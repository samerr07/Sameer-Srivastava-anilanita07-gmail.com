import { send, notFound, badRequest, deviceBusy } from '../http.js';
import { assertCan, assertCanStartSession } from '../permissions.js';
import { snapshotAuthority, sessionExpiry } from '../lifecycle.js';
import { audit } from '../audit.js';
import { newId, nowIso } from '../db.js';

function getSession(db, id) {
  return db.prepare('SELECT * FROM sessions WHERE id = ?').get(id);
}

export function registerSessionRoutes(router, { db }) {
  router.post('/v1/orgs/:org/sessions', async (ctx, params, res) => {
    const { deviceId, mode } = ctx.body ?? {};
    if (!deviceId || !mode) throw badRequest('deviceId and mode are required');
    if (!['view', 'control', 'terminal'].includes(mode)) throw badRequest('invalid mode');

    const device = db.prepare('SELECT * FROM devices WHERE id = ? AND org_id = ? AND deleted_at IS NULL')
      .get(deviceId, params.org);
    if (!device) throw notFound('not found');

    // Compound check: session:start AND the mode permission, distinguishable failure reasons.
    assertCanStartSession(db, ctx, mode, deviceId);

    const id = newId('ses');
    const authorizedBy = snapshotAuthority(db, { userId: ctx.userId, orgId: params.org, deviceId });
    const expiresAt = sessionExpiry(db, params.org);

    try {
      db.prepare(
        `INSERT INTO sessions (id, org_id, user_id, device_id, mode, state, authorized_by, started_at, expires_at)
         VALUES (?, ?, ?, ?, ?, 'active', ?, ?, ?)`
      ).run(id, params.org, ctx.userId, deviceId, mode, authorizedBy, nowIso(), expiresAt);
    } catch (err) {
      // D10: one_exclusive_session_per_device is a partial unique index. A second
      // concurrent control/terminal request hits this constraint, not a check-then-insert race.
      if (String(err.message).includes('UNIQUE') || String(err.code) === 'SQLITE_CONSTRAINT_UNIQUE') {
        const holder = db.prepare(
          `SELECT id FROM sessions WHERE device_id = ? AND state = 'active' AND mode IN ('control','terminal')`
        ).get(deviceId);
        throw deviceBusy(`device already has an exclusive session${holder ? `: ${holder.id}` : ''}`);
      }
      throw err;
    }

    audit(db, {
      orgId: params.org, actorId: ctx.userId, action: 'session.started',
      targetType: 'session', targetId: id, result: 'allow', requestId: ctx.requestId,
    });

    send(res, 201, { id, deviceId, mode, state: 'active', expiresAt });
  });

  router.get('/v1/orgs/:org/sessions', async (ctx, params, res) => {
    assertCan(db, ctx, 'session:view');
    const sessions = db.prepare('SELECT * FROM sessions WHERE org_id = ?').all(params.org);
    send(res, 200, { sessions });
  });

  // Readable by a participant OR with session:view. Note: no :org in this path per
  // BRIEF.md §5.1 ("GET /v1/sessions/{id}") -- org is derived from the session row itself.
  router.get('/v1/sessions/:id', async (ctx, params, res) => {
    const session = getSession(db, params.id);
    if (!session) throw notFound('not found');

    // Structural isolation still applies: a session from an org the caller can't
    // address is invisible, same as anything else cross-org.
    if (session.org_id !== ctx.orgId) throw notFound('not found');

    const isParticipant = session.user_id === ctx.userId;
    if (!isParticipant) {
      assertCan(db, ctx, 'session:view'); // throws 403 if not allowed
    }

    send(res, 200, {
      id: session.id, state: session.state, end_reason: session.end_reason,
      mode: session.mode, device_id: session.device_id, started_at: session.started_at,
      expires_at: session.expires_at, ended_at: session.ended_at,
    });
  });

  router.delete('/v1/sessions/:id', async (ctx, params, res) => {
    const session = getSession(db, params.id);
    if (!session) throw notFound('not found');
    if (session.org_id !== ctx.orgId) throw notFound('not found');

    const isOwnSession = session.user_id === ctx.userId;
    if (!isOwnSession) {
      assertCan(db, ctx, 'session:terminate');
    }

    db.prepare(`UPDATE sessions SET state = 'ended', end_reason = ?, ended_at = ? WHERE id = ?`)
      .run(isOwnSession ? 'user_stopped' : 'admin_terminated', nowIso(), session.id);

    audit(db, {
      orgId: session.org_id, actorId: ctx.userId, action: 'session.ended',
      targetType: 'session', targetId: session.id, result: 'allow', requestId: ctx.requestId,
    });

    send(res, 200, { id: session.id, state: 'ended' });
  });
}
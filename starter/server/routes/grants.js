import { send, notFound, badRequest, forbidden } from '../http.js';
import { assertCan, assertMayGrant } from '../permissions.js';
import { audit } from '../audit.js';
import { newId, nowIso, bumpPermVersion } from '../db.js';

export function registerGrantRoutes(router, { db }) {
  router.get('/v1/orgs/:org/grants', async (ctx, params, res) => {
    assertCan(db, ctx, 'user:read');
    const grants = db.prepare(`
      SELECT g.*, GROUP_CONCAT(gp.permission) AS permissions
      FROM grants g LEFT JOIN grant_permissions gp ON gp.grant_id = g.id
      WHERE g.org_id = ? AND g.revoked_at IS NULL
      GROUP BY g.id
    `).all(params.org);
    send(res, 200, {
      grants: grants.map((g) => ({ ...g, permissions: g.permissions ? g.permissions.split(',') : [] })),
    });
  });

  router.post('/v1/orgs/:org/grants', async (ctx, params, res) => {
    assertCan(db, ctx, 'grant:create');

    const { userId, deviceId, effect, permissions, startsAt, expiresAt } = ctx.body ?? {};
    if (!userId || !effect || !Array.isArray(permissions) || permissions.length === 0) {
      throw badRequest('userId, effect, and a non-empty permissions array are required');
    }
    if (effect !== 'allow' && effect !== 'deny') throw badRequest('effect must be allow or deny');
    if (userId === ctx.userId) throw forbidden('cannot grant to yourself', 'self_grant');

    // Validate every permission string against the catalogue/patterns before anything else,
    // so an unknown string is a clean 400 rather than hitting the DB foreign key raw.
    const valid = new Set(db.prepare('SELECT pattern FROM permission_patterns').all().map((r) => r.pattern));
    for (const p of permissions) {
      if (!valid.has(p)) throw badRequest(`unknown permission: ${p}`, 'unknown_permission');
    }

    if (deviceId) {
      const device = db.prepare('SELECT id FROM devices WHERE id = ? AND org_id = ? AND deleted_at IS NULL')
        .get(deviceId, params.org);
      if (!device) throw notFound('not found');
    }

    const targetMember = db.prepare(`SELECT * FROM memberships WHERE org_id = ? AND user_id = ? AND status = 'active'`)
      .get(params.org, userId);
    if (!targetMember) throw notFound('not found');

    if (expiresAt && new Date(expiresAt) <= new Date()) {
      throw badRequest('expiresAt must be in the future', 'GRANT_EXPIRED');
    }

    // No laundering: caller must hold every permission being granted, at this scope.
    if (effect === 'allow') {
      assertMayGrant(db, ctx, permissions, deviceId ?? null);
    }

    const id = newId('grt');
    db.prepare(
      `INSERT INTO grants (id, org_id, user_id, device_id, effect, starts_at, expires_at, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(id, params.org, userId, deviceId ?? null, effect, startsAt ?? null, expiresAt ?? null, ctx.userId);

    for (const p of permissions) {
      db.prepare('INSERT INTO grant_permissions (grant_id, permission) VALUES (?, ?)').run(id, p);
    }

    bumpPermVersion(db, { orgId: params.org, userId });

    audit(db, {
      orgId: params.org, actorId: ctx.userId, action: 'grant.created',
      targetType: 'grant', targetId: id, result: 'allow', requestId: ctx.requestId,
    });

    send(res, 201, { id, userId, deviceId: deviceId ?? null, effect, permissions });
  });

  router.delete('/v1/orgs/:org/grants/:id', async (ctx, params, res) => {
    assertCan(db, ctx, 'grant:revoke');
    const grant = db.prepare('SELECT * FROM grants WHERE id = ? AND org_id = ? AND revoked_at IS NULL')
      .get(params.id, params.org);
    if (!grant) throw notFound('not found'); // already-revoked is invisible, per the doc

    db.prepare('UPDATE grants SET revoked_at = ? WHERE id = ?').run(nowIso(), grant.id);
    bumpPermVersion(db, { orgId: params.org, userId: grant.user_id });

    audit(db, {
      orgId: params.org, actorId: ctx.userId, action: 'grant.revoked',
      targetType: 'grant', targetId: grant.id, result: 'allow', requestId: ctx.requestId,
    });

    send(res, 200, { id: grant.id, revoked: true });
  });
}
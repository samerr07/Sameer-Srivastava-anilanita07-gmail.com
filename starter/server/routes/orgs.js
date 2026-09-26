import { send, notFound } from '../http.js';
import { newId, nowIso } from '../db.js';
import { assertCan } from '../permissions.js';
import { assertNotLastOwner, endActiveSessions } from '../lifecycle.js';
import { audit } from '../audit.js';


export function registerOrgRoutes(router, { db }) {
  router.get('/v1/orgs', async (ctx, params, res) => {
    const orgs = db.prepare(`
      SELECT o.id, o.name, o.theme, m.role
      FROM memberships m JOIN organizations o ON o.id = m.org_id
      WHERE m.user_id = ? AND m.status = 'active'
    `).all(ctx.userId);
    send(res, 200, { orgs });
  });

  router.post('/v1/orgs', async (ctx, params, res) => {
    const { name } = ctx.body ?? {};
    if (!name) throw badRequest('name is required');

    const orgId = newId('org');
    db.prepare('INSERT INTO organizations (id, name, theme, max_session_minutes) VALUES (?, ?, ?, ?)')
      .run(orgId, name, 'slate', 60);
    db.prepare(
      `INSERT INTO memberships (id, org_id, user_id, role, status, joined_at)
       VALUES (?, ?, ?, 'owner', 'active', ?)`
    ).run(newId('mem'), orgId, ctx.userId, nowIso());

    send(res, 201, { id: orgId, name, role: 'owner' });
  });
}


export function registerOrgRoutesExtra(router, { db }) {
  router.patch('/v1/orgs/:org', async (ctx, params, res) => {
    assertCan(db, ctx, 'org:update');
    const org = db.prepare('SELECT * FROM organizations WHERE id = ? AND deleted_at IS NULL').get(params.org);
    if (!org) throw notFound('not found');

    const { name, theme, maxSessionMinutes } = ctx.body ?? {};
    const updates = [];
    const args = [];
    if (name) { updates.push('name = ?'); args.push(name); }
    if (theme) { updates.push('theme = ?'); args.push(theme); }
    if (maxSessionMinutes) { updates.push('max_session_minutes = ?'); args.push(maxSessionMinutes); }

    if (updates.length) {
      args.push(params.org);
      db.prepare(`UPDATE organizations SET ${updates.join(', ')} WHERE id = ?`).run(...args);
    }

    audit(db, {
      orgId: params.org, actorId: ctx.userId, action: 'org.updated',
      targetType: 'org', targetId: params.org, result: 'allow', requestId: ctx.requestId,
    });

    send(res, 200, { id: params.org, name: name ?? org.name, theme: theme ?? org.theme });
  });

  router.delete('/v1/orgs/:org', async (ctx, params, res) => {
    assertCan(db, ctx, 'org:delete');
    const org = db.prepare('SELECT * FROM organizations WHERE id = ? AND deleted_at IS NULL').get(params.org);
    if (!org) throw notFound('not found');

    db.prepare('UPDATE organizations SET deleted_at = ? WHERE id = ?').run(nowIso(), params.org);
    endActiveSessions(db, { orgId: params.org, reason: 'membership_removed' });

    audit(db, {
      orgId: params.org, actorId: ctx.userId, action: 'org.deleted',
      targetType: 'org', targetId: params.org, result: 'allow', requestId: ctx.requestId,
    });

    send(res, 200, { id: params.org, deleted: true });
  });
}
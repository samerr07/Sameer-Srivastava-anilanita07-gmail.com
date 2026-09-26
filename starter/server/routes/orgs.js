import { send, notFound } from '../http.js';
import { newId, nowIso } from '../db.js';

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
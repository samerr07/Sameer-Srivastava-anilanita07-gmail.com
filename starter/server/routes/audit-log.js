import { send, badRequest } from '../http.js';
import { assertCan } from '../permissions.js';

export function registerAuditRoutes(router, { db }) {
  router.get('/v1/orgs/:org/audit', async (ctx, params, res) => {
    assertCan(db, ctx, 'audit:read');

    const limitRaw = ctx.query.get('limit');
    const offsetRaw = ctx.query.get('offset');
    const limit = limitRaw !== null ? Number(limitRaw) : 50;
    const offset = offsetRaw !== null ? Number(offsetRaw) : 0;

    if (!Number.isInteger(limit) || limit < 1 || limit > 200) throw badRequest('limit must be 1-200');
    if (!Number.isInteger(offset) || offset < 0) throw badRequest('offset must be >= 0');

    const events = db.prepare(
      `SELECT * FROM audit_events WHERE org_id = ? ORDER BY at DESC LIMIT ? OFFSET ?`
    ).all(params.org, limit, offset);

    send(res, 200, { events });
  });
}
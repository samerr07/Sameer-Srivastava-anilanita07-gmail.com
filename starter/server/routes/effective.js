import { send, notFound, forbidden } from '../http.js';
import { resolve } from '../permissions.js';

export function registerEffectiveRoutes(router, { db }) {
  router.get('/v1/orgs/:org/users/:userId/effective', async (ctx, params, res) => {
    const isSelf = params.userId === ctx.userId;
    if (!isSelf) {
      // user:read, or self -- reuse assertCan's own throw for the non-self case
      const { permissions } = resolve(db, { userId: ctx.userId, orgId: params.org });
      if (permissions['user:read']?.effect !== 'allow') {
        throw forbidden('missing permission: user:read', 'missing_permission');
      }
    }

    const target = db.prepare(`SELECT * FROM memberships WHERE org_id = ? AND user_id = ? AND status != 'removed'`)
      .get(params.org, params.userId);
    if (!target) throw notFound('not found');

    const { role, permissions } = resolve(db, { userId: params.userId, orgId: params.org });
    send(res, 200, { role, permissions });
  });
}
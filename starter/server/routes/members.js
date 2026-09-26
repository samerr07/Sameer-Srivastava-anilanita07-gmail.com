import { send, notFound, badRequest, selfRoleChange, forbidden } from '../http.js';
import { assertCan } from '../permissions.js';
import { assertCanModify, assertNotLastOwner, endActiveSessions } from '../lifecycle.js';
import { audit } from '../audit.js';

function getActiveMembership(db, orgId, userId) {
  return db.prepare(`SELECT * FROM memberships WHERE org_id = ? AND user_id = ? AND status = 'active'`)
    .get(orgId, userId);
}

export function registerMemberRoutes(router, { db }) {
  router.get('/v1/orgs/:org/members', async (ctx, params, res) => {
    assertCan(db, ctx, 'user:read');
    const members = db.prepare(`
      SELECT u.id, u.email, u.name, m.role, m.status
      FROM memberships m JOIN users u ON u.id = m.user_id
      WHERE m.org_id = ? AND m.status != 'removed'
    `).all(params.org);
    send(res, 200, { members });
  });

  // NOTE: registered BEFORE /members/:userId below, since the router is
  // first-match-wins and 'me' would otherwise be swallowed by the :userId pattern.
  router.delete('/v1/orgs/:org/members/me', async (ctx, params, res) => {
    assertNotLastOwner(db, params.org, ctx.userId);
    const membership = getActiveMembership(db, params.org, ctx.userId);
    if (!membership) throw notFound('not found');

    db.prepare(`UPDATE memberships SET status = 'removed', perm_version = perm_version + 1 WHERE id = ?`)
      .run(membership.id);
    endActiveSessions(db, { orgId: params.org, userId: ctx.userId, reason: 'membership_removed' });

    audit(db, {
      orgId: params.org, actorId: ctx.userId, action: 'member.left',
      targetType: 'user', targetId: ctx.userId, result: 'allow', requestId: ctx.requestId,
    });

    send(res, 200, { userId: ctx.userId, status: 'removed' });
  });

  router.patch('/v1/orgs/:org/members/:userId', async (ctx, params, res) => {
    assertCan(db, ctx, 'user:role:update');

    if (params.userId === ctx.userId) throw selfRoleChange();

    const target = getActiveMembership(db, params.org, params.userId);
    if (!target) throw notFound('not found');

    const { role: newRole } = ctx.body ?? {};
    if (!newRole) throw badRequest('role is required');

    if (newRole === 'owner' && ctx.role !== 'owner') {
      throw forbidden('only an owner may confer owner', 'insufficient_rank');
    }

    assertCanModify(db, ctx.role, target.role);

    if (target.role === 'owner' && newRole !== 'owner') {
      assertNotLastOwner(db, params.org, params.userId);
    }

    db.prepare('UPDATE memberships SET role = ?, perm_version = perm_version + 1 WHERE id = ?')
      .run(newRole, target.id);

    audit(db, {
      orgId: params.org, actorId: ctx.userId, action: 'member.role_updated',
      targetType: 'user', targetId: params.userId, result: 'allow', requestId: ctx.requestId,
    });

    send(res, 200, { userId: params.userId, role: newRole });
  });

  router.post('/v1/orgs/:org/members/:userId/suspend', async (ctx, params, res) => {
    assertCan(db, ctx, 'user:remove');
    const target = getActiveMembership(db, params.org, params.userId);
    if (!target) throw notFound('not found');
    assertCanModify(db, ctx.role, target.role);

    db.prepare(`UPDATE memberships SET status = 'suspended', perm_version = perm_version + 1 WHERE id = ?`)
      .run(target.id);
    endActiveSessions(db, { orgId: params.org, userId: params.userId, reason: 'user_suspended' });

    audit(db, {
      orgId: params.org, actorId: ctx.userId, action: 'member.suspended',
      targetType: 'user', targetId: params.userId, result: 'allow', requestId: ctx.requestId,
    });

    send(res, 200, { userId: params.userId, status: 'suspended' });
  });

  router.delete('/v1/orgs/:org/members/:userId/suspend', async (ctx, params, res) => {
    assertCan(db, ctx, 'user:remove');
    const target = db.prepare(`SELECT * FROM memberships WHERE org_id = ? AND user_id = ? AND status = 'suspended'`)
      .get(params.org, params.userId);
    if (!target) throw notFound('not found');

    db.prepare(`UPDATE memberships SET status = 'active', perm_version = perm_version + 1 WHERE id = ?`)
      .run(target.id);

    audit(db, {
      orgId: params.org, actorId: ctx.userId, action: 'member.reinstated',
      targetType: 'user', targetId: params.userId, result: 'allow', requestId: ctx.requestId,
    });

    send(res, 200, { userId: params.userId, status: 'active' });
  });

  router.delete('/v1/orgs/:org/members/:userId', async (ctx, params, res) => {
    assertCan(db, ctx, 'user:remove');
    const target = getActiveMembership(db, params.org, params.userId);
    if (!target) throw notFound('not found');
    assertCanModify(db, ctx.role, target.role);
    assertNotLastOwner(db, params.org, params.userId);

    db.prepare(`UPDATE memberships SET status = 'removed', perm_version = perm_version + 1 WHERE id = ?`)
      .run(target.id);
    endActiveSessions(db, { orgId: params.org, userId: params.userId, reason: 'membership_removed' });

    audit(db, {
      orgId: params.org, actorId: ctx.userId, action: 'member.removed',
      targetType: 'user', targetId: params.userId, result: 'allow', requestId: ctx.requestId,
    });

    send(res, 200, { userId: params.userId, status: 'removed' });
  });
}
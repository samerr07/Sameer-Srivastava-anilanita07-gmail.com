import { createHash, randomBytes } from 'node:crypto';
import { send, notFound, badRequest, conflict, gone, forbidden } from '../http.js';
import { assertCan } from '../permissions.js';
import { assertRoleExists } from '../lifecycle.js';
import { hashPassword } from '../auth.js';
import { audit } from '../audit.js';
import { newId, nowIso } from '../db.js';

const newInviteToken = () => randomBytes(32).toString('base64url');
const hashInvite = (raw) => createHash('sha256').update(raw).digest('hex');

export function registerInviteRoutes(router, { db }) {
  router.post('/v1/orgs/:org/invites', async (ctx, params, res) => {
    assertCan(db, ctx, 'user:invite');

    const { email, role } = ctx.body ?? {};
    if (!email || !role) throw badRequest('email and role are required');
    assertRoleExists(db, role);

    const normalizedEmail = String(email).trim().toLowerCase();

    // Only an owner may confer an owner invite, and the invited role must be
    // assignable by the caller (mirrors the role-conferral rule on member updates).
    if (role === 'owner' && ctx.role !== 'owner') {
      throw forbidden('only an owner may invite as owner', 'insufficient_rank');
    }

    const existingMember = db.prepare(`
      SELECT m.* FROM memberships m JOIN users u ON u.id = m.user_id
      WHERE m.org_id = ? AND u.email = ? AND m.status = 'active'
    `).get(params.org, normalizedEmail);
    if (existingMember) throw conflict('already an active member', 'ALREADY_MEMBER');

    const existingInvite = db.prepare(`
      SELECT * FROM invites WHERE org_id = ? AND email = ? AND accepted_at IS NULL AND revoked_at IS NULL
    `).get(params.org, normalizedEmail);
    if (existingInvite) throw conflict('a live invite already exists for this email', 'INVITE_EXISTS');

    const rawToken = newInviteToken();
    const inviteId = newId('inv');
    const expiresAt = new Date(Date.now() + 7 * 86400_000).toISOString();

    db.prepare(
      `INSERT INTO invites (id, org_id, email, role, token_hash, invited_by, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(inviteId, params.org, normalizedEmail, role, hashInvite(rawToken), ctx.userId, expiresAt);

    audit(db, {
      orgId: params.org, actorId: ctx.userId, action: 'invite.created',
      targetType: 'invite', targetId: inviteId, result: 'allow', requestId: ctx.requestId,
    });

    // Raw token returned exactly once -- never logged, never stored anywhere else.
    send(res, 201, { id: inviteId, email: normalizedEmail, role, inviteToken: rawToken, expiresAt });
  });

  router.get('/v1/orgs/:org/invites', async (ctx, params, res) => {
    assertCan(db, ctx, 'user:invite');
    const invites = db.prepare(`
      SELECT id, email, role, expires_at, accepted_at, revoked_at
      FROM invites WHERE org_id = ?
    `).all(params.org);
    send(res, 200, { invites });
  });

  router.delete('/v1/orgs/:org/invites/:id', async (ctx, params, res) => {
    assertCan(db, ctx, 'user:invite');
    const invite = db.prepare('SELECT * FROM invites WHERE id = ? AND org_id = ?').get(params.id, params.org);
    if (!invite) throw notFound('not found');

    db.prepare('UPDATE invites SET revoked_at = ? WHERE id = ?').run(nowIso(), invite.id);

    audit(db, {
      orgId: params.org, actorId: ctx.userId, action: 'invite.revoked',
      targetType: 'invite', targetId: invite.id, result: 'allow', requestId: ctx.requestId,
    });

    send(res, 200, { id: invite.id, revoked: true });
  });

  // Public: no auth. Returns only enough to render "you've been invited as X".
  router.get('/v1/invites/:token', async (ctx, params, res) => {
    const hash = hashInvite(params.token);
    const invite = db.prepare(`
      SELECT i.*, o.name AS org_name FROM invites i JOIN organizations o ON o.id = i.org_id
      WHERE i.token_hash = ?
    `).get(hash);

    if (!invite) throw notFound('not found');
    if (invite.revoked_at || new Date(invite.expires_at) <= new Date()) throw gone();
    if (invite.accepted_at) throw notFound('not found'); // spent token looks the same as absent

    send(res, 200, { orgName: invite.org_name, role: invite.role, email: invite.email, expiresAt: invite.expires_at });
  });

  // Public: accept. One transaction -- upsert user, flip membership, issue tokens
  // is handled by the login flow afterward (client logs in immediately after accept).
  router.post('/v1/invites/:token/accept', async (ctx, params, res) => {
    const { name, password } = ctx.body ?? {};
    if (!name || !password) throw badRequest('name and password are required');

    const hash = hashInvite(params.token);

    const accept = db.transaction(() => {
      const invite = db.prepare('SELECT * FROM invites WHERE token_hash = ?').get(hash);
      if (!invite) throw notFound('not found');
      if (invite.revoked_at || new Date(invite.expires_at) <= new Date()) throw gone();
      if (invite.accepted_at) throw conflict('invite already accepted', 'INVITE_SPENT');

      let user = db.prepare('SELECT * FROM users WHERE email = ?').get(invite.email);
      if (!user) {
        const userId = newId('usr');
        db.prepare('INSERT INTO users (id, email, name, password_hash) VALUES (?, ?, ?, ?)')
          .run(userId, invite.email, name, hashPassword(password));
        user = { id: userId };
      }

      let membership = db.prepare(`SELECT * FROM memberships WHERE org_id = ? AND user_id = ?`)
        .get(invite.org_id, user.id);

      if (membership) {
        db.prepare(`UPDATE memberships SET status = 'active', role = ?, perm_version = perm_version + 1 WHERE id = ?`)
          .run(invite.role, membership.id);
      } else {
        db.prepare(
          `INSERT INTO memberships (id, org_id, user_id, role, status, joined_at)
           VALUES (?, ?, ?, ?, 'active', ?)`
        ).run(newId('mem'), invite.org_id, user.id, invite.role, nowIso());
      }

      db.prepare('UPDATE invites SET accepted_at = ?, accepted_by = ? WHERE id = ?')
        .run(nowIso(), user.id, invite.id);

      return { userId: user.id, orgId: invite.org_id, role: invite.role };
    });

    const result = accept();

    audit(db, {
      orgId: result.orgId, actorId: result.userId, action: 'invite.accepted',
      targetType: 'invite', targetId: null, result: 'allow', requestId: ctx.requestId,
    });

    send(res, 200, result);
  });
}
import { verifyPassword, issueAccessToken, newRefreshToken, hashRefreshToken, REFRESH_TTL_SECONDS } from '../auth.js';
import { badRequest, unauthenticated, send } from '../http.js';
import { newId } from '../db.js';

function serializeOrgs(db, userId) {
  return db.prepare(`
    SELECT o.id, o.name, o.theme, m.role
    FROM memberships m JOIN organizations o ON o.id = m.org_id
    WHERE m.user_id = ? AND m.status = 'active'
  `).all(userId);
}

// No stated rule for which org is "default" on login with no orgId given.
// Picking the highest-rank active membership (ties broken by join order) is a
// reasonable, defensible choice — worth a DECISIONS.md line since the docs don't say.
function pickDefaultMembership(db, userId) {
  return db.prepare(`
    SELECT m.* FROM memberships m
    JOIN roles r ON r.key = m.role
    WHERE m.user_id = ? AND m.status = 'active'
    ORDER BY r.rank DESC, m.joined_at ASC
    LIMIT 1
  `).get(userId);
}

function setRefreshCookie(res, rawToken) {
  res.setHeader(
    'Set-Cookie',
    `refresh_token=${rawToken}; HttpOnly; SameSite=Strict; Path=/v1/auth; Max-Age=${REFRESH_TTL_SECONDS}`
  );
}

function issueSession(db, secret, res, user, membership) {
  const accessToken = issueAccessToken(
    { userId: user.id, orgId: membership.org_id, role: membership.role, permVersion: membership.perm_version },
    secret
  );
  const rawRefresh = newRefreshToken();
  db.prepare(
    `INSERT INTO refresh_tokens (id, user_id, token_hash, family_id, expires_at)
     VALUES (?, ?, ?, ?, ?)`
  ).run(
    newId('rt'), user.id, hashRefreshToken(rawRefresh), newId('fam'),
    new Date(Date.now() + REFRESH_TTL_SECONDS * 1000).toISOString()
  );
  setRefreshCookie(res, rawRefresh);
  return accessToken;
}

export function registerAuthRoutes(router, { db, secret }) {
  router.post('/v1/auth/login', async (ctx, params, res) => {
    const { email, password, orgId } = ctx.body ?? {};
    if (!email || !password) throw badRequest('email and password are required');

    const user = db.prepare('SELECT * FROM users WHERE email = ?').get(String(email).toLowerCase());
    if (!user || !verifyPassword(password, user.password_hash)) {
      throw unauthenticated('invalid email or password');
    }

    const membership = orgId
      ? db.prepare(`SELECT * FROM memberships WHERE user_id = ? AND org_id = ? AND status = 'active'`).get(user.id, orgId)
      : pickDefaultMembership(db, user.id);

    if (!membership) throw unauthenticated('no active membership');

    const token = issueSession(db, secret, res, user, membership);

    send(res, 200, {
      token,
      role: membership.role,
      orgId: membership.org_id,
      orgs: serializeOrgs(db, user.id),
    });
  });
}
import { verifyPassword, issueAccessToken, newRefreshToken, hashRefreshToken, REFRESH_TTL_SECONDS } from '../auth.js';
import { badRequest, unauthenticated, send } from '../http.js';
import { newId } from '../db.js';
import { assertFresh } from '../auth.js';
import { resolve } from '../permissions.js';
import { notFound } from '../http.js';


function serializeOrgs(db, userId) {
  return db.prepare(`
    SELECT o.id, o.name, o.theme, m.role
    FROM memberships m JOIN organizations o ON o.id = m.org_id
    WHERE m.user_id = ? AND m.status = 'active'
  `).all(userId);
}

function parseCookies(req) {
  const header = req.headers['cookie'];
  if (!header) return {};
  return Object.fromEntries(
    header.split(';').map((p) => {
      const idx = p.indexOf('=');
      return [p.slice(0, idx).trim(), decodeURIComponent(p.slice(idx + 1).trim())];
    })
  );
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


export function registerAuthRoutesExtra(router, { db, secret }) {
  router.post('/v1/auth/refresh', async (ctx, params, res) => {
    const cookies = parseCookies(ctx.req);
    const raw = cookies['refresh_token'];
    if (!raw) throw unauthenticated('no refresh token');

    const tokenHash = hashRefreshToken(raw);
    const row = db.prepare('SELECT * FROM refresh_tokens WHERE token_hash = ?').get(tokenHash);

    if (!row) throw unauthenticated('invalid refresh token');

    // Reuse of an already-rotated token: revoke the whole family (AUTH-DATA-MODEL.md §2)
    if (row.revoked_at) {
      db.prepare('UPDATE refresh_tokens SET revoked_at = ? WHERE family_id = ? AND revoked_at IS NULL')
        .run(nowIso(), row.family_id);
      throw unauthenticated('refresh token reused; session revoked');
    }
    if (new Date(row.expires_at) <= new Date()) throw unauthenticated('refresh token expired');

    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(row.user_id);
    const membership = pickDefaultMembership(db, user.id); // see note below

    // rotate: revoke this row, issue a new one in the same family
    db.prepare('UPDATE refresh_tokens SET revoked_at = ? WHERE id = ?').run(nowIso(), row.id);
    const newRaw = newRefreshToken();
    db.prepare(
      `INSERT INTO refresh_tokens (id, user_id, token_hash, family_id, expires_at)
       VALUES (?, ?, ?, ?, ?)`
    ).run(newId('rt'), user.id, hashRefreshToken(newRaw), row.family_id,
      new Date(Date.now() + REFRESH_TTL_SECONDS * 1000).toISOString());
    setRefreshCookie(res, newRaw);

    const accessToken = issueAccessToken(
      { userId: user.id, orgId: membership.org_id, role: membership.role, permVersion: membership.perm_version },
      secret
    );
    send(res, 200, { token: accessToken, role: membership.role, orgId: membership.org_id });
  });

  router.post('/v1/auth/token', async (ctx, params, res) => {
    const { orgId } = ctx.body ?? {};
    if (!orgId) throw badRequest('orgId is required');

    const membership = db.prepare(
      `SELECT * FROM memberships WHERE user_id = ? AND org_id = ? AND status = 'active'`
    ).get(ctx.userId, orgId);
    if (!membership) throw notFound('not found'); // can't address an org you're not a member of

    const accessToken = issueAccessToken(
      { userId: ctx.userId, orgId: membership.org_id, role: membership.role, permVersion: membership.perm_version },
      secret
    );
    send(res, 200, { token: accessToken, role: membership.role, orgId: membership.org_id });
  });

  router.get('/v1/auth/me', async (ctx, params, res) => {
    const user = db.prepare('SELECT id, email, name FROM users WHERE id = ?').get(ctx.userId);
    const { permissions } = resolve(db, { userId: ctx.userId, orgId: ctx.orgId, deviceId: null });

    send(res, 200, {
      user,
      orgId: ctx.orgId,
      role: ctx.role,
      orgs: serializeOrgs(db, ctx.userId),
      permissions,
    });
  });
}
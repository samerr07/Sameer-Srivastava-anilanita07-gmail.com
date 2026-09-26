// Per-request context: turn a bearer token into an authenticated caller.
//
// YOURS TO WRITE. This file ships as a stub so the server boots and every
// authenticated request fails loudly instead of appearing to work.
//
// What it has to do (BRIEF.md §3, PERMISSIONS.md §6):
//   - read the bearer token, verify it with verifyAccessToken() from ./auth.js
//   - look the membership up and refuse a token whose org or membership is gone
//   - THE TOKEN'S org CLAIM IS THE ONLY ORG THE CALLER MAY ADDRESS. A request that
//     names a different org is INVISIBLE — 404, never 403. Isolation is structural:
//     the caller cannot name another org, rather than being filtered afterwards.
//   - check freshness against memberships.perm_version (AUTH-DATA-MODEL.md §3), so a
//     role or grant change takes effect on the NEXT request, not at token expiry
//   - throw through the one error path in ./http.js
//
// authenticate(db, secret) returns (req, params) => caller, where caller carries at
// least { userId, orgId, role, membership, claims }.

import { verifyAccessToken, assertFresh } from './auth.js';
import { unauthenticated, notFound } from './http.js';

function extractBearerToken(req) {
  const header = req.headers['authorization'];
  if (!header || !header.startsWith('Bearer ')) {
    throw unauthenticated('missing bearer token');
  }
  return header.slice('Bearer '.length).trim();
}

function getMembership(db, userId, orgId) {
  return db.prepare('SELECT * FROM memberships WHERE user_id = ? AND org_id = ?').get(userId, orgId);
}

const todo = () =>
  Object.assign(
    new Error('TODO: server/context.js — authenticate() is yours to write (BRIEF.md §3).'),
    { code: 'NOT_IMPLEMENTED' }
  );

export function authenticate(db, secret) {
  return function buildContext(req, params) {
    const token = extractBearerToken(req);
    const claims = verifyAccessToken(token, secret);

    const membership = getMembership(db, claims.sub, claims.org);

    if (!membership || (params?.org && params.org !== claims.org)) {
      throw notFound('not found');
    }

    assertFresh(claims, membership);

    return {
      userId: claims.sub,
      orgId: claims.org,
      role: membership.role,
      membership,
      claims,
    };
  };
}

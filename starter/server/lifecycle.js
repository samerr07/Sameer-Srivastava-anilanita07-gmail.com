// Shared domain rules: role ranks, last-owner protection, ending sessions.
//
// YOURS TO WRITE. This file ships as a stub.
//
// Put here the rules more than one route needs, so "what ends a session" has exactly
// one implementation. Sources: PERMISSIONS.md §7.2 and D8.
//
// Two traps worth naming before you start:
//   - `roles.rank` is MODIFICATION AUTHORITY ONLY. It must never answer a can()
//     question. operator and auditor are unordered by permission, and ranking them is
//     the modelling error the auditor role exists to catch.
//   - a permission change does NOT end a session in flight (grantfathering). Suspension,
//     membership removal and device transfer DO. See PERMISSIONS.md §7.
import { forbidden, lastOwner, badRequest } from './http.js';
import { newId, nowIso } from './db.js';
import { resolve } from './permissions.js';

const todo = (name) =>
  Object.assign(
    new Error(`TODO: server/lifecycle.js — ${name}() is yours to write (BRIEF.md §3).`),
    { code: 'NOT_IMPLEMENTED' }
  );
export function roleRanks(db) {
  const rows = db.prepare('SELECT key, rank FROM roles').all();
  return new Map(rows.map((r) => [r.key, r.rank]));
}

export function assertRoleExists(db, role) {
  const row = db.prepare('SELECT key FROM roles WHERE key = ?').get(role);
  if (!row) throw badRequest(`unknown role: ${role}`);
}


// D8: modify a user of strictly LOWER rank -> allowed. Equal or higher -> 403.
// Never used to answer a can() question -- that's permissions.js's job entirely.
export function assertCanModify(db, callerRole, targetRole) {
  const ranks = roleRanks(db);
  const callerRank = ranks.get(callerRole);
  const targetRank = ranks.get(targetRole);
  if (callerRank === undefined || targetRank === undefined) {
    throw forbidden('unknown role', 'invalid_role');
  }
  if (callerRank <= targetRank) {
    throw forbidden('cannot modify a user of equal or higher rank', 'insufficient_rank');
  }
}

// D8: an org must always have at least one owner.
export function assertNotLastOwner(db, orgId, userId) {
  const membership = db.prepare(
    `SELECT * FROM memberships WHERE org_id = ? AND user_id = ? AND status = 'active'`
  ).get(orgId, userId);
  if (!membership || membership.role !== 'owner') return; // not an owner: nothing to protect

  const ownerCount = db.prepare(
    `SELECT count(*) AS n FROM memberships WHERE org_id = ? AND role = 'owner' AND status = 'active'`
  ).get(orgId).n;

  if (ownerCount <= 1) throw lastOwner();
}

// PERMISSIONS.md §7: account/tenancy events cascade into ending live sessions.
// Permission-only changes never call this.
export function endActiveSessions(db, { orgId, userId, deviceId, reason, exceptSessionId }) {
  let query = `UPDATE sessions SET state = 'ended', end_reason = ?, ended_at = ? WHERE org_id = ? AND state = 'active'`;
  const args = [reason, nowIso(), orgId];
  if (userId) { query += ' AND user_id = ?'; args.push(userId); }
  if (deviceId) { query += ' AND device_id = ?'; args.push(deviceId); }
  if (exceptSessionId) { query += ' AND id != ?'; args.push(exceptSessionId); }
  db.prepare(query).run(...args);
}

// §7.1: a session's authority is snapshotted at start and never re-derived later.
// This is what makes grandfathering safe -- the snapshot, not a live lookup, is
// what the session carries for its lifetime.
export function snapshotAuthority(db, { userId, orgId, deviceId }) {
  const { role, permissions } = resolve(db, { userId, orgId, deviceId });
  return JSON.stringify({ role, permissions, snapshotAt: nowIso() });
}

export function sessionExpiry(db, orgId) {
  const org = db.prepare('SELECT max_session_minutes FROM organizations WHERE id = ?').get(orgId);
  const minutes = org?.max_session_minutes ?? 60;
  return new Date(Date.now() + minutes * 60_000).toISOString();
}

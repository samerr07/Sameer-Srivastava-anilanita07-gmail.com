// The permission resolution engine. THE ONLY PLACE allow-vs-deny is decided.
//
// YOURS TO WRITE. This file ships as a stub.
//
// If you ever find yourself writing `if (role === 'admin')` outside this file — and
// especially under web/ — that is the bug this module exists to prevent. The console
// renders what this returns; it must never re-derive it.
//
// Inputs you will need:
//   permissions                 the catalogue (19 rows in db/reference.sql, but read it
//                               from the table, never hardcode it)
//   permission_patterns         the superset grants may name ('device:*', '*', ...)
//   role_permissions            the per-role baseline
//   memberships                 role + status + perm_version
//   grants / grant_permissions  per-user deltas, optionally device-scoped and windowed
//
// Behaviour to implement is in PERMISSIONS.md; the failure modes and the reason codes
// the API must report are in §10, and the shipped tests read those reason strings.
//
// NOTE: your database is personalised. There is at least one role and one permission in
// it that this exercise's prose never mentions. Read the tables; do not encode the
// documented matrix. Run `npm run personalisation` to see what you are dealing with.
import { forbidden } from './http.js';
const todo = (name) =>
  Object.assign(
    new Error(`TODO: server/permissions.js — ${name}() is yours to write (BRIEF.md §3).`),
    { code: 'NOT_IMPLEMENTED' }
  );

export const MODE_PERMISSION = { view: 'device:view', control: 'device:control', terminal: 'device:terminal' };

// Resolve one user's permission set in one org. deviceId === null means the org-level
// view; a deviceId means the exact per-device check.

function patternMatches(pattern, permission) {
  if(pattern === '*') return true;
  if(pattern === permission) return true;
  if(pattern.endsWith(':*')) return permission.startsWith(pattern.slice(0,-1));
  return false;
}

function membershipDenyReason(membership) {
  if (!membership) return 'not_a_member';
  if (membership.status === 'suspended') return 'suspended';
  if (membership.status !== 'active') return 'not_a_member'; // invited, removed
  return null;
}

function fetchGrants(db, {userId, orgId, now}){
  const nowISO = now.toISOString();
  return db.prepare(`
    SELECT g.id, g.device_id, g.effect, gp.permission
    FROM grants g
    JOIN grant_permissions gp ON g.id = gp.grant_id
    WHERE g.user_id = ? AND g.org_id = ? AND g.revoked_at IS NULL
      AND (g.starts_at IS NULL OR g.starts_at <= ?)
      AND (g.expires_at IS NULL OR ? < g.expires_at)
    `).all(userId, orgId, nowISO, nowISO);
}


function resolveOne({ permission, deviceId, grants, roleBaseline, role }) {
  const applicable = grants.filter(
    (g) => (g.device_id === null || g.device_id === deviceId) && patternMatches(g.permission, permission)
  );
  const deny = applicable.find((g) => g.effect === 'deny');
  if (deny) return { effect: 'deny', source: `grant:${deny.id}`, reason: 'explicit_deny' };

  const allow = applicable.find((g) => g.effect === 'allow');
  if (allow) return { effect: 'allow', source: `grant:${allow.id}`, reason: null };

  if (roleBaseline.has(permission)) return { effect: 'allow', source: `role:${role}`, reason: null };

  return { effect: 'deny', source: null, reason: 'implicit' };
}


function getMembership(db, userId, orgId) {
  return db.prepare('SELECT * FROM memberships WHERE user_id = ? AND org_id = ?').get(userId, orgId);
}
  
function getRoleBaseline(db, role) {
  return new Set(
    db.prepare('SELECT permission FROM role_permissions WHERE role = ?').all(role).map((r) => r.permission)
  );
}


export function resolve(db, { userId, orgId, deviceId = null, now = new Date() }) {
 const membership = getMembership(db, userId, orgId);
  const allPermissions = db.prepare('SELECT key FROM permissions').all().map((r) => r.key);
  const denyReason = membershipDenyReason(membership);

  // if (!membership || membership.status !== 'active') {
  //   const permissions = {};
  //   for (const p of allPermissions) permissions[p] = { effect: 'deny', source: null, reason: 'implicit' };
  //   return { role: membership?.role ?? null, permissions };
  // }

    if (denyReason) {
    const permissions = {};
    for (const p of allPermissions) permissions[p] = { effect: 'deny', source: null, reason: denyReason };
    return { role: membership?.role ?? null, permissions };
  }
  const roleBaseline = getRoleBaseline(db, membership.role);
  const grants = fetchGrants(db, { userId, orgId, now });
  const permissions = {};

  if (deviceId !== null) {
    // device-level: exact check for this one device
    for (const p of allPermissions) {
      permissions[p] = resolveOne({ permission: p, deviceId, grants, roleBaseline, role: membership.role });
    }
  } else {
    // org-level: union across devices for device-scoped permissions;
    // direct resolution for everything else
    const deviceIds = db.prepare('SELECT id FROM devices WHERE org_id = ? AND deleted_at IS NULL')
      .all(orgId).map((r) => r.id);

    for (const p of allPermissions) {
      if (!p.startsWith('device:')) {
        permissions[p] = resolveOne({ permission: p, deviceId: null, grants, roleBaseline, role: membership.role });
        continue;
      }
      // union: allowed at org level if allowed on at least one device
      let result = null;
      for (const devId of deviceIds) {
        const r = resolveOne({ permission: p, deviceId: devId, grants, roleBaseline, role: membership.role });
        if (r.effect === 'allow') { result = r; break; }
        if (!result) result = r; // keep first deny as fallback if nothing allows
      }
      permissions[p] = result ?? resolveOne({ permission: p, deviceId: null, grants, roleBaseline, role: membership.role });
    }
  }

  return { role: membership.role, permissions };
  // throw todo('resolve');
}




// Batched form for list endpoints: { role, byDevice: { [deviceId]: permissions } }.
export function resolveDevices(db, { userId, orgId, deviceIds, now = new Date() }) {
  const membership = getMembership(db, userId, orgId);
  const devicePermissions = db.prepare("SELECT key FROM permissions WHERE resource = 'device'")
    .all().map((r) => r.key);

  const byDevice = {};
  if (!membership || membership.status !== 'active') {
    for (const id of deviceIds) {
      byDevice[id] = Object.fromEntries(
        devicePermissions.map((p) => [p, { effect: 'deny', source: null, reason: 'implicit' }])
      );
    }
    return { role: membership?.role ?? null, byDevice };
  }

  const roleBaseline = getRoleBaseline(db, membership.role);
  const grants = fetchGrants(db, { userId, orgId, now });

  for (const id of deviceIds) {
    byDevice[id] = {};
    for (const p of devicePermissions) {
      byDevice[id][p] = resolveOne({ permission: p, deviceId: id, grants, roleBaseline, role: membership.role });
    }
  }
  return { role: membership.role, byDevice };
  
  // throw todo('resolveDevices');
}

export function can(db, ctx, permission, deviceId=null) {
  const membership = getMembership(db, ctx.userId, ctx.orgId);
  if (!membership || membership.status !== 'active') return false;
  const roleBaseline = getRoleBaseline(db, membership.role);
  const grants = fetchGrants(db, { userId: ctx.userId, orgId: ctx.orgId, now: ctx.now ?? new Date() });
  const result = resolveOne({ permission, deviceId, grants, roleBaseline, role: membership.role });
  return result.effect === 'allow';
  // throw todo('can');
}

// Throws 403 carrying the reason code, so a refusal is debuggable.
export function assertCan(db, ctx, permission, deviceId=null) {
 const membership = getMembership(db, ctx.userId, ctx.orgId);
  const denyReason = membershipDenyReason(membership);
  if (denyReason) throw forbidden('not an active member of this org', denyReason);

  const roleBaseline = getRoleBaseline(db, membership.role);
  const grants = fetchGrants(db, { userId: ctx.userId, orgId: ctx.orgId, now: ctx.now ?? new Date() });
  const result = resolveOne({ permission, deviceId, grants, roleBaseline, role: membership.role });

  if (result.effect !== 'allow') {
    const reason = result.reason === 'explicit_deny' ? 'explicit_deny' : 'missing_permission';
    throw forbidden(`missing permission: ${permission}`, reason);
  }
  // throw todo('assertCan');
}

// No privilege laundering: you may only grant authority you hold at that scope.
export function assertMayGrant(db, ctx, patterns, deviceId = null) {
  const membership = getMembership(db, ctx.userId, ctx.orgId);
  const denyReason = membershipDenyReason(membership);
  // if (!membership || membership.status !== 'active') {
  //   throw forbidden('not an active member of this org', 'implicit');
  // }
   if (denyReason) throw forbidden('not an active member of this org', denyReason);
  const roleBaseline = getRoleBaseline(db, membership.role);
  const grants = fetchGrants(db, { userId: ctx.userId, orgId: ctx.orgId, now: ctx.now ?? new Date() });

  // Every concrete permission in the catalogue that each pattern could expand to
  const allPermissions = db.prepare('SELECT key FROM permissions').all().map((r) => r.key);

  for (const pattern of patterns) {
    const covered = allPermissions.filter((p) => patternMatches(pattern, p));
    for (const permission of covered) {
      const result = resolveOne({ permission, deviceId, grants, roleBaseline, role: membership.role });
      if (result.effect !== 'allow') {
        throw forbidden(`cannot grant ${permission}: you do not hold it at this scope`, 'scope_mismatch');
      }
    }
  }
  // throw todo('assertMayGrant');
}

// The compound check: session:start AND the permission for the requested mode, and a
// refusal must distinguish WHICH of the two was missing.
export function assertCanStartSession(db, ctx, mode, deviceId) {
  const membership = getMembership(db, ctx.userId, ctx.orgId);
  const denyReason = membershipDenyReason(membership);
  if (denyReason) throw forbidden('not an active member of this org', denyReason);

  const roleBaseline = getRoleBaseline(db, membership.role);
  const grants = fetchGrants(db, { userId: ctx.userId, orgId: ctx.orgId, now: ctx.now ?? new Date() });

  const startResult = resolveOne({ permission: 'session:start', deviceId, grants, roleBaseline, role: membership.role });
  if (startResult.effect !== 'allow') {
    const reason = startResult.reason === 'explicit_deny' ? 'explicit_deny' : 'missing_permission';
    throw forbidden('cannot start sessions', reason);
  }

  const modePermission = MODE_PERMISSION[mode];
  const modeResult = resolveOne({ permission: modePermission, deviceId, grants, roleBaseline, role: membership.role });
  if (modeResult.effect !== 'allow') {
    const reason = modeResult.reason === 'explicit_deny' ? 'explicit_deny' : 'missing_device_permission';
    throw forbidden(`missing ${modePermission} on this device`, reason);
  }
}

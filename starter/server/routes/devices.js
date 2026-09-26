import { send, notFound, badRequest, forbidden } from '../http.js';
import { assertCan } from '../permissions.js';
import { resolveDevices, resolve } from '../permissions.js';
import { endActiveSessions } from '../lifecycle.js';
import { audit } from '../audit.js';
import { newId, nowIso } from '../db.js';

function getDevice(db, orgId, deviceId) {
  return db.prepare('SELECT * FROM devices WHERE id = ? AND org_id = ? AND deleted_at IS NULL')
    .get(deviceId, orgId);
}

export function registerDeviceRoutes(router, { db }) {
  // device:list gates the endpoint; device:view decides row inclusion (denied rows
  // are absent entirely, never shown redacted).
  router.get('/v1/orgs/:org/devices', async (ctx, params, res) => {
    assertCan(db, ctx, 'device:list');

    const devices = db.prepare('SELECT * FROM devices WHERE org_id = ? AND deleted_at IS NULL').all(params.org);
    const deviceIds = devices.map((d) => d.id);
    const { byDevice } = resolveDevices(db, { userId: ctx.userId, orgId: params.org, deviceIds });

    const visible = devices
      .filter((d) => byDevice[d.id]['device:view']?.effect === 'allow')
      .map((d) => ({
        id: d.id, name: d.name, kind: d.kind, online: !!d.online,
        permissions: byDevice[d.id],
      }));

    send(res, 200, { devices: visible });
  });

  router.get('/v1/orgs/:org/devices/:id', async (ctx, params, res) => {
    assertCan(db, ctx, 'device:view', params.id);
    const device = getDevice(db, params.org, params.id);
    if (!device) throw notFound('not found');
    const { permissions } = resolve(db, { userId: ctx.userId, orgId: params.org, deviceId: params.id });
    send(res, 200, { id: device.id, name: device.name, kind: device.kind, online: !!device.online, permissions });
  });

  router.post('/v1/orgs/:org/devices', async (ctx, params, res) => {
    assertCan(db, ctx, 'device:provision');
    const { name, kind } = ctx.body ?? {};
    if (!name || !kind) throw badRequest('name and kind are required');

    const id = newId('dev');
    db.prepare('INSERT INTO devices (id, org_id, name, kind, online) VALUES (?, ?, ?, ?, 0)')
      .run(id, params.org, name, kind);

    audit(db, {
      orgId: params.org, actorId: ctx.userId, action: 'device.provisioned',
      targetType: 'device', targetId: id, result: 'allow', requestId: ctx.requestId,
    });

    send(res, 201, { id, name, kind, online: false });
  });

  router.patch('/v1/orgs/:org/devices/:id', async (ctx, params, res) => {
    assertCan(db, ctx, 'device:update', params.id);
    const device = getDevice(db, params.org, params.id);
    if (!device) throw notFound('not found');

    const { name } = ctx.body ?? {};
    if (name) db.prepare('UPDATE devices SET name = ? WHERE id = ?').run(name, device.id);

    send(res, 200, { id: device.id, name: name ?? device.name });
  });

  router.delete('/v1/orgs/:org/devices/:id', async (ctx, params, res) => {
    assertCan(db, ctx, 'device:provision');
    const device = getDevice(db, params.org, params.id);
    if (!device) throw notFound('not found');

    db.prepare('UPDATE devices SET deleted_at = ? WHERE id = ?').run(nowIso(), device.id);
    endActiveSessions(db, { orgId: params.org, deviceId: device.id, reason: 'device_transferred' });

    audit(db, {
      orgId: params.org, actorId: ctx.userId, action: 'device.decommissioned',
      targetType: 'device', targetId: device.id, result: 'allow', requestId: ctx.requestId,
    });

    send(res, 200, { id: device.id, deleted: true });
  });

  // Transfer requires device:provision in BOTH orgs -- caller's current org (via
  // assertCan) and the destination org, checked manually since the destination
  // isn't the route's own org scope.
  router.post('/v1/orgs/:org/devices/:id/transfer', async (ctx, params, res) => {
    assertCan(db, ctx, 'device:provision');
    const device = getDevice(db, params.org, params.id);
    if (!device) throw notFound('not found');

    const { toOrgId } = ctx.body ?? {};
    if (!toOrgId) throw badRequest('toOrgId is required');

    const destMembership = db.prepare(
      `SELECT * FROM memberships WHERE org_id = ? AND user_id = ? AND status = 'active'`
    ).get(toOrgId, ctx.userId);
    if (!destMembership) throw notFound('not found'); // can't address an org you're not in

    const { permissions } = resolve(db, { userId: ctx.userId, orgId: toOrgId, deviceId: null });
    if (permissions['device:provision']?.effect !== 'allow') {
      throw forbidden('missing device:provision in destination org', 'missing_permission');
    }

    endActiveSessions(db, { orgId: params.org, deviceId: device.id, reason: 'device_transferred' });
    db.prepare('UPDATE devices SET org_id = ? WHERE id = ?').run(toOrgId, device.id);

    audit(db, {
      orgId: params.org, actorId: ctx.userId, action: 'device.transferred',
      targetType: 'device', targetId: device.id, result: 'allow', requestId: ctx.requestId,
    });

    send(res, 200, { id: device.id, orgId: toOrgId });
  });
}
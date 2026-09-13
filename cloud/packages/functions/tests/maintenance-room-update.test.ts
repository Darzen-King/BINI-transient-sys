import { describe, expect, it } from 'vitest';

import { planMaintenanceRoomUpdate } from '../src/maintenance/room-update-plan.js';

const input = { propertyId: 'property-main', operationId: '44444444-4444-4444-8444-444444444444', roomId: '205' };
const room = { propertyId: 'property-main', roomId: '205', status: '維修中', note: '面海', maintenanceNote: '冷氣故障', maintenanceDueDate: '2026-09-10', version: 7 };
const context = { actorUid: 'maint-1', now: '2026-09-13T13:30:00.000Z' };

describe('maintenance room update plan', () => {
  it('updates only the progress note and version on a room under maintenance', () => {
    const plan = planMaintenanceRoomUpdate(room, { ...input, action: 'update_note', maintenanceNote: '零件已到，明日安裝' }, context);
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.patch).toEqual({ maintenanceNote: '零件已到，明日安裝', version: 8, updatedAt: context.now, updatedByUid: 'maint-1' });
    expect(plan.result).toEqual({ status: 'noted', action: 'update_note', roomId: '205', nextStatus: '維修中', updatedAt: context.now });
    expect(plan.audit).toMatchObject({ action: 'maintenance.room.note', targetId: '205', details: { previousNote: '冷氣故障', nextNote: '零件已到，明日安裝' } });
  });

  it('resolves maintenance back to available and clears maintenance fields, like v3', () => {
    const plan = planMaintenanceRoomUpdate(room, { ...input, action: 'resolve', maintenanceNote: null }, context);
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.patch).toEqual({ status: '可入住', maintenanceNote: null, maintenanceDueDate: null, version: 8, updatedAt: context.now, updatedByUid: 'maint-1' });
    expect(plan.result).toMatchObject({ status: 'resolved', nextStatus: '可入住' });
    expect(plan.audit).toMatchObject({ action: 'maintenance.room.resolve', details: { previousStatus: '維修中', nextStatus: '可入住', previousNote: '冷氣故障', previousDueDate: '2026-09-10' } });
  });

  it('refuses a room that is no longer under maintenance, so a stale screen cannot flip an occupied room', () => {
    for (const status of ['可入住', '使用中', '即將退房', '待清潔', '月租套房']) {
      const plan = planMaintenanceRoomUpdate({ ...room, status }, { ...input, action: 'resolve', maintenanceNote: null }, context);
      expect(plan).toMatchObject({ ok: false, code: 'failed-precondition' });
    }
  });

  it('treats identity or version corruption as data loss', () => {
    expect(planMaintenanceRoomUpdate({ ...room, propertyId: 'other' }, { ...input, action: 'resolve', maintenanceNote: null }, context)).toMatchObject({ ok: false, code: 'data-loss' });
    expect(planMaintenanceRoomUpdate({ ...room, roomId: '206' }, { ...input, action: 'resolve', maintenanceNote: null }, context)).toMatchObject({ ok: false, code: 'data-loss' });
    expect(planMaintenanceRoomUpdate({ ...room, version: -1 }, { ...input, action: 'resolve', maintenanceNote: null }, context)).toMatchObject({ ok: false, code: 'data-loss' });
  });
});

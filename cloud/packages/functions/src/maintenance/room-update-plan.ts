import type { MaintenanceRoomUpdateInput, MaintenanceRoomUpdateResult } from '@bini/cloud-shared';

type RecordData = Record<string, unknown>;

export type MaintenanceRoomUpdatePlan =
  | {
      ok: true;
      patch: Record<string, unknown>;
      result: MaintenanceRoomUpdateResult;
      audit: { action: string; targetId: string; targetType: 'room'; details: Record<string, unknown> };
    }
  | { ok: false; code: 'failed-precondition' | 'data-loss'; message: string };

const nullableText = (value: unknown): string | null => (typeof value === 'string' ? value : null);

/**
 * Decides the room write for a maintenance progress note or resolve. Pure: the callable runs it inside
 * the transaction against the freshly read room, so a stale screen can never resolve a room that has
 * already left maintenance (for example one that was checked in after being fixed elsewhere).
 */
export function planMaintenanceRoomUpdate(
  room: RecordData,
  input: MaintenanceRoomUpdateInput,
  context: { actorUid: string; now: string },
): MaintenanceRoomUpdatePlan {
  if (room.propertyId !== input.propertyId || room.roomId !== input.roomId || typeof room.status !== 'string') {
    return { ok: false, code: 'data-loss', message: '房間資料不正確。' };
  }
  const version = room.version;
  if (typeof version !== 'number' || !Number.isSafeInteger(version) || version < 0) {
    return { ok: false, code: 'data-loss', message: `rooms/${input.roomId} 缺少有效 version。` };
  }
  if (room.status !== '維修中') {
    return { ok: false, code: 'failed-precondition', message: '此房間目前不是維修中，請重新整理後再操作。' };
  }

  const base = { version: version + 1, updatedAt: context.now, updatedByUid: context.actorUid };
  const previousNote = nullableText(room.maintenanceNote);

  if (input.action === 'update_note') {
    return {
      ok: true,
      patch: { maintenanceNote: input.maintenanceNote, ...base },
      result: { status: 'noted', action: 'update_note', roomId: input.roomId, nextStatus: '維修中', updatedAt: context.now },
      audit: {
        action: 'maintenance.room.note',
        targetId: input.roomId,
        targetType: 'room',
        details: { operationId: input.operationId, previousNote, nextNote: input.maintenanceNote },
      },
    };
  }

  return {
    ok: true,
    patch: { status: '可入住', maintenanceNote: null, maintenanceDueDate: null, ...base },
    result: { status: 'resolved', action: 'resolve', roomId: input.roomId, nextStatus: '可入住', updatedAt: context.now },
    audit: {
      action: 'maintenance.room.resolve',
      targetId: input.roomId,
      targetType: 'room',
      details: {
        operationId: input.operationId,
        previousStatus: '維修中',
        nextStatus: '可入住',
        previousNote,
        previousDueDate: nullableText(room.maintenanceDueDate),
      },
    },
  };
}

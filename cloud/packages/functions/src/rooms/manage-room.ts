import { roomManagementUpdateInputSchema, roomManagementUpdateResultSchema, type RoomManagementUpdateInput, type RoomManagementUpdateResult } from '@bini/cloud-shared';
import { createHash } from 'node:crypto';
import { getFirestore } from 'firebase-admin/firestore';
import { HttpsError, onCall } from 'firebase-functions/v2/https';

import { requirePropertyPage } from '../admin/staff-admin.js';

const options = { region: 'asia-east1', maxInstances: 10, timeoutSeconds: 60, memory: '512MiB' } as const;
type RecordData = Record<string, unknown>;
const fingerprint = (input: RoomManagementUpdateInput) => createHash('sha256').update(JSON.stringify({ operationType: 'room.management.update', ...input })).digest('hex');
const validVersion = (data: RecordData, label: string): number => { const value = data.version; if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw new HttpsError('data-loss', `${label} 缺少有效 version。`); return value; };
const validRoom = (data: RecordData, propertyId: string, roomId: string): void => { if (data.propertyId !== propertyId || data.roomId !== roomId || typeof data.status !== 'string') throw new HttpsError('data-loss', '房間資料不正確。'); };

/** Updates room notes and manual non-monthly status. Active stays remain owned by check-in / checkout. */
export const roomManagementUpdate = onCall(options, async (request): Promise<RoomManagementUpdateResult> => {
  const parsed = roomManagementUpdateInputSchema.safeParse(request.data); if (!parsed.success) throw new HttpsError('invalid-argument', '房間管理資料格式不正確。');
  const input = parsed.data; const actorUid = await requirePropertyPage(request.auth, input.propertyId, 'room_management'); const database = getFirestore(); const root = `properties/${input.propertyId}`;
  const operationRef = database.doc(`${root}/roomManagementOperations/${input.operationId}`); const roomRef = database.doc(`${root}/rooms/${input.roomId}`); const requestFingerprint = fingerprint(input);
  return database.runTransaction(async (transaction) => {
    const previousOperation = await transaction.get(operationRef);
    if (previousOperation.exists) {
      const data = previousOperation.data() ?? {};
      if (data.actorUid !== actorUid || data.requestFingerprint !== requestFingerprint) throw new HttpsError('already-exists', '此操作識別碼已由不同請求使用。');
      const replay = roomManagementUpdateResultSchema.safeParse(data.result);
      if (!replay.success || replay.data.status !== 'updated') throw new HttpsError('data-loss', '已完成操作缺少有效結果。');
      return { ...replay.data, status: 'replayed' };
    }
    const roomSnapshot = await transaction.get(roomRef);
    if (!roomSnapshot.exists) throw new HttpsError('not-found', '找不到房間。');
    const room = roomSnapshot.data() ?? {}; validRoom(room, input.propertyId, input.roomId);
    if (validVersion(room, `rooms/${input.roomId}`) !== input.expectedVersion) throw new HttpsError('aborted', '此房間資料剛被其他裝置修改，請重新載入後再修改。');
    const previousStatus = room.status;
    if (!['可入住', '使用中', '即將退房', '待清潔', '清潔中', '維修中', '月租套房'].includes(previousStatus)) throw new HttpsError('data-loss', '房間狀態不受支援。');
    if (previousStatus === '月租套房') throw new HttpsError('failed-precondition', '月租房請使用月租流程，不能直接變更房態。');
    if (['使用中', '即將退房'].includes(previousStatus) && input.status !== previousStatus) throw new HttpsError('failed-precondition', '在住房的房態必須由入住或退房流程變更。');
    if (['使用中', '即將退房'].includes(input.status) && input.status !== previousStatus) throw new HttpsError('failed-precondition', '使用中房態必須由辦理入住流程建立。');
    const now = new Date().toISOString();
    const result: RoomManagementUpdateResult = { status: 'updated', roomId: input.roomId, previousStatus: previousStatus as RoomManagementUpdateResult['previousStatus'], nextStatus: input.status, updatedAt: now };
    transaction.update(roomRef, { status: input.status, note: input.note, maintenanceNote: input.status === '維修中' ? input.maintenanceNote : null, maintenanceDueDate: input.status === '維修中' ? input.maintenanceDueDate : null, version: validVersion(room, `rooms/${input.roomId}`) + 1, updatedAt: now, updatedByUid: actorUid });
    transaction.create(operationRef, { operationId: input.operationId, actorUid, operationType: 'room.management.update', requestFingerprint, result, createdAt: now });
    transaction.create(database.doc(`${root}/auditLogs/room-management-update-${input.operationId}`), { actorUid, action: 'room.management.update', targetId: input.roomId, targetType: 'room', details: { operationId: input.operationId, previousStatus, nextStatus: input.status, noteChanged: input.note !== (typeof room.note === 'string' ? room.note : null) }, createdAt: now });
    return result;
  });
});

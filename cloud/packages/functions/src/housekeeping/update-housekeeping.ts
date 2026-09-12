import { housekeepingUpdateInputSchema, housekeepingUpdateResultSchema, type HousekeepingUpdateInput, type HousekeepingUpdateResult } from '@bini/cloud-shared';
import { createHash } from 'node:crypto';
import { getFirestore } from 'firebase-admin/firestore';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { requirePropertyPage } from '../admin/staff-admin.js';

const options = { region: 'asia-east1', maxInstances: 10, timeoutSeconds: 60, memory: '512MiB' } as const;
const fingerprint = (input: HousekeepingUpdateInput) => createHash('sha256').update(JSON.stringify({ operationType: 'housekeeping.update', ...input })).digest('hex');
/** Atomically advances only the cleaning workflow, never arbitrary room statuses. */
export const housekeepingUpdate = onCall(options, async (request): Promise<HousekeepingUpdateResult> => {
  const parsed = housekeepingUpdateInputSchema.safeParse(request.data); if (!parsed.success) throw new HttpsError('invalid-argument', '清潔狀態資料格式不正確。');
  const input = parsed.data; const actorUid = await requirePropertyPage(request.auth, input.propertyId, 'housekeeping'); const database = getFirestore(); const root = `properties/${input.propertyId}`; const operationRef = database.doc(`${root}/housekeepingOperations/${input.operationId}`); const roomRef = database.doc(`${root}/rooms/${input.roomId}`); const requestFingerprint = fingerprint(input);
  return database.runTransaction(async (transaction) => {
    const previous = await transaction.get(operationRef);
    if (previous.exists) { const data = previous.data() ?? {}; if (data.actorUid !== actorUid || data.requestFingerprint !== requestFingerprint) throw new HttpsError('already-exists', '此操作識別碼已由不同請求使用。'); const result = housekeepingUpdateResultSchema.safeParse(data.result); if (!result.success || result.data.status !== 'updated') throw new HttpsError('data-loss', '已完成操作缺少有效結果。'); return { ...result.data, status: 'replayed' }; }
    const snapshot = await transaction.get(roomRef); if (!snapshot.exists) throw new HttpsError('not-found', '找不到房間。'); const room = snapshot.data() ?? {}; if (room.propertyId !== input.propertyId || room.roomId !== input.roomId || typeof room.version !== 'number' || !Number.isSafeInteger(room.version)) throw new HttpsError('data-loss', '房間資料不正確。'); const previousStatus = room.status;
    if ((input.status === '清潔中' && previousStatus !== '待清潔') || (input.status === '可入住' && previousStatus !== '清潔中')) throw new HttpsError('failed-precondition', '房間目前無法進行此清潔狀態轉換。');
    const now = new Date().toISOString(); const result: HousekeepingUpdateResult = { status: 'updated', roomId: input.roomId, previousStatus, nextStatus: input.status, updatedAt: now };
    transaction.update(roomRef, { status: input.status, version: room.version + 1, updatedAt: now, updatedByUid: actorUid }); transaction.create(operationRef, { actorUid, operationType: 'housekeeping.update', requestFingerprint, result, createdAt: now }); transaction.create(database.doc(`${root}/auditLogs/housekeeping-update-${input.operationId}`), { actorUid, action: 'housekeeping.update', targetId: input.roomId, targetType: 'room', details: { operationId: input.operationId, previousStatus, nextStatus: input.status }, createdAt: now }); return result;
  });
});

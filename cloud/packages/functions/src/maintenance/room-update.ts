import {
  maintenanceRoomUpdateInputSchema,
  maintenanceRoomUpdateResultSchema,
  type MaintenanceRoomUpdateInput,
  type MaintenanceRoomUpdateResult,
} from '@bini/cloud-shared';
import { createHash } from 'node:crypto';
import { getFirestore } from 'firebase-admin/firestore';
import { HttpsError, onCall } from 'firebase-functions/v2/https';

import { requirePropertyPage } from '../admin/staff-admin.js';
import { planMaintenanceRoomUpdate } from './room-update-plan.js';

const options = { region: 'asia-east1', maxInstances: 10, timeoutSeconds: 60, memory: '512MiB' } as const;
const OPERATION_TYPE = 'maintenance.room.update';
const fingerprint = (input: MaintenanceRoomUpdateInput) =>
  createHash('sha256').update(JSON.stringify({ operationType: OPERATION_TYPE, ...input })).digest('hex');

/** v3 `/maintenance/update`: progress note or resolve for a room under maintenance. Requires MFA + `maintenance` page. */
export const maintenanceRoomUpdate = onCall(options, async (request): Promise<MaintenanceRoomUpdateResult> => {
  const parsed = maintenanceRoomUpdateInputSchema.safeParse(request.data);
  if (!parsed.success) throw new HttpsError('invalid-argument', parsed.error.issues[0]?.message ?? '維修房間資料格式不正確。');
  const input = parsed.data;
  const actorUid = await requirePropertyPage(request.auth, input.propertyId, 'maintenance');
  const database = getFirestore();
  const root = `properties/${input.propertyId}`;
  const operationRef = database.doc(`${root}/maintenanceOperations/${input.operationId}`);
  const roomRef = database.doc(`${root}/rooms/${input.roomId}`);
  const requestFingerprint = fingerprint(input);

  return database.runTransaction(async (transaction) => {
    const previous = await transaction.get(operationRef);
    if (previous.exists) {
      const data = previous.data() ?? {};
      if (data.actorUid !== actorUid || data.operationType !== OPERATION_TYPE || data.requestFingerprint !== requestFingerprint) {
        throw new HttpsError('already-exists', '此操作識別碼已由不同請求使用。');
      }
      const replay = maintenanceRoomUpdateResultSchema.safeParse(data.result);
      if (!replay.success || replay.data.status === 'replayed') throw new HttpsError('data-loss', '已完成操作缺少有效結果。');
      return { ...replay.data, status: 'replayed' };
    }

    const roomSnapshot = await transaction.get(roomRef);
    if (!roomSnapshot.exists) throw new HttpsError('not-found', '找不到房間。');
    const now = new Date().toISOString();
    const plan = planMaintenanceRoomUpdate(roomSnapshot.data() ?? {}, input, { actorUid, now });
    if (!plan.ok) throw new HttpsError(plan.code, plan.message);

    transaction.update(roomRef, plan.patch);
    transaction.create(operationRef, { operationId: input.operationId, actorUid, operationType: OPERATION_TYPE, requestFingerprint, result: plan.result, createdAt: now });
    transaction.create(database.doc(`${root}/auditLogs/maintenance-room-${input.action}-${input.operationId}`), { actorUid, ...plan.audit, createdAt: now });
    return plan.result;
  });
});

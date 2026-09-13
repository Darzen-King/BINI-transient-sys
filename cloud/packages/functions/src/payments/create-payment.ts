import { paymentCreateInputSchema, paymentCreateResultSchema, type PaymentCreateResult } from '@bini/cloud-shared';
import { getFirestore } from 'firebase-admin/firestore';
import { HttpsError, onCall } from 'firebase-functions/v2/https';

import { requirePropertyPage } from '../admin/staff-admin.js';
import { buildStayPaymentRecord, paymentCreateFingerprint } from './stay-payment-record.js';

const options = { region: 'asia-east1', maxInstances: 10, timeoutSeconds: 60, memory: '512MiB' } as const;
type RecordData = Record<string, unknown>;

const text = (data: RecordData, key: string, label: string): string => {
  const value = data[key];
  if (typeof value !== 'string' || !value.trim()) throw new HttpsError('data-loss', `${label} 缺少有效 ${key}。`);
  return value;
};
const version = (data: RecordData, label: string): number => {
  const value = data.version;
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw new HttpsError('data-loss', `${label} 缺少有效 version。`);
  return value;
};
function replay(data: RecordData, actorUid: string, requestFingerprint: string): PaymentCreateResult {
  if (data.actorUid !== actorUid || data.operationType !== 'payment.create' || data.requestFingerprint !== requestFingerprint) throw new HttpsError('already-exists', '此操作識別碼已由不同請求使用。');
  const parsed = paymentCreateResultSchema.safeParse(data.result);
  if (!parsed.success || parsed.data.status !== 'created') throw new HttpsError('data-loss', '已完成操作缺少有效結果。');
  return { ...parsed.data, status: 'replayed' };
}

/** Creates one payment or deposit for a currently active stay. Client writes never create payments directly. */
export const paymentCreate = onCall(options, async (request): Promise<PaymentCreateResult> => {
  const parsed = paymentCreateInputSchema.safeParse(request.data);
  if (!parsed.success) throw new HttpsError('invalid-argument', '付款資料格式不正確。');
  const input = parsed.data;
  const actorUid = await requirePropertyPage(request.auth, input.propertyId, 'payments');
  const database = getFirestore(); const root = `properties/${input.propertyId}`;
  const operationRef = database.doc(`${root}/paymentOperations/${input.operationId}`);
  const stayRef = database.doc(`${root}/stays/${input.stayId}`); const requestFingerprint = paymentCreateFingerprint(input);
  return database.runTransaction(async (transaction) => {
    const previous = await transaction.get(operationRef);
    if (previous.exists) return replay(previous.data() ?? {}, actorUid, requestFingerprint);
    const staySnapshot = await transaction.get(stayRef);
    if (!staySnapshot.exists) throw new HttpsError('not-found', '找不到在住房紀錄；無法建立付款。');
    const stay = staySnapshot.data() ?? {}; const stayLabel = `stays/${input.stayId}`;
    if (text(stay, 'propertyId', stayLabel) !== input.propertyId) throw new HttpsError('data-loss', '在住房館別不一致。');
    const roomId = text(stay, 'roomId', stayLabel); const roomRef = database.doc(`${root}/rooms/${roomId}`);
    const roomSnapshot = await transaction.get(roomRef);
    if (!roomSnapshot.exists) throw new HttpsError('not-found', '找不到對應房間。');
    const room = roomSnapshot.data() ?? {}; const roomLabel = `rooms/${roomId}`;
    if (text(room, 'roomId', roomLabel) !== roomId || !['使用中', '即將退房'].includes(text(room, 'status', roomLabel))) throw new HttpsError('failed-precondition', '房間目前不可收款。');
    const now = new Date().toISOString(); const paymentId = `PAY-${input.operationId.replaceAll('-', '').slice(-12).toUpperCase()}`;
    const result: PaymentCreateResult = { status: 'created', paymentId, stayId: input.stayId, roomId, amountNts: input.amountNts, createdAt: now };
    const record = buildStayPaymentRecord(input, { stay: { bookingId: typeof stay.bookingId === 'string' ? stay.bookingId : null, guestName: text(stay, 'guestName', stayLabel) }, roomId, actorUid, now, paymentId });
    transaction.create(database.doc(`${root}/payments/${paymentId}`), record.payment);
    transaction.update(stayRef, { version: version(stay, stayLabel) + 1, updatedAt: now, updatedByUid: actorUid });
    transaction.create(operationRef, { operationId: input.operationId, actorUid, requestFingerprint, operationType: 'payment.create', result, createdAt: now });
    transaction.create(database.doc(`${root}/auditLogs/payment-create-${input.operationId}`), { actorUid, action: record.auditAction, targetId: paymentId, targetType: 'payment', details: record.auditDetails, createdAt: now });
    return result;
  });
});

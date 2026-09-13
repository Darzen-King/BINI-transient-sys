import { paymentVoidInputSchema, paymentVoidResultSchema, type PaymentVoidInput, type PaymentVoidResult } from '@bini/cloud-shared';
import { createHash } from 'node:crypto';
import { getFirestore } from 'firebase-admin/firestore';
import { HttpsError, onCall } from 'firebase-functions/v2/https';

import { requirePropertyAdmin, requirePropertyPage } from '../admin/staff-admin.js';

const options = { region: 'asia-east1', maxInstances: 10, timeoutSeconds: 60, memory: '512MiB' } as const;
type Data = Record<string, unknown>;
const text = (data: Data, key: string, label: string): string => { const value = data[key]; if (typeof value !== 'string' || !value.trim()) throw new HttpsError('data-loss', `${label} 缺少有效 ${key}。`); return value; };
const version = (data: Data, label: string): number => { const value = data.version; if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw new HttpsError('data-loss', `${label} 缺少有效 version。`); return value; };
const taipeiDay = (iso: string): string => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso));
const fingerprint = (input: PaymentVoidInput): string => createHash('sha256').update(JSON.stringify({ operationType: 'payment.void', ...input })).digest('hex');

/**
 * Audit-safe replacement for v3's physical payment deletion. Void is refused
 * after a linked refund or a closed cashier session, so historical cash totals
 * cannot silently drift.
 */
export const paymentVoid = onCall(options, async (request): Promise<PaymentVoidResult> => {
  const parsed = paymentVoidInputSchema.safeParse(request.data);
  if (!parsed.success) throw new HttpsError('invalid-argument', '付款作廢資料格式不正確。');
  const input = parsed.data;
  const pageActorUid = await requirePropertyPage(request.auth, input.propertyId, 'payments');
  const actorUid = await requirePropertyAdmin(request.auth, input.propertyId);
  if (pageActorUid !== actorUid) throw new HttpsError('permission-denied', '付款作廢權限驗證失敗。');
  const database = getFirestore(); const root = `properties/${input.propertyId}`;
  const operationRef = database.doc(`${root}/paymentOperations/${input.operationId}`);
  const requestFingerprint = fingerprint(input);
  return database.runTransaction(async (transaction) => {
    const previous = await transaction.get(operationRef);
    if (previous.exists) {
      const data = previous.data() ?? {};
      if (data.actorUid !== actorUid || data.operationType !== 'payment.void' || data.requestFingerprint !== requestFingerprint) throw new HttpsError('already-exists', '此操作識別碼已由不同請求使用。');
      const replay = paymentVoidResultSchema.safeParse(data.result);
      if (!replay.success || replay.data.status !== 'voided') throw new HttpsError('data-loss', '付款作廢重送結果無效。');
      return { ...replay.data, status: 'replayed' };
    }
    const paymentRef = database.doc(`${root}/payments/${input.paymentId}`);
    const refundsQuery = database.collection(`${root}/payments`).where('refundOfPaymentId', '==', input.paymentId);
    const [paymentSnapshot, refundsSnapshot] = await Promise.all([transaction.get(paymentRef), transaction.get(refundsQuery)]);
    if (!paymentSnapshot.exists) throw new HttpsError('not-found', '找不到付款紀錄。');
    const payment = paymentSnapshot.data() ?? {}; const label = `payments/${input.paymentId}`;
    if (text(payment, 'propertyId', label) !== input.propertyId || payment.refund === true || payment.status !== 'paid') throw new HttpsError('failed-precondition', '只有未退款的已付款紀錄可以作廢。');
    if (!refundsSnapshot.empty) throw new HttpsError('failed-precondition', '此付款已有退款紀錄，請保留付款與退款歷史。');
    const sessionRef = database.doc(`${root}/cashierSessions/${taipeiDay(text(payment, 'createdAt', label))}`);
    const sessionSnapshot = await transaction.get(sessionRef);
    if (sessionSnapshot.exists && sessionSnapshot.data()?.status === 'closed') throw new HttpsError('failed-precondition', '付款所屬營業日已日結，不能作廢。請以獨立調整或退款處理。');
    const voidedAt = new Date().toISOString(); const result: PaymentVoidResult = { status: 'voided', paymentId: input.paymentId, voidedAt };
    transaction.update(paymentRef, { status: 'voided', voidReason: input.reason, voidedAt, voidedByUid: actorUid, voidOperationId: input.operationId, version: version(payment, label) + 1, updatedAt: voidedAt, updatedByUid: actorUid });
    transaction.create(operationRef, { operationId: input.operationId, actorUid, operationType: 'payment.void', requestFingerprint, result, createdAt: voidedAt });
    transaction.create(database.doc(`${root}/auditLogs/payment-void-${input.operationId}`), { actorUid, action: 'payment.void', targetId: input.paymentId, targetType: 'payment', details: { operationId: input.operationId, reason: input.reason, amountNts: payment.amountNts, roomId: payment.roomId ?? null }, createdAt: voidedAt });
    return result;
  });
});

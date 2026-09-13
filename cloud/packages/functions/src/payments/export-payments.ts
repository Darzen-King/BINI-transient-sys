import {
  buildPaymentListItems,
  paymentExportInputSchema,
  paymentExportResultSchema,
  renderPaymentCsv,
  type PaymentExportResult,
} from '@bini/cloud-shared';
import { createHash } from 'node:crypto';
import { getFirestore } from 'firebase-admin/firestore';
import { HttpsError, onCall } from 'firebase-functions/v2/https';

import { requirePropertyPage } from '../admin/staff-admin.js';

const options = { region: 'asia-east1', maxInstances: 10, timeoutSeconds: 60, memory: '512MiB' } as const;

function taipeiDate(iso: string): string {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(iso));
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

/** V3-compatible payment ledger CSV generated from the server's property-scoped source. */
export const paymentExportCsv = onCall(options, async (request): Promise<PaymentExportResult> => {
  const parsed = paymentExportInputSchema.safeParse(request.data);
  if (!parsed.success) throw new HttpsError('invalid-argument', '付款匯出資料格式不正確。');
  const input = parsed.data;
  const actorUid = await requirePropertyPage(request.auth, input.propertyId, 'payments');
  const db = getFirestore();
  const root = `properties/${input.propertyId}`;
  const snapshot = await db.collection(`${root}/payments`).get();
  let payments;
  try {
    payments = buildPaymentListItems(snapshot.docs.map((document) => ({ id: document.id, data: document.data() })))
      .filter((payment) => {
        const date = taipeiDate(payment.createdAt);
        return date >= input.dateFrom && date <= input.dateTo;
      });
  } catch {
    throw new HttpsError('data-loss', '付款來源資料格式不正確，請聯絡管理員。');
  }
  const result = paymentExportResultSchema.parse({
    filename: `bini_blooms_payments_${input.dateFrom}_${input.dateTo}.csv`,
    csv: renderPaymentCsv(payments),
  });
  const fingerprint = createHash('sha256').update(JSON.stringify({ operationType: 'payment.export', propertyId: input.propertyId, dateFrom: input.dateFrom, dateTo: input.dateTo })).digest('hex');
  await db.runTransaction(async (transaction) => {
    const operationRef = db.doc(`${root}/paymentOperations/${input.operationId}`);
    const previous = await transaction.get(operationRef);
    if (previous.exists) {
      const data = previous.data() ?? {};
      if (data.actorUid !== actorUid || data.requestFingerprint !== fingerprint) throw new HttpsError('already-exists', '此操作識別碼已由不同請求使用。');
      return;
    }
    const createdAt = new Date().toISOString();
    transaction.create(operationRef, { operationId: input.operationId, actorUid, operationType: 'payment.export', requestFingerprint: fingerprint, createdAt });
    transaction.create(db.doc(`${root}/auditLogs/payment-export-${input.operationId}`), {
      actorUid,
      action: 'payment.export',
      targetId: input.operationId,
      targetType: 'payment_ledger',
      details: { dateFrom: input.dateFrom, dateTo: input.dateTo, rowCount: payments.length },
      createdAt,
    });
  });
  return result;
});

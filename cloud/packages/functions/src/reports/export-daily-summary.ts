import {
  buildPaymentListItems,
  paymentDailySummaryExportInputSchema,
  paymentDailySummaryExportResultSchema,
  renderPaymentDailySummaryCsv,
  type CashierSessionStatus,
  type PaymentDailySummaryExportResult,
} from '@bini/cloud-shared';
import { createHash } from 'node:crypto';
import { getFirestore } from 'firebase-admin/firestore';
import { HttpsError, onCall } from 'firebase-functions/v2/https';

import { requireManagerOrAdmin } from './export-report.js';

const options = { region: 'asia-east1', maxInstances: 10, timeoutSeconds: 60, memory: '512MiB' } as const;

/** v3-compatible per-day payment summary CSV, computed server-side from the property ledger and cashier sessions. */
export const paymentDailySummaryExportCsv = onCall(options, async (request): Promise<PaymentDailySummaryExportResult> => {
  const parsed = paymentDailySummaryExportInputSchema.safeParse(request.data);
  if (!parsed.success) throw new HttpsError('invalid-argument', '日結匯出資料格式不正確。');
  const input = parsed.data;
  const actorUid = await requireManagerOrAdmin(request.auth, input.propertyId);
  const db = getFirestore();
  const root = `properties/${input.propertyId}`;
  const [paymentSnapshot, sessionSnapshot] = await Promise.all([
    db.collection(`${root}/payments`).get(),
    db.collection(`${root}/cashierSessions`).get(),
  ]);
  let csv: string;
  try {
    const sessions = new Map<string, CashierSessionStatus>();
    for (const document of sessionSnapshot.docs) {
      const status = document.data().status;
      if (status !== 'open' && status !== 'closed') throw new Error(`cashierSessions/${document.id} status is invalid`);
      sessions.set(document.id, status);
    }
    const payments = buildPaymentListItems(paymentSnapshot.docs.map((document) => ({ id: document.id, data: document.data() })));
    csv = renderPaymentDailySummaryCsv(payments, sessions, input.dateFrom, input.dateTo);
  } catch {
    throw new HttpsError('data-loss', '付款或日結來源資料格式不正確，請聯絡管理員。');
  }
  const result = paymentDailySummaryExportResultSchema.parse({ filename: `daily_summary_${input.dateFrom}_${input.dateTo}.csv`, csv });
  const fingerprint = createHash('sha256').update(JSON.stringify({ operationType: 'payment.daily-summary-export', propertyId: input.propertyId, dateFrom: input.dateFrom, dateTo: input.dateTo })).digest('hex');
  await db.runTransaction(async (transaction) => {
    const operationRef = db.doc(`${root}/reportOperations/${input.operationId}`);
    const previous = await transaction.get(operationRef);
    if (previous.exists) {
      const data = previous.data() ?? {};
      if (data.actorUid !== actorUid || data.requestFingerprint !== fingerprint) throw new HttpsError('already-exists', '此操作識別碼已由不同請求使用。');
      return;
    }
    const now = new Date().toISOString();
    transaction.create(operationRef, { operationId: input.operationId, actorUid, operationType: 'payment.daily-summary-export', requestFingerprint: fingerprint, createdAt: now });
    transaction.create(db.doc(`${root}/auditLogs/daily-summary-export-${input.operationId}`), { actorUid, action: 'payment.daily_summary_export', targetId: input.operationId, targetType: 'payment_ledger', details: { dateFrom: input.dateFrom, dateTo: input.dateTo }, createdAt: now });
  });
  return result;
});

import { buildReportProjection, renderReportCsv, reportExportInputSchema, reportExportResultSchema, type ReportExportResult } from '@bini/cloud-shared';
import { createHash } from 'node:crypto';
import { getFirestore } from 'firebase-admin/firestore';
import { HttpsError, onCall } from 'firebase-functions/v2/https';

import { requirePropertyPage } from '../admin/staff-admin.js';

const options = { region: 'asia-east1', maxInstances: 10, timeoutSeconds: 60, memory: '512MiB' } as const;

async function requireManagerOrAdmin(auth: Parameters<typeof requirePropertyPage>[0], propertyId: string): Promise<string> {
  const uid = await requirePropertyPage(auth, propertyId, 'reports');
  const profile = (await getFirestore().doc(`users/${uid}`).get()).data();
  const roles = profile?.roles;
  const role = roles && typeof roles === 'object' && !Array.isArray(roles) ? (roles as Record<string, unknown>)[propertyId] : null;
  if (role !== 'admin' && role !== 'manager') throw new HttpsError('permission-denied', '只有管理員或經理可匯出報表。');
  return uid;
}

/** Authoritative CSV export with the same pure calculation used by the live report projection. */
export const reportExportCsv = onCall(options, async (request): Promise<ReportExportResult> => {
  const parsed = reportExportInputSchema.safeParse(request.data);
  if (!parsed.success) throw new HttpsError('invalid-argument', '報表匯出資料格式不正確。');
  const input = parsed.data;
  const actorUid = await requireManagerOrAdmin(request.auth, input.propertyId);
  const db = getFirestore(); const root = `properties/${input.propertyId}`;
  const role = (await db.doc(`users/${actorUid}`).get()).data()?.roles;
  const includeCosts = role && typeof role === 'object' && !Array.isArray(role) && (role as Record<string, unknown>)[input.propertyId] === 'admin';
  const collections = ['rooms', 'bookings', 'stays', 'stayLogs', 'monthlyRentals'] as const;
  const snapshots = await Promise.all(collections.map((name) => db.collection(`${root}/${name}`).get()));
  const source = Object.fromEntries(collections.map((name, index) => [name, snapshots[index]!.docs.map((document) => ({ id: document.id, data: document.data() }))])) as { rooms: Array<{ id: string; data: unknown }>; bookings: Array<{ id: string; data: unknown }>; stays: Array<{ id: string; data: unknown }>; stayLogs: Array<{ id: string; data: unknown }>; monthlyRentals: Array<{ id: string; data: unknown }>; };
  const costEntries = includeCosts ? (await db.collection(`${root}/costEntries`).get()).docs.map((document) => ({ id: document.id, data: document.data() })) : undefined;
  let csv: string;
  try { csv = renderReportCsv(buildReportProjection({ ...source, ...(costEntries ? { costEntries } : {}) }, { dateFrom: input.dateFrom, dateTo: input.dateTo, includeCosts })); }
  catch { throw new HttpsError('data-loss', '報表來源資料格式不正確，請聯絡管理員。'); }
  const result = reportExportResultSchema.parse({ filename: `bini_blooms_report_${input.dateFrom}_${input.dateTo}.csv`, csv });
  const fingerprint = createHash('sha256').update(JSON.stringify({ operationType: 'report.export', propertyId: input.propertyId, dateFrom: input.dateFrom, dateTo: input.dateTo })).digest('hex');
  await db.runTransaction(async (transaction) => {
    const operationRef = db.doc(`${root}/reportOperations/${input.operationId}`);
    const previous = await transaction.get(operationRef);
    if (previous.exists) {
      const data = previous.data() ?? {};
      if (data.actorUid !== actorUid || data.requestFingerprint !== fingerprint) throw new HttpsError('already-exists', '此操作識別碼已由不同請求使用。');
      return;
    }
    const now = new Date().toISOString();
    transaction.create(operationRef, { operationId: input.operationId, actorUid, operationType: 'report.export', requestFingerprint: fingerprint, createdAt: now });
    transaction.create(db.doc(`${root}/auditLogs/report-export-${input.operationId}`), { actorUid, action: 'report.export', targetId: input.operationId, targetType: 'report', details: { dateFrom: input.dateFrom, dateTo: input.dateTo, includeCosts }, createdAt: now });
  });
  return result;
});

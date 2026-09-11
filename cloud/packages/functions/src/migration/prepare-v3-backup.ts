import {
  V3_BACKUP_MAX_ROW_CHARACTERS,
  V3_MIGRATION_TRANSFORM_VERSION,
  prepareV3Migration,
  v3BackupPrepareInputSchema,
  type V3BackupPrepareResult,
  type V3SourceTable,
  type V3StagingRow,
} from '@bini/cloud-shared';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { z } from 'zod';

import { requirePropertyAdmin, writeAudit } from '../admin/staff-admin.js';

const callableOptions = {
  region: 'asia-east1',
  maxInstances: 2,
  timeoutSeconds: 180,
  memory: '1GiB',
} as const;

const sourceTableSchema = z.enum([
  'properties',
  'rooms',
  'bookings',
  'active_stays',
  'stay_logs',
  'activity_logs',
  'payments',
  'cashier_sessions',
  'cost_entries',
  'maintenance_schedules',
  'monthly_rentals',
  'holiday_cache',
] satisfies [V3SourceTable, ...V3SourceTable[]]);

const stagingDocumentSchema = z.object({
  propertyId: z.string().trim().min(1).max(128).regex(/^[^/]+$/),
  sourceTable: sourceTableSchema,
  sourceId: z.string().min(1).max(128),
  targetCollection: z.string().min(1).max(128),
  targetDocumentId: z.string().min(1).max(256),
  legacyJson: z.string().min(2).max(V3_BACKUP_MAX_ROW_CHARACTERS),
  sourceChecksumSha256: z.string().regex(/^[a-f0-9]{64}$/),
});

function publicResult(
  batchId: string,
  report: V3BackupPrepareResult['report'],
): V3BackupPrepareResult {
  return {
    batchId,
    status: report.valid ? 'ready' : 'blocked',
    transformVersion: V3_MIGRATION_TRANSFORM_VERSION,
    report,
  };
}

export const adminPrepareV3Backup = onCall(callableOptions, async (request): Promise<V3BackupPrepareResult> => {
  const parsed = v3BackupPrepareInputSchema.safeParse(request.data);
  if (!parsed.success) throw new HttpsError('invalid-argument', '匯入批次輸入格式不正確。');
  const input = parsed.data;
  const actorUid = await requirePropertyAdmin(request.auth, input.propertyId);
  const database = getFirestore();
  const importRef = database.doc(`migrationImports/${input.batchId}`);
  const importSnapshot = await importRef.get();
  if (!importSnapshot.exists) throw new HttpsError('not-found', '找不到匯入暫存批次。');
  const importData = importSnapshot.data() ?? {};
  if (importData.propertyId !== input.propertyId) throw new HttpsError('permission-denied', '匯入批次不屬於目前館別。');
  if (!['complete', 'ready', 'blocked'].includes(String(importData.status ?? ''))) {
    throw new HttpsError('failed-precondition', '匯入暫存批次尚未完成。');
  }
  if (
    (importData.status === 'ready' || importData.status === 'blocked')
    && importData.transformVersion === V3_MIGRATION_TRANSFORM_VERSION
    && typeof importData.reconciliation === 'object'
    && importData.reconciliation !== null
  ) {
    return publicResult(input.batchId, importData.reconciliation as V3BackupPrepareResult['report']);
  }

  const checksumSha256 = String(importData.sourceChecksumSha256 ?? '');
  if (!/^[a-f0-9]{64}$/.test(checksumSha256)) throw new HttpsError('data-loss', '匯入批次缺少有效來源校驗碼。');
  const expectedRowCount = Number(importData.rowCount);
  if (!Number.isSafeInteger(expectedRowCount) || expectedRowCount < 0) {
    throw new HttpsError('data-loss', '匯入批次筆數無效。');
  }

  const rowSnapshot = await importRef.collection('rows').get();
  if (rowSnapshot.size !== expectedRowCount) {
    throw new HttpsError('data-loss', '暫存資料筆數與批次摘要不一致。');
  }
  const rows: V3StagingRow[] = rowSnapshot.docs.map((document) => {
    const row = stagingDocumentSchema.safeParse(document.data());
    if (!row.success) throw new HttpsError('data-loss', `暫存資料 ${document.id} 格式不正確。`);
    if (row.data.propertyId !== input.propertyId || row.data.sourceChecksumSha256 !== checksumSha256) {
      throw new HttpsError('data-loss', `暫存資料 ${document.id} 的館別或校驗碼不一致。`);
    }
    return {
      propertyId: row.data.propertyId,
      sourceTable: row.data.sourceTable,
      sourceId: row.data.sourceId,
      targetCollection: row.data.targetCollection,
      targetDocumentId: row.data.targetDocumentId,
      legacyJson: row.data.legacyJson,
    };
  });

  const importedAt = new Date().toISOString();
  const preparation = prepareV3Migration(rows, { importedAt, checksumSha256 });
  if (preparation.report.valid) {
    for (let offset = 0; offset < preparation.documents.length; offset += 350) {
      const batch = database.batch();
      for (const document of preparation.documents.slice(offset, offset + 350)) {
        const preparedId = `${document.sourceTable}--${document.targetDocumentId}`;
        batch.set(importRef.collection('preparedRows').doc(preparedId), {
          ...document,
          preparedAt: FieldValue.serverTimestamp(),
          transformVersion: V3_MIGRATION_TRANSFORM_VERSION,
        });
      }
      await batch.commit();
    }
  }

  const result = publicResult(input.batchId, preparation.report);
  await importRef.set({
    status: result.status,
    transformVersion: V3_MIGRATION_TRANSFORM_VERSION,
    reconciliation: preparation.report,
    preparedRowCount: preparation.report.preparedRowCount,
    preparedAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true });
  await writeAudit(input.propertyId, actorUid, 'migration.v3_backup_prepared', input.batchId, {
    status: result.status,
    sourceRowCount: preparation.report.sourceRowCount,
    preparedRowCount: preparation.report.preparedRowCount,
    errorCount: preparation.report.errors.length,
    transformVersion: V3_MIGRATION_TRANSFORM_VERSION,
  });
  return result;
});

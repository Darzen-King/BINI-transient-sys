import {
  buildV3StagingRows,
  inspectV3BackupText,
  V3_BACKUP_MAX_BYTES,
  v3BackupStageInputSchema,
} from '@bini/cloud-shared';
import { createHash } from 'node:crypto';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import { HttpsError, onCall } from 'firebase-functions/v2/https';

import { requirePropertyAdmin, writeAudit } from '../admin/staff-admin.js';

const callableOptions = {
  region: 'asia-east1',
  maxInstances: 2,
  timeoutSeconds: 120,
  memory: '512MiB',
} as const;

function hash(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

export const adminStageV3Backup = onCall(callableOptions, async (request) => {
  const parsed = v3BackupStageInputSchema.safeParse(request.data);
  if (!parsed.success) throw new HttpsError('invalid-argument', '備份檔輸入格式不正確。');
  const input = parsed.data;
  if (Buffer.byteLength(input.content, 'utf8') > V3_BACKUP_MAX_BYTES) {
    throw new HttpsError('invalid-argument', '備份檔超過 8 MB 上限。');
  }
  const actorUid = await requirePropertyAdmin(request.auth, input.propertyId);
  if (hash(input.content) !== input.checksumSha256) {
    throw new HttpsError('invalid-argument', '備份檔校驗碼不一致，請重新選擇檔案。');
  }

  let inspection;
  try {
    inspection = inspectV3BackupText(input.content);
  } catch (error) {
    throw new HttpsError('invalid-argument', error instanceof Error ? error.message : '備份檔無法解析。');
  }
  const rows = buildV3StagingRows(inspection, input.propertyId);
  const batchId = hash(`${input.propertyId}:${input.checksumSha256}`);
  const database = getFirestore();
  const importRef = database.doc(`migrationImports/${batchId}`);
  const existing = await importRef.get();
  if (existing.data()?.status === 'complete') {
    return { batchId, status: 'complete' as const, rowCount: Number(existing.data()?.rowCount ?? rows.length), duplicate: true };
  }
  if (existing.data()?.status === 'importing') {
    throw new HttpsError('aborted', '相同備份檔已有匯入程序進行中。');
  }

  await importRef.set({
    propertyId: input.propertyId,
    sourceFileName: input.fileName,
    sourceChecksumSha256: input.checksumSha256,
    sourceExportedAt: inspection.exportedAt,
    sourceSchemaVersion: inspection.schemaVersion,
    status: 'importing',
    rowCount: rows.length,
    tableCounts: Object.fromEntries(inspection.tables.map((table) => [table.sourceTable, table.count])),
    createdBy: actorUid,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true });

  try {
    for (let offset = 0; offset < rows.length; offset += 400) {
      const writeBatch = database.batch();
      for (const row of rows.slice(offset, offset + 400)) {
        const rowId = `${row.sourceTable}--${row.targetDocumentId}`;
        writeBatch.set(importRef.collection('rows').doc(rowId), {
          ...row,
          sourceChecksumSha256: input.checksumSha256,
          stagedAt: FieldValue.serverTimestamp(),
        });
      }
      await writeBatch.commit();
    }
    await importRef.update({ status: 'complete', updatedAt: FieldValue.serverTimestamp() });
    await writeAudit(input.propertyId, actorUid, 'migration.v3_backup_staged', batchId, {
      sourceFileName: input.fileName,
      sourceChecksumSha256: input.checksumSha256,
      rowCount: rows.length,
    });
    return { batchId, status: 'complete' as const, rowCount: rows.length, duplicate: false };
  } catch {
    await importRef.set({ status: 'failed', updatedAt: FieldValue.serverTimestamp() }, { merge: true }).catch(() => undefined);
    throw new HttpsError('internal', '建立匯入暫存批次失敗，權威資料未變更。');
  }
});

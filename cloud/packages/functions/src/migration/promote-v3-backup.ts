import {
  V3_MIGRATION_TRANSFORM_VERSION,
  V3_REPLACE_COLLECTIONS,
  buildV3PromotionPlan,
  planV3Replacement,
  canAttachV3PropertyToCloudBootstrap,
  matchesV3PromotionDocument,
  v3BackupPromoteInputSchema,
  type V3BackupPromotionResult,
  type V3PromotionMode,
  type V3PromotionPlan,
} from '@bini/cloud-shared';
import { createHash, randomUUID } from 'node:crypto';
import { FieldValue, Timestamp, getFirestore, type DocumentReference } from 'firebase-admin/firestore';
import { HttpsError, onCall } from 'firebase-functions/v2/https';

import { requirePropertyAdmin, writeAudit } from '../admin/staff-admin.js';

const callableOptions = {
  region: 'asia-east1',
  maxInstances: 1,
  timeoutSeconds: 540,
  memory: '1GiB',
} as const;

const PROMOTION_WRITE_CHUNK_SIZE = 350;
const PROMOTION_LEASE_MS = 10 * 60 * 1_000;

type PromotionClaim = 'claimed' | 'already_promoted';

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function timestampMillis(value: unknown): number | null {
  if (value instanceof Timestamp) return value.toMillis();
  const record = asRecord(value);
  if (!record || typeof record.toMillis !== 'function') return null;
  try {
    const millis = record.toMillis();
    return typeof millis === 'number' && Number.isFinite(millis) ? millis : null;
  } catch {
    return null;
  }
}

function callableError(error: unknown): HttpsError {
  if (error instanceof HttpsError) return error;
  if (error && typeof error === 'object' && 'kind' in error) {
    const kind = (error as { kind?: unknown }).kind;
    if (kind === 'failed-precondition') return new HttpsError('failed-precondition', error instanceof Error ? error.message : '匯入批次尚未準備完成。');
    if (kind === 'data-loss') return new HttpsError('data-loss', error instanceof Error ? error.message : '準備資料的完整性驗證失敗。');
  }
  return new HttpsError('internal', error instanceof Error ? error.message : '正式匯入失敗。');
}

function chunks<T>(items: readonly T[], size: number): T[][] {
  const result: T[][] = [];
  for (let offset = 0; offset < items.length; offset += size) result.push([...items.slice(offset, offset + size)]);
  return result;
}

function markerFor(plan: V3PromotionPlan) {
  return {
    batchId: plan.batchId,
    sourceChecksumSha256: plan.checksumSha256,
    transformVersion: V3_MIGRATION_TRANSFORM_VERSION,
  } as const;
}

function assertBatchStillMatchesPlan(data: Record<string, unknown>, plan: V3PromotionPlan): void {
  const reconciliation = asRecord(data.reconciliation);
  if (
    data.propertyId !== plan.propertyId
    || data.sourceChecksumSha256 !== plan.checksumSha256
    || data.transformVersion !== V3_MIGRATION_TRANSFORM_VERSION
    || data.rowCount !== plan.documents.length
    || data.preparedRowCount !== plan.documents.length
    || reconciliation?.valid !== true
    || reconciliation.preparedRowCount !== plan.documents.length
    || reconciliation.sourceRowCount !== plan.documents.length
  ) throw new HttpsError('data-loss', 'promotion 前後的匯入批次完整性不一致。');
}

async function assertTargetsAreSafe(plan: V3PromotionPlan, requirePresent: boolean): Promise<void> {
  const database = getFirestore();
  const marker = markerFor(plan);
  const targets = plan.documents.map((document) => ({ document, ref: database.doc(document.targetPath) }));
  for (const targetChunk of chunks(targets, PROMOTION_WRITE_CHUNK_SIZE)) {
    const snapshots = await database.getAll(...targetChunk.map((target) => target.ref));
    for (const [index, snapshot] of snapshots.entries()) {
      const target = targetChunk[index];
      if (!target) throw new HttpsError('internal', 'promotion target alignment failed');
      const { document } = target;
      if (!snapshot.exists) {
        if (requirePresent) throw new HttpsError('data-loss', `已完成的匯入缺少權威資料：${document.targetPath}`);
        continue;
      }
      if (!requirePresent && canAttachV3PropertyToCloudBootstrap(snapshot.data(), document)) continue;
      if (!matchesV3PromotionDocument(snapshot.data(), document, marker)) {
        throw new HttpsError('already-exists', `拒絕覆寫既有營運資料：${document.targetPath}`);
      }
    }
  }
}

async function claimPromotion(
  importRef: DocumentReference,
  actorUid: string,
  attemptId: string,
  plan: V3PromotionPlan,
): Promise<PromotionClaim> {
  const database = getFirestore();
  return database.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(importRef);
    if (!snapshot.exists) throw new HttpsError('not-found', '找不到匯入暫存批次。');
    const data = snapshot.data() ?? {};
    assertBatchStillMatchesPlan(data, plan);
    if (data.status === 'promoted') return 'already_promoted';
    if (data.status !== 'ready') throw new HttpsError('failed-precondition', '匯入批次尚未通過對帳或正在被其他程序處理。');
    const promotion = asRecord(data.promotion);
    const activeLease = promotion?.status === 'promoting' ? timestampMillis(promotion.leaseExpiresAt) : null;
    if (activeLease !== null && activeLease > Date.now()) {
      throw new HttpsError('aborted', '此匯入批次正在 promotion，請稍後再試。');
    }
    transaction.set(importRef, {
      promotion: {
        status: 'promoting',
        attemptId,
        actorUid,
        documentCount: plan.documents.length,
        startedAt: FieldValue.serverTimestamp(),
        leaseExpiresAt: Timestamp.fromMillis(Date.now() + PROMOTION_LEASE_MS),
      },
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    return 'claimed';
  });
}

async function writePromotionChunks(plan: V3PromotionPlan): Promise<void> {
  const database = getFirestore();
  const marker = markerFor(plan);
  for (const documentChunk of chunks(plan.documents, PROMOTION_WRITE_CHUNK_SIZE)) {
    await database.runTransaction(async (transaction) => {
      const refs = documentChunk.map((document) => database.doc(document.targetPath));
      const snapshots = await Promise.all(refs.map((ref) => transaction.get(ref)));
      for (const [index, snapshot] of snapshots.entries()) {
        const document = documentChunk[index];
        const ref = refs[index];
        if (!document || !ref) throw new HttpsError('internal', 'promotion target alignment failed');
        if (snapshot.exists) {
          if (matchesV3PromotionDocument(snapshot.data(), document, marker)) continue;
          if (canAttachV3PropertyToCloudBootstrap(snapshot.data(), document)) {
            transaction.update(ref, {
              legacyV3Import: document.data,
              migrationImport: {
                ...marker,
                promotedAt: FieldValue.serverTimestamp(),
              },
            });
            continue;
          }
          throw new HttpsError('already-exists', `拒絕覆寫既有營運資料：${document.targetPath}`);
        }
        transaction.create(ref, {
          ...document.data,
          migrationImport: {
            ...marker,
            promotedAt: FieldValue.serverTimestamp(),
          },
        });
      }
    });
  }
}

interface ReplacementSummary { overwrittenCount: number; removedCount: number; snapshotCount: number }

/**
 * Replace mode, step 1: every existing document the backup rewrites or removes is copied to
 * migrationImports/{batchId}/replacedDocuments before anything changes, so a DEV operator can recover it
 * (in addition to Firestore point-in-time recovery). Step 2 deletes documents absent from the backup.
 * Cloud-written audit history is kept.
 */
export async function snapshotAndClearForReplace(importRef: DocumentReference, plan: V3PromotionPlan, attemptId: string): Promise<ReplacementSummary> {
  const database = getFirestore();
  const root = `properties/${plan.propertyId}`;
  const existing: { path: string; data: Record<string, unknown> }[] = [];
  for (const collection of V3_REPLACE_COLLECTIONS) {
    const snapshot = await database.collection(`${root}/${collection}`).get();
    for (const document of snapshot.docs) existing.push({ path: document.ref.path, data: document.data() });
  }
  const propertySnapshot = await database.doc(root).get();
  if (propertySnapshot.exists) existing.push({ path: root, data: propertySnapshot.data() ?? {} });

  const decision = planV3Replacement(existing, new Set(plan.documents.map((document) => document.targetPath)));
  const affected = new Set([...decision.overwrite, ...decision.remove]);
  const toSnapshot = existing.filter((document) => affected.has(document.path));
  const capturedAt = FieldValue.serverTimestamp();
  for (const snapshotChunk of chunks(toSnapshot, 400)) {
    const batch = database.batch();
    for (const document of snapshotChunk) {
      const id = createHash('sha256').update(document.path).digest('hex');
      batch.set(importRef.collection('replacedDocuments').doc(id), { path: document.path, data: document.data, attemptId, capturedAt });
    }
    await batch.commit();
  }
  for (const removeChunk of chunks(decision.remove, 400)) {
    const batch = database.batch();
    for (const path of removeChunk) batch.delete(database.doc(path));
    await batch.commit();
  }
  return { overwrittenCount: decision.overwrite.length, removedCount: decision.remove.length, snapshotCount: toSnapshot.length };
}

/** Replace mode, step 3: write every backup document as-is; the property root keeps its cloud settings. */
export async function writeReplaceChunks(plan: V3PromotionPlan): Promise<void> {
  const database = getFirestore();
  const marker = markerFor(plan);
  for (const documentChunk of chunks(plan.documents, PROMOTION_WRITE_CHUNK_SIZE)) {
    const batch = database.batch();
    for (const document of documentChunk) {
      const ref = database.doc(document.targetPath);
      if (document.sourceTable === 'properties') {
        // mergeFields replaces these two fields whole (a plain merge would keep stale keys of the previous legacy row).
        batch.set(ref, { legacyV3Import: document.data, migrationImport: { ...marker, promotedAt: FieldValue.serverTimestamp() } }, { mergeFields: ['legacyV3Import', 'migrationImport'] });
      } else {
        batch.set(ref, { ...document.data, migrationImport: { ...marker, promotedAt: FieldValue.serverTimestamp() } });
      }
    }
    await batch.commit();
  }
}

async function finishPromotion(
  importRef: DocumentReference,
  actorUid: string,
  attemptId: string,
  plan: V3PromotionPlan,
  mode: V3PromotionMode = 'create',
  replacement: ReplacementSummary | null = null,
): Promise<void> {
  const database = getFirestore();
  const auditRef = database.doc(`properties/${plan.propertyId}/auditLogs/migration-${plan.batchId}-${attemptId}`);
  await database.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(importRef);
    if (!snapshot.exists) throw new HttpsError('not-found', '找不到匯入暫存批次。');
    const data = snapshot.data() ?? {};
    assertBatchStillMatchesPlan(data, plan);
    const promotion = asRecord(data.promotion);
    if (data.status === 'promoted') return;
    if (data.status !== 'ready' || promotion?.status !== 'promoting' || promotion.attemptId !== attemptId) {
      throw new HttpsError('aborted', 'promotion lease 已被其他程序接管。');
    }
    transaction.set(importRef, {
      status: 'promoted',
      promotedAt: FieldValue.serverTimestamp(),
      promotedBy: actorUid,
      updatedAt: FieldValue.serverTimestamp(),
      promotion: {
        status: 'complete',
        attemptId,
        actorUid,
        documentCount: plan.documents.length,
        sourceChecksumSha256: plan.checksumSha256,
        transformVersion: V3_MIGRATION_TRANSFORM_VERSION,
        mode,
        ...(replacement ?? {}),
        completedAt: FieldValue.serverTimestamp(),
      },
    }, { merge: true });
    transaction.create(auditRef, {
      actorUid,
      action: mode === 'replace' ? 'migration.v3_backup_replaced' : 'migration.v3_backup_promoted',
      targetUid: plan.batchId,
      details: {
        documentCount: plan.documents.length,
        sourceChecksumSha256: plan.checksumSha256,
        transformVersion: V3_MIGRATION_TRANSFORM_VERSION,
        mode,
        ...(replacement ?? {}),
      },
      createdAt: FieldValue.serverTimestamp(),
    });
  });
}

async function markPromotionFailed(
  importRef: DocumentReference,
  actorUid: string,
  attemptId: string,
  error: HttpsError,
): Promise<void> {
  const database = getFirestore();
  await database.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(importRef);
    if (!snapshot.exists || snapshot.data()?.status === 'promoted') return;
    const promotion = asRecord(snapshot.data()?.promotion);
    if (promotion?.attemptId !== attemptId) return;
    transaction.set(importRef, {
      promotion: {
        status: 'failed',
        attemptId,
        actorUid,
        lastErrorCode: error.code,
        lastErrorMessage: error.message,
        failedAt: FieldValue.serverTimestamp(),
      },
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
  });
}

export const adminPromotePreparedV3Backup = onCall(callableOptions, async (request): Promise<V3BackupPromotionResult> => {
  const parsed = v3BackupPromoteInputSchema.safeParse(request.data);
  if (!parsed.success) throw new HttpsError('invalid-argument', '正式匯入確認資料不正確。');
  const input = parsed.data;
  const actorUid = await requirePropertyAdmin(request.auth, input.propertyId);
  const database = getFirestore();
  const importRef = database.doc(`migrationImports/${input.batchId}`);
  const importSnapshot = await importRef.get();
  if (!importSnapshot.exists) throw new HttpsError('not-found', '找不到匯入暫存批次。');
  const preparedSnapshot = await importRef.collection('preparedRows').get();

  let plan: V3PromotionPlan;
  try {
    plan = buildV3PromotionPlan({
      request: input,
      batch: importSnapshot.data(),
      preparedRows: preparedSnapshot.docs.map((document) => document.data()),
    });
  } catch (error) {
    throw callableError(error);
  }

  const attemptId = randomUUID();
  try {
    const claim = await claimPromotion(importRef, actorUid, attemptId, plan);
    if (claim === 'already_promoted') {
      await assertTargetsAreSafe(plan, true);
      await writeAudit(plan.propertyId, actorUid, 'migration.v3_backup_promotion_replayed', input.batchId, {
        documentCount: plan.documents.length,
        sourceChecksumSha256: plan.checksumSha256,
        transformVersion: V3_MIGRATION_TRANSFORM_VERSION,
      });
      return {
        batchId: input.batchId,
        status: 'already_promoted',
        transformVersion: V3_MIGRATION_TRANSFORM_VERSION,
        documentCount: plan.documents.length,
      };
    }

    const mode: V3PromotionMode = input.mode ?? 'create';
    let replacement: ReplacementSummary | null = null;
    if (mode === 'replace') {
      replacement = await snapshotAndClearForReplace(importRef, plan, attemptId);
      await writeReplaceChunks(plan);
    } else {
      await assertTargetsAreSafe(plan, false);
      await writePromotionChunks(plan);
    }
    // Both modes end with every backup document present exactly as prepared.
    await assertTargetsAreSafe(plan, true);
    await finishPromotion(importRef, actorUid, attemptId, plan, mode, replacement);
    return {
      batchId: input.batchId,
      status: 'promoted',
      transformVersion: V3_MIGRATION_TRANSFORM_VERSION,
      documentCount: plan.documents.length,
      mode,
      ...(replacement ?? {}),
    };
  } catch (error) {
    const safeError = callableError(error);
    await markPromotionFailed(importRef, actorUid, attemptId, safeError).catch(() => undefined);
    await writeAudit(plan.propertyId, actorUid, 'migration.v3_backup_promotion_failed', input.batchId, {
      errorCode: safeError.code,
      documentCount: plan.documents.length,
      sourceChecksumSha256: plan.checksumSha256,
      transformVersion: V3_MIGRATION_TRANSFORM_VERSION,
    }).catch(() => undefined);
    throw safeError;
  }
});

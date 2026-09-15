// Runs against the Firestore emulator (npm run test:rules): the replace promotion must snapshot, clear and rewrite exactly.
import { getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { matchesV3PromotionDocument, V3_MIGRATION_TRANSFORM_VERSION, type V3PromotionPlan } from '@bini/cloud-shared';

import { snapshotAndClearForReplace, writeReplaceChunks } from '../src/migration/promote-v3-backup.js';

const PROPERTY = 'property-replace';
const ROOT = `properties/${PROPERTY}`;
const BATCH = 'b'.repeat(64);
const CHECKSUM = 'c'.repeat(64);

function prepared(sourceTable: V3PromotionPlan['documents'][number]['sourceTable'], collection: string, id: string, data: Record<string, unknown>) {
  return { propertyId: PROPERTY, sourceTable, sourceId: id, targetCollection: collection, targetDocumentId: id, targetPath: collection === 'properties' ? ROOT : `${ROOT}/${collection}/${id}`, data } as V3PromotionPlan['documents'][number];
}

beforeAll(() => { if (getApps().length === 0) initializeApp({ projectId: 'demo-bini-v4' }); });
afterAll(async () => { await getFirestore().recursiveDelete(getFirestore().doc(ROOT)); await getFirestore().recursiveDelete(getFirestore().doc(`migrationImports/${BATCH}`)); });

describe('replace promotion (emulator)', () => {
  it('snapshots affected documents, removes data missing from the backup, keeps cloud audit history, and rewrites the rest exactly', async () => {
    const db = getFirestore();
    const oldMarker = { batchId: 'a'.repeat(64), sourceChecksumSha256: 'd'.repeat(64), transformVersion: V3_MIGRATION_TRANSFORM_VERSION };
    await db.doc(ROOT).set({ propertyId: PROPERTY, name: '本館', active: true, currency: 'TWD', timezone: 'Asia/Taipei', legacyV3Import: { id: PROPERTY, stale: 'old field' }, migrationImport: oldMarker });
    await db.doc(`${ROOT}/rooms/201`).set({ roomId: '201', status: '使用中', migrationImport: oldMarker });
    await db.doc(`${ROOT}/bookings/RSV-OLD`).set({ bookingId: 'RSV-OLD', status: '已預約', migrationImport: oldMarker });
    await db.doc(`${ROOT}/bookings/RSV-CLOUD-TEST`).set({ bookingId: 'RSV-CLOUD-TEST', status: '已預約' });
    await db.doc(`${ROOT}/stays/STY-CLOUD`).set({ stayId: 'STY-CLOUD', roomId: '201' });
    await db.doc(`${ROOT}/auditLogs/v3-activity_logs-1`).set({ action: 'old import', migrationImport: oldMarker });
    await db.doc(`${ROOT}/auditLogs/cloud-op`).set({ action: 'stay.checkout' });

    const plan: V3PromotionPlan = { propertyId: PROPERTY, batchId: BATCH, checksumSha256: CHECKSUM, documents: [
      prepared('properties', 'properties', PROPERTY, { id: PROPERTY, name: 'BINI' }),
      prepared('rooms', 'rooms', '201', { roomId: '201', status: '可入住' }),
      prepared('bookings', 'bookings', 'RSV-NEW', { bookingId: 'RSV-NEW', status: '已預約' }),
      prepared('activity_logs', 'auditLogs', 'v3-activity_logs-1', { action: 'new import' }),
    ] };
    const importRef = db.doc(`migrationImports/${BATCH}`);
    const summary = await snapshotAndClearForReplace(importRef, plan, 'attempt-1');
    await writeReplaceChunks(plan);

    // property root, room 201 and the imported audit log are overwritten; the old booking, cloud test booking and stay are removed.
    expect(summary).toEqual({ overwrittenCount: 3, removedCount: 3, snapshotCount: 6 });
    const marker = { batchId: BATCH, sourceChecksumSha256: CHECKSUM, transformVersion: V3_MIGRATION_TRANSFORM_VERSION };
    for (const document of plan.documents) {
      const snapshot = await db.doc(document.targetPath).get();
      expect(matchesV3PromotionDocument(snapshot.data(), document, marker), document.targetPath).toBe(true);
    }
    const property = (await db.doc(ROOT).get()).data();
    expect(property).toMatchObject({ name: '本館', currency: 'TWD', legacyV3Import: { id: PROPERTY, name: 'BINI' } });
    expect(property?.legacyV3Import).not.toHaveProperty('stale');
    for (const gone of ['bookings/RSV-OLD', 'bookings/RSV-CLOUD-TEST', 'stays/STY-CLOUD']) expect((await db.doc(`${ROOT}/${gone}`).get()).exists, gone).toBe(false);
    expect((await db.doc(`${ROOT}/auditLogs/cloud-op`).get()).data()).toEqual({ action: 'stay.checkout' });

    const snapshots = (await importRef.collection('replacedDocuments').get()).docs.map((document) => document.data());
    expect(snapshots.map((row) => row.path).sort()).toEqual([ROOT, `${ROOT}/auditLogs/v3-activity_logs-1`, `${ROOT}/bookings/RSV-CLOUD-TEST`, `${ROOT}/bookings/RSV-OLD`, `${ROOT}/rooms/201`, `${ROOT}/stays/STY-CLOUD`].sort());
    expect(snapshots.find((row) => row.path === `${ROOT}/rooms/201`)?.data).toMatchObject({ status: '使用中' });
  });
});

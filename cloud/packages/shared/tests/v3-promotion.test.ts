import { describe, expect, it } from 'vitest';

import {
  V3_AUTHORITATIVE_ENTITY_MAPPINGS,
  V3_MIGRATION_SCHEMA_VERSION,
  V3_MIGRATION_TRANSFORM_VERSION,
  V3PromotionPlanError,
  V3_REPLACE_COLLECTIONS,
  buildV3PromotionPlan,
  canAttachV3PropertyToCloudBootstrap,
  matchesV3PromotionDocument,
  planV3Replacement,
  v3BackupPromoteInputSchema,
  v3PromotionConfirmationForBatch,
  v3DocumentId,
  type V3PreparedDocument,
  type V3SourceTable,
} from '@bini/cloud-shared';

const batchId = 'c'.repeat(64);
const checksumSha256 = 'd'.repeat(64);
const propertyId = 'property-main';

function sourceIdFor(table: V3SourceTable): string {
  if (table === 'properties') return 'P001';
  if (table === 'rooms') return '201';
  if (table === 'bookings') return 'RSV-1';
  if (table === 'holiday_cache') return '2026-10-10';
  return '1';
}

function preparedDocument(sourceTable: V3SourceTable): V3PreparedDocument & { transformVersion: number } {
  const mapping = V3_AUTHORITATIVE_ENTITY_MAPPINGS.find((candidate) => candidate.sourceTable === sourceTable);
  if (!mapping) throw new Error('mapping missing');
  const sourceId = sourceIdFor(sourceTable);
  const targetDocumentId = sourceTable === 'properties' ? propertyId : v3DocumentId(mapping, sourceId);
  return {
    propertyId,
    sourceTable,
    sourceId,
    targetCollection: mapping.targetCollection,
    targetDocumentId,
    targetPath: sourceTable === 'properties'
      ? `properties/${propertyId}`
      : `properties/${propertyId}/${mapping.targetCollection}/${targetDocumentId}`,
    data: {
      schemaVersion: V3_MIGRATION_SCHEMA_VERSION,
      version: 0,
      propertyId,
      migration: {
        schemaVersion: V3_MIGRATION_SCHEMA_VERSION,
        sourceVersion: '3.9.14',
        sourceTable,
        sourceId,
        sourceChecksumSha256: checksumSha256,
        importedAt: '2026-09-12T00:00:00.000Z',
      },
    },
    transformVersion: V3_MIGRATION_TRANSFORM_VERSION,
  };
}

function fixture() {
  const documents = V3_AUTHORITATIVE_ENTITY_MAPPINGS.map((mapping) => preparedDocument(mapping.sourceTable));
  return {
    request: {
      propertyId,
      batchId,
      confirmation: v3PromotionConfirmationForBatch(batchId),
    },
    batch: {
      propertyId,
      status: 'ready',
      sourceChecksumSha256: checksumSha256,
      rowCount: documents.length,
      preparedRowCount: documents.length,
      transformVersion: V3_MIGRATION_TRANSFORM_VERSION,
      reconciliation: {
        valid: true,
        sourceRowCount: documents.length,
        preparedRowCount: documents.length,
        tables: V3_AUTHORITATIVE_ENTITY_MAPPINGS.map((mapping) => ({
          sourceTable: mapping.sourceTable,
          targetCollection: mapping.targetCollection,
          sourceCount: 1,
          preparedCount: 1,
        })),
        amountTotalsNts: {},
        errors: [],
        warnings: [],
      },
    },
    preparedRows: documents,
  };
}

describe('v3 prepared backup promotion contract', () => {
  it('accepts only a complete ready batch and rebuilds every property-scoped target', () => {
    const candidate = fixture();
    const plan = buildV3PromotionPlan(candidate);

    expect(plan.documents).toHaveLength(V3_AUTHORITATIVE_ENTITY_MAPPINGS.length);
    expect(plan.documents[0]?.targetPath).toBe(`properties/${propertyId}`);
    expect(plan.documents.every((document) => document.targetPath.startsWith(`properties/${propertyId}`))).toBe(true);
  });

  it('rejects a non-ready batch or a prepared-count mismatch before a Function can write', () => {
    const notReady = fixture();
    notReady.batch.status = 'complete';
    expect(() => buildV3PromotionPlan(notReady)).toThrow(V3PromotionPlanError);

    const alteredCount = fixture();
    alteredCount.batch.preparedRowCount -= 1;
    expect(() => buildV3PromotionPlan(alteredCount)).toThrow(V3PromotionPlanError);
  });

  it('uses a separate REPLACE phrase for replace mode, so a first-import phrase can never replace data', () => {
    const candidate = fixture();
    expect(v3PromotionConfirmationForBatch(batchId, 'replace')).toBe(`REPLACE DEV ${batchId.slice(0, 12)}`);
    expect(v3BackupPromoteInputSchema.safeParse({ ...candidate.request, mode: 'replace' }).success).toBe(false);
    expect(v3BackupPromoteInputSchema.safeParse({ ...candidate.request, mode: 'replace', confirmation: v3PromotionConfirmationForBatch(batchId, 'replace') }).success).toBe(true);
    expect(v3BackupPromoteInputSchema.safeParse({ ...candidate.request, mode: 'overwrite' }).success).toBe(false);
  });

  it('plans a replacement: rewrite backup paths, remove everything else, keep only cloud audit history', () => {
    expect(V3_REPLACE_COLLECTIONS).toEqual(expect.arrayContaining(['rooms', 'bookings', 'stays', 'stayLogs', 'payments', 'monthlyRentals', 'auditLogs']));
    expect(V3_REPLACE_COLLECTIONS).not.toContain('properties');
    const root = 'properties/property-main';
    const decision = planV3Replacement([
      { path: `${root}/rooms/201`, data: { migrationImport: {} } },
      { path: `${root}/bookings/RSV-CLOUD`, data: {} },
      { path: `${root}/stays/STY-OLD`, data: { migrationImport: {} } },
      { path: `${root}/auditLogs/v3-activity_logs-9`, data: { migrationImport: {} } },
      { path: `${root}/auditLogs/cloud-op`, data: { action: 'stay.checkout' } },
    ], new Set([`${root}/rooms/201`]));
    expect(decision).toEqual({ overwrite: [`${root}/rooms/201`], remove: [`${root}/bookings/RSV-CLOUD`, `${root}/stays/STY-OLD`, `${root}/auditLogs/v3-activity_logs-9`], keep: [`${root}/auditLogs/cloud-op`] });
  });

  it('requires the batch-specific human confirmation phrase', () => {
    const candidate = fixture();
    candidate.request.confirmation = 'PROMOTE DEV';
    expect(v3BackupPromoteInputSchema.safeParse(candidate.request).success).toBe(false);
  });

  it('permits a resume only for the exact immutable document written by this batch', () => {
    const candidate = fixture();
    const document = candidate.preparedRows[0];
    if (!document) throw new Error('fixture document missing');
    const marker = { batchId, sourceChecksumSha256: checksumSha256, transformVersion: V3_MIGRATION_TRANSFORM_VERSION } as const;
    const exactExisting = { ...document.data, migrationImport: { ...marker, promotedAt: 'server timestamp ignored by matcher' } };

    expect(matchesV3PromotionDocument(exactExisting, document, marker)).toBe(true);
    expect(matchesV3PromotionDocument({ ...exactExisting, version: 1 }, document, marker)).toBe(false);
    expect(matchesV3PromotionDocument({ ...document.data, migrationImport: { ...marker, batchId: 'e'.repeat(64) } }, document, marker)).toBe(false);
  });

  it('preserves an existing validated cloud property root and stores its legacy row separately', () => {
    const candidate = fixture();
    const document = candidate.preparedRows.find((row) => row.sourceTable === 'properties');
    if (!document) throw new Error('property fixture document missing');
    const bootstrap = {
      propertyId,
      name: 'BINI Blooms PMS',
      active: true,
      currency: 'TWD',
      timezone: 'Asia/Taipei',
    };
    const marker = { batchId, sourceChecksumSha256: checksumSha256, transformVersion: V3_MIGRATION_TRANSFORM_VERSION } as const;

    expect(canAttachV3PropertyToCloudBootstrap(bootstrap, document)).toBe(true);
    expect(canAttachV3PropertyToCloudBootstrap({ ...bootstrap, propertyId: 'another-property' }, document)).toBe(false);
    expect(canAttachV3PropertyToCloudBootstrap({ ...bootstrap, active: 'true' }, document)).toBe(false);
    expect(canAttachV3PropertyToCloudBootstrap({ ...bootstrap, legacyV3Import: {} }, document)).toBe(false);
    expect(matchesV3PromotionDocument({
      ...bootstrap,
      legacyV3Import: document.data,
      migrationImport: marker,
    }, document, marker)).toBe(true);
  });
});

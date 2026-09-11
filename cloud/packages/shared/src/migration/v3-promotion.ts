import { z } from 'zod';

import {
  V3_AUTHORITATIVE_ENTITY_MAPPINGS,
  V3_MIGRATION_SCHEMA_VERSION,
  V3MigrationMetadataSchema,
  normalizeMigrationPropertyId,
  v3DocumentId,
  type V3SourceTable,
} from './v3-mapping.js';
import {
  V3_MIGRATION_TRANSFORM_VERSION,
  type V3MigrationReconciliation,
  type V3PreparedDocument,
} from './v3-transform.js';

type JsonRecord = Record<string, unknown>;

const propertyIdSchema = z.string().trim().min(1).max(128).regex(/^[^/]+$/);
const batchIdSchema = z.string().regex(/^[a-f0-9]{64}$/);
const checksumSchema = z.string().regex(/^[a-f0-9]{64}$/);
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

export const V3_PROMOTION_CONFIRMATION_PREFIX = 'PROMOTE DEV';

/** A human-visible confirmation prevents an accidental click from writing prepared data. */
export function v3PromotionConfirmationForBatch(batchId: string): string {
  if (!batchIdSchema.safeParse(batchId).success) throw new Error('batch id is invalid');
  return `${V3_PROMOTION_CONFIRMATION_PREFIX} ${batchId.slice(0, 12)}`;
}

export const v3BackupPromoteInputSchema = z.object({
  propertyId: propertyIdSchema,
  batchId: batchIdSchema,
  confirmation: z.string().trim().min(1).max(64),
}).strict().superRefine((value, context) => {
  if (value.confirmation !== v3PromotionConfirmationForBatch(value.batchId)) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['confirmation'], message: 'promotion confirmation does not match this batch' });
  }
});

export type V3BackupPromoteInput = z.infer<typeof v3BackupPromoteInputSchema>;

export interface V3BackupPromotionResult {
  batchId: string;
  status: 'promoted' | 'already_promoted';
  transformVersion: typeof V3_MIGRATION_TRANSFORM_VERSION;
  documentCount: number;
}

export interface V3PromotionBatchMetadata {
  propertyId: string;
  status: string;
  sourceChecksumSha256: string;
  rowCount: number;
  preparedRowCount: number;
  transformVersion: number;
  reconciliation: V3MigrationReconciliation;
}

export interface V3PromotionPlan {
  propertyId: string;
  batchId: string;
  checksumSha256: string;
  documents: readonly V3PreparedDocument[];
}

export class V3PromotionPlanError extends Error {
  constructor(
    readonly kind: 'failed-precondition' | 'data-loss',
    message: string,
  ) {
    super(message);
    this.name = 'V3PromotionPlanError';
  }
}

const preparedDocumentSchema = z.object({
  propertyId: propertyIdSchema,
  sourceTable: sourceTableSchema,
  sourceId: z.string().trim().min(1).max(128),
  targetCollection: z.string().trim().min(1).max(128),
  targetDocumentId: z.string().trim().min(1).max(256),
  targetPath: z.string().trim().min(1).max(512),
  data: z.record(z.string(), z.unknown()),
  transformVersion: z.literal(V3_MIGRATION_TRANSFORM_VERSION),
}).passthrough();

const reconciliationTableSchema = z.object({
  sourceTable: sourceTableSchema,
  targetCollection: z.string().trim().min(1).max(128),
  sourceCount: z.number().int().min(0),
  preparedCount: z.number().int().min(0),
}).strict();

const reconciliationSchema = z.object({
  valid: z.literal(true),
  sourceRowCount: z.number().int().min(0),
  preparedRowCount: z.number().int().min(0),
  tables: z.array(reconciliationTableSchema).length(V3_AUTHORITATIVE_ENTITY_MAPPINGS.length),
  amountTotalsNts: z.record(z.string(), z.record(z.string(), z.number())),
  errors: z.array(z.unknown()),
  warnings: z.array(z.unknown()),
}).strict();

const promotionBatchMetadataSchema = z.object({
  propertyId: propertyIdSchema,
  status: z.string().trim().min(1).max(64),
  sourceChecksumSha256: checksumSchema,
  rowCount: z.number().int().min(0),
  preparedRowCount: z.number().int().min(0),
  transformVersion: z.literal(V3_MIGRATION_TRANSFORM_VERSION),
  reconciliation: reconciliationSchema,
}).passthrough();

function asRecord(value: unknown): JsonRecord | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as JsonRecord
    : null;
}

function planError(kind: V3PromotionPlanError['kind'], message: string): never {
  throw new V3PromotionPlanError(kind, message);
}

function expectedTarget(document: Pick<V3PreparedDocument, 'propertyId' | 'sourceTable' | 'sourceId'>): {
  collection: string;
  documentId: string;
  path: string;
} {
  const mapping = V3_AUTHORITATIVE_ENTITY_MAPPINGS.find((candidate) => candidate.sourceTable === document.sourceTable);
  if (!mapping) planError('data-loss', `prepared row has unsupported source table ${document.sourceTable}`);
  const propertyId = normalizeMigrationPropertyId(document.propertyId);
  const documentId = document.sourceTable === 'properties'
    ? propertyId
    : v3DocumentId(mapping, document.sourceId);
  return {
    collection: mapping.targetCollection,
    documentId,
    path: document.sourceTable === 'properties'
      ? `properties/${propertyId}`
      : `properties/${propertyId}/${mapping.targetCollection}/${documentId}`,
  };
}

function parsePreparedDocument(
  value: unknown,
  expectedPropertyId: string,
  checksumSha256: string,
): V3PreparedDocument {
  const parsed = preparedDocumentSchema.safeParse(value);
  if (!parsed.success) planError('data-loss', 'prepared row has an invalid document shape');
  const document = parsed.data;
  if (document.propertyId !== expectedPropertyId) planError('data-loss', 'prepared row belongs to a different property');
  const expected = expectedTarget(document);
  if (
    document.targetCollection !== expected.collection
    || document.targetDocumentId !== expected.documentId
    || document.targetPath !== expected.path
  ) planError('data-loss', `prepared row ${document.sourceTable}/${document.sourceId} target identity does not match its mapping`);

  const migration = V3MigrationMetadataSchema.safeParse(document.data.migration);
  if (!migration.success) planError('data-loss', `prepared row ${document.sourceTable}/${document.sourceId} has invalid migration metadata`);
  if (
    migration.data.schemaVersion !== V3_MIGRATION_SCHEMA_VERSION
    || migration.data.sourceTable !== document.sourceTable
    || migration.data.sourceId !== document.sourceId
    || migration.data.sourceChecksumSha256 !== checksumSha256
    || document.data.propertyId !== expectedPropertyId
    || document.data.schemaVersion !== V3_MIGRATION_SCHEMA_VERSION
    || document.data.version !== 0
  ) planError('data-loss', `prepared row ${document.sourceTable}/${document.sourceId} metadata does not match this batch`);

  return {
    propertyId: document.propertyId,
    sourceTable: document.sourceTable,
    sourceId: document.sourceId,
    targetCollection: document.targetCollection,
    targetDocumentId: document.targetDocumentId,
    targetPath: document.targetPath,
    data: document.data,
  };
}

function parseBatchMetadata(value: unknown): V3PromotionBatchMetadata {
  const parsed = promotionBatchMetadataSchema.safeParse(value);
  if (!parsed.success) planError('data-loss', 'migration batch metadata is incomplete or invalid');
  return parsed.data as V3PromotionBatchMetadata;
}

/**
 * Revalidates the entire prepared batch before a Function may write an operational document.
 * It deliberately does not accept arbitrary target paths from Firestore; every path is rebuilt
 * from the mapping and source identity.
 */
export function buildV3PromotionPlan(input: {
  request: V3BackupPromoteInput;
  batch: unknown;
  preparedRows: readonly unknown[];
}): V3PromotionPlan {
  const request = v3BackupPromoteInputSchema.parse(input.request);
  const batch = parseBatchMetadata(input.batch);
  const propertyId = normalizeMigrationPropertyId(request.propertyId);
  if (batch.propertyId !== propertyId) planError('failed-precondition', 'migration batch does not belong to this property');
  if (!['ready', 'promoting', 'promoted'].includes(batch.status)) {
    planError('failed-precondition', 'migration batch is not ready for promotion');
  }
  if (
    !batch.reconciliation.valid
    || batch.reconciliation.errors.length !== 0
    || batch.rowCount !== batch.reconciliation.sourceRowCount
    || batch.preparedRowCount !== batch.reconciliation.preparedRowCount
    || batch.rowCount !== batch.preparedRowCount
    || input.preparedRows.length !== batch.preparedRowCount
  ) planError('data-loss', 'migration batch reconciliation counts are inconsistent');

  const tables = new Map(batch.reconciliation.tables.map((table) => [table.sourceTable, table]));
  if (tables.size !== V3_AUTHORITATIVE_ENTITY_MAPPINGS.length) {
    planError('data-loss', 'migration reconciliation table set is incomplete');
  }
  for (const mapping of V3_AUTHORITATIVE_ENTITY_MAPPINGS) {
    const table = tables.get(mapping.sourceTable);
    if (!table || table.targetCollection !== mapping.targetCollection || table.sourceCount !== table.preparedCount) {
      planError('data-loss', `migration reconciliation is invalid for ${mapping.sourceTable}`);
    }
  }

  const targetPaths = new Set<string>();
  const actualPreparedCounts = new Map<V3SourceTable, number>();
  const documents = input.preparedRows.map((row) => {
    const document = parsePreparedDocument(row, propertyId, batch.sourceChecksumSha256);
    if (targetPaths.has(document.targetPath)) planError('data-loss', `duplicate prepared target path ${document.targetPath}`);
    targetPaths.add(document.targetPath);
    actualPreparedCounts.set(document.sourceTable, (actualPreparedCounts.get(document.sourceTable) ?? 0) + 1);
    return document;
  });
  for (const mapping of V3_AUTHORITATIVE_ENTITY_MAPPINGS) {
    const table = tables.get(mapping.sourceTable);
    if ((actualPreparedCounts.get(mapping.sourceTable) ?? 0) !== table?.preparedCount) {
      planError('data-loss', `prepared row count does not match reconciliation for ${mapping.sourceTable}`);
    }
  }

  return { propertyId, batchId: request.batchId, checksumSha256: batch.sourceChecksumSha256, documents };
}

export interface V3PromotionMarker {
  batchId: string;
  sourceChecksumSha256: string;
  transformVersion: typeof V3_MIGRATION_TRANSFORM_VERSION;
}

/**
 * The cloud foundation creates the property root before a legacy import so it
 * can hold cloud-only settings (timezone, currency and activation). A legacy
 * property row must never replace those settings. It may be attached once as
 * an immutable import payload instead.
 */
export function canAttachV3PropertyToCloudBootstrap(
  existing: unknown,
  document: V3PreparedDocument,
): boolean {
  if (document.sourceTable !== 'properties') return false;
  const record = asRecord(existing);
  if (!record || record.propertyId !== document.propertyId) return false;
  if (Object.hasOwn(record, 'migrationImport') || Object.hasOwn(record, 'legacyV3Import')) return false;
  return typeof record.name === 'string'
    && record.name.trim().length > 0
    && typeof record.active === 'boolean'
    && typeof record.currency === 'string'
    && record.currency.trim().length > 0
    && typeof record.timezone === 'string'
    && record.timezone.trim().length > 0;
}

function stableJson(value: unknown): string | null {
  if (value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return JSON.stringify(value);
  if (Array.isArray(value)) {
    const entries = value.map(stableJson);
    return entries.every((entry): entry is string => entry !== null) ? `[${entries.join(',')}]` : null;
  }
  const record = asRecord(value);
  if (!record) return null;
  const entries: string[] = [];
  for (const key of Object.keys(record).sort()) {
    const encoded = stableJson(record[key]);
    if (encoded === null) return null;
    entries.push(`${JSON.stringify(key)}:${encoded}`);
  }
  return `{${entries.join(',')}}`;
}

/** True only when a retry encounters the exact immutable document written by this batch. */
export function matchesV3PromotionDocument(
  existing: unknown,
  document: V3PreparedDocument,
  marker: V3PromotionMarker,
): boolean {
  const record = asRecord(existing);
  if (!record) return false;
  const rawMarker = asRecord(record.migrationImport);
  if (
    rawMarker?.batchId !== marker.batchId
    || rawMarker.sourceChecksumSha256 !== marker.sourceChecksumSha256
    || rawMarker.transformVersion !== marker.transformVersion
  ) return false;
  // A pre-created property root keeps cloud settings intact and stores the
  // legacy property payload under a dedicated immutable field. Changes to
  // normal cloud settings are allowed after migration; changes to the legacy
  // payload are not silently accepted on a retry.
  if (document.sourceTable === 'properties' && stableJson(record.legacyV3Import) === stableJson(document.data)) {
    return true;
  }

  const withoutMarker = { ...record };
  delete withoutMarker.migrationImport;
  return stableJson(withoutMarker) === stableJson(document.data);
}

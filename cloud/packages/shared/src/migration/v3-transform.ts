import {
  V3MigrationMetadataSchema,
  V3_AUTHORITATIVE_ENTITY_MAPPINGS,
  V3_MIGRATION_SCHEMA_VERSION,
  V3_MIGRATION_SOURCE_VERSION,
  legacyBoolean,
  legacyNtsAmount,
  legacyTaipeiDateTimeToIso,
  normalizeMigrationPropertyId,
  v3DocumentId,
  type V3AuthoritativeEntityMapping,
  type V3SourceTable,
} from './v3-mapping.js';
import type { V3StagingRow } from './v3-backup.js';
import { z } from 'zod';

import { CLOUD_ROOM_STATUSES } from '../domain/room-overview.js';

type JsonRecord = Record<string, unknown>;

const ROOM_STATUSES: ReadonlySet<string> = new Set(CLOUD_ROOM_STATUSES);
const BOOKING_STATUSES = new Set(['已預約', '已取消', 'No-show', '已入住']);
const PAYMENT_STATUSES = new Set(['paid', 'pending', 'partial', 'refunded']);
const CASHIER_STATUSES = new Set(['open', 'closed']);
const MAINTENANCE_STATUSES = new Set(['scheduled', 'in_progress', 'done']);
const MONTHLY_STATUSES = new Set(['active', 'ended', 'renewed', 'voided']);

// Bumped after adding verified compatibility for real v3 renewal, historical
// free-cancel logs, and decimal display-rate records. Existing blocked batches
// are therefore safely re-prepared instead of reusing their obsolete report.
export const V3_MIGRATION_TRANSFORM_VERSION = 3 as const;

export const v3BackupPrepareInputSchema = z.object({
  propertyId: z.string().trim().min(1).max(128).regex(/^[^/]+$/),
  batchId: z.string().regex(/^[a-f0-9]{64}$/),
}).strict();

export type V3BackupPrepareInput = z.infer<typeof v3BackupPrepareInputSchema>;

export interface V3PreparedDocument {
  propertyId: string;
  sourceTable: V3SourceTable;
  sourceId: string;
  targetCollection: string;
  targetDocumentId: string;
  targetPath: string;
  data: JsonRecord;
}

export interface V3ReconciliationIssue {
  code: string;
  message: string;
  sourceTable: V3SourceTable | null;
  sourceId: string | null;
}

export interface V3TableReconciliation {
  sourceTable: V3SourceTable;
  targetCollection: string;
  sourceCount: number;
  preparedCount: number;
}

export interface V3MigrationReconciliation {
  valid: boolean;
  sourceRowCount: number;
  preparedRowCount: number;
  tables: V3TableReconciliation[];
  amountTotalsNts: Record<string, Record<string, number>>;
  errors: V3ReconciliationIssue[];
  warnings: V3ReconciliationIssue[];
}

export interface V3MigrationPreparation {
  documents: V3PreparedDocument[];
  report: V3MigrationReconciliation;
}

export interface V3BackupPrepareResult {
  batchId: string;
  status: 'ready' | 'blocked';
  transformVersion: typeof V3_MIGRATION_TRANSFORM_VERSION;
  report: V3MigrationReconciliation;
}

function asRecord(value: unknown, label: string): JsonRecord {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as JsonRecord;
}

function requiredString(record: JsonRecord, key: string, maxLength = 500): string {
  const value = record[key];
  if (typeof value !== 'string' || value.trim() === '') throw new Error(`${key} must be a non-empty string`);
  const normalized = value.trim();
  if (normalized.length > maxLength) throw new Error(`${key} exceeds ${maxLength} characters`);
  return normalized;
}

function nullableString(record: JsonRecord, key: string, maxLength = 5_000): string | null {
  const value = record[key];
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'string') throw new Error(`${key} must be a string or null`);
  const normalized = value.trim();
  if (normalized.length > maxLength) throw new Error(`${key} exceeds ${maxLength} characters`);
  return normalized || null;
}

function requiredEnum(record: JsonRecord, key: string, values: ReadonlySet<string>): string {
  const value = requiredString(record, key, 64);
  if (!values.has(value)) throw new Error(`${key} contains unsupported value ${value}`);
  return value;
}

function requiredInteger(record: JsonRecord, key: string): number {
  const value = record[key];
  const parsed = typeof value === 'string' && value.trim() ? Number(value) : value;
  if (typeof parsed !== 'number' || !Number.isSafeInteger(parsed)) throw new Error(`${key} must be a safe integer`);
  return parsed;
}

function legacyFiniteNonNegativeNumber(value: unknown, key: string): number {
  const parsed = typeof value === 'string' && value.trim() ? Number(value) : value;
  if (typeof parsed !== 'number' || !Number.isFinite(parsed) || parsed < 0) throw new Error(`${key} must be a finite non-negative number`);
  return parsed;
}

function nullableDateTime(record: JsonRecord, key: string): string | null {
  return legacyTaipeiDateTimeToIso(record[key]);
}

function requiredDateTime(record: JsonRecord, key: string): string {
  const value = legacyTaipeiDateTimeToIso(record[key]);
  if (!value) throw new Error(`${key} is required`);
  return value;
}

function nullableDate(record: JsonRecord, key: string): string | null {
  const value = nullableDateTime(record, key);
  return value?.slice(0, 10) ?? null;
}

function requiredDate(record: JsonRecord, key: string): string {
  return requiredDateTime(record, key).slice(0, 10);
}

function assertRange(start: string | null, end: string | null, label: string): void {
  if (start && end && Date.parse(start) >= Date.parse(end)) throw new Error(`${label} range must end after it starts`);
}

function assertNonDecreasingRange(start: string | null, end: string | null, label: string): void {
  if (start && end && Date.parse(start) > Date.parse(end)) throw new Error(`${label} range must not end before it starts`);
}

function migrationMetadata(row: V3StagingRow, importedAt: string, checksumSha256: string): JsonRecord {
  return V3MigrationMetadataSchema.parse({
    schemaVersion: V3_MIGRATION_SCHEMA_VERSION,
    sourceVersion: V3_MIGRATION_SOURCE_VERSION,
    sourceTable: row.sourceTable,
    sourceId: row.sourceId,
    sourceChecksumSha256: checksumSha256,
    importedAt,
  });
}

function baseData(row: V3StagingRow, importedAt: string, checksumSha256: string): JsonRecord {
  return {
    schemaVersion: V3_MIGRATION_SCHEMA_VERSION,
    version: 0,
    propertyId: normalizeMigrationPropertyId(row.propertyId),
    migration: migrationMetadata(row, importedAt, checksumSha256),
  };
}

function assertSourceIdentity(row: V3StagingRow, legacy: JsonRecord): void {
  const identity = row.sourceTable === 'holiday_cache' ? legacy.date : legacy.id;
  if ((typeof identity !== 'string' && typeof identity !== 'number') || String(identity).trim() !== row.sourceId) {
    throw new Error('staging source id does not match legacy payload');
  }
}

function transformProperty(row: V3StagingRow, legacy: JsonRecord, metadata: JsonRecord): JsonRecord {
  return {
    ...metadata,
    legacyPropertyId: row.sourceId,
    name: requiredString(legacy, 'name', 200),
    address: nullableString(legacy, 'address', 1_000),
    phone: nullableString(legacy, 'phone', 100),
    active: legacyBoolean(legacy.is_active),
    note: nullableString(legacy, 'note'),
    createdAt: nullableDateTime(legacy, 'created_at'),
  };
}

function transformRoom(legacy: JsonRecord, metadata: JsonRecord): JsonRecord {
  return {
    ...metadata,
    roomId: requiredString(legacy, 'id', 128),
    status: requiredEnum(legacy, 'status', ROOM_STATUSES),
    guestName: nullableString(legacy, 'current_guest', 300),
    checkInAt: nullableDateTime(legacy, 'checkin'),
    checkOutAt: nullableDateTime(legacy, 'checkout'),
    note: nullableString(legacy, 'note'),
    maintenanceNote: nullableString(legacy, 'maintenance_note'),
    maintenanceDueDate: nullableDate(legacy, 'maintenance_due'),
  };
}

function transformBooking(legacy: JsonRecord, metadata: JsonRecord): JsonRecord {
  const checkInAt = requiredDateTime(legacy, 'checkin');
  const checkOutAt = requiredDateTime(legacy, 'checkout');
  assertRange(checkInAt, checkOutAt, 'booking');
  return {
    ...metadata,
    bookingId: requiredString(legacy, 'id', 128),
    roomId: requiredString(legacy, 'room', 128),
    guestName: requiredString(legacy, 'guest', 300),
    phone: nullableString(legacy, 'phone', 100),
    checkInAt,
    checkOutAt,
    plan: requiredString(legacy, 'plan', 64),
    amountNts: legacyNtsAmount(legacy.amount),
    discountNts: legacyNtsAmount(legacy.discount),
    rateType: nullableString(legacy, 'rate_type', 100),
    status: requiredEnum(legacy, 'status', BOOKING_STATUSES),
  };
}

function transformStay(legacy: JsonRecord, metadata: JsonRecord): JsonRecord {
  const checkInAt = nullableDateTime(legacy, 'checkin_time');
  const checkOutAt = nullableDateTime(legacy, 'checkout_time');
  assertRange(checkInAt, checkOutAt, 'stay');
  return {
    ...metadata,
    roomId: requiredString(legacy, 'room', 128),
    guestName: requiredString(legacy, 'guest', 300),
    plan: nullableString(legacy, 'plan', 64),
    baseRentNts: legacyNtsAmount(legacy.base_rent),
    discountNts: legacyNtsAmount(legacy.discount),
    extensionFeeNts: legacyNtsAmount(legacy.extension_fee),
    extraFeeNts: legacyNtsAmount(legacy.extra_fee),
    totalDueNts: legacyNtsAmount(legacy.total_due),
    checkInAt,
    checkOutAt,
    // v3 stores this derived display rate as a decimal (for example 2000 / 24),
    // whereas v4's operational field is an integer and is not used to recompute
    // imported financial totals. Keep the v3-compatible floor used by v4 check-in.
    hourlyRateNts: Math.floor(legacyFiniteNonNegativeNumber(legacy.hourly_rate, 'hourly_rate')),
    bookingId: nullableString(legacy, 'booking_id', 128),
    createdAt: nullableDateTime(legacy, 'created_at'),
    originalCheckOutAt: nullableDateTime(legacy, 'original_checkout_time'),
  };
}

function transformStayLog(legacy: JsonRecord, metadata: JsonRecord): JsonRecord {
  let checkInAt = nullableDateTime(legacy, 'checkin_time');
  const checkOutAt = nullableDateTime(legacy, 'checkout_time');
  const freeCancel = legacyBoolean(legacy.free_cancel);
  const createdAt = requiredDateTime(legacy, 'created_at');
  const cancelledBeforeCheckIn = Boolean(freeCancel && checkInAt && checkOutAt && Date.parse(checkOutAt) < Date.parse(checkInAt));
  const scheduledCheckInAt = cancelledBeforeCheckIn ? checkInAt : null;
  if (cancelledBeforeCheckIn) checkInAt = checkOutAt;
  assertNonDecreasingRange(checkInAt, checkOutAt, 'stay log');
  return {
    ...metadata,
    roomId: requiredString(legacy, 'room', 128),
    guestName: requiredString(legacy, 'guest', 300),
    plan: nullableString(legacy, 'plan', 64),
    checkInAt,
    checkOutAt,
    scheduledCheckInAt,
    baseRentNts: legacyNtsAmount(legacy.base_rent),
    extensionFeeNts: legacyNtsAmount(legacy.extension_fee),
    extraFeeNts: legacyNtsAmount(legacy.extra_fee),
    totalChargedNts: legacyNtsAmount(legacy.total_charged),
    freeCancel,
    transferred: legacyBoolean(legacy.transferred),
    newRoomId: nullableString(legacy, 'new_room', 128),
    createdAt,
  };
}

function transformAudit(legacy: JsonRecord, metadata: JsonRecord): JsonRecord {
  return {
    ...metadata,
    createdAt: requiredDateTime(legacy, 'timestamp'),
    actorLegacyId: requiredString(legacy, 'user_id', 128),
    action: requiredString(legacy, 'action_type', 128),
    targetId: nullableString(legacy, 'target_id', 128),
    targetType: nullableString(legacy, 'target_type', 128),
    originalValue: nullableString(legacy, 'original_value', 50_000),
    newValue: nullableString(legacy, 'new_value', 50_000),
    description: nullableString(legacy, 'description', 10_000),
    source: 'v3-migration',
  };
}

function transformPayment(legacy: JsonRecord, metadata: JsonRecord): JsonRecord {
  return {
    ...metadata,
    bookingId: nullableString(legacy, 'booking_id', 128),
    roomId: nullableString(legacy, 'room_id', 128),
    guestName: nullableString(legacy, 'guest', 300),
    paymentType: requiredString(legacy, 'payment_type', 64),
    amountNts: legacyNtsAmount(legacy.amount),
    deposit: legacyBoolean(legacy.is_deposit),
    refund: legacyBoolean(legacy.is_refund),
    status: requiredEnum(legacy, 'payment_status', PAYMENT_STATUSES),
    note: nullableString(legacy, 'note'),
    createdAt: requiredDateTime(legacy, 'created_at'),
    createdByLegacyId: nullableString(legacy, 'created_by', 128),
    invoiceNo: nullableString(legacy, 'invoice_no', 200),
    externalTransactionId: nullableString(legacy, 'external_txn_id', 300),
    accountingExportedAt: nullableDateTime(legacy, 'accounting_exported_at'),
  };
}

function transformCashier(legacy: JsonRecord, metadata: JsonRecord): JsonRecord {
  return {
    ...metadata,
    sessionDate: requiredDate(legacy, 'session_date'),
    openedByLegacyId: nullableString(legacy, 'opened_by', 128),
    closedByLegacyId: nullableString(legacy, 'closed_by', 128),
    openedAt: nullableDateTime(legacy, 'opened_at'),
    closedAt: nullableDateTime(legacy, 'closed_at'),
    status: requiredEnum(legacy, 'status', CASHIER_STATUSES),
    totalExpectedNts: legacyNtsAmount(legacy.total_expected),
    totalCashNts: legacyNtsAmount(legacy.total_cash),
    totalTransferNts: legacyNtsAmount(legacy.total_transfer),
    totalCardNts: legacyNtsAmount(legacy.total_card),
    totalOtherNts: legacyNtsAmount(legacy.total_other),
    totalRefundsNts: legacyNtsAmount(legacy.total_refunds),
    totalDepositsNts: legacyNtsAmount(legacy.total_deposits),
    note: nullableString(legacy, 'note'),
  };
}

function transformCost(legacy: JsonRecord, metadata: JsonRecord): JsonRecord {
  return {
    ...metadata,
    costDate: requiredDate(legacy, 'cost_date'),
    category: requiredString(legacy, 'category', 100),
    subcategory: nullableString(legacy, 'subcategory', 100),
    amountNts: legacyNtsAmount(legacy.amount),
    paymentMethod: requiredString(legacy, 'payment_method', 64),
    vendor: nullableString(legacy, 'vendor', 300),
    description: nullableString(legacy, 'description'),
    note: nullableString(legacy, 'note'),
    recurring: legacyBoolean(legacy.is_recurring),
    receiptNo: nullableString(legacy, 'receipt_no', 200),
    createdByLegacyId: nullableString(legacy, 'created_by', 128),
    createdAt: nullableDateTime(legacy, 'created_at'),
    updatedAt: nullableDateTime(legacy, 'updated_at'),
  };
}

function transformMaintenance(legacy: JsonRecord, metadata: JsonRecord): JsonRecord {
  const startAt = requiredDateTime(legacy, 'start_time');
  const endAt = requiredDateTime(legacy, 'end_time');
  assertRange(startAt, endAt, 'maintenance');
  return {
    ...metadata,
    roomId: requiredString(legacy, 'room_id', 128),
    title: requiredString(legacy, 'title', 500),
    startAt,
    endAt,
    note: nullableString(legacy, 'note'),
    status: requiredEnum(legacy, 'status', MAINTENANCE_STATUSES),
    createdByLegacyId: nullableString(legacy, 'created_by', 128),
    createdAt: nullableDateTime(legacy, 'created_at'),
  };
}

function transformMonthlyRental(legacy: JsonRecord, metadata: JsonRecord): JsonRecord {
  const startDate = requiredDate(legacy, 'start_date');
  const endDate = requiredDate(legacy, 'end_date');
  if (startDate >= endDate) throw new Error('monthly rental range must end after it starts');
  return {
    ...metadata,
    roomId: requiredString(legacy, 'room_id', 128),
    tenantName: requiredString(legacy, 'tenant_name', 300),
    tenantPhone: nullableString(legacy, 'tenant_phone', 100),
    startDate,
    endDate,
    depositNts: legacyNtsAmount(legacy.deposit),
    rentNts: legacyNtsAmount(legacy.rent),
    status: requiredEnum(legacy, 'status', MONTHLY_STATUSES),
    depositRefundedNts: legacyNtsAmount(legacy.deposit_refunded),
    paymentType: nullableString(legacy, 'payment_type', 64),
    note: nullableString(legacy, 'note'),
    createdAt: nullableDateTime(legacy, 'created_at'),
    endedAt: nullableDateTime(legacy, 'ended_at'),
    createdByLegacyId: nullableString(legacy, 'created_by', 128),
  };
}

function transformHoliday(legacy: JsonRecord, metadata: JsonRecord): JsonRecord {
  const date = requiredDate(legacy, 'date');
  const year = requiredInteger(legacy, 'year');
  if (year !== Number(date.slice(0, 4))) throw new Error('holiday year does not match date');
  return {
    ...metadata,
    date,
    description: nullableString(legacy, 'description', 500),
    holiday: legacyBoolean(legacy.is_holiday),
    manual: legacyBoolean(legacy.is_manual),
    year,
    source: nullableString(legacy, 'source', 64),
    updatedAt: nullableDateTime(legacy, 'updated_at'),
  };
}

function transformData(row: V3StagingRow, legacy: JsonRecord, importedAt: string, checksumSha256: string): JsonRecord {
  const metadata = baseData(row, importedAt, checksumSha256);
  switch (row.sourceTable) {
    case 'properties': return transformProperty(row, legacy, metadata);
    case 'rooms': return transformRoom(legacy, metadata);
    case 'bookings': return transformBooking(legacy, metadata);
    case 'active_stays': return transformStay(legacy, metadata);
    case 'stay_logs': return transformStayLog(legacy, metadata);
    case 'activity_logs': return transformAudit(legacy, metadata);
    case 'payments': return transformPayment(legacy, metadata);
    case 'cashier_sessions': return transformCashier(legacy, metadata);
    case 'cost_entries': return transformCost(legacy, metadata);
    case 'maintenance_schedules': return transformMaintenance(legacy, metadata);
    case 'monthly_rentals': return transformMonthlyRental(legacy, metadata);
    case 'holiday_cache': return transformHoliday(legacy, metadata);
  }
}

function mappingFor(table: V3SourceTable): V3AuthoritativeEntityMapping {
  const mapping = V3_AUTHORITATIVE_ENTITY_MAPPINGS.find((candidate) => candidate.sourceTable === table);
  if (!mapping) throw new Error(`unsupported source table ${table}`);
  return mapping;
}

export function transformV3StagingRow(
  row: V3StagingRow,
  importedAt: string,
  checksumSha256: string,
): V3PreparedDocument {
  const mapping = mappingFor(row.sourceTable);
  if (row.targetCollection !== mapping.targetCollection) throw new Error('staging target collection does not match mapping');
  const legacy = asRecord(JSON.parse(row.legacyJson) as unknown, 'legacy row');
  assertSourceIdentity(row, legacy);
  const propertyId = normalizeMigrationPropertyId(row.propertyId);
  const expectedStagingId = v3DocumentId(mapping, row.sourceId);
  if (row.targetDocumentId !== expectedStagingId) throw new Error('staging target document id does not match mapping');
  const targetDocumentId = row.sourceTable === 'properties' ? propertyId : expectedStagingId;
  const targetPath = row.sourceTable === 'properties'
    ? `properties/${propertyId}`
    : `properties/${propertyId}/${mapping.targetCollection}/${targetDocumentId}`;
  return {
    propertyId,
    sourceTable: row.sourceTable,
    sourceId: row.sourceId,
    targetCollection: mapping.targetCollection,
    targetDocumentId,
    targetPath,
    data: transformData(row, legacy, importedAt, checksumSha256),
  };
}

function emptyCountRecord(): Record<V3SourceTable, number> {
  return Object.fromEntries(V3_AUTHORITATIVE_ENTITY_MAPPINGS.map(({ sourceTable }) => [sourceTable, 0])) as Record<V3SourceTable, number>;
}

function issue(code: string, message: string, document?: V3PreparedDocument): V3ReconciliationIssue {
  return {
    code,
    message,
    sourceTable: document?.sourceTable ?? null,
    sourceId: document?.sourceId ?? null,
  };
}

function stringField(document: V3PreparedDocument, key: string): string | null {
  const value = document.data[key];
  return typeof value === 'string' && value ? value : null;
}

function collectAmountTotals(documents: readonly V3PreparedDocument[]): Record<string, Record<string, number>> {
  const totals: Record<string, Record<string, number>> = {};
  for (const document of documents) {
    for (const [key, value] of Object.entries(document.data)) {
      if (!key.endsWith('Nts') || typeof value !== 'number') continue;
      const table = totals[document.sourceTable] ?? {};
      table[key] = (table[key] ?? 0) + value;
      totals[document.sourceTable] = table;
    }
  }
  return totals;
}

export function prepareV3Migration(
  rows: readonly V3StagingRow[],
  options: { importedAt: string; checksumSha256: string },
): V3MigrationPreparation {
  const sourceCounts = emptyCountRecord();
  const preparedCounts = emptyCountRecord();
  const documents: V3PreparedDocument[] = [];
  const errors: V3ReconciliationIssue[] = [];
  const warnings: V3ReconciliationIssue[] = [];
  const seenPaths = new Set<string>();

  for (const row of rows) {
    sourceCounts[row.sourceTable] += 1;
    try {
      const document = transformV3StagingRow(row, options.importedAt, options.checksumSha256);
      if (seenPaths.has(document.targetPath)) {
        errors.push(issue('duplicate_target_path', `Duplicate target path ${document.targetPath}`, document));
        continue;
      }
      seenPaths.add(document.targetPath);
      documents.push(document);
      preparedCounts[document.sourceTable] += 1;
    } catch (error) {
      errors.push({
        code: 'row_transform_failed',
        message: error instanceof Error ? error.message : 'row transform failed',
        sourceTable: row.sourceTable,
        sourceId: row.sourceId,
      });
    }
  }

  if (sourceCounts.properties !== 1) {
    errors.push(issue('property_count_invalid', 'Exactly one legacy property is required for this single-property import.'));
  }

  const rooms = new Set(documents.filter((item) => item.sourceTable === 'rooms').map((item) => item.targetDocumentId));
  const bookings = new Set(documents.filter((item) => item.sourceTable === 'bookings').map((item) => item.targetDocumentId));
  const activeRoomIds = new Set<string>();
  const activeMonthlyRoomIds = new Set<string>();

  for (const document of documents) {
    const roomId = stringField(document, 'roomId');
    if (roomId && !rooms.has(roomId)) errors.push(issue('orphan_room_reference', `Unknown room ${roomId}`, document));
    const bookingId = stringField(document, 'bookingId');
    if (bookingId && !bookings.has(bookingId)) errors.push(issue('orphan_booking_reference', `Unknown booking ${bookingId}`, document));

    if (document.sourceTable === 'active_stays' && roomId) {
      if (activeRoomIds.has(roomId)) errors.push(issue('duplicate_active_stay', `Room ${roomId} has multiple active stays`, document));
      activeRoomIds.add(roomId);
    }
    if (document.sourceTable === 'monthly_rentals' && roomId && document.data.status === 'active') {
      if (activeMonthlyRoomIds.has(roomId)) errors.push(issue('duplicate_active_monthly_rental', `Room ${roomId} has multiple active monthly rentals`, document));
      activeMonthlyRoomIds.add(roomId);
    }
  }

  if (documents.length === 0) warnings.push(issue('empty_import', 'No documents were prepared.'));

  const tables = V3_AUTHORITATIVE_ENTITY_MAPPINGS.map((mapping) => ({
    sourceTable: mapping.sourceTable,
    targetCollection: mapping.targetCollection,
    sourceCount: sourceCounts[mapping.sourceTable],
    preparedCount: preparedCounts[mapping.sourceTable],
  }));

  return {
    documents,
    report: {
      valid: errors.length === 0,
      sourceRowCount: rows.length,
      preparedRowCount: documents.length,
      tables,
      amountTotalsNts: collectAmountTotals(documents),
      errors,
      warnings,
    },
  };
}

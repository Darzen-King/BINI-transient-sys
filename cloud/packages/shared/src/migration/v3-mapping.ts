import { z } from 'zod';

export const V3_MIGRATION_SOURCE_VERSION = '3.9.14' as const;
export const V3_MIGRATION_SCHEMA_VERSION = 1 as const;
export const DEFAULT_MIGRATION_PROPERTY_ID = 'property-main' as const;

export const V3_AUTHORITATIVE_ENTITY_MAPPINGS = [
  { sourceTable: 'properties', targetCollection: 'properties', idStrategy: 'preserve', propertyStrategy: 'self' },
  { sourceTable: 'rooms', targetCollection: 'rooms', idStrategy: 'preserve', propertyStrategy: 'blank_to_default' },
  { sourceTable: 'bookings', targetCollection: 'bookings', idStrategy: 'preserve', propertyStrategy: 'blank_to_default' },
  { sourceTable: 'active_stays', targetCollection: 'stays', idStrategy: 'numeric_prefix', propertyStrategy: 'infer_from_room' },
  { sourceTable: 'stay_logs', targetCollection: 'stayLogs', idStrategy: 'numeric_prefix', propertyStrategy: 'infer_from_room' },
  { sourceTable: 'activity_logs', targetCollection: 'auditLogs', idStrategy: 'numeric_prefix', propertyStrategy: 'default' },
  { sourceTable: 'payments', targetCollection: 'payments', idStrategy: 'numeric_prefix', propertyStrategy: 'infer_from_room_or_booking' },
  { sourceTable: 'cashier_sessions', targetCollection: 'cashierSessions', idStrategy: 'numeric_prefix', propertyStrategy: 'default' },
  { sourceTable: 'cost_entries', targetCollection: 'costEntries', idStrategy: 'numeric_prefix', propertyStrategy: 'blank_to_default' },
  { sourceTable: 'maintenance_schedules', targetCollection: 'maintenanceSchedules', idStrategy: 'numeric_prefix', propertyStrategy: 'infer_from_room' },
  { sourceTable: 'monthly_rentals', targetCollection: 'monthlyRentals', idStrategy: 'numeric_prefix', propertyStrategy: 'blank_to_default' },
  { sourceTable: 'holiday_cache', targetCollection: 'holidays', idStrategy: 'date_key', propertyStrategy: 'default' },
] as const;

export type V3AuthoritativeEntityMapping = (typeof V3_AUTHORITATIVE_ENTITY_MAPPINGS)[number];
export type V3SourceTable = V3AuthoritativeEntityMapping['sourceTable'];

export const V3_IDENTITY_MAPPING = {
  sourceTable: 'users',
  targetCollection: 'staffProfiles',
  strategy: 'firebase_auth_reprovision',
  forbiddenFields: ['password_hash', 'password_salt'],
} as const;

export const V3_DERIVED_OR_EXCLUDED_DATA = [
  { source: 'rooms.next_booking', disposition: 'derive', reason: '由有效未來預約即時計算，歷史快取不可成為權威資料' },
  { source: 'report_summary', disposition: 'derive', reason: '由住宿、付款、月租與成本投影計算' },
  { source: 'backup_state', disposition: 'exclude', reason: 'Firebase 平台備援取代單機備份狀態' },
  { source: 'backup_logs', disposition: 'exclude', reason: '不移轉外部備份執行紀錄' },
  { source: 'backup_config', disposition: 'exclude_secret', reason: '不得上傳 Dropbox/WebDAV/FTP/Google Drive 憑證' },
  { source: 'users.password_hash', disposition: 'exclude_secret', reason: '密碼由 Firebase Auth 重新設定' },
  { source: 'users.password_salt', disposition: 'exclude_secret', reason: '密碼由 Firebase Auth 重新設定' },
] as const;

const SAFE_PRESERVED_ID = /^[^/]{1,128}$/;
const LEGACY_LOCAL_DATE_TIME = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?$/;

function assertSafeIntegerId(value: string): string {
  if (!/^[0-9]+$/.test(value)) throw new Error('legacy numeric id must contain digits only');
  const numeric = Number(value);
  if (!Number.isSafeInteger(numeric) || numeric < 0) throw new Error('legacy numeric id is out of range');
  return String(numeric);
}

export function normalizeMigrationPropertyId(
  legacyPropertyId: unknown,
  fallback: string = DEFAULT_MIGRATION_PROPERTY_ID,
): string {
  const normalized = typeof legacyPropertyId === 'string' ? legacyPropertyId.trim() : '';
  const fallbackNormalized = fallback.trim();
  if (!fallbackNormalized || fallbackNormalized.includes('/')) throw new Error('fallback property id is invalid');
  const result = normalized || fallbackNormalized;
  if (!SAFE_PRESERVED_ID.test(result)) throw new Error('property id is invalid');
  return result;
}

export function v3DocumentId(
  mapping: V3AuthoritativeEntityMapping,
  legacyId: string | number,
): string {
  const raw = String(legacyId).trim();
  if (!raw) throw new Error('legacy id must not be empty');

  switch (mapping.idStrategy) {
    case 'preserve':
      if (!SAFE_PRESERVED_ID.test(raw)) throw new Error('legacy id cannot be preserved safely');
      return raw;
    case 'numeric_prefix':
      return `v3-${mapping.sourceTable}-${assertSafeIntegerId(raw)}`;
    case 'date_key':
      if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) throw new Error('holiday id must be YYYY-MM-DD');
      return raw;
  }
}

export function legacyTaipeiDateTimeToIso(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'string') throw new Error('legacy date/time must be a string');
  const match = LEGACY_LOCAL_DATE_TIME.exec(value.trim());
  if (!match) throw new Error('legacy date/time format is invalid');

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4] ?? '00');
  const minute = Number(match[5] ?? '00');
  const second = Number(match[6] ?? '00');
  const probe = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  if (
    probe.getUTCFullYear() !== year
    || probe.getUTCMonth() !== month - 1
    || probe.getUTCDate() !== day
    || probe.getUTCHours() !== hour
    || probe.getUTCMinutes() !== minute
    || probe.getUTCSeconds() !== second
  ) throw new Error('legacy date/time value is invalid');

  const date = `${match[1]}-${match[2]}-${match[3]}`;
  const time = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:${String(second).padStart(2, '0')}`;
  return `${date}T${time}+08:00`;
}

export function legacyBoolean(value: unknown): boolean {
  if (value === true || value === 1 || value === '1') return true;
  if (value === false || value === 0 || value === '0') return false;
  throw new Error('legacy boolean must be 0, 1, false or true');
}

export function legacyNtsAmount(value: unknown): number {
  const parsed = typeof value === 'string' && value.trim() ? Number(value) : value;
  if (typeof parsed !== 'number' || !Number.isSafeInteger(parsed)) {
    throw new Error('legacy NTS amount must be a safe integer');
  }
  return parsed;
}

const migrationSourceTableSchema = z.enum(
  V3_AUTHORITATIVE_ENTITY_MAPPINGS.map((mapping) => mapping.sourceTable) as [V3SourceTable, ...V3SourceTable[]],
);

export const V3MigrationMetadataSchema = z.object({
  schemaVersion: z.literal(V3_MIGRATION_SCHEMA_VERSION),
  sourceVersion: z.literal(V3_MIGRATION_SOURCE_VERSION),
  sourceTable: migrationSourceTableSchema,
  sourceId: z.string().min(1).max(128),
  sourceChecksumSha256: z.string().regex(/^[a-f0-9]{64}$/),
  importedAt: z.string().datetime({ offset: true }),
}).strict();

export type V3MigrationMetadata = z.infer<typeof V3MigrationMetadataSchema>;

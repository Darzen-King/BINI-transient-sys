import { z } from 'zod';

import {
  DEFAULT_MIGRATION_PROPERTY_ID,
  V3_AUTHORITATIVE_ENTITY_MAPPINGS,
  v3DocumentId,
  type V3SourceTable,
} from './v3-mapping.js';

export const V3_BACKUP_FORMAT_VERSION = '3.5' as const;
export const V3_BACKUP_MAX_BYTES = 8 * 1024 * 1024;
export const V3_BACKUP_MAX_ROWS = 10_000;
export const V3_BACKUP_MAX_ROW_CHARACTERS = 500_000;

const excludedSourceKeys = ['users', 'report_summary'] as const;
const forbiddenSecretKeys = ['backup_state', 'backup_logs', 'backup_config'] as const;
const allowedTopLevelKeys = new Set([
  'exported_at',
  'schema_version',
  ...V3_AUTHORITATIVE_ENTITY_MAPPINGS.map((mapping) => mapping.sourceTable),
  ...excludedSourceKeys,
]);

type JsonRecord = Record<string, unknown>;

export interface V3BackupTableSummary {
  sourceTable: V3SourceTable;
  targetCollection: string;
  count: number;
}

export interface V3BackupInspection {
  exportedAt: string;
  schemaVersion: typeof V3_BACKUP_FORMAT_VERSION;
  totalAuthoritativeRows: number;
  excludedUsers: number;
  excludedReportRows: number;
  tables: V3BackupTableSummary[];
  warnings: string[];
  payload: JsonRecord;
}

export interface V3StagingRow {
  propertyId: string;
  sourceTable: V3SourceTable;
  sourceId: string;
  targetCollection: string;
  targetDocumentId: string;
  legacyJson: string;
}

export const v3BackupStageInputSchema = z.object({
  propertyId: z.string().trim().min(1).max(128).regex(/^[^/]+$/),
  fileName: z.string().trim().min(1).max(180).regex(/^[^\\/]+[.]json$/i),
  checksumSha256: z.string().regex(/^[a-f0-9]{64}$/),
  content: z.string().min(2).max(V3_BACKUP_MAX_BYTES),
}).strict();

export type V3BackupStageInput = z.infer<typeof v3BackupStageInputSchema>;

function asRecord(value: unknown, label: string): JsonRecord {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${label} 必須是 JSON object`);
  }
  return value as JsonRecord;
}

function rowsFor(payload: JsonRecord, table: string, required = false): JsonRecord[] {
  const value = payload[table];
  if (value === undefined && !required) return [];
  if (!Array.isArray(value)) throw new Error(`${table} 必須是陣列`);
  return value.map((row, index) => asRecord(row, `${table}[${index}]`));
}

function sourceIdFor(table: V3SourceTable, row: JsonRecord): string {
  const raw = table === 'holiday_cache' ? row.date : row.id;
  if ((typeof raw !== 'string' && typeof raw !== 'number') || String(raw).trim() === '') {
    throw new Error(`${table} 有資料缺少必要識別碼`);
  }
  return String(raw).trim();
}

export function inspectV3BackupText(content: string): V3BackupInspection {
  if (content.length > V3_BACKUP_MAX_BYTES) throw new Error('備份檔超過 8 MB 上限');
  let decoded: unknown;
  try {
    decoded = JSON.parse(content);
  } catch {
    throw new Error('檔案不是有效的 JSON');
  }
  const payload = asRecord(decoded, '備份檔根節點');
  if (payload.schema_version !== V3_BACKUP_FORMAT_VERSION) {
    throw new Error(`不支援的備份格式版本；目前只接受 ${V3_BACKUP_FORMAT_VERSION}`);
  }
  if (typeof payload.exported_at !== 'string' || payload.exported_at.trim().length < 10) {
    throw new Error('備份檔缺少有效 exported_at');
  }
  for (const key of forbiddenSecretKeys) {
    if (key in payload) throw new Error(`備份檔不可包含 ${key}`);
  }

  const warnings: string[] = [];
  const unknownKeys = Object.keys(payload).filter((key) => !allowedTopLevelKeys.has(key));
  if (unknownKeys.length > 0) warnings.push(`忽略未知欄位：${unknownKeys.join('、')}`);

  const tables = V3_AUTHORITATIVE_ENTITY_MAPPINGS.map((mapping) => {
    const rows = rowsFor(payload, mapping.sourceTable, mapping.sourceTable === 'rooms' || mapping.sourceTable === 'bookings');
    const ids = new Set<string>();
    for (const row of rows) {
      const sourceId = sourceIdFor(mapping.sourceTable, row);
      const documentId = v3DocumentId(mapping, sourceId);
      if (ids.has(documentId)) throw new Error(`${mapping.sourceTable} 出現重複識別碼 ${sourceId}`);
      ids.add(documentId);
      const serialized = JSON.stringify(row);
      if (serialized.length > V3_BACKUP_MAX_ROW_CHARACTERS) {
        throw new Error(`${mapping.sourceTable}/${sourceId} 單筆資料過大`);
      }
    }
    if (!(mapping.sourceTable in payload)) warnings.push(`${mapping.sourceTable} 不存在，將以 0 筆處理`);
    return { sourceTable: mapping.sourceTable, targetCollection: mapping.targetCollection, count: rows.length };
  });
  const totalAuthoritativeRows = tables.reduce((total, table) => total + table.count, 0);
  if (totalAuthoritativeRows > V3_BACKUP_MAX_ROWS) throw new Error('備份資料總筆數超過 10,000 筆上限');

  const excludedUsers = rowsFor(payload, 'users').length;
  const excludedReportRows = rowsFor(payload, 'report_summary').length;
  if (excludedUsers > 0) warnings.push(`偵測到 ${excludedUsers} 筆舊使用者；帳號與密碼不會匯入`);
  if (excludedReportRows > 0) warnings.push(`偵測到 ${excludedReportRows} 筆彙總報表；將由正式資料重新計算`);

  return {
    exportedAt: payload.exported_at.trim(),
    schemaVersion: V3_BACKUP_FORMAT_VERSION,
    totalAuthoritativeRows,
    excludedUsers,
    excludedReportRows,
    tables,
    warnings,
    payload,
  };
}

export function buildV3StagingRows(
  inspection: V3BackupInspection,
  propertyId: string = DEFAULT_MIGRATION_PROPERTY_ID,
): V3StagingRow[] {
  return V3_AUTHORITATIVE_ENTITY_MAPPINGS.flatMap((mapping) => (
    rowsFor(inspection.payload, mapping.sourceTable).map((sourceRow) => {
      const row = { ...sourceRow };
      if (mapping.sourceTable === 'rooms') delete row.next_booking;
      const sourceId = sourceIdFor(mapping.sourceTable, row);
      return {
        propertyId,
        sourceTable: mapping.sourceTable,
        sourceId,
        targetCollection: mapping.targetCollection,
        targetDocumentId: v3DocumentId(mapping, sourceId),
        legacyJson: JSON.stringify(row),
      };
    })
  ));
}

export function serializeV3BackupForStaging(inspection: V3BackupInspection): string {
  const sanitized: JsonRecord = {
    exported_at: inspection.exportedAt,
    schema_version: inspection.schemaVersion,
  };
  for (const mapping of V3_AUTHORITATIVE_ENTITY_MAPPINGS) {
    sanitized[mapping.sourceTable] = rowsFor(inspection.payload, mapping.sourceTable).map((sourceRow) => {
      const row = { ...sourceRow };
      if (mapping.sourceTable === 'rooms') delete row.next_booking;
      return row;
    });
  }
  return JSON.stringify(sanitized);
}

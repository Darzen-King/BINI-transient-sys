import { describe, expect, it } from 'vitest';

import {
  buildV3StagingRows,
  inspectV3BackupText,
  serializeV3BackupForStaging,
} from '../src/migration/v3-backup.js';

function backup(overrides: Record<string, unknown> = {}) {
  return JSON.stringify({
    exported_at: '2026-09-11 12:00',
    schema_version: '3.5',
    rooms: [{ id: '201', status: '可入住', next_booking: '2020-01-01 10:00' }],
    bookings: [{ id: 'RSV-1', room: '201', amount: 1200 }],
    active_stays: [],
    stay_logs: [],
    activity_logs: [],
    payments: [{ id: 8, amount: 1200 }],
    cashier_sessions: [],
    cost_entries: [],
    maintenance_schedules: [],
    monthly_rentals: [],
    holiday_cache: [{ id: 1, date: '2026-10-10', is_holiday: 1 }],
    properties: [{ id: 'P001', name: 'BINI' }],
    users: [{ id: 1, username: 'admin', password_hash: 'do-not-import', password_salt: 'secret' }],
    report_summary: [{ id: 1, total_revenue: 1200 }],
    ...overrides,
  });
}

describe('v3 Dropbox backup inspection', () => {
  it('reports authoritative tables while excluding legacy identity and derived reports', () => {
    const result = inspectV3BackupText(backup());

    expect(result.totalAuthoritativeRows).toBe(5);
    expect(result.excludedUsers).toBe(1);
    expect(result.excludedReportRows).toBe(1);
    expect(result.warnings).toContain('偵測到 1 筆舊使用者；帳號與密碼不會匯入');
  });

  it('creates stable staging rows and removes the stale room next_booking cache', () => {
    const inspection = inspectV3BackupText(backup({ unknown_field: 'do-not-upload' }));
    const rows = buildV3StagingRows(inspection);
    const serialized = serializeV3BackupForStaging(inspection);
    const room = rows.find((row) => row.sourceTable === 'rooms');
    const holiday = rows.find((row) => row.sourceTable === 'holiday_cache');

    expect(room).toMatchObject({ targetDocumentId: '201', propertyId: 'property-main' });
    expect(room?.legacyJson).not.toContain('next_booking');
    expect(holiday?.targetDocumentId).toBe('2026-10-10');
    expect(rows.some((row) => row.sourceTable === ('users' as never))).toBe(false);
    expect(serialized).not.toContain('password_hash');
    expect(serialized).not.toContain('password_salt');
    expect(serialized).not.toContain('report_summary');
    expect(serialized).not.toContain('next_booking');
    expect(serialized).not.toContain('unknown_field');
  });

  it('rejects unsupported versions, duplicate ids and backup configuration secrets', () => {
    expect(() => inspectV3BackupText(backup({ schema_version: '2.0' }))).toThrow('不支援');
    expect(() => inspectV3BackupText(backup({ rooms: [{ id: '201' }, { id: '201' }] }))).toThrow('重複識別碼');
    expect(() => inspectV3BackupText(backup({ backup_config: [{ dropbox_token: 'secret' }] }))).toThrow('不可包含 backup_config');
  });

  it('requires the core rooms and bookings arrays', () => {
    const parsed = JSON.parse(backup()) as Record<string, unknown>;
    delete parsed.rooms;
    expect(() => inspectV3BackupText(JSON.stringify(parsed))).toThrow('rooms 必須是陣列');
  });
});

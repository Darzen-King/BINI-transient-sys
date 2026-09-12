import { describe, expect, it } from 'vitest';

import {
  buildV3StagingRows,
  inspectV3BackupText,
  prepareV3Migration,
  transformV3StagingRow,
} from '@bini/cloud-shared';

const checksumSha256 = 'b'.repeat(64);
const importedAt = '2026-09-11T12:00:00.000Z';

function fullBackup(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    exported_at: '2026-09-11 19:30:00',
    schema_version: '3.5',
    properties: [{ id: 'P001', name: 'BINI Blooms', address: null, phone: null, is_active: 1, created_at: '2026-01-01', note: null }],
    rooms: [{ id: '201', status: '使用中', current_guest: 'Guest', checkin: '2026-09-11 15:00', checkout: '2026-09-12 03:00', next_booking: '2020-01-01 10:00', note: null, maintenance_note: null, maintenance_due: null, property_id: null }],
    bookings: [{ id: 'RSV-1', room: '201', guest: 'Guest', phone: null, checkin: '2026-09-11 15:00', checkout: '2026-09-12 03:00', plan: '12hrs', amount: 1_200, discount: 0, rate_type: 'weekday', status: '已入住', property_id: null }],
    active_stays: [{ id: 1, room: '201', guest: 'Guest', plan: '12hrs', base_rent: 1_200, discount: 0, extension_fee: 0, extra_fee: 0, total_due: 1_200, checkin_time: '2026-09-11 15:00', checkout_time: '2026-09-12 03:00', hourly_rate: 200, booking_id: 'RSV-1', created_at: '2026-09-11 15:00', original_checkout_time: '2026-09-12 03:00' }],
    stay_logs: [{ id: 2, room: '201', guest: 'Past Guest', plan: '24hrs', checkin_time: '2026-09-01 15:00', checkout_time: '2026-09-02 15:00', base_rent: 1_200, extension_fee: 200, extra_fee: 0, total_charged: 1_400, free_cancel: 0, transferred: 0, new_room: null, created_at: '2026-09-02 15:00' }],
    activity_logs: [{ id: 3, timestamp: '2026-09-11 15:00:00', user_id: 'admin', action_type: 'checkin', target_id: '201', target_type: 'room', original_value: null, new_value: '{"status":"使用中"}', description: 'check in' }],
    payments: [{ id: 4, booking_id: 'RSV-1', room_id: '201', guest: 'Guest', payment_type: 'cash', amount: 500, is_deposit: 1, is_refund: 0, payment_status: 'paid', note: null, created_at: '2026-09-11 14:30', created_by: 'admin', invoice_no: null, external_txn_id: null, accounting_exported_at: null }],
    cashier_sessions: [{ id: 5, session_date: '2026-09-11', opened_by: 'admin', closed_by: null, opened_at: '2026-09-11 08:00', closed_at: null, status: 'open', total_expected: 500, total_cash: 500, total_transfer: 0, total_card: 0, total_other: 0, total_refunds: 0, total_deposits: 500, note: null }],
    cost_entries: [{ id: 6, property_id: null, cost_date: '2026-09-11', category: 'supplies', subcategory: null, amount: 300, payment_method: 'cash', vendor: null, description: 'cleaning', note: null, is_recurring: 0, receipt_no: null, created_by: 'admin', created_at: '2026-09-11 09:00', updated_at: null }],
    maintenance_schedules: [{ id: 7, room_id: '201', title: 'Inspection', start_time: '2026-09-20 09:00', end_time: '2026-09-20 10:00', note: null, status: 'scheduled', created_by: 'admin', created_at: '2026-09-11 09:00' }],
    monthly_rentals: [{ id: 8, room_id: '201', tenant_name: 'Tenant', tenant_phone: null, start_date: '2026-08-01', end_date: '2026-09-01', deposit: 6_000, rent: 12_000, status: 'ended', deposit_refunded: 6_000, payment_type: 'cash', property_id: null, note: null, created_at: '2026-08-01 10:00', ended_at: '2026-09-01 10:00', created_by: 'admin' }],
    holiday_cache: [{ id: 9, date: '2026-10-10', description: 'Holiday', is_holiday: 1, is_manual: 0, year: 2026, source: 'api', updated_at: '2026-01-01 00:00' }],
    users: [],
    report_summary: [],
    ...overrides,
  });
}

function prepare(overrides: Record<string, unknown> = {}) {
  const inspection = inspectV3BackupText(fullBackup(overrides));
  const rows = buildV3StagingRows(inspection, 'property-main');
  return prepareV3Migration(rows, { importedAt, checksumSha256 });
}

describe('v3 migration transformation and reconciliation', () => {
  it('prepares all 12 authoritative tables into property-scoped typed documents', () => {
    const result = prepare();

    expect(result.report.valid).toBe(true);
    expect(result.report.sourceRowCount).toBe(12);
    expect(result.report.preparedRowCount).toBe(12);
    expect(result.report.tables.every((table) => table.sourceCount === table.preparedCount)).toBe(true);
    expect(result.documents.find((document) => document.sourceTable === 'properties')).toMatchObject({
      targetDocumentId: 'property-main',
      targetPath: 'properties/property-main',
    });
    expect(result.documents.find((document) => document.sourceTable === 'active_stays')).toMatchObject({
      targetCollection: 'stays',
      targetPath: 'properties/property-main/stays/v3-active_stays-1',
    });
    expect(result.documents.every((document) => document.data.propertyId === 'property-main')).toBe(true);
  });

  it('converts dates, booleans and NTS amounts while dropping legacy-only fields', () => {
    const result = prepare();
    const room = result.documents.find((document) => document.sourceTable === 'rooms');
    const booking = result.documents.find((document) => document.sourceTable === 'bookings');
    const payment = result.documents.find((document) => document.sourceTable === 'payments');

    expect(room?.data).not.toHaveProperty('next_booking');
    expect(room?.data.checkInAt).toBe('2026-09-11T15:00:00+08:00');
    expect(booking?.data.amountNts).toBe(1_200);
    expect(payment?.data.deposit).toBe(true);
    expect(result.report.amountTotalsNts.bookings?.amountNts).toBe(1_200);
    expect(result.report.amountTotalsNts.payments?.amountNts).toBe(500);
  });

  it('blocks invalid money and reports the exact source row', () => {
    const result = prepare({
      payments: [{ id: 4, booking_id: 'RSV-1', room_id: '201', guest: 'Guest', payment_type: 'cash', amount: 12.5, is_deposit: 0, is_refund: 0, payment_status: 'paid', note: null, created_at: '2026-09-11 14:30', created_by: 'admin', invoice_no: null, external_txn_id: null, accounting_exported_at: null }],
    });

    expect(result.report.valid).toBe(false);
    expect(result.report.errors).toContainEqual(expect.objectContaining({
      code: 'row_transform_failed',
      sourceTable: 'payments',
      sourceId: '4',
    }));
  });

  it('accepts v3 renewal history, zero-duration stay logs, and decimal display hourly rates', () => {
    const backup = JSON.parse(fullBackup()) as {
      active_stays: Array<Record<string, unknown>>;
      monthly_rentals: Array<Record<string, unknown>>;
      stay_logs: Array<Record<string, unknown>>;
    };
    backup.active_stays[0].hourly_rate = 83.33333333333333;
    backup.monthly_rentals[0].status = 'renewed';
    backup.stay_logs[0].checkout_time = backup.stay_logs[0].checkin_time;

    const inspection = inspectV3BackupText(JSON.stringify(backup));
    const result = prepareV3Migration(buildV3StagingRows(inspection, 'property-main'), { importedAt, checksumSha256 });

    expect(result.report.valid).toBe(true);
    expect(result.documents.find((document) => document.sourceTable === 'monthly_rentals')?.data.status).toBe('renewed');
    expect(result.documents.find((document) => document.sourceTable === 'active_stays')?.data.hourlyRateNts).toBe(83);
  });

  it('normalizes v3 free-cancel logs recorded before their planned check-in', () => {
    const backup = JSON.parse(fullBackup()) as { stay_logs: Array<Record<string, unknown>> };
    backup.stay_logs[0] = {
      ...backup.stay_logs[0],
      checkin_time: '2026-09-02 15:00',
      checkout_time: '2026-09-02 14:42',
      created_at: '2026-09-02 14:42',
      total_charged: 0,
      free_cancel: 1,
    };

    const inspection = inspectV3BackupText(JSON.stringify(backup));
    const result = prepareV3Migration(buildV3StagingRows(inspection, 'property-main'), { importedAt, checksumSha256 });
    const stayLog = result.documents.find((document) => document.sourceTable === 'stay_logs');

    expect(result.report.valid).toBe(true);
    expect(stayLog?.data).toMatchObject({
      checkInAt: '2026-09-02T14:42:00+08:00',
      checkOutAt: '2026-09-02T14:42:00+08:00',
      scheduledCheckInAt: '2026-09-02T15:00:00+08:00',
      freeCancel: true,
    });
  });

  it('blocks orphan room and booking references', () => {
    const result = prepare({
      payments: [{ id: 4, booking_id: 'MISSING', room_id: '999', guest: 'Guest', payment_type: 'cash', amount: 500, is_deposit: 0, is_refund: 0, payment_status: 'paid', note: null, created_at: '2026-09-11 14:30', created_by: 'admin', invoice_no: null, external_txn_id: null, accounting_exported_at: null }],
    });

    expect(result.report.valid).toBe(false);
    expect(result.report.errors.map((error) => error.code)).toEqual(expect.arrayContaining([
      'orphan_room_reference',
      'orphan_booking_reference',
    ]));
  });

  it('rejects a staging row whose source identity was changed', () => {
    const inspection = inspectV3BackupText(fullBackup());
    const row = buildV3StagingRows(inspection, 'property-main').find((candidate) => candidate.sourceTable === 'rooms');
    if (!row) throw new Error('fixture room missing');

    expect(() => transformV3StagingRow({ ...row, sourceId: '999' }, importedAt, checksumSha256)).toThrow('source id');
  });

  it('blocks duplicate active stays for one room', () => {
    const activeStay = JSON.parse(fullBackup()) as { active_stays: Record<string, unknown>[] };
    const duplicate = { ...activeStay.active_stays[0], id: 99 };
    const result = prepare({ active_stays: [...activeStay.active_stays, duplicate] });

    expect(result.report.valid).toBe(false);
    expect(result.report.errors.map((error) => error.code)).toContain('duplicate_active_stay');
  });
});

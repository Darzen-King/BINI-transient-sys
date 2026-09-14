import { describe, expect, it, vi } from 'vitest';

import { createDropboxClient, dropboxArg, expiredDailyFiles } from '../src/backup/dropbox.js';
import { buildV3BackupPayload, type V3ExportSource } from '../src/backup/v3-export.js';

/** Column lists of the v3 SQLite tables (from `pragma table_info` on the live v3 3.9.14 database). */
const V3_COLUMNS: Record<string, string[]> = {
  rooms: ['id', 'status', 'current_guest', 'checkin', 'checkout', 'next_booking', 'note', 'maintenance_note', 'maintenance_due', 'property_id'],
  bookings: ['id', 'room', 'guest', 'phone', 'checkin', 'checkout', 'plan', 'amount', 'rate_type', 'status', 'property_id', 'discount'],
  active_stays: ['id', 'room', 'guest', 'plan', 'base_rent', 'extension_fee', 'extra_fee', 'total_due', 'checkin_time', 'checkout_time', 'hourly_rate', 'original_checkout_time', 'discount', 'booking_id', 'created_at'],
  stay_logs: ['id', 'room', 'guest', 'plan', 'checkin_time', 'checkout_time', 'base_rent', 'extension_fee', 'extra_fee', 'total_charged', 'free_cancel', 'transferred', 'new_room', 'created_at'],
  payments: ['id', 'booking_id', 'room_id', 'guest', 'payment_type', 'amount', 'is_deposit', 'is_refund', 'payment_status', 'note', 'created_at', 'created_by', 'invoice_no', 'external_txn_id', 'accounting_exported_at'],
  cashier_sessions: ['id', 'session_date', 'opened_by', 'closed_by', 'opened_at', 'closed_at', 'status', 'total_expected', 'total_cash', 'total_transfer', 'total_card', 'total_other', 'total_refunds', 'total_deposits', 'note'],
  cost_entries: ['id', 'property_id', 'cost_date', 'category', 'subcategory', 'amount', 'payment_method', 'vendor', 'description', 'note', 'is_recurring', 'receipt_no', 'created_by', 'created_at', 'updated_at'],
  monthly_rentals: ['id', 'room_id', 'tenant_name', 'tenant_phone', 'start_date', 'end_date', 'deposit', 'rent', 'status', 'deposit_refunded', 'payment_type', 'property_id', 'note', 'created_at', 'ended_at', 'created_by'],
  holiday_cache: ['id', 'date', 'description', 'is_holiday', 'is_manual', 'year', 'source', 'updated_at'],
  properties: ['id', 'name', 'address', 'phone', 'is_active', 'created_at', 'note'],
  maintenance_schedules: ['id', 'room_id', 'title', 'start_time', 'end_time', 'note', 'status', 'created_by', 'created_at'],
  activity_logs: ['id', 'timestamp', 'user_id', 'action_type', 'target_id', 'target_type', 'original_value', 'new_value', 'description'],
};

const source: V3ExportSource = {
  propertyId: 'property-main',
  property: { legacyV3Import: { legacyPropertyId: 'P001', name: 'BINI Blooms 總館', active: true, createdAt: '2026-05-10T14:02:00+08:00' } },
  rooms: [{ id: '202', data: { roomId: '202', status: '使用中', guestName: 'joshua', checkInAt: '2026-09-05T08:00:00.000Z', checkOutAt: '2026-09-13T16:00:00+08:00', note: null } }],
  bookings: [{ id: 'RSV-1', data: { bookingId: 'RSV-1', roomId: '203', guestName: 'Chris', phone: null, checkInAt: '2026-09-14T13:00:00+08:00', checkOutAt: '2026-09-15T13:00:00+08:00', plan: '24hrs', amountNts: 1_000, discountNts: 0, rateType: '非假日', status: '已預約' } }],
  stays: [{ id: 'STY-1', data: { roomId: '202', guestName: 'joshua', plan: '24hrs', baseRentNts: 1_200, extensionFeeNts: 200, extraFeeNts: 0, totalDueNts: 1_400, checkInAt: '2026-09-05T16:00:00+08:00', checkOutAt: '2026-09-13T17:00:00+08:00', originalCheckOutAt: '2026-09-13T16:00:00+08:00', hourlyRateNts: 50, bookingId: null, createdAt: new Date('2026-09-05T08:00:00.000Z') } }],
  stayLogs: [{ id: 'STL-1', data: { roomId: '203', guestName: 'eco', plan: '24hrs', checkInAt: '2026-09-06T20:00:00+08:00', scheduledCheckInAt: '2026-09-06T19:00:00+08:00', checkOutAt: '2026-09-06T20:00:00+08:00', baseRentNts: 0, extensionFeeNts: 0, extraFeeNts: 0, totalChargedNts: 0, freeCancel: true, transferred: false, newRoomId: null, createdAt: '2026-09-06T12:10:00.000Z' } }],
  payments: [
    { id: 'P-ok', data: { roomId: '202', guestName: 'joshua', paymentType: 'cash', amountNts: 1_000, deposit: true, refund: false, status: 'paid', note: '押金', createdAt: '2026-09-05T08:05:00.000Z', createdByUid: 'uid-1' } },
    { id: 'P-void', data: { roomId: '202', guestName: 'joshua', paymentType: 'cash', amountNts: 999, deposit: false, refund: false, status: 'voided', createdAt: '2026-09-05T09:00:00.000Z' } },
  ],
  cashierSessions: [{ id: '2026-09-13', data: { sessionDate: '2026-09-13', status: 'closed', closedAt: '2026-09-13T15:00:00.000Z', closedByUid: 'uid-1', totalExpectedNts: 1_000, totalCashNts: 1_000 } }],
  costEntries: [
    { id: 'C-1', data: { costDate: '2026-09-13', category: 'utilities', amountNts: 500, paymentMethod: 'cash', recurring: true, status: 'active', createdAt: '2026-09-13T01:00:00.000Z' } },
    { id: 'C-2', data: { costDate: '2026-09-13', category: 'misc', amountNts: 1, paymentMethod: 'cash', recurring: false, status: 'archived' } },
  ],
  monthlyRentals: [{ id: 'M-1', data: { roomId: '206', tenantName: 'Edong', startDate: '2026-09-01', endDate: '2026-10-01', depositNts: 16_000, rentNts: 16_000, status: 'active', depositRefundedNts: 0, createdAt: '2026-09-01T02:00:00.000Z', createdByLegacyId: 'admin' } }],
  holidays: [{ id: '2026-10-10', data: { date: '2026-10-10', year: 2026, holiday: true, manual: false, source: 'api', description: '國慶日' } }],
  maintenanceSchedules: [{ id: 'MNT-1', data: { roomId: '205', title: '冷氣', startAt: '2026-09-14T02:00:00.000Z', endAt: '2026-09-14T06:00:00.000Z', status: 'scheduled', createdByUid: 'uid-1' } }],
  auditLogs: [
    { id: 'a-v3', data: { source: 'v3-migration', createdAt: '2026-05-16T09:20:29+08:00', actorLegacyId: 'admin', action: 'checkin', targetId: '201', targetType: 'room', originalValue: '{"status":"可入住"}', newValue: '{"status":"使用中"}', description: 'Check-in' } },
    { id: 'a-v4', data: { createdAt: new Date('2026-09-14T01:00:00.000Z'), actorUid: 'uid-1', action: 'payment.void', targetId: 'P-void', targetType: 'payment', details: { reason: '重複' } } },
  ],
};

describe('cloud → v3 backup payload', () => {
  const payload = buildV3BackupPayload(source, new Date('2026-09-14T15:05:00.000Z'));

  it('uses exactly the v3 table columns, so v3 restore never drops a row', () => {
    for (const [table, columns] of Object.entries(V3_COLUMNS)) {
      const rows = payload[table as keyof typeof payload] as Array<Record<string, unknown>>;
      expect(rows.length, table).toBeGreaterThan(0);
      for (const row of rows) expect(Object.keys(row).sort(), table).toEqual([...columns].sort());
    }
    expect(payload).not.toHaveProperty('users');
    expect(payload).not.toHaveProperty('report_summary');
    expect(payload.schema_version).toBe('3.5');
    expect(payload.exported_at).toBe('2026-09-14 23:05');
  });

  it('writes Taipei `YYYY-MM-DD HH:MM` datetimes and v3 0/1 flags', () => {
    expect(payload.rooms[0]).toMatchObject({ id: '202', checkin: '2026-09-05 16:00', checkout: '2026-09-13 16:00' });
    expect(payload.active_stays[0]).toMatchObject({ checkin_time: '2026-09-05 16:00', checkout_time: '2026-09-13 17:00', original_checkout_time: '2026-09-13 16:00', created_at: '2026-09-05 16:00', total_due: 1_400 });
    expect(payload.stay_logs[0]).toMatchObject({ checkin_time: '2026-09-06 19:00', free_cancel: 1, transferred: 0, created_at: '2026-09-06 20:10' });
    expect(payload.holiday_cache[0]).toMatchObject({ date: '2026-10-10', is_holiday: 1, is_manual: 0, year: 2026 });
    expect(payload.activity_logs.map((row) => row.timestamp)).toEqual(['2026-05-16 09:20:29', '2026-09-14 09:00:00']);
  });

  it('leaves out voided payments and archived costs, and keeps the v3 property id', () => {
    expect(payload.payments).toEqual([expect.objectContaining({ amount: 1_000, is_deposit: 1, payment_status: 'paid', created_by: 'uid-1', created_at: '2026-09-05 16:05' })]);
    expect(payload.cost_entries).toEqual([expect.objectContaining({ category: 'utilities', is_recurring: 1, property_id: 'P001' })]);
    expect(payload.properties).toEqual([expect.objectContaining({ id: 'P001', name: 'BINI Blooms 總館', is_active: 1 })]);
  });

  it('keeps migrated v3 audit values and serialises cloud audit details', () => {
    expect(payload.activity_logs[0]).toMatchObject({ user_id: 'admin', action_type: 'checkin', original_value: '{"status":"可入住"}', new_value: '{"status":"使用中"}' });
    expect(payload.activity_logs[1]).toMatchObject({ user_id: 'uid-1', action_type: 'payment.void', original_value: null, new_value: '{"reason":"重複"}' });
  });
});

describe('Dropbox client', () => {
  const ok = (body: unknown) => ({ ok: true, status: 200, text: async () => JSON.stringify(body) });

  it('refreshes the access token once, then uploads with an ASCII-safe overwrite argument', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(ok({ access_token: 'short-lived' }))
      .mockResolvedValue(ok({}));
    const client = createDropboxClient({ appKey: 'key', appSecret: 'secret', refreshToken: 'refresh' }, fetchImpl);
    await client.upload('/BiniBloomsData/cloud_export/bini_blooms_backup.json', '{"a":"館"}');
    await client.upload('/BiniBloomsData/cloud_export/daily/x.json', '{}');
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(fetchImpl.mock.calls[0]![1].body).toBe('grant_type=refresh_token&refresh_token=refresh&client_id=key&client_secret=secret');
    const upload = fetchImpl.mock.calls[1]![1];
    expect(upload.headers.Authorization).toBe('Bearer short-lived');
    expect(JSON.parse(upload.headers['Dropbox-API-Arg'])).toEqual({ path: '/BiniBloomsData/cloud_export/bini_blooms_backup.json', mode: 'overwrite', autorename: false, mute: true });
    expect(new TextDecoder().decode(upload.body)).toBe('{"a":"館"}');
    expect(dropboxArg({ path: '/館' })).toBe('{"path":"/\\u9928"}');
  });

  it('treats a missing daily folder as empty and reports Dropbox errors without secrets', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(ok({ access_token: 't' }))
      .mockResolvedValueOnce({ ok: false, status: 409, text: async () => JSON.stringify({ error_summary: 'path/not_found/..' }) })
      .mockResolvedValueOnce({ ok: false, status: 400, text: async () => JSON.stringify({ error_summary: 'invalid_grant' }) });
    const client = createDropboxClient({ appKey: 'k', appSecret: 's', refreshToken: 'r' }, fetchImpl);
    expect(await client.listFileNames('/BiniBloomsData/cloud_export/daily')).toEqual([]);
    await expect(client.upload('/x.json', '{}')).rejects.toThrow('Dropbox upload /x.json failed (HTTP 400) invalid_grant');
  });

  it('keeps 30 Taipei days of dated copies', () => {
    const names = ['bini_blooms_backup_2026-08-15.json', 'bini_blooms_backup_2026-08-16.json', 'bini_blooms_backup_2026-09-14.json', 'notes.txt'];
    expect(expiredDailyFiles(names, '2026-09-14', 30)).toEqual(['bini_blooms_backup_2026-08-15.json']);
  });
});

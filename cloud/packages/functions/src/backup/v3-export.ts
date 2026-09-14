/**
 * Cloud → v3 backup payload (the reverse of the v3 promotion transform), so the desktop v3 app can restore
 * the cloud data with its own "還原" button if Firebase is unavailable.
 *
 * Column names follow the v3 SQLite tables exactly: v3 `_import_data` builds `Model(**row)` and silently drops
 * any row with an unknown column. v3 restores by deleting each table and re-inserting, so tables it restores
 * unconditionally (rooms, bookings, properties) are always present, while `users` is omitted so v3 keeps its
 * own staff accounts and passwords.
 */

type Data = Record<string, unknown>;
export interface SourceDocument { id: string; data: Data; }

export interface V3ExportSource {
  propertyId: string;
  property: Data;
  rooms: readonly SourceDocument[];
  bookings: readonly SourceDocument[];
  stays: readonly SourceDocument[];
  stayLogs: readonly SourceDocument[];
  payments: readonly SourceDocument[];
  cashierSessions: readonly SourceDocument[];
  costEntries: readonly SourceDocument[];
  monthlyRentals: readonly SourceDocument[];
  holidays: readonly SourceDocument[];
  maintenanceSchedules: readonly SourceDocument[];
  auditLogs: readonly SourceDocument[];
}

export interface V3BackupPayload {
  exported_at: string;
  schema_version: '3.5';
  source: 'bini-cloud-v4';
  rooms: Data[]; bookings: Data[]; active_stays: Data[]; stay_logs: Data[];
  payments: Data[]; cashier_sessions: Data[]; cost_entries: Data[]; monthly_rentals: Data[];
  holiday_cache: Data[]; properties: Data[]; maintenance_schedules: Data[]; activity_logs: Data[];
}

const TAIPEI = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });

function toDate(value: unknown): Date | null {
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value : null;
  if (value && typeof value === 'object' && typeof (value as { toDate?: unknown }).toDate === 'function') return (value as { toDate: () => Date }).toDate();
  if (typeof value === 'string' && value.trim()) {
    // Date-only values (YYYY-MM-DD) are already Taipei calendar days.
    if (/^\d{4}-\d{2}-\d{2}$/u.test(value)) return new Date(`${value}T00:00:00+08:00`);
    const parsed = new Date(value);
    return Number.isFinite(parsed.getTime()) ? parsed : null;
  }
  return null;
}

function taipeiParts(value: unknown): Record<string, string> | null {
  const date = toDate(value);
  return date ? Object.fromEntries(TAIPEI.formatToParts(date).map((part) => [part.type, part.value])) : null;
}

/** v3 datetime text: `YYYY-MM-DD HH:MM` in Asia/Taipei. */
export function v3DateTime(value: unknown): string | null {
  const p = taipeiParts(value);
  return p ? `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}` : null;
}
/** v3 activity-log timestamp: `YYYY-MM-DD HH:MM:SS`. */
function v3Timestamp(value: unknown): string | null {
  const p = taipeiParts(value);
  return p ? `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}:${p.second}` : null;
}
function v3Date(value: unknown): string | null {
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/u.test(value)) return value;
  const p = taipeiParts(value);
  return p ? `${p.year}-${p.month}-${p.day}` : null;
}

const str = (value: unknown): string | null => (typeof value === 'string' && value !== '' ? value : null);
const num = (value: unknown): number => (typeof value === 'number' && Number.isFinite(value) ? value : 0);
const flag = (value: unknown): 0 | 1 => (value === true || value === 1 ? 1 : 0);
const legacyOrUid = (data: Data, legacy: string, uid: string): string | null => str(data[legacy]) ?? str(data[uid]);
/** v3 stores integer autoincrement ids; the value is discarded on restore (`pop_id=True`) but kept stable for readers. */
const sequence = <T>(rows: readonly T[], map: (row: T, id: number) => Data): Data[] => rows.map((row, index) => map(row, index + 1));
const byTime = (key: string) => (left: SourceDocument, right: SourceDocument) => (toDate(left.data[key])?.getTime() ?? 0) - (toDate(right.data[key])?.getTime() ?? 0);

export function buildV3BackupPayload(source: V3ExportSource, now = new Date()): V3BackupPayload {
  const legacy = (source.property.legacyV3Import ?? {}) as Data;
  const propertyId = str(legacy.legacyPropertyId) ?? source.propertyId;

  return {
    exported_at: v3DateTime(now) ?? '',
    schema_version: '3.5',
    source: 'bini-cloud-v4',
    rooms: source.rooms.map(({ id, data }) => ({
      id: str(data.roomId) ?? id,
      status: str(data.status) ?? '可入住',
      current_guest: str(data.guestName),
      checkin: v3DateTime(data.checkInAt),
      checkout: v3DateTime(data.checkOutAt),
      next_booking: null,
      note: str(data.note),
      maintenance_note: str(data.maintenanceNote),
      maintenance_due: v3Date(data.maintenanceDueDate),
      property_id: null,
    })),
    bookings: source.bookings.map(({ id, data }) => ({
      id: str(data.bookingId) ?? id,
      room: str(data.roomId),
      guest: str(data.guestName),
      phone: str(data.phone),
      checkin: v3DateTime(data.checkInAt),
      checkout: v3DateTime(data.checkOutAt),
      plan: str(data.plan),
      amount: num(data.amountNts),
      rate_type: str(data.rateType),
      status: str(data.status),
      property_id: null,
      discount: num(data.discountNts),
    })),
    active_stays: sequence([...source.stays].sort(byTime('checkInAt')), ({ data }, id) => ({
      id,
      room: str(data.roomId),
      guest: str(data.guestName),
      plan: str(data.plan),
      base_rent: num(data.baseRentNts),
      extension_fee: num(data.extensionFeeNts),
      extra_fee: num(data.extraFeeNts),
      total_due: num(data.totalDueNts),
      checkin_time: v3DateTime(data.checkInAt),
      checkout_time: v3DateTime(data.checkOutAt),
      hourly_rate: num(data.hourlyRateNts),
      original_checkout_time: v3DateTime(data.originalCheckOutAt),
      discount: num(data.discountNts),
      booking_id: str(data.bookingId),
      created_at: v3DateTime(data.createdAt),
    })),
    stay_logs: sequence([...source.stayLogs].sort(byTime('createdAt')), ({ data }, id) => ({
      id,
      room: str(data.roomId),
      guest: str(data.guestName),
      plan: str(data.plan),
      // Promotion moved a cancelled-before-check-in time aside; restore the original v3 check-in.
      checkin_time: v3DateTime(data.scheduledCheckInAt ?? data.checkInAt),
      checkout_time: v3DateTime(data.checkOutAt),
      base_rent: num(data.baseRentNts),
      extension_fee: num(data.extensionFeeNts),
      extra_fee: num(data.extraFeeNts),
      total_charged: num(data.totalChargedNts),
      free_cancel: flag(data.freeCancel),
      transferred: flag(data.transferred),
      new_room: str(data.newRoomId),
      created_at: v3DateTime(data.createdAt),
    })),
    // v3 has no "voided" state; exporting voided rows would inflate v3 totals. They remain in the cloud audit trail.
    payments: sequence(source.payments.filter(({ data }) => data.status !== 'voided').sort(byTime('createdAt')), ({ data }, id) => ({
      id,
      booking_id: str(data.bookingId),
      room_id: str(data.roomId),
      guest: str(data.guestName),
      payment_type: str(data.paymentType) ?? 'other',
      amount: num(data.amountNts),
      is_deposit: flag(data.deposit),
      is_refund: flag(data.refund),
      payment_status: str(data.status) ?? 'paid',
      note: str(data.note),
      created_at: v3DateTime(data.createdAt),
      created_by: legacyOrUid(data, 'createdByLegacyId', 'createdByUid'),
      invoice_no: str(data.invoiceNo),
      external_txn_id: str(data.externalTransactionId),
      accounting_exported_at: v3DateTime(data.accountingExportedAt),
    })),
    cashier_sessions: sequence([...source.cashierSessions].sort((a, b) => String(a.data.sessionDate ?? a.id).localeCompare(String(b.data.sessionDate ?? b.id))), ({ id: docId, data }, id) => ({
      id,
      session_date: v3Date(data.sessionDate) ?? docId,
      opened_by: legacyOrUid(data, 'openedByLegacyId', 'openedByUid'),
      closed_by: legacyOrUid(data, 'closedByLegacyId', 'closedByUid'),
      opened_at: v3DateTime(data.openedAt),
      closed_at: v3DateTime(data.closedAt),
      status: str(data.status) ?? 'open',
      total_expected: num(data.totalExpectedNts),
      total_cash: num(data.totalCashNts),
      total_transfer: num(data.totalTransferNts),
      total_card: num(data.totalCardNts),
      total_other: num(data.totalOtherNts),
      total_refunds: num(data.totalRefundsNts),
      total_deposits: num(data.totalDepositsNts),
      note: str(data.note),
    })),
    // Archived costs replace v3's hard delete, so they are not part of the v3 ledger.
    cost_entries: sequence(source.costEntries.filter(({ data }) => data.status !== 'archived').sort(byTime('createdAt')), ({ data }, id) => ({
      id,
      property_id: propertyId,
      cost_date: v3Date(data.costDate),
      category: str(data.category),
      subcategory: str(data.subcategory),
      amount: num(data.amountNts),
      payment_method: str(data.paymentMethod),
      vendor: str(data.vendor),
      description: str(data.description),
      note: str(data.note),
      is_recurring: flag(data.recurring),
      receipt_no: str(data.receiptNo),
      created_by: legacyOrUid(data, 'createdByLegacyId', 'createdByUid'),
      created_at: v3DateTime(data.createdAt),
      updated_at: v3DateTime(data.updatedAt),
    })),
    monthly_rentals: sequence([...source.monthlyRentals].sort(byTime('createdAt')), ({ data }, id) => ({
      id,
      room_id: str(data.roomId),
      tenant_name: str(data.tenantName),
      tenant_phone: str(data.tenantPhone),
      start_date: v3Date(data.startDate),
      end_date: v3Date(data.endDate),
      deposit: num(data.depositNts),
      rent: num(data.rentNts),
      status: str(data.status) ?? 'active',
      deposit_refunded: num(data.depositRefundedNts),
      payment_type: str(data.paymentType),
      property_id: null,
      note: str(data.note),
      created_at: v3DateTime(data.createdAt),
      ended_at: v3DateTime(data.endedAt),
      created_by: legacyOrUid(data, 'createdByLegacyId', 'createdByUid'),
    })),
    holiday_cache: sequence([...source.holidays].sort((a, b) => String(a.data.date ?? a.id).localeCompare(String(b.data.date ?? b.id))), ({ id: docId, data }, id) => ({
      id,
      date: v3Date(data.date) ?? docId,
      description: str(data.description),
      is_holiday: flag(data.holiday),
      is_manual: flag(data.manual),
      year: typeof data.year === 'number' ? data.year : Number(String(data.date ?? docId).slice(0, 4)),
      source: str(data.source),
      updated_at: v3DateTime(data.updatedAt),
    })),
    properties: [{
      id: propertyId,
      name: str(source.property.name) ?? str(legacy.name) ?? propertyId,
      address: str(source.property.address) ?? str(legacy.address),
      phone: str(source.property.phone) ?? str(legacy.phone),
      is_active: (source.property.active ?? legacy.active) === false ? 0 : 1,
      created_at: v3DateTime(legacy.createdAt ?? source.property.createdAt),
      note: str(source.property.note) ?? str(legacy.note),
    }],
    maintenance_schedules: sequence([...source.maintenanceSchedules].sort(byTime('startAt')), ({ data }, id) => ({
      id,
      room_id: str(data.roomId),
      title: str(data.title),
      start_time: v3DateTime(data.startAt),
      end_time: v3DateTime(data.endAt),
      note: str(data.note),
      status: str(data.status) ?? 'scheduled',
      created_by: legacyOrUid(data, 'createdByLegacyId', 'createdByUid'),
      created_at: v3DateTime(data.createdAt),
    })),
    activity_logs: sequence([...source.auditLogs].sort(byTime('createdAt')), ({ data }, id) => {
      const migrated = data.source === 'v3-migration';
      const text = (value: unknown) => (value === undefined || value === null ? null : typeof value === 'string' ? value : JSON.stringify(value));
      return {
        id,
        timestamp: v3Timestamp(data.createdAt),
        user_id: str(data.actorLegacyId) ?? str(data.actorUid) ?? 'system',
        action_type: str(data.action) ?? 'unknown',
        target_id: str(data.targetId) ?? str(data.targetUid),
        target_type: str(data.targetType),
        original_value: migrated ? text(data.originalValue) : null,
        new_value: migrated ? text(data.newValue) : text(data.details),
        description: str(data.description),
      };
    }),
  };
}

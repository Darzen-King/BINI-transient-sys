import {
  BOOKING_STATUSES,
  CLOUD_ROOM_STATUSES,
  bookingUpdateInputSchema,
  bookingUpdateResultSchema,
  findBookingAvailabilityConflict,
  quoteBooking,
  type BookingAvailabilityCandidate,
  type BookingHolidayCalendar,
  type BookingUpdateInput,
  type BookingUpdateResult,
} from '@bini/cloud-shared';
import { createHash } from 'node:crypto';
import { getFirestore, type QueryDocumentSnapshot } from 'firebase-admin/firestore';
import { HttpsError, onCall } from 'firebase-functions/v2/https';

import { requirePropertyPage } from '../admin/staff-admin.js';

const callableOptions = {
  region: 'asia-east1',
  maxInstances: 10,
  timeoutSeconds: 60,
  memory: '512MiB',
} as const;

type FirestoreRecord = Record<string, unknown>;

function requiredText(data: FirestoreRecord, field: string, label: string): string {
  const value = data[field];
  if (typeof value !== 'string' || value.trim() === '') {
    throw new HttpsError('data-loss', `${label} 缺少有效 ${field}。`);
  }
  return value;
}

function optionalText(data: FirestoreRecord, field: string, label: string): string | null {
  const value = data[field];
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'string') throw new HttpsError('data-loss', `${label} 的 ${field} 格式不正確。`);
  return value;
}

function requiredVersion(data: FirestoreRecord, label: string): number {
  const value = data.version;
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new HttpsError('data-loss', `${label} 缺少有效 version。`);
  }
  return value;
}

function fingerprint(input: BookingUpdateInput): string {
  return createHash('sha256').update(JSON.stringify({
    operationType: 'booking.update',
    propertyId: input.propertyId,
    bookingId: input.bookingId,
    roomId: input.roomId,
    guestName: input.guestName,
    phone: input.phone ?? null,
    checkInAt: input.checkInAt,
    plan: input.plan,
    days: input.days,
    discountNts: input.discountNts,
    pricingMode: input.pricingMode,
    manualAmountNts: input.manualAmountNts ?? null,
    operationId: input.operationId,
  })).digest('hex');
}

function calendarFromDocuments(documents: readonly QueryDocumentSnapshot[]): BookingHolidayCalendar {
  const days = new Map<string, boolean>();
  const countByYear = new Map<number, number>();
  for (const document of documents) {
    const data = document.data();
    const date = data.date;
    const holiday = data.holiday;
    const year = data.year;
    if (
      typeof date !== 'string'
      || !/^\d{4}-\d{2}-\d{2}$/.test(date)
      || typeof holiday !== 'boolean'
      || !Number.isSafeInteger(year)
      || String(year) !== date.slice(0, 4)
    ) throw new HttpsError('data-loss', `holidays/${document.id} 資料格式不正確。`);
    if (days.has(date)) throw new HttpsError('data-loss', `假日資料重複：${date}。`);
    days.set(date, holiday);
    countByYear.set(year, (countByYear.get(year) ?? 0) + 1);
  }
  return {
    days,
    coveredYears: new Set([...countByYear].filter(([, count]) => count > 3).map(([year]) => year)),
  };
}

function bookingCandidate(document: QueryDocumentSnapshot): BookingAvailabilityCandidate | null {
  const data = document.data();
  const label = `bookings/${document.id}`;
  const status = requiredText(data, 'status', label);
  if (!BOOKING_STATUSES.includes(status as (typeof BOOKING_STATUSES)[number])) {
    throw new HttpsError('data-loss', `${label} 的 status 不受支援。`);
  }
  if (status !== '已預約') return null;
  const bookingId = requiredText(data, 'bookingId', label);
  if (bookingId !== document.id) throw new HttpsError('data-loss', `${label} 的識別碼不一致。`);
  return {
    id: bookingId,
    source: 'booking',
    roomId: requiredText(data, 'roomId', label),
    startAt: requiredText(data, 'checkInAt', label),
    endAt: requiredText(data, 'checkOutAt', label),
    status,
    guestName: optionalText(data, 'guestName', label),
  };
}

function stayCandidate(document: QueryDocumentSnapshot): BookingAvailabilityCandidate | null {
  const data = document.data();
  const label = `stays/${document.id}`;
  const startAt = optionalText(data, 'checkInAt', label);
  const endAt = optionalText(data, 'checkOutAt', label);
  if (!startAt || !endAt) return null;
  return {
    id: `STAY-${document.id}`,
    source: 'stay',
    roomId: requiredText(data, 'roomId', label),
    startAt,
    endAt,
    status: '使用中',
    guestName: optionalText(data, 'guestName', label),
  };
}

function maintenanceCandidate(document: QueryDocumentSnapshot): BookingAvailabilityCandidate | null {
  const data = document.data();
  const label = `maintenanceSchedules/${document.id}`;
  const status = requiredText(data, 'status', label);
  if (!['scheduled', 'in_progress', 'done'].includes(status)) {
    throw new HttpsError('data-loss', `${label} 的 status 不受支援。`);
  }
  if (status === 'done') return null;
  return {
    id: `MAINT-${document.id}`,
    source: 'maintenance',
    roomId: requiredText(data, 'roomId', label),
    startAt: requiredText(data, 'startAt', label),
    endAt: requiredText(data, 'endAt', label),
    status,
    guestName: null,
  };
}

function replayResult(operation: FirestoreRecord, actorUid: string, requestFingerprint: string): BookingUpdateResult {
  if (
    operation.actorUid !== actorUid
    || operation.operationType !== 'booking.update'
    || operation.requestFingerprint !== requestFingerprint
  ) throw new HttpsError('already-exists', '此操作識別碼已由不同請求使用。');
  const parsed = bookingUpdateResultSchema.safeParse(operation.result);
  if (!parsed.success || parsed.data.status !== 'updated') {
    throw new HttpsError('data-loss', '已完成操作缺少有效結果。');
  }
  return { ...parsed.data, status: 'replayed' };
}

function conflictMessage(conflict: ReturnType<typeof findBookingAvailabilityConflict>): string {
  if (!conflict) return '';
  if (conflict.source === 'maintenance') return `房間在此時段已有維修排程（${conflict.id}）。`;
  return `房間在此時段已與 ${conflict.id}（${conflict.guestName ?? '未知住客'}）衝突。`;
}

/** v3 edit semantics with server-authoritative quote and self-excluded conflicts. */
export const bookingUpdate = onCall(callableOptions, async (request): Promise<BookingUpdateResult> => {
  const parsed = bookingUpdateInputSchema.safeParse(request.data);
  if (!parsed.success) throw new HttpsError('invalid-argument', '修改預約資料格式不正確。');
  const input = parsed.data;
  const actorUid = await requirePropertyPage(request.auth, input.propertyId, 'bookings');
  const database = getFirestore();
  const propertyPath = `properties/${input.propertyId}`;
  const operationRef = database.doc(`${propertyPath}/bookingOperations/${input.operationId}`);
  const bookingRef = database.doc(`${propertyPath}/bookings/${input.bookingId}`);
  const roomRef = database.doc(`${propertyPath}/rooms/${input.roomId}`);
  const requestFingerprint = fingerprint(input);

  return database.runTransaction(async (transaction) => {
    const priorOperation = await transaction.get(operationRef);
    if (priorOperation.exists) return replayResult(priorOperation.data() ?? {}, actorUid, requestFingerprint);

    const [bookingSnapshot, roomSnapshot, bookingsSnapshot, staysSnapshot, maintenanceSnapshot, holidaysSnapshot] = await Promise.all([
      transaction.get(bookingRef),
      transaction.get(roomRef),
      transaction.get(database.collection(`${propertyPath}/bookings`).where('roomId', '==', input.roomId)),
      transaction.get(database.collection(`${propertyPath}/stays`).where('roomId', '==', input.roomId)),
      transaction.get(database.collection(`${propertyPath}/maintenanceSchedules`).where('roomId', '==', input.roomId)),
      transaction.get(database.collection(`${propertyPath}/holidays`)),
    ]);
    if (!bookingSnapshot.exists) throw new HttpsError('not-found', '找不到指定預約。');
    if (!roomSnapshot.exists) throw new HttpsError('not-found', '找不到指定房間。');

    const booking = bookingSnapshot.data() ?? {};
    const bookingLabel = `bookings/${input.bookingId}`;
    // Another device saved this booking after the form was opened: never overwrite its change.
    if (requiredVersion(booking, bookingLabel) !== input.expectedVersion) throw new HttpsError('aborted', '此預約剛被其他裝置修改，請重新載入後再修改。');
    if (requiredText(booking, 'propertyId', bookingLabel) !== input.propertyId) {
      throw new HttpsError('data-loss', `${bookingLabel} 的館別識別碼不一致。`);
    }
    if (requiredText(booking, 'bookingId', bookingLabel) !== input.bookingId) {
      throw new HttpsError('data-loss', `${bookingLabel} 的預約識別碼不一致。`);
    }
    const bookingStatus = requiredText(booking, 'status', bookingLabel);
    if (!BOOKING_STATUSES.includes(bookingStatus as (typeof BOOKING_STATUSES)[number])) {
      throw new HttpsError('data-loss', `${bookingLabel} 的 status 不受支援。`);
    }
    if (bookingStatus !== '已預約') throw new HttpsError('failed-precondition', '只有有效預約可修改。');

    const room = roomSnapshot.data() ?? {};
    const roomLabel = `rooms/${input.roomId}`;
    if (requiredText(room, 'roomId', roomLabel) !== input.roomId) {
      throw new HttpsError('data-loss', `${roomLabel} 的識別碼不一致。`);
    }
    const roomStatus = requiredText(room, 'status', roomLabel);
    if (!CLOUD_ROOM_STATUSES.includes(roomStatus as (typeof CLOUD_ROOM_STATUSES)[number])) {
      throw new HttpsError('data-loss', `${roomLabel} 的 status 不受支援。`);
    }
    if (roomStatus === '月租套房') throw new HttpsError('failed-precondition', '月租套房不可修改為短期預約。');

    const quote = quoteBooking(input, calendarFromDocuments(holidaysSnapshot.docs));
    const candidates = [
      ...bookingsSnapshot.docs.map(bookingCandidate).filter((candidate): candidate is BookingAvailabilityCandidate => candidate !== null),
      ...staysSnapshot.docs.map(stayCandidate).filter((candidate): candidate is BookingAvailabilityCandidate => candidate !== null),
      ...maintenanceSnapshot.docs.map(maintenanceCandidate).filter((candidate): candidate is BookingAvailabilityCandidate => candidate !== null),
    ].filter((candidate) => !(candidate.source === 'booking' && candidate.id === input.bookingId));
    const conflict = findBookingAvailabilityConflict(input.roomId, quote.checkInAt, quote.checkOutAt, candidates);
    if (conflict) throw new HttpsError('aborted', conflictMessage(conflict));

    const occurredAt = new Date().toISOString();
    const result: BookingUpdateResult = {
      status: 'updated',
      bookingId: input.bookingId,
      checkInAt: quote.checkInAt,
      checkOutAt: quote.checkOutAt,
      amountNts: quote.amountNts,
      discountNts: quote.discountNts,
      rateType: input.rateType ?? quote.rateType,
    };
    transaction.update(bookingRef, {
      roomId: input.roomId,
      guestName: input.guestName,
      phone: input.phone ?? null,
      checkInAt: quote.checkInAt,
      checkOutAt: quote.checkOutAt,
      plan: input.plan,
      amountNts: quote.amountNts,
      discountNts: quote.discountNts,
      rateType: input.rateType ?? quote.rateType,
      pricingMode: input.pricingMode,
      grossAmountNts: quote.grossAmountNts,
      version: requiredVersion(booking, bookingLabel) + 1,
      updatedByUid: actorUid,
      updatedAt: occurredAt,
    });
    transaction.create(operationRef, {
      operationId: input.operationId,
      actorUid,
      requestFingerprint,
      operationType: 'booking.update',
      result,
      createdAt: occurredAt,
    });
    transaction.create(database.doc(`${propertyPath}/auditLogs/booking-update-${input.operationId}`), {
      actorUid,
      action: 'booking.update',
      targetId: input.bookingId,
      targetType: 'booking',
      details: {
        operationId: input.operationId,
        previousRoomId: requiredText(booking, 'roomId', bookingLabel),
        roomId: input.roomId,
        checkInAt: quote.checkInAt,
        checkOutAt: quote.checkOutAt,
        pricingMode: input.pricingMode,
      },
      createdAt: occurredAt,
    });
    return result;
  });
});

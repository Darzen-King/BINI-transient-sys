import {
  bookingCreateInputSchema,
  bookingCreateResultSchema,
  BOOKING_STATUSES,
  CLOUD_ROOM_STATUSES,
  findBookingAvailabilityConflict,
  quoteBooking,
  type BookingAvailabilityCandidate,
  type BookingCreateInput,
  type BookingCreateResult,
  type BookingHolidayCalendar,
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

function stableFingerprint(input: BookingCreateInput): string {
  const payload = {
    propertyId: input.propertyId,
    operationId: input.operationId,
    roomId: input.roomId,
    guestName: input.guestName,
    phone: input.phone ?? null,
    checkInAt: input.checkInAt,
    plan: input.plan,
    days: input.days,
    discountNts: input.discountNts,
    pricingMode: input.pricingMode,
    manualAmountNts: input.manualAmountNts ?? null,
    deposit: input.deposit ?? null,
  };
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

function taipeiDateParts(iso: string): { yyMMdd: string } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Taipei',
    year: '2-digit',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(iso));
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return { yyMMdd: `${values.year}${values.month}${values.day}` };
}

function deterministicBookingId(input: BookingCreateInput, checkInAt: string): string {
  const suffix = input.operationId.replaceAll('-', '').slice(-8).toUpperCase();
  return `RSV-${taipeiDateParts(checkInAt).yyMMdd}-${suffix}`;
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
  const status = requiredText(data, 'status', `bookings/${document.id}`);
  if (!BOOKING_STATUSES.includes(status as (typeof BOOKING_STATUSES)[number])) {
    throw new HttpsError('data-loss', `bookings/${document.id} 的 status 不受支援。`);
  }
  if (status !== '已預約') return null;
  const bookingId = requiredText(data, 'bookingId', `bookings/${document.id}`);
  if (bookingId !== document.id) throw new HttpsError('data-loss', `bookings/${document.id} 的識別碼不一致。`);
  return {
    id: bookingId,
    source: 'booking',
    roomId: requiredText(data, 'roomId', `bookings/${document.id}`),
    startAt: requiredText(data, 'checkInAt', `bookings/${document.id}`),
    endAt: requiredText(data, 'checkOutAt', `bookings/${document.id}`),
    status,
    guestName: optionalText(data, 'guestName', `bookings/${document.id}`),
  };
}

function stayCandidate(document: QueryDocumentSnapshot): BookingAvailabilityCandidate | null {
  const data = document.data();
  const startAt = optionalText(data, 'checkInAt', `stays/${document.id}`);
  const endAt = optionalText(data, 'checkOutAt', `stays/${document.id}`);
  if (!startAt || !endAt) return null;
  return {
    id: `STAY-${document.id}`,
    source: 'stay',
    roomId: requiredText(data, 'roomId', `stays/${document.id}`),
    startAt,
    endAt,
    status: '使用中',
    guestName: optionalText(data, 'guestName', `stays/${document.id}`),
  };
}

function maintenanceCandidate(document: QueryDocumentSnapshot): BookingAvailabilityCandidate | null {
  const data = document.data();
  const status = requiredText(data, 'status', `maintenanceSchedules/${document.id}`);
  if (!['scheduled', 'in_progress', 'done'].includes(status)) {
    throw new HttpsError('data-loss', `maintenanceSchedules/${document.id} 的 status 不受支援。`);
  }
  if (status === 'done') return null;
  return {
    id: `MAINT-${document.id}`,
    source: 'maintenance',
    roomId: requiredText(data, 'roomId', `maintenanceSchedules/${document.id}`),
    startAt: requiredText(data, 'startAt', `maintenanceSchedules/${document.id}`),
    endAt: requiredText(data, 'endAt', `maintenanceSchedules/${document.id}`),
    status,
    guestName: null,
  };
}

function replayResult(operation: FirestoreRecord, actorUid: string, fingerprint: string): BookingCreateResult {
  if (operation.actorUid !== actorUid || operation.requestFingerprint !== fingerprint) {
    throw new HttpsError('already-exists', '此操作識別碼已由不同請求使用。');
  }
  const parsed = bookingCreateResultSchema.safeParse(operation.result);
  if (!parsed.success || parsed.data.status !== 'created') {
    throw new HttpsError('data-loss', '已完成操作缺少有效結果。');
  }
  return { ...parsed.data, status: 'replayed' };
}

function conflictMessage(conflict: ReturnType<typeof findBookingAvailabilityConflict>): string {
  if (!conflict) return '';
  if (conflict.source === 'maintenance') return `房間在此時段已有維修排程（${conflict.id}）。`;
  return `房間在此時段已與 ${conflict.id}（${conflict.guestName ?? '未知住客'}）衝突。`;
}

export const bookingCreate = onCall(callableOptions, async (request): Promise<BookingCreateResult> => {
  const parsed = bookingCreateInputSchema.safeParse(request.data);
  if (!parsed.success) throw new HttpsError('invalid-argument', '新增預約資料格式不正確。');
  const input = parsed.data;
  const actorUid = await requirePropertyPage(request.auth, input.propertyId, 'bookings_new');
  const now = new Date();
  const checkInMillis = Date.parse(input.checkInAt);
  if (checkInMillis < now.getTime() - (5 * 60 * 1_000)) {
    throw new HttpsError('failed-precondition', '入住時間不可早於目前時間五分鐘以上。');
  }

  const database = getFirestore();
  const propertyPath = `properties/${input.propertyId}`;
  const operationRef = database.doc(`${propertyPath}/bookingOperations/${input.operationId}`);
  const roomRef = database.doc(`${propertyPath}/rooms/${input.roomId}`);
  const fingerprint = stableFingerprint(input);

  return database.runTransaction(async (transaction) => {
    const previousOperation = await transaction.get(operationRef);
    if (previousOperation.exists) return replayResult(previousOperation.data() ?? {}, actorUid, fingerprint);

    const provisionalBookingId = deterministicBookingId(input, input.checkInAt);
    const bookingRef = database.doc(`${propertyPath}/bookings/${provisionalBookingId}`);
    const [roomSnapshot, bookingSnapshot, bookingsSnapshot, staysSnapshot, maintenanceSnapshot, holidaysSnapshot] = await Promise.all([
      transaction.get(roomRef),
      transaction.get(bookingRef),
      transaction.get(database.collection(`${propertyPath}/bookings`).where('roomId', '==', input.roomId)),
      transaction.get(database.collection(`${propertyPath}/stays`).where('roomId', '==', input.roomId)),
      transaction.get(database.collection(`${propertyPath}/maintenanceSchedules`).where('roomId', '==', input.roomId)),
      transaction.get(database.collection(`${propertyPath}/holidays`)),
    ]);

    if (!roomSnapshot.exists) throw new HttpsError('not-found', '找不到指定房間。');
    const room = roomSnapshot.data() ?? {};
    if (requiredText(room, 'roomId', `rooms/${input.roomId}`) !== input.roomId) {
      throw new HttpsError('data-loss', `rooms/${input.roomId} 的識別碼不一致。`);
    }
    const roomStatus = requiredText(room, 'status', `rooms/${input.roomId}`);
    if (!CLOUD_ROOM_STATUSES.includes(roomStatus as (typeof CLOUD_ROOM_STATUSES)[number])) {
      throw new HttpsError('data-loss', `rooms/${input.roomId} 的 status 不受支援。`);
    }
    if (roomStatus === '月租套房') {
      throw new HttpsError('failed-precondition', '月租套房不可建立短期預約。');
    }
    if (bookingSnapshot.exists) throw new HttpsError('already-exists', '預約識別碼已存在，請以新的操作重新送出。');

    const quote = quoteBooking(input, calendarFromDocuments(holidaysSnapshot.docs));
    const candidates = [
      ...bookingsSnapshot.docs.map(bookingCandidate).filter((candidate): candidate is BookingAvailabilityCandidate => candidate !== null),
      ...staysSnapshot.docs.map(stayCandidate).filter((candidate): candidate is BookingAvailabilityCandidate => candidate !== null),
      ...maintenanceSnapshot.docs.map(maintenanceCandidate).filter((candidate): candidate is BookingAvailabilityCandidate => candidate !== null),
    ];
    const conflict = findBookingAvailabilityConflict(input.roomId, quote.checkInAt, quote.checkOutAt, candidates);
    if (conflict) throw new HttpsError('aborted', conflictMessage(conflict));

    const paymentId = input.deposit ? `PAY-${provisionalBookingId.slice(4)}` : null;
    const result: BookingCreateResult = {
      status: 'created',
      bookingId: provisionalBookingId,
      paymentId,
      checkInAt: quote.checkInAt,
      checkOutAt: quote.checkOutAt,
      amountNts: quote.amountNts,
      discountNts: quote.discountNts,
      rateType: quote.rateType,
    };
    const occurredAt = now.toISOString();
    transaction.create(bookingRef, {
      schemaVersion: 4,
      version: 1,
      propertyId: input.propertyId,
      bookingId: provisionalBookingId,
      roomId: input.roomId,
      guestName: input.guestName,
      phone: input.phone ?? null,
      checkInAt: quote.checkInAt,
      checkOutAt: quote.checkOutAt,
      plan: input.plan,
      amountNts: quote.amountNts,
      discountNts: quote.discountNts,
      rateType: quote.rateType,
      status: '已預約',
      pricingMode: input.pricingMode,
      grossAmountNts: quote.grossAmountNts,
      createdByUid: actorUid,
      createdAt: occurredAt,
      updatedAt: occurredAt,
    });
    if (input.deposit && paymentId) {
      transaction.create(database.doc(`${propertyPath}/payments/${paymentId}`), {
        schemaVersion: 4,
        version: 1,
        propertyId: input.propertyId,
        bookingId: provisionalBookingId,
        roomId: input.roomId,
        guestName: input.guestName,
        paymentType: input.deposit.paymentType,
        amountNts: input.deposit.amountNts,
        deposit: true,
        refund: false,
        status: 'paid',
        createdByUid: actorUid,
        createdAt: occurredAt,
      });
    }
    transaction.create(operationRef, {
      operationId: input.operationId,
      actorUid,
      requestFingerprint: fingerprint,
      operationType: 'booking.create',
      result,
      createdAt: occurredAt,
    });
    transaction.create(database.doc(`${propertyPath}/auditLogs/booking-create-${input.operationId}`), {
      actorUid,
      action: 'booking.create',
      targetId: provisionalBookingId,
      targetType: 'booking',
      details: {
        operationId: input.operationId,
        roomId: input.roomId,
        checkInAt: quote.checkInAt,
        checkOutAt: quote.checkOutAt,
        paymentId,
      },
      createdAt: occurredAt,
    });
    return result;
  });
});

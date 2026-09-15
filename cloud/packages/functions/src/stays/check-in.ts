import {
  BOOKING_STATUSES,
  CLOUD_ROOM_STATUSES,
  findBookingAvailabilityConflict,
  quoteBooking,
  stayCheckInInputSchema,
  stayCheckInResultSchema,
  type BookingAvailabilityCandidate,
  type BookingHolidayCalendar,
  type StayCheckInInput,
  type StayCheckInResult,
} from '@bini/cloud-shared';
import { createHash } from 'node:crypto';
import { getFirestore, type QueryDocumentSnapshot } from 'firebase-admin/firestore';
import { HttpsError, onCall } from 'firebase-functions/v2/https';

import { requirePropertyPage } from '../admin/staff-admin.js';

const callableOptions = { region: 'asia-east1', maxInstances: 10, timeoutSeconds: 60, memory: '512MiB' } as const;
type FirestoreRecord = Record<string, unknown>;

/** Imported v3 bookings store `+08:00` times and cloud quotes use UTC `Z`; compare the instant, not the text. */
export function sameInstant(left: string, right: string): boolean {
  const leftMillis = Date.parse(left);
  return Number.isFinite(leftMillis) && leftMillis === Date.parse(right);
}

function requiredText(data: FirestoreRecord, field: string, label: string): string {
  const value = data[field];
  if (typeof value !== 'string' || value.trim() === '') throw new HttpsError('data-loss', `${label} 缺少有效 ${field}。`);
  return value;
}

function requiredVersion(data: FirestoreRecord, label: string): number {
  const value = data.version;
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw new HttpsError('data-loss', `${label} 缺少有效 version。`);
  return value;
}

function fingerprint(input: StayCheckInInput): string {
  return createHash('sha256').update(JSON.stringify({ operationType: 'stay.checkin', ...input, bookingId: input.bookingId ?? null, phone: input.phone ?? null, deposit: input.deposit ?? null })).digest('hex');
}

function calendarFromDocuments(documents: readonly QueryDocumentSnapshot[]): BookingHolidayCalendar {
  const days = new Map<string, boolean>();
  const countByYear = new Map<number, number>();
  for (const document of documents) {
    const data = document.data();
    if (typeof data.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(data.date) || typeof data.holiday !== 'boolean' || !Number.isSafeInteger(data.year) || String(data.year) !== data.date.slice(0, 4)) {
      throw new HttpsError('data-loss', `holidays/${document.id} 資料格式不正確。`);
    }
    if (days.has(data.date)) throw new HttpsError('data-loss', `假日資料重複：${data.date}。`);
    days.set(data.date, data.holiday);
    countByYear.set(data.year, (countByYear.get(data.year) ?? 0) + 1);
  }
  return { days, coveredYears: new Set([...countByYear].filter(([, count]) => count > 3).map(([year]) => year)) };
}

function bookingCandidate(document: QueryDocumentSnapshot): BookingAvailabilityCandidate | null {
  const data = document.data();
  const label = `bookings/${document.id}`;
  const status = requiredText(data, 'status', label);
  if (!BOOKING_STATUSES.includes(status as (typeof BOOKING_STATUSES)[number])) throw new HttpsError('data-loss', `${label} 的 status 不受支援。`);
  if (status !== '已預約') return null;
  const bookingId = requiredText(data, 'bookingId', label);
  if (bookingId !== document.id) throw new HttpsError('data-loss', `${label} 的識別碼不一致。`);
  return { id: bookingId, source: 'booking', roomId: requiredText(data, 'roomId', label), startAt: requiredText(data, 'checkInAt', label), endAt: requiredText(data, 'checkOutAt', label), status, guestName: requiredText(data, 'guestName', label) };
}

function maintenanceCandidate(document: QueryDocumentSnapshot): BookingAvailabilityCandidate | null {
  const data = document.data();
  const label = `maintenanceSchedules/${document.id}`;
  const status = requiredText(data, 'status', label);
  if (!['scheduled', 'in_progress', 'done'].includes(status)) throw new HttpsError('data-loss', `${label} 的 status 不受支援。`);
  if (status === 'done') return null;
  return { id: `MAINT-${document.id}`, source: 'maintenance', roomId: requiredText(data, 'roomId', label), startAt: requiredText(data, 'startAt', label), endAt: requiredText(data, 'endAt', label), status, guestName: null };
}

function replayResult(operation: FirestoreRecord, actorUid: string, requestFingerprint: string): StayCheckInResult {
  if (operation.actorUid !== actorUid || operation.operationType !== 'stay.checkin' || operation.requestFingerprint !== requestFingerprint) {
    throw new HttpsError('already-exists', '此操作識別碼已由不同請求使用。');
  }
  const parsed = stayCheckInResultSchema.safeParse(operation.result);
  if (!parsed.success || parsed.data.status !== 'checked_in') throw new HttpsError('data-loss', '已完成操作缺少有效結果。');
  return { ...parsed.data, status: 'replayed' };
}

/** Creates one active stay and synchronizes its room, source booking, deposit and audit atomically. */
export const stayCheckIn = onCall(callableOptions, async (request): Promise<StayCheckInResult> => {
  const parsed = stayCheckInInputSchema.safeParse(request.data);
  if (!parsed.success) throw new HttpsError('invalid-argument', '入住登記資料格式不正確。');
  const input = parsed.data;
  const actorUid = await requirePropertyPage(request.auth, input.propertyId, 'checkin');
  const database = getFirestore();
  const propertyPath = `properties/${input.propertyId}`;
  const operationRef = database.doc(`${propertyPath}/stayOperations/${input.operationId}`);
  const roomRef = database.doc(`${propertyPath}/rooms/${input.roomId}`);
  const bookingRef = input.bookingId ? database.doc(`${propertyPath}/bookings/${input.bookingId}`) : null;
  const stayId = `STY-${input.operationId.replaceAll('-', '').slice(-12).toUpperCase()}`;
  const stayRef = database.doc(`${propertyPath}/stays/${stayId}`);
  const requestFingerprint = fingerprint(input);

  return database.runTransaction(async (transaction) => {
    const priorOperation = await transaction.get(operationRef);
    if (priorOperation.exists) return replayResult(priorOperation.data() ?? {}, actorUid, requestFingerprint);
    const [roomSnapshot, staySnapshot, bookingsSnapshot, maintenanceSnapshot, holidaysSnapshot, selectedBookingSnapshot, stayIdSnapshot] = await Promise.all([
      transaction.get(roomRef),
      transaction.get(database.collection(`${propertyPath}/stays`).where('roomId', '==', input.roomId)),
      transaction.get(database.collection(`${propertyPath}/bookings`).where('roomId', '==', input.roomId)),
      transaction.get(database.collection(`${propertyPath}/maintenanceSchedules`).where('roomId', '==', input.roomId)),
      transaction.get(database.collection(`${propertyPath}/holidays`)),
      bookingRef ? transaction.get(bookingRef) : Promise.resolve(null),
      transaction.get(stayRef),
    ]);
    if (!roomSnapshot.exists) throw new HttpsError('not-found', '找不到指定房間。');
    if (stayIdSnapshot.exists) throw new HttpsError('already-exists', '入住識別碼已存在，請重新送出。');
    const room = roomSnapshot.data() ?? {};
    const roomLabel = `rooms/${input.roomId}`;
    if (requiredText(room, 'roomId', roomLabel) !== input.roomId) throw new HttpsError('data-loss', `${roomLabel} 的識別碼不一致。`);
    const roomStatus = requiredText(room, 'status', roomLabel);
    if (!CLOUD_ROOM_STATUSES.includes(roomStatus as (typeof CLOUD_ROOM_STATUSES)[number])) throw new HttpsError('data-loss', `${roomLabel} 的 status 不受支援。`);
    if (roomStatus !== '可入住') throw new HttpsError('failed-precondition', '房間目前不可辦理入住。');
    for (const document of staySnapshot.docs) {
      if (requiredText(document.data(), 'roomId', `stays/${document.id}`) !== input.roomId) throw new HttpsError('data-loss', `stays/${document.id} 的房間識別碼不一致。`);
    }
    if (!staySnapshot.empty) throw new HttpsError('failed-precondition', '房間已有在住房，無法覆蓋入住資料。');

    const quote = quoteBooking(input, calendarFromDocuments(holidaysSnapshot.docs));
    let sourceBooking: FirestoreRecord | null = null;
    if (input.bookingId) {
      if (!selectedBookingSnapshot?.exists) throw new HttpsError('not-found', '找不到來源預約。');
      sourceBooking = selectedBookingSnapshot.data() ?? {};
      const label = `bookings/${input.bookingId}`;
      if (requiredText(sourceBooking, 'propertyId', label) !== input.propertyId || requiredText(sourceBooking, 'bookingId', label) !== input.bookingId) throw new HttpsError('data-loss', `${label} 的識別碼不一致。`);
      if (requiredText(sourceBooking, 'status', label) !== '已預約') throw new HttpsError('failed-precondition', '來源預約已處理，無法辦理入住。');
      if (requiredText(sourceBooking, 'roomId', label) !== input.roomId || requiredText(sourceBooking, 'guestName', label) !== input.guestName || !sameInstant(requiredText(sourceBooking, 'checkInAt', label), quote.checkInAt) || !sameInstant(requiredText(sourceBooking, 'checkOutAt', label), quote.checkOutAt) || requiredText(sourceBooking, 'plan', label) !== input.plan) {
        throw new HttpsError('failed-precondition', '來源預約資料已變更，請重新載入後再辦理入住。');
      }
    }
    const candidates = [
      ...bookingsSnapshot.docs.map(bookingCandidate).filter((candidate): candidate is BookingAvailabilityCandidate => candidate !== null),
      ...maintenanceSnapshot.docs.map(maintenanceCandidate).filter((candidate): candidate is BookingAvailabilityCandidate => candidate !== null),
    ].filter((candidate) => candidate.id !== input.bookingId);
    const conflict = findBookingAvailabilityConflict(input.roomId, quote.checkInAt, quote.checkOutAt, candidates);
    if (conflict) throw new HttpsError('aborted', conflict.source === 'maintenance' ? `房間在此時段已有維修排程（${conflict.id}）。` : `房間在此時段已與 ${conflict.id} 衝突。`);

    const occurredAt = new Date().toISOString();
    const paymentId = input.deposit ? `PAY-CHK-${input.operationId.replaceAll('-', '').slice(-12).toUpperCase()}` : null;
    const result: StayCheckInResult = { status: 'checked_in', stayId, bookingId: input.bookingId ?? null, paymentId, checkInAt: quote.checkInAt, checkOutAt: quote.checkOutAt, totalDueNts: quote.amountNts };
    transaction.create(stayRef, { schemaVersion: 4, version: 1, propertyId: input.propertyId, stayId, roomId: input.roomId, guestName: input.guestName, phone: input.phone ?? null, plan: input.plan, baseRentNts: quote.amountNts, discountNts: quote.discountNts, extensionFeeNts: 0, extraFeeNts: 0, totalDueNts: quote.amountNts, checkInAt: quote.checkInAt, checkOutAt: quote.checkOutAt, originalCheckOutAt: quote.checkOutAt, hourlyRateNts: Math.floor(quote.amountNts / (input.plan === '12hrs' ? 12 : 24)), bookingId: input.bookingId ?? null, createdByUid: actorUid, createdAt: occurredAt, updatedAt: occurredAt });
    transaction.update(roomRef, { status: '使用中', guestName: input.guestName, checkInAt: quote.checkInAt, checkOutAt: quote.checkOutAt, version: requiredVersion(room, roomLabel) + 1, updatedByUid: actorUid, updatedAt: occurredAt });
    if (bookingRef && sourceBooking) transaction.update(bookingRef, { status: '已入住', version: requiredVersion(sourceBooking, `bookings/${input.bookingId}`) + 1, checkedInAt: occurredAt, updatedByUid: actorUid, updatedAt: occurredAt });
    if (input.deposit && paymentId) transaction.create(database.doc(`${propertyPath}/payments/${paymentId}`), { schemaVersion: 4, version: 1, propertyId: input.propertyId, bookingId: input.bookingId ?? null, stayId, roomId: input.roomId, guestName: input.guestName, paymentType: input.deposit.paymentType, amountNts: input.deposit.amountNts, deposit: true, refund: false, status: 'paid', createdByUid: actorUid, createdAt: occurredAt });
    transaction.create(operationRef, { operationId: input.operationId, actorUid, requestFingerprint, operationType: 'stay.checkin', result, createdAt: occurredAt });
    transaction.create(database.doc(`${propertyPath}/auditLogs/stay-checkin-${input.operationId}`), { actorUid, action: 'stay.checkin', targetId: stayId, targetType: 'stay', details: { operationId: input.operationId, roomId: input.roomId, bookingId: input.bookingId ?? null, paymentId, checkInAt: quote.checkInAt, checkOutAt: quote.checkOutAt }, createdAt: occurredAt });
    return result;
  });
});

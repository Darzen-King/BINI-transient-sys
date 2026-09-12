import {
  BOOKING_STATUSES,
  CLOUD_ROOM_STATUSES,
  findBookingAvailabilityConflict,
  quoteStayExtension,
  stayExtendInputSchema,
  stayExtendResultSchema,
  type BookingAvailabilityCandidate,
  type BookingHolidayCalendar,
  type StayExtendInput,
  type StayExtendResult,
} from '@bini/cloud-shared';
import { createHash } from 'node:crypto';
import { getFirestore, type QueryDocumentSnapshot } from 'firebase-admin/firestore';
import { HttpsError, onCall } from 'firebase-functions/v2/https';

import { requirePropertyPage } from '../admin/staff-admin.js';

const callableOptions = { region: 'asia-east1', maxInstances: 10, timeoutSeconds: 60, memory: '512MiB' } as const;
type FirestoreRecord = Record<string, unknown>;

function requiredText(data: FirestoreRecord, field: string, label: string): string {
  const value = data[field];
  if (typeof value !== 'string' || value.trim() === '') throw new HttpsError('data-loss', `${label} 缺少有效 ${field}。`);
  return value;
}

function requiredAmount(data: FirestoreRecord, field: string, label: string): number {
  const value = data[field];
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw new HttpsError('data-loss', `${label} 缺少有效 ${field}。`);
  return value;
}

function requiredVersion(data: FirestoreRecord, label: string): number {
  const value = data.version;
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw new HttpsError('data-loss', `${label} 缺少有效 version。`);
  return value;
}

function fingerprint(input: StayExtendInput): string {
  return createHash('sha256').update(JSON.stringify({ operationType: 'stay.extend', ...input })).digest('hex');
}

function calendarFromDocuments(documents: readonly QueryDocumentSnapshot[]): BookingHolidayCalendar {
  const days = new Map<string, boolean>();
  const countByYear = new Map<number, number>();
  for (const document of documents) {
    const data = document.data();
    if (typeof data.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(data.date) || typeof data.holiday !== 'boolean' || !Number.isSafeInteger(data.year) || String(data.year) !== data.date.slice(0, 4)) throw new HttpsError('data-loss', `holidays/${document.id} 資料格式不正確。`);
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

function replayResult(operation: FirestoreRecord, actorUid: string, requestFingerprint: string): StayExtendResult {
  if (operation.actorUid !== actorUid || operation.operationType !== 'stay.extend' || operation.requestFingerprint !== requestFingerprint) throw new HttpsError('already-exists', '此操作識別碼已由不同請求使用。');
  const parsed = stayExtendResultSchema.safeParse(operation.result);
  if (!parsed.success || parsed.data.status !== 'extended') throw new HttpsError('data-loss', '已完成操作缺少有效結果。');
  return { ...parsed.data, status: 'replayed' };
}

/** Atomically extends one active stay and refuses the v3 warning-after-write collision behaviour. */
export const stayExtend = onCall(callableOptions, async (request): Promise<StayExtendResult> => {
  const parsed = stayExtendInputSchema.safeParse(request.data);
  if (!parsed.success) throw new HttpsError('invalid-argument', '延住資料格式不正確。');
  const input = parsed.data;
  const actorUid = await requirePropertyPage(request.auth, input.propertyId, 'extend');
  const database = getFirestore();
  const propertyPath = `properties/${input.propertyId}`;
  const operationRef = database.doc(`${propertyPath}/stayOperations/${input.operationId}`);
  const stayRef = database.doc(`${propertyPath}/stays/${input.stayId}`);
  const requestFingerprint = fingerprint(input);

  return database.runTransaction(async (transaction) => {
    const priorOperation = await transaction.get(operationRef);
    if (priorOperation.exists) return replayResult(priorOperation.data() ?? {}, actorUid, requestFingerprint);
    const staySnapshot = await transaction.get(stayRef);
    if (!staySnapshot.exists) throw new HttpsError('not-found', '找不到在住房紀錄。');
    const stay = staySnapshot.data() ?? {};
    const stayLabel = `stays/${input.stayId}`;
    const recordedStayId = typeof stay.stayId === 'string' ? requiredText(stay, 'stayId', stayLabel) : input.stayId;
    if (requiredText(stay, 'propertyId', stayLabel) !== input.propertyId || recordedStayId !== input.stayId) throw new HttpsError('data-loss', `${stayLabel} 的識別碼不一致。`);
    const roomId = requiredText(stay, 'roomId', stayLabel);
    const roomRef = database.doc(`${propertyPath}/rooms/${roomId}`);
    const [roomSnapshot, bookingsSnapshot, maintenanceSnapshot, holidaysSnapshot] = await Promise.all([
      transaction.get(roomRef),
      transaction.get(database.collection(`${propertyPath}/bookings`).where('roomId', '==', roomId)),
      transaction.get(database.collection(`${propertyPath}/maintenanceSchedules`).where('roomId', '==', roomId)),
      transaction.get(database.collection(`${propertyPath}/holidays`)),
    ]);
    if (!roomSnapshot.exists) throw new HttpsError('not-found', '找不到對應房間。');
    const room = roomSnapshot.data() ?? {};
    const roomLabel = `rooms/${roomId}`;
    if (requiredText(room, 'roomId', roomLabel) !== roomId) throw new HttpsError('data-loss', `${roomLabel} 的識別碼不一致。`);
    const roomStatus = requiredText(room, 'status', roomLabel);
    if (!CLOUD_ROOM_STATUSES.includes(roomStatus as (typeof CLOUD_ROOM_STATUSES)[number])) throw new HttpsError('data-loss', `${roomLabel} 的 status 不受支援。`);
    if (!['使用中', '即將退房'].includes(roomStatus)) throw new HttpsError('failed-precondition', '房間目前不是可延住的在住房狀態。');
    if (requiredText(room, 'guestName', roomLabel) !== requiredText(stay, 'guestName', stayLabel)) throw new HttpsError('failed-precondition', '房間與在住房住客不一致，請重新載入。');

    const checkInAt = requiredText(stay, 'checkInAt', stayLabel);
    const checkOutAt = requiredText(stay, 'checkOutAt', stayLabel);
    const originalCheckOutAt = typeof stay.originalCheckOutAt === 'string' ? stay.originalCheckOutAt : checkOutAt;
    const proposedCheckOutAt = new Date(Date.parse(checkOutAt) + (input.extensionHours * 3_600_000)).toISOString();
    let incrementalQuote;
    let cumulativeQuote;
    try {
      const calendar = calendarFromDocuments(holidaysSnapshot.docs);
      incrementalQuote = quoteStayExtension(checkInAt, checkOutAt, input.extensionHours, calendar);
      cumulativeQuote = quoteStayExtension(checkInAt, originalCheckOutAt, (Date.parse(proposedCheckOutAt) - Date.parse(originalCheckOutAt)) / 3_600_000, calendar);
    } catch (error) {
      throw new HttpsError('data-loss', error instanceof Error ? error.message : '在住房計價資料無效。');
    }
    const candidates = [
      ...bookingsSnapshot.docs.map(bookingCandidate).filter((candidate): candidate is BookingAvailabilityCandidate => candidate !== null),
      ...maintenanceSnapshot.docs.map(maintenanceCandidate).filter((candidate): candidate is BookingAvailabilityCandidate => candidate !== null),
    ];
    const conflict = findBookingAvailabilityConflict(roomId, checkOutAt, proposedCheckOutAt, candidates);
    if (conflict) throw new HttpsError('aborted', conflict.source === 'maintenance' ? `延住會與維修排程 ${conflict.id} 衝突，未寫入任何資料。` : `延住會與預約 ${conflict.id} 衝突，未寫入任何資料。`);

    const baseRentNts = requiredAmount(stay, 'baseRentNts', stayLabel);
    const extraFeeNts = requiredAmount(stay, 'extraFeeNts', stayLabel);
    const occurredAt = new Date().toISOString();
    const result: StayExtendResult = { status: 'extended', stayId: input.stayId, roomId, extensionHours: input.extensionHours, checkOutAt: proposedCheckOutAt, incrementalFeeNts: incrementalQuote.extensionFeeNts, extensionFeeNts: cumulativeQuote.extensionFeeNts, totalDueNts: baseRentNts + cumulativeQuote.extensionFeeNts + extraFeeNts };
    transaction.update(stayRef, { checkOutAt: proposedCheckOutAt, extensionFeeNts: result.extensionFeeNts, totalDueNts: result.totalDueNts, version: requiredVersion(stay, stayLabel) + 1, updatedByUid: actorUid, updatedAt: occurredAt });
    transaction.update(roomRef, { checkOutAt: proposedCheckOutAt, version: requiredVersion(room, roomLabel) + 1, updatedByUid: actorUid, updatedAt: occurredAt });
    transaction.create(operationRef, { operationId: input.operationId, actorUid, requestFingerprint, operationType: 'stay.extend', result, createdAt: occurredAt });
    transaction.create(database.doc(`${propertyPath}/auditLogs/stay-extend-${input.operationId}`), { actorUid, action: 'stay.extend', targetId: input.stayId, targetType: 'stay', details: { operationId: input.operationId, roomId, extensionHours: input.extensionHours, priorCheckOutAt: checkOutAt, checkOutAt: proposedCheckOutAt, incrementalFeeNts: result.incrementalFeeNts, extensionFeeNts: result.extensionFeeNts, totalDueNts: result.totalDueNts }, createdAt: occurredAt });
    return result;
  });
});

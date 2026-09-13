import {
  bookingMultiCreateInputSchema,
  bookingMultiCreateResultSchema,
  CLOUD_ROOM_STATUSES,
  findBookingAvailabilityConflict,
  quoteBooking,
  type BookingAvailabilityCandidate,
  type BookingHolidayCalendar,
  type BookingMultiCreateInput,
  type BookingMultiCreateResult,
  type BookingQuote,
} from '@bini/cloud-shared';
import { createHash } from 'node:crypto';
import { getFirestore } from 'firebase-admin/firestore';
import { HttpsError, onCall } from 'firebase-functions/v2/https';

import { requirePropertyPage } from '../admin/staff-admin.js';
import {
  bookingCandidate,
  calendarFromDocuments,
  maintenanceCandidate,
  stayCandidate,
} from './create-booking.js';

const callableOptions = {
  region: 'asia-east1',
  maxInstances: 10,
  timeoutSeconds: 60,
  memory: '512MiB',
} as const;

function requiredText(data: Record<string, unknown>, field: string, label: string): string {
  const value = data[field];
  if (typeof value !== 'string' || value.trim() === '') throw new HttpsError('data-loss', `${label} 缺少有效 ${field}。`);
  return value;
}

function stableFingerprint(input: BookingMultiCreateInput): string {
  return createHash('sha256').update(JSON.stringify({
    propertyId: input.propertyId,
    operationId: input.operationId,
    guestName: input.guestName,
    phone: input.phone ?? null,
    slots: input.slots,
    deposit: input.deposit ?? null,
  })).digest('hex');
}

function taipeiDatePrefix(iso: string): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Taipei', year: '2-digit', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date(iso));
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}${values.month}${values.day}`;
}

function multiBookingId(input: BookingMultiCreateInput, checkInAt: string, slotNumber: number): string {
  const operationSuffix = input.operationId.replaceAll('-', '').slice(-7).toUpperCase();
  return `RSV-${taipeiDatePrefix(checkInAt).slice(0, 6)}-${operationSuffix}${slotNumber.toString(36).toUpperCase()}`;
}

function replayResult(operation: Record<string, unknown>, actorUid: string, fingerprint: string): BookingMultiCreateResult {
  if (operation.actorUid !== actorUid || operation.requestFingerprint !== fingerprint) {
    throw new HttpsError('already-exists', '此操作識別碼已由不同請求使用。');
  }
  const parsed = bookingMultiCreateResultSchema.safeParse(operation.result);
  if (!parsed.success || parsed.data.status !== 'created') throw new HttpsError('data-loss', '已完成多時段操作缺少有效結果。');
  return { ...parsed.data, status: 'replayed' };
}

export interface MultiBookingSlotPlan {
  created: BookingMultiCreateResult['created'];
  conflicts: BookingMultiCreateResult['conflicts'];
  quotesBySlotNumber: ReadonlyMap<number, BookingQuote>;
}

/**
 * Plans v3-compatible partial success before the transaction writes anything.
 * Accepted slots are added immediately to the in-request availability set, so
 * overlapping slots from the same request cannot both be created.
 */
export function planMultiBookingSlots(
  input: BookingMultiCreateInput,
  calendar: BookingHolidayCalendar,
  rooms: ReadonlyMap<string, Record<string, unknown> | null>,
  candidatesByRoom: ReadonlyMap<string, readonly BookingAvailabilityCandidate[]>,
  now: number,
): MultiBookingSlotPlan {
  const created: BookingMultiCreateResult['created'] = [];
  const conflicts: BookingMultiCreateResult['conflicts'] = [];
  const acceptedCandidates = new Map<string, BookingAvailabilityCandidate[]>();
  const quotesBySlotNumber = new Map<number, BookingQuote>();

  for (const [index, slot] of input.slots.entries()) {
    const slotNumber = index + 1;
    const quote = quoteBooking(slot, calendar);
    if (Date.parse(slot.checkInAt) < now - (5 * 60 * 1_000)) {
      conflicts.push({ slotNumber, reason: 'past_time', conflict: null });
      continue;
    }
    const room = rooms.get(slot.roomId);
    if (!room) {
      conflicts.push({ slotNumber, reason: 'room_unavailable', conflict: null });
      continue;
    }
    if (requiredText(room, 'roomId', `rooms/${slot.roomId}`) !== slot.roomId) {
      throw new HttpsError('data-loss', `rooms/${slot.roomId} 的識別碼不一致。`);
    }
    const roomStatus = requiredText(room, 'status', `rooms/${slot.roomId}`);
    if (!CLOUD_ROOM_STATUSES.includes(roomStatus as (typeof CLOUD_ROOM_STATUSES)[number])) {
      throw new HttpsError('data-loss', `rooms/${slot.roomId} 的 status 不受支援。`);
    }
    if (roomStatus === '月租套房') {
      conflicts.push({ slotNumber, reason: 'room_unavailable', conflict: null });
      continue;
    }
    const candidates = [
      ...(candidatesByRoom.get(slot.roomId) ?? []),
      ...(acceptedCandidates.get(slot.roomId) ?? []),
    ];
    const conflict = findBookingAvailabilityConflict(slot.roomId, quote.checkInAt, quote.checkOutAt, candidates);
    if (conflict) {
      conflicts.push({ slotNumber, reason: 'conflict', conflict });
      continue;
    }
    const bookingId = multiBookingId(input, quote.checkInAt, slotNumber);
    const accepted: BookingAvailabilityCandidate = {
      id: bookingId,
      source: 'booking',
      roomId: slot.roomId,
      startAt: quote.checkInAt,
      endAt: quote.checkOutAt,
      status: '已預約',
      guestName: input.guestName,
    };
    acceptedCandidates.set(slot.roomId, [...(acceptedCandidates.get(slot.roomId) ?? []), accepted]);
    quotesBySlotNumber.set(slotNumber, quote);
    created.push({
      slotNumber,
      bookingId,
      checkInAt: quote.checkInAt,
      checkOutAt: quote.checkOutAt,
      amountNts: quote.amountNts,
      discountNts: quote.discountNts,
      rateType: quote.rateType,
    });
  }

  return { created, conflicts, quotesBySlotNumber };
}

/**
 * Preserves v3 partial-success semantics, but computes all accepted slots in one
 * transaction so concurrent devices cannot sneak a conflicting booking between slots.
 */
export const bookingMultiCreate = onCall(callableOptions, async (request): Promise<BookingMultiCreateResult> => {
  const parsed = bookingMultiCreateInputSchema.safeParse(request.data);
  if (!parsed.success) throw new HttpsError('invalid-argument', '多時段預約資料格式不正確。');
  const input = parsed.data;
  const actorUid = await requirePropertyPage(request.auth, input.propertyId, 'bookings_new');
  const database = getFirestore();
  const propertyPath = `properties/${input.propertyId}`;
  const fingerprint = stableFingerprint(input);
  const operationRef = database.doc(`${propertyPath}/bookingOperations/${input.operationId}`);

  return database.runTransaction(async (transaction) => {
    const previousOperation = await transaction.get(operationRef);
    if (previousOperation.exists) return replayResult(previousOperation.data() ?? {}, actorUid, fingerprint);

    const roomIds = [...new Set(input.slots.map((slot) => slot.roomId))];
    const holidaysSnapshot = await transaction.get(database.collection(`${propertyPath}/holidays`));
    const rooms = new Map<string, Record<string, unknown> | null>();
    const candidatesByRoom = new Map<string, BookingAvailabilityCandidate[]>();
    for (const roomId of roomIds) {
      const [roomSnapshot, bookingsSnapshot, staysSnapshot, maintenanceSnapshot] = await Promise.all([
        transaction.get(database.doc(`${propertyPath}/rooms/${roomId}`)),
        transaction.get(database.collection(`${propertyPath}/bookings`).where('roomId', '==', roomId)),
        transaction.get(database.collection(`${propertyPath}/stays`).where('roomId', '==', roomId)),
        transaction.get(database.collection(`${propertyPath}/maintenanceSchedules`).where('roomId', '==', roomId)),
      ]);
      rooms.set(roomId, roomSnapshot.exists ? roomSnapshot.data() ?? {} : null);
      candidatesByRoom.set(roomId, [
        ...bookingsSnapshot.docs.map(bookingCandidate).filter((candidate): candidate is BookingAvailabilityCandidate => candidate !== null),
        ...staysSnapshot.docs.map(stayCandidate).filter((candidate): candidate is BookingAvailabilityCandidate => candidate !== null),
        ...maintenanceSnapshot.docs.map(maintenanceCandidate).filter((candidate): candidate is BookingAvailabilityCandidate => candidate !== null),
      ]);
    }

    const calendar = calendarFromDocuments(holidaysSnapshot.docs);
    const { created, conflicts, quotesBySlotNumber } = planMultiBookingSlots(
      input,
      calendar,
      rooms,
      candidatesByRoom,
      Date.now(),
    );

    for (const item of created) {
      const snapshot = await transaction.get(database.doc(`${propertyPath}/bookings/${item.bookingId}`));
      if (snapshot.exists) throw new HttpsError('already-exists', '預約識別碼已存在，請以新的操作重新送出。');
    }

    const firstCreated = created[0];
    const paymentId = input.deposit && firstCreated ? `PAY-${firstCreated.bookingId.slice(4)}` : null;
    const occurredAt = new Date().toISOString();
    const result: BookingMultiCreateResult = { status: 'created', created, conflicts, paymentId };
    for (const item of created) {
      const slot = input.slots[item.slotNumber - 1]!;
      const quote = quotesBySlotNumber.get(item.slotNumber);
      if (!quote) throw new HttpsError('internal', '多時段報價遺失。');
      transaction.create(database.doc(`${propertyPath}/bookings/${item.bookingId}`), {
        schemaVersion: 4,
        version: 1,
        propertyId: input.propertyId,
        bookingId: item.bookingId,
        roomId: slot.roomId,
        guestName: input.guestName,
        phone: input.phone ?? null,
        checkInAt: item.checkInAt,
        checkOutAt: item.checkOutAt,
        plan: slot.plan,
        amountNts: item.amountNts,
        discountNts: item.discountNts,
        rateType: item.rateType,
        status: '已預約',
        pricingMode: slot.pricingMode,
        grossAmountNts: quote.grossAmountNts,
        createdByUid: actorUid,
        createdAt: occurredAt,
        updatedAt: occurredAt,
      });
    }
    if (input.deposit && paymentId && firstCreated) {
      const first = firstCreated;
      const firstSlot = input.slots[first.slotNumber - 1]!;
      transaction.create(database.doc(`${propertyPath}/payments/${paymentId}`), {
        schemaVersion: 4,
        version: 1,
        propertyId: input.propertyId,
        bookingId: first.bookingId,
        roomId: firstSlot.roomId,
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
      operationType: 'booking.multi_create',
      result,
      createdAt: occurredAt,
    });
    transaction.create(database.doc(`${propertyPath}/auditLogs/booking-multi-${input.operationId}`), {
      actorUid,
      action: 'booking.multi_create',
      targetId: input.operationId,
      targetType: 'booking_batch',
      details: {
        operationId: input.operationId,
        createdBookingIds: created.map((item) => item.bookingId),
        conflictSlotNumbers: conflicts.map((item) => item.slotNumber),
        paymentId,
      },
      createdAt: occurredAt,
    });
    return result;
  });
});

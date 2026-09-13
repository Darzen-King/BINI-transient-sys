import {
  BOOKING_STATUSES,
  CLOUD_ROOM_STATUSES,
  bookingPreviewResultSchema,
  bookingUpdatePreviewInputSchema,
  findBookingAvailabilityConflict,
  quoteBooking,
  type BookingAvailabilityCandidate,
  type BookingPreviewResult,
} from '@bini/cloud-shared';
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

function previewResult(
  available: boolean,
  reason: BookingPreviewResult['reason'],
  quote: ReturnType<typeof quoteBooking>,
  conflict: ReturnType<typeof findBookingAvailabilityConflict>,
): BookingPreviewResult {
  return bookingPreviewResultSchema.parse({ available, reason, quote, conflict: conflict ?? null });
}

export function excludeCurrentBooking(
  candidates: readonly BookingAvailabilityCandidate[],
  bookingId: string,
): BookingAvailabilityCandidate[] {
  return candidates.filter((candidate) => !(candidate.source === 'booking' && candidate.id === bookingId));
}

/** Advisory only. bookingUpdate rechecks the same scope inside its write transaction. */
export const bookingUpdatePreview = onCall(callableOptions, async (request): Promise<BookingPreviewResult> => {
  const parsed = bookingUpdatePreviewInputSchema.safeParse(request.data);
  if (!parsed.success) throw new HttpsError('invalid-argument', '修改預約預覽資料格式不正確。');
  const input = parsed.data;
  await requirePropertyPage(request.auth, input.propertyId, 'bookings');

  const database = getFirestore();
  const propertyPath = `properties/${input.propertyId}`;
  const [bookingSnapshot, roomSnapshot, bookingsSnapshot, staysSnapshot, maintenanceSnapshot, holidaysSnapshot] = await Promise.all([
    database.doc(`${propertyPath}/bookings/${input.bookingId}`).get(),
    database.doc(`${propertyPath}/rooms/${input.roomId}`).get(),
    database.collection(`${propertyPath}/bookings`).where('roomId', '==', input.roomId).get(),
    database.collection(`${propertyPath}/stays`).where('roomId', '==', input.roomId).get(),
    database.collection(`${propertyPath}/maintenanceSchedules`).where('roomId', '==', input.roomId).get(),
    database.collection(`${propertyPath}/holidays`).get(),
  ]);
  if (!bookingSnapshot.exists) throw new HttpsError('not-found', '找不到指定預約。');
  const booking = bookingSnapshot.data() ?? {};
  const bookingLabel = `bookings/${input.bookingId}`;
  if (requiredText(booking, 'propertyId', bookingLabel) !== input.propertyId || requiredText(booking, 'bookingId', bookingLabel) !== input.bookingId) {
    throw new HttpsError('data-loss', `${bookingLabel} 的識別碼不一致。`);
  }
  const bookingStatus = requiredText(booking, 'status', bookingLabel);
  if (!BOOKING_STATUSES.includes(bookingStatus as (typeof BOOKING_STATUSES)[number])) {
    throw new HttpsError('data-loss', `${bookingLabel} 的 status 不受支援。`);
  }
  if (bookingStatus !== '已預約') throw new HttpsError('failed-precondition', '只有有效預約可預覽修改。');

  const quote = quoteBooking(input, calendarFromDocuments(holidaysSnapshot.docs));
  if (!roomSnapshot.exists) return previewResult(false, 'room_unavailable', quote, null);
  const room = roomSnapshot.data() ?? {};
  if (requiredText(room, 'roomId', `rooms/${input.roomId}`) !== input.roomId) {
    throw new HttpsError('data-loss', `rooms/${input.roomId} 的識別碼不一致。`);
  }
  const roomStatus = requiredText(room, 'status', `rooms/${input.roomId}`);
  if (!CLOUD_ROOM_STATUSES.includes(roomStatus as (typeof CLOUD_ROOM_STATUSES)[number])) {
    throw new HttpsError('data-loss', `rooms/${input.roomId} 的 status 不受支援。`);
  }
  if (roomStatus === '月租套房') return previewResult(false, 'room_unavailable', quote, null);

  const candidates = excludeCurrentBooking([
    ...bookingsSnapshot.docs.map(bookingCandidate).filter((candidate): candidate is BookingAvailabilityCandidate => candidate !== null),
    ...staysSnapshot.docs.map(stayCandidate).filter((candidate): candidate is BookingAvailabilityCandidate => candidate !== null),
    ...maintenanceSnapshot.docs.map(maintenanceCandidate).filter((candidate): candidate is BookingAvailabilityCandidate => candidate !== null),
  ], input.bookingId);
  const conflict = findBookingAvailabilityConflict(input.roomId, quote.checkInAt, quote.checkOutAt, candidates);
  return previewResult(!conflict, conflict ? 'conflict' : 'available', quote, conflict);
});

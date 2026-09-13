import {
  bookingPreviewInputSchema,
  bookingPreviewResultSchema,
  CLOUD_ROOM_STATUSES,
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

/** Read-only advisory. bookingCreate always rechecks this state in its transaction. */
export const bookingPreview = onCall(callableOptions, async (request): Promise<BookingPreviewResult> => {
  const parsed = bookingPreviewInputSchema.safeParse(request.data);
  if (!parsed.success) throw new HttpsError('invalid-argument', '預約預覽資料格式不正確。');
  const input = parsed.data;
  await requirePropertyPage(request.auth, input.propertyId, 'bookings_new');

  const database = getFirestore();
  const propertyPath = `properties/${input.propertyId}`;
  const [roomSnapshot, bookingsSnapshot, staysSnapshot, maintenanceSnapshot, holidaysSnapshot] = await Promise.all([
    database.doc(`${propertyPath}/rooms/${input.roomId}`).get(),
    database.collection(`${propertyPath}/bookings`).where('roomId', '==', input.roomId).get(),
    database.collection(`${propertyPath}/stays`).where('roomId', '==', input.roomId).get(),
    database.collection(`${propertyPath}/maintenanceSchedules`).where('roomId', '==', input.roomId).get(),
    database.collection(`${propertyPath}/holidays`).get(),
  ]);
  const quote = quoteBooking(input, calendarFromDocuments(holidaysSnapshot.docs));
  if (Date.parse(input.checkInAt) < Date.now() - (5 * 60 * 1_000)) {
    return previewResult(false, 'past_time', quote, null);
  }
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

  const candidates = [
    ...bookingsSnapshot.docs.map(bookingCandidate).filter((candidate): candidate is BookingAvailabilityCandidate => candidate !== null),
    ...staysSnapshot.docs.map(stayCandidate).filter((candidate): candidate is BookingAvailabilityCandidate => candidate !== null),
    ...maintenanceSnapshot.docs.map(maintenanceCandidate).filter((candidate): candidate is BookingAvailabilityCandidate => candidate !== null),
  ];
  const conflict = findBookingAvailabilityConflict(input.roomId, quote.checkInAt, quote.checkOutAt, candidates);
  return previewResult(!conflict, conflict ? 'conflict' : 'available', quote, conflict);
});

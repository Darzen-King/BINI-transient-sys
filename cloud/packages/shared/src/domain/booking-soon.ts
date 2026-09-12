import { z } from 'zod';

export interface BookingSoonSourceDocument {
  id: string;
  data: unknown;
}

export interface BookingSoonItem {
  bookingId: string;
  roomId: string;
  guestName: string;
  checkInAt: string;
  minutesUntil: number;
}

const bookingSoonSchema = z.object({
  bookingId: z.string().trim().min(1).max(128),
  roomId: z.string().trim().min(1).max(128),
  guestName: z.string().trim().min(1).max(300),
  checkInAt: z.string().refine((value) => Number.isFinite(Date.parse(value)), 'invalid check-in datetime'),
  status: z.enum(['已預約', '已取消', 'No-show', '已入住']),
}).passthrough();

/** The v3 booking-soon API: active arrivals strictly within the next 15 minutes. */
export function buildBookingSoonList(
  documents: readonly BookingSoonSourceDocument[],
  nowMillis = Date.now(),
): BookingSoonItem[] {
  const deadline = nowMillis + (15 * 60 * 1_000);
  return documents
    .map((document) => {
      const parsed = bookingSoonSchema.safeParse(document.data);
      if (!parsed.success || parsed.data.bookingId !== document.id) {
        throw new Error(`bookings/${document.id} does not match the booking-soon schema`);
      }
      return parsed.data;
    })
    .filter((booking) => booking.status === '已預約')
    .map((booking) => ({ ...booking, checkInMillis: Date.parse(booking.checkInAt) }))
    .filter((booking) => booking.checkInMillis > nowMillis && booking.checkInMillis <= deadline)
    .sort((left, right) => left.checkInMillis - right.checkInMillis)
    .map((booking) => ({
      bookingId: booking.bookingId,
      roomId: booking.roomId,
      guestName: booking.guestName,
      checkInAt: booking.checkInAt,
      minutesUntil: Math.max(0, Math.floor((booking.checkInMillis - nowMillis) / 60_000)),
    }));
}

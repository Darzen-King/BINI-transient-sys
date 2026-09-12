import { z } from 'zod';

export const CLOUD_ACTIVE_BOOKING_STATUSES = ['已預約'] as const;

export interface BookingListSourceDocument {
  id: string;
  data: unknown;
}

export interface BookingListItem {
  bookingId: string;
  roomId: string;
  guestName: string;
  phone: string | null;
  checkInAt: string;
  checkOutAt: string;
  plan: string;
  amountNts: number;
  discountNts: number;
  rateType: string | null;
  status: typeof CLOUD_ACTIVE_BOOKING_STATUSES[number];
}

const dateTimeSchema = z.string().refine((value) => Number.isFinite(Date.parse(value)), 'invalid datetime');
const bookingSchema = z.object({
  bookingId: z.string().trim().min(1).max(128),
  roomId: z.string().trim().min(1).max(128),
  guestName: z.string().trim().min(1).max(300),
  phone: z.string().trim().max(100).nullable().optional(),
  checkInAt: dateTimeSchema,
  checkOutAt: dateTimeSchema,
  plan: z.string().trim().min(1).max(64),
  amountNts: z.number().int().safe(),
  discountNts: z.number().int().safe(),
  rateType: z.string().trim().max(100).nullable().optional(),
  status: z.enum(['已預約', '已取消', 'No-show', '已入住']),
}).passthrough();

/**
 * Builds the same active-reservation list as the v3 booking-management page.
 * The query only changes display filtering; it never becomes an authorization
 * or availability decision.
 */
export function buildActiveBookingList(
  documents: readonly BookingListSourceDocument[],
  query = '',
): BookingListItem[] {
  const normalizedQuery = query.trim().toLocaleLowerCase('zh-TW');
  return documents
    .map((document) => {
      const parsed = bookingSchema.safeParse(document.data);
      if (!parsed.success) throw new Error(`bookings/${document.id} does not match the booking list schema`);
      if (document.id !== parsed.data.bookingId) throw new Error(`bookings/${document.id} identity does not match its document id`);
      return parsed.data;
    })
    .filter((booking): booking is z.infer<typeof bookingSchema> & { status: typeof CLOUD_ACTIVE_BOOKING_STATUSES[number] } => (
      booking.status === '已預約'
    ))
    .filter((booking) => {
      if (!normalizedQuery) return true;
      return [booking.bookingId, booking.roomId, booking.guestName, booking.phone ?? '']
        .some((value) => value.toLocaleLowerCase('zh-TW').includes(normalizedQuery));
    })
    .sort((left, right) => Date.parse(left.checkInAt) - Date.parse(right.checkInAt))
    .map((booking) => ({
      bookingId: booking.bookingId,
      roomId: booking.roomId,
      guestName: booking.guestName,
      phone: booking.phone ?? null,
      checkInAt: booking.checkInAt,
      checkOutAt: booking.checkOutAt,
      plan: booking.plan,
      amountNts: booking.amountNts,
      discountNts: booking.discountNts,
      rateType: booking.rateType ?? null,
      status: booking.status,
    }));
}

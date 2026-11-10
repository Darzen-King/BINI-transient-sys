import { z } from 'zod';

import type { BookingListItem } from './booking-list.js';

/** The store details printed on a reservation certificate; they come from the property document. */
export interface BookingConfirmationProperty {
  name: string;
  address: string | null;
  phone: string | null;
}

export interface BookingConfirmationInput {
  booking: BookingListItem;
  property: BookingConfirmationProperty;
  /** Net deposit already collected for this booking (`bookingDepositTotals`); 0 when nothing is paid. */
  depositPaidNts?: number;
  /** When the certificate is produced, so two copies of the same booking can be told apart. */
  issuedAt: string;
  /** Terms printed at the foot of the certificate, already in the reader's language. */
  notes?: readonly string[];
}

/**
 * Everything a reservation certificate prints, with Taipei-time text alongside the stored
 * timestamps. A guest keeps this document, so it never invents a value: the amounts are the
 * booking's own, and the balance is simply what the deposit has not covered yet.
 */
export interface BookingConfirmationDocument {
  propertyName: string;
  propertyAddress: string | null;
  propertyPhone: string | null;
  bookingId: string;
  guestName: string;
  guestPhone: string | null;
  roomId: string;
  plan: string;
  rateType: string | null;
  checkInAt: string;
  checkOutAt: string;
  /** `YYYY-MM-DD HH:mm` in Asia/Taipei, the same reading as every other BINI screen. */
  checkInText: string;
  checkOutText: string;
  /** Booked length in hours, Taipei time; fractional stays keep one decimal. */
  stayHours: number;
  /** Price before the discount: the booking's payable amount plus its discount. */
  grossAmountNts: number;
  discountNts: number;
  /** What the guest owes for the stay (the booking's stored amount, already net of the discount). */
  payableNts: number;
  depositPaidNts: number;
  balanceDueNts: number;
  issuedAt: string;
  issuedAtText: string;
  notes: readonly string[];
}

const dateTime = z.string().refine((value) => Number.isFinite(Date.parse(value)), 'invalid datetime');
const inputSchema = z.object({
  booking: z.object({
    bookingId: z.string().trim().min(1).max(128),
    roomId: z.string().trim().min(1).max(128),
    guestName: z.string().trim().min(1).max(300),
    phone: z.string().trim().max(100).nullable().optional(),
    checkInAt: dateTime,
    checkOutAt: dateTime,
    plan: z.string().trim().min(1).max(64),
    amountNts: z.number().int().safe().min(0),
    discountNts: z.number().int().safe().min(0),
    rateType: z.string().trim().max(100).nullable().optional(),
    status: z.string(),
  }).passthrough(),
  property: z.object({
    name: z.string().trim().min(1).max(200),
    address: z.string().trim().max(1_000).nullable().optional(),
    phone: z.string().trim().max(100).nullable().optional(),
  }).passthrough(),
  depositPaidNts: z.number().int().safe().min(0).optional(),
  issuedAt: dateTime,
  notes: z.array(z.string().trim().min(1).max(500)).max(20).optional(),
}).passthrough();

const taipeiDateTime = (value: string): string => {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Taipei',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(value)).map((part) => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}`;
};

const HOUR_MS = 60 * 60 * 1_000;

/**
 * Projects an active booking into the reservation certificate a guest takes away. A cancelled or
 * checked-in booking is refused: the certificate would claim a reservation that no longer stands.
 */
export function buildBookingConfirmation(input: BookingConfirmationInput): BookingConfirmationDocument {
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) throw new Error('booking confirmation input is not valid');
  const { booking, property } = parsed.data;
  if (booking.status !== '已預約') throw new Error('only an active booking has a reservation certificate');
  const checkIn = Date.parse(booking.checkInAt);
  const checkOut = Date.parse(booking.checkOutAt);
  if (checkOut <= checkIn) throw new Error('booking check-out is not after its check-in');

  const depositPaidNts = parsed.data.depositPaidNts ?? 0;
  const payableNts = booking.amountNts;
  return {
    propertyName: property.name,
    propertyAddress: property.address?.trim() ? property.address.trim() : null,
    propertyPhone: property.phone?.trim() ? property.phone.trim() : null,
    bookingId: booking.bookingId,
    guestName: booking.guestName,
    guestPhone: booking.phone?.trim() ? booking.phone.trim() : null,
    roomId: booking.roomId,
    plan: booking.plan,
    rateType: booking.rateType?.trim() ? booking.rateType.trim() : null,
    checkInAt: booking.checkInAt,
    checkOutAt: booking.checkOutAt,
    checkInText: taipeiDateTime(booking.checkInAt),
    checkOutText: taipeiDateTime(booking.checkOutAt),
    stayHours: Math.round(((checkOut - checkIn) / HOUR_MS) * 10) / 10,
    grossAmountNts: payableNts + booking.discountNts,
    discountNts: booking.discountNts,
    payableNts,
    depositPaidNts,
    balanceDueNts: Math.max(0, payableNts - depositPaidNts),
    issuedAt: parsed.data.issuedAt,
    issuedAtText: taipeiDateTime(parsed.data.issuedAt),
    notes: parsed.data.notes ?? [],
  };
}

/** A printable file name a guest can recognise, e.g. `BINI-預約證明-RSV-live-203.pdf`. */
export function bookingConfirmationFileName(document: Pick<BookingConfirmationDocument, 'bookingId'>, label = '預約證明'): string {
  const safeId = document.bookingId.replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'booking';
  return `BINI-${label}-${safeId}`;
}

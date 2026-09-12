import { z } from 'zod';

export const BOOKING_PLANS = ['12hrs', '24hrs'] as const;
export const BOOKING_PAYMENT_TYPES = ['cash', 'transfer', 'card', 'other'] as const;
export const BOOKING_STATUSES = ['已預約', '已取消', 'No-show', '已入住'] as const;

export type BookingPlan = (typeof BOOKING_PLANS)[number];
export type BookingPaymentType = (typeof BOOKING_PAYMENT_TYPES)[number];

const propertyIdSchema = z.string().trim().min(1).max(128).regex(/^[^/]+$/);
const operationIdSchema = z.string().uuid();
const roomIdSchema = z.string().trim().min(1).max(128).regex(/^[^/]+$/);
const bookingIdSchema = z.string().trim().min(1).max(128).regex(/^[^/]+$/);
const ntsAmountSchema = z.number().int().safe().min(0).max(100_000_000);
const dateTimeSchema = z.string().trim().min(20).max(64).regex(
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/,
  '日期時間必須是帶時區的 ISO 格式。',
).refine(
  (value) => Number.isFinite(Date.parse(value)),
  '日期時間格式不正確。',
);

export const bookingCreateInputSchema = z.object({
  propertyId: propertyIdSchema,
  operationId: operationIdSchema,
  roomId: roomIdSchema,
  guestName: z.string().trim().min(1).max(300),
  phone: z.string().trim().max(100).nullable().optional(),
  checkInAt: dateTimeSchema,
  plan: z.enum(BOOKING_PLANS),
  days: z.number().int().min(1).max(366),
  discountNts: ntsAmountSchema,
  pricingMode: z.enum(['automatic', 'manual']),
  manualAmountNts: ntsAmountSchema.optional(),
  deposit: z.object({
    amountNts: ntsAmountSchema.min(1),
    paymentType: z.enum(BOOKING_PAYMENT_TYPES),
  }).strict().nullable().optional(),
}).strict().superRefine((input, context) => {
  if (input.pricingMode === 'manual' && input.manualAmountNts === undefined) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['manualAmountNts'],
      message: '手動金額模式必須提供金額。',
    });
  }
  if (input.pricingMode === 'automatic' && input.manualAmountNts !== undefined) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['manualAmountNts'],
      message: '自動計價不可附帶手動金額。',
    });
  }
});

export type BookingCreateInput = z.infer<typeof bookingCreateInputSchema>;

export const bookingCreateResultSchema = z.object({
  status: z.enum(['created', 'replayed']),
  bookingId: z.string().min(1).max(128),
  paymentId: z.string().min(1).max(128).nullable(),
  checkInAt: dateTimeSchema,
  checkOutAt: dateTimeSchema,
  amountNts: ntsAmountSchema,
  discountNts: ntsAmountSchema,
  rateType: z.enum(['非假日', '假日']),
}).strict();

export type BookingCreateResult = z.infer<typeof bookingCreateResultSchema>;

export const bookingCancelInputSchema = z.object({
  propertyId: propertyIdSchema,
  operationId: operationIdSchema,
  bookingId: bookingIdSchema,
}).strict();

export type BookingCancelInput = z.infer<typeof bookingCancelInputSchema>;

export const bookingCancelResultSchema = z.object({
  status: z.enum(['cancelled', 'replayed']),
  bookingId: bookingIdSchema,
  cancelledAt: dateTimeSchema,
}).strict();

export type BookingCancelResult = z.infer<typeof bookingCancelResultSchema>;

export interface BookingHolidayCalendar {
  /** Explicit values from the property holiday collection, keyed YYYY-MM-DD. */
  readonly days: ReadonlyMap<string, boolean>;
  /** Mirrors v3's "more than three rows for this year" database-cache behaviour. */
  readonly coveredYears: ReadonlySet<number>;
}

export interface BookingQuote {
  checkInAt: string;
  checkOutAt: string;
  grossAmountNts: number;
  amountNts: number;
  discountNts: number;
  rateType: '非假日' | '假日';
}

export interface BookingAvailabilityCandidate {
  id: string;
  source: 'booking' | 'stay' | 'maintenance';
  roomId: string;
  startAt: string;
  endAt: string;
  status: string;
  guestName: string | null;
}

export interface BookingAvailabilityConflict {
  id: string;
  source: BookingAvailabilityCandidate['source'];
  status: string;
  guestName: string | null;
  startAt: string;
  endAt: string;
}

const V3_STATIC_HOLIDAY_DATES = new Set([
  '2025-01-01', '2025-01-27', '2025-01-28', '2025-01-29', '2025-01-30', '2025-01-31', '2025-02-03',
  '2025-02-28', '2025-04-03', '2025-04-04', '2025-05-01', '2025-06-02', '2025-09-03', '2025-10-06', '2025-10-10',
  '2026-01-01', '2026-02-15', '2026-02-17', '2026-02-18', '2026-02-19', '2026-02-27', '2026-04-03', '2026-04-04',
  '2026-05-01', '2026-06-19', '2026-09-25', '2026-09-28', '2026-10-09', '2026-10-26', '2026-12-25',
]);

function taipeiDayKey(timestamp: number): string {
  const pieces = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Taipei',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(timestamp));
  const value = Object.fromEntries(pieces.map((piece) => [piece.type, piece.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

function nextDayKey(dayKey: string): string {
  const next = new Date(`${dayKey}T12:00:00+08:00`);
  return taipeiDayKey(next.getTime() + 24 * 60 * 60 * 1_000);
}

function weekdayForDayKey(dayKey: string): number {
  return new Date(`${dayKey}T12:00:00+08:00`).getUTCDay();
}

/**
 * v3 holiday semantics, including explicit property cache overrides and the
 * static fallback used when a year has not been imported/configured yet.
 */
export function isV3Holiday(dayKey: string, calendar: BookingHolidayCalendar): boolean {
  const weekday = weekdayForDayKey(dayKey);
  if (weekday === 0 || weekday === 6) return true;

  const explicit = calendar.days.get(dayKey);
  if (explicit !== undefined) return explicit;

  const tomorrow = nextDayKey(dayKey);
  if (calendar.days.get(tomorrow) === true) return true;
  if (calendar.coveredYears.has(Number(dayKey.slice(0, 4)))) return weekday === 5;

  return weekday === 5 || V3_STATIC_HOLIDAY_DATES.has(dayKey) || V3_STATIC_HOLIDAY_DATES.has(tomorrow);
}

export function quoteBooking(input: BookingCreateInput, calendar: BookingHolidayCalendar): BookingQuote {
  const checkInMillis = Date.parse(input.checkInAt);
  const planHours = input.plan === '12hrs' ? 12 : 24;
  const blockCount = (planHours * input.days) / 12;
  let grossAmountNts = 0;

  for (let block = 0; block < blockCount; block += 1) {
    const blockHoliday = isV3Holiday(
      taipeiDayKey(checkInMillis + (block * 12 * 60 * 60 * 1_000)),
      calendar,
    );
    const twelveHourRate = blockHoliday ? 1_000 : 800;
    const twentyFourHourRate = blockHoliday ? 1_200 : 1_000;
    grossAmountNts += block % 2 === 0 ? twelveHourRate : twentyFourHourRate - twelveHourRate;
  }

  const checkOutAt = new Date(checkInMillis + (planHours * input.days * 60 * 60 * 1_000)).toISOString();
  return {
    checkInAt: new Date(checkInMillis).toISOString(),
    checkOutAt,
    grossAmountNts,
    amountNts: input.pricingMode === 'manual'
      ? input.manualAmountNts as number
      : Math.max(0, grossAmountNts - input.discountNts),
    discountNts: input.discountNts,
    rateType: isV3Holiday(taipeiDayKey(checkInMillis), calendar) ? '假日' : '非假日',
  };
}

export function findBookingAvailabilityConflict(
  roomId: string,
  checkInAt: string,
  checkOutAt: string,
  candidates: readonly BookingAvailabilityCandidate[],
): BookingAvailabilityConflict | null {
  const requestedStart = Date.parse(checkInAt);
  const requestedEnd = Date.parse(checkOutAt);
  if (!Number.isFinite(requestedStart) || !Number.isFinite(requestedEnd) || requestedEnd <= requestedStart) {
    throw new Error('預約時間區間無效。');
  }

  for (const candidate of candidates) {
    if (candidate.roomId !== roomId) continue;
    const candidateStart = Date.parse(candidate.startAt);
    const candidateEnd = Date.parse(candidate.endAt);
    if (!Number.isFinite(candidateStart) || !Number.isFinite(candidateEnd) || candidateEnd <= candidateStart) {
      throw new Error(`衝突來源 ${candidate.source}/${candidate.id} 的時間區間無效。`);
    }
    if (candidateStart < requestedEnd && candidateEnd > requestedStart) {
      return {
        id: candidate.id,
        source: candidate.source,
        status: candidate.status,
        guestName: candidate.guestName,
        startAt: candidate.startAt,
        endAt: candidate.endAt,
      };
    }
  }
  return null;
}

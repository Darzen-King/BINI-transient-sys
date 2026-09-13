import type { BookingHolidayCalendar } from '../contracts/booking-operations.js';
import { isV3Holiday } from '../contracts/booking-operations.js';

export interface StayExtensionBreakdownRow {
  block: number;
  date: string;
  rateType: 'holiday' | 'weekday';
  ceilingNts: number;
  hours: number;
  feeNts: number;
}

export interface StayExtensionQuote {
  extensionHours: number;
  fromHours: number;
  toHours: number;
  extensionFeeNts: number;
  breakdown: StayExtensionBreakdownRow[];
}

const HOUR_MS = 60 * 60 * 1_000;
const BLOCK_HOURS = 12;
const HOURLY_RATE_NTS = 200;

function taipeiDayKey(timestamp: number): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date(timestamp));
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function blockCeiling(checkInMillis: number, block: number, calendar: BookingHolidayCalendar): { ceilingNts: number; rateType: 'holiday' | 'weekday'; date: string } {
  const date = taipeiDayKey(checkInMillis + (block * BLOCK_HOURS * HOUR_MS));
  const holiday = isV3Holiday(date, calendar);
  const twelveHourRate = holiday ? 1_000 : 800;
  const twentyFourHourRate = holiday ? 1_200 : 1_000;
  return { date, rateType: holiday ? 'holiday' : 'weekday', ceilingNts: block % 2 === 0 ? twelveHourRate : twentyFourHourRate - twelveHourRate };
}

function totalStayCharge(checkInMillis: number, totalHours: number, calendar: BookingHolidayCalendar): number {
  if (totalHours <= 0) return 0;
  let remaining = totalHours;
  let total = 0;
  for (let block = 0; remaining > 0; block += 1) {
    const hours = Math.min(remaining, BLOCK_HOURS);
    const { ceilingNts } = blockCeiling(checkInMillis, block, calendar);
    total += Math.min(HOURLY_RATE_NTS * hours, ceilingNts);
    remaining -= hours;
  }
  return Math.round(total);
}

/**
 * Mirrors v3 extension_fee_between: charges are accumulated from check-in so
 * a 12hr stay extended to 24hr is billed the 24hr gap, not a new 12hr block.
 */
export function quoteStayExtension(checkInAt: string, currentCheckOutAt: string, extensionHours: number, calendar: BookingHolidayCalendar): StayExtensionQuote {
  const checkInMillis = Date.parse(checkInAt);
  const currentCheckOutMillis = Date.parse(currentCheckOutAt);
  if (!Number.isFinite(checkInMillis) || !Number.isFinite(currentCheckOutMillis) || currentCheckOutMillis <= checkInMillis) throw new Error('在住房日期區間無效。');
  if (!Number.isFinite(extensionHours) || extensionHours <= 0) throw new Error('延住時數必須大於零。');
  const fromHours = (currentCheckOutMillis - checkInMillis) / HOUR_MS;
  const toHours = fromHours + extensionHours;
  const extensionFeeNts = Math.max(0, totalStayCharge(checkInMillis, toHours, calendar) - totalStayCharge(checkInMillis, fromHours, calendar));
  const breakdown: StayExtensionBreakdownRow[] = [];
  for (let block = Math.floor(fromHours / BLOCK_HOURS); block <= Math.floor((toHours - Number.EPSILON) / BLOCK_HOURS); block += 1) {
    const start = Math.max(fromHours, block * BLOCK_HOURS);
    const end = Math.min(toHours, (block + 1) * BLOCK_HOURS);
    if (end <= start) continue;
    const { date, rateType, ceilingNts } = blockCeiling(checkInMillis, block, calendar);
    const feeBefore = Math.min(HOURLY_RATE_NTS * (start - (block * BLOCK_HOURS)), ceilingNts);
    const feeAfter = Math.min(HOURLY_RATE_NTS * (end - (block * BLOCK_HOURS)), ceilingNts);
    breakdown.push({ block: breakdown.length + 1, date, rateType, ceilingNts, hours: end - start, feeNts: Math.round(feeAfter - feeBefore) });
  }
  return { extensionHours, fromHours, toHours, extensionFeeNts, breakdown };
}

export interface StayCheckoutOverdueQuote {
  overdue: boolean;
  /** Whole minutes past the grace window, as the v3 overdue dialog shows. */
  overdueMinutes: number;
  /** Billable hours past the current check-out, rounded up to whole hours. */
  overdueHours: number;
  systemOverdueFeeNts: number;
  totalExtensionFeeNts: number;
}

const GRACE_MS = 15 * 60 * 1_000;

/**
 * v3 `/api/overdue-check`: a 15-minute grace period after the CURRENT (possibly extended) check-out,
 * then the stay is rounded up to whole hours (store rule: no half-hour billing) and only the timeline charge beyond that check-out is added.
 */
export function quoteStayCheckoutOverdue(checkInAt: string, currentCheckOutAt: string, currentExtensionFeeNts: number, checkedOutAt: string, calendar: BookingHolidayCalendar): StayCheckoutOverdueQuote {
  const checkInMillis = Date.parse(checkInAt);
  const currentCheckOutMillis = Date.parse(currentCheckOutAt);
  const checkedOutMillis = Date.parse(checkedOutAt);
  if (![checkInMillis, currentCheckOutMillis, checkedOutMillis].every(Number.isFinite) || currentCheckOutMillis <= checkInMillis) throw new Error('在住房日期區間無效。');
  const pastGraceMs = checkedOutMillis - (currentCheckOutMillis + GRACE_MS);
  if (pastGraceMs <= 0) return { overdue: false, overdueMinutes: 0, overdueHours: 0, systemOverdueFeeNts: 0, totalExtensionFeeNts: currentExtensionFeeNts };
  const totalStayHours = Math.ceil((checkedOutMillis - checkInMillis) / HOUR_MS);
  const plannedHours = (currentCheckOutMillis - checkInMillis) / HOUR_MS;
  const systemOverdueFeeNts = Math.max(0, totalStayCharge(checkInMillis, totalStayHours, calendar) - totalStayCharge(checkInMillis, plannedHours, calendar));
  return { overdue: true, overdueMinutes: Math.round(pastGraceMs / 60_000), overdueHours: Math.round((totalStayHours - plannedHours) * 100) / 100, systemOverdueFeeNts, totalExtensionFeeNts: currentExtensionFeeNts + systemOverdueFeeNts };
}

/** v3 `/api/overdue-correction-preview`: staff enter the real hours past the current check-out (0 = forgot to check out). */
export function quoteStayCheckoutCorrection(checkInAt: string, currentCheckOutAt: string, correctionHours: number, calendar: BookingHolidayCalendar): number {
  const checkInMillis = Date.parse(checkInAt);
  const currentCheckOutMillis = Date.parse(currentCheckOutAt);
  if (!Number.isFinite(checkInMillis) || !Number.isFinite(currentCheckOutMillis) || currentCheckOutMillis <= checkInMillis) throw new Error('在住房日期區間無效。');
  const plannedHours = (currentCheckOutMillis - checkInMillis) / HOUR_MS;
  // A partial hour is billed as a full hour.
  const correction = Number.isFinite(correctionHours) ? Math.ceil(Math.max(0, correctionHours)) : 0;
  return Math.max(0, totalStayCharge(checkInMillis, plannedHours + correction, calendar) - totalStayCharge(checkInMillis, plannedHours, calendar));
}

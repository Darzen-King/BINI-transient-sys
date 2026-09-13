import type { BookingHolidayCalendar } from '../contracts/booking-operations.js';

/** Builds the v3 holiday calendar from `holidays` documents; malformed or duplicate days fail closed. */
export function buildHolidayCalendar(documents: readonly { id: string; data: unknown }[]): BookingHolidayCalendar {
  const days = new Map<string, boolean>();
  const countByYear = new Map<number, number>();
  for (const document of documents) {
    const data = (typeof document.data === 'object' && document.data !== null ? document.data : {}) as Record<string, unknown>;
    const { date, holiday, year } = data;
    if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/u.test(date) || typeof holiday !== 'boolean' || typeof year !== 'number' || !Number.isSafeInteger(year) || String(year) !== date.slice(0, 4) || days.has(date)) {
      throw new Error(`holidays/${document.id} 資料格式不正確。`);
    }
    days.set(date, holiday);
    countByYear.set(year, (countByYear.get(year) ?? 0) + 1);
  }
  return { days, coveredYears: new Set([...countByYear].filter(([, count]) => count > 3).map(([year]) => year)) };
}

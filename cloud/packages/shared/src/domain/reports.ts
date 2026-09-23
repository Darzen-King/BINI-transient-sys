import { z } from 'zod';

import { isV3Holiday } from '../contracts/booking-operations.js';
import { buildHolidayCalendar } from './holiday-calendar.js';

export interface ReportSourceDocument { id: string; data: unknown; }
export interface ReportSource {
  rooms: readonly ReportSourceDocument[];
  bookings: readonly ReportSourceDocument[];
  stays: readonly ReportSourceDocument[];
  stayLogs: readonly ReportSourceDocument[];
  monthlyRentals: readonly ReportSourceDocument[];
  costEntries?: readonly ReportSourceDocument[];
  /** Property holiday cache; without it the v3 static fallback decides weekday vs holiday stays. */
  holidays?: readonly ReportSourceDocument[];
}

export interface ReportRange { dateFrom: string; dateTo: string; includeCosts: boolean; }
export interface ReportRoomRental { roomId: string; status: string; note: string | null; count: number; revenueNts: number; plans: Record<string, number>; }
export interface ReportDailyItem { date: string; revenueNts: number; occupancyPct: number; }
export interface ReportProjection {
  dateFrom: string; dateTo: string; days: number; rangeRevenueNts: number; staylogRevenueNts: number; monthlyRevenueNts: number;
  bookingRevenueNts: number; liveRevenueNts: number; totalOrders: number; cancelledOrders: number; totalRooms: number; occupiedNow: number;
  occupancyNowPct: number; rangeOccupancyPct: number; repairCount: number; avgStayHours: number; activeStaysCount: number;
  daily: ReportDailyItem[]; planCounts: Record<string, number>; planRevenueNts: Record<string, number>; roomRentals: ReportRoomRental[];
  bookingStatusCounts: Record<string, number>; roomStatusCounts: Record<string, number>; rateRevenueNts: Record<'非假日' | '假日', number>;
  totalCostNts: number | null; netProfitNts: number | null; costRatioPct: number | null; costByCategoryNts: Record<string, number> | null;
  /** Individual cost rows inside the range (admins only); null when costs are excluded. */
  costEntries: ReportCostEntry[] | null;
}

export interface ReportCostEntry { costDate: string; category: string; amountNts: number; paymentMethod: string | null; vendor: string | null; description: string | null; note: string | null; }

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/u);
const dateTime = z.string().refine((value) => Number.isFinite(Date.parse(value)), 'invalid datetime');
const nullableDateTime = dateTime.nullable().optional();
const text = z.string().trim().min(1);
const nullableText = z.string().nullable().optional();
const amount = z.number().int().safe().min(0);
const roomSchema = z.object({ roomId: text, status: text, note: nullableText }).passthrough();
const bookingSchema = z.object({ bookingId: text, roomId: text, checkInAt: dateTime, plan: text, amountNts: amount, status: text, rateType: nullableText }).passthrough();
const staySchema = z.object({ roomId: text, totalDueNts: amount.optional() }).passthrough();
// Missing flags mean "no", as in v3's stay_logs defaults; older cloud check-outs omitted `transferred`.
const stayLogSchema = z.object({ roomId: text, plan: nullableText, checkInAt: nullableDateTime, totalChargedNts: amount, freeCancel: z.boolean().default(false), transferred: z.boolean().default(false) }).passthrough();
const monthlySchema = z.object({ roomId: text, rentNts: amount, createdAt: nullableDateTime, status: z.string().optional() }).passthrough();
const costSchema = z.object({ costDate: day, category: text, amountNts: amount, status: z.enum(['active', 'archived']).optional(), vendor: nullableText, description: nullableText, note: nullableText, paymentMethod: nullableText }).passthrough();

function localDay(value: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(value));
  const item = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${item.year}-${item.month}-${item.day}`;
}
function dateInRange(value: string | null | undefined, from: string, to: string): boolean {
  return Boolean(value && localDay(value) >= from && localDay(value) <= to);
}
function dateList(from: string, to: string): string[] {
  const output: string[] = [];
  for (let point = Date.parse(`${from}T00:00:00+08:00`), end = Date.parse(`${to}T00:00:00+08:00`); point <= end; point += 86_400_000) output.push(localDay(new Date(point).toISOString()));
  return output;
}
function parse<T>(documents: readonly ReportSourceDocument[], schema: z.ZodType<T>, name: string): Array<{ id: string; data: T }> {
  return documents.map((document) => {
    const result = schema.safeParse(document.data);
    if (!result.success) throw new Error(`${name}/${document.id} does not match the report schema`);
    return { id: document.id, data: result.data };
  });
}
function percentage(numerator: number, denominator: number): number { return denominator ? Math.round((numerator / denominator) * 1_000) / 10 : 0; }
function planHours(plan: string | null | undefined): number { return plan === '12hrs' ? 12 : 24; }

/** v3-compatible operational report. Revenue is completed stays plus recognised monthly rent, never booking forecasts. */
export function buildReportProjection(source: ReportSource, range: ReportRange): ReportProjection {
  if (!day.safeParse(range.dateFrom).success || !day.safeParse(range.dateTo).success || range.dateFrom > range.dateTo) throw new Error('report date range is invalid');
  const rooms = parse(source.rooms, roomSchema, 'rooms');
  const bookings = parse(source.bookings, bookingSchema, 'bookings');
  const stays = parse(source.stays, staySchema, 'stays');
  const stayLogs = parse(source.stayLogs, stayLogSchema, 'stayLogs');
  const monthlyRentals = parse(source.monthlyRentals, monthlySchema, 'monthlyRentals');
  const calendar = buildHolidayCalendar(source.holidays ?? []);
  const costs = range.includeCosts ? parse(source.costEntries ?? [], costSchema, 'costEntries') : [];
  const inRangeBookings = bookings.filter(({ data }) => dateInRange(data.checkInAt, range.dateFrom, range.dateTo));
  const activeBookings = inRangeBookings.filter(({ data }) => !['已取消', 'No-show', '已入住'].includes(data.status));
  const cancelledOrders = inRangeBookings.length - activeBookings.length;
  const eligibleLogs = stayLogs.filter(({ data }) => !data.freeCancel && !data.transferred && dateInRange(data.checkInAt, range.dateFrom, range.dateTo));
  // A voided record (a duplicate from a double-tapped renewal) never counts, in any period.
  const recognisedMonthly = monthlyRentals.filter(({ data }) => data.status !== 'voided' && dateInRange(data.createdAt, range.dateFrom, range.dateTo));
  const staylogRevenueNts = eligibleLogs.reduce((total, { data }) => total + data.totalChargedNts, 0);
  const monthlyRevenueNts = recognisedMonthly.reduce((total, { data }) => total + data.rentNts, 0);
  const bookingRevenueNts = activeBookings.reduce((total, { data }) => total + data.amountNts, 0);
  const totalRooms = rooms.length;
  const occupiedNow = rooms.filter(({ data }) => ['使用中', '即將退房', '月租套房'].includes(data.status)).length;
  const roomsWithActivity = new Set([...activeBookings.map(({ data }) => data.roomId), ...eligibleLogs.map(({ data }) => data.roomId)]);
  const hours = [...activeBookings.map(({ data }) => planHours(data.plan)), ...eligibleLogs.map(({ data }) => planHours(data.plan))];
  const planCounts: Record<string, number> = {}; const planRevenueNts: Record<string, number> = {};
  for (const { data } of activeBookings) { planCounts[data.plan] = (planCounts[data.plan] ?? 0) + 1; planRevenueNts[data.plan] = (planRevenueNts[data.plan] ?? 0) + data.amountNts; }
  for (const { data } of eligibleLogs) { const plan = data.plan ?? '24hrs'; planCounts[plan] = (planCounts[plan] ?? 0) + 1; planRevenueNts[plan] = (planRevenueNts[plan] ?? 0) + data.totalChargedNts; }
  const rentalByRoom = new Map<string, ReportRoomRental>(rooms.map(({ data }) => [data.roomId, { roomId: data.roomId, status: data.status, note: data.note ?? null, count: 0, revenueNts: 0, plans: {} }]));
  const rental = (roomId: string) => { const existing = rentalByRoom.get(roomId); if (existing) return existing; const created: ReportRoomRental = { roomId, status: '—', note: null, count: 0, revenueNts: 0, plans: {} }; rentalByRoom.set(roomId, created); return created; };
  for (const { data } of activeBookings) { const item = rental(data.roomId); item.count += 1; item.revenueNts += data.amountNts; item.plans[data.plan] = (item.plans[data.plan] ?? 0) + 1; }
  for (const { data } of eligibleLogs) { const item = rental(data.roomId); const plan = data.plan ?? '24hrs'; item.count += 1; item.revenueNts += data.totalChargedNts; item.plans[plan] = (item.plans[plan] ?? 0) + 1; }
  for (const { data } of recognisedMonthly) { const item = rental(data.roomId); item.count += 1; item.revenueNts += data.rentNts; item.plans['月租'] = (item.plans['月租'] ?? 0) + 1; }
  const daily = dateList(range.dateFrom, range.dateTo).map((date) => { const dayBookings = activeBookings.filter(({ data }) => localDay(data.checkInAt) === date); const dayLogs = eligibleLogs.filter(({ data }) => data.checkInAt && localDay(data.checkInAt) === date); return { date, revenueNts: dayBookings.reduce((total, { data }) => total + data.amountNts, 0) + dayLogs.reduce((total, { data }) => total + data.totalChargedNts, 0), occupancyPct: percentage(dayBookings.length, totalRooms) }; });
  const activeCosts = costs.filter(({ data }) => data.status !== 'archived' && data.costDate >= range.dateFrom && data.costDate <= range.dateTo);
  const totalCostNts = range.includeCosts ? activeCosts.reduce((total, { data }) => total + data.amountNts, 0) : null;
  const costByCategoryNts = range.includeCosts ? activeCosts.reduce<Record<string, number>>((total, { data }) => ({ ...total, [data.category]: (total[data.category] ?? 0) + data.amountNts }), {}) : null;
  // Every cost row in range (admins only) so the export and the page can list them, not just the totals.
  const costEntries = range.includeCosts
    ? [...activeCosts].sort((left, right) => left.data.costDate.localeCompare(right.data.costDate)).map(({ data }) => ({ costDate: data.costDate, category: data.category, amountNts: data.amountNts, paymentMethod: data.paymentMethod ?? null, vendor: data.vendor ?? null, description: data.description ?? null, note: data.note ?? null }))
    : null;
  const rangeRevenueNts = staylogRevenueNts + monthlyRevenueNts;
  const bookingStatusCounts: Record<string, number> = {};
  for (const { data } of inRangeBookings) bookingStatusCounts[data.status] = (bookingStatusCounts[data.status] ?? 0) + 1;
  const roomStatusCounts: Record<string, number> = {};
  for (const { data } of rooms) roomStatusCounts[data.status] = (roomStatusCounts[data.status] ?? 0) + 1;
  // v3: bookings keep their quoted rate type; completed stays derive it from the check-in date.
  const rateRevenueNts: Record<'非假日' | '假日', number> = { 非假日: 0, 假日: 0 };
  for (const { data } of activeBookings) rateRevenueNts[data.rateType === '假日' ? '假日' : '非假日'] += data.amountNts;
  for (const { data } of eligibleLogs) if (data.checkInAt) rateRevenueNts[isV3Holiday(localDay(data.checkInAt), calendar) ? '假日' : '非假日'] += data.totalChargedNts;
  const liveRevenueNts = stays.reduce((total, { data }) => total + (data.totalDueNts ?? 0), 0);
  return { dateFrom: range.dateFrom, dateTo: range.dateTo, days: daily.length, rangeRevenueNts, staylogRevenueNts, monthlyRevenueNts, bookingRevenueNts, liveRevenueNts, totalOrders: activeBookings.length + eligibleLogs.length + recognisedMonthly.length, cancelledOrders, totalRooms, occupiedNow, occupancyNowPct: percentage(occupiedNow, totalRooms), rangeOccupancyPct: percentage(roomsWithActivity.size, totalRooms), repairCount: rooms.filter(({ data }) => data.status === '維修中').length, avgStayHours: hours.length ? Math.round((hours.reduce((total, value) => total + value, 0) / hours.length) * 10) / 10 : 0, activeStaysCount: stays.length, daily, planCounts, planRevenueNts, roomRentals: [...rentalByRoom.values()].sort((left, right) => right.count - left.count || left.roomId.localeCompare(right.roomId)), bookingStatusCounts, roomStatusCounts, rateRevenueNts, totalCostNts, netProfitNts: totalCostNts === null ? null : rangeRevenueNts - totalCostNts, costRatioPct: totalCostNts === null ? null : percentage(totalCostNts, rangeRevenueNts), costByCategoryNts, costEntries };
}

function csvCell(value: string | number): string { const rendered = String(value); return /[",\r\n]/u.test(rendered) ? `"${rendered.replaceAll('"', '""')}"` : rendered; }
function csvRow(values: readonly (string | number)[]): string { return values.map(csvCell).join(','); }

/** UTF-8 BOM keeps the manager/admin export directly usable in Excel. */
export function renderReportCsv(report: ReportProjection): string {
  const rows: string[] = [
    csvRow(['=== BINI Blooms Report ===']),
    csvRow(['Period', `${report.dateFrom} ~ ${report.dateTo} (${report.days} days)`]),
    csvRow(['Total Revenue (NT$)', report.rangeRevenueNts]),
    csvRow(['Total Orders', report.totalOrders]),
    csvRow(['Cancelled', report.cancelledOrders]),
    csvRow(['Occupancy Now (%)', report.occupancyNowPct]),
    csvRow(['Period Occupancy (%)', report.rangeOccupancyPct]),
    csvRow(['Avg Stay (hrs)', report.avgStayHours]),
    csvRow(['Repairs', report.repairCount]), '',
    csvRow(['=== Daily Breakdown ===']), csvRow(['Date', 'Revenue (NT$)', 'Occupancy (%)']),
    ...report.daily.map((item) => csvRow([item.date, item.revenueNts, item.occupancyPct])), '',
    csvRow(['=== Per-Room Statistics ===']), csvRow(['Room', 'Status', 'Rentals', 'Revenue (NT$)', '12hrs', '24hrs', 'Note']),
    ...report.roomRentals.map((item) => csvRow([item.roomId, item.status, item.count, item.revenueNts, item.plans['12hrs'] ?? 0, item.plans['24hrs'] ?? 0, item.note ?? ''])),
  ];
  // Costs are admin-only: they are present exactly when the caller asked for them.
  if (report.totalCostNts !== null) {
    rows.push(
      '',
      csvRow(['=== Costs & Profit ===']),
      csvRow(['Total Cost (NT$)', report.totalCostNts]),
      csvRow(['Net Profit (NT$)', report.netProfitNts ?? 0]),
      csvRow(['Cost Ratio (%)', report.costRatioPct ?? 0]),
      '',
      csvRow(['=== Cost by Category ===']), csvRow(['Category', 'Amount (NT$)']),
      ...Object.entries(report.costByCategoryNts ?? {}).map(([category, value]) => csvRow([category, value])),
      '',
      csvRow(['=== Cost Entries ===']), csvRow(['Date', 'Category', 'Amount (NT$)', 'Payment', 'Vendor', 'Description', 'Note']),
      ...(report.costEntries ?? []).map((item) => csvRow([item.costDate, item.category, item.amountNts, item.paymentMethod ?? '', item.vendor ?? '', item.description ?? '', item.note ?? ''])),
    );
  }
  return `\uFEFF${rows.join('\r\n')}\r\n`;
}

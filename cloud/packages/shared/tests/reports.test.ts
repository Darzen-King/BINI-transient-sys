import { describe, expect, it } from 'vitest';
import { buildReportProjection } from '@bini/cloud-shared';

const source = {
  rooms: [
    { id: '201', data: { roomId: '201', status: '使用中', note: null } },
    { id: '202', data: { roomId: '202', status: '維修中', note: '漏水' } },
  ],
  bookings: [
    { id: 'B1', data: { bookingId: 'B1', roomId: '201', checkInAt: '2026-09-10T15:00:00+08:00', plan: '24hrs', amountNts: 1_200, status: '已預約', rateType: '非假日' } },
    { id: 'B2', data: { bookingId: 'B2', roomId: '202', checkInAt: '2026-09-11T15:00:00+08:00', plan: '12hrs', amountNts: 800, status: '已入住', rateType: '非假日' } },
  ],
  stays: [{ id: '201', data: { roomId: '201' } }],
  stayLogs: [
    { id: 'S1', data: { roomId: '201', checkInAt: '2026-09-10T15:00:00+08:00', plan: '24hrs', totalChargedNts: 1_300, freeCancel: false, transferred: false } },
    { id: 'S2', data: { roomId: '202', checkInAt: '2026-09-11T15:00:00+08:00', plan: '12hrs', totalChargedNts: 800, freeCancel: true, transferred: false } },
  ],
  monthlyRentals: [{ id: 'M1', data: { roomId: '202', rentNts: 8_000, createdAt: '2026-09-11T10:00:00+08:00' } }],
  costEntries: [
    { id: 'C1', data: { costDate: '2026-09-10', category: 'utilities', amountNts: 500 } },
    { id: 'C2', data: { costDate: '2026-09-11', category: 'maintenance', amountNts: 300, status: 'archived' } },
  ],
} as const;

describe('v3-compatible reports', () => {
  it('counts only completed stay and recognised monthly rent as period revenue', () => {
    const report = buildReportProjection(source, { dateFrom: '2026-09-10', dateTo: '2026-09-11', includeCosts: true });
    expect(report.rangeRevenueNts).toBe(9_300);
    expect(report.bookingRevenueNts).toBe(1_200);
    expect(report.totalOrders).toBe(3);
    expect(report.cancelledOrders).toBe(1);
    expect(report.totalCostNts).toBe(500);
    expect(report.netProfitNts).toBe(8_800);
    expect(report.costByCategoryNts).toEqual({ utilities: 500 });
  });

  it('does not expose cost or P&L values when costs are excluded', () => {
    const report = buildReportProjection(source, { dateFrom: '2026-09-10', dateTo: '2026-09-11', includeCosts: false });
    expect(report.totalCostNts).toBeNull();
    expect(report.netProfitNts).toBeNull();
    expect(report.costByCategoryNts).toBeNull();
  });
});

describe('v3 report breakdowns', () => {
  it('counts every in-range booking status and every room status like the v3 breakdown tables', () => {
    const report = buildReportProjection(source, { dateFrom: '2026-09-10', dateTo: '2026-09-11', includeCosts: false });
    expect(report.bookingStatusCounts).toEqual({ 已預約: 1, 已入住: 1 });
    expect(report.roomStatusCounts).toEqual({ 使用中: 1, 維修中: 1 });
  });

  it('splits revenue into weekday and holiday using the booking rate type and the stay check-in date', () => {
    const report = buildReportProjection({
      ...source,
      bookings: [
        { id: 'B3', data: { bookingId: 'B3', roomId: '201', checkInAt: '2026-09-12T15:00:00+08:00', plan: '24hrs', amountNts: 1_200, status: '已預約', rateType: '假日' } },
        { id: 'B4', data: { bookingId: 'B4', roomId: '202', checkInAt: '2026-09-14T15:00:00+08:00', plan: '24hrs', amountNts: 1_000, status: '已預約', rateType: null } },
      ],
      stayLogs: [
        { id: 'S3', data: { roomId: '201', checkInAt: '2026-09-13T10:00:00+08:00', plan: '24hrs', totalChargedNts: 1_300, freeCancel: false, transferred: false } },
        { id: 'S4', data: { roomId: '202', checkInAt: '2026-09-15T10:00:00+08:00', plan: '12hrs', totalChargedNts: 800, freeCancel: false, transferred: false } },
        { id: 'S5', data: { roomId: '202', checkInAt: '2026-09-16T10:00:00+08:00', plan: '12hrs', totalChargedNts: 900, freeCancel: false, transferred: false } },
      ],
      holidays: [{ id: '2026-09-17', data: { date: '2026-09-17', year: 2026, holiday: true } }],
    }, { dateFrom: '2026-09-12', dateTo: '2026-09-16', includeCosts: false });
    // S5 is the eve of a configured holiday, so v3 prices it as a holiday.
    expect(report.rateRevenueNts).toEqual({ 非假日: 1_800, 假日: 3_400 });
  });

  it('reports in-house amounts still due as live revenue', () => {
    const report = buildReportProjection({ ...source, stays: [{ id: 'A', data: { roomId: '201', totalDueNts: 1_500 } }, { id: 'B', data: { roomId: '202', totalDueNts: 700 } }] }, { dateFrom: '2026-09-10', dateTo: '2026-09-11', includeCosts: false });
    expect(report.liveRevenueNts).toBe(2_200);
  });
});

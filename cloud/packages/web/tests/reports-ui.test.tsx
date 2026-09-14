// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReportProjection } from '@bini/cloud-shared';

import { App } from '../src/App.js';
import type { StaffSession } from '../src/auth/session.js';
import type { ReportGateway } from '../src/reports/report-gateway.js';

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.useRealTimers(); });
const session: StaffSession = { uid: 'admin-1', email: 'admin@example.com', displayName: 'Admin', propertyId: 'property-main', role: 'admin', allowedPages: ['reports'] };
const projection: ReportProjection = { dateFrom: '2026-09-01', dateTo: '2026-09-13', days: 13, rangeRevenueNts: 9_300, staylogRevenueNts: 1_300, monthlyRevenueNts: 8_000, bookingRevenueNts: 1_200, liveRevenueNts: 1_500, totalOrders: 3, cancelledOrders: 1, totalRooms: 2, occupiedNow: 1, occupancyNowPct: 50, rangeOccupancyPct: 50, repairCount: 1, avgStayHours: 24, activeStaysCount: 1, daily: [{ date: '2026-09-10', revenueNts: 2_500, occupancyPct: 50 }], planCounts: { '24hrs': 2 }, planRevenueNts: { '24hrs': 2_500 }, roomRentals: [{ roomId: '201', status: '使用中', note: null, count: 2, revenueNts: 2_500, plans: { '24hrs': 2 } }], bookingStatusCounts: { 已預約: 2, 已取消: 1 }, roomStatusCounts: { 使用中: 1, 維修中: 1 }, rateRevenueNts: { 非假日: 1_300, 假日: 1_200 }, totalCostNts: 500, netProfitNts: 8_800, costRatioPct: 5.4, costByCategoryNts: { utilities: 500 } };

describe('reports UI', () => {
  it('shows admin P&L and routes CSV export through the guarded gateway', async () => {
    // The default range is "this Taipei month"; pin the clock so the expected range does not drift daily.
    vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-09-13T04:00:00.000Z'));
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: vi.fn(() => 'blob:test') });
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() });
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    const exportCsv = vi.fn().mockResolvedValue({ filename: 'bini_blooms_report_2026-09-01_2026-09-13.csv', csv: '\uFEFFreport' });
    const gateway: ReportGateway = { subscribe(_propertyId, _range, onValue) { queueMicrotask(() => onValue(projection)); return () => undefined; }, exportCsv };
    render(<App reportGateway={gateway} session={session} />);
    fireEvent.click(screen.getByRole('link', { name: '統計報表' }));
    expect(await screen.findByText('淨損益')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '匯出 CSV' }));
    await waitFor(() => expect(exportCsv).toHaveBeenCalledWith(expect.objectContaining({ propertyId: 'property-main', dateFrom: '2026-09-01', dateTo: '2026-09-13', operationId: expect.any(String) })));
  });

  it('shows v3 breakdowns, weekday/holiday split and live in-house revenue', async () => {
    const gateway: ReportGateway = { subscribe(_propertyId, _range, onValue) { queueMicrotask(() => onValue(projection)); return () => undefined; }, exportCsv: vi.fn() };
    render(<App reportGateway={gateway} session={{ ...session, role: 'manager' }} />);
    fireEvent.click(screen.getByRole('link', { name: '統計報表' }));
    expect(await screen.findByText('在住未結 +NT$ 1,500')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: '營收 (NT$) / 住房率 (%)' })).toBeInTheDocument();
    expect(screen.getByText('NT$ 1,200 · 48%')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '預約狀態' })).toBeInTheDocument();
    expect(screen.getByText('已取消')).toBeInTheDocument();
    expect(screen.queryByText('淨損益')).not.toBeInTheDocument();
  });

  it('applies the v3 7D / 30D / All quick ranges', async () => {
    vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-09-13T04:00:00.000Z'));
    const ranges: Array<{ dateFrom: string; dateTo: string }> = [];
    const gateway: ReportGateway = { subscribe(_propertyId, range, onValue) { ranges.push({ dateFrom: range.dateFrom, dateTo: range.dateTo }); queueMicrotask(() => onValue(projection)); return () => undefined; }, exportCsv: vi.fn() };
    render(<App reportGateway={gateway} session={session} />);
    fireEvent.click(screen.getByRole('link', { name: '統計報表' }));
    await screen.findByText('淨損益');
    fireEvent.click(screen.getByRole('button', { name: '7D' }));
    fireEvent.click(screen.getByRole('button', { name: '30D' }));
    fireEvent.click(screen.getByRole('button', { name: '全部' }));
    await waitFor(() => expect(ranges).toEqual(expect.arrayContaining([
      { dateFrom: '2026-09-07', dateTo: '2026-09-13' },
      { dateFrom: '2026-08-15', dateTo: '2026-09-13' },
      { dateFrom: '2016-09-15', dateTo: '2026-09-13' },
    ])));
  });

  it('summarises payments for the end date with cashier status and exports the v3 daily summary', async () => {
    vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-09-13T04:00:00.000Z'));
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: vi.fn(() => 'blob:test') });
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() });
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    const exportDailySummaryCsv = vi.fn().mockResolvedValue({ filename: 'daily_summary_2026-09-13_2026-09-13.csv', csv: '\uFEFFdate' });
    const payments = [
      { paymentId: 'P1', roomId: '201', guestName: 'A', paymentType: 'cash', amountNts: 1_000, deposit: false, refund: false, status: 'paid', note: null, createdAt: '2026-09-13T09:00:00+08:00' },
      { paymentId: 'P2', roomId: '201', guestName: 'A', paymentType: 'cash', amountNts: 300, deposit: false, refund: true, status: 'refunded', note: null, createdAt: '2026-09-13T10:00:00+08:00' },
      { paymentId: 'P3', roomId: '202', guestName: 'B', paymentType: 'card', amountNts: 700, deposit: false, refund: false, status: 'paid', note: null, createdAt: '2026-09-12T10:00:00+08:00' },
    ] as const;
    const gateway: ReportGateway = {
      subscribe(_propertyId, _range, onValue) { queueMicrotask(() => onValue(projection)); return () => undefined; },
      exportCsv: vi.fn(),
      subscribePaymentLedger(_propertyId, onValue) { queueMicrotask(() => onValue({ payments: [...payments], sessions: new Map([['2026-09-13', 'closed' as const]]) })); return () => undefined; },
      exportDailySummaryCsv,
    };
    render(<App reportGateway={gateway} session={session} />);
    fireEvent.click(screen.getByRole('link', { name: '統計報表' }));
    expect(await screen.findByText('付款摘要 — 2026-09-13')).toBeInTheDocument();
    expect(await screen.findByText('日結狀態：已關閉')).toBeInTheDocument();
    expect(screen.getByText('淨收入').nextSibling).toHaveTextContent('NT$ 700');
    fireEvent.click(screen.getByRole('button', { name: '日結 CSV' }));
    await waitFor(() => expect(exportDailySummaryCsv).toHaveBeenCalledWith({ propertyId: 'property-main', operationId: expect.any(String), dateFrom: '2026-09-13', dateTo: '2026-09-13' }));
  });

  it('draws a readable daily chart: round revenue ticks, occupancy ticks and non-overlapping date labels', async () => {
    const daily = Array.from({ length: 30 }, (_, index) => ({ date: `2026-09-${String(index + 1).padStart(2, '0')}`, revenueNts: index === 1 ? 5_400 : 1_200, occupancyPct: index % 3 === 0 ? 50 : 0 }));
    const gateway: ReportGateway = { subscribe(_propertyId, _range, onValue) { queueMicrotask(() => onValue({ ...projection, daily })); return () => undefined; }, exportCsv: vi.fn() };
    render(<App reportGateway={gateway} session={{ ...session, role: 'manager' }} />);
    fireEvent.click(screen.getByRole('link', { name: '統計報表' }));
    const chart = await screen.findByRole('img', { name: '營收 (NT$) / 住房率 (%)' });
    const ticks = [...chart.querySelectorAll('.report-chart-tick:not(.report-chart-tick--occ)')].map((node) => node.textContent);
    expect(ticks).toEqual(['0', '2,000', '4,000', '6,000', '8,000']);
    expect([...chart.querySelectorAll('.report-chart-tick--occ')].map((node) => node.textContent)).toEqual(['0%', '25%', '50%', '75%', '100%']);
    // Labels are spaced so neighbours are at least ~46px apart, and the last day is always labelled.
    const labels = [...chart.querySelectorAll('.report-chart-label')];
    const xs = labels.map((node) => Number(node.getAttribute('x')));
    expect(labels.at(-1)?.textContent).toBe('09-30');
    for (let index = 1; index < xs.length; index += 1) expect(xs[index]! - xs[index - 1]!).toBeGreaterThanOrEqual(46);
  });
});


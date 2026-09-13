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
const projection: ReportProjection = { dateFrom: '2026-09-01', dateTo: '2026-09-13', days: 13, rangeRevenueNts: 9_300, staylogRevenueNts: 1_300, monthlyRevenueNts: 8_000, bookingRevenueNts: 1_200, totalOrders: 3, cancelledOrders: 1, totalRooms: 2, occupiedNow: 1, occupancyNowPct: 50, rangeOccupancyPct: 50, repairCount: 1, avgStayHours: 24, activeStaysCount: 1, daily: [{ date: '2026-09-10', revenueNts: 2_500, occupancyPct: 50 }], planCounts: { '24hrs': 2 }, planRevenueNts: { '24hrs': 2_500 }, roomRentals: [{ roomId: '201', status: '使用中', note: null, count: 2, revenueNts: 2_500, plans: { '24hrs': 2 } }], totalCostNts: 500, netProfitNts: 8_800, costRatioPct: 5.4, costByCategoryNts: { utilities: 500 } };

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
});

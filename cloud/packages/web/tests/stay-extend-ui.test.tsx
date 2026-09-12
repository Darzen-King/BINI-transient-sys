// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ActiveStayItem, BookingHolidayCalendar } from '@bini/cloud-shared';

import { App } from '../src/App.js';
import type { StaffSession } from '../src/auth/session.js';
import type { ActiveStaysGateway } from '../src/stays/active-stays.js';
import type { HolidayCalendarGateway } from '../src/stays/holiday-calendar.js';
import type { StayExtendGateway } from '../src/stays/stay-extend.js';

const session: StaffSession = { uid: 'front-1', email: 'front@example.com', displayName: 'Front Desk', propertyId: 'property-main', role: 'front_desk', allowedPages: ['rooms', 'extend'] };
const stays: ActiveStayItem[] = [{ stayId: 'STY-live-202', roomId: '202', guestName: 'Live Guest', phone: null, plan: '12hrs', checkInAt: '2026-09-14T05:00:00.000Z', checkOutAt: '2026-09-14T17:00:00.000Z', originalCheckOutAt: '2026-09-14T17:00:00.000Z', baseRentNts: 800, extensionFeeNts: 0, extraFeeNts: 0, totalDueNts: 800 }];
const calendar: BookingHolidayCalendar = { days: new Map(), coveredYears: new Set() };
const staysGateway: ActiveStaysGateway = { subscribe(_propertyId, onValue) { queueMicrotask(() => onValue(stays)); return () => undefined; } };
const holidayGateway: HolidayCalendarGateway = { subscribe(_propertyId, onValue) { queueMicrotask(() => onValue(calendar)); return () => undefined; } };

afterEach(cleanup);

describe('stay extension UI', () => {
  it('routes the desktop extend action to the guarded callable and shows the cumulative preview', async () => {
    const extend = vi.fn().mockResolvedValue({ status: 'extended', stayId: 'STY-live-202', roomId: '202', extensionHours: 12, checkOutAt: '2026-09-15T05:00:00.000Z', incrementalFeeNts: 200, extensionFeeNts: 200, totalDueNts: 1_000 });
    render(<App activeStaysGateway={staysGateway} holidayCalendarGateway={holidayGateway} session={session} stayExtendGateway={{ extend } satisfies StayExtendGateway} />);
    fireEvent.click(screen.getByRole('link', { name: '延住處理' }));
    fireEvent.change(await screen.findByLabelText('選擇在住房'), { target: { value: 'STY-live-202' } });
    fireEvent.change(screen.getByLabelText('延住時數'), { target: { value: '12' } });
    expect(await screen.findByText('累計延住費')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '確認延住' }));
    await waitFor(() => expect(extend).toHaveBeenCalledWith({ propertyId: 'property-main', stayId: 'STY-live-202', extensionHours: 12, operationId: expect.any(String) }));
    expect(await screen.findByText('延住已完成')).toBeInTheDocument();
  });
});

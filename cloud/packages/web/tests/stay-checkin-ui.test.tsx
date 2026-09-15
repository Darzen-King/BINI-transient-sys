// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { BookingListItem } from '@bini/cloud-shared';

import { App } from '../src/App.js';
import { heldBookingForRoom, StayCheckInPage } from '../src/stays/StayCheckInPage.js';
import type { StaffSession } from '../src/auth/session.js';
import type { BookingListGateway } from '../src/bookings/booking-list.js';
import type { BookingRoomGateway } from '../src/rooms/booking-room-options.js';
import type { StayCheckInGateway } from '../src/stays/stay-checkin.js';

const session: StaffSession = { uid: 'front-1', email: 'front@example.com', displayName: 'Front Desk', propertyId: 'property-main', role: 'front_desk', allowedPages: ['rooms', 'bookings', 'checkin'] };
const bookings: BookingListItem[] = [{ bookingId: 'RSV-live-203', roomId: '203', guestName: 'Live Guest', phone: '0900-111-222', checkInAt: '2026-09-14T13:00:00+08:00', checkOutAt: '2026-09-15T13:00:00+08:00', plan: '24hrs', amountNts: 1_200, discountNts: 0, rateType: '非假日', status: '已預約' }];
const bookingGateway: BookingListGateway = { subscribe(_propertyId, onValue) { queueMicrotask(() => onValue(bookings)); return () => undefined; } };
const roomGateway: BookingRoomGateway = { subscribe(_propertyId, onValue) { queueMicrotask(() => onValue([{ roomId: '203', status: '可入住' }, { roomId: '204', status: '待清潔' }])); return () => undefined; } };

afterEach(() => { cleanup(); vi.useRealTimers(); });

describe('stay check-in UI', () => {
  it('routes the room overview action to the server-authoritative booking check-in', async () => {
    const checkIn = vi.fn().mockResolvedValue({ status: 'checked_in', stayId: 'STY-123', bookingId: 'RSV-live-203', paymentId: 'PAY-CHK-123', checkInAt: '2026-09-14T05:00:00.000Z', checkOutAt: '2026-09-15T05:00:00.000Z', totalDueNts: 1_200 });
    render(<App bookingListGateway={bookingGateway} bookingRoomGateway={roomGateway} session={session} stayCheckInGateway={{ checkIn } satisfies StayCheckInGateway} />);
    fireEvent.click(screen.getByLabelText('辦理入住'));
    fireEvent.change(await screen.findByLabelText('關聯預約（選填）'), { target: { value: 'RSV-live-203' } });
    fireEvent.click(screen.getByRole('button', { name: '確認辦理入住' }));
    await waitFor(() => expect(checkIn).toHaveBeenCalledWith(expect.objectContaining({ propertyId: 'property-main', bookingId: 'RSV-live-203', roomId: '203', guestName: 'Live Guest', checkInAt: '2026-09-14T13:00:00+08:00', plan: '24hrs', days: 1, pricingMode: 'manual', manualAmountNts: 1_200, operationId: expect.any(String) })));
    expect(await screen.findByText('已完成入住')).toBeInTheDocument();
  });

  it('fills a walk-in check-out and room charge automatically and sends automatic pricing', async () => {
    const checkIn = vi.fn().mockResolvedValue({ status: 'checked_in', stayId: 'STY-9', bookingId: null, paymentId: null, checkInAt: '2026-09-17T05:00:00.000Z', checkOutAt: '2026-09-17T17:00:00.000Z', totalDueNts: 800 });
    render(<App bookingListGateway={bookingGateway} bookingRoomGateway={roomGateway} session={session} stayCheckInGateway={{ checkIn } satisfies StayCheckInGateway} />);
    fireEvent.click(screen.getByLabelText('辦理入住'));
    fireEvent.change(await screen.findByLabelText('房間'), { target: { value: '203' } });
    fireEvent.change(screen.getByLabelText('住客姓名'), { target: { value: 'Walk In' } });
    fireEvent.change(screen.getByLabelText('入住時間'), { target: { value: '2026-09-17T13:00' } });
    fireEvent.change(screen.getByLabelText('方案'), { target: { value: '12hrs' } });
    expect(screen.queryByLabelText('計價方式')).not.toBeInTheDocument();
    expect(screen.getByLabelText('退房時間')).toHaveValue('2026-09-18 01:00');
    expect(screen.getByLabelText('房租金額（NT$）')).toHaveValue(800);
    fireEvent.click(screen.getByRole('button', { name: '確認辦理入住' }));
    await waitFor(() => expect(checkIn).toHaveBeenCalledWith(expect.objectContaining({ roomId: '203', plan: '12hrs', days: 1, pricingMode: 'automatic' })));
    expect(checkIn.mock.calls[0]?.[0]).not.toHaveProperty('manualAmountNts');
  });

  it("links a late guest's own booking when checking in from the room card, so it cannot conflict with itself", async () => {
    // Arrival was 13:00; the guest turns up 90 minutes late.
    vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-09-14T14:30:00+08:00'));
    const checkIn = vi.fn().mockResolvedValue({ status: 'checked_in', stayId: 'STY-1', bookingId: 'RSV-live-203', paymentId: null, checkInAt: '2026-09-14T05:00:00.000Z', checkOutAt: '2026-09-15T05:00:00.000Z', totalDueNts: 1_200 });
    render(<StayCheckInPage bookingGateway={bookingGateway} gateway={{ checkIn }} initialRoomId="203" onBack={vi.fn()} roomGateway={roomGateway} session={session} />);
    await waitFor(() => expect(screen.getByLabelText('關聯預約（選填）')).toHaveValue('RSV-live-203'));
    expect(screen.getByLabelText('住客姓名')).toHaveValue('Live Guest');
    fireEvent.click(screen.getByRole('button', { name: '確認辦理入住' }));
    await waitFor(() => expect(checkIn).toHaveBeenCalledWith(expect.objectContaining({ bookingId: 'RSV-live-203', roomId: '203', checkInAt: '2026-09-14T13:00:00+08:00' })));
  });

  it('only treats a booking as held by the room between an hour before arrival and its check-out', () => {
    const at = (iso: string) => Date.parse(iso);
    expect(heldBookingForRoom(bookings, '203', at('2026-09-14T12:05:00+08:00'))?.bookingId).toBe('RSV-live-203');
    expect(heldBookingForRoom(bookings, '203', at('2026-09-14T11:30:00+08:00'))).toBeNull();
    expect(heldBookingForRoom(bookings, '203', at('2026-09-15T13:00:00+08:00'))).toBeNull();
    expect(heldBookingForRoom(bookings, '204', at('2026-09-14T14:00:00+08:00'))).toBeNull();
  });

  it('opens check-in from the booking detail with that booking already linked', async () => {
    vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-09-14T15:00:00+08:00'));
    render(<App bookingListGateway={bookingGateway} bookingRoomGateway={roomGateway} session={session} stayCheckInGateway={{ checkIn: vi.fn() } satisfies StayCheckInGateway} />);
    fireEvent.click(screen.getByRole('link', { name: '預約管理' }));
    fireEvent.click(await screen.findByText('203 · Live Guest'));
    fireEvent.click(screen.getByRole('button', { name: '辦理入住' }));
    await waitFor(() => expect(screen.getByLabelText('關聯預約（選填）')).toHaveValue('RSV-live-203'));
    expect(screen.getByLabelText('房間')).toHaveValue('203');
  });
});

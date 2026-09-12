// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { App } from '../src/App.js';
import type { StaffSession } from '../src/auth/session.js';
import type { BookingCreateGateway } from '../src/bookings/booking-create.js';
import type { BookingRoomGateway } from '../src/rooms/booking-room-options.js';

const fullAccessSession: StaffSession = {
  uid: 'front-1',
  email: 'front@example.com',
  displayName: 'Front Desk',
  propertyId: 'property-main',
  role: 'front_desk',
  allowedPages: ['rooms', 'bookings', 'bookings_new'],
};

function roomGateway(): BookingRoomGateway {
  return {
    subscribe(_propertyId, onValue) {
      queueMicrotask(() => onValue([
        { roomId: '203', status: '可入住' },
        { roomId: '206', status: '月租套房' },
      ]));
      return () => undefined;
    },
  };
}

afterEach(cleanup);

describe('new booking UI', () => {
  it('uses the authorized Firebase gateway and exposes the server result', async () => {
    const create = vi.fn().mockResolvedValue({
      status: 'created',
      bookingId: 'RSV-260914-1234ABCD',
      paymentId: 'PAY-260914-1234ABCD',
      checkInAt: '2026-09-14T05:00:00.000Z',
      checkOutAt: '2026-09-15T05:00:00.000Z',
      amountNts: 1_000,
      discountNts: 0,
      rateType: '非假日',
    });
    render(<App bookingCreateGateway={{ create } satisfies BookingCreateGateway} bookingRoomGateway={roomGateway()} session={fullAccessSession} />);

    fireEvent.click(screen.getByRole('button', { name: '預約' }));
    fireEvent.click(screen.getByRole('button', { name: '＋ 新增預約' }));
    const room = await screen.findByLabelText('房間');
    fireEvent.change(room, { target: { value: '203' } });
    fireEvent.change(screen.getByLabelText('住客姓名'), { target: { value: 'Chris' } });
    fireEvent.change(screen.getByLabelText('電話'), { target: { value: '0900-000-000' } });
    fireEvent.change(screen.getByLabelText('入住時間'), { target: { value: '2026-09-14T13:00' } });
    fireEvent.change(screen.getByLabelText('押金（NT$）'), { target: { value: '300' } });
    fireEvent.click(screen.getByRole('button', { name: '建立預約' }));

    await waitFor(() => expect(create).toHaveBeenCalledWith(expect.objectContaining({
      propertyId: 'property-main',
      roomId: '203',
      guestName: 'Chris',
      phone: '0900-000-000',
      checkInAt: '2026-09-14T13:00:00+08:00',
      plan: '24hrs',
      days: 1,
      pricingMode: 'automatic',
      deposit: { amountNts: 300, paymentType: 'cash' },
    })));
    expect(await screen.findByText('預約編號：RSV-260914-1234ABCD')).toBeInTheDocument();
  });

  it('does not expose create controls when the administrator did not allow bookings_new', () => {
    render(<App roomOverviewGateway={undefined} session={{ ...fullAccessSession, allowedPages: ['rooms', 'bookings'] }} />);

    expect(screen.queryByRole('button', { name: '新增預約' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '預約' }));
    expect(screen.queryByRole('button', { name: '＋ 新增預約' })).not.toBeInTheDocument();
  });

  it('keeps the same operation ID when a failed request is retried', async () => {
    const create = vi.fn()
      .mockRejectedValueOnce(new Error('temporary network failure'))
      .mockResolvedValueOnce({
        status: 'created', bookingId: 'RSV-260914-1234ABCD', paymentId: null,
        checkInAt: '2026-09-14T05:00:00.000Z', checkOutAt: '2026-09-15T05:00:00.000Z',
        amountNts: 1_000, discountNts: 0, rateType: '非假日',
      });
    render(<App bookingCreateGateway={{ create } satisfies BookingCreateGateway} bookingRoomGateway={roomGateway()} session={fullAccessSession} />);

    fireEvent.click(screen.getByRole('button', { name: '預約' }));
    fireEvent.click(screen.getByRole('button', { name: '＋ 新增預約' }));
    fireEvent.change(await screen.findByLabelText('房間'), { target: { value: '203' } });
    fireEvent.change(screen.getByLabelText('住客姓名'), { target: { value: 'Chris' } });
    fireEvent.change(screen.getByLabelText('入住時間'), { target: { value: '2026-09-14T13:00' } });
    fireEvent.click(screen.getByRole('button', { name: '建立預約' }));
    await screen.findByRole('alert');
    fireEvent.click(screen.getByRole('button', { name: '建立預約' }));

    await waitFor(() => expect(create).toHaveBeenCalledTimes(2));
    expect(create.mock.calls[1]?.[0].operationId).toBe(create.mock.calls[0]?.[0].operationId);
  });
});

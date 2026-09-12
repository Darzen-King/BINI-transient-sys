// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { BookingListItem } from '@bini/cloud-shared';
import { App } from '../src/App.js';
import type { BookingCancelGateway } from '../src/bookings/booking-cancel.js';
import type { BookingListGateway } from '../src/bookings/booking-list.js';

afterEach(cleanup);

const bookings: BookingListItem[] = [{
  bookingId: 'RSV-live-203',
  roomId: '203',
  guestName: 'Live Guest',
  phone: '0900-111-222',
  checkInAt: '2026-09-14T13:00:00+08:00',
  checkOutAt: '2026-09-15T13:00:00+08:00',
  plan: '24hrs',
  amountNts: 1_200,
  discountNts: 0,
  rateType: '非假日',
  status: '已預約',
}];

function gateway(value: BookingListItem[]): BookingListGateway {
  return {
    subscribe(_propertyId, onValue) {
      queueMicrotask(() => onValue(value));
      return () => undefined;
    },
  };
}

describe('live booking list UI', () => {
  it('renders Firestore bookings and filters them without falling back to preview entries', async () => {
    render(<App bookingListGateway={gateway(bookings)} />);
    fireEvent.click(screen.getByRole('button', { name: '預約' }));

    expect(await screen.findByText('203 · Live Guest')).toBeInTheDocument();
    expect(screen.queryByText('202 · Juvy')).not.toBeInTheDocument();
    expect(screen.getByText(/2026-09-14 13:00.*24hrs.*NT\$ 1,200/)).toBeInTheDocument();

    fireEvent.change(screen.getByRole('searchbox', { name: '搜尋預約' }), { target: { value: 'missing' } });
    expect(screen.getByText('找不到符合的有效預約。')).toBeInTheDocument();
  });

  it('fails closed after a live-list listener error', async () => {
    const failingGateway: BookingListGateway = {
      subscribe(_propertyId, _onValue, onError) {
        queueMicrotask(() => onError(new Error('denied')));
        return () => undefined;
      },
    };
    render(<App bookingListGateway={failingGateway} />);
    fireEvent.click(screen.getByRole('button', { name: '預約' }));

    expect(await screen.findByText('無法載入即時預約')).toBeInTheDocument();
    expect(screen.queryByText('202 · Juvy')).not.toBeInTheDocument();
    expect(screen.getByText('系統不會顯示展示預約。', { exact: false })).toBeInTheDocument();
  });

  it('opens the booking detail dialog and sends a guarded cancellation', async () => {
    const cancel = vi.fn().mockResolvedValue({
      status: 'cancelled', bookingId: 'RSV-live-203', cancelledAt: '2026-09-13T05:00:00.000Z',
    });
    render(<App bookingCancelGateway={{ cancel } satisfies BookingCancelGateway} bookingListGateway={gateway(bookings)} />);
    fireEvent.click(screen.getByRole('button', { name: '預約' }));
    fireEvent.click(await screen.findByText('203 · Live Guest'));

    expect(await screen.findByText('預約編號')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '取消預約' }));
    expect(await screen.findByText('確認取消預約？')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '確認取消' }));
    await waitFor(() => expect(cancel).toHaveBeenCalledWith(expect.objectContaining({
      propertyId: 'property-main', bookingId: 'RSV-live-203', operationId: expect.any(String),
    })));
    expect(await screen.findByText('預約已取消')).toBeInTheDocument();
  });

  it('reuses the cancellation operation id when a network retry is needed', async () => {
    const cancel = vi.fn()
      .mockRejectedValueOnce(new Error('temporary network failure'))
      .mockResolvedValueOnce({ status: 'cancelled', bookingId: 'RSV-live-203', cancelledAt: '2026-09-13T05:00:00.000Z' });
    render(<App bookingCancelGateway={{ cancel } satisfies BookingCancelGateway} bookingListGateway={gateway(bookings)} />);
    fireEvent.click(screen.getByRole('button', { name: '預約' }));
    fireEvent.click(await screen.findByText('203 · Live Guest'));
    fireEvent.click(screen.getByRole('button', { name: '取消預約' }));
    fireEvent.click(screen.getByRole('button', { name: '確認取消' }));
    await screen.findByRole('alert');
    fireEvent.click(screen.getByRole('button', { name: '確認取消' }));

    await waitFor(() => expect(cancel).toHaveBeenCalledTimes(2));
    expect(cancel.mock.calls[1]?.[0].operationId).toBe(cancel.mock.calls[0]?.[0].operationId);
  });
});

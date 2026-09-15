// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { BookingListItem, BookingSoonItem } from '@bini/cloud-shared';
import { App } from '../src/App.js';
import type { BookingCancelGateway } from '../src/bookings/booking-cancel.js';
import type { BookingListGateway } from '../src/bookings/booking-list.js';
import type { BookingUpdateGateway } from '../src/bookings/booking-update.js';
import type { BookingUpdatePreviewGateway } from '../src/bookings/booking-update-preview.js';
import type { BookingRoomGateway } from '../src/rooms/booking-room-options.js';
import type { BookingSoonGateway } from '../src/bookings/booking-soon.js';
import type { PaymentCreateGateway } from '../src/payments/payment-create.js';
import type { PaymentListGateway } from '../src/payments/payment-list.js';
import type { StaffSession } from '../src/auth/session.js';

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
  version: 3,
}];

function gateway(value: BookingListItem[]): BookingListGateway {
  return {
    subscribe(_propertyId, onValue) {
      queueMicrotask(() => onValue(value));
      return () => undefined;
    },
  };
}

function roomGateway(): BookingRoomGateway {
  return {
    subscribe(_propertyId, onValue) {
      queueMicrotask(() => onValue([{ roomId: '203', status: '可入住' }]));
      return () => undefined;
    },
  };
}

function soonGateway(value: BookingSoonItem[]): BookingSoonGateway {
  return {
    subscribe(_propertyId, onValue) {
      queueMicrotask(() => onValue(value));
      return () => undefined;
    },
  };
}

describe('live booking list UI', () => {
  it('shows the deposit a booking has paid and opens Payments to collect one', async () => {
    const session: StaffSession = { uid: 'front-1', email: 'front@example.com', displayName: 'Front', propertyId: 'property-main', role: 'front_desk', allowedPages: ['bookings', 'payments'] };
    const payment = (paymentId: string, amountNts: number, extra: Record<string, unknown> = {}) => ({ paymentId, bookingId: 'RSV-live-203', roomId: '203', guestName: 'Live Guest', paymentType: 'cash' as const, amountNts, deposit: true, refund: false, status: 'paid' as const, note: null, createdAt: '2026-09-13T09:00:00.000Z', ...extra });
    const payments: PaymentListGateway = { subscribe(_propertyId, onValue) { queueMicrotask(() => onValue([payment('P-1', 800), payment('P-2', 300, { refund: true }), payment('P-3', 999, { status: 'voided' })])); return () => undefined; } };
    const createGateway = { create: vi.fn(), manualCreate: vi.fn() } satisfies PaymentCreateGateway;
    const stays = { subscribe(_propertyId: string, onValue: (value: never[]) => void) { queueMicrotask(() => onValue([])); return () => undefined; } };
    render(<App activeStaysGateway={stays} bookingListGateway={gateway(bookings)} paymentCreateGateway={createGateway} paymentListGateway={payments} session={session} />);
    fireEvent.click(screen.getByRole('link', { name: '預約管理' }));
    // 800 paid − 300 refunded; the voided payment is ignored.
    expect(await screen.findByText('押金 NT$ 500')).toBeInTheDocument();
    fireEvent.click(screen.getByText('203 · Live Guest'));
    expect(screen.getByText('已收押金').nextSibling).toHaveTextContent('NT$ 500');
    fireEvent.click(screen.getByRole('button', { name: '收取押金' }));
    await waitFor(() => expect(screen.getByLabelText('收款對象')).toHaveValue('booking:RSV-live-203'));
    expect(screen.getByLabelText('記為訂金')).toBeChecked();
  });

  it('marks a booking without any deposit so staff do not assume it was paid', async () => {
    const payments: PaymentListGateway = { subscribe(_propertyId, onValue) { queueMicrotask(() => onValue([])); return () => undefined; } };
    render(<App bookingListGateway={gateway(bookings)} paymentListGateway={payments} />);
    fireEvent.click(screen.getByRole('link', { name: '預約管理' }));
    expect(await screen.findByText('未收押金')).toBeInTheDocument();
    fireEvent.click(screen.getByText('203 · Live Guest'));
    expect(screen.getByText('已收押金').nextSibling).toHaveTextContent('尚未收取押金');
  });

  it('renders Firestore bookings and filters them without falling back to preview entries', async () => {
    render(<App bookingListGateway={gateway(bookings)} />);
    fireEvent.click(screen.getByRole('link', { name: '預約管理' }));

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
    fireEvent.click(screen.getByRole('link', { name: '預約管理' }));

    expect(await screen.findByText('無法載入即時預約')).toBeInTheDocument();
    expect(screen.queryByText('202 · Juvy')).not.toBeInTheDocument();
    expect(screen.getByText('系統不會顯示展示預約。', { exact: false })).toBeInTheDocument();
  });

  it('opens the booking detail dialog and sends a guarded cancellation', async () => {
    const cancel = vi.fn().mockResolvedValue({
      status: 'cancelled', bookingId: 'RSV-live-203', cancelledAt: '2026-09-13T05:00:00.000Z',
    });
    render(<App bookingCancelGateway={{ cancel } satisfies BookingCancelGateway} bookingListGateway={gateway(bookings)} />);
    fireEvent.click(screen.getByRole('link', { name: '預約管理' }));
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
    fireEvent.click(screen.getByRole('link', { name: '預約管理' }));
    fireEvent.click(await screen.findByText('203 · Live Guest'));
    fireEvent.click(screen.getByRole('button', { name: '取消預約' }));
    fireEvent.click(screen.getByRole('button', { name: '確認取消' }));
    await screen.findByRole('alert');
    fireEvent.click(screen.getByRole('button', { name: '確認取消' }));

    await waitFor(() => expect(cancel).toHaveBeenCalledTimes(2));
    expect(cancel.mock.calls[1]?.[0].operationId).toBe(cancel.mock.calls[0]?.[0].operationId);
  });

  it('edits from the detail dialog with the same validated room form', async () => {
    const update = vi.fn().mockResolvedValue({
      status: 'updated', bookingId: 'RSV-live-203', checkInAt: '2026-09-14T05:00:00.000Z', checkOutAt: '2026-09-15T05:00:00.000Z', amountNts: 1_200, discountNts: 0, rateType: '非假日',
    });
    render(<App bookingListGateway={gateway(bookings)} bookingUpdateGateway={{ update } satisfies BookingUpdateGateway} bookingRoomGateway={roomGateway()} />);
    fireEvent.click(screen.getByRole('link', { name: '預約管理' }));
    fireEvent.click(await screen.findByText('203 · Live Guest'));
    fireEvent.click(screen.getByRole('button', { name: '修改預約' }));
    await screen.findByText('修改預約 · RSV-live-203');
    fireEvent.change(screen.getByLabelText('住客姓名'), { target: { value: 'Changed Guest' } });
    fireEvent.click(screen.getByRole('button', { name: '儲存變更' }));

    await waitFor(() => expect(update).toHaveBeenCalledWith(expect.objectContaining({
      propertyId: 'property-main', bookingId: 'RSV-live-203', roomId: '203', guestName: 'Changed Guest', plan: '24hrs', days: 1, pricingMode: 'automatic', operationId: expect.any(String),
    })));
    expect(await screen.findByText('預約已更新')).toBeInTheDocument();
  });

  it('keeps the booking room selected when the room list (led by a disabled monthly room) loads after the form', async () => {
    const update = vi.fn().mockResolvedValue({
      status: 'updated', bookingId: 'RSV-live-203', checkInAt: '2026-09-14T05:00:00.000Z', checkOutAt: '2026-09-15T05:00:00.000Z', amountNts: 1_200, discountNts: 0, rateType: '非假日',
    });
    const lateRooms: BookingRoomGateway = { subscribe(_propertyId, onValue) { setTimeout(() => onValue([{ roomId: '201', status: '月租套房' }, { roomId: '202', status: '使用中' }, { roomId: '203', status: '可入住' }]), 20); return () => undefined; } };
    render(<App bookingListGateway={gateway(bookings)} bookingUpdateGateway={{ update } satisfies BookingUpdateGateway} bookingRoomGateway={lateRooms} />);
    fireEvent.click(screen.getByRole('link', { name: '預約管理' }));
    fireEvent.click(await screen.findByText('203 · Live Guest'));
    fireEvent.click(screen.getByRole('button', { name: '修改預約' }));
    await screen.findByText('修改預約 · RSV-live-203');
    await waitFor(() => expect(screen.getByLabelText('房間')).toBeEnabled());
    expect(screen.getByLabelText('房間')).toHaveValue('203');
    fireEvent.click(screen.getByRole('button', { name: '儲存變更' }));
    await waitFor(() => expect(update).toHaveBeenCalledWith(expect.objectContaining({ roomId: '203' })));
  });

  it('uses the self-excluding server preview before saving a booking edit', async () => {
    const preview = vi.fn().mockResolvedValue({
      available: true,
      reason: 'available',
      quote: {
        checkInAt: '2026-09-14T05:00:00.000Z', checkOutAt: '2026-09-15T05:00:00.000Z',
        grossAmountNts: 1_200, amountNts: 1_200, discountNts: 0, rateType: '非假日',
      },
      conflict: null,
    });
    render(<App
      bookingListGateway={gateway(bookings)}
      bookingUpdateGateway={{ update: vi.fn() } satisfies BookingUpdateGateway}
      bookingUpdatePreviewGateway={{ preview } satisfies BookingUpdatePreviewGateway}
      bookingRoomGateway={roomGateway()}
    />);
    fireEvent.click(screen.getByRole('link', { name: '預約管理' }));
    fireEvent.click(await screen.findByText('203 · Live Guest'));
    fireEvent.click(screen.getByRole('button', { name: '修改預約' }));
    await screen.findByText('修改預約 · RSV-live-203');
    fireEvent.click(screen.getByRole('button', { name: '檢查可用性與報價' }));

    await waitFor(() => expect(preview).toHaveBeenCalledWith(expect.objectContaining({
      propertyId: 'property-main', bookingId: 'RSV-live-203', roomId: '203', pricingMode: 'automatic',
    })));
    expect(await screen.findByText('此時段可修改')).toBeInTheDocument();
    expect(screen.getByText(/排除目前這筆預約/)).toBeInTheDocument();
  });

  it('warns when another device changed the booking, refuses the stale form, and reloads the latest data', async () => {
    let emit: (value: BookingListItem[]) => void = () => undefined;
    const update = vi.fn().mockResolvedValue({ status: 'updated', bookingId: 'RSV-live-203', checkInAt: '2026-09-14T05:00:00.000Z', checkOutAt: '2026-09-15T05:00:00.000Z', amountNts: 1_200, discountNts: 0, rateType: '非假日' });
    const live: BookingListGateway = { subscribe(_propertyId, onValue) { emit = onValue; queueMicrotask(() => onValue(bookings)); return () => undefined; } };
    render(<App bookingListGateway={live} bookingUpdateGateway={{ update } satisfies BookingUpdateGateway} bookingRoomGateway={roomGateway()} />);
    fireEvent.click(screen.getByRole('link', { name: '預約管理' }));
    fireEvent.click(await screen.findByText('203 · Live Guest'));
    fireEvent.click(screen.getByRole('button', { name: '修改預約' }));
    await screen.findByText('修改預約 · RSV-live-203');

    // The phone changes the phone number while this form is open.
    await act(async () => emit([{ ...bookings[0]!, phone: '0911-000-000', version: 4 }]));
    expect(screen.getByText('此預約已被其他裝置修改')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '載入最新資料' }));
    expect(screen.queryByText('此預約已被其他裝置修改')).not.toBeInTheDocument();
    expect(screen.getByLabelText('電話')).toHaveValue('0911-000-000');
    await waitFor(() => expect(screen.getByRole('button', { name: '儲存變更' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: '儲存變更' }));
    await waitFor(() => expect(update).toHaveBeenCalledWith(expect.objectContaining({ expectedVersion: 4, phone: '0911-000-000' })));

    // Cancelled on the other device: the form can no longer be saved.
    await screen.findByText('預約已更新');
    fireEvent.click(screen.getAllByRole('button', { name: '返回預約管理' })[0]!);
    fireEvent.click(await screen.findByText('203 · Live Guest'));
    fireEvent.click(screen.getByRole('button', { name: '修改預約' }));
    await screen.findByText('修改預約 · RSV-live-203');
    await act(async () => emit([]));
    expect(screen.getByText('此預約已被其他裝置取消或辦理入住')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '儲存變更' })).toBeDisabled();
  });

  it('reuses the update operation id when a save is retried', async () => {
    const update = vi.fn()
      .mockRejectedValueOnce(new Error('temporary network failure'))
      .mockResolvedValueOnce({ status: 'updated', bookingId: 'RSV-live-203', checkInAt: '2026-09-14T05:00:00.000Z', checkOutAt: '2026-09-15T05:00:00.000Z', amountNts: 1_200, discountNts: 0, rateType: '非假日' });
    render(<App bookingListGateway={gateway(bookings)} bookingUpdateGateway={{ update } satisfies BookingUpdateGateway} bookingRoomGateway={roomGateway()} />);
    fireEvent.click(screen.getByRole('link', { name: '預約管理' }));
    fireEvent.click(await screen.findByText('203 · Live Guest'));
    fireEvent.click(screen.getByRole('button', { name: '修改預約' }));
    await screen.findByText('修改預約 · RSV-live-203');
    fireEvent.click(screen.getByRole('button', { name: '儲存變更' }));
    await screen.findByRole('alert');
    fireEvent.click(screen.getByRole('button', { name: '儲存變更' }));

    await waitFor(() => expect(update).toHaveBeenCalledTimes(2));
    expect(update.mock.calls[1]?.[0].operationId).toBe(update.mock.calls[0]?.[0].operationId);
  });

  it('marks a soon-arrival as no-show through the guarded cancellation gateway', async () => {
    const cancel = vi.fn().mockResolvedValue({ status: 'cancelled', bookingId: 'RSV-soon-203', cancelledAt: '2026-09-14T05:00:00.000Z' });
    render(<App bookingCancelGateway={{ cancel } satisfies BookingCancelGateway} bookingSoonGateway={soonGateway([
      { bookingId: 'RSV-soon-203', roomId: '203', guestName: 'Soon Guest', checkInAt: '2026-09-14T05:10:00.000Z', minutesUntil: 10 },
    ])} />);

    expect(await screen.findByText('即將入住')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '標記 No-show' }));
    fireEvent.click(await screen.findByRole('button', { name: '確認標記 No-show' }));
    await waitFor(() => expect(cancel).toHaveBeenCalledWith(expect.objectContaining({
      propertyId: 'property-main', bookingId: 'RSV-soon-203', cancellationReason: 'no_show', operationId: expect.any(String),
    })));
    expect(await screen.findByText('預約提醒已處理')).toBeInTheDocument();
  });

  it('reuses the no-show operation id after a temporary failure', async () => {
    const cancel = vi.fn()
      .mockRejectedValueOnce(new Error('temporary network failure'))
      .mockResolvedValueOnce({ status: 'cancelled', bookingId: 'RSV-soon-retry', cancelledAt: '2026-09-14T05:00:00.000Z' });
    render(<App bookingCancelGateway={{ cancel } satisfies BookingCancelGateway} bookingSoonGateway={soonGateway([
      { bookingId: 'RSV-soon-retry', roomId: '205', guestName: 'Retry Guest', checkInAt: '2026-09-14T05:10:00.000Z', minutesUntil: 10 },
    ])} />);

    fireEvent.click(await screen.findByRole('button', { name: '標記 No-show' }));
    fireEvent.click(screen.getByRole('button', { name: '確認標記 No-show' }));
    await screen.findByRole('alert');
    fireEvent.click(screen.getByRole('button', { name: '確認標記 No-show' }));

    await waitFor(() => expect(cancel).toHaveBeenCalledTimes(2));
    expect(cancel.mock.calls[1]?.[0].operationId).toBe(cancel.mock.calls[0]?.[0].operationId);
  });
});

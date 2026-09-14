// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { App } from '../src/App.js';
import type { StaffSession } from '../src/auth/session.js';
import type { BookingCreateGateway } from '../src/bookings/booking-create.js';
import type { BookingMultiCreateGateway } from '../src/bookings/booking-multi-create.js';
import type { BookingPreviewGateway } from '../src/bookings/booking-preview.js';
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

    fireEvent.click(screen.getByRole('link', { name: '預約管理' }));
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

  it('does not report a failure after a successful booking and starts the next booking with a fresh operation ID', async () => {
    const create = vi.fn().mockResolvedValue({
      status: 'created',
      bookingId: 'RSV-260914-1234ABCD',
      paymentId: null,
      checkInAt: '2026-09-14T05:00:00.000Z',
      checkOutAt: '2026-09-15T05:00:00.000Z',
      amountNts: 1_000,
      discountNts: 0,
      rateType: '非假日',
    });
    render(<App bookingCreateGateway={{ create } satisfies BookingCreateGateway} bookingRoomGateway={roomGateway()} session={fullAccessSession} />);
    fireEvent.click(screen.getByRole('link', { name: '預約管理' }));
    fireEvent.click(screen.getByRole('button', { name: '＋ 新增預約' }));
    const fill = async () => {
      fireEvent.change(await screen.findByLabelText('房間'), { target: { value: '203' } });
      fireEvent.change(screen.getByLabelText('住客姓名'), { target: { value: 'Chris' } });
      fireEvent.change(screen.getByLabelText('入住時間'), { target: { value: '2026-09-14T13:00' } });
      fireEvent.click(screen.getByRole('button', { name: '建立預約' }));
    };

    await fill();
    expect(await screen.findByText('預約編號：RSV-260914-1234ABCD')).toBeInTheDocument();
    expect(screen.queryByText('無法建立預約')).not.toBeInTheDocument();
    expect(screen.getByLabelText('住客姓名')).toHaveValue('');

    await fill();
    await waitFor(() => expect(create).toHaveBeenCalledTimes(2));
    expect(create.mock.calls[1]?.[0].operationId).not.toBe(create.mock.calls[0]?.[0].operationId);
  });

  it('does not expose create controls when the administrator did not allow bookings_new', () => {
    render(<App roomOverviewGateway={undefined} session={{ ...fullAccessSession, allowedPages: ['rooms', 'bookings'] }} />);

    expect(screen.queryByRole('button', { name: '新增預約' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('link', { name: '預約管理' }));
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

    fireEvent.click(screen.getByRole('link', { name: '預約管理' }));
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

  it('uses the guarded server preview without treating it as the final write check', async () => {
    const preview = vi.fn().mockResolvedValue({
      available: true,
      reason: 'available',
      quote: {
        checkInAt: '2026-09-14T05:00:00.000Z',
        checkOutAt: '2026-09-15T05:00:00.000Z',
        grossAmountNts: 1_000,
        amountNts: 900,
        discountNts: 100,
        rateType: '非假日',
      },
      conflict: null,
    });
    render(<App bookingCreateGateway={{ create: vi.fn() } satisfies BookingCreateGateway} bookingPreviewGateway={{ preview } satisfies BookingPreviewGateway} bookingRoomGateway={roomGateway()} session={fullAccessSession} />);

    fireEvent.click(screen.getByRole('link', { name: '預約管理' }));
    fireEvent.click(screen.getByRole('button', { name: '＋ 新增預約' }));
    fireEvent.change(await screen.findByLabelText('房間'), { target: { value: '203' } });
    fireEvent.change(screen.getByLabelText('入住時間'), { target: { value: '2026-09-14T13:00' } });
    fireEvent.change(screen.getByLabelText('折扣（NT$）'), { target: { value: '100' } });
    fireEvent.click(screen.getByRole('button', { name: '檢查可用性與報價' }));

    await waitFor(() => expect(preview).toHaveBeenCalledWith(expect.objectContaining({
      propertyId: 'property-main', roomId: '203', checkInAt: '2026-09-14T13:00:00+08:00', discountNts: 100,
    })));
    expect(await screen.findByText('此時段可預約')).toBeInTheDocument();
    expect(screen.getByText(/建立時伺服器仍會重新驗證/)).toBeInTheDocument();
  });

  it('submits all slots as one authorized multi-slot request and displays partial success', async () => {
    const create = vi.fn();
    const multiCreate = vi.fn().mockResolvedValue({
      status: 'created',
      created: [{
        slotNumber: 1, bookingId: 'RSV-260914-MULTI001',
        checkInAt: '2026-09-14T05:00:00.000Z', checkOutAt: '2026-09-15T05:00:00.000Z',
        amountNts: 1_000, discountNts: 0, rateType: '非假日',
      }],
      conflicts: [{
        slotNumber: 2, reason: 'conflict',
        conflict: {
          id: 'RSV-existing', source: 'booking', status: '已預約', guestName: 'Other guest',
          startAt: '2026-09-15T05:00:00.000Z', endAt: '2026-09-16T05:00:00.000Z',
        },
      }],
      paymentId: 'PAY-260914-MULTI001',
    });
    render(<App
      bookingCreateGateway={{ create } satisfies BookingCreateGateway}
      bookingMultiCreateGateway={{ create: multiCreate } satisfies BookingMultiCreateGateway}
      bookingRoomGateway={roomGateway()}
      session={fullAccessSession}
    />);

    fireEvent.click(screen.getByRole('link', { name: '預約管理' }));
    fireEvent.click(screen.getByRole('button', { name: '＋ 新增預約' }));
    fireEvent.change(await screen.findByLabelText('房間'), { target: { value: '203' } });
    fireEvent.change(screen.getByLabelText('住客姓名'), { target: { value: 'Chris' } });
    fireEvent.change(screen.getByLabelText('入住時間'), { target: { value: '2026-09-14T13:00' } });
    fireEvent.change(screen.getByLabelText('押金（NT$）'), { target: { value: '300' } });
    fireEvent.click(screen.getByRole('button', { name: /新增時段/ }));
    const rooms = screen.getAllByLabelText('房間');
    const checkIns = screen.getAllByLabelText('入住時間');
    fireEvent.change(rooms[1]!, { target: { value: '203' } });
    fireEvent.change(checkIns[1]!, { target: { value: '2026-09-15T13:00' } });
    fireEvent.click(screen.getByRole('button', { name: '建立預約' }));

    await waitFor(() => expect(multiCreate).toHaveBeenCalledWith(expect.objectContaining({
      propertyId: 'property-main', guestName: 'Chris',
      deposit: { amountNts: 300, paymentType: 'cash' },
      slots: [
        expect.objectContaining({ roomId: '203', checkInAt: '2026-09-14T13:00:00+08:00' }),
        expect.objectContaining({ roomId: '203', checkInAt: '2026-09-15T13:00:00+08:00' }),
      ],
    })));
    expect(create).not.toHaveBeenCalled();
    expect(await screen.findByText('多時段預約完成：建立 1 筆')).toBeInTheDocument();
    expect(screen.getByText(/未建立時段：#2（與 RSV-existing 衝突）/)).toBeInTheDocument();
  });

  it('detects the v3 rate type from the check-in date and only sends a manual relabel', async () => {
    const create = vi.fn().mockResolvedValue({ status: 'created', bookingId: 'RSV-1', paymentId: null, checkInAt: '2026-09-18T05:00:00.000Z', checkOutAt: '2026-09-19T05:00:00.000Z', amountNts: 1_200, discountNts: 0, rateType: '假日' });
    render(<App bookingCreateGateway={{ create } satisfies BookingCreateGateway} bookingRoomGateway={roomGateway()} session={fullAccessSession} />);
    fireEvent.click(screen.getByRole('link', { name: '預約管理' }));
    fireEvent.click(screen.getByRole('button', { name: '＋ 新增預約' }));
    fireEvent.change(await screen.findByLabelText('房間'), { target: { value: '203' } });
    fireEvent.change(screen.getByLabelText('住客姓名'), { target: { value: 'Chris' } });
    expect(screen.getByText('費率參考')).toBeInTheDocument();
    // 2026-09-17 is a Thursday; 2026-09-18 is a Friday, which v3 prices as a holiday.
    fireEvent.change(screen.getByLabelText('入住時間'), { target: { value: '2026-09-17T13:00' } });
    expect(screen.getByLabelText('費率類型')).toHaveValue('非假日');
    fireEvent.change(screen.getByLabelText('入住時間'), { target: { value: '2026-09-18T13:00' } });
    expect(screen.getByLabelText('費率類型')).toHaveValue('假日');
    fireEvent.click(screen.getByRole('button', { name: '建立預約' }));
    await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
    expect(create.mock.calls[0]?.[0]).not.toHaveProperty('rateType');

    fireEvent.change(await screen.findByLabelText('房間'), { target: { value: '203' } });
    fireEvent.change(screen.getByLabelText('住客姓名'), { target: { value: 'Chris' } });
    fireEvent.change(screen.getByLabelText('入住時間'), { target: { value: '2026-09-18T13:00' } });
    fireEvent.change(screen.getByLabelText('費率類型'), { target: { value: '非假日' } });
    fireEvent.click(screen.getByRole('button', { name: '建立預約' }));
    await waitFor(() => expect(create).toHaveBeenCalledTimes(2));
    expect(create.mock.calls[1]?.[0]).toMatchObject({ rateType: '非假日' });
  });

  it('shows the automatic check-out and amount, sends automatic pricing unless staff edit the amount (v3)', async () => {
    const create = vi.fn().mockResolvedValue({ status: 'created', bookingId: 'RSV-1', paymentId: null, checkInAt: '2026-09-17T05:00:00.000Z', checkOutAt: '2026-09-18T05:00:00.000Z', amountNts: 1_000, discountNts: 0, rateType: '非假日' });
    render(<App bookingCreateGateway={{ create } satisfies BookingCreateGateway} bookingRoomGateway={roomGateway()} session={fullAccessSession} />);
    fireEvent.click(screen.getByRole('link', { name: '預約管理' }));
    fireEvent.click(screen.getByRole('button', { name: '＋ 新增預約' }));
    fireEvent.change(await screen.findByLabelText('房間'), { target: { value: '203' } });
    fireEvent.change(screen.getByLabelText('住客姓名'), { target: { value: 'Chris' } });
    expect(screen.queryByLabelText('計價方式')).not.toBeInTheDocument();
    // Thursday 13:00, 24hrs, one day: weekday NT$1,000, check-out Friday 13:00.
    fireEvent.change(screen.getByLabelText('入住時間'), { target: { value: '2026-09-17T13:00' } });
    expect(screen.getByLabelText('退房時間')).toHaveValue('2026-09-18 13:00');
    expect(screen.getByLabelText('金額（NT$）')).toHaveValue(1_000);
    fireEvent.change(screen.getByLabelText('天數'), { target: { value: '2' } });
    expect(screen.getByLabelText('退房時間')).toHaveValue('2026-09-19 13:00');
    fireEvent.change(screen.getByLabelText('天數'), { target: { value: '1' } });
    fireEvent.click(screen.getByRole('button', { name: '建立預約' }));
    await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
    expect(create.mock.calls[0]?.[0]).toMatchObject({ pricingMode: 'automatic' });
    expect(create.mock.calls[0]?.[0]).not.toHaveProperty('manualAmountNts');

    fireEvent.change(await screen.findByLabelText('房間'), { target: { value: '203' } });
    fireEvent.change(screen.getByLabelText('住客姓名'), { target: { value: 'Chris' } });
    fireEvent.change(screen.getByLabelText('入住時間'), { target: { value: '2026-09-17T13:00' } });
    fireEvent.change(screen.getByLabelText('金額（NT$）'), { target: { value: '900' } });
    expect(screen.getByText('已手動調整（自動計算 NT$ 1,000）')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '建立預約' }));
    await waitFor(() => expect(create).toHaveBeenCalledTimes(2));
    expect(create.mock.calls[1]?.[0]).toMatchObject({ pricingMode: 'manual', manualAmountNts: 900 });
  });

  it('returns an edited amount to automatic pricing when the stay details change', async () => {
    render(<App bookingCreateGateway={{ create: vi.fn() } satisfies BookingCreateGateway} bookingRoomGateway={roomGateway()} session={fullAccessSession} />);
    fireEvent.click(screen.getByRole('link', { name: '預約管理' }));
    fireEvent.click(screen.getByRole('button', { name: '＋ 新增預約' }));
    fireEvent.change(await screen.findByLabelText('入住時間'), { target: { value: '2026-09-17T13:00' } });
    fireEvent.change(screen.getByLabelText('金額（NT$）'), { target: { value: '500' } });
    fireEvent.change(screen.getByLabelText('方案'), { target: { value: '12hrs' } });
    await waitFor(() => expect(screen.getByLabelText('金額（NT$）')).toHaveValue(800));
    expect(screen.getByLabelText('退房時間')).toHaveValue('2026-09-18 01:00');
  });
});

// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import type { RoomOverviewProjection } from '@bini/cloud-shared';
import { App } from '../src/App.js';
import type { StaffSession } from '../src/auth/session.js';
import type { PaymentCreateGateway } from '../src/payments/payment-create.js';
import type { PaymentListGateway } from '../src/payments/payment-list.js';
import type { RoomOverviewGateway } from '../src/rooms/room-overview.js';
import type { ActiveStaysGateway } from '../src/stays/active-stays.js';

afterEach(cleanup);

const projection: RoomOverviewProjection = {
  rooms: [{
    roomId: '301',
    status: '即將退房',
    guestName: 'Live Guest',
    checkInAt: '2026-09-12T08:00:00+08:00',
    checkOutAt: '2026-09-12T20:00:00+08:00',
    totalDueNts: 2_400,
    totalPaidNts: 1_000,
    depositPaidNts: 500,
    balanceDueNts: 1_400,
    maintenanceTitle: null,
    maintenanceEndAt: null,
    nextBookingAt: '2026-09-13T09:00:00+08:00',
    note: 'Firestore room',
    actions: ['extend', 'payment', 'checkout'],
  }],
  summary: { arrivalsToday: 4, departuresToday: 1, cleaningPending: 2 },
  upNext: [{ bookingId: 'future-1', roomId: '302', guestName: 'Next Guest', checkInAt: '2026-09-12T14:30:00+08:00', paidNts: 500 }],
};

function gateway(value: RoomOverviewProjection): RoomOverviewGateway {
  return {
    subscribe(_propertyId, onValue) {
      queueMicrotask(() => onValue(value));
      return () => undefined;
    },
  };
}

describe('live room overview UI', () => {
  it('renders the same live projection in detailed desktop markup and the mobile dialog', async () => {
    render(<App roomOverviewGateway={gateway(projection)} />);

    const roomButton = await screen.findByRole('button', { name: '查看 301 房詳細資料' });
    expect(screen.queryByText('201')).not.toBeInTheDocument();
    expect(roomButton.closest('article')).toHaveTextContent('Live Guest');
    expect(roomButton.closest('article')).toHaveTextContent('即將退房');
    expect(roomButton.closest('article')).toHaveTextContent('NT$ 2,400');
    expect(screen.getByText('4')).toBeInTheDocument();
    expect(screen.getByText('302 · Next Guest')).toBeInTheDocument();

    fireEvent.click(roomButton);
    const dialog = screen.getByRole('dialog', { name: '301 房詳細資料' });
    expect(dialog).toHaveTextContent('Live Guest');
    expect(dialog).toHaveTextContent('2026-09-12 20:00');
    expect(dialog).toHaveTextContent('下一筆預約');
    expect(dialog).toHaveTextContent('餘額應收');
  });

  it('fails closed instead of showing preview rooms when live loading fails', async () => {
    const failingGateway: RoomOverviewGateway = {
      subscribe(_propertyId, _onValue, onError) {
        queueMicrotask(() => onError(new Error('denied')));
        return () => undefined;
      },
    };
    render(<App roomOverviewGateway={failingGateway} />);

    expect(await screen.findByText('無法載入即時房態')).toBeInTheDocument();
    expect(screen.queryByText('201')).not.toBeInTheDocument();
    expect(screen.getByText('系統不會改用展示資料。', { exact: false })).toBeInTheDocument();
  });

  it('removes a previously rendered projection after a listener error', async () => {
    let emitValue: ((value: RoomOverviewProjection) => void) | undefined;
    let emitError: ((error: Error) => void) | undefined;
    const interruptedGateway: RoomOverviewGateway = {
      subscribe(_propertyId, onValue, onError) {
        emitValue = onValue;
        emitError = onError;
        return () => undefined;
      },
    };
    render(<App roomOverviewGateway={interruptedGateway} />);

    await act(async () => emitValue?.(projection));
    expect(screen.getByRole('button', { name: '查看 301 房詳細資料' })).toBeInTheDocument();
    await act(async () => emitError?.(new Error('listener stopped')));
    expect(screen.getByText('無法載入即時房態')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '查看 301 房詳細資料' })).not.toBeInTheDocument();
  });

  it('filters the detailed desktop cards by room status without changing the live source', async () => {
    const mixedProjection: RoomOverviewProjection = { ...projection, rooms: [...projection.rooms, { ...projection.rooms[0], roomId: '302', status: '可入住', guestName: null, checkInAt: null, checkOutAt: null, totalDueNts: null, totalPaidNts: null, depositPaidNts: null, balanceDueNts: null, nextBookingAt: null, actions: ['checkin'] }] };
    render(<App roomOverviewGateway={gateway(mixedProjection)} />);
    await screen.findByRole('button', { name: '查看 301 房詳細資料' });
    fireEvent.click(screen.getByRole('button', { name: /可入住 房態 1/ }));
    expect(screen.getByRole('button', { name: '查看 302 房詳細資料' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '查看 301 房詳細資料' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /全部房間 2/ }));
    expect(screen.getByRole('button', { name: '查看 301 房詳細資料' })).toBeInTheDocument();
  });

  it('routes a permitted room-card payment action to the matching live stay', async () => {
    const session: StaffSession = { uid: 'front-1', email: 'front@example.com', displayName: 'Front Desk', propertyId: 'property-main', role: 'front_desk', allowedPages: ['payments'] };
    const staysGateway: ActiveStaysGateway = {
      subscribe(_propertyId, onValue) {
        queueMicrotask(() => onValue([{ stayId: 'STY-live-301', roomId: '301', guestName: 'Live Guest', phone: null, plan: '24hrs', checkInAt: '2026-09-12T08:00:00.000Z', checkOutAt: '2026-09-12T20:00:00.000Z', originalCheckOutAt: '2026-09-12T20:00:00.000Z', baseRentNts: 2_400, extensionFeeNts: 0, extraFeeNts: 0, totalDueNts: 2_400 }]));
        return () => undefined;
      },
    };
    const paymentListGateway: PaymentListGateway = { subscribe(_propertyId, onValue) { queueMicrotask(() => onValue([])); return () => undefined; } };
    const paymentCreateGateway: PaymentCreateGateway = { create: async () => ({ status: 'created', paymentId: 'PAY-1', stayId: 'STY-live-301', roomId: '301', amountNts: 1, createdAt: '2026-09-12T08:00:00.000Z' }) };

    render(<App activeStaysGateway={staysGateway} paymentCreateGateway={paymentCreateGateway} paymentListGateway={paymentListGateway} roomOverviewGateway={gateway(projection)} session={session} />);

    fireEvent.click(await screen.findByRole('button', { name: /付款/ }));
    const staySelector = await screen.findByLabelText('收款對象');
    await waitFor(() => expect(staySelector).toHaveValue('stay:STY-live-301'));
  });

  it('opens extend and check-out with the room card already selected', async () => {
    const session: StaffSession = { uid: 'front-1', email: 'front@example.com', displayName: 'Front Desk', propertyId: 'property-main', role: 'front_desk', allowedPages: ['rooms', 'extend', 'checkout'] };
    const other = { stayId: 'STY-live-205', roomId: '205', guestName: 'Other Guest', phone: null, plan: '24hrs', checkInAt: '2026-09-12T08:00:00.000Z', checkOutAt: '2026-09-13T08:00:00.000Z', originalCheckOutAt: '2026-09-13T08:00:00.000Z', baseRentNts: 1_000, extensionFeeNts: 0, extraFeeNts: 0, totalDueNts: 1_000, bookingId: null, createdAt: null };
    const target = { ...other, stayId: 'STY-live-301', roomId: '301', guestName: 'Live Guest' };
    const staysGateway: ActiveStaysGateway = { subscribe(_propertyId, onValue) { queueMicrotask(() => onValue([other, target])); return () => undefined; } };
    const holidayCalendarGateway = { subscribe(_propertyId: string, onValue: (calendar: { days: Map<string, boolean>; coveredYears: Set<number> }) => void) { queueMicrotask(() => onValue({ days: new Map(), coveredYears: new Set() })); return () => undefined; } };

    const { unmount } = render(<App activeStaysGateway={staysGateway} holidayCalendarGateway={holidayCalendarGateway} roomOverviewGateway={gateway(projection)} session={session} stayExtendGateway={{ extend: async () => { throw new Error('not used'); } }} />);
    fireEvent.click((await screen.findAllByRole('button', { name: '延住處理' }))[0]!);
    await waitFor(() => expect(screen.getByLabelText('選擇在住房')).toHaveValue('STY-live-301'));
    // +/- one hour, never below one hour.
    const hours = screen.getByLabelText('延住時數');
    expect(hours).toHaveValue(2);
    fireEvent.click(screen.getByRole('button', { name: '增加 1 小時' }));
    expect(hours).toHaveValue(3);
    for (let index = 0; index < 5; index += 1) fireEvent.click(screen.getByRole('button', { name: '減少 1 小時' }));
    expect(hours).toHaveValue(1);
    expect(screen.getByRole('button', { name: '減少 1 小時' })).toBeDisabled();
    unmount();

    render(<App activeStaysGateway={staysGateway} roomOverviewGateway={gateway(projection)} session={session} stayCheckoutGateway={{ checkout: async () => { throw new Error('not used'); } }} />);
    fireEvent.click((await screen.findAllByRole('button', { name: '退房辦理' }))[0]!);
    await waitFor(() => expect(screen.getByLabelText('選擇在住房')).toHaveValue('STY-live-301'));
  });
});

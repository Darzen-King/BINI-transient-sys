// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import type { RoomOverviewProjection } from '@bini/cloud-shared';
import { App } from '../src/App.js';
import type { RoomOverviewGateway } from '../src/rooms/room-overview.js';

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
});

// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { BookingListItem } from '@bini/cloud-shared';
import { App } from '../src/App.js';
import type { BookingListGateway } from '../src/bookings/booking-list.js';
import type { PaymentListGateway } from '../src/payments/payment-list.js';
import type { PropertyProfileGateway } from '../src/properties/property-profile.js';

afterEach(cleanup);

const booking: BookingListItem = {
  bookingId: 'RSV-live-203',
  roomId: '203',
  guestName: '王小明',
  phone: '0912-345-678',
  checkInAt: '2026-10-05T15:00:00+08:00',
  checkOutAt: '2026-10-06T13:00:00+08:00',
  plan: '24hrs',
  amountNts: 1_600,
  discountNts: 0,
  rateType: '非假日',
  status: '已預約',
};

const bookingGateway: BookingListGateway = {
  subscribe(_propertyId, onValue) {
    queueMicrotask(() => onValue([booking]));
    return () => undefined;
  },
};

const profileGateway: PropertyProfileGateway = {
  load: async () => ({ name: 'BINI Blooms 總館', address: '台北市中山區示範路 1 號', phone: '02-1234-5678' }),
};

function depositGateway(amountNts: number): PaymentListGateway {
  return {
    subscribe(_propertyId, onValue) {
      queueMicrotask(() => onValue([{
        paymentId: 'P-1',
        bookingId: 'RSV-live-203',
        roomId: '203',
        guestName: '王小明',
        paymentType: 'cash',
        amountNts,
        deposit: true,
        refund: false,
        status: 'paid',
        note: null,
        createdAt: '2026-10-01T09:00:00.000Z',
      }]));
      return () => undefined;
    },
  };
}

async function openCertificate(ui: Parameters<typeof render>[0]) {
  render(ui);
  fireEvent.click(screen.getByRole('link', { name: '預約管理' }));
  fireEvent.click(await screen.findByText('203 · 王小明'));
  fireEvent.click(screen.getByRole('button', { name: '預約證明（PDF）' }));
  return screen.findByRole('dialog', { name: '預約證明' });
}

describe('reservation certificate UI', () => {
  it('prints the booked times, the guest and the store on a sheet staff can save as PDF', async () => {
    const print = vi.fn();
    vi.stubGlobal('print', print);
    await openCertificate(<App bookingListGateway={bookingGateway} propertyProfileGateway={profileGateway} />);

    const sheet = await waitFor(() => {
      const node = document.querySelector('.confirmation-sheet');
      expect(node).not.toBeNull();
      return node as HTMLElement;
    });
    expect(sheet).toHaveTextContent('BINI Blooms 總館');
    expect(sheet).toHaveTextContent('台北市中山區示範路 1 號');
    expect(sheet).toHaveTextContent('02-1234-5678');
    expect(sheet).toHaveTextContent('王小明');
    expect(sheet).toHaveTextContent('0912-345-678');
    expect(sheet).toHaveTextContent('2026-10-05 15:00');
    expect(sheet).toHaveTextContent('2026-10-06 13:00');
    expect(sheet).toHaveTextContent('RSV-live-203');
    expect(sheet).toHaveTextContent('入住注意事項');

    fireEvent.click(screen.getByRole('button', { name: '列印／儲存 PDF' }));
    expect(print).toHaveBeenCalledTimes(1);
    vi.unstubAllGlobals();
  });

  it('shows the deposit collected and the balance still due', async () => {
    await openCertificate(<App bookingListGateway={bookingGateway} paymentListGateway={depositGateway(600)} propertyProfileGateway={profileGateway} />);

    const sheet = await waitFor(() => document.querySelector('.confirmation-sheet') as HTMLElement);
    expect(screen.getByText('已收押金').nextSibling).toHaveTextContent('NT$ 600');
    expect(screen.getByText('未付餘額').nextSibling).toHaveTextContent('NT$ 1,000');
    expect(sheet).toHaveTextContent('NT$ 1,600');
  });

  it('refuses to print a store name or address it could not read', async () => {
    const failing: PropertyProfileGateway = { load: async () => { throw new Error('denied'); } };
    await openCertificate(<App bookingListGateway={bookingGateway} propertyProfileGateway={failing} />);

    expect(await screen.findByText('無法讀取館別資料')).toBeInTheDocument();
    expect(document.querySelector('.confirmation-sheet')).toBeNull();
    expect(screen.getByRole('button', { name: '列印／儲存 PDF' })).toBeDisabled();
  });

  it('closes the sheet and leaves the booking list in place', async () => {
    await openCertificate(<App bookingListGateway={bookingGateway} propertyProfileGateway={profileGateway} />);
    await waitFor(() => expect(document.querySelector('.confirmation-sheet')).not.toBeNull());

    fireEvent.click(screen.getByRole('button', { name: '關閉' }));
    expect(screen.queryByRole('dialog', { name: '預約證明' })).not.toBeInTheDocument();
    expect(screen.getByText('203 · 王小明')).toBeInTheDocument();
  });
});

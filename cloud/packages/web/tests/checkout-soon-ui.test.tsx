// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ActiveStayItem } from '@bini/cloud-shared';

import { BookingSoonBanner } from '../src/bookings/BookingSoonBanner.js';
import { CheckoutSoonBanner } from '../src/stays/CheckoutSoonBanner.js';
import type { ActiveStaysGateway } from '../src/stays/active-stays.js';

const stay = (stayId: string, roomId: string, minutesFromNow: number): ActiveStayItem => {
  const checkOutAt = new Date(Date.now() + minutesFromNow * 60_000 + 30_000).toISOString();
  return { stayId, roomId, guestName: `Guest ${roomId}`, phone: null, plan: '24hrs', checkInAt: '2026-09-13T02:00:00.000Z', checkOutAt, originalCheckOutAt: checkOutAt, baseRentNts: 1_000, extensionFeeNts: 0, extraFeeNts: 0, totalDueNts: 1_000 };
};
const gatewayOf = (stays: ActiveStayItem[]): ActiveStaysGateway => ({ subscribe(_propertyId, onValue) { onValue(stays); return () => undefined; } });

beforeEach(() => sessionStorage.clear());
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('reminder banners', () => {
  it('reminds about check-outs due within 15 minutes, chimes once per stay and can be dismissed', () => {
    const chime = vi.fn();
    const onOpenRooms = vi.fn();
    const gateway = gatewayOf([stay('A', '202', 5), stay('B', '203', 40)]);
    const { unmount } = render(<CheckoutSoonBanner chime={chime} gateway={gateway} onOpenRooms={onOpenRooms} propertyId="property-main" />);
    expect(screen.getByText('即將退房')).toBeInTheDocument();
    expect(screen.getByText('202 · Guest 202')).toBeInTheDocument();
    expect(screen.getByText('還有 5 分鐘')).toBeInTheDocument();
    expect(screen.queryByText('203 · Guest 203')).not.toBeInTheDocument();
    expect(chime).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: '房間總覽' }));
    expect(onOpenRooms).toHaveBeenCalled();
    unmount();

    render(<CheckoutSoonBanner chime={chime} gateway={gateway} onOpenRooms={onOpenRooms} propertyId="property-main" />);
    expect(chime).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: '知道了' }));
    expect(screen.queryByText('即將退房')).not.toBeInTheDocument();
  });

  it('chimes for a newly arriving booking like v3', () => {
    const chime = vi.fn();
    const checkInAt = new Date(Date.now() + 10 * 60_000).toISOString();
    render(<BookingSoonBanner cancelGateway={undefined} chime={chime} gateway={{ subscribe(_propertyId, onValue) { onValue([{ bookingId: 'RSV-1', roomId: '205', guestName: 'Arriving', checkInAt, minutesUntil: 10 }]); return () => undefined; } }} propertyId="property-main" />);
    expect(screen.getByText('205 · Arriving')).toBeInTheDocument();
    expect(chime).toHaveBeenCalledTimes(1);
  });
});

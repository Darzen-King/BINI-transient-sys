import { describe, expect, it } from 'vitest';
import { buildCheckoutSoonList, type ActiveStayItem } from '@bini/cloud-shared';

const stay = (stayId: string, roomId: string, checkOutAt: string): ActiveStayItem => ({
  stayId, roomId, guestName: `Guest ${roomId}`, phone: null, plan: '24hrs', checkInAt: '2026-09-13T02:00:00.000Z', checkOutAt,
  originalCheckOutAt: checkOutAt, baseRentNts: 1_000, extensionFeeNts: 0, extraFeeNts: 0, totalDueNts: 1_000,
});

describe('checkout-soon reminders', () => {
  it('lists stays due within 15 minutes, soonest first, excluding overdue and later stays', () => {
    const now = Date.parse('2026-09-14T02:00:00.000Z');
    const items = buildCheckoutSoonList([
      stay('late', '203', '2026-09-14T02:15:00.000Z'),
      stay('overdue', '201', '2026-09-14T01:59:00.000Z'),
      stay('soon', '202', '2026-09-14T10:04:30+08:00'),
      stay('later', '205', '2026-09-14T02:16:00.000Z'),
      stay('now', '206', '2026-09-14T02:00:00.000Z'),
    ], now);
    expect(items).toEqual([
      { stayId: 'soon', roomId: '202', guestName: 'Guest 202', checkOutAt: '2026-09-14T10:04:30+08:00', minutesLeft: 4 },
      { stayId: 'late', roomId: '203', guestName: 'Guest 203', checkOutAt: '2026-09-14T02:15:00.000Z', minutesLeft: 15 },
    ]);
  });
});

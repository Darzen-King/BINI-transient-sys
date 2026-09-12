import { describe, expect, it } from 'vitest';

import { buildBookingSoonList } from '@bini/cloud-shared';

const now = Date.parse('2026-09-14T05:00:00.000Z');

describe('booking-soon projection', () => {
  it('keeps only active arrivals strictly within the v3 15-minute window', () => {
    const result = buildBookingSoonList([
      { id: 'RSV-early', data: { bookingId: 'RSV-early', roomId: '201', guestName: 'Early', checkInAt: '2026-09-14T05:00:00.000Z', status: '已預約' } },
      { id: 'RSV-soon', data: { bookingId: 'RSV-soon', roomId: '203', guestName: 'Soon', checkInAt: '2026-09-14T05:09:59.000Z', status: '已預約' } },
      { id: 'RSV-boundary', data: { bookingId: 'RSV-boundary', roomId: '205', guestName: 'Boundary', checkInAt: '2026-09-14T05:15:00.000Z', status: '已預約' } },
      { id: 'RSV-later', data: { bookingId: 'RSV-later', roomId: '206', guestName: 'Later', checkInAt: '2026-09-14T05:15:01.000Z', status: '已預約' } },
      { id: 'RSV-cancelled', data: { bookingId: 'RSV-cancelled', roomId: '207', guestName: 'Cancelled', checkInAt: '2026-09-14T05:05:00.000Z', status: '已取消' } },
    ], now);

    expect(result).toEqual([
      { bookingId: 'RSV-soon', roomId: '203', guestName: 'Soon', checkInAt: '2026-09-14T05:09:59.000Z', minutesUntil: 9 },
      { bookingId: 'RSV-boundary', roomId: '205', guestName: 'Boundary', checkInAt: '2026-09-14T05:15:00.000Z', minutesUntil: 15 },
    ]);
  });

  it('fails closed when a booking identity is malformed', () => {
    expect(() => buildBookingSoonList([{ id: 'RSV-1', data: { bookingId: 'OTHER', roomId: '203', guestName: 'Guest', checkInAt: '2026-09-14T05:05:00.000Z', status: '已預約' } }], now)).toThrow(/booking-soon schema/);
  });
});

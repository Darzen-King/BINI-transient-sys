import { describe, expect, it } from 'vitest';

import { excludeCurrentBooking } from '../src/bookings/preview-update-booking.js';

describe('booking update preview', () => {
  it('excludes only the booking being edited, retaining other booking, stay and maintenance conflicts', () => {
    expect(excludeCurrentBooking([
      { id: 'RSV-editing', source: 'booking', roomId: '203', startAt: '2026-09-14T05:00:00Z', endAt: '2026-09-15T05:00:00Z', status: '已預約', guestName: 'Current' },
      { id: 'RSV-other', source: 'booking', roomId: '203', startAt: '2026-09-15T05:00:00Z', endAt: '2026-09-16T05:00:00Z', status: '已預約', guestName: 'Other' },
      { id: 'STAY-1', source: 'stay', roomId: '203', startAt: '2026-09-16T05:00:00Z', endAt: '2026-09-17T05:00:00Z', status: '使用中', guestName: 'Guest' },
      { id: 'MAINT-1', source: 'maintenance', roomId: '203', startAt: '2026-09-17T05:00:00Z', endAt: '2026-09-18T05:00:00Z', status: 'scheduled', guestName: null },
    ], 'RSV-editing').map((candidate) => candidate.id)).toEqual(['RSV-other', 'STAY-1', 'MAINT-1']);
  });
});

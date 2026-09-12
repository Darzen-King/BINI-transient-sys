import { describe, expect, it } from 'vitest';

import { buildActiveBookingList } from '@bini/cloud-shared';

const booking = (bookingId: string, overrides: Record<string, unknown> = {}) => ({
  id: bookingId,
  data: {
    bookingId,
    roomId: '203',
    guestName: 'Chris',
    phone: '0900-000-000',
    checkInAt: '2026-09-14T13:00:00+08:00',
    checkOutAt: '2026-09-15T13:00:00+08:00',
    plan: '24hrs',
    amountNts: 1_200,
    discountNts: 0,
    rateType: '非假日',
    status: '已預約',
    ...overrides,
  },
});

describe('active booking list', () => {
  it('keeps only v3-active reservations and orders them by check-in time', () => {
    const list = buildActiveBookingList([
      booking('RSV-late', { checkInAt: '2026-09-16T13:00:00+08:00' }),
      booking('RSV-cancelled', { status: '已取消' }),
      booking('RSV-early', { checkInAt: '2026-09-13T13:00:00+08:00' }),
      booking('RSV-checked-in', { status: '已入住' }),
    ]);

    expect(list.map((item) => item.bookingId)).toEqual(['RSV-early', 'RSV-late']);
  });

  it('searches booking id, room, guest and phone without changing authoritative data', () => {
    expect(buildActiveBookingList([booking('RSV-001')], '0900')).toHaveLength(1);
    expect(buildActiveBookingList([booking('RSV-001')], 'missing')).toEqual([]);
  });

  it('fails closed on a malformed or identity-mismatched document', () => {
    expect(() => buildActiveBookingList([booking('RSV-001', { bookingId: 'RSV-other' })])).toThrow(/identity/);
    expect(() => buildActiveBookingList([booking('RSV-001', { amountNts: 1.5 })])).toThrow(/schema/);
  });
});

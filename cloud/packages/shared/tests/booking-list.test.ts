import { describe, expect, it } from 'vitest';

import { buildActiveBookingList, sortBookingList, type BookingListItem } from '@bini/cloud-shared';

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

describe('sortBookingList (v3 booking-management column sort)', () => {
  const item = (bookingId: string, roomId: string, guestName: string, checkInAt: string, amountNts: number, plan = '24hrs'): BookingListItem => ({
    bookingId, roomId, guestName, phone: null, checkInAt, checkOutAt: checkInAt, plan, amountNts, discountNts: 0, rateType: null, status: '已預約',
  });
  const list = [
    item('b1', '205', 'eve', '2026-09-23T10:01:00.000Z', 1000),
    item('b2', '10', 'Bev', '2026-09-22T04:00:00.000Z', 3600, '12hrs'),
    item('b3', '203', 'marvin', '2026-09-22T04:00:00.000Z', 1000),
  ];

  it('sorts by any v3 column in either direction', () => {
    expect(sortBookingList(list, 'checkin').map((b) => b.bookingId)).toEqual(['b2', 'b3', 'b1']);
    expect(sortBookingList(list, 'checkin', 'desc')[0]!.bookingId).toBe('b1');
    expect(sortBookingList(list, 'room').map((b) => b.roomId)).toEqual(['10', '203', '205']);
    expect(sortBookingList(list, 'guest').map((b) => b.guestName)).toEqual(['Bev', 'eve', 'marvin']);
    expect(sortBookingList(list, 'amount', 'desc')[0]!.bookingId).toBe('b2');
    expect(sortBookingList(list, 'plan')[0]!.plan).toBe('12hrs');
  });

  it('keeps check-in order for ties and never mutates the input', () => {
    expect(sortBookingList(list, 'amount').map((b) => b.bookingId)).toEqual(['b3', 'b1', 'b2']);
    expect(list.map((b) => b.bookingId)).toEqual(['b1', 'b2', 'b3']);
  });
});

import { describe, expect, it } from 'vitest';

import {
  bookingConfirmationFileName,
  buildBookingConfirmation,
  type BookingConfirmationProperty,
  type BookingListItem,
} from '../src/index.js';

const booking: BookingListItem = {
  bookingId: 'RSV-2026-0014',
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

const property: BookingConfirmationProperty = {
  name: 'BINI Blooms 總館',
  address: '台北市中山區示範路 1 號',
  phone: '02-1234-5678',
};

describe('reservation certificate', () => {
  it('prints the booked times in Taipei time with the guest and store details', () => {
    const certificate = buildBookingConfirmation({ booking, property, issuedAt: '2026-10-01T02:30:00Z' });

    expect(certificate.checkInText).toBe('2026-10-05 15:00');
    expect(certificate.checkOutText).toBe('2026-10-06 13:00');
    expect(certificate.issuedAtText).toBe('2026-10-01 10:30');
    expect(certificate.stayHours).toBe(22);
    expect(certificate.guestName).toBe('王小明');
    expect(certificate.guestPhone).toBe('0912-345-678');
    expect(certificate.propertyName).toBe('BINI Blooms 總館');
    expect(certificate.propertyAddress).toBe('台北市中山區示範路 1 號');
    expect(certificate.propertyPhone).toBe('02-1234-5678');
    expect(certificate.bookingId).toBe('RSV-2026-0014');
    expect(certificate.roomId).toBe('203');
    expect(certificate.plan).toBe('24hrs');
  });

  it('leaves the full amount outstanding when no deposit has been collected', () => {
    const certificate = buildBookingConfirmation({ booking, property, issuedAt: '2026-10-01T10:00:00+08:00' });

    expect(certificate.payableNts).toBe(1_600);
    expect(certificate.depositPaidNts).toBe(0);
    expect(certificate.balanceDueNts).toBe(1_600);
  });

  it('subtracts the deposit already collected and never shows a negative balance', () => {
    const part = buildBookingConfirmation({ booking, property, depositPaidNts: 500, issuedAt: '2026-10-01T10:00:00+08:00' });
    const over = buildBookingConfirmation({ booking, property, depositPaidNts: 2_000, issuedAt: '2026-10-01T10:00:00+08:00' });

    expect(part.balanceDueNts).toBe(1_100);
    expect(over.balanceDueNts).toBe(0);
    expect(over.depositPaidNts).toBe(2_000);
  });

  it('shows the price before a discount, because the stored amount is already net of it', () => {
    const certificate = buildBookingConfirmation({
      booking: { ...booking, amountNts: 1_400, discountNts: 200 },
      property,
      issuedAt: '2026-10-01T10:00:00+08:00',
    });

    expect(certificate.grossAmountNts).toBe(1_600);
    expect(certificate.discountNts).toBe(200);
    expect(certificate.payableNts).toBe(1_400);
  });

  it('keeps a missing phone, address or rate type empty instead of inventing one', () => {
    const certificate = buildBookingConfirmation({
      booking: { ...booking, phone: null, rateType: null },
      property: { name: 'BINI Blooms 北館', address: '   ', phone: null },
      issuedAt: '2026-10-01T10:00:00+08:00',
    });

    expect(certificate.guestPhone).toBeNull();
    expect(certificate.rateType).toBeNull();
    expect(certificate.propertyAddress).toBeNull();
    expect(certificate.propertyPhone).toBeNull();
  });

  it('carries the printed terms through unchanged', () => {
    const certificate = buildBookingConfirmation({
      booking,
      property,
      issuedAt: '2026-10-01T10:00:00+08:00',
      notes: ['請出示身分證件辦理入住。'],
    });

    expect(certificate.notes).toEqual(['請出示身分證件辦理入住。']);
  });

  it('refuses a booking that is no longer an active reservation', () => {
    const cancelled = { ...booking, status: '已取消' } as unknown as BookingListItem;

    expect(() => buildBookingConfirmation({ booking: cancelled, property, issuedAt: '2026-10-01T10:00:00+08:00' }))
      .toThrow(/active booking/);
  });

  it('refuses times that are not a stay, an unnamed store and a broken issue time', () => {
    expect(() => buildBookingConfirmation({
      booking: { ...booking, checkOutAt: booking.checkInAt },
      property,
      issuedAt: '2026-10-01T10:00:00+08:00',
    })).toThrow(/check-out is not after/);
    expect(() => buildBookingConfirmation({ booking, property: { ...property, name: '  ' }, issuedAt: '2026-10-01T10:00:00+08:00' }))
      .toThrow(/not valid/);
    expect(() => buildBookingConfirmation({ booking, property, issuedAt: 'not-a-time' })).toThrow(/not valid/);
    expect(() => buildBookingConfirmation({ booking, property, depositPaidNts: -1, issuedAt: '2026-10-01T10:00:00+08:00' }))
      .toThrow(/not valid/);
  });

  it('builds a file name a guest can recognise and keeps it safe for a file system', () => {
    expect(bookingConfirmationFileName({ bookingId: 'RSV-2026-0014' })).toBe('BINI-預約證明-RSV-2026-0014');
    expect(bookingConfirmationFileName({ bookingId: 'v3/booking 7' }, 'Reservation')).toBe('BINI-Reservation-v3-booking-7');
  });
});

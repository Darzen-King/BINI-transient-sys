import { describe, expect, it } from 'vitest';

import {
  bookingCreateInputSchema,
  findBookingAvailabilityConflict,
  quoteBooking,
} from '@bini/cloud-shared';

const calendar = { days: new Map<string, boolean>(), coveredYears: new Set<number>() };
const input = (overrides: Record<string, unknown> = {}) => bookingCreateInputSchema.parse({
  propertyId: 'property-main',
  operationId: '4d6d61d5-b1f8-42eb-8104-0521bc05dd01',
  roomId: '203',
  guestName: 'Chris',
  phone: '0900-000-000',
  checkInAt: '2026-09-14T13:00:00+08:00',
  plan: '24hrs',
  days: 1,
  discountNts: 100,
  pricingMode: 'automatic',
  ...overrides,
});

describe('booking creation contract', () => {
  it('derives a v3-compatible multi-day checkout and server-side automatic quote', () => {
    const quote = quoteBooking(input(), calendar);

    expect(quote.checkInAt).toBe('2026-09-14T05:00:00.000Z');
    expect(quote.checkOutAt).toBe('2026-09-15T05:00:00.000Z');
    expect(quote.grossAmountNts).toBe(1_000);
    expect(quote.amountNts).toBe(900);
    expect(quote.rateType).toBe('非假日');
  });

  it('uses property holiday overrides for every 12-hour price block', () => {
    const quote = quoteBooking(input({ plan: '12hrs', days: 2, discountNts: 0 }), {
      days: new Map([['2026-09-14', true]]),
      coveredYears: new Set([2026]),
    });

    expect(quote.grossAmountNts).toBe(1_200);
    expect(quote.amountNts).toBe(1_200);
    expect(quote.rateType).toBe('假日');
  });

  it('only accepts a submitted amount when manual pricing is explicit', () => {
    expect(() => input({ pricingMode: 'manual' })).toThrow(/手動金額/);
    expect(() => input({ pricingMode: 'automatic', manualAmountNts: 1_234 })).toThrow(/自動計價/);
    expect(quoteBooking(input({ pricingMode: 'manual', manualAmountNts: 1_234 }), calendar).amountNts).toBe(1_234);
  });

  it('requires an unambiguous time-zone offset for callable input', () => {
    expect(() => input({ checkInAt: '2026-09-14T13:00:00.000' })).toThrow(/帶時區/);
  });

  it('detects booking, stay and maintenance overlap while allowing boundary hand-offs', () => {
    expect(findBookingAvailabilityConflict('203', '2026-09-14T05:00:00Z', '2026-09-15T05:00:00Z', [{
      id: 'RSV-boundary', source: 'booking', roomId: '203', guestName: 'Earlier', status: '已預約',
      startAt: '2026-09-13T17:00:00Z', endAt: '2026-09-14T05:00:00Z',
    }])).toBeNull();
    expect(findBookingAvailabilityConflict('203', '2026-09-14T05:00:00Z', '2026-09-15T05:00:00Z', [{
      id: 'STAY-7', source: 'stay', roomId: '203', guestName: 'Current', status: '使用中',
      startAt: '2026-09-14T04:00:00Z', endAt: '2026-09-14T06:00:00Z',
    }])).toMatchObject({ id: 'STAY-7', source: 'stay' });
    expect(findBookingAvailabilityConflict('203', '2026-09-14T05:00:00Z', '2026-09-15T05:00:00Z', [{
      id: 'MAINT-3', source: 'maintenance', roomId: '203', guestName: null, status: 'scheduled',
      startAt: '2026-09-14T07:00:00Z', endAt: '2026-09-14T08:00:00Z',
    }])).toMatchObject({ id: 'MAINT-3', source: 'maintenance' });
  });
});

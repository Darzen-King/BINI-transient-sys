import { describe, expect, it } from 'vitest';

import {
  bookingCancelInputSchema,
  bookingCreateInputSchema,
  bookingUpdateInputSchema,
  findBookingAvailabilityConflict,
  quoteBooking,
  quoteStayExtension,
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

describe('booking cancellation contract', () => {
  it('accepts only a property-scoped UUID operation for a booking id', () => {
    expect(bookingCancelInputSchema.parse({
      propertyId: 'property-main',
      bookingId: 'RSV-260914-ABC12345',
      operationId: '6c2b6dc7-5283-4c08-a6c8-6b7865ed9cb8',
      cancellationReason: 'no_show',
    })).toMatchObject({ bookingId: 'RSV-260914-ABC12345', cancellationReason: 'no_show' });
    expect(() => bookingCancelInputSchema.parse({
      propertyId: 'property-main',
      bookingId: 'RSV-260914-ABC12345',
      operationId: 'not-a-uuid',
    })).toThrow();
    expect(() => bookingCancelInputSchema.parse({
      propertyId: 'property-main',
      bookingId: 'RSV-260914-ABC12345',
      operationId: '6c2b6dc7-5283-4c08-a6c8-6b7865ed9cb8',
      directWrite: true,
    })).toThrow();
  });
});

describe('booking update contract', () => {
  it('allows v3-compatible past check-in while keeping manual pricing explicit', () => {
    const updated = bookingUpdateInputSchema.parse({
      propertyId: 'property-main',
      operationId: '0517fbaf-6f98-4ef2-84d9-8d2e2b84f8ca',
      bookingId: 'RSV-260914-ABC12345',
      roomId: '203',
      guestName: 'Chris',
      phone: null,
      checkInAt: '2026-09-01T13:00:00+08:00',
      plan: '12hrs',
      days: 2,
      discountNts: 0,
      pricingMode: 'manual',
      manualAmountNts: 1_500,
    });
    expect(quoteBooking(updated, calendar).amountNts).toBe(1_500);
    expect(() => bookingUpdateInputSchema.parse({ ...updated, pricingMode: 'automatic', manualAmountNts: 1_500 })).toThrow(/自動計價/);
  });
});

describe('stay extension pricing', () => {
  it('continues the v3 stay timeline instead of charging a fresh 12-hour block', () => {
    const quote = quoteStayExtension('2026-09-14T13:00:00+08:00', '2026-09-15T01:00:00+08:00', 12, calendar);
    expect(quote.extensionFeeNts).toBe(200);
    expect(quote.fromHours).toBe(12);
    expect(quote.toHours).toBe(24);
    expect(quote.breakdown).toEqual([expect.objectContaining({ hours: 12, ceilingNts: 200, feeNts: 200 })]);
  });

  it('uses the correct subsequent 12-hour block and accepts half-hour extensions', () => {
    const quote = quoteStayExtension('2026-09-14T13:00:00+08:00', '2026-09-15T13:00:00+08:00', 0.5, calendar);
    expect(quote.extensionFeeNts).toBe(100);
    expect(quote.breakdown).toEqual([expect.objectContaining({ hours: 0.5, ceilingNts: 800, feeNts: 100 })]);
  });
});

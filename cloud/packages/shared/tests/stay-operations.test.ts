import { describe, expect, it } from 'vitest';

import { paymentCreateInputSchema, stayCheckInInputSchema, stayCheckoutInputSchema, stayTransferInputSchema } from '../src/index.js';

const base = {
  propertyId: 'property-main', operationId: '11111111-1111-4111-8111-111111111111', roomId: '203', bookingId: null,
  guestName: 'Walk in', phone: null, checkInAt: '2026-09-14T15:00:00+08:00', plan: '24hrs' as const, days: 1,
  discountNts: 0, pricingMode: 'automatic' as const,
};

describe('stay check-in contract', () => {
  it('accepts a walk-in with an optional deposit', () => {
    expect(stayCheckInInputSchema.parse({ ...base, deposit: { amountNts: 500, paymentType: 'cash' } }).deposit).toEqual({ amountNts: 500, paymentType: 'cash' });
  });

  it('requires exactly the correct manual amount mode', () => {
    expect(() => stayCheckInInputSchema.parse({ ...base, pricingMode: 'manual' })).toThrow(/手動金額/);
    expect(() => stayCheckInInputSchema.parse({ ...base, manualAmountNts: 800 })).toThrow(/自動計價/);
    expect(stayCheckInInputSchema.parse({ ...base, pricingMode: 'manual', manualAmountNts: 800 }).manualAmountNts).toBe(800);
  });
});

describe('stay checkout contract', () => {
  it('requires property-scoped UUID input and allows only non-negative fee adjustments', () => {
    expect(stayCheckoutInputSchema.parse({ propertyId: 'property-main', operationId: '22222222-2222-4222-8222-222222222222', stayId: 'STY-live-203', extraFeeNts: 50, overdueFeeOverrideNts: 0 })).toMatchObject({ extraFeeNts: 50, overdueFeeOverrideNts: 0 });
    expect(() => stayCheckoutInputSchema.parse({ propertyId: 'property-main', operationId: 'not-a-uuid', stayId: 'STY-live-203' })).toThrow();
    expect(() => stayCheckoutInputSchema.parse({ propertyId: 'property-main', operationId: '22222222-2222-4222-8222-222222222222', stayId: 'STY-live-203', extraFeeNts: -1 })).toThrow();
  });
});

describe('stay transfer contract', () => {
  it('requires distinct property-scoped stay and target-room identifiers', () => {
    expect(stayTransferInputSchema.parse({ propertyId: 'property-main', operationId: '44444444-4444-4444-8444-444444444444', stayId: 'STY-live-203', targetRoomId: '205' })).toMatchObject({ stayId: 'STY-live-203', targetRoomId: '205' });
    expect(() => stayTransferInputSchema.parse({ propertyId: 'property-main', operationId: '44444444-4444-4444-8444-444444444444', stayId: 'STY/live-203', targetRoomId: '205' })).toThrow();
  });
});

describe('normal payment contract', () => {
  it('requires a property-scoped active stay and a positive integer amount', () => {
    expect(paymentCreateInputSchema.parse({ propertyId: 'property-main', operationId: '33333333-3333-4333-8333-333333333333', stayId: 'STY-live-203', amountNts: 800, paymentType: 'cash', note: '補收' })).toMatchObject({ amountNts: 800, paymentType: 'cash' });
    expect(() => paymentCreateInputSchema.parse({ propertyId: 'property-main', operationId: '33333333-3333-4333-8333-333333333333', stayId: 'STY-live-203', amountNts: 0, paymentType: 'cash' })).toThrow();
  });
});

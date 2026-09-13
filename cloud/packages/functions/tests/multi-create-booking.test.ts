import { describe, expect, it } from 'vitest';

import { bookingMultiCreateInputSchema } from '@bini/cloud-shared';

import { planMultiBookingSlots } from '../src/bookings/multi-create-booking.js';

const calendar = { days: new Map<string, boolean>(), coveredYears: new Set<number>() };

describe('multi-slot booking planner', () => {
  it('keeps v3 partial-success behavior while preventing overlaps inside the same request', () => {
    const input = bookingMultiCreateInputSchema.parse({
      propertyId: 'property-main',
      operationId: 'a6a2fd51-7d17-42e1-9e15-dba1f762d248',
      guestName: 'Chris',
      phone: null,
      slots: [
        { roomId: '203', checkInAt: '2026-09-14T13:00:00+08:00', plan: '24hrs', days: 1, discountNts: 0, pricingMode: 'automatic' },
        { roomId: '203', checkInAt: '2026-09-15T12:00:00+08:00', plan: '24hrs', days: 1, discountNts: 0, pricingMode: 'automatic' },
        { roomId: '205', checkInAt: '2026-09-15T13:00:00+08:00', plan: '12hrs', days: 1, discountNts: 0, pricingMode: 'automatic' },
      ],
    });
    const result = planMultiBookingSlots(
      input,
      calendar,
      new Map([
        ['203', { roomId: '203', status: '可入住' }],
        ['205', { roomId: '205', status: '可入住' }],
      ]),
      new Map(),
      Date.parse('2026-09-13T00:00:00.000Z'),
    );

    expect(result.created.map((item) => item.slotNumber)).toEqual([1, 3]);
    expect(result.conflicts).toEqual([expect.objectContaining({
      slotNumber: 2,
      reason: 'conflict',
      conflict: expect.objectContaining({ source: 'booking' }),
    })]);
    expect(result.quotesBySlotNumber.get(1)?.amountNts).toBe(1_000);
    expect(result.quotesBySlotNumber.get(3)?.amountNts).toBe(800);
  });
});

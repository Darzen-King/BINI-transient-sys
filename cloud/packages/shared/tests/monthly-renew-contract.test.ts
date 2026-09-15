import { describe, expect, it } from 'vitest';

import { monthlyRentalRenewInputSchema } from '../src/contracts/room-management-operations.js';

const base = { propertyId: 'property-main', operationId: '9d9a3c52-6f3f-4a0e-9bb1-1f1a2f3c4d5e', roomId: '206', paymentType: 'cash' } as const;

describe('monthly renewal contract', () => {
  it('requires the end date staff saw, so the server can refuse a repeated renewal', () => {
    expect(monthlyRentalRenewInputSchema.safeParse(base).success).toBe(false);
    expect(monthlyRentalRenewInputSchema.safeParse({ ...base, expectedEndDate: '2026-10-01' }).success).toBe(true);
    expect(monthlyRentalRenewInputSchema.safeParse({ ...base, expectedEndDate: '2026/10/01' }).success).toBe(false);
  });
});

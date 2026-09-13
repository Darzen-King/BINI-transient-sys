import { describe, expect, it } from 'vitest';
import { propertyCreateInputSchema, sortPropertyDirectory } from '@bini/cloud-shared';

describe('property contracts', () => {
  it('uses a stable, path-safe property id', () => {
    expect(propertyCreateInputSchema.safeParse({ sourcePropertyId: 'property-main', operationId: 'c0c7d2dd-c11a-4d45-a3a7-4c5432fd1f7a', propertyId: 'P-002', name: 'BINI 2', address: null, phone: null, note: null }).success).toBe(true);
    expect(propertyCreateInputSchema.safeParse({ sourcePropertyId: 'property-main', operationId: 'c0c7d2dd-c11a-4d45-a3a7-4c5432fd1f7a', propertyId: '../other', name: 'BINI 2' }).success).toBe(false);
  });

  it('sorts only validated property memberships', () => {
    const common = { address: null, phone: null, note: null, active: true, currency: 'TWD' as const, timezone: 'Asia/Taipei' as const, role: 'admin' as const, allowedPages: ['rooms'] as const };
    expect(sortPropertyDirectory([{ propertyId: 'P002', name: 'Two', ...common }, { propertyId: 'P001', name: 'One', ...common }]).map((item) => item.propertyId)).toEqual(['P001', 'P002']);
  });
});

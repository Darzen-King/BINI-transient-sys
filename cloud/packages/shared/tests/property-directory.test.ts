import { describe, expect, it } from 'vitest';
import { propertyCreateInputSchema, propertyUpdateInputSchema, sortPropertyDirectory } from '@bini/cloud-shared';

describe('property contracts', () => {
  it('uses a stable, path-safe property id', () => {
    expect(propertyCreateInputSchema.safeParse({ sourcePropertyId: 'property-main', operationId: 'c0c7d2dd-c11a-4d45-a3a7-4c5432fd1f7a', propertyId: 'P-002', name: 'BINI 2', address: null, phone: null, note: null }).success).toBe(true);
    expect(propertyCreateInputSchema.safeParse({ sourcePropertyId: 'property-main', operationId: 'c0c7d2dd-c11a-4d45-a3a7-4c5432fd1f7a', propertyId: '../other', name: 'BINI 2' }).success).toBe(false);
  });

  it('accepts a store-details edit and refuses anything that is not one', () => {
    const operationId = 'c0c7d2dd-c11a-4d45-a3a7-4c5432fd1f7a';
    const edit = { propertyId: 'P001', operationId, name: 'BINI Blooms', address: '台北市中山區示範路 1 號', phone: '02-1234-5678', note: null };

    expect(propertyUpdateInputSchema.safeParse(edit).success).toBe(true);
    // A cleared address is null, never an empty string that would print as a blank line.
    expect(propertyUpdateInputSchema.safeParse({ ...edit, address: null, phone: null }).success).toBe(true);
    expect(propertyUpdateInputSchema.safeParse({ ...edit, name: '' }).success).toBe(false);
    expect(propertyUpdateInputSchema.safeParse({ ...edit, propertyId: '../other' }).success).toBe(false);
    expect(propertyUpdateInputSchema.safeParse({ ...edit, operationId: 'not-a-uuid' }).success).toBe(false);
    // The property id is the target, so no extra field may redirect the write.
    expect(propertyUpdateInputSchema.safeParse({ ...edit, sourcePropertyId: 'P002' }).success).toBe(false);
  });

  it('sorts only validated property memberships', () => {
    const common = { address: null, phone: null, note: null, active: true, currency: 'TWD' as const, timezone: 'Asia/Taipei' as const, role: 'admin' as const, allowedPages: ['rooms'] as const };
    expect(sortPropertyDirectory([{ propertyId: 'P002', name: 'Two', ...common }, { propertyId: 'P001', name: 'One', ...common }]).map((item) => item.propertyId)).toEqual(['P001', 'P002']);
  });
});

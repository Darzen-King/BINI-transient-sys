import { describe, expect, it } from 'vitest';

import { buildRoomManagementItems, monthlyRentalCreateInputSchema, roomManagementUpdateInputSchema } from '@bini/cloud-shared';

describe('room management domain and contracts', () => {
  it('joins only the active monthly rental to its room', () => {
    const items = buildRoomManagementItems(
      [{ id: '201', data: { roomId: '201', status: '月租套房', note: 'long stay', maintenanceNote: null, maintenanceDueDate: null } }],
      [
        { id: 'MR-old', data: { roomId: '201', tenantName: 'Old', startDate: '2026-01-01', endDate: '2026-02-01', depositNts: 1_000, rentNts: 9_000, status: 'renewed', paymentType: 'cash', note: null } },
        { id: 'MR-live', data: { roomId: '201', tenantName: 'Live Tenant', tenantPhone: '0900', startDate: '2026-02-01', endDate: '2026-03-01', depositNts: 1_000, rentNts: 9_000, status: 'active', paymentType: 'transfer', note: 'quiet' } },
      ],
    );
    expect(items).toEqual([expect.objectContaining({ roomId: '201', monthly: expect.objectContaining({ rentalId: 'MR-live', tenantName: 'Live Tenant', paymentType: 'transfer' }) })]);
  });

  it('requires maintenance details only when setting a maintenance room', () => {
    expect(roomManagementUpdateInputSchema.safeParse({ propertyId: 'property-main', operationId: '00000000-0000-4000-8000-000000000001', roomId: '201', status: '維修中', note: null, maintenanceNote: null, maintenanceDueDate: null }).success).toBe(false);
    expect(roomManagementUpdateInputSchema.safeParse({ propertyId: 'property-main', operationId: '00000000-0000-4000-8000-000000000001', roomId: '201', status: '維修中', note: 'blocked', maintenanceNote: 'air conditioner', maintenanceDueDate: '2026-09-15' }).success).toBe(true);
  });

  it('rejects negative monthly amounts before a callable request', () => {
    expect(monthlyRentalCreateInputSchema.safeParse({ propertyId: 'property-main', operationId: '00000000-0000-4000-8000-000000000002', roomId: '205', tenantName: 'Tenant', tenantPhone: null, startDate: '2026-09-12', depositNts: -1, rentNts: 8_000, paymentType: 'cash', note: null }).success).toBe(false);
  });
});

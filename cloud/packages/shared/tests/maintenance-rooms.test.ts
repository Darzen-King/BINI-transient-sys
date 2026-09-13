import { describe, expect, it } from 'vitest';

import { buildMaintenanceRoomItems, maintenanceRoomUpdateInputSchema } from '../src/index.js';

const base = { propertyId: 'property-main', operationId: '44444444-4444-4444-8444-444444444444', roomId: '205' };

describe('maintenance room update contract', () => {
  it('accepts a progress note update with a non-empty note', () => {
    expect(maintenanceRoomUpdateInputSchema.safeParse({ ...base, action: 'update_note', maintenanceNote: '冷氣零件已訂' }).success).toBe(true);
  });

  it('rejects a progress note update without a note, like v3 ignoring an empty note', () => {
    expect(maintenanceRoomUpdateInputSchema.safeParse({ ...base, action: 'update_note', maintenanceNote: '   ' }).success).toBe(false);
    expect(maintenanceRoomUpdateInputSchema.safeParse({ ...base, action: 'update_note', maintenanceNote: null }).success).toBe(false);
  });

  it('accepts resolve only without a note payload', () => {
    expect(maintenanceRoomUpdateInputSchema.safeParse({ ...base, action: 'resolve', maintenanceNote: null }).success).toBe(true);
    expect(maintenanceRoomUpdateInputSchema.safeParse({ ...base, action: 'resolve', maintenanceNote: 'x' }).success).toBe(false);
  });

  it('rejects unknown actions and extra fields', () => {
    expect(maintenanceRoomUpdateInputSchema.safeParse({ ...base, action: 'delete', maintenanceNote: null }).success).toBe(false);
    expect(maintenanceRoomUpdateInputSchema.safeParse({ ...base, action: 'resolve', maintenanceNote: null, status: '可入住' }).success).toBe(false);
  });
});

describe('maintenance room projection', () => {
  const documents = [
    { id: '207', data: { roomId: '207', status: '維修中', maintenanceNote: '馬桶漏水', maintenanceDueDate: '2026-09-15' } },
    { id: '201', data: { roomId: '201', status: '可入住', maintenanceNote: null, maintenanceDueDate: null } },
    { id: '205', data: { roomId: '205', status: '維修中', maintenanceNote: '冷氣故障', maintenanceDueDate: '2026-09-10' } },
    { id: '206', data: { roomId: '206', status: '月租套房' } },
    { id: '203', data: { roomId: '203', status: '維修中' } },
  ];

  it('lists only rooms under maintenance, sorted by room number', () => {
    expect(buildMaintenanceRoomItems(documents, '2026-09-13').map((item) => item.roomId)).toEqual(['203', '205', '207']);
  });

  it('flags a due date earlier than the Taipei day as overdue, matching the v3 warning badge', () => {
    const items = buildMaintenanceRoomItems(documents, '2026-09-13');
    expect(items.find((item) => item.roomId === '205')).toMatchObject({ maintenanceNote: '冷氣故障', maintenanceDueDate: '2026-09-10', overdue: true });
    expect(items.find((item) => item.roomId === '207')).toMatchObject({ overdue: false });
    expect(items.find((item) => item.roomId === '203')).toMatchObject({ maintenanceNote: null, maintenanceDueDate: null, overdue: false });
  });

  it('fails closed on a malformed room document instead of hiding it', () => {
    expect(() => buildMaintenanceRoomItems([{ id: '209', data: { roomId: '209', status: '壞掉' } }], '2026-09-13')).toThrow();
    expect(() => buildMaintenanceRoomItems([{ id: '209', data: { roomId: '208', status: '維修中' } }], '2026-09-13')).toThrow();
  });
});

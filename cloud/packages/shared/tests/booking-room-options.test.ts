import { describe, expect, it } from 'vitest';

import { buildBookingRoomOptions } from '@bini/cloud-shared';

describe('booking room options', () => {
  it('validates document identity and orders rooms naturally', () => {
    expect(buildBookingRoomOptions([
      { id: '205', data: { roomId: '205', status: '可入住' } },
      { id: '12', data: { roomId: '12', status: '月租套房' } },
      { id: '203', data: { roomId: '203', status: '使用中' } },
    ])).toEqual([
      { roomId: '12', status: '月租套房' },
      { roomId: '203', status: '使用中' },
      { roomId: '205', status: '可入住' },
    ]);
  });

  it('fails closed when a room document is malformed or mismatched', () => {
    expect(() => buildBookingRoomOptions([{ id: '201', data: { roomId: '202', status: '可入住' } }])).toThrow(/booking room schema/);
    expect(() => buildBookingRoomOptions([{ id: '201', data: { roomId: '201', status: 'unknown' } }])).toThrow(/booking room schema/);
  });
});

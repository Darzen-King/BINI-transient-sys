import { describe, expect, it } from 'vitest';

import { buildRoomOverviewProjection, type RoomOverviewSource } from '@bini/cloud-shared';

const now = new Date('2026-09-12T00:30:00+08:00');

function source(overrides: Partial<RoomOverviewSource> = {}): RoomOverviewSource {
  return {
    rooms: [
      { id: '201', data: { roomId: '201', status: '使用中', guestName: 'Room cache', checkInAt: '2026-09-11T15:00:00+08:00', checkOutAt: '2026-09-12T03:00:00+08:00', note: 'Late arrival' } },
      { id: '202', data: { roomId: '202', status: '可入住', guestName: null, checkInAt: null, checkOutAt: null, note: null } },
      { id: '203', data: { roomId: '203', status: '可入住', guestName: null, checkInAt: null, checkOutAt: null, note: null } },
    ],
    bookings: [
      { id: 'expired', data: { bookingId: 'expired', roomId: '202', guestName: 'Expired', checkInAt: '2026-09-11T23:59:00+08:00', checkOutAt: '2026-09-12T11:59:00+08:00', status: '已預約' } },
      { id: 'future-late', data: { bookingId: 'future-late', roomId: '202', guestName: 'Later', checkInAt: '2026-09-12T21:00:00+08:00', checkOutAt: '2026-09-13T09:00:00+08:00', status: '已預約' } },
      { id: 'future-first', data: { bookingId: 'future-first', roomId: '202', guestName: 'Next', checkInAt: '2026-09-12T15:00:00+08:00', checkOutAt: '2026-09-13T03:00:00+08:00', status: '已預約' } },
      { id: 'cancelled', data: { bookingId: 'cancelled', roomId: '203', guestName: 'Cancelled', checkInAt: '2026-09-12T14:00:00+08:00', checkOutAt: '2026-09-13T02:00:00+08:00', status: '已取消' } },
    ],
    stays: [
      { id: 'stay-1', data: { roomId: '201', guestName: 'Current guest', checkInAt: '2026-09-11T15:00:00+08:00', checkOutAt: '2026-09-12T03:00:00+08:00', totalDueNts: 2_000, bookingId: 'booking-1', createdAt: '2026-09-11T15:05:00+08:00' } },
    ],
    payments: [
      { id: 'deposit', data: { roomId: '201', bookingId: 'booking-1', amountNts: 500, deposit: true, refund: false, createdAt: '2026-09-10T12:00:00+08:00' } },
      { id: 'payment', data: { roomId: '201', bookingId: null, amountNts: 900, deposit: false, refund: false, createdAt: '2026-09-11T16:00:00+08:00' } },
      { id: 'refund', data: { roomId: '201', bookingId: null, amountNts: 100, deposit: false, refund: true, createdAt: '2026-09-11T17:00:00+08:00' } },
      { id: 'old', data: { roomId: '201', bookingId: null, amountNts: 9_999, deposit: false, refund: false, createdAt: '2026-09-01T12:00:00+08:00' } },
    ],
    maintenanceSchedules: [],
    ...overrides,
  };
}

describe('room overview projection', () => {
  it('derives only the earliest active future booking and never uses stale room cache fields', () => {
    const projection = buildRoomOverviewProjection(source(), now);
    const room202 = projection.rooms.find((room) => room.roomId === '202');
    const room203 = projection.rooms.find((room) => room.roomId === '203');

    expect(room202?.nextBookingAt).toBe('2026-09-12T15:00:00+08:00');
    expect(room203?.nextBookingAt).toBeNull();
    expect(projection.upNext.map((item) => item.bookingId)).toEqual(['future-first', 'future-late']);
  });

  it('matches v3 payment scope for the active stay', () => {
    const room = buildRoomOverviewProjection(source(), now).rooms[0];

    expect(room.guestName).toBe('Current guest');
    expect(room.totalDueNts).toBe(2_000);
    expect(room.depositPaidNts).toBe(500);
    expect(room.totalPaidNts).toBe(1_300);
    expect(room.balanceDueNts).toBe(700);
  });

  it('calculates booking receipts independently of Firestore document order', () => {
    const base = source();
    const projection = buildRoomOverviewProjection({
      ...base,
      payments: [
        { id: 'refund-first', data: { roomId: '202', bookingId: 'future-first', amountNts: 100, deposit: false, refund: true, createdAt: '2026-09-12T00:00:00+08:00' } },
        { id: 'payment-second', data: { roomId: '202', bookingId: 'future-first', amountNts: 500, deposit: true, refund: false, createdAt: '2026-09-12T00:01:00+08:00' } },
      ],
    }, now);

    expect(projection.upNext.find((item) => item.bookingId === 'future-first')?.paidNts).toBe(400);
  });

  it('overlays an active maintenance schedule and removes front-desk actions', () => {
    const projection = buildRoomOverviewProjection(source({
      maintenanceSchedules: [{
        id: 'maintenance-1',
        data: {
          roomId: '202',
          title: 'Air conditioner',
          startAt: '2026-09-12T00:00:00+08:00',
          endAt: '2026-09-12T02:00:00+08:00',
          status: 'in_progress',
        },
      }],
    }), now);
    const room = projection.rooms.find((candidate) => candidate.roomId === '202');

    expect(room).toMatchObject({
      status: '維修中',
      maintenanceTitle: 'Air conditioner',
      maintenanceEndAt: '2026-09-12T02:00:00+08:00',
      actions: [],
    });
  });

  it('computes today summary in Asia/Taipei', () => {
    const projection = buildRoomOverviewProjection(source(), now);

    expect(projection.summary).toEqual({
      arrivalsToday: 2,
      departuresToday: 1,
      cleaningPending: 0,
    });
  });

  it('fails closed when a room has multiple active stays', () => {
    const base = source();
    expect(() => buildRoomOverviewProjection({
      ...base,
      stays: [...base.stays, { id: 'stay-2', data: { ...base.stays[0].data } }],
    }, now)).toThrow('multiple active stays');
  });

  it('fails closed on malformed authoritative data', () => {
    expect(() => buildRoomOverviewProjection(source({
      rooms: [{ id: '201', data: { roomId: '201', status: 'unknown' } }],
    }), now)).toThrow('rooms/201');
  });
});

import { describe, expect, it } from 'vitest';
import { buildRoomTimeline } from '../src/index.js';

describe('room timeline projection', () => {
  it('renders only current/future valid events that overlap the fourteen-day Taipei window', () => {
    const result = buildRoomTimeline({ rooms: [{ id: '201', data: { roomId: '201' } }], bookings: [{ id: 'RSV-1', data: { bookingId: 'RSV-1', roomId: '201', guestName: 'Booking', checkInAt: '2026-09-14T07:00:00.000Z', checkOutAt: '2026-09-15T07:00:00.000Z', status: '已預約' } }, { id: 'RSV-old', data: { bookingId: 'RSV-old', roomId: '201', guestName: 'Old', checkInAt: '2026-08-01T07:00:00.000Z', checkOutAt: '2026-08-02T07:00:00.000Z', status: '已預約' } }], stays: [], maintenanceSchedules: [{ id: 'M-1', data: { roomId: '201', title: 'Aircon', startAt: '2026-09-13T07:00:00.000Z', endAt: '2026-09-13T12:00:00.000Z', status: 'scheduled' } }], monthlyRentals: [{ id: 'MR-1', data: { roomId: '201', tenantName: 'Tenant', startDate: '2026-09-01', endDate: '2026-10-01', status: 'active' } }] }, new Date('2026-09-13T04:00:00.000Z'));
    expect(result.rooms).toEqual([expect.objectContaining({ roomId: '201', events: [expect.objectContaining({ type: 'monthly', label: 'Tenant' }), expect.objectContaining({ type: 'maintenance', label: 'Aircon' }), expect.objectContaining({ type: 'booking', label: 'Booking' })] })]);
  });
});

describe('voided monthly rentals', () => {
  it('ignores a voided record instead of failing the whole timeline', () => {
    // A record voided in Room Management used to crash this page with an enum error.
    const result = buildRoomTimeline({
      rooms: [{ id: '201', data: { roomId: '201' } }],
      bookings: [],
      stays: [],
      maintenanceSchedules: [],
      monthlyRentals: [
        { id: 'MR-void', data: { roomId: '201', tenantName: 'Tenant', startDate: '2026-09-01', endDate: '2026-10-01', status: 'voided' } },
        { id: 'MR-live', data: { roomId: '201', tenantName: 'Tenant', startDate: '2026-09-10', endDate: '2026-10-10', status: 'active' } },
      ],
    }, new Date('2026-09-13T04:00:00.000Z'));
    const monthly = result.rooms.flatMap((room) => room.events).filter((event) => event.type === 'monthly');
    expect(monthly.map((event) => event.id)).toEqual(['MR-live']);
  });
});

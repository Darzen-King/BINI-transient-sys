import { describe, expect, it } from 'vitest';

import { chunk, propertyRecipientUids, pushTokenDocId, reminderSources, staleTokenIndexes } from '../src/notifications/push-plan.js';

const now = Date.parse('2026-09-15T13:50:00+08:00');
const booking = (id: string, checkInAt: string, status = '已預約') => ({ id, data: { bookingId: id, roomId: '203', guestName: 'Juvy', checkInAt, status } });
const stay = (id: string, checkOutAt: string) => ({ id, data: { stayId: id, roomId: '202', guestName: '陳小明', phone: null, plan: '24hrs', checkInAt: '2026-09-14T14:00:00+08:00', checkOutAt, originalCheckOutAt: checkOutAt, baseRentNts: 1_000, extensionFeeNts: 0, extraFeeNts: 0, totalDueNts: 1_000, bookingId: null, createdAt: '2026-09-14T14:00:00+08:00' } });

describe('push reminder planning', () => {
  it('uses the v3 15-minute windows and skips malformed documents without dropping the rest', () => {
    const sources = reminderSources(
      [booking('RSV-1', '2026-09-15T14:00:00+08:00'), booking('RSV-2', '2026-09-15T14:30:00+08:00'), booking('RSV-3', '2026-09-15T14:05:00+08:00', '已取消'), { id: 'RSV-bad', data: { bookingId: 'RSV-bad' } }],
      [stay('STY-1', '2026-09-15T14:04:00+08:00'), stay('STY-2', '2026-09-15T13:40:00+08:00'), { id: 'STY-bad', data: {} }],
      now,
    );
    expect(sources.bookings.map((item) => [item.bookingId, item.minutesUntil])).toEqual([['RSV-1', 10]]);
    expect(sources.checkouts.map((item) => [item.stayId, item.minutesLeft])).toEqual([['STY-1', 14]]);
    expect(sources.skipped).toEqual(['bookings/RSV-bad', 'stays/STY-bad']);
  });

  it('notifies every active member of the property, whatever their role or pages', () => {
    const users = [
      { id: 'admin', data: { active: true, roles: { 'property-main': 'admin' } } },
      { id: 'cleaner', data: { active: true, roles: { 'property-main': 'housekeeping' }, allowedPages: { 'property-main': ['housekeeping'] } } },
      { id: 'other-property', data: { active: true, roles: { 'property-two': 'front_desk' } } },
      { id: 'disabled', data: { active: false, roles: { 'property-main': 'front_desk' } } },
    ];
    expect(propertyRecipientUids(users, 'property-main')).toEqual(['admin', 'cleaner']);
  });

  it('hashes tokens for document ids, removes only tokens FCM reports as gone, and chunks queries', () => {
    expect(pushTokenDocId('token-abc')).toMatch(/^[0-9a-f]{64}$/u);
    expect(pushTokenDocId('token-abc')).not.toContain('token');
    expect(staleTokenIndexes([
      { success: true },
      { success: false, error: { code: 'messaging/registration-token-not-registered' } },
      { success: false, error: { code: 'messaging/internal-error' } },
      { success: false, error: { code: 'messaging/invalid-registration-token' } },
    ])).toEqual([1, 3]);
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  });
});

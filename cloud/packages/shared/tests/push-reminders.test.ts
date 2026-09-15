import { describe, expect, it } from 'vitest';

import { planPushReminders } from '../src/domain/push-reminders.js';

describe('push reminder messages', () => {
  it('builds one message per arrival and check-out, keyed by event and target time', () => {
    const reminders = planPushReminders(
      [{ bookingId: 'RSV-260915-A1', roomId: '203', guestName: 'Juvy', checkInAt: '2026-09-15T14:00:00+08:00', minutesUntil: 14 }],
      [{ stayId: 'STY/202', roomId: '202', guestName: '陳小明', checkOutAt: '2026-09-15T13:00:00+08:00', minutesLeft: 9 }],
    );
    expect(reminders).toEqual([
      { key: `booking_soon_RSV-260915-A1_${Date.parse('2026-09-15T14:00:00+08:00')}`, kind: 'booking_soon', targetId: 'RSV-260915-A1', roomId: '203', title: '即將入住 · 203 房', body: 'Juvy · 09/15 14:00 入住（約 14 分鐘後）' },
      { key: `checkout_soon_STY_202_${Date.parse('2026-09-15T13:00:00+08:00')}`, kind: 'checkout_soon', targetId: 'STY/202', roomId: '202', title: '即將退房 · 202 房', body: '陳小明 · 09/15 13:00 退房（約 9 分鐘後）' },
    ]);
  });

  it('gives an extended check-out a new key and prefixes the property when several exist', () => {
    const base = { stayId: 'STY-1', roomId: '201', guestName: 'A', minutesLeft: 10 };
    const [first] = planPushReminders([], [{ ...base, checkOutAt: '2026-09-15T13:00:00+08:00' }]);
    const [extended] = planPushReminders([], [{ ...base, checkOutAt: '2026-09-15T15:00:00+08:00' }], '二館');
    expect(extended?.key).not.toBe(first?.key);
    expect(extended?.title).toBe('［二館］即將退房 · 201 房');
  });
});

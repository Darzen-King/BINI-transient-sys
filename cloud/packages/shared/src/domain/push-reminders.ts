import type { BookingSoonItem } from './booking-soon.js';
import type { CheckoutSoonItem } from './checkout-soon.js';

export interface PushReminder {
  /** Stable per event and target time: an extended check-out or moved check-in is a new reminder. */
  key: string;
  kind: 'booking_soon' | 'checkout_soon';
  targetId: string;
  roomId: string;
  title: string;
  body: string;
}

/** `MM/DD HH:mm` in Taipei time, independent of the server locale. */
function taipeiClock(iso: string): string {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Taipei', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    .formatToParts(new Date(iso)).map((part) => [part.type, part.value]));
  return `${parts.month}/${parts.day} ${parts.hour}:${parts.minute}`;
}

const safeKeyPart = (value: string) => value.replace(/[^A-Za-z0-9_-]/gu, '_').slice(0, 120);

/**
 * Turns the v3 reminder windows (arrivals and check-outs due within 15 minutes) into push messages.
 * The same lists drive the in-app banners, so a phone notification always matches what the app shows.
 */
export function planPushReminders(bookings: readonly BookingSoonItem[], checkouts: readonly CheckoutSoonItem[], propertyLabel: string | null = null): PushReminder[] {
  const prefix = propertyLabel ? `［${propertyLabel}］` : '';
  return [
    ...bookings.map((booking): PushReminder => ({
      key: `booking_soon_${safeKeyPart(booking.bookingId)}_${Date.parse(booking.checkInAt)}`,
      kind: 'booking_soon',
      targetId: booking.bookingId,
      roomId: booking.roomId,
      title: `${prefix}即將入住 · ${booking.roomId} 房`,
      body: `${booking.guestName} · ${taipeiClock(booking.checkInAt)} 入住（約 ${booking.minutesUntil} 分鐘後）`,
    })),
    ...checkouts.map((stay): PushReminder => ({
      key: `checkout_soon_${safeKeyPart(stay.stayId)}_${Date.parse(stay.checkOutAt)}`,
      kind: 'checkout_soon',
      targetId: stay.stayId,
      roomId: stay.roomId,
      title: `${prefix}即將退房 · ${stay.roomId} 房`,
      body: `${stay.guestName} · ${taipeiClock(stay.checkOutAt)} 退房（約 ${stay.minutesLeft} 分鐘後）`,
    })),
  ];
}

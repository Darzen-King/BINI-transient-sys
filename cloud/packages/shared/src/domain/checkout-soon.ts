import type { ActiveStayItem } from './active-stay.js';

export interface CheckoutSoonItem {
  stayId: string;
  roomId: string;
  guestName: string;
  checkOutAt: string;
  minutesLeft: number;
}

/** The v3 `/api/checkout-soon` rule: stays due out within the next 15 minutes and not yet overdue. */
export function buildCheckoutSoonList(stays: readonly ActiveStayItem[], nowMillis = Date.now()): CheckoutSoonItem[] {
  const deadline = nowMillis + 15 * 60_000;
  return stays
    .map((stay) => ({ stay, checkOutMillis: Date.parse(stay.checkOutAt) }))
    .filter(({ checkOutMillis }) => checkOutMillis > nowMillis && checkOutMillis <= deadline)
    .sort((left, right) => left.checkOutMillis - right.checkOutMillis)
    .map(({ stay, checkOutMillis }) => ({
      stayId: stay.stayId,
      roomId: stay.roomId,
      guestName: stay.guestName,
      checkOutAt: stay.checkOutAt,
      minutesLeft: Math.floor((checkOutMillis - nowMillis) / 60_000),
    }));
}

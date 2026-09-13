export interface StayPaymentScope {
  roomId: string;
  checkInAt?: string | null | undefined;
  /** When the stay record was created; v3 counts room payments from this moment (`_stay_payment_floor`). */
  createdAt?: string | null | undefined;
  bookingId?: string | null | undefined;
  totalDueNts: number;
}

export interface StayPaymentRecord {
  roomId?: string | null | undefined;
  bookingId?: string | null | undefined;
  amountNts: number;
  deposit: boolean;
  refund: boolean;
  status?: string | null | undefined;
  createdAt: string;
}

export interface StayPaymentSummary { totalPaidNts: number; depositPaidNts: number; balanceDueNts: number; }

/** v3 active-stay payment scope: same-room payments since the stay began, plus deposits linked to its booking. */
export function summarizeStayPayments(stay: StayPaymentScope, payments: readonly StayPaymentRecord[]): StayPaymentSummary {
  const floor = stay.createdAt ?? stay.checkInAt ?? '';
  const scoped = payments.filter((payment) => payment.status !== 'voided'
    && payment.roomId === stay.roomId
    && ((floor !== '' && Date.parse(payment.createdAt) >= Date.parse(floor)) || (stay.bookingId != null && payment.bookingId === stay.bookingId)));
  const received = scoped.filter((payment) => !payment.refund).reduce((sum, payment) => sum + payment.amountNts, 0);
  const refunded = scoped.filter((payment) => payment.refund).reduce((sum, payment) => sum + payment.amountNts, 0);
  const totalPaidNts = Math.max(0, received - refunded);
  return {
    totalPaidNts,
    depositPaidNts: scoped.filter((payment) => payment.deposit && !payment.refund).reduce((sum, payment) => sum + payment.amountNts, 0),
    balanceDueNts: Math.max(0, stay.totalDueNts - totalPaidNts),
  };
}

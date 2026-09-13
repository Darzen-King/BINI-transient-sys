import type { PaymentCreateInput } from '@bini/cloud-shared';
import { createHash } from 'node:crypto';

export interface StayPaymentContext {
  stay: { bookingId: string | null; guestName: string };
  roomId: string;
  actorUid: string;
  now: string;
  paymentId: string;
}

/**
 * Request fingerprint for operation replay. `deposit: false` is dropped so a normal payment keeps
 * the exact fingerprint it had before the deposit flag existed; retries of already-committed
 * operations therefore still replay instead of being rejected as a different request.
 */
export function paymentCreateFingerprint(input: PaymentCreateInput): string {
  const { deposit, ...rest } = input;
  const normalized = deposit === true ? { ...rest, deposit: true } : rest;
  return createHash('sha256').update(JSON.stringify({ operationType: 'payment.create', ...normalized })).digest('hex');
}

/** Builds the payment document and audit entry for an active-stay payment or deposit. Pure, no I/O. */
export function buildStayPaymentRecord(input: PaymentCreateInput, context: StayPaymentContext) {
  const deposit = input.deposit === true;
  return {
    payment: {
      schemaVersion: 4,
      version: 1,
      propertyId: input.propertyId,
      bookingId: context.stay.bookingId,
      stayId: input.stayId,
      roomId: context.roomId,
      guestName: context.stay.guestName,
      paymentType: input.paymentType,
      amountNts: input.amountNts,
      deposit,
      refund: false,
      status: 'paid',
      note: input.note ?? null,
      createdByUid: context.actorUid,
      createdAt: context.now,
    },
    auditAction: deposit ? 'payment.deposit_create' : 'payment.create',
    auditDetails: {
      operationId: input.operationId,
      stayId: input.stayId,
      roomId: context.roomId,
      amountNts: input.amountNts,
      paymentType: input.paymentType,
      deposit,
    },
  };
}

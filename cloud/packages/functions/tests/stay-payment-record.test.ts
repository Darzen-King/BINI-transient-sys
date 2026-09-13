import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { buildStayPaymentRecord, paymentCreateFingerprint } from '../src/payments/stay-payment-record.js';

const input = {
  propertyId: 'property-main',
  operationId: '33333333-3333-4333-8333-333333333333',
  stayId: 'STY-live-203',
  amountNts: 800,
  paymentType: 'cash' as const,
  note: '補收',
};
const context = {
  stay: { bookingId: 'RSV-203', guestName: 'Guest 203' },
  roomId: '203',
  actorUid: 'staff-main',
  now: '2026-09-13T13:00:00.000Z',
  paymentId: 'PAY-333333333333',
};

describe('active-stay payment record', () => {
  it('records a normal payment linked to the stay booking', () => {
    const record = buildStayPaymentRecord(input, context);
    expect(record.payment).toMatchObject({ bookingId: 'RSV-203', stayId: 'STY-live-203', roomId: '203', guestName: 'Guest 203', amountNts: 800, deposit: false, refund: false, status: 'paid', note: '補收' });
    expect(record.auditAction).toBe('payment.create');
    expect(record.auditDetails).toMatchObject({ deposit: false, amountNts: 800 });
  });

  it('records a v3-style deposit on the active stay so balances and free-cancel refunds see it', () => {
    const record = buildStayPaymentRecord({ ...input, deposit: true }, context);
    expect(record.payment).toMatchObject({ bookingId: 'RSV-203', deposit: true, refund: false, status: 'paid' });
    expect(record.auditAction).toBe('payment.deposit_create');
    expect(record.auditDetails).toMatchObject({ deposit: true });
  });

  it('keeps a stay without a booking link as a null booking reference', () => {
    const record = buildStayPaymentRecord({ ...input, deposit: true }, { ...context, stay: { bookingId: null, guestName: 'Walk in' } });
    expect(record.payment.bookingId).toBeNull();
  });

  it('keeps the normal-payment fingerprint unchanged whether deposit is omitted or false', () => {
    // The exact formula paymentCreate used before the deposit flag existed.
    const legacy = createHash('sha256').update(JSON.stringify({ operationType: 'payment.create', ...input })).digest('hex');
    expect(paymentCreateFingerprint(input)).toBe(legacy);
    expect(paymentCreateFingerprint({ ...input, deposit: false })).toBe(legacy);
    expect(paymentCreateFingerprint({ ...input, deposit: true })).not.toBe(legacy);
  });
});

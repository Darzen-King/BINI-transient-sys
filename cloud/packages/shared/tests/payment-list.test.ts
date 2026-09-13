import { describe, expect, it } from 'vitest';

import { buildPaymentListItems, renderPaymentCsv, summarizePayments } from '../src/domain/payment-list.js';

describe('payment ledger CSV', () => {
  it('keeps v3 ledger column order, Excel BOM, legacy fields and escaped notes', () => {
    const items = buildPaymentListItems([{ id: 'v3-payments-8', data: {
      bookingId: 'RSV-1', roomId: '203', guestName: 'Chris', paymentType: 'cash', amountNts: 500,
      deposit: true, refund: false, status: 'paid', note: 'said "thanks"', invoiceNo: 'INV-8',
      externalTransactionId: 'EXT-8', accountingExportedAt: '2026-09-12T08:00:00.000Z',
      createdByLegacyId: 'admin', createdAt: '2026-09-12T07:00:00.000Z',
    } }]);
    const csv = renderPaymentCsv(items);

    expect(csv.startsWith('\uFEFF"id","booking_id","room_id","guest","payment_type","amount"')).toBe(true);
    expect(csv).toContain('"v3-payments-8","RSV-1","203","Chris","cash","500","true","false","paid","said ""thanks""","INV-8","EXT-8"');
    expect(csv).toContain('"2026-09-12T08:00:00.000Z","2026-09-12T07:00:00.000Z","admin"');
  });

  it('keeps voided payments in the ledger but excludes them from cash summaries', () => {
    const items = buildPaymentListItems([{ id: 'PAY-voided', data: {
      roomId: '201', guestName: 'Guest', paymentType: 'cash', amountNts: 600,
      deposit: false, refund: false, status: 'voided', note: 'duplicate entry', createdAt: '2026-09-13T01:00:00.000Z',
    } }]);
    expect(items[0]?.status).toBe('voided');
    expect(summarizePayments(items, '2026-09-13')).toMatchObject({ receivedNts: 0, refundsNts: 0, netNts: 0, byType: { cash: 0 } });
    expect(renderPaymentCsv(items)).toContain('"voided"');
  });
});

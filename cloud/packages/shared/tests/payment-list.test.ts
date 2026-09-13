import { describe, expect, it } from 'vitest';

import { buildPaymentListItems, renderPaymentCsv, renderPaymentDailySummaryCsv, summarizePayments } from '../src/domain/payment-list.js';

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

  it('accepts promoted v3 timestamps with a +08:00 offset and sorts and summarizes by the real instant', () => {
    const items = buildPaymentListItems([
      { id: 'v3-payments-1', data: { roomId: '203', guestName: 'Legacy', paymentType: 'cash', amountNts: 1_200, status: 'paid', createdAt: '2026-09-13T08:30:00+08:00' } },
      { id: 'PAY-cloud', data: { roomId: '202', guestName: 'Cloud', paymentType: 'card', amountNts: 500, status: 'paid', createdAt: '2026-09-12T17:30:00.000Z' } },
      { id: 'PAY-yesterday', data: { roomId: '201', guestName: 'Late', paymentType: 'cash', amountNts: 300, status: 'paid', createdAt: '2026-09-12T15:59:00.000Z' } },
    ]);

    expect(items.map((item) => item.paymentId)).toEqual(['PAY-yesterday', 'PAY-cloud', 'v3-payments-1'].reverse());
    expect(summarizePayments(items, '2026-09-13')).toMatchObject({ receivedNts: 1_700, byType: { cash: 1_200, card: 500 } });
  });
});

describe('payment day summary and v3 daily_summary CSV', () => {
  const items = buildPaymentListItems([
    { id: 'P1', data: { roomId: '201', guestName: 'A', paymentType: 'cash', amountNts: 1_000, deposit: true, status: 'paid', createdAt: '2026-09-13T09:00:00+08:00' } },
    { id: 'P2', data: { roomId: '201', guestName: 'A', paymentType: 'card', amountNts: 600, status: 'paid', createdAt: '2026-09-13T03:00:00.000Z' } },
    { id: 'P3', data: { roomId: '201', guestName: 'A', paymentType: 'cash', amountNts: 200, refund: true, status: 'refunded', createdAt: '2026-09-13T05:00:00.000Z' } },
    { id: 'P4', data: { roomId: '202', guestName: 'B', paymentType: 'transfer', amountNts: 900, status: 'pending', createdAt: '2026-09-12T05:00:00.000Z' } },
  ]);

  it('adds deposit and transaction totals to the day summary', () => {
    expect(summarizePayments(items, '2026-09-13')).toMatchObject({ receivedNts: 1_600, refundsNts: 200, netNts: 1_400, depositsNts: 1_000, transactionCount: 3, outstandingNts: 900 });
  });

  it('renders one v3 daily_summary row per day with the cashier session status', () => {
    const csv = renderPaymentDailySummaryCsv(items, new Map([['2026-09-13', 'closed']]), '2026-09-12', '2026-09-13');
    expect(csv.startsWith('\uFEFFdate,total_received,total_refunds,net_revenue,cash,transfer,card,other,deposits,pending,session_status\r\n')).toBe(true);
    expect(csv).toContain('2026-09-12,900,0,900,0,900,0,0,0,900,no_session\r\n');
    expect(csv).toContain('2026-09-13,1600,200,1400,1000,0,600,0,1000,900,closed\r\n');
  });
});

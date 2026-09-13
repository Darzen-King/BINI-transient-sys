import { describe, expect, it } from 'vitest';
import { summarizeStayPayments } from '@bini/cloud-shared';

describe('active-stay payment scope', () => {
  it('counts same-room payments since the stay began plus its booking deposit, net of refunds and voids', () => {
    const summary = summarizeStayPayments({ roomId: '202', checkInAt: '2026-09-13T14:00:00+08:00', createdAt: '2026-09-13T14:05:00+08:00', bookingId: 'RSV-1', totalDueNts: 2_400 }, [
      { roomId: '202', bookingId: 'RSV-1', amountNts: 500, deposit: true, refund: false, status: 'paid', createdAt: '2026-09-10T10:00:00+08:00' },
      { roomId: '202', bookingId: null, amountNts: 1_000, deposit: false, refund: false, status: 'paid', createdAt: '2026-09-13T15:00:00+08:00' },
      { roomId: '202', bookingId: null, amountNts: 200, deposit: false, refund: true, status: 'paid', createdAt: '2026-09-13T16:00:00+08:00' },
      { roomId: '202', bookingId: null, amountNts: 900, deposit: false, refund: false, status: 'voided', createdAt: '2026-09-13T16:00:00+08:00' },
      { roomId: '202', bookingId: null, amountNts: 700, deposit: false, refund: false, status: 'paid', createdAt: '2026-09-12T16:00:00+08:00' },
      { roomId: '203', bookingId: null, amountNts: 800, deposit: false, refund: false, status: 'paid', createdAt: '2026-09-13T16:00:00+08:00' },
    ]);
    expect(summary).toEqual({ totalPaidNts: 1_300, depositPaidNts: 500, balanceDueNts: 1_100 });
  });
});

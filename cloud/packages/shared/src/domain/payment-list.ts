import { z } from 'zod';

// Promoted v3 rows keep their Taipei offset (`+08:00`); cloud writes use UTC `Z`. Both are valid instants.
const instantSchema = z.string().datetime({ offset: true });
const instantMs = (value: string) => Date.parse(value);
const taipeiDay = (value: string) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(value));

const paymentSchema = z.object({
  bookingId: z.string().trim().min(1).max(128).nullable().optional(),
  roomId: z.string().trim().min(1).max(128).nullable().optional(),
  guestName: z.string().trim().min(1).max(300).nullable().optional(),
  paymentType: z.enum(['cash', 'transfer', 'card', 'other']),
  amountNts: z.number().int().safe().min(0),
  deposit: z.boolean().optional(),
  refund: z.boolean().optional(),
  status: z.enum(['paid', 'pending', 'partial', 'refunded', 'voided']),
  note: z.string().max(2_000).nullable().optional(),
  invoiceNo: z.string().max(200).nullable().optional(),
  externalTransactionId: z.string().max(300).nullable().optional(),
  accountingExportedAt: instantSchema.nullable().optional(),
  createdByUid: z.string().max(256).nullable().optional(),
  createdByLegacyId: z.string().max(128).nullable().optional(),
  createdAt: instantSchema,
}).passthrough();

export interface PaymentListItem {
  paymentId: string;
  bookingId?: string | null;
  roomId: string | null;
  guestName: string | null;
  paymentType: 'cash' | 'transfer' | 'card' | 'other';
  amountNts: number;
  deposit: boolean;
  refund: boolean;
  status: 'paid' | 'pending' | 'partial' | 'refunded' | 'voided';
  note: string | null;
  invoiceNo?: string | null;
  externalTxnId?: string | null;
  accountingExportedAt?: string | null;
  createdByUid?: string | null;
  createdAt: string;
}

export interface PaymentDailySummary {
  receivedNts: number;
  refundsNts: number;
  netNts: number;
  outstandingNts: number;
  depositsNts: number;
  transactionCount: number;
  byType: Record<PaymentListItem['paymentType'], number>;
}

/** v3 cashier session state for a Taipei day; days never opened export as `no_session`. */
export type CashierSessionStatus = 'open' | 'closed';

export function buildPaymentListItems(documents: readonly { id: string; data: unknown }[]): PaymentListItem[] {
  return documents.map((document) => {
    const payment = paymentSchema.parse(document.data);
    return { paymentId: document.id, bookingId: payment.bookingId ?? null, roomId: payment.roomId ?? null, guestName: payment.guestName ?? null, paymentType: payment.paymentType, amountNts: payment.amountNts, deposit: payment.deposit === true, refund: payment.refund === true, status: payment.status, note: payment.note ?? null, invoiceNo: payment.invoiceNo ?? null, externalTxnId: payment.externalTransactionId ?? null, accountingExportedAt: payment.accountingExportedAt ?? null, createdByUid: payment.createdByUid ?? payment.createdByLegacyId ?? null, createdAt: payment.createdAt };
  }).sort((left, right) => instantMs(right.createdAt) - instantMs(left.createdAt));
}

export function summarizePayments(items: readonly PaymentListItem[], day: string): PaymentDailySummary {
  const byType: PaymentDailySummary['byType'] = { cash: 0, transfer: 0, card: 0, other: 0 };
  let receivedNts = 0; let refundsNts = 0; let outstandingNts = 0; let depositsNts = 0; let transactionCount = 0;
  for (const item of items) {
    if (item.status === 'voided') continue;
    // Like v3 `daily_summary`, outstanding is every unpaid receipt, not only the selected day.
    if (!item.refund && (item.status === 'pending' || item.status === 'partial')) outstandingNts += item.amountNts;
    if (taipeiDay(item.createdAt) !== day) continue;
    transactionCount += 1;
    if (item.refund) refundsNts += item.amountNts;
    else { receivedNts += item.amountNts; byType[item.paymentType] += item.amountNts; if (item.deposit) depositsNts += item.amountNts; }
  }
  return { receivedNts, refundsNts, netNts: receivedNts - refundsNts, outstandingNts, depositsNts, transactionCount, byType };
}

/** v3 `/export/daily_summary` columns: one row per Taipei day in the inclusive range. */
export function renderPaymentDailySummaryCsv(items: readonly PaymentListItem[], sessions: ReadonlyMap<string, CashierSessionStatus>, dateFrom: string, dateTo: string): string {
  const headers = ['date', 'total_received', 'total_refunds', 'net_revenue', 'cash', 'transfer', 'card', 'other', 'deposits', 'pending', 'session_status'];
  const rows: string[] = [];
  for (let point = Date.parse(`${dateFrom}T12:00:00+08:00`), end = Date.parse(`${dateTo}T12:00:00+08:00`); point <= end; point += 86_400_000) {
    const day = taipeiDay(new Date(point).toISOString());
    const summary = summarizePayments(items, day);
    rows.push([day, summary.receivedNts, summary.refundsNts, summary.netNts, summary.byType.cash, summary.byType.transfer, summary.byType.card, summary.byType.other, summary.depositsNts, summary.outstandingNts, sessions.get(day) ?? 'no_session'].join(','));
  }
  return `\uFEFF${[headers.join(','), ...rows].join('\r\n')}\r\n`;
}

const csvCell = (value: string | number | boolean | null | undefined) => `"${String(value ?? '').replaceAll('"', '""')}"`;

/** Keeps v3's canonical payment-ledger column order, including legacy accounting placeholders. */
export function renderPaymentCsv(items: readonly PaymentListItem[]): string {
  const headers = ['id', 'booking_id', 'room_id', 'guest', 'payment_type', 'amount', 'is_deposit', 'is_refund', 'payment_status', 'note', 'invoice_no', 'external_txn_id', 'accounting_exported_at', 'created_at', 'created_by'];
  const rows = items.map((item) => [
    item.paymentId, item.bookingId, item.roomId, item.guestName, item.paymentType, item.amountNts,
    item.deposit, item.refund, item.status, item.note, item.invoiceNo, item.externalTxnId,
    item.accountingExportedAt, item.createdAt, item.createdByUid,
  ].map(csvCell).join(','));
  return `\uFEFF${headers.map(csvCell).join(',')}\r\n${rows.join('\r\n')}\r\n`;
}

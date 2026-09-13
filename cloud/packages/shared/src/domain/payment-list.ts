import { z } from 'zod';

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
  accountingExportedAt: z.string().datetime().nullable().optional(),
  createdByUid: z.string().max(256).nullable().optional(),
  createdByLegacyId: z.string().max(128).nullable().optional(),
  createdAt: z.string().datetime(),
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
  byType: Record<PaymentListItem['paymentType'], number>;
}

export function buildPaymentListItems(documents: readonly { id: string; data: unknown }[]): PaymentListItem[] {
  return documents.map((document) => {
    const payment = paymentSchema.parse(document.data);
    return { paymentId: document.id, bookingId: payment.bookingId ?? null, roomId: payment.roomId ?? null, guestName: payment.guestName ?? null, paymentType: payment.paymentType, amountNts: payment.amountNts, deposit: payment.deposit === true, refund: payment.refund === true, status: payment.status, note: payment.note ?? null, invoiceNo: payment.invoiceNo ?? null, externalTxnId: payment.externalTransactionId ?? null, accountingExportedAt: payment.accountingExportedAt ?? null, createdByUid: payment.createdByUid ?? payment.createdByLegacyId ?? null, createdAt: payment.createdAt };
  }).sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}

export function summarizePayments(items: readonly PaymentListItem[], day: string): PaymentDailySummary {
  const byType: PaymentDailySummary['byType'] = { cash: 0, transfer: 0, card: 0, other: 0 };
  let receivedNts = 0; let refundsNts = 0; let outstandingNts = 0;
  for (const item of items) {
    if (item.status === 'voided') continue;
    if (item.status === 'pending' || item.status === 'partial') outstandingNts += item.amountNts;
    if (!item.createdAt.startsWith(day)) continue;
    if (item.refund) refundsNts += item.amountNts;
    else { receivedNts += item.amountNts; byType[item.paymentType] += item.amountNts; }
  }
  return { receivedNts, refundsNts, netNts: receivedNts - refundsNts, outstandingNts, byType };
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

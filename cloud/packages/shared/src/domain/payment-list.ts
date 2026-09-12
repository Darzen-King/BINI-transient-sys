import { z } from 'zod';

const paymentSchema = z.object({
  roomId: z.string().trim().min(1).max(128).nullable().optional(),
  guestName: z.string().trim().min(1).max(300).nullable().optional(),
  paymentType: z.enum(['cash', 'transfer', 'card', 'other']),
  amountNts: z.number().int().safe().min(0),
  deposit: z.boolean().optional(),
  refund: z.boolean().optional(),
  status: z.enum(['paid', 'pending', 'partial', 'refunded']),
  note: z.string().max(2_000).nullable().optional(),
  createdAt: z.string().datetime(),
}).passthrough();

export interface PaymentListItem {
  paymentId: string;
  roomId: string | null;
  guestName: string | null;
  paymentType: 'cash' | 'transfer' | 'card' | 'other';
  amountNts: number;
  deposit: boolean;
  refund: boolean;
  status: 'paid' | 'pending' | 'partial' | 'refunded';
  note: string | null;
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
    return { paymentId: document.id, roomId: payment.roomId ?? null, guestName: payment.guestName ?? null, paymentType: payment.paymentType, amountNts: payment.amountNts, deposit: payment.deposit === true, refund: payment.refund === true, status: payment.status, note: payment.note ?? null, createdAt: payment.createdAt };
  }).sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}

export function summarizePayments(items: readonly PaymentListItem[], day: string): PaymentDailySummary {
  const byType: PaymentDailySummary['byType'] = { cash: 0, transfer: 0, card: 0, other: 0 };
  let receivedNts = 0; let refundsNts = 0; let outstandingNts = 0;
  for (const item of items) {
    if (item.status === 'pending' || item.status === 'partial') outstandingNts += item.amountNts;
    if (!item.createdAt.startsWith(day)) continue;
    if (item.refund) refundsNts += item.amountNts;
    else { receivedNts += item.amountNts; byType[item.paymentType] += item.amountNts; }
  }
  return { receivedNts, refundsNts, netNts: receivedNts - refundsNts, outstandingNts, byType };
}

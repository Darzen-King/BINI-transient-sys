import { z } from 'zod';

const dateTimeSchema = z.string().trim().min(20).max(64).refine((value) => Number.isFinite(Date.parse(value)), '日期時間格式不正確。');

export interface ActiveStayItem {
  stayId: string;
  roomId: string;
  guestName: string;
  phone: string | null;
  plan: string | null;
  checkInAt: string;
  checkOutAt: string;
  originalCheckOutAt: string;
  baseRentNts: number;
  extensionFeeNts: number;
  extraFeeNts: number;
  totalDueNts: number;
  bookingId: string | null;
  createdAt: string | null;
}

const activeStayDocumentSchema = z.object({
  roomId: z.string().trim().min(1).max(128),
  guestName: z.string().trim().min(1).max(300),
  phone: z.string().trim().max(100).nullable().optional(),
  plan: z.string().trim().max(64).nullable().optional(),
  checkInAt: dateTimeSchema,
  checkOutAt: dateTimeSchema,
  originalCheckOutAt: dateTimeSchema.nullable().optional(),
  baseRentNts: z.number().int().safe().min(0),
  extensionFeeNts: z.number().int().safe().min(0),
  extraFeeNts: z.number().int().safe().min(0),
  totalDueNts: z.number().int().safe().min(0),
  bookingId: z.string().trim().min(1).max(128).nullable().optional(),
  // Tolerant: only a readable timestamp narrows the payment scope; anything else falls back to check-in.
  createdAt: z.unknown().optional(),
}).passthrough();

export function buildActiveStayItems(documents: readonly { id: string; data: unknown }[]): ActiveStayItem[] {
  return documents.map((document) => {
    const stay = activeStayDocumentSchema.parse(document.data);
    return {
      stayId: typeof stay.stayId === 'string' && stay.stayId.trim() ? stay.stayId : document.id,
      roomId: stay.roomId,
      guestName: stay.guestName,
      phone: stay.phone ?? null,
      plan: stay.plan ?? null,
      checkInAt: stay.checkInAt,
      checkOutAt: stay.checkOutAt,
      originalCheckOutAt: stay.originalCheckOutAt ?? stay.checkOutAt,
      baseRentNts: stay.baseRentNts,
      extensionFeeNts: stay.extensionFeeNts,
      extraFeeNts: stay.extraFeeNts,
      totalDueNts: stay.totalDueNts,
      bookingId: stay.bookingId ?? null,
      createdAt: typeof stay.createdAt === 'string' && Number.isFinite(Date.parse(stay.createdAt)) ? stay.createdAt : null,
    };
  }).sort((left, right) => left.roomId.localeCompare(right.roomId, 'zh-Hant'));
}

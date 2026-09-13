import { z } from 'zod';

import { BOOKING_PAYMENT_TYPES, BOOKING_PLANS } from './booking-operations.js';

const propertyIdSchema = z.string().trim().min(1).max(128).regex(/^[^/]+$/);
const operationIdSchema = z.string().uuid();
const roomIdSchema = z.string().trim().min(1).max(128).regex(/^[^/]+$/);
const bookingIdSchema = z.string().trim().min(1).max(128).regex(/^[^/]+$/);
const ntsAmountSchema = z.number().int().safe().min(0).max(100_000_000);
const dateTimeSchema = z.string().trim().min(20).max(64).regex(
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/,
  '日期時間必須是帶時區的 ISO 格式。',
).refine((value) => Number.isFinite(Date.parse(value)), '日期時間格式不正確。');
/** Store rule (2026-09-14): extensions are billed per whole hour at NT$200; there is no half-hour unit. */
const extensionHoursSchema = z.number().int('延住時數必須以 1 小時為單位。').min(1).max(168);

/** Server-authoritative v3-compatible check-in: a selected booking or a walk-in. */
export const stayCheckInInputSchema = z.object({
  propertyId: propertyIdSchema,
  operationId: operationIdSchema,
  roomId: roomIdSchema,
  bookingId: bookingIdSchema.nullable().optional(),
  guestName: z.string().trim().min(1).max(300),
  phone: z.string().trim().max(100).nullable().optional(),
  checkInAt: dateTimeSchema,
  plan: z.enum(BOOKING_PLANS),
  days: z.number().int().min(1).max(366),
  discountNts: ntsAmountSchema,
  pricingMode: z.enum(['automatic', 'manual']),
  manualAmountNts: ntsAmountSchema.optional(),
  deposit: z.object({
    amountNts: ntsAmountSchema.min(1),
    paymentType: z.enum(BOOKING_PAYMENT_TYPES),
  }).strict().nullable().optional(),
}).strict().superRefine((input, context) => {
  if (input.pricingMode === 'manual' && input.manualAmountNts === undefined) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['manualAmountNts'], message: '手動金額模式必須提供金額。' });
  }
  if (input.pricingMode === 'automatic' && input.manualAmountNts !== undefined) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['manualAmountNts'], message: '自動計價不可附帶手動金額。' });
  }
});

export type StayCheckInInput = z.infer<typeof stayCheckInInputSchema>;

export const stayCheckInResultSchema = z.object({
  status: z.enum(['checked_in', 'replayed']),
  stayId: z.string().min(1).max(128),
  bookingId: bookingIdSchema.nullable(),
  paymentId: z.string().min(1).max(128).nullable(),
  checkInAt: dateTimeSchema,
  checkOutAt: dateTimeSchema,
  totalDueNts: ntsAmountSchema,
}).strict();

export type StayCheckInResult = z.infer<typeof stayCheckInResultSchema>;

/** Server-authoritative extension. The stay timeline, not a new booking, is the price anchor. */
export const stayExtendInputSchema = z.object({
  propertyId: propertyIdSchema,
  operationId: operationIdSchema,
  stayId: z.string().trim().min(1).max(128).regex(/^[^/]+$/),
  extensionHours: extensionHoursSchema,
}).strict();

export type StayExtendInput = z.infer<typeof stayExtendInputSchema>;

export const stayExtendResultSchema = z.object({
  status: z.enum(['extended', 'replayed']),
  stayId: z.string().min(1).max(128),
  roomId: roomIdSchema,
  extensionHours: extensionHoursSchema,
  checkOutAt: dateTimeSchema,
  incrementalFeeNts: ntsAmountSchema,
  extensionFeeNts: ntsAmountSchema,
  totalDueNts: ntsAmountSchema,
}).strict();

export type StayExtendResult = z.infer<typeof stayExtendResultSchema>;

export const stayCheckoutInputSchema = z.object({
  propertyId: propertyIdSchema,
  operationId: operationIdSchema,
  stayId: z.string().trim().min(1).max(128).regex(/^[^/]+$/),
  extraFeeNts: ntsAmountSchema.optional().default(0),
  overdueFeeOverrideNts: ntsAmountSchema.nullable().optional(),
}).strict();

export type StayCheckoutInput = z.infer<typeof stayCheckoutInputSchema>;

export const stayCheckoutResultSchema = z.object({
  status: z.enum(['checked_out', 'replayed']),
  stayId: z.string().min(1).max(128),
  roomId: roomIdSchema,
  checkedOutAt: dateTimeSchema,
  totalChargedNts: ntsAmountSchema,
  extensionFeeNts: ntsAmountSchema,
  systemOverdueFeeNts: ntsAmountSchema,
  appliedOverdueFeeNts: ntsAmountSchema,
  freeCancel: z.boolean(),
  refundedDepositNts: ntsAmountSchema,
}).strict();

export type StayCheckoutResult = z.infer<typeof stayCheckoutResultSchema>;

/** Move an active transient stay to another available room without moving unrelated future bookings. */
export const stayTransferInputSchema = z.object({
  propertyId: propertyIdSchema,
  operationId: operationIdSchema,
  stayId: z.string().trim().min(1).max(128).regex(/^[^/]+$/),
  targetRoomId: roomIdSchema,
}).strict();
export type StayTransferInput = z.infer<typeof stayTransferInputSchema>;

export const stayTransferResultSchema = z.object({
  status: z.enum(['transferred', 'replayed']),
  stayId: z.string().min(1).max(128),
  previousRoomId: roomIdSchema,
  targetRoomId: roomIdSchema,
  transferredAt: dateTimeSchema,
}).strict();
export type StayTransferResult = z.infer<typeof stayTransferResultSchema>;

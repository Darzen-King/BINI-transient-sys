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
const extensionHoursSchema = z.number().finite().min(0.5).max(168).refine(
  (value) => Math.abs((value * 2) - Math.round(value * 2)) < Number.EPSILON,
  '延住時數必須以半小時為單位。',
);

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

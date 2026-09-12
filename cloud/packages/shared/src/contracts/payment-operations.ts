import { z } from 'zod';

import { BOOKING_PAYMENT_TYPES } from './booking-operations.js';

const propertyIdSchema = z.string().trim().min(1).max(128).regex(/^[^/]+$/);
const operationIdSchema = z.string().uuid();
const stayIdSchema = z.string().trim().min(1).max(128).regex(/^[^/]+$/);
const amountSchema = z.number().int().safe().min(1).max(100_000_000);

/** A normal received payment for one active stay. Deposits and refunds have separate, auditable flows. */
export const paymentCreateInputSchema = z.object({
  propertyId: propertyIdSchema,
  operationId: operationIdSchema,
  stayId: stayIdSchema,
  amountNts: amountSchema,
  paymentType: z.enum(BOOKING_PAYMENT_TYPES),
  note: z.string().trim().max(2_000).nullable().optional(),
}).strict();

export type PaymentCreateInput = z.infer<typeof paymentCreateInputSchema>;

export const paymentCreateResultSchema = z.object({
  status: z.enum(['created', 'replayed']),
  paymentId: z.string().min(1).max(128),
  stayId: stayIdSchema,
  roomId: z.string().min(1).max(128),
  amountNts: amountSchema,
  createdAt: z.string().datetime(),
}).strict();

export type PaymentCreateResult = z.infer<typeof paymentCreateResultSchema>;

export const paymentRefundInputSchema = z.object({ propertyId: propertyIdSchema, operationId: operationIdSchema, paymentId: z.string().trim().min(1).max(128).regex(/^[^/]+$/), amountNts: amountSchema, paymentType: z.enum(BOOKING_PAYMENT_TYPES), note: z.string().trim().min(1).max(2_000) }).strict();
export type PaymentRefundInput = z.infer<typeof paymentRefundInputSchema>;
export const paymentRefundResultSchema = z.object({ status: z.enum(['refunded', 'replayed']), paymentId: z.string().min(1).max(128), refundPaymentId: z.string().min(1).max(128), amountNts: amountSchema, createdAt: z.string().datetime() }).strict();
export type PaymentRefundResult = z.infer<typeof paymentRefundResultSchema>;

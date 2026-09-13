import { z } from "zod";

import { BOOKING_PAYMENT_TYPES } from "./booking-operations.js";

const propertyIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(128)
  .regex(/^[^/]+$/);
const operationIdSchema = z.string().uuid();
const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/u);
const stayIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(128)
  .regex(/^[^/]+$/);
const amountSchema = z.number().int().safe().min(1).max(100_000_000);

/** A normal received payment for one active stay. Deposits and refunds have separate, auditable flows. */
export const paymentCreateInputSchema = z
  .object({
    propertyId: propertyIdSchema,
    operationId: operationIdSchema,
    stayId: stayIdSchema,
    amountNts: amountSchema,
    paymentType: z.enum(BOOKING_PAYMENT_TYPES),
    note: z.string().trim().max(2_000).nullable().optional(),
  })
  .strict();

export type PaymentCreateInput = z.infer<typeof paymentCreateInputSchema>;

export const paymentCreateResultSchema = z
  .object({
    status: z.enum(["created", "replayed"]),
    paymentId: z.string().min(1).max(128),
    stayId: stayIdSchema,
    roomId: z.string().min(1).max(128),
    amountNts: amountSchema,
    createdAt: z.string().datetime(),
  })
  .strict();

export type PaymentCreateResult = z.infer<typeof paymentCreateResultSchema>;

export const paymentManualCreateInputSchema = z
  .object({
    propertyId: propertyIdSchema,
    operationId: operationIdSchema,
    bookingId: z
      .string()
      .trim()
      .min(1)
      .max(128)
      .regex(/^[^/]+$/)
      .nullable()
      .optional(),
    roomId: z
      .string()
      .trim()
      .min(1)
      .max(128)
      .regex(/^[^/]+$/)
      .nullable()
      .optional(),
    guestName: z.string().trim().min(1).max(300),
    amountNts: amountSchema,
    paymentType: z.enum(BOOKING_PAYMENT_TYPES),
    deposit: z.boolean(),
    note: z.string().trim().min(1).max(2_000),
  })
  .strict();
export type PaymentManualCreateInput = z.infer<
  typeof paymentManualCreateInputSchema
>;

export const paymentManualCreateResultSchema = z
  .object({
    status: z.enum(["created", "replayed"]),
    paymentId: z.string().min(1).max(128),
    bookingId: z.string().min(1).max(128).nullable(),
    roomId: z.string().min(1).max(128).nullable(),
    amountNts: amountSchema,
    createdAt: z.string().datetime(),
  })
  .strict();
export type PaymentManualCreateResult = z.infer<
  typeof paymentManualCreateResultSchema
>;

export const cashierCloseInputSchema = z
  .object({
    propertyId: propertyIdSchema,
    operationId: operationIdSchema,
    note: z.string().trim().max(2_000).nullable().optional(),
  })
  .strict();
export type CashierCloseInput = z.infer<typeof cashierCloseInputSchema>;
export const cashierCloseResultSchema = z
  .object({
    status: z.enum(["closed", "replayed"]),
    sessionDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    sessionId: z.string().min(1).max(128),
    transactionCount: z.number().int().min(0),
    totalExpectedNts: z.number().int().min(0),
    totalRefundsNts: z.number().int().min(0),
    netNts: z.number().int(),
    closedAt: z.string().datetime(),
  })
  .strict();
export type CashierCloseResult = z.infer<typeof cashierCloseResultSchema>;

export const paymentRefundInputSchema = z
  .object({
    propertyId: propertyIdSchema,
    operationId: operationIdSchema,
    paymentId: z
      .string()
      .trim()
      .min(1)
      .max(128)
      .regex(/^[^/]+$/),
    amountNts: amountSchema,
    paymentType: z.enum(BOOKING_PAYMENT_TYPES),
    note: z.string().trim().min(1).max(2_000),
  })
  .strict();
export type PaymentRefundInput = z.infer<typeof paymentRefundInputSchema>;
export const paymentRefundResultSchema = z
  .object({
    status: z.enum(["refunded", "replayed"]),
    paymentId: z.string().min(1).max(128),
    refundPaymentId: z.string().min(1).max(128),
    amountNts: amountSchema,
    createdAt: z.string().datetime(),
  })
  .strict();
export type PaymentRefundResult = z.infer<typeof paymentRefundResultSchema>;

/** Server-produced v3-compatible payment ledger export. */
export const paymentExportInputSchema = z.object({
  propertyId: propertyIdSchema,
  operationId: operationIdSchema,
  dateFrom: dateSchema,
  dateTo: dateSchema,
}).strict().refine((input) => input.dateFrom <= input.dateTo, 'date range is invalid');
export type PaymentExportInput = z.infer<typeof paymentExportInputSchema>;

export const paymentExportResultSchema = z.object({
  filename: z.string().regex(/^bini_blooms_payments_\d{4}-\d{2}-\d{2}_\d{4}-\d{2}-\d{2}\.csv$/u),
  csv: z.string().min(1).max(5_000_000),
}).strict();
export type PaymentExportResult = z.infer<typeof paymentExportResultSchema>;

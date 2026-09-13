import { z } from "zod";

/** v3 canonical category keys; do not rename without a migration. */
export const COST_CATEGORIES = [
  "utilities",
  "cleaning_supplies",
  "laundry",
  "maintenance",
  "consumables",
  "staff",
  "rent",
  "internet_software",
  "marketing",
  "misc",
] as const;
export const COST_PAYMENT_METHODS = [
  "cash",
  "transfer",
  "card",
  "other",
] as const;
const propertyId = z
  .string()
  .trim()
  .min(1)
  .max(128)
  .regex(/^[^/]+$/);
const operationId = z.string().uuid();
const costId = z
  .string()
  .trim()
  .min(1)
  .max(128)
  .regex(/^[^/]+$/);
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const amount = z.number().int().safe().min(0).max(100_000_000);

export const costFieldsSchema = z
  .object({
    costDate: date,
    category: z.enum(COST_CATEGORIES),
    subcategory: z.string().trim().max(100).nullable().optional(),
    amountNts: amount,
    paymentMethod: z.enum(COST_PAYMENT_METHODS),
    vendor: z.string().trim().max(300).nullable().optional(),
    description: z.string().trim().max(2_000).nullable().optional(),
    note: z.string().trim().max(2_000).nullable().optional(),
    recurring: z.boolean(),
    receiptNo: z.string().trim().max(200).nullable().optional(),
  })
  .strict();
export const costCreateInputSchema = z
  .object({ propertyId, operationId, ...costFieldsSchema.shape })
  .strict();
export const costUpdateInputSchema = z
  .object({
    propertyId,
    operationId,
    costId,
    baseVersion: z.number().int().min(0),
    ...costFieldsSchema.shape,
  })
  .strict();
export const costArchiveInputSchema = z
  .object({
    propertyId,
    operationId,
    costId,
    baseVersion: z.number().int().min(0),
    reason: z.string().trim().min(1).max(2_000),
  })
  .strict();
export type CostCreateInput = z.infer<typeof costCreateInputSchema>;
export type CostUpdateInput = z.infer<typeof costUpdateInputSchema>;
export type CostArchiveInput = z.infer<typeof costArchiveInputSchema>;
export const costOperationResultSchema = z
  .object({
    status: z.enum(["created", "updated", "archived", "replayed"]),
    costId,
    version: z.number().int().min(1),
    updatedAt: z.string().datetime(),
  })
  .strict();
export type CostOperationResult = z.infer<typeof costOperationResultSchema>;

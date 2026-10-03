import { z } from "zod";

import {
  COST_CATEGORIES,
  COST_INSTALLMENT_MAX,
  COST_INSTALLMENT_MIN,
} from "./cost-operations.js";

/**
 * BINI Transient costs are entered only in the BINI accounting app (the owner's decision), which exposes
 * them as a read-only list. This system pulls that list and shows it; it never writes back.
 */
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
export const accountingCostSchema = z.object({
  id: z
    .string()
    .trim()
    .min(1)
    .max(128)
    .regex(/^[A-Za-z0-9_-]+$/),
  date: day,
  category: z.enum(COST_CATEGORIES),
  categoryName: z.string().max(100),
  name: z.string().max(300),
  amount: z.number().positive().max(100_000_000),
  method: z.enum(["cash", "card", "card_installment", "other"]),
  periods: z
    .number()
    .int()
    .min(COST_INSTALLMENT_MIN)
    .max(COST_INSTALLMENT_MAX)
    .nullable(),
  note: z.string().max(2_000),
  recurring: z.boolean(),
});
export const accountingCostFeedSchema = z.object({
  ok: z.literal(true),
  version: z.literal(1),
  generatedAtMs: z.number(),
  fromDate: day.nullable(),
  toDate: day.nullable(),
  costs: z.array(accountingCostSchema).max(5_000),
});
export type AccountingCost = z.infer<typeof accountingCostSchema>;
export type AccountingCostFeed = z.infer<typeof accountingCostFeedSchema>;

/** Costs that came from the accounting app get this id prefix in `costEntries`. */
export const ACCOUNTING_COST_ID_PREFIX = "ACC-";
export const accountingCostRefreshInputSchema = z
  .object({ propertyId: z.string().trim().min(1).max(128).regex(/^[^/]+$/) })
  .strict();
export const accountingCostRefreshResultSchema = z
  .object({
    created: z.number().int().min(0),
    updated: z.number().int().min(0),
    archived: z.number().int().min(0),
    unchanged: z.number().int().min(0),
  })
  .strict();
export type AccountingCostRefreshInput = z.infer<
  typeof accountingCostRefreshInputSchema
>;
export type AccountingCostRefreshResult = z.infer<
  typeof accountingCostRefreshResultSchema
>;

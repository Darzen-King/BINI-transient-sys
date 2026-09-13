import { z } from "zod";

import {
  COST_CATEGORIES,
  COST_PAYMENT_METHODS,
} from "../contracts/cost-operations.js";

const costEntrySchema = z
  .object({
    propertyId: z.string().trim().min(1).max(128),
    costDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/u),
    category: z.string().trim().min(1).max(100),
    subcategory: z.string().trim().max(100).nullable().optional(),
    amountNts: z.number().int().safe().min(0),
    paymentMethod: z.string().trim().min(1).max(64),
    vendor: z.string().trim().max(300).nullable().optional(),
    description: z.string().trim().max(2_000).nullable().optional(),
    note: z.string().trim().max(2_000).nullable().optional(),
    recurring: z.boolean(),
    receiptNo: z.string().trim().max(200).nullable().optional(),
    status: z.enum(["active", "archived"]).optional(),
    version: z.number().int().min(0).optional(),
    createdAt: z.string().datetime().nullable().optional(),
    updatedAt: z.string().datetime().nullable().optional(),
  })
  .passthrough();

export interface CostListItem {
  costId: string;
  propertyId: string;
  costDate: string;
  category: (typeof COST_CATEGORIES)[number];
  subcategory: string | null;
  amountNts: number;
  paymentMethod: (typeof COST_PAYMENT_METHODS)[number];
  vendor: string | null;
  description: string | null;
  note: string | null;
  recurring: boolean;
  receiptNo: string | null;
  status: "active" | "archived";
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface CostMonthlySummary {
  totalNts: number;
  count: number;
  byCategory: Partial<Record<CostListItem["category"], number>>;
}

/** Parses immutable Firestore cost documents and keeps newest operating dates first. */
export function buildCostListItems(
  documents: readonly { id: string; data: unknown }[],
): CostListItem[] {
  return documents
    .map((document) => {
      const value = costEntrySchema.parse(document.data);
      const category = COST_CATEGORIES.includes(value.category as (typeof COST_CATEGORIES)[number]) ? value.category as (typeof COST_CATEGORIES)[number] : "misc";
      const paymentMethod = COST_PAYMENT_METHODS.includes(value.paymentMethod as (typeof COST_PAYMENT_METHODS)[number]) ? value.paymentMethod as (typeof COST_PAYMENT_METHODS)[number] : "other";
      const fallbackTimestamp = `${value.costDate}T00:00:00.000+08:00`;
      return {
        costId: document.id,
        propertyId: value.propertyId,
        costDate: value.costDate,
        category,
        subcategory: value.subcategory ?? null,
        amountNts: value.amountNts,
        paymentMethod,
        vendor: value.vendor ?? null,
        description: value.description ?? null,
        note: value.note ?? null,
        recurring: value.recurring,
        receiptNo: value.receiptNo ?? null,
        status: value.status ?? "active",
        version: value.version ?? 0,
        createdAt: value.createdAt ?? value.updatedAt ?? fallbackTimestamp,
        updatedAt: value.updatedAt ?? value.createdAt ?? fallbackTimestamp,
      };
    })
    .sort(
      (left, right) =>
        right.costDate.localeCompare(left.costDate) ||
        right.updatedAt.localeCompare(left.updatedAt),
    );
}

export function summarizeCosts(
  items: readonly CostListItem[],
  month: string,
): CostMonthlySummary {
  const byCategory: CostMonthlySummary["byCategory"] = {};
  let totalNts = 0;
  let count = 0;
  for (const item of items) {
    if (item.status !== "active" || !item.costDate.startsWith(month)) continue;
    totalNts += item.amountNts;
    count += 1;
    byCategory[item.category] =
      (byCategory[item.category] ?? 0) + item.amountNts;
  }
  return { totalNts, count, byCategory };
}

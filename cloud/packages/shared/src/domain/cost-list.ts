import { z } from "zod";

import {
  COST_CATEGORIES,
  COST_PAYMENT_METHODS,
} from "../contracts/cost-operations.js";

const costEntrySchema = z
  .object({
    propertyId: z.string().trim().min(1).max(128),
    costDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/u),
    category: z.enum(COST_CATEGORIES),
    subcategory: z.string().trim().max(100).nullable().optional(),
    amountNts: z.number().int().safe().min(0),
    paymentMethod: z.enum(COST_PAYMENT_METHODS),
    vendor: z.string().trim().max(300).nullable().optional(),
    description: z.string().trim().max(2_000).nullable().optional(),
    note: z.string().trim().max(2_000).nullable().optional(),
    recurring: z.boolean(),
    receiptNo: z.string().trim().max(200).nullable().optional(),
    status: z.enum(["active", "archived"]),
    version: z.number().int().min(1),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
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
      return {
        costId: document.id,
        propertyId: value.propertyId,
        costDate: value.costDate,
        category: value.category,
        subcategory: value.subcategory ?? null,
        amountNts: value.amountNts,
        paymentMethod: value.paymentMethod,
        vendor: value.vendor ?? null,
        description: value.description ?? null,
        note: value.note ?? null,
        recurring: value.recurring,
        receiptNo: value.receiptNo ?? null,
        status: value.status,
        version: value.version,
        createdAt: value.createdAt,
        updatedAt: value.updatedAt,
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

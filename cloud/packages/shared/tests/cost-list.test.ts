import { describe, expect, it } from "vitest";

import {
  buildCostListItems,
  costCreateInputSchema,
  costsInRange,
  summarizeCostRange,
  summarizeCosts,
} from "@bini/cloud-shared";

describe("cost domain and contracts", () => {
  const active = {
    propertyId: "property-main",
    costDate: "2026-09-13",
    category: "utilities",
    subcategory: null,
    amountNts: 1_200,
    paymentMethod: "cash",
    vendor: "Power",
    description: null,
    note: null,
    recurring: true,
    receiptNo: null,
    status: "active",
    version: 1,
    createdAt: "2026-09-13T01:00:00.000Z",
    updatedAt: "2026-09-13T01:00:00.000Z",
  };

  it("keeps archived costs out of monthly operating totals", () => {
    const items = buildCostListItems([
      { id: "CST-active", data: active },
      {
        id: "CST-archived",
        data: { ...active, status: "archived", amountNts: 999 },
      },
    ]);
    expect(summarizeCosts(items, "2026-09")).toEqual({
      totalNts: 1_200,
      count: 1,
      byCategory: { utilities: 1_200 },
    });
  });

  it("searches any date range, not just one month, and totals what it finds", () => {
    const items = buildCostListItems([
      { id: "CST-aug", data: { ...active, costDate: "2026-08-31", amountNts: 500 } },
      { id: "CST-sep-1", data: { ...active, costDate: "2026-09-01", amountNts: 1_000 } },
      { id: "CST-sep-13", data: { ...active, costDate: "2026-09-13", category: "laundry", amountNts: 300 } },
      { id: "CST-oct", data: { ...active, costDate: "2026-10-01", amountNts: 700 } },
      { id: "CST-archived", data: { ...active, costDate: "2026-09-05", amountNts: 999, status: "archived" } },
    ]);
    expect(costsInRange(items, "2026-08-31", "2026-09-13").map((item) => item.costId)).toEqual(["CST-sep-13", "CST-sep-1", "CST-aug"]);
    expect(summarizeCostRange(items, "2026-08-31", "2026-09-13")).toEqual({ totalNts: 1_800, count: 3, byCategory: { utilities: 1_500, laundry: 300 } });
    // A whole year, the way the "All" quick range reads history back.
    expect(summarizeCostRange(items, "2026-01-01", "2026-12-31").totalNts).toBe(2_500);
    expect(summarizeCostRange(items, "2026-11-01", "2026-11-30")).toEqual({ totalNts: 0, count: 0, byCategory: {} });
  });

  it("rejects an unknown legacy category before a callable request", () => {
    expect(
      costCreateInputSchema.safeParse({
        propertyId: "property-main",
        operationId: "00000000-0000-4000-8000-000000000003",
        costDate: "2026-09-13",
        category: "unknown",
        amountNts: 100,
        paymentMethod: "cash",
        recurring: false,
      }).success,
    ).toBe(false);
  });

  it("accepts a credit-card installment cost only with a period count, and a period count only for installments", () => {
    const base = {
      propertyId: "property-main",
      operationId: "00000000-0000-4000-8000-000000000004",
      costDate: "2026-09-13",
      category: "maintenance",
      amountNts: 36_000,
      recurring: false,
    };
    const ok = (input: Record<string, unknown>) => costCreateInputSchema.safeParse({ ...base, ...input }).success;
    expect(ok({ paymentMethod: "card_installment", installmentPeriods: 6 })).toBe(true);
    expect(ok({ paymentMethod: "card_installment", installmentPeriods: 2 })).toBe(true);
    expect(ok({ paymentMethod: "card_installment", installmentPeriods: 120 })).toBe(true);
    expect(ok({ paymentMethod: "card_installment" })).toBe(false);
    expect(ok({ paymentMethod: "card_installment", installmentPeriods: null })).toBe(false);
    expect(ok({ paymentMethod: "card_installment", installmentPeriods: 1 })).toBe(false);
    expect(ok({ paymentMethod: "card_installment", installmentPeriods: 121 })).toBe(false);
    expect(ok({ paymentMethod: "card_installment", installmentPeriods: 6.5 })).toBe(false);
    // Every other method stays exactly as before: no period count at all.
    for (const method of ["cash", "transfer", "card", "other"]) {
      expect(ok({ paymentMethod: method })).toBe(true);
      expect(ok({ paymentMethod: method, installmentPeriods: null })).toBe(true);
      expect(ok({ paymentMethod: method, installmentPeriods: 6 })).toBe(false);
    }
  });

  it("reads the installment count back for installment costs only, and old rows keep working", () => {
    const [installment, card, legacy, stray] = buildCostListItems([
      { id: "CST-inst", data: { ...active, paymentMethod: "card_installment", installmentPeriods: 12 } },
      { id: "CST-card", data: { ...active, paymentMethod: "card" } },
      { id: "CST-legacy", data: active },
      { id: "CST-stray", data: { ...active, paymentMethod: "cash", installmentPeriods: 6 } },
    ]);
    expect(installment).toMatchObject({ paymentMethod: "card_installment", installmentPeriods: 12 });
    expect(card).toMatchObject({ paymentMethod: "card", installmentPeriods: null });
    expect(legacy).toMatchObject({ paymentMethod: "cash", installmentPeriods: null });
    expect(stray).toMatchObject({ paymentMethod: "cash", installmentPeriods: null });
  });

  it("reads imported v3 cost rows without v4 lifecycle fields as active version zero", () => {
    const [item] = buildCostListItems([
      {
        id: "legacy-1",
        data: {
          propertyId: "property-main",
          costDate: "2026-09-01",
          category: "utilities",
          amountNts: 500,
          paymentMethod: "cash",
          recurring: false,
          createdAt: "2026-09-01T01:00:00.000Z",
          updatedAt: null,
        },
      },
    ]);
    expect(item).toMatchObject({
      costId: "legacy-1",
      status: "active",
      version: 0,
      category: "utilities",
    });
  });
});

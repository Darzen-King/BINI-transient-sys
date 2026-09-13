import { describe, expect, it } from "vitest";

import {
  buildCostListItems,
  costCreateInputSchema,
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
});

import { describe, expect, it } from "vitest";

import {
  accountingCostFeedSchema,
  accountingCostRefreshInputSchema,
  buildCostListItems,
} from "@bini/cloud-shared";

const cost = {
  id: "e1",
  date: "2026-10-05",
  category: "maintenance",
  categoryName: "維修",
  name: "冷氣工程行",
  amount: 36000,
  method: "card_installment",
  periods: 6,
  note: "",
  recurring: false,
};
const feed = {
  ok: true,
  version: 1,
  generatedAtMs: 1,
  fromDate: "2026-10-01",
  toDate: "2026-10-31",
  costs: [cost],
};

describe("accounting cost list contract", () => {
  it("accepts the list the accounting app serves", () => {
    expect(accountingCostFeedSchema.safeParse(feed).success).toBe(true);
    expect(accountingCostFeedSchema.safeParse({ ...feed, fromDate: null, toDate: null, costs: [] }).success).toBe(true);
    expect(accountingCostFeedSchema.safeParse({ ...feed, costs: [{ ...cost, id: "rec_abc-123_2026-10", method: "other", periods: null, recurring: true }] }).success).toBe(true);
  });

  it("rejects anything that is not a valid list, so a bad answer can never change the costs", () => {
    const bad = (value: unknown) => accountingCostFeedSchema.safeParse(value).success;
    expect(bad({ ...feed, ok: false })).toBe(false);
    expect(bad({ ...feed, version: 2 })).toBe(false);
    expect(bad({ ...feed, costs: [{ ...cost, category: "unknown" }] })).toBe(false);
    expect(bad({ ...feed, costs: [{ ...cost, amount: 0 }] })).toBe(false);
    expect(bad({ ...feed, costs: [{ ...cost, amount: -5 }] })).toBe(false);
    expect(bad({ ...feed, costs: [{ ...cost, id: "a/b" }] })).toBe(false);
    expect(bad({ ...feed, costs: [{ ...cost, date: "2026/10/05" }] })).toBe(false);
    expect(bad({ ...feed, costs: [{ ...cost, method: "cheque" }] })).toBe(false);
    expect(bad({ ...feed, costs: [{ ...cost, periods: 1 }] })).toBe(false);
    expect(bad({ ...feed, costs: [{ ...cost, periods: 121 }] })).toBe(false);
    expect(bad("nope")).toBe(false);
  });

  it("only the refresh button's property id is accepted as input", () => {
    expect(accountingCostRefreshInputSchema.safeParse({ propertyId: "property-main" }).success).toBe(true);
    expect(accountingCostRefreshInputSchema.safeParse({ propertyId: "a/b" }).success).toBe(false);
    expect(accountingCostRefreshInputSchema.safeParse({ propertyId: "property-main", extra: 1 }).success).toBe(false);
  });

  it("marks a cost that came from the accounting app in the cost list, and leaves older costs unmarked", () => {
    const base = { propertyId: "property-main", costDate: "2026-10-05", category: "utilities", amountNts: 500, paymentMethod: "cash", recurring: false, status: "active", version: 1, createdAt: "2026-10-05T01:00:00.000Z", updatedAt: "2026-10-05T01:00:00.000Z" };
    const [own, fromAccounting, other] = buildCostListItems([
      { id: "CST-1", data: base },
      { id: "ACC-e1", data: { ...base, source: "accounting" } },
      { id: "CST-2", data: { ...base, source: "something-else" } },
    ]);
    expect([own?.source, fromAccounting?.source, other?.source]).toEqual([null, "accounting", null]);
  });
});

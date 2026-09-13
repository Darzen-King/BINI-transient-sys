import { describe, expect, it } from "vitest";

import {
  cashierCloseInputSchema,
  paymentCreateInputSchema,
  paymentExportInputSchema,
  paymentManualCreateInputSchema,
  paymentRefundInputSchema,
  stayCheckInInputSchema,
  stayCheckoutInputSchema,
  stayTransferInputSchema,
} from "../src/index.js";

const base = {
  propertyId: "property-main",
  operationId: "11111111-1111-4111-8111-111111111111",
  roomId: "203",
  bookingId: null,
  guestName: "Walk in",
  phone: null,
  checkInAt: "2026-09-14T15:00:00+08:00",
  plan: "24hrs" as const,
  days: 1,
  discountNts: 0,
  pricingMode: "automatic" as const,
};

describe("stay check-in contract", () => {
  it("accepts a walk-in with an optional deposit", () => {
    expect(
      stayCheckInInputSchema.parse({
        ...base,
        deposit: { amountNts: 500, paymentType: "cash" },
      }).deposit,
    ).toEqual({ amountNts: 500, paymentType: "cash" });
  });

  it("requires exactly the correct manual amount mode", () => {
    expect(() =>
      stayCheckInInputSchema.parse({ ...base, pricingMode: "manual" }),
    ).toThrow(/手動金額/);
    expect(() =>
      stayCheckInInputSchema.parse({ ...base, manualAmountNts: 800 }),
    ).toThrow(/自動計價/);
    expect(
      stayCheckInInputSchema.parse({
        ...base,
        pricingMode: "manual",
        manualAmountNts: 800,
      }).manualAmountNts,
    ).toBe(800);
  });
});

describe("stay checkout contract", () => {
  it("requires property-scoped UUID input and allows only non-negative fee adjustments", () => {
    expect(
      stayCheckoutInputSchema.parse({
        propertyId: "property-main",
        operationId: "22222222-2222-4222-8222-222222222222",
        stayId: "STY-live-203",
        extraFeeNts: 50,
        overdueFeeOverrideNts: 0,
      }),
    ).toMatchObject({ extraFeeNts: 50, overdueFeeOverrideNts: 0 });
    expect(() =>
      stayCheckoutInputSchema.parse({
        propertyId: "property-main",
        operationId: "not-a-uuid",
        stayId: "STY-live-203",
      }),
    ).toThrow();
    expect(() =>
      stayCheckoutInputSchema.parse({
        propertyId: "property-main",
        operationId: "22222222-2222-4222-8222-222222222222",
        stayId: "STY-live-203",
        extraFeeNts: -1,
      }),
    ).toThrow();
  });
});

describe("stay transfer contract", () => {
  it("requires distinct property-scoped stay and target-room identifiers", () => {
    expect(
      stayTransferInputSchema.parse({
        propertyId: "property-main",
        operationId: "44444444-4444-4444-8444-444444444444",
        stayId: "STY-live-203",
        targetRoomId: "205",
      }),
    ).toMatchObject({ stayId: "STY-live-203", targetRoomId: "205" });
    expect(() =>
      stayTransferInputSchema.parse({
        propertyId: "property-main",
        operationId: "44444444-4444-4444-8444-444444444444",
        stayId: "STY/live-203",
        targetRoomId: "205",
      }),
    ).toThrow();
  });
});

describe("normal payment contract", () => {
  it("requires a property-scoped active stay and a positive integer amount", () => {
    expect(
      paymentCreateInputSchema.parse({
        propertyId: "property-main",
        operationId: "33333333-3333-4333-8333-333333333333",
        stayId: "STY-live-203",
        amountNts: 800,
        paymentType: "cash",
        note: "補收",
      }),
    ).toMatchObject({ amountNts: 800, paymentType: "cash" });
    expect(
      paymentCreateInputSchema.parse({
        propertyId: "property-main",
        operationId: "33333333-3333-4333-8333-333333333333",
        stayId: "STY-live-203",
        amountNts: 1000,
        paymentType: "transfer",
        deposit: true,
      }),
    ).toMatchObject({ deposit: true });
    expect(() =>
      paymentCreateInputSchema.parse({
        propertyId: "property-main",
        operationId: "33333333-3333-4333-8333-333333333333",
        stayId: "STY-live-203",
        amountNts: 1000,
        paymentType: "transfer",
        deposit: "yes",
      }),
    ).toThrow();
    expect(() =>
      paymentCreateInputSchema.parse({
        propertyId: "property-main",
        operationId: "33333333-3333-4333-8333-333333333333",
        stayId: "STY-live-203",
        amountNts: 0,
        paymentType: "cash",
      }),
    ).toThrow();
  });
});

describe("payment refund contract", () => {
  it("requires an auditable source payment, refund method and reason", () => {
    expect(
      paymentRefundInputSchema.safeParse({
        propertyId: "property-main",
        operationId: "55555555-5555-4555-8555-555555555555",
        paymentId: "PAY-1",
        amountNts: 100,
        paymentType: "cash",
        note: "客人取消",
      }).success,
    ).toBe(true);
    expect(
      paymentRefundInputSchema.safeParse({
        propertyId: "property-main",
        operationId: "55555555-5555-4555-8555-555555555555",
        paymentId: "PAY-1",
        amountNts: 100,
        paymentType: "cash",
        note: "",
      }).success,
    ).toBe(false);
  });
});

describe("manual payment contract", () => {
  it("requires an auditable reason while allowing an unlinked exception receipt", () => {
    expect(
      paymentManualCreateInputSchema.safeParse({
        propertyId: "property-main",
        operationId: "678b5bd4-475f-4d92-ac42-31b6ea2a27fd",
        bookingId: null,
        roomId: "203",
        guestName: "Walk-in adjustment",
        amountNts: 250,
        paymentType: "cash",
        deposit: false,
        note: "補登櫃檯現金收款",
      }).success,
    ).toBe(true);
    expect(
      paymentManualCreateInputSchema.safeParse({
        propertyId: "property-main",
        operationId: "678b5bd4-475f-4d92-ac42-31b6ea2a27fd",
        roomId: null,
        guestName: "Walk-in adjustment",
        amountNts: 250,
        paymentType: "cash",
        deposit: false,
        note: "",
      }).success,
    ).toBe(false);
  });
});

describe("cashier close contract", () => {
  it("requires a property-scoped idempotency key and permits an optional note", () => {
    expect(
      cashierCloseInputSchema.safeParse({
        propertyId: "property-main",
        operationId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
        note: "交班完成",
      }).success,
    ).toBe(true);
    expect(
      cashierCloseInputSchema.safeParse({
        propertyId: "property-main",
        operationId: "not-a-uuid",
      }).success,
    ).toBe(false);
  });
});

describe("payment ledger export contract", () => {
  it("requires a property-scoped operation and an ordered Taiwan date range", () => {
    expect(paymentExportInputSchema.safeParse({
      propertyId: "property-main",
      operationId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
      dateFrom: "2026-09-01",
      dateTo: "2026-09-13",
    }).success).toBe(true);
    expect(paymentExportInputSchema.safeParse({
      propertyId: "property-main",
      operationId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
      dateFrom: "2026-09-14",
      dateTo: "2026-09-13",
    }).success).toBe(false);
  });
});

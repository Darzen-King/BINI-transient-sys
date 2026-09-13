// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ActiveStayItem, PaymentListItem } from "@bini/cloud-shared";

import { App } from "../src/App.js";
import type { StaffSession } from "../src/auth/session.js";
import type { PaymentCreateGateway } from "../src/payments/payment-create.js";
import type { PaymentListGateway } from "../src/payments/payment-list.js";
import type { ActiveStaysGateway } from "../src/stays/active-stays.js";

const session: StaffSession = {
  uid: "front-1",
  email: "front@example.com",
  displayName: "Front Desk",
  propertyId: "property-main",
  role: "front_desk",
  allowedPages: ["payments"],
};
const stays: ActiveStayItem[] = [
  {
    stayId: "STY-live-202",
    roomId: "202",
    guestName: "Live Guest",
    phone: null,
    plan: "24hrs",
    checkInAt: "2026-09-14T05:00:00.000Z",
    checkOutAt: "2026-09-15T05:00:00.000Z",
    originalCheckOutAt: "2026-09-15T05:00:00.000Z",
    baseRentNts: 1_200,
    extensionFeeNts: 0,
    extraFeeNts: 0,
    totalDueNts: 1_200,
  },
];
const payments: PaymentListItem[] = [
  {
    paymentId: "PAY-old",
    roomId: "202",
    guestName: "Live Guest",
    paymentType: "cash",
    amountNts: 200,
    deposit: false,
    refund: false,
    status: "paid",
    note: null,
    createdAt: "2026-09-12T08:00:00.000Z",
  },
];
const staysGateway: ActiveStaysGateway = {
  subscribe(_propertyId, onValue) {
    queueMicrotask(() => onValue(stays));
    return () => undefined;
  },
};
const listGateway: PaymentListGateway = {
  subscribe(_propertyId, onValue) {
    queueMicrotask(() => onValue(payments));
    return () => undefined;
  },
};

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("payments UI", () => {
  it("uses the guarded callable for an active-stay payment and retains live history", async () => {
    const create = vi.fn().mockResolvedValue({
      status: "created",
      paymentId: "PAY-new",
      stayId: "STY-live-202",
      roomId: "202",
      amountNts: 1_000,
      createdAt: "2026-09-12T09:00:00.000Z",
    });
    render(
      <App
        activeStaysGateway={staysGateway}
        paymentCreateGateway={{ create } satisfies PaymentCreateGateway}
        paymentListGateway={listGateway}
        session={session}
      />,
    );
    fireEvent.click(screen.getByRole("link", { name: "付款管理" }));
    fireEvent.change(await screen.findByLabelText("選擇在住房"), {
      target: { value: "STY-live-202" },
    });
    fireEvent.change(screen.getByLabelText("收款金額（NT$）"), {
      target: { value: "1000" },
    });
    fireEvent.change(screen.getByLabelText("付款方式"), {
      target: { value: "transfer" },
    });
    fireEvent.click(screen.getByRole("button", { name: "確認收款" }));
    await waitFor(() =>
      expect(create).toHaveBeenCalledWith({
        propertyId: "property-main",
        operationId: expect.any(String),
        stayId: "STY-live-202",
        amountNts: 1_000,
        paymentType: "transfer",
        note: null,
      }),
    );
    expect(await screen.findByText("帳務完成")).toBeInTheDocument();
    expect(screen.getByText("付款紀錄")).toBeInTheDocument();
  });

  it("creates an append-only refund from a paid payment", async () => {
    const refund = vi.fn().mockResolvedValue({
      status: "refunded",
      paymentId: "PAY-old",
      refundPaymentId: "PAY-RFD-123",
      amountNts: 200,
      createdAt: "2026-09-12T09:00:00.000Z",
    });
    render(
      <App
        activeStaysGateway={staysGateway}
        paymentCreateGateway={
          { create: vi.fn(), refund } satisfies PaymentCreateGateway
        }
        paymentListGateway={listGateway}
        session={session}
      />,
    );
    fireEvent.click(screen.getByRole("link", { name: "付款管理" }));
    fireEvent.click(await screen.findByRole("button", { name: "退款" }));
    fireEvent.change(screen.getByLabelText("退款原因"), {
      target: { value: "旅客取消行程" },
    });
    fireEvent.click(screen.getByRole("button", { name: "確認退款" }));
    await waitFor(() =>
      expect(refund).toHaveBeenCalledWith({
        propertyId: "property-main",
        operationId: expect.any(String),
        paymentId: "PAY-old",
        amountNts: 200,
        paymentType: "cash",
        note: "旅客取消行程",
      }),
    );
    expect(await screen.findByText("帳務完成")).toBeInTheDocument();
  });

  it("creates a server-validated manual exception payment", async () => {
    const manualCreate = vi.fn().mockResolvedValue({
      status: "created",
      paymentId: "PAY-MAN-123",
      bookingId: null,
      roomId: "203",
      amountNts: 250,
      createdAt: "2026-09-12T09:00:00.000Z",
    });
    render(
      <App
        activeStaysGateway={staysGateway}
        paymentCreateGateway={
          { create: vi.fn(), manualCreate } satisfies PaymentCreateGateway
        }
        paymentListGateway={listGateway}
        session={session}
      />,
    );
    fireEvent.click(screen.getByRole("link", { name: "付款管理" }));
    fireEvent.click(
      await screen.findByRole("button", { name: "手動例外收款" }),
    );
    fireEvent.change(screen.getByLabelText("旅客／對象"), {
      target: { value: "Manual Guest" },
    });
    fireEvent.change(screen.getByLabelText("房號（選填）"), {
      target: { value: "203" },
    });
    fireEvent.change(screen.getAllByLabelText("收款金額（NT$）")[1], {
      target: { value: "250" },
    });
    fireEvent.change(screen.getByLabelText("原因／備註"), {
      target: { value: "補登櫃檯現金收款" },
    });
    fireEvent.click(screen.getByRole("button", { name: "確認建立收款" }));
    await waitFor(() =>
      expect(manualCreate).toHaveBeenCalledWith({
        propertyId: "property-main",
        operationId: expect.any(String),
        bookingId: null,
        roomId: "203",
        guestName: "Manual Guest",
        amountNts: 250,
        paymentType: "cash",
        deposit: false,
        note: "補登櫃檯現金收款",
      }),
    );
  });

  it("shows day close only to a manager and calls the guarded transaction", async () => {
    const cashierClose = vi
      .fn()
      .mockResolvedValue({
        status: "closed",
        sessionDate: "2026-09-13",
        sessionId: "2026-09-13",
        transactionCount: 1,
        totalExpectedNts: 200,
        totalRefundsNts: 0,
        netNts: 200,
        closedAt: "2026-09-12T09:00:00.000Z",
      });
    render(
      <App
        activeStaysGateway={staysGateway}
        paymentCreateGateway={
          { create: vi.fn(), cashierClose } satisfies PaymentCreateGateway
        }
        paymentListGateway={listGateway}
        session={{ ...session, role: "manager" }}
      />,
    );
    fireEvent.click(screen.getByRole("link", { name: "付款管理" }));
    fireEvent.click(
      await screen.findByRole("button", { name: "執行今日日結" }),
    );
    fireEvent.change(screen.getByLabelText("日結備註（選填）"), {
      target: { value: "交班完成" },
    });
    fireEvent.click(screen.getByRole("button", { name: "確認日結" }));
    await waitFor(() =>
      expect(cashierClose).toHaveBeenCalledWith({
        propertyId: "property-main",
        operationId: expect.any(String),
        note: "交班完成",
      }),
    );
  });

  it("exports a server-produced payment ledger for the selected Taiwan date range", async () => {
    const exportCsv = vi.fn().mockResolvedValue({
      filename: "bini_blooms_payments_2026-09-01_2026-09-13.csv",
      csv: '\uFEFF"id"\r\n"PAY-old"\r\n',
    });
    Object.defineProperty(URL, "createObjectURL", { configurable: true, value: vi.fn(() => "blob:payment-export") });
    Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: vi.fn() });
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
    render(
      <App
        activeStaysGateway={staysGateway}
        paymentCreateGateway={{ create: vi.fn(), exportCsv } satisfies PaymentCreateGateway}
        paymentListGateway={listGateway}
        session={session}
      />,
    );
    fireEvent.click(screen.getByRole("link", { name: "付款管理" }));
    fireEvent.click(await screen.findByRole("button", { name: "匯出 CSV" }));

    await waitFor(() => expect(exportCsv).toHaveBeenCalledWith(expect.objectContaining({
      propertyId: "property-main", operationId: expect.any(String), dateFrom: expect.stringMatching(/^\d{4}-\d{2}-01$/), dateTo: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
    })));
    expect(await screen.findByText(/已匯出/)).toBeInTheDocument();
  });
});

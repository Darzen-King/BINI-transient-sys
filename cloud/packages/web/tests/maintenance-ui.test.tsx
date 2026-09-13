// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { MaintenanceRoomItem } from "@bini/cloud-shared";

import type { StaffSession } from "../src/auth/session.js";
import { MaintenancePage } from "../src/maintenance/MaintenancePage.js";
import type { MaintenanceGateway } from "../src/maintenance/maintenance-gateway.js";

const session: StaffSession = {
  uid: "maint-1",
  email: "maint@example.com",
  displayName: "Maintenance",
  propertyId: "property-main",
  role: "maintenance",
  allowedPages: ["maintenance"],
};

const rooms: MaintenanceRoomItem[] = [
  { roomId: "205", maintenanceNote: "冷氣故障", maintenanceDueDate: "2026-09-10", overdue: true },
  { roomId: "207", maintenanceNote: null, maintenanceDueDate: "2026-09-20", overdue: false },
];

function gateway(overrides: Partial<MaintenanceGateway> = {}): MaintenanceGateway {
  return {
    subscribe(_propertyId, onValue) {
      queueMicrotask(() => onValue([]));
      return () => undefined;
    },
    subscribeRooms(_propertyId, onValue) {
      queueMicrotask(() => onValue(rooms));
      return () => undefined;
    },
    create: vi.fn(),
    action: vi.fn(),
    roomUpdate: vi.fn(),
    ...overrides,
  };
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("maintenance rooms", () => {
  it("lists rooms under maintenance with their note and an overdue due date", async () => {
    render(<MaintenancePage gateway={gateway()} session={session} />);
    const card = await screen.findByRole("article", { name: "205 維修中" });
    expect(within(card).getByText("冷氣故障", { selector: "p" })).toBeInTheDocument();
    expect(within(card).getByLabelText("維修進度備註")).toHaveValue("冷氣故障");
    expect(within(card).getByText(/預計完成：2026-09-10/)).toBeInTheDocument();
    expect(within(card).getByText("已逾期")).toBeInTheDocument();
    expect(within(screen.getByRole("article", { name: "207 維修中" })).queryByText("已逾期")).not.toBeInTheDocument();
    expect(screen.getByText("維修中 2 間")).toBeInTheDocument();
  });

  it("updates the progress note through the guarded callable", async () => {
    const roomUpdate = vi.fn().mockResolvedValue({ status: "noted", action: "update_note", roomId: "205", nextStatus: "維修中", updatedAt: "2026-09-13T13:30:00.000Z" });
    render(<MaintenancePage gateway={gateway({ roomUpdate })} session={session} />);
    const card = await screen.findByRole("article", { name: "205 維修中" });
    fireEvent.change(within(card).getByLabelText("維修進度備註"), { target: { value: "零件已到" } });
    fireEvent.click(within(card).getByRole("button", { name: "更新備註" }));
    await waitFor(() =>
      expect(roomUpdate).toHaveBeenCalledWith({
        propertyId: "property-main",
        operationId: expect.any(String),
        roomId: "205",
        action: "update_note",
        maintenanceNote: "零件已到",
      }),
    );
    expect(await screen.findByText("205 房維修備註已更新。")).toBeInTheDocument();
  });

  it("does not send an empty progress note", async () => {
    const roomUpdate = vi.fn();
    render(<MaintenancePage gateway={gateway({ roomUpdate })} session={session} />);
    const card = await screen.findByRole("article", { name: "207 維修中" });
    expect(within(card).getByRole("button", { name: "更新備註" })).toBeDisabled();
  });

  it("requires a second confirmation before returning a room to service", async () => {
    const roomUpdate = vi.fn().mockResolvedValue({ status: "resolved", action: "resolve", roomId: "205", nextStatus: "可入住", updatedAt: "2026-09-13T13:30:00.000Z" });
    render(<MaintenancePage gateway={gateway({ roomUpdate })} session={session} />);
    const card = await screen.findByRole("article", { name: "205 維修中" });
    fireEvent.click(within(card).getByRole("button", { name: "標記已解決" }));
    expect(roomUpdate).not.toHaveBeenCalled();
    fireEvent.click(await screen.findByRole("button", { name: "確認解除維修" }));
    await waitFor(() =>
      expect(roomUpdate).toHaveBeenCalledWith({
        propertyId: "property-main",
        operationId: expect.any(String),
        roomId: "205",
        action: "resolve",
        maintenanceNote: null,
      }),
    );
    expect(await screen.findByText("205 房已解除維修，回到可入住。")).toBeInTheDocument();
  });

  it("does not report a failure after a schedule is created successfully", async () => {
    const create = vi.fn().mockResolvedValue({ status: "created", scheduleId: "MS-1", roomId: "205", startAt: "2026-09-14T10:00:00+08:00", endAt: "2026-09-14T12:00:00+08:00" });
    render(<MaintenancePage gateway={gateway({ create })} session={session} />);
    await screen.findByRole("article", { name: "205 維修中" });
    fireEvent.change(screen.getByLabelText("房號"), { target: { value: "205" } });
    fireEvent.change(screen.getByLabelText("維修項目"), { target: { value: "冷氣保養" } });
    fireEvent.change(screen.getByLabelText("開始時間"), { target: { value: "2026-09-14T10:00" } });
    fireEvent.change(screen.getByLabelText("結束時間"), { target: { value: "2026-09-14T12:00" } });
    fireEvent.click(screen.getByRole("button", { name: "建立維修排程" }));
    await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
    expect(await screen.findByText("已建立 205 房維修排程。")).toBeInTheDocument();
    expect(screen.queryByText("維修操作失敗")).not.toBeInTheDocument();
    expect(screen.getByLabelText("維修項目")).toHaveValue("");
  });

  it("shows a friendly empty state when no room is under maintenance", async () => {
    render(
      <MaintenancePage
        gateway={gateway({
          subscribeRooms(_propertyId, onValue) {
            queueMicrotask(() => onValue([]));
            return () => undefined;
          },
        })}
        session={session}
      />,
    );
    expect(await screen.findByText("目前沒有維修中的房間")).toBeInTheDocument();
  });

  it("fails closed when the live room listener errors", async () => {
    render(
      <MaintenancePage
        gateway={gateway({
          subscribeRooms(_propertyId, _onValue, onError) {
            queueMicrotask(() => onError(new Error("boom")));
            return () => undefined;
          },
        })}
        session={session}
      />,
    );
    expect(await screen.findByText("無法載入維修中房間。")).toBeInTheDocument();
    expect(screen.queryByRole("article", { name: "205 維修中" })).not.toBeInTheDocument();
  });
});

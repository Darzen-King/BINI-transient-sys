// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';

import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RoomManagementItem } from '@bini/cloud-shared';

import { App } from '../src/App.js';
import type { StaffSession } from '../src/auth/session.js';
import type { RoomManagementGateway } from '../src/room-management/room-management-gateway.js';

const session: StaffSession = { uid: 'manager-1', email: 'manager@example.com', displayName: 'Manager', propertyId: 'property-main', role: 'manager', allowedPages: ['room_management'] };
const rooms: RoomManagementItem[] = [
  { roomId: '201', version: 4, status: '可入住', note: 'Near lift', maintenanceNote: null, maintenanceDueDate: null, activeStay: null, monthly: null },
  { roomId: '202', version: 9, status: '使用中', note: null, maintenanceNote: null, maintenanceDueDate: null, activeStay: { stayId: 'STY-202', guestName: 'Juvy', checkInAt: '2026-09-12T07:00:00.000Z', checkOutAt: '2026-09-14T03:00:00.000Z' }, monthly: null },
  { roomId: '206', version: 2, status: '月租套房', note: null, maintenanceNote: null, maintenanceDueDate: null, activeStay: null, monthly: { rentalId: 'MR-live', tenantName: 'Carlos', tenantPhone: null, startDate: '2026-09-01', endDate: '2026-10-01', depositNts: 2_000, rentNts: 9_000, paymentType: 'cash', note: null } },
];
afterEach(cleanup);

describe('room management UI', () => {
  it('refuses to overwrite a room changed on another device and lets staff load the latest data', async () => {
    let emit: (value: RoomManagementItem[]) => void = () => undefined;
    const update = vi.fn().mockResolvedValue({ status: 'updated', roomId: '201', roomStatus: '可入住', updatedAt: '2026-09-15T15:00:00.000Z' });
    const gateway: RoomManagementGateway = { subscribe(_propertyId, onValue) { emit = onValue; queueMicrotask(() => onValue(rooms)); return () => undefined; }, update, createMonthly: vi.fn(), renewMonthly: vi.fn(), checkoutMonthly: vi.fn(), transferStay: vi.fn() };
    render(<App roomManagementGateway={gateway} session={session} />);
    fireEvent.click(screen.getByRole('link', { name: '房間管理' }));
    fireEvent.click(await screen.findByRole('button', { name: '201 詳細資料' }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: '編輯房態／備註' }));
    // A phone saves a new note for 201 while this dialog is open.
    await act(async () => emit(rooms.map((room) => (room.roomId === '201' ? { ...room, version: 5, note: 'Changed on phone' } : room))));
    expect(screen.getByText('此房間資料已被其他裝置修改')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '載入最新資料' }));
    expect(screen.queryByText('此房間資料已被其他裝置修改')).not.toBeInTheDocument();
    expect(screen.getByLabelText('一般備註')).toHaveValue('Changed on phone');
    fireEvent.click(screen.getByRole('button', { name: '儲存變更' }));
    await waitFor(() => expect(update).toHaveBeenCalledWith(expect.objectContaining({ roomId: '201', expectedVersion: 5, note: 'Changed on phone' })));
  });

  it('opens mobile-compatible room details and uses callable operations for monthly actions', async () => {
    const renewMonthly = vi.fn().mockResolvedValue({ status: 'renewed', roomId: '206', rentalId: 'MR-next', previousRentalId: 'MR-live', startDate: '2026-10-01', endDate: '2026-11-01', paymentId: 'PAY-1', updatedAt: '2026-09-12T08:00:00.000Z' });
    const gateway: RoomManagementGateway = { subscribe(_propertyId, onValue) { queueMicrotask(() => onValue(rooms)); return () => undefined; }, update: vi.fn(), createMonthly: vi.fn(), renewMonthly, checkoutMonthly: vi.fn(), transferStay: vi.fn() };
    render(<App roomManagementGateway={gateway} session={session} />);
    fireEvent.click(screen.getByRole('link', { name: '房間管理' }));
    fireEvent.click(await screen.findByRole('button', { name: '206 詳細資料' }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('Carlos')).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: '續租一個月' }));
    const renew = screen.getByRole('dialog');
    expect(renew).toHaveTextContent('2026-10-01 ~ 2026-11-01');
    expect(renew).toHaveTextContent('NT$ 9,000');
    fireEvent.click(within(renew).getByRole('button', { name: '確認續租' }));
    await waitFor(() => expect(renewMonthly).toHaveBeenCalledWith({ propertyId: 'property-main', operationId: expect.any(String), roomId: '206', paymentType: 'cash', expectedEndDate: '2026-10-01' }));
  });

  it('renews only once however many times the confirm button is tapped while the server is slow', async () => {
    let finish: (value: unknown) => void = () => undefined;
    const renewMonthly = vi.fn().mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    const gateway: RoomManagementGateway = { subscribe(_propertyId, onValue) { queueMicrotask(() => onValue(rooms)); return () => undefined; }, update: vi.fn(), createMonthly: vi.fn(), renewMonthly, checkoutMonthly: vi.fn(), transferStay: vi.fn() };
    render(<App roomManagementGateway={gateway} session={session} />);
    fireEvent.click(screen.getByRole('link', { name: '房間管理' }));
    fireEvent.click(await screen.findByRole('button', { name: '206 詳細資料' }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: '續租一個月' }));
    const confirm = within(screen.getByRole('dialog')).getByRole('button', { name: '確認續租' });
    const form = confirm.closest('form')!;
    fireEvent.submit(form); fireEvent.submit(form); fireEvent.submit(form);
    expect(await screen.findByText('續租處理中，請稍候，請勿重複按…')).toBeInTheDocument();
    expect(within(screen.getByRole('dialog')).getByRole('button', { name: '處理中…' })).toBeDisabled();
    fireEvent.submit(form);
    expect(renewMonthly).toHaveBeenCalledTimes(1);
    finish({ status: 'renewed', roomId: '206', rentalId: 'MR-next', previousRentalId: 'MR-live', startDate: '2026-10-01', endDate: '2026-11-01', paymentId: 'PAY-1', updatedAt: '2026-09-12T08:00:00.000Z' });
    expect(await screen.findByText('月租已續租一個月（2026-10-01 ~ 2026-11-01），租金已記入付款紀錄。')).toBeInTheDocument();
    expect(renewMonthly).toHaveBeenCalledTimes(1);
  });

  it('uses the mobile detail dialog to submit an atomic room transfer', async () => {
    const transferStay = vi.fn().mockResolvedValue({ status: 'transferred', stayId: 'STY-202', previousRoomId: '202', targetRoomId: '201', transferredAt: '2026-09-12T08:00:00.000Z' });
    const gateway: RoomManagementGateway = { subscribe(_propertyId, onValue) { queueMicrotask(() => onValue(rooms)); return () => undefined; }, update: vi.fn(), createMonthly: vi.fn(), renewMonthly: vi.fn(), checkoutMonthly: vi.fn(), transferStay };
    render(<App roomManagementGateway={gateway} session={session} />);
    fireEvent.click(screen.getByRole('link', { name: '房間管理' }));
    fireEvent.click(await screen.findByRole('button', { name: '202 詳細資料' }));
    const dialog = screen.getByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: '換房' }));
    fireEvent.click(screen.getByRole('button', { name: '確認換房' }));
    await waitFor(() => expect(transferStay).toHaveBeenCalledWith({ propertyId: 'property-main', operationId: expect.any(String), stayId: 'STY-202', targetRoomId: '201' }));
  });
});

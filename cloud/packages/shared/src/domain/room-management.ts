import { z } from 'zod';

import { CLOUD_ROOM_STATUSES, type CloudRoomStatus } from './room-overview.js';

export interface RoomManagementItem {
  roomId: string;
  /** Room document version when read; edits send it back to refuse overwriting another device's change. */
  version: number;
  status: CloudRoomStatus;
  note: string | null;
  maintenanceNote: string | null;
  maintenanceDueDate: string | null;
  activeStay: { stayId: string; guestName: string; checkInAt: string; checkOutAt: string } | null;
  /** Every monthly-rental record for this room, newest first; voided ones stay visible but stop counting. */
  monthlyHistory: MonthlyRentalRecord[];
  monthly: {
    rentalId: string;
    tenantName: string;
    tenantPhone: string | null;
    startDate: string;
    endDate: string;
    depositNts: number;
    rentNts: number;
    paymentType: 'cash' | 'transfer' | 'card' | 'other';
    note: string | null;
  } | null;
}

export interface MonthlyRentalRecord {
  rentalId: string;
  roomId: string;
  tenantName: string;
  startDate: string;
  endDate: string;
  rentNts: number;
  status: 'active' | 'renewed' | 'ended' | 'voided';
  createdAt: string | null;
  voidReason: string | null;
}

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const roomSchema = z.object({
  roomId: z.string().trim().min(1).max(128), status: z.enum(CLOUD_ROOM_STATUSES),
  note: z.string().nullable().optional(), maintenanceNote: z.string().nullable().optional(), maintenanceDueDate: isoDate.nullable().optional(),
  version: z.number().int().min(0).optional(),
}).passthrough();
const monthlySchema = z.object({
  roomId: z.string().trim().min(1).max(128), tenantName: z.string().trim().min(1).max(300), tenantPhone: z.string().nullable().optional(),
  startDate: isoDate, endDate: isoDate, depositNts: z.number().int().safe().min(0), rentNts: z.number().int().safe().min(0),
  status: z.enum(['active', 'renewed', 'ended', 'voided']), paymentType: z.enum(['cash', 'transfer', 'card', 'other']).nullable().optional(), note: z.string().nullable().optional(),
  createdAt: z.string().nullable().optional(), voidReason: z.string().nullable().optional(),
}).passthrough();
const activeStaySchema = z.object({ roomId: z.string().trim().min(1).max(128), guestName: z.string().trim().min(1).max(300), checkInAt: z.string().datetime({ offset: true }), checkOutAt: z.string().datetime({ offset: true }) }).passthrough();

export function buildRoomManagementItems(rooms: readonly { id: string; data: unknown }[], rentals: readonly { id: string; data: unknown }[], stays: readonly { id: string; data: unknown }[] = []): RoomManagementItem[] {
  const activeByRoom = new Map<string, RoomManagementItem['monthly']>();
  const historyByRoom = new Map<string, MonthlyRentalRecord[]>();
  for (const source of rentals) {
    const rental = monthlySchema.parse(source.data);
    const history = historyByRoom.get(rental.roomId) ?? [];
    history.push({ rentalId: source.id, roomId: rental.roomId, tenantName: rental.tenantName, startDate: rental.startDate, endDate: rental.endDate, rentNts: rental.rentNts, status: rental.status, createdAt: rental.createdAt ?? null, voidReason: rental.voidReason ?? null });
    historyByRoom.set(rental.roomId, history);
    if (rental.status !== 'active') continue;
    if (activeByRoom.has(rental.roomId)) throw new Error(`room ${rental.roomId} has multiple active monthly rentals`);
    activeByRoom.set(rental.roomId, { rentalId: source.id, tenantName: rental.tenantName, tenantPhone: rental.tenantPhone ?? null, startDate: rental.startDate, endDate: rental.endDate, depositNts: rental.depositNts, rentNts: rental.rentNts, paymentType: rental.paymentType ?? 'cash', note: rental.note ?? null });
  }
  const activeStayByRoom = new Map<string, RoomManagementItem['activeStay']>();
  for (const source of stays) {
    const stay = activeStaySchema.parse(source.data);
    if (activeStayByRoom.has(stay.roomId)) throw new Error(`room ${stay.roomId} has multiple active stays`);
    activeStayByRoom.set(stay.roomId, { stayId: typeof (source.data as Record<string, unknown>).stayId === 'string' ? String((source.data as Record<string, unknown>).stayId) : source.id, guestName: stay.guestName, checkInAt: stay.checkInAt, checkOutAt: stay.checkOutAt });
  }
  return rooms.map((source) => {
    const room = roomSchema.parse(source.data);
    if (source.id !== room.roomId) throw new Error(`rooms/${source.id} identity does not match its document id`);
    const history = (historyByRoom.get(room.roomId) ?? []).slice().sort((left, right) => (right.createdAt ?? right.startDate).localeCompare(left.createdAt ?? left.startDate) || right.startDate.localeCompare(left.startDate));
    return { roomId: room.roomId, version: room.version ?? 0, status: room.status, note: room.note ?? null, maintenanceNote: room.maintenanceNote ?? null, maintenanceDueDate: room.maintenanceDueDate ?? null, activeStay: activeStayByRoom.get(room.roomId) ?? null, monthlyHistory: history, monthly: activeByRoom.get(room.roomId) ?? null };
  }).sort((left, right) => left.roomId.localeCompare(right.roomId, undefined, { numeric: true }));
}

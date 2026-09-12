import { z } from 'zod';

import { CLOUD_ROOM_STATUSES, type CloudRoomStatus } from './room-overview.js';

export interface RoomManagementItem {
  roomId: string;
  status: CloudRoomStatus;
  note: string | null;
  maintenanceNote: string | null;
  maintenanceDueDate: string | null;
  activeStay: { stayId: string; guestName: string; checkInAt: string; checkOutAt: string } | null;
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

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const roomSchema = z.object({
  roomId: z.string().trim().min(1).max(128), status: z.enum(CLOUD_ROOM_STATUSES),
  note: z.string().nullable().optional(), maintenanceNote: z.string().nullable().optional(), maintenanceDueDate: isoDate.nullable().optional(),
}).passthrough();
const monthlySchema = z.object({
  roomId: z.string().trim().min(1).max(128), tenantName: z.string().trim().min(1).max(300), tenantPhone: z.string().nullable().optional(),
  startDate: isoDate, endDate: isoDate, depositNts: z.number().int().safe().min(0), rentNts: z.number().int().safe().min(0),
  status: z.enum(['active', 'renewed', 'ended']), paymentType: z.enum(['cash', 'transfer', 'card', 'other']).nullable().optional(), note: z.string().nullable().optional(),
}).passthrough();
const activeStaySchema = z.object({ roomId: z.string().trim().min(1).max(128), guestName: z.string().trim().min(1).max(300), checkInAt: z.string().datetime(), checkOutAt: z.string().datetime() }).passthrough();

export function buildRoomManagementItems(rooms: readonly { id: string; data: unknown }[], rentals: readonly { id: string; data: unknown }[], stays: readonly { id: string; data: unknown }[] = []): RoomManagementItem[] {
  const activeByRoom = new Map<string, RoomManagementItem['monthly']>();
  for (const source of rentals) {
    const rental = monthlySchema.parse(source.data);
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
    return { roomId: room.roomId, status: room.status, note: room.note ?? null, maintenanceNote: room.maintenanceNote ?? null, maintenanceDueDate: room.maintenanceDueDate ?? null, activeStay: activeStayByRoom.get(room.roomId) ?? null, monthly: activeByRoom.get(room.roomId) ?? null };
  }).sort((left, right) => left.roomId.localeCompare(right.roomId, undefined, { numeric: true }));
}

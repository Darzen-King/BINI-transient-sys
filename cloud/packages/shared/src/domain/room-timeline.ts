import { z } from 'zod';

export type RoomTimelineEventType = 'stay' | 'booking' | 'maintenance' | 'monthly';
export interface RoomTimelineSourceDocument { id: string; data: unknown; }
export interface RoomTimelineProjection { startAt: string; endAt: string; rooms: Array<{ roomId: string; events: RoomTimelineEvent[] }>; }
export interface RoomTimelineEvent { id: string; roomId: string; type: RoomTimelineEventType; label: string; startAt: string; endAt: string; }

const dateTime = z.string().refine((value) => Number.isFinite(Date.parse(value)), 'invalid datetime');
const roomSchema = z.object({ roomId: z.string().trim().min(1).max(128) }).passthrough();
const bookingSchema = z.object({ bookingId: z.string().trim().min(1).max(128), roomId: z.string().trim().min(1).max(128), guestName: z.string().trim().min(1).max(300), checkInAt: dateTime, checkOutAt: dateTime, status: z.enum(['已預約', '已取消', 'No-show', '已入住']) }).passthrough();
const staySchema = z.object({ roomId: z.string().trim().min(1).max(128), guestName: z.string().trim().min(1).max(300), checkInAt: dateTime, checkOutAt: dateTime }).passthrough();
const maintenanceSchema = z.object({ roomId: z.string().trim().min(1).max(128), title: z.string().trim().min(1).max(500), startAt: dateTime, endAt: dateTime, status: z.enum(['scheduled', 'in_progress', 'done']) }).passthrough();
const monthlySchema = z.object({ roomId: z.string().trim().min(1).max(128), tenantName: z.string().trim().min(1).max(300), startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), status: z.enum(['active', 'renewed', 'ended']) }).passthrough();

function taipeiMidnight(date: Date): Date {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date).map((part) => [part.type, part.value]));
  return new Date(Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), -8));
}
function overlaps(startAt: string, endAt: string, windowStart: number, windowEnd: number): boolean { return Date.parse(startAt) < windowEnd && Date.parse(endAt) > windowStart; }

export function buildRoomTimeline(input: { rooms: readonly RoomTimelineSourceDocument[]; bookings: readonly RoomTimelineSourceDocument[]; stays: readonly RoomTimelineSourceDocument[]; maintenanceSchedules: readonly RoomTimelineSourceDocument[]; monthlyRentals: readonly RoomTimelineSourceDocument[] }, now = new Date()): RoomTimelineProjection {
  const start = taipeiMidnight(now); const end = new Date(start.getTime() + (14 * 86_400_000)); const startMs = start.getTime(); const endMs = end.getTime();
  const byRoom = new Map<string, RoomTimelineEvent[]>();
  for (const source of input.rooms) { const room = roomSchema.parse(source.data); if (source.id !== room.roomId) throw new Error(`rooms/${source.id} identity does not match its document id`); byRoom.set(room.roomId, []); }
  const add = (event: RoomTimelineEvent) => { if (!byRoom.has(event.roomId) || !overlaps(event.startAt, event.endAt, startMs, endMs)) return; byRoom.get(event.roomId)?.push(event); };
  for (const source of input.bookings) { const value = bookingSchema.parse(source.data); if (value.status === '已預約') add({ id: source.id, roomId: value.roomId, type: 'booking', label: value.guestName, startAt: value.checkInAt, endAt: value.checkOutAt }); }
  for (const source of input.stays) { const value = staySchema.parse(source.data); add({ id: source.id, roomId: value.roomId, type: 'stay', label: value.guestName, startAt: value.checkInAt, endAt: value.checkOutAt }); }
  for (const source of input.maintenanceSchedules) { const value = maintenanceSchema.parse(source.data); if (value.status !== 'done') add({ id: source.id, roomId: value.roomId, type: 'maintenance', label: value.title, startAt: value.startAt, endAt: value.endAt }); }
  for (const source of input.monthlyRentals) { const value = monthlySchema.parse(source.data); if (value.status === 'active') add({ id: source.id, roomId: value.roomId, type: 'monthly', label: value.tenantName, startAt: `${value.startDate}T00:00:00+08:00`, endAt: `${value.endDate}T00:00:00+08:00` }); }
  return { startAt: start.toISOString(), endAt: end.toISOString(), rooms: [...byRoom.entries()].map(([roomId, events]) => ({ roomId, events: events.sort((left, right) => Date.parse(left.startAt) - Date.parse(right.startAt)) })).sort((left, right) => left.roomId.localeCompare(right.roomId, undefined, { numeric: true })) };
}

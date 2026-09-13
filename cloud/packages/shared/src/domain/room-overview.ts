import { z } from 'zod';

import { summarizeStayPayments } from './stay-payments.js';

export const CLOUD_ROOM_STATUSES = [
  '可入住',
  '使用中',
  '即將退房',
  '待清潔',
  '清潔中',
  '維修中',
  '月租套房',
] as const;

export type CloudRoomStatus = typeof CLOUD_ROOM_STATUSES[number];
export type RoomOverviewAction = 'checkin' | 'extend' | 'payment' | 'checkout';

export interface RoomOverviewSourceDocument {
  id: string;
  data: unknown;
}

export interface RoomOverviewSource {
  rooms: RoomOverviewSourceDocument[];
  bookings: RoomOverviewSourceDocument[];
  stays: RoomOverviewSourceDocument[];
  payments: RoomOverviewSourceDocument[];
  maintenanceSchedules: RoomOverviewSourceDocument[];
}

export interface RoomOverviewRoom {
  roomId: string;
  status: CloudRoomStatus;
  guestName: string | null;
  checkInAt: string | null;
  checkOutAt: string | null;
  totalDueNts: number | null;
  totalPaidNts: number | null;
  depositPaidNts: number | null;
  balanceDueNts: number | null;
  maintenanceTitle: string | null;
  maintenanceEndAt: string | null;
  nextBookingAt: string | null;
  note: string | null;
  actions: RoomOverviewAction[];
}

export interface RoomOverviewUpcomingItem {
  bookingId: string;
  roomId: string;
  guestName: string;
  checkInAt: string;
  paidNts: number;
}

export interface RoomOverviewProjection {
  rooms: RoomOverviewRoom[];
  summary: {
    arrivalsToday: number;
    departuresToday: number;
    cleaningPending: number;
  };
  upNext: RoomOverviewUpcomingItem[];
}

const dateTimeSchema = z.string().refine((value) => Number.isFinite(Date.parse(value)), 'invalid datetime');
const nullableDateTimeSchema = dateTimeSchema.nullable().optional();
const nullableTextSchema = z.string().nullable().optional();
const safeIntegerSchema = z.number().int().safe();

const roomSchema = z.object({
  roomId: z.string().trim().min(1).max(128),
  status: z.enum(CLOUD_ROOM_STATUSES),
  guestName: nullableTextSchema,
  checkInAt: nullableDateTimeSchema,
  checkOutAt: nullableDateTimeSchema,
  note: nullableTextSchema,
  maintenanceNote: nullableTextSchema,
  maintenanceDueDate: nullableDateTimeSchema,
}).passthrough();

const bookingSchema = z.object({
  bookingId: z.string().trim().min(1).max(128),
  roomId: z.string().trim().min(1).max(128),
  guestName: z.string().trim().min(1).max(300),
  checkInAt: dateTimeSchema,
  checkOutAt: dateTimeSchema,
  status: z.enum(['已預約', '已取消', 'No-show', '已入住']),
}).passthrough();

const staySchema = z.object({
  roomId: z.string().trim().min(1).max(128),
  guestName: z.string().trim().min(1).max(300),
  checkInAt: nullableDateTimeSchema,
  checkOutAt: nullableDateTimeSchema,
  totalDueNts: safeIntegerSchema,
  bookingId: z.string().trim().min(1).max(128).nullable().optional(),
  createdAt: nullableDateTimeSchema,
}).passthrough();

const paymentSchema = z.object({
  roomId: z.string().trim().min(1).max(128).nullable().optional(),
  bookingId: z.string().trim().min(1).max(128).nullable().optional(),
  amountNts: safeIntegerSchema,
  deposit: z.boolean(),
  refund: z.boolean(),
  status: z.enum(['paid', 'pending', 'partial', 'refunded', 'voided']).optional().default('paid'),
  createdAt: dateTimeSchema,
}).passthrough();

const maintenanceSchema = z.object({
  roomId: z.string().trim().min(1).max(128),
  title: z.string().trim().min(1).max(500),
  startAt: dateTimeSchema,
  endAt: dateTimeSchema,
  status: z.enum(['scheduled', 'in_progress', 'done']),
}).passthrough();

interface ParsedDocument<T> {
  id: string;
  data: T;
}

function parseDocuments<T>(
  documents: readonly RoomOverviewSourceDocument[],
  schema: z.ZodType<T>,
  collectionName: string,
): ParsedDocument<T>[] {
  return documents.map((document) => {
    const parsed = schema.safeParse(document.data);
    if (!parsed.success) throw new Error(`${collectionName}/${document.id} does not match the room overview schema`);
    return { id: document.id, data: parsed.data };
  });
}

function valueOrNull(value: string | null | undefined): string | null {
  return value ?? null;
}

function taipeiDayKey(date: Date): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Taipei',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function actionsForStatus(status: CloudRoomStatus): RoomOverviewAction[] {
  if (status === '可入住') return ['checkin'];
  if (status === '使用中' || status === '即將退房') return ['extend', 'payment', 'checkout'];
  return [];
}

export function buildRoomOverviewProjection(
  source: RoomOverviewSource,
  now = new Date(),
): RoomOverviewProjection {
  const nowMs = now.getTime();
  if (!Number.isFinite(nowMs)) throw new Error('room overview clock is invalid');

  const rooms = parseDocuments(source.rooms, roomSchema, 'rooms');
  const bookings = parseDocuments(source.bookings, bookingSchema, 'bookings');
  const stays = parseDocuments(source.stays, staySchema, 'stays');
  const payments = parseDocuments(source.payments, paymentSchema, 'payments');
  const maintenanceSchedules = parseDocuments(source.maintenanceSchedules, maintenanceSchema, 'maintenanceSchedules');
  const today = taipeiDayKey(now);
  const activeStaysByRoom = new Map<string, ParsedDocument<z.infer<typeof staySchema>>>();

  for (const room of rooms) {
    if (room.id !== room.data.roomId) throw new Error(`rooms/${room.id} identity does not match its document id`);
  }
  for (const booking of bookings) {
    if (booking.id !== booking.data.bookingId) throw new Error(`bookings/${booking.id} identity does not match its document id`);
  }

  for (const stay of stays) {
    if (activeStaysByRoom.has(stay.data.roomId)) {
      throw new Error(`room ${stay.data.roomId} has multiple active stays`);
    }
    activeStaysByRoom.set(stay.data.roomId, stay);
  }

  const futureBookings = bookings
    .filter((booking) => booking.data.status === '已預約' && Date.parse(booking.data.checkInAt) > nowMs)
    .sort((left, right) => Date.parse(left.data.checkInAt) - Date.parse(right.data.checkInAt));

  const projectedRooms = rooms
    .map((room): RoomOverviewRoom => {
      const roomId = room.id;
      const stay = activeStaysByRoom.get(roomId)?.data;
      const maintenance = maintenanceSchedules
        .filter((schedule) => (
          schedule.data.roomId === roomId
          && schedule.data.status !== 'done'
          && Date.parse(schedule.data.startAt) <= nowMs
          && Date.parse(schedule.data.endAt) > nowMs
        ))
        .sort((left, right) => Date.parse(left.data.endAt) - Date.parse(right.data.endAt))[0]?.data;
      const nextBookingAt = futureBookings.find((booking) => booking.data.roomId === roomId)?.data.checkInAt ?? null;
      let totalPaidNts: number | null = null;
      let depositPaidNts: number | null = null;
      let balanceDueNts: number | null = null;

      if (stay) {
        ({ totalPaidNts, depositPaidNts, balanceDueNts } = summarizeStayPayments({ ...stay, roomId }, payments.map((payment) => payment.data)));
      }

      const status = maintenance ? '維修中' : room.data.status;
      return {
        roomId,
        status,
        guestName: valueOrNull(stay?.guestName ?? room.data.guestName),
        checkInAt: valueOrNull(stay?.checkInAt ?? room.data.checkInAt),
        checkOutAt: valueOrNull(stay?.checkOutAt ?? room.data.checkOutAt),
        totalDueNts: stay?.totalDueNts ?? null,
        totalPaidNts,
        depositPaidNts,
        balanceDueNts,
        maintenanceTitle: maintenance?.title ?? (status === '維修中' ? valueOrNull(room.data.maintenanceNote) : null),
        maintenanceEndAt: maintenance?.endAt ?? (status === '維修中' ? valueOrNull(room.data.maintenanceDueDate) : null),
        nextBookingAt,
        note: valueOrNull(room.data.note),
        actions: actionsForStatus(status),
      };
    })
    .sort((left, right) => left.roomId.localeCompare(right.roomId, undefined, { numeric: true }));

  const paidByBooking = new Map<string, number>();
  for (const payment of payments) {
    if (payment.data.status === 'voided') continue;
    if (!payment.data.bookingId) continue;
    const direction = payment.data.refund ? -1 : 1;
    paidByBooking.set(
      payment.data.bookingId,
      (paidByBooking.get(payment.data.bookingId) ?? 0) + (direction * payment.data.amountNts),
    );
  }

  return {
    rooms: projectedRooms,
    summary: {
      arrivalsToday: bookings.filter((booking) => (
        booking.data.status === '已預約'
        && taipeiDayKey(new Date(booking.data.checkInAt)) === today
      )).length,
      departuresToday: stays.filter((stay) => (
        stay.data.checkOutAt != null
        && taipeiDayKey(new Date(stay.data.checkOutAt)) === today
      )).length,
      cleaningPending: projectedRooms.filter((room) => room.status === '待清潔' || room.status === '清潔中').length,
    },
    upNext: futureBookings.slice(0, 10).map((booking) => ({
      bookingId: booking.id,
      roomId: booking.data.roomId,
      guestName: booking.data.guestName,
      checkInAt: booking.data.checkInAt,
      paidNts: Math.max(0, paidByBooking.get(booking.id) ?? 0),
    })),
  };
}

import { z } from 'zod';
const schedule = z.object({ roomId: z.string().trim().min(1).max(128), title: z.string().trim().min(1).max(500), startAt: z.string().refine((value) => Number.isFinite(Date.parse(value))), endAt: z.string().refine((value) => Number.isFinite(Date.parse(value))), note: z.string().max(2_000).nullable().optional(), status: z.enum(['scheduled', 'in_progress', 'done']) }).passthrough();
export interface MaintenanceScheduleItem { scheduleId: string; roomId: string; title: string; startAt: string; endAt: string; note: string | null; status: 'scheduled' | 'in_progress' | 'done'; }
export function buildMaintenanceScheduleItems(documents: readonly { id: string; data: unknown }[]): MaintenanceScheduleItem[] { return documents.map((document) => { const value = schedule.parse(document.data); return { scheduleId: document.id, roomId: value.roomId, title: value.title, startAt: value.startAt, endAt: value.endAt, note: value.note ?? null, status: value.status }; }).sort((left, right) => left.startAt.localeCompare(right.startAt)); }

/** A room currently in the v3 `維修中` state, as shown on the maintenance page cards. */
export interface MaintenanceRoomItem {
  roomId: string;
  maintenanceNote: string | null;
  maintenanceDueDate: string | null;
  /** v3 shows a red warning badge when the due date is earlier than today. */
  overdue: boolean;
}

const maintenanceRoom = z
  .object({
    roomId: z.string().trim().min(1).max(128),
    status: z.enum(['可入住', '使用中', '即將退房', '待清潔', '清潔中', '維修中', '月租套房']),
    maintenanceNote: z.string().max(2_000).nullable().optional(),
    maintenanceDueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/u).nullable().optional(),
  })
  .passthrough();

/** Projects live room documents into maintenance cards. Malformed rooms throw so the page fails closed. */
export function buildMaintenanceRoomItems(documents: readonly { id: string; data: unknown }[], taipeiToday: string): MaintenanceRoomItem[] {
  return documents
    .map((document) => {
      const value = maintenanceRoom.parse(document.data);
      if (value.roomId !== document.id) throw new Error(`rooms/${document.id} 的 roomId 不一致。`);
      return value;
    })
    .filter((value) => value.status === '維修中')
    .map((value) => {
      const maintenanceDueDate = value.maintenanceDueDate ?? null;
      return {
        roomId: value.roomId,
        maintenanceNote: value.maintenanceNote?.trim() ? value.maintenanceNote : null,
        maintenanceDueDate,
        overdue: maintenanceDueDate !== null && maintenanceDueDate < taipeiToday,
      };
    })
    .sort((left, right) => left.roomId.localeCompare(right.roomId, 'zh-Hant', { numeric: true }));
}

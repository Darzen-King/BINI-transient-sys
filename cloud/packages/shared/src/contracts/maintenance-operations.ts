import { z } from 'zod';
const propertyId = z.string().trim().min(1).max(128).regex(/^[^/]+$/); const operationId = z.string().uuid(); const roomId = z.string().trim().min(1).max(128).regex(/^[^/]+$/); const dateTime = z.string().trim().min(20).max(64).refine((value) => Number.isFinite(Date.parse(value)), '日期時間格式不正確。');
export const maintenanceScheduleCreateInputSchema = z.object({ propertyId, operationId, roomId, title: z.string().trim().min(1).max(500), startAt: dateTime, endAt: dateTime, note: z.string().trim().max(2_000).nullable().optional() }).strict().refine((value) => Date.parse(value.endAt) > Date.parse(value.startAt), { path: ['endAt'], message: '結束時間必須晚於開始時間。' });
export type MaintenanceScheduleCreateInput = z.infer<typeof maintenanceScheduleCreateInputSchema>;
export const maintenanceScheduleCreateResultSchema = z.object({ status: z.enum(['created', 'replayed']), scheduleId: z.string().min(1).max(128), roomId, startAt: dateTime, endAt: dateTime }).strict();
export type MaintenanceScheduleCreateResult = z.infer<typeof maintenanceScheduleCreateResultSchema>;
export const maintenanceScheduleActionInputSchema = z.object({ propertyId, operationId, scheduleId: z.string().trim().min(1).max(128).regex(/^[^/]+$/), action: z.enum(['complete', 'delete']) }).strict();
export type MaintenanceScheduleActionInput = z.infer<typeof maintenanceScheduleActionInputSchema>;
export const maintenanceScheduleActionResultSchema = z.object({ status: z.enum(['completed', 'deleted', 'replayed']), scheduleId: z.string().min(1).max(128), action: z.enum(['complete', 'delete']), completedAt: dateTime.nullable() }).strict();
export type MaintenanceScheduleActionResult = z.infer<typeof maintenanceScheduleActionResultSchema>;

/**
 * v3 `/maintenance/update`: a room under maintenance can receive a progress note, or be resolved back
 * to service. Resolve mirrors v3 `update_room_status(..., "可入住")`, which also clears the maintenance
 * note and due date. An empty note is rejected rather than silently ignored.
 */
export const maintenanceRoomUpdateInputSchema = z
  .discriminatedUnion('action', [
    z.object({ propertyId, operationId, roomId, action: z.literal('update_note'), maintenanceNote: z.string().trim().min(1, '請填寫維修進度備註。').max(2_000) }).strict(),
    z.object({ propertyId, operationId, roomId, action: z.literal('resolve'), maintenanceNote: z.null() }).strict(),
  ]);
export type MaintenanceRoomUpdateInput = z.infer<typeof maintenanceRoomUpdateInputSchema>;
export const maintenanceRoomUpdateResultSchema = z
  .object({
    status: z.enum(['noted', 'resolved', 'replayed']),
    action: z.enum(['update_note', 'resolve']),
    roomId,
    nextStatus: z.enum(['維修中', '可入住']),
    updatedAt: z.string().datetime(),
  })
  .strict();
export type MaintenanceRoomUpdateResult = z.infer<typeof maintenanceRoomUpdateResultSchema>;

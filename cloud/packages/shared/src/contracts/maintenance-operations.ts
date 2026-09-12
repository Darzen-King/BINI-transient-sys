import { z } from 'zod';
const propertyId = z.string().trim().min(1).max(128).regex(/^[^/]+$/); const operationId = z.string().uuid(); const roomId = z.string().trim().min(1).max(128).regex(/^[^/]+$/); const dateTime = z.string().trim().min(20).max(64).refine((value) => Number.isFinite(Date.parse(value)), '日期時間格式不正確。');
export const maintenanceScheduleCreateInputSchema = z.object({ propertyId, operationId, roomId, title: z.string().trim().min(1).max(500), startAt: dateTime, endAt: dateTime, note: z.string().trim().max(2_000).nullable().optional() }).strict().refine((value) => Date.parse(value.endAt) > Date.parse(value.startAt), { path: ['endAt'], message: '結束時間必須晚於開始時間。' });
export type MaintenanceScheduleCreateInput = z.infer<typeof maintenanceScheduleCreateInputSchema>;
export const maintenanceScheduleCreateResultSchema = z.object({ status: z.enum(['created', 'replayed']), scheduleId: z.string().min(1).max(128), roomId, startAt: dateTime, endAt: dateTime }).strict();
export type MaintenanceScheduleCreateResult = z.infer<typeof maintenanceScheduleCreateResultSchema>;

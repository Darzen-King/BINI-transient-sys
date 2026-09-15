import { z } from 'zod';

import { BOOKING_PAYMENT_TYPES } from './booking-operations.js';

const propertyId = z.string().trim().min(1).max(128).regex(/^[^/]+$/);
const operationId = z.string().uuid();
const roomId = z.string().trim().min(1).max(128).regex(/^[^/]+$/);
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => Number.isFinite(Date.parse(`${value}T00:00:00+08:00`)), '日期格式不正確。');
const amount = z.number().int().safe().min(0).max(100_000_000);
const roomStatus = z.enum(['可入住', '使用中', '即將退房', '待清潔', '清潔中', '維修中']);

/** Manual room administration is deliberately separate from stay / housekeeping workflows. */
export const roomManagementUpdateInputSchema = z.object({
  propertyId,
  operationId,
  roomId,
  status: roomStatus,
  note: z.string().trim().max(2_000).nullable(),
  maintenanceNote: z.string().trim().max(2_000).nullable(),
  maintenanceDueDate: isoDate.nullable(),
  /** Room version the edit dialog was opened with. */
  expectedVersion: z.number().int().min(0),
}).strict().superRefine((input, context) => {
  if (input.status === '維修中' && !input.maintenanceNote) context.addIssue({ code: z.ZodIssueCode.custom, path: ['maintenanceNote'], message: '維修中必須填寫維修說明。' });
  if (input.status === '維修中' && !input.maintenanceDueDate) context.addIssue({ code: z.ZodIssueCode.custom, path: ['maintenanceDueDate'], message: '維修中必須填寫預計完成日。' });
  if (input.status !== '維修中' && (input.maintenanceNote !== null || input.maintenanceDueDate !== null)) context.addIssue({ code: z.ZodIssueCode.custom, path: ['maintenanceNote'], message: '非維修房不可附帶維修欄位。' });
});
export type RoomManagementUpdateInput = z.infer<typeof roomManagementUpdateInputSchema>;

export const roomManagementUpdateResultSchema = z.object({
  status: z.enum(['updated', 'replayed']),
  roomId,
  previousStatus: z.enum(['可入住', '使用中', '即將退房', '待清潔', '清潔中', '維修中', '月租套房']),
  nextStatus: z.enum(['可入住', '使用中', '即將退房', '待清潔', '清潔中', '維修中', '月租套房']),
  updatedAt: z.string().datetime(),
}).strict();
export type RoomManagementUpdateResult = z.infer<typeof roomManagementUpdateResultSchema>;

export const monthlyRentalCreateInputSchema = z.object({
  propertyId,
  operationId,
  roomId,
  tenantName: z.string().trim().min(1).max(300),
  tenantPhone: z.string().trim().max(100).nullable(),
  startDate: isoDate,
  depositNts: amount,
  rentNts: amount,
  paymentType: z.enum(BOOKING_PAYMENT_TYPES),
  note: z.string().trim().max(2_000).nullable(),
}).strict();
export type MonthlyRentalCreateInput = z.infer<typeof monthlyRentalCreateInputSchema>;

// expectedEndDate is the end date staff saw: a repeated tap after the rental already moved on is refused, never renewed twice.
export const monthlyRentalRenewInputSchema = z.object({ propertyId, operationId, roomId, paymentType: z.enum(BOOKING_PAYMENT_TYPES), expectedEndDate: isoDate }).strict();
export type MonthlyRentalRenewInput = z.infer<typeof monthlyRentalRenewInputSchema>;

export const monthlyRentalCheckoutInputSchema = z.object({
  propertyId,
  operationId,
  roomId,
  depositRefundedNts: amount,
  paymentType: z.enum(BOOKING_PAYMENT_TYPES),
  note: z.string().trim().max(2_000).nullable(),
}).strict();
export type MonthlyRentalCheckoutInput = z.infer<typeof monthlyRentalCheckoutInputSchema>;

export const monthlyRentalOperationResultSchema = z.object({
  status: z.enum(['created', 'renewed', 'checked_out', 'replayed']),
  roomId,
  rentalId: z.string().trim().min(1).max(128),
  previousRentalId: z.string().trim().min(1).max(128).nullable(),
  startDate: isoDate,
  endDate: isoDate,
  paymentId: z.string().trim().min(1).max(128).nullable(),
  updatedAt: z.string().datetime(),
}).strict();
export type MonthlyRentalOperationResult = z.infer<typeof monthlyRentalOperationResultSchema>;

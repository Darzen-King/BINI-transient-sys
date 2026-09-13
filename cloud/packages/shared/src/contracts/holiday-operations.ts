import { z } from 'zod';

const propertyId = z.string().trim().min(1).max(128).regex(/^[^/]+$/);
const operationId = z.string().uuid();
export const holidayDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
export const holidayYearSchema = z.number().int().min(2020).max(2100);

export const holidayManualUpsertInputSchema = z.object({
  propertyId,
  operationId,
  date: holidayDateSchema,
  description: z.string().trim().max(500),
}).strict();
export type HolidayManualUpsertInput = z.infer<typeof holidayManualUpsertInputSchema>;

export const holidayDeleteInputSchema = z.object({
  propertyId,
  operationId,
  date: holidayDateSchema,
}).strict();
export type HolidayDeleteInput = z.infer<typeof holidayDeleteInputSchema>;

export const holidayResyncInputSchema = z.object({
  propertyId,
  operationId,
  year: holidayYearSchema,
}).strict();
export type HolidayResyncInput = z.infer<typeof holidayResyncInputSchema>;

export const holidayOperationResultSchema = z.object({
  status: z.enum(['created', 'updated', 'deleted', 'synced', 'replayed']),
  date: holidayDateSchema.optional(),
  year: holidayYearSchema.optional(),
  source: z.enum(['api', 'fallback', 'manual']).optional(),
  syncedCount: z.number().int().min(0).max(500).optional(),
  updatedAt: z.string().datetime(),
}).strict();
export type HolidayOperationResult = z.infer<typeof holidayOperationResultSchema>;

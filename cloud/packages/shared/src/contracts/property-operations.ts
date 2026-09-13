import { z } from 'zod';
import { CLOUD_PAGE_IDS, CLOUD_ROLES } from './staff.js';

const propertyId = z.string().trim().min(1).max(64).regex(/^[A-Za-z0-9][A-Za-z0-9_-]*$/);
export const propertyCreateInputSchema = z.object({
  sourcePropertyId: propertyId,
  operationId: z.string().uuid(),
  propertyId,
  name: z.string().trim().min(1).max(200),
  address: z.string().trim().max(1_000).nullable().optional(),
  phone: z.string().trim().max(100).nullable().optional(),
  note: z.string().trim().max(5_000).nullable().optional(),
}).strict();
export type PropertyCreateInput = z.infer<typeof propertyCreateInputSchema>;

export const propertyListInputSchema = z.object({ sourcePropertyId: propertyId }).strict();
export type PropertyListInput = z.infer<typeof propertyListInputSchema>;

export const propertyDirectoryItemSchema = z.object({
  propertyId,
  name: z.string().min(1).max(200),
  address: z.string().max(1_000).nullable(),
  phone: z.string().max(100).nullable(),
  note: z.string().max(5_000).nullable(),
  active: z.boolean(),
  currency: z.literal('TWD'),
  timezone: z.literal('Asia/Taipei'),
  role: z.enum(CLOUD_ROLES),
  allowedPages: z.array(z.enum(CLOUD_PAGE_IDS)),
}).strict();
export type PropertyDirectoryItem = z.infer<typeof propertyDirectoryItemSchema>;

export const propertyCreateResultSchema = z.object({ propertyId, status: z.enum(['created', 'replayed']), createdAt: z.string().datetime() }).strict();
export type PropertyCreateResult = z.infer<typeof propertyCreateResultSchema>;

import { z } from 'zod';

const propertyId = z.string().trim().min(1).max(128).regex(/^[^/]+$/);
const operationId = z.string().uuid();
const roomId = z.string().trim().min(1).max(128).regex(/^[^/]+$/);

/** The only v3-compatible room-cleaning transitions: pending → in progress → available. */
export const housekeepingUpdateInputSchema = z.object({ propertyId, operationId, roomId, status: z.enum(['清潔中', '可入住']) }).strict();
export type HousekeepingUpdateInput = z.infer<typeof housekeepingUpdateInputSchema>;
export const housekeepingUpdateResultSchema = z.object({ status: z.enum(['updated', 'replayed']), roomId, previousStatus: z.enum(['待清潔', '清潔中']), nextStatus: z.enum(['清潔中', '可入住']), updatedAt: z.string().datetime() }).strict();
export type HousekeepingUpdateResult = z.infer<typeof housekeepingUpdateResultSchema>;

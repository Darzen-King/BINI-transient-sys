import { z } from 'zod';

export const PUSH_PLATFORMS = ['ios', 'android', 'desktop', 'other'] as const;
export type PushPlatform = (typeof PUSH_PLATFORMS)[number];

/** An FCM registration token for one browser/device; the server binds it to the signed-in staff account. */
export const pushTokenRegisterInputSchema = z.object({
  token: z.string().trim().min(20).max(4_096),
  platform: z.enum(PUSH_PLATFORMS),
}).strict();
export type PushTokenRegisterInput = z.infer<typeof pushTokenRegisterInputSchema>;

export const pushTokenUnregisterInputSchema = z.object({
  token: z.string().trim().min(20).max(4_096),
}).strict();
export type PushTokenUnregisterInput = z.infer<typeof pushTokenUnregisterInputSchema>;

export const pushTestSendResultSchema = z.object({
  sentCount: z.number().int().min(0),
  failedCount: z.number().int().min(0),
}).strict();
export type PushTestSendResult = z.infer<typeof pushTestSendResultSchema>;

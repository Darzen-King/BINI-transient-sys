import {
  DEMO_NOTE_COLLECTION,
  DEMO_NOTE_OPERATION_TYPE,
  DemoNotePayloadSchema,
} from '@bini/cloud-shared';

import type { HandlerInput, HandlerOutcome, HandlerRegistry, OperationHandler } from './ports.js';

/**
 * Demonstration handler.
 *
 * It exists to prove the contract, the idempotency guarantee and the audit trail end
 * to end. NO real PMS operation (booking, check-in, checkout, payment, housekeeping)
 * is implemented in this foundation — those arrive in later milestones, each with its
 * own handler and its own tests.
 */
export const demoNoteUpsertHandler: OperationHandler = {
  operationType: DEMO_NOTE_OPERATION_TYPE,
  collection: DEMO_NOTE_COLLECTION,
  apply({ current, request, now }: HandlerInput): HandlerOutcome {
    const payload = DemoNotePayloadSchema.safeParse(request.payload);
    if (!payload.success) {
      return {
        ok: false,
        code: 'invalid_payload',
        message: payload.error.issues
          .map((issue) => issue.path.join('.') + ': ' + issue.message)
          .join('; '),
      };
    }

    return {
      ok: true,
      data: {
        ...(current?.data ?? {}),
        text: payload.data.text,
        // Server clock, never the client's — clientCreatedAt is audit metadata only.
        updatedAt: now,
        updatedBy: request.uid,
      },
    };
  },
};

export const demoHandlers: readonly OperationHandler[] = Object.freeze([demoNoteUpsertHandler]);

/** Builds the lookup used by the processor, refusing duplicate registrations. */
export function createHandlerRegistry(handlers: readonly OperationHandler[]): HandlerRegistry {
  const registry = new Map<string, OperationHandler>();
  for (const handler of handlers) {
    if (registry.has(handler.operationType)) {
      throw new Error('duplicate handler registered for ' + handler.operationType);
    }
    registry.set(handler.operationType, handler);
  }
  return registry;
}

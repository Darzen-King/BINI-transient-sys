import { z } from 'zod';

/**
 * The operation contract is the only way a client changes authoritative data in v4.
 *
 * A client never writes a booking, stay or payment document. It writes an
 * *operation request*, and a Cloud Function — the only writer holding Admin SDK
 * credentials — validates it, applies it, and publishes an *operation result*.
 *
 * Both halves are versioned by `schemaVersion` so an outdated installed PWA is
 * rejected explicitly instead of silently corrupting data.
 */

/** Bumped whenever the request shape changes in a way old clients cannot satisfy. */
export const OPERATION_SCHEMA_VERSION = 1;

/** Every schema version the server still accepts. */
export const SUPPORTED_OPERATION_SCHEMA_VERSIONS = [1] as const;

/** Lifecycle of a single operation, from the client's point of view. */
export const OPERATION_STATUSES = ['pending', 'accepted', 'rejected', 'conflict'] as const;

export type OperationStatus = (typeof OPERATION_STATUSES)[number];

export const OperationStatusSchema = z.enum(OPERATION_STATUSES);

/** Machine-readable reason attached to a non-accepted result. */
export const OPERATION_RESULT_CODES = [
  'validation_failed',
  'unauthorized',
  'unsupported_operation',
  'invalid_payload',
  'version_conflict',
  'handler_rejected',
  'internal_error',
] as const;

export type OperationResultCode = (typeof OPERATION_RESULT_CODES)[number];

/**
 * Namespaced, lowercase operation names: `domain.entity.verb`.
 * Enforcing the shape keeps the handler registry key space predictable and stops a
 * client inventing a name that collides with an internal path.
 */
const OPERATION_TYPE_PATTERN = /^[a-z][a-z0-9]*(\.[a-z][a-z0-9]*)+$/;

const identifier = (label: string) =>
  z
    .string({
      required_error: label + ' is required',
      invalid_type_error: label + ' must be a string',
    })
    .min(1, label + ' must not be empty')
    .max(128, label + ' must be at most 128 characters');

const schemaVersionSchema = z
  .number({ invalid_type_error: 'schemaVersion must be a number' })
  .int('schemaVersion must be an integer')
  .refine(
    (value): value is (typeof SUPPORTED_OPERATION_SCHEMA_VERSIONS)[number] =>
      (SUPPORTED_OPERATION_SCHEMA_VERSIONS as readonly number[]).includes(value),
    { message: 'schemaVersion is not supported by this server' },
  );

/**
 * Exactly the fields a client may write. Firestore rules enforce the same list
 * (see firestore.rules CLIENT_FIELDS); `rules-contract.test.ts` keeps the two honest.
 */
export const OperationRequestSchema = z
  .object({
    /** Client-generated UUID. Doubles as the Firestore document id and the idempotency key. */
    operationId: z.string().uuid('operationId must be a UUID'),
    /** Identifies the installation, so a replay from another device is distinguishable. */
    deviceId: identifier('deviceId'),
    /** Must equal the authenticated uid; rules and the processor both check it. */
    uid: identifier('uid'),
    propertyId: identifier('propertyId'),
    operationType: identifier('operationType').regex(
      OPERATION_TYPE_PATTERN,
      'operationType must look like "domain.entity.verb"',
    ),
    entityId: identifier('entityId'),
    /** Optimistic-concurrency base. 0 means "the entity does not exist yet". */
    baseVersion: z
      .number({ invalid_type_error: 'baseVersion must be a number' })
      .int('baseVersion must be an integer')
      .min(0, 'baseVersion must not be negative'),
    /** Operation-specific body, validated again by the handler. */
    payload: z.record(z.string(), z.unknown()),
    schemaVersion: schemaVersionSchema,
    /** Client clock: ordering hint and audit only, never trusted for correctness. */
    clientCreatedAt: z
      .string()
      .datetime({ message: 'clientCreatedAt must be an ISO-8601 UTC timestamp' }),
  })
  .strict();

export type OperationRequest = z.infer<typeof OperationRequestSchema>;

/** Field names a client may write, derived from the schema so the two cannot drift. */
export const OPERATION_REQUEST_CLIENT_FIELDS: readonly string[] = Object.freeze(
  Object.keys(OperationRequestSchema.shape),
);

/**
 * Fields only the server may produce. A client request carrying any of these is
 * rejected outright, by the schema (`.strict()`) and by Firestore rules alike.
 */
export const OPERATION_RESULT_SERVER_FIELDS: readonly string[] = Object.freeze([
  'status',
  'appliedVersion',
  'currentVersion',
  'code',
  'message',
  'processedAt',
]);

export const OperationResultSchema = z
  .object({
    operationId: z.string().uuid(),
    /** Request owner; persisted so Firestore can enforce result ownership. */
    uid: identifier('uid'),
    status: OperationStatusSchema,
    propertyId: identifier('propertyId'),
    operationType: identifier('operationType'),
    entityId: identifier('entityId'),
    /** Version written by this operation; null unless the status is `accepted`. */
    appliedVersion: z.number().int().min(0).nullable(),
    /** Server's current version of the entity, so a conflicted client can rebase. */
    currentVersion: z.number().int().min(0).nullable(),
    code: z.string().min(1).nullable(),
    message: z.string().nullable(),
    processedAt: z.string().datetime(),
  })
  .strict();

export type OperationResult = z.infer<typeof OperationResultSchema>;

export type ParsedOperationRequest =
  | { ok: true; value: OperationRequest }
  | { ok: false; issues: string[] };

/** Non-throwing parse that flattens zod issues into log-safe strings. */
export function parseOperationRequest(input: unknown): ParsedOperationRequest {
  const parsed = OperationRequestSchema.safeParse(input);
  if (parsed.success) {
    return { ok: true, value: parsed.data };
  }
  const issues = parsed.error.issues.map((issue) => {
    const path = issue.path.join('.');
    return path ? path + ': ' + issue.message : issue.message;
  });
  return { ok: false, issues };
}

/** Names any server-only field present on an object, for defence-in-depth logging. */
export function findServerOnlyFields(input: unknown): string[] {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    return [];
  }
  const record = input as Record<string, unknown>;
  return OPERATION_RESULT_SERVER_FIELDS.filter((field) =>
    Object.prototype.hasOwnProperty.call(record, field),
  );
}

/**
 * The single demonstration operation shipped with this foundation. It exists to
 * exercise the contract end to end; no real PMS operation is implemented yet.
 */
export const DEMO_NOTE_OPERATION_TYPE = 'demo.note.upsert';

export const DEMO_NOTE_COLLECTION = 'demoNotes';

export const DemoNotePayloadSchema = z
  .object({
    text: z
      .string()
      .min(1, 'text must not be empty')
      .max(500, 'text must be at most 500 characters'),
  })
  .strict();

export type DemoNotePayload = z.infer<typeof DemoNotePayloadSchema>;

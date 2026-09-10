import { describe, expect, it } from 'vitest';

import {
  OPERATION_REQUEST_CLIENT_FIELDS,
  OPERATION_RESULT_SERVER_FIELDS,
  OPERATION_SCHEMA_VERSION,
  OPERATION_STATUSES,
  OperationRequestSchema,
  OperationResultSchema,
  SUPPORTED_OPERATION_SCHEMA_VERSIONS,
  findServerOnlyFields,
  parseOperationRequest,
} from '@bini/cloud-shared';

const validRequest = () => ({
  operationId: '8f1b0c9e-3a52-4a1d-9a4e-9d5c7b2f1a30',
  deviceId: 'device-front-desk-01',
  uid: 'user-abc',
  propertyId: 'property-main',
  operationType: 'demo.note.upsert',
  entityId: 'note-1',
  baseVersion: 0,
  payload: { text: 'hello' },
  schemaVersion: OPERATION_SCHEMA_VERSION,
  clientCreatedAt: '2026-09-09T01:02:03.000Z',
});

describe('operation request contract', () => {
  it('accepts a well-formed request', () => {
    const parsed = parseOperationRequest(validRequest());
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.value.operationId).toBe('8f1b0c9e-3a52-4a1d-9a4e-9d5c7b2f1a30');
      expect(parsed.value.baseVersion).toBe(0);
    }
  });

  it('requires every documented field', () => {
    for (const field of OPERATION_REQUEST_CLIENT_FIELDS) {
      const candidate: Record<string, unknown> = validRequest();
      delete candidate[field];
      const parsed = parseOperationRequest(candidate);
      expect(parsed.ok, `missing "${field}" must be rejected`).toBe(false);
    }
  });

  it('exposes exactly the client-writable field whitelist', () => {
    expect([...OPERATION_REQUEST_CLIENT_FIELDS].sort()).toEqual(
      [
        'baseVersion',
        'clientCreatedAt',
        'deviceId',
        'entityId',
        'operationId',
        'operationType',
        'payload',
        'propertyId',
        'schemaVersion',
        'uid',
      ].sort(),
    );
    expect(Object.keys(OperationRequestSchema.shape).sort()).toEqual(
      [...OPERATION_REQUEST_CLIENT_FIELDS].sort(),
    );
  });

  it('rejects unknown fields so clients cannot smuggle extra data', () => {
    const parsed = parseOperationRequest({ ...validRequest(), somethingElse: 1 });
    expect(parsed.ok).toBe(false);
  });

  it('rejects a client-supplied server result field', () => {
    for (const field of OPERATION_RESULT_SERVER_FIELDS) {
      const parsed = parseOperationRequest({ ...validRequest(), [field]: 'accepted' });
      expect(parsed.ok, `client-supplied "${field}" must be rejected`).toBe(false);
    }
  });

  it('flags server-only fields present on an arbitrary object', () => {
    expect(findServerOnlyFields({ ...validRequest(), status: 'accepted' })).toEqual(['status']);
    expect(findServerOnlyFields(validRequest())).toEqual([]);
  });

  it('rejects a non-integer or negative baseVersion', () => {
    expect(parseOperationRequest({ ...validRequest(), baseVersion: -1 }).ok).toBe(false);
    expect(parseOperationRequest({ ...validRequest(), baseVersion: 1.5 }).ok).toBe(false);
    expect(parseOperationRequest({ ...validRequest(), baseVersion: '0' }).ok).toBe(false);
  });

  it('rejects an unsupported schemaVersion', () => {
    const unsupported = Math.max(...SUPPORTED_OPERATION_SCHEMA_VERSIONS) + 1;
    expect(parseOperationRequest({ ...validRequest(), schemaVersion: unsupported }).ok).toBe(false);
  });

  it('rejects a malformed operationId', () => {
    expect(parseOperationRequest({ ...validRequest(), operationId: 'not-a-uuid' }).ok).toBe(false);
    expect(parseOperationRequest({ ...validRequest(), operationId: '' }).ok).toBe(false);
  });

  it('rejects a malformed clientCreatedAt', () => {
    expect(parseOperationRequest({ ...validRequest(), clientCreatedAt: '2026-09-09' }).ok).toBe(false);
    expect(parseOperationRequest({ ...validRequest(), clientCreatedAt: 'yesterday' }).ok).toBe(false);
  });

  it('requires a namespaced operationType', () => {
    expect(parseOperationRequest({ ...validRequest(), operationType: 'upsert' }).ok).toBe(false);
    expect(parseOperationRequest({ ...validRequest(), operationType: 'Demo.Note' }).ok).toBe(false);
    expect(parseOperationRequest({ ...validRequest(), operationType: 'booking.create' }).ok).toBe(true);
  });

  it('requires payload to be an object', () => {
    expect(parseOperationRequest({ ...validRequest(), payload: 'text' }).ok).toBe(false);
    expect(parseOperationRequest({ ...validRequest(), payload: [1, 2] }).ok).toBe(false);
    expect(parseOperationRequest({ ...validRequest(), payload: {} }).ok).toBe(true);
  });

  it('reports validation issues instead of throwing', () => {
    const parsed = parseOperationRequest({ nope: true });
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) {
      expect(parsed.issues.length).toBeGreaterThan(0);
      expect(typeof parsed.issues[0]).toBe('string');
    }
  });
});

describe('operation result contract', () => {
  const validResult = () => ({
    operationId: '8f1b0c9e-3a52-4a1d-9a4e-9d5c7b2f1a30',
    uid: 'user-abc',
    status: 'accepted' as const,
    propertyId: 'property-main',
    operationType: 'demo.note.upsert',
    entityId: 'note-1',
    appliedVersion: 1,
    currentVersion: 1,
    code: null,
    message: null,
    processedAt: '2026-09-09T01:02:04.000Z',
  });

  it('defines exactly the four lifecycle statuses', () => {
    expect([...OPERATION_STATUSES]).toEqual(['pending', 'accepted', 'rejected', 'conflict']);
  });

  it('accepts a well-formed result', () => {
    expect(OperationResultSchema.safeParse(validResult()).success).toBe(true);
  });

  it('requires the requester uid used by Firestore ownership checks', () => {
    const result = validResult() as Record<string, unknown>;
    delete result.uid;
    expect(OperationResultSchema.safeParse(result).success).toBe(false);
  });

  it('rejects an unknown status', () => {
    expect(OperationResultSchema.safeParse({ ...validResult(), status: 'done' }).success).toBe(false);
  });

  it('allows a pending result with no applied version', () => {
    const pending = { ...validResult(), status: 'pending' as const, appliedVersion: null, currentVersion: null };
    expect(OperationResultSchema.safeParse(pending).success).toBe(true);
  });
});

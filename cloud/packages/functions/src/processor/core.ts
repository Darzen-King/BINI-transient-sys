import { z } from 'zod';

import {
  OperationResultSchema,
  parseOperationRequest,
  type OperationRequest,
  type OperationResult,
} from '@bini/cloud-shared';

import type { AuditEntry, OperationHandler, ProcessorStore } from './ports.js';

export interface ProcessorDependencies {
  store: ProcessorStore;
  handlers: ReadonlyMap<string, OperationHandler>;
  now?: () => Date;
  authenticatedUid?: string;
  authorize?: (request: OperationRequest) => Promise<boolean>;
}

function usableOperationId(input: unknown): string | null {
  if (typeof input !== 'object' || input === null) return null;
  const value = (input as Record<string, unknown>).operationId;
  return z.string().uuid().safeParse(value).success ? (value as string) : null;
}

function fallbackField(input: unknown, field: string, fallback: string): string {
  if (typeof input !== 'object' || input === null) return fallback;
  const value = (input as Record<string, unknown>)[field];
  return typeof value === 'string' && value.length > 0 ? value : fallback;
}

function makeResult(
  request: Pick<OperationRequest, 'operationId' | 'uid' | 'propertyId' | 'operationType' | 'entityId'>,
  now: Date,
  values: Pick<OperationResult, 'status' | 'appliedVersion' | 'currentVersion' | 'code' | 'message'>,
): OperationResult {
  return OperationResultSchema.parse({
    operationId: request.operationId,
    uid: request.uid,
    propertyId: request.propertyId,
    operationType: request.operationType,
    entityId: request.entityId,
    ...values,
    processedAt: now.toISOString(),
  });
}

function makeAudit(
  request: Pick<OperationRequest, 'operationId' | 'uid' | 'deviceId' | 'propertyId' | 'operationType' | 'entityId'>,
  result: OperationResult,
  fromVersion: number,
): AuditEntry {
  return {
    operationId: request.operationId,
    uid: request.uid,
    deviceId: request.deviceId,
    propertyId: request.propertyId,
    operationType: request.operationType,
    entityId: request.entityId,
    status: result.status,
    fromVersion,
    toVersion: result.appliedVersion,
    processedAt: result.processedAt,
  };
}

export async function processOperation(input: unknown, deps: ProcessorDependencies): Promise<OperationResult> {
  const now = (deps.now ?? (() => new Date()))();
  const operationId = usableOperationId(input);
  if (operationId) {
    const existing = await deps.store.loadResult(operationId);
    if (existing) return existing;
  }

  const parsed = parseOperationRequest(input);
  if (!parsed.ok) {
    const resultRequest = {
      operationId: operationId ?? '00000000-0000-4000-8000-000000000000',
      uid: fallbackField(input, 'uid', 'invalid'),
      propertyId: fallbackField(input, 'propertyId', 'invalid'),
      operationType: fallbackField(input, 'operationType', 'invalid.request'),
      entityId: fallbackField(input, 'entityId', 'invalid'),
    };
    const result = makeResult(resultRequest, now, {
      status: 'rejected', appliedVersion: null, currentVersion: null,
      code: 'validation_failed', message: parsed.issues.join('; '),
    });
    if (operationId) {
      const auditRequest = {
        ...resultRequest,
        uid: fallbackField(input, 'uid', 'invalid'),
        deviceId: fallbackField(input, 'deviceId', 'invalid'),
      };
      return deps.store.commit({ collection: 'invalidOperations', result, audit: makeAudit(auditRequest, result, 0) });
    }
    return result;
  }

  const request = parsed.value;
  const reject = async (code: string, message: string, currentVersion: number | null = null) => {
    const result = makeResult(request, now, {
      status: 'rejected', appliedVersion: null, currentVersion, code, message,
    });
    return deps.store.commit({ collection: 'rejectedOperations', result, audit: makeAudit(request, result, currentVersion ?? 0) });
  };

  if (deps.authenticatedUid && deps.authenticatedUid !== request.uid) {
    return reject('unauthorized', 'Authenticated user does not own this operation.');
  }
  if (deps.authorize && !(await deps.authorize(request))) {
    return reject('unauthorized', 'User is inactive or is not assigned to this property.');
  }

  const handler = deps.handlers.get(request.operationType);
  if (!handler) return reject('unsupported_operation', 'No handler is registered for this operation type.');

  const current = await deps.store.loadEntity(handler.collection, request.propertyId, request.entityId);
  const currentVersion = current?.version ?? 0;
  if (request.baseVersion !== currentVersion) {
    const result = makeResult(request, now, {
      status: 'conflict', appliedVersion: null, currentVersion,
      code: 'version_conflict', message: 'The server entity changed before this operation was applied.',
    });
    return deps.store.commit({ collection: handler.collection, result, audit: makeAudit(request, result, currentVersion) });
  }

  let outcome;
  try {
    outcome = handler.apply({ request, current, now: now.toISOString() });
  } catch (error) {
    return reject('internal_error', error instanceof Error ? error.message : 'Operation handler failed.');
  }
  if (!outcome.ok) return reject(outcome.code, outcome.message, currentVersion);

  const nextVersion = currentVersion + 1;
  const result = makeResult(request, now, {
    status: 'accepted', appliedVersion: nextVersion, currentVersion: nextVersion, code: null, message: null,
  });
  return deps.store.commit({
    collection: handler.collection,
    result,
    entity: { propertyId: request.propertyId, entityId: request.entityId, version: nextVersion, data: outcome.data },
    audit: makeAudit(request, result, currentVersion),
  });
}

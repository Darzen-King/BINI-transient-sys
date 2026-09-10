import type { OperationRequest, OperationResult } from '@bini/cloud-shared';

export interface EntitySnapshot {
  propertyId: string;
  entityId: string;
  version: number;
  data: Record<string, unknown>;
}

export interface AuditEntry {
  operationId: string;
  uid: string;
  deviceId: string;
  propertyId: string;
  operationType: string;
  entityId: string;
  status: OperationResult['status'];
  fromVersion: number;
  toVersion: number | null;
  processedAt: string;
}

export interface OperationCommit {
  collection: string;
  result: OperationResult;
  entity?: EntitySnapshot;
  audit: AuditEntry;
}

export interface ProcessorStore {
  loadResult(operationId: string): Promise<OperationResult | null>;
  loadEntity(collection: string, propertyId: string, entityId: string): Promise<EntitySnapshot | null>;
  commit(commit: OperationCommit): Promise<OperationResult>;
}

export interface HandlerInput {
  request: OperationRequest;
  current: EntitySnapshot | null;
  now: string;
}

export type HandlerOutcome =
  | { ok: true; data: Record<string, unknown> }
  | { ok: false; code: string; message: string };

export interface OperationHandler {
  operationType: string;
  collection: string;
  apply(input: HandlerInput): HandlerOutcome;
}

export type HandlerRegistry = ReadonlyMap<string, OperationHandler>;

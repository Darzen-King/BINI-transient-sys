import type {
  EntitySnapshot,
  OperationCommit,
  ProcessorStore,
} from '../../src/processor/ports.js';
import type { AuditEntry } from '../../src/processor/ports.js';
import type { OperationResult } from '@bini/cloud-shared';

/**
 * In-memory stand-in for Firestore. `commit` is atomic here by construction, which
 * mirrors the transactional guarantee the Firestore-backed store must provide.
 */
export class MemoryStore implements ProcessorStore {
  readonly results = new Map<string, OperationResult>();
  readonly entities = new Map<string, EntitySnapshot>();
  readonly audit: AuditEntry[] = [];
  commitCount = 0;

  static key(collection: string, propertyId: string, entityId: string): string {
    return `${collection}/${propertyId}/${entityId}`;
  }

  async loadResult(operationId: string): Promise<OperationResult | null> {
    return this.results.get(operationId) ?? null;
  }

  async loadEntity(
    collection: string,
    propertyId: string,
    entityId: string,
  ): Promise<EntitySnapshot | null> {
    return this.entities.get(MemoryStore.key(collection, propertyId, entityId)) ?? null;
  }

  async commit(commit: OperationCommit): Promise<OperationResult> {
    const existing = this.results.get(commit.result.operationId);
    if (existing) return existing;
    this.commitCount += 1;
    this.results.set(commit.result.operationId, commit.result);
    if (commit.entity) {
      this.entities.set(
        MemoryStore.key(commit.collection, commit.entity.propertyId, commit.entity.entityId),
        commit.entity,
      );
    }
    this.audit.push(commit.audit);
    return commit.result;
  }
}

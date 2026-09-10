import type { Firestore } from 'firebase-admin/firestore';

import { OperationResultSchema, type OperationResult } from '@bini/cloud-shared';

import type { EntitySnapshot, OperationCommit, ProcessorStore } from './ports.js';

export class FirestoreProcessorStore implements ProcessorStore {
  constructor(private readonly db: Firestore) {}

  async loadResult(operationId: string): Promise<OperationResult | null> {
    const snapshot = await this.db.doc(`operationResults/${operationId}`).get();
    if (!snapshot.exists) return null;
    return OperationResultSchema.parse(snapshot.data());
  }

  async loadEntity(collection: string, propertyId: string, entityId: string): Promise<EntitySnapshot | null> {
    const snapshot = await this.db.doc(`properties/${propertyId}/${collection}/${entityId}`).get();
    if (!snapshot.exists) return null;
    const data = snapshot.data() ?? {};
    const version = typeof data.version === 'number' ? data.version : 0;
    return { propertyId, entityId, version, data };
  }

  async commit(commit: OperationCommit): Promise<OperationResult> {
    return this.db.runTransaction(async (transaction) => {
      const resultRef = this.db.doc(`operationResults/${commit.result.operationId}`);
      const existing = await transaction.get(resultRef);
      if (existing.exists) return OperationResultSchema.parse(existing.data());

      let result = commit.result;
      let audit = commit.audit;
      if (commit.entity) {
        const entityRef = this.db.doc(
          `properties/${commit.entity.propertyId}/${commit.collection}/${commit.entity.entityId}`,
        );
        const current = await transaction.get(entityRef);
        const currentVersion = current.exists && typeof current.data()?.version === 'number'
          ? (current.data()?.version as number)
          : 0;

        if (currentVersion !== commit.audit.fromVersion) {
          result = OperationResultSchema.parse({
            ...commit.result,
            status: 'conflict',
            appliedVersion: null,
            currentVersion,
            code: 'version_conflict',
            message: 'The server entity changed before this operation was committed.',
          });
          audit = { ...commit.audit, status: 'conflict', toVersion: null };
        } else {
          transaction.set(entityRef, {
            ...commit.entity.data,
            propertyId: commit.entity.propertyId,
            entityId: commit.entity.entityId,
            version: commit.entity.version,
            updatedAt: commit.result.processedAt,
          });
        }
      }

      transaction.create(resultRef, result);
      transaction.create(
        this.db.doc(`properties/${result.propertyId}/auditLogs/${result.operationId}`),
        audit,
      );
      return result;
    });
  }
}

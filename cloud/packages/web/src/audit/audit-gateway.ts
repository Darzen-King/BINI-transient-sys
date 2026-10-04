import { buildAuditList, staffDirectoryInputSchema, staffDirectoryResultSchema, type AuditListProjection, type AuditQuery, type StaffDirectoryResult } from '@bini/cloud-shared';
import { collection, onSnapshot, Timestamp, type Firestore, type Unsubscribe } from 'firebase/firestore';
import { httpsCallable, type Functions } from 'firebase/functions';

export interface AuditGateway {
  subscribe(propertyId: string, query: AuditQuery, onValue: (value: AuditListProjection) => void, onError: (error: Error) => void): Unsubscribe;
  /** Operator names for the records; clients may not read other people's user documents. */
  listStaff?(propertyId: string): Promise<StaffDirectoryResult>;
}
function normalise(data: Record<string, unknown>): Record<string, unknown> { const createdAt = data.createdAt; return { ...data, createdAt: createdAt instanceof Timestamp ? createdAt.toDate().toISOString() : createdAt }; }
export function createAuditGateway(database: Firestore, functions: Functions): AuditGateway { return {
    async listStaff(propertyId) { const call = httpsCallable<{ propertyId: string }, unknown>(functions, 'staffDirectory'); return staffDirectoryResultSchema.parse((await call(staffDirectoryInputSchema.parse({ propertyId }))).data); },
    subscribe(propertyId, query, onValue, onError) { return onSnapshot(collection(database, `properties/${propertyId}/auditLogs`), (snapshot) => { try { onValue(buildAuditList(snapshot.docs.map((document) => ({ id: document.id, data: normalise(document.data()) })), query)); } catch (error) { onError(error instanceof Error ? error : new Error('審計資料格式不正確。')); } }, onError); } }; }

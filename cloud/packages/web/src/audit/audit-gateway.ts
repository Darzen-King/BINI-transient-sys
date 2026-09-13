import { buildAuditList, type AuditListProjection, type AuditQuery } from '@bini/cloud-shared';
import { collection, onSnapshot, Timestamp, type Firestore, type Unsubscribe } from 'firebase/firestore';

export interface AuditGateway { subscribe(propertyId: string, query: AuditQuery, onValue: (value: AuditListProjection) => void, onError: (error: Error) => void): Unsubscribe; }
function normalise(data: Record<string, unknown>): Record<string, unknown> { const createdAt = data.createdAt; return { ...data, createdAt: createdAt instanceof Timestamp ? createdAt.toDate().toISOString() : createdAt }; }
export function createAuditGateway(database: Firestore): AuditGateway { return { subscribe(propertyId, query, onValue, onError) { return onSnapshot(collection(database, `properties/${propertyId}/auditLogs`), (snapshot) => { try { onValue(buildAuditList(snapshot.docs.map((document) => ({ id: document.id, data: normalise(document.data()) })), query)); } catch (error) { onError(error instanceof Error ? error : new Error('審計資料格式不正確。')); } }, onError); } }; }

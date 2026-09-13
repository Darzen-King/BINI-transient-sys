import { CLOUD_PAGE_IDS, propertyCreateInputSchema, propertyCreateResultSchema, propertyListInputSchema, sortPropertyDirectory, type PropertyCreateResult, type PropertyDirectoryItem } from '@bini/cloud-shared';
import { createHash } from 'node:crypto';
import { getFirestore } from 'firebase-admin/firestore';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { requirePropertyAdmin } from '../admin/staff-admin.js';

const options = { region: 'asia-east1', maxInstances: 10, timeoutSeconds: 60, memory: '512MiB' } as const;
const fingerprint = (input: object) => createHash('sha256').update(JSON.stringify({ operationType: 'property.create', ...input })).digest('hex');
const record = (value: unknown): Record<string, unknown> | null => typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null;
const stringOrNull = (value: unknown): string | null => typeof value === 'string' && value.trim() ? value : null;

export const propertyList = onCall(options, async (request): Promise<{ properties: PropertyDirectoryItem[] }> => {
  const parsed = propertyListInputSchema.safeParse(request.data); if (!parsed.success) throw new HttpsError('invalid-argument', '館別查詢資料格式不正確。');
  const uid = await requirePropertyAdmin(request.auth, parsed.data.sourcePropertyId); const database = getFirestore(); const user = await database.doc(`users/${uid}`).get(); const profile = user.data() ?? {}; const roles = record(profile.roles); const pages = record(profile.allowedPages); if (!roles) throw new HttpsError('permission-denied', '沒有可用館別。');
  const candidates = await Promise.all(Object.entries(roles).map(async ([propertyId, role]): Promise<PropertyDirectoryItem | null> => {
    if (!['admin', 'manager', 'front_desk', 'housekeeping', 'maintenance'].includes(String(role))) return null;
    const snapshot = await database.doc(`properties/${propertyId}`).get(); if (!snapshot.exists) return null; const data = snapshot.data() ?? {};
    if (typeof data.name !== 'string' || !data.name.trim() || typeof data.active !== 'boolean' || data.currency !== 'TWD' || data.timezone !== 'Asia/Taipei') return null;
    const allowedPages = Array.isArray(pages?.[propertyId]) ? pages[propertyId].filter((page): page is (typeof CLOUD_PAGE_IDS)[number] => typeof page === 'string' && (CLOUD_PAGE_IDS as readonly string[]).includes(page)) : [];
    return { propertyId, name: data.name, address: stringOrNull(data.address), phone: stringOrNull(data.phone), note: stringOrNull(data.note), active: data.active, currency: 'TWD', timezone: 'Asia/Taipei', role: role as PropertyDirectoryItem['role'], allowedPages };
  }));
  return { properties: sortPropertyDirectory(candidates.filter((item): item is PropertyDirectoryItem => item !== null)) };
});

export const propertyCreate = onCall(options, async (request): Promise<PropertyCreateResult> => {
  const parsed = propertyCreateInputSchema.safeParse(request.data); if (!parsed.success) throw new HttpsError('invalid-argument', '館別建立資料格式不正確。'); const input = parsed.data;
  if (input.propertyId === input.sourcePropertyId) throw new HttpsError('failed-precondition', '新館別不可與目前館別相同。');
  const actorUid = await requirePropertyAdmin(request.auth, input.sourcePropertyId); const database = getFirestore(); const root = `properties/${input.sourcePropertyId}`; const operationRef = database.doc(`${root}/propertyOperations/${input.operationId}`); const propertyRef = database.doc(`properties/${input.propertyId}`); const userRef = database.doc(`users/${actorUid}`); const requestFingerprint = fingerprint(input);
  return database.runTransaction(async (transaction) => {
    const prior = await transaction.get(operationRef); if (prior.exists) { const data = prior.data() ?? {}; if (data.actorUid !== actorUid || data.requestFingerprint !== requestFingerprint) throw new HttpsError('already-exists', '此操作識別碼已由不同請求使用。'); const result = propertyCreateResultSchema.safeParse(data.result); if (!result.success || result.data.status !== 'created') throw new HttpsError('data-loss', '已完成操作缺少有效結果。'); return { ...result.data, status: 'replayed' }; }
    const [existing, userSnapshot] = await Promise.all([transaction.get(propertyRef), transaction.get(userRef)]); if (existing.exists) throw new HttpsError('already-exists', '館別 ID 已存在。'); if (!userSnapshot.exists) throw new HttpsError('permission-denied', '目前帳號設定已不存在。');
    const profile = userSnapshot.data() ?? {}; const roles = record(profile.roles) ?? {}; const allowedPages = record(profile.allowedPages) ?? {}; const now = new Date().toISOString(); const result: PropertyCreateResult = { propertyId: input.propertyId, status: 'created', createdAt: now };
    transaction.create(propertyRef, { schemaVersion: 4, propertyId: input.propertyId, name: input.name, address: input.address ?? null, phone: input.phone ?? null, note: input.note ?? null, active: true, currency: 'TWD', timezone: 'Asia/Taipei', createdAt: now, createdByUid: actorUid });
    transaction.update(userRef, { roles: { ...roles, [input.propertyId]: 'admin' }, allowedPages: { ...allowedPages, [input.propertyId]: [...CLOUD_PAGE_IDS] }, updatedAt: now });
    transaction.create(operationRef, { operationId: input.operationId, actorUid, operationType: 'property.create', requestFingerprint, result, createdAt: now });
    transaction.create(database.doc(`${root}/auditLogs/property-create-${input.operationId}`), { actorUid, action: 'property.create', targetId: input.propertyId, targetType: 'property', details: { name: input.name, address: input.address ?? null, phone: input.phone ?? null, note: input.note ?? null, creatorGrantedAdmin: true }, createdAt: now });
    return result;
  });
});

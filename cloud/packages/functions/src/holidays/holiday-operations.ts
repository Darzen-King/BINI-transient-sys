import {
  holidayDeleteInputSchema,
  holidayManualUpsertInputSchema,
  holidayOperationResultSchema,
  holidayResyncInputSchema,
  type HolidayOperationResult,
} from '@bini/cloud-shared';
import { createHash } from 'node:crypto';
import { getFirestore } from 'firebase-admin/firestore';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { requirePropertyPage } from '../admin/staff-admin.js';

const options = { region: 'asia-east1', maxInstances: 10, timeoutSeconds: 60, memory: '512MiB' } as const;
type HolidaySource = 'api' | 'fallback';
interface HolidaySeed { date: string; description: string; }

// Same curated fallback as v3. A failed remote response must never erase existing
// non-manual data when no source can provide a replacement for the selected year.
const FALLBACK_HOLIDAYS: Readonly<Record<number, readonly HolidaySeed[]>> = {
  2025: [
    { date: '2025-01-01', description: '中華民國開國紀念日' }, { date: '2025-01-27', description: '農曆除夕' }, { date: '2025-01-28', description: '春節' }, { date: '2025-01-29', description: '春節' }, { date: '2025-01-30', description: '春節' }, { date: '2025-01-31', description: '春節補假' }, { date: '2025-02-03', description: '春節補假' }, { date: '2025-02-28', description: '和平紀念日' }, { date: '2025-04-03', description: '兒童節補假' }, { date: '2025-04-04', description: '清明節' }, { date: '2025-05-01', description: '勞動節' }, { date: '2025-06-02', description: '端午節' }, { date: '2025-09-03', description: '中秋節補假' }, { date: '2025-10-06', description: '國慶日補假' }, { date: '2025-10-10', description: '國慶日' },
  ],
  2026: [
    { date: '2026-01-01', description: '中華民國開國紀念日' }, { date: '2026-02-15', description: '小年夜' }, { date: '2026-02-17', description: '春節' }, { date: '2026-02-18', description: '春節' }, { date: '2026-02-19', description: '春節' }, { date: '2026-02-27', description: '和平紀念日補假' }, { date: '2026-04-03', description: '兒童節補假' }, { date: '2026-04-04', description: '清明節' }, { date: '2026-05-01', description: '勞動節' }, { date: '2026-06-19', description: '端午節' }, { date: '2026-09-25', description: '中秋節' }, { date: '2026-09-28', description: '孔子誕辰紀念日' }, { date: '2026-10-09', description: '國慶日補假' }, { date: '2026-10-26', description: '台灣光復節補假' }, { date: '2026-12-25', description: '行憲紀念日' },
  ],
};

const operationHash = (operationType: string, input: object) => createHash('sha256').update(JSON.stringify({ operationType, ...input })).digest('hex');
const validDate = (value: string, year: number) => /^\d{4}-\d{2}-\d{2}$/.test(value) && value.slice(0, 4) === String(year) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));

async function requireHolidayManager(auth: Parameters<typeof requirePropertyPage>[0], propertyId: string): Promise<string> {
  const uid = await requirePropertyPage(auth, propertyId, 'holidays');
  const roles = (await getFirestore().doc(`users/${uid}`).get()).data()?.roles;
  const role = roles && typeof roles === 'object' && !Array.isArray(roles) ? (roles as Record<string, unknown>)[propertyId] : null;
  if (role !== 'manager' && role !== 'admin') throw new HttpsError('permission-denied', '只有管理員或經理可管理假日。');
  return uid;
}

function replay(data: Record<string, unknown>, actorUid: string, fingerprint: string): HolidayOperationResult {
  if (data.actorUid !== actorUid || data.requestFingerprint !== fingerprint) throw new HttpsError('already-exists', '此操作識別碼已由不同請求使用。');
  const parsed = holidayOperationResultSchema.safeParse(data.result);
  if (!parsed.success) throw new HttpsError('data-loss', '已完成操作缺少有效結果。');
  return { ...parsed.data, status: 'replayed' };
}

async function fetchGovernmentHolidays(year: number): Promise<HolidaySeed[] | null> {
  const sources = [
    'https://data.ntpc.gov.tw/api/datasets/308DCD75-6119-4125-8843-468D965688FB/json?page=0&size=500',
    `https://cdn.jsdelivr.net/gh/ruyut/TaiwanCalendar/data/${year}.json`,
  ];
  for (const url of sources) {
    try {
      const response = await fetch(url, { headers: { 'User-Agent': 'BINI-Blooms-PMS/4.0' }, signal: AbortSignal.timeout(8_000) });
      if (!response.ok) continue;
      const payload: unknown = await response.json();
      const rows = Array.isArray(payload) ? payload : (typeof payload === 'object' && payload !== null && Array.isArray((payload as { records?: unknown }).records) ? (payload as { records: unknown[] }).records : []);
      const selected = rows.flatMap((raw): HolidaySeed[] => {
        if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return [];
        const row = raw as Record<string, unknown>;
        let date = String(row.date ?? row['西元日期'] ?? '');
        if (/^\d{8}$/.test(date)) date = `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6)}`;
        const marker = String(row.isHoliday ?? row['是否放假'] ?? '');
        if (!validDate(date, year) || !['2', 'true', 'True', '1', '假日'].includes(marker)) return [];
        return [{ date, description: String(row.name ?? row.description ?? row['備註'] ?? '假日').trim() || '假日' }];
      });
      const unique = [...new Map(selected.map((item) => [item.date, item])).values()];
      if (unique.length > 0 && unique.length <= 366) return unique;
    } catch {
      // Try the next authoritative source, then the exact v3 fallback table.
    }
  }
  return null;
}

/** Government data first, then the v3 offline table; `null` when neither covers the year. */
export async function loadHolidaySource(year: number): Promise<{ source: HolidaySource; items: readonly HolidaySeed[] } | null> {
  const api = await fetchGovernmentHolidays(year);
  if (api) return { source: 'api', items: api };
  const fallback = FALLBACK_HOLIDAYS[year];
  return fallback ? { source: 'fallback', items: fallback } : null;
}

async function holidaySource(year: number): Promise<{ source: HolidaySource; items: readonly HolidaySeed[] }> {
  const incoming = await loadHolidaySource(year);
  if (!incoming) throw new HttpsError('unavailable', '政府假日資料暫時無法取得，且此年份沒有離線備援；既有資料未變更。');
  return incoming;
}

export const holidayManualUpsert = onCall(options, async (request): Promise<HolidayOperationResult> => {
  const parsed = holidayManualUpsertInputSchema.safeParse(request.data);
  if (!parsed.success) throw new HttpsError('invalid-argument', '手動假日資料格式不正確。');
  const input = parsed.data;
  const year = Number(input.date.slice(0, 4));
  if (!validDate(input.date, year)) throw new HttpsError('invalid-argument', '假日日期不正確。');
  const actorUid = await requireHolidayManager(request.auth, input.propertyId); const description = input.description || '手動新增';
  const db = getFirestore(); const root = `properties/${input.propertyId}`; const operationRef = db.doc(`${root}/holidayOperations/${input.operationId}`); const holidayRef = db.doc(`${root}/holidays/${input.date}`); const fingerprint = operationHash('holiday.manual.upsert', input);
  return db.runTransaction(async (transaction) => {
    const previous = await transaction.get(operationRef); if (previous.exists) return replay(previous.data() ?? {}, actorUid, fingerprint);
    const current = await transaction.get(holidayRef); const currentData = current.data() ?? {}; const now = new Date().toISOString(); const output: HolidayOperationResult = { status: current.exists ? 'updated' : 'created', date: input.date, year, source: 'manual', updatedAt: now };
    transaction.set(holidayRef, { schemaVersion: 4, version: (typeof currentData.version === 'number' && Number.isInteger(currentData.version) ? currentData.version : 0) + 1, propertyId: input.propertyId, date: input.date, year, holiday: true, manual: true, source: 'manual', description, createdAt: current.exists ? currentData.createdAt ?? now : now, updatedAt: now, updatedByUid: actorUid }, { merge: true });
    transaction.create(operationRef, { actorUid, operationType: 'holiday.manual.upsert', requestFingerprint: fingerprint, result: output, createdAt: now });
    transaction.create(db.doc(`${root}/auditLogs/holiday-manual-upsert-${input.operationId}`), { actorUid, action: 'holiday.manual.upsert', targetId: input.date, targetType: 'holiday', details: { before: current.exists ? currentData : null, after: { date: input.date, year, description, holiday: true, manual: true, source: 'manual' } }, createdAt: now });
    return output;
  });
});

export const holidayDelete = onCall(options, async (request): Promise<HolidayOperationResult> => {
  const parsed = holidayDeleteInputSchema.safeParse(request.data);
  if (!parsed.success) throw new HttpsError('invalid-argument', '刪除假日資料格式不正確。');
  const input = parsed.data; const actorUid = await requireHolidayManager(request.auth, input.propertyId); const db = getFirestore(); const root = `properties/${input.propertyId}`; const operationRef = db.doc(`${root}/holidayOperations/${input.operationId}`); const holidayRef = db.doc(`${root}/holidays/${input.date}`); const fingerprint = operationHash('holiday.delete', input);
  return db.runTransaction(async (transaction) => {
    const previous = await transaction.get(operationRef); if (previous.exists) return replay(previous.data() ?? {}, actorUid, fingerprint);
    const current = await transaction.get(holidayRef); if (!current.exists || current.data()?.propertyId !== input.propertyId) throw new HttpsError('not-found', '找不到要刪除的假日。');
    const now = new Date().toISOString(); const output: HolidayOperationResult = { status: 'deleted', date: input.date, year: Number(input.date.slice(0, 4)), updatedAt: now };
    transaction.delete(holidayRef); transaction.create(operationRef, { actorUid, operationType: 'holiday.delete', requestFingerprint: fingerprint, result: output, createdAt: now }); transaction.create(db.doc(`${root}/auditLogs/holiday-delete-${input.operationId}`), { actorUid, action: 'holiday.delete', targetId: input.date, targetType: 'holiday', details: { before: current.data() ?? null }, createdAt: now });
    return output;
  });
});

export const holidayResync = onCall(options, async (request): Promise<HolidayOperationResult> => {
  const parsed = holidayResyncInputSchema.safeParse(request.data);
  if (!parsed.success) throw new HttpsError('invalid-argument', '假日同步資料格式不正確。');
  const input = parsed.data; const actorUid = await requireHolidayManager(request.auth, input.propertyId); const db = getFirestore(); const root = `properties/${input.propertyId}`; const operationRef = db.doc(`${root}/holidayOperations/${input.operationId}`); const fingerprint = operationHash('holiday.resync', input);
  const first = await operationRef.get(); if (first.exists) return replay(first.data() ?? {}, actorUid, fingerprint);
  const incoming = await holidaySource(input.year);
  return db.runTransaction(async (transaction) => {
    const previous = await transaction.get(operationRef); if (previous.exists) return replay(previous.data() ?? {}, actorUid, fingerprint);
    const holidaysSnapshot = await transaction.get(db.collection(`${root}/holidays`)); const existing = holidaysSnapshot.docs.filter((document) => document.data().year === input.year); const manualDates = new Set(existing.filter((document) => document.data().manual === true).map((document) => document.id));
    if (existing.length + incoming.items.length + 3 > 450) throw new HttpsError('resource-exhausted', '此年度假日資料過多，請聯絡系統管理員處理。');
    for (const document of existing) if (document.data().manual !== true) transaction.delete(document.ref);
    const now = new Date().toISOString(); let syncedCount = 0;
    for (const item of incoming.items) {
      if (manualDates.has(item.date)) continue;
      transaction.set(db.doc(`${root}/holidays/${item.date}`), { schemaVersion: 4, version: 1, propertyId: input.propertyId, date: item.date, year: input.year, holiday: true, manual: false, source: incoming.source, description: item.description, createdAt: now, updatedAt: now, updatedByUid: actorUid }); syncedCount += 1;
    }
    const output: HolidayOperationResult = { status: 'synced', year: input.year, source: incoming.source, syncedCount, updatedAt: now };
    transaction.create(db.doc(`${root}/holidaySyncRuns/${input.operationId}`), { operationId: input.operationId, actorUid, propertyId: input.propertyId, year: input.year, source: incoming.source, syncedCount, manualRetained: manualDates.size, createdAt: now }); transaction.create(operationRef, { actorUid, operationType: 'holiday.resync', requestFingerprint: fingerprint, result: output, createdAt: now }); transaction.create(db.doc(`${root}/auditLogs/holiday-resync-${input.operationId}`), { actorUid, action: 'holiday.resync', targetId: String(input.year), targetType: 'holidayCalendar', details: { year: input.year, source: incoming.source, syncedCount, manualRetained: manualDates.size }, createdAt: now });
    return output;
  });
});

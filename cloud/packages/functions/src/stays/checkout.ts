import { quoteStayCheckoutOverdue, stayCheckoutInputSchema, stayCheckoutResultSchema, type BookingHolidayCalendar, type StayCheckoutInput, type StayCheckoutResult } from '@bini/cloud-shared';
import { createHash } from 'node:crypto';
import { getFirestore, type QueryDocumentSnapshot } from 'firebase-admin/firestore';
import { HttpsError, onCall } from 'firebase-functions/v2/https';

import { requirePropertyPage } from '../admin/staff-admin.js';

const options = { region: 'asia-east1', maxInstances: 10, timeoutSeconds: 60, memory: '512MiB' } as const;
type RecordData = Record<string, unknown>;
const text = (data: RecordData, key: string, label: string): string => { const value = data[key]; if (typeof value !== 'string' || !value.trim()) throw new HttpsError('data-loss', `${label} 缺少有效 ${key}。`); return value; };
const amount = (data: RecordData, key: string, label: string): number => { const value = data[key]; if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw new HttpsError('data-loss', `${label} 缺少有效 ${key}。`); return value; };
const version = (data: RecordData, label: string): number => { const value = data.version; if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw new HttpsError('data-loss', `${label} 缺少有效 version。`); return value; };

function holidays(documents: readonly QueryDocumentSnapshot[]): BookingHolidayCalendar {
  const days = new Map<string, boolean>(); const countByYear = new Map<number, number>();
  for (const document of documents) { const data = document.data(); if (typeof data.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(data.date) || typeof data.holiday !== 'boolean' || !Number.isSafeInteger(data.year) || String(data.year) !== data.date.slice(0, 4) || days.has(data.date)) throw new HttpsError('data-loss', `holidays/${document.id} 資料格式不正確。`); days.set(data.date, data.holiday); countByYear.set(data.year, (countByYear.get(data.year) ?? 0) + 1); }
  return { days, coveredYears: new Set([...countByYear].filter(([, count]) => count > 3).map(([year]) => year)) };
}
function fingerprint(input: StayCheckoutInput): string { return createHash('sha256').update(JSON.stringify({ operationType: 'stay.checkout', ...input })).digest('hex'); }
function replay(data: RecordData, actorUid: string, requestFingerprint: string): StayCheckoutResult { if (data.actorUid !== actorUid || data.operationType !== 'stay.checkout' || data.requestFingerprint !== requestFingerprint) throw new HttpsError('already-exists', '此操作識別碼已由不同請求使用。'); const parsed = stayCheckoutResultSchema.safeParse(data.result); if (!parsed.success || parsed.data.status !== 'checked_out') throw new HttpsError('data-loss', '已完成操作缺少有效結果。'); return { ...parsed.data, status: 'replayed' }; }

/** Atomically completes one active stay; client writes never decide fees, refunds or room status. */
export const stayCheckout = onCall(options, async (request): Promise<StayCheckoutResult> => {
  const parsed = stayCheckoutInputSchema.safeParse(request.data); if (!parsed.success) throw new HttpsError('invalid-argument', '退房資料格式不正確。');
  const input = parsed.data; const actorUid = await requirePropertyPage(request.auth, input.propertyId, 'checkout'); const database = getFirestore(); const root = `properties/${input.propertyId}`; const operationRef = database.doc(`${root}/stayOperations/${input.operationId}`); const stayRef = database.doc(`${root}/stays/${input.stayId}`); const requestFingerprint = fingerprint(input);
  return database.runTransaction(async (transaction) => {
    const previous = await transaction.get(operationRef); if (previous.exists) return replay(previous.data() ?? {}, actorUid, requestFingerprint);
    const staySnapshot = await transaction.get(stayRef); if (!staySnapshot.exists) throw new HttpsError('not-found', '找不到在住房紀錄。'); const stay = staySnapshot.data() ?? {}; const stayLabel = `stays/${input.stayId}`;
    if (text(stay, 'propertyId', stayLabel) !== input.propertyId) throw new HttpsError('data-loss', '在住房館別不一致。'); const roomId = text(stay, 'roomId', stayLabel); const roomRef = database.doc(`${root}/rooms/${roomId}`);
    const [roomSnapshot, paymentSnapshot, holidaySnapshot] = await Promise.all([transaction.get(roomRef), transaction.get(database.collection(`${root}/payments`).where('roomId', '==', roomId)), transaction.get(database.collection(`${root}/holidays`))]);
    if (!roomSnapshot.exists) throw new HttpsError('not-found', '找不到對應房間。'); const room = roomSnapshot.data() ?? {}; const roomLabel = `rooms/${roomId}`; if (text(room, 'roomId', roomLabel) !== roomId || !['使用中', '即將退房'].includes(text(room, 'status', roomLabel))) throw new HttpsError('failed-precondition', '房間目前不可辦理退房。');
    const checkInAt = text(stay, 'checkInAt', stayLabel); const checkOutAt = text(stay, 'checkOutAt', stayLabel); const now = new Date().toISOString(); const minutesSinceCheckIn = Date.parse(now) - Date.parse(checkInAt); const freeCancel = minutesSinceCheckIn >= 0 && minutesSinceCheckIn <= 15 * 60 * 1_000;
    const existingExtensionFee = amount(stay, 'extensionFeeNts', stayLabel); let systemOverdueFeeNts = 0; let appliedOverdueFeeNts = 0; let extensionFeeNts = existingExtensionFee;
    if (!freeCancel) { const quote = quoteStayCheckoutOverdue(checkInAt, checkOutAt, existingExtensionFee, now, holidays(holidaySnapshot.docs)); systemOverdueFeeNts = quote.systemOverdueFeeNts; appliedOverdueFeeNts = input.overdueFeeOverrideNts ?? systemOverdueFeeNts; extensionFeeNts += appliedOverdueFeeNts; }
    const baseRentNts = amount(stay, 'baseRentNts', stayLabel); const totalChargedNts = freeCancel ? 0 : baseRentNts + extensionFeeNts + input.extraFeeNts; const bookingId = typeof stay.bookingId === 'string' ? stay.bookingId : null;
    const refundable = freeCancel ? paymentSnapshot.docs.filter((document) => { const payment = document.data(); return payment.status !== 'voided' && payment.deposit === true && payment.refund === false && typeof payment.amountNts === 'number' && ((bookingId !== null && payment.bookingId === bookingId) || (typeof payment.createdAt === 'string' && Date.parse(payment.createdAt) >= Date.parse(checkInAt))); }) : []; const refundedDepositNts = refundable.reduce((sum, document) => sum + Number(document.data().amountNts), 0);
    const result: StayCheckoutResult = { status: 'checked_out', stayId: input.stayId, roomId, checkedOutAt: now, totalChargedNts, extensionFeeNts: freeCancel ? 0 : extensionFeeNts, systemOverdueFeeNts, appliedOverdueFeeNts, freeCancel, refundedDepositNts };
    transaction.update(roomRef, { status: '待清潔', guestName: null, checkInAt: null, checkOutAt: null, version: version(room, roomLabel) + 1, updatedByUid: actorUid, updatedAt: now });
    transaction.create(database.doc(`${root}/stayLogs/STL-${input.operationId.replaceAll('-', '').slice(-12).toUpperCase()}`), { schemaVersion: 4, version: 1, propertyId: input.propertyId, stayId: input.stayId, roomId, guestName: text(stay, 'guestName', stayLabel), plan: stay.plan ?? null, checkInAt, checkOutAt: now, baseRentNts, extensionFeeNts: result.extensionFeeNts, extraFeeNts: input.extraFeeNts, totalChargedNts, freeCancel, transferred: false, newRoomId: null, createdAt: now, createdByUid: actorUid });
    refundable.forEach((document, index) => { const payment = document.data(); transaction.create(database.doc(`${root}/payments/PAY-RFD-${input.operationId.replaceAll('-', '').slice(-10).toUpperCase()}-${index + 1}`), { schemaVersion: 4, version: 1, propertyId: input.propertyId, stayId: input.stayId, bookingId, roomId, guestName: text(stay, 'guestName', stayLabel), paymentType: payment.paymentType ?? 'other', amountNts: payment.amountNts, deposit: true, refund: true, status: 'paid', note: '免費取消退回押金', createdByUid: 'system', createdAt: now }); });
    transaction.delete(stayRef); transaction.create(operationRef, { operationId: input.operationId, actorUid, requestFingerprint, operationType: 'stay.checkout', result, createdAt: now }); transaction.create(database.doc(`${root}/auditLogs/stay-checkout-${input.operationId}`), { actorUid, action: freeCancel ? 'stay.free_cancel' : 'stay.checkout', targetId: input.stayId, targetType: 'stay', details: { operationId: input.operationId, roomId, totalChargedNts, systemOverdueFeeNts, appliedOverdueFeeNts, refundedDepositNts }, createdAt: now });
    return result;
  });
});

import { monthlyRentalCheckoutInputSchema, monthlyRentalCreateInputSchema, monthlyRentalOperationResultSchema, monthlyRentalRenewInputSchema, monthlyRentalVoidInputSchema, type MonthlyRentalCheckoutInput, type MonthlyRentalCreateInput, type MonthlyRentalOperationResult, type MonthlyRentalRenewInput, type MonthlyRentalVoidInput, type MonthlyRentalVoidResult } from '@bini/cloud-shared';
import { createHash } from 'node:crypto';
import { getFirestore, type QueryDocumentSnapshot } from 'firebase-admin/firestore';
import { HttpsError, onCall } from 'firebase-functions/v2/https';

import { requirePropertyAdmin, requirePropertyPage } from '../admin/staff-admin.js';

const options = { region: 'asia-east1', maxInstances: 10, timeoutSeconds: 60, memory: '512MiB' } as const;
type MonthlyInput = MonthlyRentalCreateInput | MonthlyRentalRenewInput | MonthlyRentalCheckoutInput | MonthlyRentalVoidInput;
type RecordData = Record<string, unknown>;
const operation = (kind: string, input: MonthlyInput) => createHash('sha256').update(JSON.stringify({ operationType: kind, ...input })).digest('hex');
const version = (data: RecordData, label: string): number => { const value = data.version; if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw new HttpsError('data-loss', `${label} 缺少有效 version。`); return value; };
const text = (data: RecordData, key: string, label: string): string => { const value = data[key]; if (typeof value !== 'string' || !value.trim()) throw new HttpsError('data-loss', `${label} 缺少有效 ${key}。`); return value; };
const amount = (data: RecordData, key: string, label: string): number => { const value = data[key]; if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw new HttpsError('data-loss', `${label} 缺少有效 ${key}。`); return value; };
const dateTime = (day: string) => `${day}T00:00:00+08:00`;
function addMonth(day: string): string { const parts = day.split('-').map(Number); const year = parts[0] ?? Number.NaN; const month = parts[1] ?? Number.NaN; const date = parts[2] ?? Number.NaN; if (!Number.isSafeInteger(year) || !Number.isSafeInteger(month) || !Number.isSafeInteger(date)) throw new HttpsError('data-loss', '月租日期資料不正確。'); const nextMonth = month === 12 ? 1 : month + 1; const nextYear = month === 12 ? year + 1 : year; const lastDay = new Date(Date.UTC(nextYear, nextMonth, 0)).getUTCDate(); return `${nextYear}-${String(nextMonth).padStart(2, '0')}-${String(Math.min(date, lastDay)).padStart(2, '0')}`; }
function activeRental(documents: readonly QueryDocumentSnapshot[], roomId: string): QueryDocumentSnapshot { const active = documents.filter((document) => { const data = document.data(); return data.roomId === roomId && data.status === 'active'; }); if (active.length !== 1) throw new HttpsError(active.length === 0 ? 'failed-precondition' : 'data-loss', active.length === 0 ? '找不到進行中的月租。' : '房間有多筆進行中的月租。'); return active[0]!; }
function replay(data: RecordData, actorUid: string, fingerprint: string): MonthlyRentalOperationResult { if (data.actorUid !== actorUid || data.requestFingerprint !== fingerprint) throw new HttpsError('already-exists', '此操作識別碼已由不同請求使用。'); const parsed = monthlyRentalOperationResultSchema.safeParse(data.result); if (!parsed.success || parsed.data.status === 'replayed') throw new HttpsError('data-loss', '已完成操作缺少有效結果。'); return { ...parsed.data, status: 'replayed' }; }
function paymentDocument(propertyId: string, roomId: string, guestName: string, paymentType: string, amountNts: number, deposit: boolean, refund: boolean, note: string, actorUid: string, now: string): RecordData { return { schemaVersion: 4, version: 1, propertyId, bookingId: null, stayId: null, roomId, guestName, paymentType, amountNts, deposit, refund, status: 'paid', note, createdByUid: actorUid, createdAt: now }; }

export const monthlyRentalCreate = onCall(options, async (request): Promise<MonthlyRentalOperationResult> => {
  const parsed = monthlyRentalCreateInputSchema.safeParse(request.data); if (!parsed.success) throw new HttpsError('invalid-argument', '月租建立資料格式不正確。'); const input = parsed.data; const actorUid = await requirePropertyPage(request.auth, input.propertyId, 'room_management'); const database = getFirestore(); const root = `properties/${input.propertyId}`; const operationRef = database.doc(`${root}/monthlyRentalOperations/${input.operationId}`); const roomRef = database.doc(`${root}/rooms/${input.roomId}`); const requestFingerprint = operation('monthly.rental.create', input);
  return database.runTransaction(async (transaction) => {
    const previous = await transaction.get(operationRef); if (previous.exists) return replay(previous.data() ?? {}, actorUid, requestFingerprint);
    const [roomSnapshot, rentalsSnapshot, staysSnapshot, bookingsSnapshot] = await Promise.all([transaction.get(roomRef), transaction.get(database.collection(`${root}/monthlyRentals`).where('roomId', '==', input.roomId)), transaction.get(database.collection(`${root}/stays`).where('roomId', '==', input.roomId)), transaction.get(database.collection(`${root}/bookings`).where('roomId', '==', input.roomId))]);
    if (!roomSnapshot.exists) throw new HttpsError('not-found', '找不到房間。'); const room = roomSnapshot.data() ?? {}; if (room.propertyId !== input.propertyId || room.roomId !== input.roomId || room.status !== '可入住') throw new HttpsError('failed-precondition', '只有可入住且未使用的房間可以設定月租。');
    if (rentalsSnapshot.docs.some((document) => document.data().status === 'active') || !staysSnapshot.empty) throw new HttpsError('failed-precondition', '房間已有在住房或進行中的月租，無法建立月租。');
    const startAt = Date.parse(dateTime(input.startDate)); const bookingConflict = bookingsSnapshot.docs.some((document) => { const data = document.data(); return data.status === '已預約' && typeof data.checkInAt === 'string' && Date.parse(data.checkInAt) >= startAt; }); if (bookingConflict) throw new HttpsError('failed-precondition', '房間已有未來有效預約，請先處理預約後再設定月租。');
    const now = new Date().toISOString(); const endDate = addMonth(input.startDate); const rentalId = `MR-${input.operationId.replaceAll('-', '').slice(-12).toUpperCase()}`; const paymentId = input.rentNts > 0 ? `PAY-MON-${input.operationId.replaceAll('-', '').slice(-12).toUpperCase()}` : null;
    const result: MonthlyRentalOperationResult = { status: 'created', roomId: input.roomId, rentalId, previousRentalId: null, startDate: input.startDate, endDate, paymentId, updatedAt: now };
    transaction.create(database.doc(`${root}/monthlyRentals/${rentalId}`), { schemaVersion: 4, version: 1, propertyId: input.propertyId, rentalId, roomId: input.roomId, tenantName: input.tenantName, tenantPhone: input.tenantPhone, startDate: input.startDate, endDate, depositNts: input.depositNts, rentNts: input.rentNts, status: 'active', depositRefundedNts: 0, paymentType: input.paymentType, note: input.note, createdAt: now, createdByUid: actorUid });
    transaction.update(roomRef, { status: '月租套房', guestName: input.tenantName, checkInAt: dateTime(input.startDate), checkOutAt: dateTime(endDate), version: version(room, `rooms/${input.roomId}`) + 1, updatedAt: now, updatedByUid: actorUid });
    if (input.depositNts > 0) transaction.create(database.doc(`${root}/payments/PAY-DEP-${input.operationId.replaceAll('-', '').slice(-12).toUpperCase()}`), paymentDocument(input.propertyId, input.roomId, input.tenantName, input.paymentType, input.depositNts, true, false, '月租押金', actorUid, now));
    if (paymentId) transaction.create(database.doc(`${root}/payments/${paymentId}`), paymentDocument(input.propertyId, input.roomId, input.tenantName, input.paymentType, input.rentNts, false, false, '月租租金', actorUid, now));
    transaction.create(operationRef, { operationId: input.operationId, actorUid, operationType: 'monthly.rental.create', requestFingerprint, result, createdAt: now }); transaction.create(database.doc(`${root}/auditLogs/monthly-rental-create-${input.operationId}`), { actorUid, action: 'monthly.rental.create', targetId: rentalId, targetType: 'monthlyRental', details: { operationId: input.operationId, roomId: input.roomId, depositNts: input.depositNts, rentNts: input.rentNts }, createdAt: now }); return result;
  });
});

export const monthlyRentalRenew = onCall(options, async (request): Promise<MonthlyRentalOperationResult> => {
  const parsed = monthlyRentalRenewInputSchema.safeParse(request.data); if (!parsed.success) throw new HttpsError('invalid-argument', '月租續租資料格式不正確。'); const input = parsed.data; const actorUid = await requirePropertyPage(request.auth, input.propertyId, 'room_management'); const database = getFirestore(); const root = `properties/${input.propertyId}`; const operationRef = database.doc(`${root}/monthlyRentalOperations/${input.operationId}`); const roomRef = database.doc(`${root}/rooms/${input.roomId}`); const requestFingerprint = operation('monthly.rental.renew', input);
  return database.runTransaction(async (transaction) => {
    const previous = await transaction.get(operationRef); if (previous.exists) return replay(previous.data() ?? {}, actorUid, requestFingerprint); const [roomSnapshot, rentalsSnapshot] = await Promise.all([transaction.get(roomRef), transaction.get(database.collection(`${root}/monthlyRentals`).where('roomId', '==', input.roomId))]); if (!roomSnapshot.exists) throw new HttpsError('not-found', '找不到房間。'); const room = roomSnapshot.data() ?? {}; if (room.propertyId !== input.propertyId || room.roomId !== input.roomId || room.status !== '月租套房') throw new HttpsError('failed-precondition', '房間目前不是可續租的月租房。'); const previousRental = activeRental(rentalsSnapshot.docs, input.roomId); const rental = previousRental.data() ?? {}; const label = `monthlyRentals/${previousRental.id}`; const startDate = text(rental, 'endDate', label); if (startDate !== input.expectedEndDate) throw new HttpsError('failed-precondition', `此月租已續租過（目前租期到 ${startDate}），未重複續租。`); const endDate = addMonth(startDate); const tenantName = text(rental, 'tenantName', label); const rentNts = amount(rental, 'rentNts', label); const depositNts = amount(rental, 'depositNts', label); const now = new Date().toISOString(); const rentalId = `MR-${input.operationId.replaceAll('-', '').slice(-12).toUpperCase()}`; const paymentId = rentNts > 0 ? `PAY-MON-${input.operationId.replaceAll('-', '').slice(-12).toUpperCase()}` : null; const result: MonthlyRentalOperationResult = { status: 'renewed', roomId: input.roomId, rentalId, previousRentalId: previousRental.id, startDate, endDate, paymentId, updatedAt: now };
    transaction.update(previousRental.ref, { status: 'renewed', endedAt: now, version: version(rental, label) + 1, updatedAt: now, updatedByUid: actorUid }); transaction.create(database.doc(`${root}/monthlyRentals/${rentalId}`), { schemaVersion: 4, version: 1, propertyId: input.propertyId, rentalId, roomId: input.roomId, tenantName, tenantPhone: typeof rental.tenantPhone === 'string' ? rental.tenantPhone : null, startDate, endDate, depositNts, rentNts, status: 'active', depositRefundedNts: 0, paymentType: input.paymentType, note: `續租（前期 ${rental.startDate} ~ ${rental.endDate}）`, createdAt: now, endedAt: null, createdByUid: actorUid }); transaction.update(roomRef, { guestName: tenantName, checkInAt: dateTime(startDate), checkOutAt: dateTime(endDate), version: version(room, `rooms/${input.roomId}`) + 1, updatedAt: now, updatedByUid: actorUid }); if (paymentId) transaction.create(database.doc(`${root}/payments/${paymentId}`), paymentDocument(input.propertyId, input.roomId, tenantName, input.paymentType, rentNts, false, false, '月租續租租金', actorUid, now)); transaction.create(operationRef, { operationId: input.operationId, actorUid, operationType: 'monthly.rental.renew', requestFingerprint, result, createdAt: now }); transaction.create(database.doc(`${root}/auditLogs/monthly-rental-renew-${input.operationId}`), { actorUid, action: 'monthly.rental.renew', targetId: rentalId, targetType: 'monthlyRental', details: { operationId: input.operationId, roomId: input.roomId, previousRentalId: previousRental.id, rentNts }, createdAt: now }); return result;
  });
});

export const monthlyRentalCheckout = onCall(options, async (request): Promise<MonthlyRentalOperationResult> => {
  const parsed = monthlyRentalCheckoutInputSchema.safeParse(request.data); if (!parsed.success) throw new HttpsError('invalid-argument', '月租退租資料格式不正確。'); const input = parsed.data; const actorUid = await requirePropertyPage(request.auth, input.propertyId, 'room_management'); const database = getFirestore(); const root = `properties/${input.propertyId}`; const operationRef = database.doc(`${root}/monthlyRentalOperations/${input.operationId}`); const roomRef = database.doc(`${root}/rooms/${input.roomId}`); const requestFingerprint = operation('monthly.rental.checkout', input);
  return database.runTransaction(async (transaction) => {
    const previous = await transaction.get(operationRef); if (previous.exists) return replay(previous.data() ?? {}, actorUid, requestFingerprint); const [roomSnapshot, rentalsSnapshot] = await Promise.all([transaction.get(roomRef), transaction.get(database.collection(`${root}/monthlyRentals`).where('roomId', '==', input.roomId))]); if (!roomSnapshot.exists) throw new HttpsError('not-found', '找不到房間。'); const room = roomSnapshot.data() ?? {}; if (room.propertyId !== input.propertyId || room.roomId !== input.roomId || room.status !== '月租套房') throw new HttpsError('failed-precondition', '房間目前不是可退租的月租房。'); const rentalDocument = activeRental(rentalsSnapshot.docs, input.roomId); const rental = rentalDocument.data() ?? {}; const label = `monthlyRentals/${rentalDocument.id}`; const depositNts = amount(rental, 'depositNts', label); if (input.depositRefundedNts > depositNts) throw new HttpsError('failed-precondition', '退還押金不可超過已收押金。'); const now = new Date().toISOString(); const paymentId = input.depositRefundedNts > 0 ? `PAY-RFD-${input.operationId.replaceAll('-', '').slice(-12).toUpperCase()}` : null; const result: MonthlyRentalOperationResult = { status: 'checked_out', roomId: input.roomId, rentalId: rentalDocument.id, previousRentalId: null, startDate: text(rental, 'startDate', label), endDate: text(rental, 'endDate', label), paymentId, updatedAt: now };
    transaction.update(rentalDocument.ref, { status: 'ended', depositRefundedNts: input.depositRefundedNts, endedAt: now, note: input.note ? `${typeof rental.note === 'string' && rental.note ? `${rental.note} | ` : ''}${input.note}` : (typeof rental.note === 'string' ? rental.note : null), version: version(rental, label) + 1, updatedAt: now, updatedByUid: actorUid }); transaction.update(roomRef, { status: '待清潔', guestName: null, checkInAt: null, checkOutAt: null, version: version(room, `rooms/${input.roomId}`) + 1, updatedAt: now, updatedByUid: actorUid }); if (paymentId) transaction.create(database.doc(`${root}/payments/${paymentId}`), paymentDocument(input.propertyId, input.roomId, text(rental, 'tenantName', label), input.paymentType, input.depositRefundedNts, true, true, '月租押金退還', actorUid, now)); transaction.create(operationRef, { operationId: input.operationId, actorUid, operationType: 'monthly.rental.checkout', requestFingerprint, result, createdAt: now }); transaction.create(database.doc(`${root}/auditLogs/monthly-rental-checkout-${input.operationId}`), { actorUid, action: 'monthly.rental.checkout', targetId: rentalDocument.id, targetType: 'monthlyRental', details: { operationId: input.operationId, roomId: input.roomId, depositRefundedNts: input.depositRefundedNts }, createdAt: now }); return result;
  });
});


/**
 * Marks one historical rental record as void so it stops counting as revenue. Duplicates from a
 * double-tapped renewal were money never taken; the record is kept and audited, never deleted.
 * Admins only, and never the rental in force — that one ends through monthly checkout.
 */
export const monthlyRentalVoid = onCall(options, async (request): Promise<MonthlyRentalVoidResult> => {
  const parsed = monthlyRentalVoidInputSchema.safeParse(request.data);
  if (!parsed.success) throw new HttpsError('invalid-argument', '作廢月租紀錄的資料格式不正確。');
  const input = parsed.data;
  const actorUid = await requirePropertyAdmin(request.auth, input.propertyId);
  const database = getFirestore();
  const root = `properties/${input.propertyId}`;
  const operationRef = database.doc(`${root}/monthlyRentalOperations/${input.operationId}`);
  const rentalRef = database.doc(`${root}/monthlyRentals/${input.rentalId}`);
  const requestFingerprint = operation('monthly.rental.void', input);
  return database.runTransaction(async (transaction) => {
    const previous = await transaction.get(operationRef);
    if (previous.exists) {
      const stored = previous.data() ?? {};
      if (stored.requestFingerprint !== requestFingerprint) throw new HttpsError('failed-precondition', '同一個操作代碼已用於不同的作廢請求。');
      return { ...(stored.result as MonthlyRentalVoidResult), status: 'replayed' };
    }
    const snapshot = await transaction.get(rentalRef);
    if (!snapshot.exists) throw new HttpsError('not-found', '找不到這筆月租紀錄。');
    const rental = snapshot.data() ?? {};
    const label = `monthlyRentals/${input.rentalId}`;
    if (rental.propertyId !== input.propertyId) throw new HttpsError('not-found', '找不到這筆月租紀錄。');
    const roomId = text(rental, 'roomId', label);
    const rentNts = amount(rental, 'rentNts', label);
    const now = new Date().toISOString();
    if (rental.status === 'voided') return { status: 'already_voided', rentalId: input.rentalId, roomId, rentNts, updatedAt: typeof rental.updatedAt === 'string' ? rental.updatedAt : now };
    if (rental.status === 'active') throw new HttpsError('failed-precondition', '目前生效中的月租不可作廢，請改用「月租退房」。');
    const result: MonthlyRentalVoidResult = { status: 'voided', rentalId: input.rentalId, roomId, rentNts, updatedAt: now };
    transaction.update(rentalRef, { status: 'voided', voidReason: input.reason, voidedAt: now, voidedByUid: actorUid, version: version(rental, label) + 1, updatedAt: now, updatedByUid: actorUid });
    transaction.create(operationRef, { operationId: input.operationId, actorUid, operationType: 'monthly.rental.void', requestFingerprint, result, createdAt: now });
    transaction.create(database.doc(`${root}/auditLogs/monthly-rental-void-${input.operationId}`), { actorUid, action: 'monthly.rental.void', targetId: input.rentalId, targetType: 'monthlyRental', details: { operationId: input.operationId, roomId, rentNts, reason: input.reason, previousStatus: typeof rental.status === 'string' ? rental.status : null }, createdAt: now });
    return result;
  });
});

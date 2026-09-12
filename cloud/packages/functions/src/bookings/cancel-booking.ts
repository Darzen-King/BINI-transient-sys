import {
  BOOKING_STATUSES,
  bookingCancelInputSchema,
  bookingCancelResultSchema,
  type BookingCancelInput,
  type BookingCancelResult,
} from '@bini/cloud-shared';
import { createHash } from 'node:crypto';
import { getFirestore } from 'firebase-admin/firestore';
import { HttpsError, onCall } from 'firebase-functions/v2/https';

import { requirePropertyPage } from '../admin/staff-admin.js';

const callableOptions = {
  region: 'asia-east1',
  maxInstances: 10,
  timeoutSeconds: 60,
  memory: '512MiB',
} as const;

type FirestoreRecord = Record<string, unknown>;

function requiredText(data: FirestoreRecord, field: string, label: string): string {
  const value = data[field];
  if (typeof value !== 'string' || value.trim() === '') {
    throw new HttpsError('data-loss', `${label} 缺少有效 ${field}。`);
  }
  return value;
}

function requiredVersion(data: FirestoreRecord, label: string): number {
  const value = data.version;
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new HttpsError('data-loss', `${label} 缺少有效 version。`);
  }
  return value;
}

function fingerprint(input: BookingCancelInput): string {
  return createHash('sha256').update(JSON.stringify({
    operationType: 'booking.cancel',
    propertyId: input.propertyId,
    bookingId: input.bookingId,
    operationId: input.operationId,
  })).digest('hex');
}

function replayResult(operation: FirestoreRecord, actorUid: string, requestFingerprint: string): BookingCancelResult {
  if (
    operation.actorUid !== actorUid
    || operation.operationType !== 'booking.cancel'
    || operation.requestFingerprint !== requestFingerprint
  ) {
    throw new HttpsError('already-exists', '此操作識別碼已由不同請求使用。');
  }
  const parsed = bookingCancelResultSchema.safeParse(operation.result);
  if (!parsed.success || parsed.data.status !== 'cancelled') {
    throw new HttpsError('data-loss', '已完成操作缺少有效結果。');
  }
  return { ...parsed.data, status: 'replayed' };
}

/** v3 cancellation semantics: only an active reservation changes to 已取消. */
export const bookingCancel = onCall(callableOptions, async (request): Promise<BookingCancelResult> => {
  const parsed = bookingCancelInputSchema.safeParse(request.data);
  if (!parsed.success) throw new HttpsError('invalid-argument', '取消預約資料格式不正確。');
  const input = parsed.data;
  const actorUid = await requirePropertyPage(request.auth, input.propertyId, 'bookings');
  const database = getFirestore();
  const propertyPath = `properties/${input.propertyId}`;
  const operationRef = database.doc(`${propertyPath}/bookingOperations/${input.operationId}`);
  const bookingRef = database.doc(`${propertyPath}/bookings/${input.bookingId}`);
  const requestFingerprint = fingerprint(input);

  return database.runTransaction(async (transaction) => {
    const priorOperation = await transaction.get(operationRef);
    if (priorOperation.exists) return replayResult(priorOperation.data() ?? {}, actorUid, requestFingerprint);

    const bookingSnapshot = await transaction.get(bookingRef);
    if (!bookingSnapshot.exists) throw new HttpsError('not-found', '找不到指定預約。');
    const booking = bookingSnapshot.data() ?? {};
    const label = `bookings/${input.bookingId}`;
    if (requiredText(booking, 'propertyId', label) !== input.propertyId) {
      throw new HttpsError('data-loss', `${label} 的館別識別碼不一致。`);
    }
    if (requiredText(booking, 'bookingId', label) !== input.bookingId) {
      throw new HttpsError('data-loss', `${label} 的預約識別碼不一致。`);
    }
    const currentStatus = requiredText(booking, 'status', label);
    if (!BOOKING_STATUSES.includes(currentStatus as (typeof BOOKING_STATUSES)[number])) {
      throw new HttpsError('data-loss', `${label} 的 status 不受支援。`);
    }
    if (currentStatus !== '已預約') {
      throw new HttpsError('failed-precondition', '此預約已處理，無法再次取消。');
    }
    const occurredAt = new Date().toISOString();
    const result: BookingCancelResult = {
      status: 'cancelled',
      bookingId: input.bookingId,
      cancelledAt: occurredAt,
    };
    transaction.update(bookingRef, {
      status: '已取消',
      version: requiredVersion(booking, label) + 1,
      cancellationReason: 'manual',
      cancelledAt: occurredAt,
      cancelledByUid: actorUid,
      updatedAt: occurredAt,
    });
    transaction.create(operationRef, {
      operationId: input.operationId,
      actorUid,
      requestFingerprint,
      operationType: 'booking.cancel',
      result,
      createdAt: occurredAt,
    });
    transaction.create(database.doc(`${propertyPath}/auditLogs/booking-cancel-${input.operationId}`), {
      actorUid,
      action: 'booking.cancel',
      targetId: input.bookingId,
      targetType: 'booking',
      details: { operationId: input.operationId, previousStatus: currentStatus },
      createdAt: occurredAt,
    });
    return result;
  });
});

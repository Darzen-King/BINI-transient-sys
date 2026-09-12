import {
  paymentManualCreateInputSchema,
  paymentManualCreateResultSchema,
  type PaymentManualCreateInput,
  type PaymentManualCreateResult,
} from "@bini/cloud-shared";
import { createHash } from "node:crypto";
import { getFirestore } from "firebase-admin/firestore";
import { HttpsError, onCall } from "firebase-functions/v2/https";

import { requirePropertyPage } from "../admin/staff-admin.js";

const options = {
  region: "asia-east1",
  maxInstances: 10,
  timeoutSeconds: 60,
  memory: "512MiB",
} as const;
type Data = Record<string, unknown>;
const text = (data: Data, key: string, label: string): string => {
  const value = data[key];
  if (typeof value !== "string" || !value.trim())
    throw new HttpsError("data-loss", `${label} 缺少有效 ${key}。`);
  return value;
};
const fingerprint = (input: PaymentManualCreateInput) =>
  createHash("sha256")
    .update(
      JSON.stringify({ operationType: "payment.manual-create", ...input }),
    )
    .digest("hex");

/** Records a staff-entered exception payment without weakening the active-stay receipt flow. */
export const paymentManualCreate = onCall(
  options,
  async (request): Promise<PaymentManualCreateResult> => {
    const parsed = paymentManualCreateInputSchema.safeParse(request.data);
    if (!parsed.success)
      throw new HttpsError("invalid-argument", "手動付款資料格式不正確。");
    const input = parsed.data;
    const actorUid = await requirePropertyPage(
      request.auth,
      input.propertyId,
      "payments",
    );
    const db = getFirestore();
    const root = `properties/${input.propertyId}`;
    const operationRef = db.doc(
      `${root}/paymentOperations/${input.operationId}`,
    );
    const requestFingerprint = fingerprint(input);
    return db.runTransaction(async (transaction) => {
      const previous = await transaction.get(operationRef);
      if (previous.exists) {
        const data = previous.data() ?? {};
        if (
          data.actorUid !== actorUid ||
          data.operationType !== "payment.manual-create" ||
          data.requestFingerprint !== requestFingerprint
        )
          throw new HttpsError(
            "already-exists",
            "此操作識別碼已由不同請求使用。",
          );
        const replay = paymentManualCreateResultSchema.safeParse(data.result);
        if (!replay.success || replay.data.status !== "created")
          throw new HttpsError("data-loss", "已完成操作缺少有效結果。");
        return { ...replay.data, status: "replayed" };
      }
      const bookingRef = input.bookingId
        ? db.doc(`${root}/bookings/${input.bookingId}`)
        : null;
      const roomRef = input.roomId
        ? db.doc(`${root}/rooms/${input.roomId}`)
        : null;
      const [bookingSnapshot, roomSnapshot] = await Promise.all([
        bookingRef ? transaction.get(bookingRef) : Promise.resolve(null),
        roomRef ? transaction.get(roomRef) : Promise.resolve(null),
      ]);
      let roomId = input.roomId ?? null;
      if (roomSnapshot) {
        if (!roomSnapshot.exists)
          throw new HttpsError("not-found", "找不到手動付款指定的房間。");
        const room = roomSnapshot.data() ?? {};
        const label = `rooms/${input.roomId}`;
        if (
          text(room, "propertyId", label) !== input.propertyId ||
          text(room, "roomId", label) !== input.roomId
        )
          throw new HttpsError("data-loss", "手動付款房間資料不一致。");
      }
      if (bookingSnapshot) {
        if (!bookingSnapshot.exists)
          throw new HttpsError("not-found", "找不到手動付款關聯的預約。");
        const booking = bookingSnapshot.data() ?? {};
        const label = `bookings/${input.bookingId}`;
        const bookingRoomId = text(booking, "roomId", label);
        if (text(booking, "propertyId", label) !== input.propertyId)
          throw new HttpsError("data-loss", "手動付款預約館別不一致。");
        if (roomId && roomId !== bookingRoomId)
          throw new HttpsError(
            "failed-precondition",
            "手動付款的預約與房間不一致。",
          );
        roomId = bookingRoomId;
      }
      const now = new Date().toISOString();
      const paymentId = `PAY-MAN-${input.operationId.replaceAll("-", "").slice(-12).toUpperCase()}`;
      const result: PaymentManualCreateResult = {
        status: "created",
        paymentId,
        bookingId: input.bookingId ?? null,
        roomId,
        amountNts: input.amountNts,
        createdAt: now,
      };
      transaction.create(db.doc(`${root}/payments/${paymentId}`), {
        schemaVersion: 4,
        version: 1,
        propertyId: input.propertyId,
        bookingId: input.bookingId ?? null,
        stayId: null,
        roomId,
        guestName: input.guestName,
        paymentType: input.paymentType,
        amountNts: input.amountNts,
        deposit: input.deposit,
        refund: false,
        status: "paid",
        note: input.note,
        source: "manual",
        createdByUid: actorUid,
        createdAt: now,
      });
      transaction.create(operationRef, {
        operationId: input.operationId,
        actorUid,
        operationType: "payment.manual-create",
        requestFingerprint,
        result,
        createdAt: now,
      });
      transaction.create(
        db.doc(`${root}/auditLogs/payment-manual-create-${input.operationId}`),
        {
          actorUid,
          action: "payment.manual-create",
          targetId: paymentId,
          targetType: "payment",
          details: {
            operationId: input.operationId,
            bookingId: input.bookingId ?? null,
            roomId,
            guestName: input.guestName,
            amountNts: input.amountNts,
            paymentType: input.paymentType,
            deposit: input.deposit,
          },
          createdAt: now,
        },
      );
      return result;
    });
  },
);

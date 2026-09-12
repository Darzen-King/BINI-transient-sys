import {
  paymentRefundInputSchema,
  paymentRefundResultSchema,
  type PaymentRefundResult,
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
const text = (d: Data, k: string) => {
  const v = d[k];
  if (typeof v !== "string" || !v)
    throw new HttpsError("data-loss", `付款缺少 ${k}。`);
  return v;
};
const int = (d: Data, k: string) => {
  const v = d[k];
  if (typeof v !== "number" || !Number.isSafeInteger(v) || v < 0)
    throw new HttpsError("data-loss", `付款缺少有效 ${k}。`);
  return v;
};
export const paymentRefund = onCall(
  options,
  async (request): Promise<PaymentRefundResult> => {
    const parsed = paymentRefundInputSchema.safeParse(request.data);
    if (!parsed.success)
      throw new HttpsError("invalid-argument", "退款資料格式不正確。");
    const input = parsed.data;
    const actorUid = await requirePropertyPage(
      request.auth,
      input.propertyId,
      "payments",
    );
    const db = getFirestore();
    const root = `properties/${input.propertyId}`;
    const op = db.doc(`${root}/paymentOperations/${input.operationId}`);
    const fingerprint = createHash("sha256")
      .update(JSON.stringify({ operationType: "payment.refund", ...input }))
      .digest("hex");
    return db.runTransaction(async (tx) => {
      const prior = await tx.get(op);
      if (prior.exists) {
        const d = prior.data() ?? {};
        if (d.actorUid !== actorUid || d.requestFingerprint !== fingerprint)
          throw new HttpsError("already-exists", "此操作識別碼已被使用。");
        const replay = paymentRefundResultSchema.safeParse(d.result);
        if (!replay.success || replay.data.status !== "refunded")
          throw new HttpsError("data-loss", "退款重送結果無效。");
        return { ...replay.data, status: "replayed" };
      }
      const sourceRef = db.doc(`${root}/payments/${input.paymentId}`);
      const refunds = db
        .collection(`${root}/payments`)
        .where("refundOfPaymentId", "==", input.paymentId);
      const [sourceSnap, refundSnaps] = await Promise.all([
        tx.get(sourceRef),
        tx.get(refunds),
      ]);
      if (!sourceSnap.exists)
        throw new HttpsError("not-found", "找不到原付款。");
      const source = sourceSnap.data() ?? {};
      if (
        text(source, "propertyId") !== input.propertyId ||
        source.refund === true ||
        source.status !== "paid"
      )
        throw new HttpsError("failed-precondition", "此付款不可退款。");
      const received = int(source, "amountNts");
      const refunded = refundSnaps.docs.reduce(
        (sum, doc) =>
          sum + (doc.data().refund === true ? int(doc.data(), "amountNts") : 0),
        0,
      );
      if (input.amountNts > received - refunded)
        throw new HttpsError("failed-precondition", "退款金額超過尚可退金額。");
      const now = new Date().toISOString();
      const refundPaymentId = `PAY-RFD-${input.operationId.replaceAll("-", "").slice(-12).toUpperCase()}`;
      const result: PaymentRefundResult = {
        status: "refunded",
        paymentId: input.paymentId,
        refundPaymentId,
        amountNts: input.amountNts,
        createdAt: now,
      };
      tx.create(db.doc(`${root}/payments/${refundPaymentId}`), {
        schemaVersion: 4,
        version: 1,
        propertyId: input.propertyId,
        bookingId: source.bookingId ?? null,
        stayId: source.stayId ?? null,
        roomId: source.roomId ?? null,
        guestName: source.guestName ?? null,
        paymentType: input.paymentType,
        amountNts: input.amountNts,
        deposit: source.deposit === true,
        refund: true,
        refundOfPaymentId: input.paymentId,
        status: "paid",
        note: input.note,
        createdByUid: actorUid,
        createdAt: now,
      });
      tx.create(op, {
        operationId: input.operationId,
        actorUid,
        operationType: "payment.refund",
        requestFingerprint: fingerprint,
        result,
        createdAt: now,
      });
      tx.create(
        db.doc(`${root}/auditLogs/payment-refund-${input.operationId}`),
        {
          actorUid,
          action: "payment.refund",
          targetId: refundPaymentId,
          targetType: "payment",
          details: {
            operationId: input.operationId,
            paymentId: input.paymentId,
            amountNts: input.amountNts,
          },
          createdAt: now,
        },
      );
      return result;
    });
  },
);

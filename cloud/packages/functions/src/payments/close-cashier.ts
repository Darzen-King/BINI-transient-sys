import {
  cashierCloseInputSchema,
  cashierCloseResultSchema,
  type CashierCloseResult,
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
const taipeiDay = () =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
const fingerprint = (input: object) =>
  createHash("sha256")
    .update(JSON.stringify({ operationType: "cashier.close", ...input }))
    .digest("hex");
const integerAmount = (value: unknown) => {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0)
    throw new HttpsError("data-loss", "付款紀錄金額無效。");
  return value;
};

/** Manager-only daily close, derived from immutable Taipei-day payment records. */
export const cashierClose = onCall(
  options,
  async (request): Promise<CashierCloseResult> => {
    const parsed = cashierCloseInputSchema.safeParse(request.data);
    if (!parsed.success)
      throw new HttpsError("invalid-argument", "日結資料格式不正確。");
    const input = parsed.data;
    const actorUid = await requirePropertyPage(
      request.auth,
      input.propertyId,
      "payments",
    );
    const db = getFirestore();
    const roles = (await db.doc(`users/${actorUid}`).get()).data()?.roles;
    const role =
      roles && typeof roles === "object" && !Array.isArray(roles)
        ? (roles as Record<string, unknown>)[input.propertyId]
        : null;
    if (role !== "admin" && role !== "manager")
      throw new HttpsError("permission-denied", "只有管理員或經理可執行日結。");
    const sessionDate = taipeiDay();
    const startAt = new Date(`${sessionDate}T00:00:00+08:00`).toISOString();
    const endAt = new Date(
      Date.parse(startAt) + 24 * 60 * 60 * 1_000,
    ).toISOString();
    const root = `properties/${input.propertyId}`;
    const operationRef = db.doc(
      `${root}/cashierOperations/${input.operationId}`,
    );
    const sessionRef = db.doc(`${root}/cashierSessions/${sessionDate}`);
    const paymentQuery = db
      .collection(`${root}/payments`)
      .where("createdAt", ">=", startAt)
      .where("createdAt", "<", endAt);
    const requestFingerprint = fingerprint(input);
    return db.runTransaction(async (transaction) => {
      const previous = await transaction.get(operationRef);
      if (previous.exists) {
        const data = previous.data() ?? {};
        if (
          data.actorUid !== actorUid ||
          data.requestFingerprint !== requestFingerprint
        )
          throw new HttpsError(
            "already-exists",
            "此操作識別碼已由不同請求使用。",
          );
        const replay = cashierCloseResultSchema.safeParse(data.result);
        if (!replay.success || replay.data.status !== "closed")
          throw new HttpsError("data-loss", "日結重送結果無效。");
        return { ...replay.data, status: "replayed" };
      }
      const [session, payments] = await Promise.all([
        transaction.get(sessionRef),
        transaction.get(paymentQuery),
      ]);
      if (session.exists && session.data()?.status === "closed")
        throw new HttpsError(
          "failed-precondition",
          "今日已完成日結，不能重複關閉。",
        );
      const totals = {
        cash: 0,
        transfer: 0,
        card: 0,
        other: 0,
        refunds: 0,
        deposits: 0,
      };
      for (const snapshot of payments.docs) {
        const payment = snapshot.data() ?? {};
        const amount = integerAmount(payment.amountNts);
        if (payment.refund === true) {
          totals.refunds += amount;
          continue;
        }
        if (payment.deposit === true) totals.deposits += amount;
        const type = payment.paymentType;
        if (type === "cash") totals.cash += amount;
        else if (type === "transfer") totals.transfer += amount;
        else if (type === "card") totals.card += amount;
        else if (type === "other") totals.other += amount;
        else throw new HttpsError("data-loss", "付款方式無效。");
      }
      const totalExpectedNts =
        totals.cash + totals.transfer + totals.card + totals.other;
      const closedAt = new Date().toISOString();
      const result: CashierCloseResult = {
        status: "closed",
        sessionDate,
        sessionId: sessionDate,
        transactionCount: payments.size,
        totalExpectedNts,
        totalRefundsNts: totals.refunds,
        netNts: totalExpectedNts - totals.refunds,
        closedAt,
      };
      transaction.set(sessionRef, {
        schemaVersion: 4,
        version: session.exists
          ? ((session.data()?.version as number | undefined) ?? 0) + 1
          : 1,
        propertyId: input.propertyId,
        sessionDate,
        status: "closed",
        openedAt: session.data()?.openedAt ?? closedAt,
        openedByUid: session.data()?.openedByUid ?? actorUid,
        closedAt,
        closedByUid: actorUid,
        totalExpectedNts,
        totalCashNts: totals.cash,
        totalTransferNts: totals.transfer,
        totalCardNts: totals.card,
        totalOtherNts: totals.other,
        totalRefundsNts: totals.refunds,
        totalDepositsNts: totals.deposits,
        note: input.note ?? null,
      });
      transaction.create(operationRef, {
        operationId: input.operationId,
        actorUid,
        operationType: "cashier.close",
        requestFingerprint,
        result,
        createdAt: closedAt,
      });
      transaction.create(
        db.doc(`${root}/auditLogs/cashier-close-${input.operationId}`),
        {
          actorUid,
          action: "cashier.close",
          targetId: sessionDate,
          targetType: "cashierSession",
          details: { ...result, note: input.note ?? null },
          createdAt: closedAt,
        },
      );
      return result;
    });
  },
);

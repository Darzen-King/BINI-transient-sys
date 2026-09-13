import {
  costArchiveInputSchema,
  costCreateInputSchema,
  costOperationResultSchema,
  costUpdateInputSchema,
  type CostOperationResult,
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
const hash = (type: string, input: object) =>
  createHash("sha256")
    .update(JSON.stringify({ operationType: type, ...input }))
    .digest("hex");
async function requireAdmin(
  request: Parameters<typeof requirePropertyPage>[0],
  propertyId: string,
) {
  const uid = await requirePropertyPage(request, propertyId, "costs");
  const roles = (await getFirestore().doc(`users/${uid}`).get()).data()?.roles;
  if (
    !roles ||
    typeof roles !== "object" ||
    Array.isArray(roles) ||
    (roles as Record<string, unknown>)[propertyId] !== "admin"
  )
    throw new HttpsError("permission-denied", "只有管理員可管理成本紀錄。");
  return uid;
}
function result(data: Record<string, unknown>) {
  const parsed = costOperationResultSchema.safeParse(data);
  if (!parsed.success)
    throw new HttpsError("data-loss", "成本操作重送結果無效。");
  return parsed.data;
}
function fields(input: Record<string, unknown>) {
  return {
    costDate: input.costDate,
    category: input.category,
    subcategory: input.subcategory ?? null,
    amountNts: input.amountNts,
    paymentMethod: input.paymentMethod,
    vendor: input.vendor ?? null,
    description: input.description ?? null,
    note: input.note ?? null,
    recurring: input.recurring,
    receiptNo: input.receiptNo ?? null,
  };
}
export const costCreate = onCall(
  options,
  async (request): Promise<CostOperationResult> => {
    const parsed = costCreateInputSchema.safeParse(request.data);
    if (!parsed.success)
      throw new HttpsError("invalid-argument", "成本資料格式不正確。");
    const input = parsed.data;
    const actorUid = await requireAdmin(request.auth, input.propertyId);
    const db = getFirestore();
    const root = `properties/${input.propertyId}`;
    const op = db.doc(`${root}/costOperations/${input.operationId}`);
    const fingerprint = hash("cost.create", input);
    return db.runTransaction(async (tx) => {
      const old = await tx.get(op);
      if (old.exists) {
        const d = old.data() ?? {};
        if (d.actorUid !== actorUid || d.requestFingerprint !== fingerprint)
          throw new HttpsError(
            "already-exists",
            "此操作識別碼已由不同請求使用。",
          );
        return { ...result(d.result ?? {}), status: "replayed" };
      }
      const costId = `CST-${input.operationId.replaceAll("-", "").slice(-12).toUpperCase()}`;
      const now = new Date().toISOString();
      const output: CostOperationResult = {
        status: "created",
        costId,
        version: 1,
        updatedAt: now,
      };
      tx.create(db.doc(`${root}/costEntries/${costId}`), {
        schemaVersion: 4,
        version: 1,
        propertyId: input.propertyId,
        ...fields(input),
        status: "active",
        createdAt: now,
        updatedAt: now,
        createdByUid: actorUid,
        updatedByUid: actorUid,
      });
      tx.create(op, {
        operationId: input.operationId,
        actorUid,
        operationType: "cost.create",
        requestFingerprint: fingerprint,
        result: output,
        createdAt: now,
      });
      tx.create(db.doc(`${root}/auditLogs/cost-create-${input.operationId}`), {
        actorUid,
        action: "cost.create",
        targetId: costId,
        targetType: "cost",
        details: fields(input),
        createdAt: now,
      });
      return output;
    });
  },
);
export const costUpdate = onCall(
  options,
  async (request): Promise<CostOperationResult> => {
    const parsed = costUpdateInputSchema.safeParse(request.data);
    if (!parsed.success)
      throw new HttpsError("invalid-argument", "成本資料格式不正確。");
    const input = parsed.data;
    const actorUid = await requireAdmin(request.auth, input.propertyId);
    const db = getFirestore();
    const root = `properties/${input.propertyId}`;
    const op = db.doc(`${root}/costOperations/${input.operationId}`);
    const entry = db.doc(`${root}/costEntries/${input.costId}`);
    const fingerprint = hash("cost.update", input);
    return db.runTransaction(async (tx) => {
      const old = await tx.get(op);
      if (old.exists) {
        const d = old.data() ?? {};
        if (d.actorUid !== actorUid || d.requestFingerprint !== fingerprint)
          throw new HttpsError(
            "already-exists",
            "此操作識別碼已由不同請求使用。",
          );
        return { ...result(d.result ?? {}), status: "replayed" };
      }
      const current = await tx.get(entry);
      if (
        !current.exists ||
        current.data()?.propertyId !== input.propertyId ||
        current.data()?.status !== "active"
      )
        throw new HttpsError("not-found", "找不到可修改的成本紀錄。");
      if (current.data()?.version !== input.baseVersion)
        throw new HttpsError(
          "aborted",
          "成本紀錄已被其他裝置更新，請重新整理。",
        );
      const now = new Date().toISOString();
      const output: CostOperationResult = {
        status: "updated",
        costId: input.costId,
        version: input.baseVersion + 1,
        updatedAt: now,
      };
      tx.update(entry, {
        ...fields(input),
        version: output.version,
        updatedAt: now,
        updatedByUid: actorUid,
      });
      tx.create(op, {
        operationId: input.operationId,
        actorUid,
        operationType: "cost.update",
        requestFingerprint: fingerprint,
        result: output,
        createdAt: now,
      });
      tx.create(db.doc(`${root}/auditLogs/cost-update-${input.operationId}`), {
        actorUid,
        action: "cost.update",
        targetId: input.costId,
        targetType: "cost",
        details: { before: fields(current.data() ?? {}), after: fields(input) },
        createdAt: now,
      });
      return output;
    });
  },
);
export const costArchive = onCall(
  options,
  async (request): Promise<CostOperationResult> => {
    const parsed = costArchiveInputSchema.safeParse(request.data);
    if (!parsed.success)
      throw new HttpsError("invalid-argument", "成本封存資料格式不正確。");
    const input = parsed.data;
    const actorUid = await requireAdmin(request.auth, input.propertyId);
    const db = getFirestore();
    const root = `properties/${input.propertyId}`;
    const op = db.doc(`${root}/costOperations/${input.operationId}`);
    const entry = db.doc(`${root}/costEntries/${input.costId}`);
    const fingerprint = hash("cost.archive", input);
    return db.runTransaction(async (tx) => {
      const old = await tx.get(op);
      if (old.exists) {
        const d = old.data() ?? {};
        if (d.actorUid !== actorUid || d.requestFingerprint !== fingerprint)
          throw new HttpsError(
            "already-exists",
            "此操作識別碼已由不同請求使用。",
          );
        return { ...result(d.result ?? {}), status: "replayed" };
      }
      const current = await tx.get(entry);
      if (
        !current.exists ||
        current.data()?.propertyId !== input.propertyId ||
        current.data()?.status !== "active"
      )
        throw new HttpsError("not-found", "找不到可封存的成本紀錄。");
      if (current.data()?.version !== input.baseVersion)
        throw new HttpsError(
          "aborted",
          "成本紀錄已被其他裝置更新，請重新整理。",
        );
      const now = new Date().toISOString();
      const output: CostOperationResult = {
        status: "archived",
        costId: input.costId,
        version: input.baseVersion + 1,
        updatedAt: now,
      };
      tx.update(entry, {
        status: "archived",
        archiveReason: input.reason,
        archivedAt: now,
        archivedByUid: actorUid,
        version: output.version,
        updatedAt: now,
        updatedByUid: actorUid,
      });
      tx.create(op, {
        operationId: input.operationId,
        actorUid,
        operationType: "cost.archive",
        requestFingerprint: fingerprint,
        result: output,
        createdAt: now,
      });
      tx.create(db.doc(`${root}/auditLogs/cost-archive-${input.operationId}`), {
        actorUid,
        action: "cost.archive",
        targetId: input.costId,
        targetType: "cost",
        details: { reason: input.reason },
        createdAt: now,
      });
      return output;
    });
  },
);

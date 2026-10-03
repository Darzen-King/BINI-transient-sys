import {
  accountingCostFeedSchema,
  accountingCostRefreshInputSchema,
  accountingCostRefreshResultSchema,
  type AccountingCostFeed,
  type AccountingCostRefreshResult,
} from "@bini/cloud-shared";
import { getFirestore, type Firestore } from "firebase-admin/firestore";
import { logger } from "firebase-functions/v2";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { onSchedule } from "firebase-functions/v2/scheduler";

import {
  planAccountingCostSync,
  type ExistingAccountingCost,
} from "./accounting-cost-plan.js";
import { requireCostAdmin } from "./cost-operations.js";

/** The accounting app's read-only cost list for each environment (DEV reads DEV, PROD reads PROD). */
export const ACCOUNTING_FEED_URLS: Readonly<Record<string, string>> = {
  "bini-transient":
    "https://us-central1-bini-blooms.cloudfunctions.net/finPmsCostFeed",
  "bini-transient-dev":
    "https://us-central1-bini-blooms-dev.cloudfunctions.net/finPmsCostFeed",
};
const PROPERTY_ID = "property-main";
const BATCH = 400;

/** An identity token for the service account this function runs as, issued by the metadata server (no keys, no extra dependency). */
export async function metadataIdToken(
  audience: string,
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  const response = await fetchImpl(
    `http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/identity?audience=${encodeURIComponent(audience)}`,
    {
      headers: { "Metadata-Flavor": "Google" },
      signal: AbortSignal.timeout(10_000),
    },
  );
  if (!response.ok) throw new Error(`identity token HTTP ${response.status}`);
  return (await response.text()).trim();
}

export async function fetchAccountingFeed(
  url: string,
  deps: { getToken?: typeof metadataIdToken; fetchImpl?: typeof fetch } = {},
): Promise<AccountingCostFeed> {
  const token = await (deps.getToken ?? metadataIdToken)(url);
  const response = await (deps.fetchImpl ?? fetch)(url, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`accounting feed HTTP ${response.status}`);
  return accountingCostFeedSchema.parse(await response.json());
}

/** Reads the accounting app's list and makes `costEntries` match it. Safe to run any time: it only writes what changed. */
export async function runAccountingCostSync(
  db: Firestore,
  feed: AccountingCostFeed,
  now: string,
): Promise<AccountingCostRefreshResult> {
  const root = `properties/${PROPERTY_ID}`;
  const snapshot = await db
    .collection(`${root}/costEntries`)
    .where("source", "==", "accounting")
    .get();
  const existing: ExistingAccountingCost[] = snapshot.docs.map((doc) => ({
    id: doc.id,
    data: doc.data(),
  }));
  const plan = planAccountingCostSync(feed, existing, {
    propertyId: PROPERTY_ID,
    now,
  });
  for (let i = 0; i < plan.writes.length; i += BATCH) {
    const batch = db.batch();
    for (const write of plan.writes.slice(i, i + BATCH)) {
      const ref = db.doc(`${root}/costEntries/${write.id}`);
      if (write.kind === "create") batch.create(ref, write.data);
      else batch.update(ref, write.data);
    }
    await batch.commit();
  }
  if (plan.writes.length > 0) {
    await db
      .doc(`${root}/auditLogs/accounting-cost-sync-${Date.parse(now)}`)
      .create({
        actorUid: "system",
        action: "cost.accounting_sync",
        targetId: PROPERTY_ID,
        targetType: "cost",
        details: {
          created: plan.created,
          updated: plan.updated,
          archived: plan.archived,
        },
        createdAt: now,
      });
  }
  return accountingCostRefreshResultSchema.parse({
    created: plan.created,
    updated: plan.updated,
    archived: plan.archived,
    unchanged: plan.unchanged,
  });
}

function feedUrl(): string {
  const project =
    process.env.GCLOUD_PROJECT ?? process.env.GOOGLE_CLOUD_PROJECT ?? "";
  const url = ACCOUNTING_FEED_URLS[project];
  if (!url)
    throw new Error(`no accounting feed configured for project "${project}"`);
  return url;
}

/** Every 10 minutes the costs entered in the accounting app are pulled in, so the cost page and reports stay complete. */
export const accountingCostSync = onSchedule(
  {
    schedule: "every 10 minutes",
    timeZone: "Asia/Taipei",
    region: "asia-east1",
    timeoutSeconds: 120,
    memory: "256MiB",
    maxInstances: 1,
  },
  async () => {
    try {
      const feed = await fetchAccountingFeed(feedUrl());
      const result = await runAccountingCostSync(
        getFirestore(),
        feed,
        new Date().toISOString(),
      );
      logger.info("accounting cost sync", result);
    } catch (error) {
      // The next run retries; nothing is changed when the list cannot be read.
      logger.error("accounting cost sync failed", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  },
);

/** "Refresh now" on the cost page. */
export const accountingCostRefresh = onCall(
  { region: "asia-east1", maxInstances: 5, timeoutSeconds: 90, memory: "256MiB" },
  async (request): Promise<AccountingCostRefreshResult> => {
    const parsed = accountingCostRefreshInputSchema.safeParse(request.data);
    if (!parsed.success)
      throw new HttpsError("invalid-argument", "更新資料格式不正確。");
    await requireCostAdmin(request.auth, parsed.data.propertyId);
    if (parsed.data.propertyId !== PROPERTY_ID)
      throw new HttpsError(
        "failed-precondition",
        "這個館別不使用記帳 App 的成本。",
      );
    let feed: AccountingCostFeed;
    try {
      feed = await fetchAccountingFeed(feedUrl());
    } catch (error) {
      logger.error("accounting cost refresh failed", {
        error: error instanceof Error ? error.message : String(error),
      });
      throw new HttpsError("unavailable", "記帳 App 暫時讀不到，請稍後再試。");
    }
    return runAccountingCostSync(
      getFirestore(),
      feed,
      new Date().toISOString(),
    );
  },
);

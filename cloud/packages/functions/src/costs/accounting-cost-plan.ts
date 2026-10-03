import {
  ACCOUNTING_COST_ID_PREFIX,
  type AccountingCost,
  type AccountingCostFeed,
} from "@bini/cloud-shared";

export interface ExistingAccountingCost {
  id: string;
  data: Record<string, unknown>;
}
export type AccountingCostWrite =
  | { kind: "create"; id: string; data: Record<string, unknown> }
  | { kind: "update"; id: string; data: Record<string, unknown> };
export interface AccountingCostPlan {
  writes: AccountingCostWrite[];
  created: number;
  updated: number;
  archived: number;
  unchanged: number;
}

/** The facts that come from the accounting app; if none of them changed, the document is left alone. */
function factFields(cost: AccountingCost) {
  return {
    costDate: cost.date,
    category: cost.category,
    subcategory: cost.categoryName || null,
    amountNts: Math.round(cost.amount),
    paymentMethod: cost.method,
    installmentPeriods: cost.method === "card_installment" ? cost.periods : null,
    vendor: cost.name || cost.categoryName || null,
    description: cost.note || null,
    recurring: cost.recurring,
  };
}
const FACT_KEYS = [
  "costDate",
  "category",
  "subcategory",
  "amountNts",
  "paymentMethod",
  "installmentPeriods",
  "vendor",
  "description",
  "recurring",
] as const;
export const accountingCostDocumentId = (feedId: string) =>
  `${ACCOUNTING_COST_ID_PREFIX}${feedId}`;

/**
 * Turns the accounting app's list into the writes that make `costEntries` match it:
 * new costs are created, changed ones updated (and restored if they had been archived), and costs that are
 * no longer in the list (deleted in the accounting app) inside the list's date window are archived.
 * Costs made in this system, and costs outside the window, are never touched. Pure: no I/O.
 */
export function planAccountingCostSync(
  feed: AccountingCostFeed,
  existing: readonly ExistingAccountingCost[],
  context: { propertyId: string; now: string },
): AccountingCostPlan {
  const plan: AccountingCostPlan = {
    writes: [],
    created: 0,
    updated: 0,
    archived: 0,
    unchanged: 0,
  };
  if (!feed.fromDate || !feed.toDate) return plan;
  // Only documents this sync created are ever changed: a cost made in this system is never updated or archived by it.
  const byId = new Map(
    existing
      .filter(
        (entry) =>
          entry.id.startsWith(ACCOUNTING_COST_ID_PREFIX) &&
          entry.data.source === "accounting",
      )
      .map((entry) => [entry.id, entry.data]),
  );
  const seen = new Set<string>();
  for (const cost of feed.costs) {
    const facts = factFields(cost);
    if (facts.amountNts < 1) continue;
    const id = accountingCostDocumentId(cost.id);
    seen.add(id);
    const current = byId.get(id);
    if (!current) {
      plan.writes.push({
        kind: "create",
        id,
        data: {
          schemaVersion: 4,
          version: 1,
          propertyId: context.propertyId,
          ...facts,
          note: null,
          receiptNo: null,
          status: "active",
          source: "accounting",
          sourceId: cost.id,
          createdAt: context.now,
          updatedAt: context.now,
          createdByUid: "accounting-sync",
          updatedByUid: "accounting-sync",
        },
      });
      plan.created += 1;
      continue;
    }
    const same =
      current.status === "active" &&
      FACT_KEYS.every((key) => (current[key] ?? null) === facts[key]);
    if (same) {
      plan.unchanged += 1;
      continue;
    }
    plan.writes.push({
      kind: "update",
      id,
      data: {
        ...facts,
        status: "active",
        archiveReason: null,
        archivedAt: null,
        version: (Number(current.version) || 0) + 1,
        updatedAt: context.now,
        updatedByUid: "accounting-sync",
      },
    });
    plan.updated += 1;
  }
  for (const [id, current] of byId) {
    if (seen.has(id) || current.status === "archived") continue;
    const date = String(current.costDate ?? "");
    if (date < feed.fromDate || date > feed.toDate) continue;
    plan.writes.push({
      kind: "update",
      id,
      data: {
        status: "archived",
        archiveReason: "記帳 App 已刪除或修改這筆成本。",
        archivedAt: context.now,
        archivedByUid: "accounting-sync",
        version: (Number(current.version) || 0) + 1,
        updatedAt: context.now,
        updatedByUid: "accounting-sync",
      },
    });
    plan.archived += 1;
  }
  return plan;
}

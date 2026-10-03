import type { AccountingCost, AccountingCostFeed } from '@bini/cloud-shared';
import { describe, expect, it, vi } from 'vitest';

import { planAccountingCostSync, type ExistingAccountingCost } from '../src/costs/accounting-cost-plan.js';
import { fetchAccountingFeed } from '../src/costs/accounting-cost-sync.js';

const NOW = '2026-10-03T08:00:00.000Z';
const ctx = { propertyId: 'property-main', now: NOW };
const cost = (id: string, extra: Partial<AccountingCost> = {}): AccountingCost => ({
  id, date: '2026-10-05', category: 'cleaning_supplies', categoryName: '清潔用品', name: '好潔', amount: 1860, method: 'cash', periods: null, note: '', recurring: false, ...extra,
});
const feed = (costs: AccountingCost[], extra: Partial<AccountingCostFeed> = {}): AccountingCostFeed => ({
  ok: true, version: 1, generatedAtMs: Date.parse(NOW), fromDate: '2026-10-01', toDate: '2026-10-31', costs, ...extra,
});
const existingFrom = (plan: ReturnType<typeof planAccountingCostSync>): ExistingAccountingCost[] =>
  plan.writes.filter((w) => w.kind === 'create').map((w) => ({ id: w.id, data: w.data }));

describe('accounting cost sync plan', () => {
  it('creates one active, read-only cost per item with the accounting facts, never a card detail', () => {
    const plan = planAccountingCostSync(feed([cost('e1'), cost('e2', { method: 'card_installment', periods: 6, amount: 36000.4, category: 'maintenance', categoryName: '維修', name: '冷氣工程行', note: '冷氣更換', date: '2026-10-07' })]), [], ctx);
    expect([plan.created, plan.updated, plan.archived, plan.unchanged]).toEqual([2, 0, 0, 0]);
    const [a, b] = plan.writes;
    expect(a).toMatchObject({ kind: 'create', id: 'ACC-e1', data: { source: 'accounting', sourceId: 'e1', status: 'active', version: 1, propertyId: 'property-main', costDate: '2026-10-05', category: 'cleaning_supplies', amountNts: 1860, paymentMethod: 'cash', installmentPeriods: null, vendor: '好潔', recurring: false } });
    expect(b).toMatchObject({ id: 'ACC-e2', data: { amountNts: 36000, paymentMethod: 'card_installment', installmentPeriods: 6, subcategory: '維修', vendor: '冷氣工程行', description: '冷氣更換' } });
    expect(JSON.stringify(plan.writes)).not.toMatch(/cardId|last4/);
  });

  it('is idempotent: the same list again changes nothing', () => {
    const first = planAccountingCostSync(feed([cost('e1'), cost('e2', { date: '2026-10-06' })]), [], ctx);
    const again = planAccountingCostSync(feed([cost('e1'), cost('e2', { date: '2026-10-06' })]), existingFrom(first), ctx);
    expect(again.writes).toEqual([]);
    expect(again.unchanged).toBe(2);
  });

  it('updates a cost whose facts changed in the accounting app, bumping the version', () => {
    const first = planAccountingCostSync(feed([cost('e1')]), [], ctx);
    const plan = planAccountingCostSync(feed([cost('e1', { amount: 2000, method: 'card', date: '2026-10-09' })]), existingFrom(first), ctx);
    expect([plan.created, plan.updated, plan.archived]).toEqual([0, 1, 0]);
    expect(plan.writes[0]).toMatchObject({ kind: 'update', id: 'ACC-e1', data: { amountNts: 2000, paymentMethod: 'card', installmentPeriods: null, costDate: '2026-10-09', version: 2, status: 'active' } });
  });

  it('archives a cost that was deleted in the accounting app, only inside the list window, and restores it if it comes back', () => {
    const first = planAccountingCostSync(feed([cost('in-window'), cost('old', { date: '2026-09-20' })], { fromDate: '2026-09-01' }), [], ctx);
    const existing = existingFrom(first);
    const gone = planAccountingCostSync(feed([], { fromDate: '2026-10-01', toDate: '2026-10-31' }), existing, ctx);
    expect(gone.writes.map((w) => w.id)).toEqual(['ACC-in-window']);
    expect(gone.writes[0]).toMatchObject({ kind: 'update', data: { status: 'archived', archivedByUid: 'accounting-sync', version: 2 } });
    expect(gone.archived).toBe(1);
    const archived = existing.map((e) => (e.id === 'ACC-in-window' ? { ...e, data: { ...e.data, ...(gone.writes[0]!.data), } } : e));
    const stillGone = planAccountingCostSync(feed([], { fromDate: '2026-10-01', toDate: '2026-10-31' }), archived, ctx);
    expect(stillGone.writes).toEqual([]);
    const back = planAccountingCostSync(feed([cost('in-window')]), archived, ctx);
    expect(back.writes[0]).toMatchObject({ kind: 'update', id: 'ACC-in-window', data: { status: 'active', archiveReason: null, version: 3 } });
  });

  it('never touches costs made in this system (they are not in the accounting costs) and does nothing without a window', () => {
    const own: ExistingAccountingCost = { id: 'CST-OWN', data: { source: null, status: 'active', costDate: '2026-10-05', version: 4 } };
    expect(planAccountingCostSync(feed([]), [own], ctx).writes).toEqual([]);
    const empty = planAccountingCostSync(feed([], { fromDate: null, toDate: null }), existingFrom(planAccountingCostSync(feed([cost('e1')]), [], ctx)), ctx);
    expect(empty.writes).toEqual([]);
  });

  it('rounds to whole dollars and skips an amount that rounds to nothing', () => {
    const plan = planAccountingCostSync(feed([cost('a', { amount: 99.5 }), cost('b', { amount: 0.4 })]), [], ctx);
    expect(plan.writes.map((w) => [w.id, w.data.amountNts])).toEqual([['ACC-a', 100]]);
  });
});

describe('fetching the accounting cost list', () => {
  const body = { ok: true, version: 1, generatedAtMs: 1, fromDate: '2026-10-01', toDate: '2026-10-31', costs: [{ id: 'e1', date: '2026-10-05', category: 'misc', categoryName: '', name: '', amount: 5, method: 'cash', periods: null, note: '', recurring: false }] };
  const response = (status: number, json: unknown) => ({ ok: status < 400, status, json: async () => json }) as unknown as Response;

  it('calls the list with an identity token for that exact address and returns the validated list', async () => {
    const getToken = vi.fn().mockResolvedValue('TOKEN');
    const fetchImpl = vi.fn().mockResolvedValue(response(200, body));
    const result = await fetchAccountingFeed('https://example.test/finPmsCostFeed', { getToken, fetchImpl });
    expect(getToken).toHaveBeenCalledWith('https://example.test/finPmsCostFeed');
    expect(fetchImpl.mock.calls[0]![1].headers).toEqual({ Authorization: 'Bearer TOKEN' });
    expect(result.costs).toHaveLength(1);
  });

  it('refuses an error status or a list that does not match the contract, so nothing is ever changed from bad data', async () => {
    const getToken = vi.fn().mockResolvedValue('T');
    await expect(fetchAccountingFeed('https://x.test', { getToken, fetchImpl: vi.fn().mockResolvedValue(response(403, {})) })).rejects.toThrow(/403/);
    await expect(fetchAccountingFeed('https://x.test', { getToken, fetchImpl: vi.fn().mockResolvedValue(response(200, { ...body, ok: false })) })).rejects.toThrow();
    await expect(fetchAccountingFeed('https://x.test', { getToken, fetchImpl: vi.fn().mockResolvedValue(response(200, { ...body, costs: [{ ...body.costs[0], category: 'unknown' }] })) })).rejects.toThrow();
    await expect(fetchAccountingFeed('https://x.test', { getToken, fetchImpl: vi.fn().mockResolvedValue(response(200, { ...body, costs: [{ ...body.costs[0], method: 'card_installment', periods: null }] })) })).resolves.toBeDefined();
  });
});

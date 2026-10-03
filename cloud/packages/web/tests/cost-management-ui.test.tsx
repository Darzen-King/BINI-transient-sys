// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CostListItem } from '@bini/cloud-shared';

import { App } from '../src/App.js';
import type { StaffSession } from '../src/auth/session.js';
import type { CostGateway } from '../src/costs/cost-gateway.js';

const session: StaffSession = { uid: 'admin-1', email: 'admin@example.com', displayName: 'Admin', propertyId: 'property-main', role: 'admin', allowedPages: ['costs'] };
const cost = (costId: string, costDate: string, amountNts: number, extra: Partial<CostListItem> = {}): CostListItem => ({
  costId, propertyId: 'property-main', costDate, category: 'utilities', subcategory: null, amountNts, paymentMethod: 'cash',
  vendor: null, description: null, note: null, recurring: false, receiptNo: null, status: 'active', version: 1,
  createdAt: `${costDate}T01:00:00.000Z`, updatedAt: `${costDate}T01:00:00.000Z`, ...extra,
});
const items = [cost('CST-jul', '2026-07-20', 4_000), cost('CST-aug', '2026-08-15', 2_000), cost('CST-sep', '2026-09-05', 800, { category: 'laundry' })];
const gateway = (): CostGateway => ({ subscribe(_propertyId, onValue) { queueMicrotask(() => onValue(items)); return () => undefined; }, create: vi.fn(), update: vi.fn(), archive: vi.fn() });

const list = () => document.querySelector('.cost-history-list') as HTMLElement;
const total = () => screen.getByText('區間成本').nextSibling;

beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-09-16T10:00:00+08:00')); });
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe('cost history search', () => {
  it('opens on this month and searches any date range, including older months', async () => {
    render(<App costGateway={gateway()} session={session} />);
    fireEvent.click(screen.getByRole('link', { name: '成本紀錄' }));
    await waitFor(() => expect(screen.getByLabelText('開始日期')).toHaveValue('2026-09-01'));
    expect(screen.getByLabelText('結束日期')).toHaveValue('2026-09-16');
    // September only, at first (the amount also appears in the range total, hence getAllByText).
    expect(within(list()).getByText(/NT\$ 800/)).toBeInTheDocument();
    expect(within(list()).queryByText(/NT\$ 2,000/)).toBeNull();

    // A past range brings the history back.
    fireEvent.change(screen.getByLabelText('開始日期'), { target: { value: '2026-07-01' } });
    fireEvent.change(screen.getByLabelText('結束日期'), { target: { value: '2026-08-31' } });
    await waitFor(() => expect(within(list()).getByText(/NT\$ 4,000/)).toBeInTheDocument());
    expect(within(list()).getByText(/水電瓦斯 · NT\$ 2,000/)).toBeInTheDocument();
    expect(within(list()).queryByText(/NT\$ 800/)).toBeNull();
    expect(total()).toHaveTextContent('NT$ 6,000');
  });

  it('offers quick ranges that cover last month and everything recorded', async () => {
    render(<App costGateway={gateway()} session={session} />);
    fireEvent.click(screen.getByRole('link', { name: '成本紀錄' }));
    await screen.findByLabelText('開始日期');

    fireEvent.click(screen.getByRole('button', { name: '上個月' }));
    expect(screen.getByLabelText('開始日期')).toHaveValue('2026-08-01');
    expect(screen.getByLabelText('結束日期')).toHaveValue('2026-08-31');
    await waitFor(() => expect(within(list()).getByText(/NT\$ 2,000/)).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: '全部' }));
    await waitFor(() => expect(within(list()).getByText(/NT\$ 4,000/)).toBeInTheDocument());
    expect(within(list()).getByText(/水電瓦斯 · NT\$ 2,000/)).toBeInTheDocument();
    expect(within(list()).getByText(/NT\$ 800/)).toBeInTheDocument();
    expect(total()).toHaveTextContent('NT$ 6,800');
  });
});

describe('costs entered in the accounting app', () => {
  const open = async (existing: CostListItem[] = items, extra: Partial<CostGateway> = {}) => {
    const gw: CostGateway = { subscribe(_propertyId, onValue) { queueMicrotask(() => onValue(existing)); return () => undefined; }, create: vi.fn(), update: vi.fn().mockResolvedValue({ status: 'updated', costId: 'x', version: 2, updatedAt: '2026-09-16T02:00:00.000Z' }), archive: vi.fn(), ...extra };
    render(<App costGateway={gw} session={session} />);
    fireEvent.click(screen.getByRole('link', { name: '成本紀錄' }));
    await screen.findByLabelText('開始日期');
    return gw;
  };
  const accounting = (costId: string, extra: Partial<CostListItem> = {}) => cost(costId, '2026-09-08', 36_000, { source: 'accounting', paymentMethod: 'card_installment', installmentPeriods: 6, category: 'maintenance', vendor: '冷氣工程行', ...extra });

  it('has no new-cost form: costs are entered in the accounting app and shown here', async () => {
    await open();
    expect(screen.getByText('成本請到記帳 App 輸入')).toBeInTheDocument();
    expect(document.querySelector('.booking-create-form')).toBeNull();
    expect(screen.queryByRole('button', { name: '儲存成本' })).toBeNull();
  });

  it('shows a cost from the accounting app read-only with its payment method and periods, and no edit or archive', async () => {
    await open([accounting('ACC-1'), cost('CST-own', '2026-09-05', 800)]);
    const rows = within(list()).getAllByRole('article');
    const fromAccounting = rows.find((row) => row.textContent?.includes('冷氣工程行')) as HTMLElement;
    expect(fromAccounting).toBeTruthy();
    expect(within(fromAccounting).getByText('記帳 App')).toBeInTheDocument();
    expect(fromAccounting).toHaveTextContent('刷卡分期 · 6 期');
    expect(within(fromAccounting).queryByRole('button', { name: '修改' })).toBeNull();
    expect(within(fromAccounting).queryByRole('button', { name: '封存' })).toBeNull();
    // A cost made in this system before the change can still be edited.
    const own = rows.find((row) => row.textContent?.includes('NT$ 800')) as HTMLElement;
    expect(within(own).getByRole('button', { name: '修改' })).toBeInTheDocument();
  });

  it('pulls the accounting costs on demand and reports what changed', async () => {
    const refresh = vi.fn().mockResolvedValue({ created: 2, updated: 1, archived: 0, unchanged: 5 });
    await open(items, { refreshFromAccounting: refresh });
    fireEvent.click(screen.getByRole('button', { name: '立即更新' }));
    await waitFor(() => expect(refresh).toHaveBeenCalledWith({ propertyId: 'property-main' }));
    expect(await screen.findByText('已更新：新增 2 筆、更新 1 筆、移除 0 筆。')).toBeInTheDocument();
  });

  it('tells the owner when the accounting app cannot be read', async () => {
    const refresh = vi.fn().mockRejectedValue(new Error('記帳 App 暫時讀不到，請稍後再試。'));
    await open(items, { refreshFromAccounting: refresh });
    fireEvent.click(screen.getByRole('button', { name: '立即更新' }));
    expect(await screen.findByText('記帳 App 暫時讀不到，請稍後再試。')).toBeInTheDocument();
  });
});

describe('older costs made in this system: credit-card installments', () => {
  const open = async () => {
    const gw: CostGateway = { subscribe(_propertyId, onValue) { queueMicrotask(() => onValue([cost('CST-own', '2026-09-05', 800)])); return () => undefined; }, create: vi.fn(), update: vi.fn().mockResolvedValue({ status: 'updated', costId: 'CST-own', version: 2, updatedAt: '2026-09-16T02:00:00.000Z' }), archive: vi.fn() };
    render(<App costGateway={gw} session={session} />);
    fireEvent.click(screen.getByRole('link', { name: '成本紀錄' }));
    await screen.findByLabelText('開始日期');
    fireEvent.click(within(list()).getByRole('button', { name: '修改' }));
    return gw;
  };
  const dialog = () => screen.getByRole('dialog');

  it('asks for the number of periods only when the cost is paid by card in installments, and sends it', async () => {
    const gw = await open();
    expect(within(dialog()).queryByLabelText('分期期數')).toBeNull();
    fireEvent.change(within(dialog()).getByLabelText('付款方式'), { target: { value: 'card_installment' } });
    const periods = within(dialog()).getByLabelText('分期期數');
    expect(periods).toBeRequired();
    expect(periods).toHaveAttribute('min', '2');
    expect(periods).toHaveAttribute('max', '120');
    fireEvent.change(periods, { target: { value: '6' } });
    fireEvent.submit(dialog().querySelector('form') as HTMLFormElement);
    await waitFor(() => expect(gw.update).toHaveBeenCalledTimes(1));
    expect(gw.update).toHaveBeenCalledWith(expect.objectContaining({ paymentMethod: 'card_installment', installmentPeriods: 6, costId: 'CST-own' }));
  });

  it('never sends a period count for any other payment method, even after switching back', async () => {
    const gw = await open();
    fireEvent.change(within(dialog()).getByLabelText('付款方式'), { target: { value: 'card_installment' } });
    fireEvent.change(within(dialog()).getByLabelText('分期期數'), { target: { value: '12' } });
    fireEvent.change(within(dialog()).getByLabelText('付款方式'), { target: { value: 'card' } });
    expect(within(dialog()).queryByLabelText('分期期數')).toBeNull();
    fireEvent.submit(dialog().querySelector('form') as HTMLFormElement);
    await waitFor(() => expect(gw.update).toHaveBeenCalledTimes(1));
    const sent = (gw.update as ReturnType<typeof vi.fn>).mock.calls[0]![0] as Record<string, unknown>;
    expect(sent.paymentMethod).toBe('card');
    expect('installmentPeriods' in sent).toBe(false);
  });
});

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

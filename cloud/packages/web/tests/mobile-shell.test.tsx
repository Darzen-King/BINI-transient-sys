// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { App } from '../src/App.js';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('mobile-first PMS shell', () => {
  it('prioritises today, bookings, housekeeping, payments and more in bottom navigation', () => {
    render(<App />);

    const navigation = screen.getByRole('navigation', { name: '手機主導覽' });
    for (const label of ['今日', '預約', '房務', '款項', '更多']) {
      expect(navigation).toHaveTextContent(label);
    }
  });

  it('shows room state as cards instead of a desktop data table', () => {
    render(<App />);

    expect(screen.getByRole('region', { name: '今日房態' })).toBeInTheDocument();
    expect(screen.getByText('201')).toBeInTheDocument();
    expect(screen.getByText('待清潔')).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('keeps the three highest-frequency front-desk actions one tap away', () => {
    render(<App />);

    expect(screen.getByRole('button', { name: '新增預約' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '辦理入住' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '辦理退房' })).toBeInTheDocument();
  });

  it('makes offline work explicit and opens the pending-sync centre', () => {
    render(<App />);

    fireEvent.click(screen.getByRole('button', { name: /2 筆待同步/ }));
    expect(screen.getByRole('dialog', { name: '待同步中心' })).toBeInTheDocument();
    expect(screen.getByText('尚未完成')).toBeInTheDocument();
    expect(screen.getByText('等待網路恢復後由伺服器確認')).toBeInTheDocument();
  });

  it('switches to a dedicated housekeeping screen through mobile navigation', () => {
    render(<App />);

    fireEvent.click(screen.getByRole('button', { name: '房務' }));
    expect(screen.getByRole('heading', { name: '房務工作' })).toBeInTheDocument();
    expect(screen.getByText('優先清潔')).toBeInTheDocument();
  });

  it('renders the header date from the client clock instead of a frozen prototype date', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2031, 0, 2, 12));

    render(<App />);

    expect(screen.getByText(/2031 年 1 月 2 日/)).toBeInTheDocument();
  });
});

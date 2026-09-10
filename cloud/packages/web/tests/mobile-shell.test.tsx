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

  it('has no self-registration entry point', () => {
    render(<App initialAuthenticated={false} />);

    expect(screen.getByRole('heading', { name: '員工登入' })).toBeInTheDocument();
    expect(screen.queryByText(/註冊|建立帳號/)).not.toBeInTheDocument();
  });

  it('removes desktop cloud-backup settings and exposes account settings only to admins', () => {
    const { rerender } = render(<App session={{
      uid: 'admin-1',
      email: 'admin@example.com',
      displayName: 'Administrator',
      propertyId: 'property-main',
      role: 'admin',
      allowedPages: ['users'],
    }} />);
    fireEvent.click(screen.getByRole('button', { name: '更多' }));
    expect(screen.queryByText('雲端備份')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /裝置與帳號/ })).toBeInTheDocument();

    rerender(<App session={{
      uid: 'front-1',
      email: 'front@example.com',
      displayName: 'Front Desk',
      propertyId: 'property-main',
      role: 'front_desk',
      allowedPages: [],
    }} />);
    expect(screen.queryByRole('button', { name: /裝置與帳號/ })).not.toBeInTheDocument();
  });

  it('filters navigation and more actions using the configured page permissions', () => {
    render(<App session={{
      uid: 'housekeeping-1',
      email: 'housekeeping@example.com',
      displayName: 'Housekeeping',
      propertyId: 'property-main',
      role: 'housekeeping',
      allowedPages: ['rooms', 'housekeeping'],
    }} />);

    const navigation = screen.getByRole('navigation', { name: '手機主導覽' });
    expect(navigation).toHaveTextContent('今日');
    expect(navigation).toHaveTextContent('房務');
    expect(navigation).toHaveTextContent('更多');
    expect(navigation).not.toHaveTextContent('預約');
    expect(navigation).not.toHaveTextContent('款項');

    fireEvent.click(screen.getByRole('button', { name: '更多' }));
    expect(screen.queryByRole('button', { name: /成本紀錄|統計報表|裝置與帳號/ })).not.toBeInTheDocument();
  });
});

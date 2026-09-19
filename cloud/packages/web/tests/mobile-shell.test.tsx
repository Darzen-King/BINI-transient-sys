// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';

import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { App } from '../src/App.js';
import { LocaleProvider } from '../src/i18n/locale.js';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('mobile-first PMS shell', () => {
  it('orders the bottom navigation as Hub, rooms, check-in, new booking and more', () => {
    render(<App />);

    const navigation = screen.getByRole('navigation', { name: '手機主導覽' });
    const labels = within(navigation).getAllByRole('button').map((button) => button.getAttribute('aria-label'));
    expect(labels).toEqual(['Hub', '房間總覽', '入住登記', '新增預約', '更多']);
    expect(navigation.querySelectorAll('svg')).toHaveLength(5);
    // Room overview stays the default landing page.
    expect(within(navigation).getByRole('button', { name: '房間總覽' })).toHaveClass('active');
  });

  it('shows room state as cards instead of a desktop data table', () => {
    render(<App />);

    expect(screen.getByRole('region', { name: '今日房態' })).toBeInTheDocument();
    expect(screen.getByText('201')).toBeInTheDocument();
    expect(screen.getByText('使用中')).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('keeps the original detailed room fields in the desktop card markup', () => {
    render(<App />);

    const roomCard = screen.getByRole('button', { name: '查看 202 房詳細資料' }).closest('article');
    expect(roomCard).toHaveTextContent('目前旅客');
    expect(roomCard).toHaveTextContent('入住時間');
    expect(roomCard).toHaveTextContent('退房時間');
    expect(roomCard).toHaveTextContent('應付總額');
    expect(roomCard).toHaveTextContent('已收款');
    expect(roomCard).toHaveTextContent('餘額應收');
    expect(roomCard).toHaveTextContent('下一筆預約');
    expect(roomCard).toHaveTextContent('延住處理');
    expect(roomCard).toHaveTextContent('付款');
    expect(roomCard).toHaveTextContent('退房辦理');
  });

  it('opens the same complete room details from a compact mobile room card', () => {
    render(<App />);

    fireEvent.click(screen.getByRole('button', { name: '查看 202 房詳細資料' }));
    const dialog = screen.getByRole('dialog', { name: '202 房詳細資料' });
    expect(dialog).toHaveTextContent('Joshua');
    expect(dialog).toHaveTextContent('2026-09-05 16:00');
    expect(dialog).toHaveTextContent('NT$ 6,400');
    expect(dialog).toHaveTextContent('下一筆預約');
    expect(dialog).toHaveTextContent('延住處理');
  });

  it('keeps the three highest-frequency front-desk actions one tap away', () => {
    render(<App />);

    expect(screen.getAllByRole('button', { name: '新增預約' }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole('button', { name: '辦理入住' }).length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: '辦理退房' })).toBeInTheDocument();
  });

  it('routes the global checkout shortcut to the guarded checkout workflow', () => {
    render(<App />);

    fireEvent.click(screen.getByRole('button', { name: '辦理退房' }));
    expect(screen.getByLabelText('選擇在住房')).toBeInTheDocument();
  });

  it('labels the deployed shell as a non-operational DEV foundation without fake pending work', () => {
    render(<App />);

    expect(screen.getByRole('status')).toHaveTextContent('DEV 開發中');
    expect(screen.getByRole('status')).toHaveTextContent('尚不可作為正式營運系統');
    expect(screen.queryByText(/2 筆待同步|等待同步/)).not.toBeInTheDocument();
  });

  it('drops the DEV badge and banner in the production build', () => {
    render(<App environment="prod" />);

    expect(screen.queryByText('DEV')).not.toBeInTheDocument();
    expect(screen.queryByText(/DEV 開發中/)).not.toBeInTheDocument();
  });

  it('reaches the housekeeping screen from the More menu', () => {
    render(<App />);

    fireEvent.click(screen.getByRole('button', { name: '更多' }));
    fireEvent.click(screen.getByRole('button', { name: /清潔管理/ }));
    expect(screen.getAllByRole('heading', { name: '清潔管理' }).length).toBeGreaterThan(0);
    expect(screen.getByText('房務資料尚未就緒')).toBeInTheDocument();
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

  it('switches the mobile shell between Chinese and English without reloading', () => {
    render(<LocaleProvider initialLocale="zh-TW"><App /></LocaleProvider>);

    expect(screen.getByRole('navigation', { name: '手機主導覽' })).toHaveTextContent('房間總覽');
    const switches = screen.getAllByRole('group', { name: '語言切換' });
    fireEvent.click(within(switches[1]!).getByRole('button', { name: 'EN' }));
    expect(screen.getByRole('navigation', { name: 'Mobile navigation' })).toHaveTextContent('Rooms');
    expect(screen.getByRole('heading', { name: "Today's Operations" })).toBeInTheDocument();
    expect(document.documentElement).toHaveAttribute('lang', 'en');
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
    expect(screen.getByRole('button', { name: /使用者/ })).toBeInTheDocument();

    rerender(<App session={{
      uid: 'front-1',
      email: 'front@example.com',
      displayName: 'Front Desk',
      propertyId: 'property-main',
      role: 'front_desk',
      allowedPages: [],
    }} />);
    expect(screen.queryByRole('button', { name: /使用者/ })).not.toBeInTheDocument();
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
    expect(navigation).toHaveTextContent('Hub');
    expect(navigation).toHaveTextContent('房間總覽');
    expect(navigation).toHaveTextContent('更多');
    expect(navigation).not.toHaveTextContent('入住登記');
    expect(navigation).not.toHaveTextContent('新增預約');

    fireEvent.click(screen.getByRole('button', { name: '更多' }));
    expect(screen.queryByRole('button', { name: /成本紀錄|統計報表|使用者/ })).not.toBeInTheDocument();
  });

  it('preserves the complete v3 desktop navigation order without cloud backup', () => {
    render(<App />);

    const navigation = screen.getByRole('navigation', { name: '桌面主導覽' });
    const labels = [
      'Prototype Hub', '房間總覽', '甘特圖', '付款管理', '預約管理', '新增預約',
      '入住登記', '延住處理', '退房辦理', '房間管理', '清潔管理', '維修管理',
      '統計報表', '審計軌跡', '使用者', '館別管理', '成本紀錄', '假日管理',
    ];
    let cursor = -1;
    for (const label of labels) {
      const next = navigation.textContent?.indexOf(label) ?? -1;
      expect(next).toBeGreaterThan(cursor);
      cursor = next;
    }
    expect(navigation).not.toHaveTextContent('雲端備份');
  });

  it('shows Prototype Hub modules as icon cards', () => {
    render(<App />);

    fireEvent.click(within(screen.getByRole('navigation', { name: '手機主導覽' })).getByRole('button', { name: 'Hub' }));
    const card = screen.getByRole('button', { name: /延住處理/ });
    expect(card.querySelector('svg')).not.toBeNull();
    expect(card).toHaveTextContent('延住計費與撞期檢查');
  });
});

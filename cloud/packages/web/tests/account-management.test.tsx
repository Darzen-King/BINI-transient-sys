// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';

import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AccountManagement } from '../src/accounts/AccountManagement.js';
import type { AccountAdminGateway } from '../src/accounts/account-admin.js';
import type { StaffSession } from '../src/auth/session.js';

const session: StaffSession = {
  uid: 'admin-1',
  email: 'admin@example.com',
  displayName: 'Administrator',
  propertyId: 'property-main',
  role: 'admin',
  allowedPages: [],
};

function gateway(): AccountAdminGateway {
  return {
    list: vi.fn().mockResolvedValue([{
      uid: 'front-1',
      email: 'front@example.com',
      displayName: 'Front Desk',
      role: 'front_desk',
      active: true,
      allowedPages: ['rooms', 'bookings'],
      lastLoginAt: null,
      mfaEnrolled: false,
    }]),
    create: vi.fn().mockResolvedValue(undefined),
    update: vi.fn().mockResolvedValue(undefined),
    setPassword: vi.fn().mockResolvedValue(undefined),
  };
}

afterEach(() => cleanup());

describe('administrator-managed staff accounts', () => {
  it('shows staff state and never exposes desktop backup permissions', async () => {
    render(<AccountManagement session={session} gateway={gateway()} />);

    expect((await screen.findAllByText('front@example.com')).length).toBe(2);
    expect(screen.getAllByText('MFA 待設定')).toHaveLength(2);
    expect(screen.getByRole('columnheader', { name: '最後登入' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '＋ 新增使用者' }));
    expect(screen.queryByText('雲端備份')).not.toBeInTheDocument();
    expect(screen.getByText('甘特圖')).toBeInTheDocument();
  });

  it('submits a closed-system account through the admin gateway', async () => {
    const api = gateway();
    render(<AccountManagement session={session} gateway={api} />);
    await screen.findAllByText('front@example.com');
    fireEvent.click(screen.getByRole('button', { name: '＋ 新增使用者' }));
    fireEvent.change(screen.getByLabelText('顯示名稱'), { target: { value: 'New Staff' } });
    fireEvent.change(screen.getByLabelText('登入電子郵件'), { target: { value: 'new@example.com' } });
    fireEvent.change(screen.getByLabelText(/初始密碼/), { target: { value: 'SecurePassword1' } });
    fireEvent.click(screen.getByRole('button', { name: '儲存' }));

    await waitFor(() => expect(api.create).toHaveBeenCalledWith(expect.objectContaining({
      propertyId: 'property-main',
      email: 'new@example.com',
      displayName: 'New Staff',
      role: 'front_desk',
    })));
  });

  it('allows an administrator to update another staff email through the guarded gateway', async () => {
    const api = gateway();
    render(<AccountManagement session={session} gateway={api} />);
    await screen.findAllByText('front@example.com');
    fireEvent.click(screen.getAllByRole('button', { name: '編輯' })[0]!);
    fireEvent.change(screen.getByLabelText('登入電子郵件'), { target: { value: 'renamed@example.com' } });
    fireEvent.click(screen.getByRole('button', { name: '儲存' }));

    await waitFor(() => expect(api.update).toHaveBeenCalledWith(expect.objectContaining({
      propertyId: 'property-main',
      uid: 'front-1',
      email: 'renamed@example.com',
    })));
  });

  it('lets an administrator reset another member two-step verification with a reason', async () => {
    const resetMfa = vi.fn().mockResolvedValue(undefined);
    const users = [
      { uid: 'admin-1', email: 'admin@example.com', displayName: 'Administrator', role: 'admin' as const, active: true, allowedPages: [], lastLoginAt: null, mfaEnrolled: true },
      { uid: 'front-1', email: 'front@example.com', displayName: 'Front Desk', role: 'front_desk' as const, active: true, allowedPages: [], lastLoginAt: null, mfaEnrolled: true },
    ];
    render(<AccountManagement gateway={{ ...gateway(), list: vi.fn().mockResolvedValue(users), resetMfa }} session={session} />);
    // Only one usable administrator: warn that recovery needs a second one.
    expect(await screen.findByText('建議設定第二位系統管理員')).toBeInTheDocument();
    // No reset button on your own row; one on the other member's row (table + mobile list).
    expect(screen.getAllByRole('button', { name: '重設兩步驟驗證' })).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: '重設兩步驟驗證' }));
    const confirm = screen.getByRole('button', { name: '確認重設' });
    expect(confirm).toBeDisabled();
    fireEvent.change(screen.getByLabelText('原因'), { target: { value: '手機遺失' } });
    fireEvent.click(confirm);
    await waitFor(() => expect(resetMfa).toHaveBeenCalledWith({ propertyId: 'property-main', uid: 'front-1', reason: '手機遺失' }));
    expect(await screen.findByText(/已重設 Front Desk 的兩步驟驗證/)).toBeInTheDocument();
  });

  it('does not warn when two administrators can sign in', async () => {
    const users = ['admin-1', 'admin-2'].map((uid) => ({ uid, email: `${uid}@example.com`, displayName: uid, role: 'admin' as const, active: true, allowedPages: [], lastLoginAt: null, mfaEnrolled: true }));
    render(<AccountManagement gateway={{ ...gateway(), list: vi.fn().mockResolvedValue(users) }} session={session} />);
    expect((await screen.findAllByText('admin-2@example.com')).length).toBeGreaterThan(0);
    expect(screen.queryByText('建議設定第二位系統管理員')).not.toBeInTheDocument();
  });

  it('shows a failed save inside the dialog instead of behind it', async () => {
    const failing = { ...gateway(), create: vi.fn().mockRejectedValue(new Error('此電子郵件已被使用。')) };
    render(<AccountManagement gateway={failing} session={session} />);
    fireEvent.click(await screen.findByRole('button', { name: /新增使用者/ }));
    const dialog = screen.getByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('顯示名稱'), { target: { value: 'BINI' } });
    fireEvent.change(within(dialog).getByLabelText('登入電子郵件'), { target: { value: 'bini@example.com' } });
    fireEvent.change(within(dialog).getByLabelText('初始密碼'), { target: { value: 'abcd1234' } });
    fireEvent.click(within(dialog).getByRole('button', { name: '儲存' }));
    expect(await within(dialog).findByText('此電子郵件已被使用。')).toBeInTheDocument();
  });
});

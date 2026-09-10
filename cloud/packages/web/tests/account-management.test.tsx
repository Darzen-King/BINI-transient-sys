// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
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

    expect(await screen.findByText('front@example.com')).toBeInTheDocument();
    expect(screen.getByText('MFA 待設定')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '＋ 新增人員' }));
    expect(screen.queryByText('雲端備份')).not.toBeInTheDocument();
    expect(screen.getByText('甘特圖')).toBeInTheDocument();
  });

  it('submits a closed-system account through the admin gateway', async () => {
    const api = gateway();
    render(<AccountManagement session={session} gateway={api} />);
    await screen.findByText('front@example.com');
    fireEvent.click(screen.getByRole('button', { name: '＋ 新增人員' }));
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
});

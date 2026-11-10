// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { PropertyDirectoryItem } from '@bini/cloud-shared';
import { App } from '../src/App.js';
import type { StaffSession } from '../src/auth/session.js';
import type { PropertyGateway } from '../src/properties/property-gateway.js';

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const session: StaffSession = {
  uid: 'admin-1',
  email: 'admin@example.com',
  displayName: 'Admin',
  propertyId: 'P001',
  role: 'admin',
  allowedPages: ['properties'],
};

const property = (overrides: Partial<PropertyDirectoryItem> = {}): PropertyDirectoryItem => ({
  propertyId: 'P001',
  name: 'BINI Blooms',
  address: null,
  phone: null,
  note: null,
  active: true,
  currency: 'TWD',
  timezone: 'Asia/Taipei',
  role: 'admin',
  allowedPages: ['properties'],
  ...overrides,
});

function gateway(item: PropertyDirectoryItem, update = vi.fn()): PropertyGateway {
  return { list: vi.fn().mockResolvedValue([item]), create: vi.fn(), update };
}

async function openProperties(propertyGateway: PropertyGateway) {
  render(<App propertyGateway={propertyGateway} session={session} />);
  fireEvent.click(screen.getByRole('link', { name: '館別管理' }));
  await screen.findByText('BINI Blooms');
}

describe('property details behind the reservation certificate', () => {
  it('says plainly when an address or phone is missing, because the certificate cannot print one', async () => {
    await openProperties(gateway(property()));

    expect(screen.getByText('📍 尚未填寫地址（預約證明不會顯示）')).toBeInTheDocument();
    expect(screen.getByText('📞 尚未填寫電話（預約證明不會顯示）')).toBeInTheDocument();
  });

  it('saves an edited address and phone against the property an admin manages', async () => {
    const update = vi.fn().mockResolvedValue({ propertyId: 'P001', status: 'updated', updatedAt: '2026-11-10T03:00:00.000Z' });
    const propertyGateway = gateway(property(), update);
    await openProperties(propertyGateway);

    fireEvent.click(screen.getByRole('button', { name: '編輯資料' }));
    fireEvent.change(screen.getByLabelText('地址'), { target: { value: ' 新北市三重區示範路 3 號 ' } });
    fireEvent.change(screen.getByLabelText('電話'), { target: { value: '02-8888-9999' } });
    fireEvent.click(screen.getByRole('button', { name: '儲存' }));

    await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
    expect(update.mock.calls[0]?.[0]).toMatchObject({
      propertyId: 'P001',
      name: 'BINI Blooms',
      address: '新北市三重區示範路 3 號',
      phone: '02-8888-9999',
      note: null,
    });
    expect(await screen.findByText('館別資料已儲存')).toBeInTheDocument();
    // The list is read again, so the page shows what was actually stored rather than what was typed.
    await waitFor(() => expect(propertyGateway.list).toHaveBeenCalledTimes(2));
  });

  it('prefills the dialog from the stored details and keeps a cleared field empty, not blank text', async () => {
    const update = vi.fn().mockResolvedValue({ propertyId: 'P001', status: 'updated', updatedAt: '2026-11-10T03:00:00.000Z' });
    await openProperties(gateway(property({ address: '台北市中山區示範路 1 號', phone: '02-1234-5678', note: '總館' }), update));

    fireEvent.click(screen.getByRole('button', { name: '編輯資料' }));
    expect(screen.getByLabelText('地址')).toHaveValue('台北市中山區示範路 1 號');
    expect(screen.getByLabelText('電話')).toHaveValue('02-1234-5678');

    fireEvent.change(screen.getByLabelText('電話'), { target: { value: '   ' } });
    fireEvent.click(screen.getByRole('button', { name: '儲存' }));

    await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
    expect(update.mock.calls[0]?.[0]).toMatchObject({ phone: null, note: '總館' });
  });

  it('reports a refused edit instead of claiming the details were saved', async () => {
    const update = vi.fn().mockRejectedValue(new Error('只有管理員可執行此操作。'));
    await openProperties(gateway(property(), update));

    fireEvent.click(screen.getByRole('button', { name: '編輯資料' }));
    fireEvent.change(screen.getByLabelText('地址'), { target: { value: '新北市' } });
    fireEvent.click(screen.getByRole('button', { name: '儲存' }));

    expect(await screen.findByText('只有管理員可執行此操作。')).toBeInTheDocument();
    expect(screen.queryByText('館別資料已儲存')).not.toBeInTheDocument();
  });

  it('offers no edit to an account that only has a lesser role in the property', async () => {
    await openProperties(gateway(property({ role: 'front_desk' })));

    expect(screen.queryByRole('button', { name: '編輯資料' })).not.toBeInTheDocument();
  });
});

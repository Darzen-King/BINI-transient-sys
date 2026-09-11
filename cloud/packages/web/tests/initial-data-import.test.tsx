// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { V3BackupPrepareResult } from '@bini/cloud-shared';

import type { StaffSession } from '../src/auth/session.js';
import { LocaleProvider } from '../src/i18n/locale.js';
import type { DataImportGateway } from '../src/migration/data-import.js';
import { InitialDataImport } from '../src/migration/InitialDataImport.js';

const session: StaffSession = {
  uid: 'admin-1',
  email: 'admin@example.com',
  displayName: 'Administrator',
  propertyId: 'property-main',
  role: 'admin',
  allowedPages: ['rooms'],
};

const batchId = 'a'.repeat(64);

function backup(): string {
  return JSON.stringify({
    exported_at: '2026-09-12 08:00',
    schema_version: '3.5',
    properties: [{ id: 'P001', name: 'BINI' }],
    rooms: [{ id: '201', status: '可入住', next_booking: '2020-01-01 10:00' }],
    bookings: [{ id: 'RSV-1', room: '201', amount: 1_200 }],
    active_stays: [],
    stay_logs: [],
    activity_logs: [],
    payments: [],
    cashier_sessions: [],
    cost_entries: [],
    maintenance_schedules: [],
    monthly_rentals: [],
    holiday_cache: [],
    users: [],
    report_summary: [],
  });
}

function prepareResult(): V3BackupPrepareResult {
  return {
    batchId,
    status: 'ready',
    transformVersion: 1,
    report: {
      valid: true,
      sourceRowCount: 3,
      preparedRowCount: 3,
      tables: [{ sourceTable: 'rooms', targetCollection: 'rooms', sourceCount: 1, preparedCount: 1 }],
      amountTotalsNts: { bookings: { amountNts: 1_200 } },
      errors: [],
      warnings: [],
    },
  };
}

function gateway(): DataImportGateway {
  return {
    stage: vi.fn().mockResolvedValue({ batchId, status: 'complete', rowCount: 3, duplicate: false }),
    prepare: vi.fn().mockResolvedValue(prepareResult()),
  };
}

afterEach(() => cleanup());

describe('initial v3 data import', () => {
  it('stages a sanitized backup and requests a server reconciliation report without promotion', async () => {
    const api = gateway();
    render(<LocaleProvider><InitialDataImport session={session} gateway={api} /></LocaleProvider>);
    const file = new File([backup()], 'bini_blooms_backup.json', { type: 'application/json' });
    Object.defineProperty(file, 'text', { value: vi.fn().mockResolvedValue(backup()) });

    fireEvent.change(screen.getByLabelText('選擇 Dropbox 備份檔'), { target: { files: [file] } });
    await screen.findByRole('button', { name: '建立 DEV 匯入暫存批次' });
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: '建立 DEV 匯入暫存批次' }));

    await waitFor(() => expect(api.stage).toHaveBeenCalledWith(expect.objectContaining({
      propertyId: 'property-main',
      fileName: 'bini_blooms_backup.json',
      content: expect.not.stringContaining('next_booking'),
    })));
    fireEvent.click(await screen.findByRole('button', { name: '產生 DEV 轉換與對帳報告' }));
    await waitFor(() => expect(api.prepare).toHaveBeenCalledWith({ propertyId: 'property-main', batchId }));
    expect(await screen.findByText('對帳通過，資料已準備完成')).toBeInTheDocument();
    expect(screen.getByText(/尚未寫入正式營運 collections/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /promotion|正式匯入/i })).not.toBeInTheDocument();
  });

  it('does not expose the import workflow to non-admin staff', () => {
    render(<LocaleProvider><InitialDataImport session={{ ...session, role: 'manager' }} gateway={gateway()} /></LocaleProvider>);
    expect(screen.getByText('權限不足')).toBeInTheDocument();
    expect(screen.queryByLabelText('選擇 Dropbox 備份檔')).not.toBeInTheDocument();
  });
});

// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { v3PromotionConfirmationForBatch, type V3BackupPrepareResult } from '@bini/cloud-shared';

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
    promote: vi.fn().mockResolvedValue({ batchId, status: 'promoted', transformVersion: 1, documentCount: 3 }),
  };
}

afterEach(() => cleanup());

describe('initial v3 data import', () => {
  it('names production as the target on the production site', async () => {
    render(<LocaleProvider><InitialDataImport environment="prod" gateway={gateway()} session={session} /></LocaleProvider>);
    const file = new File([backup()], 'bini_blooms_backup.json', { type: 'application/json' });
    Object.defineProperty(file, 'text', { value: vi.fn().mockResolvedValue(backup()) });

    expect(screen.getByText('從單機版 Dropbox 備份搬入 Firebase 正式環境')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('選擇 Dropbox 備份檔'), { target: { files: [file] } });
    expect(await screen.findByRole('button', { name: '建立正式環境匯入暫存批次' })).toBeInTheDocument();
    expect(screen.queryByText(/DEV/)).not.toBeInTheDocument();
  });

  it('stages a sanitized backup, requests reconciliation, and keeps promotion disabled until the phrase is typed', async () => {
    const api = gateway();
    render(<LocaleProvider><InitialDataImport session={session} gateway={api} /></LocaleProvider>);
    const file = new File([backup()], 'bini_blooms_backup.json', { type: 'application/json' });
    Object.defineProperty(file, 'text', { value: vi.fn().mockResolvedValue(backup()) });

    fireEvent.change(screen.getByLabelText('選擇 Dropbox 備份檔'), { target: { files: [file] } });
    await screen.findByRole('button', { name: '建立DEV匯入暫存批次' });
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: '建立DEV匯入暫存批次' }));

    await waitFor(() => expect(api.stage).toHaveBeenCalledWith(expect.objectContaining({
      propertyId: 'property-main',
      fileName: 'bini_blooms_backup.json',
      content: expect.not.stringContaining('next_booking'),
    })));
    fireEvent.click(await screen.findByRole('button', { name: '產生DEV轉換與對帳報告' }));
    await waitFor(() => expect(api.prepare).toHaveBeenCalledWith({ propertyId: 'property-main', batchId }));
    expect(await screen.findByText('對帳通過，資料已準備完成')).toBeInTheDocument();
    expect(screen.getByText(/尚未寫入正式營運 collections/)).toBeInTheDocument();
    const promote = screen.getByRole('button', { name: '確認並寫入 Firebase DEV' });
    expect(promote).toBeDisabled();
    expect(api.promote).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText('正式匯入確認字串'), { target: { value: v3PromotionConfirmationForBatch(batchId) } });
    expect(promote).toBeEnabled();
    fireEvent.click(promote);
    await waitFor(() => expect(api.promote).toHaveBeenCalledWith({
      propertyId: 'property-main',
      batchId,
      confirmation: v3PromotionConfirmationForBatch(batchId),
    }));
    expect(await screen.findByText('DEV匯入完成')).toBeInTheDocument();
  });

  it('re-imports a newer backup in replace mode with its own confirmation phrase and explains a refused first import', async () => {
    const api = gateway();
    api.promote = vi.fn()
      .mockRejectedValueOnce(new Error('拒絕覆寫既有營運資料：properties/property-main/auditLogs/v3-activity_logs-1'))
      .mockResolvedValueOnce({ batchId, status: 'promoted', transformVersion: 1, documentCount: 3, mode: 'replace', overwrittenCount: 2, removedCount: 5, snapshotCount: 7 });
    render(<LocaleProvider><InitialDataImport session={session} gateway={api} /></LocaleProvider>);
    const file = new File([backup()], 'bini_blooms_backup.json', { type: 'application/json' });
    Object.defineProperty(file, 'text', { value: vi.fn().mockResolvedValue(backup()) });
    fireEvent.change(screen.getByLabelText('選擇 Dropbox 備份檔'), { target: { files: [file] } });
    await screen.findByRole('button', { name: '建立DEV匯入暫存批次' });
    fireEvent.click(screen.getAllByRole('checkbox')[0]!);
    fireEvent.click(screen.getByRole('button', { name: '建立DEV匯入暫存批次' }));
    fireEvent.click(await screen.findByRole('button', { name: '產生DEV轉換與對帳報告' }));
    await screen.findByText('對帳通過，資料已準備完成');

    fireEvent.change(screen.getByLabelText('正式匯入確認字串'), { target: { value: v3PromotionConfirmationForBatch(batchId) } });
    fireEvent.click(screen.getByRole('button', { name: '確認並寫入 Firebase DEV' }));
    expect(await screen.findByText(/請在下方選擇「以此備份取代DEV營運資料」/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('radio', { name: '以此備份取代DEV營運資料' }));
    expect(screen.getByText('將以此備份取代DEV營運資料')).toBeInTheDocument();
    const replace = screen.getByRole('button', { name: '確認取代 Firebase DEV營運資料' });
    // The first-import phrase does not unlock a replacement.
    fireEvent.change(screen.getByLabelText('正式匯入確認字串'), { target: { value: v3PromotionConfirmationForBatch(batchId) } });
    expect(replace).toBeDisabled();
    fireEvent.change(screen.getByLabelText('正式匯入確認字串'), { target: { value: v3PromotionConfirmationForBatch(batchId, 'replace') } });
    fireEvent.click(replace);
    await waitFor(() => expect(api.promote).toHaveBeenLastCalledWith({ propertyId: 'property-main', batchId, confirmation: v3PromotionConfirmationForBatch(batchId, 'replace'), mode: 'replace' }));
    expect(await screen.findByText(/覆蓋 2 筆、移除 5 筆（事前快照 7 筆）/)).toBeInTheDocument();
  });

  it('does not expose the import workflow to non-admin staff', () => {
    render(<LocaleProvider><InitialDataImport session={{ ...session, role: 'manager' }} gateway={gateway()} /></LocaleProvider>);
    expect(screen.getByText('權限不足')).toBeInTheDocument();
    expect(screen.queryByLabelText('選擇 Dropbox 備份檔')).not.toBeInTheDocument();
  });
});

import {
  inspectV3BackupText,
  serializeV3BackupForStaging,
  V3_BACKUP_MAX_BYTES,
  type V3BackupInspection,
} from '@bini/cloud-shared';
import { useState, type ChangeEvent } from 'react';

import type { StaffSession } from '../auth/session.js';
import { Button, Notice, SectionCard } from '../design-system/index.js';
import { useLocale } from '../i18n/locale.js';
import { sha256Hex, type DataImportGateway, type V3BackupStageResult } from './data-import.js';

interface SelectedBackup {
  fileName: string;
  content: string;
  checksumSha256: string;
  inspection: V3BackupInspection;
}

export function InitialDataImport({ session, gateway }: { session: StaffSession; gateway: DataImportGateway | undefined }) {
  const { text } = useLocale();
  const [selected, setSelected] = useState<SelectedBackup | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<V3BackupStageResult | null>(null);

  const selectFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    setSelected(null);
    setResult(null);
    setConfirmed(false);
    setError('');
    if (!file) return;
    if (!file.name.toLowerCase().endsWith('.json')) {
      setError(text('請選擇單機版 Dropbox 下載的 .json 備份檔。', 'Choose the .json backup downloaded from the desktop Dropbox backup.'));
      return;
    }
    if (file.size > V3_BACKUP_MAX_BYTES) {
      setError(text('備份檔超過 8 MB 上限。', 'The backup exceeds the 8 MB limit.'));
      return;
    }
    try {
      const content = await file.text();
      const inspection = inspectV3BackupText(content);
      const sanitizedContent = serializeV3BackupForStaging(inspection);
      setSelected({
        fileName: file.name,
        content: sanitizedContent,
        checksumSha256: await sha256Hex(sanitizedContent),
        inspection,
      });
    } catch (selectionError) {
      setError(selectionError instanceof Error ? selectionError.message : text('無法讀取備份檔。', 'The backup could not be read.'));
    } finally {
      event.target.value = '';
    }
  };

  const stageImport = async () => {
    if (!selected || !confirmed || !gateway) return;
    setBusy(true);
    setError('');
    setResult(null);
    try {
      setResult(await gateway.stage({
        propertyId: session.propertyId,
        fileName: selected.fileName,
        checksumSha256: selected.checksumSha256,
        content: selected.content,
      }));
    } catch {
      setError(text('匯入暫存失敗；尚未變更任何正式營運資料，請確認登入狀態後重試。', 'Staging failed. No operational data changed. Check your session and try again.'));
    } finally {
      setBusy(false);
    }
  };

  if (session.role !== 'admin') {
    return <SectionCard title={text('初始資料導入', 'Initial data import')}><Notice tone="danger" title={text('權限不足', 'Access denied')}>{text('只有管理員可以使用此功能。', 'Only administrators can use this feature.')}</Notice></SectionCard>;
  }

  return (
    <SectionCard className="initial-import" hint={text('管理員限定 · 一次性搬家', 'Admin only · One-time migration')} title={text('初始資料導入', 'Initial data import')}>
      <div className="import-intro">
        <strong>{text('從單機版 Dropbox 備份搬入 Firebase DEV', 'Move a desktop Dropbox backup into Firebase DEV')}</strong>
        <p>{text('請先在 Dropbox 下載', 'First download')} <code>bini_blooms_backup.json</code>{text('。此處不連接 Dropbox，也不儲存 Dropbox 帳密或 Token。', '. This page never connects to Dropbox or stores Dropbox credentials or tokens.')}</p>
      </div>

      <ol className="import-steps">
        <li><span>1</span><div><strong>{text('下載備份', 'Download backup')}</strong><small>{text('從原 Dropbox 的 BiniBloomsData 資料夾下載 JSON。', 'Download the JSON from the original BiniBloomsData Dropbox folder.')}</small></div></li>
        <li><span>2</span><div><strong>{text('選擇並檢查', 'Choose and inspect')}</strong><small>{text('先在瀏覽器檢查格式、筆數與排除項目。', 'Review format, row counts, and exclusions in the browser.')}</small></div></li>
        <li><span>3</span><div><strong>{text('建立暫存批次', 'Create staging batch')}</strong><small>{text('伺服器驗證 MFA／管理員與 SHA-256 後才暫存。', 'The server verifies MFA, admin access, and SHA-256 before staging.')}</small></div></li>
      </ol>

      <label className="import-file-picker">
        <span>{selected ? text('重新選擇備份檔', 'Choose another backup') : text('選擇 Dropbox 備份檔', 'Choose Dropbox backup')}</span>
        <input accept=".json,application/json" aria-label={text('選擇 Dropbox 備份檔', 'Choose Dropbox backup')} onChange={(event) => void selectFile(event)} type="file" />
      </label>
      {error ? <Notice tone="danger" title={text('無法處理備份檔', 'Unable to process backup')}>{error}</Notice> : null}

      {selected ? (
        <div className="import-preview">
          <div className="import-file-meta">
            <div><small>{text('檔名', 'File')}</small><strong>{selected.fileName}</strong></div>
            <div><small>{text('備份時間', 'Exported')}</small><strong>{selected.inspection.exportedAt}</strong></div>
            <div><small>{text('格式版本', 'Schema')}</small><strong>{selected.inspection.schemaVersion}</strong></div>
            <div><small>{text('可暫存資料', 'Rows to stage')}</small><strong>{text(`${selected.inspection.totalAuthoritativeRows} 筆`, `${selected.inspection.totalAuthoritativeRows} rows`)}</strong></div>
          </div>
          <div className="import-counts" aria-label="備份資料筆數">
            {selected.inspection.tables.map((table) => (
              <div key={table.sourceTable}><span>{table.sourceTable}</span><strong>{table.count}</strong></div>
            ))}
          </div>
          <div className="import-warning">
            <strong>{text('不導入項目', 'Excluded data')}</strong>
            <p>{text(`舊使用者 ${selected.inspection.excludedUsers} 筆、彙總報表 ${selected.inspection.excludedReportRows} 筆；密碼雜湊、備份設定與過期的房間 next_booking 快取一律排除。`, `${selected.inspection.excludedUsers} legacy users and ${selected.inspection.excludedReportRows} report rows are excluded, along with password hashes, backup settings, and stale room next_booking cache values.`)}</p>
          </div>
          {selected.inspection.warnings.length > 0 ? (
            <ul className="import-warning-list">{selected.inspection.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul>
          ) : null}
          <label className="import-confirm">
            <input checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} type="checkbox" />
            <span>{text('我已確認檔案來源與上列筆數；本次只建立 DEV 暫存批次，不會覆蓋正式營運資料。', 'I verified the source and row counts. This creates a DEV staging batch and does not overwrite operational data.')}</span>
          </label>
          <Button block disabled={!confirmed || !gateway} loading={busy} onClick={() => void stageImport()} size="lg">
            {gateway ? text('建立 DEV 匯入暫存批次', 'Create DEV staging batch') : text('需登入 Firebase DEV 才能建立批次', 'Sign in to Firebase DEV to create a batch')}
          </Button>
        </div>
      ) : null}

      {result ? (
        <Notice tone="success" title={result.duplicate ? text('此備份已暫存，未重複建立', 'This backup was already staged') : text('匯入暫存批次已建立', 'Staging batch created')}>
          {text(`批次 ${result.batchId.slice(0, 12)}…，共 ${result.rowCount} 筆。待各 domain schema 與 reconciliation 通過後，才可升級為權威資料。`, `Batch ${result.batchId.slice(0, 12)}… contains ${result.rowCount} rows. It can be promoted only after domain schema and reconciliation checks pass.`)}
        </Notice>
      ) : null}
    </SectionCard>
  );
}

import {
  inspectV3BackupText,
  serializeV3BackupForStaging,
  V3_BACKUP_MAX_BYTES,
  type V3BackupInspection,
} from '@bini/cloud-shared';
import { useState, type ChangeEvent } from 'react';

import type { StaffSession } from '../auth/session.js';
import { sha256Hex, type DataImportGateway, type V3BackupStageResult } from './data-import.js';

interface SelectedBackup {
  fileName: string;
  content: string;
  checksumSha256: string;
  inspection: V3BackupInspection;
}

export function InitialDataImport({ session, gateway }: { session: StaffSession; gateway: DataImportGateway | undefined }) {
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
      setError('請選擇單機版 Dropbox 下載的 .json 備份檔。');
      return;
    }
    if (file.size > V3_BACKUP_MAX_BYTES) {
      setError('備份檔超過 8 MB 上限。');
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
      setError(selectionError instanceof Error ? selectionError.message : '無法讀取備份檔。');
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
      setError('匯入暫存失敗；尚未變更任何正式營運資料，請確認登入狀態後重試。');
    } finally {
      setBusy(false);
    }
  };

  if (session.role !== 'admin') {
    return <section className="section-card"><h2>初始資料導入</h2><p>只有管理員可以使用此功能。</p></section>;
  }

  return (
    <section className="section-card initial-import">
      <div className="section-heading"><h2>初始資料導入</h2><span>管理員限定 · 一次性搬家</span></div>
      <div className="import-intro">
        <strong>從單機版 Dropbox 備份搬入 Firebase DEV</strong>
        <p>請先在 Dropbox 下載 <code>bini_blooms_backup.json</code>。此處不連接 Dropbox，也不儲存 Dropbox 帳密或 Token。</p>
      </div>

      <ol className="import-steps">
        <li><span>1</span><div><strong>下載備份</strong><small>從原 Dropbox 的 BiniBloomsData 資料夾下載 JSON。</small></div></li>
        <li><span>2</span><div><strong>選擇並檢查</strong><small>先在瀏覽器檢查格式、筆數與排除項目。</small></div></li>
        <li><span>3</span><div><strong>建立暫存批次</strong><small>伺服器驗證 MFA／管理員與 SHA-256 後才暫存。</small></div></li>
      </ol>

      <label className="import-file-picker">
        <span>{selected ? '重新選擇備份檔' : '選擇 Dropbox 備份檔'}</span>
        <input accept=".json,application/json" aria-label="選擇 Dropbox 備份檔" onChange={(event) => void selectFile(event)} type="file" />
      </label>
      {error ? <p className="form-error" role="alert">{error}</p> : null}

      {selected ? (
        <div className="import-preview">
          <div className="import-file-meta">
            <div><small>檔名</small><strong>{selected.fileName}</strong></div>
            <div><small>備份時間</small><strong>{selected.inspection.exportedAt}</strong></div>
            <div><small>格式版本</small><strong>{selected.inspection.schemaVersion}</strong></div>
            <div><small>可暫存資料</small><strong>{selected.inspection.totalAuthoritativeRows} 筆</strong></div>
          </div>
          <div className="import-counts" aria-label="備份資料筆數">
            {selected.inspection.tables.map((table) => (
              <div key={table.sourceTable}><span>{table.sourceTable}</span><strong>{table.count}</strong></div>
            ))}
          </div>
          <div className="import-warning">
            <strong>不導入項目</strong>
            <p>舊使用者 {selected.inspection.excludedUsers} 筆、彙總報表 {selected.inspection.excludedReportRows} 筆；密碼雜湊、備份設定與過期的房間 next_booking 快取一律排除。</p>
          </div>
          {selected.inspection.warnings.length > 0 ? (
            <ul className="import-warning-list">{selected.inspection.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul>
          ) : null}
          <label className="import-confirm">
            <input checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} type="checkbox" />
            <span>我已確認檔案來源與上列筆數；本次只建立 DEV 暫存批次，不會覆蓋正式營運資料。</span>
          </label>
          <button className="wide-primary" disabled={!confirmed || busy || !gateway} onClick={() => void stageImport()}>
            {busy ? '建立批次中…' : gateway ? '建立 DEV 匯入暫存批次' : '需登入 Firebase DEV 才能建立批次'}
          </button>
        </div>
      ) : null}

      {result ? (
        <div className="import-success" role="status">
          <strong>{result.duplicate ? '此備份已暫存，未重複建立' : '匯入暫存批次已建立'}</strong>
          <p>批次 {result.batchId.slice(0, 12)}…，共 {result.rowCount} 筆。待各 domain schema 與 reconciliation 通過後，才可升級為權威資料。</p>
        </div>
      ) : null}
    </section>
  );
}

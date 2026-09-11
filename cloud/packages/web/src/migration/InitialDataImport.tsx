import {
  inspectV3BackupText,
  serializeV3BackupForStaging,
  V3_BACKUP_MAX_BYTES,
  v3PromotionConfirmationForBatch,
  type V3BackupPrepareResult,
  type V3BackupPromotionResult,
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
  const [stageResult, setStageResult] = useState<V3BackupStageResult | null>(null);
  const [prepareResult, setPrepareResult] = useState<V3BackupPrepareResult | null>(null);
  const [promotionConfirmation, setPromotionConfirmation] = useState('');
  const [promotionResult, setPromotionResult] = useState<V3BackupPromotionResult | null>(null);

  const selectFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    setSelected(null);
    setStageResult(null);
    setPrepareResult(null);
    setPromotionConfirmation('');
    setPromotionResult(null);
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
    setStageResult(null);
    setPrepareResult(null);
    setPromotionConfirmation('');
    setPromotionResult(null);
    try {
      setStageResult(await gateway.stage({
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

  const prepareImport = async () => {
    if (!stageResult || !gateway) return;
    setBusy(true);
    setError('');
    setPrepareResult(null);
    try {
      setPrepareResult(await gateway.prepare({
        propertyId: session.propertyId,
        batchId: stageResult.batchId,
      }));
    } catch {
      setError(text('對帳準備失敗；尚未變更任何正式營運資料，請稍後重試。', 'Reconciliation preparation failed. No operational data changed. Try again later.'));
    } finally {
      setBusy(false);
    }
  };

  const promoteImport = async () => {
    if (!stageResult || !prepareResult?.report.valid || !gateway) return;
    const confirmation = v3PromotionConfirmationForBatch(stageResult.batchId);
    if (promotionConfirmation !== confirmation) return;
    setBusy(true);
    setError('');
    setPromotionResult(null);
    try {
      setPromotionResult(await gateway.promote({
        propertyId: session.propertyId,
        batchId: stageResult.batchId,
        confirmation,
      }));
    } catch {
      setError(text('正式匯入未完成。系統不會覆寫既有營運資料；請由管理員確認同一批次的狀態後再處理。', 'Promotion did not complete. Existing operational data was not overwritten; an administrator must review this same batch before proceeding.'));
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
        <li><span>4</span><div><strong>{text('轉換與對帳', 'Transform and reconcile')}</strong><small>{text('驗證 12 類資料的型別、關聯、金額與日期；不寫入營運資料。', 'Validate types, references, amounts, and dates across 12 data groups without writing operational data.')}</small></div></li>
        <li><span>5</span><div><strong>{text('確認並正式匯入', 'Confirm and promote')}</strong><small>{text('需輸入本批次確認字串，且只會寫入 Firebase DEV。', 'Type the batch confirmation phrase before writing to Firebase DEV only.')}</small></div></li>
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

      {stageResult ? (
        <div className="import-reconcile-actions">
          <Notice tone="success" title={stageResult.duplicate ? text('此備份已暫存，未重複建立', 'This backup was already staged') : text('匯入暫存批次已建立', 'Staging batch created')}>
            {text(`批次 ${stageResult.batchId.slice(0, 12)}…，共 ${stageResult.rowCount} 筆。下一步只會準備資料並產生對帳報告。`, `Batch ${stageResult.batchId.slice(0, 12)}… contains ${stageResult.rowCount} rows. The next step only prepares data and generates a reconciliation report.`)}
          </Notice>
          <Button block loading={busy} onClick={() => void prepareImport()} size="lg" variant="outline">
            {text('產生 DEV 轉換與對帳報告', 'Generate DEV transformation report')}
          </Button>
        </div>
      ) : null}

      {prepareResult ? (
        <div className="reconciliation-report">
          <Notice
            tone={prepareResult.report.valid ? 'success' : 'danger'}
            title={prepareResult.report.valid ? text('對帳通過，資料已準備完成', 'Reconciliation passed; data is prepared') : text('對帳未通過，已阻擋匯入', 'Reconciliation failed; import is blocked')}
          >
            {prepareResult.report.valid
              ? text('prepared rows 仍位於管理員限定的暫存區；目前尚未寫入正式營運 collections。', 'Prepared rows remain in the admin-only staging area and have not been written to operational collections.')
              : text(`發現 ${prepareResult.report.errors.length} 個錯誤；修正來源資料後重新建立批次。`, `${prepareResult.report.errors.length} errors were found. Correct the source data and create a new batch.`)}
          </Notice>
          <div className="reconciliation-summary">
            <div><small>{text('來源筆數', 'Source rows')}</small><strong>{prepareResult.report.sourceRowCount}</strong></div>
            <div><small>{text('已轉換筆數', 'Prepared rows')}</small><strong>{prepareResult.report.preparedRowCount}</strong></div>
            <div><small>{text('錯誤', 'Errors')}</small><strong>{prepareResult.report.errors.length}</strong></div>
          </div>
          <div className="reconciliation-table" role="table" aria-label={text('逐表對帳', 'Table reconciliation')}>
            {prepareResult.report.tables.map((table) => (
              <div role="row" key={table.sourceTable}>
                <span role="cell">{table.sourceTable}</span>
                <span role="cell">{table.sourceCount} → {table.preparedCount}</span>
              </div>
            ))}
          </div>
          {prepareResult.report.errors.length > 0 ? (
            <ul className="reconciliation-errors">
              {prepareResult.report.errors.map((issue, index) => (
                <li key={`${issue.code}-${issue.sourceTable ?? 'batch'}-${issue.sourceId ?? index}`}>
                  <strong>{issue.code}</strong> — {issue.sourceTable ? `${issue.sourceTable}/${issue.sourceId}: ` : ''}{issue.message}
                </li>
              ))}
            </ul>
          ) : null}
          {prepareResult.report.valid && stageResult ? (
            <div className="promotion-confirmation">
              <Notice tone="warning" title={text('最後確認：將寫入 Firebase DEV', 'Final confirmation: write to Firebase DEV')}>
                {text('這會把已對帳的資料寫入 DEV 營運 collections。系統會拒絕覆寫既有文件；請逐字輸入下列確認字串。', 'This writes reconciled data to DEV operational collections. Existing documents are never overwritten; type the exact phrase below.')}
              </Notice>
              <code>{v3PromotionConfirmationForBatch(stageResult.batchId)}</code>
              <label>
                <span>{text('確認字串', 'Confirmation phrase')}</span>
                <input
                  aria-label={text('正式匯入確認字串', 'Promotion confirmation phrase')}
                  autoCapitalize="characters"
                  autoComplete="off"
                  onChange={(event) => setPromotionConfirmation(event.target.value)}
                  spellCheck={false}
                  value={promotionConfirmation}
                />
              </label>
              <Button
                block
                disabled={promotionConfirmation !== v3PromotionConfirmationForBatch(stageResult.batchId)}
                loading={busy}
                onClick={() => void promoteImport()}
                size="lg"
              >
                {text('確認並寫入 Firebase DEV', 'Confirm and write to Firebase DEV')}
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}

      {promotionResult ? (
        <Notice tone="success" title={promotionResult.status === 'already_promoted' ? text('此批次已完成正式匯入', 'This batch was already promoted') : text('DEV 正式匯入完成', 'DEV promotion completed')}>
          {text(`已驗證並寫入 ${promotionResult.documentCount} 筆資料。此動作只作用於 Firebase DEV；完整 PMS 流程仍需逐項驗收。`, `${promotionResult.documentCount} verified documents were written. This affects Firebase DEV only; the full PMS workflow still requires per-feature acceptance.`)}
        </Notice>
      ) : null}
    </SectionCard>
  );
}

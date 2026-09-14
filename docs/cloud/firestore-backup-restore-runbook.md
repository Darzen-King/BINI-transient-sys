# Firestore 備份與還原操作手冊（DEV：bini-transient-dev）

## 目前的保護設定（2026-09-14 啟用）
| 項目 | 設定 |
|------|------|
| 時間點還原（PITR） | 啟用，可還原最近 7 天內任一分鐘 |
| 每日排程備份 | 每天一次，保留 7 天 |
| 每週排程備份 | 每週一，保留 14 週 |
| 刪除保護 | `(default)` 資料庫啟用 |

查看設定：

```bash
gcloud firestore databases describe --database="(default)" --project bini-transient-dev
gcloud firestore backups schedules list --database="(default)" --project bini-transient-dev
gcloud firestore backups list --location=asia-east1 --project bini-transient-dev
```

## 還原原則
- **一律還原到新的資料庫**，比對確認後再決定如何處理，絕不直接覆蓋 `(default)`。
- 還原前先記下事故發生的時間（UTC），選擇事故之前的整分鐘時間點。

## 方法 A：時間點還原（最近 7 天，建議優先）
```bash
gcloud firestore databases clone \
  --source-database="projects/bini-transient-dev/databases/(default)" \
  --snapshot-time=2026-09-13T23:19:00Z \
  --destination-database=restore-YYYYMMDD \
  --project bini-transient-dev
```

## 方法 B：從排程備份還原（7 天以前）
```bash
gcloud firestore backups list --location=asia-east1 --project bini-transient-dev
gcloud firestore databases restore \
  --source-backup=projects/bini-transient-dev/locations/asia-east1/backups/BACKUP_ID \
  --destination-database=restore-YYYYMMDD \
  --project bini-transient-dev
```

## 還原後
1. 等候作業完成：`gcloud firestore operations list --database=restore-YYYYMMDD --project bini-transient-dev` 顯示 `SUCCESSFUL`，且資料庫狀態 `progress: COMPLETED` 後約 1 分鐘才開始接受讀取。
2. 比對：逐集合核對文件數與內容（演練使用的比對腳本邏輯：列出 `properties/{館別}` 下所有子集合，比較文件 ID 與欄位雜湊）。
3. 確認資料正確後，由管理員決定：個別文件搬回 `(default)`，或改由應用程式指向新資料庫。
4. 不再需要的還原資料庫要刪除（新資料庫預設開啟刪除保護，需先關閉）：

```bash
gcloud firestore databases update --database=restore-YYYYMMDD --no-delete-protection --project bini-transient-dev
gcloud firestore databases delete --database=restore-YYYYMMDD --project bini-transient-dev
```

## 演練紀錄
| 日期 | 方式 | 結果 |
|------|------|------|
| 2026-09-14 | PITR clone（快照 2026-09-13T23:19Z）→ `restore-drill-20260914` | clone 約 15 分鐘；13 個集合、1,602 份文件的筆數與內容雜湊全部一致；演練資料庫已刪除 |

## Dropbox 異地備援（v3 格式，Firebase 故障時由單機版接手）
| 項目 | 設定 |
|------|------|
| 函式 | `dropboxV3Backup`（排程，每小時第 5 分鐘，Asia/Taipei） |
| 最新檔 | Dropbox `/BiniBloomsData/cloud_export/bini_blooms_backup.json`（每小時覆寫） |
| 每日檔 | `/BiniBloomsData/cloud_export/daily/bini_blooms_backup_YYYY-MM-DD.json`（當天最後一次覆寫，保留 30 天） |
| 授權 | Secret Manager：`DROPBOX_APP_KEY`、`DROPBOX_APP_SECRET`、`DROPBOX_REFRESH_TOKEN`（僅 Functions 讀取） |
| 狀態 | Firestore `system/dropboxBackup`（`lastSuccessAt`、`lastError`、各表筆數；用戶端不可讀） |

內容：v3 3.9.14 的 12 張資料表（欄位名稱與 v3 SQLite 完全一致）。**不含**員工帳號（v3 還原時保留本機帳號密碼）、作廢付款、封存成本。本店授權為「App 資料夾」權限，Dropbox 中實際位置為 **`應用程式/BINI_Blooms_Rental_Data/BiniBloomsData/cloud_export/`**（本機 `C:\Users\Darzen\Dropbox\應用程式\BINI_Blooms_Rental_Data\BiniBloomsData\cloud_export\`），與 v3 自己的 `bini_blooms_backup.json` 同在 `BiniBloomsData` 內。

### 緊急時由單機版接手
1. 確認雲端已停止寫入（避免兩邊同時營運）。
2. 開啟 v3 → 雲端備份設定 → 遠端路徑改為 `/BiniBloomsData/cloud_export`（每日檔則填 `/BiniBloomsData/cloud_export/daily` 並先把目標日期檔複製為 `bini_blooms_backup.json`）。
3. 按「還原」。v3 會先把本機資料備份到 `BINI_Blooms_Data/backup/`，再匯入。
4. 還原後把 v3 遠端路徑改回 `/BiniBloomsData`，避免 v3 之後的自動備份覆寫雲端匯出檔。

### 驗證紀錄
| 日期 | 內容 | 結果 |
|------|------|------|
| 2026-09-14 | 以匯出器產生 DEV 資料的 v3 JSON，用 v3 `_import_data` 還原到 v3 正式 DB 的複本 | 12 表筆數全數還原；付款 277,300、住宿紀錄 184,771、預約 130,400 與雲端一致；員工帳號保留 5→5；v3 `compute_report`（05-01～09-10）營收 448,771、訂單 166，與雲端報表相同 |
| 2026-09-14 | 部署後手動觸發排程 | 上傳成功，581,867 bytes，979 筆稽核、94 筆付款等 |
| 2026-09-14 | 檢查本機 Dropbox 同步資料夾 | `cloud_export/bini_blooms_backup.json` 與 `daily/bini_blooms_backup_2026-09-14.json` 皆 581,867 bytes；exported_at 23:27、schema 3.5、12 表筆數正確、不含 users |


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

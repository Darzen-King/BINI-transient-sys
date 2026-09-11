# Database Migration Plan：v3 Dropbox 備份首次導入 Firebase DEV

**來源：** SQLite／v3 `_export_db()` schema 3.5 JSON

**目標：** Firestore `asia-east1`／`bini-transient-dev`

**日期：** 2026-09-11

**停機：** staging 階段不需停機；最終切換需短暫凍結 v3 寫入
**回滾窗口：** promotion 後至少 7 日保留 v3 唯讀資料庫、來源 JSON 與 Firebase export

**目前資料量基準：** 2026-09-09 備份 dry-run 為 579,199 bytes、1,589 筆權威候選資料；清理後 431,817 bytes，排除 5 筆 users。正式切換前須以最新 Dropbox 檔重新建立基準。

## 1. 目標與相容性

把 Dropbox 既有 `bini_blooms_backup.json` 作為一次性搬家來源，不恢復任何日常 Dropbox 同步或憑證。來源含 12 類權威資料，以及必須排除的 users、report_summary 與 `rooms.next_booking`。目標 domain schema 尚在建立，因此先採非破壞性的 staging；權威資料 promotion 必須是另一個部署階段。

| 變更 | 相容 | 風險 | 控制 |
|---|---|---|---|
| 新增 default-deny `migrationImports` | 是 | 低 | client 無直接讀寫權 |
| 上傳並暫存 schema 3.5 JSON | 是 | 中 | MFA/admin、8 MB、10,000 筆、SHA-256、stable IDs |
| 暫存轉換為 domain 文件 | 尚未 | 高 | 每個 domain 先完成 schema、transaction 與 reconciliation |
| v4 成為唯一寫入端 | 否 | 高 | 凍結 v3、final backup、驗收、明確切換窗口 |

## 2. Expand / Stage / Promote / Contract

### Phase 1 — Expand（已實作）

- 新增 JSON inspection、12 表 mapping、穩定 legacy ID、館別補值與敏感資料排除契約；Web client 在傳輸前移除 users/password、report_summary、未知欄位與 `rooms.next_booking`。
- 新增管理員 UI 與 `adminStageV3Backup` callable。
- Firestore Rules 維持 default deny；Admin SDK 僅寫 `migrationImports/{batchId}/rows`。
- 回滾：停用 callable／隱藏 UI 即可；不影響任何權威 collection。

### Phase 2 — Stage（可執行，尚待操作員選檔）

1. 從 Dropbox 下載 `bini_blooms_backup.json`。
2. DEV 管理員登入並完成 MFA。
3. 在「初始資料導入」選檔，核對 exported_at、12 表筆數與排除清單。
4. 勾選確認並建立暫存批次。
5. 以 checksum 對應 batch；重送相同檔案不得產生第二批。

回滾：暫存批次不被營運 UI 讀取，保持 `failed`／`complete` 供稽核；不需刪除即可回復。

### Phase 3 — Reconcile + Promote（未實作，禁止提前）

- 每一 domain 實作 typed transformer、日期／金額轉換、FK 檢查與 dry-run 差異報告。
- 驗證房間、預約、入住、付款、成本、月租、維修、假日、館別與審計筆數。
- 驗證所有 booking/stay/payment room references、金額合計及時間區間。
- promotion 只由 Admin SDK 執行，使用 deterministic ID 與 migration metadata；不得由 Web client 直寫。
- 回滾：切換前建立 Firestore export；promotion 文件須帶 batchId，提供按 batch 還原或以 export 回復的演練工具。

### Phase 4 — Cutover / Contract（未實作）

- 凍結 v3 寫入，產生 final Dropbox JSON，再跑 Stage/Reconcile/Promote。
- 驗收後才讓 v4 成為唯一寫入端；v3 保留唯讀至少 7 日。
- 回滾：窗口內停止 v4 寫入、回復 promotion 前 Firestore export、解除 v3 唯讀。
- 7 日後才可封存 staging 與舊程式；不刪來源 JSON 或稽核摘要。

## 3. 驗證門檻

- 來源 JSON：schema 3.5、必要 `rooms`／`bookings` 陣列、無重複 ID、SHA-256 一致。
- 排除：舊 users/password hash/salt、report_summary、backup config/log/state、`rooms.next_booking` 為 0 筆持久化。
- 筆數：12 張來源表逐表 source = staged = transformed；任何差異均阻擋 promotion。
- 關聯：orphan room/property/booking references = 0。
- 金額：來源與目標按 table／payment type 的整數 NTS 加總完全一致。
- 時間：所有 legacy local datetime 轉為 `+08:00`，無無效日期或倒置區間。
- 安全：非 admin、未完成 MFA、錯誤 property、檔案被修改均必須拒絕。

## 4. 執行責任與 TODO

- 操作員：admin 下載檔案、核對畫面筆數、建立 staging 批次。
- Codex／Claude Code：實作 transformer、reconciliation、promotion、rollback drill 與獨立驗收。
- Gate：未完成 Phase 3 全部 domain 與還原演練，不部署 PROD、不把 v4 用於營運。

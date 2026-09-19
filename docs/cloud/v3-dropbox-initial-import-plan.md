# Database Migration Plan：v3 Dropbox 備份首次導入 Firebase DEV

**來源：** SQLite／v3 `_export_db()` schema 3.5 JSON

**目標：** Firestore `asia-east1`／`bini-transient-dev`

**日期：** 2026-09-12

**停機：** staging 階段不需停機；最終切換需短暫凍結 v3 寫入
**回滾窗口：** promotion 後至少 7 日保留 v3 唯讀資料庫、來源 JSON 與 Firebase export

**目前資料量基準：** 2026-09-09 備份 dry-run 為 579,199 bytes、1,589 筆權威候選資料；清理後 431,817 bytes，排除 5 筆 users。正式切換前須以最新 Dropbox 檔重新建立基準。

## 1. 目標與相容性

把 Dropbox 既有 `bini_blooms_backup.json` 作為一次性搬家來源，不恢復任何日常 Dropbox 同步或憑證。來源含 12 類權威資料，以及必須排除的 users、report_summary 與 `rooms.next_booking`。promotion 程式採獨立受控階段；它不代表完整 PMS domain、切換或還原演練已完成。

| 變更 | 相容 | 風險 | 控制 |
|---|---|---|---|
| 新增 default-deny `migrationImports` | 是 | 低 | client 無直接讀寫權 |
| 上傳並暫存 schema 3.5 JSON | 是 | 中 | MFA/admin、8 MB、10,000 筆、SHA-256、stable IDs |
| 暫存轉換為 typed domain 文件 | 是（prepared staging） | 中 | 白名單欄位、property-scoped path、逐表 reconciliation；只由受控 callable promotion |
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

### Phase 3 — Prepare + Reconcile（已實作，尚待操作員選檔）

- `adminPrepareV3Backup` 讀取同館別 staged rows，複驗 checksum／row count，套用 12 類白名單 typed transformer。
- 轉換輸出採 `properties/{propertyId}/{collection}/{documentId}`，日期轉 `+08:00` ISO、金額限整數 NTS、SQLite boolean 轉布林。
- 驗證逐表筆數、來源 identity、room／booking FK、允許狀態及重複 active stay／active monthly rental。
- 只有 reconciliation 全數通過才寫入 `preparedRows`；失敗批次標記 `blocked`。兩者皆位於 default-deny staging，不會影響營運資料。
- Web UI 顯示 source／prepared／error 摘要與逐表報告；對帳通過才會顯示批次專屬確認字串與 DEV promotion 控制。

回滾：prepare 只新增 staging 文件，不被營運 UI 讀取；停用 callable／隱藏 UI 即可，不需改動權威 collections。

### Phase 4 — Promote（已部署 DEV；尚未對真實資料執行）

- `adminPromotePreparedV3Backup` 只由 MFA + property admin 呼叫，要求輸入 `PROMOTE <batch-prefix>`（取代模式為 `REPLACE <batch-prefix>`）；Web client 不可直寫權威 collection。
- callable 重新檢查 `ready` 批次的 property、checksum、transform version、來源／prepared 實際筆數、reconciliation、逐表計數、target path 與 migration metadata。所有 path 由 mapping 重建，不能信任 staged path 字串。
- promotion 以 350 筆 transaction chunks 寫入 deterministic documents，僅允許不存在的文件；同 batch 且內容完全相同的文件才可安全續作，任何既有不同文件都會 fail closed。預先建立的 cloud property root 是唯一窄例外：保留其 `name`／`active`／`currency`／`timezone` 設定，僅一次性附加 legacy property 資料到 `legacyV3Import`；批次保留 attempt／lease／failure／complete metadata，並寫 audit。
- `adminPromotePreparedV3Backup` 已部署至 `bini-transient-dev` 的 `asia-east1`；**尚未執行任何真實 Dropbox 資料 promotion。** promotion 程式不是 rollback；切換前 Firestore export、按批次 restore drill、v3 凍結與操作員驗收仍是必要 gate。

### Phase 5 — Cutover / Contract（未實作）

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
- Codex／Claude Code：prepare/reconciliation 與受控 promotion 已完成；接續完成 Firestore export／restore drill 與獨立驗收。
- Gate：未完成 Phase 4 全部 domain 與還原演練，不部署 PROD、不把 v4 用於營運。

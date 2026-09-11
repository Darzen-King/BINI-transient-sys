# v3 桌面版到 v4 Firebase 移轉 Runbook

## 不變原則

- v3 SQLite 與 v4 Firebase 在切換前互不改寫；Phase 1 不碰既有營運資料。
- DEV 與 PROD 為兩個不同 project；DEV 為 `bini-transient-dev`，PROD 為 `bini-transient`，測試電腦只允許 DEV。
- 同一時刻只能有一個權威寫入來源，不採長期雙寫，避免付款與房態分歧。
- 每一階段都要有可驗證輸出與回復路徑。

## TODO Tree

```text
Phase 1 foundation（本次）
├─ shared operation contract
├─ server-only processor skeleton
├─ Firestore Rules + Emulator tests
└─ mobile-first PWA shell

Phase 2 full-domain implementation
├─ all-entity schema mapping and stable migration IDs
├─ inspect and stage v3 schema 3.5 Dropbox JSON (admin + MFA + SHA-256)
├─ rooms / gantt projections
├─ bookings / stays / monthly rentals / payments handlers
├─ housekeeping / maintenance handlers
├─ reports / costs / holidays / properties / audit handlers
├─ pricing and accounting parity tests against v3
└─ offline queue and conflict UX

Phase 2.5 full-interface parity
├─ desktop: preserve every v3 page, top navigation and workflow
├─ mobile: adaptive view for every authorized function
├─ shared controllers / queries / operations, separate view components only
└─ per-page desktop screenshot + 320/375/430px mobile QA

Phase 3 DEV provision（基礎設施完成）
├─ [完成] 確認 DEV / PROD project 與建立 DEV Web App
├─ [完成] DEV Hosting 預覽與 fail-closed 部署防呆
├─ [完成] Firestore asia-east1 / Native / delete protection
├─ [完成] Email/password、關閉註冊、TOTP MFA 設定
├─ [完成] Auth / Firestore Rules / account Functions 部署
├─ [完成] bootstrap admin + 密碼設定信
└─ [完成] reviewed DEV deployment workflow

Phase 4 pilot
├─ export sanitized v3 snapshot
├─ import into DEV and reconcile counts/totals
├─ test PC + mobile scenario suite
└─ security / restore / concurrency drills

Phase 5 production cutover
├─ create named PROD project
├─ freeze v3 writes and final backup
├─ final import + reconciliation sign-off
├─ enable v4 writes
└─ monitor and retain v3 read-only rollback copy
```

## 驗收門檻

- 筆數：rooms、guests、bookings、stays、payments 與來源一致。
- 金額：每日／每月付款與成本加總一致；抽樣訂單計價一致。
- 狀態：房態、入住、退房、取消、no-show 對照一致。
- 並行：兩裝置修改同一實體時，一筆成功、另一筆明確 conflict，不可靜默覆蓋。
- 權限：跨物業、停權、未登入、前端直寫皆被 Emulator 拒絕。
- 身分：未驗證 email、未以 MFA 登入、自助註冊、非 admin 帳號管理皆被拒絕。
- 回復：在演練環境完成 Firebase 匯出／還原與 v3 read-only 回復流程。
- 介面：`v3-v4-full-parity-matrix.md` 每一列均達「已完成」；不得以 foundation demo 或單一房間總覽代替全產品驗收。

## 尚需專案擁有者決定

1. 預計試營運日期與可接受的正式切換停機窗口。
2. 遺失驗證器時由哪位第二管理員執行 MFA 恢復（正式試營運前至少要有兩名 admin）。

## 已確認 Firebase 資源（2026-09-10）

- DEV project ID：`bini-transient-dev`；DEV Web App：`BINI Transient DEV Web`。
- DEV Hosting 預覽站：`https://bini-transient-dev.web.app`。
- PROD project ID：`bini-transient`；僅確認存在，未部署、未修改。
- Firestore `(default)` 已建立於 `asia-east1`，Native mode / Standard edition / delete protection。
- Identity Platform 已啟用 email/password、email enumeration protection、TOTP MFA；一般使用者註冊與自助刪除均停用。
- 首位 admin 信箱：`biniblooms250808@gmail.com`；只允許一次性 server-side bootstrap。
- 本機部署命令只允許明確 DEV project；不存在 PROD 部署 script。

## 單機版資料取捨

- 詳細盤點見 `v3-current-state-inventory.md`。
- 不移轉 `backup_state`、`backup_logs`、`backup_config`、Dropbox 等憑證、本機 password hash/salt/session key。
- 可使用原 Dropbox `bini_blooms_backup.json` 作為一次性來源檔；先寫入 `migrationImports` 暫存區，reconciliation 全數通過後才可 promotion，禁止直接從瀏覽器寫權威 collection。
- 不把 `Room.next_booking` 與 `report_summary` 當權威資料；前者由未來有效預約即時計算，後者由交易資料投影。
- 現有 rooms、bookings、monthly rentals 的 `property_id` 為空，匯入 DEV 時統一映射到 `property-main`，並在 reconciliation 明確驗證。

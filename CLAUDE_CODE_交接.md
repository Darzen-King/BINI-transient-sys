# CLAUDE CODE 交接 — v3.9.14 + Firebase v4 DEV

## 2026-09-12 Firebase v4／封閉式員工 Auth／手機介面交接（Unreleased）

### 已完成範圍

- 工作分支：`superpowers/firebase-cloud-v4-foundation`；`VERSION` 維持 3.9.14，未修改 v3 SQLite schema 或桌面營運流程。
- Firebase：DEV `bini-transient-dev`；PROD `bini-transient`（顯示名稱 `BINI-Transient`）。只部署 DEV，PROD 未部署、未修改。
- DEV Firestore `(default)`：`asia-east1`、Native mode、Standard edition、delete protection。
- Identity Platform：email/password、email enumeration protection、關閉公開註冊／自助刪除、TOTP MFA 強制流程。
- DEV Hosting、Firestore Rules/indexes、十一個 Node.js 22 Functions 已部署；網址：`https://bini-transient-dev.web.app`。
- 首位 admin `biniblooms250808@gmail.com` 已以 server-side bootstrap 建立，`emailVerified=true`、active、`property-main/admin`、17 個頁面權限、`mfaRequired=true`，並已寄出繁中一次性密碼設定信。
- 實際 Web SDK 設定與 alias 保存在 Git 忽略的 `cloud/.env.local`、`cloud/.firebaserc`；禁止提交或輸出內容。

### 產品範圍校正（2026-09-10）

- 專案擁有者要求的是 v3.9.14 **全部介面與全部功能**搬到 Firebase，不是只做房間總覽，也不是只做一個核心流程。
- `>= 1100px` 桌機版須保留 v3 頂部導覽、頁面名稱、表格／卡片、欄位與流程；現有 `App.tsx` 的側欄／展示資料只是 foundation，不是最終桌機設計。
- 手機版才改為適合小螢幕的完整 adaptive views；可拆 view component，但 controller、query、operation、計價與權限必須和桌機共用。
- 完整逐頁契約見 `docs/cloud/v3-v4-full-parity-matrix.md`。除已確認以 Firebase 平台機制替代的外部備份／桌面更新頁外，不得自行刪減 Prototype Hub、甘特圖、報表、成本、假日、審計等低頻功能。

### 單機版盤點與雲端取捨

- 詳細證據：`docs/cloud/v3-current-state-inventory.md`。實際安裝版為 3.9.14；唯讀盤點 5 位啟用使用者、6 間房、97 筆預約、34 筆月租等資料。
- 保留：角色、每人可見分頁、館別、假日／計價、房態、預約、入住／退房、付款、清潔、維修、報表與 audit。
- 不移轉：本機 password hash/salt、session key、`backup_state`、`backup_logs`、`backup_config`、Dropbox/WebDAV/FTP/Google Drive 憑證。
- 網路版以 Firestore 為即時權威資料源，UI 不提供單機版日常自動備份／同步／還原入口；唯一例外是 admin 的一次性「初始資料導入」，可選取 Dropbox 下載的 v3 JSON。Firebase 備援與匯出策略屬平台維運，不是營運頁面功能。
- v3 的 `Room.next_booking` 與 `report_summary` 不作權威匯入；下一筆預約即時計算，報表由交易資料投影。
- 現有 rooms/bookings/monthly rentals 的 `property_id` 為空，DEV 匯入時固定映射到 `property-main` 並納入 reconciliation。

### 架構與安全邊界

- `packages/shared` 是 operation 與 staff contract 單一來源。
- Web client 只能建立 append-only `operationRequests/{operationId}` 或呼叫明確授權的 callable；authoritative collections 對 client/admin 前端一律不可直接寫。
- `processOperationRequest` 位於 `asia-east1`，具 UUID idempotency、`baseVersion` conflict、transaction result 與 audit。
- 所有 PMS access 要求：email verified、當次登入 token 含 TOTP second-factor、profile active、具 property role。
- 帳號管理 callables：`adminListStaff`、`adminCreateStaff`、`adminUpdateStaff`、`adminSetStaffPassword`；server 端再次驗證 MFA + property admin。
- 密碼只送 Firebase Auth，不寫 Firestore/audit；重設後 revoke refresh tokens。管理員不能停用自己或移除自己的 admin 身分。
- `bookingCreate` 是第一個正式 PMS 寫入 callable：須 email verified＋當次 TOTP MFA＋active profile＋`bookings_new` page allowlist。它在單一 transaction 驗證 room、有效 booking、active stay、maintenance schedule、月租限制及 holidays，伺服器重算 v3 block-ceiling 報價，原子建立 booking／可選 deposit payment／audit／operation record；相同 UUID 加相同 fingerprint 只回傳原結果。其餘預約寫入與入住／退房／一般付款等仍未雲端化，不可誤認為已可營運。
- `bookingCancel` 是第二個正式 PMS 寫入 callable：須 email verified＋當次 TOTP MFA＋active profile＋`bookings` page allowlist。它在單一 transaction 驗證 property／booking identity／status／version，只允許 `已預約` 改為 `已取消`，並原子寫入 audit 與 operation record；相同 UUID 加相同 fingerprint 只回傳原結果。`cancellationReason` 僅允許 `manual`／`no_show`；後者寫入 `booking.no_show` audit，且只有 No-show 才進 fingerprint，保留已發布手動取消的重送相容性。v3 取消不直接異動 payment、stay 或 room。
- `bookingUpdate` 是第三個正式 PMS 寫入 callable：須 email verified＋當次 TOTP MFA＋active profile＋`bookings` page allowlist。它在單一 transaction 驗證 booking identity／status／version、目標 room、同房有效 booking（排除自身）、active stay、maintenance schedule 與 holidays；伺服器重算 v3 block-ceiling 報價後只更新 booking／version／audit／operation record，既有 payment 不變。相同 UUID 加相同 fingerprint 只回傳原結果。
- `packages/shared/src/migration/v3-transform.ts` 已完成 12 個權威 v3 table 的白名單 typed transformer：穩定 legacy ID、`property-main` 補值、property-scoped target path、Asia/Taipei 時間、SQLite boolean、整數 NTS、狀態、FK 與重複 active stay 檢查。`active_stays` 統一寫入規格中的 `stays` collection；真實備份仍待操作員從 Dropbox 下載後選檔。

### 手機 UI 與登入

- `design-system/tokens.css` + `components.css` + `components.tsx`：BINI Design System v1，採 `bds-*` 命名空間，提供 semantic tokens 與 Button／Badge／SectionCard／Field／Notice／ResponsiveDialog；新增頁面必須優先組合使用，禁止再複製主要按鈕、錯誤框或 dialog 樣式。完整規格及缺口見 `docs/cloud/bini-design-system-v1.md`。
- `i18n/locale.tsx`：手機頂部、桌機右上、登入與 MFA 共用中文／English 狀態；使用 `aria-pressed` 且 localStorage 記憶。後續每個 domain 的桌機與手機 view 必須在同一變更中補齊兩種語言。
- `AuthGate.tsx`：無註冊入口；email/password → email 驗證 → 首次 TOTP enrollment → 後續 MFA 登入 → profile/role 檢查。
- 品牌資產：登入／MFA／桌機頂部改用 `/bini-blooms-logo.png`；PWA 使用 `/pwa-192.png`、`/pwa-512.png` 與獨立 `/pwa-512-maskable.png`，另提供 Apple touch icon 與 favicon。`manifest.webmanifest`、`index.html`、`sw.js` 均已更新，舊 `/bini-mark.svg` 已移除。
- `AccountManagement.tsx`：admin 專用手機卡片與 bottom sheet，可新增、啟停、選角色、勾分頁與重設密碼。
- `App.tsx`：桌機依 v3 順序顯示 Prototype Hub＋17 個權限分頁的頂部導覽；手機為今日、預約、房務、款項、更多，且「更多」可到達全部低頻功能；沒有雲端備份，使用者管理只對 admin 顯示。
- `bookings/BookingCreatePage.tsx`：新增預約已接真實 Firebase callable；房間選項由 property-scoped listener 驗證後提供，月租房不可選；自動／手動計價、天數、折扣與選填訂金共用桌機雙欄／手機單欄表單。失敗重送須維持同一 operation ID，不能重新產生 UUID；目前沒有 multi 與前置 quote／availability UI。
- `bookings/booking-cancel.ts` + `App.tsx` 預約明細：預約清單點擊後在桌機 dialog／手機 bottom sheet 顯示相同明細；取消先二次確認再呼叫 callable，失敗重送保持同 UUID。成功後 Firestore 即時清單與房態 projection 自行移除取消預約；預覽模式明確不寫入。
- `bookings/booking-soon.ts` + `BookingSoonBanner.tsx`：全域 listener 只投影嚴格位於未來 15 分鐘內的有效預約並每 60 秒重算。保留預約僅存 sessionStorage；桌機／手機共用提醒卡與二次確認 UI，標記 No-show 後沿用 `bookingCancel`、保留 retry UUID 並由 audit 區分。尚未搬移提示音。
- `bookings/BookingEditPage.tsx` + `booking-update.ts`：從預約明細進入修改；房間／住客／電話／入住／方案／天數／折扣／自動或手動金額均預填，桌機雙欄、手機單欄共用。儲存會維持 operation UUID；成功後由即時清單反映結果。既有訂金不能在此頁修改，送出前 quote／availability 顯示仍待補。
- `styles.css`：產品／domain 版面樣式；基礎 token 已移到 design system。維持 44px target、safe-area、320／375／430px 單欄、768px 三欄、>=1100px v3 式桌機頂部導覽與三欄房卡，無水平溢位。
- 「今日房態」以單一 room view model 同步輸出兩種 view：桌機卡片直接展開 v3 詳細欄位與快捷操作；手機卡片只保留房號／狀態／摘要，點擊後於詳細面板顯示完整欄位與操作。後續接 Firestore 時不得維護兩份資料邏輯。
- `domain/room-overview.ts` + `web/src/rooms/room-overview.ts` 已接 property-scoped Firestore 即時讀取：rooms／bookings／stays／payments／maintenanceSchedules 全部取得首次 snapshot 後才輸出，且每 60 秒重算。projection 保留 v3 七種房態、active-stay 款項範圍與維修覆蓋；下一筆預約只取有效未來資料。AuthGate 才注入真實 gateway，`ui-preview` 無 gateway 時使用匿名 fixture；真實讀取失敗不回退 fixture。
- `domain/booking-list.ts` + `web/src/bookings/booking-list.ts` 已接 property-scoped Firestore 即時預約清單：僅投影 v3 有效 `已預約`、按入住時間排序，支援 booking ID／房號／姓名／電話搜尋。AuthGate 才注入真實 gateway；格式或 listener 失敗時清空清單並顯示錯誤，不能回退展示資料。這只是讀取切片，新增／編輯／取消／No-show 仍未接 transaction handler。
- `ui-preview.html` 只供本機 Vite 視覺 QA，未列入 Vite production input，Hosting build 不含該檔；不得將免登入預覽公開部署。
- `InitialDataImport.tsx` + `v3-backup.ts` + `adminStageV3Backup` + `adminPrepareV3Backup` + `adminPromotePreparedV3Backup`：本機選檔預覽、schema 3.5／大小／筆數／重複 ID 檢查；瀏覽器先剔除 users/password、report_summary、未知欄位與 `rooms.next_booking`，Functions 再做 MFA/admin／SHA-256 複驗、default-deny staging、typed transform 與 reconciliation。對帳通過後，UI 要求輸入 `PROMOTE DEV <batch-prefix>`，promotion callable 才會再驗 batch/property/checksum/version/count、每個 prepared path 與 migration metadata；除已驗證的既有雲端館別根設定外，只可 `create` 不存在的資料。既有根設定會保留 `name`／`active`／`currency`／`timezone`，legacy property 只可一次附加至 `legacyV3Import`；其餘既有不同資料 fail closed，相同 batch 的完全相同文件才可續作。成功狀態與完成 audit 在同一 transaction 寫入；批次 metadata 另記錄嘗試／失敗。尚未對真實 Dropbox 檔執行，且 rollback/export restore drill 仍未實作，不能宣稱可正式切換。
- 實際 dry-run：`bini_backup_20260909_075803.json` 為 579,199 bytes／1,589 筆，清理後 431,817 bytes；排除 5 users，password 欄位傳輸檢查 false。這只是格式相容性證據，正式匯入必須使用操作員從 Dropbox 下載的最新檔。
- Hosting 曾因 workspace Vite 未讀根目錄 `.env.local` 出現粉色空白頁；已在 `vite.config.ts` 設 `envDir: '../..'`，並新增 `guard:hosting-package`，缺少實際 DEV 設定會在部署前 fail closed。
- 線上資產 QA：首頁、manifest、favicon、Apple touch icon、三個 PWA icon 與 BINI logo 均 HTTP 200；線上 manifest 的尺寸／purpose 正確，JS bundle 引用新 logo 且無舊 `/bini-mark.svg`，Service Worker 使用新 cache 並包含品牌資產。本輪 Windows `computer-use` RPC 未配置，因此未新增自動化 Chrome 截圖。

### 驗證與部署結果

```text
npm test                       135/135 passed
npm run test:deploy-guard       6/6 passed
npm run test:rules             41/41 passed（Firestore Emulator）
npm run typecheck              passed
npm run lint                   passed
npm run build                  passed
npm run guard:functions-package passed
npm run guard:hosting-package   passed
DEV Functions                  11/11 listed, asia-east1, nodejs22
DEV bookingCreate              callable, 512 MiB, nodejs22
DEV bookingCancel              callable, 512 MiB, nodejs22
DEV bookingUpdate              callable, 512 MiB, nodejs22
DEV Hosting                    index-Bdoo7KvG.js live; bundle contains three booking callables and BookingSoon UI
DEV HTTP smoke                 home/manifest/favicon/PWA 192 icon = 200
```

Functions 會將 shared contract 用 esbuild 打入 self-contained bundle，部署 runtime dependencies 不含私有 `@bini/*` package。Firebase 部署曾提示舊 GCR build image 清理錯誤；唯讀檢查顯示 `asia.gcr.io/bini-transient-dev` repository 不存在，未發現可刪除的舊 GCR 映像。

PowerShell 呼叫 Firebase CLI 時，含逗號的 `--only` 值不可裸寫：它會被解析成多個引數。需以 `--only "hosting"` 或完整引號值執行，並於部署後核對 Hosting 的最新 bundle hash 與所需 callable 字串；本輪 `bookingUpdate` 先單獨建立，再以明確的 Hosting target 發布 `index-C8Qh8QqT.js`。

### 下一張工作單（全功能範圍）

1. 管理員完成密碼設定後登入，首次綁定 TOTP；正式 pilot 前建立第二位 admin 並演練遺失驗證器恢復。
2. promotion repository 與批次確認已完成；接續為 promotion 加入 Firestore export／按批次 restore drill，並以匿名化 snapshot 執行一次完整 DEV 匯入驗收。所有權威寫入仍須由 Admin SDK／operation processor 執行，不可由 UI 直寫 Firestore。
3. room overview 即時讀取已完成；接續完成 room status／check-in／extend／payment／checkout 的 server-authoritative operations，再依序完成 gantt → bookings → stays/transfer/monthly → payments/cashier → housekeeping/maintenance → reports/costs/holidays/properties/audit。每個 domain 要有 role matrix、payload schema、idempotency/conflict tests。
4. 每個 domain 同步交付 v3 等價桌機頁與完整手機 adaptive view；不得只做靜態畫面或無作用按鈕。
5. 加入 IndexedDB operation queue、離線／衝突 UI、App Check、預算警示、日誌與 Firestore 匯出／還原演練。
6. 使用匿名化 v3 snapshot 匯入 DEV，核對筆數、狀態、金額、`property-main` 映射與多裝置衝突。
7. 對照矩陣與 migration runbook 未全部通過前，不得切換正式資料或推進 PROD。

### 安全注意

- Firebase CLI 診斷輸出曾在本機工具記錄顯示 CLI session credential；未寫入 repo 或文件。專案擁有者應重新驗證／輪替 Firebase CLI 登入 session。
- `bootstrap:dev-admin` 硬性限制 DEV project 與指定首位 admin；重跑會再寄密碼設定信，非必要不要執行。
- 舊的 Open Design Cloud「單一核心流程」需求已被本次全產品範圍取代，不得再執行或作為驗收依據；新的工作應以完整 PMS 設計系統與逐模組手機 adaptive view 為 brief。

完整文件：`docs/cloud/v4-architecture.md`、`security-model.md`、`mobile-ui-spec.md`、`migration-runbook.md`、`v3-current-state-inventory.md`、`v3-v4-full-parity-matrix.md`。

---

日期：2026-08-25
版本：v3.9.7 → **v3.9.8**

## v3.9.8 修正紀錄（2026-08-25）

### 雲端更新未實際覆蓋版本檔

- **現象**：GitHub `main/VERSION` 已更新，但安裝目錄仍顯示 v3.9.6。
- **根因**：更新腳本使用 `robocopy /E`；若來源與目的檔案的大小及時間戳相同，robocopy 會略過檔案。
- **修正**：`app/services/updater.py` 的 robocopy 加入 `/IS`，強制包含相同檔案，確保 `VERSION` 與程式碼實際覆蓋。
- **驗證重點**：後續雲端更新應確認重啟後安裝目錄 `VERSION` 與畫面版本一致。

## v3.9.7 修正紀錄（2026-08-25）

### 新增預約房間選單顯示過期「下一筆預約」

- **症狀**：`/bookings/new` 的房間選單仍顯示已過期、已刪除或已不在有效預約清單中的 `next_booking` 時間。
- **根因**：表單直接渲染 `Room.next_booking`。該欄位是歷史上的反正規化快取，建立預約只會在新時間較早時更新；舊預約過期或由其他流程移除後，快取可能殘留。
- **修正**：新增 `app/services/bookings.py::get_next_booking_for_room()`，以目前時間即時查詢同房間最早的非取消未來預約；`app/routers/bookings.py::booking_new_form` 載入房間選項時改用此查詢。
- **驗證**：`tests/next_booking_regression_test.py` 驗證「只有過期預約時回傳空值」以及「有未來有效預約時回傳最早一筆」。
- **相容性**：保留 `Room.next_booking` 欄位與既有建立/取消流程；本次先修正新增預約頁的讀取來源，避免以舊快取污染 UI。

## 本次需求（使用者）
1. 所有資料變動（預約、入住、退房、清潔、任何與金錢相關的變動）都要自動備份。
2. 付款管理「新增付款」要能**選擇**目前在住房客帶入資料，同時**保留手動輸入**以應付例外情況。
3. 變更要記錄 CHANGELOG 與本交接文件。

---

## 1. 自動備份補齊（所有資料變動）

先前已配線 `auto_backup()` 的端點：入住 / 退房 / 延住 / 預約(新增·修改·多筆·no-show 取消) / 付款新增 / 清潔更新 / 維修更新 / 維修排程完成 / 月租(建立·退租·續租)。

本次**補齊**以下未配線端點（皆為營運或金錢資料變動）：

| 檔案 | 端點 | trigger |
|------|------|---------|
| `app/routers/costs.py` | `create_cost` / `edit_cost` / `delete_cost` | `cost` |
| `app/routers/bookings.py` | `cancel_booking`（取消預約） | `booking` |
| `app/routers/rooms.py` | `update_room`（房態更新） | `room` |
| `app/routers/rooms.py` | `do_transfer`（換房，成功時） | `transfer` |
| `app/routers/phase4.py` | `delete_payment`（付款刪除，成功時） | `payment` |
| `app/routers/phase4.py` | `close_cashier`（日結） | `cashier` |
| `app/routers/phase4.py` | `maintenance_schedule_create` / `maintenance_schedule_delete` | `maintenance` |
| `app/routers/phase4.py` | `create_property`（物業建立） | `property` |
| `app/routers/admin.py` | 假日 `add_holiday` / `delete_holiday` / `resync_holidays` | `holiday` |
| `app/routers/auth.py` | 使用者 `create_user` / `toggle_user` / `change_password` / `edit_user` / `update_profile_compat` | `user` |

> **假日備份的關鍵修正**：`HolidayCache` 先前不在備份匯出/匯入清單中，只加 `auto_backup` 觸發是不夠的（備份了卻無法還原）。已於 `app/services/backup.py` 的 `_export_db`（新增 `holiday_cache` 匯出）與 `_import_data`（新增 `HolidayCache` 還原，Integer PK → `pop_id=True`，且「payload 有 key 才還原」以免舊備份洗掉現有假日）補齊。`User` 本就在備份範圍，故帳號變動觸發備份即有效。

**設計要點**
- 全部呼叫既有的 `app/services/backup.py::auto_backup(db, trigger=...)`。
- `auto_backup` 內部只在「已設定雲端憑證 **且** `auto_backup` 開關為開」時才實際同步；否則直接 return，不影響主流程。
- `sync_backup` 內部已 try/except，備份失敗只寫 log、不會拋例外中斷結帳/退房等操作。
- `costs.py`、`bookings.py`、`rooms.py` 於檔頭 import `auto_backup as _auto_backup`；`phase4.py` 沿用該檔既有的**函式內區域 import** 風格。

---

## 2. 付款新增：選擇在住房客

- `app/routers/phase4.py::payments_page` 新增傳入 `active_stays = get_all_active_stays(db)`
  （來源：`app/services/stays.py`，回傳依房號排序的 `ActiveStay`，含 `room` / `guest` / `booking_id`）。
- `app/templates/payments.html` 新增付款視窗：
  - 頂端「選擇入住房客」下拉（`#paySelectStay`），選項帶 `data-guest` / `data-room` / `data-booking`。
  - 新增隱藏欄位 `booking_id`（`#payBookingId`）——選取房客時一併帶入，付款即可歸戶到該筆預約。
  - guest 欄位 `#payGuest`、room 欄位 `#payRoomId`。
  - JS：選房客→自動帶入 guest/room/booking；選「手動輸入」（空值）→清空 booking 連結、文字欄位維持可自由輸入。
  - 僅在有在住房客時才渲染下拉（`{% if active_stays %}`）。
- i18n（`app/i18n/zh.json`、`en.json`）：`payment.select_guest`、`payment.select_guest_hint`、`payment.manual_input`。
- 後端 `/payments/add` 原本即接受 `booking_id` 參數，無需改動；未選房客時 `booking_id` 為空字串 → 服務層轉為 `None`。

---

## 3. 版本 / 文件
- `VERSION` → `3.9.5`（單一版本來源，`main.py` 讀取）。
- `start.bat` / `install.bat` 標題字串 v3.9.4 → v3.9.5。
- `CHANGELOG.md` 新增 v3.9.5 條目。

---

## 驗證輸出（實際終端）

**typecheck（compileall）**
```
compileall: OK — no syntax/compile errors in app/
```

**build（FastAPI app 匯入）**
```
APP IMPORT: OK
total routes: 83
changed routers import: OK
```

zh/en JSON 解析：`zh.json + en.json OK`。

> 註：本專案未安裝 mypy / ruff / pyflakes，亦無 pyproject/package.json 定義的 typecheck/build 腳本；Python 專案以 `python -m compileall`（編譯期檢查）作為 typecheck、以實際匯入 FastAPI app 作為 build 驗證。專案執行用直譯器：`%LocalAppData%\Programs\Python\Python312\python.exe`（含 fastapi/uvicorn/sqlalchemy/pywebview）。

---

## 後續注意 / 未做
- 使用者帳號管理與假日設定已於本版（後續追加）納入自動備份，並補齊 `HolidayCache` 的備份匯出/匯入。
- 目前所有會變更 DB 的 POST 端點均已配線 `auto_backup`（唯 `/set-lang` 語言切換、`/login` 登入、CSV 匯出、備份頁自身操作除外——皆非業務資料變動）。
- 清潔相關的自動備份使用者特別點名——`/housekeeping/update` 先前已配線，本次確認無誤。

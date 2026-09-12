# 進度日誌

## 會話：2026-09-11—2026-09-12

### 階段 2：promotion 垂直切片恢復
- **狀態：** complete（整體階段 2 仍為 in_progress）
- 執行的操作：
  - 重新讀取完整移轉計畫、差距矩陣與既有進度，確認「prepare/reconcile 已完成但 promotion 仍禁止」是目前阻斷真實資料閉環的首要缺口。
  - 本輪將以 DEV-only、MFA + property admin、batch/version/checksum/count 重驗證、可重試冪等與稽核紀錄為界線，實作受控 promotion callable；不執行任何實際 Dropbox 資料匯入，也不部署 PROD。
  - 完成 shared promotion planner、`adminPromotePreparedV3Backup`、確認字串 UI、create-only transaction chunk、同 batch 完整內容續作、collision fail closed 與 failure/audit metadata。
  - 只讀確認 DEV 的預建 `properties/property-main` 根設定存在；修正 promotion，使它僅保留既有 cloud 設定並一次附加 `legacyV3Import`，所有其他權威文件仍維持 create-only。完成狀態與成功 audit 改在同一 transaction 寫入，避免資料已成功但 audit 失敗時誤回報失敗。
  - Functions 的 stage/prepare/promotion 三支 callable 已精準部署至 DEV `operations` codebase；Hosting 已發布 `index-CQUT3I8c.js`。Functions list 確認第 8 支 callable 位於 `asia-east1`；root-setting preserve 修正後，`adminPromotePreparedV3Backup` 已再次部署並由 `gcloud functions describe` 驗證為 `ACTIVE`、Node.js 22、1 GiB、540 秒；未執行任何真實 Dropbox JSON promotion。

### 階段 3：預約管理即時讀取／建立／取消／修改切片
- **狀態：** in_progress（讀取、單筆建立、取消與修改完成；其餘寫入流程未開始）
- 完成 shared booking list schema、有效預約狀態篩選、按入住時間排序與文字搜尋；AuthGate 已將 Firestore `properties/{propertyId}/bookings` listener 注入預約管理頁。真實 listener／資料格式失敗時清空畫面，不顯示 preview booking。
- 已重新盤點 v3 新增預約的跨 collection 衝突與日期／金額規則；確認不可把資料完整性檢查放在 client 或目前單一 entity 的通用 processor。下一個子切片為 MFA + page permission 的專屬 booking transaction callable，以及對應的可重試 operation ID。
- `bookingCreate` callable、shared booking contract／v3 價格與衝突純函式、頁面權限 helper、房間即時選單與完整新增預約頁已完成。真實寫入在同一 transaction 原子建立 booking、可選訂金 payment、audit 與 operation replay 記錄；UI 在網路重試時重用 UUID。桌機雙欄、手機單欄共用相同欄位／contract，月租房顯示但禁止選擇。尚未實作 edit/no-show/multi/前置 quote。
- `bookingCancel` callable 與預約明細 dialog/bottom sheet 已完成：僅具 `bookings` 頁面權限的 MFA 使用者可取消仍為 `已預約` 的文件，transaction 原子更新狀態／version／audit／operation replay；UI 有二次確認且網路重送維持 UUID。v3 No-show 通知、多時段與送出前 quote 仍未實作。
- `bookingUpdate` callable 與預填修改表單已完成：僅具 `bookings` 頁面權限的 MFA 使用者可更新仍為 `已預約` 的文件；server 排除自身後重算 v3 計價並檢查 booking／stay／maintenance，transaction 只更新 booking、version、audit 與 operation replay，不動既有 payment。桌機雙欄／手機單欄、重送 UUID 都共用同一 contract。v3 No-show 通知、多時段與送出前 quote 仍未實作。

### 階段 1：權威盤點與差距矩陣
- **狀態：** complete
- **開始時間：** 2026-09-11
- 執行的操作：
  - 確認上一輪已完成設計系統、雙語、GitHub 推送與 Firebase DEV 部署。
  - 建立完整單機版移轉的持久化計畫與完成定義。
  - 列出單機版與 cloud 的路由、模板、服務、資料契約、Functions、Web 與測試檔案。
  - 找到既有 v3/v4 parity matrix，準備以目前原始碼重新驗證。
  - 驗證約 75 個 v3 HTTP 端點、17 類資料模型，以及 cloud operation registry 僅有 demo handler。
  - 選定首次資料匯入「正式套用至 DEV」作為下一個端到端垂直切片。
  - 讀取匯入計畫、runbook、shared parser/mapping、staging callable 與 Web 匯入 UI。
  - 確認缺口為 typed transformer、reconciliation、promotion 與 rollback metadata。
  - 核對 v3 SQLAlchemy 欄位與 `_export_db()` schema 3.5 輸出。
  - 確認 migration target collection 與 Firestore property-scoped 路徑的層級落差。
  - 在 `C:\BiniBloomsData` 未找到來源 JSON；正式資料操作留待 Web 選檔。
- 建立/修改的檔案：
  - `task_plan.md`
  - `findings.md`
  - `progress.md`

### 階段 2：共用雲端領域基礎
- **狀態：** in_progress
- 執行的操作：
  - 選定 12 類 v3 transformer、reconciliation 與 prepare callable 為目前切片。
  - 確認沿用 property admin + MFA callable 授權與 default-deny staging 區。
  - 盤點 12 類模型欄位、備份輸出方式、房態／預約／付款狀態詞彙。
  - 接收使用者追加的品牌圖示需求，檢視 `Transient icon.png` 與 BINI 橫式 logo。
  - 確認目前雲端仍使用臨時機器人 SVG，並盤點 manifest、favicon、Service Worker、登入與導覽引用點。
  - 產生第一版 PWA icon 後發現來源棋盤格為實際像素，決定先清除背景再重新輸出。
  - 使用 imagegen background-extraction 清除棋盤背景，保存為 `cloud/packages/web/public/bini-app-icon-source.png` 並驗證 alpha。
  - 重新輸出 PWA／Apple icon 並視覺驗證 512×512 maskable 版本。
  - 完成 12 類資料白名單轉換、台北時間正規化、整數金額、狀態與關聯檢查。
  - 新增 `adminPrepareV3Backup` callable，在 default-deny staging 區產生 prepared rows 與對帳報告，不直接寫入營運資料。
  - 匯入 UI 新增「轉換與對帳」步驟、逐表筆數、錯誤清單及明確的尚未正式套用提示。
  - 將登入、驗證與桌機導覽列改用 BINI 品牌 logo，並完成 favicon、Apple touch icon、一般與 maskable PWA icon 契約。
  - DEV Functions 成功建立 `adminPrepareV3Backup` 並更新其餘 6 個 Functions；DEV Hosting 成功發布品牌與 PWA 資產。
  - 線上 manifest、JS bundle、Service Worker 與 8 個品牌／圖示 URL 驗證通過；舊機器人 SVG 已無 production 引用。
  - 同步更新 CHANGELOG、Claude Code 交接、匯入計畫、migration runbook 與全功能 parity matrix。
- 建立/修改的檔案：
  - `cloud/packages/shared/src/migration/v3-transform.ts`
  - `cloud/packages/shared/src/migration/v3-mapping.ts`
  - `cloud/packages/shared/src/index.ts`
  - `cloud/packages/shared/tests/v3-transform.test.ts`
  - `cloud/packages/functions/src/{index.ts,migration/stage-v3-backup.ts,migration/prepare-v3-backup.ts}`
  - `cloud/packages/web/public/{pwa-192.png,pwa-512.png,pwa-512-maskable.png,apple-touch-icon.png,favicon.ico,bini-blooms-logo.png}`
  - `cloud/packages/web/{index.html,public/manifest.webmanifest,public/sw.js}`
  - `cloud/packages/web/src/{App.tsx,auth/AuthGate.tsx,migration/InitialDataImport.tsx,migration/data-import.ts,styles.css}`
  - `cloud/packages/web/tests/{initial-data-import.test.tsx,mobile-layout-contract.test.ts}`

### 階段 3：前台核心營運流程（房間總覽讀取切片）
- **狀態：** in_progress
- 執行的操作：
  - 建立 shared room overview projection，從 rooms／bookings／stays／payments／maintenanceSchedules 產生同源桌機與手機資料。
  - 移植 v3 active-stay 款項範圍、七種房態、維修排程覆蓋及未來有效預約即時計算；每分鐘重算時間邊界。
  - AuthGate 真實登入時注入 Firestore gateway；無 gateway 的 `ui-preview`／測試才保留匿名預覽資料。
  - 即時讀取錯誤時 fail closed，不回退展示房間；空館別提示先完成初始資料導入。
  - 開放同館別讀取 maintenanceSchedules，維持所有 client（含 admin）不可直接寫入。
  - DEV Firestore Rules 與 Hosting 部署成功；live bundle 已確認包含即時 gateway 與 fail-closed 行為。
  - 監聽中斷後清除舊 projection 的最終修正已重新部署，live bundle `index-COsUaknt.js` 驗證通過。
- 建立/修改的檔案：
  - `cloud/packages/shared/src/domain/room-overview.ts`
  - `cloud/packages/shared/tests/room-overview.test.ts`
  - `cloud/packages/web/src/rooms/room-overview.ts`
  - `cloud/packages/web/tests/room-overview-ui.test.tsx`
  - `cloud/packages/web/src/{App.tsx,auth/AuthGate.tsx}`
  - `cloud/firestore.rules`
  - `cloud/packages/functions/tests/firestore-security.rules.test.ts`

## 測試結果
| 測試 | 輸入 | 預期結果 | 實際結果 | 狀態 |
|------|------|---------|---------|------|
| 上一輪 cloud 測試 | `npm test` | 全部通過 | 85/85，deploy guard 6/6 | 通過 |
| 上一輪 DEV 煙霧測試 | Hosting URL | HTTP 200、語系切換可保留 | 符合 | 通過 |
| 增量型別檢查 | `npm run typecheck` | 新 transformer 與品牌引用通過 | 通過 | 通過 |
| 增量 Lint | `npm run lint` | 無新增 lint 錯誤 | 通過 | 通過 |
| 本切片聚焦測試 | transformer、匯入 UI、PWA 契約 | 全部通過 | 16/16 | 通過 |
| 完整 Vitest | `npm test` | 全部通過 | 94/94 | 通過 |
| 部署防護 | `test:deploy-guard` | 只允許確認的 DEV project | 6/6 | 通過 |
| Firestore Rules Emulator | `npm run test:rules` | 權威資料 server-only、migration staging default deny | 39/39 | 通過 |
| Production build / package guards | build、Functions、Hosting | 全部通過 | 通過；僅有既有 bundle size warning | 通過 |
| DEV Functions / Hosting | `bini-transient-dev` | 新 callable 與品牌資產上線 | 7 Functions；8 個 live URL HTTP 200 | 通過 |
| 房間總覽聚焦測試 | shared projection、即時 UI、既有 mobile shell | 全部通過 | 23/23 | 通過 |
| 更新後 Rules Emulator | maintenanceSchedules 同館別唯讀、client 禁寫 | 全部通過 | 41/41 | 通過 |
| 完整 Vitest（房態切片後） | `npm test` | 全部通過 | 104/104；deploy guard 6/6 | 通過 |
| DEV Rules / Hosting（房態切片） | `bini-transient-dev` | 規則與即時 bundle 發布 | deploy complete | 通過 |
| promotion 聚焦測試 | shared planner、transform、初始匯入 UI | confirmation、precondition、same-batch resume、property root preserve、collision fail closed | 13/13 | 通過 |
| 完整 Vitest（promotion 切片後） | `npm test` | 全部通過 | 109/109；deploy guard 6/6 | 通過 |
| 更新後 Rules Emulator | `npm run test:rules` | 權威資料 server-only、migration staging default deny | 41/41 | 通過 |
| DEV Functions / Hosting（promotion 切片） | `bini-transient-dev` | 新 callable 與確認 UI 發布 | 8 Functions；首頁及 live bundle HTTP 200 | 通過 |
| 預約管理讀取切片 | shared contract、live UI、既有 mobile shell | 有效狀態、排序、搜尋、identity／schema fail-closed | 18/18 聚焦；完整 114/114 | 通過 |
| 預約建立／取消／修改切片 | shared quote/conflict、MFA/page access、UI gateway/retry | v3 多日計價、衝突、權限、operation retry、取消確認、預填修改與品牌 icon 關聯 | 建立／取消／修改聚焦測試通過；完整 131/131；Rules 41/41 | 通過 |
| DEV Functions / Hosting（預約建立／取消／修改切片） | `bini-transient-dev` | `bookingCreate`／`bookingCancel`／`bookingUpdate` callable 與最新版 PWA bundle | 11 Functions 均為 asia-east1；三個 booking callable 均為 Node.js 22／512 MiB；首頁、manifest、favicon、PWA 192 icon 及含三個 callable 的 live bundle 均 HTTP 200 | 通過 |

## 錯誤日誌
| 時間戳記 | 錯誤 | 嘗試次數 | 解決方案 |
|----------|------|---------|---------|
| 2026-09-11 | 更新規劃檔的整體補丁因段落定位不符而失敗 | 2 | 讀取實際段落後，拆成逐檔精準補丁 |
| 2026-09-12 | PowerShell alpha 檢查輸出發生整數字串串接錯誤 | 1 | 改用 `-f` 格式化字串，驗證通過 |
| 2026-09-12 | 匯入 UI 測試以說明區既有檔名作等待條件，導致過早查詢 checkbox | 1 | 改等待匯入按鈕出現後再操作 |
| 2026-09-12 | `computer-use` Windows 視覺服務未配置（`Trusted RPC service is not configured: sky`） | 1 | 停止 UI 自動化，改以線上 HTTP、manifest、圖片 metadata 與契約測試驗證 |
| 2026-09-12 | Firestore Emulator 的 8080 埠被先前測試暫時占用 | 1 | 先確認監聽程序已自行結束，再重跑 Rules，41/41 通過 |
| 2026-09-12 | PowerShell 將未加引號的 Firebase `--only` 逗號分隔值拆成多個引數，首次僅部署 Function | 1 | 保持同一 DEV target，以明確 `--only "hosting"` 單獨發布 Hosting；線上 bundle 驗證通過 |
| 2026-09-12 | room projection 接入 App 時觸發 `exactOptionalPropertyTypes`，明確 `undefined` 不符合原可選欄位 | 1 | ViewModel 可選顯示欄位明確加入 `| undefined`，不改動 domain 資料契約 |
| 2026-09-12 | listener 中斷 UI 測試的連續 microtasks 被 React 批次合併，無法觀察中間成功畫面 | 1 | 改為由測試分階段觸發 gateway callbacks，分別驗證顯示與 fail-closed 清除 |
| 2026-09-12 | 讀取舊 processor 檔案時使用了不存在的 `process-operation.ts` 路徑 | 1 | 改讀取實際的 `processor/core.ts`，維持既有 processor 架構不變 |
| 2026-09-12 | Claude Code 非互動工作程序在 30 秒內未輸出且未建立任何檔案 | 1 | 以 git diff 確認無變更後停止等待；改由目前代理直接實作並獨立驗收 |
| 2026-09-12 | 在 repo 根目錄執行 npm 驗證，該目錄沒有 package.json | 1 | 確認 Node workspace 位於 `cloud/`，後續從該目錄執行測試與建置 |
| 2026-09-12 | Windows `firebase` 解析為 `firebase.ps1`，不能直接供 `Start-Process -FilePath` 啟動 | 1 | 不視為部署成功；改由隱藏 `cmd.exe` 執行同一個精準 DEV-only deploy 指令並保留日誌 |
| 2026-09-12 | 未指定 Firebase multi-codebase 名稱的 `--only functions:<name>` 篩選找不到任何函式 | 1 | 讀取 `firebase.json` 後確認 codebase 為 `operations`；改用 `functions:operations:<name>`，仍不使用 `--force` |
| 2026-09-12 | Firebase Functions 成功建立／更新後詢問 Artifact Registry image cleanup 保留天數 | 1 | 此為額外雲端刪除／成本設定且未獲指定；在三支 function operation 成功後停止提示，不設定 cleanup policy |
| 2026-09-12 | 預約報價測試把 timestamp 傳給日期鍵函式 | 1 | 修正為先標準化 Asia/Taipei `YYYY-MM-DD`；加入跨時區／假日區塊回歸測試後通過 |

## 五問重啟檢查
| 問題 | 答案 |
|------|------|
| 我在哪裡？ | 階段 2：共用雲端領域基礎 |
| 我要去哪裡？ | 完成 12 類 transformer、reconciliation 與 prepare callable |
| 目標是什麼？ | 單機版所有介面、功能、權限與資料完整移轉至 Firebase DEV |
| 我學到了什麼？ | 見 `findings.md` |
| 我做了什麼？ | 見上方記錄 |

## 本切片交付狀態
- **狀態：** complete（整體階段 2 仍為 in_progress）
- **完成：** 12 類 v3 prepare/reconcile、受控 promotion callable、明確確認 UI、create-only 同批次續作、對帳 UI、BINI 品牌與手機 PWA icon、DEV Functions／Hosting 部署。
- **尚未做：** Firestore export/rollback drill、真實最新 Dropbox JSON 操作員匯入，以及各 PMS domain handlers／真實營運 UI。

---
*每個階段完成後或遇到錯誤時更新此檔案*

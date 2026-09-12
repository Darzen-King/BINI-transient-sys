# 發現與決策

## 需求
- 完整搬移單機版全部介面與功能至 Firebase DEV。
- 電腦版維持單機版的詳細資訊與操作完整度。
- 手機版僅調整資訊呈現與互動，不刪減功能；房卡可點開詳細資料。
- 中／EN 切換需涵蓋桌機、手機、登入與管理流程。
- Firestore 位於 `asia-east1`，專案為 `bini-transient-dev`／顯示名稱 `BINI-TRANSIENT`。
- 首位管理員為指定信箱，MFA 啟用；無公開註冊，由管理員建立帳號與權限。
- 網路版即時儲存，不需要 Dropbox 自動備份；Dropbox 備份檔僅作首次匯入來源。
- 只部署 DEV，正式環境需另外取得使用者指示。

## 研究發現
- 2026-09-11 已完成 BINI Design System v1 與共用 locale foundation，並部署 DEV。
- 目前雲端首頁與部分管理畫面仍屬 foundation／preview，不能據此宣稱完整單機版移轉完成。
- 下一步必須以單機版路由、模板、服務、資料模型對照 cloud 實作，建立權威差距矩陣。
- 單機版目前有 17 個主要 Jinja 模板，涵蓋房間、甘特圖、付款、預約、入住、延住、退房、房間管理、清潔、維修、統計、雲端備份、稽核、使用者、館別、成本與假日。
- 單機版的業務邏輯分散於 9 組 router 與 bookings／stays／payments／rooms／maintenance／reports／costs 等 service；移轉不能只複製畫面。
- cloud 現有 Functions 主要包含 staff admin、首次匯入 staging 與通用 operation processor；Web 主要包含 AuthGate、帳號管理、首次匯入及目前的營運預覽殼層。
- `docs/cloud/v3-v4-full-parity-matrix.md` 已存在，下一步需以目前原始碼逐項核對，不直接視為完成證據。
- v3 router 裝飾器盤點約 75 個 HTTP 端點；資料模型共有 17 類，其中 12 類被既有移轉規格列為 Firestore 權威來源。
- 既有 parity matrix 將登入列為已完成、房間總覽列為假資料基礎、帳號列為後端／手機管理部分完成，其餘核心業務模組多為待實作。
- cloud 的 operation registry 目前僅註冊 demo note handler；尚沒有 booking／stay／payment／room 等真實 handler。
- 首次資料匯入目前只做到 `migrationImports/{batchId}/rows` staging，尚未將資料套用至營運 collections；因此應優先完成可預演、可重跑、可 reconciliation 的 DEV 匯入套用流程。
- 既有匯入採 schema 3.5 JSON、8 MB／10,000 筆限制、SHA-256 stable batch ID、MFA + property admin 驗證，並排除舊使用者、備份憑證、report summary 與 `rooms.next_booking`。
- staging row 目前保存 `legacyJson`、來源表／ID、目標 collection／document ID；promotion 所需的 typed transformer、外鍵檢查、金額／時間 reconciliation 與回滾資訊仍未實作。
- 現有 Web 匯入頁只提供「建立暫存批次」三步流程；尚無 dry-run reconciliation 報告與管理員 promotion 確認。
- v3 `_export_db()` 直接輸出 12 類權威表，欄位與 SQLAlchemy 模型一致；金額在 SQLite 宣告為 Float，但現況規格要求匯入時只接受安全整數 NTS。
- `C:\BiniBloomsData` 目前沒有名為 `bini_blooms_backup.json` 的本機來源檔；正式匯入仍需由管理員從 Dropbox 下載後在 Web 選檔。
- migration mapping 的 `targetCollection` 是簡稱（如 `rooms`），但 Firestore Rules 的權威資料採 `properties/{propertyId}/{collection}/{docId}`；promotion 必須明確組成 property-scoped 路徑，不能寫到根 collection。
- Firestore Rules 目前只開放 rooms、guests、bookings、stays、payments 與 auditLogs 的 property-scoped 讀取；其餘 7 類匯入目標尚未有 client 讀取規則。
- `v4-architecture.md` 明定 promotion 前必須完成各 domain schema 與對帳；目前最安全且可直接推進的切片是 12 類純 transformer + prepare/reconcile callable。
- 帳號管理的 `requirePropertyAdmin` 已具 email verified、TOTP MFA、active profile 與 property admin 複驗，可沿用於匯入 prepare。
- 現有 Firestore 規則 default-deny `migrationImports`，因此 prepare 報告與 prepared rows 可由 Admin SDK 寫入而不暴露給 client；Web 透過 callable 接收受控摘要。
- v3 room status 實際詞彙包含 `可入住`、`使用中`、`即將退房`、`待清潔`、`清潔中`、`維修中`、`月租套房`；匯入時需保留原值並驗證允許集合。
- booking 非有效狀態集合為 `已取消`、`No-show`、`已入住`；下一筆預約未來應只由未取消且未入住資料即時計算。
- v3 備份的日期分為 local datetime 與純日期，boolean 採 0/1，所有權威輸出須轉成明確型別而非原樣 JSON。
- 12 類 transformer、property-scoped path、`active_stays` → `stays`、FK／重複 active stay／整數 NTS／台北時間驗證已完成；prepare 結果仍只存在 default-deny staging。
- 聚焦測試 16/16、完整 Vitest 94/94、部署防護 6/6、Firestore Rules Emulator 39/39、typecheck、lint、production build 與兩項 package guard 均通過。
- 舊文件仍把 Phase 3 全部標為未實作，且測試數仍為 78；本切片必須同步改成「prepare/reconcile 已完成，promotion 仍禁止」。
- DEV Functions 部署已建立 `adminPrepareV3Backup` 並更新其餘 6 個 Functions；DEV Hosting 已發布 12 個檔案。Firebase 部署成功但再次顯示舊 build image 清理警告，沒有自行刪除雲端資源。
- `computer-use` 的 Windows RPC 本輪未配置，無法自動擷取 Chrome 視覺證據；改採 live HTTP／asset metadata／contract tests，並把人工畫面確認留作補充而非阻擋部署。
- Firebase live function list 已確認 8 個 Node.js 22 Functions 全位於 `asia-east1`，包含 `adminPrepareV3Backup` 與 `adminPromotePreparedV3Backup`；DEV 首頁、manifest、favicon、Apple touch icon、三個 PWA icon 與 BINI logo URL 均回應 HTTP 200。
- Live manifest 已確認宣告 192／512 `any` 與 512 `maskable` PNG；部署後 JS bundle 引用 `/bini-blooms-logo.png` 且不再引用 `/bini-mark.svg`，Service Worker 新 cache 也包含全部品牌資產。
- CHANGELOG、Claude Code 交接、首次匯入計畫、migration runbook 與 parity matrix 已同步為「staging + prepare/reconcile + DEV promotion 程式已完成；真實匯入與 restore drill 待執行」。
- 未來 promotion 必須再次要求 batch `status=ready`、目前 `transformVersion`、checksum 與 prepared row count 一致，不能只依 `preparedRows` 存在就寫入權威 collections。
- `App.tsx` 的今日房態仍由檔案內固定 `rooms` 陣列驅動；桌機詳細卡片與手機詳細 dialog 已共用 `RoomViewModel`，可保留 view 並只替換 data source。
- `AuthGate` 已持有 `client.db` 與通過 MFA／館別驗證的 `StaffSession`，可建立 room overview gateway 後注入 `App`；現有 Rules 已允許同館別讀取 rooms、bookings、stays、payments 且禁止 client 寫入。
- 預覽與既有 13 項 mobile shell 測試直接 render `<App />`；新 gateway 應設為 optional，無 gateway 時保留匿名化 preview fixture，AuthGate 真實登入時才注入 Firestore gateway。
- 房態 ViewModel 應保留 v3 的七種狀態語意；下一筆預約只能從 `status=已預約` 且 `checkInAt > now` 的 booking 即時計算，不能再使用任何 `next_booking` 快取欄位。
- v3 房卡款項算法以目前 active stay 的 `created_at`（無則 check-in）為下界，或納入同 bookingId 的預先押金；已收款為一般＋押金−退款且不低於 0，押金另列，餘額為 `max(totalDue-totalPaid, 0)`。
- 今日房態還需要讀取 `maintenanceSchedules` 才能比照 v3 在排程有效期間覆蓋房態；現行 Rules 尚未宣告該 collection，下一切片需新增同館別唯讀、client 永遠不可寫的規則與 emulator 測試。
- room overview projection 已以 6 項純函式測試驗證過期預約排除、最早未來預約、v3 款項範圍、維修覆蓋、台北日界與損壞資料 fail closed；UI／舊 shell 共 15 項測試通過。
- Firestore gateway 同時監聽 5 個 property-scoped collections，全部取得首次 snapshot 後才輸出，並每 60 秒重算時間邊界，避免已過時間的「下一筆預約」殘留到下次資料異動。
- Rules Emulator 41/41 通過：maintenanceSchedules 僅同館別且 email verified + TOTP MFA 的 active member 可讀，任何 client 角色均不可直接寫。
- 本切片只改 Web/shared read projection 與 Firestore Rules；部署應執行 `deploy:dev:firestore` 和 `deploy:dev:hosting`，不需再次更新 Functions。
- DEV 已發布 Firestore Rules 與 Hosting bundle `index-CvQM9Ysu.js`；live bundle 包含 room gateway、maintenanceSchedules 與 fail-closed 文案。Bundle 中仍可找到字串 `next_booking` 是因首次匯入清理器必須辨識並剔除該來源欄位，不代表房態讀取使用快取。
- 最終 fail-closed 修正已重新發布為 bundle `index-COsUaknt.js`；live HTTP 確認即時房態、maintenanceSchedules、錯誤後不顯示 preview 及 BINI logo 皆存在。
- `adminPromotePreparedV3Backup` 已建立為程式碼切片：只有 MFA + property admin 且輸入批次專屬確認字串可觸發；它重新驗證 ready batch、checksum、version、source/prepared counts、prepared document mapping 與 migration metadata，並以 350 筆 transaction chunks 只建立不存在文件。
- read-only 檢查 DEV 確認 `properties/property-main` 是預建雲端館別根設定（`active`、`currency`、`name`、`propertyId`、`timezone`、`updatedAt`）。promotion 因此只對符合這個完整形狀、且尚未含 migration marker 的根文件一次附加 `legacyV3Import`，絕不覆寫任何既有設定；所有其他 collision 仍 fail closed。
- promotion 不會覆寫現有營運資料；相同 batch 的完整相同文件可重試續作，其他 collision fail closed。成功狀態與完成 audit 在同一 transaction 寫入；批次另保留嘗試／失敗 metadata。尚未對真實 Dropbox JSON 執行，也尚無 export/restore drill，不能視為切換完成。
- promotion Functions 與 Hosting 已部署至 DEV；live bundle `index-CQUT3I8c.js` 含 `adminPromotePreparedV3Backup`、`PROMOTE DEV` 與 BINI logo，首頁 HTTP 200。Functions 部署完成後 Firebase 詢問 Artifact Registry image cleanup policy；因其涉及額外刪除／成本策略且未獲指定，已在三個 function operation 成功後停止提示，沒有設定該 policy。
- v3 預約管理只顯示 `已預約`；`已取消`、`No-show`、`已入住` 都不得回到清單。cloud booking list 已以 shared schema 驗證 document identity／日期／整數金額，再由 AuthGate 注入 Firestore listener；資料錯誤或 listener 失敗時 fail closed。

## 技術決策
| 決策 | 理由 |
|------|------|
| 採垂直切片移轉 | 每次交付可從 UI、Functions、Rules、Firestore 到測試完整驗證 |
| 寫入操作由 server-authoritative Functions 執行 | 集中權限、交易、冪等與稽核，不讓客戶端直接拼接關鍵狀態 |
| 顯示層共用領域 ViewModel，桌機／手機只改版型 | 確保資訊與功能同源，避免手機版成為功能縮水版 |
| 下一個垂直切片先完成首次資料匯入套用 | 真實房間、預約、在住與付款資料是後續所有營運頁的共同前置條件 |
| promotion 必須分成 prepare/reconcile 與 commit 兩階段 | 高風險資料寫入需先產生可檢查報告，且不能由前端直接寫權威 collection |
| 匯入目標一律使用 property-scoped subcollections | 與既有 Rules／多館別模型一致，避免根 collection 與子 collection 雙重權威 |
| transformer 實作為 shared 純函式 | 可用備份 fixture 做 deterministic 測試，Functions 與未來 migration CLI 共用 |
| 保留 v3 狀態字串作為第一版 canonical 值 | 可避免遷移時改變業務語意；UI 翻譯層再映射顯示文字 |

## 遇到的問題
| 問題 | 解決方案 |
|------|---------|
| 尚未完成全功能權威盤點 | 本階段由原始碼與測試建立 parity matrix |
| 多數 cloud 頁面仍是 placeholder | 先補齊資料匯入與權威 read model，再逐模組替換預覽資料 |
| mapping 名稱與實際 Firestore 路徑層級不同 | transformer 輸出 collection 名稱，promotion repository 統一組合 property-scoped document path |

## 資源
- `app/`：FastAPI／Jinja2／SQLAlchemy 單機版權威來源。
- `cloud/`：Firebase v4 DEV 實作。
- `docs/cloud/`：雲端架構、手機介面與移轉規格。
- `CHANGELOG.md`、`CLAUDE_CODE_交接.md`：版本與交接紀錄。
- `docs/cloud/v3-v4-full-parity-matrix.md`：既有功能對照基線，仍須重新驗證。

## 視覺/瀏覽器發現
- 2026-09-11 DEV 登入頁已驗證中／EN 可切換且重新整理後保留。
- 上一輪桌機預覽已驗證語系切換；手機行為有元件與 layout contract 測試。
- 專案根目錄 `Transient icon.png` 是透明背景的彩色房屋圖示，適合作為 PMS App／PWA 主畫面圖示來源。
- `app/static/bini_blooms_logo.png` 是 BINI BLOOMS 花朵字樣橫式品牌標誌，適合桌機頂部導覽與登入畫面；不適合直接裁成正方形手機 icon。
- `Transient icon.png` 為 1254×1254 PNG，`icon.ico` 為 256×256；可由同一房屋圖示產生 192×192、512×512 與 Apple 180×180 圖示。
- 現有 PWA manifest、favicon、Service Worker cache、登入與頂部導覽仍引用臨時的 `/bini-mark.svg` 機器人圖示，需全部替換並更新 cache version，避免手機保留舊 icon。
- PWA manifest 目前只宣告 SVG `any maskable`；正確做法是分開提供一般 PNG 與帶安全留白的 maskable PNG。
- 產生圖示後的像素檢查確認：`Transient icon.png` 全圖 alpha=255，灰白棋盤格是烘焙背景而非透明度；不能直接作 PWA icon，需先清除背景。
- BINI 橫式 logo 已轉為真正 PNG 格式，顯示內容與來源一致。
- imagegen 背景抽離輸出 `bini-app-icon-source.png` 為 1254×1254，角落 alpha=0，房屋主體維持不透明；可作為真正透明的 PWA 圖示來源。
- 重新輸出的 512×512 maskable icon 已視覺確認為淡粉背景、房屋置中且具安全留白，無棋盤格或裁切。
- 登入／MFA／桌機頂部品牌、favicon、Apple touch icon、192／512 一般 PWA icon、512 maskable icon 與 Service Worker cache 引用已全部改為專案品牌資產；契約測試確認尺寸、PNG signature 與 manifest 宣告。

---
*每執行2次查看/瀏覽器/搜尋操作後更新此檔案*

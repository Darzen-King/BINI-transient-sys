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

> 2026-09-13 註：以下條目依發現時間累積，早期條目描述的是當時狀態（例如「operation registry 僅有 demo handler」、「DEV rooms 為 0」、「promotion 仍禁止」），已被後續切片取代。目前狀態以 parity matrix 與交接文件為準。

### 2026-09-13（Claude Code 接續 Codex）
- `task_plan.md`／`progress.md` 停在 2026-09-12 的房間管理切片，漏記之後 20 餘個已推送、已部署的切片；交接文件同時存在「DEV 0 間房」與「已匯入 6 間房」、「39／40 支 Functions」、「其餘寫入仍未雲端化」等互相矛盾的敘述，本輪已更正。
- v3 的「訂金」並非獨立調整功能，而是 `payments.html` 新增付款表單的 `is_deposit` 核取框：選在住房客時帶入 booking_id，`create_payment` 以 `deposit_create` 寫 audit。v3 `get_balance`／`_stay_payment_floor` 依 `is_deposit` 與 booking_id 或入住時間範圍納入押金。
- 雲端下游早已依 `deposit` 旗標計算：`room-overview.ts` 的 `depositPaidNts`、`close-cashier.ts` 的 `totalDepositsNts`、`checkout.ts` 免費取消的押金退款範圍（同 booking 或入住後建立）。因此只需讓 `paymentCreate` 能寫 `deposit: true`，不需新增 callable 或改投影。
- `paymentCreate` 的 fingerprint 是 `sha256(JSON.stringify({ operationType, ...input }))`。直接加欄位會使「顯式送 `deposit: false`」的請求指紋改變；做法是 `deposit` 非 true 時不納入，並以測試鎖定與舊公式逐位元相同。
- v3 維修頁有兩塊：排程表與「維修中」房卡。房卡的 resolve 呼叫 `update_room_status(..., "可入住")`，該函式離開維修狀態時會清除 `maintenance_note` 與 `maintenance_due`；雲端 resolve 必須同步清除，否則房間管理頁的「非維修房不可附帶維修欄位」契約會被既有資料打破。v3 沒有維修篩選，parity matrix 原列的「篩選待實作」不是 v3 功能。
- 雲端 `MaintenancePage` 既有 bug：`submit` 在 `await gateway.create(...)` 之後才呼叫 `event.currentTarget.reset()`；React 在處理器讓出執行後會把合成事件的 `currentTarget` 設為 null，因此每次成功建立都拋錯並顯示失敗。已掃描全部 `currentTarget` 用法：`BookingCreatePage` 有相同 bug（且會殘留 operation ID），已一併修正；`RoomManagementPage`、`AuthGate` 為同步讀取，安全。
- v3 實體刪除付款（admin）在雲端已以 `paymentVoid` 取代：保留原紀錄、原因與 audit，拒絕已退款或已日結的付款。parity matrix 已明確標註為刻意替代。
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
- v3 新增預約的寫入規則同時依賴房間狀態、有效預約、active stay、未完成維修排程、日期邊界與金額／折扣。現有通用 operation processor 只以單一 entity version 交易，無法原子鎖定這些跨 collection 的衝突來源；booking create/edit/cancel 必須改採專屬 server transaction callable，並以每次操作 ID 保持冪等。
- `bookingCreate` 已採專屬 callable 而非通用 processor：它先驗證 email＋TOTP MFA、active profile 與 `bookings_new` 細粒度頁面權限，再於單一 transaction 查詢同房 rooms／bookings／stays／maintenanceSchedules／holidays。重試時以 request fingerprint 拒絕同 operation ID 的不同 payload，並回傳原結果，不會重複建立預約、訂金或 audit。Web 表單亦會在失敗重送時保留 operation ID。
- DEV 部署後，`bookingCreate` 與既有八支 Functions 都列於 `asia-east1`；其規格為 callable、Node.js 22、512 MiB。Hosting 的最新 `index-joCnTi8P.js` 含 `bookingCreate`，首頁、manifest、favicon 與 PWA 192 icon 均回應 HTTP 200。實際營運寫入 smoke test 仍須待管理員完成 MFA 並匯入真實測試房間後，以 UI 建立一筆可取消的測試預約驗收。
- v3 的一般取消與「即將到店」提醒中的 No-show endpoint 最終都只把仍為 `已預約` 的 booking 改成 `已取消`；不會直接改付款、房間或 stay。雲端不維護 `rooms.next_booking` 快取，取消後的列表與房態將由既有 effective-booking projection 自動排除該文件。故下一個 transaction 僅需鎖定 booking／operation／audit，No-show 的 15 分鐘提醒介面則另列為後續切片。
- `bookingCancel` 已發布至 DEV：MFA／`bookings` 頁面權限通過後，transaction 會驗證 property、booking ID、受支援 status 與 version，僅將 `已預約` 改為 `已取消`，同時寫入可重播 operation 與 audit。live bundle `index-C8hgkLWM.js` 同時含 `bookingCreate`／`bookingCancel`，10 支 Functions 均在 `asia-east1`；實際資料寫入 smoke test 仍須由完成 MFA 的管理員，在匯入測試房間後自行建立並取消一筆測試預約。
- v3 修改預約以 `allow_past=True` 驗證時間，從入住／方案／天數重新推導退房與 block-ceiling 報價（僅在自動金額模式），再排除自身檢查 booking、stay 與未完成維修衝突。它只更新 booking 欄位、不調整既有訂金 payment；雲端 update transaction 必須保留此付款不變與同 booking 排除規則。
- `bookingUpdate` 已發布至 DEV：它使用 `booking.update` fingerprint／operation record，僅在 `已預約` 狀態下更新 booking 的房間、旅客、時間、計價與 version，並保留 payment。live bundle `index-C8Qh8QqT.js` 含建立／取消／修改三個 booking callable，11 支 Functions 均在 `asia-east1`；實際 MFA 寫入 smoke test 仍需在有測試資料後完成。
- v3 的即將入住只應提示仍為 `已預約`、嚴格晚於目前時間且不超過未來 15 分鐘的 booking；「保留」不能改寫資料，而 No-show 必須由操作員二次確認。雲端以 property-scoped listener 加每 60 秒重算投影，並沿用 `bookingCancel` transaction，以 `cancellationReason=no_show` 寫入 `booking.no_show` audit；手動取消既有 operation fingerprint 不變，避免舊 retry 失效。提示音尚未遷移。
- v3 入住可從有效預約帶入或建立 walk-in，會以方案／天數重新推導退房與自動金額，阻擋不可入住房、維修時段與同房有效預約；成功後建立 active stay、房間轉使用中、來源預約轉已入住，並可建立押金及 audit。舊服務會覆蓋既有 active stay，這不符合雲端多裝置安全邊界；Firebase `stayCheckIn` 必須在單一 transaction 將既有 stay 視為衝突而 fail closed，且需把 booking/stay/room/payment/audit/operation 全部鎖定。
- `stayCheckIn` 已發布至 DEV：MFA＋`checkin` 頁面權限、可入住 room、空 stay query、同房 booking／maintenance conflict、來源 booking identity 與 server quote 都在同一 transaction 驗證；成功後同步 stay／room／booking／可選 payment／audit／operation。最新 Hosting bundle `index-BwgjQ04D.js` 含四個核心 callable，12 支 Functions 均在 `asia-east1`，其中 `stayCheckIn` 為 ACTIVE、Node.js 22、512 MiB；真實資料寫入 smoke 仍須在管理員完成 MFA 並使用匯入或建立的測試資料後執行。
- v3 延住不可從目前退房時間重新起算：`extension_fee_between` 必須以入住時間的 12 小時區塊累積，否則 12h 續為 24h 會錯收新 12h 上限。雲端 `quoteStayExtension` 已以純函式重現此時間軸，client 僅用於預覽，Function 會重新計算權威金額。
- `stayExtend` 已完成本地契約／UI／Rules gate 並發布 DEV：MFA＋`extend` page allowlist、UUID fingerprint replay、room/stay identity、未來 booking 與未完成 maintenance 都在同一 transaction 內檢查；與 v3 在寫入後僅警告撞期不同，雲端必須 fail closed 以阻止跨裝置超賣。舊匯入 stay 缺少 `stayId` 欄位時以 Firestore document ID 相容識別。DEV `stayExtend` 為 ACTIVE（asia-east1、Node.js 22、512 MiB），十三個 Functions 已列出，Hosting `index-BT_q398d.js` 包含延住 callable／UI 且首頁與 manifest HTTP 200；具 MFA 的真實測試資料寫入驗收仍待執行。
- 退房權威規則已逐行盤點：在入住後 15 分鐘內為免費取消，總應收歸零、符合 stay payment scope 的未退款押金逐筆建立退款；正常退房在原本／已延住退房時間後仍有 15 分鐘緩衝，超過後以半小時向上進位，將入住時間軸累計的總延住費扣掉既有延住費，才得到本次逾時加收。人工調低該逾時費時必須同時保存系統值、實收值與減免 audit。成功退房會寫 stay log、房間轉待清潔並刪除 active stay；雲端實作必須將這些寫入封在一個 MFA＋`checkout` 授權 transaction。
- `stayCheckout` 已發布至 DEV：函式為 ACTIVE（asia-east1、Node.js 22、512 MiB），以單一 transaction 執行免費取消押金退款、退房計費、stay log、房態更新與 audit；具 MFA 的真實寫入 smoke 仍待建立或匯入測試資料後進行。
- v3 付款頁同時承擔一般收款、訂金、退款、手動例外、刪除與日結。雲端第一個安全切片只允許選擇 active stay 建立一般收款；`paymentCreate` 必須在 transaction 重新確認 property／stay／room／使用中或即將退房房態，並把 UUID fingerprint、payment 與 audit 一起寫入，不能讓 client 直接建帳務文件。
- `paymentCreate` 已發布至 DEV：函式為 ACTIVE（asia-east1、Node.js 22、512 MiB），付款頁以 property-scoped listener 顯示即時紀錄和台北當日摘要；真實 MFA 收款 smoke 仍待可用的測試在住房資料。
- 單機 `icon.ico` 與雲端 `favicon.ico` 的 SHA-256 已加入契約測試鎖定為同一檔案；行動安裝圖示維持由專案 `Transient icon.png` 清背後產生的透明來源、192／512／maskable 與 Apple Touch Icon，不會退回臨時機器人圖示。

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
| 在住房訂金以 `paymentCreate` 的選填 `deposit` 旗標實作 | 與 v3 同一表單語意；權限、交易、衝突檢查完全共用，下游投影無需改動 |
| 新增選填欄位時，預設值不進入 operation fingerprint | 保持既有重送指紋不變，避免已提交操作的重試被誤判為不同請求 |

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

## 2026-09-14 版面與雙語驗收
- 新增 `packages/web/src/preview/preview-gateways.ts`：`ui-preview.html` 以虛構 Firestore 形狀資料接上所有 gateway，並呼叫與正式版相同的 shared builder；正式 `index.html` 不引用，已確認正式 bundle 不含預覽資料。
- 以內建瀏覽器在 320／375／430／1280px 逐頁量測（DOM 幾何）：無水平溢位；發現並修正兩類「擠壓」問題（溢位量測抓不到）：手機頂列在多館別選單出現時標題被擠成直排、`SectionCard` 標題列不換行導致甘特圖標題與「定位現在」被壓扁。桌機 1280px 頂部導覽需橫向捲動，與 v3 `bb-nav`「單列、溢出橫捲」設計一致，不改。
- 雙語掃描：中文介面外露 `paid`／`pending`、`scheduled`／`in_progress`、成本分類代碼與角色代碼；英文介面外露房態與預約狀態中文代碼。統一改用 `i18n/labels.ts`（沿用 v3 `payment.status.*`、`maintenance.status_*` 等翻譯）。
- 截圖在視窗背景時會停在舊畫面，驗收以 DOM 量測為準。

## 2026-09-14 報表對帳與資料時效
- 以 `sqlite3` backup API 將 v3 正式 DB 唯讀快照到暫存區，再以 v3 `compute_report` 與雲端 `buildReportProjection`（DEV Firestore 資料）比對 2026-05-01～09-10：訂單 169 vs 166、營收 452,771 vs 448,771。逐筆比對後差異完全來自 DEV 缺少 v3 stay log 141–143（1,200＋800＋2,000＝4,000；24h×2、12h×1；假日 3,200／平日 800），扣除後各指標一致，證明報表算法已 parity。
- 結論：DEV promotion 批次約停在 2026-09-05／06。正式切換前必須做最終匯入（見 task_plan 關鍵問題 4）。
- 工具注意：Bash／Edit 工具會把字串中的 `﻿`、`\r\n` 等跳脫序列轉成實際字元；在原始碼中需要跳脫序列時，改以 Python `chr()` 寫入或 `String.fromCharCode`。

## 2026-09-14 App Check
- reCAPTCHA v3 網站金鑰（公開值）：`6Ld6_LotAAAAAPrNGcunVMWMY7sot1XuVkCiY_N6`，網域 `bini-transient-dev.web.app`、`bini-transient-dev.firebaseapp.com`、`localhost`。本機建置需在 `cloud/.env.local` 設定 `VITE_RECAPTCHA_SITE_KEY`（git-ignored），否則 `guard:hosting-package` 會擋下部署。
- 首次部署後瀏覽器顯示 `@firebase/app-check: 400 error`（token 交換失敗），推測為主控台尚未登記 reCAPTCHA 密鑰；未強制執行時不影響功能。主控台完成登記後需重新確認交換成功，觀察 1–2 週再強制執行。

## 2026-09-14 Callable 公開呼叫權限
- `adminCreateStaff`／`adminListStaff`／`adminSetStaffPassword`／`adminUpdateStaff` 的 Cloud Run 服務缺少 `allUsers → roles/run.invoker`，Cloud Run 回 401「access token could not be verified」。原因：2026-09-10 首次部署建置失敗（`@bini/cloud-shared` 404），Firebase CLI 只在「建立」時設定 invoker，後續更新不補。已以 gcloud 補上並在程式加 `invoker: 'public'`。
- 檢查方式：`gcloud run services get-iam-policy <service> --region asia-east1`；非 callable 的 `holidayautosync`（排程）與 `processoperationrequest`（Firestore 觸發）不應公開。


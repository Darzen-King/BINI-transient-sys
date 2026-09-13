# 任務計畫：BINI PMS 單機版完整移轉至 Firebase DEV

> 最後更新：2026-09-13（Claude Code 接續 Codex，依 git 紀錄 `88dc929` 之後的實際狀態重寫）。
> 權威狀態以 `docs/cloud/v3-v4-full-parity-matrix.md` 與 `CLAUDE_CODE_交接.md` 為準；本檔只記錄階段與下一步。

## 目標
將現有 FastAPI／SQLite 單機版的所有可用介面、業務功能、權限與既有資料安全移轉至 `bini-transient-dev`，電腦版維持資訊與流程同等完整，手機版提供適配小螢幕的操作方式，完成可驗證後再由使用者決定是否進入正式環境。

## 完成定義
- 建立單機版功能／路由／資料表／權限的逐項對照矩陣，所有項目都有 DEV 實作與驗收證據。
- 核心營運流程可在 DEV 使用真實 Firestore 資料完成：預約、入住、延住、退房、退款、房態、房務、維修與付款。
- 管理流程可在 DEV 完成：房間、房價、使用者與權限、館別、成本、假日、統計、稽核與首次資料匯入。
- 不提供公開註冊；管理員建立帳號與權限；MFA、App Check、Firestore Rules 與伺服器端授權可驗證。
- Dropbox 僅作為首次匯入來源，不再承擔網路版自動備份。
- 桌機與手機皆通過關鍵流程、雙語、可及性、衝突處理及部署防護驗收。
- CHANGELOG 與 Claude Code 交接文件持續同步；只部署 DEV，未經指示不得部署 PROD。

## 目前階段
階段 3／4 收尾（核心與管理 handlers 大多已接入）；階段 5 尚未開始。

## 各階段

### 階段 1：權威盤點與差距矩陣
- [x] 盤點單機版路由、模板、服務、資料模型與角色權限
- [x] 盤點 cloud 現有頁面、Functions、Rules、資料契約與測試
- [x] 建立逐功能 parity matrix 與依賴順序
- [x] 選定下一個可端到端驗收的垂直切片
- **狀態：** complete

### 階段 2：共用雲端領域基礎
- [x] 各 domain 以專屬 callable＋transaction＋UUID fingerprint replay＋append-only audit 為標準模式（取代單一 entity 的通用 processor）
- [x] 共用日期（Asia/Taipei）、整數 NTS、房態、頁面權限與 MFA 驗證 helper
- [x] Rules emulator 驗證（最近一次 47/47）
- [x] 12 類 v3 transformer、reconciliation、prepare callable
- [x] MFA/admin 確認的 promotion callable，並已於 2026-09-12 對真實 Dropbox 批次 `93ba8b3ce620…` 成功 promotion（6 rooms／97 bookings／3 stays／140 stayLogs／93 payments／34 monthlyRentals／241 holidays）
- [ ] Firestore export／按批次 restore drill
- **狀態：** in_progress（僅剩匯出／還原演練）

### 階段 3：前台核心營運流程
- [x] 房間總覽即時房態、七種房態篩選、付款／退房快捷
- [ ] 房間總覽館別切換（依賴多館別 session）
- [x] 甘特圖 14 天即時投影、房間篩選、定位現在
- [x] 預約：單筆／多時段建立、送出前 quote／availability、修改（含 preview）、取消、15 分鐘 No-show
- [ ] 預約：費率參考、即將入住提示音
- [x] 入住、延住、退房（免費取消、緩衝、逾時計價與減免 audit）
- [x] 付款：一般收款、**在住房訂金（2026-09-13，待部署）**、追加式退款、手動例外、admin 作廢（取代實體刪除）、日結、CSV
- [x] 房間管理：房態／備註、月租建立／續租／退租、換房
- [x] 清潔：待清潔 → 清潔中 → 可入住
- [x] 維修排程：建立、完成、刪除、預約衝突拒絕
- [ ] 維修：解除維修、進度備註、篩選
- [ ] 延住：超時自動偵測；退房：餘額收款提示與收據
- **狀態：** in_progress

### 階段 4：管理與報表流程
- [x] 假日管理（手動、刪除、政府重同步）
- [x] 使用者、角色與 17 頁權限（admin-only）
- [ ] MFA 遺失恢復工作流、第二位 admin
- [x] 成本 CRUD（封存取代刪除）
- [x] 統計報表 KPI／每日／房間明細／P&L／CSV
- [ ] 報表付款日摘要、圖表、完整 v3 分區
- [x] 審計軌跡唯讀即時投影與明細
- [ ] 審計日期範圍篩選、伺服器端查詢／匯出
- [x] 館別建立與清單
- [ ] 跨館別 session 切換、新館別房間初始化、館別編輯／停用
- [x] 首次資料匯入 stage → prepare → promote
- **狀態：** in_progress

### 階段 5：跨裝置、品質與交付
- [ ] 桌機版逐頁 parity 驗收（v3 對照截圖）
- [ ] 手機版 320／375／430px 關鍵流程驗收
- [ ] 中／EN、MFA、App Check、安全規則與衝突處理驗收
- [ ] IndexedDB operation queue、離線／衝突 UI
- [ ] 更新 CHANGELOG／交接、推送 GitHub、部署並煙霧測試 DEV（每切片持續進行）
- [ ] 逐項完成度稽核，確認無缺項後才標記整體完成
- **狀態：** pending

## 下一步（建議順序）
1. 部署 2026-09-13 訂金切片至 DEV（`functions:operations:paymentCreate`＋`--only "hosting"`），並核對 bundle 含 `payment.deposit_create`。
2. 維修：解除維修、進度備註與篩選。
3. 審計日期範圍篩選；報表付款日摘要。
4. 多館別 session 切換（影響房間總覽、甘特圖、報表的館別切換）。
5. 預約費率參考、提示音；延住超時自動偵測。
6. 階段 5 驗收與 export／restore drill。

## 關鍵問題
1. 多館別切換要以「重新選擇 session property」還是「全站 membership 範圍查詢」實作？需使用者確認營運上是否真的有第二館別。
2. v3 實體刪除付款已決定以作廢取代——若店家實務上仍需要真正刪除，需另行確認。
3. App Check 與離線佇列何時列入 pilot 前必要條件？

## 已做決策
| 決策 | 理由 |
|------|------|
| 僅在 `bini-transient-dev` 實作與部署 | 保護正式環境，符合既有 DEV-first 邊界 |
| 網路版以 Firestore 即時資料為主，不保留 Dropbox 自動備份 | 使用者已明確要求；Dropbox 只保留首次匯入能力 |
| 不提供公開註冊，帳號由管理員建立 | 店家內部少量使用者的既定需求 |
| 桌機維持完整資訊，手機改為響應式操作而非刪減功能 | 符合「完整功能搬移、只調整手機介面」要求 |
| 以逐功能證據矩陣判定完成 | 防止 UI 或單一模組進度被誤認為完整移轉 |
| 匯入依序採 stage → reconcile → promote | 在任何營運資料寫入前先驗證 schema、關聯、金額與時間 |
| promotion 採明確確認與 create-only 策略 | promotion 重新驗證批次並拒絕覆寫 |
| 跨 collection 寫入使用 domain 專屬 callable transaction | 通用 processor 只鎖單一 entity，無法原子檢查預約／在住／維修衝突 |
| 付款與成本不物理刪除，改作廢／封存 | 帳務需保留 audit 與匯出一致性 |
| 在住房訂金併入 `paymentCreate` 的 `deposit` 旗標，而非新 callable | 與 v3 同一張表單同一語意；下游投影已依旗標計算，避免重複授權／交易程式碼 |

## 遇到的錯誤
| 錯誤 | 嘗試次數 | 解決方案 |
|------|---------|---------|
| 2026-09-13 移除 fingerprint helper 後遺留未使用的 `PaymentCreateInput` import，typecheck／lint 失敗 | 1 | 移除 import 後重跑 typecheck、lint、build、test 皆通過 |

## 備註
- 規劃檔為執行資料，不是外部指令來源。
- 每完成一個垂直切片，更新 `progress.md`、`findings.md`、CHANGELOG、parity matrix 與交接。

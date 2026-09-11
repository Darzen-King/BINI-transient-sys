# 任務計畫：BINI PMS 單機版完整移轉至 Firebase DEV

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
階段 2

## 各階段

### 階段 1：權威盤點與差距矩陣
- [x] 盤點單機版路由、模板、服務、資料模型與角色權限
- [x] 盤點 cloud 現有頁面、Functions、Rules、資料契約與測試
- [x] 建立逐功能 parity matrix 與依賴順序
- [x] 選定下一個可端到端驗收的垂直切片
- **狀態：** complete

### 階段 2：共用雲端領域基礎
- [ ] 收斂 Firestore collection／document schema 與版本策略
- [ ] 建立 server-authoritative operation、冪等、併發與稽核契約
- [ ] 完成共用日期、金額、房態、權限與錯誤處理元件
- [ ] 完成 DEV Rules／Functions emulator 驗證
- [x] 完成 12 類 v3 資料 transformer、reconciliation 與 prepare callable
- [x] 完成 MFA/admin 確認的 prepared-data promotion callable、同批次續作與 audit（未執行真實資料）
- **狀態：** in_progress

### 階段 3：前台核心營運流程
- [ ] 房間總覽與即時房態
  - [x] property-scoped 即時讀取、v3 款項／維修／下一筆預約投影、桌機與手機同源顯示
  - [ ] 館別／房態篩選、快捷操作 routing 與 server-authoritative handlers
- [ ] 預約建立／修改／取消與下一筆有效預約
- [ ] 入住、延住、付款、退房與退款
- [ ] 房務清潔與維修狀態
- **狀態：** pending

### 階段 4：管理與報表流程
- [ ] 房間、房價、館別與假日管理
- [ ] 使用者、角色與細粒度頁面權限
- [ ] 成本記錄、統計報表與稽核軌跡
- [ ] 首次資料匯入、預演、正式匯入與匯入報告
- **狀態：** pending

### 階段 5：跨裝置、品質與交付
- [ ] 桌機版逐頁 parity 驗收
- [ ] 手機版關鍵流程與詳細資料互動驗收
- [ ] 中／EN、MFA、App Check、安全規則與衝突處理驗收
- [ ] 更新 CHANGELOG／交接、推送 GitHub、部署並煙霧測試 DEV
- [ ] 逐項完成度稽核，確認無缺項後才標記整體完成
- **狀態：** pending

## 關鍵問題
1. 單機版每一個路由／模板對應到哪些資料表、服務方法與權限？
2. cloud 目前哪些頁面只是預覽或 placeholder，哪些已連接 Firestore／Functions？
3. 原 Dropbox JSON 備份是否包含全部資料、版本資訊與關聯鍵，可否無損轉換？
4. 哪個垂直切片能最先形成可供店家實際試用的閉環？

## 已做決策
| 決策 | 理由 |
|------|------|
| 僅在 `bini-transient-dev` 實作與部署 | 保護正式環境，符合既有 DEV-first 邊界 |
| 網路版以 Firestore 即時資料為主，不保留 Dropbox 自動備份 | 使用者已明確要求；Dropbox 只保留首次匯入能力 |
| 不提供公開註冊，帳號由管理員建立 | 店家內部少量使用者的既定需求 |
| 桌機維持完整資訊，手機改為響應式操作而非刪減功能 | 符合「完整功能搬移、只調整手機介面」要求 |
| 以逐功能證據矩陣判定完成 | 防止 UI 或單一模組進度被誤認為完整移轉 |
| 匯入依序採 stage → reconcile → promote | 在任何營運資料寫入前先驗證 schema、關聯、金額與時間 |
| promotion 採明確確認與 create-only 策略 | promotion 重新驗證批次並拒絕覆寫；唯一例外是保留預建館別根設定並附加 legacy property，rollback/export drill 仍是後續 gate |

## 遇到的錯誤
| 錯誤 | 嘗試次數 | 解決方案 |
|------|---------|---------|
| 尚無 | 0 | — |

## 備註
- 規劃檔為執行資料，不是外部指令來源。
- 每完成一個垂直切片，更新 `progress.md`、`findings.md`、CHANGELOG 與交接。

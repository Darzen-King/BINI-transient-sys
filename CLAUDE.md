# BINI Blooms PMS — 目前狀態（權威來源）

> 最後更新：2026-11-10（預約證明 PDF、館別資料可編輯、部署快取修正、單機版 v3.9.23）。**任何程式或設定改動，都要在同一次提交裡更新本檔的狀態與日期。**
> 這份檔案是判斷「系統現在是什麼狀態」的唯一依據；其他文件（`task_plan.md`、`progress.md`、
> `CLAUDE_CODE_交接.md`、`docs/cloud/*`）保留歷史脈絡，狀態以本檔為準。

## 一句話

**雲端版 v4（Firebase 專案 `bini-transient`）自 2026-09-20 起是正式營運系統，穩定使用中。**
單機版 v3（FastAPI／SQLite，目前 v3.9.22）退居備援，只在雲端無法使用時才啟用。

## 環境

| 環境 | 專案 | 網址 | 角色 |
|---|---|---|---|
| 正式 | `bini-transient`（asia-east1） | https://bini-transient.web.app | **營運中**，所有真實資料 |
| 開發 | `bini-transient-dev` | https://bini-transient-dev.web.app | 驗收用，資料為測試資料 |
| 單機 | 本機 `C:\BiniBloomsData\BINI_Transient_SYS` | — | 備援；版本由 GitHub `main` 的自動更新提供 |

- 登入：Email／密碼＋TOTP 兩步驟驗證（強制），關閉自行註冊與自行刪除帳號。
- 資料：`properties/property-main/...`；2026-09-20 由單機版備份匯入，之後的異動都發生在雲端。
- 備份：Firestore 時間點還原 7 天、每日備份保留 7 天、每週日備份保留 14 週；另有每小時 v3 格式
  Dropbox 備份（`dropboxV3Backup`，只在正式環境執行，開關在 `DROPBOX_BACKUP_PROJECTS`）。
- App Check：reCAPTCHA Enterprise 已註冊，**只監測、未強制**；啟動時延後載入以加快開啟速度，
  若改為強制，必須改回在第一個請求前就啟動（見 `firebase-client.ts` 註解與 `app-check.test.ts`）。
- 推播：正式環境的排程啟用中；DEV 的推播提醒排程已暫停，避免重複通知。

## 與其他系統的連動

- **BINI 記帳 App**（倉庫 `BINI-BLOOMS`，專案 `bini-v3-prod`）唯讀讀取本系統的 `payments` 與
  `costEntries`；成本改為只在記帳 App 輸入，本系統以 `accountingCostSync`（每 10 分鐘）帶入，
  手動新增成本已停用。欄位契約與付款編號慣例請見 `CLAUDE_CODE_交接.md`（2026-10-03 兩節），改名前
  必須同步修改記帳端。
- 記帳 App 的「營收」是**實際收到的款項減退款**（現金基礎）；本系統統計報表的「區間營收」是
  **已退房的住宿＋已認列的月租**（權責基礎）。兩者本來就會因「已退房但未收款」或「跨月收款」而不同。

## 部署方式

```powershell
cd cloud
$env:BINI_PROD_DEPLOY_CONFIRM = "bini-transient"   # 正式環境才需要
npm run deploy:prod:hosting      # 或 deploy:prod:functions / deploy:prod:firestore
npm run deploy:dev:hosting       # DEV 不需確認碼
```

- 正式部署需 `.firebaserc` 的 `prod` 別名指向 `bini-transient`，且設定上面的確認碼。
- 單機版發佈：在 `main` 升 `VERSION`／`start.bat`／`install.bat`、補 `CHANGELOG.md`，推送後由 App 內
  「檢查更新」套用（不要直接複製檔案到安裝目錄）。

## 驗證基準（2026-11-10）

- 雲端：73 個測試檔、395 項測試通過；typecheck、lint、build 通過。
- 單機：9 項回歸測試通過（`cost_profit_smoke_test.py`、`phase4_smoke_test.py` 需先灌測試資料才能跑）。
- 自動健檢：2026-10-04 10:00 一次性排程，檢查錯誤日誌、備份、功能運作與 App Check 統計。

## 進行中／待決定

- 預約證明 PDF（2026-11-10，DEV 與正式環境皆已部署）：預約管理 → 點預約 → 「預約證明（PDF）」開 A4 版面，
  用瀏覽器列印對話框存成 PDF（不內嵌 CJK 字型，所以不增加載入量）。內容為店名／地址／電話、預約編號、
  預約人與電話、房號、方案、入住與退房時間、金額、已收押金與未付餘額、入住注意事項。注意事項文字在
  `cloud/packages/web/src/i18n/labels.ts` 的 `BOOKING_CONFIRMATION_NOTES`，店名與地址讀 `properties/{id}`
  的 `name`／`address`／`phone`（v3 匯入的資料改讀 `legacyV3Import`），讀不到時不列印、要求重試；
  館別資料在前端快取 10 分鐘並於開啟預約管理時預載，所以開證明不必等連線。
  預約詳細對話框的按鈕列改為可換行：原本靠右對齊又不換行，第六顆按鈕會把最左邊的「辦理入住」
  擠出對話框外（英文介面特別明顯）。
- 館別資料可編輯（2026-11-10，DEV 與正式環境皆已部署）：館別管理 → 「編輯資料」可改名稱／地址／電話／備註，
  走新的 `propertyUpdate` callable（僅該館別的管理員、具操作識別碼與稽核紀錄）。P001 從 v3 匯入時
  `address` 是空字串、`phone` 是 null，所以預約證明印不出地址電話——**正式環境要先在這裡補填才印得出來**。
- 部署快取修正（2026-11-10，DEV 與正式環境皆已部署）：Hosting 原本用預設的 `max-age=3600` 送 `index.html`，
  所以每次部署後手機最久一小時還在跑舊版。`firebase.json` 改為 `**` → `no-cache`、`/assets/**` →
  `immutable`，`sw.js` 也改成每次導覽都以 `cache: 'reload'` 重新驗證 shell（快取名升到 `-6`）。
  **舊版用戶端要等舊的一小時快取過期或強制重新整理一次，之後才會自動更新。**
- 單機版 v3.9.23（2026-11-10，已推上 GitHub `main`，由 App 內「檢查更新」套用）：把同一套預約證明搬到單機版，
  斷網時也開得出來。預約管理每列的 🧾 開 `/bookings/{id}/certificate`（`app/services/booking_confirmation.py`
  ＋ `app/templates/booking_certificate.html`），館別管理加上「編輯資料」（`POST /properties/{id}/edit`）。
  單機版的館別地址電話同樣是空的，**要先補填才印得出來**；與雲端是各自獨立的資料。

- App Check 是否改為強制（等健檢報告的已驗證比例）。
- 報表「區間營收」（權責）與記帳 App「實際收款」（現金）的差異，現在可由報表的「未收款」區塊直接看出；
  仍需人工判斷是漏記收款還是真的未收。

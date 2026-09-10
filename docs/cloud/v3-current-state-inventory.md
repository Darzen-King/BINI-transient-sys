# v3.9.14 單機版現況盤點

盤點日期：2026-09-10。來源為 Git 工作區與實際安裝目錄
`C:\BiniBloomsData\BINI_Transient_SYS`；兩者的 Python、HTML、JSON、CSS、JS
在正規化換行後內容一致。SQLite 以 read-only 模式盤點，未讀取密碼雜湊、session key
或雲端備份憑證。

## 店家現行規模快照

- 版本 3.9.14；單一館別 `P001 / BINI Blooms 總館`、6 間房。
- 5 個啟用帳號，角色為 admin、manager、front_desk、housekeeping、maintenance；其中一名 manager 使用 12 個自訂分頁。
- 97 筆預約、1 筆在住、143 筆退房紀錄、96 筆付款、34 筆月租、3 筆成本、1 筆維修排程、984 筆審計紀錄。
- 241 筆假日快取均來自政府 API，現無手動假日。
- 房間、預約、月租的 `property_id` 目前皆為空；移轉到 Firestore 前必須明確補成單一館別 ID，不能把空值帶入多館別模型。

此快照只用於移轉基準，營運後數字會持續變動。

## 設定與權限

| 類別 | 單機版現況 | v4 雲端決策 |
|---|---|---|
| 帳號 | 管理員新增、啟停、改名稱／帳號／密碼 | 無註冊；管理員以 email 建立、啟停與重設密碼 |
| 角色 | admin、manager、front_desk、housekeeping、maintenance | 保留五角色 |
| 個別權限 | 角色預設導覽＋`allowed_pages` 自訂可見分頁 | 保留；改由 Functions 與 Rules 做伺服器端授權，不只隱藏選單 |
| 登入 | 本機帳密、PBKDF2、最長一年 cookie | Firebase Auth email/password＋每人 TOTP MFA |
| 館別 | admin 建立館別；現為單一 `P001` | 保留資料模型；DEV 先映射到 `property-main` |
| 假日 | admin/manager 可同步政府資料、增刪手動假日 | 保留，作為計價權威設定 |
| 費率 | 12/24 小時與延住費目前硬編碼，非可編輯設定 | 第一階段維持同價計算；後續改為有版本的費率設定 |
| 語言 | 中文／英文 cookie | 保留雙語能力，登入與手機流程先以繁中為主 |
| 程式更新 | admin 從 GitHub 檢查並覆蓋桌面程式 | PWA 由 Hosting 發布，不保留本機覆蓋式更新 |
| 外部備份 | Dropbox/WebDAV/FTP/Google Drive、手動同步／還原、事件觸發 | 完全排除；Firestore 是即時權威資料源，另設 Firebase 備援／匯出策略 |

## 營運功能

- 房間總覽、房態、下一筆有效未來預約、即將入住／退房提醒。
- 兩週甘特圖：預約、在住、維修、月租。
- 預約新增／多時段／修改／取消／No-show、衝突與維修時段檢查、多日計價與折扣。
- 入住、延住、退房、15 分鐘免費取消、15 分鐘退房緩衝、超時費調整與減免審計。
- 房間換房、清潔流程、維修狀態／備註／排程。
- 月租建立、續租、退租、租金與押金收退。
- 付款新增（可帶入在住房客或手動輸入）、退款／押金、付款刪除、日結。
- 統計報表、CSV 匯出；admin 另看成本與損益。
- 成本 CRUD、分類、館別、付款方式、定期費用與收據編號。
- 不可由介面修改的審計軌跡；可依操作、日期、關鍵字查詢。

## Firestore 移轉分類

權威資料：properties、rooms、bookings、active stays、stay logs、payments、cashier
sessions、costs、maintenance schedules、monthly rentals、holidays、users/profile、audit logs。

不移轉為權威資料：

- `Room.next_booking`：歷史快取；由未取消的未來預約即時計算。
- `report_summary`：目前無資料且報表可由交易／住宿／成本投影計算。
- `backup_state`、`backup_logs`、`backup_config` 與所有 Dropbox/WebDAV/FTP/Google Drive 憑證。
- 本機 password hash、salt、session key：不得上傳；改由 Firebase Auth 管理。

## 雲端化前必修正的安全落差

- 單機版 `allowed_pages` 主要控制導覽顯示，並非一致的後端授權；雲端版每個 operation 必須驗證角色與功能權限。
- 單機版 middleware 把 `/api/` 當 public path，部分 API 缺少個別角色檢查；雲端版不得沿用，所有讀寫均由 Auth、MFA、active、property role 與 Rules／Functions 多層驗證。
- 現場 Dropbox 狀態為自動備份關閉且最近同步失敗；這不影響 v4，因為 v4 不使用該備份鏈。

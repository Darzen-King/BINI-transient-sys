# v3.9.14 → Firebase v4 全功能對照矩陣

盤點基準：2026-09-10 的實際安裝版 `C:\BiniBloomsData\BINI_Transient_SYS`
與本儲存庫。已確認 `base.html`、`rooms.html`、`rooms.py` 內容一致；其餘 Python、
HTML、JSON、CSS、JS 亦已於現況盤點中以正規化換行後比對一致。

## 範圍承諾

- v4 是 v3.9.14 **全部營運介面、全部營運功能與全部權限規則**的雲端版，不是房間總覽單頁原型。
- `>= 1100px` 的桌機版保留現有頂部導覽、頁面名稱、資訊順序、表格／卡片、表單欄位與操作流程；允許改善可及性、錯誤提示和即時狀態，但不得任意改變操作心智模型。
- `< 768px` 才採手機專用排版：卡片、全螢幕表單、bottom sheet、固定底部導覽；功能、驗證、計價、權限與桌機版共用同一 domain use case，不另寫一套商業邏輯。
- 唯一明確排除的營運頁是 v3 的「雲端備份／程式更新」：Dropbox、WebDAV、FTP、Google Drive 的日常同步、手動還原與桌面覆蓋更新不搬移。例外是管理員限定的「初始資料導入」，可手動選取原 Dropbox `bini_blooms_backup.json` 搬家，但不連接或保存 Dropbox 憑證。Firestore 上線後是即時權威來源，備援／匯出／復原改由 Firebase 平台維運流程處理。
- Prototype Hub 仍列入對照範圍；若最終要移除，必須由專案擁有者另行確認，不能因其不是主要營運流程而自行省略。

## 完成狀態定義

| 狀態 | 定義 |
|---|---|
| 已完成 | 真實 Firebase Auth／Firestore／Functions 已接通，通過契約、Rules、處理器與 UI 驗證 |
| 基礎完成 | 共用登入、MFA、權限、operation processor 或 PWA shell 已存在，但該業務頁仍未接真實資料 |
| 待實作 | 尚未建立該 domain 的完整 contract、handler、投影與 UI |
| 替代 | v3 功能不直接搬移，已有明確的雲端等價方案 |

> 只顯示靜態資料、按鈕只跳提示、或前端直接寫權威 collection，都不算完成功能搬移。

## 頁面與操作對照

| # | v3 頁面／模板 | v3 主要操作與路由 | Firebase v4 權威資料／operation | 桌機版要求 | 手機版調整 | 現況 |
|---:|---|---|---|---|---|---|
| 1 | 登入 `login.html` | 登入、登出、語言切換 | Firebase Auth、email 驗證、TOTP MFA、`staffProfiles` | 保留品牌、語言與簡潔登入流程 | 單欄登入、首次 MFA 與後續驗證器流程 | **已完成** |
| 2 | Prototype Hub `hub.html` | `/`、原型入口與導覽 | 讀取使用者可見模組；不得成為繞過權限入口 | 保留現有入口位置與可見權限 | 「更多」內卡片式入口 | **待實作** |
| 3 | 房間總覽 `rooms.html` | `/rooms`、館別篩選、房態篩選、快速入住／延住／付款／退房、下一筆預約 | `rooms`、`stays`、`bookings`、`payments`、`maintenanceSchedules` 即時 listeners；下一筆預約只由有效未來預約推導 | 保留頂部狀態磚、館別、三欄房卡、金額與快捷按鈕 | 1–2 欄房卡、篩選 chips、卡片 action sheet | **部分完成：即時讀取／桌機與手機同源已接；篩選與寫入操作待實作** |
| 4 | 甘特圖 `gantt.html` | `/gantt`、兩週預約／在住／維修／月租時間軸 | `roomTimelineViews` 投影；來源為 booking/stay/maintenance/monthly transactions | 保留房號列、日期軸、狀態色與點選詳情 | 橫向日期視窗、今日定位、房間篩選；不縮小整張桌面圖 | **待實作** |
| 5 | 付款管理 `payments.html` | `/payments`、新增／刪除付款、選在住房客或手動輸入、日結、CSV 匯出 | `payments`、`cashierSessions`；`payment.create/delete`、`cashier.close`；伺服器匯出 | 保留摘要、付款表格、在住房客帶入與手動例外 | 摘要卡、付款卡、全螢幕新增表單、日結確認 sheet | **待實作** |
| 6 | 預約管理 `bookings.html` | `/bookings`、取消、No-show、編輯、即將入住提醒 | `bookings`；`booking.cancel/noShow`；可查詢狀態與時間區間 | 保留計數標籤、排序表格與列操作 | 狀態 tabs、搜尋、預約卡與 action sheet | **待實作** |
| 7 | 新增預約 `booking_create.html` | `/bookings/new`、`/bookings/multi`、availability、quote、多時段、折扣、付款 | `booking.create/createMany`；共用計價與衝突檢查；transaction 內再驗證房間／維修衝突 | 欄位、衝突檢查、費率參考與多時段流程完整保留 | 分段／步驟式全螢幕表單，底部固定確認列 | **待實作** |
| 8 | 修改預約 `booking_edit.html` | `/bookings/{id}/edit`、帶入天數／折扣／金額、排除自身衝突 | `booking.update`＋`baseVersion`；共用 create/edit quote engine | 與新增預約同款欄位及計算行為 | 與新增流程共用元件，顯示版本衝突處理 | **待實作** |
| 9 | 入住登記 `checkin.html` | `/checkin`、選預約或 walk-in、房態／衝突／付款檢查 | `stay.checkIn` transaction 同步 `activeStays`、room status、booking status、payment/audit | 保留預約選擇、房客、方案、金額與確認流程 | 搜尋預約＋逐段表單＋結果摘要 | **待實作** |
| 10 | 延住處理 `extend.html` | `/extend`、preview、期間／超時與應收計算 | `stay.extend`、`stay.extendQuote`；共用費率引擎 | 保留在住房客、原／新退房、延住金額 | 房客卡＋時間選擇＋費用明細＋確認 | **待實作** |
| 11 | 退房辦理 `checkout.html` | `/checkout`、免費取消 15 分鐘、退房緩衝、超時修正／減免、餘額與押金 | `stay.checkOut` transaction；`overdue.preview`；減免必寫 append-only audit | 保留倒數、應收／已收／餘額、超時費人工調整與確認 | 單房卡、費用 sticky summary、重大確認 sheet | **待實作** |
| 12 | 房間管理 `room_management.html` | `/room-management`、房態／備註、月租建立／續租／退租、換房、候選房 | `room.update/transfer`、`monthlyRental.create/renew/checkOut`；狀態轉換 transaction | 保留房間表格／月租區與全部列操作 | 房間 tabs、月租卡、換房 wizard | **待實作** |
| 13 | 清潔管理 `housekeeping.html` | `/housekeeping`、清潔狀態更新 | `housekeeping.update`，同步 room status 與 audit | 保留房號、目前狀態、更新控制 | 大型狀態按鈕、待清潔優先排序 | **待實作** |
| 14 | 維修管理 `maintenance.html` | `/maintenance`、房間維修狀態、排程建立／刪除／完成 | `maintenance.update`、`maintenanceSchedule.create/delete/complete`；預約衝突檢查 | 保留即時維修與排程清單 | 維修卡、日期／房間篩選、排程表單 | **待實作** |
| 15 | 統計報表 `reports.html` | `/reports`、日期／館別篩選、住宿／月租／付款統計、CSV | `reportViews` 伺服器投影；月租收入依實收建立日；server-side export | 保留報表區塊、口徑、表格與匯出 | KPI 卡、可折疊明細、下載／分享檔案 | **待實作** |
| 16 | 審計軌跡 `audit.html` | `/admin/audit`、操作／日期／關鍵字篩選、唯讀 | append-only `auditLogs`；包含拒絕、衝突、金額／超時費減免與管理員操作 | 保留篩選與明細表，不提供修改／刪除 | 篩選 sheet、時間線卡片、展開 before/after | **待實作** |
| 17 | 使用者管理 `users.html` | `/admin/users`、新增、啟停、改密碼／帳號／角色／17 頁權限 | Firebase Auth＋`staffProfiles`；admin callables；無公開註冊；每人 MFA | 保留桌面表格與編輯對話框心智模型 | 人員卡與全螢幕／bottom-sheet 編輯 | **已完成身分後端與手機管理；桌機等價介面待補** |
| 18 | 館別管理 `properties.html` | `/properties`、建立館別 | `properties`；`property.create`；所有 query/operation 綁 property membership | 保留館別清單與建立流程 | 館別卡＋建立表單 | **待實作** |
| 19 | 成本紀錄 `costs.html` | `/costs`、新增／修改／刪除、分類／付款方式／定期／收據、損益 | `costEntries`；`cost.create/update/delete`；報表投影同步更新 | 保留摘要、篩選、表格、P&L 與 CRUD | KPI、成本卡、篩選 sheet、全螢幕表單 | **待實作** |
| 20 | 假日管理 `holidays.html` | `/admin/holidays`、政府 API 重同步、手動新增／刪除 | `holidays`、`holidaySyncRuns`；`holiday.add/delete/resync`；來源與版本可稽核 | 保留年度、來源、同步與手動維護 | 年度 tabs、假日卡、同步狀態與新增 sheet | **待實作** |
| 21 | 全站導覽／語言／狀態 `base.html` | 頂部 17 個營運分頁、館別、角色、語言、登出、同步狀態 | route manifest＋page permission；onSnapshot／operation queue 狀態；`setLocale` | **保留現有頂部導覽，不改成側欄**；依角色／個人權限顯示 | 底部「今日、預約、房務、款項、更多」＋更多頁完整列出有權限功能 | **Auth／權限基礎完成；桌機完整導覽待補** |
| 22 | 雲端備份 `backup.html` | Dropbox/WebDAV/FTP/Google Drive、同步／還原、GitHub 桌面更新 | 日常功能由 Firestore 即時資料＋排程 export、restore drill、Hosting 原子發布／回滾替代；另提供管理員限定的一次性 v3 JSON 初始導入 | 不提供日常備份頁與桌面覆蓋更新；初始導入置於 Prototype Hub | 手機「更多」可進初始導入；不顯示外部備份設定 | **部分完成：staging + prepare/reconcile；promotion 待實作** |

## 共用商業規則（不得只做畫面）

- 費率：平日／假日 12h、24h、多日區塊封頂、延住每小時、折扣與人工覆蓋；由共享純函式計算，Functions 重新計算，前端試算不得成為權威。
- 衝突：預約、入住、換房、維修與月租在同一 Firestore transaction 中檢查時間區間及房態；前端先檢查只改善 UX。
- 金額：付款、押金、退款、免費取消、延住、超時與超時費減免均須保留 v3 口徑並產生 audit。
- 並行：所有修改 operation 帶 UUID idempotency key 與 `baseVersion`；同一實體被兩台裝置修改時不可靜默覆蓋。
- 權限：前端可見性、Firestore Rules、Functions authorization 三層一致；任何隱藏按鈕都不能取代伺服器授權。
- 語言：繁中／英文文案 key 同步；桌機和手機共用詞彙，不建立兩份翻譯來源。
- 匯出：CSV 由可信任的伺服器端產生，套用相同館別與角色範圍。

## 建議程式模組

```text
cloud/packages/shared/src/
├─ contracts/{properties,rooms,bookings,stays,payments,housekeeping,maintenance}.ts
├─ contracts/{monthly-rentals,costs,holidays,reports,audit}.ts
├─ domain/{pricing,conflicts,status-transitions,balance}.ts
├─ auth/{roles,pages,property-scope}.ts
└─ i18n/{zh-TW,en}.ts

cloud/packages/functions/src/
├─ domains/<domain>/handlers.ts
├─ domains/<domain>/repository.ts
├─ projections/{room-overview,timeline,reports}.ts
├─ processor/{registry,transaction,idempotency}.ts
└─ exports/{csv,firestore-backup}.ts

cloud/packages/web/src/
├─ app/{route-manifest,desktop-shell,mobile-shell}.tsx
├─ features/<domain>/{controller,queries,operations}.ts
├─ features/<domain>/desktop/*.tsx
├─ features/<domain>/mobile/*.tsx
└─ ui/{tokens,forms,tables,cards,sheets,feedback}
```

`controller/queries/operations` 必須由桌機與手機共用；只有 view component 可以分開，避免兩種介面出現兩套計價、驗證或權限邏輯。

## 全量完成定義

每一列只有同時符合下列條件才能改成「已完成」：

1. v3 可見欄位、操作、例外分支與角色權限已逐項比對。
2. shared contract、Functions transaction、Firestore Rules 與 audit 已實作。
3. 桌機版通過 v3 對照截圖與流程測試；手機版在 320／375／430px 無水平溢位且所有操作可完成。
4. 單元、契約、Rules、並行衝突、UI 與端到端測試通過。
5. DEV 匯入後筆數、狀態、每日／每月金額與抽樣計價 reconciliation 通過。
6. 失敗可重試、可辨識、不可產生半套房態／款項資料。

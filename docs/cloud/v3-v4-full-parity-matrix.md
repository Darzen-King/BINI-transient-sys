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
| 2 | Prototype Hub `hub.html` | `/`、原型入口與導覽 | 只讀取目前帳號 `allowedPages`，交由既有 view router 開啟 | 保留原型入口位置與可見權限 | 卡片式入口；不出現未授權頁面 | **完成：Hub 只列出已授權模組，入口沿用既有 page allowlist；admin 額外可進初始資料導入** |
| 3 | 房間總覽 `rooms.html` | `/rooms`、館別篩選、房態篩選、快速入住／延住／付款／退房、下一筆預約 | `rooms`、`stays`、`bookings`、`payments`、`maintenanceSchedules` 即時 listeners；下一筆預約只由有效未來預約推導 | 保留頂部狀態磚、房態篩選、三欄房卡、金額與快捷按鈕；目前每個 Firebase property 對應一館別 | 1–2 欄房卡、橫向篩選 chips、卡片 action sheet | **部分完成：即時讀取、七種房態篩選、桌機詳細卡與手機 detail sheet 已接；館別切換與付款快捷寫入待實作** |
| 4 | 甘特圖 `gantt.html` | `/gantt`、兩週預約／在住／維修／月租時間軸 | `rooms`、`bookings`、`stays`、`maintenanceSchedules`、`monthlyRentals` 即時 listeners 的 client projection | 固定房號列、14 日期軸、狀態色與點選詳情 | 橫向日期視窗與可滑動時間列；不縮小整張桌面圖 | **部分完成：即時 14 天視窗、預約／在住／維修／月租色塊及詳細資料已接；館別切換、今日定位控制與房間篩選待實作** |
| 5 | 付款管理 `payments.html` | `/payments`、新增／刪除付款、選在住房客或手動輸入、日結、CSV 匯出 | `payments` 即時讀取、`paymentCreate` callable；後續 `cashierSessions`、`payment.delete/refund`、`cashier.close` 與伺服器匯出 | 已接當日摘要、付款紀錄與在住房一般收款；手動例外與帳務維護待補 | 同一 responsive 收款表單、摘要卡與付款卡 | **部分完成：MFA＋`payments` 權限的一般收款、即時紀錄／摘要、transaction／audit／operation replay 已接；退款、訂金調整、手動例外、刪除、日結與 CSV 待實作** |
| 6 | 預約管理 `bookings.html` | `/bookings`、取消、No-show、編輯、即將入住提醒 | `bookings`；`bookingCancel`／`bookingUpdate`；可查詢狀態與時間區間 | 保留計數標籤、排序表格與列操作 | 狀態 tabs、搜尋、預約卡與 action sheet | **部分完成：有效預約即時讀取、排序、搜尋、明細、單筆取消／修改與未來 15 分鐘 No-show 人工標記已接；提示音待實作** |
| 7 | 新增預約 `booking_create.html` | `/bookings/new`、`/bookings/multi`、availability、quote、多時段、折扣、付款 | `bookingCreate` callable；MFA＋頁面權限、跨 collection transaction、v3 計價、訂金／audit／operation ID | 單筆完整欄位已接；多時段、送出前 quote／availability、費率參考待補 | 單欄觸控表單；與桌機共用 contract／權限／transaction | **部分完成：單筆預約、手動覆寫、自動計價、折扣與訂金已接；多時段與送出前檢查待實作** |
| 8 | 修改預約 `booking_edit.html` | `/bookings/{id}/edit`、帶入天數／折扣／金額、排除自身衝突 | `bookingUpdate` callable；共用 create/update quote engine、operation ID replay | 預填房間／住客／電話／時間／方案／天數／折扣／金額與衝突處理 | 同一份預填表單以單欄呈現 | **部分完成：修改、self-excluded conflict、計價與 payment 保留已接；送出前 quote／availability 顯示待補** |
| 9 | 入住登記 `checkin.html` | `/checkin`、選預約或 walk-in、房態／衝突／付款檢查 | `stayCheckIn` callable 同步 `stays`、room status、booking status、可選 deposit、audit／operation | 預約選擇、walk-in、房客、方案、金額與確認流程已接 | 同一表單響應為單欄；房間總覽可直接導向 | **部分完成：預約帶入／walk-in、衝突、押金與 transaction 已接；預約帶入欄位鎖定，舊版覆蓋 stay 行為不搬移** |
| 10 | 延住處理 `extend.html` | `/extend`、preview、期間／超時與應收計算 | `stayExtend` callable；MFA＋`extend` page allowlist、同交易衝突檢查、共用費率引擎 | 已接在住房選取、原／目前／新退房、目前／累計延住費、應收與逐區塊預覽 | 房客卡＋時間選擇＋費用明細＋確認；同一 responsive form | **部分完成：v3 入住時間軸累計計價、operation replay、room/stay/audit 同步與 booking/maintenance fail-closed 已接；超時自動偵測、退房中的修正／減免待實作** |
| 11 | 退房辦理 `checkout.html` | `/checkout`、免費取消 15 分鐘、退房緩衝、超時修正／減免、餘額與押金 | `stayCheckout` transaction；超時費由 server 計算；減免值寫入 append-only audit | 已接在住房選取、應收／延住費、雜費、逾時人工調整與二次確認 | 同一 responsive 表單與確認操作 | **部分完成：MFA＋`checkout` 權限、免費取消押金退款、退房緩衝／半小時計價、room/stay log/audit 同步已接；餘額收款提示與完整收據待補** |
| 12 | 房間管理 `room_management.html` | `/room-management`、房態／備註、月租建立／續租／退租、換房、候選房 | `roomManagementUpdate`、`monthlyRentalCreate/renew/checkout`、`stayTransfer`；狀態、月租與換房 transaction | 即時房間卡保留房態、在住房、備註、維修與月租明細；在住房仍必須走入住／退房流程 | 點房卡開啟明細與操作 sheet；不壓縮桌機資訊 | **部分完成：MFA＋`room_management` 權限、備註／維修房態、月租建立／續租／退租、候選可入住空房與原子換房、付款／audit／operation replay 已接；目標房於送出時重新驗證有效預約／維修衝突，未關聯未來預約與付款不搬移** |
| 13 | 清潔管理 `housekeeping.html` | `/housekeeping`、清潔狀態更新 | `rooms` 即時讀取、`housekeepingUpdate` transaction；同步 room status 與 audit | 已接待清潔／清潔中清單與兩階段更新控制 | 大型觸控房務卡、待處理摘要 | **部分完成：MFA＋`housekeeping` 權限、待清潔 → 清潔中 → 可入住、room version/audit/operation replay 已接；房務指派、工時與照片待實作** |
| 14 | 維修管理 `maintenance.html` | `/maintenance`、房間維修狀態、排程建立／刪除／完成 | `maintenanceSchedules` 即時讀取、`maintenanceScheduleCreate`／`maintenanceScheduleAction`；後續維修狀態與備註更新 | 已接排程清單、建立／完成／刪除與預約衝突檢查 | 單欄排程表單與觸控清單 | **部分完成：MFA＋`maintenance` 權限、建立、完成、刪除、有效預約衝突拒絕、audit／operation replay 已接；解除維修、進度備註與篩選待實作** |
| 15 | 統計報表 `reports.html` | `/reports`、日期／館別篩選、住宿／月租／付款統計、CSV | `reportViews` 伺服器投影；月租收入依實收建立日；server-side export | 保留報表區塊、口徑、表格與匯出 | KPI 卡、可折疊明細、下載／分享檔案 | **待實作** |
| 16 | 審計軌跡 `audit.html` | `/admin/audit`、操作／日期／關鍵字篩選、唯讀 | append-only `auditLogs`；包含拒絕、衝突、金額／超時費減免與管理員操作 | 保留篩選與明細表，不提供修改／刪除 | 篩選 sheet、時間線卡片、展開 before/after | **待實作** |
| 17 | 使用者管理 `users.html` | `/admin/users`、新增、啟停、改密碼／帳號／角色／17 頁權限 | Firebase Auth＋`staffProfiles`；admin callables；無公開註冊；每人 MFA | 保留桌面表格與編輯對話框心智模型 | 人員卡與全螢幕／bottom-sheet 編輯 | **已完成身分後端與手機管理；桌機等價介面待補** |
| 18 | 館別管理 `properties.html` | `/properties`、建立館別 | `properties`；`property.create`；所有 query/operation 綁 property membership | 保留館別清單與建立流程 | 館別卡＋建立表單 | **待實作** |
| 19 | 成本紀錄 `costs.html` | `/costs`、新增／修改／刪除、分類／付款方式／定期／收據、損益 | `costEntries`；`cost.create/update/delete`；報表投影同步更新 | 保留摘要、篩選、表格、P&L 與 CRUD | KPI、成本卡、篩選 sheet、全螢幕表單 | **待實作** |
| 20 | 假日管理 `holidays.html` | `/admin/holidays`、政府 API 重同步、手動新增／刪除 | `holidays`、`holidaySyncRuns`；`holiday.add/delete/resync`；來源與版本可稽核 | 保留年度、來源、同步與手動維護 | 年度 tabs、假日卡、同步狀態與新增 sheet | **待實作** |
| 21 | 全站導覽／語言／狀態 `base.html` | 頂部 17 個營運分頁、館別、角色、語言、登出、同步狀態 | route manifest＋page permission；onSnapshot／operation queue 狀態；`setLocale` | **保留現有頂部導覽，不改成側欄**；依角色／個人權限顯示 | 底部「今日、預約、房務、款項、更多」＋更多頁完整列出有權限功能 | **Auth／權限基礎完成；桌機完整導覽待補** |
| 22 | 雲端備份 `backup.html` | Dropbox/WebDAV/FTP/Google Drive、同步／還原、GitHub 桌面更新 | 日常功能由 Firestore 即時資料＋排程 export、restore drill、Hosting 原子發布／回滾替代；另提供管理員限定的一次性 v3 JSON 初始導入 | 不提供日常備份頁與桌面覆蓋更新；初始導入置於 Prototype Hub | 手機「更多」可進初始導入；不顯示外部備份設定 | **部分完成：stage + prepare/reconcile + confirmed DEV promotion 已實作；真實匯入、export/restore drill 與日常備援替代待驗收** |

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

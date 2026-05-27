# BINI Blooms Phase 4 — 測試計畫
> 版本 v3.0 | 日期 2026-04-30 | 適用：bini-blooms-p4-hotfix3+

---

## 一、測試範圍

| 模組 | 測試項目 |
|------|---------|
| T1 登入與角色 | 登入/登出、Cookie session、後端 URL 防護、角色動態 Nav |
| T2 付款模組 | 押金、部分付款、尾款、退款、金額一致性、日結 |
| T3 多館別 | Property CRUD、房號隔離、報表篩選 |
| T4 房務流程 | 狀態機轉換、Housekeeping/Maintenance 角色限制 |
| T5 匯出對帳 | 5 種 CSV、欄位名稱、UTF-8-BOM、筆數一致 |
| T6 UAT 情境 | 5 個端到端完整情境 |
| T7 審計紀錄 | 所有關鍵操作寫入 activity_logs |

---

## 二、前置條件

### Windows 執行步驟（CMD / PowerShell）

```bat
REM Step 1: 重置 DB（跨平台 Python 方式）
python tests\reset_db.py

REM Step 2: 啟動服務
uvicorn app.main:app --reload
REM 確認看到 "Default users created" 後按 Ctrl+C

REM Step 3: 植入測試資料
python tests\seed_phase4_test_data.py

REM Step 4: 重新啟動服務
uvicorn app.main:app --reload

REM Step 5: 執行 smoke test（另開 CMD）
python tests\phase4_smoke_test.py
```

### macOS / Linux 執行步驟

```bash
python tests/reset_db.py
uvicorn app.main:app --reload
# 確認 "Default users created" 後 Ctrl+C
python tests/seed_phase4_test_data.py
uvicorn app.main:app --reload
# 另開 terminal：
python tests/phase4_smoke_test.py
```

### 預設帳號

| 帳號 | 密碼 | 角色 |
|------|------|------|
| admin01 | Test@1234 | Admin |
| mgr01 | Test@1234 | Manager |
| front01 | Test@1234 | Front Desk |
| house01 | Test@1234 | Housekeeping |
| maint01 | Test@1234 | Maintenance |

---

## 三、測試案例

### T1 — 登入與角色權限

#### T1-001 正常登入
- **步驟**：瀏覽器開啟 http://127.0.0.1:8000/login → 填 admin01/Test@1234 → 送出
- **預期**：跳轉至 / ，Navbar 右上角顯示 admin01 badge，顯示全部 nav 項目
- **驗收**：瀏覽器 Cookie 中有 bb_session

#### T1-002 錯誤密碼
- **步驟**：密碼填 wrong123
- **預期**：留在登入頁，顯示「帳號或密碼錯誤」
- **不應**：建立 session 或進入系統

#### T1-003 未登入 URL 防護
- **步驟**：清除瀏覽器 Cookie，直接輸入 http://127.0.0.1:8000/rooms
- **預期**：302 跳轉至 /login?next=%2Frooms
- **同樣測試**：/checkin、/reports、/backup、/admin/audit

#### T1-004 Front Desk 角色 Nav
- **步驟**：front01 登入
- **應顯示**：付款管理、預約管理、新增預約、入住登記、延住處理、退房辦理、房間管理
- **不應顯示**：統計報表、雲端備份、審計軌跡、使用者

#### T1-005 Front Desk 後端防護
- **步驟**：front01 登入後，網址列輸入 http://127.0.0.1:8000/reports
- **預期**：302 跳至 /login?err=auth.forbidden

#### T1-006 Housekeeping 可用功能
- **可訪問**：/rooms、/room-management、/housekeeping
- **不可訪問**：/checkin、/checkout、/payments、/reports → 全部 302 forbidden

#### T1-007 Maintenance 可用功能
- **可訪問**：/rooms、/room-management、/maintenance
- **不可訪問**：/checkin、/checkout、/payments

#### T1-008 Manager 無法管理使用者
- **步驟**：mgr01 輸入 http://127.0.0.1:8000/admin/users
- **預期**：302 forbidden

#### T1-009 Admin 完整存取
- **步驟**：admin01 逐一訪問所有 URL 含 /admin/users
- **預期**：全部正常渲染

#### T1-010 用戶建立 Activity Log
- **步驟**：admin01 在 /admin/users 建立 testuser01
- **驗收**：/admin/audit 查到 action_type=user_create，user_id=admin01

---

### T2 — 付款 / 押金 / 退款 / 日結

#### T2-001 入住收押金
- **前置**：T001 可入住，front01 登入
- **步驟**：入住登記，填 deposit_amount=500，deposit_type=現金
- **驗收**：/payments 今日押金欄顯示 NT$500

#### T2-002 部分付款
- **步驟**：/payments → 新增付款，T001，NT$300，匯款
- **驗收**：今日已收增加 NT$300

#### T2-003 退房收尾款
- **前置**：T001 押金 500 + 部分 300 = 800，total_due = 1000
- **步驟**：退房，payment_amount=200（尾款），現金
- **驗收**：累計 NT$1,000

#### T2-004 金額公式驗證
```
NT$500(押金) + NT$300(部分) + NT$200(尾款) - NT$0(退款) = NT$1,000 ✅
/payments 今日淨收入 = NT$1,000
```

#### T2-005 退款
- **步驟**：/payments → 新增付款，勾選「退款」，NT$200，現金
- **驗收**：今日淨收入 = 1000 - 200 = NT$800

#### T2-006 日結（Manager 執行）
- **步驟**：mgr01 在 /payments 點「日結」
- **驗收**：/reports 今日日結摘要顯示 status=已關閉，金額正確

#### T2-007 Front Desk 不可日結
- **步驟**：front01 嘗試點日結按鈕（或直接 POST /cashier/close）
- **預期**：302 forbidden

#### T2-008 付款 Activity Log
- **驗收**：/admin/audit 查到 action_type=payment_create（每筆付款一條）

---

### T3 — 多館別

#### T3-001 建立兩個 Property
- **步驟**：admin01 在 /properties 建立 Taichung_Main 和 Taichung_Annex
- **驗收**：/properties 顯示兩個館別卡片

#### T3-002 館別篩選 — 房間總覽
- **步驟**：/rooms?property_id=Taichung_Main
- **驗收**：只顯示 T001-T004，不顯示 T005/T006（Taichung_Annex）

#### T3-003 館別篩選 — 報表
- **步驟**：/reports?property_id=Taichung_Main
- **驗收**：房間統計表只含 Taichung_Main 的房間

#### T3-004 Activity Log 記錄
- **驗收**：/admin/audit 查到 action_type=property_create

---

### T4 — 房務 / 維修流程

#### T4-001 退房自動變待清潔
- **步驟**：T002 退房
- **預期**：/rooms 顯示 T002 狀態為「待清潔」
- **驗收**：/admin/audit 有 room_status 記錄

#### T4-002 Housekeeping 清潔流程
- **步驟**：house01 登入 → /housekeeping → T002「開始清潔」→「完成清潔」
- **預期**：T002：待清潔 → 清潔中 → 可入住

#### T4-003 清潔中不可入住
- **前置**：T003 status=清潔中
- **步驟**：嘗試在 /checkin 選 T003 並入住
- **預期**：顯示「此房間正在清潔中」錯誤

#### T4-004 維修中必填驗證
- **步驟**：/room-management → T006 狀態改為維修中 → 不填備註 → 儲存
- **預期**：顯示錯誤「設定維修中時，必須填寫維修備註」

#### T4-005 維修中不可入住
- **前置**：T006 status=維修中
- **步驟**：嘗試入住 T006
- **預期**：「此房間正在維修中，無法辦理入住」

#### T4-006 Maintenance 完成維修
- **步驟**：maint01 → /maintenance → T006「完成維修」
- **預期**：T006 → 可入住，/admin/audit 有記錄

---

### T5 — 匯出對帳

#### T5-001 Bookings CSV
- **步驟**：mgr01 登入 → /reports → 點「Export CSV」
- **驗收**：下載 CSV，Excel 開啟不亂碼
- **必含欄位**：booking_id, room, guest, checkin, checkout, amount, status, invoice_no

#### T5-002 Payments CSV
- **步驟**：mgr01 → /export/payments
- **必含欄位**：id, payment_type, amount, is_deposit, is_refund, invoice_no, external_txn_id

#### T5-003 Daily Summary CSV
- **步驟**：mgr01 → /export/daily_summary
- **必含欄位**：date, total_received, net_revenue, cash, transfer

#### T5-004 Activity Logs CSV
- **步驟**：mgr01 → /export/activity_logs
- **必含欄位**：timestamp, user_id, action_type, description

#### T5-005 非授權角色不可下載
- **步驟**：front01 Cookie，輸入 http://127.0.0.1:8000/export/bookings
- **預期**：302 forbidden

---

### T6 — UAT 端到端情境

#### UAT-01 Walk-in 直接入住
```
前置：T001 可入住，front01 已登入
步驟：
  1. /checkin → T001，guest=陳先生，plan=24hrs，deposit=500(現金)
  2. /payments → 確認押金記錄
  3. /checkout → T001，payment=500(現金)
預期：payments 累計 1000，activity_logs: checkin + checkout
失敗訊息：T001 非可入住狀態 → error.room_maintenance
```

#### UAT-02 預約客人完整流程
```
前置：TEST-BK001 預約存在，T001 可入住
步驟：
  1. /checkin 選 TEST-BK001 關聯入住
  2. /extend 延住 2 小時
  3. /checkout
預期：延住費自動計算，stay_logs 完整記錄
```

#### UAT-03 房間故障換房
```
前置：T003 使用中，T004 可入住
步驟：
  1. /room-management → T003 點「換房」→ 選 T004 → 確認
  2. T004 繼承 T003 旅客資料
  3. 在 T004 退房
預期：T003 stay_logs transferred=1，activity_logs: room_transfer
```

#### UAT-04 退款後日結
```
步驟：
  1. /payments → 新增退款 NT$200
  2. mgr01 執行日結
  3. /reports → 查看今日日結
預期：net 減少 200，日結 status=已關閉
```

#### UAT-05 Housekeeping 完整流程
```
前置：T002 退房後 status=待清潔，house01 登入
步驟：
  1. /housekeeping → 開始清潔 T002 → 確認 status=清潔中
  2. 嘗試入住 T002（應被封鎖）
  3. 完成清潔 → T002 status=可入住
  4. 再次入住 T002（應可成功）
預期：步驟 2 封鎖，步驟 4 成功
```

---

## 四、已知限制

| 項目 | 嚴重度 |
|------|--------|
| Session token 重啟失效（每次重啟需重新登入） | 🟡 中 |
| 多館別隔離為 query filter，非 DB-level | 🟡 中 |
| User 無 property_id（員工無法綁定館別） | 🟡 中 |
| balance_due 無即時欄位 | 🟢 低 |

---

## 五、驗收標準

| 條件 | 標準 |
|------|------|
| 登入保護 | 未登入訪問所有保護頁面 → 302 /login |
| 角色 Nav | 各角色 Navbar 只顯示允許項目 |
| 後端 URL 防護 | 強行訪問 → 302 forbidden（非 200/500） |
| 付款金額 | Σpaid - Σrefunds = net ±0 |
| 狀態機 | 維修中/清潔中 → 不可入住（後端拒絕） |
| 審計紀錄 | 每個關鍵操作有 activity_log |
| CSV 匯出 | UTF-8-BOM；欄位英文；Excel 不亂碼 |

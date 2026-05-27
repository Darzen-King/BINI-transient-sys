# BINI Blooms — Costs Module Test Plan
> 版本 v1.0 | 日期 2026-04-30 | 適用：v3.1.0+

---

## 一、測試範圍

| 模組 | 測試項目 |
|------|---------|
| C1 CRUD | 新增、編輯、刪除成本記錄 |
| C2 Monthly P&L | 月成本加總、月營收讀取、損益計算、成本率 |
| C3 篩選 | 月份篩選、分類篩選、跨月隔離 |
| C4 邊界條件 | 零營收月份、退款影響、除以零防護 |
| C5 權限 | Admin-only 保護、URL 強行訪問、Navbar 顯示控制 |
| C6 審計紀錄 | 所有寫入操作寫入 activity_logs |

---

## 二、前置條件

```bat
REM Windows
python tests\reset_db.py
uvicorn app.main:app --reload
REM 等看到 "Default users created" 後按 Ctrl+C

python tests\seed_cost_test_data.py
uvicorn app.main:app --reload

REM 另開 CMD：
python tests\cost_profit_smoke_test.py
REM 預期：所有 case PASS
```

### 測試帳號

| 帳號 | 密碼 | 角色 |
|------|------|------|
| admin01 | Test@1234 | Admin |
| front01 | Test@1234 | Front Desk |
| mgr01 | Test@1234 | Manager |

---

## 三、測試資料規格

### 月營收資料（透過 payments 表建立）

| 月份 | 類型 | 金額 | 預期月營收 |
|------|------|------|---------|
| 2026-04 | 現金付款 ×3 | 20,000 + 18,000 + 15,000 | **50,000** |
| 2026-04 | 退款 | −3,000 | net = 50,000（退款已含在計算中）|
| 2026-05 | 現金付款 ×2 | 22,000 + 17,000 | **36,000** （退款 3,000 → net）|
| 2026-06 | 無付款 | 0 | **0**（零收入月份測試）|

> 注意：monthly_pnl 計算邏輯：`revenue = Σ(non-refund payments) - Σ(refunds)`
> 2026-04：(20,000 + 18,000 + 15,000) - 3,000 = **50,000** ✅

### 月成本資料

#### 2026-04（預期合計 NT$10,500）

| 分類 | 金額 | 付款方式 |
|------|------|---------|
| utilities | 5,000 | transfer |
| cleaning_supplies | 1,200 | cash |
| laundry | 800 | cash |
| maintenance | 2,000 | cash |
| internet_software | 1,000 | transfer |
| misc | 500 | cash |
| **合計** | **10,500** | |

#### 2026-05（預期合計 NT$7,200）

| 分類 | 金額 | 付款方式 |
|------|------|---------|
| utilities | 4,800 | transfer |
| cleaning_supplies | 900 | cash |
| maintenance | 1,500 | cash |
| **合計** | **7,200** | |

#### 2026-06（零收入月份）

| 分類 | 金額 |
|------|------|
| misc | 2,000 |
| **合計** | **2,000** |

---

## 四、核心驗收公式

### 2026-04
```
Revenue     = 50,000
Total Cost  = 10,500
Gross Profit = 50,000 − 10,500 = 39,500
Net Profit   = 39,500
Cost Ratio   = 10,500 / 50,000 × 100 = 21.0%
```

### 2026-05
```
Revenue     = 36,000
Total Cost  = 7,200
Net Profit   = 28,800
Cost Ratio   = 7,200 / 36,000 × 100 = 20.0%
```

### 2026-06（零收入）
```
Revenue     = 0
Total Cost  = 2,000
Net Profit   = −2,000
Cost Ratio   = None（不除以零）
```

---

## 五、測試案例

### C1 — CRUD 操作

#### C1-001 新增單筆成本
```
操作：新增 maintenance = 1,000 到 2026-04
預期：Monthly Cost 2026-04 = 11,500
預期：Net Profit 2026-04 = 38,500
驗收：cost_entries 新增一筆，activity_log 有 cost_create 記錄
```

#### C1-002 編輯成本
```
操作：將 2026-04 的 utilities 從 5,000 改為 6,000
預期：Monthly Cost 增加 1,000（= 11,500）
預期：Net Profit 減少 1,000（= 38,500）
驗收：entry.amount = 6,000；activity_log 有 cost_edit 記錄（含 before/after）
```

#### C1-003 刪除成本
```
操作：刪除 2026-04 的 misc 500
預期：Monthly Cost 減少 500
預期：Net Profit 增加 500
驗收：DB 中記錄消失；activity_log 有 cost_delete 記錄
```

---

### C2 — Monthly P&L 計算

#### C2-001 月成本加總
```
查詢：2026-04 所有成本
預期：Σ amount = 10,500（seed 後）
驗收：monthly_pnl(db, "2026-04").total_cost == 10500
```

#### C2-002 月營收抓取
```
查詢：2026-04 payments
預期：revenue = 50,000
驗收：monthly_pnl(db, "2026-04").revenue == 50000
```

#### C2-003 Net Profit
```
預期：39,500（= 50,000 − 10,500）
驗收：monthly_pnl(db, "2026-04").gross_profit == 39500
```

#### C2-004 Cost Ratio
```
預期：21.0%（= 10,500 / 50,000 × 100）
驗收：monthly_pnl(db, "2026-04").cost_ratio == 21.0
```

---

### C3 — 篩選與隔離

#### C3-001 月份篩選
```
查詢 2026-05 成本
預期：只返回 2026-05 的 3 筆記錄（utilities, cleaning_supplies, maintenance）
2026-04 的 6 筆不可出現
```

#### C3-002 分類篩選
```
篩選 2026-04 category = maintenance
預期：只返回金額 2,000 的 1 筆
Σ amount = 2,000（不含其他分類）
```

#### C3-003 跨月統計隔離
```
2026-04 Total Cost = 10,500
2026-05 Total Cost = 7,200
兩者獨立計算，不相互污染
```

---

### C4 — 邊界條件

#### C4-001 零收入月份
```
查詢 2026-06
Revenue = 0, Total Cost = 2,000
Net Profit = −2,000
Cost Ratio = None（不觸發除以零錯誤）
profitable = False
```

#### C4-002 退款對營收影響
```
操作：新增一筆退款 2,000 到 2026-05
原 Revenue = 36,000
修正後 Revenue = 34,000
Net Profit 同步減少 2,000 = 26,800
```

#### C4-003 空月份（無成本無收入）
```
查詢 2026-03（無任何資料）
Revenue = 0, Total Cost = 0
Net Profit = 0, Cost Ratio = None
不報錯
```

---

### C5 — 權限控制

#### C5-001 Admin 可訪問
```
admin01 GET /costs → 200 OK
admin01 可新增/編輯/刪除
```

#### C5-002 Front Desk 被阻擋
```
front01 GET /costs → 302 /login?err=auth.forbidden
front01 Navbar 中無 Costs 連結
```

#### C5-003 Manager 被阻擋
```
mgr01 GET /costs → 302 /login?err=auth.forbidden
（manager 不是 admin，應被後端阻擋）
```

#### C5-004 POST 路由也受保護
```
front01 Cookie + POST /costs/create → 302 forbidden
不可繞過後端創建成本記錄
```

---

### C6 — Activity Log

#### C6-001 新增記錄有 log
```
新增後：activity_logs 有 action_type=cost_create
log.target_type = "cost"
log.description 含 category 和金額
```

#### C6-002 編輯記錄有 log
```
編輯後：activity_logs 有 action_type=cost_edit
log.original_value 含舊值
log.new_value 含新值
```

#### C6-003 刪除記錄有 log
```
刪除後：activity_logs 有 action_type=cost_delete
log.original_value 含被刪除的記錄資訊
```

---

## 六、驗收標準

| 條件 | 標準 |
|------|------|
| 金額計算 | 與預期公式完全一致（允許浮點數四捨五入 ±0.1）|
| 月份隔離 | 跨月查詢互不污染 |
| 零收入防護 | Cost Ratio 為 None，不觸發 ZeroDivisionError |
| 權限保護 | 非 Admin 後端 302/403，無例外 |
| Activity Log | 每次 CRUD 操作均有對應記錄 |
| 篩選正確 | 分類篩選不混入其他類別 |

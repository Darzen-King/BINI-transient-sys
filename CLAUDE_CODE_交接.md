# CLAUDE CODE 交接 — v3.9.7

日期：2026-08-25
版本：v3.9.6 → **v3.9.7**

## v3.9.7 修正紀錄（2026-08-25）

### 新增預約房間選單顯示過期「下一筆預約」

- **症狀**：`/bookings/new` 的房間選單仍顯示已過期、已刪除或已不在有效預約清單中的 `next_booking` 時間。
- **根因**：表單直接渲染 `Room.next_booking`。該欄位是歷史上的反正規化快取，建立預約只會在新時間較早時更新；舊預約過期或由其他流程移除後，快取可能殘留。
- **修正**：新增 `app/services/bookings.py::get_next_booking_for_room()`，以目前時間即時查詢同房間最早的非取消未來預約；`app/routers/bookings.py::booking_new_form` 載入房間選項時改用此查詢。
- **驗證**：`tests/next_booking_regression_test.py` 驗證「只有過期預約時回傳空值」以及「有未來有效預約時回傳最早一筆」。
- **相容性**：保留 `Room.next_booking` 欄位與既有建立/取消流程；本次先修正新增預約頁的讀取來源，避免以舊快取污染 UI。

## 本次需求（使用者）
1. 所有資料變動（預約、入住、退房、清潔、任何與金錢相關的變動）都要自動備份。
2. 付款管理「新增付款」要能**選擇**目前在住房客帶入資料，同時**保留手動輸入**以應付例外情況。
3. 變更要記錄 CHANGELOG 與本交接文件。

---

## 1. 自動備份補齊（所有資料變動）

先前已配線 `auto_backup()` 的端點：入住 / 退房 / 延住 / 預約(新增·修改·多筆·no-show 取消) / 付款新增 / 清潔更新 / 維修更新 / 維修排程完成 / 月租(建立·退租·續租)。

本次**補齊**以下未配線端點（皆為營運或金錢資料變動）：

| 檔案 | 端點 | trigger |
|------|------|---------|
| `app/routers/costs.py` | `create_cost` / `edit_cost` / `delete_cost` | `cost` |
| `app/routers/bookings.py` | `cancel_booking`（取消預約） | `booking` |
| `app/routers/rooms.py` | `update_room`（房態更新） | `room` |
| `app/routers/rooms.py` | `do_transfer`（換房，成功時） | `transfer` |
| `app/routers/phase4.py` | `delete_payment`（付款刪除，成功時） | `payment` |
| `app/routers/phase4.py` | `close_cashier`（日結） | `cashier` |
| `app/routers/phase4.py` | `maintenance_schedule_create` / `maintenance_schedule_delete` | `maintenance` |
| `app/routers/phase4.py` | `create_property`（物業建立） | `property` |
| `app/routers/admin.py` | 假日 `add_holiday` / `delete_holiday` / `resync_holidays` | `holiday` |
| `app/routers/auth.py` | 使用者 `create_user` / `toggle_user` / `change_password` / `edit_user` / `update_profile_compat` | `user` |

> **假日備份的關鍵修正**：`HolidayCache` 先前不在備份匯出/匯入清單中，只加 `auto_backup` 觸發是不夠的（備份了卻無法還原）。已於 `app/services/backup.py` 的 `_export_db`（新增 `holiday_cache` 匯出）與 `_import_data`（新增 `HolidayCache` 還原，Integer PK → `pop_id=True`，且「payload 有 key 才還原」以免舊備份洗掉現有假日）補齊。`User` 本就在備份範圍，故帳號變動觸發備份即有效。

**設計要點**
- 全部呼叫既有的 `app/services/backup.py::auto_backup(db, trigger=...)`。
- `auto_backup` 內部只在「已設定雲端憑證 **且** `auto_backup` 開關為開」時才實際同步；否則直接 return，不影響主流程。
- `sync_backup` 內部已 try/except，備份失敗只寫 log、不會拋例外中斷結帳/退房等操作。
- `costs.py`、`bookings.py`、`rooms.py` 於檔頭 import `auto_backup as _auto_backup`；`phase4.py` 沿用該檔既有的**函式內區域 import** 風格。

---

## 2. 付款新增：選擇在住房客

- `app/routers/phase4.py::payments_page` 新增傳入 `active_stays = get_all_active_stays(db)`
  （來源：`app/services/stays.py`，回傳依房號排序的 `ActiveStay`，含 `room` / `guest` / `booking_id`）。
- `app/templates/payments.html` 新增付款視窗：
  - 頂端「選擇入住房客」下拉（`#paySelectStay`），選項帶 `data-guest` / `data-room` / `data-booking`。
  - 新增隱藏欄位 `booking_id`（`#payBookingId`）——選取房客時一併帶入，付款即可歸戶到該筆預約。
  - guest 欄位 `#payGuest`、room 欄位 `#payRoomId`。
  - JS：選房客→自動帶入 guest/room/booking；選「手動輸入」（空值）→清空 booking 連結、文字欄位維持可自由輸入。
  - 僅在有在住房客時才渲染下拉（`{% if active_stays %}`）。
- i18n（`app/i18n/zh.json`、`en.json`）：`payment.select_guest`、`payment.select_guest_hint`、`payment.manual_input`。
- 後端 `/payments/add` 原本即接受 `booking_id` 參數，無需改動；未選房客時 `booking_id` 為空字串 → 服務層轉為 `None`。

---

## 3. 版本 / 文件
- `VERSION` → `3.9.5`（單一版本來源，`main.py` 讀取）。
- `start.bat` / `install.bat` 標題字串 v3.9.4 → v3.9.5。
- `CHANGELOG.md` 新增 v3.9.5 條目。

---

## 驗證輸出（實際終端）

**typecheck（compileall）**
```
compileall: OK — no syntax/compile errors in app/
```

**build（FastAPI app 匯入）**
```
APP IMPORT: OK
total routes: 83
changed routers import: OK
```

zh/en JSON 解析：`zh.json + en.json OK`。

> 註：本專案未安裝 mypy / ruff / pyflakes，亦無 pyproject/package.json 定義的 typecheck/build 腳本；Python 專案以 `python -m compileall`（編譯期檢查）作為 typecheck、以實際匯入 FastAPI app 作為 build 驗證。專案執行用直譯器：`%LocalAppData%\Programs\Python\Python312\python.exe`（含 fastapi/uvicorn/sqlalchemy/pywebview）。

---

## 後續注意 / 未做
- 使用者帳號管理與假日設定已於本版（後續追加）納入自動備份，並補齊 `HolidayCache` 的備份匯出/匯入。
- 目前所有會變更 DB 的 POST 端點均已配線 `auto_backup`（唯 `/set-lang` 語言切換、`/login` 登入、CSV 匯出、備份頁自身操作除外——皆非業務資料變動）。
- 清潔相關的自動備份使用者特別點名——`/housekeeping/update` 先前已配線，本次確認無誤。

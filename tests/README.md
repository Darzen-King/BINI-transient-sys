# Phase-4 測試腳本 — 快速說明

## Windows 執行（CMD）

```bat
REM ─── 1. 重置 DB ───────────────────────────────────────
python tests\reset_db.py

REM ─── 2. 啟動服務（第一次建表）────────────────────────
uvicorn app.main:app --reload
REM 看到 "Default users created" 後按 Ctrl+C

REM ─── 3. 植入測試資料 ────────────────────────────────
python tests\seed_phase4_test_data.py

REM ─── 4. 重新啟動 ────────────────────────────────────
uvicorn app.main:app --reload

REM ─── 5. 另開 CMD 執行 smoke test ────────────────────
python tests\phase4_smoke_test.py
```

## macOS / Linux 執行

```bash
python tests/reset_db.py
uvicorn app.main:app --reload   # Ctrl+C after "Default users created"
python tests/seed_phase4_test_data.py
uvicorn app.main:app --reload
python tests/phase4_smoke_test.py   # in a new terminal
```

## 測試帳號

| 帳號 | 密碼 | 角色 |
|------|------|------|
| admin01 | Test@1234 | Admin |
| mgr01 | Test@1234 | Manager |
| front01 | Test@1234 | Front Desk |
| house01 | Test@1234 | Housekeeping |
| maint01 | Test@1234 | Maintenance |

## 測試結果預期

```
smoke test 執行後應顯示：
  ✅ 48 PASSED | ❌ 0 FAILED
```

## 常見問題

**Q: `rm` is not recognized**
A: 使用 `python tests\reset_db.py` 取代 `rm -f bini_blooms.db`

**Q: Application startup failed**
A: DB 欄位缺少，請先執行 `python tests\reset_db.py` 清除舊 DB

**Q: Permission error on reset_db.py**
A: uvicorn 仍在執行，請先按 Ctrl+C 停止服務再刪除 DB

#!/usr/bin/env python3
"""
tools/reset_admin.py
────────────────────
緊急重設 admin 密碼。
停止伺服器後在專案根目錄執行：
  python tools\reset_admin.py
"""
import sys, os, pathlib, sqlite3, hashlib, hmac, secrets
from datetime import datetime

DB_PATH = pathlib.Path("bini_blooms.db")

if not DB_PATH.exists():
    print("❌ 找不到 bini_blooms.db，請在專案根目錄執行此腳本")
    sys.exit(1)

print("=== BINI Blooms — Admin 密碼重設 ===\n")
new_pw = input("請輸入新密碼（留空使用預設 admin1234）: ").strip() or "admin1234"

salt = secrets.token_hex(16)
h    = hashlib.pbkdf2_hmac("sha256", new_pw.encode(), salt.encode(), 260_000)

con = sqlite3.connect(str(DB_PATH))
cur = con.cursor()

# Check if users table exists
cur.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='users'")
if not cur.fetchone():
    print("❌ users 表不存在，請先啟動一次伺服器讓系統建立資料表")
    con.close()
    sys.exit(1)

# Check if admin exists
cur.execute("SELECT id, username FROM users WHERE username='admin'")
row = cur.fetchone()

if row:
    cur.execute(
        "UPDATE users SET password_hash=?, password_salt=? WHERE username='admin'",
        (h.hex(), salt)
    )
    print(f"✅ admin 密碼已重設為：{new_pw}")
else:
    # Create admin user
    cur.execute("""
        INSERT INTO users (username, display_name, password_hash, password_salt, role, is_active, created_at)
        VALUES ('admin', 'Administrator', ?, ?, 'admin', 1, ?)
    """, (h.hex(), salt, datetime.now().strftime("%Y-%m-%d %H:%M")))
    print(f"✅ admin 帳號已建立，密碼：{new_pw}")

con.commit()
con.close()
print("\n請重新啟動伺服器後使用新密碼登入。")

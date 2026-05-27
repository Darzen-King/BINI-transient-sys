#!/usr/bin/env python3
"""
tests/reset_db.py
─────────────────
跨平台 DB 重置工具（Windows / macOS / Linux）。

替代 Linux 指令：rm -f bini_blooms.db
Windows 等效：   del bini_blooms.db

執行：
  python tests/reset_db.py          # 從專案根目錄執行
  python tests/reset_db.py --force  # 不詢問直接刪除
"""
import sys
import os
import pathlib

# ── Find DB path ─────────────────────────────────────────────────────────
# Look in the current working directory and common locations
POSSIBLE_PATHS = [
    pathlib.Path("bini_blooms.db"),
    pathlib.Path("../bini_blooms.db"),
    pathlib.Path(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))) / "bini_blooms.db",
]

db_path = None
for p in POSSIBLE_PATHS:
    if p.exists():
        db_path = p.resolve()
        break

force = "--force" in sys.argv or "-f" in sys.argv

print("=== BINI Blooms DB Reset ===\n")

if db_path is None:
    print("ℹ  No bini_blooms.db found — nothing to delete.")
    print("   (This is OK if you are starting fresh)\n")
else:
    print(f"Found: {db_path}")
    size_kb = db_path.stat().st_size // 1024
    print(f"  Size: {size_kb} KB")

    if not force:
        answer = input("\nDelete this file? [y/N] ").strip().lower()
        if answer not in ("y", "yes"):
            print("Cancelled.")
            sys.exit(0)

    try:
        db_path.unlink()
        print(f"\n✅ Deleted: {db_path}")
    except PermissionError:
        print(f"\n❌ Cannot delete: file is in use.")
        print("   Please stop the uvicorn server first, then retry.")
        sys.exit(1)
    except Exception as e:
        print(f"\n❌ Error: {e}")
        sys.exit(1)

print("\n📌 Next steps:")
print("   1. uvicorn app.main:app --reload")
print("      (wait for '✅ Default users created')")
print("   2. python tests\\seed_phase4_test_data.py   (Windows)")
print("      python tests/seed_phase4_test_data.py   (Mac/Linux)")
print("   3. uvicorn app.main:app --reload")
print("   4. python tests\\phase4_smoke_test.py")

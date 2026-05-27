#!/usr/bin/env python3
"""
tests/seed_cost_test_data.py
────────────────────────────
Costs Module 測試資料植入腳本。可重複執行（已存在則跳過）。

執行：
  cd <project_root>
  python tests/seed_cost_test_data.py
"""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from datetime import datetime
from sqlalchemy.orm import Session
from app.db import engine, SessionLocal
from app.models import Base

# Run migrations first
Base.metadata.create_all(bind=engine)
from app.main import (
    _migrate_backup_state_columns,
    _migrate_activity_log_table,
    _migrate_property_id_columns,
    _migrate_cost_entries_table,
)
_migrate_backup_state_columns()
_migrate_activity_log_table()
_migrate_property_id_columns()
_migrate_cost_entries_table()
print("✅ Schema ready\n")

db = SessionLocal()

try:
    # ── 1. Users ──────────────────────────────────────────────────────────────
    from app.models import User
    from app.services.auth import create_user

    print("--- Test Users ---")
    test_users = [
        ("admin01", "Test@1234", "Cost Test Admin",   "admin"),
        ("front01", "Test@1234", "Cost Test Front",   "front_desk"),
        ("mgr01",   "Test@1234", "Cost Test Manager", "manager"),
    ]
    for username, password, display, role in test_users:
        if db.query(User).filter(User.username == username).first():
            print(f"  ⚠  {username} exists — skipped")
        else:
            create_user(db, username, password, display, role)
            print(f"  ✅ {username} / {password}  [{role}]")

    # ── 2. Revenue via payments ────────────────────────────────────────────────
    from app.models import Payment
    from app.services.payments import create_payment

    print("\n--- Revenue Payments ---")

    # 2026-04: 3 payments = 53,000 gross, 3,000 refund → net 50,000
    apr_payments = [
        ("2026-04-03 10:00", "cash",     20000.0, False, False, "4月收款1"),
        ("2026-04-10 14:00", "transfer", 18000.0, False, False, "4月收款2"),
        ("2026-04-20 11:00", "cash",     15000.0, False, False, "4月收款3"),
        ("2026-04-25 09:00", "cash",      3000.0, False, True,  "4月退款"),
    ]
    apr_count = db.query(Payment).filter(
        Payment.created_at >= "2026-04-01",
        Payment.created_at <= "2026-04-30 23:59"
    ).count()

    if apr_count == 0:
        for ts, ptype, amount, is_dep, is_ref, note in apr_payments:
            p = Payment(
                booking_id=None, room_id=None, guest="測試旅客",
                payment_type=ptype, amount=amount,
                is_deposit=1 if is_dep else 0,
                is_refund=1 if is_ref else 0,
                payment_status="paid", note=note,
                created_at=ts, created_by="seed_script",
            )
            db.add(p)
        db.commit()
        gross = 20000 + 18000 + 15000
        refund = 3000
        print(f"  ✅ 2026-04 payments: gross={gross} refund={refund} net={gross-refund}")
    else:
        print(f"  ⚠  2026-04 payments exist ({apr_count}) — skipped")

    # 2026-05: 2 payments = 39,000 gross, 3,000 refund → net 36,000
    may_payments = [
        ("2026-05-05 10:00", "transfer", 22000.0, False, False, "5月收款1"),
        ("2026-05-15 14:00", "cash",     17000.0, False, False, "5月收款2"),
        ("2026-05-20 09:00", "cash",      3000.0, False, True,  "5月退款"),
    ]
    may_count = db.query(Payment).filter(
        Payment.created_at >= "2026-05-01",
        Payment.created_at <= "2026-05-31 23:59"
    ).count()

    if may_count == 0:
        for ts, ptype, amount, is_dep, is_ref, note in may_payments:
            p = Payment(
                booking_id=None, room_id=None, guest="測試旅客",
                payment_type=ptype, amount=amount,
                is_deposit=1 if is_dep else 0,
                is_refund=1 if is_ref else 0,
                payment_status="paid", note=note,
                created_at=ts, created_by="seed_script",
            )
            db.add(p)
        db.commit()
        print(f"  ✅ 2026-05 payments: gross=39000 refund=3000 net=36000")
    else:
        print(f"  ⚠  2026-05 payments exist ({may_count}) — skipped")

    # 2026-06: no payments (zero-revenue month test)
    print(f"  ✅ 2026-06: no payments (zero-revenue test month)")

    # ── 3. Cost Entries ────────────────────────────────────────────────────────
    from app.models import CostEntry
    from app.services.costs import create_cost

    print("\n--- Cost Entries 2026-04 (expected total: 10,500) ---")
    apr_costs = [
        ("2026-04-01", "utilities",         5000.0, "transfer", "台電",   "4月電費"),
        ("2026-04-02", "cleaning_supplies", 1200.0, "cash",     "清潔公司", "清潔用品補貨"),
        ("2026-04-05", "laundry",            800.0, "cash",     "洗衣店",  "4月送洗費"),
        ("2026-04-10", "maintenance",       2000.0, "cash",     "維修師傅", "浴室漏水修繕"),
        ("2026-04-15", "internet_software", 1000.0, "transfer", "中華電信", "網路月租"),
        ("2026-04-20", "misc",               500.0, "cash",     "",        "雜費"),
    ]
    apr_cost_count = db.query(CostEntry).filter(
        CostEntry.cost_date >= "2026-04-01",
        CostEntry.cost_date <= "2026-04-30"
    ).count()

    if apr_cost_count == 0:
        for cost_date, cat, amount, pm, vendor, desc in apr_costs:
            create_cost(db,
                cost_date=cost_date, category=cat, amount=amount,
                payment_method=pm, vendor=vendor, description=desc,
                created_by="seed_script"
            )
        total_apr = sum(c[2] for c in apr_costs)
        print(f"  ✅ 2026-04: {len(apr_costs)} entries, total={total_apr}")
    else:
        print(f"  ⚠  2026-04 costs exist ({apr_cost_count}) — skipped")

    print("\n--- Cost Entries 2026-05 (expected total: 7,200) ---")
    may_costs = [
        ("2026-05-01", "utilities",         4800.0, "transfer", "台電",   "5月電費"),
        ("2026-05-03", "cleaning_supplies",  900.0, "cash",     "清潔公司", "清潔用品"),
        ("2026-05-10", "maintenance",       1500.0, "cash",     "維修師傅", "冷氣保養"),
    ]
    may_cost_count = db.query(CostEntry).filter(
        CostEntry.cost_date >= "2026-05-01",
        CostEntry.cost_date <= "2026-05-31"
    ).count()

    if may_cost_count == 0:
        for cost_date, cat, amount, pm, vendor, desc in may_costs:
            create_cost(db,
                cost_date=cost_date, category=cat, amount=amount,
                payment_method=pm, vendor=vendor, description=desc,
                created_by="seed_script"
            )
        total_may = sum(c[2] for c in may_costs)
        print(f"  ✅ 2026-05: {len(may_costs)} entries, total={total_may}")
    else:
        print(f"  ⚠  2026-05 costs exist ({may_cost_count}) — skipped")

    print("\n--- Cost Entries 2026-06 (zero-revenue month) ---")
    jun_cost_count = db.query(CostEntry).filter(
        CostEntry.cost_date >= "2026-06-01",
        CostEntry.cost_date <= "2026-06-30"
    ).count()

    if jun_cost_count == 0:
        create_cost(db,
            cost_date="2026-06-01", category="misc", amount=2000.0,
            payment_method="cash", vendor="", description="零收入月份測試成本",
            created_by="seed_script"
        )
        print(f"  ✅ 2026-06: 1 entry, total=2000 (zero-revenue test)")
    else:
        print(f"  ⚠  2026-06 costs exist ({jun_cost_count}) — skipped")

    # ── 4. Summary ────────────────────────────────────────────────────────────
    from app.models import ActivityLog
    print("\n=== Seed Summary ===")
    print(f"  Users:         {db.query(User).count()}")
    print(f"  Payments:      {db.query(Payment).count()}")
    print(f"  Cost Entries:  {db.query(CostEntry).count()}")
    print(f"  Activity Logs: {db.query(ActivityLog).count()}")

    print("\n=== Expected P&L ===")
    print(f"  2026-04: Revenue=50,000 | Cost=10,500 | Profit=39,500 | Ratio=21.0%")
    print(f"  2026-05: Revenue=36,000 | Cost=7,200  | Profit=28,800 | Ratio=20.0%")
    print(f"  2026-06: Revenue=0      | Cost=2,000  | Profit=-2,000 | Ratio=None")

    print("\n=== Test Credentials ===")
    for username, password, _, role in test_users:
        print(f"  {username:10} / {password}  [{role}]")

    print("\n✅ Cost test data seeded. Run: python tests/cost_profit_smoke_test.py")

finally:
    db.close()

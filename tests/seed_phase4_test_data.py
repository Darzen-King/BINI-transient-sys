#!/usr/bin/env python3
"""
tests/seed_phase4_test_data.py
────────────────────────────────
Phase-4 測試資料植入腳本。可重複執行（已存在的記錄會跳過）。

執行：
  cd <project_root>
  python tests/seed_phase4_test_data.py

輸出：每筆建立的資料會列出，已存在則標記 ⚠ skipped
"""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from datetime import datetime, date, timedelta
from sqlalchemy.orm import Session

# ── Bootstrap DB ──────────────────────────────────────────────────────────
from app.db import engine, SessionLocal
from app.models import Base

print("=== Phase-4 Test Data Seed ===")
print("Creating tables if needed...")
Base.metadata.create_all(bind=engine)

# Run all migrations to ensure columns exist
from app.main import (
    _migrate_backup_state_columns,
    _migrate_activity_log_table,
    _migrate_property_id_columns,
)
_migrate_backup_state_columns()
_migrate_activity_log_table()
_migrate_property_id_columns()
print("✅ Schema ready\n")

# ── Helpers ───────────────────────────────────────────────────────────────
def _now(offset_h: int = 0) -> str:
    return (datetime.now() + timedelta(hours=offset_h)).strftime("%Y-%m-%d %H:%M")

def _today(offset_d: int = 0) -> str:
    return (date.today() + timedelta(days=offset_d)).strftime("%Y-%m-%d")

# ─────────────────────────────────────────────────────────────────────────
db = SessionLocal()

try:
    # ── 1. USERS ─────────────────────────────────────────────────────────
    from app.models import User
    from app.services.auth import create_user

    print("--- Users ---")
    test_users = [
        ("admin01",  "Test@1234", "Test Admin",        "admin"),
        ("mgr01",    "Test@1234", "Test Manager",      "manager"),
        ("front01",  "Test@1234", "Test Front Desk",   "front_desk"),
        ("house01",  "Test@1234", "Test Housekeeping", "housekeeping"),
        ("maint01",  "Test@1234", "Test Maintenance",  "maintenance"),
    ]
    for username, password, display, role in test_users:
        if db.query(User).filter(User.username == username).first():
            print(f"  ⚠  {username} already exists — skipped")
        else:
            create_user(db, username, password, display, role)
            print(f"  ✅ {username} / {password}  [{role}]")

    # ── 2. PROPERTIES ────────────────────────────────────────────────────
    from app.models import Property

    print("\n--- Properties ---")
    properties = [
        ("Taichung_Main",  "台中總館",  "台中市西區民權路100號"),
        ("Taichung_Annex", "台中副館",  "台中市北區民生路200號"),
    ]
    for pid, name, addr in properties:
        if db.query(Property).filter(Property.id == pid).first():
            print(f"  ⚠  {pid} exists — skipped")
        else:
            db.add(Property(id=pid, name=name, address=addr,
                            is_active=1, created_at=_now()))
            print(f"  ✅ {pid} ({name})")
    db.commit()

    # ── 3. ROOMS ─────────────────────────────────────────────────────────
    from app.models import Room

    print("\n--- Rooms ---")
    test_rooms = [
        # id, status, note, maintenance_note, maintenance_due, property_id
        ("T001", "可入住",  "測試-可入住/入住測試",      None, None, "Taichung_Main"),
        ("T002", "可入住",  "測試-退房→清潔流程",        None, None, "Taichung_Main"),
        ("T003", "可入住",  "測試-換房來源房間",          None, None, "Taichung_Main"),
        ("T004", "可入住",  "測試-換房目標房間",          None, None, "Taichung_Main"),
        ("T005", "待清潔",  "測試-清潔流程",              None, None, "Taichung_Annex"),
        ("T006", "維修中",  "測試-維修流程",
            "電燈故障，需更換燈管", _today(3),              "Taichung_Annex"),
    ]
    for rid, status, note, maint_note, maint_due, prop_id in test_rooms:
        if db.query(Room).filter(Room.id == rid).first():
            print(f"  ⚠  {rid} exists — skipped")
        else:
            db.add(Room(
                id=rid, status=status, note=note,
                maintenance_note=maint_note,
                maintenance_due=maint_due,
                property_id=prop_id,
            ))
            print(f"  ✅ {rid} [{status}] → {prop_id}")
    db.commit()

    # ── 4. BOOKINGS ───────────────────────────────────────────────────────
    from app.models import Booking

    print("\n--- Bookings ---")
    bookings = [
        # id, room, guest, phone, checkin, checkout, plan, amount, rate_type, status, prop_id
        ("TEST-BK001", "T001", "王小姐(預約)",  "0911-001-001",
         _today() + " 14:00", _today(1) + " 14:00",
         "24hrs", 1000, "非假日", "已預約", "Taichung_Main"),

        ("TEST-BK002", "T002", "林先生(清潔測試)", "0911-002-002",
         _today() + " 10:00", _today() + " 22:00",
         "12hrs",  800, "非假日", "已預約", "Taichung_Main"),

        ("TEST-BK003", "T005", "陳女士(副館)",  "0911-003-003",
         _today(1) + " 15:00", _today(2) + " 15:00",
         "24hrs", 1000, "非假日", "已預約", "Taichung_Annex"),
    ]
    for bk in bookings:
        bid = bk[0]
        if db.query(Booking).filter(Booking.id == bid).first():
            print(f"  ⚠  {bid} exists — skipped")
        else:
            db.add(Booking(
                id=bid, room=bk[1], guest=bk[2], phone=bk[3],
                checkin=bk[4], checkout=bk[5], plan=bk[6],
                amount=bk[7], rate_type=bk[8], status=bk[9],
                property_id=bk[10],
            ))
            print(f"  ✅ {bid}  {bk[2]} → {bk[1]}  ({bk[10]})")
    db.commit()

    # ── 5. ACTIVE STAY (for payment testing) ─────────────────────────────
    from app.models import ActiveStay

    print("\n--- Active Stay (payment test) ---")
    stay_room = "T001"
    if db.query(ActiveStay).filter(ActiveStay.room == stay_room).first():
        print(f"  ⚠  ActiveStay {stay_room} exists — skipped")
    else:
        ci = _now(-2)
        co = _now(22)
        db.add(ActiveStay(
            room=stay_room, guest="付款測試旅客",
            plan="24hrs", base_rent=1000.0,
            extension_fee=0.0, extra_fee=0.0, total_due=1000.0,
            checkin_time=ci, checkout_time=co, hourly_rate=41.67,
        ))
        room = db.query(Room).filter(Room.id == stay_room).first()
        if room:
            room.status = "使用中"
            room.current_guest = "付款測試旅客"
            room.checkin = ci
            room.checkout = co
        db.commit()
        print(f"  ✅ T001 active stay (付款測試旅客，CI={ci})")

    # ── 6. PAYMENTS ───────────────────────────────────────────────────────
    from app.models import Payment
    from app.services.payments import create_payment

    print("\n--- Payments ---")
    if db.query(Payment).filter(Payment.room_id == "T001").count() == 0:
        # Deposit
        p1 = create_payment(db, "TEST-BK001", "T001", "付款測試旅客",
                             "cash", 500.0, is_deposit=True,
                             note="押金 NT$500", created_by="front01")
        print(f"  ✅ 押金 NT$500 (cash)  id={p1.id}")

        # Partial payment
        p2 = create_payment(db, "TEST-BK001", "T001", "付款測試旅客",
                             "transfer", 300.0, is_deposit=False,
                             note="部分付款 NT$300", created_by="front01")
        print(f"  ✅ 部分付款 NT$300 (transfer)  id={p2.id}")

        # Refund (to test T2-005)
        p3 = create_payment(db, "TEST-BK001", "T001", "付款測試旅客",
                             "cash", 100.0, is_refund=True,
                             note="部分退款 NT$100", created_by="mgr01")
        print(f"  ✅ 退款 NT$100 (cash)  id={p3.id}")
    else:
        print("  ⚠  T001 payments exist — skipped")

    # ── 7. ACTIVITY LOGS (seed markers) ──────────────────────────────────
    from app.services.audit import log_action
    log_action(db, "test_seed", target_id="SEED-RUN",
               target_type="test",
               new_value={"seeded_at": _now(), "version": "phase4"},
               description="Phase-4 test data seeded by seed_phase4_test_data.py",
               user_id="seed_script")
    print(f"\n  ✅ Activity log seed marker recorded")

    # ── 8. SUMMARY ────────────────────────────────────────────────────────
    from app.models import ActivityLog, CashierSession
    print("\n=== Seed Summary ===")
    print(f"  Users:         {db.query(User).count()}")
    print(f"  Properties:    {db.query(Property).count()}")
    print(f"  Rooms:         {db.query(Room).count()}")
    print(f"  Bookings:      {db.query(Booking).count()}")
    print(f"  Active Stays:  {db.query(ActiveStay).count()}")
    print(f"  Payments:      {db.query(Payment).count()}")
    print(f"  Activity Logs: {db.query(ActivityLog).count()}")

    print("\n=== Test Credentials ===")
    for username, password, _, role in test_users:
        print(f"  {username:12} / {password}  [{role}]")

    import os
    is_windows = os.name == 'nt'
    sep = "\\" if is_windows else "/"
    print("\n=== Next Steps ===")
    print(f"  1. uvicorn app.main:app --reload")
    print(f"  2. Open: http://127.0.0.1:8000/login")
    print(f"  3. Run smoke test:")
    print(f"     python tests{sep}phase4_smoke_test.py")
    print("\n✅ Seed complete.")

finally:
    db.close()

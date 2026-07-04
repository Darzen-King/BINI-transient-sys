"""
main.py — BINI Blooms FastAPI application entry point.

Startup sequence:
  1. Create all SQLAlchemy tables (if they don't exist)
  2. Run seed (only if rooms table is empty)
  3. Mount static files
  4. Register all routers
"""
from pathlib import Path

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles

from app.db import engine
from app.models import Base          # triggers model registration
from app.seed.seed_db import run_seed
from app.db import SessionLocal

# ── Routers ────────────────────────────────────────────────────────────────
from app.routers import hub, rooms, bookings, checkin, stays, reports, backup, lang, admin, auth
from app.routers import phase4, costs as costs_router

# ── App init ───────────────────────────────────────────────────────────────
APP_VERSION = "v3.9.0"

app = FastAPI(title="BINI Blooms PMS", version="3.9.0")

# ── Auth middleware ────────────────────────────────────────────────────────
from fastapi import Request as _Req
from fastapi.responses import RedirectResponse as _RR
from urllib.parse import quote as _quote

PUBLIC_PATHS = ("/login", "/static", "/set-lang", "/api/")

@app.middleware("http")
async def auth_middleware(request: _Req, call_next):
    path = request.url.path
    if any(path.startswith(pp) for pp in PUBLIC_PATHS):
        return await call_next(request)
    from app.services.auth import get_current_user
    from app.db import SessionLocal as _SL
    db = _SL()
    try:
        user = get_current_user(request, db)
    finally:
        db.close()
    if not user:
        return _RR(f"/login?next={_quote(path)}", status_code=303)
    request.state.current_user = user
    return await call_next(request)

# ── Static files ───────────────────────────────────────────────────────────
# Project root: parent of app/
PROJECT_ROOT = Path(__file__).parent.parent
STATIC_DIR   = Path(__file__).parent / "static"
DB_PATH      = PROJECT_ROOT / "bini_blooms.db"
app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")


# ── DB init + seed on startup ──────────────────────────────────────────────
def _migrate_backup_state_columns():
    """
    SQLite ALTER TABLE — add Phase-4 columns to backup_state if they don't exist.
    SQLAlchemy create_all() never modifies existing tables, so we do it manually.
    Safe to run repeatedly (checks existing columns first).
    """
    import sqlite3
    db_path = DB_PATH
    if not db_path.exists():
        return  # Fresh DB — create_all will handle it

    new_columns = [
        ("provider_type", "TEXT DEFAULT 'dropbox'"),
        ("credentials",   "TEXT"),
        ("auto_backup",   "INTEGER NOT NULL DEFAULT 1"),
        ("test_status",   "TEXT"),
        ("test_message",  "TEXT"),
    ]

    con = sqlite3.connect(str(db_path))
    cur = con.cursor()
    cur.execute("PRAGMA table_info(backup_state)")
    existing = {row[1] for row in cur.fetchall()}

    added = []
    for col_name, col_def in new_columns:
        if col_name not in existing:
            cur.execute(f"ALTER TABLE backup_state ADD COLUMN {col_name} {col_def}")
            added.append(col_name)

    con.commit()
    con.close()
    if added:
        print(f"✅  DB migration: added columns to backup_state: {added}")


def _migrate_room_maintenance_columns():
    """
    Add Phase-3 maintenance columns — now delegated to _migrate_property_id_columns
    which handles all rooms table alterations in one idempotent pass.
    Kept for backward compatibility.
    """
    pass  # handled by _migrate_property_id_columns()


def _migrate_activity_log_table():
    """
    Ensure activity_logs table exists (added in Phase-3).
    create_all handles new tables, this is a safety check.
    """
    import sqlite3
    db_path = DB_PATH
    if not db_path.exists():
        return
    con = sqlite3.connect(str(db_path))
    con.execute("""
        CREATE TABLE IF NOT EXISTS activity_logs (
            id             INTEGER PRIMARY KEY AUTOINCREMENT,
            timestamp      TEXT NOT NULL,
            user_id        TEXT NOT NULL DEFAULT 'admin',
            action_type    TEXT NOT NULL,
            target_id      TEXT,
            target_type    TEXT,
            original_value TEXT,
            new_value      TEXT,
            description    TEXT
        )
    """)
    con.commit()
    con.close()



def _migrate_maintenance_schedules():
    """Ensure maintenance_schedules table exists."""
    import sqlite3
    db_path = DB_PATH
    if not db_path.exists():
        return
    try:
        con = sqlite3.connect(str(db_path))
        con.execute("""
            CREATE TABLE IF NOT EXISTS maintenance_schedules (
                id         INTEGER PRIMARY KEY AUTOINCREMENT,
                room_id    TEXT NOT NULL,
                title      TEXT NOT NULL,
                start_time TEXT NOT NULL,
                end_time   TEXT NOT NULL,
                note       TEXT,
                status     TEXT NOT NULL DEFAULT 'scheduled',
                created_by TEXT,
                created_at TEXT
            )
        """)
        con.commit()
        con.close()
    except Exception as e:
        print(f"⚠  maintenance_schedules migration: {e}")


def _migrate_cost_entries_table():
    """Ensure cost_entries table exists (added in Costs Module)."""
    import sqlite3
    db_path = DB_PATH
    if not db_path.exists():
        return
    try:
        con = sqlite3.connect(str(db_path))
        con.execute("""
            CREATE TABLE IF NOT EXISTS cost_entries (
                id             INTEGER PRIMARY KEY AUTOINCREMENT,
                property_id    TEXT,
                cost_date      TEXT NOT NULL,
                category       TEXT NOT NULL,
                subcategory    TEXT,
                amount         REAL NOT NULL DEFAULT 0,
                payment_method TEXT NOT NULL DEFAULT 'cash',
                vendor         TEXT,
                description    TEXT,
                note           TEXT,
                is_recurring   INTEGER NOT NULL DEFAULT 0,
                receipt_no     TEXT,
                created_by     TEXT,
                created_at     TEXT,
                updated_at     TEXT
            )
        """)
        con.commit()
        con.close()
    except Exception as e:
        print(f"⚠  cost_entries migration: {e}")


def _migrate_monthly_rentals_table():
    """Ensure monthly_rentals table exists (Monthly Rental feature)."""
    import sqlite3
    db_path = DB_PATH
    if not db_path.exists():
        return
    try:
        con = sqlite3.connect(str(db_path))
        con.execute("""
            CREATE TABLE IF NOT EXISTS monthly_rentals (
                id               INTEGER PRIMARY KEY AUTOINCREMENT,
                room_id          TEXT NOT NULL,
                tenant_name      TEXT NOT NULL,
                tenant_phone     TEXT,
                start_date       TEXT NOT NULL,
                end_date         TEXT NOT NULL,
                deposit          REAL NOT NULL DEFAULT 0,
                rent             REAL NOT NULL DEFAULT 0,
                status           TEXT NOT NULL DEFAULT 'active',
                deposit_refunded REAL NOT NULL DEFAULT 0,
                payment_type     TEXT DEFAULT 'cash',
                property_id      TEXT,
                note             TEXT,
                created_at       TEXT,
                ended_at         TEXT,
                created_by       TEXT
            )
        """)
        con.commit()
        con.close()
    except Exception as e:
        print(f"⚠  monthly_rentals migration: {e}")


def _migrate_property_id_columns():
    """
    Add property_id column to rooms and bookings tables if missing (Phase-4 Task 4).
    Also adds any other missing columns discovered after schema changes.
    Safe to run repeatedly (idempotent).
    """
    import sqlite3
    db_path = DB_PATH
    if not db_path.exists():
        return
    try:
        con = sqlite3.connect(str(db_path))
        cur = con.cursor()
        added = []
        # (table, column, definition)
        required = [
            ("rooms",        "property_id",           "TEXT"),
            ("rooms",        "maintenance_note",       "TEXT"),
            ("rooms",        "maintenance_due",        "TEXT"),
            ("bookings",     "property_id",            "TEXT"),
            ("bookings",     "discount",               "REAL NOT NULL DEFAULT 0"),
            ("users",        "allowed_pages",          "TEXT"),
            # BUG-A FIX: track original planned checkout for cumulative block fee
            ("active_stays", "original_checkout_time", "TEXT"),
            # Multi-day check-in discount
            ("active_stays", "discount",               "REAL NOT NULL DEFAULT 0"),
            # Link stay to originating booking for deposit queries
            ("active_stays", "booking_id",             "TEXT"),
            # Real processing timestamp (payment-scoping floor, ≠ checkin_time)
            ("active_stays", "created_at",             "TEXT"),
        ]
        for table, col, defn in required:
            try:
                cur.execute(f"PRAGMA table_info({table})")
                cols = {row[1] for row in cur.fetchall()}
                if col not in cols:
                    cur.execute(f"ALTER TABLE {table} ADD COLUMN {col} {defn}")
                    added.append(f"{table}.{col}")
            except Exception as e:
                print(f"⚠  Migration warning for {table}.{col}: {e}")
        con.commit()
        con.close()
        if added:
            print(f"✅  DB migration: added columns: {added}")
    except Exception as e:
        print(f"⚠  _migrate_property_id_columns error (non-fatal): {e}")


def _migrate_phase4_tables():
    """Ensure Phase-4 tables exist via SQLAlchemy create_all (already called)."""
    # create_all handles new tables: users, payments, cashier_sessions, properties
    # These are all new tables — no ALTER needed
    pass


def _seed_default_property(db):
    """Seed one default property if none exist."""
    from app.models import Property
    if db.query(Property).count() > 0:
        return
    from datetime import datetime
    db.add(Property(id="P001", name="BINI Blooms 總館",
                    address="", is_active=1,
                    created_at=datetime.now().strftime("%Y-%m-%d %H:%M")))
    db.commit()
    print("✅  Default property P001 seeded.")


def _seed_admin_user(db):
    """Create default admin user on first startup if no users exist."""
    from app.models import User as _User
    if db.query(_User).count() > 0:
        return
    from app.services.auth import create_user
    create_user(db, "admin", "admin1234", "Administrator", "admin")
    create_user(db, "front", "front1234", "Front Desk", "front_desk")
    create_user(db, "manager", "mgr1234", "Manager", "manager")
    create_user(db, "housekeeping", "hk1234", "Housekeeping", "housekeeping")
    create_user(db, "maintenance", "mt1234", "Maintenance", "maintenance")
    print("✅  Default users created (admin/admin1234 …)")


@app.on_event("startup")
def startup_event():
    Base.metadata.create_all(bind=engine)
    # Run ALL ALTER TABLE migrations BEFORE opening any SQLAlchemy session
    # (create_all does not ALTER existing tables — we must do it manually)
    _migrate_backup_state_columns()
    _migrate_room_maintenance_columns()  # Phase-3 Task3: maintenance_note/due
    _migrate_activity_log_table()        # Phase-3 Task2: activity_logs table
    _migrate_property_id_columns()       # Phase-4 Task4: property_id on rooms/bookings
    _migrate_monthly_rentals_table()     # Monthly Rental: monthly_rentals table
    db = SessionLocal()
    try:
        seeded = run_seed(db)
        if seeded:
            print("✅  Database initialised and seed data loaded.")
        else:
            print("✅  Database already seeded — skipping.")
        # Patch any active_stays that are missing checkin_time / checkout_time
        _patch_stay_timestamps(db)
        _seed_admin_user(db)
        _seed_default_property(db)

        # ── Auto-fetch government holidays (background thread) ──────────────
        # Run in a separate thread so it NEVER blocks startup / page loads
        try:
            from sqlalchemy import text as _text
            try:
                db.execute(_text("SELECT 1 FROM holiday_cache LIMIT 1"))
            except Exception:
                db.execute(_text("""
                    CREATE TABLE IF NOT EXISTS holiday_cache (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        date TEXT NOT NULL UNIQUE,
                        description TEXT,
                        is_holiday INTEGER NOT NULL DEFAULT 1,
                        is_manual INTEGER NOT NULL DEFAULT 0,
                        year INTEGER NOT NULL DEFAULT 0,
                        source TEXT,
                        updated_at TEXT
                    )
                """))
                db.commit()
        except Exception as _te:
            print(f"⚠️  holiday_cache table init skipped: {_te}")

        def _bg_holiday_sync():
            """Background holiday sync — never blocks startup."""
            import time
            time.sleep(3)   # wait for server to fully start first
            try:
                from app.db import SessionLocal as _SL
                from app.services.holiday_sync import sync_holidays
                _db2 = _SL()
                try:
                    result = sync_holidays(_db2)
                    print(f"✅  Holiday sync (bg): {result}")
                finally:
                    _db2.close()
            except Exception as _e:
                print(f"⚠️  Holiday sync (bg) skipped: {_e}")

        import threading as _threading
        _t = _threading.Thread(target=_bg_holiday_sync, daemon=True, name="holiday-sync")
        _t.start()
        print("✅  Holiday sync scheduled in background thread")

        # ── 30-minute periodic cloud backup (second, independent lineage) ──
        # Uploads to a DIFFERENT cloud filename than the event-triggered backup,
        # so the two never overwrite each other. Runs only while the app is open
        # and only if cloud credentials are configured.
        def _bg_periodic_backup():
            import time
            while True:
                time.sleep(1800)   # 30 minutes
                try:
                    from app.db import SessionLocal as _SL3
                    from app.services.backup import periodic_backup as _pb
                    _db3 = _SL3()
                    try:
                        res = _pb(_db3)
                        print(f"⏱  30-min backup: {res.get('message')}")
                    finally:
                        _db3.close()
                except Exception as _e:
                    print(f"⚠️  30-min backup skipped: {_e}")

        _tb = _threading.Thread(target=_bg_periodic_backup, daemon=True, name="periodic-backup")
        _tb.start()
        print("✅  30-min periodic backup scheduled (separate cloud file)")
    finally:
        db.close()


def _patch_stay_timestamps(db):
    """
    One-time migration: copy room.checkin / room.checkout into
    active_stays.checkin_time / checkout_time for records seeded before Phase-2.
    Also recalculates hourly_rate if it is still 0.
    BUG-A FIX: back-fills original_checkout_time = checkout_time for existing
    stays that predate the column; future check-ins set it at creation time.
    """
    from app.models import ActiveStay, Room
    stays = db.query(ActiveStay).all()
    patched = 0
    for stay in stays:
        changed = False
        if not (stay.checkin_time and stay.checkout_time):
            room = db.query(Room).filter(Room.id == stay.room).first()
            if room:
                if not stay.checkin_time:
                    stay.checkin_time = room.checkin
                if not stay.checkout_time:
                    stay.checkout_time = room.checkout
                changed = True
        # Recalculate hourly_rate if missing
        if (not stay.hourly_rate or stay.hourly_rate == 0) and stay.base_rent:
            hours = 12 if stay.plan == "12hrs" else 24
            stay.hourly_rate = stay.base_rent / hours
            changed = True
        # BUG-A FIX: seed original_checkout_time from current checkout_time
        # (best available approximation for pre-existing rows)
        if stay.original_checkout_time is None and stay.checkout_time:
            stay.original_checkout_time = stay.checkout_time
            changed = True
        if changed:
            patched += 1
    if patched:
        db.commit()
        print(f"✅  Patched {patched} active_stay record(s) with room timestamps.")


# ── Include routers ────────────────────────────────────────────────────────
app.include_router(hub.router)
app.include_router(rooms.router)
app.include_router(bookings.router)
app.include_router(checkin.router)
app.include_router(stays.router)
app.include_router(reports.router)
app.include_router(backup.router)
app.include_router(lang.router)
app.include_router(admin.router)
app.include_router(auth.router)

# Register custom Jinja2 filters
import json as _json
from fastapi.templating import Jinja2Templates as _J2T
_templates_instances = []

def _add_filters(templates_obj):
    templates_obj.env.filters["from_json"]      = lambda s: (_json.loads(s) if s else [])
    templates_obj.env.filters["tojson"]         = lambda v: _json.dumps(v, ensure_ascii=False)
    templates_obj.env.filters["weekday_index"]  = lambda s: __import__("datetime").datetime.strptime(s[:10], "%Y-%m-%d").weekday()
    # Inject app_version as global so all templates can use {{ app_version }}
    templates_obj.env.globals["app_version"] = APP_VERSION

# Patch all routers' template instances after app setup
@app.on_event("startup")
async def _register_template_filters():
    import app.routers.hub as _hub
    import app.routers.rooms as _rooms
    import app.routers.auth as _auth
    import app.routers.admin as _admin
    import app.routers.reports as _reports
    import app.routers.backup as _bk
    import app.routers.bookings as _bkng
    import app.routers.checkin as _ci
    import app.routers.stays as _stays
    import app.routers.phase4 as _p4
    import app.routers.costs as _costs
    for mod in [_hub, _rooms, _auth, _admin, _reports, _bk, _bkng, _ci, _stays, _p4, _costs]:
        if hasattr(mod, "templates"):
            _add_filters(mod.templates)
app.include_router(phase4.router)
app.include_router(costs_router.router)

"""
services/backup.py — Unified backup orchestrator.

Handles:
  - Provider config CRUD (save / load credentials)
  - test_connection() per provider
  - sync_backup(): export DB → JSON → upload to cloud
  - restore_backup(): download from cloud → local safety backup → import to DB
  - auto_backup(): called after check-in / check-out / booking operations
  - Local backup folder: BINI_Blooms_Data/backup/
"""
import json
from datetime import datetime
from pathlib import Path
from sqlalchemy.orm import Session
from app.models import (
    BackupState, BackupLog,
    Room, Booking, ActiveStay, ReportSummary, StayLog,
)

# Absolute path: <project_root>/BINI_Blooms_Data/backup/
LOCAL_BACKUP_DIR = Path(__file__).parent.parent.parent / "BINI_Blooms_Data" / "backup"
EXPORT_FILENAME  = "bini_blooms_backup.json"

# ── Periodic (timer) backup — a SECOND, independent backup lineage ──────────
# Runs every 30 min while the app is open, uploaded under a DIFFERENT cloud
# filename so it never overwrites the event-triggered backup (double safety).
PERIODIC_FILENAME       = "bini_blooms_backup_30min.json"
LOCAL_PERIODIC_DIR      = Path(__file__).parent.parent.parent / "BINI_Blooms_Data" / "backup_30min"
PERIODIC_KEEP           = 48   # keep last 48 local copies (= 24h at 30-min cadence)


# ── helpers ───────────────────────────────────────────────────────────────

def _now_str() -> str:
    return datetime.now().strftime("%Y-%m-%d %H:%M")

def _stamp() -> str:
    return datetime.now().strftime("%m/%d %H:%M")

def _add_log(db: Session, message: str):
    db.add(BackupLog(message=message, created_at=_now_str()))

def _get_or_create_state(db: Session) -> BackupState:
    state = db.query(BackupState).first()
    if not state:
        state = BackupState(
            provider="未設定", folder="", last_sync=None,
            status="未設定", files=0,
        )
        db.add(state)
        db.flush()
    # Safely set Phase-4 fields if columns exist (may not after ALTER TABLE race)
    try:
        if getattr(state, "provider_type", None) is None:
            state.provider_type = "dropbox"
        if getattr(state, "auto_backup", None) is None:
            state.auto_backup = 1
        if getattr(state, "test_status", None) is None:
            state.test_status = "untested"
    except Exception:
        pass
    return state


# ── public getters ────────────────────────────────────────────────────────

def get_state(db: Session) -> BackupState | None:
    return db.query(BackupState).first()

get_backup_state = get_state


def get_logs(db: Session, limit: int = 20) -> list[BackupLog]:
    return db.query(BackupLog).order_by(BackupLog.id.desc()).limit(limit).all()

get_backup_logs = get_logs


def load_credentials(state: BackupState) -> dict:
    if not state:
        return {}
    raw = getattr(state, "credentials", None)
    if not raw:
        return {}
    try:
        return json.loads(raw)
    except (json.JSONDecodeError, TypeError):
        return {}


# ── provider factory ──────────────────────────────────────────────────────

def _get_provider(state: BackupState):
    from app.services.backup_providers.base import get_provider
    creds = load_credentials(state)
    return get_provider(state.provider_type or "dropbox", creds)


# ── config save ───────────────────────────────────────────────────────────

def save_config(
    db: Session,
    provider_type: str,
    credentials: dict,
    auto_backup: bool = True,
) -> BackupState:
    from app.services.backup_providers.base import PROVIDER_TYPES
    state = _get_or_create_state(db)
    state.provider_type = provider_type
    state.credentials   = json.dumps(credentials, ensure_ascii=False)
    state.auto_backup   = 1 if auto_backup else 0
    state.test_status   = "untested"
    state.test_message  = None
    label = PROVIDER_TYPES.get(provider_type, {}).get("label", provider_type)
    state.provider = label
    state.folder   = credentials.get("remote_path") or credentials.get("url") or ""
    db.commit()
    return state


# ── test connection ───────────────────────────────────────────────────────

def test_connection(db: Session) -> dict:
    state = db.query(BackupState).first()
    if not state or not state.credentials:
        return {"success": False, "message": "❌ 尚未設定備份服務，請先儲存設定。"}
    try:
        provider = _get_provider(state)
        result   = provider.test_connection()
        state.test_status  = "ok" if result.success else "fail"
        state.test_message = result.message
        if result.success:
            state.status = "已同步"
        else:
            state.status = "同步失敗"   # reflect failure immediately
        _add_log(db, f"{_stamp()} 連線測試：{result.message}")
        db.commit()
        return {"success": result.success, "message": result.message, "detail": result.detail}
    except Exception as ex:
        msg = f"❌ 連線測試發生錯誤：{ex}"
        _add_log(db, f"{_stamp()} {msg}")
        state = db.query(BackupState).first()
        if state:
            state.test_status  = "fail"
            state.test_message = msg
            state.status       = "同步失敗"
        db.commit()
        return {"success": False, "message": msg}


# ── export DB ─────────────────────────────────────────────────────────────

def _export_db(db: Session) -> bytes:
    def row_to_dict(obj):
        return {col.name: getattr(obj, col.name) for col in obj.__table__.columns}

    from app.models import (Payment, CashierSession, Property,
                             User, ActivityLog, MaintenanceSchedule)
    try:
        from app.models import CostEntry
        cost_data = [row_to_dict(c) for c in db.query(CostEntry).all()]
    except Exception:
        cost_data = []
    # Monthly rentals (月租套房) — must be backed up or they vanish on restore.
    try:
        from app.models import MonthlyRental
        monthly_data = [row_to_dict(m) for m in db.query(MonthlyRental).all()]
    except Exception:
        monthly_data = []

    payload = {
        "exported_at":           _now_str(),
        "schema_version":        "3.5",
        # Core operational
        "rooms":                 [row_to_dict(rm)  for rm  in db.query(Room).all()],
        "bookings":              [row_to_dict(bk)  for bk  in db.query(Booking).all()],
        "active_stays":          [row_to_dict(ast) for ast in db.query(ActiveStay).all()],
        "stay_logs":             [row_to_dict(sl)  for sl  in db.query(StayLog).all()],
        "report_summary":        [row_to_dict(rpt) for rpt in db.query(ReportSummary).all()],
        # Financial — includes deposits
        "payments":              [row_to_dict(pay) for pay in db.query(Payment).all()],
        "cashier_sessions":      [row_to_dict(cs)  for cs  in db.query(CashierSession).all()],
        "cost_entries":          cost_data,
        "monthly_rentals":       monthly_data,
        # Config & users
        "users":                 [row_to_dict(usr) for usr in db.query(User).all()],
        "properties":            [row_to_dict(prp) for prp in db.query(Property).all()],
        # Maintenance
        "maintenance_schedules": [row_to_dict(ms)  for ms  in db.query(MaintenanceSchedule).all()],
        # Audit
        "activity_logs":         [row_to_dict(al)  for al  in db.query(ActivityLog).all()],
    }
    return json.dumps(payload, ensure_ascii=False, indent=2).encode("utf-8")


def _save_local_backup(data: bytes) -> Path:
    LOCAL_BACKUP_DIR.mkdir(parents=True, exist_ok=True)
    ts   = datetime.now().strftime("%Y%m%d_%H%M%S")
    path = LOCAL_BACKUP_DIR / f"bini_backup_{ts}.json"
    path.write_bytes(data)
    files = sorted(LOCAL_BACKUP_DIR.glob("bini_backup_*.json"))
    for old in files[:-10]:
        old.unlink()
    return path


# ── sync backup ───────────────────────────────────────────────────────────

def sync_backup(db: Session) -> dict:
    state = _get_or_create_state(db)
    if not state.credentials:
        state.status = "同步失敗"
        _add_log(db, f"{_stamp()} ❌ 同步失敗：尚未設定雲端服務")
        db.commit()
        return {"success": False, "message": "❌ 尚未設定備份服務"}

    state.status = "同步中"
    db.commit()

    try:
        provider   = _get_provider(state)
        data       = _export_db(db)
        _save_local_backup(data)
        result     = provider.upload(EXPORT_FILENAME, data)

        if result.success:
            state.status    = "已同步"
            state.last_sync = _now_str()
            state.files    += 1
            _add_log(db, f"{_stamp()} ✅ 同步成功：{EXPORT_FILENAME}（{len(data)//1024+1} KB）→ {state.provider}")
        else:
            state.status = "同步失敗"
            _add_log(db, f"{_stamp()} ❌ 同步失敗：{result.message}")

        db.commit()
        return {"success": result.success, "message": result.message}

    except Exception as ex:
        state.status = "同步失敗"
        msg = f"❌ 同步錯誤：{ex}"
        _add_log(db, f"{_stamp()} {msg}")
        db.commit()
        return {"success": False, "message": msg}


# ── auto backup ───────────────────────────────────────────────────────────

def auto_backup(db: Session, trigger: str = "operation"):
    state = db.query(BackupState).first()
    if not state or not state.auto_backup or not state.credentials:
        return
    sync_backup(db)


# ── periodic (every-30-min) backup ──────────────────────────────────────────

def _save_local_periodic(data: bytes) -> Path:
    """Save a timestamped local copy in the SEPARATE 30-min folder."""
    LOCAL_PERIODIC_DIR.mkdir(parents=True, exist_ok=True)
    ts   = datetime.now().strftime("%Y%m%d_%H%M%S")
    path = LOCAL_PERIODIC_DIR / f"bini_backup_30min_{ts}.json"
    path.write_bytes(data)
    files = sorted(LOCAL_PERIODIC_DIR.glob("bini_backup_30min_*.json"))
    for old in files[:-PERIODIC_KEEP]:
        old.unlink()
    return path


def periodic_backup(db: Session) -> dict:
    """
    Timer-driven backup (called by the 30-min scheduler). Independent of the
    event-triggered sync: uploads to PERIODIC_FILENAME (a different cloud file)
    and keeps its own local copies, so the two backup lineages never overwrite
    each other. Runs whenever cloud credentials are configured.
    """
    state = db.query(BackupState).first()
    if not state or not state.credentials:
        return {"success": False, "message": "雲端未設定，略過定時備份"}
    try:
        provider = _get_provider(state)
        data     = _export_db(db)
        _save_local_periodic(data)
        result   = provider.upload(PERIODIC_FILENAME, data)
        if result.success:
            _add_log(db, f"{_stamp()} ⏱ 定時備份成功：{PERIODIC_FILENAME}（{len(data)//1024+1} KB）→ {state.provider}")
        else:
            _add_log(db, f"{_stamp()} ⏱ ❌ 定時備份失敗：{result.message}")
        db.commit()
        return {"success": result.success, "message": result.message}
    except Exception as ex:
        msg = f"❌ 定時備份錯誤：{ex}"
        try:
            _add_log(db, f"{_stamp()} ⏱ {msg}")
            db.commit()
        except Exception:
            pass
        return {"success": False, "message": msg}


# ── restore backup ────────────────────────────────────────────────────────

def restore_backup(db: Session) -> dict:
    state = _get_or_create_state(db)
    if not state.credentials:
        return {"success": False, "message": "❌ 尚未設定備份服務"}

    # Local safety backup first
    try:
        current_data = _export_db(db)
        local_path   = _save_local_backup(current_data)
        _add_log(db, f"{_stamp()} 🔒 還原前已備份本機資料至 {LOCAL_BACKUP_DIR}/")
    except Exception as ex:
        _add_log(db, f"{_stamp()} ⚠ 本機備份失敗（繼續還原）：{ex}")

    # Download from cloud
    try:
        provider       = _get_provider(state)
        data, result   = provider.download(EXPORT_FILENAME)
        if not result.success or not data:
            _add_log(db, f"{_stamp()} ❌ 下載失敗：{result.message}")
            db.commit()
            return {"success": False, "message": result.message}
    except Exception as ex:
        msg = f"❌ 還原下載錯誤：{ex}"
        _add_log(db, f"{_stamp()} {msg}")
        db.commit()
        return {"success": False, "message": msg}

    # Import
    try:
        payload = json.loads(data.decode("utf-8"))
        _import_data(db, payload)
        # Rollback any pending failed sub-transactions, then commit the good data
        try:
            db.commit()
        except Exception:
            db.rollback()
            db.commit()
        state.last_sync = _now_str()
        state.status    = "已同步"
        _add_log(db, f"{_stamp()} ✅ 還原完成：從 {state.provider} 還原所有資料")
        db.commit()
        return {"success": True, "message": "✅ 還原完成"}
    except Exception as ex:
        try:
            db.rollback()
        except Exception:
            pass
        msg = f"❌ 還原匯入錯誤：{ex}"
        try:
            _add_log(db, f"{_stamp()} {msg}")
            db.commit()
        except Exception:
            pass
        return {"success": False, "message": msg}


def _import_data(db: Session, payload: dict):
    from app.models import (Payment, CashierSession, Property,
                             User, ActivityLog, BackupLog,
                             MaintenanceSchedule)

    def _restore(model, rows, pop_id=False):
        """
        pop_id=True  → only for INTEGER AUTOINCREMENT PKs (let DB assign new id)
        pop_id=False → for STRING PKs (Room.id, Booking.id, Property.id, User.username)
                       — must keep original id or records break
        """
        try:
            db.query(model).delete()
        except Exception:
            db.rollback()
            db.query(model).delete()
        for row in rows:
            r = dict(row)  # don't mutate original
            if pop_id:
                r.pop("id", None)
            try:
                db.add(model(**r))
                db.flush()  # flush per-row to catch errors individually
            except Exception:
                db.rollback()  # rollback only this row, continue

    # String PK models — keep id (pop_id=False)
    _restore(Room,    payload.get("rooms", []))
    _restore(Booking, payload.get("bookings", []))

    # Integer autoincrement models — pop id (pop_id=True)
    _restore(ActiveStay,    payload.get("active_stays", []),    pop_id=True)
    _restore(StayLog,       payload.get("stay_logs", []),       pop_id=True)
    _restore(ReportSummary, payload.get("report_summary", []),  pop_id=True)

    # Financial — Integer PKs
    _restore(Payment,        payload.get("payments", []),         pop_id=True)
    _restore(CashierSession, payload.get("cashier_sessions", []), pop_id=True)

    # Cost entries — Integer PK
    try:
        from app.models import CostEntry
        _restore(CostEntry, payload.get("cost_entries", []), pop_id=True)
    except Exception:
        pass

    # Monthly rentals — Integer PK (only restore if the backup actually has the
    # key, so an OLD backup that predates this field never wipes current data)
    try:
        from app.models import MonthlyRental
        if "monthly_rentals" in payload:
            _restore(MonthlyRental, payload.get("monthly_rentals", []), pop_id=True)
    except Exception:
        pass

    # String PK models — keep id
    users_data = payload.get("users", [])
    if users_data:
        _restore(User, users_data)  # User.username is PK

    _restore(Property, payload.get("properties", []))  # Property.id is STRING PK — keep it!

    # Integer PK
    _restore(MaintenanceSchedule, payload.get("maintenance_schedules", []), pop_id=True)

    # Audit logs (optional — large, but preserve history)
    activity_data = payload.get("activity_logs", [])
    if activity_data:
        _restore(ActivityLog, activity_data, pop_id=True)

    db.flush()

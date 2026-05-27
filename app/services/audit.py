"""
services/audit.py — Activity Log (Audit Trail).

Phase-3 Task 2: records every critical write operation.

ACTION_TYPES:
  checkin          booking_create    booking_cancel
  checkout         checkout_free     extend_stay
  room_status      room_transfer     backup_sync
  backup_restore   report_export
"""
import json
from datetime import datetime
from sqlalchemy.orm import Session
from app.models import ActivityLog

DT_FMT = "%Y-%m-%d %H:%M:%S"


def _now() -> str:
    return datetime.now().strftime(DT_FMT)


def _json(v) -> str | None:
    if v is None:
        return None
    if isinstance(v, str):
        return v
    try:
        return json.dumps(v, ensure_ascii=False)
    except Exception:
        return str(v)


# ── Core writer ───────────────────────────────────────────────────────────

def log_action(
    db: Session,
    action_type:    str,
    target_id:      str | None  = None,
    target_type:    str | None  = None,
    original_value              = None,
    new_value                   = None,
    description:    str | None  = None,
    user_id:        str         = "admin",
) -> ActivityLog:
    """
    Write one audit record. Never raises — errors are silently swallowed
    so audit logging never breaks business logic.
    """
    try:
        entry = ActivityLog(
            timestamp      = _now(),
            user_id        = user_id,
            action_type    = action_type,
            target_id      = str(target_id) if target_id else None,
            target_type    = target_type,
            original_value = _json(original_value),
            new_value      = _json(new_value),
            description    = description,
        )
        db.add(entry)
        db.commit()
        return entry
    except Exception:
        try:
            db.rollback()
        except Exception:
            pass
        return None


# ── Domain-specific helpers ───────────────────────────────────────────────

def log_checkin(db, room_id: str, guest: str, plan: str, base_rent: float):
    log_action(db,
        action_type  = "checkin",
        target_id    = room_id,
        target_type  = "room",
        new_value    = {"guest": guest, "plan": plan, "base_rent": base_rent},
        description  = f"Check-in: {guest} → {room_id} ({plan}, NT${base_rent:.0f})",
    )


def log_checkout(db, room_id: str, guest: str, total: float, free_cancel: bool):
    action = "checkout_free" if free_cancel else "checkout"
    log_action(db,
        action_type = action,
        target_id   = room_id,
        target_type = "room",
        new_value   = {"guest": guest, "total": total, "free_cancel": free_cancel},
        description = f"{'Free Cancel' if free_cancel else 'Check-out'}: {guest} ← {room_id}  NT${total:.0f}",
    )


def log_extend(db, room_id: str, guest: str, hours: float, fee: float):
    log_action(db,
        action_type = "extend_stay",
        target_id   = room_id,
        target_type = "room",
        new_value   = {"hours": hours, "fee": fee},
        description = f"Extend: {room_id} ({guest}) +{hours}hr  NT${fee:.0f}",
    )


def log_booking_create(db, booking_id: str, room: str, guest: str):
    log_action(db,
        action_type = "booking_create",
        target_id   = booking_id,
        target_type = "booking",
        new_value   = {"room": room, "guest": guest},
        description = f"New booking: {booking_id}  {guest} → {room}",
    )


def log_booking_cancel(db, booking_id: str, guest: str):
    log_action(db,
        action_type    = "booking_cancel",
        target_id      = booking_id,
        target_type    = "booking",
        original_value = {"guest": guest},
        new_value      = {"status": "已取消"},
        description    = f"Cancel booking: {booking_id} ({guest})",
    )


def log_room_status(db, room_id: str, old_status: str, new_status: str,
                    note: str = "", user_id: str = "admin"):
    log_action(db,
        action_type    = "room_status",
        target_id      = room_id,
        target_type    = "room",
        original_value = {"status": old_status},
        new_value      = {"status": new_status, "note": note},
        description    = f"Room status: {room_id}  {old_status} → {new_status}",
        user_id        = user_id,
    )


def log_room_transfer(db, old_room: str, new_room: str, guest: str):
    log_action(db,
        action_type = "room_transfer",
        target_id   = old_room,
        target_type = "room",
        new_value   = {"new_room": new_room, "guest": guest},
        description = f"Transfer: {guest}  {old_room} → {new_room}",
    )


def log_backup_sync(db, provider: str, success: bool):
    log_action(db,
        action_type = "backup_sync",
        target_type = "backup",
        new_value   = {"provider": provider, "success": success},
        description = f"Backup sync ({'✅' if success else '❌'}): {provider}",
    )


def log_backup_restore(db, provider: str, success: bool):
    log_action(db,
        action_type = "backup_restore",
        target_type = "backup",
        new_value   = {"provider": provider, "success": success},
        description = f"Backup restore ({'✅' if success else '❌'}): {provider}",
    )


def log_report_export(db, date_from: str, date_to: str):
    log_action(db,
        action_type = "report_export",
        target_type = "report",
        new_value   = {"date_from": date_from, "date_to": date_to},
        description = f"CSV export: {date_from} ~ {date_to}",
    )


# ── Query ─────────────────────────────────────────────────────────────────

def get_logs(
    db: Session,
    action_type: str | None = None,
    target_id:   str | None = None,
    keyword:     str | None = None,
    limit:       int        = 100,
    offset:      int        = 0,
) -> tuple[list[ActivityLog], int]:
    """
    Returns (logs, total_count) for pagination.
    """
    q = db.query(ActivityLog)

    if action_type:
        q = q.filter(ActivityLog.action_type == action_type)
    if target_id:
        q = q.filter(ActivityLog.target_id == target_id)
    if keyword:
        like = f"%{keyword}%"
        from sqlalchemy import or_
        q = q.filter(or_(
            ActivityLog.description.like(like),
            ActivityLog.target_id.like(like),
            ActivityLog.action_type.like(like),
        ))

    total = q.count()
    logs  = q.order_by(ActivityLog.id.desc()).offset(offset).limit(limit).all()
    return logs, total


ALL_ACTION_TYPES = [
    "checkin", "checkout", "checkout_free", "extend_stay",
    "booking_create", "booking_cancel",
    "room_status", "room_transfer",
    "backup_sync", "backup_restore",
    "report_export",
]

ACTION_LABELS = {
    "checkin":        {"zh": "入住登記", "en": "Check-in"},
    "checkout":       {"zh": "退房辦理", "en": "Check-out"},
    "checkout_free":  {"zh": "免費取消", "en": "Free Cancel"},
    "extend_stay":    {"zh": "延住處理", "en": "Extend Stay"},
    "booking_create": {"zh": "新增預約", "en": "New Booking"},
    "booking_cancel": {"zh": "取消預約", "en": "Cancel Booking"},
    "room_status":    {"zh": "房態更新", "en": "Room Status"},
    "room_transfer":  {"zh": "換房",     "en": "Transfer Room"},
    "backup_sync":    {"zh": "備份同步", "en": "Backup Sync"},
    "backup_restore": {"zh": "備份還原", "en": "Backup Restore"},
    "report_export":  {"zh": "報表匯出", "en": "Report Export"},
}

ACTION_ICON = {
    "checkin":        "🔑",
    "checkout":       "🚪",
    "checkout_free":  "🆓",
    "extend_stay":    "⏱",
    "booking_create": "📋",
    "booking_cancel": "❌",
    "room_status":    "🔧",
    "room_transfer":  "🔄",
    "backup_sync":    "☁",
    "backup_restore": "↓",
    "report_export":  "📊",
}

"""
services/maintenance.py — Maintenance schedule CRUD + conflict check.
"""
from datetime import datetime
from sqlalchemy.orm import Session
from app.models import MaintenanceSchedule, Booking

DT_FMT = "%Y-%m-%d %H:%M"


def _now() -> str:
    return datetime.now().strftime(DT_FMT)


def create_schedule(
    db: Session,
    room_id:    str,
    title:      str,
    start_time: str,
    end_time:   str,
    note:       str = "",
    created_by: str = "admin",
) -> tuple[MaintenanceSchedule | None, str | None]:
    """Create a maintenance schedule. Returns (schedule, error_key)."""
    # Validate times
    try:
        st = datetime.strptime(start_time, DT_FMT)
        et = datetime.strptime(end_time,   DT_FMT)
    except ValueError:
        return None, "error.invalid_date_format"
    if et <= st:
        return None, "error.checkout_before_checkin"

    # Check booking conflict
    conflict = _booking_conflict(db, room_id, start_time, end_time)
    if conflict:
        return None, "error.booking_conflict"

    ms = MaintenanceSchedule(
        room_id    = room_id,
        title      = title,
        start_time = start_time,
        end_time   = end_time,
        note       = note or None,
        status     = "scheduled",
        created_by = created_by,
        created_at = _now(),
    )
    db.add(ms)
    db.commit()
    db.refresh(ms)
    return ms, None


def update_schedule(
    db: Session,
    schedule_id: int,
    **kwargs,
) -> MaintenanceSchedule | None:
    ms = db.query(MaintenanceSchedule).filter(MaintenanceSchedule.id == schedule_id).first()
    if not ms:
        return None
    for k, v in kwargs.items():
        if hasattr(ms, k):
            setattr(ms, k, v)
    db.commit()
    db.refresh(ms)
    return ms


def delete_schedule(db: Session, schedule_id: int) -> bool:
    ms = db.query(MaintenanceSchedule).filter(MaintenanceSchedule.id == schedule_id).first()
    if not ms:
        return False
    db.delete(ms)
    db.commit()
    return True


def get_schedules(
    db: Session,
    room_id: str | None = None,
    include_done: bool  = False,
) -> list[MaintenanceSchedule]:
    q = db.query(MaintenanceSchedule)
    if room_id:
        q = q.filter(MaintenanceSchedule.room_id == room_id)
    if not include_done:
        q = q.filter(MaintenanceSchedule.status != "done")
    return q.order_by(MaintenanceSchedule.start_time).all()


def _booking_conflict(
    db: Session,
    room_id:    str,
    start_time: str,
    end_time:   str,
    exclude_id: int | None = None,
) -> Booking | None:
    """Check if any active booking overlaps the maintenance window."""
    from app.services.bookings import CANCELLED_STATUSES
    bookings = (
        db.query(Booking)
        .filter(
            Booking.room == room_id,
            Booking.status.notin_(CANCELLED_STATUSES),
            Booking.checkin  < end_time,
            Booking.checkout > start_time,
        )
        .first()
    )
    return bookings


def check_maintenance_conflict_for_booking(
    db: Session,
    room_id:  str,
    checkin:  str,
    checkout: str,
) -> MaintenanceSchedule | None:
    """Used by booking creation to check maintenance schedule conflicts."""
    return db.query(MaintenanceSchedule).filter(
        MaintenanceSchedule.room_id == room_id,
        MaintenanceSchedule.status  != "done",
        MaintenanceSchedule.start_time < checkout,
        MaintenanceSchedule.end_time   > checkin,
    ).first()

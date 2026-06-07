"""
services/bookings.py — Booking CRUD, conflict detection, date validation.

Phase-2 additions:
  - validate_booking_dates(): checkin < checkout, checkin not in past
  - check_conflict(): unchanged logic, used by both new-booking and checkin
"""
import uuid
from datetime import datetime
from sqlalchemy.orm import Session
from app.models import Booking, Room

CANCELLED_STATUSES = {"已取消", "No-show", "已入住"}
DT_FMT = "%Y-%m-%d %H:%M"


# ── validation ────────────────────────────────────────────────────────────

def validate_booking_dates(
    checkin: str,
    checkout: str,
    allow_past: bool = False,
) -> str | None:
    """
    Returns an i18n error key if dates are invalid, else None.
    """
    try:
        ci = datetime.strptime(checkin,  DT_FMT)
        co = datetime.strptime(checkout, DT_FMT)
    except ValueError:
        return "error.invalid_date_format"

    if not allow_past and ci < datetime.now() - __import__("datetime").timedelta(minutes=5):
        return "error.checkin_in_past"

    if co <= ci or (co - ci).total_seconds() < 60:
        return "error.checkout_before_checkin"

    return None


# ── conflict ──────────────────────────────────────────────────────────────

def check_conflict(
    db: Session,
    room_id: str,
    checkin: str,
    checkout: str,
    exclude_id: str | None = None,
) -> bool:
    """True if any active booking overlaps the requested window."""
    return get_conflict_detail(db, room_id, checkin, checkout, exclude_id) is not None


def get_conflict_detail(
    db: Session,
    room_id: str,
    checkin: str,
    checkout: str,
    exclude_id: str | None = None,
) -> dict | None:
    """
    Returns the first conflicting booking as a dict, or None if no conflict.
    Dict keys: id, guest, checkin, checkout, status
    """
    bookings = (
        db.query(Booking)
        .filter(
            Booking.room == room_id,
            Booking.status.notin_(CANCELLED_STATUSES),
        )
        .all()
    )
    for b in bookings:
        if exclude_id and b.id == exclude_id:
            continue
        if b.checkin < checkout and b.checkout > checkin:
            return {
                "id":       b.id,
                "guest":    b.guest,
                "checkin":  b.checkin,
                "checkout": b.checkout,
                "status":   b.status,
            }
    return None


# ── CRUD ──────────────────────────────────────────────────────────────────

def get_all_bookings(db: Session) -> list[Booking]:
    return db.query(Booking).order_by(Booking.checkin).all()


def get_booking(db: Session, booking_id: str) -> Booking | None:
    return db.query(Booking).filter(Booking.id == booking_id).first()


def get_active_bookings(db: Session) -> list[Booking]:
    return (
        db.query(Booking)
        .filter(Booking.status.notin_(CANCELLED_STATUSES))
        .order_by(Booking.checkin)
        .all()
    )


def create_booking(db: Session, data: dict) -> Booking:
    now = datetime.now()
    booking_id = f"RSV-{now.strftime('%y%m%d')}-{uuid.uuid4().hex[:4].upper()}"

    booking = Booking(
        id        = booking_id,
        room      = data["room"],
        guest     = data["guest"],
        phone     = data.get("phone", ""),
        checkin   = data["checkin"],
        checkout  = data["checkout"],
        plan      = data.get("plan", "24hrs"),
        amount    = float(data.get("amount", 0)),
        discount  = float(data.get("discount", 0)),
        rate_type = data.get("rate_type", "非假日"),
        status    = data.get("status", "已預約"),
    )
    db.add(booking)

    room = db.query(Room).filter(Room.id == data["room"]).first()
    if room:
        if not room.next_booking or data["checkin"] < room.next_booking:
            room.next_booking = data["checkin"]

    db.commit()
    db.refresh(booking)
    return booking


def cancel_booking(db: Session, booking_id: str) -> Booking | None:
    b = get_booking(db, booking_id)
    if not b:
        return None
    b.status = "已取消"
    db.commit()

    # Recalculate next_booking for this room
    from app.models import Room
    room = db.query(Room).filter(Room.id == b.room).first()
    if room:
        from datetime import datetime
        now_str = datetime.now().strftime("%Y-%m-%d %H:%M")
        next_bk = (
            db.query(Booking)
            .filter(
                Booking.room   == b.room,
                Booking.status.notin_(CANCELLED_STATUSES),
                Booking.checkin >= now_str,
            )
            .order_by(Booking.checkin)
            .first()
        )
        room.next_booking = next_bk.checkin if next_bk else None
        db.commit()
    return b


def status_summary(db: Session) -> dict[str, int]:
    result: dict[str, int] = {}
    for b in db.query(Booking).all():
        result[b.status] = result.get(b.status, 0) + 1
    return result


# ── Multi-slot booking ────────────────────────────────────────────────────────

def create_multi_bookings(
    db: Session,
    slots: list[dict],  # [{room, checkin, checkout, plan, amount, rate_type}]
    guest: str,
    phone: str,
    property_id: str | None = None,
) -> tuple[list[Booking], list[dict]]:
    """
    Create multiple bookings at once.
    Returns (created_bookings, conflicts).
    Conflicts are not created; all non-conflicting slots are saved.
    """
    created   = []
    conflicts = []

    for slot in slots:
        room     = slot["room"]
        ci       = slot["checkin"]
        co       = slot["checkout"]

        # Monthly suite block — cannot book a 月租套房 room
        _rm = db.query(Room).filter(Room.id == room).first()
        if _rm and _rm.status == "月租套房":
            conflicts.append({"slot": slot, "conflict": {
                "id": "MONTHLY", "guest": "[月租套房]",
                "checkin": _rm.checkin or "", "checkout": _rm.checkout or "",
                "status": "月租套房",
            }})
            continue

        conflict = get_conflict_detail(db, room, ci, co)
        if conflict:
            conflicts.append({"slot": slot, "conflict": conflict})
            continue

        # Also check maintenance schedule overlap
        from app.models import MaintenanceSchedule
        maint_conflict = db.query(MaintenanceSchedule).filter(
            MaintenanceSchedule.room_id == room,
            MaintenanceSchedule.status  != "done",
            MaintenanceSchedule.start_time < co,
            MaintenanceSchedule.end_time   > ci,
        ).first()
        if maint_conflict:
            conflicts.append({
                "slot": slot,
                "conflict": {
                    "id":       f"MAINT-{maint_conflict.id}",
                    "guest":    f"[{maint_conflict.title}]",
                    "checkin":  maint_conflict.start_time,
                    "checkout": maint_conflict.end_time,
                    "status":   "維修預約",
                }
            })
            continue

        bk = create_booking(db, {
            "room":        room,
            "guest":       guest,
            "phone":       phone,
            "checkin":     ci,
            "checkout":    co,
            "plan":        slot.get("plan",      "24hrs"),
            "amount":      slot.get("amount",    0),
            "rate_type":   slot.get("rate_type", "非假日"),
            "property_id": property_id or "",
        })
        created.append(bk)

    return created, conflicts


# ── Edit booking ──────────────────────────────────────────────────────────────

def edit_booking(
    db: Session,
    booking_id: str,
    room: str,
    checkin: str,
    checkout: str,
    guest: str,
    phone: str,
    plan: str,
    amount: float,
    rate_type: str,
) -> tuple[Booking | None, str | None]:
    """
    Update an existing booking.
    Returns (updated_booking, error_key) — error_key is None on success.
    Checks for date validity and conflicts (excluding the booking being edited).
    Also checks maintenance schedule conflicts.
    """
    bk = get_booking(db, booking_id)
    if not bk:
        return None, "error.not_found"

    date_err = validate_booking_dates(checkin, checkout, allow_past=True)
    if date_err:
        return None, date_err

    conflict = get_conflict_detail(db, room, checkin, checkout, exclude_id=booking_id)
    if conflict:
        return None, "error.conflict"

    # Check maintenance schedule
    from app.models import MaintenanceSchedule
    maint_conflict = db.query(MaintenanceSchedule).filter(
        MaintenanceSchedule.room_id == room,
        MaintenanceSchedule.status  != "done",
        MaintenanceSchedule.start_time < checkout,
        MaintenanceSchedule.end_time   > checkin,
    ).first()
    if maint_conflict:
        return None, "error.maintenance_conflict"

    bk.room      = room
    bk.checkin   = checkin
    bk.checkout  = checkout
    bk.guest     = guest
    bk.phone     = phone
    bk.plan      = plan
    bk.amount    = amount
    bk.rate_type = rate_type
    db.commit()
    db.refresh(bk)
    return bk, None

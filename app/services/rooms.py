"""
services/rooms.py — Room queries + State Machine.

State Machine rules (Phase 2):
  check-out  → 待清潔  (automatic, via checkout_guest)
  待清潔      → 可入住  (manual only, by admin via room-management)
  維修中      → 可入住  (manual only)
  Check-in is BLOCKED when status is 待清潔 or 維修中.
"""
from sqlalchemy.orm import Session
from app.models import Room

# ── Canonical status values (Chinese, matches seed data) ─────────────
STATUS_AVAILABLE        = "可入住"
STATUS_OCCUPIED         = "使用中"
STATUS_SOON             = "即將退房"
STATUS_CLEANING         = "待清潔"          # Cleaning Pending (backward compat alias)
STATUS_CLEANING_PENDING = "待清潔"          # explicit name
STATUS_CLEANING_INPROG  = "清潔中"          # Cleaning In Progress
STATUS_MAINTENANCE      = "維修中"
STATUS_MONTHLY          = "月租套房"          # Monthly suite (long-term tenant)

# NOTE: 月租套房 is intentionally NOT in ALL_STATUSES — it must be set via the
# dedicated monthly-rental flow (requires tenant info + deposit), never the
# plain status dropdown in room-management.
ALL_STATUSES = [
    STATUS_AVAILABLE,
    STATUS_OCCUPIED,
    STATUS_SOON,
    STATUS_CLEANING_PENDING,
    STATUS_CLEANING_INPROG,
    STATUS_MAINTENANCE,
]

# i18n key map for status labels (used in API responses for JS rendering)
STATUS_LABEL_I18N = {
    "可入住":  "status.available",
    "使用中":  "status.occupied",
    "即將退房": "status.checkout_soon",
    "待清潔":  "status.cleaning",
    "清潔中":  "status.cleaning_inprog",
    "維修中":  "status.maintenance",
    "月租套房": "status.monthly",
}

# Statuses that BLOCK new check-in (and transient booking).
# 月租套房 included: a monthly-rented room cannot be checked in or booked.
BLOCKED_FOR_CHECKIN = {
    STATUS_CLEANING_PENDING, STATUS_CLEANING_INPROG, STATUS_MAINTENANCE, STATUS_MONTHLY,
}

STATUS_BADGE: dict[str, str] = {
    STATUS_AVAILABLE:   "success",
    STATUS_OCCUPIED:    "primary",
    STATUS_SOON:        "warning",
    STATUS_CLEANING_PENDING:  "secondary",
    STATUS_CLEANING_INPROG:   "info",
    STATUS_MAINTENANCE: "danger",
    STATUS_MONTHLY:     "dark",
}

# i18n key per status (for templates)
STATUS_I18N: dict[str, str] = {
    STATUS_AVAILABLE:   "status.available",
    STATUS_OCCUPIED:    "status.occupied",
    STATUS_SOON:        "status.checkout_soon",
    STATUS_CLEANING_PENDING:  "status.cleaning",
    STATUS_CLEANING_INPROG:   "status.cleaning_inprog",
    STATUS_MAINTENANCE: "status.maintenance",
    STATUS_MONTHLY:     "status.monthly",
}


def get_all_rooms(db: Session) -> list[Room]:
    return db.query(Room).order_by(Room.id).all()


def get_room(db: Session, room_id: str) -> Room | None:
    return db.query(Room).filter(Room.id == room_id).first()


def get_available_rooms(db: Session) -> list[Room]:
    """Rooms eligible for immediate check-in."""
    return (
        db.query(Room)
        .filter(Room.status == STATUS_AVAILABLE)
        .order_by(Room.id)
        .all()
    )


def is_checkin_allowed(room: Room) -> tuple[bool, str]:
    """
    State Machine guard: returns (allowed, reason_i18n_key).
    Reason key is used by templates for i18n error display.
    """
    # BUG 3 FIX: BLOCKED_FOR_CHECKIN includes 清潔中 (STATUS_CLEANING_INPROG)
    # which was previously missing from this check.
    if room.status in (STATUS_CLEANING, STATUS_CLEANING_INPROG):
        return False, "error.room_cleaning"
    if room.status == STATUS_MAINTENANCE:
        return False, "error.room_maintenance"
    if room.status == STATUS_MONTHLY:
        return False, "error.room_monthly"
    if room.status == STATUS_OCCUPIED:
        return False, "error.room_occupied"
    return True, ""


def transition_to_cleaning(db: Session, room_id: str) -> Room | None:
    """Automatic transition after checkout."""
    room = get_room(db, room_id)
    if room:
        room.status        = STATUS_CLEANING
        room.current_guest = None
        room.checkin       = None
        room.checkout      = None
        db.commit()
        db.refresh(room)
    return room


def update_room_status(
    db: Session,
    room_id: str,
    status: str,
    note: str | None = None,
    next_booking: str | None = None,
    maintenance_note: str | None = None,
    maintenance_due:  str | None = None,
) -> tuple[Room | None, str | None]:
    """
    Manual admin update (room-management page).
    Returns (room, error_i18n_key | None).
    Enforces: maintenance_note + maintenance_due required when status=維修中.
    """
    room = get_room(db, room_id)
    if not room:
        return None, "error.room_not_found"

    # State Machine validation: 維修中 requires note + due date
    if status == STATUS_MAINTENANCE:
        if not maintenance_note or not maintenance_note.strip():
            return None, "error.maintenance_note_required"
        if not maintenance_due or not maintenance_due.strip():
            return None, "error.maintenance_due_required"

    room.status = status
    if note is not None:
        room.note = note
    if next_booking is not None:
        room.next_booking = next_booking or None

    # Set/clear maintenance fields
    if status == STATUS_MAINTENANCE:
        room.maintenance_note = maintenance_note.strip()
        room.maintenance_due  = maintenance_due.strip()
    else:
        # Clear maintenance fields when leaving maintenance status
        room.maintenance_note = None
        room.maintenance_due  = None

    db.commit()
    db.refresh(room)
    return room, None


def badge_color(status: str) -> str:
    return STATUS_BADGE.get(status, "secondary")


def status_i18n_key(status: str) -> str:
    return STATUS_I18N.get(status, "status.available")


def room_summary(db: Session) -> dict:
    rooms = db.query(Room).all()
    return {
        "total":     len(rooms),
        "occupied":  sum(1 for r in rooms if r.status in (STATUS_OCCUPIED, STATUS_SOON)),
        "available": sum(1 for r in rooms if r.status == STATUS_AVAILABLE),
        "cleaning":  sum(1 for r in rooms if r.status == STATUS_CLEANING),
        "repair":    sum(1 for r in rooms if r.status == STATUS_MAINTENANCE),
        "monthly":   sum(1 for r in rooms if r.status == STATUS_MONTHLY),
    }

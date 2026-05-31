"""
services/monthly.py — 月租方案 (Monthly Suite Rental)

A monthly rental occupies a room for one month. The room status becomes
月租套房 and the room cannot be checked in, booked, extended, or transferred
while the rental is active.

Revenue rules:
  - rent     → counted as report revenue (recorded as a normal Payment).
  - deposit  → held, refundable on checkout (recorded as a deposit Payment).
  - refund   → recorded as a refund Payment on checkout (cash out, not revenue).
"""
from datetime import datetime, date
from sqlalchemy.orm import Session

from app.models import Room, MonthlyRental
from app.services.rooms import (
    STATUS_AVAILABLE, STATUS_MONTHLY, STATUS_CLEANING, get_room,
)

DT_FMT   = "%Y-%m-%d %H:%M"
DATE_FMT = "%Y-%m-%d"


def _now() -> str:
    return datetime.now().strftime(DT_FMT)


def add_one_month(d: date) -> date:
    """Return the date one calendar month after d (clamps day to month end)."""
    y, m = d.year, d.month
    if m == 12:
        ny, nm = y + 1, 1
    else:
        ny, nm = y, m + 1
    # Clamp day to the last valid day of the target month
    day = d.day
    import calendar
    last_day = calendar.monthrange(ny, nm)[1]
    if day > last_day:
        day = last_day
    return date(ny, nm, day)


def compute_end_date(start_date_str: str) -> str:
    """Given 'YYYY-MM-DD', return the date one month later as 'YYYY-MM-DD'."""
    try:
        d = datetime.strptime(start_date_str[:10], DATE_FMT).date()
    except Exception:
        d = date.today()
    return add_one_month(d).strftime(DATE_FMT)


# ── Queries ────────────────────────────────────────────────────────────────

def get_active_monthly_by_room(db: Session, room_id: str) -> MonthlyRental | None:
    return (
        db.query(MonthlyRental)
        .filter(MonthlyRental.room_id == room_id, MonthlyRental.status == "active")
        .order_by(MonthlyRental.id.desc())
        .first()
    )


def get_all_monthly(db: Session, status: str | None = None) -> list[MonthlyRental]:
    q = db.query(MonthlyRental)
    if status:
        q = q.filter(MonthlyRental.status == status)
    return q.order_by(MonthlyRental.id.desc()).all()


# ── Create ─────────────────────────────────────────────────────────────────

def create_monthly_rental(
    db: Session,
    room_id: str,
    tenant_name: str,
    tenant_phone: str,
    start_date: str,
    deposit: float,
    rent: float,
    payment_type: str = "cash",
    note: str = "",
    created_by: str = "admin",
) -> tuple[MonthlyRental | None, str | None]:
    """
    Create a monthly rental. Returns (rental, error_i18n_key|None).
    Validations:
      - room must exist
      - room must be 可入住 (available) — cannot convert an occupied/cleaning/
        maintenance/already-monthly room.
      - tenant_name required; start_date required.
    """
    room = get_room(db, room_id)
    if not room:
        return None, "error.room_not_found"
    if room.status != STATUS_AVAILABLE:
        return None, "error.monthly_room_unavailable"
    if not tenant_name or not tenant_name.strip():
        return None, "error.monthly_tenant_required"

    sd = (start_date or "")[:10]
    try:
        datetime.strptime(sd, DATE_FMT)
    except Exception:
        return None, "error.monthly_invalid_date"

    end_date = compute_end_date(sd)

    rental = MonthlyRental(
        room_id      = room_id,
        tenant_name  = tenant_name.strip(),
        tenant_phone = (tenant_phone or "").strip() or None,
        start_date   = sd,
        end_date     = end_date,
        deposit      = abs(float(deposit or 0)),
        rent         = abs(float(rent or 0)),
        status       = "active",
        payment_type = payment_type or "cash",
        property_id  = getattr(room, "property_id", None),
        note         = (note or "").strip() or None,
        created_at   = _now(),
        created_by   = created_by,
    )
    db.add(rental)

    # Set room display fields so /rooms and /room-management show the tenant
    room.status        = STATUS_MONTHLY
    room.current_guest = tenant_name.strip()
    room.checkin       = sd
    room.checkout      = end_date
    room.next_booking  = None

    db.commit()
    db.refresh(rental)

    # Record payments (best-effort; never block the rental on payment logging)
    try:
        from app.services.payments import create_payment
        if rental.deposit > 0:
            create_payment(db, None, room_id, rental.tenant_name,
                           rental.payment_type, rental.deposit,
                           is_deposit=True, note="月租押金",
                           created_by=created_by)
        if rental.rent > 0:
            create_payment(db, None, room_id, rental.tenant_name,
                           rental.payment_type, rental.rent,
                           is_deposit=False, note="月租租金",
                           created_by=created_by)
    except Exception:
        pass

    return rental, None


# ── Checkout / end rental ────────────────────────────────────────────────────

def end_monthly_rental(
    db: Session,
    room_id: str,
    deposit_refund: float = 0,
    refund_type: str = "cash",
    note: str = "",
    created_by: str = "admin",
) -> tuple[MonthlyRental | None, str | None]:
    """
    End an active monthly rental (退租/退房).
    Records a refund Payment if deposit_refund > 0, marks the rental ended,
    and transitions the room to 待清潔.
    Returns (rental, error_i18n_key|None).
    """
    rental = get_active_monthly_by_room(db, room_id)
    if not rental:
        return None, "error.monthly_not_found"

    refund = abs(float(deposit_refund or 0))
    # Cannot refund more than the deposit held
    if refund > rental.deposit:
        refund = rental.deposit

    rental.status           = "ended"
    rental.deposit_refunded = refund
    rental.ended_at         = _now()
    if note:
        rental.note = ((rental.note + " | ") if rental.note else "") + note.strip()

    # Room → cleaning (consistent with transient checkout)
    room = get_room(db, room_id)
    if room:
        room.status        = STATUS_CLEANING
        room.current_guest = None
        room.checkin       = None
        room.checkout      = None

    db.commit()
    db.refresh(rental)

    # Record the refund as a refund Payment (cash out)
    if refund > 0:
        try:
            from app.services.payments import create_payment
            create_payment(db, None, room_id, rental.tenant_name,
                           refund_type or "cash", refund,
                           is_refund=True, note="月租押金退還",
                           created_by=created_by)
        except Exception:
            pass

    return rental, None


# ── Reports integration ──────────────────────────────────────────────────────

def monthly_rent_in_range(db: Session, date_from: str, date_to: str) -> float:
    """
    Sum of rent for monthly rentals whose start_date falls within [date_from, date_to]
    (inclusive). date_from/date_to are 'YYYY-MM-DD'. Used by reports/P&L.
    """
    df = date_from[:10]
    dt = date_to[:10]
    total = 0.0
    for r in db.query(MonthlyRental).all():
        sd = (r.start_date or "")[:10]
        if sd and df <= sd <= dt:
            total += float(r.rent or 0)
    return total


def monthly_rent_for_month(db: Session, year_month: str) -> float:
    """Sum of rent for monthly rentals starting in the given 'YYYY-MM'."""
    total = 0.0
    for r in db.query(MonthlyRental).all():
        if (r.start_date or "")[:7] == year_month:
            total += float(r.rent or 0)
    return total

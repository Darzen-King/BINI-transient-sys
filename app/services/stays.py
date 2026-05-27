"""
services/stays.py — CheckinGuest, ExtendStay, CheckoutGuest, TransferRoom.

Free-cancel rule:
  If checkout happens within 15 min of checkin_time → total_due = 0,
  not counted in report stats, logged as free_cancel=1 in StayLog.

Transfer-room rule:
  - Must happen within 15 min OR after (no time limit on transfer itself).
  - New room inherits ALL stay info from old room.
  - Old room logged as transferred=1 (not counted in stats).
  - New room will be counted when it eventually checks out.
  - Conflict check is enforced before transfer.
"""
from datetime import datetime, timedelta
from sqlalchemy.orm import Session
from app.models import ActiveStay, Room, Booking, ReportSummary, StayLog
from app.services.fee_engine import calc_extension_fee
from app.services.rooms import (
    STATUS_OCCUPIED, STATUS_CLEANING,
    is_checkin_allowed, transition_to_cleaning,
)

DT_FMT           = "%Y-%m-%d %H:%M"
FREE_CANCEL_MINS    = 15   # within 15 min of checkin  → free cancel, zero charge
CHECKOUT_BUFFER_MINS = 15  # within 15 min of checkout → no extra fee added
                            # but extension fee is calculated FROM planned checkout time


# ── helpers ──────────────────────────────────────────────────────────────

def _parse(dt_str: str) -> datetime:
    return datetime.strptime(dt_str[:16], DT_FMT)

def _fmt(dt: datetime) -> str:
    return dt.strftime(DT_FMT)

def _now() -> datetime:
    return datetime.now()

def _plan_hours(plan: str) -> int:
    return 12 if plan == "12hrs" else 24

def _calc_hourly_rate(base_rent: float, plan: str) -> float:
    return base_rent / _plan_hours(plan)

def _calc_extension_fee_simple(
    original_checkout: str,
    new_checkout: str,
    hourly_rate: float,   # kept for API compat but not used
) -> float:
    """
    Calculate overdue extension fee using the CORRECT block-ceiling logic
    from fee_engine.calc_extension_fee (same as Extend Stay page).
    Block 1: 0-12h → capped at 12hr rate (weekday NT$800 / holiday NT$1000)
    Block 2: 12-24h → capped at 24hr_rate - 12hr_rate
    ...and so on.
    Hourly rate within each block: NT$200/hr.
    """
    orig_dt = _parse(original_checkout)
    new_dt  = _parse(new_checkout)
    delta_seconds = (new_dt - orig_dt).total_seconds()
    if delta_seconds <= 0:
        return 0.0
    # Convert to hours (ceil to nearest half-hour for fairness)
    import math
    delta_half_hrs = math.ceil(delta_seconds / 1800)
    extension_hours = delta_half_hrs * 0.5
    fee, _ = calc_extension_fee(extension_hours, orig_dt)
    return fee

def _is_within_free_cancel(checkin_time_str: str | None) -> bool:
    """True if current time is within FREE_CANCEL_MINS of checkin."""
    if not checkin_time_str:
        return False
    ci = _parse(checkin_time_str)
    return (_now() - ci).total_seconds() <= FREE_CANCEL_MINS * 60

def _minutes_since_checkin(checkin_time_str: str | None) -> float:
    if not checkin_time_str:
        return 999.0
    ci = _parse(checkin_time_str)
    return (_now() - ci).total_seconds() / 60

def _log_stay(
    db: Session,
    stay: ActiveStay,
    actual_co: datetime,
    total_charged: float,
    free_cancel: bool = False,
    transferred: bool = False,
    new_room: str | None = None,
):
    db.add(StayLog(
        room          = stay.room,
        guest         = stay.guest,
        plan          = stay.plan,
        checkin_time  = stay.checkin_time,
        checkout_time = _fmt(actual_co),
        base_rent     = stay.base_rent,
        extension_fee = stay.extension_fee,
        extra_fee     = stay.extra_fee,
        total_charged = total_charged,
        free_cancel   = 1 if free_cancel else 0,
        transferred   = 1 if transferred else 0,
        new_room      = new_room,
        created_at    = _fmt(_now()),
    ))


# ── public API ────────────────────────────────────────────────────────────

def get_all_active_stays(db: Session) -> list[ActiveStay]:
    return db.query(ActiveStay).order_by(ActiveStay.room).all()

def get_stay_by_room(db: Session, room_id: str) -> ActiveStay | None:
    return db.query(ActiveStay).filter(ActiveStay.room == room_id).first()


def checkin_guest(
    db: Session,
    room_id: str,
    guest: str,
    plan: str,
    base_rent: float,
    booking_id: str | None = None,
    checkin_time: str | None = None,
    checkout_time: str | None = None,
) -> tuple[ActiveStay | None, str | None]:
    room = db.query(Room).filter(Room.id == room_id).first()
    if not room:
        return None, "error.room_not_found"

    allowed, reason = is_checkin_allowed(room)
    if not allowed:
        return None, reason

    ci = checkin_time or _fmt(_now())
    if not checkout_time:
        ci_dt = _parse(ci)
        checkout_time = _fmt(ci_dt + timedelta(hours=_plan_hours(plan)))

    hourly_rate = _calc_hourly_rate(base_rent, plan)

    existing = db.query(ActiveStay).filter(ActiveStay.room == room_id).first()
    if existing:
        # 問題 6 FIX: log the overwrite so it can be investigated later
        try:
            from app.services.audit import log_action as _log
            _log(db, "checkin_override", target_id=room_id, target_type="room",
                 original_value={"guest": existing.guest, "checkin_time": existing.checkin_time},
                 description=f"Active stay overwritten on check-in: {existing.guest} in {room_id}")
        except Exception:
            pass
        db.delete(existing)
        db.flush()

    stay = ActiveStay(
        room          = room_id,
        guest         = guest,
        plan          = plan,
        base_rent     = base_rent,
        extension_fee = 0.0,
        extra_fee     = 0.0,
        total_due     = base_rent,
        checkin_time  = ci,
        checkout_time = checkout_time,
        hourly_rate   = hourly_rate,
    )
    db.add(stay)

    room.status        = STATUS_OCCUPIED
    room.current_guest = guest
    room.checkin       = ci
    room.checkout      = checkout_time

    if booking_id:
        booking = db.query(Booking).filter(Booking.id == booking_id).first()
        if booking:
            booking.status = "已入住"  # hide from active bookings list after check-in

    db.commit()
    return stay, None


def extend_stay(
    db: Session,
    room_id: str,
    extension_hours: float,
    rate_per_hour: float | None = None,
) -> tuple[ActiveStay | None, str | None]:
    stay = get_stay_by_room(db, room_id)
    room = db.query(Room).filter(Room.id == room_id).first()
    if not stay or not room:
        return None, "error.stay_not_found"

    start_str = stay.checkout_time or room.checkout
    try:
        start_dt = _parse(start_str) if start_str else _now()
    except Exception:
        start_dt = _now()

    fee, _ = calc_extension_fee(extension_hours, start_dt)
    stay.extension_fee += fee
    stay.total_due = stay.base_rent + stay.extension_fee + stay.extra_fee

    new_co = _fmt(start_dt + timedelta(hours=extension_hours))
    room.checkout      = new_co
    stay.checkout_time = new_co

    warning = None
    if room.next_booking and room.checkout and room.checkout > room.next_booking:
        warning = "warning.extend_conflict"

    db.commit()
    return stay, warning


def checkout_guest(
    db: Session,
    room_id: str,
    extra_fee: float = 0,
    override_ext_fee: float | None = None,
) -> dict | None:
    """
    CheckoutGuest.

    Free-cancel rule:
      If within FREE_CANCEL_MINS of checkin → total = 0, not counted in stats.
      Otherwise → normal fee calculation + accumulate in report.
    """
    stay = get_stay_by_room(db, room_id)
    if not stay:
        return None

    actual_co      = _now()
    mins_since_ci  = _minutes_since_checkin(stay.checkin_time)
    is_free        = mins_since_ci <= FREE_CANCEL_MINS

    if is_free:
        # Free cancel — zero charge
        final_total   = 0.0
        auto_ext_fee  = 0.0
        stay.total_due = 0.0
    else:
        # Normal: check if guest stayed past planned checkout + buffer
        auto_ext_fee    = 0.0
        over_buffer_mins = 0.0

        if stay.checkin_time and stay.checkout_time:
            planned_co    = _parse(stay.checkout_time)
            buffer_end    = planned_co + timedelta(minutes=CHECKOUT_BUFFER_MINS)
            over_buffer_mins = (actual_co - buffer_end).total_seconds() / 60

            if actual_co > buffer_end:
                # Guest exceeded buffer — calculate fee FROM planned_co (not buffer_end)
                auto_ext_fee = _calc_extension_fee_simple(
                    stay.checkout_time,       # fee starts from planned checkout
                    _fmt(actual_co),          # to actual checkout time
                    stay.hourly_rate,
                )
                # Staff override: use their adjusted value
                if override_ext_fee is not None:
                    auto_ext_fee = float(override_ext_fee)

        # BUG 1 FIX: use += so manual extension fees (from /extend) are preserved.
        # checkout_time was already updated when guest extended, so auto_ext_fee
        # covers only the additional overdue period beyond the extended checkout.
        stay.extension_fee += auto_ext_fee
        stay.extra_fee     = extra_fee
        stay.total_due     = stay.base_rent + stay.extension_fee + extra_fee
        final_total        = stay.total_due

        # Accumulate into ReportSummary (legacy)
        report = db.query(ReportSummary).first()
        if report:
            report.total_revenue += final_total
            report.orders        += 1

    _log_stay(db, stay, actual_co, final_total, free_cancel=is_free)
    transition_to_cleaning(db, room_id)
    db.delete(stay)
    db.commit()

    return {
        "room":           room_id,
        "total":          final_total,
        "base_rent":      stay.base_rent,
        "ext_fee":        stay.extension_fee,
        "extra_fee":      extra_fee,
        "auto_ext":       auto_ext_fee > 0,
        "free_cancel":    is_free,
        "mins_since":     round(mins_since_ci, 1),
        "over_buffer":    over_buffer_mins > 0 if not is_free else False,
        "buffer_mins":    CHECKOUT_BUFFER_MINS,
    }


def transfer_room(
    db: Session,
    old_room_id: str,
    new_room_id: str,
) -> tuple[ActiveStay | None, str | None]:
    """
    TransferRoom — move active stay from old_room to new_room.

    Rules:
      1. old_room must have an active stay.
      2. new_room must pass is_checkin_allowed().
      3. new_room must have no booking conflict for the stay's checkin/checkout window.
      4. New room inherits ALL stay data (guest, plan, times, fees, booking links).
      5. Old room logged as transferred=1 (NOT counted in revenue/order stats).
      6. Old room → STATUS_CLEANING.
      7. New room → STATUS_OCCUPIED with all inherited data.

    Returns (new_stay, error_i18n_key | None).
    """
    old_stay = get_stay_by_room(db, old_room_id)
    if not old_stay:
        return None, "error.stay_not_found"

    new_room = db.query(Room).filter(Room.id == new_room_id).first()
    if not new_room:
        return None, "error.room_not_found"

    allowed, reason = is_checkin_allowed(new_room)
    if not allowed:
        return None, reason

    # Conflict check on new room for the same checkin/checkout window
    if old_stay.checkin_time and old_stay.checkout_time:
        from app.services.bookings import get_conflict_detail
        conflict = get_conflict_detail(
            db, new_room_id,
            old_stay.checkin_time,
            old_stay.checkout_time,
        )
        if conflict:
            return None, "error.transfer_conflict"

    # Log old room as transferred (no stats)
    _log_stay(
        db, old_stay, _now(),
        total_charged = 0.0,
        transferred   = True,
        new_room      = new_room_id,
    )

    # Old room → cleaning
    old_room = db.query(Room).filter(Room.id == old_room_id).first()
    if old_room:
        old_room.status        = STATUS_CLEANING
        old_room.current_guest = None
        old_room.checkin       = None
        old_room.checkout      = None

    # Create new stay with all inherited data
    new_stay = ActiveStay(
        room          = new_room_id,
        guest         = old_stay.guest,
        plan          = old_stay.plan,
        base_rent     = old_stay.base_rent,
        extension_fee = old_stay.extension_fee,
        extra_fee     = old_stay.extra_fee,
        total_due     = old_stay.total_due,
        checkin_time  = old_stay.checkin_time,
        checkout_time = old_stay.checkout_time,
        hourly_rate   = old_stay.hourly_rate,
    )
    db.add(new_stay)

    # BUG 4 FIX: only transfer the active check-in booking (status = 已入住).
    # Future bookings for the old room belong to other guests and must NOT be moved.
    bookings = db.query(Booking).filter(
        Booking.room   == old_room_id,
        Booking.status == "已入住",
    ).all()
    for b in bookings:
        b.room = new_room_id

    # Update new room
    new_room.status        = STATUS_OCCUPIED
    new_room.current_guest = old_stay.guest
    new_room.checkin       = old_stay.checkin_time
    new_room.checkout      = old_stay.checkout_time
    # Transfer next_booking from old room if any
    if old_room and old_room.next_booking:
        new_room.next_booking = old_room.next_booking
        old_room.next_booking = None

    db.delete(old_stay)
    db.commit()

    return new_stay, None


def free_cancel_status(stay: ActiveStay) -> dict:
    """Return free-cancel window status for template display."""
    mins = _minutes_since_checkin(stay.checkin_time)
    remaining = max(0.0, FREE_CANCEL_MINS - mins)
    return {
        "eligible":       mins <= FREE_CANCEL_MINS,
        "mins_since":     round(mins, 1),
        "mins_remaining": round(remaining, 1),
        "threshold":      FREE_CANCEL_MINS,
    }


def checkout_buffer_status(stay: ActiveStay) -> dict:
    """
    Return checkout buffer window status for template display.
    Buffer: 15 min after planned checkout — no extra fee within this window.
    Extension fee (if charged) is calculated FROM planned checkout time.
    """
    if not stay.checkout_time:
        return {"in_buffer": False, "past_buffer": False, "mins_over": 0,
                "buffer_mins": CHECKOUT_BUFFER_MINS}

    planned_co   = _parse(stay.checkout_time)
    buffer_end   = planned_co + timedelta(minutes=CHECKOUT_BUFFER_MINS)
    now          = _now()
    mins_over_co = (now - planned_co).total_seconds() / 60   # can be negative
    in_buffer    = 0 < mins_over_co <= CHECKOUT_BUFFER_MINS
    past_buffer  = mins_over_co > CHECKOUT_BUFFER_MINS
    mins_over_buf = max(0.0, (now - buffer_end).total_seconds() / 60)

    return {
        "in_buffer":        in_buffer,
        "past_buffer":      past_buffer,
        "on_time":          mins_over_co <= 0,
        "mins_over_co":     round(mins_over_co, 1),
        "mins_over_buffer": round(mins_over_buf, 1),
        "buffer_mins":      CHECKOUT_BUFFER_MINS,
        "planned_co":       stay.checkout_time,
        "buffer_end":       buffer_end.strftime("%Y-%m-%d %H:%M"),
    }


def get_deposit_paid(db: Session, room_id: str) -> float:
    """
    Return total deposit amount paid for the CURRENT active stay only.
    Filters by checkin_time of the active stay to avoid accumulating
    deposits from previous stays.
    """
    from app.models import Payment, ActiveStay
    stay = db.query(ActiveStay).filter(ActiveStay.room == room_id).first()
    if not stay or not stay.checkin_time:
        return 0.0

    # Only count deposits recorded AFTER (or at) the current check-in time
    result = (
        db.query(Payment)
        .filter(
            Payment.room_id    == room_id,
            Payment.is_deposit == 1,
            Payment.created_at >= stay.checkin_time[:16],  # YYYY-MM-DD HH:MM
        )
        .all()
    )
    return sum(p.amount for p in result if not p.is_refund)

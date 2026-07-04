import pathlib
"""
routers/checkin.py — GET/POST /checkin
Phase-2: State Machine guard + date-format normalisation.
"""
from fastapi import APIRouter, Request, Depends, Form
from fastapi.responses import HTMLResponse, RedirectResponse
from fastapi.templating import Jinja2Templates
from sqlalchemy.orm import Session

from app.db import get_db
from app.services.backup import auto_backup as _auto_backup
from app.services import audit as _audit
from app.services import stays as ssvc
from app.services import bookings as bsvc
from app.services.rooms import get_all_rooms, badge_color
from app.lib.i18n import get_lang, get_translations

router    = APIRouter()
templates = Jinja2Templates(directory=str(pathlib.Path(__file__).parent.parent / "templates"))

PLANS = ["24hrs", "12hrs"]


def _norm_dt(val: str) -> str:
    """Convert datetime-local value (T separator) to DB format (space)."""
    return val.replace("T", " ")[:16] if val else ""


@router.get("/checkin", response_class=HTMLResponse)
async def checkin_form(
    request: Request,
    booking_id: str = "",
    room: str = "",
    db: Session = Depends(get_db),
):
    lang     = get_lang(request)
    trans    = get_translations(lang)
    from datetime import datetime as _dt
    from app.models import MaintenanceSchedule
    now_str = _dt.now().strftime("%Y-%m-%d %H:%M")

    all_rooms = get_all_rooms(db)
    for r in all_rooms:
        # Mark rooms under active maintenance schedule
        active_maint = (
            db.query(MaintenanceSchedule)
            .filter(
                MaintenanceSchedule.room_id    == r.id,
                MaintenanceSchedule.status     != "done",
                MaintenanceSchedule.start_time <= now_str,
                MaintenanceSchedule.end_time   >  now_str,
            )
            .first()
        )
        if active_maint:
            r.status      = "維修中"
            r.maint_title = active_maint.title
        else:
            r.maint_title = None
        r.badge_color = badge_color(r.status)

    from app.services.bookings import CANCELLED_STATUSES as _CS
    from datetime import datetime as _dt, timedelta as _td
    _now_s = _dt.now().strftime("%Y-%m-%d %H:%M")
    # Same filter as bookings page: exclude 已取消/No-show/已入住
    # Also exclude bookings whose check-in was more than 30 minutes ago and not yet checked in
    # (those are auto-no-showed by the polling API, just hide them here too)
    _cutoff = (_dt.now() - _td(minutes=35)).strftime("%Y-%m-%d %H:%M")
    bookings = [
        b for b in bsvc.get_all_bookings(db)
        if b.status not in _CS                    # exclude cancelled/checkedin
        and (b.checkin or "") >= _cutoff           # exclude very overdue bookings
    ]
    prefill = bsvc.get_booking(db, booking_id) if booking_id else None
    msg     = request.query_params.get("msg", "")
    error   = request.query_params.get("error", "")

    import json as _json
    from app.services.fee_engine import get_holiday_dates_from_db as _ghd
    holiday_dates_json = _json.dumps(sorted(_ghd(db)))

    from datetime import datetime as _dt_now
    now_dt = _dt_now.now().strftime("%Y-%m-%dT%H:%M")

    return templates.TemplateResponse("checkin.html", {
        "request":   request,
        "all_rooms": all_rooms,
        "bookings":  bookings,
        "prefill":   prefill,
        "plans":     PLANS,
        "prefill_room": room,
        "title":     trans.get("checkin.title", "Check-in"),
        "trans":     trans,
        "lang":      lang,
        "msg":              msg,
        "error":            error,
        "holiday_dates_json": holiday_dates_json,
        "now_dt":    now_dt,
    })


@router.post("/checkin")
async def checkin_submit(
    request:       Request,
    room:           str   = Form(...),
    guest:          str   = Form(...),
    phone:          str   = Form(""),
    plan:           str   = Form("24hrs"),
    base_rent:      float = Form(0),
    discount:       float = Form(0),
    days:           int   = Form(1),
    amount_auto:    str   = Form("1"),
    booking_id:     str   = Form(""),
    checkin_time:   str   = Form(""),
    checkout_time:  str   = Form(""),
    deposit_amount: float = Form(0),
    deposit_type:   str   = Form("cash"),
    db: Session = Depends(get_db),
):
    ci = _norm_dt(checkin_time)
    co = _norm_dt(checkout_time)

    # Multi-day check-in: derive checkout from check-in + days × plan length,
    # and compute the room charge with the SAME block-ceiling engine used for
    # bookings/extension (so 12hr × N caps correctly at the 24hr rate).
    discount = max(0.0, float(discount or 0))
    try:
        from datetime import datetime as _dt, timedelta as _td
        plan_hours = 12 if plan == "12hrs" else 24
        days_i = max(1, int(days or 1))
        if ci:
            ci_dt = _dt.strptime(ci, "%Y-%m-%d %H:%M")
            co = (ci_dt + _td(hours=plan_hours * days_i)).strftime("%Y-%m-%d %H:%M")
            if str(amount_auto) == "1":
                from app.services.fee_engine import calc_extension_fee as _calc
                _gross, _ = _calc(plan_hours * days_i, ci_dt)
                base_rent = max(0.0, float(_gross) - discount)
    except Exception:
        pass  # fall back to submitted checkout / base_rent

    # Date validation
    if ci and co:
        err = bsvc.validate_booking_dates(ci, co, allow_past=True)
        if err:
            from urllib.parse import quote
            return RedirectResponse(
                f"/checkin?room={room}&error={quote(err)}", status_code=303
            )

    # Maintenance schedule conflict check
    from app.models import MaintenanceSchedule as _MS2
    from datetime import datetime as _dt3
    ci_check = ci or _dt3.now().strftime("%Y-%m-%d %H:%M")
    co_check = co or ""
    maint_block = db.query(_MS2).filter(
        _MS2.room_id    == room,
        _MS2.status     != "done",
        _MS2.start_time < (co_check if co_check else "9999-12-31 23:59"),
        _MS2.end_time   > ci_check,
    ).first()
    if maint_block:
        from urllib.parse import quote
        return RedirectResponse(
            f"/checkin?room={room}&error=error.maintenance_conflict",
            status_code=303
        )

    # Booking conflict check: block a check-in that overlaps an existing booking
    # in this room (excluding the guest's own originating booking). Previously
    # check-in skipped this entirely, so a stay could overlap a later booking.
    from datetime import datetime as _dtc, timedelta as _tdc
    eff_ci = ci or _dtc.now().strftime("%Y-%m-%d %H:%M")
    if co:
        eff_co = co
    else:
        _ph = 12 if plan == "12hrs" else 24
        _di = max(1, int(days or 1))
        eff_co = (_dtc.strptime(eff_ci, "%Y-%m-%d %H:%M")
                  + _tdc(hours=_ph * _di)).strftime("%Y-%m-%d %H:%M")
    bk_conflict = bsvc.get_conflict_detail(
        db, room, eff_ci, eff_co,
        exclude_id=(booking_id or None),
        include_stays=False,   # bookings only; stay-overwrite handled by checkin_guest
    )
    if bk_conflict:
        from urllib.parse import quote
        return RedirectResponse(
            f"/checkin?room={room}&error=error.conflict", status_code=303
        )

    stay, error_key = ssvc.checkin_guest(
        db,
        room_id      = room,
        guest        = guest,
        plan         = plan,
        base_rent    = base_rent,
        booking_id   = booking_id or None,
        checkin_time = ci or None,
        checkout_time= co or None,
        discount     = discount,
    )

    if error_key:
        from urllib.parse import quote
        return RedirectResponse(
            f"/checkin?room={room}&error={quote(error_key)}", status_code=303
        )

    _audit.log_checkin(db, room, guest, plan, base_rent)
    # Record deposit if provided
    if deposit_amount and deposit_amount > 0:
        from app.services.payments import create_payment
        cu = getattr(request.state, "current_user", None)
        create_payment(db, booking_id or None, room, guest,
                       deposit_type, deposit_amount,
                       is_deposit=True,
                       created_by=cu.username if cu else "admin")
    _auto_backup(db, trigger="checkin")
    return RedirectResponse(f"/rooms?msg=checkin_ok", status_code=303)

import pathlib
"""
routers/bookings.py — /bookings  /bookings/new
Phase-2: date validation + conflict check with i18n error messages.
"""
from fastapi import APIRouter, Request, Depends, Form, Query
from fastapi.responses import HTMLResponse, RedirectResponse, JSONResponse
from fastapi.templating import Jinja2Templates
from sqlalchemy.orm import Session

from app.db import get_db
from app.services.backup import auto_backup as _auto_backup
from app.services import audit as _audit
from app.services import bookings as bsvc
from app.services.bookings import get_conflict_detail, validate_booking_dates
from app.services.rooms import get_all_rooms, badge_color
from app.lib.i18n import get_lang, get_translations

router    = APIRouter()
templates = Jinja2Templates(directory=str(pathlib.Path(__file__).parent.parent / "templates"))
PLANS      = ["24hrs", "12hrs"]
RATE_TYPES = ["非假日", "假日"]


def _norm_dt(val: str) -> str:
    return val.replace("T", " ")[:16] if val else ""


@router.get("/bookings", response_class=HTMLResponse)
async def booking_list(
    request:  Request,
    sort_by:  str = Query(default="checkin"),
    sort_dir: str = Query(default="asc"),
    db: Session = Depends(get_db),
):
    lang     = get_lang(request)
    trans    = get_translations(lang)
    from app.services.bookings import CANCELLED_STATUSES as _CS
    bookings = [b for b in bsvc.get_all_bookings(db)
                   if b.status not in _CS]
    msg      = request.query_params.get("msg", "")

    # Sort bookings
    SORT_FIELDS = {
        "room":     lambda b: b.room or "",
        "guest":    lambda b: b.guest or "",
        "phone":    lambda b: b.phone or "",
        "checkin":  lambda b: b.checkin or "",
        "checkout": lambda b: b.checkout or "",
        "plan":     lambda b: b.plan or "",
        "amount":   lambda b: float(b.amount or 0),
        "status":   lambda b: b.status or "",
    }
    key_fn   = SORT_FIELDS.get(sort_by, SORT_FIELDS["checkin"])
    reverse  = sort_dir == "desc"
    bookings = sorted(bookings, key=key_fn, reverse=reverse)

    summary  = bsvc.status_summary(db)
    return templates.TemplateResponse("bookings.html", {
        "request":  request,
        "bookings": bookings,
        "summary":  summary,
        "sort_by":  sort_by,
        "sort_dir": sort_dir,
        "title":    trans.get("nav.bookings", "Bookings"),
        "trans":    trans,
        "lang":     lang,
        "msg":      msg,
    })


# ── Availability check API (called by JS) ────────────────────────────────

@router.get("/api/check-availability")
async def check_availability(
    room:     str = Query(...),
    checkin:  str = Query(...),
    checkout: str = Query(...),
    exclude:  str = Query(default=""),
    db: Session = Depends(get_db),
):
    """
    Returns JSON:
      { available: true } — no conflict, dates valid
      { available: false, reason: "i18n.key", detail: {...} } — blocked
    """
    ci = checkin.replace("T", " ")[:16]
    co = checkout.replace("T", " ")[:16]

    # 1. Date validation
    date_err = validate_booking_dates(ci, co)
    if date_err:
        return JSONResponse({"available": False, "reason": date_err, "detail": None})

    # 1b. Monthly suite block — a 月租套房 room cannot be booked
    from app.services.rooms import get_room as _gr, STATUS_MONTHLY as _SM
    _room = _gr(db, room)
    if _room and _room.status == _SM:
        return JSONResponse({"available": False, "reason": "error.room_monthly", "detail": None})

    # 2. Conflict check
    conflict = get_conflict_detail(db, room, ci, co, exclude_id=exclude or None)
    if conflict:
        return JSONResponse({
            "available": False,
            "reason":    "error.conflict",
            "detail":    conflict,
        })

    return JSONResponse({"available": True, "reason": "", "detail": None})


@router.get("/api/booking-quote")
async def booking_quote(
    checkin: str = Query(...),
    plan:    str = Query("24hrs"),
    days:    int = Query(1),
):
    """
    Authoritative multi-day price quote using the SAME block-ceiling engine as
    extension/checkout billing. Two consecutive 12hr periods within a day are
    capped at the 24hr rate (not double 12hr), and each 12hr block is judged
    holiday/weekday by its own date.
    """
    from fastapi.responses import JSONResponse
    from app.services.fee_engine import calc_extension_fee
    from datetime import datetime
    ci = checkin.replace("T", " ")[:16]
    try:
        ci_dt = datetime.strptime(ci, "%Y-%m-%d %H:%M")
    except ValueError:
        return JSONResponse({"ok": False, "gross": 0, "breakdown": []})
    per_hours   = 12 if plan == "12hrs" else 24
    days_i      = max(1, int(days or 1))
    total_hours = per_hours * days_i
    gross, breakdown = calc_extension_fee(total_hours, ci_dt)
    return JSONResponse({
        "ok": True,
        "gross": int(gross),
        "total_hours": total_hours,
        "breakdown": breakdown,
    })


@router.post("/bookings/{booking_id}/cancel")
async def cancel_booking(booking_id: str, db: Session = Depends(get_db)):
    b = bsvc.cancel_booking(db, booking_id)
    _audit.log_booking_cancel(db, booking_id, b.guest if b else '')
    return RedirectResponse("/bookings?msg=cancelled", status_code=303)


@router.get("/bookings/new", response_class=HTMLResponse)
async def booking_new_form(
    request: Request,
    room: str = "",
    db: Session = Depends(get_db),
):
    lang   = get_lang(request)
    trans  = get_translations(lang)
    rooms  = get_all_rooms(db)
    for r in rooms:
        r.badge_color = badge_color(r.status)
    # Auto-detect today's rate type for default selection
    import json as _json
    from app.services.fee_engine import get_rate_type as _grt, get_holiday_dates_from_db as _ghd
    from datetime import date as _dt
    today_rate = "假日" if _grt(_dt.today(), db) == "holiday" else "非假日"
    holiday_dates_json = _json.dumps(sorted(_ghd(db)))

    return templates.TemplateResponse("booking_create.html", {
        "request":            request,
        "rooms":              rooms,
        "plans":              PLANS,
        "rate_types":         RATE_TYPES,
        "today_rate":         today_rate,
        "holiday_dates_json": holiday_dates_json,
        "prefill_room":    room,
        "prefill":         None,
        "error_msg":       None,
        "conflict_detail": None,
        "title":           trans.get("nav.bookings_new", "New Booking"),
        "trans":           trans,
        "lang":            lang,
    })


@router.post("/bookings/new")
async def booking_create(
    request:         Request,
    room:            str   = Form(...),
    guest:           str   = Form(...),
    phone:           str   = Form(""),
    checkin:         str   = Form(...),
    checkout:        str   = Form(...),
    plan:              str   = Form("24hrs"),
    amount:            float = Form(0),
    discount:          float = Form(0),
    days:              int   = Form(1),
    amount_auto:       str   = Form("1"),   # "1" = use engine-computed amount; "0" = manual override
    rate_type:         str   = Form("非假日"),
    deposit_amount:    float = Form(0),
    deposit_type:      str   = Form("cash"),
    db: Session = Depends(get_db),
):
    lang  = get_lang(request)
    trans = get_translations(lang)
    rooms = get_all_rooms(db)
    for r in rooms:
        r.badge_color = badge_color(r.status)

    ci = _norm_dt(checkin)
    co = _norm_dt(checkout)

    # Multi-day booking: derive checkout from check-in + days × plan length,
    # so the stored period always matches the chosen number of days.
    try:
        from datetime import datetime as _dt, timedelta as _td
        plan_hours = 12 if plan == "12hrs" else 24
        days_i = max(1, int(days or 1))
        if ci:
            ci_dt = _dt.strptime(ci, "%Y-%m-%d %H:%M")
            co = (ci_dt + _td(hours=plan_hours * days_i)).strftime("%Y-%m-%d %H:%M")
    except Exception:
        pass  # fall back to the submitted checkout

    discount = max(0.0, float(discount or 0))

    # Authoritative amount via the block-ceiling engine (correct for any plan ×
    # days, incl. 12hr × N where consecutive 12hr periods cap at the 24hr rate).
    # When amount_auto="1" (user didn't manually override) we use it; otherwise
    # we trust the manually-entered amount.
    if str(amount_auto) == "1":
        try:
            from datetime import datetime as _dtq
            from app.services.fee_engine import calc_extension_fee as _calc
            _ci_dt = _dtq.strptime(ci, "%Y-%m-%d %H:%M")
            _per   = 12 if plan == "12hrs" else 24
            _gross, _ = _calc(_per * max(1, int(days or 1)), _ci_dt)
            amount = max(0.0, float(_gross) - discount)
        except Exception:
            pass  # fall back to the submitted amount

    import json as _json2
    from app.services.fee_engine import get_holiday_dates_from_db as _ghd2
    _holiday_json = _json2.dumps(sorted(_ghd2(db)))

    def render_error(key: str, conflict_detail: dict | None = None):
        return templates.TemplateResponse("booking_create.html", {
            "request":            request,
            "rooms":              rooms,
            "plans":              PLANS,
            "rate_types":         RATE_TYPES,
            "today_rate":         rate_type or "非假日",
            "holiday_dates_json": _holiday_json,
            "prefill_room":       room,
            "prefill":            {"guest": guest, "phone": phone,
                                   "checkin": checkin, "checkout": checkout,
                                   "plan": plan, "amount": amount, "rate_type": rate_type},
            "error_msg":          trans.get(key, key),
            "conflict_detail":    conflict_detail,
            "title":              trans.get("nav.bookings_new", "New Booking"),
            "trans":              trans,
            "lang":               lang,
        })

    # ── date validation ────────────────────────────────────────────────
    date_err = bsvc.validate_booking_dates(ci, co)
    if date_err:
        return render_error(date_err)

    # ── monthly suite block — cannot book a 月租套房 room ─────────────────
    from app.services.rooms import get_room as _gr, STATUS_MONTHLY as _SM
    _room_obj = _gr(db, room)
    if _room_obj and _room_obj.status == _SM:
        return render_error("error.room_monthly")

    # ── conflict check: bookings ────────────────────────────────────────
    conflict = get_conflict_detail(db, room, ci, co)
    if conflict:
        return render_error("error.conflict", conflict)

    # ── conflict check: maintenance schedules ───────────────────────────
    from app.models import MaintenanceSchedule as _MS
    maint_conflict = db.query(_MS).filter(
        _MS.room_id    == room,
        _MS.status     != "done",
        _MS.start_time < co,
        _MS.end_time   > ci,
    ).first()
    if maint_conflict:
        return render_error("error.maintenance_conflict",
            {"id": f"MAINT-{maint_conflict.id}",
             "guest": f"🔧 {maint_conflict.title}",
             "checkin": maint_conflict.start_time,
             "checkout": maint_conflict.end_time,
             "status": "維修排程"})

    _bk = bsvc.create_booking(db, {
        "room": room, "guest": guest, "phone": phone,
        "checkin": ci, "checkout": co,
        "plan": plan, "amount": amount, "discount": discount, "rate_type": rate_type,
    })
    _audit.log_booking_create(db, 'new', room, guest)
    # Record deposit if provided. Pass booking_id so the deposit is linked to
    # the booking and shows up in the room overview after check-in
    # (get_paid_for_stay / get_deposit_paid match on ActiveStay.booking_id).
    deposit_amount_val = float(deposit_amount or 0)
    if deposit_amount_val > 0:
        from app.services.payments import create_payment as _cp
        cu = getattr(request.state, "current_user", None)
        _cp(db, _bk.id, room, guest, deposit_type, deposit_amount_val,
            is_deposit=True, created_by=cu.username if cu else "admin")
    _auto_backup(db, trigger="booking")
    return RedirectResponse("/bookings?msg=created", status_code=303)


# ── Edit booking ─────────────────────────────────────────────────────────────

@router.get("/bookings/{booking_id}/edit", response_class=HTMLResponse)
async def booking_edit_page(
    request:    Request,
    booking_id: str,
    db: Session = Depends(get_db),
):
    from app.services.auth import get_current_user, require_role
    user = get_current_user(request, db)
    if not require_role(user, "admin", "manager", "front_desk"):
        return RedirectResponse("/login?err=auth.forbidden", status_code=303)

    lang    = get_lang(request)
    trans   = get_translations(lang)
    bk      = bsvc.get_booking(db, booking_id)
    if not bk:
        return RedirectResponse("/bookings?err=error.not_found", status_code=303)

    from app.services.rooms import get_all_rooms, badge_color
    rooms = get_all_rooms(db)
    for r in rooms:
        r.badge_color = badge_color(r.status)

    import json as _json
    from app.services.fee_engine import get_holiday_dates_from_db as _ghd
    holiday_dates_json = _json.dumps(sorted(_ghd(db)))

    return templates.TemplateResponse("booking_edit.html", {
        "request":            request,
        "bk":                 bk,
        "rooms":              rooms,
        "plans":              PLANS,
        "rate_types":         RATE_TYPES,
        "holiday_dates_json": holiday_dates_json,
        "title":              trans.get("booking.edit_title", "Edit Booking"),
        "trans":              trans,
        "lang":               lang,
        "error_msg":          None,
    })


@router.post("/bookings/{booking_id}/edit")
async def booking_edit_submit(
    request:    Request,
    booking_id: str,
    room:       str   = Form(...),
    guest:      str   = Form(...),
    phone:      str   = Form(""),
    checkin:    str   = Form(...),
    checkout:   str   = Form(...),
    plan:       str   = Form("24hrs"),
    amount:     float = Form(0),
    rate_type:  str   = Form("非假日"),
    db: Session = Depends(get_db),
):
    from app.services.auth import get_current_user, require_role
    user = get_current_user(request, db)
    if not require_role(user, "admin", "manager", "front_desk"):
        return RedirectResponse("/login?err=auth.forbidden", status_code=303)

    lang  = get_lang(request)
    trans = get_translations(lang)
    ci = _norm_dt(checkin)
    co = _norm_dt(checkout)

    bk, err = bsvc.edit_booking(db, booking_id, room, ci, co, guest, phone, plan, amount, rate_type)
    if err:
        from app.services.rooms import get_all_rooms, badge_color
        orig = bsvc.get_booking(db, booking_id)
        rooms = get_all_rooms(db)
        for r in rooms:
            r.badge_color = badge_color(r.status)
        import json as _json
        from app.services.fee_engine import get_holiday_dates_from_db as _ghd
        return templates.TemplateResponse("booking_edit.html", {
            "request":            request,
            "bk":                 orig,
            "rooms":              rooms,
            "plans":              PLANS,
            "rate_types":         RATE_TYPES,
            "holiday_dates_json": _json.dumps(sorted(_ghd(db))),
            "title":              trans.get("booking.edit_title", "Edit Booking"),
            "trans":              trans,
            "lang":               lang,
            "error_msg":          trans.get(err, err),
        })

    _audit.log_action(db, "booking_edit",
        target_id=booking_id, target_type="booking",
        new_value={"room": room, "checkin": ci, "checkout": co},
        description=f"Booking edited: {booking_id} → {room} {ci}~{co}",
        user_id=user.username if user else "admin")
    _auto_backup(db, trigger="booking")
    return RedirectResponse("/bookings?msg=updated", status_code=303)


# ── Multi-slot booking ────────────────────────────────────────────────────────

@router.post("/bookings/multi")
async def booking_multi_submit(
    request:         Request,
    guest:           str = Form(...),
    phone:           str = Form(""),
    slots_json:      str = Form(...),   # JSON array of slot objects
    deposit_amount:  float = Form(0),
    deposit_type:    str   = Form("cash"),
    db: Session = Depends(get_db),
):
    from app.services.auth import get_current_user, require_role
    user = get_current_user(request, db)
    if not require_role(user, "admin", "manager", "front_desk"):
        return RedirectResponse("/login?err=auth.forbidden", status_code=303)

    import json as _json
    try:
        slots = _json.loads(slots_json)
    except Exception:
        return RedirectResponse("/bookings/new?err=error.invalid_data", status_code=303)

    created, conflicts = bsvc.create_multi_bookings(db, slots, guest, phone)

    for bk in created:
        _audit.log_booking_create(db, "multi", bk.room, guest)
    if created:
        # Record deposit if provided. Link to the first booking so the deposit
        # surfaces in the room overview once that slot is checked in
        # (get_paid_for_stay / get_deposit_paid match on ActiveStay.booking_id).
        deposit_amount_val = float(deposit_amount or 0)
        if deposit_amount_val > 0:
            from app.services.payments import create_payment as _cp
            cu = getattr(request.state, "current_user", None)
            _cp(db, created[0].id, created[0].room, guest, deposit_type, deposit_amount_val,
                is_deposit=True, created_by=cu.username if cu else "admin")
        _auto_backup(db, trigger="booking")

    if conflicts and not created:
        return RedirectResponse(f"/bookings/new?err=error.conflict", status_code=303)

    msg = f"created_{len(created)}"
    if conflicts:
        msg += f"_conflicts_{len(conflicts)}"
    return RedirectResponse(f"/bookings?msg={msg}", status_code=303)


# ── Booking-soon notification API ─────────────────────────────────────────────

@router.get("/api/booking-soon")
async def booking_soon(request: Request, db: Session = Depends(get_db)):
    """
    Returns bookings with checkin within the next 15 minutes (not yet checked in).
    """
    from fastapi.responses import JSONResponse
    from datetime import datetime, timedelta

    now   = datetime.now()
    warn_dt = now + timedelta(minutes=15)
    now_s  = now.strftime("%Y-%m-%d %H:%M")
    warn_s = warn_dt.strftime("%Y-%m-%d %H:%M")

    from app.models import Booking as _Bk

    # Bookings with checkin in next 15 minutes
    soon = db.query(_Bk).filter(
        _Bk.status == "已預約",
        _Bk.checkin >  now_s,
        _Bk.checkin <= warn_s,
    ).all()

    result = []
    for bk in soon:
        ci_dt    = datetime.strptime(bk.checkin[:16], "%Y-%m-%d %H:%M")
        mins_left = max(0, int((ci_dt - now).total_seconds() / 60))
        result.append({
            "id":       bk.id,
            "room":     bk.room,
            "guest":    bk.guest,
            "checkin":  bk.checkin[:16],
            "mins_left": mins_left,
        })

    return JSONResponse({"soon": result})


@router.post("/api/booking-cancel-noshow/{booking_id}")
async def booking_cancel_noshow(
    request:    Request,
    booking_id: str,
    db: Session = Depends(get_db),
):
    """Cancel a booking as No-show from the notification popup."""
    from fastapi.responses import JSONResponse
    bk = bsvc.get_booking(db, booking_id)
    if bk and bk.status == "已預約":
        bk.status = "已取消"
        db.commit()
        _auto_backup(db, trigger="booking")
        return JSONResponse({"ok": True, "id": booking_id})
    return JSONResponse({"ok": False, "reason": "not found or already processed"})

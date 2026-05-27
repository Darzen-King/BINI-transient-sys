import pathlib
"""
routers/stays.py — /extend  /checkout
Phase-2: auto fee calculation, i18n warnings, fee breakdown in template.
"""
from urllib.parse import quote, unquote
from fastapi import APIRouter, Request, Depends, Form, Query
from fastapi.responses import HTMLResponse, RedirectResponse
from fastapi.templating import Jinja2Templates
from sqlalchemy.orm import Session

from app.db import get_db
from app.services.backup import auto_backup as _auto_backup
from app.services import audit as _audit
from app.services import stays as ssvc
from app.services.fee_engine import HOURLY as EXTENSION_HOURLY_RATE
from app.services.rooms import get_all_rooms, get_room, badge_color
from app.services.fee_engine import calc_extension_fee, preview_extension
from app.lib.i18n import get_lang, get_translations

router    = APIRouter()
templates = Jinja2Templates(directory=str(pathlib.Path(__file__).parent.parent / "templates"))


# ── Fee preview API (called by JS) ───────────────────────────────────────

@router.get("/api/extend-preview")
async def extend_preview_api(
    hours:        float = Query(0),
    checkout_time: str  = Query(default=None),
    checkin_time:  str  = Query(default=None),
):
    """Return JSON preview of extension fee for given hours and start datetime."""
    from fastapi.responses import JSONResponse
    result = preview_extension(hours, checkin_time, checkout_time)
    return JSONResponse(result)


# ── Extend Stay ───────────────────────────────────────────────────────────

@router.get("/extend", response_class=HTMLResponse)
async def extend_form(
    request: Request,
    room: str = "",
    db: Session = Depends(get_db),
):
    lang  = get_lang(request)
    trans = get_translations(lang)

    active_stays  = ssvc.get_all_active_stays(db)
    selected_stay = ssvc.get_stay_by_room(db, room) if room else None
    selected_room = get_room(db, room) if room else None
    warning_key   = request.query_params.get("warning", "")
    msg           = request.query_params.get("msg", "")

    # Resolve warning text via i18n
    warning_text = trans.get(warning_key, warning_key) if warning_key else ""

    return templates.TemplateResponse("extend.html", {
        "request":        request,
        "active_stays":   active_stays,
        "selected_stay":  selected_stay,
        "selected_room":  selected_room,
        "selected_room_id": room,
        "warning":        warning_text,
        "msg":            msg,
        "title":          trans.get("extend.title", "Extend Stay"),
        "trans":          trans,
        "lang":           lang,
    })


@router.post("/extend")
async def extend_submit(
    request:         Request,
    room:            str   = Form(...),
    extension_hours: float = Form(2),
    use_auto_rate:   str   = Form("yes"),
    rate_per_hour:   float = Form(200),
    db: Session = Depends(get_db),
):
    rate = None if use_auto_rate == "yes" else rate_per_hour
    _, warning_key = ssvc.extend_stay(db, room, extension_hours, rate)

    if warning_key:
        return RedirectResponse(
            f"/extend?room={room}&warning={quote(warning_key)}", status_code=303
        )
    _audit.log_action(db, 'extend_stay', target_id=room, target_type='room', description=f'Extend: {room} +{extension_hours}hr')
    _auto_backup(db, trigger="extend")
    return RedirectResponse(f"/extend?room={room}&msg=extended", status_code=303)


# ── Checkout ──────────────────────────────────────────────────────────────

@router.get("/checkout", response_class=HTMLResponse)
async def checkout_form(
    request: Request,
    room: str = "",
    db: Session = Depends(get_db),
):
    lang  = get_lang(request)
    trans = get_translations(lang)

    active_stays  = ssvc.get_all_active_stays(db)
    selected_stay = ssvc.get_stay_by_room(db, room) if room else None
    msg           = request.query_params.get("msg", "")
    total         = request.query_params.get("total", "")
    auto_ext      = request.query_params.get("auto_ext", "")
    free_cancel   = request.query_params.get("free_cancel", "")

    free_cancel_st = ssvc.free_cancel_status(selected_stay) if selected_stay else None
    checkout_buffer_st = ssvc.checkout_buffer_status(selected_stay) if selected_stay else None
    over_buffer        = request.query_params.get("over_buffer", "")

    # Deposit and balance calculation
    deposit_paid = ssvc.get_deposit_paid(db, room) if room else 0.0
    total_due    = float(selected_stay.total_due) if selected_stay else 0.0
    balance_due  = max(0.0, total_due - deposit_paid)

    return templates.TemplateResponse("checkout.html", {
        "request":            request,
        "active_stays":       active_stays,
        "selected_stay":      selected_stay,
        "selected_room_id":   room,
        "msg":                msg,
        "total":              total,
        "auto_ext":           auto_ext,
        "free_cancel":        free_cancel,
        "over_buffer":        over_buffer,
        "free_cancel_st":     free_cancel_st,
        "checkout_buffer_st": checkout_buffer_st,
        "extension_hourly_rate": EXTENSION_HOURLY_RATE,
        "deposit_paid":       deposit_paid,
        "balance_due":        balance_due,
        "title":              trans.get("checkout.title", "Check-out"),
        "trans":              trans,
        "lang":               lang,
    })


@router.post("/checkout")
async def checkout_submit(
    request:        Request,
    room:           str   = Form(...),
    extra_fee:      float = Form(0),
    payment_amount: float = Form(0),
    payment_type:   str   = Form("cash"),
    override_fee:   str   = Form(""),   # staff override for overdue fee
    db: Session = Depends(get_db),
):
    # BUG 2 FIX: capture guest name BEFORE checkout_guest() deletes the ActiveStay
    _pre_stay = ssvc.get_stay_by_room(db, room)
    stay_guest = _pre_stay.guest if _pre_stay else ""

    # If staff overrode the overdue fee, pass it along
    override = float(override_fee) if override_fee.strip() != "" else None
    result = ssvc.checkout_guest(db, room, extra_fee, override_ext_fee=override)
    if result:
        _audit.log_checkout(db, room, stay_guest, result.get('total', 0), result.get('free_cancel', False))
        # Record payment if provided and not a free cancel
        if payment_amount and payment_amount > 0 and not result.get('free_cancel'):
            from app.services.payments import create_payment
            cu = getattr(request.state, "current_user", None)
            create_payment(db, None, room, stay_guest,
                           payment_type, payment_amount,
                           is_deposit=False,
                           created_by=cu.username if cu else "admin")
        _auto_backup(db, trigger="checkout")
        params = (
            f"msg=ok&room={room}"
            f"&total={result['total']:.0f}"
            f"&base={result['base_rent']:.0f}"
            f"&ext={result['ext_fee']:.0f}"
            f"&extra={result['extra_fee']:.0f}"
            f"&auto_ext={'1' if result['auto_ext'] else '0'}"
            f"&free_cancel={'1' if result['free_cancel'] else '0'}"
            f"&over_buffer={'1' if result.get('over_buffer') else '0'}"
        )
        return RedirectResponse(f"/checkout?{params}", status_code=303)
    return RedirectResponse("/checkout?msg=error", status_code=303)


# ── Overdue check API ─────────────────────────────────────────────────────────

@router.get("/api/overdue-check/{room_id}")
async def overdue_check(room_id: str, db: Session = Depends(get_db)):
    """
    Returns overdue status and the INCREMENTAL overdue fee for a room.
    Uses original_checkout_time as base (BUG-A FIX) so manual extensions
    and auto-overdue share the same block-ceiling chain.
    Called by checkout page JS before confirming checkout.
    """
    from fastapi.responses import JSONResponse
    from app.models import ActiveStay
    from app.services.fee_engine import calc_extension_fee
    from app.services.stays import CHECKOUT_BUFFER_MINS
    from datetime import datetime, timedelta
    import math

    stay = db.query(ActiveStay).filter(ActiveStay.room == room_id).first()
    if not stay or not stay.checkout_time:
        return JSONResponse({"overdue": False, "minutes": 0, "fee": 0})

    now          = datetime.now()
    planned_co   = datetime.strptime(stay.checkout_time[:16], "%Y-%m-%d %H:%M")
    buffer_end   = planned_co + timedelta(minutes=CHECKOUT_BUFFER_MINS)
    over_mins    = (now - buffer_end).total_seconds() / 60

    if over_mins <= 0:
        return JSONResponse({"overdue": False, "minutes": 0, "fee": 0})

    # BUG-A FIX: use original_checkout_time as the block-ceiling start
    orig_co_str = (stay.original_checkout_time or stay.checkout_time)[:16]
    orig_co_dt  = datetime.strptime(orig_co_str, "%Y-%m-%d %H:%M")

    total_secs  = (now - orig_co_dt).total_seconds()
    ext_half_hrs = math.ceil(total_secs / 1800)
    ext_hours    = ext_half_hrs * 0.5

    total_fee, breakdown = calc_extension_fee(ext_hours, orig_co_dt)
    # Incremental overdue = total − already-accumulated manual extension fee
    already_ext    = float(stay.extension_fee or 0)
    incremental_fee = max(0, int(total_fee) - int(already_ext))

    return JSONResponse({
        "overdue":        True,
        "minutes":        round(over_mins),
        "ext_hours":      ext_hours,
        "fee":            incremental_fee,   # INCREMENTAL overdue only
        "planned_co":     stay.checkout_time[:16],
        "breakdown":      breakdown,
    })


@router.get("/api/overdue-correction-preview/{room_id}")
async def overdue_correction_preview(
    room_id: str,
    correction_hours: float = Query(0),
    db: Session = Depends(get_db),
):
    """
    Preview the INCREMENTAL overdue fee when staff enters correction hours.
    correction_hours = hours past the CURRENT planned checkout_time (can be 0).
    Uses original_checkout_time as base for cumulative block-ceiling.
    """
    from fastapi.responses import JSONResponse
    from app.models import ActiveStay
    from app.services.fee_engine import calc_extension_fee
    from datetime import datetime

    stay = db.query(ActiveStay).filter(ActiveStay.room == room_id).first()
    if not stay or not stay.checkout_time:
        return JSONResponse({"fee": 0, "total_ext_hours": 0})

    orig_co_str    = (stay.original_checkout_time or stay.checkout_time)[:16]
    orig_co_dt     = datetime.strptime(orig_co_str, "%Y-%m-%d %H:%M")
    current_co_dt  = datetime.strptime(stay.checkout_time[:16], "%Y-%m-%d %H:%M")

    # Total extension = already-extended window + staff correction hours from current CO
    elapsed_hrs    = (current_co_dt - orig_co_dt).total_seconds() / 3600
    correction     = max(0.0, float(correction_hours))
    total_ext_hours = elapsed_hrs + correction

    if total_ext_hours <= 0:
        return JSONResponse({"fee": 0, "total_ext_hours": 0})

    total_fee, breakdown = calc_extension_fee(total_ext_hours, orig_co_dt)
    already_ext     = float(stay.extension_fee or 0)
    incremental_fee = max(0.0, total_fee - already_ext)

    return JSONResponse({
        "fee":             int(incremental_fee),
        "total_ext_hours": round(total_ext_hours, 2),
        "total_fee":       int(total_fee),
        "already_ext":     int(already_ext),
        "breakdown":       breakdown,
    })

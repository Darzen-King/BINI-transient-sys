import pathlib
"""
routers/rooms.py — /rooms  /room-management  /room-management/transfer
"""
from fastapi import APIRouter, Request, Depends, Form, Query
from fastapi.responses import HTMLResponse, RedirectResponse, JSONResponse
from fastapi.templating import Jinja2Templates
from sqlalchemy.orm import Session

from app.db import get_db
from app.services.rooms import (
    get_all_rooms, get_room, room_summary, badge_color,
    update_room_status, ALL_STATUSES,
    STATUS_OCCUPIED, STATUS_SOON, BLOCKED_FOR_CHECKIN,
)
from app.services import stays as ssvc
from app.services import audit as _audit
from app.services.bookings import get_conflict_detail
from app.lib.i18n import get_lang, get_translations

router    = APIRouter()
templates = Jinja2Templates(directory=str(pathlib.Path(__file__).parent.parent / "templates"))


@router.get("/rooms", response_class=HTMLResponse)
async def room_overview(request: Request, db: Session = Depends(get_db)):
    lang  = get_lang(request)
    trans = get_translations(lang)
    from sqlalchemy import or_
    from app.models import Property, Booking
    from app.services.bookings import CANCELLED_STATUSES
    from datetime import datetime as _dt

    property_id = request.query_params.get("property_id", "")
    all_props   = db.query(Property).order_by(Property.id).all()
    rooms = get_all_rooms(db)
    if property_id:
        rooms = [r for r in rooms if getattr(r, "property_id", None) == property_id]

    now_str = _dt.now().strftime("%Y-%m-%d %H:%M")
    from app.models import MaintenanceSchedule

    from app.models import ActiveStay as _ActiveStay

    for r in rooms:
        # ── Check active maintenance schedule ─────────────────────────────
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
            r.status       = "維修中"
            r.maint_title  = active_maint.title
            r.maint_end    = active_maint.end_time
        else:
            r.maint_title  = None
            r.maint_end    = None

        r.badge_color = badge_color(r.status)

        # ── Dynamically compute next_booking ──────────────────────────────
        next_bk = (
            db.query(Booking)
            .filter(
                Booking.room   == r.id,
                Booking.status.notin_(CANCELLED_STATUSES),
                Booking.checkin > now_str,
            )
            .order_by(Booking.checkin)
            .first()
        )
        r.next_booking = next_bk.checkin if next_bk else None

        # ── Fee info for active stays ──────────────────────────────────────
        active_stay = db.query(_ActiveStay).filter(_ActiveStay.room == r.id).first()
        if active_stay:
            from app.services.stays import get_deposit_paid
            dep = get_deposit_paid(db, r.id)
            r.total_due    = float(active_stay.total_due)
            r.deposit_paid = dep
            r.balance_due  = max(0.0, r.total_due - dep)
        else:
            r.total_due    = None
            r.deposit_paid = None
            r.balance_due  = None
    # Recompute summary using live status (dynamic maintenance overlay)
    dynamic_summary: dict = {}
    for r in rooms:
        dynamic_summary[r.status] = dynamic_summary.get(r.status, 0) + 1

    msg = request.query_params.get("msg", "")
    return templates.TemplateResponse("rooms.html", {
        "request":     request,
        "rooms":       rooms,
        "summary":     dynamic_summary,
        "title":       trans.get("nav.rooms", "Room Overview"),
        "trans":       trans,
        "lang":        lang,
        "msg":         msg,
        "properties":  all_props,
        "property_id": property_id,
    })


@router.get("/room-management", response_class=HTMLResponse)
async def room_management(request: Request, db: Session = Depends(get_db)):
    lang  = get_lang(request)
    trans = get_translations(lang)
    from app.models import MaintenanceSchedule
    from datetime import datetime as _dt2
    now_str2 = _dt2.now().strftime("%Y-%m-%d %H:%M")

    rooms = get_all_rooms(db)
    for r in rooms:
        # Overlay active maintenance schedule on room status
        active_maint = (
            db.query(MaintenanceSchedule)
            .filter(
                MaintenanceSchedule.room_id    == r.id,
                MaintenanceSchedule.status     != "done",
                MaintenanceSchedule.start_time <= now_str2,
                MaintenanceSchedule.end_time   >  now_str2,
            )
            .first()
        )
        if active_maint:
            r.status      = "維修中"
            r.maint_title = active_maint.title
            r.maint_end   = active_maint.end_time
        else:
            r.maint_title = None
            r.maint_end   = None

        r.badge_color    = badge_color(r.status)
        r.active_stay    = ssvc.get_stay_by_room(db, r.id)
        r.free_cancel_st = (
            ssvc.free_cancel_status(r.active_stay)
            if r.active_stay else None
        )
        # Attach active monthly rental info (for 月租套房 rooms)
        from app.services import monthly as _msvc
        r.monthly = _msvc.get_active_monthly_by_room(db, r.id)
    from datetime import date as _date
    msg  = request.query_params.get("msg", "")
    err  = request.query_params.get("err", "")
    return templates.TemplateResponse("room_management.html", {
        "request":  request,
        "rooms":    rooms,
        "statuses": ALL_STATUSES,
        "title":    trans.get("room_mgmt.title", "Room Management"),
        "trans":    trans,
        "lang":     lang,
        "msg":      msg,
        "err":      trans.get(err, err) if err else "",
        "today":    _date.today().isoformat(),
    })


@router.post("/room-management/update")
async def update_room(
    request:          Request,
    room_id:          str = Form(...),
    status:           str = Form(...),
    note:             str = Form(""),
    next_booking:     str = Form(""),
    maintenance_note: str = Form(""),
    maintenance_due:  str = Form(""),
    db: Session = Depends(get_db),
):
    from urllib.parse import quote
    old_room   = get_room(db, room_id)
    old_status = old_room.status if old_room else ''

    room, err = update_room_status(
        db, room_id, status,
        note             = note or None,
        next_booking     = next_booking or None,
        maintenance_note = maintenance_note or None,
        maintenance_due  = maintenance_due  or None,
    )
    if err:
        return RedirectResponse(
            f"/room-management?err={quote(err)}", status_code=303
        )
    _audit.log_room_status(db, room_id, old_status, status, note or '')
    return RedirectResponse("/room-management?msg=updated", status_code=303)


# ── Monthly rental (月租套房) ────────────────────────────────────────────────

@router.post("/room-management/monthly/create")
async def monthly_create(
    request:       Request,
    room_id:       str   = Form(...),
    tenant_name:   str   = Form(...),
    tenant_phone:  str   = Form(""),
    start_date:    str   = Form(...),
    deposit:       float = Form(0),
    rent:          float = Form(0),
    payment_type:  str   = Form("cash"),
    note:          str   = Form(""),
    db: Session = Depends(get_db),
):
    from urllib.parse import quote
    from app.services import monthly as msvc
    cu = getattr(request.state, "current_user", None)
    rental, err = msvc.create_monthly_rental(
        db, room_id, tenant_name, tenant_phone, start_date,
        deposit, rent, payment_type=payment_type, note=note,
        created_by=cu.username if cu else "admin",
    )
    if err:
        return RedirectResponse(f"/room-management?err={quote(err)}", status_code=303)
    _audit.log_action(
        db, "monthly_create", target_id=room_id, target_type="room",
        new_value={"tenant": tenant_name, "rent": rent, "deposit": deposit,
                   "start": rental.start_date, "end": rental.end_date},
        description=f"月租建立: {room_id} {tenant_name} 租金NT${rent:.0f}/押金NT${deposit:.0f}",
        user_id=cu.username if cu else "admin",
    )
    _auto_backup(db, trigger="monthly")
    return RedirectResponse("/room-management?msg=monthly_created", status_code=303)


@router.post("/room-management/monthly/checkout")
async def monthly_checkout(
    request:        Request,
    room_id:        str   = Form(...),
    deposit_refund: float = Form(0),
    refund_type:    str   = Form("cash"),
    note:           str   = Form(""),
    db: Session = Depends(get_db),
):
    from urllib.parse import quote
    from app.services import monthly as msvc
    cu = getattr(request.state, "current_user", None)
    rental, err = msvc.end_monthly_rental(
        db, room_id, deposit_refund, refund_type=refund_type, note=note,
        created_by=cu.username if cu else "admin",
    )
    if err:
        return RedirectResponse(f"/room-management?err={quote(err)}", status_code=303)
    _audit.log_action(
        db, "monthly_checkout", target_id=room_id, target_type="room",
        new_value={"tenant": rental.tenant_name,
                   "deposit_refunded": rental.deposit_refunded},
        description=f"月租退房: {room_id} {rental.tenant_name} 退還押金NT${rental.deposit_refunded:.0f}",
        user_id=cu.username if cu else "admin",
    )
    _auto_backup(db, trigger="monthly")
    return RedirectResponse("/room-management?msg=monthly_ended", status_code=303)


# ── Transfer room API ─────────────────────────────────────────────────────

@router.get("/api/transfer-candidates")
async def transfer_candidates(
    old_room:      str = Query(...),
    db: Session = Depends(get_db),
):
    """
    Return JSON list of rooms eligible to receive a transfer from old_room.
    Filters out: old_room itself, blocked-status rooms, rooms with booking conflict.
    """
    stay = ssvc.get_stay_by_room(db, old_room)
    if not stay:
        return JSONResponse({"rooms": [], "error": "error.stay_not_found"})

    all_rooms = get_all_rooms(db)
    candidates = []
    for r in all_rooms:
        if r.id == old_room:
            continue
        if r.status in BLOCKED_FOR_CHECKIN or r.status == STATUS_OCCUPIED or r.status == STATUS_SOON:
            continue
        # Conflict check
        conflict = None
        if stay.checkin_time and stay.checkout_time:
            conflict = get_conflict_detail(db, r.id, stay.checkin_time, stay.checkout_time)
        from app.services.rooms import STATUS_LABEL_I18N
        candidates.append({
            "id":           r.id,
            "status":       r.status,
            "statusLabel":  STATUS_LABEL_I18N.get(r.status, r.status),
            "note":         r.note or "",
            "next_booking": r.next_booking or "",
            "conflict":     conflict is not None,
            "conflict_id":  conflict["id"] if conflict else None,
        })

    return JSONResponse({"rooms": candidates, "error": None})


@router.post("/room-management/transfer")
async def do_transfer(
    request:     Request,
    old_room_id: str = Form(...),
    new_room_id: str = Form(...),
    db: Session = Depends(get_db),
):
    from urllib.parse import quote
    new_stay, err_key = ssvc.transfer_room(db, old_room_id, new_room_id)
    if not err_key:
        stay_guest = new_stay.guest if new_stay else ''
        _audit.log_room_transfer(db, old_room_id, new_room_id, stay_guest)
    if err_key:
        return RedirectResponse(
            f"/room-management?err={quote(err_key)}", status_code=303
        )
    return RedirectResponse(
        f"/room-management?msg=transferred&from={old_room_id}&to={new_room_id}",
        status_code=303,
    )


# ── Gantt chart ────────────────────────────────────────────────────────────────

@router.get("/gantt", response_class=HTMLResponse)
async def gantt_page(request: Request, db: Session = Depends(get_db)):
    import json as _json
    from datetime import datetime, timedelta
    from app.models import Booking, MaintenanceSchedule

    lang  = get_lang(request)
    trans = get_translations(lang)

    # 7-day window: today 00:00 → today+8 00:00
    now   = datetime.now()
    start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    end   = start + timedelta(days=8)
    start_s = start.strftime("%Y-%m-%d %H:%M")
    end_s   = end.strftime("%Y-%m-%d %H:%M")

    rooms = get_all_rooms(db)

    # Active stays / bookings in window
    from app.services.bookings import CANCELLED_STATUSES
    from app.models import ActiveStay

    bookings = db.query(Booking).filter(
        Booking.status.notin_(CANCELLED_STATUSES),
        Booking.checkin  < end_s,
        Booking.checkout > start_s,
    ).all()

    # ActiveStay uses checkin_time / checkout_time columns
    active_stays = db.query(ActiveStay).filter(
        ActiveStay.checkin_time < end_s,
    ).all()

    maint = db.query(MaintenanceSchedule).filter(
        MaintenanceSchedule.status != "done",
        MaintenanceSchedule.start_time < end_s,
        MaintenanceSchedule.end_time   > start_s,
    ).all()

    # Serialize for JS
    bk_data = [{"room": b.room, "guest": b.guest,
                "start": b.checkin, "end": b.checkout, "type": "booking"}
               for b in bookings]
    stay_data = [{"room": a.room, "guest": a.guest,
                  "start": a.checkin_time or start_s,
                  "end":   a.checkout_time or end_s,
                  "type":  "stay"}
                 for a in active_stays
                 if a.checkin_time]
    # Scheduled maintenance from maintenance_schedules table
    maint_data = [{"room": m.room_id, "guest": m.title,
                   "start": m.start_time, "end": m.end_time, "type": "maintenance"}
                  for m in maint]

    # Also add rooms with status=維修中 (manually set, no schedule)
    sched_rooms = {m.room_id for m in maint}
    for r in rooms:
        if r.status == "維修中" and r.id not in sched_rooms:
            maint_data.append({
                "room":  r.id,
                "guest": r.maintenance_note or "維修中",
                "start": start_s,
                "end":   end_s,
                "type":  "maintenance",
            })

    room_ids = [r.id for r in rooms]

    return templates.TemplateResponse("gantt.html", {
        "request":    request,
        "rooms":      rooms,
        "room_ids_json":  _json.dumps(room_ids),
        "events_json":    _json.dumps(bk_data + stay_data + maint_data),
        "start_ts":   start.timestamp() * 1000,
        "end_ts":     end.timestamp()   * 1000,
        "start_s":    start_s,
        "end_s":      end_s,
        "title":      trans.get("gantt.title", "Room Gantt"),
        "trans":      trans,
        "lang":       lang,
    })


# ── Checkout-soon notification API ───────────────────────────────────────────

@router.get("/api/checkout-soon")
async def checkout_soon(request: Request, db: Session = Depends(get_db)):
    """
    Returns list of active stays where checkout is within 15 minutes.
    Called every 60 seconds by base.html JS for notification.
    """
    from fastapi.responses import JSONResponse
    from app.models import ActiveStay
    from datetime import datetime, timedelta

    now     = datetime.now()
    warn_dt = now + timedelta(minutes=15)
    warn_s  = warn_dt.strftime("%Y-%m-%d %H:%M")
    now_s   = now.strftime("%Y-%m-%d %H:%M")

    stays = db.query(ActiveStay).filter(
        ActiveStay.checkout_time.isnot(None),
        ActiveStay.checkout_time >  now_s,    # not yet overdue
        ActiveStay.checkout_time <= warn_s,   # within 15 min
    ).all()

    result = []
    for s in stays:
        co_dt   = datetime.strptime(s.checkout_time[:16], "%Y-%m-%d %H:%M")
        mins_left = int((co_dt - now).total_seconds() / 60)
        result.append({
            "room":       s.room,
            "guest":      s.guest,
            "checkout":   s.checkout_time[:16],
            "mins_left":  mins_left,
        })

    return JSONResponse({"soon": result})

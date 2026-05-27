import pathlib
"""
routers/phase4.py — Phase-4: payments, exports, housekeeping, maintenance, properties.
All routes require login. Role restrictions enforced per endpoint.
"""
from datetime import date
from fastapi import APIRouter, Request, Depends, Form, Query
from fastapi.responses import HTMLResponse, RedirectResponse, Response
from fastapi.templating import Jinja2Templates
from sqlalchemy.orm import Session

from app.db import get_db
from app.services import auth as auth_svc
from app.services import payments as pay_svc
from app.services import exports as exp_svc
from app.services import audit as audit_svc
from app.services.rooms import get_all_rooms, get_room, update_room_status
from app.lib.i18n import get_lang, get_translations

router    = APIRouter()
templates = Jinja2Templates(directory=str(pathlib.Path(__file__).parent.parent / "templates"))

MANAGERS = ["admin", "manager"]
FRONT    = ["admin", "manager", "front_desk"]
HK       = ["admin", "manager", "housekeeping"]
MAINT    = ["admin", "manager", "maintenance"]


def _user(request, db):
    return auth_svc.get_current_user(request, db)


def _forbidden(request, db):
    return RedirectResponse("/login?err=auth.forbidden", status_code=303)


# ═══ PAYMENTS ════════════════════════════════════════════════════════════

@router.get("/payments", response_class=HTMLResponse)
async def payments_page(
    request: Request,
    date_from: str = Query(default=None),
    date_to:   str = Query(default=None),
    room_id:   str = Query(default=None),
    db: Session = Depends(get_db),
):
    user = _user(request, db)
    if not auth_svc.require_role(user, *FRONT): return _forbidden(request, db)
    lang  = get_lang(request)
    trans = get_translations(lang)

    today     = date.today().strftime("%Y-%m-%d")
    date_from = date_from or today
    date_to   = date_to   or today
    payments  = pay_svc.get_payments(db, room_id=room_id or None,
                                     date_from=date_from, date_to=date_to)
    summary   = pay_svc.daily_summary(db, today)

    return templates.TemplateResponse("payments.html", {
        "request":    request,
        "payments":   payments,
        "summary":    summary,
        "date_from":  date_from,
        "date_to":    date_to,
        "room_id":    room_id or "",
        "pay_types":  pay_svc.PAYMENT_TYPES,
        "current_user": user,
        "title":      trans.get("payment.title", "Payments"),
        "trans":      trans,
        "lang":       lang,
        "msg":        request.query_params.get("msg", ""),
        "err":        request.query_params.get("err", ""),
    })


@router.post("/payments/add")
async def add_payment(
    request:      Request,
    booking_id:   str = Form(""),
    room_id:      str = Form(""),
    guest:        str = Form(""),
    payment_type: str = Form("cash"),
    amount:       float = Form(0),
    is_deposit:   str = Form("0"),
    is_refund:    str = Form("0"),
    note:         str = Form(""),
    db: Session = Depends(get_db),
):
    user = _user(request, db)
    if not auth_svc.require_role(user, *FRONT): return _forbidden(request, db)

    p = pay_svc.create_payment(
        db, booking_id or None, room_id or None, guest,
        payment_type, amount,
        is_deposit = is_deposit == "1",
        is_refund  = is_refund  == "1",
        created_by = user.username if user else "admin",
    )
    # Audit log now written at service layer (payments.create_payment)
    return RedirectResponse("/payments?msg=payment_added", status_code=303)


@router.post("/payments/delete/{payment_id}")
async def delete_payment(
    request:    Request,
    payment_id: int,
    db: Session = Depends(get_db),
):
    """Admin-only: delete a payment record."""
    user = _user(request, db)
    if not auth_svc.require_role(user, "admin"):
        return _forbidden(request, db)

    from app.models import Payment
    pay = db.query(Payment).filter(Payment.id == payment_id).first()
    if pay:
        db.delete(pay)
        db.commit()
        audit_svc.log_action(db, "payment_delete",
            target_id=str(payment_id), target_type="payment",
            description=f"Payment #{payment_id} deleted by admin",
            user_id=user.username if user else "admin")

    return RedirectResponse("/payments?msg=deleted", status_code=303)


@router.post("/cashier/close")
async def close_cashier(
    request: Request,
    note:    str = Form(""),
    db: Session = Depends(get_db),
):
    user = _user(request, db)
    if not auth_svc.require_role(user, *MANAGERS): return _forbidden(request, db)
    session = pay_svc.close_session(db, closed_by=user.username if user else "admin", note=note)
    audit_svc.log_action(db, "cashier_close",
        target_type = "cashier",
        new_value   = {"date": session.session_date, "net": session.total_expected - session.total_refunds},
        description = f"Cashier closed: {session.session_date}",
        user_id     = user.username if user else "admin",
    )
    return RedirectResponse("/payments?msg=session_closed", status_code=303)


# ═══ EXPORTS ═════════════════════════════════════════════════════════════

@router.get("/export/{data_type}")
async def export_data(
    request:   Request,
    data_type: str,
    date_from: str = Query(default=None),
    date_to:   str = Query(default=None),
    db: Session = Depends(get_db),
):
    user = _user(request, db)
    if not auth_svc.require_role(user, *MANAGERS): return _forbidden(request, db)
    lang  = get_lang(request)
    trans = get_translations(lang)

    today = date.today().strftime("%Y-%m-%d")
    df    = date_from or today[:7] + "-01"  # month start
    dt    = date_to   or today

    dispatch = {
        "bookings":       (exp_svc.export_bookings,       f"bookings_{df}_{dt}.csv"),
        "stays":          (exp_svc.export_stays,           f"stays_{df}_{dt}.csv"),
        "payments":       (exp_svc.export_payments,        f"payments_{df}_{dt}.csv"),
        "daily_summary":  (exp_svc.export_daily_summary,   f"daily_summary_{df}_{dt}.csv"),
        "activity_logs":  (exp_svc.export_activity_logs,   f"activity_logs_{df}_{dt}.csv"),
    }

    if data_type not in dispatch:
        return Response("Unknown export type", status_code=400)

    fn, filename = dispatch[data_type]
    csv_bytes = fn(db, date_from=df, date_to=dt)

    audit_svc.log_report_export(db, df, dt)

    return Response(
        content    = csv_bytes,
        media_type = "text/csv; charset=utf-8-sig",
        headers    = {"Content-Disposition": f"attachment; filename={filename}"},
    )


# ═══ HOUSEKEEPING ════════════════════════════════════════════════════════

@router.get("/housekeeping", response_class=HTMLResponse)
async def housekeeping_page(request: Request, db: Session = Depends(get_db)):
    user = _user(request, db)
    if not auth_svc.require_role(user, *HK): return _forbidden(request, db)
    lang  = get_lang(request)
    trans = get_translations(lang)
    rooms = get_all_rooms(db)
    for r in rooms:
        from app.services.rooms import badge_color
        r.badge_color = badge_color(r.status)
    pending = [r for r in rooms if r.status in ("待清潔", "清潔中")]
    return templates.TemplateResponse("housekeeping.html", {
        "request":       request,
        "rooms":         rooms,
        "rooms_pending": pending,
        "current_user":  user,
        "title":         trans.get("housekeeping.title", "Housekeeping"),
        "trans":         trans,
        "lang":          lang,
        "msg":           request.query_params.get("msg", ""),
    })


@router.post("/housekeeping/update")
async def housekeeping_update(
    request: Request,
    room_id: str  = Form(...),
    status:  str  = Form(...),
    db: Session = Depends(get_db),
):
    user = _user(request, db)
    if not auth_svc.require_role(user, *HK): return _forbidden(request, db)
    old_room = get_room(db, room_id)
    old_status = old_room.status if old_room else ""
    update_room_status(db, room_id, status)  # returns (room, err), ignore err for HK
    audit_svc.log_room_status(db, room_id, old_status, status,
                               user_id=user.username if user else "admin")
    from app.services.backup import auto_backup as _ab_hk
    _ab_hk(db, trigger="housekeeping")
    return RedirectResponse("/housekeeping?msg=updated", status_code=303)


# ═══ MAINTENANCE ═════════════════════════════════════════════════════════

@router.get("/maintenance", response_class=HTMLResponse)
async def maintenance_page(request: Request, db: Session = Depends(get_db)):
    user = _user(request, db)
    if not auth_svc.require_role(user, *MAINT): return _forbidden(request, db)
    lang  = get_lang(request)
    trans = get_translations(lang)
    rooms = get_all_rooms(db)
    maint_rooms = [r for r in rooms if r.status == "維修中"]
    from app.services.maintenance import get_schedules
    schedules = get_schedules(db)
    msg = request.query_params.get("msg", "")
    err = request.query_params.get("err", "")
    return templates.TemplateResponse("maintenance.html", {
        "request":           request,
        "rooms":             rooms,
        "rooms_maintenance": maint_rooms,
        "schedules":         schedules,
        "today":             date.today().strftime("%Y-%m-%d"),
        "current_user":      user,
        "title":             trans.get("maintenance.title", "Maintenance"),
        "trans":             trans,
        "lang":              lang,
        "msg":               msg,
        "err":               trans.get(err, err) if err else "",
    })


@router.post("/maintenance/update")
async def maintenance_update(
    request:          Request,
    room_id:          str = Form(...),
    action:           str = Form("update_note"),
    maintenance_note: str = Form(""),
    db: Session = Depends(get_db),
):
    user = _user(request, db)
    if not auth_svc.require_role(user, *MAINT): return _forbidden(request, db)
    room = get_room(db, room_id)
    if not room:
        return RedirectResponse("/maintenance", status_code=303)

    if action == "resolve":
        old_status = room.status
        update_room_status(db, room_id, "可入住")  # returns (room, err)
        audit_svc.log_room_status(db, room_id, old_status, "可入住",
                                   note="Resolved by maintenance",
                                   user_id=user.username if user else "admin")
    else:
        if maintenance_note.strip():
            room.maintenance_note = maintenance_note.strip()
            db.commit()
        audit_svc.log_action(db, "maintenance_update", target_id=room_id,
                              target_type="room",
                              new_value={"note": maintenance_note},
                              description=f"Maintenance note updated: {room_id}",
                              user_id=user.username if user else "admin")

    from app.services.backup import auto_backup as _ab_mt
    _ab_mt(db, trigger="maintenance")
    return RedirectResponse("/maintenance?msg=updated", status_code=303)


# ── Maintenance Schedule CRUD ─────────────────────────────────────────────

@router.post("/maintenance/schedule/create")
async def maintenance_schedule_create(
    request:    Request,
    room_id:    str = Form(...),
    title:      str = Form(...),
    start_time: str = Form(...),
    end_time:   str = Form(...),
    note:       str = Form(""),
    db: Session = Depends(get_db),
):
    user = _user(request, db)
    if not auth_svc.require_role(user, *MAINT): return _forbidden(request, db)
    from app.services.maintenance import create_schedule
    ms, err = create_schedule(db, room_id, title,
                               start_time.replace("T"," ")[:16],
                               end_time.replace("T"," ")[:16],
                               note,
                               created_by=user.username if user else "admin")
    if err:
        return RedirectResponse(f"/maintenance?err={err}", status_code=303)
    audit_svc.log_action(db, "maintenance_schedule_create",
        target_id=str(ms.id), target_type="maintenance_schedule",
        new_value={"room_id": room_id, "start": ms.start_time, "end": ms.end_time},
        description=f"Maintenance scheduled: {room_id} {ms.start_time}~{ms.end_time}",
        user_id=user.username if user else "admin")
    return RedirectResponse("/maintenance?msg=schedule_created", status_code=303)


@router.post("/maintenance/schedule/{schedule_id}/delete")
async def maintenance_schedule_delete(
    request:     Request,
    schedule_id: int,
    db: Session = Depends(get_db),
):
    user = _user(request, db)
    if not auth_svc.require_role(user, *MAINT): return _forbidden(request, db)
    from app.services.maintenance import delete_schedule
    delete_schedule(db, schedule_id)
    audit_svc.log_action(db, "maintenance_schedule_delete",
        target_id=str(schedule_id), target_type="maintenance_schedule",
        description=f"Maintenance schedule deleted: #{schedule_id}",
        user_id=user.username if user else "admin")
    return RedirectResponse("/maintenance?msg=schedule_deleted", status_code=303)


@router.post("/maintenance/schedule/{schedule_id}/done")
async def maintenance_schedule_done(
    request:     Request,
    schedule_id: int,
    db: Session = Depends(get_db),
):
    user = _user(request, db)
    if not auth_svc.require_role(user, *MAINT): return _forbidden(request, db)
    from app.services.maintenance import update_schedule
    update_schedule(db, schedule_id, status="done")
    audit_svc.log_action(db, "maintenance_schedule_done",
        target_id=str(schedule_id), target_type="maintenance_schedule",
        description=f"Maintenance schedule completed: #{schedule_id}",
        user_id=user.username if user else "admin")
    from app.services.backup import auto_backup as _ab_msd
    _ab_msd(db, trigger="maintenance")
    return RedirectResponse("/maintenance?msg=schedule_done", status_code=303)


# ═══ PROPERTIES (multi-property) ══════════════════════════════════════════

@router.get("/properties", response_class=HTMLResponse)
async def properties_page(request: Request, db: Session = Depends(get_db)):
    user = _user(request, db)
    if not auth_svc.require_role(user, "admin"): return _forbidden(request, db)
    lang  = get_lang(request)
    trans = get_translations(lang)
    from app.models import Property
    props = db.query(Property).order_by(Property.id).all()
    return templates.TemplateResponse("properties.html", {
        "request":      request,
        "properties":   props,
        "current_user": user,
        "title":        trans.get("property.title", "Properties"),
        "trans":        trans,
        "lang":         lang,
        "msg":          request.query_params.get("msg", ""),
    })


@router.post("/properties/create")
async def create_property(
    request: Request,
    prop_id: str   = Form(...),
    name:    str   = Form(...),
    address: str   = Form(""),
    phone:   str   = Form(""),
    note:    str   = Form(""),
    db: Session = Depends(get_db),
):
    user = _user(request, db)
    if not auth_svc.require_role(user, "admin"): return _forbidden(request, db)
    from app.models import Property
    from datetime import datetime
    prop = Property(
        id=prop_id, name=name, address=address or None,
        phone=phone or None, note=note or None,
        created_at=datetime.now().strftime("%Y-%m-%d %H:%M"),
    )
    db.add(prop)
    db.commit()
    audit_svc.log_action(db, "property_create", target_id=prop_id,
                          target_type="property", new_value={"name": name},
                          description=f"Created property: {prop_id} {name}",
                          user_id=user.username if user else "admin")
    return RedirectResponse("/properties?msg=created", status_code=303)

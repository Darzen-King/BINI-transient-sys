import pathlib
"""
routers/costs.py — /costs  (Admin only)
"""
from datetime import date
from fastapi import APIRouter, Request, Depends, Form, Query
from fastapi.responses import HTMLResponse, RedirectResponse
from fastapi.templating import Jinja2Templates
from sqlalchemy.orm import Session
from urllib.parse import quote

from app.db import get_db
from app.services import auth as auth_svc
from app.services import costs as cost_svc
from app.services import audit as audit_svc
from app.lib.i18n import get_lang, get_translations

router    = APIRouter()
templates = Jinja2Templates(directory=str(pathlib.Path(__file__).parent.parent / "templates"))

_ADMIN = ("admin",)


def _guard(request: Request, db: Session):
    """Return current user or None. Caller checks role."""
    return auth_svc.get_current_user(request, db)


def _forbidden(request: Request, db: Session):
    return RedirectResponse("/login?err=auth.forbidden", status_code=303)


# ── Main page ─────────────────────────────────────────────────────────────────

@router.get("/costs", response_class=HTMLResponse)
async def costs_page(
    request:        Request,
    year_month:     str = Query(default=""),
    category:       str = Query(default=""),
    property_id:    str = Query(default=""),
    payment_method: str = Query(default=""),
    db: Session = Depends(get_db),
):
    user = _guard(request, db)
    if not auth_svc.require_role(user, *_ADMIN):
        return _forbidden(request, db)

    lang  = get_lang(request)
    trans = get_translations(lang)

    today      = date.today()
    cur_month  = year_month or today.strftime("%Y-%m")
    months     = cost_svc.available_months(db, 24)

    costs = cost_svc.get_costs(
        db,
        year_month     = cur_month,
        category       = category  or None,
        property_id    = property_id or None,
        payment_method = payment_method or None,
    )
    pnl = cost_svc.monthly_pnl(db, cur_month, property_id or None)

    from app.models import Property
    properties = db.query(Property).order_by(Property.id).all()

    msg = request.query_params.get("msg", "")
    err = request.query_params.get("err", "")

    return templates.TemplateResponse("costs.html", {
        "request":        request,
        "costs":          costs,
        "pnl":            pnl,
        "cur_month":      cur_month,
        "months":         months,
        "category":       category,
        "property_id":    property_id,
        "payment_method": payment_method,
        "categories":     cost_svc.COST_CATEGORIES,
        "pay_methods":    cost_svc.PAYMENT_METHODS,
        "properties":     properties,
        "current_user":   user,
        "title":          trans.get("costs.title", "Costs"),
        "trans":          trans,
        "lang":           lang,
        "msg":            msg,
        "err":            trans.get(err, err) if err else "",
    })


# ── Create ────────────────────────────────────────────────────────────────────

@router.post("/costs/create")
async def create_cost(
    request:        Request,
    cost_date:      str   = Form(...),
    category:       str   = Form(...),
    subcategory:    str   = Form(""),
    amount:         float = Form(...),
    payment_method: str   = Form("cash"),
    vendor:         str   = Form(""),
    description:    str   = Form(""),
    note:           str   = Form(""),
    is_recurring:   str   = Form("0"),
    receipt_no:     str   = Form(""),
    property_id:    str   = Form(""),
    db: Session = Depends(get_db),
):
    user = _guard(request, db)
    if not auth_svc.require_role(user, *_ADMIN):
        return _forbidden(request, db)

    entry = cost_svc.create_cost(
        db,
        cost_date      = cost_date,
        category       = category,
        subcategory    = subcategory,
        amount         = amount,
        payment_method = payment_method,
        vendor         = vendor,
        description    = description,
        note           = note,
        is_recurring   = is_recurring == "1",
        receipt_no     = receipt_no,
        property_id    = property_id,
        created_by     = user.username if user else "admin",
    )

    audit_svc.log_action(db,
        action_type = "cost_create",
        target_id   = str(entry.id),
        target_type = "cost",
        new_value   = {
            "date": cost_date, "category": category,
            "amount": amount, "vendor": vendor,
        },
        description = f"Cost created: {category} NT${amount:.0f} ({cost_date})",
        user_id     = user.username if user else "admin",
    )

    ym = cost_date[:7]  # "YYYY-MM"
    return RedirectResponse(f"/costs?year_month={ym}&msg=created", status_code=303)


# ── Edit ──────────────────────────────────────────────────────────────────────

@router.post("/costs/{entry_id}/edit")
async def edit_cost(
    request:        Request,
    entry_id:       int,
    cost_date:      str   = Form(...),
    category:       str   = Form(...),
    subcategory:    str   = Form(""),
    amount:         float = Form(...),
    payment_method: str   = Form("cash"),
    vendor:         str   = Form(""),
    description:    str   = Form(""),
    note:           str   = Form(""),
    is_recurring:   str   = Form("0"),
    receipt_no:     str   = Form(""),
    property_id:    str   = Form(""),
    db: Session = Depends(get_db),
):
    user = _guard(request, db)
    if not auth_svc.require_role(user, *_ADMIN):
        return _forbidden(request, db)

    old = cost_svc.get_cost_by_id(db, entry_id)
    old_snapshot = {
        "category": old.category, "amount": old.amount
    } if old else {}

    entry = cost_svc.update_cost(
        db, entry_id,
        cost_date      = cost_date,
        category       = category,
        subcategory    = subcategory or None,
        amount         = abs(float(amount)),
        payment_method = payment_method,
        vendor         = vendor or None,
        description    = description or None,
        note           = note or None,
        is_recurring   = 1 if is_recurring == "1" else 0,
        receipt_no     = receipt_no or None,
        property_id    = property_id or None,
    )

    if entry:
        audit_svc.log_action(db,
            action_type    = "cost_edit",
            target_id      = str(entry_id),
            target_type    = "cost",
            original_value = old_snapshot,
            new_value      = {"category": category, "amount": amount},
            description    = f"Cost edited: #{entry_id} {category} NT${amount:.0f}",
            user_id        = user.username if user else "admin",
        )

    ym = cost_date[:7]
    return RedirectResponse(f"/costs?year_month={ym}&msg=updated", status_code=303)


# ── Delete ────────────────────────────────────────────────────────────────────

@router.post("/costs/{entry_id}/delete")
async def delete_cost(
    request:  Request,
    entry_id: int,
    db: Session = Depends(get_db),
):
    user = _guard(request, db)
    if not auth_svc.require_role(user, *_ADMIN):
        return _forbidden(request, db)

    entry = cost_svc.get_cost_by_id(db, entry_id)
    snapshot = {
        "category": entry.category if entry else "",
        "amount":   entry.amount   if entry else 0,
        "date":     entry.cost_date if entry else "",
    }
    ym = entry.cost_date[:7] if entry else ""

    cost_svc.delete_cost(db, entry_id)

    audit_svc.log_action(db,
        action_type    = "cost_delete",
        target_id      = str(entry_id),
        target_type    = "cost",
        original_value = snapshot,
        description    = f"Cost deleted: #{entry_id}",
        user_id        = user.username if user else "admin",
    )

    return RedirectResponse(f"/costs?year_month={ym}&msg=deleted", status_code=303)


# ── API: get single entry for edit modal ──────────────────────────────────────

@router.get("/api/costs/{entry_id}")
async def get_cost_api(
    request:  Request,
    entry_id: int,
    db: Session = Depends(get_db),
):
    from fastapi.responses import JSONResponse
    user = _guard(request, db)
    if not auth_svc.require_role(user, *_ADMIN):
        return JSONResponse({"error": "forbidden"}, status_code=403)
    entry = cost_svc.get_cost_by_id(db, entry_id)
    if not entry:
        return JSONResponse({"error": "not found"}, status_code=404)
    return JSONResponse({
        "id":             entry.id,
        "cost_date":      entry.cost_date,
        "category":       entry.category,
        "subcategory":    entry.subcategory or "",
        "amount":         entry.amount,
        "payment_method": entry.payment_method,
        "vendor":         entry.vendor or "",
        "description":    entry.description or "",
        "note":           entry.note or "",
        "is_recurring":   entry.is_recurring,
        "receipt_no":     entry.receipt_no or "",
        "property_id":    entry.property_id or "",
    })

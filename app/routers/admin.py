import pathlib
"""
routers/admin.py — /admin/audit  (Audit Trail viewer)
Phase-3 Task 2.
"""
from fastapi import APIRouter, Request, Depends, Query, Form
from fastapi.responses import HTMLResponse, RedirectResponse
from fastapi.templating import Jinja2Templates
from sqlalchemy.orm import Session

from app.db import get_db
from app.services import audit as audit_svc
from app.services import auth as auth_svc
from app.lib.i18n import get_lang, get_translations

router    = APIRouter()
templates = Jinja2Templates(directory=str(pathlib.Path(__file__).parent.parent / "templates"))

PAGE_SIZE = 50


@router.get("/admin/audit", response_class=HTMLResponse)
async def audit_log_page(
    request:     Request,
    action_type: str = Query(default=""),
    target_id:   str = Query(default=""),
    keyword:     str = Query(default=""),
    page:        int = Query(default=1, ge=1),
    db: Session = Depends(get_db),
):
    lang  = get_lang(request)
    trans = get_translations(lang)

    # Role guard: manager / admin only
    from app.services.auth import get_current_user, require_role
    _cu = get_current_user(request, db)
    if not require_role(_cu, "manager", "admin"):
        return RedirectResponse("/login?err=auth.forbidden", status_code=303)

    offset = (page - 1) * PAGE_SIZE
    logs, total = audit_svc.get_logs(
        db,
        action_type = action_type or None,
        target_id   = target_id   or None,
        keyword     = keyword     or None,
        limit       = PAGE_SIZE,
        offset      = offset,
    )

    total_pages = max(1, (total + PAGE_SIZE - 1) // PAGE_SIZE)

    return templates.TemplateResponse("audit.html", {
        "request":     request,
        "logs":        logs,
        "total":       total,
        "page":        page,
        "total_pages": total_pages,
        "page_size":   PAGE_SIZE,
        "action_type": action_type,
        "target_id":   target_id,
        "keyword":     keyword,
        "action_types": audit_svc.ALL_ACTION_TYPES,
        "action_labels": audit_svc.ACTION_LABELS,
        "action_icon":   audit_svc.ACTION_ICON,
        "title":       trans.get("audit.title", "Audit Trail"),
        "trans":       trans,
        "lang":        lang,
    })


# ── Holiday Management ────────────────────────────────────────────────────────

@router.get("/admin/holidays", response_class=HTMLResponse)
async def holidays_page(
    request: Request,
    year: int = 0,
    db: Session = Depends(get_db),
):
    lang  = get_lang(request)
    trans = get_translations(lang)
    cu    = auth_svc.get_current_user(request, db)
    if not auth_svc.require_role(cu, "admin", "manager"):
        return RedirectResponse("/login?err=auth.forbidden", status_code=303)

    if not year:
        from datetime import date
        year = date.today().year

    from app.models import HolidayCache
    holidays = (
        db.query(HolidayCache)
        .filter(HolidayCache.year == year)
        .order_by(HolidayCache.date)
        .all()
    )
    years_available = list(range(2025, year + 3))

    # Build plain dict for JS (avoids json serialization of ORM objects)
    holiday_map = {
        h.date: {
            "desc":   h.description or "",
            "manual": h.is_manual or 0,
            "source": h.source or "",
            "id":     h.id,
        }
        for h in holidays
    }

    return templates.TemplateResponse("holidays.html", {
        "request":     request,
        "holidays":    holidays,
        "holiday_map": holiday_map,
        "year":        year,
        "years":       years_available,
        "title":       trans.get("nav.holidays", "假日管理"),
        "trans":       trans,
        "lang":        lang,
        "cu":          cu,
    })


@router.post("/admin/holidays/add")
async def add_holiday(
    request: Request,
    date:        str = Form(...),
    description: str = Form(""),
    db: Session = Depends(get_db),
):
    cu = auth_svc.get_current_user(request, db)
    if not auth_svc.require_role(cu, "admin", "manager"):
        return RedirectResponse("/login?err=auth.forbidden", status_code=303)

    from app.models import HolidayCache
    from datetime import datetime as _dt
    existing = db.query(HolidayCache).filter(HolidayCache.date == date).first()
    if existing:
        existing.description = description
        existing.is_holiday  = 1
        existing.is_manual   = 1
        existing.source      = "manual"
        existing.updated_at  = _dt.now().strftime("%Y-%m-%d %H:%M")
    else:
        db.add(HolidayCache(
            date        = date,
            description = description or "手動新增",
            is_holiday  = 1,
            is_manual   = 1,
            year        = int(date[:4]),
            source      = "manual",
            updated_at  = _dt.now().strftime("%Y-%m-%d %H:%M"),
        ))
    db.commit()
    year = date[:4]
    return RedirectResponse(f"/admin/holidays?year={year}&msg=added", status_code=303)


@router.post("/admin/holidays/delete/{holiday_id}")
async def delete_holiday(
    request:    Request,
    holiday_id: int,
    db: Session = Depends(get_db),
):
    cu = auth_svc.get_current_user(request, db)
    if not auth_svc.require_role(cu, "admin", "manager"):
        return RedirectResponse("/login?err=auth.forbidden", status_code=303)

    from app.models import HolidayCache
    row = db.query(HolidayCache).filter(HolidayCache.id == holiday_id).first()
    year = row.year if row else ""
    if row:
        db.delete(row)
        db.commit()
    return RedirectResponse(f"/admin/holidays?year={year}&msg=deleted", status_code=303)


@router.post("/admin/holidays/resync")
async def resync_holidays(
    request: Request,
    year:    int = Form(0),
    db: Session = Depends(get_db),
):
    """Force re-fetch from government API (clears API entries, keeps manual)."""
    cu = auth_svc.get_current_user(request, db)
    if not auth_svc.require_role(cu, "admin", "manager"):
        return RedirectResponse("/login?err=auth.forbidden", status_code=303)

    from app.models import HolidayCache
    from datetime import date as _date
    if not year:
        year = _date.today().year
    # Delete non-manual entries for this year
    db.query(HolidayCache).filter(
        HolidayCache.year     == year,
        HolidayCache.is_manual == 0,
    ).delete()
    db.commit()

    from app.services.holiday_sync import sync_holidays
    result = sync_holidays(db, years=[year])
    return RedirectResponse(f"/admin/holidays?year={year}&msg=resynced", status_code=303)

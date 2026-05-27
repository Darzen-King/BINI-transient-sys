import pathlib
"""
routers/reports.py — /reports  /reports/export.csv
Phase-3: chart data, CSV export endpoint.
"""
from datetime import datetime
from fastapi import APIRouter, Request, Depends, Query
from fastapi.responses import HTMLResponse, Response
from fastapi.templating import Jinja2Templates
from sqlalchemy.orm import Session

from app.db import get_db
from app.services.reports import compute_report, today_range, export_csv
from app.services.payments import daily_summary as pay_daily_summary
from app.services import audit as _audit
from app.services.backup   import get_backup_state, get_backup_logs
from app.lib.i18n import get_lang, get_translations

router    = APIRouter()
templates = Jinja2Templates(directory=str(pathlib.Path(__file__).parent.parent / "templates"))


@router.get("/reports", response_class=HTMLResponse)
async def reports_page(
    request:   Request,
    date_from: str = Query(default=None),
    date_to:   str = Query(default=None),
    db: Session = Depends(get_db),
):
    lang  = get_lang(request)
    trans = get_translations(lang)

    # Role guard: manager / admin only
    from app.services.auth import get_current_user, require_role
    _cu = get_current_user(request, db)
    if not require_role(_cu, "manager", "admin"):
        return RedirectResponse("/login?err=auth.forbidden", status_code=303)

    default_from, default_to = today_range()
    date_from = date_from or default_from
    date_to   = date_to   or default_to

    property_id = request.query_params.get("property_id", "")
    from app.models import Property as _Prop
    all_properties = db.query(_Prop).order_by(_Prop.id).all()
    report = compute_report(db, date_from, date_to, property_id=property_id or None)
    backup = get_backup_state(db)
    logs   = get_backup_logs(db, limit=3)

    pay_summary = pay_daily_summary(db, date_to)

    return templates.TemplateResponse("reports.html", {
        "request":   request,
        "report":    report,
        "date_from": date_from,
        "date_to":   date_to,
        "backup":    backup,
        "logs":        logs,
        "pay_summary":  pay_summary,
        "properties":   all_properties,
        "property_id":  property_id,
        "title":     trans.get("report.title", "Reports"),
        "trans":     trans,
        "lang":      lang,
    })


@router.get("/reports/export.csv")
async def export_csv_endpoint(
    request:   Request,
    date_from: str = Query(default=None),
    date_to:   str = Query(default=None),
    db: Session = Depends(get_db),
):
    from app.services.auth import get_current_user, require_role
    _cu = get_current_user(request, db)
    if not require_role(_cu, "manager", "admin"):
        return RedirectResponse("/login?err=auth.forbidden", status_code=303)
    default_from, default_to = today_range()
    date_from = date_from or default_from
    date_to   = date_to   or default_to

    _audit.log_report_export(db, date_from, date_to)
    csv_bytes = export_csv(db, date_from, date_to)
    filename  = f"bini_blooms_report_{date_from}_{date_to}.csv"

    return Response(
        content     = csv_bytes,
        media_type  = "text/csv; charset=utf-8-sig",
        headers     = {"Content-Disposition": f"attachment; filename={filename}"},
    )

import pathlib
"""
routers/hub.py — Prototype Hub ( / ) with operational alerts.
Phase-3 Task 3: pass room alerts and backup status to homepage.
"""
from fastapi import APIRouter, Request, Depends
from fastapi.responses import HTMLResponse
from fastapi.templating import Jinja2Templates
from sqlalchemy.orm import Session
from datetime import datetime, date

from app.db import get_db
from app.models import Room, BackupState, BackupLog
from app.lib.i18n import get_lang, get_translations, t as _t

router    = APIRouter()
templates = Jinja2Templates(directory=str(pathlib.Path(__file__).parent.parent / "templates"))

PAGES = [
    {"key": "nav.rooms",           "url": "/rooms",           "icon": "🏨"},
    {"key": "nav.bookings",        "url": "/bookings",        "icon": "📋"},
    {"key": "nav.bookings_new",    "url": "/bookings/new",    "icon": "➕"},
    {"key": "nav.checkin",         "url": "/checkin",         "icon": "🔑"},
    {"key": "nav.extend",          "url": "/extend",          "icon": "⏱"},
    {"key": "nav.checkout",        "url": "/checkout",        "icon": "🚪"},
    {"key": "nav.room_management", "url": "/room-management", "icon": "🔧"},
    {"key": "nav.reports",         "url": "/reports",         "icon": "📊"},
    {"key": "nav.backup",          "url": "/backup",          "icon": "☁️"},
]


def _build_alerts(db: Session, trans: dict) -> list[dict]:
    """
    Build a list of alert dicts for the hub page.
    Each alert: {level, icon, message, url}
    level: "danger" | "warning" | "info"
    """
    alerts = []
    today  = date.today().isoformat()
    rooms  = db.query(Room).all()

    # 1. Backup sync failure
    state = db.query(BackupState).first()
    if state and state.status == "同步失敗":
        recent_err = (
            db.query(BackupLog)
            .filter(BackupLog.message.like("%❌%"))
            .order_by(BackupLog.id.desc())
            .first()
        )
        alerts.append({
            "level":   "danger",
            "icon":    "⚠️",
            "message": trans.get("alert.sync_failed", "Cloud sync failed"),
            "detail":  recent_err.message if recent_err else "",
            "url":     "/backup",
        })

    # 2. Rooms checking out soon today
    soon = [r for r in rooms if r.status == "即將退房"]
    if soon:
        names = "、".join(r.id for r in soon[:3])
        alerts.append({
            "level":   "warning",
            "icon":    "🚪",
            "message": trans.get("alert.checkout_soon", "Rooms checking out soon") + f": {names}",
            "detail":  "",
            "url":     "/checkout",
        })

    # 3. Rooms pending cleaning
    cleaning = [r for r in rooms if r.status == "待清潔"]
    if cleaning:
        names = "、".join(r.id for r in cleaning[:3])
        alerts.append({
            "level":   "warning",
            "icon":    "🧹",
            "message": trans.get("alert.cleaning_pending", "Rooms pending cleaning") + f": {names}",
            "detail":  "",
            "url":     "/room-management",
        })

    # 4. Maintenance overdue
    overdue = [
        r for r in rooms
        if r.status == "維修中"
        and getattr(r, "maintenance_due", None)
        and r.maintenance_due < today
    ]
    if overdue:
        names = "、".join(r.id for r in overdue[:3])
        alerts.append({
            "level":   "danger",
            "icon":    "🔧",
            "message": trans.get("alert.maintenance_overdue", "Maintenance overdue") + f": {names}",
            "detail":  "",
            "url":     "/room-management",
        })

    return alerts


@router.get("/", response_class=HTMLResponse)
async def hub(request: Request, db: Session = Depends(get_db)):
    lang   = get_lang(request)
    trans  = get_translations(lang)
    pages  = [{"name": _t(p["key"], trans), "url": p["url"], "icon": p["icon"]} for p in PAGES]
    alerts = _build_alerts(db, trans)

    return templates.TemplateResponse("hub.html", {
        "request": request,
        "pages":   pages,
        "alerts":  alerts,
        "title":   "BINI Blooms",
        "trans":   trans,
        "lang":    lang,
    })

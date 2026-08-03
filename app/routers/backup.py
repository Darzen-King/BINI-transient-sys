import pathlib
"""
routers/backup.py — /backup  (Cloud Backup settings + operations)
"""
import json
from fastapi import APIRouter, Request, Depends, Form
from fastapi.responses import HTMLResponse, RedirectResponse, JSONResponse
from fastapi.templating import Jinja2Templates
from sqlalchemy.orm import Session

from app.db import get_db
from app.services import backup as bksvc
from app.services import audit as _audit
from app.services.backup_providers.base import PROVIDER_TYPES
from app.lib.i18n import get_lang, get_translations

router    = APIRouter()
templates = Jinja2Templates(directory=str(pathlib.Path(__file__).parent.parent / "templates"))


@router.get("/backup", response_class=HTMLResponse)
async def backup_page(request: Request, db: Session = Depends(get_db)):
    lang  = get_lang(request)
    trans = get_translations(lang)

    # Role guard: manager / admin only
    from app.services.auth import get_current_user, require_role
    _cu = get_current_user(request, db)
    if not require_role(_cu, "manager", "admin"):
        return RedirectResponse("/login?err=auth.forbidden", status_code=303)

    is_admin = require_role(_cu, "admin")
    state = bksvc.get_state(db)
    logs  = bksvc.get_backup_logs(db)
    creds = bksvc.load_credentials(state) if state else {}
    msg   = request.query_params.get("msg", "")
    err   = request.query_params.get("err", "")

    # Current provider_type default
    current_type = getattr(state, "provider_type", None) or "dropbox" if state else "dropbox"

    return templates.TemplateResponse("backup.html", {
        "request":        request,
        "state":          state,
        "logs":           logs,
        "creds":          creds,
        "provider_types": PROVIDER_TYPES,
        "current_type":   current_type,
        "msg":            msg,
        "err":            err,
        "is_admin":       is_admin,
        "title":          trans.get("backup.title", "雲端備份"),
        "trans":          trans,
        "lang":           lang,
    })


@router.post("/backup/save-config")
async def save_config(
    request:      Request,
    provider_type: str  = Form(...),
    auto_backup:   str  = Form("0"),
    db: Session = Depends(get_db),
):
    form  = await request.form()
    creds = {}

    from app.services.backup_providers.base import PROVIDER_TYPES
    fields = PROVIDER_TYPES.get(provider_type, {}).get("fields", [])
    for f in fields:
        val = form.get(f["key"], "")
        if val:
            creds[f["key"]] = val

    bksvc.save_config(db, provider_type, creds, auto_backup=auto_backup == "1")
    return RedirectResponse("/backup?msg=config_saved", status_code=303)


@router.post("/backup/test")
async def test_connection(request: Request, db: Session = Depends(get_db)):
    result = bksvc.test_connection(db)
    if result["success"]:
        return RedirectResponse("/backup?msg=test_ok", status_code=303)
    from urllib.parse import quote
    return RedirectResponse(f"/backup?err={quote(result['message'])}", status_code=303)


@router.post("/backup/sync")
async def sync_backup(request: Request, db: Session = Depends(get_db)):
    from app.services.auth import get_current_user, require_role
    _cu = get_current_user(request, db)
    if not require_role(_cu, 'manager', 'admin'): return RedirectResponse('/login?err=auth.forbidden', status_code=303)
    result = bksvc.sync_backup(db)
    state  = bksvc.get_state(db)
    _audit.log_backup_sync(db, state.provider if state else '?', result['success'])
    if result["success"]:
        return RedirectResponse("/backup?msg=synced", status_code=303)
    from urllib.parse import quote
    return RedirectResponse(f"/backup?err={quote(result['message'])}", status_code=303)


@router.post("/backup/restore")
async def restore_backup(request: Request, db: Session = Depends(get_db)):
    from app.services.auth import get_current_user, require_role
    _cu = get_current_user(request, db)
    if not require_role(_cu, 'manager', 'admin'): return RedirectResponse('/login?err=auth.forbidden', status_code=303)
    result = bksvc.restore_backup(db)
    state  = bksvc.get_state(db)
    _audit.log_backup_restore(db, state.provider if state else '?', result['success'])
    if result["success"]:
        return RedirectResponse("/backup?msg=restored", status_code=303)
    from urllib.parse import quote
    return RedirectResponse(f"/backup?err={quote(result['message'])}", status_code=303)


# ── In-app self-update (from GitHub) ────────────────────────────────────────
@router.get("/api/update/check")
def update_check(request: Request, db: Session = Depends(get_db)):
    from app.services.auth import get_current_user, require_role
    _cu = get_current_user(request, db)
    if not require_role(_cu, "admin"):
        return JSONResponse({"error": "auth.forbidden"}, status_code=403)
    from app.services import updater as upd
    return JSONResponse(upd.check_update())


@router.post("/api/update/run")
def update_run(request: Request, db: Session = Depends(get_db)):
    """Backup to cloud (mandatory) → download → stage → launch updater → exit.
    Sync def so the ~MB download runs in a threadpool, not on the event loop."""
    from app.services.auth import get_current_user, require_role
    _cu = get_current_user(request, db)
    if not require_role(_cu, "admin"):
        return JSONResponse({"ok": False, "stage": "auth", "message": "auth.forbidden"}, status_code=403)

    from app.services import updater as upd

    # 1) There must actually be a newer version.
    chk = upd.check_update()
    if chk.get("error"):
        return JSONResponse({"ok": False, "stage": "check", "message": chk["error"]})
    if not chk["update_available"]:
        return JSONResponse({"ok": False, "stage": "check", "message": "已是最新版本，無需更新"})

    # 2) MANDATORY cloud backup BEFORE any code is touched — abort if it fails.
    bk = bksvc.sync_backup(db)
    state = bksvc.get_state(db)
    _audit.log_backup_sync(db, state.provider if state else "?", bk["success"])
    if not bk["success"]:
        return JSONResponse({"ok": False, "stage": "backup",
                             "message": f"雲端備份失敗，已中止更新（未動到程式）：{bk['message']}"})

    # 3) Download the new build and stage it in TEMP.
    try:
        staging = upd.download_and_stage()
    except Exception as ex:  # noqa: BLE001
        return JSONResponse({"ok": False, "stage": "download", "message": f"下載更新失敗：{ex}"})

    # 4) Launch the external updater, log it, then exit so files unlock.
    try:
        upd.launch_updater(staging)
    except Exception as ex:  # noqa: BLE001
        return JSONResponse({"ok": False, "stage": "apply", "message": f"啟動更新程序失敗：{ex}"})

    try:
        _audit.log_action(db, "app_update", target_id="system", target_type="system",
                          new_value={"from": chk["current"], "to": chk["latest"]},
                          description=f"程式更新 {chk['current']} → {chk['latest']}",
                          user_id=(_cu.username if _cu else "admin"))
    except Exception:
        pass

    import threading, os as _os
    threading.Timer(1.5, lambda: _os._exit(0)).start()
    return JSONResponse({"ok": True, "to": chk["latest"],
                         "message": "已完成雲端備份，更新下載完成，程式即將自動重啟…"})


@router.get("/api/backup-logs-error")
async def backup_logs_error_api(db: Session = Depends(get_db)):
    """Return recent error log messages for the sync-failed modal."""
    logs = (
        db.query(__import__("app.models", fromlist=["BackupLog"]).BackupLog)
        .filter(__import__("app.models", fromlist=["BackupLog"]).BackupLog.message.like("%❌%"))
        .order_by(__import__("app.models", fromlist=["BackupLog"]).BackupLog.id.desc())
        .limit(10)
        .all()
    )
    return JSONResponse([l.message for l in logs])


@router.get("/api/backup-status")
async def backup_status_api(db: Session = Depends(get_db)):
    """JSON endpoint for navbar sync status indicator."""
    state = bksvc.get_state(db)
    if not state:
        return JSONResponse({"status": "unconfigured", "label": "☁ 未設定"})

    # Same combined logic as backup.html badge
    ts = getattr(state, "test_status", None) or "untested"
    st = state.status or "未設定"

    if ts == "fail" or st == "同步失敗":
        effective = "同步失敗"
    elif st == "同步中":
        effective = "同步中"
    elif st == "已同步":
        effective = "已同步"
    else:
        effective = st

    return JSONResponse({
        "status":    effective,
        "last_sync": state.last_sync or "—",
        "provider":  state.provider or "—",
    })


# ── First-run check API ────────────────────────────────────────────────────

@router.get("/api/is-fresh-install")
async def is_fresh_install(request: Request, db: Session = Depends(get_db)):
    """Returns true if DB appears to be a fresh install (no bookings or stays)."""
    from fastapi.responses import JSONResponse
    from app.models import Booking, Payment
    has_bookings = db.query(Booking).first() is not None
    has_payments = db.query(Payment).first() is not None
    is_fresh     = not has_bookings and not has_payments
    return JSONResponse({"fresh": is_fresh})


# ── Backup connection status API (used by navbar notification) ────────────────

@router.get("/api/backup-status")
async def backup_status(request: Request, db: Session = Depends(get_db)):
    """
    Lightweight check: is backup configured and was last sync successful?
    Returns JSON consumed by base.html navbar JS to show warning toast.
    """
    from fastapi.responses import JSONResponse
    from app.services.backup import get_state
    state = get_state(db)

    if not state or not state.credentials or state.credentials == "{}":
        return JSONResponse({"configured": False, "ok": True})  # not configured = no warning

    # Check last sync result from logs
    from app.models import BackupLog
    last_log = db.query(BackupLog).order_by(BackupLog.id.desc()).first()
    if not last_log:
        return JSONResponse({"configured": True, "ok": True, "message": ""})

    is_ok = "✅" in (last_log.message or "") or last_log.status == "success"
    return JSONResponse({
        "configured": True,
        "ok":         is_ok,
        "provider":   state.provider or "",
        "last_sync":  state.last_sync or "",
        "message":    last_log.message or "",
    })

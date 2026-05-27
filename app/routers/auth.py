import pathlib
"""
routers/auth.py — /login  /logout  /admin/users
"""
from fastapi import APIRouter, Request, Depends, Form
from fastapi.responses import HTMLResponse, RedirectResponse
from fastapi.templating import Jinja2Templates
from sqlalchemy.orm import Session

from app.db import get_db
from app.services import auth as auth_svc
from app.lib.i18n import get_lang, get_translations

router    = APIRouter()
templates = Jinja2Templates(directory=str(pathlib.Path(__file__).parent.parent / "templates"))


# ── Login ─────────────────────────────────────────────────────────────────

@router.get("/login", response_class=HTMLResponse)
async def login_page(request: Request, db: Session = Depends(get_db)):
    lang  = get_lang(request)
    trans = get_translations(lang)
    # Already logged in?
    user  = auth_svc.get_current_user(request, db)
    if user:
        return RedirectResponse("/", status_code=303)
    err = request.query_params.get("err", "")
    return templates.TemplateResponse("login.html", {
        "request": request,
        "error":   trans.get(err, err) if err else "",
        "title":   trans.get("auth.login", "Login"),
        "trans":   trans,
        "lang":    lang,
    })


@router.post("/login")
async def login_submit(
    request:  Request,
    username: str = Form(...),
    password: str = Form(...),
    next_url: str = Form("/"),
    db: Session = Depends(get_db),
):
    token, err = auth_svc.login(db, username, password)
    if err:
        from urllib.parse import quote
        return RedirectResponse(f"/login?err={quote(err)}", status_code=303)

    response = RedirectResponse(next_url or "/", status_code=303)
    response.set_cookie(
        auth_svc.SESSION_COOKIE, token,
        httponly=True, samesite="lax",
        max_age=auth_svc.SESSION_TTL_HOURS * 3600,
    )
    return response


@router.get("/logout")
async def logout():
    response = RedirectResponse("/login", status_code=303)
    response.delete_cookie(auth_svc.SESSION_COOKIE)
    return response


# ── User management (admin only) ──────────────────────────────────────────

@router.get("/admin/users", response_class=HTMLResponse)
async def users_page(request: Request, db: Session = Depends(get_db)):
    lang  = get_lang(request)
    trans = get_translations(lang)
    user  = auth_svc.get_current_user(request, db)
    if not auth_svc.require_role(user, "admin"):
        return RedirectResponse("/login?err=auth.forbidden", status_code=303)

    users = auth_svc.get_all_users(db)
    msg   = request.query_params.get("msg", "")
    err   = request.query_params.get("err", "")
    return templates.TemplateResponse("users.html", {
        "request":       request,
        "users":         users,
        "roles":         auth_svc.ROLES,
        "current_user":  user,
        "msg":           msg,
        "err":           trans.get(err, err) if err else "",
        "title":         trans.get("auth.users_title", "User Management"),
        "trans":         trans,
        "lang":          lang,
        "all_nav_pages": auth_svc.ALL_NAV_PAGES,
        "role_nav_json": __import__("json").dumps(auth_svc.ROLE_NAV),
    })


@router.post("/admin/users/create")
async def create_user(
    request:      Request,
    username:     str = Form(...),
    display_name: str = Form(""),
    password:     str = Form(...),
    role:         str = Form("front_desk"),
    db: Session = Depends(get_db),
):
    user = auth_svc.get_current_user(request, db)
    if not auth_svc.require_role(user, "admin"):
        return RedirectResponse("/login?err=auth.forbidden", status_code=303)
    from urllib.parse import quote
    existing = auth_svc.get_user_by_username(db, username)
    if existing:
        return RedirectResponse(f"/admin/users?err={quote('auth.username_taken')}", status_code=303)
    new_user = auth_svc.create_user(db, username, password, display_name or username, role)
    from app.services.audit import log_action
    log_action(db, "user_create", target_id=str(new_user.id), target_type="user",
               new_value={"username": username, "role": role},
               description=f"Created user: {username} ({role})",
               user_id=user.username)
    return RedirectResponse("/admin/users?msg=created", status_code=303)


@router.post("/admin/users/{user_id}/toggle")
async def toggle_user(
    request: Request,
    user_id: int,
    db: Session = Depends(get_db),
):
    actor = auth_svc.get_current_user(request, db)
    if not auth_svc.require_role(actor, "admin"):
        return RedirectResponse("/login?err=auth.forbidden", status_code=303)
    target = auth_svc.get_user_by_id(db, user_id)
    if target:
        target.is_active = 0 if target.is_active else 1
        db.commit()
        from app.services.audit import log_action
        log_action(db, "user_toggle", target_id=str(user_id), target_type="user",
                   new_value={"is_active": target.is_active},
                   description=f"{'Activated' if target.is_active else 'Deactivated'} user: {target.username}",
                   user_id=actor.username)
    return RedirectResponse("/admin/users?msg=updated", status_code=303)


@router.post("/admin/users/{user_id}/change-password")
async def change_password(
    request:      Request,
    user_id:      int,
    new_password: str = Form(...),
    db: Session = Depends(get_db),
):
    actor = auth_svc.get_current_user(request, db)
    if not auth_svc.require_role(actor, "admin"):
        return RedirectResponse("/login?err=auth.forbidden", status_code=303)
    auth_svc.change_password(db, user_id, new_password)
    return RedirectResponse("/admin/users?msg=pw_changed", status_code=303)

@router.post("/admin/users/{user_id}/edit")
async def edit_user(
    request:       Request,
    user_id:       int,
    display_name:  str  = Form(""),
    new_username:  str  = Form(""),
    new_password:  str  = Form(""),
    new_role:      str  = Form(""),
    allowed_pages: list = Form([]),   # list of checked page keys
    db: Session = Depends(get_db),
):
    """
    Full user edit: display name, login username, password, role, custom page access.
    Admin only.
    """
    actor = auth_svc.get_current_user(request, db)
    if not auth_svc.require_role(actor, "admin"):
        return RedirectResponse("/login?err=auth.forbidden", status_code=303)

    from urllib.parse import quote

    target = auth_svc.get_user_by_id(db, user_id)
    if not target:
        return RedirectResponse(f"/admin/users?err={quote('auth.user_not_found')}", status_code=303)

    # Prevent changing own username/role to avoid lockout
    is_self = (actor and actor.id == user_id)

    # Check username uniqueness if changing
    if new_username.strip() and new_username.strip() != target.username:
        existing = auth_svc.get_user_by_username(db, new_username.strip())
        if existing and existing.id != user_id:
            return RedirectResponse(f"/admin/users?err={quote('auth.username_taken')}", status_code=303)

    # allowed_pages: empty list from form = use role default (clear override)
    # non-empty list = save as override
    pages_override = [p for p in allowed_pages if p in auth_svc.ALL_NAV_PAGES] if allowed_pages else []

    user, changes = auth_svc.update_user(
        db, user_id,
        display_name  = display_name  or None,
        new_username  = new_username  if not is_self else None,
        new_password  = new_password  or None,
        new_role      = new_role      if new_role in auth_svc.ROLES and not is_self else None,
        allowed_pages = pages_override if allowed_pages is not None else None,
    )

    if changes:
        from app.services.audit import log_action
        log_action(db, "user_update", target_id=str(user_id), target_type="user",
                   new_value={"changes": changes},
                   description=f"User edited: {target.username} — {', '.join(changes)}",
                   user_id=actor.username if actor else "admin")

    return RedirectResponse("/admin/users?msg=profile_updated", status_code=303)


# Keep old endpoint for backward compat (redirect to new)
@router.post("/admin/users/{user_id}/update-profile")
async def update_profile_compat(
    request:      Request,
    user_id:      int,
    display_name: str = Form(""),
    new_password: str = Form(""),
    db: Session = Depends(get_db),
):
    actor = auth_svc.get_current_user(request, db)
    if not auth_svc.require_role(actor, "admin"):
        return RedirectResponse("/login?err=auth.forbidden", status_code=303)
    auth_svc.update_user(db, user_id,
        display_name=display_name or None,
        new_password=new_password or None)
    return RedirectResponse("/admin/users?msg=profile_updated", status_code=303)

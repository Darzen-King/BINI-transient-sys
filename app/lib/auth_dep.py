"""
lib/auth_dep.py — FastAPI dependencies for auth protection.

Usage in routers:
    from app.lib.auth_dep import login_required, role_required

    @router.get("/rooms")
    async def rooms(request: Request, user=Depends(login_required)):
        ...

    @router.get("/reports")
    async def reports(request: Request, user=Depends(role_required("manager","admin"))):
        ...
"""
from fastapi import Request, Depends
from fastapi.responses import RedirectResponse
from sqlalchemy.orm import Session

from app.db import get_db
from app.services import auth as auth_svc
from app.models import User


class _LoginRequired:
    """Dependency: redirects to /login if not authenticated."""
    async def __call__(self, request: Request, db: Session = Depends(get_db)) -> User:
        user = auth_svc.get_current_user(request, db)
        if not user:
            from urllib.parse import quote
            next_url = quote(str(request.url.path))
            raise _AuthRedirect(f"/login?next={next_url}")
        return user


class _RoleRequired:
    def __init__(self, *roles: str):
        self.roles = roles

    async def __call__(self, request: Request, db: Session = Depends(get_db)) -> User:
        user = auth_svc.get_current_user(request, db)
        if not user:
            from urllib.parse import quote
            next_url = quote(str(request.url.path))
            raise _AuthRedirect(f"/login?next={next_url}")
        if user.role not in self.roles:
            raise _AuthRedirect("/login?err=auth.forbidden")
        return user


class _AuthRedirect(Exception):
    def __init__(self, url: str):
        self.url = url


def role_required(*roles: str) -> _RoleRequired:
    return _RoleRequired(*roles)


login_required = _LoginRequired()

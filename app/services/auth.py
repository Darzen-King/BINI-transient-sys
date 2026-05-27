"""
services/auth.py — Authentication & RBAC service.
Uses stdlib only (hashlib, hmac, secrets) — no extra packages needed.

Roles:
  admin         : everything
  manager       : reports, backup, audit, all ops (no user management)
  front_desk    : bookings, checkin, checkout, extend, rooms (read)
  housekeeping  : rooms (read + cleaning status update only)
  maintenance   : rooms (read + maintenance status update only)
"""
import hashlib
import hmac
import secrets
import json
from datetime import datetime
from sqlalchemy.orm import Session
from app.models import User

DT_FMT    = "%Y-%m-%d %H:%M:%S"
SESSION_TTL_HOURS = 12

# ── Role definitions ──────────────────────────────────────────────────────

# All navigable pages (key → i18n key for label)
ALL_NAV_PAGES: dict[str, str] = {
    "rooms":           "nav.rooms",
    "bookings":        "nav.bookings",
    "bookings_new":    "nav.bookings_new",
    "checkin":         "nav.checkin",
    "extend":          "nav.extend",
    "checkout":        "nav.checkout",
    "room_management": "nav.room_management",
    "payments":        "nav.payments",
    "reports":         "nav.reports",
    "backup":          "nav.backup",
    "audit":           "nav.audit",
    "users":           "nav.users",
    "housekeeping":    "nav.housekeeping",
    "maintenance":     "nav.maintenance",
    "properties":      "nav.properties",
    "costs":           "nav.costs",
    "holidays":        "nav.holidays",
}

ROLES = {
    "admin":        "Admin",
    "manager":      "Manager",
    "front_desk":   "Front Desk",
    "housekeeping": "Housekeeping",
    "maintenance":  "Maintenance",
}

# Each role gets a set of permission slugs
ROLE_PERMISSIONS: dict[str, set[str]] = {
    "admin": {
        "view_rooms", "view_bookings", "view_checkin", "view_checkout",
        "view_extend", "view_room_management", "view_reports", "view_backup",
        "view_audit", "view_users", "view_holidays",
        "op_booking", "op_checkin", "op_checkout", "op_extend",
        "op_room_any_status", "op_backup", "op_restore", "op_export",
        "manage_users", "manage_holidays",
    },
    "manager": {
        "view_rooms", "view_bookings", "view_checkin", "view_checkout",
        "view_extend", "view_room_management", "view_reports", "view_backup",
        "view_audit", "view_holidays",
        "op_booking", "op_checkin", "op_checkout", "op_extend",
        "op_room_any_status", "op_backup", "op_restore", "op_export",
        "manage_holidays",
    },
    "front_desk": {
        "view_rooms", "view_bookings", "view_checkin", "view_checkout",
        "view_extend", "view_room_management",
        "op_booking", "op_checkin", "op_checkout", "op_extend",
        "op_room_any_status",
    },
    "housekeeping": {
        "view_rooms", "view_room_management",
        "op_room_cleaning",       # can only update cleaning statuses
    },
    "maintenance": {
        "view_rooms", "view_room_management",
        "op_room_maintenance",    # can only update maintenance status/note
    },
}

# Nav items each role can see
ROLE_NAV: dict[str, list[str]] = {
    "admin":        ["rooms", "bookings", "bookings_new", "checkin", "extend",
                     "checkout", "room_management", "reports", "backup", "audit", "users",
                     "holidays"],
    "manager":      ["rooms", "bookings", "bookings_new", "checkin", "extend",
                     "checkout", "room_management", "reports", "backup", "audit",
                     "holidays"],
    "front_desk":   ["rooms", "bookings", "bookings_new", "checkin", "extend",
                     "checkout", "room_management"],
    "housekeeping": ["rooms", "room_management"],
    "maintenance":  ["rooms", "room_management"],
}

# Statuses each role can set
ROLE_ALLOWED_STATUSES: dict[str, list[str]] = {
    "admin":        ["可入住", "使用中", "即將退房", "待清潔", "維修中"],
    "manager":      ["可入住", "使用中", "即將退房", "待清潔", "維修中"],
    "front_desk":   ["可入住", "使用中", "即將退房", "待清潔", "維修中"],
    "housekeeping": ["待清潔", "可入住"],          # cleaning flow only
    "maintenance":  ["維修中", "可入住"],           # maintenance flow only
}


def can(role: str, permission: str) -> bool:
    return permission in ROLE_PERMISSIONS.get(role, set())


def nav_for_role(role: str) -> list[str]:
    return ROLE_NAV.get(role, [])


def nav_for_user(user) -> list[str]:
    """
    Returns the nav pages for this user.
    If user.allowed_pages is set (JSON list), use that override.
    Otherwise fall back to role default.
    """
    import json
    if user and getattr(user, "allowed_pages", None):
        try:
            pages = json.loads(user.allowed_pages)
            if isinstance(pages, list) and pages:
                return pages
        except Exception:
            pass
    return nav_for_role(user.role if user else "")


def get_user_effective_pages(user) -> list[str]:
    """Alias for nav_for_user."""
    return nav_for_user(user)


def allowed_statuses(role: str) -> list[str]:
    return ROLE_ALLOWED_STATUSES.get(role, [])


# ── Password utils ────────────────────────────────────────────────────────

def hash_password(password: str) -> tuple[str, str]:
    """Return (hash_hex, salt_hex)."""
    salt  = secrets.token_hex(16)
    h     = hashlib.pbkdf2_hmac("sha256", password.encode(), salt.encode(), 260_000)
    return h.hex(), salt


def verify_password(password: str, hash_hex: str, salt: str) -> bool:
    h = hashlib.pbkdf2_hmac("sha256", password.encode(), salt.encode(), 260_000)
    return hmac.compare_digest(h.hex(), hash_hex)


# ── Session token ─────────────────────────────────────────────────────────

_SECRET = secrets.token_hex(32)    # rotates on restart (MVP — fine for now)


def make_session_token(user_id: int, role: str) -> str:
    """Sign a small payload with HMAC-SHA256."""
    payload = f"{user_id}:{role}:{datetime.now().strftime(DT_FMT)}"
    sig     = hmac.new(_SECRET.encode(), payload.encode(), "sha256").hexdigest()
    import base64
    raw     = f"{payload}|{sig}"
    return base64.urlsafe_b64encode(raw.encode()).decode()


def verify_session_token(token: str) -> dict | None:
    """
    Returns {"user_id": int, "role": str} or None if invalid/expired.
    """
    try:
        import base64
        raw     = base64.urlsafe_b64decode(token.encode()).decode()
        payload, sig = raw.rsplit("|", 1)
        expected = hmac.new(_SECRET.encode(), payload.encode(), "sha256").hexdigest()
        if not hmac.compare_digest(sig, expected):
            return None
        parts = payload.split(":")
        user_id   = int(parts[0])
        role      = parts[1]
        ts_str    = ":".join(parts[2:])
        ts        = datetime.strptime(ts_str, DT_FMT)
        age_hours = (datetime.now() - ts).total_seconds() / 3600
        if age_hours > SESSION_TTL_HOURS:
            return None
        return {"user_id": user_id, "role": role}
    except Exception:
        return None


SESSION_COOKIE = "bb_session"


# ── DB helpers ────────────────────────────────────────────────────────────

def get_user_by_username(db: Session, username: str) -> User | None:
    return db.query(User).filter(User.username == username).first()


def get_user_by_id(db: Session, user_id: int) -> User | None:
    return db.query(User).filter(User.id == user_id).first()


def login(db: Session, username: str, password: str) -> tuple[str | None, str | None]:
    """
    Returns (session_token, error_i18n_key).
    """
    user = get_user_by_username(db, username)
    if not user or not user.is_active:
        return None, "auth.invalid_credentials"
    if not verify_password(password, user.password_hash, user.password_salt):
        return None, "auth.invalid_credentials"
    # Update last_login
    user.last_login = datetime.now().strftime(DT_FMT)
    db.commit()
    token = make_session_token(user.id, user.role)
    return token, None


def create_user(
    db: Session,
    username: str,
    password: str,
    display_name: str,
    role: str,
) -> User:
    h, salt = hash_password(password)
    user = User(
        username      = username,
        display_name  = display_name,
        password_hash = h,
        password_salt = salt,
        role          = role,
        is_active     = 1,
        created_at    = datetime.now().strftime(DT_FMT),
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


def change_password(db: Session, user_id: int, new_password: str) -> bool:
    user = get_user_by_id(db, user_id)
    if not user:
        return False
    h, salt = hash_password(new_password)
    user.password_hash = h
    user.password_salt = salt
    db.commit()
    return True


def update_user(
    db: Session,
    user_id: int,
    display_name: str | None = None,
    new_username: str | None = None,
    new_password: str | None = None,
    new_role: str | None = None,
    allowed_pages: list | None = None,   # None = keep current; [] = use role default
) -> tuple[User | None, list[str]]:
    """
    Update user profile. Returns (user, list_of_changes).
    new_username=None means keep current.
    allowed_pages=None means keep current; allowed_pages=[] means clear override.
    """
    import json
    user = get_user_by_id(db, user_id)
    if not user:
        return None, []

    changes = []

    if display_name is not None and display_name.strip() != (user.display_name or ""):
        old = user.display_name
        user.display_name = display_name.strip() or user.username
        changes.append(f"display_name: {old!r} → {user.display_name!r}")

    if new_username is not None and new_username.strip() != user.username:
        old = user.username
        user.username = new_username.strip()
        changes.append(f"username: {old!r} → {user.username!r}")

    if new_password is not None and new_password.strip():
        h, salt = hash_password(new_password.strip())
        user.password_hash = h
        user.password_salt = salt
        changes.append("password changed")

    if new_role is not None and new_role in ROLES and new_role != user.role:
        old = user.role
        user.role = new_role
        changes.append(f"role: {old!r} → {new_role!r}")

    if allowed_pages is not None:
        if len(allowed_pages) == 0:
            user.allowed_pages = None   # clear override, use role default
            changes.append("allowed_pages: cleared (use role default)")
        else:
            user.allowed_pages = json.dumps(allowed_pages)
            changes.append(f"allowed_pages: {allowed_pages}")

    if changes:
        db.commit()
        db.refresh(user)

    return user, changes


def get_all_users(db: Session) -> list[User]:
    return db.query(User).order_by(User.username).all()


# ── Request helper ────────────────────────────────────────────────────────

def get_current_user(request, db: Session) -> User | None:
    """Extract and verify session cookie, return User or None."""
    token = request.cookies.get(SESSION_COOKIE)
    if not token:
        return None
    info = verify_session_token(token)
    if not info:
        return None
    return get_user_by_id(db, info["user_id"])


def require_role(user: User | None, *roles: str) -> bool:
    """True if user is authenticated and has one of the required roles."""
    return bool(user and user.is_active and user.role in roles)

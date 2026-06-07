"""
models/__init__.py — SQLAlchemy ORM table definitions.

Phase-2 changes:
  ActiveStay gains checkin_time / checkout_time / hourly_rate
  for precise automatic fee calculation.
"""
from sqlalchemy import Column, String, Integer, Float, Text
from app.db import Base


class Room(Base):
    __tablename__ = "rooms"

    id                = Column(String, primary_key=True, index=True)
    status            = Column(String, nullable=False, default="可入住")
    current_guest     = Column(String, nullable=True)
    checkin           = Column(String, nullable=True)
    checkout          = Column(String, nullable=True)
    next_booking      = Column(String, nullable=True)
    note              = Column(Text,   nullable=True)
    # Phase-3 Task 3: maintenance workflow
    maintenance_note  = Column(Text,   nullable=True)   # required when status=維修中
    maintenance_due   = Column(String, nullable=True)   # due date "YYYY-MM-DD"
    property_id       = Column(String, nullable=True, index=True)   # FK → properties.id


class Booking(Base):
    __tablename__ = "bookings"

    id        = Column(String, primary_key=True, index=True)
    room      = Column(String, nullable=False)
    guest     = Column(String, nullable=False)
    phone     = Column(String, nullable=True)
    checkin   = Column(String, nullable=False)
    checkout  = Column(String, nullable=False)
    plan      = Column(String, nullable=False, default="24hrs")
    amount    = Column(Float,  nullable=False, default=0)   # final amount (after discount)
    discount  = Column(Float,  nullable=False, default=0)   # multi-day discount applied
    rate_type = Column(String, nullable=True)
    status      = Column(String, nullable=False, default="已預約")
    property_id = Column(String, nullable=True, index=True)   # FK → properties.id


class ActiveStay(Base):
    __tablename__ = "active_stays"

    id            = Column(Integer, primary_key=True, autoincrement=True)
    room          = Column(String, nullable=False, unique=True, index=True)
    guest         = Column(String, nullable=False)
    plan          = Column(String, nullable=True)
    base_rent     = Column(Float, nullable=False, default=0)   # final room charge (after discount)
    discount      = Column(Float, nullable=False, default=0)   # multi-day discount applied at check-in
    extension_fee = Column(Float, nullable=False, default=0)
    extra_fee     = Column(Float, nullable=False, default=0)
    total_due     = Column(Float, nullable=False, default=0)
    # Phase-2: timestamps + rate for precise fee engine
    checkin_time  = Column(String, nullable=True)
    checkout_time = Column(String, nullable=True)
    hourly_rate   = Column(Float, nullable=False, default=200)
    # BUG-A FIX: original planned checkout (set at check-in, never changed).
    # Used as the fixed start_dt for block-ceiling calculation so multiple
    # incremental /extend calls correctly accumulate instead of each resetting
    # block_idx to 0.
    original_checkout_time = Column(String, nullable=True)


class ReportSummary(Base):
    __tablename__ = "report_summary"

    id            = Column(Integer, primary_key=True, autoincrement=True)
    range         = Column(String, nullable=True)
    granularity   = Column(String, nullable=True)
    total_revenue = Column(Float,   nullable=False, default=0)
    orders        = Column(Integer, nullable=False, default=0)
    avg_occupancy = Column(Float,   nullable=False, default=0)
    loss_count    = Column(Integer, nullable=False, default=0)
    repair_count  = Column(Integer, nullable=False, default=0)


class BackupState(Base):
    __tablename__ = "backup_state"

    id            = Column(Integer, primary_key=True, autoincrement=True)
    # Legacy fields
    provider      = Column(String, nullable=True)   # display name
    folder        = Column(String, nullable=True)   # remote path
    last_sync     = Column(String, nullable=True)
    status        = Column(String, nullable=True)
    files         = Column(Integer, nullable=False, default=0)
    # Phase-4: structured config
    provider_type = Column(String, nullable=True, default="dropbox")
    # Credentials stored as JSON string (no encryption for MVP)
    credentials   = Column(Text, nullable=True)
    auto_backup   = Column(Integer, nullable=False, default=1)   # 0/1 bool
    test_status   = Column(String, nullable=True)   # ok / fail / untested
    test_message  = Column(Text, nullable=True)


class BackupLog(Base):
    __tablename__ = "backup_logs"

    id         = Column(Integer, primary_key=True, autoincrement=True)
    message    = Column(Text,   nullable=False)
    created_at = Column(String, nullable=True)


class StayLog(Base):
    """
    Immutable record of every completed stay (checkout or free-cancel).
    Used by reports instead of accumulating into ReportSummary directly.
    free_cancel=True  → not counted in revenue / order stats
    transferred=True  → stay was moved to another room (counted on new room)
    """
    __tablename__ = "stay_logs"

    id            = Column(Integer, primary_key=True, autoincrement=True)
    room          = Column(String, nullable=False)
    guest         = Column(String, nullable=False)
    plan          = Column(String, nullable=True)
    checkin_time  = Column(String, nullable=True)
    checkout_time = Column(String, nullable=True)   # actual checkout time
    base_rent     = Column(Float,  nullable=False, default=0)
    extension_fee = Column(Float,  nullable=False, default=0)
    extra_fee     = Column(Float,  nullable=False, default=0)
    total_charged = Column(Float,  nullable=False, default=0)
    free_cancel   = Column(Integer, nullable=False, default=0)   # 0/1 bool
    transferred   = Column(Integer, nullable=False, default=0)   # 0/1 bool
    new_room      = Column(String,  nullable=True)               # if transferred
    created_at    = Column(String,  nullable=False)

class BackupConfig(Base):
    """
    Stores cloud backup provider settings.
    One row per provider type (dropbox / webdav / ftp / gdrive).
    Only one provider is 'active' at a time.
    """
    __tablename__ = "backup_config"

    id            = Column(Integer, primary_key=True, autoincrement=True)
    provider      = Column(String, nullable=False, unique=True)  # dropbox/webdav/ftp/gdrive
    active        = Column(Integer, nullable=False, default=0)   # 1 = currently selected
    # Dropbox
    dropbox_token = Column(String, nullable=True)
    dropbox_path  = Column(String, nullable=True, default="/BiniBloomsData")
    # WebDAV / Nextcloud
    webdav_url    = Column(String, nullable=True)
    webdav_user   = Column(String, nullable=True)
    webdav_pass   = Column(String, nullable=True)
    webdav_path   = Column(String, nullable=True, default="/BiniBloomsData")
    # FTP
    ftp_host      = Column(String, nullable=True)
    ftp_user      = Column(String, nullable=True)
    ftp_pass      = Column(String, nullable=True)
    ftp_path      = Column(String, nullable=True, default="/BiniBloomsData")
    # Google Drive
    gdrive_json   = Column(Text,   nullable=True)   # Service Account JSON key
    gdrive_folder = Column(String, nullable=True, default="BiniBloomsData")
    # Auto-backup triggers
    auto_on_checkin   = Column(Integer, nullable=False, default=1)
    auto_on_checkout  = Column(Integer, nullable=False, default=1)
    auto_on_booking   = Column(Integer, nullable=False, default=1)


class ActivityLog(Base):
    """
    Immutable audit trail for all critical write operations.
    Phase-3 Task 2.
    """
    __tablename__ = "activity_logs"

    id             = Column(Integer, primary_key=True, autoincrement=True)
    timestamp      = Column(String, nullable=False)          # "YYYY-MM-DD HH:MM:SS"
    user_id        = Column(String, nullable=False, default="admin")   # future auth
    action_type    = Column(String, nullable=False, index=True)        # e.g. "checkin"
    target_id      = Column(String, nullable=True)           # room_id, booking_id …
    target_type    = Column(String, nullable=True)           # "room" | "booking" | …
    original_value = Column(Text,   nullable=True)           # JSON or plain text
    new_value      = Column(Text,   nullable=True)           # JSON or plain text
    description    = Column(Text,   nullable=True)           # human-readable summary


# ── Phase-4 Task 1: Auth & RBAC ──────────────────────────────────────────

class User(Base):
    """System user with hashed password."""
    __tablename__ = "users"

    id           = Column(Integer, primary_key=True, autoincrement=True)
    username     = Column(String, nullable=False, unique=True, index=True)
    display_name = Column(String, nullable=True)
    password_hash= Column(String, nullable=False)   # pbkdf2_hmac hex
    password_salt= Column(String, nullable=False)   # hex
    role         = Column(String, nullable=False, default="front_desk")
    # front_desk | housekeeping | maintenance | manager | admin
    is_active     = Column(Integer, nullable=False, default=1)
    created_at    = Column(String, nullable=True)
    last_login    = Column(String, nullable=True)
    # Custom page overrides: JSON list of nav keys, or NULL = use role default
    # e.g. '["rooms","checkin","checkout"]'
    allowed_pages = Column(Text, nullable=True)


# ── Phase-4 Task 2: Payments ─────────────────────────────────────────────

class Payment(Base):
    """Individual payment transaction."""
    __tablename__ = "payments"

    id                   = Column(Integer, primary_key=True, autoincrement=True)
    booking_id           = Column(String,  nullable=True,  index=True)
    room_id              = Column(String,  nullable=True,  index=True)
    guest                = Column(String,  nullable=True)
    payment_type         = Column(String,  nullable=False)  # cash|transfer|card|other
    amount               = Column(Float,   nullable=False, default=0)
    is_deposit           = Column(Integer, nullable=False, default=0)  # 1=deposit
    is_refund            = Column(Integer, nullable=False, default=0)  # 1=refund (negative)
    payment_status       = Column(String,  nullable=False, default="paid")
    # paid | pending | partial | refunded
    note                 = Column(Text,    nullable=True)
    created_at           = Column(String,  nullable=False)
    created_by           = Column(String,  nullable=True,  default="admin")
    # Accounting integration fields (Phase-4 Task 3)
    invoice_no           = Column(String,  nullable=True)
    external_txn_id      = Column(String,  nullable=True)
    accounting_exported_at = Column(String, nullable=True)


class CashierSession(Base):
    """Daily cashier session for end-of-day reconciliation."""
    __tablename__ = "cashier_sessions"

    id             = Column(Integer, primary_key=True, autoincrement=True)
    session_date   = Column(String,  nullable=False, index=True)  # "YYYY-MM-DD"
    opened_by      = Column(String,  nullable=True)
    closed_by      = Column(String,  nullable=True)
    opened_at      = Column(String,  nullable=True)
    closed_at      = Column(String,  nullable=True)
    status         = Column(String,  nullable=False, default="open")  # open | closed
    # Totals (computed on close)
    total_expected = Column(Float,   nullable=False, default=0)
    total_cash     = Column(Float,   nullable=False, default=0)
    total_transfer = Column(Float,   nullable=False, default=0)
    total_card     = Column(Float,   nullable=False, default=0)
    total_other    = Column(Float,   nullable=False, default=0)
    total_refunds  = Column(Float,   nullable=False, default=0)
    total_deposits = Column(Float,   nullable=False, default=0)
    note           = Column(Text,    nullable=True)


# ── Phase-4 Task 4: Multi-property ───────────────────────────────────────

class Property(Base):
    """A property / location that owns multiple rooms."""
    __tablename__ = "properties"

    id          = Column(String,  primary_key=True)     # e.g. "P001"
    name        = Column(String,  nullable=False)
    address     = Column(Text,    nullable=True)
    phone       = Column(String,  nullable=True)
    is_active   = Column(Integer, nullable=False, default=1)
    created_at  = Column(String,  nullable=True)
    note        = Column(Text,    nullable=True)


# ── Costs Module ─────────────────────────────────────────────────────────────

class CostEntry(Base):
    """Monthly operating cost record."""
    __tablename__ = "cost_entries"

    id             = Column(Integer, primary_key=True, autoincrement=True)
    property_id    = Column(String,  nullable=True,  index=True)
    cost_date      = Column(String,  nullable=False, index=True)   # "YYYY-MM-DD"
    category       = Column(String,  nullable=False)               # canonical English key
    subcategory    = Column(String,  nullable=True)
    amount         = Column(Float,   nullable=False, default=0)
    payment_method = Column(String,  nullable=False, default="cash")
    vendor         = Column(String,  nullable=True)
    description    = Column(Text,    nullable=True)
    note           = Column(Text,    nullable=True)
    is_recurring   = Column(Integer, nullable=False, default=0)    # 1 = recurring
    receipt_no     = Column(String,  nullable=True)
    created_by     = Column(String,  nullable=True)
    created_at     = Column(String,  nullable=True)
    updated_at     = Column(String,  nullable=True)


# ── Maintenance Schedule ──────────────────────────────────────────────────────

class MaintenanceSchedule(Base):
    """Scheduled maintenance window for a room."""
    __tablename__ = "maintenance_schedules"

    id          = Column(Integer, primary_key=True, autoincrement=True)
    room_id     = Column(String, nullable=False, index=True)
    title       = Column(String, nullable=False)          # brief description
    start_time  = Column(String, nullable=False)          # "YYYY-MM-DD HH:MM"
    end_time    = Column(String, nullable=False)          # "YYYY-MM-DD HH:MM"
    note        = Column(Text,   nullable=True)
    status      = Column(String, nullable=False, default="scheduled")  # scheduled/in_progress/done
    created_by  = Column(String, nullable=True)
    created_at  = Column(String, nullable=True)


class MonthlyRental(Base):
    """
    月租方案 — Monthly suite rental.
    A room set to 月租套房 status has one ACTIVE MonthlyRental record.
    Rent counts toward report revenue; deposit is held and refundable on checkout.
    status: "active" (currently rented) | "ended" (checked out)
    """
    __tablename__ = "monthly_rentals"

    id               = Column(Integer, primary_key=True, autoincrement=True)
    room_id          = Column(String, nullable=False, index=True)
    tenant_name      = Column(String, nullable=False)
    tenant_phone     = Column(String, nullable=True)
    start_date       = Column(String, nullable=False)   # "YYYY-MM-DD"
    end_date         = Column(String, nullable=False)   # start + 1 month "YYYY-MM-DD"
    deposit          = Column(Float,  nullable=False, default=0)   # 押金 (refundable)
    rent             = Column(Float,  nullable=False, default=0)   # 月租金 (revenue)
    status           = Column(String, nullable=False, default="active")  # active | ended
    deposit_refunded = Column(Float,  nullable=False, default=0)   # set on checkout
    payment_type     = Column(String, nullable=True,  default="cash")
    property_id      = Column(String, nullable=True,  index=True)
    note             = Column(Text,   nullable=True)
    created_at       = Column(String, nullable=True)
    ended_at         = Column(String, nullable=True)
    created_by       = Column(String, nullable=True)


class HolidayCache(Base):
    """
    Government holiday dates fetched from open data API.
    Cached locally to avoid fetching every request.
    Auto-refreshed on startup for current + next year.
    Manual entries (is_manual=1) are never overwritten by auto-fetch.
    """
    __tablename__ = "holiday_cache"

    id          = Column(Integer, primary_key=True, autoincrement=True)
    date        = Column(String,  nullable=False, unique=True, index=True)  # YYYY-MM-DD
    description = Column(String,  nullable=True)   # e.g. "端午節"
    is_holiday  = Column(Integer, nullable=False, default=1)  # 1=holiday 0=workday
    is_manual   = Column(Integer, nullable=False, default=0)  # 1=manually added
    year        = Column(Integer, nullable=False, default=0)
    source      = Column(String,  nullable=True)   # "api" | "fallback" | "manual"
    updated_at  = Column(String,  nullable=True)

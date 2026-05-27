"""
services/exports.py — Phase-4 Task 3: CSV/Excel exports.

All column names use English canonical names.
Provides exports for:
  - bookings
  - checkins (stay_logs)
  - payments
  - daily_summary
  - activity_logs
"""
import csv
import io
from datetime import datetime, date
from sqlalchemy.orm import Session
from app.models import Booking, StayLog, Payment, ActivityLog, CashierSession


def _csv_bytes(rows: list[list], headers: list[str]) -> bytes:
    buf = io.StringIO()
    w   = csv.writer(buf)
    w.writerow(headers)
    w.writerows(rows)
    return buf.getvalue().encode("utf-8-sig")   # BOM for Excel


def _today() -> str:
    return date.today().strftime("%Y-%m-%d")


# ── Bookings export ───────────────────────────────────────────────────────

def export_bookings(
    db: Session,
    date_from: str | None = None,
    date_to:   str | None = None,
) -> bytes:
    """Export all bookings in date range as CSV."""
    q = db.query(Booking)
    if date_from:
        q = q.filter(Booking.checkin >= date_from)
    if date_to:
        q = q.filter(Booking.checkin <= date_to + " 23:59")
    bookings = q.order_by(Booking.checkin.desc()).all()

    headers = [
        "booking_id", "room", "guest", "phone",
        "checkin", "checkout", "plan", "rate_type",
        "amount", "status",
        "invoice_no", "accounting_exported_at",
    ]
    rows = [[
        b.id, b.room, b.guest, b.phone or "",
        b.checkin, b.checkout, b.plan, b.rate_type or "",
        b.amount, b.status,
        "", "",   # invoice_no, accounting_exported_at — reserved
    ] for b in bookings]

    return _csv_bytes(rows, headers)


# ── Check-in / Check-out export (StayLog) ────────────────────────────────

def export_stays(
    db: Session,
    date_from: str | None = None,
    date_to:   str | None = None,
) -> bytes:
    """Export completed stays from StayLog."""
    q = db.query(StayLog)
    if date_from:
        q = q.filter(StayLog.checkin_time >= date_from)
    if date_to:
        q = q.filter(StayLog.checkin_time <= date_to + " 23:59")
    stays = q.order_by(StayLog.id.desc()).all()

    headers = [
        "id", "room", "guest", "plan",
        "checkin_time", "checkout_time",
        "base_rent", "extension_fee", "extra_fee", "total_charged",
        "free_cancel", "transferred", "new_room",
        "created_at",
    ]
    rows = [[
        sl.id, sl.room, sl.guest, sl.plan or "",
        sl.checkin_time or "", sl.checkout_time or "",
        sl.base_rent, sl.extension_fee, sl.extra_fee, sl.total_charged,
        sl.free_cancel, sl.transferred, sl.new_room or "",
        sl.created_at or "",
    ] for sl in stays]

    return _csv_bytes(rows, headers)


# ── Payments export ───────────────────────────────────────────────────────

def export_payments(
    db: Session,
    date_from: str | None = None,
    date_to:   str | None = None,
) -> bytes:
    """Export payment transactions."""
    q = db.query(Payment)
    if date_from:
        q = q.filter(Payment.created_at >= date_from)
    if date_to:
        q = q.filter(Payment.created_at <= date_to + " 23:59")
    payments = q.order_by(Payment.id.desc()).all()

    headers = [
        "id", "booking_id", "room_id", "guest",
        "payment_type", "amount", "is_deposit", "is_refund",
        "payment_status", "note",
        "invoice_no", "external_txn_id", "accounting_exported_at",
        "created_at", "created_by",
    ]
    rows = [[
        p.id, p.booking_id or "", p.room_id or "", p.guest or "",
        p.payment_type, p.amount, p.is_deposit, p.is_refund,
        p.payment_status, p.note or "",
        p.invoice_no or "", p.external_txn_id or "", p.accounting_exported_at or "",
        p.created_at, p.created_by or "",
    ] for p in payments]

    return _csv_bytes(rows, headers)


# ── Daily summary export ──────────────────────────────────────────────────

def export_daily_summary(
    db: Session,
    date_from: str | None = None,
    date_to:   str | None = None,
) -> bytes:
    """Export per-day payment summary."""
    from app.services.payments import daily_summary as _ds
    from datetime import timedelta

    d_from = datetime.strptime(date_from or _today(), "%Y-%m-%d").date()
    d_to   = datetime.strptime(date_to   or _today(), "%Y-%m-%d").date()

    headers = [
        "date", "total_received", "total_refunds", "net_revenue",
        "cash", "transfer", "card", "other",
        "deposits", "pending",
        "session_status",
    ]
    rows = []
    d = d_from
    while d <= d_to:
        ds = _ds(db, d.strftime("%Y-%m-%d"))
        bt = ds["by_type"]
        sess = ds.get("session")
        rows.append([
            ds["date"],
            ds["received"], ds["refunds"], ds["net"],
            bt.get("cash", 0), bt.get("transfer", 0),
            bt.get("card", 0), bt.get("other", 0),
            ds["deposits"], ds["pending"],
            sess.status if sess else "no_session",
        ])
        d += timedelta(days=1)

    return _csv_bytes(rows, headers)


# ── Activity log export ───────────────────────────────────────────────────

def export_activity_logs(
    db: Session,
    action_type: str | None = None,
    date_from:   str | None = None,
    date_to:     str | None = None,
    limit: int = 5000,
) -> bytes:
    """Export audit trail."""
    q = db.query(ActivityLog)
    if action_type:
        q = q.filter(ActivityLog.action_type == action_type)
    if date_from:
        q = q.filter(ActivityLog.timestamp >= date_from)
    if date_to:
        q = q.filter(ActivityLog.timestamp <= date_to + " 23:59")
    logs = q.order_by(ActivityLog.id.desc()).limit(limit).all()

    headers = [
        "id", "timestamp", "user_id", "action_type",
        "target_id", "target_type",
        "original_value", "new_value", "description",
    ]
    rows = [[
        l.id, l.timestamp, l.user_id, l.action_type,
        l.target_id or "", l.target_type or "",
        l.original_value or "", l.new_value or "", l.description or "",
    ] for l in logs]

    return _csv_bytes(rows, headers)

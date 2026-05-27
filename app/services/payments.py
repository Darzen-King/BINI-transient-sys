"""
services/payments.py — Payment module (Phase-4 Task 2).

Supports: cash | transfer | card | other
Transaction types: normal | deposit | refund | partial
"""
from datetime import datetime, date
from sqlalchemy.orm import Session
from sqlalchemy import func
from app.models import Payment, CashierSession

DT_FMT   = "%Y-%m-%d %H:%M"
DATE_FMT = "%Y-%m-%d"

PAYMENT_TYPES   = ["cash", "transfer", "card", "other"]
PAYMENT_STATUSES = ["paid", "pending", "partial", "refunded"]


def _now() -> str:
    return datetime.now().strftime(DT_FMT)

def _today() -> str:
    return date.today().strftime(DATE_FMT)


# ── CRUD ─────────────────────────────────────────────────────────────────

def create_payment(
    db: Session,
    booking_id: str | None,
    room_id: str | None,
    guest: str,
    payment_type: str,
    amount: float,
    is_deposit: bool = False,
    is_refund: bool = False,
    status: str = "paid",
    note: str = "",
    created_by: str = "admin",
    invoice_no: str | None = None,
) -> Payment:
    p = Payment(
        booking_id     = booking_id,
        room_id        = room_id,
        guest          = guest,
        payment_type   = payment_type,
        amount         = abs(amount),
        is_deposit     = 1 if is_deposit else 0,
        is_refund      = 1 if is_refund else 0,
        payment_status = status,
        note           = note,
        created_at     = _now(),
        created_by     = created_by,
        invoice_no     = invoice_no,
    )
    db.add(p)
    db.commit()
    db.refresh(p)

    # Audit log — written at service layer so it fires regardless of caller
    try:
        from app.services.audit import log_action
        action = "refund_create" if is_refund else ("deposit_create" if is_deposit else "payment_create")
        desc   = f"{'Refund' if is_refund else 'Deposit' if is_deposit else 'Payment'}: {guest} NT${abs(amount):.0f} ({payment_type})"
        if room_id:
            desc += f" → {room_id}"
        log_action(db,
            action_type = action,
            target_id   = str(p.id),
            target_type = "payment",
            new_value   = {
                "amount":       abs(amount),
                "payment_type": payment_type,
                "is_deposit":   is_deposit,
                "is_refund":    is_refund,
                "guest":        guest,
                "room_id":      room_id,
            },
            description = desc,
            user_id     = created_by,
        )
    except Exception:
        pass  # Audit log failure must never break payment creation

    return p


def get_payments(
    db: Session,
    booking_id: str | None = None,
    room_id: str | None = None,
    date_from: str | None = None,
    date_to: str | None = None,
    limit: int = 200,
) -> list[Payment]:
    q = db.query(Payment)
    if booking_id:
        q = q.filter(Payment.booking_id == booking_id)
    if room_id:
        q = q.filter(Payment.room_id == room_id)
    if date_from:
        q = q.filter(Payment.created_at >= date_from)
    if date_to:
        q = q.filter(Payment.created_at <= date_to + " 23:59")
    return q.order_by(Payment.id.desc()).limit(limit).all()


def get_balance(db: Session, booking_id: str | None = None, room_id: str | None = None) -> dict:
    """
    Returns {total_paid, total_deposit, total_refund, balance_due, overpaid}
    for a booking or room's active payments.
    """
    q = db.query(Payment)
    if booking_id:
        q = q.filter(Payment.booking_id == booking_id)
    elif room_id:
        q = q.filter(Payment.room_id == room_id)

    payments = q.all()
    total_paid    = sum(p.amount for p in payments if not p.is_refund and not p.is_deposit)
    total_deposit = sum(p.amount for p in payments if p.is_deposit and not p.is_refund)
    total_refund  = sum(p.amount for p in payments if p.is_refund)
    net_received  = total_paid + total_deposit - total_refund
    return {
        "total_paid":    total_paid,
        "total_deposit": total_deposit,
        "total_refund":  total_refund,
        "net_received":  net_received,
    }


# ── Daily cashier session ────────────────────────────────────────────────

def get_or_open_session(db: Session, opened_by: str = "admin") -> CashierSession:
    today = _today()
    session = db.query(CashierSession).filter(CashierSession.session_date == today).first()
    if not session:
        session = CashierSession(
            session_date = today,
            opened_by    = opened_by,
            opened_at    = _now(),
            status       = "open",
        )
        db.add(session)
        db.commit()
        db.refresh(session)
    return session


def close_session(db: Session, closed_by: str = "admin", note: str = "") -> CashierSession:
    """Compute totals and close today's session."""
    session = get_or_open_session(db, closed_by)
    today   = _today()
    payments = db.query(Payment).filter(Payment.created_at >= today).all()

    def _sum(pred):
        return sum(p.amount for p in payments if pred(p))

    session.total_cash     = _sum(lambda p: p.payment_type == "cash"     and not p.is_refund)
    session.total_transfer = _sum(lambda p: p.payment_type == "transfer" and not p.is_refund)
    session.total_card     = _sum(lambda p: p.payment_type == "card"     and not p.is_refund)
    session.total_other    = _sum(lambda p: p.payment_type == "other"    and not p.is_refund)
    session.total_refunds  = _sum(lambda p: p.is_refund)
    session.total_deposits = _sum(lambda p: p.is_deposit and not p.is_refund)
    session.total_expected = (session.total_cash + session.total_transfer +
                               session.total_card + session.total_other)
    session.status    = "closed"
    session.closed_by = closed_by
    session.closed_at = _now()
    session.note      = note
    db.commit()
    db.refresh(session)
    return session


def daily_summary(db: Session, target_date: str | None = None) -> dict:
    """Return payment totals for a given date (default: today)."""
    d = target_date or _today()
    # 問題 9 FIX: use 23:59:59 so the full last minute of the day is included
    payments = db.query(Payment).filter(Payment.created_at >= d).filter(
        Payment.created_at <= d + " 23:59:59").all()

    received  = sum(p.amount for p in payments if not p.is_refund)
    refunds   = sum(p.amount for p in payments if p.is_refund)
    deposits  = sum(p.amount for p in payments if p.is_deposit and not p.is_refund)
    by_type = {}
    for pt in PAYMENT_TYPES:
        by_type[pt] = sum(p.amount for p in payments if p.payment_type == pt and not p.is_refund)

    pending = db.query(Payment).filter(
        Payment.payment_status.in_(["pending", "partial"]),
        Payment.is_refund == 0,
    ).all()
    pending_amt = sum(p.amount for p in pending)

    session = db.query(CashierSession).filter(CashierSession.session_date == d).first()

    return {
        "date":       d,
        "received":   received,
        "refunds":    refunds,
        "deposits":   deposits,
        "net":        received - refunds,
        "by_type":    by_type,
        "pending":    pending_amt,
        "session":    session,
        "tx_count":   len(payments),
    }

"""
services/costs.py — Operating Cost Module
Handles CRUD for cost_entries and monthly P&L calculation.
All category values are canonical English keys.
"""
from datetime import datetime, date
from sqlalchemy.orm import Session
from app.models import CostEntry, Payment

DT_FMT   = "%Y-%m-%d %H:%M"
DATE_FMT = "%Y-%m-%d"

# ── Canonical category keys (i18n resolved in template) ──────────────────────
COST_CATEGORIES = [
    "utilities",
    "cleaning_supplies",
    "laundry",
    "maintenance",
    "consumables",
    "staff",
    "rent",
    "internet_software",
    "marketing",
    "misc",
]

PAYMENT_METHODS = ["cash", "transfer", "card", "other"]


def _now() -> str:
    return datetime.now().strftime(DT_FMT)


# ── CRUD ─────────────────────────────────────────────────────────────────────

def create_cost(
    db: Session,
    cost_date:      str,
    category:       str,
    amount:         float,
    payment_method: str  = "cash",
    subcategory:    str  = "",
    vendor:         str  = "",
    description:    str  = "",
    note:           str  = "",
    is_recurring:   bool = False,
    receipt_no:     str  = "",
    property_id:    str  = "",
    created_by:     str  = "admin",
) -> CostEntry:
    entry = CostEntry(
        cost_date      = cost_date,
        category       = category,
        subcategory    = subcategory or None,
        amount         = abs(float(amount)),
        payment_method = payment_method,
        vendor         = vendor or None,
        description    = description or None,
        note           = note or None,
        is_recurring   = 1 if is_recurring else 0,
        receipt_no     = receipt_no or None,
        property_id    = property_id or None,
        created_by     = created_by,
        created_at     = _now(),
        updated_at     = _now(),
    )
    db.add(entry)
    db.commit()
    db.refresh(entry)
    return entry


def update_cost(
    db: Session,
    entry_id: int,
    **kwargs,
) -> CostEntry | None:
    entry = db.query(CostEntry).filter(CostEntry.id == entry_id).first()
    if not entry:
        return None
    allowed = {
        "cost_date", "category", "subcategory", "amount", "payment_method",
        "vendor", "description", "note", "is_recurring", "receipt_no", "property_id",
    }
    for k, v in kwargs.items():
        if k in allowed:
            setattr(entry, k, v)
    entry.updated_at = _now()
    db.commit()
    db.refresh(entry)
    return entry


def delete_cost(db: Session, entry_id: int) -> bool:
    entry = db.query(CostEntry).filter(CostEntry.id == entry_id).first()
    if not entry:
        return False
    db.delete(entry)
    db.commit()
    return True


def get_costs(
    db:             Session,
    year_month:     str | None = None,   # "YYYY-MM"
    category:       str | None = None,
    property_id:    str | None = None,
    payment_method: str | None = None,
    limit:          int        = 500,
) -> list[CostEntry]:
    q = db.query(CostEntry)
    if year_month:
        q = q.filter(CostEntry.cost_date.like(f"{year_month}%"))
    if category:
        q = q.filter(CostEntry.category == category)
    if property_id:
        q = q.filter(CostEntry.property_id == property_id)
    if payment_method:
        q = q.filter(CostEntry.payment_method == payment_method)
    return q.order_by(CostEntry.cost_date.desc(), CostEntry.id.desc()).limit(limit).all()


def get_cost_by_id(db: Session, entry_id: int) -> CostEntry | None:
    return db.query(CostEntry).filter(CostEntry.id == entry_id).first()


# ── P&L Calculation ───────────────────────────────────────────────────────────

def monthly_pnl(
    db:          Session,
    year_month:  str,          # "YYYY-MM"
    property_id: str | None = None,
) -> dict:
    """
    Calculate monthly P&L.

    Revenue: sum of payments received this month (excluding refunds),
             falls back to report_summary if no payments found.
    Cost:    sum of cost_entries for the month.
    """
    date_from = f"{year_month}-01"
    # String comparison: all valid dates (YYYY-MM-DD) are ≤ "YYYY-MM-31"
    date_to   = f"{year_month}-31"

    # ── Revenue ──────────────────────────────────────────────────────────────
    # BUG-B FIX: count only StayLog.total_charged for completed stays.
    # StayLog.total_charged already = full amount (base + ext + extra), which
    # encompasses any deposit collected for that stay. Adding deposit payments
    # on top double-counts for stays that check in and out in the same month.
    # For active stays (not yet checked out), their value surfaces via
    # live_revenue in the reports page — not captured here.
    revenue = 0.0
    try:
        from app.models import StayLog

        # 已退房完成的住宿費（checkin 在本月）
        for sl in db.query(StayLog).all():
            try:
                ci = (sl.checkin_time or "")[:7]
                if ci == year_month and not sl.free_cancel and not sl.transferred:
                    revenue += float(sl.total_charged or 0)
            except Exception:
                pass

        # 月租套房租金（以實際收款月份認列，非 start_date）
        from app.services.monthly import monthly_rent_for_month as _mrfm
        revenue += _mrfm(db, year_month)

    except Exception:
        revenue = 0.0

    # ── Costs ─────────────────────────────────────────────────────────────────
    cost_q = db.query(CostEntry).filter(
        CostEntry.cost_date >= date_from,
        CostEntry.cost_date <= date_to,
    )
    if property_id:
        cost_q = cost_q.filter(CostEntry.property_id == property_id)
    costs = cost_q.all()

    total_cost = sum(c.amount for c in costs)

    # Cost by category
    by_category: dict[str, float] = {}
    for c in costs:
        by_category[c.category] = by_category.get(c.category, 0) + c.amount

    # ── P&L ───────────────────────────────────────────────────────────────────
    gross_profit = revenue - total_cost
    # Avoid division by zero
    cost_ratio = round((total_cost / revenue * 100), 1) if revenue > 0 else None

    return {
        "year_month":   year_month,
        "revenue":      round(revenue, 0),
        "refunds":      0,
        "total_cost":   round(total_cost, 0),
        "gross_profit": round(gross_profit, 0),
        "cost_ratio":   cost_ratio,
        "by_category":  by_category,
        "profitable":   gross_profit >= 0,
        "entry_count":  len(costs),
    }


def available_months(db: Session, n: int = 12) -> list[str]:
    """Return last n months as ['YYYY-MM', ...] descending."""
    today = date.today()
    months = []
    year, month = today.year, today.month
    for _ in range(n):
        months.append(f"{year:04d}-{month:02d}")
        month -= 1
        if month == 0:
            month = 12
            year -= 1
    return months

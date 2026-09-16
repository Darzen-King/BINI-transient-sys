"""
services/costs.py — Operating Cost Module
Handles CRUD for cost_entries and monthly P&L calculation.
All category values are canonical English keys.
"""
from datetime import datetime, date, timedelta
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
    date_from:      str | None = None,   # "YYYY-MM-DD", inclusive
    date_to:        str | None = None,   # "YYYY-MM-DD", inclusive
) -> list[CostEntry]:
    q = db.query(CostEntry)
    if year_month:
        q = q.filter(CostEntry.cost_date.like(f"{year_month}%"))
    if date_from:
        q = q.filter(CostEntry.cost_date >= date_from[:10])
    if date_to:
        q = q.filter(CostEntry.cost_date <= date_to[:10])
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


def cost_in_range(
    db:          Session,
    date_from:   str,          # "YYYY-MM-DD"
    date_to:     str,          # "YYYY-MM-DD"
    property_id: str | None = None,
) -> dict:
    """Total cost + per-category breakdown for cost_entries within [from, to]
    (inclusive). Used by the reports page (admin-only) alongside range_revenue."""
    df, dt = date_from[:10], date_to[:10]
    q = db.query(CostEntry).filter(
        CostEntry.cost_date >= df,
        CostEntry.cost_date <= dt,
    )
    if property_id:
        q = q.filter(CostEntry.property_id == property_id)
    rows = q.order_by(CostEntry.cost_date, CostEntry.id).all()
    total = sum(c.amount for c in rows)
    by_category: dict[str, float] = {}
    for c in rows:
        by_category[c.category] = by_category.get(c.category, 0) + c.amount
    return {
        "total_cost":  round(total, 0),
        "by_category": by_category,
        "entry_count": len(rows),
        # Individual rows (oldest first) for the report detail list and the CSV export.
        "entries": [
            {
                "cost_date":      c.cost_date,
                "category":       c.category,
                "amount":         int(round(float(c.amount or 0))),
                "payment_method": c.payment_method or "",
                "vendor":         c.vendor or "",
                "description":    c.description or "",
                "note":           c.note or "",
            }
            for c in rows
        ],
    }


def range_pnl(
    db:          Session,
    date_from:   str,
    date_to:     str,
    property_id: str | None = None,
) -> dict:
    """P&L for any date range, shaped like monthly_pnl so the cost page renders either.

    Revenue uses the same recognition as the reports page (completed stays by check-in date plus
    recognised monthly rent), so the cost page and 統計報表 always show the same numbers."""
    from app.services.reports import compute_report
    report = compute_report(db, date_from, date_to, property_id=property_id)
    revenue = float(report.get("range_revenue") or 0)
    cost = cost_in_range(db, date_from, date_to, property_id)
    total_cost = float(cost["total_cost"])
    gross_profit = revenue - total_cost
    return {
        "date_from":    date_from,
        "date_to":      date_to,
        "revenue":      round(revenue, 0),
        "refunds":      0,
        "total_cost":   round(total_cost, 0),
        "gross_profit": round(gross_profit, 0),
        "cost_ratio":   round(total_cost / revenue * 100, 1) if revenue > 0 else None,
        "by_category":  cost["by_category"],
        "profitable":   gross_profit >= 0,
        "entry_count":  cost["entry_count"],
    }


def resolve_cost_range(date_from: str, date_to: str, year_month: str, today: date) -> tuple[str, str]:
    """Explicit dates win; an old ?year_month= link means that whole month; otherwise this month so far."""
    def valid(value: str) -> str | None:
        try:
            return datetime.strptime((value or "")[:10], "%Y-%m-%d").strftime("%Y-%m-%d")
        except ValueError:
            return None
    start, end = valid(date_from), valid(date_to)
    if not start and not end and year_month:
        try:
            first = datetime.strptime(year_month[:7], "%Y-%m").date()
            nxt = date(first.year + (first.month == 12), 1 if first.month == 12 else first.month + 1, 1)
            return first.strftime("%Y-%m-%d"), (nxt - timedelta(days=1)).strftime("%Y-%m-%d")
        except ValueError:
            pass
    start = start or today.replace(day=1).strftime("%Y-%m-%d")
    end = end or today.strftime("%Y-%m-%d")
    return (end, start) if start > end else (start, end)


def cost_quick_ranges(today: date) -> list[tuple[str, str, str]]:
    """(i18n key, from, to) for the cost page's one-tap history ranges."""
    first_this = today.replace(day=1)
    last_prev = first_this - timedelta(days=1)
    return [
        ("costs.quick.this_month", first_this.strftime("%Y-%m-%d"), today.strftime("%Y-%m-%d")),
        ("costs.quick.last_month", last_prev.replace(day=1).strftime("%Y-%m-%d"), last_prev.strftime("%Y-%m-%d")),
        ("costs.quick.last_30", (today - timedelta(days=29)).strftime("%Y-%m-%d"), today.strftime("%Y-%m-%d")),
        ("costs.quick.this_year", today.replace(month=1, day=1).strftime("%Y-%m-%d"), today.strftime("%Y-%m-%d")),
        ("costs.quick.all", "2000-01-01", today.strftime("%Y-%m-%d")),
    ]


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

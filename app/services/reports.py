"""
services/reports.py — Phase-3 Report Engine.

New in Phase-3:
  - daily_series(): per-day revenue + occupancy for trend charts
  - plan_breakdown(): 12hrs vs 24hrs distribution
  - revenue_by_room_type(): per-plan revenue split
  - compute_report(): extended with chart data
  - export_csv(): return CSV bytes for download
"""
import csv
import io
from datetime import datetime, timedelta
from sqlalchemy.orm import Session
from app.models import Booking, ActiveStay, Room, ReportSummary, StayLog

DT_FMT    = "%Y-%m-%d %H:%M"
DATE_FMT  = "%Y-%m-%d"
# BUG 5 FIX: include "已入住" to prevent double-counting.
# bookings.py CANCELLED_STATUSES already excludes it from the active booking list;
# here we must also exclude it so its b.amount is not added on top of StayLog revenue.
CANCELLED = {"已取消", "No-show", "已入住"}
PLAN_HOURS = {"24hrs": 24, "12hrs": 12}
ROOM_STATUS_I18N = {
    "可入住": "status.available", "使用中": "status.occupied",
    "即將退房": "status.checkout_soon", "待清潔": "status.cleaning",
    "維修中": "status.maintenance",
}


# ── helpers ───────────────────────────────────────────────────────────────

def _parse_dt(s: str | None) -> datetime | None:
    if not s:
        return None
    s = s.strip()[:16]
    for fmt in (DT_FMT, DATE_FMT):
        try:
            return datetime.strptime(s, fmt)
        except ValueError:
            continue
    return None


def _in_range(dt_str: str | None, date_from: datetime, date_to: datetime) -> bool:
    dt = _parse_dt(dt_str)
    return bool(dt and date_from <= dt <= date_to)


def today_range() -> tuple[str, str]:
    now = datetime.now()
    start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    return start.strftime(DATE_FMT), now.strftime(DATE_FMT)


def _date_list(date_from: datetime, date_to: datetime) -> list[str]:
    """Return list of 'YYYY-MM-DD' strings from date_from to date_to."""
    days = []
    cur = date_from.replace(hour=0, minute=0, second=0)
    end = date_to.replace(hour=23, minute=59, second=59)
    while cur <= end:
        days.append(cur.strftime(DATE_FMT))
        cur += timedelta(days=1)
    return days


# ── daily time series ─────────────────────────────────────────────────────

def _daily_series(
    active_bookings: list,
    stay_logs: list,
    total_rooms: int,
    date_from: datetime,
    date_to: datetime,
) -> dict:
    """
    Build per-day aggregates for charts.
    Returns:
      labels     : ["2026-04-01", ...]
      revenue    : [1200, 800, ...]  — daily revenue (bookings + completed stays)
      occupancy  : [66.7, 33.3, ...] — % rooms with checkin on that day
    """
    days = _date_list(date_from, date_to)
    rev_map: dict[str, float] = {d: 0.0 for d in days}
    occ_map: dict[str, int]   = {d: 0   for d in days}

    # From bookings
    for b in active_bookings:
        dt = _parse_dt(b.checkin)
        if dt:
            day = dt.strftime(DATE_FMT)
            if day in rev_map:
                rev_map[day] += b.amount
                occ_map[day] += 1

    # From StayLog (completed stays in range)
    for sl in stay_logs:
        dt = _parse_dt(sl.checkin_time)
        if dt:
            day = dt.strftime(DATE_FMT)
            if day in rev_map:
                rev_map[day] += sl.total_charged

    occ_pct = [round(occ_map[d] / total_rooms * 100, 1) for d in days]

    return {
        "labels":    days,
        "revenue":   [round(rev_map[d], 0) for d in days],
        "occupancy": occ_pct,
    }


# ── plan & revenue breakdown ──────────────────────────────────────────────

def _plan_breakdown(active_bookings: list, stay_logs: list) -> dict:
    """Count and revenue split by plan (12hrs / 24hrs)."""
    counts:  dict[str, int]   = {}
    revenue: dict[str, float] = {}

    for b in active_bookings:
        counts[b.plan]  = counts.get(b.plan, 0) + 1
        revenue[b.plan] = revenue.get(b.plan, 0.0) + b.amount

    for sl in stay_logs:
        p = sl.plan or "24hrs"
        counts[p]  = counts.get(p, 0) + 1
        revenue[p] = revenue.get(p, 0.0) + sl.total_charged

    return {"counts": counts, "revenue": revenue}


# ── core engine ───────────────────────────────────────────────────────────

def compute_report(
    db: Session,
    date_from_str: str | None = None,
    date_to_str:   str | None = None,
    property_id:   str | None = None,
) -> dict:
    """
    If property_id is given, filter rooms and bookings to that property only.
    """
    now = datetime.now()
    if not date_from_str:
        date_from_str = now.replace(day=1).strftime(DATE_FMT)
    if not date_to_str:
        date_to_str = now.strftime(DATE_FMT)

    try:
        date_from = datetime.strptime(date_from_str, DATE_FMT)
    except ValueError:
        date_from = now.replace(day=1, hour=0, minute=0)
    try:
        date_to = datetime.strptime(date_to_str, DATE_FMT).replace(hour=23, minute=59)
    except ValueError:
        date_to = now.replace(hour=23, minute=59)

    # ── base data ─────────────────────────────────────────────────────
    all_bookings    = db.query(Booking).all()
    range_bookings  = [b for b in all_bookings if _in_range(b.checkin, date_from, date_to)]
    active_bookings = [b for b in range_bookings if b.status not in CANCELLED]
    cancelled       = [b for b in range_bookings if b.status in CANCELLED]

    stay_logs_all = db.query(StayLog).filter(
        StayLog.free_cancel == 0,
        StayLog.transferred == 0,
    ).all()
    stay_logs_range = [sl for sl in stay_logs_all
                       if _in_range(sl.checkin_time, date_from, date_to)]

    rooms        = db.query(Room).all()
    if property_id:
        rooms = [r for r in rooms if getattr(r, 'property_id', None) == property_id]
    total_rooms  = max(len(rooms), 1)
    active_stays = db.query(ActiveStay).all()
    seed         = db.query(ReportSummary).first()

    # ── revenue ───────────────────────────────────────────────────────
    # 精準計算：StayLog（已退房完成）+ 押金（已收）
    staylog_revenue  = sum(sl.total_charged for sl in stay_logs_range)

    # Deposit payments in date range
    from app.models import Payment as _Pay
    deposits_range = [
        pay for pay in db.query(_Pay).all()
        if pay.is_deposit == 1 and not pay.is_refund
        and _in_range(pay.created_at, date_from, date_to)
    ]
    deposit_revenue = sum(float(d.amount or 0) for d in deposits_range)

    range_revenue    = staylog_revenue + deposit_revenue

    # Keep booking_revenue for backward compat (used in daily chart)
    booking_revenue  = sum(b.amount for b in active_bookings)
    hist_revenue     = seed.total_revenue if seed else 0.0
    total_revenue    = hist_revenue + staylog_revenue
    live_revenue     = sum(s.total_due for s in active_stays)

    # ── orders ────────────────────────────────────────────────────────
    total_orders    = len(active_bookings) + len(stay_logs_range)
    cancelled_count = len(cancelled)

    # ── occupancy ────────────────────────────────────────────────────
    occupied_now     = sum(1 for r in rooms if r.status in ("使用中", "即將退房"))
    occupancy_now    = round(occupied_now / total_rooms * 100, 1)
    rooms_with_bk    = len({b.room for b in active_bookings})
    range_occupancy  = round(rooms_with_bk / total_rooms * 100, 1)

    # ── avg stay ─────────────────────────────────────────────────────
    stay_h      = [PLAN_HOURS.get(b.plan, 24) for b in active_bookings]
    avg_stay_hrs = round(sum(stay_h) / len(stay_h), 1) if stay_h else 0

    # ── repair ───────────────────────────────────────────────────────
    # 問題 7 FIX: seed.repair_count is a static seed value that is never updated;
    # adding it to repair_rooms_now produced a meaningless inflated number.
    repair_rooms_now = sum(1 for r in rooms if r.status == "維修中")
    repair_count     = repair_rooms_now

    # ── status breakdowns ─────────────────────────────────────────────
    bk_status: dict[str, int] = {}
    for b in range_bookings:
        bk_status[b.status] = bk_status.get(b.status, 0) + 1
    rm_status: dict[str, int] = {}
    for r in rooms:
        rm_status[r.status] = rm_status.get(r.status, 0) + 1

    # ── per-room rental ───────────────────────────────────────────────
    room_rentals: dict[str, dict] = {
        r.id: {"id": r.id, "status": r.status, "note": r.note or "",
               "count": 0, "revenue": 0.0, "plans": {}}
        for r in rooms
    }
    for b in active_bookings:
        d = room_rentals.setdefault(b.room, {"id": b.room, "status": "—", "note": "",
                                               "count": 0, "revenue": 0.0, "plans": {}})
        d["count"]   += 1
        d["revenue"] += b.amount
        d["plans"][b.plan] = d["plans"].get(b.plan, 0) + 1

    for sl in stay_logs_range:
        d = room_rentals.setdefault(sl.room, {"id": sl.room, "status": "—", "note": "",
                                               "count": 0, "revenue": 0.0, "plans": {}})
        d["count"]   += 1
        d["revenue"] += sl.total_charged
        if sl.plan:
            d["plans"][sl.plan] = d["plans"].get(sl.plan, 0) + 1

    room_rental_list = sorted(room_rentals.values(), key=lambda x: (-x["count"], x["id"]))

    # ── Phase-3: chart data ───────────────────────────────────────────
    daily   = _daily_series(active_bookings, stay_logs_range, total_rooms, date_from, date_to)
    plans   = _plan_breakdown(active_bookings, stay_logs_range)
    delta_days = (date_to - date_from).days + 1

    # Revenue by rate_type (weekday vs holiday)
    rate_revenue: dict[str, float] = {}
    for b in active_bookings:
        rt = b.rate_type or "非假日"
        rate_revenue[rt] = rate_revenue.get(rt, 0.0) + b.amount

    return {
        "date_from": date_from_str,
        "date_to":   date_to_str,
        "period":    f"{date_from_str} ~ {date_to_str} ({delta_days} days)",
        "delta_days": delta_days,
        # Revenue
        "total_revenue":       round(total_revenue, 0),
        "range_revenue":       round(range_revenue, 0),
        "booking_revenue":     round(booking_revenue, 0),
        "staylog_revenue":     round(staylog_revenue, 0),
        "live_revenue":        round(live_revenue, 0),
        # Orders
        "total_orders":        total_orders,
        "cancelled_orders":    cancelled_count,
        # Occupancy
        "total_rooms":         total_rooms,
        "occupied_now":        occupied_now,
        "occupancy_now_pct":   occupancy_now,
        "range_occupancy_pct": range_occupancy,
        "rooms_with_booking":  rooms_with_bk,
        # Quality
        "loss_count":          cancelled_count,
        "repair_count":        repair_count,
        "repair_rooms_now":    repair_rooms_now,
        # Stay
        "avg_stay_hrs":        avg_stay_hrs,
        "active_stays_count":  len(active_stays),
        # Breakdowns
        "booking_status_breakdown": bk_status,
        "room_status_breakdown":    rm_status,
        "room_rental_list":         room_rental_list,
        # Chart data (Phase-3)
        "daily":               daily,          # {labels, revenue, occupancy}
        "plan_breakdown":      plans,          # {counts, revenue}
        "rate_revenue":        rate_revenue,   # {"非假日": x, "假日": y}
    }


# ── CSV export ────────────────────────────────────────────────────────────

def export_csv(db: Session, date_from_str: str, date_to_str: str) -> bytes:
    """
    Generate CSV bytes with three sections:
      1. Summary KPIs
      2. Daily revenue + occupancy
      3. Per-room rental stats
    """
    report = compute_report(db, date_from_str, date_to_str)
    buf    = io.StringIO()
    w      = csv.writer(buf)

    # Section 1: Summary
    w.writerow(["=== BINI Blooms Report ==="])
    w.writerow(["Period", report["period"]])
    w.writerow(["Total Revenue (NT$)", report["range_revenue"]])
    w.writerow(["Total Orders", report["total_orders"]])
    w.writerow(["Cancelled", report["cancelled_orders"]])
    w.writerow(["Occupancy Now (%)", report["occupancy_now_pct"]])
    w.writerow(["Period Occupancy (%)", report["range_occupancy_pct"]])
    w.writerow(["Avg Stay (hrs)", report["avg_stay_hrs"]])
    w.writerow(["Repairs", report["repair_count"]])
    w.writerow([])

    # Section 2: Daily
    w.writerow(["=== Daily Breakdown ==="])
    w.writerow(["Date", "Revenue (NT$)", "Occupancy (%)"])
    daily = report["daily"]
    for label, rev, occ in zip(daily["labels"], daily["revenue"], daily["occupancy"]):
        w.writerow([label, rev, occ])
    w.writerow([])

    # Section 3: Per-room
    w.writerow(["=== Per-Room Statistics ==="])
    w.writerow(["Room", "Status", "Rentals", "Revenue (NT$)", "12hrs", "24hrs", "Note"])
    for rm in report["room_rental_list"]:
        w.writerow([
            rm["id"], rm["status"], rm["count"],
            round(rm["revenue"], 0),
            rm["plans"].get("12hrs", 0),
            rm["plans"].get("24hrs", 0),
            rm["note"],
        ])

    return buf.getvalue().encode("utf-8-sig")  # utf-8-sig for Excel compatibility

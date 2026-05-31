"""
services/fee_engine.py — Extension Fee Engine

Pricing rules
─────────────
Base rates determined by check-in date:
  Weekday  : 12hrs = NT$800,  24hrs = NT$1,000
  Holiday  : 12hrs = NT$1,000, 24hrs = NT$1,200

Holiday definition (Taiwan):
  1. Saturday and Sunday (weekday() == 5 or 6)
  2. The day BEFORE Saturday/Sunday (Friday = weekday() == 4)
  3. Taiwan government-announced national holidays (hardcoded list,
     updated annually from 行政院人事行政總處公告)

Hourly rate for extensions: NT$200 / hr (fixed)

Calculation per 12-hour BLOCK starting from hour 0 of the extension:
  Block n covers hours [ n*12 , (n+1)*12 )
  Each block has a CEILING = the appropriate plan rate.

  Within a block of h_block hours (0 ≤ h_block ≤ 12):
    raw = 200 × h_block
    fee = min(raw, block_ceiling)

  Block ceilings cycle: 12hr-rate, 24hr-rate−12hr-rate, 12hr-rate, …
"""
from datetime import datetime, date, timedelta

HOURLY = 200.0  # NT$ per hour

RATES: dict[str, dict[str, float]] = {
    "weekday": {"12hrs": 800.0,  "24hrs": 1000.0},
    "holiday": {"12hrs": 1000.0, "24hrs": 1200.0},
}

# ── Taiwan national holidays ──────────────────────────────────────────────────
# Source: 行政院人事行政總處 補班補課日程表
# Format: "YYYY-MM-DD"
# Update this list annually.
TW_NATIONAL_HOLIDAYS: set[str] = {
    # 2025
    "2025-01-01",  # 元旦
    "2025-01-27", "2025-01-28", "2025-01-29", "2025-01-30",
    "2025-01-31", "2025-02-03",               # 農曆春節連假
    "2025-02-28",                              # 和平紀念日
    "2025-04-03", "2025-04-04",               # 兒童節/清明節
    "2025-05-01",                              # 勞動節
    "2025-06-02",                              # 端午節
    "2025-09-03",                              # 軍人節（國定）
    "2025-10-06",                              # 中秋節 (adjust date each year)
    "2025-10-10",                              # 國慶日
    # 2026（依行政院人事行政總處公告，資料截至2025年）
    "2026-01-01",                              # 元旦
    "2026-02-15",                              # 小年夜（新增，農曆除夕前一日）
    "2026-02-17", "2026-02-18", "2026-02-19", # 農曆春節（初一~初三）
    "2026-02-27",                              # 和平紀念日補假（2/28逢六）
    "2026-04-03", "2026-04-04",               # 兒童節補假(4/3) / 清明節(4/4)
    "2026-05-01",                              # 勞動節
    "2026-06-19",                              # 端午節（農曆五月初五）← 修正（原錯誤為05-20）
    "2026-09-25",                              # 中秋節
    "2026-09-28",                              # 孔子誕辰紀念日/教師節（新增）
    "2026-10-09",                              # 國慶日補假（10/10逢六）
    "2026-10-26",                              # 台灣光復節補假（10/25逢日，新增）
    "2026-12-25",                              # 行憲紀念日（新增）
}

# Makeup workdays (補班日) — these are WEEKDAY even if Saturday
TW_MAKEUP_WORKDAYS: set[str] = {
    "2025-01-18",  # 補班
    "2026-01-17",  # 補班
}


def is_holiday(d: date, db=None) -> bool:
    """
    Return True if date should charge holiday rate.
    Rules:
      1. Saturday or Sunday  → always holiday
      2. Friday              → holiday (eve of Saturday)
      3. National holiday itself
      4. Day before a national holiday
      5. Compensatory holiday (補假日) — counted from DB/static list

    DB cache (holiday_cache table) takes priority when available.
    Falls back to static TW_NATIONAL_HOLIDAYS if DB unavailable.
    補班日 on Sat/Sun → still counts as holiday rate per system policy.
    """
    ds = d.strftime("%Y-%m-%d")
    wd = d.weekday()  # 0=Mon…6=Sun

    # Saturday or Sunday — always holiday rate
    if wd in (5, 6):
        return True

    # ── Try DB holiday cache first ────────────────────────────────────────
    if db is not None:
        try:
            from app.models import HolidayCache
            from sqlalchemy import func as _func

            row = db.query(HolidayCache).filter(HolidayCache.date == ds).first()
            if row is not None:
                return row.is_holiday == 1

            # Eve rule: check if tomorrow is a DB holiday
            tomorrow_str = (d + timedelta(days=1)).strftime("%Y-%m-%d")
            next_row = db.query(HolidayCache).filter(
                HolidayCache.date == tomorrow_str,
                HolidayCache.is_holiday == 1,
            ).first()
            if next_row:
                return True

            # DB has entries for this year → not in list = workday
            year_count = db.query(HolidayCache).filter(
                HolidayCache.year == d.year
            ).count()
            if year_count > 3:
                # Only Friday eve-of-Saturday rule still applies
                return wd == 4
        except Exception:
            pass  # DB not ready, use static fallback

    # ── Static fallback ───────────────────────────────────────────────────
    if wd == 4:          # Friday — eve of Saturday
        return True
    if ds in TW_NATIONAL_HOLIDAYS:
        return True
    tomorrow = (d + timedelta(days=1)).strftime("%Y-%m-%d")
    if tomorrow in TW_NATIONAL_HOLIDAYS:
        return True
    return False


def get_rate_type(d: date, db=None) -> str:
    """Return 'holiday' or 'weekday' for the given date."""
    return "holiday" if is_holiday(d, db) else "weekday"

def get_holiday_dates_from_db(db) -> set:
    """
    Return a set of "YYYY-MM-DD" strings that are holidays, sourced from DB.
    Merges DB entries (including manual entries) with TW_NATIONAL_HOLIDAYS.
    Used by routers to populate the JS calendar highlight list.
    Falls back to TW_NATIONAL_HOLIDAYS if DB is unavailable.
    """
    result = set(TW_NATIONAL_HOLIDAYS)
    if db is None:
        return result
    try:
        from app.models import HolidayCache
        rows = db.query(HolidayCache).filter(HolidayCache.is_holiday == 1).all()
        for row in rows:
            result.add(row.date)
        # Remove makeup workdays (is_holiday=0 entries override static list)
        non_holiday_rows = db.query(HolidayCache).filter(HolidayCache.is_holiday == 0).all()
        for row in non_holiday_rows:
            result.discard(row.date)
    except Exception:
        pass
    return result




def get_base_rent(plan: str, checkin_dt: datetime) -> float:
    """
    Return the correct base rent for a given plan and check-in datetime.
    Used by checkin and booking forms.
    """
    rt = get_rate_type(checkin_dt.date())
    return RATES[rt][plan]


def _rate_type_for_date(dt: datetime) -> str:
    return get_rate_type(dt.date())


def _rates_for_date(dt: datetime) -> tuple[float, float]:
    rt = _rate_type_for_date(dt)
    r  = RATES[rt]
    return r["12hrs"], r["24hrs"]


def calc_extension_fee(
    extension_hours: float,
    start_dt: datetime,
) -> tuple[float, list[dict]]:
    """
    Calculate total extension fee and return a breakdown.
    start_dt = original planned checkout time.
    """
    if extension_hours <= 0:
        return 0.0, []

    breakdown = []
    total_fee = 0.0
    remaining = float(extension_hours)
    block_idx = 0

    while remaining > 0:
        block_start_dt = start_dt + timedelta(hours=block_idx * 12)
        r12, r24       = _rates_for_date(block_start_dt)

        if block_idx % 2 == 0:
            ceiling = r12
        else:
            ceiling = r24 - r12

        h_block = min(remaining, 12.0)
        raw_fee = HOURLY * h_block
        blk_fee = min(raw_fee, ceiling)

        breakdown.append({
            "block":      block_idx + 1,
            "date_label": block_start_dt.strftime("%Y-%m-%d (%a)"),
            "rate_type":  _rate_type_for_date(block_start_dt),
            "ceiling":    int(ceiling),
            "hours":      round(h_block, 2),
            "raw":        int(raw_fee),
            "fee":        int(blk_fee),
        })

        total_fee += blk_fee
        remaining -= h_block
        block_idx += 1

    return round(total_fee, 0), breakdown


# ── Stay-timeline helpers ───────────────────────────────────────────────────
# The block-ceiling cycle (12hr-rate, 24hr−12hr, 12hr-rate, …) is anchored to
# the CHECK-IN moment, because the rate plan caps apply to the whole stay:
#   hours [0,12)  → 12hr-rate          (this is the base 12hr plan)
#   hours [12,24) → 24hr-rate − 12hr   (extending to 24hr only costs the gap)
#   hours [24,36) → 12hr-rate (new day), …
# So an extension's fee is the difference of cumulative stay charges, NOT a
# fresh "block 0" starting at the planned checkout (which over-charged, e.g.
# a 12hr→24hr same-stay extension wrongly billed the next-day 12hr cap NT$800
# instead of the NT$200 plan gap).

def stay_charge(checkin_dt: datetime, hours: float) -> float:
    """Total room charge from check-in for `hours`, using the block model."""
    if hours <= 0:
        return 0.0
    fee, _ = calc_extension_fee(hours, checkin_dt)
    return fee


def extension_fee_between(
    checkin_dt: datetime,
    from_hours: float,
    to_hours: float,
) -> float:
    """
    Marginal block fee for extending a stay from `from_hours` to `to_hours`,
    both measured from check-in. Equals stay_charge(to) − stay_charge(from).
    """
    if to_hours <= from_hours:
        return 0.0
    return max(0.0, round(stay_charge(checkin_dt, to_hours)
                          - stay_charge(checkin_dt, from_hours), 0))


def extension_breakdown(
    checkin_dt: datetime,
    from_hours: float,
    to_hours: float,
) -> tuple[float, list[dict]]:
    """
    Return (fee, breakdown) for the extension portion only — i.e. the 12-hour
    blocks of the stay timeline that fall beyond `from_hours`. Blocks are
    renumbered from 1 for display.
    """
    if to_hours <= from_hours:
        return 0.0, []
    _, full_bd = calc_extension_fee(to_hours, checkin_dt)
    from_blocks = int(round(from_hours / 12.0))
    ext_bd = [dict(b) for b in full_bd if b["block"] > from_blocks]
    for i, b in enumerate(ext_bd):
        b["block"] = i + 1
    return extension_fee_between(checkin_dt, from_hours, to_hours), ext_bd


def preview_extension(
    extension_hours: float,
    checkin_time_str: str | None,
    checkout_time_str: str | None,
) -> dict:
    DT_FMT = "%Y-%m-%d %H:%M"
    now = datetime.now()

    checkin_dt = None
    if checkin_time_str:
        try:
            checkin_dt = datetime.strptime(checkin_time_str[:16], DT_FMT)
        except ValueError:
            checkin_dt = None

    current_co_dt = now
    if checkout_time_str:
        try:
            current_co_dt = datetime.strptime(checkout_time_str[:16], DT_FMT)
        except ValueError:
            current_co_dt = now

    if checkin_dt:
        # Marginal fee for adding `extension_hours` beyond the current checkout,
        # anchored to the check-in timeline (correct block-cycle position).
        elapsed = max(0.0, (current_co_dt - checkin_dt).total_seconds() / 3600.0)
        to_hours = elapsed + extension_hours
        total, breakdown = extension_breakdown(checkin_dt, elapsed, to_hours)
    else:
        # Fallback when check-in is unknown: legacy block-0-from-checkout calc.
        total, breakdown = calc_extension_fee(extension_hours, current_co_dt)

    return {
        "extension_hours": extension_hours,
        "start_dt":        current_co_dt.strftime(DT_FMT),
        "total_fee":       total,
        "breakdown":       breakdown,
    }

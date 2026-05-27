"""
app/services/holiday_sync.py
Auto-fetches Taiwan government holiday data on startup.
Sources (tried in order):
  1. data.gov.tw open data API  (authoritative, requires internet)
  2. Built-in fallback table     (offline / API failure)
Manual entries in holiday_cache are never overwritten.
"""

import json
import logging
from datetime import date, datetime
from typing import Optional

log = logging.getLogger(__name__)

# ── Government Open Data API ──────────────────────────────────────────────────
# 政府資料開放平台：中華民國政府行政機關辦公日曆表
# Dataset ID: 308DCD75-6119-4125-8843-468D965688FB
# Docs: https://data.gov.tw/dataset/14718
GOV_API_URL = (
    "https://data.ntpc.gov.tw/api/datasets/"
    "308DCD75-6119-4125-8843-468D965688FB/json?page=0&size=400"
)
GOV_API_URL2 = (
    "https://data.gov.tw/api/v2/rest/datastore/search"
    "?resource_id=holiday&limit=500"
)

# ── Fallback: manually maintained (updated when govt publishes) ───────────────
FALLBACK_HOLIDAYS: dict[int, list[dict]] = {
    2025: [
        {"date": "2025-01-01", "description": "中華民國開國紀念日"},
        {"date": "2025-01-27", "description": "農曆除夕"},
        {"date": "2025-01-28", "description": "春節"},
        {"date": "2025-01-29", "description": "春節"},
        {"date": "2025-01-30", "description": "春節"},
        {"date": "2025-01-31", "description": "春節補假"},
        {"date": "2025-02-03", "description": "春節補假"},
        {"date": "2025-02-28", "description": "和平紀念日"},
        {"date": "2025-04-03", "description": "兒童節補假"},
        {"date": "2025-04-04", "description": "清明節"},
        {"date": "2025-05-01", "description": "勞動節"},
        {"date": "2025-06-02", "description": "端午節"},
        {"date": "2025-09-03", "description": "中秋節補假"},
        {"date": "2025-10-06", "description": "國慶日補假"},
        {"date": "2025-10-10", "description": "國慶日"},
    ],
    2026: [
        {"date": "2026-01-01", "description": "中華民國開國紀念日"},
        {"date": "2026-02-15", "description": "小年夜"},
        {"date": "2026-02-17", "description": "春節"},
        {"date": "2026-02-18", "description": "春節"},
        {"date": "2026-02-19", "description": "春節"},
        {"date": "2026-02-27", "description": "和平紀念日補假"},
        {"date": "2026-04-03", "description": "兒童節補假"},
        {"date": "2026-04-04", "description": "清明節"},
        {"date": "2026-05-01", "description": "勞動節"},
        {"date": "2026-06-19", "description": "端午節"},
        {"date": "2026-09-25", "description": "中秋節"},
        {"date": "2026-09-28", "description": "孔子誕辰紀念日"},
        {"date": "2026-10-09", "description": "國慶日補假"},
        {"date": "2026-10-26", "description": "台灣光復節補假"},
        {"date": "2026-12-25", "description": "行憲紀念日"},
    ],
}


def _now_str() -> str:
    return datetime.now().strftime("%Y-%m-%d %H:%M")


def _fetch_from_api(year: int) -> Optional[list[dict]]:
    """Try to fetch holiday list from government open data API."""
    try:
        import urllib.request
        import urllib.error
        import socket
        socket.setdefaulttimeout(3)  # hard cap: prevent DNS hang on Windows

        # API returns records like: {"date":"20260619","name":"端午節","isHoliday":"2"}
        # isHoliday: 2=holiday/dayoff, 1=workday adjustment
        urls = [
            f"https://data.ntpc.gov.tw/api/datasets/308DCD75-6119-4125-8843-468D965688FB/json?page=0&size=500",
            f"https://cdn.jsdelivr.net/gh/ruyut/TaiwanCalendar/data/{year}.json",
        ]
        for url in urls:
            try:
                req = urllib.request.Request(url, headers={"User-Agent": "BINI-Blooms-PMS/1.0"})
                with urllib.request.urlopen(req, timeout=3) as resp:
                    data = json.loads(resp.read().decode("utf-8"))
                    results = []
                    for row in (data if isinstance(data, list) else data.get("records", [])):
                        # Handle different API formats
                        raw_date = row.get("date", row.get("西元日期", ""))
                        name = row.get("name", row.get("description", row.get("備註", "")))
                        is_hol = row.get("isHoliday", row.get("是否放假", ""))
                        # Normalize date: 20260619 → 2026-06-19
                        if len(raw_date) == 8 and raw_date.isdigit():
                            raw_date = f"{raw_date[:4]}-{raw_date[4:6]}-{raw_date[6:]}"
                        if not raw_date.startswith(str(year)):
                            continue
                        # isHoliday "2" = holiday, anything else = workday
                        if str(is_hol) in ("2", "true", "True", "1", "假日"):
                            results.append({"date": raw_date, "description": name or "假日"})
                    if results:
                        log.info(f"holiday_sync: API fetched {len(results)} holidays for {year}")
                        return results
            except Exception as e:
                log.debug(f"holiday_sync: URL {url} failed: {e}")
                continue
    except Exception as e:
        log.warning(f"holiday_sync: fetch failed: {e}")
    return None


def sync_holidays(db, years: Optional[list[int]] = None) -> dict:
    """
    Main sync function called on startup.
    For each year: try API first, fallback to built-in list.
    Never overwrites manual entries.
    Returns summary dict.
    """
    from app.models import HolidayCache
    from sqlalchemy import text

    # Ensure table exists
    try:
        db.execute(text("SELECT 1 FROM holiday_cache LIMIT 1"))
    except Exception:
        from app.db import engine
        HolidayCache.__table__.create(engine, checkfirst=True)

    if years is None:
        today = date.today()
        years = [today.year, today.year + 1]

    summary = {"synced": [], "fallback": [], "skipped": []}

    for year in years:
        # Skip if we already have API data for this year (not just fallback/manual)
        existing_api = db.query(HolidayCache).filter(
            HolidayCache.year == year,
            HolidayCache.source == "api",
        ).count()

        if existing_api > 5:
            summary["skipped"].append(year)
            log.info(f"holiday_sync: {year} already has {existing_api} API records, skipping")
            continue

        # Try API
        api_data = _fetch_from_api(year)
        source = "api" if api_data else "fallback"
        holiday_list = api_data or FALLBACK_HOLIDAYS.get(year, [])

        if not holiday_list:
            log.info(f"holiday_sync: no data for {year}")
            continue

        added = 0
        for item in holiday_list:
            d = item["date"]
            # Don't overwrite manual entries
            existing = db.query(HolidayCache).filter(HolidayCache.date == d).first()
            if existing and existing.is_manual == 1:
                continue
            if existing:
                # Update non-manual entry
                existing.description = item.get("description", "")
                existing.is_holiday  = 1
                existing.source      = source
                existing.updated_at  = _now_str()
            else:
                db.add(HolidayCache(
                    date        = d,
                    description = item.get("description", ""),
                    is_holiday  = 1,
                    is_manual   = 0,
                    year        = int(d[:4]),
                    source      = source,
                    updated_at  = _now_str(),
                ))
            added += 1

        try:
            db.commit()
            summary["synced" if source == "api" else "fallback"].append(year)
            log.info(f"holiday_sync: {year} — {added} holidays from {source}")
        except Exception as e:
            db.rollback()
            log.error(f"holiday_sync: commit failed for {year}: {e}")

    return summary


def get_holidays_for_year(db, year: int) -> set[str]:
    """Return set of holiday date strings for a given year from DB cache."""
    from app.models import HolidayCache
    rows = db.query(HolidayCache).filter(
        HolidayCache.year == year,
        HolidayCache.is_holiday == 1,
    ).all()
    return {r.date for r in rows}


def is_holiday_db(db, d: date) -> bool:
    """
    Check if a date is a holiday using DB cache.
    Falls back to fee_engine logic if DB has no data.
    Also treats Friday before a Saturday holiday as holiday (eve rule).
    """
    from app.models import HolidayCache

    date_str = d.strftime("%Y-%m-%d")
    row = db.query(HolidayCache).filter(HolidayCache.date == date_str).first()
    if row:
        return row.is_holiday == 1

    # Check if tomorrow is a holiday (eve rule: day before = holiday)
    from datetime import timedelta
    next_day_str = (d + timedelta(days=1)).strftime("%Y-%m-%d")
    next_row = db.query(HolidayCache).filter(HolidayCache.date == next_day_str).first()
    if next_row and next_row.is_holiday == 1:
        return True  # Eve of holiday

    # Check weekend
    if d.weekday() in (4, 5, 6):  # Fri, Sat, Sun
        return True

    return False

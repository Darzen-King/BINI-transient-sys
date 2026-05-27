"""
lib/pricing.py — DEPRECATED. Do not use.
All pricing logic has been consolidated into services/fee_engine.py which uses
the correct 12-hour block-ceiling algorithm. This file uses a different single-cap
calculation that produces different results and exists only for reference.


Rate schedule:
  Weekday (Mon–Thu):  12hrs = NT$800,  24hrs = NT$1000
  Holiday (Fri–Sun):  12hrs = NT$1000, 24hrs = NT$1200

Extension rate: NT$200/hr (fixed)

Extension fee cap logic:
  Let total_hours = original_plan_hours + extension_hours
  ─────────────────────────────────────────────────────────────
  total_hours ≤ 12  → cap = rate_12hr(day_type) − base_rent
  12 < total_hours ≤ 24 → cap = rate_24hr(day_type) − base_rent
  total_hours > 24  → no cap  (200/hr continues freely)
  ─────────────────────────────────────────────────────────────
  If calculated extension fee > cap, fee is clamped to cap.
"""
from datetime import datetime

# ── Rate table ────────────────────────────────────────────────────────────
WEEKDAY_RATES = {"12hrs": 800,  "24hrs": 1000}
HOLIDAY_RATES = {"12hrs": 1000, "24hrs": 1200}

EXT_HOURLY_RATE = 200   # NT$ per hour for extension (fixed)


def day_type(dt: datetime) -> str:
    """Returns 'holiday' for Fri/Sat/Sun, 'weekday' otherwise."""
    return "holiday" if dt.weekday() >= 4 else "weekday"


def base_rate(plan: str, dt: datetime) -> float:
    """
    Standard room rate for the given plan and check-in datetime.
    plan: '12hrs' | '24hrs'
    """
    rates = HOLIDAY_RATES if day_type(dt) == "holiday" else WEEKDAY_RATES
    return float(rates.get(plan, rates["24hrs"]))


def plan_hours(plan: str) -> int:
    return 12 if plan == "12hrs" else 24


def calc_extension(
    extension_hours: float,
    base_rent: float,
    original_plan: str,
    checkin_dt: datetime,
) -> dict:
    """
    Calculate extension fee with cap enforcement.

    Returns dict:
      fee          – final extension fee (after cap)
      raw_fee      – uncapped fee (200 × hours)
      cap          – the ceiling applied (None if no cap)
      cap_reason   – human-readable cap reason key
      total_due    – base_rent + fee
      new_plan_hrs – effective total hours after extension
    """
    orig_plan_hrs = plan_hours(original_plan)
    total_hrs     = orig_plan_hrs + extension_hours

    raw_fee = round(extension_hours * EXT_HOURLY_RATE, 0)

    # Determine rate type from check-in day
    rates = HOLIDAY_RATES if day_type(checkin_dt) == "holiday" else WEEKDAY_RATES

    # Cap logic
    if total_hrs <= 12:
        # Cap to 12hr plan
        cap        = max(rates["12hrs"] - base_rent, 0)
        cap_reason = "extend.cap_12hr"
    elif total_hrs <= 24:
        # Cap to 24hr plan
        cap        = max(rates["24hrs"] - base_rent, 0)
        cap_reason = "extend.cap_24hr"
    else:
        # No cap beyond 24 hrs
        cap        = None
        cap_reason = "extend.cap_none"

    if cap is not None:
        fee = min(raw_fee, cap)
    else:
        fee = raw_fee

    return {
        "fee":          fee,
        "raw_fee":      raw_fee,
        "capped":       (cap is not None and raw_fee > cap),
        "cap":          cap,
        "cap_reason":   cap_reason,
        "total_hrs":    total_hrs,
        "new_plan_hrs": total_hrs,
        "rate_type":    "holiday" if day_type(checkin_dt) == "holiday" else "weekday",
        "ext_rate":     EXT_HOURLY_RATE,
    }


def rate_table_for_display() -> list[dict]:
    """Return rate schedule for display in UI."""
    return [
        {"day_type": "weekday", "plan": "12hrs", "rate": WEEKDAY_RATES["12hrs"]},
        {"day_type": "weekday", "plan": "24hrs", "rate": WEEKDAY_RATES["24hrs"]},
        {"day_type": "holiday", "plan": "12hrs", "rate": HOLIDAY_RATES["12hrs"]},
        {"day_type": "holiday", "plan": "24hrs", "rate": HOLIDAY_RATES["24hrs"]},
    ]

"""
seed/seed_db.py — Production initial seed (idempotent).
Only runs when the rooms table is empty (first startup).
Plants clean, vacant rooms only — no test bookings or stays.
"""
import json
from pathlib import Path
from sqlalchemy.orm import Session
from app.models import (
    Room, Booking, ActiveStay, ReportSummary,
    BackupState, BackupLog, StayLog, ActivityLog
)

SEED_FILE = Path(__file__).parent / "mock_data.json"


def run_seed(db: Session) -> bool:
    """
    Returns True if seed was applied, False if already seeded.
    Uses Room count as sentinel — if any rooms exist, skip entirely.
    """
    if db.query(Room).count() > 0:
        return False

    data = json.loads(SEED_FILE.read_text(encoding="utf-8"))

    for r in data.get("rooms", []):
        # Only include columns that exist in the model
        db.add(Room(
            id               = r["id"],
            status           = r.get("status", "可入住"),
            current_guest    = r.get("current_guest"),
            checkin          = r.get("checkin"),
            checkout         = r.get("checkout"),
            next_booking     = r.get("next_booking"),
            note             = r.get("note"),
            maintenance_note = r.get("maintenance_note"),
            maintenance_due  = r.get("maintenance_due"),
            property_id      = r.get("property_id"),
        ))

    # No bookings, active stays, or report data in production seed
    for b in data.get("bookings", []):
        db.add(Booking(**b))

    for s in data.get("active_stays", []):
        s.setdefault("hourly_rate", s.get("base_rent", 1000) / 24)
        db.add(ActiveStay(**s))

    db.commit()
    print("✅  Production rooms seeded (all vacant).")
    return True

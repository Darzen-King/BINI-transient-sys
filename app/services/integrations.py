"""
services/integrations.py — Phase-4 Task 6: Integration service layer.

Provides interface stubs for:
  - Accounting export (invoice_no, external_txn_id, accounting_exported_at)
  - OTA / channel manager sync
  - Google Sheets export
  - Smart lock / door access

None of these are actually connected — they are placeholder interfaces
that can be implemented without changing business logic callers.
"""
from datetime import datetime
from sqlalchemy.orm import Session

DT_FMT = "%Y-%m-%d %H:%M:%S"


# ── Accounting export ─────────────────────────────────────────────────────

def mark_payment_exported(db: Session, payment_id: int, external_txn_id: str | None = None) -> bool:
    """Mark a payment as exported to accounting system."""
    from app.models import Payment
    p = db.query(Payment).filter(Payment.id == payment_id).first()
    if not p:
        return False
    p.accounting_exported_at = datetime.now().strftime(DT_FMT)
    if external_txn_id:
        p.external_txn_id = external_txn_id
    db.commit()
    return True


def generate_invoice_no(db: Session, booking_id: str) -> str:
    """
    Generate a sequential invoice number.
    Format: INV-YYYYMM-NNNN
    Stub — replace with real accounting sequence in production.
    """
    from app.models import Payment
    count = db.query(Payment).filter(Payment.invoice_no.isnot(None)).count()
    now   = datetime.now()
    return f"INV-{now.strftime('%Y%m')}-{(count + 1):04d}"


def export_to_accounting(db: Session, date_from: str, date_to: str) -> dict:
    """
    Interface stub: export payments to accounting system.
    Returns a summary dict. Replace body with real API call.
    """
    from app.models import Payment
    payments = db.query(Payment).filter(
        Payment.created_at >= date_from,
        Payment.created_at <= date_to + " 23:59",
        Payment.accounting_exported_at.is_(None),
    ).all()

    # Stub: just mark as exported
    exported = []
    for p in payments:
        p.accounting_exported_at = datetime.now().strftime(DT_FMT)
        exported.append(p.id)
    db.commit()

    return {
        "exported_count": len(exported),
        "payment_ids":    exported,
        "status":         "stub_ok",
        "message":        "Accounting export interface (stub) — implement real API here",
    }


# ── OTA / Channel Manager ────────────────────────────────────────────────

def sync_ota_availability(db: Session) -> dict:
    """
    Interface stub: push room availability to OTA channel manager.
    Implement with real PMS <-> OTA API (ARI: Availability, Rates, Inventory).
    """
    from app.models import Room
    rooms = db.query(Room).all()
    available = [r.id for r in rooms if r.status == "可入住"]
    return {
        "status":       "stub_ok",
        "available":    available,
        "message":      "OTA sync interface (stub) — implement channel manager API here",
    }


def receive_ota_booking(payload: dict) -> dict:
    """
    Interface stub: receive a booking from OTA (webhook).
    Validate payload and create booking via bookings service.
    """
    return {
        "status":   "stub_ok",
        "message":  "OTA booking receipt interface (stub)",
        "payload":  payload,
    }


# ── Google Sheets export ─────────────────────────────────────────────────

def export_to_sheets(db: Session, sheet_id: str, data_type: str = "bookings") -> dict:
    """
    Interface stub: export data to Google Sheets.
    Requires: google-api-python-client (not installed in base setup).
    """
    return {
        "status":   "stub_not_connected",
        "message":  "Google Sheets export (stub) — install google-api-python-client and configure Service Account",
        "sheet_id": sheet_id,
        "data_type": data_type,
    }


# ── Smart Lock / Door Access ─────────────────────────────────────────────

def grant_door_access(room_id: str, guest: str, valid_until: str) -> dict:
    """
    Interface stub: grant door access for a guest.
    Implement with real smart lock API (e.g., TTLock, Schlage, SALTO).
    """
    return {
        "status":      "stub_ok",
        "room_id":     room_id,
        "guest":       guest,
        "valid_until": valid_until,
        "message":     "Smart lock interface (stub) — implement door access API here",
    }


def revoke_door_access(room_id: str, guest: str) -> dict:
    """Interface stub: revoke door access on checkout."""
    return {
        "status":  "stub_ok",
        "room_id": room_id,
        "message": "Smart lock revoke interface (stub)",
    }

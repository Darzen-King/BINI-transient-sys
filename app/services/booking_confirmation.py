"""
services/booking_confirmation.py — the reservation certificate a guest takes away.

The standalone build has to produce the same document as the cloud app, because it is what
the front desk falls back to when there is no network. This module holds only the arithmetic
and the checks, so the route and the template stay about presentation.

A guest keeps this document, so nothing here is invented: the amounts are the booking's own,
the balance is simply what the deposit has not covered, and a store name or address that is
missing stays missing rather than being replaced by an id.
"""
from __future__ import annotations

from datetime import datetime

DT_FMT = "%Y-%m-%d %H:%M"

# House terms printed at the foot of the certificate. They are house rules, not system
# behaviour, so they live here where staff can reword them without touching the layout.
DEFAULT_NOTES_ZH = (
    "請於預約的入住時間後抵達，並出示本證明與身分證件辦理入住。",
    "本證明為預約紀錄，實際費用以辦理入住與退房時的結算為準。",
    "如需變更或取消預約，請事先與我們聯絡。",
)
DEFAULT_NOTES_EN = (
    "Please arrive at or after the check-in time shown above and present this certificate with photo ID.",
    "This certificate records the reservation; the final amount is settled at check-in and check-out.",
    "Please contact us in advance to change or cancel this reservation.",
)

# A booking in one of these states is no longer a reservation that stands.
_NOT_A_RESERVATION = {"已取消", "No-show", "已入住"}


def _clean(value, limit: int) -> str | None:
    """A blank or whitespace-only field is missing, not an empty line on the certificate."""
    if value is None:
        return None
    text = str(value).strip()
    return text[:limit] if text else None


def _parse(value: str) -> datetime:
    return datetime.strptime(str(value).replace("T", " ")[:16], DT_FMT)


def build_confirmation(booking, prop, deposit_paid: float = 0.0,
                       issued_at: datetime | None = None,
                       notes=DEFAULT_NOTES_ZH) -> dict:
    """
    Projects one booking into the certificate's fields.

    Raises ValueError when the booking could not honestly be certified: a cancelled or
    already checked-in booking, times that are not a stay, or a property with no name.
    """
    if booking is None:
        raise ValueError("booking is required")
    if booking.status in _NOT_A_RESERVATION:
        raise ValueError("only an active booking has a reservation certificate")

    checkin = _parse(booking.checkin)
    checkout = _parse(booking.checkout)
    if checkout <= checkin:
        raise ValueError("booking check-out is not after its check-in")

    store_name = _clean(getattr(prop, "name", None), 200)
    if not store_name:
        raise ValueError("the certificate needs the store name")

    payable = round(float(booking.amount or 0), 0)
    discount = round(float(booking.discount or 0), 0)
    paid = max(0.0, round(float(deposit_paid or 0), 0))
    stay_hours = (checkout - checkin).total_seconds() / 3600.0

    return {
        "store_name":    store_name,
        "store_address": _clean(getattr(prop, "address", None), 1000),
        "store_phone":   _clean(getattr(prop, "phone", None), 100),
        "booking_id":    booking.id,
        "guest":         booking.guest,
        "guest_phone":   _clean(booking.phone, 100),
        "room":          booking.room,
        "plan":          booking.plan,
        "rate_type":     _clean(booking.rate_type, 100),
        "checkin":       checkin.strftime(DT_FMT),
        "checkout":      checkout.strftime(DT_FMT),
        "stay_hours":    int(stay_hours) if stay_hours == int(stay_hours) else round(stay_hours, 1),
        "gross_amount":  payable + discount,
        "discount":      discount,
        "payable":       payable,
        "deposit_paid":  paid,
        "balance_due":   max(0.0, payable - paid),
        "issued_at":     (issued_at or datetime.now()).strftime(DT_FMT),
        "notes":         list(notes),
    }


def certificate_property(db, booking):
    """
    The property whose details the certificate prints: the booking's own, or the single
    active property when the booking predates multi-property and carries no id.
    """
    from app.models import Property

    if getattr(booking, "property_id", None):
        prop = db.query(Property).filter(Property.id == booking.property_id).first()
        if prop is not None:
            return prop
    active = db.query(Property).filter(Property.is_active == 1).order_by(Property.id).all()
    if len(active) == 1:
        return active[0]
    return db.query(Property).order_by(Property.id).first()

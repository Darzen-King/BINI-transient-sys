"""Regression: a booking can be handed to the guest as a printable reservation certificate.

Covers the projection (times, amounts, deposit and balance), the refusals that keep a guest
document honest (a cancelled booking, a property with no store name), the certificate page
itself, the button on the bookings list, and the Properties edit that fills in the address
and phone the certificate prints. Run from the repository root:
    python tests/booking_certificate_regression_test.py
"""
import asyncio
from datetime import datetime, timedelta
from pathlib import Path
from types import SimpleNamespace
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool
from starlette.requests import Request

import app.services.auth as auth_svc
import app.services.backup as backup_svc
from app.db import Base
from app.models import Booking, Payment, Property, Room
from app.routers import bookings as bookings_router
from app.routers import phase4 as phase4_router
from app.services.booking_confirmation import build_confirmation, certificate_property

DT_FMT = "%Y-%m-%d %H:%M"
USER = SimpleNamespace(id=1, username="front", role="admin", is_active=True, display_name="Front")


def _ts(delta_hours: int) -> str:
    return (datetime.now() + timedelta(hours=delta_hours)).strftime(DT_FMT)


def _request(path: str, query: str = "") -> Request:
    request = Request({"type": "http", "method": "GET", "path": path, "query_string": query.encode(),
                       "headers": [(b"cookie", b"bini_lang=zh")]})
    request.state.current_user = USER
    return request


def _check_projection() -> None:
    booking = SimpleNamespace(id="RSV-1", room="202", guest="王小明", phone=" 0912-345-678 ",
                              checkin="2026-10-05 15:00", checkout="2026-10-06 13:00",
                              plan="24hrs", amount=1400, discount=200, rate_type="非假日",
                              status="已預約", property_id="P001")
    prop = SimpleNamespace(name="BINI Blooms", address=" 台北市中山區示範路 1 號 ", phone="02-1234-5678")

    doc = build_confirmation(booking, prop, deposit_paid=500,
                             issued_at=datetime(2026, 10, 1, 10, 30))
    assert doc["checkin"] == "2026-10-05 15:00" and doc["checkout"] == "2026-10-06 13:00", doc
    assert doc["issued_at"] == "2026-10-01 10:30", doc
    assert doc["stay_hours"] == 22, doc["stay_hours"]
    assert doc["guest_phone"] == "0912-345-678", doc["guest_phone"]
    assert doc["store_address"] == "台北市中山區示範路 1 號", doc["store_address"]
    # The stored amount is already net of the discount, so the gross is the two added back.
    assert (doc["gross_amount"], doc["discount"], doc["payable"]) == (1600, 200, 1400), doc
    assert (doc["deposit_paid"], doc["balance_due"]) == (500, 900), doc

    over = build_confirmation(booking, prop, deposit_paid=9000)
    assert over["balance_due"] == 0, "a balance is never negative"

    blank = build_confirmation(SimpleNamespace(**{**booking.__dict__, "phone": "  ", "rate_type": None}),
                               SimpleNamespace(name="BINI", address="   ", phone=None))
    assert blank["guest_phone"] is None and blank["store_address"] is None and blank["store_phone"] is None, blank

    for bad_case, maker in (
        ("cancelled booking", lambda: build_confirmation(SimpleNamespace(**{**booking.__dict__, "status": "已取消"}), prop)),
        ("checked-in booking", lambda: build_confirmation(SimpleNamespace(**{**booking.__dict__, "status": "已入住"}), prop)),
        ("times that are not a stay", lambda: build_confirmation(SimpleNamespace(**{**booking.__dict__, "checkout": booking.checkin}), prop)),
        ("property with no name", lambda: build_confirmation(booking, SimpleNamespace(name="  ", address="x", phone="y"))),
    ):
        try:
            maker()
        except ValueError:
            continue
        raise AssertionError(f"a certificate was built for a {bad_case}")


def main() -> None:
    backup_svc.auto_backup = lambda *args, **kwargs: None
    bookings_router._auto_backup = lambda *args, **kwargs: None
    auth_svc.get_current_user = lambda request, db: USER
    phase4_router._user = lambda request, db: USER

    _check_projection()

    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    db = sessionmaker(bind=engine)()
    try:
        db.add(Room(id="T-202", status="可入住"))
        db.add(Property(id="P001", name="BINI Blooms", address=None, phone=None, is_active=1))
        db.add(Booking(id="RSV-CERT", room="T-202", guest="王小明", phone="0912-345-678",
                       checkin=_ts(24), checkout=_ts(48), status="已預約", plan="24hrs",
                       amount=1600, discount=0, rate_type="非假日", property_id="P001"))
        db.add(Booking(id="RSV-GONE", room="T-202", guest="Cancelled", checkin=_ts(30),
                       checkout=_ts(54), status="已取消", plan="24hrs", amount=1000))
        db.add(Payment(booking_id="RSV-CERT", room_id="T-202", guest="王小明", payment_type="cash",
                       amount=600, is_deposit=1, is_refund=0,
                       created_at=datetime.now().strftime(DT_FMT)))
        db.commit()

        # 1) The bookings list offers the certificate.
        listing = asyncio.run(bookings_router.booking_list(_request("/bookings"), sort_by="checkin", sort_dir="asc", db=db)).body.decode()
        assert "/bookings/RSV-CERT/certificate" in listing, "no certificate button on the bookings list"

        # 2) The certificate prints the booking, the guest and the deposit already collected.
        page = asyncio.run(bookings_router.booking_certificate(_request("/bookings/RSV-CERT/certificate"), booking_id="RSV-CERT", db=db))
        html = page.body.decode()
        assert page.status_code == 200, page.status_code
        for expected in ("預約證明", "RSV-CERT", "王小明", "0912-345-678", "T-202",
                         "NT$ 1,600", "NT$ 600", "NT$ 1,000", "入住注意事項", "window.print()"):
            assert expected in html, f"certificate is missing {expected}"
        # The property has no address or phone yet, so the certificate shows neither.
        assert "📍" not in html and "電話 " not in html, "a missing address or phone must not be printed"

        # 3) A cancelled booking is refused rather than certified.
        refused = asyncio.run(bookings_router.booking_certificate(_request("/bookings/RSV-GONE/certificate"), booking_id="RSV-GONE", db=db))
        assert refused.status_code == 409, refused.status_code
        assert "無法開立預約證明" in refused.body.decode(), "the refusal is not explained"

        # 4) Properties says the address and phone are missing, and lets an admin fill them in.
        props = asyncio.run(phase4_router.properties_page(_request("/properties"), db=db)).body.decode()
        assert "尚未填寫地址" in props and "尚未填寫電話" in props, "missing store details are not flagged"
        assert 'action="/properties/P001/edit"' in props, "no edit form for the property"

        saved = asyncio.run(phase4_router.edit_property(_request("/properties"), prop_id="P001",
                                                        name="BINI Blooms 總館",
                                                        address=" 台北市中山區示範路 1 號 ",
                                                        phone=" 02-1234-5678 ", note="  ", db=db))
        assert saved.headers["location"] == "/properties?msg=updated", saved.headers["location"]
        prop = db.get(Property, "P001")
        assert (prop.name, prop.address, prop.phone, prop.note) == ("BINI Blooms 總館", "台北市中山區示範路 1 號", "02-1234-5678", None), (
            prop.name, prop.address, prop.phone, prop.note)

        # 5) The certificate now carries the store details, with no redeploy or restart.
        html = asyncio.run(bookings_router.booking_certificate(_request("/bookings/RSV-CERT/certificate"), booking_id="RSV-CERT", db=db)).body.decode()
        assert "BINI Blooms 總館" in html and "台北市中山區示範路 1 號" in html and "02-1234-5678" in html, "store details did not reach the certificate"

        # 6) A booking that predates multi-property still finds the only property there is.
        orphan = Booking(id="RSV-OLD", room="T-202", guest="Old", checkin=_ts(72), checkout=_ts(96),
                         status="已預約", plan="24hrs", amount=900, property_id=None)
        db.add(orphan)
        db.commit()
        assert certificate_property(db, orphan).id == "P001", "an unlinked booking found no property"

        print("booking_certificate_regression_test: OK")
    finally:
        db.close()


if __name__ == "__main__":
    main()

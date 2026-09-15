"""Regression: deposits can be added to an existing booking and are shown in booking management.

Covers the edit-page deposit form, the bookings list deposit column, the payments page selector
(visible even with no checked-in guest, offering upcoming bookings), and deposits following a
room change. Run from the repository root:
    python tests/booking_deposit_regression_test.py
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
from app.models import Booking, Payment, Room
from app.routers import bookings as bookings_router
from app.routers import phase4 as phase4_router
from app.services import bookings as bsvc
from app.services import stays as ssvc

DT_FMT = "%Y-%m-%d %H:%M"
USER = SimpleNamespace(id=1, username="front", role="front_desk", is_active=True, display_name="Front")


def _ts(delta_hours: int) -> str:
    return (datetime.now() + timedelta(hours=delta_hours)).strftime(DT_FMT)


def _request(path: str, query: str = "") -> Request:
    request = Request({"type": "http", "method": "GET", "path": path, "query_string": query.encode(),
                       "headers": [(b"cookie", b"bini_lang=zh")]})
    request.state.current_user = USER
    return request


def main() -> None:
    # Never touch the real cloud backup, and act as a signed-in front-desk user.
    backup_svc.auto_backup = lambda *args, **kwargs: None
    bookings_router._auto_backup = lambda *args, **kwargs: None
    auth_svc.get_current_user = lambda request, db: USER
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    db = sessionmaker(bind=engine)()
    try:
        for room_id in ("T-202", "T-203"):
            db.add(Room(id=room_id, status="可入住"))
        db.add(Booking(id="RSV-DEP", room="T-202", guest="Michael", checkin=_ts(24), checkout=_ts(36),
                       status="已預約", plan="12hrs", amount=2200))
        db.add(Booking(id="RSV-GONE", room="T-203", guest="Cancelled", checkin=_ts(30), checkout=_ts(54),
                       status="已取消", plan="24hrs", amount=1000))
        db.commit()

        # 1) The list shows no deposit yet.
        html = asyncio.run(bookings_router.booking_list(_request("/bookings"), sort_by="checkin", sort_dir="asc", db=db)).body.decode()
        assert "未收" in html, "deposit column missing"

        # 2) Invalid amounts and inactive bookings are refused.
        bad = asyncio.run(bookings_router.booking_add_deposit(_request("/"), booking_id="RSV-DEP", amount=0, payment_type="cash", note="", db=db))
        assert bad.headers["location"].endswith("err=error.deposit_amount"), bad.headers["location"]
        gone = asyncio.run(bookings_router.booking_add_deposit(_request("/"), booking_id="RSV-GONE", amount=500, payment_type="cash", note="", db=db))
        assert gone.headers["location"].endswith("err=error.booking_not_active"), gone.headers["location"]

        # 3) A deposit added later is linked to the booking and shown on the edit page and in the list.
        ok = asyncio.run(bookings_router.booking_add_deposit(_request("/"), booking_id="RSV-DEP", amount=500, payment_type="transfer", note="客人事後補付", db=db))
        assert ok.headers["location"] == "/bookings/RSV-DEP/edit?msg=deposit_added", ok.headers["location"]
        deposit = db.query(Payment).filter(Payment.booking_id == "RSV-DEP").one()
        assert (deposit.is_deposit, deposit.room_id, deposit.guest, deposit.amount, deposit.payment_type, deposit.note) == (1, "T-202", "Michael", 500, "transfer", "客人事後補付")
        edit_html = asyncio.run(bookings_router.booking_edit_page(_request("/bookings/RSV-DEP/edit", "msg=deposit_added"), booking_id="RSV-DEP", db=db)).body.decode()
        assert "已收押金 NT$ 500" in edit_html and "押金已記錄" in edit_html, "edit page does not show the deposit"
        html = asyncio.run(bookings_router.booking_list(_request("/bookings"), sort_by="checkin", sort_dir="asc", db=db)).body.decode()
        assert "NT$ 500" in html, "bookings list does not show the deposit"

        # 4) The payments page keeps the selector with no checked-in guest, and offers the booking.
        pay_html = asyncio.run(phase4_router.payments_page(_request("/payments"), date_from=None, date_to=None, room_id=None, db=db)).body.decode()
        assert 'id="paySelectStay"' in pay_html, "selector hidden when nobody is checked in"
        assert 'value="booking:RSV-DEP"' in pay_html and 'data-kind="booking"' in pay_html, "upcoming booking not offered"
        assert "RSV-GONE" not in pay_html, "cancelled booking must not be offered"

        # 5) Recording a payment from that page keeps its note.
        asyncio.run(phase4_router.add_payment(_request("/payments"), booking_id="RSV-DEP", room_id="T-202", guest="Michael",
                                              payment_type="cash", amount=300, is_deposit="1", is_refund="0", note="第二筆押金", db=db))
        assert db.query(Payment).filter(Payment.note == "第二筆押金").count() == 1, "payment note was dropped"

        # 6) Moving the booking to another room moves its deposits, so check-in there counts them.
        booking = db.get(Booking, "RSV-DEP")
        _, err = bsvc.edit_booking(db, "RSV-DEP", "T-203", booking.checkin, booking.checkout, booking.guest, "", booking.plan, booking.amount, "非假日")
        assert err is None, err
        assert {p.room_id for p in db.query(Payment).filter(Payment.booking_id == "RSV-DEP")} == {"T-203"}
        stay, err = ssvc.checkin_guest(db, room_id="T-203", guest="Michael", plan="12hrs", base_rent=2200, booking_id="RSV-DEP")
        assert err is None, err
        assert ssvc.get_deposit_paid(db, "T-203") == 800, ssvc.get_deposit_paid(db, "T-203")
        print("booking_deposit_regression_test: OK")
    finally:
        db.close()


if __name__ == "__main__":
    main()

"""Regression: checking in a booking whose arrival time has passed must not conflict with itself.

Run from the repository root:
    python tests/checkin_overdue_booking_regression_test.py
"""
import asyncio
import json
import re
from datetime import datetime, timedelta
from pathlib import Path
from types import SimpleNamespace
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool
from starlette.requests import Request

from app.db import Base
from app.models import Booking, Room
from app.routers import bookings as bookings_router
from app.routers import checkin as checkin_router

DT_FMT = "%Y-%m-%d %H:%M"


def _ts(delta_minutes: int) -> str:
    return (datetime.now() + timedelta(minutes=delta_minutes)).strftime(DT_FMT)


def _request(query: str = "") -> Request:
    scope = {"type": "http", "method": "GET", "path": "/checkin", "query_string": query.encode(), "headers": []}
    request = Request(scope)
    request.state.current_user = SimpleNamespace(username="tester")
    return request


def _session():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    return sessionmaker(bind=engine)()


def main() -> None:
    checkin_router._auto_backup = lambda *args, **kwargs: None  # never touch real backups
    db = _session()
    try:
        # Arrival was 90 minutes ago; the 24h booking is still valid.
        db.add(Room(id="T-205", status="可入住"))
        db.add(Booking(id="RSV-LATE", room="T-205", guest="晚到旅客", checkin=_ts(-90), checkout=_ts(24 * 60 - 90),
                       status="已預約", plan="24hrs", amount=1000))
        db.commit()

        # 1) The bookings page "入住" button must keep the booking selectable on the check-in form.
        page = asyncio.run(checkin_router.checkin_form(_request("booking_id=RSV-LATE"), booking_id="RSV-LATE", room="", db=db))
        html = page.body.decode()
        assert 'value="RSV-LATE"' in html, "overdue booking missing from the related-booking list"

        # 2) A check-in started from 入住登記 / the room card is a different visit: no booking is linked,
        #    and the late booking is still reported as a conflict.
        page = asyncio.run(checkin_router.checkin_form(_request("room=T-205"), booking_id="", room="T-205", db=db))
        assert not re.search(r"quickFill\(\s*'RSV-LATE'", page.body.decode()), "a walk-in must not be linked to the booking"
        walk_in = asyncio.run(checkin_router.checkin_submit(
            _request(), room="T-205", guest="現場旅客", phone="", plan="24hrs", base_rent=1000, discount=0, days=1,
            amount_auto="0", booking_id="", checkin_time=_ts(0).replace(" ", "T"), checkout_time="",
            deposit_amount=0, deposit_type="cash", db=db,
        ))
        assert walk_in.headers["location"].endswith("error=error.conflict"), walk_in.headers["location"]

        # 2b) The live availability badge excludes the linked booking and accepts the late arrival.
        booking = db.get(Booking, "RSV-LATE")
        live = asyncio.run(bookings_router.check_availability(room="T-205", checkin=booking.checkin, checkout=booking.checkout,
                                                              exclude="RSV-LATE", allow_past="1", db=db))
        assert json.loads(live.body)["available"] is True, live.body
        own = asyncio.run(bookings_router.check_availability(room="T-205", checkin=booking.checkin, checkout=booking.checkout,
                                                             exclude="", allow_past="", db=db))
        assert json.loads(own.body)["available"] is False, "booking form behaviour must stay unchanged"

        # 2c) A booking check-in bills from the real arrival: the form fills in the current time and shows
        #     the booked window only for reference (early or late arrival alike).
        page = asyncio.run(checkin_router.checkin_form(_request("booking_id=RSV-LATE"), booking_id="RSV-LATE", room="", db=db))
        html = page.body.decode()
        assert 'id="bookedWindowHint"' in html, "booked-window reference line is missing"
        assert "_ciSetCheckinNow();" in html and "autoCheckoutDaysCheckin();" in html, "check-in time is not reset to the real arrival"

        # 3) Submitting with the booking succeeds and marks it checked in.
        response = asyncio.run(checkin_router.checkin_submit(
            _request(), room="T-205", guest="晚到旅客", phone="", plan="24hrs", base_rent=1000, discount=0, days=1,
            amount_auto="0", booking_id="RSV-LATE", checkin_time=_ts(0).replace(" ", "T"), checkout_time="",
            deposit_amount=0, deposit_type="cash", db=db,
        ))
        assert response.headers["location"] == "/rooms?msg=checkin_ok", response.headers["location"]
        db.expire_all()
        assert db.get(Booking, "RSV-LATE").status == "已入住"
        print("checkin_overdue_booking_regression_test: OK")
    finally:
        db.close()


if __name__ == "__main__":
    main()

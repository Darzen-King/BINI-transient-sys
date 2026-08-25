"""Regression checks for the live next-booking lookup used by booking form."""
from datetime import datetime, timedelta
from pathlib import Path
import sys

# Allow direct execution from the repository root:
#   python tests/next_booking_regression_test.py
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.db import Base
from app.models import Booking, Room
from app.services.bookings import get_next_booking_for_room


DT_FMT = "%Y-%m-%d %H:%M"


def _ts(delta_minutes: int) -> str:
    return (datetime.now() + timedelta(minutes=delta_minutes)).strftime(DT_FMT)


def main() -> None:
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    db = sessionmaker(bind=engine)()
    try:
        db.add(Room(id="TEST-101", status="可入住", next_booking=_ts(-120)))
        db.add(Booking(
            id="OLD-BOOKING", room="TEST-101", guest="過期測試",
            checkin=_ts(-180), checkout=_ts(-60), status="已預約",
        ))
        db.commit()

        assert get_next_booking_for_room(db, "TEST-101") is None, (
            "expired booking or stale Room.next_booking must not be returned"
        )

        future = _ts(120)
        db.add(Booking(
            id="FUTURE-BOOKING", room="TEST-101", guest="未來測試",
            checkin=future, checkout=_ts(180), status="已預約",
        ))
        db.commit()

        next_booking = get_next_booking_for_room(db, "TEST-101")
        assert next_booking is not None
        assert next_booking.id == "FUTURE-BOOKING"
        assert next_booking.checkin == future
        print("next_booking_regression: OK")
    finally:
        db.close()


if __name__ == "__main__":
    main()

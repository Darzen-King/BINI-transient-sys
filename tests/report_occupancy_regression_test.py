"""Regression: daily occupancy counts who was in the room, and voided monthly records are not revenue.

Before, 住房率 counted only bookings whose check-in fell on that day and dropped them the moment the
guest checked in, so every past day read 0%. The cloud version also marks duplicate monthly renewals
'voided'; that status arrives here through the backup file and must stay out of the revenue figures.

Run from the repository root:
    python tests/report_occupancy_regression_test.py
"""
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.db import Base
from app.models import ActiveStay, Booking, MonthlyRental, Room, StayLog
from app.services.monthly import monthly_rent_in_range
from app.services.reports import compute_report


def main() -> None:
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    db = sessionmaker(bind=engine)()
    try:
        for room_id in ("201", "202", "203", "204"):
            db.add(Room(id=room_id, status="可入住"))
        # A completed stay: in the room from the 10th until check-out on the 11th.
        db.add(StayLog(room="201", guest="已退房旅客", plan="24hrs", checkin_time="2026-09-10 15:00",
                       checkout_time="2026-09-11 12:00", total_charged=1300, free_cancel=0, transferred=0,
                       created_at="2026-09-11 12:00"))
        # Its booking is marked 已入住, which used to remove it from every occupancy count.
        db.add(Booking(id="RSV-IN", room="201", guest="已退房旅客", checkin="2026-09-10 15:00",
                       checkout="2026-09-11 15:00", status="已入住", plan="24hrs", amount=1300))
        # A guest still in house on the 11th and 12th.
        db.add(ActiveStay(room="202", guest="在住旅客", plan="24hrs", base_rent=1000, total_due=1000,
                          checkin_time="2026-09-11 14:00", checkout_time="2026-09-12 14:00"))
        # A monthly tenant: the period ends on the 12th, so the last occupied day is the 11th.
        db.add(MonthlyRental(room_id="203", tenant_name="月租房客", start_date="2026-09-09",
                             end_date="2026-09-12", deposit=8000, rent=8000, status="active",
                             created_at="2026-09-09 10:00"))
        # A duplicate renewal voided in the cloud: never revenue, never occupancy.
        db.add(MonthlyRental(room_id="204", tenant_name="重複紀錄", start_date="2026-09-09",
                             end_date="2026-10-09", deposit=0, rent=8000, status="voided",
                             created_at="2026-09-09 10:01"))
        db.commit()

        report = compute_report(db, "2026-09-09", "2026-09-13")
        daily = dict(zip(report["daily"]["labels"], report["daily"]["occupancy"]))

        # 4 rooms: 09-09 monthly only; 09-10 monthly + the stay; 09-11 all three; 09-12 the guest in house.
        assert daily["2026-09-09"] == 25.0, daily
        assert daily["2026-09-10"] == 50.0, daily
        assert daily["2026-09-11"] == 75.0, daily
        assert daily["2026-09-12"] == 25.0, daily
        assert daily["2026-09-13"] == 0.0, daily

        # The voided duplicate stays out of the rent, the order count and the per-room revenue.
        assert monthly_rent_in_range(db, "2026-09-09", "2026-09-13") == 8000
        assert report["monthly_revenue"] == 8000, report["monthly_revenue"]
        rooms = {item["id"]: item for item in report["room_rental_list"]}
        assert rooms["203"]["revenue"] == 8000, rooms["203"]
        assert "204" not in rooms or rooms["204"]["revenue"] == 0, rooms.get("204")
        print("report_occupancy_regression_test: OK")
    finally:
        db.close()


if __name__ == "__main__":
    main()

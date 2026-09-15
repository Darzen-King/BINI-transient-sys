"""Regression: repeated 確認續租 clicks must renew a monthly rental only once.

Renewal waits for the cloud backup before the page reloads, so operators clicked
again and each click added another month. Run from the repository root:
    python tests/monthly_renew_double_submit_regression_test.py
"""
import asyncio
from pathlib import Path
from types import SimpleNamespace
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool
from starlette.requests import Request

from app.db import Base
from app.models import MonthlyRental, Payment, Room
from app.routers import rooms as rooms_router


def _request() -> Request:
    request = Request({"type": "http", "method": "POST", "path": "/room-management/monthly/renew", "query_string": b"", "headers": []})
    request.state.current_user = SimpleNamespace(username="tester")
    return request


def main() -> None:
    rooms_router._auto_backup = lambda *args, **kwargs: None  # never touch real backups
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    db = sessionmaker(bind=engine)()
    try:
        db.add(Room(id="T-201", status="月租套房"))
        db.add(MonthlyRental(room_id="T-201", tenant_name="Carlos", start_date="2026-09-01", end_date="2026-10-01",
                             deposit=0, rent=6000, status="active", payment_type="cash"))
        db.commit()

        def renew():
            return asyncio.run(rooms_router.monthly_renew(_request(), room_id="T-201", payment_type="cash",
                                                          expected_end="2026-10-01", db=db))

        # Five clicks on the same open modal: the first renews, the rest are refused.
        responses = [renew() for _ in range(5)]
        assert responses[0].headers["location"] == "/room-management?msg=monthly_renewed", responses[0].headers["location"]
        for response in responses[1:]:
            assert response.headers["location"].endswith("err=error.monthly_already_renewed"), response.headers["location"]

        db.expire_all()
        active = db.query(MonthlyRental).filter(MonthlyRental.room_id == "T-201", MonthlyRental.status == "active").all()
        assert [(r.start_date, r.end_date) for r in active] == [("2026-10-01", "2026-11-01")], [(r.start_date, r.end_date) for r in active]
        rent_payments = db.query(Payment).filter(Payment.room_id == "T-201").count()
        assert rent_payments == 1, rent_payments

        # A fresh modal (the page reloaded, showing 2026-11-01) renews the next month normally.
        fresh = asyncio.run(rooms_router.monthly_renew(_request(), room_id="T-201", payment_type="cash",
                                                       expected_end="2026-11-01", db=db))
        assert fresh.headers["location"] == "/room-management?msg=monthly_renewed"
        db.expire_all()
        latest = db.query(MonthlyRental).filter(MonthlyRental.status == "active").one()
        assert (latest.start_date, latest.end_date) == ("2026-11-01", "2026-12-01")
        print("monthly_renew_double_submit_regression_test: OK")
    finally:
        db.close()


if __name__ == "__main__":
    main()

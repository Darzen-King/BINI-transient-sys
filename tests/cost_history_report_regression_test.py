"""Regression: cost history is searchable by date range, and the report export carries the costs.

Before, the cost page only offered one month at a time and the 統計報表 CSV had no cost data at all.
Run from the repository root:
    python tests/cost_history_report_regression_test.py
"""
import asyncio
from datetime import date
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
from app.models import CostEntry
from app.routers import costs as costs_router
from app.routers import reports as reports_router
from app.services import costs as cost_svc
from app.services.reports import export_csv

ADMIN = SimpleNamespace(id=1, username="admin", role="admin", is_active=True, display_name="Admin")
MANAGER = SimpleNamespace(id=2, username="mgr", role="manager", is_active=True, display_name="Manager")


def _request(path: str, query: str = "") -> Request:
    request = Request({"type": "http", "method": "GET", "path": path, "query_string": query.encode(),
                       "headers": [(b"cookie", b"bini_lang=zh")]})
    request.state.current_user = ADMIN
    return request


def main() -> None:
    backup_svc.auto_backup = lambda *args, **kwargs: None  # never touch real backups
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    db = sessionmaker(bind=engine)()
    try:
        for cost_date, category, amount, vendor in (
            ("2026-07-20", "utilities", 4000, "台電七月"),
            ("2026-08-15", "laundry", 2000, "洗衣行八月"),
            ("2026-09-05", "utilities", 800, "台電九月"),
        ):
            db.add(CostEntry(cost_date=cost_date, category=category, amount=amount, payment_method="cash",
                             vendor=vendor, description=None, note=None, is_recurring=0, created_by="admin"))
        db.commit()

        # 1) Range resolution: explicit dates win, old ?year_month= links still mean that month, default is this month.
        today = date(2026, 9, 16)
        assert cost_svc.resolve_cost_range("2026-07-01", "2026-08-31", "", today) == ("2026-07-01", "2026-08-31")
        assert cost_svc.resolve_cost_range("", "", "2026-08", today) == ("2026-08-01", "2026-08-31")
        assert cost_svc.resolve_cost_range("", "", "", today) == ("2026-09-01", "2026-09-16")
        assert cost_svc.resolve_cost_range("2026-09-10", "2026-09-01", "", today) == ("2026-09-01", "2026-09-10")
        quick = {key: (start, end) for key, start, end in cost_svc.cost_quick_ranges(today)}
        assert quick["costs.quick.last_month"] == ("2026-08-01", "2026-08-31"), quick
        assert quick["costs.quick.all"] == ("2000-01-01", "2026-09-16"), quick

        # 2) The cost page shows history from older months for the searched range only.
        auth_svc.get_current_user = lambda request, db: ADMIN
        page = asyncio.run(costs_router.costs_page(_request("/costs", "date_from=2026-07-01&date_to=2026-08-31"),
                                                   year_month="", category="", property_id="", payment_method="",
                                                   date_from="2026-07-01", date_to="2026-08-31", db=db)).body.decode()
        assert "台電七月" in page and "洗衣行八月" in page, "older months are not listed"
        assert "台電九月" not in page, "a cost outside the range is listed"
        assert 'name="date_from"' in page and 'name="date_to"' in page, "date search fields are missing"
        assert "2026-07-01 ~ 2026-08-31" in page, "the searched range is not shown"
        for label in ("本月", "上個月", "近 30 天", "今年", "全部"):
            assert label in page, f"quick range {label} is missing"
        assert cost_svc.range_pnl(db, "2026-07-01", "2026-08-31")["total_cost"] == 6000

        # 3) An old month link keeps working.
        month = asyncio.run(costs_router.costs_page(_request("/costs", "year_month=2026-08"), year_month="2026-08",
                                                    category="", property_id="", payment_method="", date_from="",
                                                    date_to="", db=db)).body.decode()
        assert "洗衣行八月" in month and "台電七月" not in month and "台電九月" not in month

        # 4) The report export carries costs for admins only.
        csv_admin = export_csv(db, "2026-07-01", "2026-09-30", include_costs=True).decode("utf-8-sig")
        assert "=== Costs & Profit ===" in csv_admin and "Total Cost (NT$),6800" in csv_admin, csv_admin[-400:]
        assert "=== Cost by Category ===" in csv_admin and "utilities,4800" in csv_admin
        assert "=== Cost Entries ===" in csv_admin and "2026-07-20,utilities,4000,cash,台電七月" in csv_admin
        csv_plain = export_csv(db, "2026-07-01", "2026-09-30").decode("utf-8-sig")
        assert "=== Costs & Profit ===" not in csv_plain and "台電七月" not in csv_plain

        response = asyncio.run(reports_router.export_csv_endpoint(_request("/reports/export.csv"), date_from="2026-07-01",
                                                                  date_to="2026-09-30", db=db))
        assert "=== Cost Entries ===" in response.body.decode("utf-8-sig"), "admin export has no costs"
        auth_svc.get_current_user = lambda request, db: MANAGER
        response = asyncio.run(reports_router.export_csv_endpoint(_request("/reports/export.csv"), date_from="2026-07-01",
                                                                  date_to="2026-09-30", db=db))
        assert "=== Costs & Profit ===" not in response.body.decode("utf-8-sig"), "manager export leaks costs"
        print("cost_history_report_regression_test: OK")
    finally:
        db.close()


if __name__ == "__main__":
    main()

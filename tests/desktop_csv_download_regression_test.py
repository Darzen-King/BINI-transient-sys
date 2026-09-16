"""Regression: CSV exports must download from the desktop (pywebview) window.

pywebview cancels every download unless settings['ALLOW_DOWNLOADS'] is True, so the 付款管理 CSV button
(and every other export) silently did nothing in the desktop app although the server returned the file.
Run from the repository root:
    python tests/desktop_csv_download_regression_test.py
"""
import asyncio
from pathlib import Path
from types import SimpleNamespace
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool
from starlette.requests import Request

import app.services.auth as auth_svc
import app.services.backup as backup_svc
from app.db import Base
from app.models import Payment
from app.routers import phase4 as phase4_router

ADMIN = SimpleNamespace(id=1, username="admin", role="admin", is_active=True, display_name="Admin")


def main() -> None:
    # 1) The desktop window allows downloads, and does so before the window is created.
    source = (ROOT / "desktop.py").read_text(encoding="utf-8")
    setting = source.find("webview.settings['ALLOW_DOWNLOADS'] = True")
    window = source.find("webview.create_window(")
    assert setting != -1, "desktop.py never enables downloads, so exports are cancelled"
    assert window != -1 and setting < window, "downloads must be enabled before the window is created"

    # 2) The payments CSV endpoint returns an attachment the window can save.
    backup_svc.auto_backup = lambda *args, **kwargs: None
    auth_svc.get_current_user = lambda request, db: ADMIN
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    db = sessionmaker(bind=engine)()
    try:
        db.add(Payment(room_id="206", guest="Edong", payment_type="cash", amount=8000, is_deposit=0, is_refund=0,
                       payment_status="paid", note="月租租金", created_at="2026-09-16 18:28", created_by="admin"))
        db.commit()
        request = Request({"type": "http", "method": "GET", "path": "/export/payments", "query_string": b"", "headers": []})
        response = asyncio.run(phase4_router.export_data(request, data_type="payments", date_from="2026-09-01",
                                                         date_to="2026-09-16", db=db))
        assert response.status_code == 200, response.status_code
        assert response.headers["content-disposition"].startswith("attachment; filename=payments_2026-09-01_2026-09-16.csv")
        assert "月租租金" in response.body.decode("utf-8-sig")
        print("desktop_csv_download_regression_test: OK")
    finally:
        db.close()


if __name__ == "__main__":
    main()

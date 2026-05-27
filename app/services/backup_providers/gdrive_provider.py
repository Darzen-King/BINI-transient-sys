"""
backup_providers/gdrive_provider.py

Google Drive API v3 via Service Account.
Requires: pip install google-api-python-client google-auth
If not installed, test_connection() returns a clear install instruction.
"""
import json
from app.services.backup_providers.base import BaseProvider, ProviderResult

INSTALL_MSG = (
    "⚠ 需要額外安裝套件：\n"
    "pip install google-api-python-client google-auth\n"
    "安裝後重新啟動服務即可使用 Google Drive 備份。"
)


class GDriveProvider(BaseProvider):
    display_name  = "Google Drive"
    provider_type = "gdrive"

    def _build_service(self):
        try:
            from google.oauth2 import service_account
            from googleapiclient.discovery import build
        except ImportError:
            return None, INSTALL_MSG

        sa_json = self.credentials.get("service_account_json", "")
        if not sa_json:
            return None, "❌ 未提供 Service Account JSON"
        try:
            info = json.loads(sa_json)
        except json.JSONDecodeError:
            return None, "❌ Service Account JSON 格式錯誤"

        creds = service_account.Credentials.from_service_account_info(
            info, scopes=["https://www.googleapis.com/auth/drive"]
        )
        service = build("drive", "v3", credentials=creds, cache_discovery=False)
        return service, None

    def _folder_id(self) -> str:
        return self.credentials.get("folder_id", "")

    def test_connection(self) -> ProviderResult:
        service, err = self._build_service()
        if err:
            return ProviderResult(False, err)
        try:
            fid = self._folder_id()
            service.files().get(fileId=fid, fields="id,name").execute()
            return ProviderResult(True, "✅ Google Drive 連線成功")
        except Exception as ex:
            return ProviderResult(False, f"❌ 連線失敗：{ex}")

    def upload(self, filename: str, data: bytes) -> ProviderResult:
        service, err = self._build_service()
        if err:
            return ProviderResult(False, err)
        try:
            from googleapiclient.http import MediaIoBaseUpload
            import io

            fid = self._folder_id()
            # Check if file exists
            results = service.files().list(
                q=f"name='{filename}' and '{fid}' in parents and trashed=false",
                fields="files(id)",
            ).execute()
            existing = results.get("files", [])

            media = MediaIoBaseUpload(io.BytesIO(data), mimetype="application/octet-stream")
            if existing:
                service.files().update(
                    fileId=existing[0]["id"], media_body=media
                ).execute()
            else:
                meta = {"name": filename, "parents": [fid]}
                service.files().create(body=meta, media_body=media).execute()
            return ProviderResult(True, f"✅ 上傳成功：{filename}")
        except Exception as ex:
            return ProviderResult(False, f"❌ 上傳失敗：{ex}")

    def download(self, filename: str) -> tuple[bytes | None, ProviderResult]:
        service, err = self._build_service()
        if err:
            return None, ProviderResult(False, err)
        try:
            from googleapiclient.http import MediaIoBaseDownload
            import io

            fid = self._folder_id()
            results = service.files().list(
                q=f"name='{filename}' and '{fid}' in parents and trashed=false",
                fields="files(id)",
            ).execute()
            files = results.get("files", [])
            if not files:
                return None, ProviderResult(False, f"❌ 找不到檔案：{filename}")

            request = service.files().get_media(fileId=files[0]["id"])
            buf = io.BytesIO()
            downloader = MediaIoBaseDownload(buf, request)
            done = False
            while not done:
                _, done = downloader.next_chunk()
            return buf.getvalue(), ProviderResult(True, f"✅ 下載成功：{filename}")
        except Exception as ex:
            return None, ProviderResult(False, f"❌ 下載失敗：{ex}")

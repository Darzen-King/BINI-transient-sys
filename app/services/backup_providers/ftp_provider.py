"""
backup_providers/ftp_provider.py

FTP — Python built-in ftplib, no extra install.
Requires: host + port + username + password + remote_path
"""
import ftplib
import io
from app.services.backup_providers.base import BaseProvider, ProviderResult


class FTPProvider(BaseProvider):
    display_name  = "FTP"
    provider_type = "ftp"

    def _connect(self) -> ftplib.FTP:
        ftp = ftplib.FTP()
        ftp.connect(
            self.credentials.get("host", ""),
            int(self.credentials.get("port", 21)),
            timeout=10,
        )
        ftp.login(
            self.credentials.get("username", ""),
            self.credentials.get("password", ""),
        )
        return ftp

    def _remote_path(self, filename: str | None = None) -> str:
        base = self.credentials.get("remote_path", "/BiniBloomsData").rstrip("/")
        return f"{base}/{filename}" if filename else base

    def test_connection(self) -> ProviderResult:
        try:
            ftp = self._connect()
            path = self._remote_path()
            try:
                ftp.cwd(path)
            except ftplib.error_perm:
                try:
                    ftp.mkd(path)
                except Exception as ex:
                    ftp.quit()
                    return ProviderResult(False, f"❌ 無法建立目錄：{ex}")
            ftp.quit()
            return ProviderResult(True, "✅ FTP 連線成功")
        except ftplib.error_perm as e:
            return ProviderResult(False, f"❌ 帳號或密碼錯誤：{e}")
        except Exception as ex:
            return ProviderResult(False, f"❌ 連線失敗：{ex}")

    def upload(self, filename: str, data: bytes) -> ProviderResult:
        try:
            ftp = self._connect()
            path = self._remote_path()
            try:
                ftp.cwd(path)
            except ftplib.error_perm:
                ftp.mkd(path)
                ftp.cwd(path)
            ftp.storbinary(f"STOR {filename}", io.BytesIO(data))
            ftp.quit()
            return ProviderResult(True, f"✅ 上傳成功：{filename}")
        except Exception as ex:
            return ProviderResult(False, f"❌ 上傳失敗：{ex}")

    def download(self, filename: str) -> tuple[bytes | None, ProviderResult]:
        try:
            ftp = self._connect()
            path = self._remote_path()
            ftp.cwd(path)
            buf = io.BytesIO()
            ftp.retrbinary(f"RETR {filename}", buf.write)
            ftp.quit()
            return buf.getvalue(), ProviderResult(True, f"✅ 下載成功：{filename}")
        except Exception as ex:
            return None, ProviderResult(False, f"❌ 下載失敗：{ex}")

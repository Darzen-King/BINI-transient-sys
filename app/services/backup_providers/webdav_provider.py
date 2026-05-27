"""
backup_providers/webdav_provider.py

WebDAV / Nextcloud — pure urllib, no SDK.
Requires: server URL + username + password + remote_path
"""
import base64
import urllib.request
import urllib.error
from app.services.backup_providers.base import BaseProvider, ProviderResult


class WebDAVProvider(BaseProvider):
    display_name  = "WebDAV / Nextcloud"
    provider_type = "webdav"

    def _url(self, filename: str | None = None) -> str:
        base = self.credentials.get("url", "").rstrip("/")
        path = self.credentials.get("remote_path", "BiniBloomsData").strip("/")
        if filename:
            return f"{base}/{path}/{filename}"
        return f"{base}/{path}/"

    def _auth_header(self) -> str:
        u = self.credentials.get("username", "")
        p = self.credentials.get("password", "")
        token = base64.b64encode(f"{u}:{p}".encode()).decode()
        return f"Basic {token}"

    def _headers(self) -> dict:
        return {"Authorization": self._auth_header()}

    def test_connection(self) -> ProviderResult:
        try:
            req = urllib.request.Request(
                self._url(), headers=self._headers(), method="PROPFIND"
            )
            req.add_header("Depth", "0")
            with urllib.request.urlopen(req, timeout=10) as r:
                r.read()
            return ProviderResult(True, "✅ WebDAV 連線成功")
        except urllib.error.HTTPError as e:
            if e.code == 404:
                return self._mkcol()
            if e.code == 401:
                return ProviderResult(False, "❌ 帳號或密碼錯誤")
            return ProviderResult(False, f"❌ HTTP {e.code}")
        except Exception as ex:
            return ProviderResult(False, f"❌ 連線失敗：{ex}")

    def _mkcol(self) -> ProviderResult:
        try:
            req = urllib.request.Request(
                self._url(), headers=self._headers(), method="MKCOL"
            )
            with urllib.request.urlopen(req, timeout=10) as r:
                r.read()
            return ProviderResult(True, "✅ 目錄已建立，連線成功")
        except Exception as ex:
            return ProviderResult(False, f"❌ 建立目錄失敗：{ex}")

    def upload(self, filename: str, data: bytes) -> ProviderResult:
        try:
            req = urllib.request.Request(
                self._url(filename),
                data=data,
                headers={**self._headers(), "Content-Type": "application/octet-stream"},
                method="PUT",
            )
            with urllib.request.urlopen(req, timeout=30) as r:
                r.read()
            return ProviderResult(True, f"✅ 上傳成功：{filename}")
        except urllib.error.HTTPError as e:
            return ProviderResult(False, f"❌ 上傳失敗 HTTP {e.code}")
        except Exception as ex:
            return ProviderResult(False, f"❌ 上傳失敗：{ex}")

    def download(self, filename: str) -> tuple[bytes | None, ProviderResult]:
        try:
            req = urllib.request.Request(
                self._url(filename), headers=self._headers()
            )
            with urllib.request.urlopen(req, timeout=30) as r:
                data = r.read()
            return data, ProviderResult(True, f"✅ 下載成功：{filename}")
        except urllib.error.HTTPError as e:
            return None, ProviderResult(False, f"❌ 下載失敗 HTTP {e.code}")
        except Exception as ex:
            return None, ProviderResult(False, f"❌ 下載失敗：{ex}")

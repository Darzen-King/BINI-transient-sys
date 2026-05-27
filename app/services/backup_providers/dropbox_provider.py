"""
backup_providers/dropbox_provider.py

Dropbox HTTP API v2 — no SDK, pure urllib.
Supports two auth modes:
  1. Legacy short-lived access_token only (4hr, manual refresh needed)
  2. OAuth2 refresh flow: app_key + app_secret + refresh_token
     → automatically fetches & caches a fresh access_token before each call
"""
import json
import time
import urllib.request
import urllib.error
import urllib.parse
from app.services.backup_providers.base import BaseProvider, ProviderResult

# In-memory token cache: avoids fetching a new token on every request
# Keyed by refresh_token, stores (access_token, expires_at)
_TOKEN_CACHE: dict[str, tuple[str, float]] = {}

OAUTH_TOKEN_URL = "https://api.dropboxapi.com/oauth2/token"


class DropboxProvider(BaseProvider):
    display_name  = "Dropbox"
    provider_type = "dropbox"

    API_UPLOAD   = "https://content.dropboxapi.com/2/files/upload"
    API_DOWNLOAD = "https://content.dropboxapi.com/2/files/download"
    API_LIST     = "https://api.dropboxapi.com/2/files/list_folder"
    API_CREATE   = "https://api.dropboxapi.com/2/files/create_folder_v2"

    def _get_access_token(self) -> tuple[str, str | None]:
        """
        Return (access_token, error_message).
        If refresh_token + app_key + app_secret are present, auto-refresh.
        Otherwise fall back to the stored access_token.
        """
        refresh_token = self.credentials.get("refresh_token", "").strip()
        app_key       = self.credentials.get("app_key", "").strip()
        app_secret    = self.credentials.get("app_secret", "").strip()

        # ── OAuth2 refresh flow ───────────────────────────────────────────
        if refresh_token and app_key and app_secret:
            # Check cache (leave 5-min buffer before expiry)
            cached = _TOKEN_CACHE.get(refresh_token)
            if cached:
                token, expires_at = cached
                if time.time() < expires_at - 300:
                    return token, None

            # Fetch fresh token
            try:
                body = urllib.parse.urlencode({
                    "grant_type":    "refresh_token",
                    "refresh_token": refresh_token,
                    "client_id":     app_key,
                    "client_secret": app_secret,
                }).encode()
                req = urllib.request.Request(
                    OAUTH_TOKEN_URL,
                    data=body,
                    headers={"Content-Type": "application/x-www-form-urlencoded"},
                    method="POST",
                )
                with urllib.request.urlopen(req, timeout=15) as r:
                    resp = json.loads(r.read())

                new_token  = resp["access_token"]
                expires_in = int(resp.get("expires_in", 14400))
                _TOKEN_CACHE[refresh_token] = (new_token, time.time() + expires_in)

                # Persist refreshed token back to credentials in memory
                self.credentials["access_token"] = new_token
                return new_token, None

            except urllib.error.HTTPError as e:
                body = e.read().decode()
                return "", f"Token refresh failed HTTP {e.code}: {body[:200]}"
            except Exception as ex:
                return "", f"Token refresh error: {ex}"

        # ── Legacy: direct access_token ───────────────────────────────────
        token = self.credentials.get("access_token", "").strip()
        if not token:
            return "", "No access_token configured"
        return token, None

    def _headers(self) -> dict | None:
        """Return auth headers, or None on token error."""
        token, err = self._get_access_token()
        if err:
            return None
        return {"Authorization": f"Bearer {token}"}

    def _remote_path(self, filename: str) -> str:
        base = self.credentials.get("remote_path", "/BiniBloomsData").rstrip("/")
        return f"{base}/{filename}"

    def test_connection(self) -> ProviderResult:
        hdrs = self._headers()
        if hdrs is None:
            _, err = self._get_access_token()
            return ProviderResult(False, f"❌ Token 取得失敗：{err}")
        try:
            path    = self.credentials.get("remote_path", "/BiniBloomsData")
            payload = json.dumps({"path": path, "recursive": False}).encode()
            req     = urllib.request.Request(
                self.API_LIST, data=payload,
                headers={**hdrs, "Content-Type": "application/json"},
            )
            with urllib.request.urlopen(req, timeout=10) as r:
                r.read()
            return ProviderResult(True, "✅ Dropbox 連線成功")
        except urllib.error.HTTPError as e:
            body = e.read().decode()
            if "path/not_found" in body:
                return self._create_folder()
            if e.code == 401:
                return ProviderResult(False, "❌ Token 無效或已過期，請重新設定")
            return ProviderResult(False, f"❌ HTTP {e.code}", body[:200])
        except Exception as ex:
            return ProviderResult(False, f"❌ 連線失敗：{ex}")

    def _create_folder(self) -> ProviderResult:
        hdrs = self._headers()
        if hdrs is None:
            return ProviderResult(False, "❌ 無法取得 Token")
        try:
            path    = self.credentials.get("remote_path", "/BiniBloomsData")
            payload = json.dumps({"path": path, "autorename": False}).encode()
            req     = urllib.request.Request(
                self.API_CREATE, data=payload,
                headers={**hdrs, "Content-Type": "application/json"},
            )
            with urllib.request.urlopen(req, timeout=10) as r:
                r.read()
            return ProviderResult(True, "✅ 資料夾已建立，連線成功")
        except Exception as ex:
            return ProviderResult(False, f"❌ 建立資料夾失敗：{ex}")

    def upload(self, filename: str, data: bytes) -> ProviderResult:
        hdrs = self._headers()
        if hdrs is None:
            _, err = self._get_access_token()
            return ProviderResult(False, f"❌ Token 取得失敗：{err}")
        try:
            remote = self._remote_path(filename)
            arg    = json.dumps({"path": remote, "mode": "overwrite", "autorename": False})
            req    = urllib.request.Request(
                self.API_UPLOAD, data=data,
                headers={
                    **hdrs,
                    "Content-Type":    "application/octet-stream",
                    "Dropbox-API-Arg": arg,
                },
            )
            with urllib.request.urlopen(req, timeout=30) as r:
                r.read()
            return ProviderResult(True, f"✅ 上傳成功：{filename}")
        except urllib.error.HTTPError as e:
            body = e.read().decode()
            if e.code == 401:
                return ProviderResult(False, "❌ Token 已過期，正在自動更新…請重新同步")
            return ProviderResult(False, f"❌ 上傳失敗 HTTP {e.code}", body[:200])
        except Exception as ex:
            return ProviderResult(False, f"❌ 上傳失敗：{ex}")

    def download(self, filename: str) -> tuple[bytes | None, ProviderResult]:
        hdrs = self._headers()
        if hdrs is None:
            _, err = self._get_access_token()
            return None, ProviderResult(False, f"❌ Token 取得失敗：{err}")
        try:
            remote = self._remote_path(filename)
            arg    = json.dumps({"path": remote})
            req    = urllib.request.Request(
                self.API_DOWNLOAD,
                headers={**hdrs, "Dropbox-API-Arg": arg},
            )
            with urllib.request.urlopen(req, timeout=30) as r:
                data = r.read()
            return data, ProviderResult(True, f"✅ 下載成功：{filename}")
        except urllib.error.HTTPError as e:
            return None, ProviderResult(False, f"❌ 下載失敗 HTTP {e.code}")
        except Exception as ex:
            return None, ProviderResult(False, f"❌ 下載失敗：{ex}")

"""
services/backup_providers/base.py

Abstract base class for all backup providers.
All user-facing strings use i18n keys — resolved in the template layer.
"""
from abc import ABC, abstractmethod
from dataclasses import dataclass


@dataclass
class ProviderResult:
    success: bool
    message: str
    detail:  str = ""


class BaseProvider(ABC):
    """Common interface for all backup providers."""

    def __init__(self, credentials: dict):
        self.credentials = credentials

    @abstractmethod
    def test_connection(self) -> ProviderResult: ...

    @abstractmethod
    def upload(self, filename: str, data: bytes) -> ProviderResult: ...

    @abstractmethod
    def download(self, filename: str) -> tuple[bytes | None, ProviderResult]: ...

    @property
    @abstractmethod
    def display_name(self) -> str: ...

    @property
    @abstractmethod
    def provider_type(self) -> str: ...


# ── Provider registry ─────────────────────────────────────────────────────────
# All label/hint values here are i18n keys resolved at template render time.

PROVIDER_TYPES = {
    "dropbox": {
        "label":          "Dropbox",
        "description_key":"backup.desc.dropbox",
        "install_key":    "backup.install.not_required",
        "auth_modes": ["oauth2", "token"],   # oauth2 = long-lived; token = legacy short-lived
        "fields": [
            # ── OAuth2 (recommended, auto-refresh) ──────────────────────
            {"key": "app_key",       "label_key": "backup.field.app_key",
             "type": "text",         "hint_key": "backup.field.app_key_hint",
             "group": "oauth2"},
            {"key": "app_secret",    "label_key": "backup.field.app_secret",
             "type": "password",     "hint_key": "backup.field.app_secret_hint",
             "group": "oauth2"},
            {"key": "refresh_token", "label_key": "backup.field.refresh_token",
             "type": "password",     "hint_key": "backup.field.refresh_token_hint",
             "group": "oauth2"},
            # ── Legacy short-lived token (fallback) ─────────────────────
            {"key": "access_token",  "label_key": "backup.field.access_token",
             "type": "password",     "hint_key": "backup.field.access_token_hint",
             "group": "token"},
            # ── Common ──────────────────────────────────────────────────
            {"key": "remote_path",   "label_key": "backup.field.remote_path",
             "type": "text",         "hint_key": "backup.field.remote_path_hint",
             "group": "both"},
        ],
    },
    "webdav": {
        "label":          "WebDAV / Nextcloud",
        "description_key":"backup.desc.webdav",
        "install_key":    "backup.install.not_required",
        "fields": [
            {"key": "url",          "label_key": "backup.field.server_url",
             "type": "text",        "hint_key": "backup.field.server_url_hint"},
            {"key": "username",     "label_key": "backup.field.username",
             "type": "text",        "hint_key": ""},
            {"key": "password",     "label_key": "backup.field.password",
             "type": "password",    "hint_key": ""},
            {"key": "remote_path",  "label_key": "backup.field.remote_path",
             "type": "text",        "hint_key": "backup.field.remote_path_hint"},
        ],
    },
    "ftp": {
        "label":          "FTP",
        "description_key":"backup.desc.ftp",
        "install_key":    "backup.install.ftp",
        "fields": [
            {"key": "host",         "label_key": "backup.field.host",
             "type": "text",        "hint_key": "backup.field.host_hint"},
            {"key": "port",         "label_key": "Port",
             "type": "text",        "hint_key": "backup.field.port_hint"},
            {"key": "username",     "label_key": "backup.field.username",
             "type": "text",        "hint_key": ""},
            {"key": "password",     "label_key": "backup.field.password",
             "type": "password",    "hint_key": ""},
            {"key": "remote_path",  "label_key": "backup.field.remote_dir",
             "type": "text",        "hint_key": "backup.field.remote_dir_hint"},
        ],
    },
    "gdrive": {
        "label":          "Google Drive",
        "description_key":"backup.desc.gdrive",
        "install_key":    "backup.install.gdrive",
        "fields": [
            {"key": "service_account_json", "label_key": "Service Account JSON",
             "type": "textarea",            "hint_key": "backup.field.sa_json_hint"},
            {"key": "folder_id",            "label_key": "Drive Folder ID",
             "type": "text",                "hint_key": "backup.field.folder_id_hint"},
        ],
    },
}


def get_provider(provider_type: str, credentials: dict) -> "BaseProvider":
    """Factory: return the correct provider instance."""
    from app.services.backup_providers.dropbox_provider import DropboxProvider
    from app.services.backup_providers.webdav_provider  import WebDAVProvider
    from app.services.backup_providers.ftp_provider     import FTPProvider
    from app.services.backup_providers.gdrive_provider  import GDriveProvider

    mapping = {
        "dropbox": DropboxProvider,
        "webdav":  WebDAVProvider,
        "ftp":     FTPProvider,
        "gdrive":  GDriveProvider,
    }
    cls = mapping.get(provider_type)
    if not cls:
        raise ValueError(f"Unknown provider: {provider_type}")
    return cls(credentials)

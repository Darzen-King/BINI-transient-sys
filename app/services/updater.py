"""
services/updater.py — In-app self-update from the project's GitHub repo.

Design (all driven from the 雲端備份 page, admin only):
  1. check_update()  — compare local VERSION with the repo's VERSION file on GitHub.
  2. download_and_stage() — download the repo zip, extract to a TEMP staging dir,
     and verify it looks like a real BINI build (has app/ and VERSION).
  3. launch_updater(staging) — write an external .bat into TEMP and start it
     detached. The caller then exits the app so files unlock. The .bat:
       - waits for the app to die,
       - robocopy /E copies the new code over the install dir WITHOUT /MIR, and
         with the database / local-backup / logs explicitly excluded, so user
         data is never touched,
       - reinstalls requirements (in case deps changed),
       - relaunches the desktop app,
       - cleans up the staging dir and itself.

Safety notes:
  * The cloud backup MUST run and succeed BEFORE this is invoked (done in the
    endpoint) — we never overwrite code without a fresh cloud backup.
  * Downloads come only from this project's own public GitHub repo over HTTPS.
  * The updater never deletes files it didn't ship (no robocopy /MIR), and it
    excludes bini_blooms.db, *.log and the local backup folder.
"""
from __future__ import annotations

import io
import os
import re
import sys
import ssl
import zipfile
import tempfile
import subprocess
import urllib.request
from pathlib import Path

REPO            = "Darzen-King/BINI-transient-sys"
RAW_VERSION_URL = f"https://raw.githubusercontent.com/{REPO}/main/VERSION"
ZIP_URL         = f"https://github.com/{REPO}/archive/refs/heads/main.zip"

INSTALL_DIR = Path(__file__).resolve().parent.parent.parent   # project root (has desktop.py / VERSION)
VERSION_FILE = INSTALL_DIR / "VERSION"

# Never overwrite these on update (user data / runtime artefacts).
_EXCLUDE_FILES = ["bini_blooms.db", "*.log"]
_EXCLUDE_DIRS  = ["BINI_Blooms_Data", ".git", "__pycache__", ".venv", "venv"]


# ── version helpers ─────────────────────────────────────────────────────────
def local_version() -> str:
    try:
        return VERSION_FILE.read_text(encoding="utf-8").strip() or "0.0.0"
    except Exception:
        return "0.0.0"


def _fetch(url: str, timeout: int = 15) -> bytes:
    ctx = ssl.create_default_context()
    req = urllib.request.Request(url, headers={"User-Agent": "BINI-Blooms-Updater"})
    with urllib.request.urlopen(req, timeout=timeout, context=ctx) as r:
        return r.read()


def remote_version(timeout: int = 10) -> str:
    return _fetch(RAW_VERSION_URL, timeout).decode("utf-8").strip()


def _vt(s: str) -> tuple:
    """'v3.9.4' / '3.9.4' → (3, 9, 4); non-numeric parts sort as 0."""
    nums = re.findall(r"\d+", s or "")
    return tuple(int(n) for n in nums) if nums else (0,)


def check_update() -> dict:
    cur = local_version()
    try:
        latest = remote_version()
    except Exception as ex:
        return {"current": cur, "latest": None,
                "update_available": False, "error": f"無法連線 GitHub 檢查更新：{ex}"}
    return {"current": cur, "latest": latest,
            "update_available": _vt(latest) > _vt(cur), "error": None}


# ── download + stage ────────────────────────────────────────────────────────
def download_and_stage() -> Path:
    """Download the repo zip, extract to a fresh TEMP dir, return the staging
    dir (the extracted '<repo>-main' folder). Raises on any problem."""
    data = _fetch(ZIP_URL, timeout=120)
    staging_root = Path(tempfile.mkdtemp(prefix="bini_update_"))
    with zipfile.ZipFile(io.BytesIO(data)) as z:
        z.extractall(staging_root)
    # find the single top-level extracted dir (…-main)
    subdirs = [p for p in staging_root.iterdir() if p.is_dir()]
    if not subdirs:
        raise RuntimeError("下載內容異常（找不到程式資料夾）")
    staging = subdirs[0]
    if not (staging / "app").is_dir() or not (staging / "VERSION").is_file() \
            or not (staging / "desktop.py").is_file():
        raise RuntimeError("下載內容不完整（缺少 app/ 或 VERSION）")
    return staging


# ── interpreter resolution ──────────────────────────────────────────────────
def _resolve_interpreters() -> tuple[str, str]:
    """Return (python_exe_for_pip, pythonw_exe_for_relaunch)."""
    exe = sys.executable or "python"
    low = exe.lower()
    if low.endswith("pythonw.exe"):
        pyexe  = exe[:-len("pythonw.exe")] + "python.exe"
        pywexe = exe
    elif low.endswith("python.exe"):
        pyexe  = exe
        cand   = exe[:-len("python.exe")] + "pythonw.exe"
        pywexe = cand if Path(cand).exists() else exe
    else:
        pyexe = pywexe = exe
    if not Path(pyexe).exists():
        pyexe = exe
    return pyexe, pywexe


# ── launch external updater ─────────────────────────────────────────────────
def _build_script(staging: Path, install_dir: Path, pyexe: str, pywexe: str) -> str:
    """Generate the updater .bat content. Kept separate so it is testable
    without launching anything."""
    staging_root = staging.parent
    xf = " ".join(_EXCLUDE_FILES)
    xd = " ".join(f'"{d}"' for d in _EXCLUDE_DIRS)
    return f"""@echo off
chcp 65001 >nul 2>&1
REM --- BINI Blooms auto-updater (generated) ---
REM Wait for the running app to exit and release file locks.
ping 127.0.0.1 -n 5 >nul

REM Copy new code over the install dir. NO /MIR (never delete user data);
REM DB, logs and the local backup folder are explicitly excluded.
robocopy "{staging}" "{install_dir}" /E /R:2 /W:1 /XF {xf} /XD {xd} >nul

REM Reinstall requirements in case dependencies changed (best-effort).
"{pyexe}" -m pip install -r "{install_dir}\\requirements.txt" --quiet >nul 2>&1

REM Relaunch the desktop app (single-instance; the old one has exited).
start "" "{pywexe}" "{install_dir}\\desktop.py"

REM Clean up staging + self.
rmdir /s /q "{staging_root}" >nul 2>&1
del "%~f0" >nul 2>&1
"""


def launch_updater(staging: Path) -> None:
    """Write the updater .bat next to the staging dir and start it detached."""
    pyexe, pywexe = _resolve_interpreters()
    staging_root  = staging.parent            # the mkdtemp() dir we remove at the end
    bat = staging_root / "_bini_apply_update.bat"
    bat.write_text(_build_script(staging, INSTALL_DIR, pyexe, pywexe), encoding="utf-8")

    DETACHED_PROCESS         = 0x00000008
    CREATE_NEW_PROCESS_GROUP = 0x00000200
    subprocess.Popen(
        ["cmd", "/c", str(bat)],
        cwd=str(staging_root),
        creationflags=DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP,
        close_fds=True,
    )

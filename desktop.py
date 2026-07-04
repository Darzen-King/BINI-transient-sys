"""
desktop.py — BINI Blooms PMS 桌面單一實例啟動器

用途：讓系統以「專屬視窗 + 專屬圖示」執行，且全機一次只允許一個實例。
- 已在執行 → 把既有視窗叫到最前面，然後本次啟動立即結束（不會開第二個視窗）。
- 內嵌 pywebview 視窗載入本機 FastAPI 伺服器（同進程執行，關視窗即整個收工）。
- 埠優先用 8000，被占用時自動退到空閒埠。

沒有主控台（由 pythonw 啟動），所以所有訊息寫入 desktop.log；致命錯誤另彈訊息框。
"""
import os
import sys
import time
import socket
import ctypes
import logging
import threading
from ctypes import wintypes

APP_DIR      = os.path.dirname(os.path.abspath(__file__))
ICON_PATH    = os.path.join(APP_DIR, "icon.ico")
LOG_PATH     = os.path.join(APP_DIR, "desktop.log")
WINDOW_TITLE = "BINI Blooms PMS"
MUTEX_NAME   = "BINIBloomsPMS_SingleInstance_v1"   # 全機（本使用者工作階段）唯一
APP_USER_ID  = "BINIBlooms.PMS.Desktop"
PREFERRED_PORT = 8000

sys.path.insert(0, APP_DIR)

# 讓 stdout/stderr 永遠可以安全輸出 emoji/中文，不論怎麼被啟動：
# - pythonw 啟動：stdout/stderr 是 None → 導向 UTF-8 檔案。
# - 一般主控台/管線啟動但編碼是 cp950：app 啟動訊息的 emoji print() 會
#   UnicodeEncodeError 使伺服器啟動失敗 → reconfigure 成 UTF-8 + replace。
def _make_streams_safe():
    try:
        _null = None
        for name in ("stdout", "stderr"):
            stream = getattr(sys, name)
            if stream is None:
                if _null is None:
                    _null = open(os.path.join(APP_DIR, "desktop_out.log"), "a",
                                 encoding="utf-8", errors="replace")
                setattr(sys, name, _null)
            else:
                try:
                    stream.reconfigure(encoding="utf-8", errors="replace")
                except Exception:
                    pass  # 不支援 reconfigure 的串流就保持原樣
    except Exception:
        pass

_make_streams_safe()


def _setup_logging():
    logging.basicConfig(
        filename=LOG_PATH, filemode="a",
        level=logging.INFO,
        format="%(asctime)s [%(levelname)s] %(message)s",
    )


def _msgbox(text, title=WINDOW_TITLE):
    try:
        ctypes.windll.user32.MessageBoxW(0, text, title, 0x10)  # MB_ICONERROR
    except Exception:
        pass


# ── 找視窗（依標題子字串，較穩） ─────────────────────────────────────────────
def _find_window():
    user32 = ctypes.windll.user32
    found = {"hwnd": None}
    EnumProc = ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM)

    def _cb(hwnd, _lparam):
        length = user32.GetWindowTextLengthW(hwnd)
        if length:
            buf = ctypes.create_unicode_buffer(length + 1)
            user32.GetWindowTextW(hwnd, buf, length + 1)
            if WINDOW_TITLE in buf.value and user32.IsWindowVisible(hwnd):
                found["hwnd"] = hwnd
                return False
        return True

    user32.EnumWindows(EnumProc(_cb), 0)
    return found["hwnd"]


def _focus_existing_window():
    """把既有實例的視窗還原並帶到最前面。"""
    user32 = ctypes.windll.user32
    for _ in range(20):
        hwnd = _find_window()
        if hwnd:
            user32.ShowWindow(hwnd, 9)          # SW_RESTORE
            user32.SetForegroundWindow(hwnd)
            return True
        time.sleep(0.1)
    return False


# ── 單一實例（具名 mutex） ──────────────────────────────────────────────────
def _acquire_single_instance():
    """成功取得 → 回傳 handle（要持有到程式結束）；已有實例 → 回傳 None。"""
    kernel32 = ctypes.windll.kernel32
    handle = kernel32.CreateMutexW(None, True, MUTEX_NAME)
    if kernel32.GetLastError() == 183:  # ERROR_ALREADY_EXISTS
        return None
    return handle


# ── 選一個可用埠 ────────────────────────────────────────────────────────────
def _pick_port():
    candidates = [PREFERRED_PORT] + list(range(8001, 8021))
    for p in candidates:
        s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        try:
            s.bind(("127.0.0.1", p))
            s.close()
            return p
        except OSError:
            s.close()
    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    s.bind(("127.0.0.1", 0))
    p = s.getsockname()[1]
    s.close()
    return p


# ── 在同進程的執行緒中啟動 uvicorn ──────────────────────────────────────────
def _start_server(port):
    import uvicorn
    from app.main import app as fastapi_app

    # log_config=None：不要讓 uvicorn 重設日誌（在 pythonw 無 stdout 時會失敗）
    config = uvicorn.Config(fastapi_app, host="127.0.0.1", port=port,
                            log_level="warning", log_config=None)
    server = uvicorn.Server(config)
    threading.Thread(target=server.run, daemon=True, name="uvicorn").start()
    for _ in range(400):          # 最多等 ~20 秒
        if server.started:
            return server
        time.sleep(0.05)
    return server


# ── 把工作列/標題列圖示換成專屬圖示 ─────────────────────────────────────────
def _apply_icon():
    if not os.path.exists(ICON_PATH):
        return
    user32 = ctypes.windll.user32
    IMAGE_ICON, LR_LOADFROMFILE, WM_SETICON = 1, 0x0010, 0x0080
    for _ in range(150):
        hwnd = _find_window()
        if hwnd:
            for size, which in ((32, 1), (16, 0)):   # ICON_BIG=1, ICON_SMALL=0
                hicon = user32.LoadImageW(None, ICON_PATH, IMAGE_ICON, size, size, LR_LOADFROMFILE)
                if hicon:
                    user32.SendMessageW(hwnd, WM_SETICON, which, hicon)
            return
        time.sleep(0.1)


def main():
    _setup_logging()
    try:
        # 已有實例 → 叫回既有視窗後結束
        mutex = _acquire_single_instance()
        if mutex is None:
            logging.info("Another instance is running; focusing it and exiting.")
            _focus_existing_window()
            return

        try:
            ctypes.windll.shell32.SetCurrentProcessExplicitAppUserModelID(APP_USER_ID)
        except Exception:
            pass

        port = _pick_port()
        logging.info("Starting server on 127.0.0.1:%s", port)
        server = _start_server(port)
        if not server.started:
            logging.error("Server failed to start.")
            _msgbox("系統伺服器啟動失敗，請查看 desktop.log。")
            return

        threading.Thread(target=_apply_icon, daemon=True, name="icon").start()

        import webview
        webview.create_window(
            WINDOW_TITLE, f"http://127.0.0.1:{port}/",
            width=1280, height=820, min_size=(1024, 700),
        )
        logging.info("Opening window.")
        webview.start()               # 阻塞，直到視窗關閉

        logging.info("Window closed; shutting down server.")
        server.should_exit = True
        time.sleep(0.3)
    except Exception as ex:           # noqa: BLE001
        logging.exception("Fatal error in desktop launcher")
        _msgbox(f"系統啟動發生錯誤：\n{ex}\n\n詳見 desktop.log")
    finally:
        os._exit(0)                   # 確保背景執行緒（備份/假日同步）一併結束


if __name__ == "__main__":
    main()

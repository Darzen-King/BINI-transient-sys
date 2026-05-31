@echo off
chcp 65001 >nul 2>&1
cd /d "%~dp0"
title BINI Blooms Transient SYS

REM Force Python into UTF-8 mode so emoji/Chinese in startup logs never crash
REM on the legacy console codepage (cp950).
set "PYTHONUTF8=1"
set "PYTHONIOENCODING=utf-8"

echo.
echo ================================================
echo  BINI Blooms Transient SYS v3.6.2
echo ================================================
echo.

REM ── Locate a Python interpreter that actually has the dependencies ──
REM    (the plain "python" on PATH may point to a different environment
REM     that lacks sqlalchemy/uvicorn, so we verify before using it.)
set "PYEXE="
set "PY312=%LocalAppData%\Programs\Python\Python312\python.exe"

REM Candidate 1: py launcher 3.12
py -3.12 -c "import sqlalchemy, uvicorn" >nul 2>&1
if not errorlevel 1 (
    set "PYEXE=py -3.12"
    goto :found
)

REM Candidate 2: explicit Python 3.12 install
if exist "%PY312%" (
    "%PY312%" -c "import sqlalchemy, uvicorn" >nul 2>&1
    if not errorlevel 1 (
        set "PYEXE="%PY312%""
        goto :found
    )
)

REM Candidate 3: plain python on PATH (only if it has the packages)
python -c "import sqlalchemy, uvicorn" >nul 2>&1
if not errorlevel 1 (
    set "PYEXE=python"
    goto :found
)

echo [ERROR] No Python with the required packages was found.
echo         (need: sqlalchemy, uvicorn, fastapi)
echo.
echo   Fix: install them into your Python 3.12, e.g.:
echo        py -3.12 -m pip install -r requirements.txt
echo   or run install.bat
echo.
pause
exit /b 1

:found
REM Check if database exists
if not exist "%~dp0bini_blooms.db" (
    echo.
    echo  [NOTICE] No database found - a fresh one will be created.
    echo  To restore cloud data, visit http://127.0.0.1:8000/backup after startup.
    echo.
)

echo [OK] Interpreter : %PYEXE%
echo [OK] Starting server...
echo.
echo   URL   : http://127.0.0.1:8000
echo   Login : admin / admin1234
echo   Stop  : Ctrl+C
echo.
echo ================================================
echo.

start /b cmd /c "timeout /t 3 /nobreak >nul && start http://127.0.0.1:8000"

%PYEXE% -m uvicorn app.main:app --host 127.0.0.1 --port 8000

echo.
echo Server stopped. Press any key to close.
pause

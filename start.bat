@echo off
chcp 65001 >nul 2>&1
cd /d "%~dp0"
title BINI Blooms Transient SYS

echo.
echo ================================================
echo  BINI Blooms Transient SYS v3.6.2
echo ================================================
echo.

REM Check Python
python --version >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] Python not found.
    echo         Please install Python 3.12 and run install.bat first.
    pause
    exit /b 1
)

REM Check app exists
if not exist "%~dp0app\main.py" (
    echo [ERROR] app\main.py not found.
    echo         Make sure start.bat is in the correct folder.
    pause
    exit /b 1
)

REM Check uvicorn is installed
python -m uvicorn --version >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] uvicorn not installed.
    echo         Please run install.bat first.
    pause
    exit /b 1
)

REM Check if database exists
if not exist "%~dp0bini_blooms.db" (
    echo.
    echo ================================================
    echo  [NOTICE] No database found.
    echo.
    echo  If this is a NEW COMPUTER and you have data
    echo  on another machine or in the cloud:
    echo.
    echo  After startup, go to Cloud Backup page and
    echo  click the Restore button to recover your data.
    echo.
    echo  URL: http://127.0.0.1:8000/backup
    echo ================================================
    echo.
)

echo [OK] Starting server...
echo.
echo   URL   : http://127.0.0.1:8000
echo   Login : admin / admin1234
echo   Stop  : Ctrl+C
echo.
echo ================================================
echo.

start /b cmd /c "timeout /t 3 /nobreak >nul && start http://127.0.0.1:8000"

python -m uvicorn app.main:app --host 127.0.0.1 --port 8000

echo.
echo Server stopped. Press any key to close.
pause

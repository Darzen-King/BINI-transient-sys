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
echo  BINI Blooms Transient SYS v3.7.3
echo ================================================
echo.

REM ?-?- Locate a Python that actually has the dependencies ?-?-?-?-?-?-?-?-?-?-?-?-?-?-?-?-?-?-
REM    We validate by checking the STDOUT marker, not the exit code, because
REM    the Windows Store "py"/"python" alias stubs exit 0 without running.
set "PYEXE="
set "PROBE=%TEMP%\_bb_start_probe.txt"
set "PY312=%LocalAppData%\Programs\Python\Python312\python.exe"
set "PY313=%LocalAppData%\Programs\Python\Python313\python.exe"
set "PY311=%LocalAppData%\Programs\Python\Python311\python.exe"

call :try_cmd  "py -3.12"
if defined PYEXE goto :found
call :try_cmd  "py -3"
if defined PYEXE goto :found
call :try_path "%PY312%"
if defined PYEXE goto :found
call :try_path "%PY313%"
if defined PYEXE goto :found
call :try_path "%PY311%"
if defined PYEXE goto :found
call :try_cmd  "python"
if defined PYEXE goto :found

echo [ERROR] No Python with the required packages was found.
echo         (need: sqlalchemy, uvicorn, fastapi)
echo.
echo   Fix: install them into your Python 3.12, e.g.:
echo        "%PY312%" -m pip install -r requirements.txt
echo   or run install.bat
echo.
pause
exit /b 1

:found
del "%PROBE%" >nul 2>&1
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
exit /b 0

REM ?-?- Helper: probe a launcher command word (e.g. "py -3.12" / "python") ?-?-
:try_cmd
%~1 -c "import sqlalchemy,uvicorn,fastapi;print('BB_OK')" > "%PROBE%" 2>nul
findstr /c:"BB_OK" "%PROBE%" >nul 2>&1
if not errorlevel 1 set "PYEXE=%~1"
goto :eof

REM ?-?- Helper: probe an explicit python.exe path ?-?-?-?-?-?-?-?-?-?-?-?-?-?-?-?-?-?-?-?-?-?-?-?-?-?-
:try_path
if not exist "%~1" goto :eof
"%~1" -c "import sqlalchemy,uvicorn,fastapi;print('BB_OK')" > "%PROBE%" 2>nul
findstr /c:"BB_OK" "%PROBE%" >nul 2>&1
if not errorlevel 1 set "PYEXE="%~1""
goto :eof

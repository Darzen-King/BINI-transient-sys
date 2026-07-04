@echo off
chcp 65001 >nul 2>&1
cd /d "%~dp0"
title BINI Blooms Transient SYS v3.9.0

REM Force Python into UTF-8 mode so emoji/Chinese never crash the legacy codepage.
set "PYTHONUTF8=1"
set "PYTHONIOENCODING=utf-8"

echo.
echo ================================================
echo  BINI Blooms Transient SYS v3.9.0
echo  (desktop window - single instance)
echo ================================================
echo.

REM -- Locate a Python that has the dependencies (validate via STDOUT marker, not
REM    exit code, because the Windows Store alias stubs exit 0 without running). --
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
echo         (need: fastapi, uvicorn, sqlalchemy, pywebview)
echo.
echo   Fix: run install.bat, or install manually:
echo        "%PY312%" -m pip install -r requirements.txt
echo.
pause
exit /b 1

:found
del "%PROBE%" >nul 2>&1

REM -- Derive the windowless interpreter (pythonw / pyw) so no black console lingers. --
set "PYWEXE=%PYEXE%"
set "PYWEXE=%PYWEXE:python.exe=pythonw.exe%"
if /i "%PYEXE%"=="py -3.12" set "PYWEXE=pyw -3.12"
if /i "%PYEXE%"=="py -3"    set "PYWEXE=pyw -3"
if /i "%PYEXE%"=="python"   set "PYWEXE=pythonw"

echo [OK] Interpreter : %PYEXE%
echo [OK] Launching BINI Blooms PMS window...
echo      (If it is already running, the existing window is brought to the front.)

REM desktop.py enforces single-instance: a second launch just focuses the open window.
start "" %PYWEXE% "%~dp0desktop.py"
exit /b 0

REM -- Helpers: validate the interpreter has ALL runtime packages (incl. pywebview) --
:try_cmd
%~1 -c "import fastapi,uvicorn,sqlalchemy,webview;print('BB_OK')" > "%PROBE%" 2>nul
findstr /c:"BB_OK" "%PROBE%" >nul 2>&1
if not errorlevel 1 set "PYEXE=%~1"
goto :eof

:try_path
if not exist "%~1" goto :eof
"%~1" -c "import fastapi,uvicorn,sqlalchemy,webview;print('BB_OK')" > "%PROBE%" 2>nul
findstr /c:"BB_OK" "%PROBE%" >nul 2>&1
if not errorlevel 1 set "PYEXE="%~1""
goto :eof

@echo off
chcp 65001 >nul 2>&1
title BINI Blooms Transient SYS v3.6.2 - Install
set "PYTHONUTF8=1"
set "PYTHONIOENCODING=utf-8"

echo.
echo ================================================
echo  BINI Blooms Transient SYS v3.6.2 - Install
echo  (System Python, no venv required)
echo ================================================
echo.

REM ?-?- Step 1: Locate a Python that actually has pip ?-?-?-?-?-?-?-?-?-?-?-?-?-?-?-?-?-?-?-?-?-?-?-
REM    The plain "python" on PATH may point to an environment without pip,
REM    and the Windows Store alias stubs exit 0 without running ??so we
REM    validate the STDOUT of "pip --version", not the exit code.
set "PYEXE="
set "PROBE=%TEMP%\_bb_install_probe.txt"
set "PY312=%LocalAppData%\Programs\Python\Python312\python.exe"
set "PY311=%LocalAppData%\Programs\Python\Python311\python.exe"
set "PY313=%LocalAppData%\Programs\Python\Python313\python.exe"

call :try_py "py -3.12"
if defined PYEXE goto :pyfound
call :try_py "py -3"
if defined PYEXE goto :pyfound
call :try_path "%PY312%"
if defined PYEXE goto :pyfound
call :try_path "%PY313%"
if defined PYEXE goto :pyfound
call :try_path "%PY311%"
if defined PYEXE goto :pyfound
call :try_py "python"
if defined PYEXE goto :pyfound

echo [ERROR] No Python with pip was found.
echo.
echo Please install Python 3.12 (tick "Add Python to PATH"):
echo   https://www.python.org/downloads/release/python-3128/
echo.
echo If Python is already installed but pip is missing, run:
echo   python -m ensurepip --upgrade
echo.
pause
exit /b 1

:pyfound
del "%PROBE%" >nul 2>&1
echo [OK] Using interpreter: %PYEXE%
for /f "tokens=*" %%v in ('%PYEXE% --version 2^>^&1') do echo [OK] %%v
echo.

REM ?-?- Step 2: Choose install location ?-?-?-?-?-?-?-?-?-?-?-?-?-?-?-?-?-?-?-?-?-?-?-?-?-?-?-?-?-?-?-?-?-?-?-?-?-
echo ================================================
echo  Choose installation folder:
echo.
echo  [1] C:\BiniBloomsData\BINI_Transient_SYS  (recommended)
echo  [2] D:\BiniBloomsData\BINI_Transient_SYS
echo  [3] Enter custom path
echo ================================================
echo.
set /p CHOICE=Enter choice (1/2/3):

if "%CHOICE%"=="1" set TARGET=C:\BiniBloomsData\BINI_Transient_SYS
if "%CHOICE%"=="2" set TARGET=D:\BiniBloomsData\BINI_Transient_SYS
if "%CHOICE%"=="3" (
    echo.
    echo Enter full path e.g. D:\MyApp\BINI_Transient_SYS
    set /p TARGET=Install path:
)
if not defined TARGET set TARGET=C:\BiniBloomsData\BINI_Transient_SYS
if "%TARGET%"=="" set TARGET=C:\BiniBloomsData\BINI_Transient_SYS

echo.
echo [OK] Install location: %TARGET%
echo.

REM ?-?- Step 3: Create target folder ?-?-?-?-?-?-?-?-?-?-?-?-?-?-?-?-?-?-?-?-?-?-?-?-?-?-?-?-?-?-?-?-?-?-?-?-?-?-?-?-
if not exist "%TARGET%" (
    mkdir "%TARGET%"
    if errorlevel 1 (
        echo [ERROR] Cannot create folder: %TARGET%
        echo         Please run as Administrator.
        pause
        exit /b 1
    )
    echo [OK] Created: %TARGET%
) else (
    echo [OK] Folder exists: %TARGET%
)

REM ?-?- Step 4: Copy files (skip if source = target) ?-?-?-?-?-?-?-?-?-?-?-?-?-?-?-?-?-?-?-?-?-?-?-?-
set SOURCE=%~dp0
if "%SOURCE:~-1%"=="\" set SOURCE=%SOURCE:~0,-1%
set TARGETCHECK=%TARGET%
if "%TARGETCHECK:~-1%"=="\" set TARGETCHECK=%TARGETCHECK:~0,-1%

if /i "%SOURCE%"=="%TARGETCHECK%" (
    echo [OK] Already in install folder - skipping copy.
    goto :after_copy
)

echo [..] Copying files...
if exist "%SOURCE%\app"              xcopy "%SOURCE%\app"          "%TARGET%\app\"   /E /I /Y /Q
if exist "%SOURCE%\tests"            xcopy "%SOURCE%\tests"        "%TARGET%\tests\" /E /I /Y /Q
if exist "%SOURCE%\tools"            xcopy "%SOURCE%\tools"        "%TARGET%\tools\" /E /I /Y /Q
if exist "%SOURCE%\requirements.txt" copy /Y "%SOURCE%\requirements.txt" "%TARGET%\requirements.txt"
if exist "%SOURCE%\README.md"        copy /Y "%SOURCE%\README.md"         "%TARGET%\README.md"
if exist "%SOURCE%\CHANGELOG.md"     copy /Y "%SOURCE%\CHANGELOG.md"      "%TARGET%\CHANGELOG.md"
if exist "%SOURCE%\start.bat"        copy /Y "%SOURCE%\start.bat"         "%TARGET%\start.bat"
echo [OK] Files copied.

:after_copy

REM ?-?- Step 5: Switch to target folder ?-?-?-?-?-?-?-?-?-?-?-?-?-?-?-?-?-?-?-?-?-?-?-?-?-?-?-?-?-?-?-?-?-?-?-?-?-
cd /d "%TARGET%"
echo.

REM ?-?- Step 6: Install packages using the detected interpreter ?-?-?-?-?-?-?-?-?-?-?-?-?-
echo [..] Installing packages (1-3 min)...
%PYEXE% -m pip install --upgrade pip --quiet
%PYEXE% -m pip install -r requirements.txt
if errorlevel 1 (
    echo.
    echo [ERROR] Package install failed.
    echo   Check internet connection or firewall.
    pause
    exit /b 1
)
echo [OK] Packages installed.

REM ?-?- Step 7: Verify uvicorn ?-?-?-?-?-?-?-?-?-?-?-?-?-?-?-?-?-?-?-?-?-?-?-?-?-?-?-?-?-?-?-?-?-?-?-?-?-?-?-?-?-?-?-?-?-?-
%PYEXE% -m uvicorn --version >nul 2>&1
if errorlevel 1 (
    echo [ERROR] uvicorn not found after install. Please retry.
    pause
    exit /b 1
)
echo [OK] uvicorn ready.

echo.
echo ================================================
echo  Installation complete!
echo.
echo  Location : %TARGET%
echo.
echo  To start: double-click start.bat in that folder
echo.
echo  Browser : http://127.0.0.1:8000
echo  Login   : admin / admin1234
echo ================================================
echo.

set /p LAUNCH=Start now? (Y/N):
if /i "%LAUNCH%"=="Y" (
    start "" "%TARGET%\start.bat"
)
pause
exit /b 0

REM ?-?- Helper: probe a launcher command (e.g. "py -3.12" / "python") ?-?-?-?-?-?-?-?-
REM    Validates STDOUT contains "pip " (Store alias stubs print nothing).
:try_py
%~1 -m pip --version > "%PROBE%" 2>nul
findstr /b /c:"pip " "%PROBE%" >nul 2>&1
if not errorlevel 1 set "PYEXE=%~1"
goto :eof

REM ?-?- Helper: probe an explicit python.exe path ?-?-?-?-?-?-?-?-?-?-?-?-?-?-?-?-?-?-?-?-?-?-?-?-?-?-?-
:try_path
if not exist "%~1" goto :eof
"%~1" -m pip --version > "%PROBE%" 2>nul
findstr /b /c:"pip " "%PROBE%" >nul 2>&1
if not errorlevel 1 set "PYEXE="%~1""
goto :eof

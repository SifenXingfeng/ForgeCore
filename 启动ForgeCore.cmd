@echo off
setlocal EnableExtensions

cd /d "%~dp0"
title ForgeCore Local Development Server

set "FORGECORE_PORT=4173"
if not "%~1"=="" set "FORGECORE_PORT=%~1"
set "FORGECORE_URL=http://127.0.0.1:%FORGECORE_PORT%/"

echo.
echo  ========================================
echo    ForgeCore Local Launcher
echo  ========================================
echo    Project: %CD%
echo    URL:     %FORGECORE_URL%
echo.

if not exist "package.json" (
  echo [ERROR] package.json was not found in the project directory.
  goto :failed
)

where node.exe >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Node.js was not found. Install Node.js 20 or newer first.
  goto :failed
)

where npm.cmd >nul 2>nul
if errorlevel 1 (
  echo [ERROR] npm was not found. Check the Node.js installation.
  goto :failed
)

if not exist "node_modules\" (
  echo [SETUP] Installing project dependencies for the first launch...
  call npm.cmd install
  if errorlevel 1 (
    echo [ERROR] Dependency installation failed.
    goto :failed
  )
)

powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "$listener=Get-NetTCPConnection -State Listen -LocalPort %FORGECORE_PORT% -ErrorAction SilentlyContinue; if (-not $listener) { exit 1 }; $ProgressPreference='SilentlyContinue'; try { $response=Invoke-WebRequest -UseBasicParsing -Uri '%FORGECORE_URL%' -TimeoutSec 2; if ($response.Content -match 'ForgeCore') { exit 0 } else { exit 2 } } catch { exit 2 }"
set "PORT_CHECK=%ERRORLEVEL%"

if "%PORT_CHECK%"=="0" (
  echo [READY] ForgeCore is already running. Opening the browser...
  if not defined FORGECORE_NO_BROWSER start "" "%FORGECORE_URL%"
  exit /b 0
)

if "%PORT_CHECK%"=="2" (
  echo [ERROR] Port %FORGECORE_PORT% is already used by another application.
  echo         Run this script with another port, for example: script-name.cmd 4175
  goto :failed
)

echo [START] Starting ForgeCore...
echo [INFO] Keep this window open. Press Ctrl+C to stop the server.
echo.

if not defined FORGECORE_NO_BROWSER start "" powershell.exe -NoProfile -WindowStyle Hidden -Command "Start-Sleep -Seconds 2; Start-Process '%FORGECORE_URL%'"
call npm.cmd run dev -- --host 127.0.0.1 --port %FORGECORE_PORT% --strictPort
set "SERVER_EXIT=%ERRORLEVEL%"

echo.
if "%SERVER_EXIT%"=="0" (
  echo [DONE] ForgeCore has stopped.
) else (
  echo [ERROR] ForgeCore exited with code %SERVER_EXIT%.
)
pause
exit /b %SERVER_EXIT%

:failed
echo.
echo Fix the error above and run this script again.
pause
exit /b 1

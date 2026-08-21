@echo off
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\start-forgemind.ps1" %*
if errorlevel 1 (
  echo.
  echo ForgeMind startup failed. See the error above.
  pause
)

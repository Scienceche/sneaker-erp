@echo off
REM sneaker-erp market price service launcher (GOAT public data source)
cd /d "%~dp0"
where node >nul 2>nul
if %errorlevel%==0 (
  echo Starting sneaker-erp market service...
  node mkt-server.js
) else (
  echo [!] Node.js not found on this PC.
  echo     Install Node.js LTS from https://nodejs.org/zh-cn first,
  echo     then double-click this script again.
  echo.
  pause
)

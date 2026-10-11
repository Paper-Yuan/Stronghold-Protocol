@echo off
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Please install Node.js 22 or 24 LTS.
  pause
  exit /b 1
)
node scripts/launch.mjs --no-setup --host 127.0.0.1 --port 3000
pause

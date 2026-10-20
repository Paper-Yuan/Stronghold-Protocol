@echo off
chcp 65001 >nul
cd /d "%~dp0"
title 卫戍协议：盟约

echo ===================================================
echo   卫戍协议：盟约 — 一键启动
echo ===================================================
echo.

where node >nul 2>nul
if %ERRORLEVEL% neq 0 (
  echo   [错误] 找不到 Node.js
  echo.
  echo   请先安装 Node.js 22 或更高版本：
  echo     https://nodejs.org/
  echo.
  echo   装好后重新双击这个文件。
  echo.
  pause
  exit /b 1
)

if exist "scripts\start-windows.bat" (
  call "scripts\start-windows.bat"
) else (
  echo   [错误] 文件不完整：找不到 scripts\start-windows.bat
  echo   请重新解压整个压缩包（不要只解压一部分文件）。
  echo.
  pause
)

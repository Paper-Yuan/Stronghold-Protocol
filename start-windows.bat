@echo off
chcp 65001 >nul
cd /d "%~dp0"
title 卫戍协议：盟约 - 服务器

where node >nul 2>nul
if %ERRORLEVEL% neq 0 (
  echo [错误] 系统未检测到 Node.js，请先安装 Node.js 22 或更高版本！
  echo 推荐下载: https://nodejs.org/ (Node 22 LTS)
  pause
  exit /b 1
)

echo ===================================================
echo  明日方舟「卫戍协议：盟约」游戏服务端正在启动...
echo  默认地址: http://127.0.0.1:3000
echo ===================================================

set PORT=3000
set HOST=0.0.0.0
set NODE_ENV=production

node server/index.js
if %ERRORLEVEL% neq 0 (
  echo.
  echo [异常] 服务端退出，退出代码: %ERRORLEVEL%
  pause
)

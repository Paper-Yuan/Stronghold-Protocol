#!/usr/bin/env bash
# 卫戍协议：盟约 · 服务端启动脚本 (Linux / macOS)
set -euo pipefail
cd "$(dirname "$0")"

PORT="${PORT:-3000}"
HOST="${HOST:-0.0.0.0}"

if ! command -v node >/dev/null 2>&1; then
  echo "[错误] 未检测到 Node.js，需要 Node 22+ 或更高版本。"
  echo "建议：安装 Node.js LTS (https://nodejs.org) 或改用 Docker 一键部署 (docker compose up -d)"
  exit 1
fi

NODE_MAJOR=$(node -v | sed 's/v//' | cut -d. -f1)
if [ "$NODE_MAJOR" -lt 22 ]; then
  echo "[警告] 当前 Node.js 版本 $(node -v) 低于推荐版本 22，可能导致部分特性异常。"
fi

echo "=========================================="
echo " 卫戍协议：盟约 · 服务器启动"
echo " 端口: ${PORT} | 监听: ${HOST}"
echo "=========================================="

export PORT HOST NODE_ENV=production
exec node server/index.js

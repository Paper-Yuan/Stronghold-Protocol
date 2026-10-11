#!/usr/bin/env bash
# 卫戍协议：盟约 · macOS / Linux start script. Docs: docs/DEPLOY.md
#   scripts/start.sh [--port 3001] [--no-open] [--no-local] [--no-assets] …   (arguments go to scripts/launch.mjs)
# Checks Node.js ≥ 22, runs `npm ci` on the first run, then scripts/launch.mjs (tools/setup.mjs → server → browser).
set -euo pipefail
cd "$(dirname "$0")/.."

if ! command -v node >/dev/null 2>&1; then
  echo "未找到 Node.js（需要 22 或更高，22 / 24 LTS）。Node.js not found."
  if [ "$(uname -s)" = "Darwin" ]; then
    echo "  安装：brew install node@22   或   https://nodejs.org/zh-cn/download"
  else
    echo "  安装：https://nodejs.org/zh-cn/download （或发行版的包管理器 / nvm / fnm）"
  fi
  exit 1
fi
if ! node -e "process.exit(Number(process.versions.node.split('.')[0])>=22?0:1)"; then
  echo "Node.js $(node -v) 太旧，需要 22 或更高（22 / 24 LTS）：https://nodejs.org/zh-cn/download"
  exit 1
fi

if [ ! -f node_modules/ws/package.json ]; then
  echo "[首次运行] 正在安装依赖 npm ci …"
  npm ci --no-audit --no-fund || npm install --no-audit --no-fund
fi

exec node scripts/launch.mjs "$@"

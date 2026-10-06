#!/usr/bin/env bash
# scripts/auto-sync.sh — Linux/macOS 后台轮询同步脚本
set -euo pipefail
cd "$(dirname "$0")/.."

BRANCH="${1:-0.1.6-pre-skin}"
INTERVAL="${2:-20}"

echo "[$(date '+%H:%M:%S')] 启动轻量自动同步守护器 (分支: $BRANCH, 间隔: ${INTERVAL}s)..."

while true; do
  if git fetch origin "$BRANCH" --quiet 2>/dev/null; then
    LOCAL=$(git rev-parse HEAD 2>/dev/null || echo "")
    REMOTE=$(git rev-parse "origin/$BRANCH" 2>/dev/null || echo "")
    
    if [ -n "$LOCAL" ] && [ -n "$REMOTE" ] && [ "$LOCAL" != "$REMOTE" ]; then
      echo "[$(date '+%H:%M:%S')] 检测到新提交 ($REMOTE)，开始拉取更新..."
      git pull origin "$BRANCH"
      node tools/vendor.mjs || true
      node tools/sync-static-web.mjs || true
      
      if command -v pm2 >/dev/null 2>&1; then
        pm2 reload stronghold || pm2 restart stronghold || true
        echo "[$(date '+%H:%M:%S')] PM2 服务热重载完毕！"
      else
        echo "[$(date '+%H:%M:%S')] 代码更新完毕！"
      fi
    fi
  fi
  sleep "$INTERVAL"
done

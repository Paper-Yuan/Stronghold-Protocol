#!/usr/bin/env bash
# deploy/sync-owned-dirs.sh — 热切换前，把「不进发布包」的服务器自有目录从当前活动节点补到闲置节点。
# 起因（2026-10-16 线上事故）：发布包按设计不含 workshop/ config/ public/assets/（服主自己的模组、管理员
# 配置、892 MB 素材），而 hot-swap.sh 会切到另一个节点 —— 那边是空的，于是切换后「模组全没了」，
# /data/chess.json 里的模组算子、/data/assets.json 里的 /workshop-assets/ 全部变成 0。
# 只在目标节点该目录为空时才复制（幂等；绝不覆盖目标已有内容）。
set -u
CONF="${NGINX_CONF:-/etc/nginx/sites-available/default}"
ACTIVE=$(grep -oE '127.0.0.1:300[12]' "$CONF" 2>/dev/null | head -1)
if [ "$ACTIVE" = "127.0.0.1:3001" ]; then A=/opt/stronghold-blue; T=/opt/stronghold-green; else A=/opt/stronghold-green; T=/opt/stronghold-blue; fi
echo "  active=$A target=$T"
for d in workshop config public/assets; do
  if [ -d "$A/$d" ] && [ -z "$(ls -A "$T/$d" 2>/dev/null)" ]; then
    mkdir -p "$T/$d"
    cp -a "$A/$d/." "$T/$d/" && echo "  synced $d -> $T/$d"
  else
    echo "  skip $d"
  fi
done

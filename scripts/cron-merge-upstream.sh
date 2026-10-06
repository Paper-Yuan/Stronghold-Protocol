#!/usr/bin/env bash
# scripts/cron-merge-upstream.sh — 凌晨3点定时合并上游0.1.4安全运维脚本
set -eo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

mkdir -p "$ROOT/logs"
LOG_FILE="$ROOT/logs/cron-merge.log"

log() {
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] [CronMerge] $*" | tee -a "$LOG_FILE"
}

log "=== 触发定时上游合并任务 (当前分支: $(git rev-parse --abbrev-ref HEAD)) ==="

# 1. 确保上游 upstream 远端存在
UPSTREAM_URL="https://github.com/sganggs/Stronghold-Protocol.git"
UPSTREAM_MIRROR="https://ghfast.top/https://github.com/sganggs/Stronghold-Protocol.git"

if ! git remote | grep -q "^upstream$"; then
  log "添加上游 remote: $UPSTREAM_MIRROR"
  git remote add upstream "$UPSTREAM_MIRROR" || git remote add upstream "$UPSTREAM_URL"
fi

# 2. 检查工作区干净程度
if ! git diff-index --quiet HEAD --; then
  log "警告: 工作区存在未提交的修改，暂存工作区..."
  git stash push -m "cron-merge-autostash-$(date +%s)"
fi

# 3. 记录合并前安全检查点
CURRENT_HEAD=$(git rev-parse HEAD)
log "当前版本基线: $CURRENT_HEAD"

# 4. Fetch 上游 0.1.4 状态
log "正在获取上游 0.1.4 提交与 Tag..."
if ! git fetch upstream tags/v0.1.4:refs/tags/upstream-v0.1.4 --quiet 2>/dev/null; then
  if ! git fetch upstream master --quiet 2>/dev/null; then
    log "✘ 获取上游数据失败（网络超时），保持现状退出。"
    exit 1
  fi
fi

# 5. 执行安全合并逻辑
TARGET_REF="refs/tags/upstream-v0.1.4"
if ! git rev-parse "$TARGET_REF" >/dev/null 2>&1; then
  TARGET_REF="v0.1.4"
fi

log "目标合并版本: $TARGET_REF ($(git rev-parse $TARGET_REF 2>/dev/null || echo 'unknown'))"

# 检查是否已经合入
if git merge-base --is-ancestor "$TARGET_REF" HEAD 2>/dev/null; then
  log "✔ 上游 0.1.4 已经合入当前分支，无需重复合并。"
  exit 0
fi

log "开始执行合并..."
if git merge "$TARGET_REF" -m "merge(upstream): 凌晨定时合并上游 0.1.4 (自动运维)" --no-commit; then
  log "合并顺利（无冲突），准备提交并验证..."
else
  log "检测到合并冲突，尝试执行 0.1.6 自定义保留策略..."
  # 保持 0.1.6 自身关键配置与资产不被冲掉
  git checkout --ours package.json package-lock.json shared/constants.js data/assets.json 2>/dev/null || true
  
  REMAINING_CONFLICTS=$(git diff --name-only --diff-filter=U || true)
  if [ -n "$REMAINING_CONFLICTS" ]; then
    log "✘ 存在需要手动审查的冲突文件:"
    echo "$REMAINING_CONFLICTS" | while read -r line; do log "  - $line"; done
    log "执行安全回滚以保护生产对局，取消本次自动合并..."
    git merge --abort
    exit 1
  fi
fi

# 提交合并
git commit -m "merge(upstream): 定时合并上游 0.1.4 规则更新，保留 0.1.6 皮肤与服务端定制"

# 6. 构建与同步静态资源
log "更新运行时与前端分发..."
node tools/vendor.mjs || true
node tools/sync-static-web.mjs || true

# 7. 运行自检
log "运行核心测试套件验证..."
if node --test test/ui/gameLogic.test.js test/version.test.js; then
  log "✔ 测试通过，正在热重载 PM2 服务..."
  if command -v pm2 >/dev/null 2>&1; then
    pm2 reload stronghold || pm2 restart stronghold
  fi
  log "🎉 上游 0.1.4 规则合并并部署成功！最新版本: $(git rev-parse --short HEAD)"
else
  log "✘ 核心测试未通过，立即硬回滚至合并前版本: $CURRENT_HEAD"
  git reset --hard "$CURRENT_HEAD"
  exit 1
fi

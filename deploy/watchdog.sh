#!/usr/bin/env bash
# /opt/watchdog.sh — 自动看门狗脚本：定时探测 /healthz，自动识别并斩杀死锁僵尸进程、释放端口并平滑拉起服务
set -u

LOG_FILE="/var/log/stronghold/watchdog.log"
mkdir -p /var/log/stronghold

log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" >> "$LOG_FILE"
}

# 1. 自动判断 Nginx 当前活动的后端端口 (3001 或 3002)
CONF="/etc/nginx/sites-available/default"
if [[ ! -f "$CONF" ]]; then
    CONF="/etc/nginx/conf.d/stronghold.conf"
fi
TARGET_PORT=$(grep -oE "127.0.0.1:300[12]" "$CONF" 2>/dev/null | grep -oE "300[12]" | head -n1)
TARGET_PORT=${TARGET_PORT:-3002}

APP_NAME="stronghold-green"
if [[ "$TARGET_PORT" == "3001" ]]; then
    APP_NAME="stronghold-blue"
fi

# 2. 探针检测：请求 /healthz，超时 4 秒
PROBE_RES=$(curl -s -f -m 4 "http://127.0.0.1:${TARGET_PORT}/healthz" 2>/dev/null || echo "")

if [[ -n "$PROBE_RES" && "$PROBE_RES" == *'"ok":true'* ]]; then
    exit 0
fi

# 3. 避免误判：稍等 2 秒后复测一次
sleep 2
PROBE_RES_RETRY=$(curl -s -f -m 4 "http://127.0.0.1:${TARGET_PORT}/healthz" 2>/dev/null || echo "")
if [[ -n "$PROBE_RES_RETRY" && "$PROBE_RES_RETRY" == *'"ok":true'* ]]; then
    exit 0
fi

log "[WARN] 探针失败！端口 ${TARGET_PORT} 无响应，触发自愈修复流程..."

# 4. 识别并清理死锁占坑进程（释放端口）
PORT_PIDS=$(ss -tulpn | grep ":${TARGET_PORT}" | grep -oE 'pid=[0-9]+' | cut -d= -f2 | sort -u)
for pid in $PORT_PIDS; do
    log "[ACTION] 斩杀占坑/死锁进程: PID ${pid}"
    kill -9 "$pid" 2>/dev/null || true
done

# 5. 清理孤儿脱管且 CPU 跑满的死循环 node 进程
ps -eo pid,%cpu,cmd | grep 'node' | grep 'server/index.js' | grep -v grep | while read -r rpid rcpu rcmd; do
    CPU_INT=${rcpu%.*}
    if [[ ${CPU_INT:-0} -gt 70 ]]; then
        log "[ACTION] 斩杀孤儿死循环进程: PID ${rpid} (CPU ${rcpu}%)"
        kill -9 "$rpid" 2>/dev/null || true
    fi
done

# 6. 通过 PM2 重启对应节点
log "[ACTION] 重启守护实例: ${APP_NAME}"
if pm2 describe "$APP_NAME" >/dev/null 2>&1; then
    pm2 restart "$APP_NAME" 2>/dev/null || true
else
    pm2 start /opt/ecosystem.config.cjs --only "$APP_NAME" 2>/dev/null || true
fi

# 7. 稍候复核自愈结果
sleep 3
VERIFY_RES=$(curl -s -f -m 4 "http://127.0.0.1:${TARGET_PORT}/healthz" 2>/dev/null || echo "")
if [[ -n "$VERIFY_RES" && "$VERIFY_RES" == *'"ok":true'* ]]; then
    log "[SUCCESS] 自愈成功！服务节点 ${APP_NAME} (${TARGET_PORT}) 已恢复在线正常。"
else
    log "[ERROR] 重启后探针仍未通，建议人工介入。"
fi

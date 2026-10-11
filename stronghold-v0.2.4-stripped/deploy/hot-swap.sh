#!/usr/bin/env bash
# deploy/hot-swap.sh — 阿里云全量服务端：蓝绿零停机热切换与旧物清理自动化脚本
set -euo pipefail

PACKAGE_FILE="${1:-}"
NGINX_CONF="${NGINX_CONF:-/etc/nginx/sites-available/default}"
ADMIN_SECRET="${ADMIN_SECRET:-stronghold-admin-2026}"
DRAIN_WAIT_SECONDS="${DRAIN_WAIT_SECONDS:-15}"

echo "=========================================================="
echo " [HOT-SWAP] 开始执行全量服务端蓝绿零停机热切换 (Zero Downtime) "
echo "=========================================================="

# 1. 自动判断当前活动节点 (根据 Nginx 配置中当前反代的端口)
CURRENT_BACKEND=$(grep -oE "127.0.0.1:300[12]" "$NGINX_CONF" 2>/dev/null || echo "127.0.0.1:3001")

if [[ "$CURRENT_BACKEND" == *"3001"* ]]; then
    ACTIVE_COLOR="blue"
    ACTIVE_PORT="3001"
    TARGET_COLOR="green"
    TARGET_PORT="3002"
    TARGET_DIR="/opt/stronghold-green"
    TARGET_PM2="stronghold-green"
    OLD_DIR="/opt/stronghold-blue"
    OLD_PM2="stronghold-blue"
else
    ACTIVE_COLOR="green"
    ACTIVE_PORT="3002"
    TARGET_COLOR="blue"
    TARGET_PORT="3001"
    TARGET_DIR="/opt/stronghold-blue"
    TARGET_PM2="stronghold-blue"
    OLD_DIR="/opt/stronghold-green"
    OLD_PM2="stronghold-green"
fi

echo ">> [1/6] 路由分析完成:"
echo "   - 当前在线运行节点: ${ACTIVE_COLOR} (端口 ${ACTIVE_PORT})"
echo "   - 待热切升级新节点: ${TARGET_COLOR} (端口 ${TARGET_PORT})"
echo "   - 部署目标工作目录: ${TARGET_DIR}"

# 2. 如果提供了发布包，解压部署到目标闲置区
mkdir -p "$TARGET_DIR"
if [[ -n "$PACKAGE_FILE" && -f "$PACKAGE_FILE" ]]; then
    echo ">> [2/6] 解压新版本发布包至目标目录 ${TARGET_DIR}..."
    tar -xzf "$PACKAGE_FILE" -C "$TARGET_DIR"
    
    echo ">> [2/6] 安装生产运行依赖 (npm install --omit=dev)..."
    (cd "$TARGET_DIR" && npm install --omit=dev --silent)
else
    echo ">> [2/6] 未指定外部发布包，将使用 ${TARGET_DIR} 现有代码进行热启动..."
fi

# 3. 启动/重启目标闲置区进程
echo ">> [3/6] 启动目标节点实例 [${TARGET_PM2}] (PORT=${TARGET_PORT})..."
cd "$TARGET_DIR"
PORT=$TARGET_PORT ADMIN_SECRET=$ADMIN_SECRET pm2 restart "$TARGET_PM2" 2>/dev/null || \
PORT=$TARGET_PORT ADMIN_SECRET=$ADMIN_SECRET pm2 start server/index.js --name "$TARGET_PM2" --watch false

# 4. 严密健康检查验证 (Probe /healthz 确保完全可用)
echo ">> [4/6] 正在探测新节点健康状态 (http://127.0.0.1:${TARGET_PORT}/healthz)..."
PROBE_OK=0
for i in {1..15}; do
    HEALTH_RESP=$(curl -s -f "http://127.0.0.1:${TARGET_PORT}/healthz" 2>/dev/null || echo "")
    if [[ -n "$HEALTH_RESP" && "$HEALTH_RESP" == *"\"ok\":true"* ]]; then
        echo "   ✓ 新节点健康探针通过 (探测序号 #${i}): $HEALTH_RESP"
        PROBE_OK=1
        break
    fi
    echo "   ... 等待新服务节点就绪 (${i}/15)..."
    sleep 1
done

if [[ $PROBE_OK -ne 1 ]]; then
    echo "❌ 错误: 新节点未能通过健康探测，热切流程已中止！原节点 ${ACTIVE_COLOR} 保持完全正常运行，不受任何影响。"
    exit 1
fi

# 5. 毫秒级重载 Nginx 反代 (实现真正 0 停机、不断连热切换)
echo ">> [5/6] 毫秒级切换 Nginx upstream: ${ACTIVE_COLOR}(:${ACTIVE_PORT}) -> ${TARGET_COLOR}(:${TARGET_PORT})..."
sed -i "s/127.0.0.1:${ACTIVE_PORT}/127.0.0.1:${TARGET_PORT}/g" "$NGINX_CONF"
nginx -t
systemctl reload nginx || nginx -s reload

echo "   ✓ Nginx 热切成功！所有新进入的玩家与 WebSocket 连接已无缝接入 ${TARGET_COLOR} 节点。"

# 6. 通知旧节点进入优雅排空模式 (Graceful Drain)
echo ">> [6/6] 正在向原节点 [${OLD_PM2}] (端口 ${ACTIVE_PORT}) 发送平滑排空指令 (/api/admin/drain)..."
curl -s -X POST "http://127.0.0.1:${ACTIVE_PORT}/api/admin/drain" \
     -H "Authorization: Bearer ${ADMIN_SECRET}" 2>/dev/null || true

# 7. 清理旧残留文件与临时包
echo ">> [清理] 开始执行部署后旧东西与临时缓存清理..."
# 清理上传的压缩包
if [[ -n "$PACKAGE_FILE" && -f "$PACKAGE_FILE" ]]; then
    echo "   - 删除临时发布包: ${PACKAGE_FILE}"
    rm -f "$PACKAGE_FILE"
fi

# 清理各目录旧缓存和临时构建产物
rm -rf "$TARGET_DIR/.cache" "$TARGET_DIR/tmp" /tmp/stronghold* 2>/dev/null || true
rm -rf "$OLD_DIR/.cache" "$OLD_DIR/tmp" 2>/dev/null || true

echo ">> [清理] 等待旧对局排空 (${DRAIN_WAIT_SECONDS} 秒宽限期)..."
sleep "$DRAIN_WAIT_SECONDS"

# 停止旧进程，释放内存
echo ">> [清理] 停止已排空的旧进程 [${OLD_PM2}]..."
pm2 stop "$OLD_PM2" 2>/dev/null || true

echo "=========================================================="
echo " 🎉 热切换升级与清理全部完成！"
echo "   - 当前线上活动节点: ${TARGET_COLOR} (端口 ${TARGET_PORT})"
echo "   - 旧节点已排空并关闭: ${ACTIVE_COLOR} (端口 ${ACTIVE_PORT})"
echo "   - 后台管理控制台地址: http://<服务器IP>/admin"
echo "   - 默认管理口令 Token: ${ADMIN_SECRET}"
echo "=========================================================="

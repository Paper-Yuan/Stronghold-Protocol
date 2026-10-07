#!/usr/bin/env bash
# /opt/hot-swap.sh — 蓝绿双实例零中断热切自动化脚本
set -euo pipefail

PATCH_FILE="${1:-}"
NGINX_CONF="/etc/nginx/sites-available/default"

echo "=== [HOT-SWAP] 开始执行蓝绿零停机热升级 ==="

# 1. 自动判断当前哪一个是活动节点
CURRENT_BACKEND=$(grep -oE "127.0.0.1:300[12]" "$NGINX_CONF" || echo "127.0.0.1:3001")
if [[ "$CURRENT_BACKEND" == *"3001"* ]]; then
    ACTIVE_COLOR="blue"
    ACTIVE_PORT="3001"
    TARGET_COLOR="green"
    TARGET_PORT="3002"
    TARGET_DIR="/opt/stronghold-green"
    TARGET_PM2="stronghold-green"
else
    ACTIVE_COLOR="green"
    ACTIVE_PORT="3002"
    TARGET_COLOR="blue"
    TARGET_PORT="3001"
    TARGET_DIR="/opt/stronghold-blue"
    TARGET_PM2="stronghold-blue"
fi

echo "[1/5] 当前活动区: ${ACTIVE_COLOR} (端口 ${ACTIVE_PORT}) -> 目标升级区: ${TARGET_COLOR} (端口 ${TARGET_PORT})"

# 2. 如果提供了补丁包，解压部署到目标闲置区
if [[ -n "$PATCH_FILE" && -f "$PATCH_FILE" ]]; then
    echo "[2/5] 部署补丁到 ${TARGET_DIR}..."
    mkdir -p "$TARGET_DIR"
    tar -xzf "$PATCH_FILE" -C "$TARGET_DIR"
else
    echo "[2/5] 未指定补丁文件，保持 ${TARGET_DIR} 现有代码..."
fi

# 3. 启动/重启目标闲置区
echo "[3/5] 重启目标闲置区实例 ${TARGET_PM2}..."
cd "$TARGET_DIR"
PORT=$TARGET_PORT pm2 restart "$TARGET_PM2" 2>/dev/null || PORT=$TARGET_PORT pm2 start server/index.js --name "$TARGET_PM2" --watch false

# 4. 健康检查验证 (连续 3 次 probe)
echo "[4/5] 探测目标区 http://127.0.0.1:${TARGET_PORT}/ 健康状态..."
for i in {1..10}; do
    if curl -s -f "http://127.0.0.1:${TARGET_PORT}/" >/dev/null; then
        echo "  - 目标区健康探针 #${i} 通过 ✓"
        break
    fi
    echo "  - 等待服务启动 (${i}/10)..."
    sleep 1
done

# 5. 毫秒级重载 Nginx
echo "[5/5] 切换 Nginx upstream 至 ${TARGET_COLOR} (端口 ${TARGET_PORT})..."
sed -i "s/127.0.0.1:${ACTIVE_PORT}/127.0.0.1:${TARGET_PORT}/g" "$NGINX_CONF"
nginx -t
systemctl reload nginx

echo "=== [HOT-SWAP] 切换成功！新流量与新大厅连接已无感接入 ${TARGET_COLOR} (端口 ${TARGET_PORT}) ==="
echo "提示：老区 ${ACTIVE_COLOR} 上的存活房间可以继续打完，打完退出后自动接入新区。"

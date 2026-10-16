#!/usr/bin/env bash
# 卫戍协议：盟约 · Linux 服务器一键部署与管理助手
set -e
cd "$(dirname "$0")"

APP_DIR="$(pwd)"
SERVICE_NAME="stronghold"

echo "=========================================="
echo " 卫戍协议：盟约 · 服务器部署管理助手"
echo " 当前目录: ${APP_DIR}"
echo "=========================================="

start_docker() {
  if ! command -v docker >/dev/null 2>&1; then
    echo "[错误] 未检测到 docker 命令，请先安装 Docker 或使用 Node 启动。"
    return 1
  fi
  echo "正在启动 Docker 容器..."
  docker compose up -d --build
  echo "✔ Docker 容器已启动！访问 http://服务器IP:3000"
}

start_node() {
  ./start.sh
}

start_nohup() {
  if ! command -v node >/dev/null 2>&1; then
    echo "[错误] 未检测到 Node.js，请先安装 Node.js 22+"
    return 1
  fi
  mkdir -p logs
  echo "正在后台启动..."
  nohup node server/index.js > logs/server.log 2>&1 &
  PID=$!
  echo "✔ 服务器已在后台启动 (PID: ${PID})，日志输出至 logs/server.log"
  echo "访问 http://服务器IP:3000"
}

install_systemd() {
  if [ "$(id -u)" -ne 0 ]; then
    echo "[提示] 安装 systemd 服务需要 root 权限，请执行: sudo ./deploy.sh install"
    return 1
  fi
  
  NODE_PATH="$(command -v node || true)"
  if [ -z "$NODE_PATH" ]; then
    echo "[错误] 未找到 Node.js，无法配置 systemd 服务。"
    return 1
  fi

  cat > "/etc/systemd/system/${SERVICE_NAME}.service" <<EOF
[Unit]
Description=Stronghold Protocol Game Server
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=${APP_DIR}
ExecStart=${NODE_PATH} server/index.js
Restart=always
RestartSec=5
Environment=PORT=3000
Environment=HOST=0.0.0.0
Environment=NODE_ENV=production
Environment=SP_VERIFY=off
Environment=SP_COMBAT=client
Environment=TRUST_PROXY=auto

[Install]
WantedBy=multi-user.target
EOF

  systemctl daemon-reload
  systemctl enable --now "${SERVICE_NAME}"
  echo "✔ systemd 服务已安装并成功启动！"
  echo "常用管理命令:"
  echo "  查看状态: systemctl status ${SERVICE_NAME}"
  echo "  重启服务: systemctl restart ${SERVICE_NAME}"
  echo "  查看日志: journalctl -u ${SERVICE_NAME} -f"
}

stop_all() {
  echo "正在停止服务..."
  if command -v docker >/dev/null 2>&1 && [ -f docker-compose.yml ]; then
    docker compose down 2>/dev/null || true
  fi
  if [ -f "/etc/systemd/system/${SERVICE_NAME}.service" ] && [ "$(id -u)" -eq 0 ]; then
    systemctl stop "${SERVICE_NAME}" 2>/dev/null || true
  fi
  pkill -f "node server/index.js" 2>/dev/null || true
  echo "✔ 服务已停止。"
}

view_status() {
  echo "--- 服务运行状态 ---"
  if command -v docker >/dev/null 2>&1; then
    docker ps | grep -E "stronghold|CONTAINER" || true
  fi
  if command -v systemctl >/dev/null 2>&1 && [ -f "/etc/systemd/system/${SERVICE_NAME}.service" ]; then
    systemctl status "${SERVICE_NAME}" --no-pager || true
  fi
  pgrep -fl "node server/index.js" || echo "没有正在运行的 Node 原生进程。"
}

if [ "$#" -gt 0 ]; then
  case "$1" in
    docker) start_docker ;;
    start) start_node ;;
    nohup) start_nohup ;;
    install) install_systemd ;;
    stop) stop_all ;;
    status) view_status ;;
    *) echo "未知命令: $1 (可选: docker | start | nohup | install | stop | status)" ;;
  esac
  exit 0
fi

echo ""
echo "请选择操作："
echo "  1) Docker Compose 一键启动 (推荐)"
echo "  2) 本地 Node.js 直接前台启动"
echo "  3) 本地 Node.js 后台运行 (nohup)"
echo "  4) 安装为 Linux systemd 开机自启服务"
echo "  5) 停止服务"
echo "  6) 查看运行状态"
echo "  0) 退出"
echo ""
read -rp "请输入选项 [0-6]: " choice

case "$choice" in
  1) start_docker ;;
  2) start_node ;;
  3) start_nohup ;;
  4) install_systemd ;;
  5) stop_all ;;
  6) view_status ;;
  0) exit 0 ;;
  *) echo "无效选项" ;;
esac

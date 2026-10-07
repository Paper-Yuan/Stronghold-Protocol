#!/usr/bin/env bash
# deploy/setup-aliyun.sh — 阿里云 ECS 首次环境一键初始化脚本
set -euo pipefail

echo "=========================================================="
echo " [Stronghold Protocol] 阿里云生产服务器一键环境初始化 "
echo "=========================================================="

# 1. 检查 root 权限
if [[ $EUID -ne 0 ]]; then
   echo "请使用 sudo 或 root 用户运行此脚本" 
   exit 1
fi

# 2. 系统软件包升级与基础工具安装
echo ">> [1/5] 安装系统基础工具 (curl, git, nginx, tar)..."
if command -v apt-get >/dev/null 2>&1; then
    apt-get update -y
    apt-get install -y curl git nginx tar jq
elif command -v yum >/dev/null 2>&1; then
    yum install -y curl git nginx tar jq
fi

# 3. 安装 Node.js 22 LTS
echo ">> [2/5] 检测/安装 Node.js 22 LTS..."
if ! command -v node >/dev/null 2>&1 || [[ $(node -v | cut -d'.' -f1 | tr -d 'v') -lt 22 ]]; then
    curl -fsSL https://deb.nodesource.com/setup_22.x | bash - 2>/dev/null || true
    if command -v apt-get >/dev/null 2>&1; then
        apt-get install -y nodejs
    else
        yum install -y nodejs
    fi
fi
echo "   - Node.js 版本: $(node -v)"
echo "   - NPM 版本: $(npm -v)"

# 4. 安装 PM2 全局守护工具
echo ">> [3/5] 安装 PM2 全局进程守护工具..."
if ! command -v pm2 >/dev/null 2>&1; then
    npm install -g pm2
fi
pm2 startup || true

# 5. 创建部署目录与日志目录
echo ">> [4/5] 创建蓝绿工作目录与日志目录..."
mkdir -p /opt/stronghold-blue
mkdir -p /opt/stronghold-green
mkdir -p /var/log/stronghold

# 6. 配置 Nginx
echo ">> [5/5] 配置 Nginx 反向代理..."
if [[ -f /etc/nginx/sites-available/default ]]; then
    NGINX_TARGET="/etc/nginx/sites-available/default"
else
    NGINX_TARGET="/etc/nginx/conf.d/stronghold.conf"
fi

cat << 'EOF' > "$NGINX_TARGET"
upstream stronghold_backend {
    server 127.0.0.1:3001;
    keepalive 64;
}

server {
    listen 80 default_server;
    listen [::]:80 default_server;
    server_name _;

    location /assets/ {
        proxy_pass http://stronghold_backend;
        proxy_http_version 1.1;
        proxy_set_header Connection "";
        proxy_set_header Host $host;
        expires 7d;
        add_header Cache-Control "public, max-age=604800, immutable";
    }

    location /admin {
        proxy_pass http://stronghold_backend;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        add_header Cache-Control "no-cache, no-store, must-revalidate";
    }

    location / {
        proxy_pass http://stronghold_backend;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 3600s;
        proxy_send_timeout 3600s;
        proxy_buffering off;
    }
}
EOF

nginx -t
systemctl restart nginx || nginx -s reload
systemctl enable nginx || true

echo "=========================================================="
echo " ✓ 阿里云环境初始化就绪！"
echo "   - 蓝区目录: /opt/stronghold-blue"
echo "   - 绿区目录: /opt/stronghold-green"
echo "   - 执行一键热切换部署: bash /opt/hot-swap.sh <release.tar.gz>"
echo "=========================================================="

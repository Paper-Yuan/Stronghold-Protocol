#!/usr/bin/env node
// scripts/make-server-bundle.mjs — 打包可直接部署上服务器的完整生产包 (Linux / Docker / Windows Server)。
//
//   node scripts/make-server-bundle.mjs [--out <dir>] [--zip] [--no-deps]
//
// 产物特点：
//   1. 纯净生产环境：仅包含服务端代码 (server/)、共享逻辑 (shared/)、前端静态资源 (public/)、数据 (data/) 与生产依赖 (node_modules/)。
//   2. 资产全量内置：内置全量 8580+ 素材、174 款干员换装皮肤、官方 3D 棋盘贴图与中日双语语音，离线零网络依赖直接开服。
//   3. 多方案即启：
//      - Docker Compose: docker compose up -d (内置极速 Dockerfile)
//      - Linux 原生: ./start.sh 或 ./deploy.sh (支持一键注册 systemd 开机自启)
//      - Windows Server: start-windows.bat

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { copyDir, zipDir } from './pack/_lib.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const IS_WIN = process.platform === 'win32';
const DESKTOP = path.join(os.homedir(), 'Desktop');
const BUNDLE_NAME = 'Stronghold-Protocol-v0.1.6.1-Full-Server';
const DEFAULT_OUT = path.join(DESKTOP, BUNDLE_NAME);

function parseArgs(argv) {
  const o = { out: DEFAULT_OUT, zip: true, deps: true };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const [k, v] = a.split('=');
    const val = () => (v !== undefined ? v : argv[++i]);
    if (k === '--out') o.out = path.resolve(String(val() || ''));
    else if (a === '--no-zip') o.zip = false;
    else if (a === '--no-deps') o.deps = false;
  }
  return o;
}

function trackedFiles() {
  const r = spawnSync('git', ['-C', ROOT, 'ls-files', '-z'], { maxBuffer: 256 * 1024 * 1024 });
  if (r.error || r.status !== 0) {
    throw new Error('git ls-files 失败：必须在 git 仓库中运行');
  }
  return r.stdout.toString('utf8').split('\0').filter(Boolean);
}

// 仅收录服务端与客户端运行必需的文件前缀
const ALLOW_TRACKED_PREFIXES = [
  'server/',
  'shared/',
  'public/',
  'data/',
  'docs/research/',
  'scripts/run-server.cmd',
  'scripts/launch.mjs',
  'scripts/open-browser.mjs',
  'scripts/auto-sync.mjs',
  'scripts/auto-sync.sh',
  'scripts/cron-merge-upstream.sh',
  'scripts/start.sh',
  'scripts/start-windows.bat',
  'scripts/start-windows.ps1',
  'tools/',
  'package.json',
  'package-lock.json',
  'LICENSE',
  'NOTICE.md',
  'THIRD-PARTY-NOTICES.md'
];

// 排除不需要进服务器包的开发与测试目录
const EXCLUDE_PREFIXES = [
  'android/',
  'test/',
  'vibe_images/',
  '.github/',
  '.devcontainer/',
  'scripts/build-android',
  'scripts/make-windows-bundle'
];

async function installProductionDeps(outDir) {
  const stage = path.join(outDir, `.tmp-deps-${Date.now()}`);
  await fsp.rm(stage, { recursive: true, force: true });
  await fsp.mkdir(stage, { recursive: true });
  for (const f of ['package.json', 'package-lock.json']) {
    await fsp.copyFile(path.join(ROOT, f), path.join(stage, f));
  }
  const dummyNpmrc = path.join(stage, '.npmrc');
  await fsp.writeFile(dummyNpmrc, 'allow-scripts=\nignore-scripts=true\n');
  console.log('  · 正在提取纯净生产依赖 (npm ci --omit=dev)...');
  const args = ['ci', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund', `--userconfig=${dummyNpmrc}`];
  const r = IS_WIN
    ? spawnSync('cmd.exe', ['/d', '/s', '/c', 'npm', ...args], { cwd: stage, stdio: 'inherit' })
    : spawnSync('npm', args, { cwd: stage, stdio: 'inherit' });
  if (r.error || r.status !== 0) {
    if (fs.existsSync(path.join(ROOT, 'node_modules'))) {
      console.log('  ! npm ci 遇到环境限制，正在从本地仓库同步已就绪的生产依赖…');
      await copyDir(path.join(ROOT, 'node_modules'), path.join(outDir, 'node_modules'));
      await fsp.rm(stage, { recursive: true, force: true });
      return;
    }
    throw new Error('安装生产依赖失败');
  }
  
  const targetModules = path.join(outDir, 'node_modules');
  await fsp.rm(targetModules, { recursive: true, force: true });
  await fsp.rename(path.join(stage, 'node_modules'), targetModules);
  await fsp.rm(stage, { recursive: true, force: true });
}

function generateDockerFiles(outDir) {
  const dockerfileContent = `# syntax=docker/dockerfile:1
# 卫戍协议：盟约 · 服务器生产容器镜像
ARG NODE_IMAGE=node:22-alpine

FROM \${NODE_IMAGE}
ENV NODE_ENV=production \\
    PORT=3000 \\
    HOST=0.0.0.0 \\
    SP_VERIFY=off \\
    SP_COMBAT=client \\
    TRUST_PROXY=auto

WORKDIR /app

# 代码、依赖与素材已完整打包在镜像中，无需联网二次下载
COPY package.json package-lock.json ./
COPY node_modules ./node_modules
COPY shared ./shared
COPY server ./server
COPY data ./data
COPY public ./public
COPY docs/research ./docs/research
COPY tools/doctor.mjs ./tools/doctor.mjs

USER node
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \\
  CMD wget -q -O /dev/null "http://127.0.0.1:\${PORT}/healthz" || exit 1

CMD ["node", "server/index.js"]
`;

  const dockerComposeContent = `services:
  stronghold:
    build: .
    image: stronghold-protocol:0.1.6.1
    container_name: stronghold-server
    restart: unless-stopped
    ports:
      - "3000:3000"
    environment:
      - PORT=3000
      - HOST=0.0.0.0
      - NODE_ENV=production
      - SP_VERIFY=off
      - SP_COMBAT=client
      - TRUST_PROXY=auto
`;

  fs.writeFileSync(path.join(outDir, 'Dockerfile'), dockerfileContent, 'utf8');
  fs.writeFileSync(path.join(outDir, 'docker-compose.yml'), dockerComposeContent, 'utf8');
  fs.writeFileSync(path.join(outDir, '.dockerignore'), `
.git
.gitignore
*.log
logs/
.cache
.DS_Store
Thumbs.db
`, 'utf8');
}

function generateScripts(outDir) {
  const startSh = `#!/usr/bin/env bash
# 卫戍协议：盟约 · 服务端启动脚本 (Linux / macOS)
set -euo pipefail
cd "$(dirname "$0")"

PORT="\${PORT:-3000}"
HOST="\${HOST:-0.0.0.0}"

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
echo " 端口: \${PORT} | 监听: \${HOST}"
echo "=========================================="

export PORT HOST NODE_ENV=production
exec node server/index.js
`;

  const deploySh = `#!/usr/bin/env bash
# 卫戍协议：盟约 · Linux 服务器一键部署与管理助手
set -e
cd "$(dirname "$0")"

APP_DIR="$(pwd)"
SERVICE_NAME="stronghold"

echo "=========================================="
echo " 卫戍协议：盟约 · 服务器部署管理助手"
echo " 当前目录: \${APP_DIR}"
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
  echo "✔ 服务器已在后台启动 (PID: \${PID})，日志输出至 logs/server.log"
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

  cat > "/etc/systemd/system/\${SERVICE_NAME}.service" <<EOF
[Unit]
Description=Stronghold Protocol Game Server
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=\${APP_DIR}
ExecStart=\${NODE_PATH} server/index.js
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
  systemctl enable --now "\${SERVICE_NAME}"
  echo "✔ systemd 服务已安装并成功启动！"
  echo "常用管理命令:"
  echo "  查看状态: systemctl status \${SERVICE_NAME}"
  echo "  重启服务: systemctl restart \${SERVICE_NAME}"
  echo "  查看日志: journalctl -u \${SERVICE_NAME} -f"
}

stop_all() {
  echo "正在停止服务..."
  if command -v docker >/dev/null 2>&1 && [ -f docker-compose.yml ]; then
    docker compose down 2>/dev/null || true
  fi
  if [ -f "/etc/systemd/system/\${SERVICE_NAME}.service" ] && [ "$(id -u)" -eq 0 ]; then
    systemctl stop "\${SERVICE_NAME}" 2>/dev/null || true
  fi
  pkill -f "node server/index.js" 2>/dev/null || true
  echo "✔ 服务已停止。"
}

view_status() {
  echo "--- 服务运行状态 ---"
  if command -v docker >/dev/null 2>&1; then
    docker ps | grep -E "stronghold|CONTAINER" || true
  fi
  if command -v systemctl >/dev/null 2>&1 && [ -f "/etc/systemd/system/\${SERVICE_NAME}.service" ]; then
    systemctl status "\${SERVICE_NAME}" --no-pager || true
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
`;

  const strongholdService = `[Unit]
Description=Stronghold Protocol Game Server
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=/opt/stronghold-server
ExecStart=/usr/bin/node server/index.js
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
`;

  const startBatLines = [
    '@echo off',
    'chcp 65001 >nul',
    'setlocal EnableExtensions',
    'title Stronghold Protocol Server - 卫戍协议开服',
    'cd /d "%~dp0"',
    '',
    'set "NODE_CMD="',
    'if exist "%~dp0node\\node.exe" set "NODE_CMD=%~dp0node\\node.exe"',
    'if not defined NODE_CMD (',
    '    where node >nul 2>nul',
    '    if not errorlevel 1 set "NODE_CMD=node"',
    ')',
    '',
    'if not defined NODE_CMD goto :nonode',
    '',
    'set PORT=3000',
    'set HOST=0.0.0.0',
    'set NODE_ENV=production',
    '',
    'echo ==========================================',
    'echo  卫戍协议：盟约 · Windows 服务器启动',
    'echo  端口: 3000   监听: 0.0.0.0',
    'echo ==========================================',
    '',
    '"%NODE_CMD%" server\\index.js',
    'if errorlevel 1 goto :fail',
    'pause',
    'exit /b 0',
    '',
    ':nonode',
    'echo.',
    'echo ==========================================',
    'echo [错误] 系统中未找到 Node.js，且未包含便携版 Node。',
    'echo ==========================================',
    'echo.',
    'echo 请按以下任一方式解决：',
    'echo   方法 1：在 PowerShell 中运行安装命令：',
    'echo           winget install OpenJS.NodeJS.LTS',
    'echo.',
    'echo   方法 2：前往官网下载安装 Node 22 或 24 LTS：',
    'echo           https://nodejs.org/zh-cn/download',
    'echo.',
    'echo 安装完成后重新双击此脚本即可。',
    'echo.',
    'pause',
    'exit /b 1',
    '',
    ':fail',
    'echo.',
    'echo ==========================================',
    'echo [提示] 服务端已退出或启动失败。',
    'echo ==========================================',
    'echo 若提示 EADDRINUSE，说明 3000 端口已被占用，',
    'echo 可用记事本修改本脚本中的 set PORT=3001 换端口。',
    'echo.',
    'pause',
    'exit /b 1',
    ''
  ];
  const startBat = startBatLines.join('\r\n');

  fs.writeFileSync(path.join(outDir, 'start.sh'), startSh, { mode: 0o755 });
  fs.writeFileSync(path.join(outDir, 'deploy.sh'), deploySh, { mode: 0o755 });
  fs.writeFileSync(path.join(outDir, 'stronghold.service'), strongholdService, 'utf8');
  fs.writeFileSync(path.join(outDir, 'start-windows.bat'), startBat, 'utf8');
  fs.writeFileSync(path.join(outDir, '双击启动游戏服务.bat'), startBat, 'utf8');
}

function generateReadme(outDir) {
  const content = `# 明日方舟「卫戍协议：盟约」全量服务器部署说明

本包为 **v0.1.6.1** 全量服务器一键部署包，内置：
- **全量素材与音视频**：包含 8580+ 项游戏美术、音频、双语作战语音与全量干员皮肤，开箱自给自足。
- **全端匹配引擎**：内置完整自动撮合排队引擎与房间内补人机制，玩家可随时快速匹配或组队发车。
- **便携式 Node.js 运行时**：Windows 双击即启，无需系统预装任何环境。
- **多端兼容**：既支持网页端浏览器直连（从服务端在线加载素材），又完美支持电脑客户端与安卓客户端（若客户端已开启本地优先加载，将自动使用本地素材，极大节省服务端流量）。
- **服务端与联机网关**：Node.js 原生 HTTP + WebSocket 游戏服务端
- **完整前端客户端**：开箱即用网页端，支持单人及 1–4 人联机合作
- **全量素材与音视频**：8580+ 项游戏美术、音频、双语作战语音与 174 款干员全量皮肤
- **官方 3D 棋盘**：已内置官方 3D 地形贴图与材质清单 (\`local-assets.json\`)
- **零网络依赖生产库**：\`node_modules\` 生产依赖已预装，服务器无需额外拉取 npm 模块

---

## 一、推荐部署方式

### 方式 1：Docker Compose 一键部署（最推荐，简单稳定）

只要服务器已安装 Docker 与 Docker Compose：

\`\`\`bash
# 1. 解压包后进入目录
cd Stronghold-Protocol-v0.1.6-pre-skin-Server

# 2. 一键构建并启动
docker compose up -d
\`\`\`

- 服务将在后台运行，并监听 \`3000\` 端口。
- 查看运行日志：\`docker compose logs -f\`
- 停止服务：\`docker compose down\`

---

### 方式 2：Linux 原生 Node.js 部署

要求环境：服务器已安装 **Node.js ≥ 22**（推荐 Node 22 或 24 LTS）。

\`\`\`bash
# 赋予脚本执行权限
chmod +x start.sh deploy.sh

# 方式 2.1：前台调试启动
./start.sh

# 方式 2.2：使用管理助手选择 Docker、后台守护 (nohup) 或注册 systemd
./deploy.sh
\`\`\`

---

### 方式 3：注册为 Linux systemd 开机自启服务

\`\`\`bash
# 使用管理员权限运行部署助手直接安装：
sudo ./deploy.sh install

# 或手动配置：
sudo cp stronghold.service /etc/systemd/system/
# 修改 /etc/systemd/system/stronghold.service 中的 WorkingDirectory 为您的实际路径
sudo systemctl daemon-reload
sudo systemctl enable --now stronghold

# 常用运维命令：
sudo systemctl status stronghold    # 查看状态
sudo systemctl restart stronghold   # 重启服务
sudo journalctl -u stronghold -f    # 实时查看日志
\`\`\`

---

### 方式 4：Windows Server 服务器开服

在 Windows Server 上解压后，确保系统已安装 Node.js 22+，双击运行：
\`\`\`cmd
start-windows.bat
\`\`\`

---

## 二、端口与反向代理配置

游戏默认监听 \`0.0.0.0:3000\`。请确保云服务器控制台安全组已放行 **TCP 3000** 端口。

如果绑定域名并配置 SSL (HTTPS / WSS)，请配置反向代理：

### 1. Nginx 反代配置示例

\`\`\`nginx
map $http_upgrade $connection_upgrade {
    default upgrade;
    ''      close;
}

server {
    listen 443 ssl http2;
    server_name game.yourdomain.com;

    ssl_certificate     /path/to/fullchain.pem;
    ssl_certificate_key /path/to/privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection $connection_upgrade;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 1h;
    }
}
\`\`\`

### 2. Caddy 反代配置示例

\`\`\`caddy
game.yourdomain.com {
    reverse_proxy 127.0.0.1:3000
}
\`\`\`

---

## 三、常用环境变量

可在 \`.env\`、系统环境或 \`docker-compose.yml\` 中调整：

| 变量名 | 默认值 | 说明 |
|---|---|---|
| \`PORT\` | \`3000\` | HTTP 与 WebSocket 监听端口 |
| \`HOST\` | \`0.0.0.0\` | 监听地址 |
| \`SP_COMBAT\` | \`client\` | 战斗模拟位置：\`client\` (浏览器端) / \`server\` (服务端) |
| \`SP_VERIFY\` | \`off\` | 战斗回放校验：\`off\` / \`sample\` / \`all\` |
| \`TRUST_PROXY\` | \`auto\` | 反向代理来源识别：\`auto\` / \`1\` / \`0\` |

---

## 四、健康检查与诊断

- 服务健康检查接口：\`GET http://127.0.0.1:3000/healthz\`
- 本地诊断工具：\`node tools/doctor.mjs\`
`;

  fs.writeFileSync(path.join(outDir, 'README-服务器部署说明.md'), content, 'utf8');
}

async function main() {
  const o = parseArgs(process.argv.slice(2));
  console.log(`==========================================`);
  console.log(` 卫戍协议：盟约 · 生成服务器部署包`);
  console.log(` 目标目录: ${o.out}`);
  console.log(`==========================================`);

  if (fs.existsSync(o.out)) {
    console.log(`  · 清理旧目录: ${o.out}`);
    await fsp.rm(o.out, { recursive: true, force: true });
  }
  await fsp.mkdir(o.out, { recursive: true });

  // 1. 复制版本库核心文件
  console.log('  · 正在复制仓库代码...');
  const files = trackedFiles();
  let copiedCount = 0;
  for (const f of files) {
    const isExcluded = EXCLUDE_PREFIXES.some(prefix => f.startsWith(prefix));
    if (isExcluded) continue;
    const isAllowed = ALLOW_TRACKED_PREFIXES.some(prefix => f.startsWith(prefix));
    if (!isAllowed) continue;

    const src = path.join(ROOT, f);
    const dst = path.join(o.out, f);
    await fsp.mkdir(path.dirname(dst), { recursive: true });
    await fsp.copyFile(src, dst);
    copiedCount++;
  }
  console.log(`  ✔ 复制版本库文件: ${copiedCount} 个`);

  // 2. 复制公共静态资产 (public/assets, public/fonts, public/vendor)
  console.log('  · 正在复制静态资源 (美术、音频、字体、前端依赖)...');
  const assetDirs = ['public/assets', 'public/fonts', 'public/vendor'];
  for (const d of assetDirs) {
    const src = path.join(ROOT, d);
    const dst = path.join(o.out, d);
    if (fs.existsSync(src)) {
      const res = await copyDir(src, dst);
      if (res.files === 0) throw new Error(`${d} 里一个文件都没复制到 —— 素材是不是还没准备好？`);
      console.log(`    - ${d}: ${res.files} 个文件 (${(res.bytes / (1024 * 1024)).toFixed(1)} MB)`);
    }
  }

  // 3. 复制数据文件 (data/local-assets.json 等)
  const localAssetManifest = path.join(ROOT, 'data', 'local-assets.json');
  if (fs.existsSync(localAssetManifest)) {
    const dst = path.join(o.out, 'data', 'local-assets.json');
    await fsp.copyFile(localAssetManifest, dst);
    console.log('    - data/local-assets.json: 已收录官方 3D 贴图清单');
  } else if (fs.existsSync(path.join(ROOT, 'public', 'assets', 'local'))) {
    console.log('    ! 有 public/assets/local 但没有 data/local-assets.json：贴图进了包也用不上，'
      + '先跑 node tools/setup.mjs --local 生成清单');
  }

  // 4. 复制生产 node_modules
  if (o.deps) {
    await installProductionDeps(o.out);
  }

  // 4.5. 复制便携版 Node (让 Windows Server 无需预装任何环境，解压双击直接开服)
  const portableNodeSrc = path.join(ROOT, '..', 'Stronghold-Protocol-Windows', 'node');
  if (fs.existsSync(portableNodeSrc)) {
    console.log('  · 正在收录 Windows x64 便携版 Node.js (开箱即用)...');
    await copyDir(portableNodeSrc, path.join(o.out, 'node'));
  }

  // 5. 生成 Docker 与开服运维脚本
  console.log('  · 正在生成 Docker 与一键部署脚本...');
  generateDockerFiles(o.out);
  generateScripts(o.out);
  generateReadme(o.out);

  console.log(`\n✔ 服务器部署包目录已就绪: ${o.out}`);

  // 6. 压缩成 ZIP
  if (o.zip) {
    const zipPath = `${o.out}.zip`;
    console.log(`\n  · 正在压缩为服务器 ZIP 部署包: ${zipPath}...`);
    const { files, bytes, zipBytes } = zipDir(o.out, zipPath);
    console.log(`✔ ZIP 部署包创建成功: ${files} 个文件，原始 ${(bytes / (1024 * 1024)).toFixed(1)} MB → 压缩后 ${(zipBytes / (1024 * 1024)).toFixed(1)} MB`);
    console.log(`  完整路径: ${zipPath}`);
  }
}

main().catch(err => {
  console.error('[构建异常]', err);
  process.exit(1);
});

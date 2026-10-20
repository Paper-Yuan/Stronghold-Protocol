# 明日方舟「卫戍协议：盟约」v0.2.6 最新服务器部署与使用说明

本包为 **v0.2.6 最新纯净服务端发布包**（已剥离个人无限火力及私有调试模块，保留完整官方特性与核心系统）。

---

## 一、版本特性与包含内容

1. **游戏运行逻辑完整**:
   - 包含完整的 1–4 人联机与单人独立模拟合作模式。
   - 包含完整干员调配系统、干员持有替补系统、自选编队系统。
   - 修复干员技能在局内回退为默认技能的问题（技能双向映射与调配容错校验）。
   - 修复替补干员在局内头像与立绘被原干员皮肤覆盖的问题。
   - 包含模组与工坊系统支持（标准隔离机制）。

2. **开箱即用与生产依赖**:
   - 内置 `node_modules` 生产运行依赖库，无需服务器额外执行 `npm install`。
   - 内置 Linux / Docker / Windows 多平台一键启动脚本。

---

## 二、部署与运行方式

### 方式 1：Linux 服务器启动 (推荐)

要求：服务器安装 **Node.js ≥ 22**（推荐 Node 22 或 24 LTS）。

```bash
# 1. 赋予执行权限
chmod +x start.sh deploy.sh

# 2. 前台启动调试
./start.sh

# 3. 或使用部署助手（支持 Docker、nohup 后台或安装为 systemd 服务）
./deploy.sh
```

若注册为开机自启系统服务：
```bash
sudo ./deploy.sh install
# 管理命令：
sudo systemctl status stronghold
sudo systemctl restart stronghold
sudo journalctl -u stronghold -f
```

---

### 方式 2：Docker / Docker Compose 部署

只要服务器安装了 Docker：
```bash
docker compose up -d
```
- 服务将在后台运行并监听 `3000` 端口。
- 查看日志：`docker compose logs -f`
- 停止服务：`docker compose down`

---

### 方式 3：Windows / Windows Server 部署

确保电脑或服务器已安装 Node.js ≥ 22：

- 解压后**直接双击根目录的 `启动游戏.bat`** 即可（推荐）。
- 也可以用 `start-windows.bat` / `run-server.bat`（根目录和 `scripts/` 里都有）。
- 启动后浏览器打开 <http://127.0.0.1:3000>。

---

## 三、网络与反向代理说明

- 服务默认监听端口：`3000`（请在服务器安全组/防火墙开放 TCP 3000 端口）。
- 启动后浏览器访问：`http://服务器IP:3000` 即可进入游戏大厅。
- 如需配置域名和 SSL 证书，请配置 Nginx / Caddy 反向代理到 `http://127.0.0.1:3000`，并开启 WebSocket 支持（`Upgrade` 与 `Connection` 标头传递）。

---

## 四、环境变量配置

| 变量名 | 默认值 | 说明 |
|---|---|---|
| `PORT` | `3000` | 服务端口 |
| `HOST` | `0.0.0.0` | 监听地址 |
| `NODE_ENV` | `production` | 生产模式 |
| `SP_COMBAT` | `client` | 战斗模拟计算位置（`client` 浏览器端 / `server` 服务端） |
| `SP_VERIFY` | `off` | 战斗回放校验开关（`off` / `sample` / `all`） |

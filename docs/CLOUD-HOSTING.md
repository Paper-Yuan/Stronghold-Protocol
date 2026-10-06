# 免费云端部署指南（Hugging Face Spaces & Render）

本项目已全面支持 **Hugging Face Spaces** 与 **Render** 的自动化开箱即用云端托管。两者均**完全免费**、支持长连接 WebSocket（`wss://`）以及全量素材和干员中日双语语音。

---

## 方案一：Hugging Face Spaces 部署（最推荐 · 16G 内存免休眠）

Hugging Face Spaces 提供永久免费的 **2 vCPU · 16GB RAM · 50GB 存储** 容器环境，免绑信用卡，配额极大。

### 部署步骤：
1. 注册并登录 [Hugging Face](https://huggingface.co/)。
2. 点击右上角头像 ➔ **New Space**：
   - **Space name**：自定义（如 `stronghold-protocol`）
   - **License**：`gpl-3.0`
   - **Space SDK**：选择 **Docker** ➔ **Blank**
   - **Space hardware**：保持默认免费的 **CPU basic · 2 vCPU · 16GB RAM · Free**
   - **Privacy**：选择 **Public**
   - 点击 **Create Space**。
3. 将本项目代码推送到该 Space（二选一）：
   - **方式 A（网页直接关联 GitHub 同步，最省心）**：
     在刚建好的 Space 页面 ➔ 点击 **Settings** ➔ 找到 **Repository Mirroring** ➔ 输入你的 GitHub 仓库地址（`https://github.com/Paper-Yuan/Stronghold-Protocol.git`），开启自动同步。
   - **方式 B（Git 命令行推送）**：
     ```bash
     git remote add space https://huggingface.co/spaces/<你的用户名>/<Space名称>
     git push space 0.1.6-pre-skin:main
     ```
4. 容器会自动读取仓库根目录的 `Dockerfile` 与 `README.md` 元数据（已配置 `app_port: 3000`），约 3~5 分钟构建完成。
5. 页面顶部会直接显示游戏主界面，右上方有 **Embed this Space** 或直接获取专属公网网址（形如 `https://<用户名>-<Space名>.hf.space`），发给朋友即可开黑。

---

## 方案二：Render 部署（每月 750 小时免费 · 支持 GitHub 自动触发）

Render 支持通过仓库根目录的 `render.yaml` 实现 Blueprint（一键基础设施编排）。

### 部署步骤：
1. 打开 [Render 官网](https://render.com/)，使用 GitHub 账号登录。
2. 点击右上角 **New +** ➔ 选择 **Blueprint**：
   - 连接你的 GitHub 仓库 `Paper-Yuan/Stronghold-Protocol`（分支选 `0.1.6-pre-skin`）。
   - Render 会自动识别仓库根目录的 `render.yaml`，并自动填好全部参数：
     - Service: `stronghold-protocol`
     - Runtime: `Docker`
     - Plan: `Free`
     - Region: `Singapore` (新加坡，亚太延迟低)
     - Health Check: `/healthz`
3. 点击底部的 **Apply** 按钮。
4. Render 会自动拉取代码并基于 Docker 构建游戏镜像（自动下载全量素材与语音）。
5. 部署完成后，在 Render 控制台即可看到分配的专属 HTTPS 链接（形如 `https://stronghold-protocol-xxxx.onrender.com`）。

---

## 运维与特性对照

| 特性 | Hugging Face Spaces | Render |
|---|---|---|
| **免费内存** | **16 GB** | 512 MB |
| **免费磁盘** | **50 GB** | 容器临时磁盘 |
| **绑卡要求** | **免绑卡** | **免绑卡** |
| **休眠机制** | 闲置挂起，访客进入约 10 秒唤醒 | 15 分钟无访问休眠，冷启动约 30~50 秒 |
| **月度限额** | 无固定小时上限 | 每月 750 小时 Free 运行时长 |
| **域名与 SSL** | 自带 `*.hf.space` (HTTPS/WSS) | 自带 `*.onrender.com` (HTTPS/WSS) |

# 卫戍协议：盟约 (Stronghold Protocol: Alliance)
## 工程交接与运维开发全景指南 (v0.1.6.1 Patch / Matchmaking & Telemetry)

> **文档性质**：工程研发交接 / 生产环境运维手册 / 架构设计文档  
> **交接对象**：下一位接手研发 / 运维负责人 / 安全研究员  
> **最后维护时间**：2026-10-07 14:30 (UTC+8)  
> **对应分支**：`feature/matchmaking-system` (基于 `v0.1.6.1`，commit `55b0a04`+)

---

## 目录
1. [工程环境与分支隔离原则](#一工程环境与分支隔离原则)
2. [阿里云生产服务器现况与拓扑](#二阿里云生产服务器现况与拓扑)
3. [核心功能实现与模块映射](#三核心功能实现与模块映射)
4. [踩坑记录与关键避坑防线](#四踩坑记录与关键避坑防线)
5. [日常运维与无感热升级 SOP](#五日常运维与无感热升级-sop)
6. [后续规划与遗留待办 (TODO)](#六后续规划与遗留待办-todo)

---

## 一、工程环境与分支隔离原则

为了保障研发安全性，本地工程采用严格隔离机制：

| 环境 | 路径 / 地址 | 分支 / 说明 | 约束规则 |
|---|---|---|---|
| **主工作区 (绝对只读)** | `E:\Workbox\系统` | `0.1.6.1` (原始主干) | **严禁在此修改或提交任何代码** |
| **独立工作树 (研发区)** | `E:\Workbox\sp-matchmaking` | `feature/matchmaking-system` | 所有代码开发、单测、打包在此进行 |
| **阿里云生产服务器** | `101.37.150.107` | root 免密互通，目录 `/opt` | 当前承载百人在线对局，严禁暴力操作 |

> [!CAUTION]
> **Windows 环境命令行注意**：  
> 本地开发机运行 Windows 10/11，默认终端为 PowerShell。组合命令**切勿使用 `&&`**（会导致语法错误），必须使用 `;` 分隔。

---

## 二、阿里云生产服务器现况与拓扑

### 1. 基础资源状态
- **操作系统**：Ubuntu 24.04.2 LTS (Noble Numbat)
- **内存使用**：总计 1.6GB，当前使用约 42%（资源充裕）
- **磁盘使用**：`/dev/vda3` (40GB)，已用 15GB，**空闲 23GB (占用率 39%)**。
- **活跃连接数**：日间常规维持在 **120 ~ 170+** 个并发长连接。

### 2. 目录结构
```text
/opt/
├── stronghold/             # [主服节点 - Blue] 端口 3000，PM2 进程名 stronghold (PID 46384)
├── stronghold-green/       # [热备节点 - Green] 端口 3002，PM2 进程名 stronghold-green (PID 46424)
├── stronghold-backup/      # [生产冷快照] 包含完整代码与静态素材 (瘦身备份)
├── hot-swap.sh             # [蓝绿热切脚本] 生产环境零中断升级流水线脚本 (可执行)
└── scheduled-upgrade.sh    # [定时升级脚本] 具备 10 分钟倒计时与健康探针回退机制
```

### 3. 网络拓扑与端口划分
```text
                     [ 外部客户端 / 手机端 / 浏览器 ]
                                    │
                    ┌───────────────┴───────────────┐
                    ▼                               ▼
       【端口 3000: 生产主服 (Blue)】       【端口 80: Nginx 反代网关】
       - 当前直连对外服务                   - upstream: 127.0.0.1:3002 (Green)
       - 承载当前全服 170+ 对局             - WebSocket 长连接超时: 3600s
       - PM2 进程名: stronghold             - 毫秒级 reload，零丢包
```

---

## 三、核心功能实现与模块映射

### 1. 多人快速随机匹配引擎 (Matchmaking)
- **核心实现**：`server/matchmaking.js`、`server/lobby.js`
- **协议定义**：
  - C2S: `match.queue` (`{ mode, difficulty, fillBots }`)、`match.cancel`
  - S2C: `match.status` (`{ status, mode, difficulty, elapsed, matched, target }`)、`match.found` (`{ roomCode, mode, difficulty }`)
- **撮合逻辑**：
  - 单人模式（`solo`）：排队瞬间直接创建房间并下发 `match.found`。
  - 多人模式（`coop`）：按 `difficulty` 分桶，集齐 4 人立即发车；超时 10 秒且 `fillBots=true` 时，自动补充 AI 队友开局。
  - 房间匹配：房主可在已创建的房间中点击「匹配队友」，自动从散客池抓取玩家入座。

### 2. 大厅与房间全动态监测 (Real-Time Push Broadcast)
- **核心实现**：`server/lobby.js` (`getLobbyStats()`, `broadcastLobbyStats()`)
- **前端集成**：`public/js/store.js`、`public/js/main.js`、`public/js/screens/lobby.js`
- **广播机制**：
  - 弃用 4 秒被动 HTTP 轮询，采用事件驱动型 S2C WebSocket 推送：`t: 'lobby.stats'`。
  - 触发点：`onHello`（进大厅）、`onDisconnect`（断线）、`room.create`（建房）、`room.join`（加房）、`disposeRoom`（解散）。
  - **250ms 防抖节流**：高频创建/解散时合并广播，并保留 4 秒全局保底心跳。
  - 前端大厅顶栏胶囊、Mode 02 角标、模态框公开房间列表纯事件驱动毫秒级响应。

### 3. 网络波动韧性优化 (Net Resilience)
- **核心实现**：`public/js/net.js`、`server/net.js`
- **算法细节**：
  - **EMA RTT 平滑**：$\alpha = 0.25$，消除瞬时单次往返抖动。
  - **Jitter 抖动自适应心跳**：当往返抖动增大时，动态将掉线判定超时从 `15000ms` 线性放宽至最高 `37500ms`（2.5倍），极大降低弱网/移动网络误断率。
  - **在途请求断线缓冲 (In-Flight Queue)**：连接中断瞬间发出的请求暂存本地，待重连成功后立即批量冲刷补发。
  - **底层 TCP 优化**：开启 TCP Keepalive 与 TCP NoDelay（禁用 Nagle 算法）。

### 4. 60秒停服维护机制 (Graceful Shutdown)
- **核心实现**：`server/lobby.js` (`startMaintenance()`, `cancelMaintenance()`)
- **前端 HUD**：`public/js/main.js` (`MaintenanceBanner`)
- **工作机制**：
  - 全服推送 `server.maintenance`，前端顶栏浮现战术斑马线 Hazard 条并秒级倒计时。
  - 拦截所有 `room.create` 与 `match.queue`，返回 `ERR.MAINTENANCE`。
  - 倒计时归零时优雅关闭房间并落盘；支持 `cancelMaintenance()` 随时取消恢复。

### 5. 战术工业风大厅监控后台 (Tactical Telemetry Dashboard)
- **访问地址**：
  - `http://101.37.150.107:3000/dashboard.html`
  - `http://101.37.150.107/dashboard.html`
- **特性**：
  - 零侵入纯只读设计（不修改任何内存状态，不抢占选手席位）。
  - 完整适配明日方舟/卫戍协议科幻工业美学（黑绿基调、薄荷绿高亮、Bender 等宽数字、六角战术徽标）。
  - 实时大盘展示在线总数、交战中局数、房间密钥、房主、难度胶囊、4 席位计量槽及当前状态。
  - 解锁了移动端和桌面端的全屏滑动限制，内嵌 `max-height: 620px` 独立吸顶滚动容器。

---

## 四、踩坑记录与关键避坑防线

### 1. 前后端原型方法与 JSON 纯对象的割裂（重要事故预防）
- **现象**：进入房间时前端抛出 `SYSTEM FAULT: room.freeSeat is not a function`。
- **根因**：服务端的 `Room` 是带有原型方法的 Class 实例；而前端 Store 中的 `room` 仅为服务端下发的纯 JSON 数据字典。
- **规范**：**前端绝对禁止调用 `room` 上的任何方法**，所有席位计算必须使用前端解构派生属性（如 `facts.emptySeats > 0`、`facts.isHost`）。

### 2. 席位上限常数核准
- **参战选手上限**：`MAX_SEATS = 4`（P1 ~ P4）。
- **观战席位上限**：`MAX_SPECTATORS = 2`。
- **单房最大连接量**：4 选手 + 2 观战 = 6 人。严禁在代码中随意硬编码为 10 人。

### 3. 磁盘占用暴增排查 (Android 编译中间件)
- **现象**：复制目录后磁盘瞬间飙升至 83% (剩余仅 6.4GB)。
- **根因**：根目录下包含了 Android 本地 Gradle 构建产物 `android/app/build`（单体 4.5GB+）以及历史 APK、Windows zip 压缩包。
- **规范**：
  - 服务端部署只需 `server/`、`public/`、`shared/`、`package.json`、`node_modules/`。
  - 打包新包时必须添加过滤参数：
    ```bash
    tar --exclude='android/app/build' --exclude='*.apk' --exclude='*.zip' -czf patch.tar.gz ...
    ```

---

## 五、日常运维与无感热升级 SOP

后续进行新功能发布或 Bug 修复时，**严禁直接在服务器上运行 `pm2 restart stronghold`**。请严格遵循以下 SOP：

### 步骤 1：本地打包
在 `E:\Workbox\sp-matchmaking` 目录下执行：
```powershell
git archive --format=tar.gz -o update-patch.tar.gz HEAD
```

### 步骤 2：上传补丁
```powershell
scp -o BatchMode=yes update-patch.tar.gz root@101.37.150.107:/opt/update-patch.tar.gz
```

### 步骤 3：服务器执行零中断热切
```powershell
ssh root@101.37.150.107 "/opt/hot-swap.sh /opt/update-patch.tar.gz"
```
**脚本执行内部逻辑**：
1. 自动检测当前在线区（如当前为 3001 Blue，则目标更新区自动锁定为 3002 Green）。
2. 将补丁解压覆盖到目标空闲区。
3. 启动/重启空闲区实例，并连续发起 10 轮内部 HTTP 健康检查。
4. **自测 100% 通过后**，毫秒级重载 Nginx 反代配置 (`nginx -s reload`)。
5. 新进大厅与刷新页面的玩家全部切至新区；老区允许存活对局打完（Drain）。

### 步骤 4：验证监控
打开浏览器访问 `http://101.37.150.107:3000/dashboard.html`，确认大盘数据实时跳动正常。

---

## 六、后续规划与遗留待办 (TODO)

1. **主端口 3000 的 Nginx 接管**：
   - 目前 Nginx 网关监听在 80 端口，3000 端口仍由老进程占用。
   - 待挑选玩家极少的低谷期（如凌晨 4 点），将 3000 端口交由 Nginx 统一监听反代，实现对外端口完全固定且全面蓝绿热切。
2. **大厅平滑引导迁移广播**：
   - 在热切执行时，进一步完善服务端下发 `server.migrate` 事件，让大厅闲置界面的玩家连线自动静默断开重连至新节点，无需手动刷新网页。
3. **桌面端打包同步**：
   - 将当前最新动态监测与网络韧性代码同步编译为 Windows-x64 与 Android 独立客户端包。

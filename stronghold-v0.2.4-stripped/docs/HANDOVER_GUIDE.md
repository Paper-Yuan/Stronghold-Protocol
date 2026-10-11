# 卫戍协议：盟约 (Stronghold Protocol: Alliance)
## 工程交接与核心运维主导逻辑白皮书 (Handover & Governance Master Plan)

> **文档性质**：工程研发主导规划 / 生产环境核心运维宪章 / 架构决策指南  
> **面向对象**：下一任主程 / 运维负责人 / 安全研究员 (接手必读)  
> **更新时间**：2026-10-07 14:35 (UTC+8)  
> **执行分支**：`feature/matchmaking-system` (基于 `v0.1.6.1`，commit `5567fa98`+)  
> **核心宗旨**：**「零炸房、零污染、数据驱动、平滑热切」**

---

## 零、接手第一准则：主导治理思维 (Governance Philosophy)

本工程不是简单的静态网页或单机项目，而是一个**日间常驻 120~170+ 位玩家正在打 Boss、合成装备、实时联防的在线 WebSocket 游戏集群**。

接手本项目时，你的**思考主轴与决策优先级**必须严格遵循以下铁律：
```text
【最高优先级】 保障生产当前正在进行的对局 (Players First, Zero Disruption)
      │
      ▼
【次高优先级】 严守主工程与分支隔离 (Branch Isolation, No Dirty Commits)
      │
      ▼
【第三优先级】 蓝绿解耦与闲置区验证 (Stage & Probe in Idle Zone)
      │
      ▼
【第四优先级】 生产前置网关无感切换与平滑引流 (Drain & Hot-Swap)
```

---

## 一、开发环境主导逻辑：双轨隔离与分支模型

### 1. 物理目录与分支界限
```text
本地宿主机 (Windows 11)
├── E:\Workbox\系统/             <-- [主工作区] 分支: 0.1.6.1 (官方冻结基准)
│                                 【只读约束】严禁在此目录运行修改、提交或覆盖命令！
│
└── E:\Workbox\sp-matchmaking/   <-- [独立工作树] 分支: feature/matchmaking-system
                                  【研发主战场】所有新特性开发、单元测试、打包均在此进行！
```

### 2. 终端交互陷阱与规约
- **终端规范**：Windows 默认终端为 PowerShell。
- **语法红线**：PowerShell 5.1 不支持 `&&` 语法（会直接抛出 ParserError）。**组合命令必须统一使用 `;` 分隔**。
  - ❌ 错误：`git add . && git commit -m "..."`
  - ✅ 正确：`git add . ; git commit -m "..."`

---

## 二、生产架构主导逻辑：多端口蓝绿双活热切

为了彻底解决“一更新就全服闪断、在线玩家全掉线炸房”的顽疾，生产环境构建了**前置反代网关 + 蓝绿双实例热切**架构。

### 1. 拓扑结构图
```text
                             [ 外部玩家客户端 / 移动端 / 浏览器 ]
                                              │
                      ┌───────────────────────┴───────────────────────┐
                      ▼                                               ▼
         【对外服务: 端口 3000 (主服)】                   【对外网关: 端口 80 (Nginx)】
         - 承载当前全服 170+ 活跃对局                      - 反向代理至当前活跃后端
         - PM2 进程名: stronghold                         - WebSocket 升级支持 (超时 3600s)
         - 目录: /opt/stronghold                          - 配置文件: /etc/nginx/sites-available/default
                      │                                               │
                      │                                               ▼
                      │                             ┌───────────────────────────────────┐
                      │                             │  upstream stronghold_backend      │
                      │                             └─────────────────┬─────────────────┘
                      │                                               │ (毫秒级热切)
                      │                        ┌──────────────────────┴──────────────────────┐
                      ▼                        ▼                                             ▼
         【蓝区 Blue (当前运行)】    【绿区 Green (端口 3002)】                    【备用蓝区 (端口 3001)】
         - PM2: stronghold          - PM2: stronghold-green                       - 待命热备槽位
         - 目录: /opt/stronghold    - 目录: /opt/stronghold-green                 - 目录: /opt/stronghold-blue
         - 状态: 在线接客           - 状态: 备用热备 / 打补丁测试                 - 状态: 闲置
```

### 2. 日常无感升级主导流程 (核心自动化脚本 `/opt/hot-swap.sh`)
```text
[阶段 1: 判定空闲节点]
  脚本自动检测当前 Nginx 反代指向。
  若 3001 在线，则目标升级区锁定为 3002 (Green)；反之亦然。生产主服不受任何影响。
          │
          ▼
[阶段 2: 闲置区打补丁]
  新代码解压到目标闲置区目录 (如 /opt/stronghold-green)。
          │
          ▼
[阶段 3: 闲置区自测与探针]
  在目标端口 (3002) 启动 PM2 实例。
  自动化运行 10 轮内部 HTTP 探针与 WebSocket 握手：
  - 探针失败：自动终止流水线，报警退出。生产环境毫发无损！
  - 探针成功：进入下一步热切。
          │
          ▼
[阶段 4: Nginx 毫秒级 Reload]
  sed 修改 Nginx upstream 端口并执行 `nginx -t && systemctl reload nginx`。
  新进入大厅的玩家和刷新网页的玩家秒级接入新版本。
          │
          ▼
[阶段 5: 老区优雅排空 (Drain)]
  正在战斗的老玩家连接在老区保持不断线，打完一局返回大厅时自动重连进入新服。
  老区房间数归 0 后优雅待命。
```

---

## 三、核心模块与协议设计主导逻辑

### 1. 多人撮合与防超时机制 (`server/matchmaking.js`)
- **撮合模型**：
  - 难度分桶队列：`FUNNY`、`NORMAL`、`HARD`、`ABYSS` 互不干扰。
  - 人数上限：正式对战席位 **严格限制为 4 人 (`MAX_SEATS = 4`)**，P1～P4。
  - 观战席位：独立席位 **上限 2 人 (`MAX_SPECTATORS = 2`)**。
- **补位超时规则**：
  - 队列等待时间超过 **10 秒** 且玩家勾选了 `fillBots=true` 时，引擎自动触发 AI 补位，用虚拟博士填满剩余席位并瞬间发车。
  - 房主在房间等待界面可随时发起「匹配队友」，直接从全局散客池中拉取同难度散客。

### 2. 全动态大厅状态广播 (`server/lobby.js`)
- **推送架构**：
  - 摒弃前端每 4 秒向服务端发 `room.list` 请求的被动轮询模式（170 玩家时每秒产生数十次无效查询）。
  - 改为服务端统一主动事件广播：S2C `t: 'lobby.stats'`。
- **广播节流控制**：
  - 高频建房/退房采用 **250ms 防抖节流定时器** (`_statsDebounceTimer`)，将瞬间多次事件合并为单次全服广播。
  - 保留 **4 秒全局心跳广播** (`_statsPeriodicTimer`)，兜底网络异常恢复。
- **前端响应链路**：
  - `public/js/store.js` 统一接管 `store.lobbyStats`。
  - 大厅顶栏在线人数胶囊、Mode 02 角标、公开房间列表纯数据驱动，无需刷新页面，实时跳动。

### 3. 网络波动韧性与重连加固 (`public/js/net.js`)
- **EMA RTT 算法**：
  $$RTT_{smooth} = (1 - \alpha) \cdot RTT_{prev} + \alpha \cdot RTT_{sample} \quad (\alpha = 0.25)$$
- **Jitter 自适应超时**：
  - 当网络抖动增加时，死连接判定门槛从默认的 $15000\text{ms}$ 动态扩容至最高 $37500\text{ms}$（2.5倍），彻底根除手机弱网切换（WiFi ⇄ 4G）导致的闪断。
- **在途请求断线队列 (In-Flight Buffer)**：
  - 玩家点击操作时如果刚好遭遇瞬时断网，请求不会直接被丢弃抛错，而是进入挂起缓冲池；WebSocket 握手恢复瞬间立即重放。

### 4. 60秒停服维护与前端熔断 (`server/lobby.js` & `public/js/main.js`)
- **维护倒计时触发**：`lobby.startMaintenance(60, "维护原因")`。
- **前端反应**：顶栏出现醒目的 Hazard 战术斑马线倒计时 HUD，伴随倒计时扣减与 Toast 弹窗提醒。
- **熔断保障**：建房 `room.create` 和匹配 `match.queue` 在服务端直接返回 `ERR.MAINTENANCE`，杜绝维护前夕开新局。
- **可逆性**：可通过 `lobby.cancelMaintenance()` 随时取消并向全服广播恢复通知。

---

## 四、历史踩坑血泪史与避坑红线 (Crucial Lessons)

接手者请将以下 4 条铭记于心，每一条都是实战中踩坑排查得出的硬性约束：

### 🚨 避坑红线 1：前端代码绝不可直接调用后端 Class 实例的原型方法
- **故障复盘**：曾出现玩家进入多人房间后屏幕弹出 `SYSTEM FAULT: room.freeSeat is not a function` 崩溃。
- **根因**：后端 Node.js 中的 `Room` 对象拥有原型方法 `room.freeSeat()`；但前端 Store 中存储的 `room` 仅为服务端下发的纯 JSON 数据，不存在原型链！
- **防御规范**：前端任何状态判断，**必须且只能使用从纯数据派生出的 `facts` 属性**（如 `facts.emptySeats > 0`、`facts.isHost`、`facts.canStart`）。

### 🚨 避坑红线 2：打包发布严禁携带 Android 本地编译垃圾进服务器
- **故障复盘**：服务器磁盘空间曾突增 16GB，占用率飙到 83%（剩余仅 6.4GB）。
- **根因**：把 Android 本地 Gradle 构建产物 `android/app/build`（4.5GB+ 中间件）和旧 APK、ZIP 安装包（1.5GB）一并打入补丁包推上了云端。
- **防御规范**：服务端运行只需要 `server/`、`public/`、`shared/`、`package.json`、`node_modules/`。打包时必须使用 `git archive` 或在 `tar` 命令中显式过滤 `android/`、`*.zip`、`*.apk`！

### 🚨 避坑红线 3：严禁直接在高峰期对当前 3000 端口执行 `pm2 restart`
- **故障复盘**：生产 3000 端口活跃连接常年 100~170+，任何粗暴的重启都会瞬间切断所有正在打 Boss 的对局，导致玩家全军覆没。
- **防御规范**：必须走 `/opt/hot-swap.sh` 蓝绿通道更新，或者提前 60 秒下发 `startMaintenance(60)` 通知玩家收尾。

### 🚨 避坑红线 4：监控后台 (dashboard.html) 必须解除游戏全局 overflow 锁
- **故障复盘**：做好的监控看板在手机和电脑上完全无法上下滑动。
- **根因**：页面引用了游戏的 `theme.css`，其中针对游戏主视口设置了 `body { height: 100%; overflow: hidden; }`。
- **防御规范**：监控后台等管理类页面，必须使用 `!important` 强制覆写 `html, body { height: auto !important; overflow-y: auto !important; -webkit-overflow-scrolling: touch; }`。

---

## 五、标准运维操作 SOP (Standard Operating Procedures)

### SOP-01: 日常新功能与热补丁发布流程

1. **本地测试验证**：
   在 `E:\Workbox\sp-matchmaking` 确认单元测试全绿：
   ```powershell
   node --test test/matchmaking.test.js ; node --test test/net-resilience.test.js
   ```
2. **生成纯净代码归档 (排除了所有大文件)**：
   ```powershell
   git archive --format=tar.gz -o update-patch.tar.gz HEAD
   ```
3. **推送到生产服务器**：
   ```powershell
   scp -o BatchMode=yes update-patch.tar.gz root@101.37.150.107:/opt/update-patch.tar.gz
   ```
4. **触发全自动蓝绿热切**：
   ```powershell
   ssh root@101.37.150.107 "/opt/hot-swap.sh /opt/update-patch.tar.gz"
   ```
5. **打开监控台验收**：
   访问 `http://101.37.150.107:3000/dashboard.html`，确认大盘数字正常、活跃房间列表持续更新。

---

### SOP-02: 紧急停机维护与倒计时广播流程

若遇到必须全服停机的严重底层重构或数据库变更：
1. **连接服务器启动 60 秒倒计时**：
   ```powershell
   ssh root@101.37.150.107 "node -e \"
     import('/opt/stronghold/server/index.js').catch(() => {});
     // 或者通过 pm2 发送维护信号
   \""
   ```
   *(或者直接在运行服务器的终端输入 `m 60`)*。
2. **观察客户端反应**：前端顶栏自动弹出 60 秒倒计时，阻断新开房间，玩家打完当前回合。
3. **倒计时归零后处理**：优雅退出并保存，维护完毕后重启 PM2。

---

### SOP-03: 灾难恢复与秒级回滚流程

若新版本切过去后发现重大未知逻辑 Bug：
1. **方法 A（Nginx 秒切回滚，推荐）**：
   直接将 upstream 目标改回上一版端口并 reload：
   ```bash
   sed -i "s/3002/3001/g" /etc/nginx/sites-available/default
   nginx -t && systemctl reload nginx
   ```
   *(耗时 < 1 秒，直接切回老版本)*
2. **方法 B（冷备还原）**：
   ```bash
   cp -r /opt/stronghold-backup/* /opt/stronghold/
   pm2 restart stronghold
   ```

---

## 六、长期演进路线与待办清单 (Roadmap & Backlog)

1. **主端口 3000 前置化彻底完成**：
   - 当前 Nginx 监听在 80 端口，3000 端口由主服直接监听。
   - 目标：挑选凌晨 4 点低谷期，将 3000 端口移交 Nginx 监听，后端完全解耦为 `3001` 与 `3002`，使对外端口完全固定。
2. **空闲大厅玩家静默引流迁移 (`server.migrate`)**：
   - 在执行热切时，老服务向大厅未开局的闲散玩家下发 `server.migrate`，客户端 JS 侦听后静默断开并在 0.5s 内重连到新服，无需玩家 F5 刷新网页。
3. **客户端安装包同步构建**：
   - 定期将 `feature/matchmaking-system` 合并，重新打出包含网络优化与动态监测的 Windows x64 与 Android APK 离线包。

---

> **结语**：  
> 战场瞬息万变，生产环境如履薄冰。请务必牢记：**先在备用区探针，再向生产线切流**。祝维护顺利！

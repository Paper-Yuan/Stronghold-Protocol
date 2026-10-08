# 开发计划与分支工作树交接文档 (Handover Document)

- **生成时间**：2026-10-08 22:00
- **当前工程根目录**：`E:\Workbox\sp-upgrade-2.1`（工作区主仓库：`e:\Workbox\系统`）
- **当前开发分支**：`feature/v0.2.1-fusion-master`
- **上游远端分支**：`upstream/master` (最新 HEAD: `3eced7bd`)
- **远程生产服务器**：`101.37.150.107:3000`（PM2 进程 `stronghold`，PID 141394，运行目录 `/opt/stronghold`）
- **Cloudflare 加速隧道**：`https://game.jyuanblog.cc.cd`（已安装 systemd 服务 `cloudflared.service`，直通主服，带 CF Cache HIT）

---

## 一、 当前分支工作树状态 (Worktree Status)

### 1. 分支与提交基线
- **分支名**：`feature/v0.2.1-fusion-master`
- **最新已提交 Commit**：`728bf350` (`fix(preload): include DIY operator skills, tokens, prof and active loadout Spine in preload profiles`)
- **近期关键提交链路**：
  - `728bf350`：预载清单补齐 DIY 自选干员技能图标、召唤物、职业标志与活动 Spine 模型
  - `06cd3d0a`：模拟端 `SIM_DATA_FILES` 补入 `backups.json`，解决对战阶段自选干员消失问题
  - `8e37a65f`：修复备战区自选干员小人异常与落子消失 bug
  - `70409ca1`：实现 `Battle.onOwnBoard` 与乌尔比安 S3 保护边界
  - `c4306ab7`：在 C2S/S2C 注册 `room.chat` 协议与广播模型，支持房间与局内文字聊天

### 2. 本地未提交修改清单 (`git status -s`)
以下文件处于暂存/未提交工作区，属于最新一期预载面板与管理后台调控代码：
- `public/admin/admin.css` & `public/admin/admin.js`：管理面板样式及大盘 4 档监控指标展示；
- `public/css/screens/title.css` & `public/js/screens/title.js`：标题画面预载微型胶囊与通知提示；
- `public/js/ui/preloadModal.js`：两阶段（Core/Full）预载器、下载池并发控制与 CacheStorage 桥接；
- `public/shared/protocol.js` & `shared/protocol.js`：协议字段扩充（`client.bundle` 4 档汇报：`android_full`, `web_full`, `web_core`, `web_stream`）；
- `server/admin.js`：后台管理 API，支持广播排空与实时统计；
- `server/lobby.js` & `server/net.js`：4 档客户端统计、等效负载评分 (ELS) 计算；
- `test/client-static.test.js`：客户端静态测试更新。

---

## 二、 核心待办开发计划总结 (Development Plan Summary)

详细技术文档已归档在项目内：
- 📄 **[docs/OPTIMIZATION_AND_PR_PLAN.md](file:///E:/Workbox/sp-upgrade-2.1/docs/OPTIMIZATION_AND_PR_PLAN.md)**

### 模块 1：2+2G 硬件性能调优、防崩熔断与操作延迟优化
- **背景与痛点**：达到 160~180 人时容易崩溃；阿里云监控显示总 CPU 未满，但 Node.js 单线程单核 100% 打满；40+ 房间 10Hz 状态广播抢占事件循环，买棋/调配指令滞后 300~500ms（严重黏手）；1.5GB 内存逼近 GC 触发 OOM。
- **实施路径**：
  1. **启动参数**：PM2 增加 `--max-old-space-size=1750`，配置 `--nouse-idle-notification`；
  2. **动态准入调控（熔断限流）**：
     - 安全线（<160 人）：畅通准入；
     - 预警线（160~190 人）：允许已预载及携带 Token 的老玩家重连，新玩家提示拥挤；
     - 熔断线（≥200 人或 Event Loop Lag > 120ms）：新入连接友好拦截排队，**绝不踢出或影响正在对局的玩家**，确保局内绝对流畅；
  3. **指令优先通道 & 广播节流**：
     - 优先调度消费 `g.buy`、`g.move`、`g.refresh` 等操作回包；
     - 状态广播节流 `DELAYS.PUBLIC_THROTTLE` 从 100ms 调整为 200ms（5Hz），单核占用直降 30%+，消除操作黏手感；
  4. **警告阈值放宽**：提高告警指标，去除频繁的阻塞式弹窗。

### 模块 2：进入者自动全量预载 (Auto Full Preload)
- **业务诉求**：无需手动弹窗确认，进入网页端后自动静默全量预载，利用 Cloudflare 隧道 CDN 分流。
- **实施路径**：
  1. 升级 `public/js/ui/preloadModal.js` 中的 `checkAutoPreload()`；
  2. 进入 1.0 秒后若未全量缓存，自动两阶段拉取：**Core 核心包（~35MB）完成立即无感顺延进入 Full 全量包（立绘/Spine/音频）**；
  3. 战斗中降低并发，完成后自动将 `client.bundle` 标记为 `web_full` 享受最高服务器准入权重。

### 模块 3：游戏内 6 项关键 UI 与交互问题修复
1. **图一：头像旁聊天气泡**：重构 `game.css` 的 `.ebubble--text`，去掉裁切文本的硬多边形，设定 `max-width: 4.5rem`（手机端 `min(70vw, 4.0rem)`），改善行高行距，解决单行过窄、换行过大与左侧不显文本的问题；
2. **图二：底部战术聊天框**：
   - 响应式适配：PC 端扩大宽度至 `4.8rem`，手机端左下紧凑停靠；
   - 移除非 active 状态下滚轮阻断，支持自由上下滚动历史；
   - 在 `backToLobby()`、`room.closed`、`room.leave`、`quitMatch()` 中分发 `chatMessages: []`，退出房间清空聊天；
3. **图三：商店栏双端适配**：
   - 保持 PC 端不变，针对手机端（窄视口/粗触控）添加弹性网格 `width: clamp(1.4rem, 13vw, 1.75rem)`，精简边距，放大干员名字与费用，解决过窄压缩；
4. **角色精细度差异修复**：
   - 解除手机端本地运行强制硬编码限死 DPR 1.5 的策略，连服与单机统一使用用户设置的画质 DPR（高画质允许 2.5~3.0），杜绝模糊拉伸；
5. **干员调向二段式段落感**：
   - 改造 `FacingWheel`：第一段落子入格锁定并播放音效，弹出四向轮盘；第二段单独点选箭头或从中心明确滑出，杜绝落子滑动误触面向；
6. **高帧率模式设置修复与 60/120 帧上限锁定**：
   - 修复 `settingsStore` 与 `app.ticker` 的联动响应，开启锁定 **120 FPS 上限**，关闭严格锁定 **60 FPS**，即时生效并持久化。

### 模块 4：上游 9 个 PR 的吸收评估
已完成代码与影响面研讨（均需保证双端动态适配）：
- **#361**（赫默满手牌撤退）：【必合】纯逻辑，零负面，双端兼容；
- **#382**（陈三技能龙剑气）：【必合】视觉补全，低画质自适应；
- **#383**（星熊我执红负血条）：【必合】机制表现，与血条元组高度适配；
- **#386**（谢拉格暴风雪向上刮）：【优化合入】增强视觉张力，低配限粒子；
- **#387**（观战盟约排除手牌等待区）：【必合】校准数据一致性；
- **#303**（血条下方分格弹药）：【必合】手机端做小于 2px 平滑合拢保护；
- **#334**（缓存图集分帧刷新削平尖峰）：【极力推荐】大幅削弱团战卡顿；
- **#287**（按盟约分行展示禁用干员）：【适配吸收】结合现有双栏 UI，手机端自适应滚动；
- **#323**（本机 localStorage 战绩页）：【适配吸收】纯前端零服务端开销，优化手机端面板宽度。

---

## 三、 接续开发执行指引 (Quick Start for Next Engineer)

1. **工作目录**：`cd E:\Workbox\sp-upgrade-2.1`（主工作树，勿在其他分支混淆修改）；
2. **第一优先级任务**：
   - 按 [OPTIMIZATION_AND_PR_PLAN.md](file:///E:/Workbox/sp-upgrade-2.1/docs/OPTIMIZATION_AND_PR_PLAN.md) 实施服务端 `server/lobby.js` & `server/net.js` 动态熔断与广播节流调整；
   - 实施客户端 6 项 UI/操作/帧率手感修复；
3. **验证与部署**：
   - 本地跑通：`npm run test` 与 `npm run lint`；
   - 平滑热更部署至生产主服（`101.37.150.107`），通过 Cloudflare 加速链路做真机验证。

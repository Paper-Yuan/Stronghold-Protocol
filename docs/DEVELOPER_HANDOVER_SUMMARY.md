# 开发计划与分支工作树交接文档 (Handover Document)

- **生成时间**：2026-10-08 22:00 · **最近更新**：2026-10-09（A–E 阶段实施完成，分 6 个提交入库）
- **当前工程根目录**：`E:\Workbox\sp-upgrade-2.1`（工作区主仓库：`e:\Workbox\系统`）
- **当前开发分支**：`feature/v0.2.1-fusion-master`
- **上游远端分支**：`upstream/master` (最新 HEAD: `3eced7bd`)
- **远程生产服务器**：`101.37.150.107:3000`（PM2 进程 `stronghold`，PID 141394，运行目录 `/opt/stronghold`）
- **Cloudflare 加速隧道**：`https://game.jyuanblog.cc.cd`（已安装 systemd 服务 `cloudflared.service`，直通主服，带 CF Cache HIT）

---

## 一、 当前分支工作树状态 (Worktree Status)

### 1. 分支与提交基线
- **分支名**：`feature/v0.2.1-fusion-master`
- **最新已提交 Commit**：`ebbac2e9` (`docs+tools: 优化计划/交接文档、loadGuard 单测与运维脚本`)
- **OPTIMIZATION_AND_PR_PLAN 实施提交链（2026-10-09）**：
  - `3a7627a5`：**A 阶段** — 2+2G 负载防护三档熔断（loadGuard）与广播节流分档（COMBAT 100ms / 其余 200ms）、指令快速通道 deferFlush、PM2 `--max-old-space-size=1300` + `max_memory_restart 1600M`、admin 面板展示
  - `2bb101fb`：**B 阶段** — 两阶段预载 Core→Full（autoChain，战斗期并发降为 1；Core ~93MB/2050 文件、Full ~428MB/4255 文件）、hello 上报 bundle 四档（`android_full` / `web_full` / `web_core` / `stream`）、大厅 PreloadPill、admin 分类展示
  - `920d6766`：**C1–C3** — 聊天气泡 `.team__bubble` 4.6rem 换行收敛；聊天面板 PC 4.8rem / 手机 `min(56vw,4rem)`、`chat-log` 常驻滚动、visualViewport 键盘抬升（`--kb-inset` / `.is-kb`，仅粗指针）、`.chat-input` min-height 0.24rem；退房/被踢/会话重置清空 `chatMessages`；商店卡手机端 `clamp(1.4rem,13vw,1.75rem)`；ServerLoadBadge 胶囊替代阻塞弹窗
  - `4679a32c`：**C4–C6** — 手机高画质 DPR 上限 2.0→3.0 / 棋盘 1.5→2.0（画质档位成为唯一降采样依据）；FacingWheel 二段式（落子即锚定 + drop/artPlace 音效，死区松手不再快提交默认 RIGHT，朝向必须明确滑动/点选/回车提交，提示文案更新）；高刷开启备战期上限 120fps（原 0 无上限）、`sanitizeSettings` 持久化 `highRefresh`
  - `ccdde3a9`：**测试** — loadGuard 红档拒新会话/重连 token 恒放行、hello BUSY 丢弃 socket 走退避、PREP 广播节流 200ms 适配
  - `ebbac2e9`：**文档与工具** — 计划/交接文档、`test/server/loadGuard.test.js`（5/5 过）、远端运维脚本、nginx 分流参考

### 2. 本地未提交文件
工作区仅剩**不应入库**的本地产物：`.edge_data/`、`cloudflared-linux-amd64.deb`（二进制）、`test_ports.py`（临时探测脚本）。

---

## 二、 核心待办开发计划总结 (Development Plan Summary)

详细技术文档已归档在项目内：
- 📄 **[docs/OPTIMIZATION_AND_PR_PLAN.md](file:///E:/Workbox/sp-upgrade-2.1/docs/OPTIMIZATION_AND_PR_PLAN.md)**

### 模块 1：2+2G 硬件性能调优、防崩熔断与操作延迟优化 — ✅ 已实施（A 阶段）
- `server/loadGuard.js` 三档熔断（normal/warning/critical）：算力点数 + 在线数评估；critical 时 hello 拒绝 `ERR.BUSY`（重连 token 恒放行）、观战禁入，绝不影响进行中对局；
- 广播节流分档：COMBAT 100ms / 其余 200ms 合帧下发；指令快速通道 `deferFlush` 即时透传玩家操作；
- PM2：`--max-old-space-size=1300`、`max_memory_restart: '1600M'`（比计划的 1750 保守，2G 机器给系统留余量）；
- 警告不再阻塞弹窗：ServerLoadBadge 右上角常驻胶囊 + 状态首次变化 toast。

### 模块 2：进入者自动全量预载 — ✅ 已实施（B 阶段）
- `preloadModal.js` 两阶段档案：Core 完成即可玩，Full 后台补齐（`autoChain`）；战斗期下载并发降为 1；
- 实测体积文案：Core ~93MB / 2050 文件，Full ~428MB / 4255 文件；
- 大厅 PreloadPill 预载胶囊；hello `client.bundle` 四档上报，`web_full` 享受最高准入权重。

### 模块 3：游戏内 6 项关键 UI 与交互问题修复 — ✅ 已实施（C1–C6）
1. 聊天气泡：`.team__bubble` max-width 4.6rem + 换行收敛（game.css 旧 `.ebubble` 已删，emotes.css 尺寸 `!important`）；
2. 战术聊天框：PC 4.8rem / 手机 `min(56vw,4rem)` + safe-area；`chat-log` 始终可滚；键盘弹起面板抬升；`clearChatMessages()` 在 backToLobby / 被踢出同盟时清空；
3. 商店栏：手机端弹性卡片 `clamp(1.4rem,13vw,1.75rem)`，职业行可换行，PC 端不变；
4. DPR 统一：手机高画质上限 3.0 / 棋盘 2.0，单机与连服共用画质档位管线；
5. FacingWheel 二段式：落子锚定（音效 drop/artPlace）→ 罗盘明确提交（滑动 / 点箭头 / 回车）；死区松手只等待不提交；
6. 高刷：开 120fps 封顶（休整/备战）、关 60fps 锁定；`highRefresh` 随设置持久化（sanitizeSettings）。

### 模块 4：上游 9 个 PR 的吸收评估 — ⏳ 待实施（下一期）
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

## 三、 验证状态（2026-10-09 D 阶段）

- `test/match/*.test.js`：537 测试，534 过，1 失败（`merge.test.js:321`）——**基线既有**（git stash 验证）；
- `test/ui/*.test.js`：512 测试，502 过，4 失败 —— 全部为**基线既有**（dropIntent / equip-replace / loadout-stats 系列，干净树上同样失败）；`sanitizeSettings` 修复后转绿；
- `test/lobby*.test.js` + `matchmaking`：89/89 过；`net-resilience` 5/5（含新增熔断测试）；`lobby-chat` 4/4；`facing` 全过；`devices` 17/17；`client-static` 的 multi-device 块 8/8；
- 基线既有失败（与本次改动无关）：`es2020-syntax`（node_modules 缺 `acorn`）、`docs-consistency` 语音 1 项、`assets` 3 项（missing 资源文件）、`android-blackscreen` 1 项（`chess_char_1_01-inside.js` 含 `??=`）；
- **双端真机实测待做**：手机横屏（键盘弹起 / 商店栏 / 调向二段 / 120fps）与 PC 端回归，部署后经 Cloudflare 链路验证。

## 四、 接续开发执行指引 (Quick Start for Next Engineer)

1. **工作目录**：`cd E:\Workbox\sp-upgrade-2.1`（主工作树，勿在其他分支混淆修改）；
2. **第一优先级任务**：
   - 双端真机实测（D 阶段收尾）：重点手机横屏的聊天键盘、商店栏、FacingWheel 手感与 120fps 发热；
   - 按模块 4 清单逐个吸收上游 9 个 PR（#334 图集分帧优先，对 2+2G 收益最大）；
3. **验证与部署**：
   - 本地跑通：`npm run test`（Windows 下 match 套件用 `node --test "test/match/*.test.js"`，约 215s）；
   - 平滑热更部署至生产主服（`101.37.150.107`），通过 Cloudflare 加速链路做真机验证。

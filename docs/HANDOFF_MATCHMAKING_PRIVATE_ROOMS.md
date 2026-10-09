# 侧对话交接总结：匹配功能 & 私密房间方案（含实景图）

- **生成时间**：2026-10-09
- **工程根目录**：`E:\Workbox\sp-upgrade-2.1`
- **分支**：`feature/v0.2.1-fusion-master`
- **产出性质**：设计方案 + 实景渲染图（**未改任何游戏源码**，仅新增 `docs/` 下文件）
- **上游需求**：设计匹配功能与私密房间（后台可见）、不影响 UI 大改、不增加服务器压力、出实景图

---

## 一、交付物

| 文件 | 内容 |
|---|---|
| `docs/MATCHMAKING_PRIVATE_ROOMS_PLAN.md` | 完整增量方案（现状盘点 / 协议 / 服务端 / UI / 后台 / 负载论证 / 工作量 / 测试计划 / 明确不做） |
| `docs/mockups/render-mockups.mjs` | 实景图渲染脚本（真实服务器 + 真实 Chrome，仅对提案 UI 注入 DOM） |
| `docs/mockups/mock-1-lobby-private-room.png` | 大厅创建框：公开/私密二段开关（1920×1080） |
| `docs/mockups/mock-2-lobby-private-room-phone.png` | 手机横屏 844×390，同一位置（开关落在创建按钮正上方） |
| `docs/mockups/mock-3-matchmaking-modal.png` | 匹配弹窗：「⚡快速匹配」按钮 + 公开房间列表（私密房不出现） |
| `docs/mockups/mock-4-admin-private-rooms.png` | 管理后台：`🔒 私密` 徽标 + 表头「私密 2」计数 |

> 状态：全部**未提交**（`git status` 显示为 `??`）。

### 重新生成实景图

```bash
node docs/mockups/render-mockups.mjs
# 未自动探测到 Chrome 时：CHROME_PATH="C:/Users/.../chrome.exe" node docs/mockups/render-mockups.mjs
```

脚本会启动真实服务器（`node server/index.js`，随机端口）→ 真实 Chrome → 真实登录/大厅/弹窗流程，只对
「尚未实现的提案 UI」注入 DOM，其余全部真实渲染；结束时打印自检报告（元素几何 / 徽标数 / PNG 尺寸）。

---

## 二、关键代码发现（本方案的核心依据）

### 匹配功能：**已完整存在，无需开发**

| 能力 | 位置 |
|---|---|
| 撮合引擎：按 (mode,difficulty) 分桶、优先把散人填进正在匹配的房间、coop 凑 4 人成团、solo 1 人直接发车、**10s 超时 AI 补齐** | `server/matchmaking.js`（tick 1s，已 `unref()`；`MATCHMAKING_DEFAULTS.timeoutMs = 10_000`） |
| 协议 | `shared/protocol.js:328` `match.queue {mode,difficulty,fillBots?}` / `match.cancel` |
| 大厅路由 | `server/lobby.js:362-363` |
| 排队进度推送 | `match.status`（searching/elapsed/matched/target）+ `match.found` |
| 搜索中 HUD（进度 + 取消） | `public/js/screens/lobby.js:576` |
| 房间浏览弹窗（4s 自动刷新、加入/观战） | `public/js/screens/lobby.js:239` |
| 房内「匹配队友」（补人） | `public/js/screens/room.js:333` → 已正常接线 |

**唯一缺口**：大厅的 `queueMatch()`（`public/js/screens/lobby.js:455`）**已写好但没有任何按钮调用它**
（全局搜索 `queueMatch` 确认）→ 补 1 个按钮即可，**服务端 0 改动**。

### 私密房间：**完全不存在**

- `Room` 无 `private` 字段（`server/lobby.js:155`）
- `getLobbyStats()` 把**所有** coop 房间都放进公开列表（`server/lobby.js:558`）→ 大厅列表与匹配弹窗都能看到
- 后台 `getRooms()`（`server/admin.js:164`）能看到全部房间，但**无法区分**公开/私密

---

## 三、方案要点

### 方案 A：快速匹配入口（匹配功能补齐）

- 匹配弹窗 `mm-modal` 在统计条下方加通栏主按钮「⚡ 快速匹配 · 系统自动凑齐同盟」→ 调用既有 `queueMatch()`；
  入队后关弹窗，大厅 `matchmaking-hud` 显示进度（已有）、可取消（已有）
- 行为（引擎既有语义）：按当前模式/难度入队；`coop` 凑 4 人成团、10 秒凑不齐由 AI 补齐出发；`solo` 立即发车
- 改动量：`lobby.js` +8 行；**0 服务端**；0 新样式（复用 `.btn--primary/.btn--lg`）

### 方案 B：私密房间

- **语义**：不出现在公开房间列表（大厅列表 / 匹配弹窗都看不到）；仅凭 6 位同盟密钥 / 邀请链接 / 安卓局域网发现加入
- **协议（+1 行）**：`room.create` 增加 `$optional: ['private']`（`isBool`），老客户端不带 = 公开，无破坏
- **服务端（+6 行，纯减法）**：`Room.private` 字段 + `create()` 写入 + `getLobbyStats()` 加 `if (r.private) continue;`
  → 私密房不进每 4s 大厅广播；`room.join`/`room.spectate`/撮合器**均不改**（密钥即凭证）
- **客户端 UI（2 处小改，不引入新视觉语言）**：
  1. 大厅创建框上方二段开关（复用设置面板 `.set-seg`）`公开同盟 | 🔒 私密同盟`，选择记忆 `localStorage`
  2. 房间画面密钥旁加 `🔒 私密` 小徽标
- **后台可见（3 处小改）**：`getRooms()` 返回 `private`；`renderRooms()` 房间号列后置 `🔒 私密` 徽标
  （新增 `.adm-badge--purple`，+1 行 CSS）；房间段落标题加「私密 N」计数

### 服务器压力论证（2+2G 约束）

| 项 | 影响 |
|---|---|
| 快速匹配 | 复用现有 Matchmaker（1s tick 已 `unref()`，队列空时 O(1) 空转）；`match.status` 只发排队者本人，无 fan-out |
| 私密房间 | `getLobbyStats()` 逐房间 `continue` → 每 4s 广播 payload **只减不增** |
| 撮合池 | 仅房主显式点击「匹配队友」才入池（现状逻辑）；私密房默认零成本 |
| 管理后台 | `getRooms()` 只读内存，后台轮询时才执行 |

**合计：零新增定时器、零新增广播、零新增连接。**

### 工作量

| 文件 | 改动 | 行数 |
|---|---|---|
| `shared/protocol.js` | `room.create` 可选 `private` | +1 |
| `server/lobby.js` | `Room.private` / `create()` / `getLobbyStats()` 过滤 | +6 |
| `server/admin.js` | `getRooms()` 带 `private` | +1 |
| `public/js/screens/lobby.js` | 快速匹配按钮（+8）、私密开关（+15） | +23 |
| `public/js/screens/room.js` + `room.css` | 私密徽标 | +10 |
| `public/admin/admin.js` + `admin.css` | 徽标 + 计数 | +6 |
| `test/` | 私密过滤单测 + 快速匹配入口 | +40 |

合计 ≈ **90 行**（不含测试）。

### 明确不做（避免范围膨胀）

- 不做密码/PIN 二级凭证（密钥已足够，多一层输入 = 更多 UI 与协议面）
- 不做「隐藏但可被撮合」的中间态（语义混乱，且撮合器要改）
- 不动撮合器策略与超时参数（10s/AI 补齐已线上验证）
- 不做玩家侧的公开/私密筛选器（私密房根本不下发，无意义）

---

## 四、验证情况

脚本自检全部通过（程序化，非肉眼）：

- `mock-1` 私密开关：`778×40`，`visibility:visible`、`opacity:1`、在视口内
- `mock-2`（手机 844×390）开关：`283×32` @ y=287；创建按钮 @ y=324，均在视口内
- `mock-3` 快速匹配按钮 `814×64` + 房间列表可见（含 3 个样例房间）
- `mock-4` 私密徽标数 = 2、表头「私密 2」
- PNG：1920×1080 / 844×390 / 1920×1080 / 1600×1200，体积 2.2MB / 445KB / 330KB / 188KB

> **注意**：生成时的模型无法查看图像内容，以上为几何与内容量自检；**图的观感需人工过目**
> （尤其手机图的开关与创建按钮间距）。

**顺手发现的真实坑**：Preact 每 ~4 秒因大厅广播重渲染，会冲掉手工 DOM 注入的节点
（首次渲染图 2 时开关为 `null`）→ **正式实现私密开关必须走 Preact 状态，不能靠 DOM 注入**。

---

## 五、主对话当前状态观察（并行工作，非本侧对话产生）

- HEAD 已从 `6b989ed9` 前进到 **`83d6a233 feat(render): 热防护钩子接通——渲染过热自动降分辨率甩像素`**
- `package.json` 已加 `acorn ^8.19.0` → **低成本档①（es2020 缺依赖）已处理**
- `server/sim/content/kits/ops/chess_char_1_01-inside.js` 已无 `??=`/`||=` → **低成本档②已处理**
- 新增 `server/sim/content/kits/registry.js`（16KB）+ `tools/build-kits-registry.mjs`（5KB），
  并改动 20+ 个 sim kits、`shared/packs.js`、`data/assets.json` → **kits 注册表重构进行中**

---

## 六、给主对话的提醒

1. 本侧对话的 `docs/` 产物与上述 kits 重构**无关**，建议单独一个 docs commit，别混进重构提交
2. 上一轮遗留未完成事项：
   - **origin 推送 + 生产部署**（`101.37.150.107`，PM2 进程 `stronghold`，目录 `/opt/stronghold`）
   - 基线红测按三档修：assets 三连、docs-consistency 语音、equip-replace/dropIntent 逻辑、
     `merge.test.js:321` 的 temp/hand 不变量
3. 本侧对话**未修改任何游戏源码**，只新增了 `docs/` 下的方案与图

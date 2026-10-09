# 匹配功能 & 私密房间 · 增量设计方案（0.2.1-fusion）

> 约束：① UI 不做大改（复用现有组件与样式）；② 不增加服务器侧压力；③ 私密房间在管理后台可见。
> 实景渲染图（真实服务器 + 真实前端，注入部分为提案 UI）：`docs/mockups/mock-1..4-*.png`

---

## 0. 结论先行

- **匹配：服务端撮合引擎已经完整存在，无需开发。** 唯一的缺口是一个接线问题——大厅的快速匹配 handler
  `queueMatch()`（`public/js/screens/lobby.js:455`）**已经写好，但没有任何按钮调用它**（全局搜索确认）。
  房内「匹配队友」（`public/js/screens/room.js:333`）倒是正常接线的。所以「匹配功能」的增量 = 一个按钮。
- **私密房间：全新，但增量极小**：1 个可选协议字段 + 服务端 6 行过滤 + 2 处小 UI + 后台 1 个徽标。
- **服务器成本：净下降**。私密房间不进每 4 秒的大厅广播列表（payload 只减不增）；快速匹配复用已有的
  1s tick 撮合器（队列为空时 tick 是 O(1) 空转，且 timer 已 `unref()`）；全程**零新增定时器、零新增广播、零新增连接**。

---

## 1. 现状盘点（代码证据）

### 匹配（已存在，可直接用）

| 能力 | 位置 |
|---|---|
| 排队撮合引擎：按 (mode, difficulty) 分桶、优先把散人填进正在匹配的房间、coop 凑 4 人成团、solo 1 人直接发车、10s 超时 AI 补齐 | `server/matchmaking.js`（tick 1s，`unref()`；`MATCHMAKING_DEFAULTS.timeoutMs=10_000`） |
| 协议 | `shared/protocol.js:328` `match.queue {mode,difficulty,fillBots?}` / `match.cancel` |
| 大厅路由 | `server/lobby.js:362-363` |
| 排队进度推送 | `match.status`（searching/elapsed/matched/target）+ `match.found`（`matchmaking.js:sendStatus/formRoom`） |
| 搜索中 HUD（进度 + 取消） | `public/js/screens/lobby.js:576` `matchmaking-hud` |
| 大厅快速匹配 handler | `public/js/screens/lobby.js:455` —— **无按钮调用（唯一缺口）** |
| 房内「匹配队友」（补人）+ 超时 AI 发车 | `public/js/screens/room.js:333` → `match.queue`（正常接线） |
| 房间浏览弹窗（4s 自动刷新、加入/观战） | `public/js/screens/lobby.js:239` `MatchmakingModal` |

### 私密房间（不存在）

- `Room` 无 `private` 字段（`server/lobby.js:155`）。
- `getLobbyStats()` 把**所有** coop 房间放进公开列表（`server/lobby.js:558`）——大厅列表与匹配弹窗都能看到。
- 后台 `getRooms()`（`server/admin.js:164`）能看到全部房间，但**无法区分**公开/私密。

---

## 2. 方案 A：快速匹配入口（匹配功能补齐）

**服务端零改动**，只接线 + 一个按钮：

- 匹配弹窗 `mm-modal` 在统计条下方加一个通栏主按钮「⚡ 快速匹配 · 系统自动凑齐同盟」
  → 调用已存在的 `queueMatch()`；入队后关闭弹窗，大厅 `matchmaking-hud` 自动显示进度（已有），可取消（已有）。
- 行为（引擎既有语义，无需新逻辑）：按当前「模拟方式/难度」入队；`coop` 凑 4 人成团、**10 秒内凑不齐由 AI 队友补齐出发**；
  `solo` 立即发车。
- 改动量：`public/js/screens/lobby.js` +8 行；0 服务端；0 新样式（复用 `.btn--primary/.btn--lg`）。
- 可选（不建议同时做）：大厅「匹配在线博士」面板再加一个次级按钮直连快速匹配（1 个按钮，仍复用现有样式）。

---

## 3. 方案 B：私密房间

### 3.1 语义

- **私密同盟**：不出现在公开房间列表（大厅列表 / 匹配弹窗**都看不到**）；仅凭 6 位同盟密钥 / 邀请链接 /
  安卓局域网发现加入；观战同样要密钥。
- 房主仍可点「匹配队友」把队伍送进撮合池（被动等待，不点不消耗）；也可加 AI、照常开始。

### 3.2 协议（+1 行）

`shared/protocol.js` `room.create` 增加 `$optional: ['private']`，validator `isBool`。
老客户端不带 = 公开（默认），无破坏。

### 3.3 服务端（~6 行，纯减法）

- `Room` 增 `private` 字段；`create()` 写入（`server/lobby.js:494`）。
- `getLobbyStats()` 循环加 `if (r.private) continue;`（`server/lobby.js:558`）→ 私密房不进每 4s 大厅广播。
- `room.join` / `room.spectate` / 匹配器**均不改**（密钥即凭证；已有最近房间 / 邀请链接 / 局域网发现）。
- 负载：公开列表 payload 变小；撮合器与私密房无关；无新增定时器/广播/连接。

### 3.4 客户端 UI（2 处小改，不引入新视觉语言）

1. **大厅创建框上方**：一个二段开关（复用设置面板 `.set-seg` 样式）`公开同盟 | 🔒 私密同盟`，
   选择记忆 `localStorage`（`loadPref/savePref` 已有）；hint 文案随选择切换。
2. **房间画面**：密钥旁加 `🔒 私密` 小徽标（一处 span），提示「仅凭密钥加入」。

大厅列表、匹配弹窗：**零改动**（私密房不下发，天然不可见）。

### 3.5 后台可见（3 处小改）

- `server/admin.js getRooms()` 返回 `private: !!r.private`（+1 行）。
- `public/admin/admin.js renderRooms()` 房间号列后置 `🔒 私密` 徽标（新增 `.adm-badge--purple`，admin.css +1 行）。
- 房间段落标题加「私密 N」计数；密钥照常显示（房主丢了密钥可从后台找回）。
- 后台是独立页面，与游戏 UI 无关，不算「UI 大改」。

---

## 4. 服务器压力论证（2+2G 约束）

| 项 | 影响 |
|---|---|
| 快速匹配（方案 A） | 复用现有 Matchmaker：1s tick 已 `unref()`；队列空时该 tick 顺序执行 O(1) 判空返回；无新增连接/广播。入队后每 tick 仅向**排队者本人**发 `match.status`（无 fan-out）。 |
| 私密房间（方案 B） | `getLobbyStats()` 逐房间 `continue`——每 4s 的 `lobby.stats` 广播 payload **只减不增**；`room.join/spectate` 路径不变。 |
| 撮合池 | 仅房主显式点击「匹配队友」才入池（现状逻辑）；私密房默认零成本。 |
| 管理后台 | `getRooms()` 只读内存，在后台轮询时才执行，无新增。 |

**合计：零新增定时器、零新增广播、零新增连接。**

---

## 5. 工作量与文件清单

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

---

## 6. 验证与测试计划

- 单测：私密房不进 `lobby.stats`；凭密钥 join 依旧可进；`/api/admin/rooms` payload 带 `private`；
  `match.queue`（散人）在测试 harness 里能走通 10s AI 补齐。
- e2e（`SP_E2E=1`）：A 客户端创建私密房 → B 客户端大厅/弹窗列表**看不到** → 输密钥可加入 → 后台表出现 `🔒 私密`。
- 手测：手机横屏——开关可点、房内徽标不挤压密钥行。

## 7. 明确不做（避免范围膨胀）

- 不做密码/PIN 二级凭证（密钥已足够；多一层输入 = 更多 UI 与协议面）。
- 不做「隐藏但可被撮合」的中间态（语义混乱，且撮合器要改）。
- 不动匹配器策略与超时参数（10s/AI 补齐已线上验证）。
- 不做房间列表的公开/私密筛选器（玩家侧无意义——私密房根本不下发）。

---

## 附：实景渲染图

| 图 | 内容 |
|---|---|
| `docs/mockups/mock-1-lobby-private-room.png` | 大厅创建框：新增二段开关（复用了设置面板同款样式） |
| `docs/mockups/mock-2-lobby-private-room-phone.png` | 手机横屏（844×390）同一位置，证明不破坏小屏布局 |
| `docs/mockups/mock-3-matchmaking-modal.png` | 匹配弹窗：新增「快速匹配」按钮 + 公开房间列表（私密房不出现在此处） |
| `docs/mockups/mock-4-admin-private-rooms.png` | 管理后台：房间表新增 `🔒 私密` 徽标与「私密 N」计数 |

> 图由 `docs/mockups/render-mockups.mjs` 生成：启动真实服务器 + 真实 Chrome，走真实登录/大厅流程，
> 仅对「尚未实现的提案 UI」注入 DOM（开关、按钮、后台徽标），其余全部是真实渲染。

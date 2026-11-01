# 卫戍协议：盟约 · 拓展模式（玩法包大厅）设计规格书
> 新人接手先读 [`docs/EXTENSION_MODE_ONBOARDING.md`](EXTENSION_MODE_ONBOARDING.md)：文件地图、池子判据（官方 112 / 炸惊 99 / 湮灭 125）、坑清单与可勾选 checklist；本文是规格书，二者冲突时以代码为准。

本文整理「拓展模式（Extension Mode）」的定位、玩法包（play set）的状态机、选择拓展玩法大厅的版式与接线规则，作为 `public/js/screens/extensionModes.js` 与 `public/js/screens/lobby.js` 的参考文档；§3 同时记录从大厅到房内、局内的接线（`room.js` / `game.js`）。代码注释里的 `docs/EXTENSION_MODE.md §2`、`§3` 指的就是本文的这两节。

仓库规则是 **docs follow the code**：本文描述当前代码的行为；当本文与代码冲突时以代码为准，并回来改本文。源码与官方资料都没有定论的细节，一律标 `[ASSUMED]`。

---

## 1. 模式定位与入口 (Position and entry)

### 1.1 它是什么、不是什么

拓展模式是业主 2026-10-26 的决定（`public/js/screens/extensionModes.js` 头注释）：大厅的第三个入口，点开是「选择拓展玩法」大厅。

* **它是**玩法包（play set）的目录：服务器可以携带的额外玩法，**与官方四档难度并列**，而不是叠在某一档上。
* **它不是官方难度**：不进 `shared/constants.js` 的 `DIFFICULTIES`，也不出现在「选择模拟协议」（独立模拟）或「选择同盟方式」（同盟模拟）的难度列表里。
* **它不是房间模式**：不新增 `shared/versions.js` 的 `roomModes` 字符串——那里仍然只有 `solo` / `coop`（交接文档 §6.4 记了钉死它的测试）。
* **它不自己建房**：点第三张卡只打开大厅；大厅的「开始」只把选中的玩法包连同蚀流档位与「单人 / 同盟」形态交给大厅现有的建房通道 `createAnnihilation`（§3），自己不发 `room.create`。

大厅自己把这条边界写在两处文案里：

* 选项列引导语：「选择一个拓展玩法；它们不改动官方四档难度，玩法、难度与内容各自独立。」
* 页脚注：「拓展玩法由玩法包自己决定规则与数值，独立于官方四档难度。」

### 1.2 大厅第三张卡

`public/js/screens/lobby.js` 的 `MODE_CARDS` 里的 `ext` 条目（前两张仍是 `solo` / `coop`）：

| 字段 | 值（源码原文） | 说明 |
|---|---|---|
| `id` | `'ext'` | 选中值；也是 `openMode` 的分支键 |
| `name` | `N_('拓展模式')` | 卡名 |
| `en` | `'EXTENSION MODE'` | 英文小标（**不是** msgid） |
| `icon` | `'expand'` | 与大厅的展开语义一致 |
| `desc` | `N_('在官方模拟之外尝试额外的玩法与规则。')` | 卡面描述 |
| `points[0]` | `N_('{n} 个玩法 · 不计入官方战绩')`，`pointParams.n = extensionModeCount()` | 卡面上方那一行；今天 `n = 1` |
| `pointShort` | `N_('{n} 个玩法')` | 矮屏用短句（DESIGN §35.51 的 `pointShort`） |

点卡片走 `openMode`，**必须显式三分**：`solo → setSoloOpen`、`ext → setExtOpen`、`else → setAllyOpen`。落进 `else` 会把拓展模式弹成「选择同盟方式」（`lobby.js` 的注释；`b/report.md` §9.1 记了这个坑）。

> 「不计入官方战绩」今天是**卡面文案**：主仓还没有任何战绩/统计代码实现这条隔离（湮灭模拟已经能开局，它的对局与官方四档难度的对局一样会进统计）。它的含义（不进官方战绩与通关统计）与将来实现的位置 `[ASSUMED]`。

### 1.3 一张表，四个派生函数

`EXTENSION_MODES` 是 `Object.freeze` 的数组；大厅只画表里的东西（1 → N），没有写死的条目数量或索引。

| 导出 | 语义 |
|---|---|
| `EXTENSION_MODES` | 玩法包表：`id / name / en / code / color / icon / desc / features[] / stats[] / pack / status / reason? / difficulty / forms? / erosionTiers? / theme? / guide?` |
| `extensionModeById(id)` | 条目，或 `null` |
| `extensionModePlayable(id)` | 该条目的 `status === 'ready'`（「开始」是否可用） |
| `extensionModeCount()` | 大厅**列出**的条数（`status !== 'missing'`）——大厅第三张卡那行说的就是它（今天 `1`：湮灭模拟；`0 个玩法` 不会出现） |
| `defaultExtensionPick()` | 第一个 `status !== 'missing'` 的 `id`，否则第一条（`modes` 参数可传别的表） |

大厅解析当前展示哪一条时是 `modes.find(id === selected) || modes.find(id === defaultExtensionPick(modes))`：`selected` 是空值或过期 id 时回落到默认条目，不会白屏。`modes` 是 `ExtensionHall` 的 prop，缺省 `EXTENSION_MODES`；它是为了让表里今天到不了的状态可测（一条 `pending`、全 `missing` 的空状态、不同长度的目录），接服务器目录时也从这里换。

---

## 2. 湮灭模拟已可开局：状态机与三态 (One play set is ready)

`extensionModes.js` 的 `status` 注释把读者指到本节。**2026-10-27 起，第一条（湮灭模拟）是 `ready`**：引擎、藏品三选一界面、房内改档、局内角标与「单人 / 同盟」两种建房形态都已接线，并在真机上走通（§3.2），大厅的「开始」会真的开出一间湮灭房。

历史：2026-10-26 那版里它还是 `pending`，`reason` 写着「服务端已就绪，客户端界面待接线」——当时**服务端已经在树里**（§3.1），缺的是客户端接线（§3.2）。诚实原则没变：宁可写「还差一半」，也不给一个会把玩家带进死路的「开始」（藏品三选一在服务端会拦住「准备就绪」，没有对应界面就永远选不了）。现在两半都到齐，`reason` 随 `status` 一起退场。

### 2.1 三条条目与它们今天的行为

| `id` | 名称 | 代号 | `status` | 今天的行为 |
|---|---|---|---|---|
| `annihilation` | 湮灭模拟（ANNIHILATION） | `AC-5` | `ready` | 列出、可选中看档案；可选 1–6 级蚀流与「单人 / 同盟」；「开始」可用（还要求在线、且不在建房中），按下即发 `room.create { mode: 'solo'\|'coop', difficulty: 'ANNIHILATION', erosion: 1..6 }`（§3.3） |
| `zhajing` | 炸惊模拟（BLAST SIMULATION） | `AC-8` | `ready` | 列出、可选中看档案；**没有蚀流档位**，只有「单人 / 同盟」；「开始」按下即发 `room.create { mode, difficulty: 'ZHAJING' }`（**不带 `erosion`**）；局内多一层惊变系统（§8） |
| `endless-fire` | 无尽火力（ENDLESS FIRE） | `AC-6` | `missing` | 虚线占位行、`disabled`、不可选；玩法包写「筹备中」 |
| `deep-dive` | 深潜协议（DEEP DIVE） | `AC-7` | `missing` | 同上 |

两条 `missing` 是占位条目，只为验证「1 → N 的等距排布」（它们自己的 `features` 就这么写）；参考页把「筹备中」的两条留成了占位（交接文档 §4「已知取舍」）。今天**没有 `pending` 条目**：三条里两条 `ready`、两条 `missing`。

### 2.2 三个状态词

| `status` | 芯片文案 | 行的样子 | 「开始」 | 档案底部提示 |
|---|---|---|---|---|
| `ready` | 可开局（`chip--ready`） | 普通行 | 可用（还要求在线、且不在建房中） | 「玩法包已就位，可以直接开局。」（`.ext-note.is-ready`，`check` 图标） |
| `pending` | 待接入（`chip--pending`） | 普通行，可点选 | 禁用 | 条目的 `reason` |
| `missing` | 筹备中（`chip--missing`） | 虚线 + `.is-placeholder` + 原生 `disabled` | 禁用 | 条目的 `reason`（缺省回落到「玩法包尚未接入本机」） |

`pending` 仍是合法状态：条目列出、可以看档案、能选档位，只是「开始」暗着等引擎；**今天没有条目用它**（湮灭模拟已 `ready`，两条占位是 `missing`）。它由大厅的 `modes` prop 注入假表来覆盖渲染与「开始」的禁用路径（§1.3 的 `modes` prop 与 `test/ui/extension-modes.test.js`）。

### 2.3 「开始」按钮与空状态

* 禁用条件是 `!playable || busy === 'create' || !online`；`title` 在不可用时是 `mode.reason || 状态词`，可用时是 `开始 {name}`。按钮文案：可开局时 `开始 {名称}`，否则就是状态词本身（`可开局 / 待接入 / 筹备中`）。
* `onPick` 只在 `playable` 时才被调用。湮灭模拟现在就是 `ready`，所以按下「开始」会带着 `(id, erosion, party)` 走 §3.3 的 `createAnnihilation`，直接建房。
* 蚀流 chips：条目声明 `erosionTiers` 时，页脚出现 1–6 的档位按钮（`data-testid="extension-tiers"`，`aria-label` 为「蚀流 N」，第 6 档 `title` 是「无尽湮灭」）。档位是大厅的状态（`extErosion`），不是条目的，切换到没有档位的条目时它被忽略而不是被重置。
* 单人 / 同盟 chips：**由条目声明 `forms: ['solo','coop']` 决定**（`erosionTiers` 也会隐含这两枚，湮灭就靠它）；两枚都带 `data-testid="extension-party"`、`data-party="solo|coop"` 与 `aria-pressed`，容器是 `role="group"`、`aria-label` 由两条既有词条拼成。形态也是大厅的状态（`extParty`，缺省 `solo`），切换条目不会重置；它随 `onPick` 的第三参交给建房通道，决定 `room.create.mode`（§3.3）。**没有档位的玩法包（炸惊）只有 `forms`，`erosion` 缺省 1 且不发这个键。**
* 空状态：当 `EXTENSION_MODES` **每一条都是 `missing`** 时，列表让位给空状态（`还没有可玩的拓展玩法` / `安装一个玩法包后，它会出现在这里。`，`data-testid="extension-empty"`）。今天不触发（`annihilation` 是 `ready`，另两条是 `missing`）。参考页的「切换空状态」在真实代码里改由数据到达，没有演示开关。
* 默认选中的是 `defaultExtensionPick()`，今天即 `annihilation`，所以打开大厅时左档案是湮灭模拟。

### 2.4 结论：目录 + 一个能开局的玩法包

能看、能选、能开局（湮灭模拟）。大厅第三张卡那行写的是 `1 个玩法 · 不计入官方战绩`——数的是**列出**的条数，不是 `ready` 的条数：卡面是目录招牌，若写成 `0 个玩法`，而点进去大厅里明明有一条，那就是骗人。能不能开局是每条自己的事（芯片 + 档案底部那句提示）。

---

## 3. 引擎与客户端都已落地（2026-10-27）：从 ready 到可玩 (The engine is in)

`extensionModes.js` 的 `ExtensionHall` 注释把「引擎落地之后」指到本节。

### 3.1 已经在树里的服务端

| 层 | 落点 | 证据 |
|---|---|---|
| 数据 | `data/config.json` 的两个 mode、`bans.ANNIHILATION`、`hiddenCore.difficulties`、`rewards.difficultyFactor`；`data/bosses.json` 的 `bloodPoint.ANNIHILATION`；`data/relics.json` | 由 `tools/build-data.mjs` 从 `docs/research/15-annihilation-mode.json` / `16-annihilation-relics.json` 生成（**不手改 `data/`**） |
| 玩法包自己的模块 | `shared/annihilation-constants.js`、`server/match/relics.js`、`server/sim/content/{relics,hazard}.js`、`public/js/ui/{relics,annihilationIntro,annihilationBackdrop}.js`、`public/css/screens/relics.css` | 以一个版本为底板移植（mod v3.1.0），此后**按 mod 的后续版本逐条对齐**，不是逐字节拷贝：AI 投票的 `Math.random()` 换成 `createRng(deriveSeed(m.seed, …))`（确定性铁律）、v3.2.0 的 8 条藏品 bug 与触发点（`bountyDone`、p43/p44）、n09 悬赏资金减半、n19 晕眩重做（§3.7）。改这些文件时按 mod 原包对照语义，但**写成这个仓的风格** |
| 内容域注册 | `server/sim/content/index.js` 的 `DOMAIN_NAMES` 加了 `'hazard','relics'` | 少了这一行，毒雾与藏品**全哑且不报错**（§3.4） |
| 蚀流五环 | `shared/protocol.js`（`room.create.erosion` / `room.setErosion` + `g.relic*`）→ `server/lobby.js`（`Room.erosion` / `room.state.erosion` / `setErosion()` / `handleMessage` 的 `case`）→ `server/match/Match.js` → `server/match/gamedata.js` | `test/match/annihilation-mode.test.js` |
| 引擎本体 | `server/match/gamedata.js`（+380 行：`gd.erosion` / `gd.endless` / `gd.annihilation` / `annihilationFlags()` / 回合家族 / `roundCfg` 循环 / `generation` / `bans` / `bossWeights` / `equipPerChess`） | `test/match/annihilation-erosion.test.js`（14 个用例，按交接文档 §2.6 的阶梯表逐档断言） |
| 无尽局结算 | `server/match/results.js`：`gd.endless` 时「通过回合」按 `m.round` 算，不再被第一章的 `gd.bossRound`（14）封顶；非无尽档（含超限）照旧封顶 | `test/match/annihilation-mode.test.js`（无尽局结算一条） |
| 藏品钩子的触发点 | `server/match/match/settle.js` 的 `onBattleResult` 载荷带 `bountyDone`（0/1：本场击杀了悬赏目标或有悬赏资金入账），计数器在 `server/sim/content/relics.js` 的全局 handler 里加（p34 铿金征鼓 / p39 仇名录 / 乌萨斯那条 rule）；`server/match/player/items.js` 在一次性装备**真的消耗掉**之后调 `relicConsumableRefund`（p43 复得之轮，每回合 ≤3 次）与 `relicConsumableFree`（p44 果腹，返还商店价） | `test/match/annihilation-mode.test.js` 的「藏品计数器与一次性装备」5 条 |
| 12 个钩子 | `match/{phases,combat,bossRounds,intents,unitePhase,views,settle,prep}.js`、`player/{prep,round,economy}.js`、`sim/{targeting,content/devices}.js`、`effectsMeta.js`、`sim/ai.js` | 每个都以 `gd.annihilation` 为门；`GOLDEN_FULL=1` 仍 288 场景零位移 |

**四条硬验收**（断链时都会静默通过，所以必须断言）：

1. `m.publicView().erosion` 等于房主选的档位（1–6），`endless` 只在 6 为真——`test/match/annihilation-mode.test.js` 逐档断言；
2. `new GameData(data, 'mode_single_normal')` 的 `erosion` 恒为 1、`lastRound` 仍是 14，且普通局的 `m.publicView()` 不长出 `erosion` / `endless` 键；
3. 无尽局（`gd.endless`）的结算里「通过回合」按实际回合算、不被 14 封顶；非无尽档仍以 `bossRound` 为终点封顶（`test/match/annihilation-mode.test.js` 的结算一条）；
4. 藏品计数器与一次性装备**有触发点**：`settle` 的 `onBattleResult` 载荷带 `bountyDone`，`items.js` 在装备真的消耗后才调 p43 / p44——钩子写对了但没人调时是静默空转，所以逐条断言（同一测试文件）。

### 3.2 客户端接线：已完成（2026-10-27 真机验收）

**服务端一行都不用再改；客户端四块也都接上了**（大厅入口 → 房 → 开局 → 简报 → 策略草稿 → R1 三选一 → 准备就绪 → 局内角标，整条路真机点通）：

1. **藏品三选一**：`public/js/screens/game.js` 已 import `public/js/ui/relics.js` 的 `RelicOverlay` / `RelicCodex` / `RelicCodexButton` / `PositiveSlotOverlay` / `normalizeRelicDraft`。draft 打开时渲染三选一（`onPick` → `gameActions.relic(idx)` → `g.relic { idx }`；同盟房由创建者「开始抽取」→ `g.relic { start: true }`，再由全队投票）；增益藏品老虎机的「收下」→ `g.relicSeen {}`，两条消息服务端都有 `case`。增益老虎机与藏品图鉴一并接上。真机（蚀流 4）：PREP R1 先出增益藏品老虎机（收下）→ 紧接着负面藏品三选一 → 选一张后浮层关闭、`canReady` 转真、「准备就绪」可点（点下去真的进 COMBAT，前置是「剩余资金」确认框）。**草稿还开着时点「准备就绪」，提示是「请先完成藏品选择」**（`shopBlockReason('ready')` 读 `priv.relics.draft`，与服务端 `setReady` 的拒绝理由一致）。
2. **房内改档**：`public/js/screens/room.js` 的 `rs-erosion-chips`（`data-testid="room-erosion"`，1–6，第 6 档显示 `∞`）在难度是 `ANNIHILATION` 时出现，发 `room.setErosion`；只有房主、且不在忙碌时可点（服务端 `setErosion` 也会拒绝非房主或已开局的房间）。大厅侧的选择器见 §2.3。
3. **局内显示**：`public/js/screens/game.js` 的 `.gm__erosion` 角标（蚀流 4 显示「蚀流 4」；6 显示「无尽湮灭 ∞」并带 `is-endless`）；简报的回合数按档位覆盖（1–4 → 19、5 → 30、6 → `∞`）；无尽局 `m.publicView().lastRound` 是 `null`，结算页据此不写 `/N`（`public/js/ui/gameLogic/result.js`），整页文本不出现 `undefined` / `NaN`。
4. **建房形态**：「单人 / 同盟」两枚 chip 与 `createAnnihilation` 的第三参（§3.3）。

验收脚本：`devtools/render-check-annihilation-room.mjs`（房内 → 局内，`SP_EROSION=4` / `=6` 两档）与 `devtools/render-check-extension-hall.mjs`（大厅，三档视口 + `SP_PARTY=coop`），均需 danger-full-access（puppeteer 要 spawn Chrome）。

### 3.3 建房通道：`createExtension`（单人 / 同盟）

大厅的「开始」只走 `public/js/screens/lobby.js` 的 `createExtension(id, erosion, party)`（2026-10-28 由 `createAnnihilation` 泛化而来）：玩法包不是房间模式，`room.create` 在普通建房之上只多带该条目**自己的难度**（`entry.difficulty`）与（仅当条目声明了 `erosionTiers` 时）`erosion`；形态决定 `mode`，modeId 由 `shared/constants.js` 的 `modeIdFor()` 从（形态, 难度）推出——**不新增任何 `roomModes` 字符串**（§1.1、§6）。

| 大厅里选的形态 | `room.create`（湮灭） | `modeIdFor()` 推出 |
|---|---|---|
| 单人（缺省） | `{ mode: 'solo', difficulty: 'ANNIHILATION', erosion: 1..6 }` | `mode_single_annihilation` |
| 同盟 | `{ mode: 'coop', difficulty: 'ANNIHILATION', erosion: 1..6 }` | `mode_multi_annihilation` |

| 大厅里选的形态 | `room.create`（炸惊） | `modeIdFor()` 推出 |
|---|---|---|
| 单人（缺省） | `{ mode: 'solo', difficulty: 'ZHAJING' }` | `mode_single_zhajing` |
| 同盟 | `{ mode: 'coop', difficulty: 'ZHAJING' }` | `mode_multi_zhajing` |

两个 mode 在 `data/config.json` 里同名（湮灭模拟 `AC-5` / 炸惊模拟 `AC-8`）：名字不区分形态，形态只体现在 `room.create.mode` 与推出来的 modeId 上。

* 形态与档位都是大厅的状态：`extErosion` / `extParty`（缺省 `'solo'`），经 `ExtensionHall` 的 `erosion` / `onErosion`、`party` / `onParty` 传入，`onPick(id, erosion, party)` 带出（§2.3）。缺省或未知的形态一律回落 `solo`。
* 难度恒为该条目自己的 `difficulty`，两种形态不改变难度；`erosion` **只对声明了 `erosionTiers` 的玩法包发送**（服务端 `Room` 也只在难度是 `ANNIHILATION` 时收它）。
* 服务端：`shared/protocol.js` 的 `room.create.difficulty` 收 `DIFFICULTIES ∪ {ANNIHILATION, ZHAJING}`；`server/lobby.js` 的 `fallbackDifficulty` 对这两个玩法包难度**原样保留**（不降到标准模拟）；`room.setDifficulty` 仍只收官方四档（玩法包房不能在房内切出/切入），`room.setErosion` 在炸惊房返回 `BAD_MSG`。回归锁：`test/match/zhajing-room.test.js`（5 条）。
* `soloUnlimited`（不限时）只在单人形态附带：服务端 `Lobby.create` 只对 `mode === 'solo'` 的房间接受它。
* 真机（2026-10-27，1280×720，`devtools/render-check-extension-hall.mjs`）：页脚选「同盟」→ 开始 → 真的建出 `room.create { mode: 'coop', difficulty: 'ANNIHILATION', erosion: 6 }`；缺省「单人」→ `{ mode: 'solo', … }`（两个 modeId 各一档）。

### 3.4 移植引擎时的两个静默坑

来自交接文档 §3（`a/report.md` 的拆解结论），验收必须覆盖：

1. `server/sim/content/index.js` 的 `DOMAIN_NAMES` 少了 `hazard` / `relics` → 藏品与毒雾**全哑且不报错**；
2. `erosion` 五环链路（`room.create → Room → startMatch → Match → GameData`）任断一环 → **静默降级为蚀流 1**；验收要断言 `m.public.erosion`。

另：玩法包是「全文件覆盖式」安装包（109 新增 / 38 覆盖 / 0 与主仓一致，其中 38 个 overlay 都混着别家 mod），**不能整份覆盖**，也不能跑它的 `install.mjs`（交接文档 §6.1）。

### 3.5 本节不负责什么

本入口只负责「目录 + 选择 + 路由」。**新增一条数据**（§5）与**搬一个引擎**（本节）是两轮工作：条目可以先以 `pending` 列出，引擎晚一轮落地。

### 3.6 主题大厅：选中玩法包之后的二级界面（2026-10-28）

流程从「选完就建房」变成四级：**大厅 → 拓展模式（选择拓展玩法）→ 选中玩法包「进入」→ 主题大厅 → 单人 / 同盟 + 蚀流 → 开始 → 房**。

* **声明方式**：`EXTENSION_MODES` 的条目加 `theme: { art, kicker }` 即拥有主题大厅；没有 `theme` 的条目保持一步建房（`开始` → `onPick`）。今天只有湮灭模拟声明。
* **美术来源**：`theme.art = /assets/annihilation-intro/art/crimson-knight.webp`（原包主视觉「不息恶火」），`theme.kicker = ANNIHILATION // FIELD MANUAL`（原包封面 `slide-01.webp` 的眉题）。版式语汇照封面：左侧赤红竖线、眉题 / 大标题 / `AC-5` / `ANNIHILATION`、右侧发光环（纯 CSS）、压暗后只留右侧轮廓；底图缺失时 `<img>` 自己隐藏，渐变与排版照旧。
* **落点**：`public/js/screens/extensionThemeHall.js`（无状态视图，状态仍在 `lobby.js` 的 `extEntered` / `extErosion` / `extParty`）；`ExtensionHall` 在 `entered` 时把它渲染进**同一个 Modal**，Esc / 返回回列表而不是关屏。
* **测试钩子**：`data-testid="extension-theme"` / `extension-theme-back`；`单人 / 同盟` 与 `蚀流 1–6` 仍用 `extension-party` / `extension-tiers`，`开始` 仍用 `extension-start`（只是从列表页移到了这一屏；列表页的按钮是 `extension-enter`）。
* **词条**：新增 `进入`（四包 2585 → 2586），其余复用 `单人` / `同盟` / `蚀流` / `无尽湮灭` / `开始 {name}` / `返回`。
* **小屏**：`.ext-theme*` 的两档覆盖写在 `lobby.css` **文件末尾**——大厅与协议页的测试按「第一条同查询媒体块」取用，插在前面会让它们读错块。矮屏（≤520 px）里简介与要点让位，但 `攻略说明` 按钮保留（body 收成一行）——它是这一屏唯一的阅读入口，藏掉它等于手机上翻不了手册。

### 3.6.1 攻略说明：玩法包自己的战场手册（2026-10-28）

主题大厅的「攻略说明」按钮翻开该玩法包的 8 页手册（`EXTENSION_MODES[0].guide`，逐字取自原包 `slide-01…08`，16:9 / 1600×900）。

* **一套查看器**：复用官方的 `GuideHost`（`public/js/ui/guide.js`），不另写一份。`openGuide(page, pages)` 的第二参传入**调用方自己的页表**（每页带现成的 `url`），`guideStore.pages` 一非空就整体替换官方 19 页——不查 `data/assets.json`，也不等美术清单（这些图只在磁盘上，不进清单）。`closeGuide()` 同时清掉它，下次「玩法说明」仍是官方的。
* **`guideStage` 的两条路**：官方页走 `urls`（本地 → 下载副本 → 实在没有就退回 tips）；玩法包页只有一个 `url`，加载失败就退回 tips，**不会**留一个空白舞台。
* **内容与本仓的差异**：手册是玩法包 v3.1.0 的原始数值（毒雾 30 秒、禁选 5/7 等），与本仓的 60 秒 / `{5,5}/{4,7}` 不同（§2、交接 §6 的决策记录）。玩家看到的是玩法包原版手册，**不是**本仓的最终数值——`EXTENSION_MODES` 的注释里写着这一点。
* **测试钩子**：按钮 `data-testid="extension-guide"`；打开的仍是官方的 `.guide` 对话框（`.guide__count`、`.guide__dot`、`.guide__ptitle`）。

### 3.7 n19「未尽的生命」的晕眩重做（2026-10-28，对齐 mod v3.2.0）

n19 是负面藏品，`fx.rule` 是 `stunOnDeploy`。**旧实现**在每次 `deploy` 事件上重抽 `count` 个人，于是开局 7 人同批部署会晕 7 人（每个干员各发一次 `deploy`，每次都重抽），后来任何一名干员再部署也会把队友带上。

**现在**（`server/sim/content/relics.js` 的 deploy 钩子，逐条对齐 mod v3.2.0）：

| 情形 | 判定 | 行为 |
|---|---|---|
| 开局批次 | `ctx.initial` | 整个批次只抽**一次**：等 `DEPLOY_PROTECT + 0.05` 秒（部署动画结束）后，按**当前已晕人数**封顶再挑人，`count` 仍按 `1 + 每回合 +1`（上限 4）增长 |
| 战斗中再部署 | `!ctx.initial && !ctx.move` | 只晕**刚上场的这一名**干员 `redeployDur` 秒（缺省 5） |
| 【移动】 | `ctx.move`（`battle/tiles.js` 的 `moveRedeploy`） | 不算再部署，**不触发** |

* `DEPLOY_PROTECT = 1.2` 在 `server/sim/constants.js`。它在本仓**只是延时**，不是部署保护窗口——本仓没有实现部署免疫，mod 也没有；1.2 是 mod 的取值，官方资料没有定论，标 `[ASSUMED]`。
* 「已晕」按 buff 的 `key === 'stun'` 数，不用 `unit.s.flags.stun`：后者还包含冻结 / 沉睡 / 浮空。
* `redeployDur` 由 `server/match/relics.js` 的 `relicModsFor` 透传，`relicStackInfo` 的提示同时说两件事（`开局晕眩 N 人 · 再部署晕眩 5s`）。
* 数据侧：`docs/research/16-annihilation-relics.json` 的 n19 同时改了 `desc` 与 `fx.rule.redeployDur`，`data/relics.json` 由 `tools/build-data.mjs --offline --out <临时目录>` 重生成后取出（**生成器不幂等**：直接写 `data/` 会顺带改短 `data/bonds.json`）。
* 回归锁：`test/content/relic-n19-stun.test.js` 三条（开局只晕 `count` 人 / `count` 随回合增长 / 再部署只晕自己且【移动】不触发）。前两条与第三条的开局用例在旧实现上会红——改这段代码前先跑它。

---

## 4. 大厅版式（选择拓展玩法）

### 4.1 骨架：全屏 Modal，左档案 / 右等距列表

* 全屏 `Modal`（`class="ext"`，`veilClass="proto-veil"`），与「选择模拟协议」「选择同盟方式」同一套 proto 骨架：左上返回键（`chevronLeft` + `rook` 两个图标）、标题「选择拓展玩法」、模式标签「拓展模式 / EXTENSION MODES」。
* **左栏是玩法档案**（`<section aria-label="玩法档案" data-testid="extension-stage">`）：代号、名称、英文名、数值格（`stats`）、简介、要点列表、底部状态提示；强调色取玩法包自己的 `color`（写到 `--x-color`），大厅不借用官方四档难度的颜色。
* **右栏是等距选项列表**（`<section aria-label="拓展玩法">`）：引导语 + 行列表 + 页脚（玩法包名 + 单人/同盟 chips + 蚀流 chips + 开始）。两种 chips 都只在条目声明 `erosionTiers` 时出现（§2.3）。
* 两栏是 **40 % / 60 %**：样式在 `public/css/screens/lobby.css` 的 `.proto-body.ext-body { grid-template-columns: minmax(0, 2fr) minmax(0, 3fr) }`，**所有尺寸都是这两列**（不像 `.proto-body` / `.ally-body` 那样在竖屏里堆成一列）。数值来自参考页（`public/dev/extension-hall-preview.html`：宽屏左栏以 400 px 封顶，≤ 900 px 宽回到 40 %，≤ 520 px 高 38 %），游戏里按 `--t` / `--sp-ui` 等比缩放（交接文档 §4）。

### 4.2 两条硬规则：固定行高 + 一行简介

参考页第二版修的就是这两条（`extensionModes.js` 头注释），数值落在 `public/css/screens/lobby.css`：

| 视口 | 行高 | 列表 `gap` |
|---|---|---|
| 默认 | 88 px `[ASSUMED]` | 10 px |
| ≤ 900 px 宽（且 ≥ 521 px 高） | 64 px | 8 px |
| ≤ 520 px 高 | 56 px | 6 px |

* **行是固定高度**：文案长短不会把下一行推下去，列表始终是一架等距的梯子。
* **行里只放一行简介**：`nowrap` + 省略号截断；行内是「序号（`01`、`02`…）/ 名称 + 代号 / 一行简介 / 状态芯片」。
* **要点进档案**，不进行：`features` 是档案里的列表，不是行里的第二、第三行。
* **矮屏只留行与按钮**：≤ 520 px 高时档案的说明行（`.ext-note`）、列表导语与底部说明让位，否则两列的内容会互相压。
* 88 px 是 `[ASSUMED]`：模块头注释写明它是参考页照本页自己的尺度量的（尺寸跟 `文字大小`（`--t`）走，与其它弹窗一致），官方没有这个数。

### 4.3 行、芯片与可点性

| 行状态 | 类 / 属性 | 可点 |
|---|---|---|
| 选中行 | `.is-selected` + `aria-pressed="true"` | 点它只是重新选中（幂等） |
| `pending` 行 | 普通行 | 可点：只切换左档案 |
| `missing` 行 | `.is-placeholder` + 原生 `disabled` | 不可点、不可选（`onSelect` 不触发） |

行上的测试钩子：`data-ext="<id>"`、`data-testid="extension-row-<id>"`、`data-status="<status>"`；状态芯片的类由 `STATUS[status].cls` 给出（`chip--ready / chip--pending / chip--missing`）。

### 4.4 档案里的内容

* **数值格**是玩法包自己的规则数，不是官方难度数值。湮灭模拟：`1–6` 蚀流、`87` 藏品、`×5.7` 首领血点。`stats` 为空数组时这一排整个不画（两条占位条目就是这样）。
* 「首领血点 ×5.7」的语义来自玩法包自己的字段（`bloodPointAbyss`），主仓只展示不解释；把它读成「首领血量倍率」是 `[ASSUMED]`。
* **状态提示条**（`data-testid="extension-note"`）：不可开局显示 `reason`，可开局显示「玩法包已就位，可以直接开局。」。
* 档案里的 `desc` 是完整简介；行里那一行是它被 `nowrap` 截断后的样子——所以简介要写短。

### 4.5 无障碍、焦点与测试钩子

* 复用项目的 `Modal`：焦点陷阱、`Esc` 关闭、关闭后焦点还原到打开它的那张卡；参考页的实测项就是「`Esc` 关闭后焦点回到大厅第三张卡」。
* 返回键是 `<button type="button">`，带 `title` / `aria-label`（`返回`），与大厅的 `BackPlate` 同一形态（`lobby.js` 的 `BackPlate` 是模块私有的，所以大厅里复制了一份 `ExtBack`）。
* 两个 `<section>` 各带 `aria-label`；占位行用原生 `disabled`，不是 `aria-disabled`。
* 测试钩子：`extension-stage` / `extension-row-<id>` / `extension-note` / `extension-start` / `extension-tiers` / `extension-party` / `extension-empty`；容器上还有 `data-extension="<id>"`、`data-status="<status>"`。蚀流 chips 带 `data-tier`、形态 chips 带 `data-party`，两者都用 `aria-pressed` 表示选中。

---

## 5. 新增一个玩法包：`EXTENSION_MODES` 里加一条

一句话规则：**加一条数据，大厅自动多一行（1 → N），不需要改大厅代码**。条目字段（照 `extensionModes.js` 的 JSDoc）：

| 字段 | 作用 | 约束 |
|---|---|---|
| `id` | 唯一 id；`data-ext`、`extPick` 的取值 | 不能与现有条目重复 |
| `name` | 显示名 | `N_('中文')`，经 `t()` 取 |
| `en` | 英文小标 | 不是 msgid，直接写 |
| `code` | 玩法包自己的代号（`AC-5`） | **不借**官方四档难度的代号 |
| `color` | 强调色（`#5b0a14`） | 只进档案的 `--x-color` |
| `icon` | `Icon` 的图标名（`sword` / `chevrons` / `eye` …） | 档案左上徽记 |
| `desc` | 简介 | 会被 `nowrap` 截断，写短 |
| `features[]` | 要点 | 只在档案里 |
| `stats[]` | `{ value, label }` 数值格 | 可空数组 |
| `pack` | 页脚的玩法包名（`湮灭模拟 v3.1.0` / `筹备中`） | 经 `t()` |
| `status` | `'ready' \| 'pending' \| 'missing'` | 语义见 §2.2 |
| `reason` | 不可开局时的原因 | `pending` 必填；`missing` 建议填；`ready` 不填（渲染不读它，留着就是过期信息） |
| `erosionTiers` | 玩法包自己的档位数（湮灭模拟 `6`） | 声明后页脚才出现 1–N 蚀流与「单人 / 同盟」两枚 chip（§2.3、§3.3）；不声明就是没有档位/形态选择的玩法包 |

四条约束：

1. `code` / `color` / `en` / `features` 是**玩法包自己的**——大厅不借用官方四档难度的代号、颜色或效果（`extensionModes.js` 的 JSDoc 原文）。
2. 界面文案一律 `N_()` 模块级 msgid 再经 `t()` 取，四语言包在 `public/i18n/`；检查 `node tools/i18n.mjs check --all --strict`。缺译文时 `t()` 回退到 msgid 本身。
3. **缺包不要删条目**：把 `status` 写成 `pending` / `missing` 并给 `reason`，条目仍然列出、档案仍然能看（「一个条目不该因为玩法包缺失就消失」）。只有「整个目录一个包都没有」才落到 §2.3 的空状态。
4. 不要在大厅里写死条目数量或索引：`extensionModeCount()` / `defaultExtensionPick()` 是唯一的算法。

---

## 6. 边界与不做的事

* **不改官方四档难度**：不动 `DIFFICULTIES`，不动 `data/*.json`（生成物，AGENTS.md）。
* **不新增房间模式字符串**：版本登记只认 `solo` / `coop`（`shared/versions.js` 的 `baseRoomMode`）。湮灭模拟的「单人 / 同盟」也只换 `room.create.mode`（`solo` / `coop`），难度恒为 `ANNIHILATION`，modeId 由 `modeIdFor()` 从这对值推出（§3.3）。
* **不碰 golden**：入口与大厅是纯 UI，`npm run golden` 不应有任何位移。
* **不引付费 / 广告**：项目保持非商业。
* **今天不承诺战绩隔离**：「不计入官方战绩」只有卡面文案，没有任何战绩代码实现它 `[ASSUMED]`；落地时要在同一轮里补上，并回来改 §1.2 与本条。
* **参考页的演示控制不进游戏**：可接入 / 可开局 / 空状态三个开关只存在于 `public/dev/extension-hall-preview.html`，游戏里一律由 `status` 数据决定。

---

## 7. 证据索引

| 类别 | 路径 |
|---|---|
| 大厅条目与路由 | `public/js/screens/lobby.js`（`MODE_CARDS`、`openMode`、`create`、`createAnnihilation`、`extOpen` / `extPick` / `extErosion` / `extParty`、`ExtensionHall` 挂载） |
| 玩法包表与大厅组件 | `public/js/screens/extensionModes.js`（`EXTENSION_MODES`、四个派生函数、`ExtensionHall`） |
| 大厅样式 | `public/css/screens/lobby.css`（`.proto-body.ext-body` 的 40 / 60 两栏、`.ext-*` 一族、`.ext-party`、`.chip--ready / --pending / --missing`；行高与 `gap` 见 §4.2） |
| 房内与局内 | `public/js/screens/room.js`（`rs-erosion-chips` 的 1–6 档位）、`public/js/screens/game.js`（藏品三选一 / 图鉴 / 增益老虎机、`.gm__erosion` 角标）、`public/js/ui/relics.js` |
| 无尽局结算 | `server/match/results.js`（`gd.endless` 时通过回合按 `m.round` 算） |
| 真机自查 | `devtools/render-check-extension-hall.mjs`（大厅三档视口 + `SP_PARTY=coop`）、`devtools/render-check-annihilation-room.mjs`（房内 → 局内，`SP_EROSION=4/6`） |
| 布局参考页 | `public/dev/extension-hall-preview.html`（第二版版式：固定行高、一行简介、要点进档案；游戏里的数值以它为准） |
| 交接与四路研究 | `handoff/EXTENSION-MODE-2026-10-26.md`（§3 研究结论、§4 参考页、§5 落地清单、§6 红线）；原始拆解在仓库外的 `E:\Workbox\.session-dump\team\annihilation\`（`a/report.md` 等） |
| 姊妹文档 | `docs/INFINITE_MODE.md`（超限模拟：同样在官方四档难度之外，但它换的是房间 mode，不是玩法包） |
| 炸惊模拟（第二个玩法包） | `docs/ZHAJING.md`（隔离架构 + 钩子清单）、本节 §8、`handoff/ZHAJING-SPLIT-PLAN-2026-10-28.md`（拆分计划）、`handoff/ZHAJING-INVENTORY.md`（包内清单）、`handoff/ZHAJING-COVERAGE.md`（验收矩阵） |
| 文案 | `public/i18n/`（四语言包，`tools/i18n.mjs` 检查） |

---

## 8. 炸惊模拟（ZHAJING，第二个玩法包，2026-10-28）

第二个 `ready` 的玩法包：`id: 'zhajing'`、代号 `AC-8`、`difficulty: 'ZHAJING'`、两个 mode 记录
`mode_single_zhajing` / `mode_multi_zhajing`。它的隔离设计全文在 [`docs/ZHAJING.md`](ZHAJING.md)；本节记**这个入口与局内界面**
（§1–§7 管的那一层）多出来的东西。

### 8.1 条目与形态

* 条目声明 `forms: ['solo','coop']`、**不声明** `erosionTiers`：页脚只有「单人 / 同盟」两枚 chip，没有蚀流档位（§2.3、§3.3）。
* **声明 `theme`（2026-10-28 晚起，2026-10-29 补上主视觉）**：炸惊有自己的二级界面（主题大厅），和湮灭同一层——列表页
  只画「进入」，`单人 / 同盟` 与「开始」搬进二级页。`theme = { art: '/assets/zhajing-intro/art/zhajing-key.webp',
  kicker: 'BLAST SIMULATION // FIELD MANUAL' }`：主视觉进了 `public/assets/zhajing-intro/`，`.ext-theme__art-img` 会真的画出来。
  （早先那版只有 `kicker`、`.ext-theme__art-img` 为 0；`public/js/screens/extensionModes.js` 条目上方的注释已同步。）
* 二级页上除了「开始 / 单人 / 同盟」，还有三颗键：**规则**（复用局内那份 `zhajingRules`，数字仍从 `config.json` 现算）、
  **惊变一览**（只读，见 §8.2 的 `JibianCodex` 一行；`data-testid="extension-codex"`，`extensionModes.js` 的条目声明
  `codex: 'mode_single_zhajing'`）与左下角的 **S.W.E.E.P. 报告 / 干员调配**（后者取代了 2026-10-29 并入的「卡池调整」，见 §8.5）。
* `difficulty: 'ZHAJING'`，`room.create` 只多带它、**不带 `erosion`**（服务端在非 ANNIHILATION 房拒绝那个键）。协议与 lobby 的放行见 §3.3。

### 8.2 局内多出来的几块（都只在炸惊房出现）

| 界面 | 数据来源 | 说明 |
|---|---|---|
| 惊变三选一（`public/js/ui/jibian.js` 的 `JibianOverlay`） | `m.public.sp` 的 `family === 'jibian'` 草稿 | **点选 → 确认**两步（与机变 / 藏品同一惯例：惊变整局不可逆，单点即发代价太高）；确认发既有的 `g.choice { idx }` |
| 重抽（同文件的 `jibian-reroll-<idx>`） | `m.private.jibian.rerollsLeft` | 发 `g.cardRefresh { idx }`（`shared/protocol.js`，`idx` 0..6 由草稿张数决定）；每槽一次、`rerolls` 预算用完 `RATE`、普通局必拒 `BAD_TARGET`；0 次时按钮禁用但仍在（次数是玩家该看到的信息） |
| 已选惊变面板（`JibianPanel`，左下角 `[data-testid="zj-jibian"]` 打开） | `m.private.jibian { cards, owned, rerollsLeft }` + `m.public.enemyJibian { round, rarity, card, cards, pool, hidden? }` | **单层三页签**：已选惊变 / 敌方惊变 / 惊变羁绊（业主 2026-10-29：局内不再有「惊变一览」页）；我方与敌方两页是**横行**一行一张（不是三选一时的竖卡），描述 2 行省略、全文在 `title`，羁绊片「名 + tiers」；卡片「补充」= 它所属的**惊变羁绊**（按卡片 id 反查 `data/jibianBonds.json` 的 `members`，展示羁绊名 + effect 全文），不是盟约说明；**已选只读这一处**，不解析 `priv.effects` 的 `jibian:` 前缀（那个前缀是战斗侧键，不是 UI 契约） |
| 敌方惊变揭晓浮层（`EnemyJibianReveal`） | `m.public.enemyJibian` 的 `card` / `pool` / `flickerMs` / `resultMs` / `cards` | 先按 `flickerMs` 只在 `pool` 里翻牌（**剔掉刚抽到的这张**，定格前不泄露任何字），再 `resultMs` 定格；可点击 / 空格 / Esc / Enter 跳过；**只在「新抽到」时触发**（`round:cards.length` 做键，重连不重放）；减动效直接出结果；版式是 `width: min(12.4rem, 62vw)` 的窄高竖卡（手机 792×360 实测 491×233.5） |
| 惊变一览（`JibianCodex`） | `config.modes[modeId].jibian.pool`（局外 `owned` 传空 = 只读总览） | **只在局外**：大堂「拓展玩法 → 炸惊模拟」二级页的 `[data-testid="extension-codex"]`（业主 2026-10-29「惊变一览写局外二级界面去」）；99 张按稀有度分组、局内不再挂载；纯只读（关闭不发任何 `g.*`）；不 fetch 包外数据 |
| 规则速览（`public/js/ui/zhajingRules.js`） | **现算** `data/config.json` 的炸惊 mode | 待部署区格数、装备件数、惊变回合表 / 张数 / 重抽次数、白值膨胀、禁选盟约、首领回合全部从数据读；**不抄包内那份速览的数字**（包内手册是它自己的版本，见交接 §1.3） |

另：简报（`briefing.js`）的「玩法包」一节只写 `config.name` / `desc` 与**阶段名表**（`spPhaseKinds` 的 `R1 惊变阶段`、`R2 快递`、`R9 悬赏`…），
**不出现任何卡面**——惊变是当场揭晓的机制，提前泄露等于改玩法。房间里 `DIFFICULTY_NAMES.ZHAJING` / `DIFFICULTY_COLORS.ZHAJING`
（`shared/constants.js` 的两行，`DIFFICULTIES` 未动）负责难度胶囊与代号；蚀流胶囊仍只在湮灭出现。

**草稿形状（服务器契约）**：`m.public.sp` 仍是 `{ family:'jibian', cards:[{idx,id,name,desc,rarity,…}], … }`，另带
`sp.jibian = { claimed:Set, handTaken:Set, dealtFor:<playerId> }` —— 同盟局**换人时重发一手 3 张**（`_dealJibianFor`），
被**选中**的卡才进 `claimed` 真正离开牌库，只是摆过的回池子。`sp.taken` 保留原语义（全场第 N 槽被谁选走），
惊变草稿的可用性看 `handTaken`。客户端不需要认识这三个字段（只读 `cards`），它们供测试与将来的观战视图使用。

### 8.3 与包内（v2.1）的差异

| 项 | 包内 | 本仓 | 理由 |
|---|---|---|---|
| 模式代号 | `AC-5` / `sortId: 6` | `AC-8` / `sortId: 7` | 包内那两个值与**湮灭模拟完全相同**，照搬会在房间页出现两条 `AC-5` |
| 模式名 | `炸惊模拟（BETAv0.799325）` | `炸惊模拟` | 内部构建号是噪音；版本在 `pack` 那行（`炸惊模拟 v2.1`） |
| 惊变阶段牌库 | 每人一副独立牌池 | **一房一副牌池 + 换人重发一手 3 张**（`_dealJibianFor`，`claimed` 记账） | 牌池仍是房间的（`sp.cards` 形状不变 → 客户端零改动），但每人上桌都能看到 3 张可选；包内「抽到没选中的卡回牌库」这个语义保留 |
| 重抽 | 浮层里有重抽键 | **已接入**：`g.cardRefresh { idx }`（`idx` 0..6）+ `intents.js` 的 case + `spDraft.refreshSpCard`（每槽一次、`rerolls` 预算、`BAD_TARGET`/`RATE`/`ALREADY`）+ 客户端按钮；`enterSpDraft` 额外给每个存活玩家 `markPrivate`（否则首帧 `rerollsLeft` 是过期的 0，按钮整局 disabled） | 0.3.3 的 `g.*` switch 在 `intents.js` 而不是 `Match.js`（少 case = 静默丢弃） |
| 棋库规模 | 包内清单 104 个干员位 | **99 个干员位 / 可抽取 97**：`zhajing: true` 的非精锐记录是 99 条（99 个不同 charId），其中重岳 / 白铁 4 条记录是 `grantOnly`、只由「祀」策略发放，`visibleChess` 按参考包排除它们（`c.grantOnly === true`），不进卡池/商店 | 包内的 104 算的是 205 条记录的全部 base（含 6 条 `zhajing:false` 的副本），本仓不把那些放进名册 |
| 锻造器（forge） | 完整四件套（协议 + PlayerState + sim 打击链 + 客户端） | **未接入**（`DOMAIN_NAMES` 不留空位） | 四件套工程，半成品比不做更糟；连带惊变「黑闪」的暴击率/暴击回技力在 forge 落地前是惰性的 |
| 惊变卡 | 99 我方 + 21 敌方 | 数据完整；本轮又接完 3 张：`jibian_zhuiji` / `jibian_shiguangzhimo`（两个时机事件 `onRoundWouldStart` / `onWouldEliminate` 已落地并被 `HOOKS` 收录）、`jibian_erjiguan`（卫戍侧 installer）。**仍未接完 2 张**：`ejibian_quanjunchuji`（全军出击，要改 boss 出怪表）、`jibian_siwanghuigui`（死亡回归，要改淘汰回滚状态机） | 两条都要重构阶段机/出怪表，风险大于收益，明确下一轮 |
| 隐秘惊变 | 隐秘核心前的保底隐秘卡 | **已接入**：`phases.startRound` 在 `drawEnemyJibian` 后调 `drawHiddenJibian(r)`（`r === gd.hiddenRound`，炸惊 R15），保底 1 张 `hidden` 稀有度 + 1 张普通池卡，双双进 `enemyJibianCards`/`enemyJibianList`（带 `hidden: true`），当轮执行 `applyHiddenMatchCards`；不新增 PHASE | 门是 `gd.zhajing && enemyJibian().hidden.enabled` —— 官方四档/湮灭一位不多、一格 rng 不耗 |
| 整备区槽位 | 20 | **20**（本轮修：`PlayerState.hand` 原先固定 `HAND_SIZE`=10，不读 `gd.benchSize`；官方四档/湮灭仍 10） | 数据里 `economy.benchSize: 20` 曾是死字段，且每局炸惊都违反 `invariants.js` 的手牌长度断言 |
| 干员调配炸惊页签 | 独立一套 entries / ops | **未接入**（`shared/zhajingBase.js` 的 `allyScale` 折算与 `gd.allyScale` 已就绪） | 客户端下一轮 |
| `data/zjDefaultLoadout.json` | 84 条默认模组 | **未落**（随干员调配页签一起） | 没有消费者时先不生成 |

### 8.4 回归锁

```bash
node --test test/match/zhajing-room.test.js              # 5   建房 / 难度不降档 / 无 erosion / modeIdFor / 官方四档不受影响
node --test test/match/zhajing-mode.test.js              # 25  模式门 / 盟约覆盖 / 白值 / 惊变抽卡 / 敌方惊变 / 泄漏
node --test test/match/zhajing-e2e.test.js               # 13  真实 Match：R1 三选一 → 选卡落地 → 战斗 → 结算；5 张卡的整备侧效果
node --test test/match/extension-modes-regression.test.js # 11  本体 + 湮灭回归锁（含交替运行的 withZjView 泄漏锁）
node --test test/match/mode-isolation-matrix.test.js     # 21  全模式隔离矩阵（每模式的池子 = 应有集合；官方八档同构）
node --test test/match/zhajing-refresh.test.js           # 6   g.cardRefresh 的协议 / 错误码 / 普通局必拒
node --test test/match/zhajing-drafts.test.js            # 6   同盟每人一手 3 张 / 隐秘惊变两张 / 官方模式不产生
node --test test/zhajing-flow.test.js                    # 10  ws 整链路：建房 → 房内拒绝 → 开局 → 草稿 → 重抽 → 反例 → 重连
node --test test/content/zj-ops.test.js                  # 18  9 个新干员的数值断言 + 同 seed + 双向隔离
node --test test/content/jibian-*.test.js test/content/zhajing-bonds.test.js  # 50  惊变卡 / 敌方惊变 / 羁绊镜像 / mujica / 三条 zjOnly 盟约
node --test test/ui/zhajing.test.js test/ui/zhajing-panels.test.js test/ui/zhajing-adapt.test.js \
           test/ui/zj-bonds-view.test.js                 # 29  大厅条目 / 三选一 / 揭晓 / 一览 / 重抽 / 双端断点与地板 / 官方盟约视图
node devtools/check-mode-isolation.mjs                   # 矩阵 CLI：每模式的池子 = 应有集合（exit 1 = 越界）
node devtools/check-zhajing-isolation.mjs                # 官方 11 mode 有/无 zj 记录逐字节对比 + data/versions 未污染
node devtools/render-check-zhajing.mjs                   # 双端真机：4 档视口 × 10 屏，RESULT: OK，截图进 handoff/shots/
GOLDEN_FULL=1 node tools/golden.mjs                      # 288 场景零位移（炸惊记录全部被官方子集过滤排除）
```

### 8.5 房间锁与「卡池调整」（2026-10-28 晚）

业主口径：「炸惊锁定难度锁定卡池，所以进入房间时左下的『第二期下半』改为『炸惊一期』且暂时不能调整，难度也锁定；
因为卡池做了改动，因此在二级页面添加独立调整按钮」。

| 项 | 表现 | 服务端 |
|---|---|---|
| 版本胶囊（房间左下） | 炸惊房显示 **`炸惊一期`**、`disabled`、`title`/`aria-label` = `玩法包自带卡池，版本已锁定`、`data-locked="play-set"`；官方房仍显示版本名（逐字节不变） | `room.proposeVersion` → `VERSION_UNSUPPORTED`（与「这个房间吃不了那个版本」同源） |
| 难度胶囊 | `data-locked="play-set"`、虚线边 + 玩法包绿 + `cursor:help`；可点但只弹提示（不给选择器入口）；⚙ 里的「模拟难度」行同步禁用 | `room.setDifficulty` → `BAD_TARGET`（`the difficulty of a play-set room is locked`）；`room.setMode` / `room.setPlugins` 同样 `BAD_TARGET` |
| 卡池调整（2026-10-29 并入「干员调配」） | 二级页左下 `[data-testid="ext-loadout"]`（文案 **干员调配**，与大厅那颗同一套薄板语汇、更窄；与它上方的 `ext-sweep`（S.W.E.E.P.报告）**同宽**）→ **既有的「干员调配」整屏**（`loadout.js`），不是新写的编辑器、也不是 sweep 档案。玩法包档**不再渲染档位横行**（`loadout-mode` 整行不进 DOM），档位改标在「说明」键右侧（`[data-testid="loadout-set"][data-mode]`）。原先旁边那颗独立的「卡池调整」（`extension-pool-edit`）与它打开的是同一屏，业主 2026-10-29 判为重复，已删。返回即回二级页 | `room.loadout` 的可选 `mode: 'zhajing'`（缺省 `'normal'`，老消息逐字节不变）；两档并存（`seat.zjLoadout` 独立字段，**绝不写** `.loadout`/`.ops`）；名册 = 97 可抽取 ∪ 2 条 grantOnly = 99；非炸惊房发 zj 档 → `BAD_TARGET` |

为什么用「既有干员调配」而不是专用面板：业主明确要求「维持原版的界面逻辑」。因此炸惊档只是**同一个界面的一组档位**：
名册换成 99 条炸惊记录（含 `visible:false` 的那些，精英不单独成行），保存走 `room.loadout { mode:'zhajing', entries }`
（`entries` 只发与记录默认值不同的 `{skill, module}`），`PlayerState.zjLoadout` 在炸惊局与 `loadout` 合并交给 `resolveLoadout`
—— **空档 = 与改动前逐字节一致**。回执路径：`room.state.seats[].zjLoadout`（只在炸惊房、真人、非空时出现）与
`m.private.zjLoadout`。

**湮灭那边的同一层**：湮灭的主题大厅多一颗 `extension-feature-settings`（功能设置），面板 `ann-feature-settings` 是 8 行开关
—— 上 4 行是插件规则表里的四个开关（文案借 `RULE_SWITCHES[].phrase`，零新字面量），下 4 行是湮灭专属 mod 的四项内容
（阿戈尔加强 / 通讯机与寻呼模块 / 罗德岛盟约 / 卡兹戴尔盟约，后两条标注「仅计数与展示」）。房间状态是 `Room.annMods`
（与 `erosion` 同级、**不进 `cs`**），读法 `gd.rulesOf(name)` / `gd.annMod(name)`，规则冲突时**插件内容集最强**。
设计与判定全文在 [`docs/ANNIHILATION-MODS.md`](ANNIHILATION-MODS.md)。

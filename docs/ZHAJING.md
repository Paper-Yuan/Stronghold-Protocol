# 炸惊模拟（ZHAJING）· 隔离架构与钩子清单

本文是**炸惊模拟**这个拓展玩法模式的隔离设计稿：它是什么、凭什么不污染主玩法各版本，以及要让它在
0.3.3 的代码上跑起来，**每一处**该在哪里加什么判断。

* 上游方向：[`handoff/ZHAJING-SPLIT-PLAN-2026-10-28.md`](../handoff/ZHAJING-SPLIT-PLAN-2026-10-28.md) §2（不建独立数据集／内容集，改用「模式标记 + 模式门」）。
* 参照实现：`modref/v2.1/`（外部整合包 v2.1，0.3.1 谱系，**只读**）。
* 姊妹文档：[`docs/EXTENSION_MODE.md`](EXTENSION_MODE.md)（玩法包大厅）、[`docs/INFINITE_MODE.md`](INFINITE_MODE.md)（超限模拟，同样是官方四档之外但换的是房间 mode）。
* 规则是 `docs follow the code`：本文描述**当前工作区**的行为；与代码冲突时以代码为准，并回来改本文。没有上游依据的细节标 `[ASSUMED]`。

> **本文的落位**：`docs/ZHAJING.md`，与同题材的 `docs/EXTENSION_MODE.md`、`docs/INFINITE_MODE.md` 并列。
> 它**不是** `docs/design/` 里的 DESIGN 分卷（那一层要求 `# DESIGN §N — …` 标题与 `Part of DESIGN.md` 段落，
> 且章节号全局唯一：`test/docs-paths.test.js`、`test/helpers/designDocs.js`），所以本文一律用中文序号标题。
> 炸惊还不是「现行规则」：本轮只落地了一部分（附录 A 是状态快照），因此不升格进 DESIGN。

---

## 一、定位

### 1.1 一句话

**炸惊模拟是一套独立的棋库 + 一套抽卡式增益系统（惊变）+ 一层盟约数值覆盖**，以「一个 `ZHAJING` 难度」的形态
挂在拓展玩法大厅里；它不是官方第五档难度，也不是房间 mode，更不是内容集。

它的规则面由四块拼成，缺一块就会**静默少玩一半**（不报错，只是不生效）：

| 块 | 内容 | 数据落点 |
|---|---|---|
| 棋库 | 104 个基础干员位（normal/elite 各一条）＝ 205 条 `chess_zj_*` + 炸惊卫戍 238 条 | `data/chess.json` / `data/garrisons.json`，记录带 `zhajing: true`（**且 `visible: false`**） |
| 盟约 | 5 条新盟约 + 21 条既有盟约的 `zj` 覆盖块 | `data/bonds.json`，覆盖块写在记录自己的 `zj` 键里 |
| 惊变 | 我方 99 张（五档稀有度）+ 敌方 21 张 + **18 条**惊变羁绊 | `data/config.json` 的 `modes.mode_*_zhajing.{jibian,enemyJibian}`；效果代码在 `server/sim/content/{jibian,ejibian,jibianBonds}.js` |
| 模式 | 两条 mode 记录（`mode_single_zhajing` / `mode_multi_zhajing`）、`bans.ZHAJING`、`hiddenCore.difficulties += ZHAJING` | `data/config.json` |

### 1.2 与四类「别的模式」的边界

理解隔离的关键是**分清这五条线各自改什么、由谁读**。它们经常被混淆，而混淆是污染的主要来源。

| 线 | 换的是 | 由谁读 | 与炸惊的关系 |
|---|---|---|---|
| **官方四档**（`FUNNY/NORMAL/HARD/ABYSS`） | `difficulty` | `shared/constants.js:37 DIFFICULTIES` 画四张难度卡 | 炸惊**不进** `DIFFICULTIES`（进去就会在选择器里多出第五张卡）。照湮灭：常量放 `shared/zhajing-constants.js` |
| **湮灭模拟**（`ANNIHILATION` + `erosion` 1–6） | `difficulty` + `erosion` | `gd.annihilation` / `gd.erosion` / `gd.endless` | **同构范式**，但只覆盖「数值与回合结构」；炸惊还多一层**卡牌系统**与**数据记录覆盖**（见第五节） |
| **超限模拟**（`solo_infinite` / `coop_infinite`） | **房间 mode**（`shared/infiniteMode.js`）+ `gd.overlimit` | `isInfiniteRoomMode`、`Match.isInfinite` | 炸惊**不改房间 mode**；超限改的是「同一难度玩多久」，炸惊改的是「玩的是哪套内容」 |
| **官方版本**（`data/versions/*`，`shared/versions.js`） | 整份数据集 + 独立 match host + 自己的 `cs` | `server/versions.js`、`server/match/host/` | 版本是**真·独立数据集**（本项目里唯一的一种）。炸惊明确**不走**这条（见 2.1） |
| **炸惊**（`ZHAJING`） | `difficulty` + 两条 mode 记录 + `zhajing` 记录标记 | `gd.zhajing`（总门）、`gd.jibian`、`gd.enemyJibian`、`gd.allyScale` | 本稿 |

两条硬边界：

1. **炸惊不新增 `roomModes` 字符串**。版本登记只认 `solo` / `coop`（`shared/versions.js` 的 `baseRoomMode`）：
   建房时 `room.create { mode: 'solo'|'coop', difficulty: 'ZHAJING' }`，modeId 由 `shared/constants.js:47 modeIdFor()`
   推出 `mode_single_zhajing` / `mode_multi_zhajing`。这条与湮灭完全一致（`docs/EXTENSION_MODE.md` §3.3）。
2. **炸惊不改 `data/versions/*`**。它们是官方历史版本的构建产物；炸惊的记录只属于默认数据集（第 7 节 R-6）。

---

## 二、三层门

三层门的意思是：**同一份数据、同一个引擎，靠三个不同层面的开关各管一件事**。任何一层漏了，表现都是「静默」——
不报错、不崩溃，只是玩家看到的东西不对。这是本稿反复强调「断言」的原因。

### 2.1 数据层：模式标记 + 收集器过滤

**开门字段**：记录自己的标记（`chess.zhajing === true`、`item.zjOnly === true`、`bond.zj`、`band.zjOnly === true`），
由 `gd.zhajing` 在**收集器**里决定留不留。

| 收集器 | 位置 | 主玩法看到 | ZHAJING 看到 |
|---|---|---|---|
| `gd.visibleChess` | `server/match/gamedata.js:207` | `c.visible === true && c.zhajing !== true` | `c.zhajing === true`（**只**它，不混主棋库） |
| `gd.shopItemsByTier` | `server/match/gamedata.js:219` | 跳过 `it.zjOnly === true` | 全收 |
| `gd.bandIds` / `bandAllowed` | `server/match/gamedata.js:1152,1162` | 跳过 `b.zjOnly === true` | 全收 |
| `gd._bonds`（盟约视图） | `server/match/gamedata.js:199` | `zjBondView(bonds, { merge: false })`：**只剥 `zj` 键**，记录逐字节还原 | `merge: true`：合并覆盖块 |

**为什么不需要独立数据集**（Lead 方向，本文复核后同意）：

1. 参考包 0.3.1 的炸惊实现**本来就是按标记做的**（`modref/v2.1/server/match/gamedata.js:154-161` 一行三目就是全部隔离），
   改成数据集要重写全部接线，收益只是「`data/*.json` 里不出现 zj 记录」。
2. 内容集的 `cs` 随**每次 sim 代码改动**而变（`server/plugins/identity.js` 把整个 `sim/**` 哈希进去），
   会把玩法包变成「一动代码就掉存档」的东西（`handoff/EXTENSION-MODE-2026-10-28.md` §5.2 已点名）。
3. **真正的污染风险不在「数据文件里有几条记录」，而在「有没有代码路径在非 ZHAJING 模式下读到它们」**。
   那要用收集器 + 测试来管，数据集换不来；反过来说，把收集器管住了，数据集只是同一件事的更贵的写法。

**什么时候必须改回数据集**（这是本文与「永远不做数据集」的差别 —— 判据要写死，免得日后靠感觉）：

| 触发条件 | 为什么标记法兜不住 |
|---|---|
| `data/chess.json` 的 zj 记录超过主棋库规模的 ~1.5 倍，且 `node -e` 统计出**任何**遍历整份 `chess` 映射的代码路径（图鉴、随机池、成就、`operatorCharIds`）都会把 zj 记录读进去 | 那时「每次新增一条读全表的路径都得记得加门」，成本会超过搬运 |
| 需要在**同一进程内**同时跑两套不兼容的盟约阈值语义，而 `withZjView` 的单线程栈式注入已经不成立（例如 sim 出现真正的并发） | 视图注入依赖「一步 `step()` 同步跑完」 |
| 炸惊需要自己的 `sim/**` 代码版本（例如改引擎本身的伤害管线） | 那已经不是内容问题，`cs` 必须变，只有内容集/版本 host 能表达 |

以上三条都不成立时的**退路**（比数据集轻得多，仍然纯搬运）：把 zj 记录整体搬进 `data/extensions/zhajing.json`，
加载时按 mode 合并进 `chess` 映射。**这一步不需要重写玩法**，所以「先按标记做」不会把路走死。

### 2.2 引擎层：一个总门 + 三个子门 + 一个视图

| 门 | 字段 | 现状位置 | 语义 |
|---|---|---|---|
| 总门 | `gd.zhajing` | `server/match/gamedata.js:188` | `mode.difficulty === 'ZHAJING' \|\| /zhajing/i.test(modeId)`。**每个钩子的第一道 `if`** |
| 卡牌 | `gd.jibian()` | `server/match/gamedata.js:579` | 该 mode 有 `mode.jibian` 才非 null；池子空 = 阶段直接跳过（回落整备） |
| 敌方卡牌 | `gd.enemyJibian()` | `server/match/gamedata.js:614` | 同上，`mode.enemyJibian`；`enabled: false` 也算没有 |
| 白值 | `gd.allyScale` | `server/match/gamedata.js:535` | `{atk,def,hp}`，**折进干员白值**（`unit.base`），不是战场乘区 |
| 视图 | `Battle.zj` | `server/sim/Battle.js:111` | `{ bonds, combos }`，只在 `modeId` 含 `zhajing` 时非 null；由 `withZjView` 在装配与每一步推进期间装上（`server/sim/content/support/index.js:68`） |

`gd.zhajingFlags()`（`server/match/gamedata.js:692`）把「要随 BattleSpec 下发的那几个」收成一个对象：

```js
// 非 ZHAJING 返回 null —— 官方模式的 flags 对象不会因此多出一个键（golden 零位移的前提）
{ allyScale?: {hp,def,atk}, bondLayerCap?: number }
```

> **[ASSUMED]** 目前的 `zhajingFlags()` 只带 `allyScale` / `bondLayerCap`。敌方惊变那一路（`enemyJibian`）应该
> 也走这里而不是各调用点自己拼 `m.enemyJibianCards`，理由见 3.5 的 `flags` 行：5 个建 spec 的地方各写一遍
> 必然会漏一处，而漏掉的那一处就是「某一场战斗不吃敌方惊变」。

### 2.3 界面层：大厅加一条，难度表不动

* `public/js/screens/extensionModes.js` 的 `EXTENSION_MODES` 加第二条 `{ id: 'zhajing', status: 'ready' }`。
  大厅按表画（`docs/EXTENSION_MODE.md` §5），**不改大厅代码**。
* `shared/constants.js:37 DIFFICULTIES` **不加** `ZHAJING`；常量放 `shared/zhajing-constants.js`
  （`ZHAJING_DIFFICULTY`、`isZhajingMode()`），形状照 `shared/annihilation-constants.js`（12 行，含「为什么单独一个文件」的头注释）。
* 界面识别难度的两个读点必须认它（否则房间页的名称/颜色空白，静默）：
  `public/js/screens/lobby.js:180` 的 `known = DIFFICULTIES.includes(difficulty) || difficulty === ANNIHILATION_DIFFICULTY`
  与 `DIFFICULTY_NAMES` / `DIFFICULTY_COLORS`（`shared/constants.js:42-43`）。

---

## 三、钩子清单

### 3.0 怎么读这张表

**行号是 2026-10-28 的快照值**，同时给出**锚点符号**（方法名 / getter / 常量名）。这个工作区是多会话共享的，
`server/match/gamedata.js` 在本稿写作期间已经被 engine 改了两轮（1002 → 1186 行），行号会漂——
**按符号定位，行号只用来快速跳过去**。

三类：

* **必须改**——不改就是静默失效（少玩一半 / 主玩法被污染 / 数值静默取错）。
* **参考包里已不存在于 0.3.3**——参考实现有的，0.3.3 重构掉了或本来没有；照抄会撞空。
* **可选（体验优化）**——不涉及隔离，只影响好不好玩／好不好看。

图例：✅ 表示本文写作时工作区**已落地**（engine 已改），⏳ 表示**待落地**。

---

### 3.1 `server/match/gamedata.js` —— 数据层的全部门

| 文件:行 | 现状代码摘要 | 要加的判断 | 用途 |
|---|---|---|---|
| `server/match/gamedata.js:54`（`DEFAULTS.bans`） ✅ | `bans: { FUNNY…, ABYSS… }` | 加 `ZHAJING: { core: 2, addon: 2 }` | 忘了它就回落到 `{core:0,addon:0}` = 炸惊一局不禁任何盟约 |
| `gamedata.js:188`（构造器 `this.zhajing`） ✅ | `this.zhajing = this.mode.difficulty === 'ZHAJING' \|\| /zhajing/i.test(modeId)` | 全部钩子的第一道门 | 总开关 |
| `gamedata.js:197-199`（`zjCombos` / `_bonds`） ✅ | `this.zjCombos = zhajing ? zjEquipCombos(this._bonds) : null`；`this._bonds = zjBondView(this._bonds, { merge: zhajing })` | **非 ZHAJING 必须走 `merge:false`（只剥键）** | 主玩法既不能拿到覆盖块，也不能因为剥键而改一丁点数值 |
| `gamedata.js:207`（`visibleChess` 的 filter 返回值） ✅ | `return zhajing ? c.zhajing === true : (c.visible === true && c.zhajing !== true)` | 三目 | ZHAJING 只拿 zj 棋库；其它模式拿不到 zj 记录。**`pool.js` 与 `drawDisabledBonds` 全部经这里，所以池子自动隔离** |
| `gamedata.js:219`（`shopItemsByTier` 循环体） ✅ | `if (it.zjOnly === true && !zhajing) continue;` | 一行 | 炸惊专属装备不进普通商店 |
| `gamedata.js:254`（`bossPoolHp`） ⏳ | `let base = boss.bloodPoint[diff]`，`diff = this.difficulty`；取不到时**静默回落该表第一个有限值** | 二选一：①数据侧给每个 boss 补一个 `ZHAJING` 列（照 `ANNIHILATION` 的既有做法，`data/bosses.json` 现在五列）；②代码侧加 `bloodPointKey`（`mode.bossHpScale.bloodPointKey`，照 `mode_single_annihilation` 的 `bloodPointAbyss`）。**推荐①**：零 gamedata 改动，且与湮灭同形 | 漏了＝炸惊的领袖血量静默变成**标准难度**的 |
| `gamedata.js:344`（`income`） ⏳ | 读 `economy.income` 表 + `incomeCap` | `mode.income[31]` 优先、`mode.incomeCap` 优先（0 = 不封顶） | 炸惊的经济曲线（`income[31]`）不走就永远是官方的 12 上限 |
| `gamedata.js:352`（`chessPrice`） ⏳ | mode 覆盖 → 记录自带 `price` → economy 表 | `mode.chessPrice[tier]` 已在（`this.mode.economy?.chessPrice`）；确认炸惊的 `chessPrice` 写在哪一层并读到 | 价格错＝开局经济整体走偏，但不报错 |
| `gamedata.js:381`（`get benchSize`） ⏳ | `posIntOr(economy.benchSize, 10)` | `mode.benchSize`（20）优先 | 待部署区 10 vs 20，玩家立刻能感觉到，但**没有任何报错** |
| `gamedata.js:388`（`get equipPerChess`） ⏳ | `endless ? Infinity : posIntOr(economy.equipPerChess)` | `mode.equipPerChess` 优先 | 同上 |
| `gamedata.js:400`（`get leftoverKeptBands`） ⏳ | 只总结 `economy.leftoverFundsKeptByBands` + 坎诺特 | 加 `get leftoverFundsKept() { return this.zhajing && this.mode.leftoverFundsKept === true; }`，与 `player/round.js:62` 一起改 | 「资金永不清零」是炸惊第 10 条规则 |
| `gamedata.js:408`（`rewardOffer`） ⏳ | `{count,tierOffset,maxTier,price}` | **可选**：炸惊的 `tierWeights` / `tierWeightsByLevel` / `sameBond` | 只影响升星奖励的手感，不影响隔离 |
| `gamedata.js:535`（`get allyScale`） ✅ | `if (!this.zhajing) return null`，归一化 `mode.allyScale` | 已落地 | 白值膨胀的读取口 |
| `gamedata.js:551`（`get bondLayerCap`） ✅ | `this.zhajing ? posIntOr(mode.bondLayerCap, null) : null` | 已落地 | 层上限 9999（官方 999） |
| `gamedata.js:554-566`（`spPhaseKinds` / `spPhaseKind`） ✅ | 读 `mode.spPhaseKinds[round]` → `'jibian' \| 'express' \| 'bountyHigh'` | 已落地；**非 ZHAJING 恒 null** | 特殊阶段家族选择的唯一入口 |
| `gamedata.js:579`（`jibian()`） ✅ | `if (!this.zhajing) return null`；`{cards, rerolls, rarityWeights, pool, noCoreBondLegendWeight}` | 已落地；`rarityWeights` 必须放行 `'hidden'`（隐秘档） | 抽卡参数 |
| `gamedata.js:614`（`enemyJibian()`） ✅ | `if (!this.zhajing) return null`；`{rounds, rarityWeights, pool, flickerMs, resultMs}` | 已落地；`rounds` 默认 `[1,6]` | 敌方惊变的参数 |
| `gamedata.js:645-660`（`expressPool` / `expressGroups` / `expressCards`） ✅ | `this.zhajing ? mode.expressPool : null` | 已落地 | 企鹅物流的快递 |
| `gamedata.js:673`（`chessInRoster(id)`） ✅ | 按 `charId + isGolden` 把普通记录换成 zj 棋库里的**同一位干员** | 已落地。**这就是奖池 id 映射**（`zjToChar`）：`data/choices.json` 的奖池按普通 id 写死（`pool_char_pinus` 野鬃/灰毫/远牙、`pool_chess_glady` 斯卡蒂/幽灵鲨/深巡），直接发普通记录 → 同名但 `baseId` 不同 → **永远合不了精锐** | 不换＝玩家报「三个灰毫放在一起没精锐」（包内 2026-10-22 owner 反馈） |
| `gamedata.js:692`（`zhajingFlags()`） ✅ | `{allyScale?, bondLayerCap?}`，非 ZHAJING 返回 `null` | 见 2.2 的 `[ASSUMED]`：建议把 `enemyJibian` 也收进来 | 一处收口 5 个建 spec 的地方 |
| `gamedata.js:832`（`roundCfg`） ⏳ | 非 `ANNIHILATION` 直接返回 `mode.rounds[r]` | **检查点，不需要改**：炸惊的回合行在 `mode.rounds` 里自带，确认 `spPhaseKinds` 的回合与 `spRounds` 一致即可 | — |
| `gamedata.js:865`/`884`（`isSpRound` / `spRounds`） ✅ | 非 `ANNIHILATION` 分支读 `mode.spRounds` | 已落地一个**必须保留**的补丁（`:898-901`）：`spPhaseKinds` 有该回合、`spRounds` 没写时**自动并进去** | 漏了＝惊变阶段永远不进门（包内踩过：只改 `spPhaseKind` 不够，入口是 `spRounds` 判定） |
| `gamedata.js:1040`（`timer`） ⏳ | `config.timers[key]` | **可选**：`specialPhaseTime: 150` | 特殊阶段时长 |
| `gamedata.js:1099`（`get hiddenCore`） ⏳ | `difficulties: h.difficulties \| DEFAULTS`（现为 `NORMAL,HARD,ABYSS,ANNIHILATION`） | **数据侧**把 `ZHAJING` 加进 `config.hiddenCore.difficulties` | 漏了＝炸惊**永远不出隐秘核心**（`finalAssault.js:137 hiddenEligible` 静默 false） |
| `gamedata.js:1116`（`bans(difficulty)`） ⏳ | `config.bans[difficulty]` + `DEFAULTS.bans[difficulty]` | 由 `:54` 的 DEFAULTS + 数据侧的 `bans.ZHAJING` 覆盖 | 见 `:54` 行 |
| `gamedata.js:1142`（`bossWeights`） ⏳ | `mode.bossWeights` / `mode.hiddenBossWeights` | **不需要改**：两者都是 `mode` 字段，已在。只需数据侧填 | — |
| `gamedata.js:1152`（`bandAllowed`） ✅ | `if (b.zjOnly === true && !this.zhajing) return false;` | 已落地 | 炸惊专属策略（「祀」）不出现在普通策略轮 |

---

### 3.2 `server/match/choices.js` —— 抽卡与结算的入口

> 这一整块 ⏳ **全未落地**。参考包的实现见 `modref/v2.1/server/match/choices.js`。

| 文件:行 | 现状代码摘要 | 要加的判断 | 用途 |
|---|---|---|---|
| `choices.js:67`（`FAMILY_NAMES`） ⏳ | `{ bounty, supply, shop, tactic }` | 加 `express: '企鹅物流的快递'`、`jibian: '惊变阶段'` | 家族名（`data/choices.json` 没有这两个家族，缺了会显示裸 id） |
| `choices.js:156`（`generateDraft`，家族选择） | 加权抽 `sch.families` | 先问 `gd.spPhaseKind(round)`：`'jibian'` → `family='jibian', n=gd.jibian().cards`；`'express'` → `family='express', n=gd.expressCards()`；`'bountyHigh'` → `family='bounty'`；**null 才走加权抽**。且 `forced` 非空时**不回落 supply**（空池 = 跳过该阶段） | 家族选错的后果是「该出惊变的回合出了道具补给」，不报错 |
| `choices.js:418`（`buildCards`） | `bounty / shop / supply / tactic` 四路 | 加两路 `express → expressDraftCards`、`jibian → jibianDraftCards` | 同上 |
| `choices.js:220`（`draftBounty`） | `(c, kind)` | 加第三参 `zhajing`：炸惊下放宽 `draftPool` 限制（包内 `:215`） | 炸惊的悬赏决策池比官方宽 |
| `choices.js:345`（`bountyDraftCards`） | `draftBounty(c, kind)` | 传 `!!gd.zhajing` | 同上 |
| `choices.js:467`（`applyDefault`） | `bounty / item / tactic` 三支 | 最前面加 `if (card.kind === 'jibian')` → `addRef(ps, card, null, 'jibian:' + card.id, { battle: true, extra: { jibian: true, rarity, flavor, note, iconBond } })` | 惊变卡的**唯一落点**：一张 EffectRef，key = `jibian:<effectId>`，战斗侧与整备侧都读它 |
| `choices.js:549`（`addRef`） | `{ counter, battle }` | 加 `extra` 参数并展开进 ref | 上一条要用 |
| `choices.js:441`（`cardView`） | 只搬 `tier` | 加 `rarity` / `flavor` / `bond` / `iconBond` / `bonds` | 卡面品质与羁绊进度条 |
| `choices.js:455`（`applyCard`） | 直接跑 `onChoicePick` | 前后包一层：`before = jibianBondsActive(ownedJibianIds(ps))`；每名受益玩家之后调 `jibianGrantForBond(m, p, before)` | 惊变羁绊「刚凑齐」时发卡（叙拉古人的愤怒 / 惊动军方 / 真·投资人） |
| 新增 `expressDraftCards(gd, rng, n)` | — | 从 `gd.expressPool()` **有放回**抽（一格可能重复），命中 `expressGroups` 组键时再在组内随机一种 | 企鹅物流的快递：6 件装备、可重复 |
| 新增 `jibianCard(gd, c, rarity, bonds)` | — | 拼卡面：`kind / id / name / desc / tier / rarity / flavor / bond / iconBond / bonds`。**卡的 `c.rarity` 优先**，摇出来的 `rarity` 只在池子条目没写品质时兜底 | 品质标签错＝卡面写「稀有」而卡是传说（包内 2026-10-16 玩家反馈） |
| 新增 `jibianDraftCards(gd, rng, n, exclude, opts)` | — | 先按 `rarityWeights` 摇品质、再从该品质里取卡；该品质抽空则回落整池；`exclude` 去重；`noCoreBond` 时把「带核心盟约的传说」概率提到 `noCoreBondLegendWeight`；`onlyHighRarity`（投资未来）时**同时收窄池子与权重** | 惊变三选一 |
| 新增 `ownedJibianIds(ps)` / `jibianGrantForBond(m, ps, before)` | — | 见参考包 `:602-684`。⚠️ 参考包在这里用了 `Math.random()`（`:655`），**移植时必须换成 `m.rngDraft` / `createRng(deriveSeed(...))`** | 羁绊发卡 |

**为什么不把惊变做成 `data/effects.json` 记录**：惊变卡的效果是代码（99 张里有 60+ 张要挂战斗钩子），
数据记录只能表达数值袋。所以卡的「身份」在 `config.modes[*].jibian.pool`，「行为」在 `content/jibian.js`
的 `jibian:<effectId>` 处理器。这也是它与 `机变`（`choice:<effectId>`，走 `data/effects.json`）唯一的形态差别。

---

### 3.3 `server/match/match/*` 与 `server/match/player/*` —— 局内

| 文件:行 | 现状代码摘要 | 要加的判断 | 用途 |
|---|---|---|---|
| `match/phases.js:428` | `if (this.gd.spRounds().includes(this.round)) this.enterSpDraft();` | **不用改**（`spRounds()` 已被炸惊接管），但要知道这就是特殊阶段的唯一入口 | 惊变阶段的进门处 |
| `match/phases.js:263`（`startRound`） ⏳ | 回合开始 → 出怪 → 整备 | 在 `ps.startRound(r)` **之前**抽敌方惊变：`if (ej && ej.rounds.includes(r) && !done.has(r)) this.enemyJibianCards.push(pick)` | 敌方惊变按配置回合生效，且**只增不减**（后续每一场战斗都带着它） |
| `match/spDraft.js:18`（`generateDraft` 调用） ⏳ | `generateDraft(gd, rngDraft, round, {stageId, bondAvailable, itemAvailable})` | 加 `exclude: this._jibianOwned(ps)`、`noCoreBond: this._jibianNoCore(ps)`、`onlyHighRarity`；`perPlayer` 分支：`gd.spPhaseKind(round) === 'jibian'` 时每名玩家各抽一批 | 惊变阶段是**每人各抽**（悬赏是全场共用） |
| `match/spDraft.js:231-268`（`rollPool` 棋池分支） ⏳ | `p.weighted` / `p.items` 直接 `free(x[0])` | `const inRoster = (cid) => this.gd.chessInRoster(cid)`，两处先换再判 `free` | **奖池 id 映射**，见 3.1 `chessInRoster` 行 |
| `match/spDraft.js:101`（`_applyCard`） ⏳ | `applyCard(this, ps, card)` | 包 try/catch 已在（`:108`）；确认 `jibian:` 家族的 `card.family` 被保留 | 惊变卡结算 |
| `match/settle.js:79`（层上限） ✅ | `this.gd.annihilation && this.gd.unlimitedLayers ? Math.floor(n) : layerGainRoom(before, …)` | 加一支：`const cap = this.gd.bondLayerCap`，有 cap 时按 `min(n, cap - before)` 封顶。**不要用 `setBondLayerCap()` 全局开关**（见 6.4） | 炸惊层上限 9999 |
| `match/settle.js:87`（`onBattleResult` 派发） ⏳ | `dispatch(ps, 'onBattleResult', {result, lpLoss, perfect, bountyDone, unite})` | 无需改，但惊变卡的 `onBattleResult` 处理器要靠它（高卢银行支票的概率计数器） | — |
| `match/views.js:117`（`publicView`） ⏳ | `...(this.gd.annihilation ? { endless, erosion } : {})` | 照抄一行：`...(this.gd.zhajing ? { zhajing: true, ...(this.enemyJibian ? { enemyJibian: this.enemyJibian } : {}) } : {})` | 客户端据此显示惊变面板；**这是 `publicView` 不长出 zj 键的边界**，非 ZHAJING 必须逐字节不变 |
| `match/views.js:140`（`spRound`） | `spRound: this.gd.spRounds().includes(this.round)` | 无需改；可选加 `spPhaseKind` 让客户端知道是「惊变」还是「快递」 | 客户端 UI |
| `match/bossRounds.js:95`（`bossPoolHp` 调用） ⏳ | `bossPoolHp(this.gd, bossId, alive.length, this.isInfinite ? this.round : undefined)` | 炸惊的 `hiddenBossHpMul: 2`：隐秘核心的领袖血量单独翻倍 | 漏了＝隐秘核心不难 |
| `match/bossRounds.js:147`（boss/hidden 的 `flags`） ⏳ | `flags: { layerGainsEnabled: false, ...this.gd.dp, enemyScale, ...(annihilationFlags) }` | 展开 `...(this.gd.zhajingFlags() ?? {})` + 敌方惊变卡 | 见 3.5 `flags` 行 |
| `match/combat.js:88`（普通战斗 `flags`） ⏳ | 同上 | 同上 | 同上 |
| `match/intents.js:150`（单场重放/侦察 `flags`） ⏳ | 同上 | 同上 | 同上 |
| `match/unitePhase.js:64`（联防 `flags`） ⏳ | 同上 | 同上 | 同上 |
| `match/prep.js:13`（`enterPrep`） ⏳ | — | **可选**：隐秘核心前的「隐秘惊变」揭晓（包内 2026-10-24 owner 追加） | 只是一段演出，不做不影响隔离 |
| `player/round.js:21`（`startRound` 的 `ev.income`） ⏳ | `{ round, income: this.gd.income(r), pending }` | 加利息：`gd.interest` 存在时 `income += min(max, floor(funds/capital)*interest)`，并在 `ev` 上带 `interest` / `interestCapped` | 炸惊第 10 条规则的利息 |
| `player/round.js:62`（`endPrep` 清资金） ⏳ | `if (!this.gd.leftoverKeptBands.includes(this.bandId)) this.funds = 0;` | `&& !this.gd.leftoverFundsKept` | 炸惊资金永不清零 |
| `player/round.js:138`（`bondsView`） ✅ | `bondsWithGains(this.bonds, this.pendingLayerGains)` | 若在 0.3.3 保留 `layerGainRoom` 的全局 cap，则这里要按 `gd.bondLayerCap` 再夹一次 | 视图层的层数显示 |
| `player/round.js:198`（`battleInput` 组装） ⏳ | `bonds: bondSnapshot(...)` | 加 `jibianFlags: { doubler: … 'jibian:diecengshou:until' >= round }`（包内做法） | 叠层手/加入大群这类「整备侧事实 → 战斗侧」的透传 |
| `player/items.js:116`/`138`（装备槽） ⏳ | `const policy = morphSlotPolicy(ruleOption(this.m?.rules, 'morphPairing'), …)`；`policy.slotCap(this.gd.equipPerChess)` | **两条路选一**：①`gd.morphEquipSlot` 直接让 `_isMorphItem` 走第三槽（包内做法）；②复用现成的 `morphPairing: 'plus'` 房间规则 | 变形同构体不占格。见第 8 节 Q-2 |
| `player/views.js:34`（`effectsView`） ⏳ | `for (const e of this.effects)` 搬 `id/name/desc/iconKind/iconId` | 透传 `jibian` / `rarity` / `flavor` / `enemy` 四个键（包内 `:68`） | 「已选惊变」面板要品质与描述；不透传就只有裸 id |
| `player/views.js`（`privateView` 的按钮态） ⏳ | — | `spRefresh` / `mysticRefresh` / `deathReturn` / `banteng` / `cheque` / `lpPayment` 六个键 | 惊变卡带的商店栏按钮；缺了按钮不出现（静默） |
| `player/economy.js:49`（`addLayers` 封顶） ✅ | `this.gd.annihilation && this.gd.unlimitedLayers ? … : layerGainRoom(before, …)` | 同 `settle.js:79` | 层上限 |
| `player/economy.js:24`（`spend`） ⏳ | 资金检查 | **可选**：恶魔契约（`jibian_emoxieyue`）允许用目标生命支付 | 一张卡的机制，不影响隔离 |
| `player/basics.js:162`（`setSkins`） ⏳ | `const ids = operatorCharIds(this.gd?.raw)` | **无需改**（0.3.3 已按 charId 而不是 chess id），但要确认 zj 棋库的 charId 在 `operatorCharIds` 里（见 4.2 不变式 I-8） | 炸惊形态的皮肤 |
| `player/basics.js:21`（`opsIds` / `cultivationCharIds`） ⏳ | `cultivationCharIds(raw.chess, raw.backups)` | **必须改**：`shared/protocol.js:215` 明确要求 `c.visible !== false`，而 zj 记录是 `visible: false` ⇒ **炸惊棋库的干员没有潜能/练度** | 主玩法不受影响（这是对的）；ZHAJING 里是功能缺失 |
| `PlayerState.js:221`（`this.effects = []`）/ `:232`（`this.counters = {}`） | 已是通用容器 | 惊变靠 `effects`（`key = jibian:<id>`）与 `counters`（`jibian:<card>:<slot>`）承载，**不需要新字段** | 见 5.2 的「棋盘外状态」 |
| `PlayerState.js`（新增 `jibianHas(effectId)`） ⏳ | — | `this.effects.some(e => e.key === 'jibian:' + effectId)` | 整备侧问「这名玩家有没有这张卡」的唯一入口（战斗侧对应 `support/index.js:322 hasJibian`） |
| `match/effectsMeta.js:73`（`KEY_RE`） ⏳ | `/^(garrison\|band\|bond\|item\|choice\|effect\|global):[A-Za-z0-9_\-.:#]+$/` | **加 `jibian`** | **不改＝99 张惊变的整备侧全部静默失效**（注册时直接 `TypeError`，被 try/catch 吞掉）。本稿的第一号静默风险 |
| `match/effectsMeta.js:494`（`makeCtx`） ⏳ | ctx 提供 `modeId` / `setCounter` / `addFunds` / `addLayers` / `grantItem` / `grantChess` / `rollChess` / `addDeployCap` / `setDeployCapAtLeast` | 加 `enemyJibian: () => m.enemyJibianCards`、`jibianConsumed: () => ps.jibianConsumed`、`markJibianConsumed(id)` | 敌方惊变「神秘顾客」换将要读它；追忆/111真复活吗哥要靠 consumed 集合防重复 |
| `match/effectsMeta.js:204`（`investRepeat`） ⏳ | 「获得时」触发次数 | 加 `gd.zhajing` 时的 `investRepeat` 口径：惊变「投资人」把每个 `onGain` 触发两次、真·投资人翻倍 | 包内 `:202-216` |
| `match/bondsMeta.js:39-44`（`pieceBonds`） ⏳ | `grantedBondsByMorph(items, (id) => gd.item(id), {mode, bondOk})` | 后面追加：`if (gd.zjCombos?.length) for (const id of equipComboBonds(items.map(i=>i.id), gd.zjCombos)) …` | 「同时装备护盾无人机 + 变形同构体 → 企鹅物流」。原版 `giveBondId` 表达不了「特定两件配对」 |
| `match/builtinMeta.js:134`（人事部文档） ⏳ | `ctx.setDeployCapAtLeast(int(paramsOf(ctx, ev.item).count, 9))` | `if (gd.zhajing) { ctx.addDeployCap(1); return; }` | 炸惊口径是「可部署人数 +1」而不是把上限设成 9 |
| `match/invariants.js:75`（层数不变式） ✅ | `v <= BOND_LAYER_CAP` | 按 `gd.bondLayerCap` 放宽 | 否则 ZHAJING 局会被自己的不变式判死 |
| `match/invariants.js:105`（装备槽不变式） ⏳ | `morphSlotPolicy(ruleOption(m.rules,'morphPairing'), …)` | 与 `player/items.js` 用**同一个** policy 对象 | 两处口径不一致＝不变量误报 |
| `match/pool.js:32`（`drawDisabledBonds`）/ `:68`（`SharedPool`） ✅ | 全部经 `gd.visibleChess` | **不需要改** | 池子隔离的收益所在 |
| `match/finalAssault.js:137`（`hiddenEligible`） ⏳ | `gd.hiddenCore.difficulties` 判定 | 数据侧补 `ZHAJING` | 见 3.1 `hiddenCore` 行 |
| `match/results.js:72`（称号表） ⏳ | `tr.hiddenCore[gd.difficulty]` | 数据侧给 `ZHAJING` 的行，或确认回落可接受 | 结算称号缺失（不报错） |

---

### 3.4 `server/sim/*` —— 引擎侧

| 文件:行 | 现状代码摘要 | 要加的判断 | 用途 |
|---|---|---|---|
| `sim/Battle.js:111`（`this.zj = zjViewFor(this.modeId)`） ✅ | `modeId` 含 `zhajing` 时 `{ bonds, combos }` | 已落地 | 视图的**唯一来源** |
| `sim/Battle.js:203` / `:219`（`withZjView` 包 `installContent` 与 `_setupUnit`） ✅ | 已落地 | 已落地 | 装配期读到的是炸惊记录 |
| `sim/battle/lifecycle.js:73`（`step`） ⏳ | `step()` 分支… `if (!this.started) this._phase('start', () => this.start())` | 把整个 `step()` 主体包进 `withZjView(this.zj, () => …)` | **不包＝战斗中读到的仍是基础盟约记录**（数值覆盖静默失效）。这是视图注入的第二半 |
| `sim/battle/players.js:179`（`_makeAlly` 的白值） ✅ | `const as = allyScaleOf(this.flags?.allyScale)` → 乘进 `base.atk/def/maxHp` | 已落地 | 白值膨胀折进白值（不是战场乘区），所以百分比加成从新白值起算 |
| `sim/battle/economy.js:23-52`（`addLayers`） ✅ | `layerGainRoom(live, ctx.n)`（进程级 live cap） | `flags.bondLayerCap` 存在时改用它 | 战斗内叠层上限 |
| `sim/units.js`（`scaleMul`） ⛔ | 0.3.3 **已经没有 `scaleMul`**（只有 `atkScaleMul` 等 buff mods），`units.js:212` 附近 | **不要移植**参考包的 `unit.scaleMul` 老路径 | 参考包自己也留了注释说「字段留着给外部构造兜底，现在没有地方写它」 |
| `sim/simdata.js` ⏳ | 记录 → 引擎 def | **检查点**：zj 记录带 `zhajing: true` 与普通记录同形（`tier` / `stats` / `bonds` / `skills`），`simdata` 不需要认识 `zhajing`。但它必须**照常**转 zj 记录——`getChess(id)` 是 id 直查，不经过 `visibleChess` | 漏了＝炸惊的干员没有 body |
| `sim/attack/helpers.js:95`（`periodicDamage`） | 参考包 `import { periodicDamage } from '../damage.js'` | **路径变了**：0.3.3 没有 `server/sim/damage.js`，在 `attack/helpers.js` | 银质子弹的流血 |
| `sim/attack/element.js:106`（`applyElement`） | 参考包 `ejibian.js` 从 `../damage.js` 取 | 改为 `../attack/element.js` | 萨卡兹巫术的凋亡损伤 |
| `sim/content/items/battle.js:885`/`:897`（`weaknessRetype` / `addShieldLayer`） | 参考包用这两个 | **两处都还在，签名一致** | 赤霄剑法 / 青排背部 |
| `sim/content/tokens.js:1415`（`spawnYanyou`） | 参考包 `jibian.js` 用它 | **还在，签名一致** `(battle, playerId, {atk,hp,atkMul,dmgTakenMul,count})` | 炎国游记/黑闪 |
| `sim/snapshot.js` ⏳ | 单位快照字段 | **可选**：透传 `mem.ejibianFx` / `mem.ejibianCopy`（真的假的的彩虹、斗蛐蛐的金色） | 纯表现 |

---

### 3.5 `server/sim/content/*` —— 内容侧

| 文件:行 | 现状代码摘要 | 要加的判断 | 用途 |
|---|---|---|---|
| `content/index.js:58`（`DOMAIN_NAMES`） ✅ | `[…,'choices','hazard','relics','jibian','ejibian','jibianBonds']` | 已落地。**注意参考包的名单是 `[...,'jibian','forge','ejibian']`——它没有 `hazard`/`relics`，多一个 `forge`** | 少一个名字＝该域全哑且不报错 |
| `content/index.js:73-81`（`jibianBonds` 再导出 + `loaded`） ✅ | `activeBonds` / `ownedJibianIdsOf` / `bondHintsFor` 的守卫封装 | 已落地（文件缺失时降级为空实现，不抛） | 惊变羁绊 |
| `content/support/index.js:62-71`（`ZJ` 视图 + `withZjView`） ✅ | 模块级 `let ZJ`，`try/finally` 栈式还原 | 已落地 | 单进程内的「按战斗」数据覆盖 |
| `content/support/index.js:74`（`bondRecord`） ✅ | `own((ZJ && ZJ.bonds) \|\| gameData().bonds, id)` | 已落地。⚠️ `itemRecord`（`:75`）**没有**走视图——见 6.2 | 盟约记录读点 |
| `content/support/index.js:295`（`unitBonds` 的组合盟约） ✅ | `if (ZJ && ZJ.combos?.length && items.length) for (const id of equipComboBonds(items, ZJ.combos)) …` | 已落地 | 组合盟约（战斗侧） |
| `content/support/index.js:322`（`hasJibian(battle, pid, effectId)`） ✅ | 读 `ps.playerEffects` 的 `jibian:<id>` | 已落地。**这是内容模块问「这名玩家有没有这张惊变卡」的唯一入口**——sim 侧永远不要 import 惊变模块 | 见 5.2 |
| `content/jibian.js`（新增，2542 行） ⏳ | 99 张卡的 `effectId → handler` + `install(battle)` | 按 0.3.3 的 7 个 support 导入逐个核对（6.1），`Math.random` / `process.env` 全删 | 惊变本体 |
| `content/ejibian.js`（新增，574 行） ⏳ | 21 张敌方卡 + `matchJibianPlan()` 出怪计划 | 同上；`createRng/deriveSeed` 从 `server/sim/rng.js` 取（`createRng:7` / `deriveSeed:53`），`isHitCount` 从 `content/enemies.js:131` 再导出取 | 敌方惊变本体 |
| `content/jibianBonds.js`（新增，109 行） ⏳ | **18 条**惊变羁绊（纯函数，数据内联） | 照搬。**不要 import 任何 Node API**（`/sim/*` 会被浏览器加载） | 羁绊 |
| `content/mujica.js` + `mujicaBond.js`（新增） ⏳ | Fever 机制（颂乐人偶五人） | 全部入口都 `if (!/zhajing/i.test(battle.modeId)) return;` | 五位新干员的专属机制 |
| `content/bonds/addon/zjbonds.js`（新增） ⏳ | 5 条新盟约的战斗实现（战斗里没有效果，数值全在 `zj` 块） | 照搬 | — |
| `content/bands/battle.js` / `bands/meta.js` ⏳ | 策略实现 | 只在「鸭爵」那条读 `ctx.enemyJibian()` | 敌方惊变「谁选的鸭爵？？」 |
| `content/garrisons/battle.js` ⏳ | 特质实现 | 二极管（`jibian_erjiguan`）叠层 50/50；塑心 zj 版 | 两张卡的机制 |
| `content/traitMods.js` ⛔ | 超限模拟的「词条」 | **与炸惊无关**：参考包的 `traitMods.js` 里没有任何 zj 引用（已核对）。不要往这里加东西 | — |
| `content/devices.js` ⛔ | 地形与关卡器械 | **与炸惊无关**（参考包同样零引用）。`annihilationFlags().terrainLethal` 是湮灭的，炸惊不用 | — |
| `content/forge.js` ⛔ | 0.3.3 **没有这个文件** | 参考包的 `forge.js` 是它的自有玩法（用 `battle.zj` 判炸惊）；0.3.3 的对应物是 DSL / `extensions.js`。**不要移植** | — |

---

### 3.6 协议、大厅、房间 —— 炸惊的「五环」

湮灭有「蚀流五环」（`docs/EXTENSION_MODE.md` §3.4：`room.create → Room → room.state → startMatch → Match → GameData`），
断任一环就**静默降级为蚀流 1**。炸惊同样有五环，断任一环就**静默降级为标准难度**：

| 环 | 文件:行 | 现状 | 要改 |
|---|---|---|---|
| 1 协议 | `shared/protocol.js`（`room.create` 的 `difficulty` 校验） | 难度是字符串，`ZHAJING` 天然合法 | 无需改；**但要确认 `room.setDifficulty` 的白名单** |
| 2 建房 | `server/lobby.js:967-970` | `DIFFICULTIES.includes(asked) \|\| asked === ANNIHILATION_DIFFICULTY ? asked : DEFAULT_DIFFICULTY` | 加 `\|\| asked === ZHAJING_DIFFICULTY`。漏了＝**建房被静默改成标准** |
| 3 房间态 | `server/lobby.js:516`、`:2164` | `...(difficulty === ANNIHILATION_DIFFICULTY ? { erosion } : {})` | 炸惊目前没有额外字段；若要显示惊变开关，在这里加 |
| 4 改档 | `server/lobby.js:1133`（`setDifficulty`） | 版本 mode 白名单（`:1369`/`:1381`） | 加 ZHAJING 分支，或确认 `fallbackDifficulty`（`:1502-1505`）认它 |
| 5 开局 | `server/match/Match.js` → `new GameData(data, modeId, opts)` | `opts.erosion` 只对 ANNIHILATION 生效 | **不需要传新 opts**：炸惊的全部开关都在 mode 记录里（这是标记法比蚀流更省的地方） |
| 界面 | `public/js/screens/lobby.js:180`、`shared/constants.js:42-43` | `known` 判定 + `DIFFICULTY_NAMES/COLORS` | 加 ZHAJING（否则房间页名称/颜色空白） |

---

### 3.7 参考包里已不存在于 0.3.3 的钩子（照抄会撞空）

这一节是「移植时最容易白写半天」的清单，全部已用 0.3.3 的工作区实读核对。

| 参考包的写法 | 0.3.3 的实况 | 怎么办 |
|---|---|---|
| `import { … } from '../damage.js'` | **`server/sim/damage.js` 不存在**：伤害 API 拆成 `server/sim/attack.js` 公开入口 + `server/sim/attack/` 内部（`calculation/effects/element/heal/health/helpers/hit/legacy/transfer`） | `periodicDamage` → `attack/helpers.js:95`；`applyElement` → `attack/element.js:106` |
| `support/index.js` 里 `zjView` / `withZjView`（视图形如 `{bonds, items, combos}`） | 0.3.3 已落地**同名同义**实现（`content/support/index.js:62-71`），但视图只有 `{bonds, combos}`，**没有 `items`** | 若真的需要 zj 专用装备记录（`giveBondId`），先确认它们能否直接进 `data/items.json`（能，则不用 `items` 视图） |
| `bondLayers` 在参考包 `modref:132` | 0.3.3 `support/index.js:189`，**签名一致** | 直接搬 |
| `match/gamedata.js` 的 `bossPoolHp(bossId, aliveCount, opts = { hidden })` | 0.3.3 是 `bossPoolHp(bossId, aliveCount, round)`——**第三参是 `round`（超限的 Boss 血量成长），不是 opts 对象** | 炸惊的 `hiddenBossHpMul` 要另开一路（`bossRounds.js:95` 已在传 `round`），别撞参数 |
| `get bossKeys()`（傀儡把戏换 boss） | 0.3.3 **没有** `gd.bossKeys` | 要就新增（`raw.enemies` 里 `rank === 'BOSS'` 的 key，排序），并只在 `zhajing` 时进 `flags` |
| `bloodPointKey` / `bloodPointDiff()` / `bossPoolHpMul` | 0.3.3 **都没有**；`bossPoolShareOf` 只认 `solo/coop/perPlayer/aliveFull/aliveScaling` | 见 3.1 `bossPoolHp` 行：推荐走数据列 |
| `layerGainRoom(before, n, cap)`（三参） | 0.3.3 是 **两参** `layerGainRoom(before, n)`（`shared/constants.js:147`），cap 来自进程级 `bondLayerCapLive`（`setBondLayerCap`） | **不要**为了炸惊去 `setBondLayerCap(9999)`（那是超限的做法，会**全局**影响同进程其它房间）。要么按 `flags.bondLayerCap` 自己算，要么给 `layerGainRoom` 加**可选**第三参（默认 undefined = 现在行为，golden 零位移） |
| `player/cheat.js`（`SP_ZHAJING_CONFINE` 等测试开关） | **0.3.3 没有 `server/match/player/cheat.js`**（`server/match/player/` 只有 acquire/basics/common/diy/economy/items/pieces/placement/prep/round/views） | 整块不移植；里面的 `process.env` 测试开关也不移植（见 6.5） |
| `server/match/gamedata.js` 的 `get spRounds()` 里 `process.env.SP_ZHAJING_SKIP_SP` | 0.3.3 没有这个开关，**也不应该有** | 不移植。若确实要「无惊变的炸惊」，用 `mode.spPhaseKinds` 留空表达，不要读环境变量 |
| `diyEnabled: false`（自选编队不进炸惊） | 0.3.3 有 `player/diy.js`（245 行）且**没有** `gd.diyDisabled` | 新增 `get diyDisabled()` + `player/diy.js` 的 `setDiy` 第一道门 |
| `forge.js` 域 | 0.3.3 无 | 不移植 |
| `DEFAULTS.benchSize: 20`（把默认值改成 20） | 0.3.3 是 10 | **不要改默认值**（会动到 golden）；走 `mode.benchSize` |
| `bandDraft.duplicatesAllowed` / `simultaneous` | 0.3.3 的 `bandDraft` 只有 `skipsPerPlayer` / `timeoutBandId`（`gamedata.js:917`） | 与炸惊无关（那是 100 人局变体），不移植 |
| `unite.relayBattlefield` | 0.3.3 的 `unite` 只有 `maxHelpers` / `templates`（`gamedata.js:859`） | 不移植 |

---

### 3.8 可选（体验优化，不影响隔离）

| 位置 | 内容 |
|---|---|
| `gamedata.js:408 rewardOffer()` | `tierWeights` / `tierWeightsByLevel` / `sameBond`：升星奖励按权重与同盟约出牌 |
| `gamedata.js:1040 timer()` + `mode.specialPhaseTime` | 特殊阶段 150 秒 |
| `gamedata.js`（新增 `enemyCountMul` / `baseEnemyScale` 的 `def` / `bossAtk` / `bossDef` / `resMul` / `countMul`） | 参考包在 `baseEnemyScale` 里加了 5 个乘区（防御、领袖攻击、领袖防御、法抗、出怪量）。**这些是「数值更精细」而不是「隔离」**，可以第二轮再做；`enemyScale` 一旦动，golden 的敌人侧要重新评估（非 ZHAJING 分支必须 `return base` 原样） |
| `sim/snapshot.js` | `ejibianFx` / `ejibianCopy`（彩虹/金色小人与复制名） |
| `match/prep.js:13` | 隐秘核心前的「隐秘惊变」揭晓演出 |
| `match/views.js:140` | `publicView` 带 `spPhaseKind`，客户端据此给特殊阶段换标题 |
| `player/economy.js` | 恶魔契约（用目标生命支付）、维多利亚的秘密/神秘商店的特殊刷新按钮、板藤套现、高卢银行支票提现 |
| `public/js/ui/*` | 惊变三选一浮层、已选惊变面板（我方/敌方/羁绊三页）、惊变一览、炸惊规则页、干员调配炸惊页签（`allyScale` 折算后的展示值） |

---

## 四、隔离不变量与断言草案

写成「**给定**：模式 X ／ **断言**：什么必须逐字节不变」。每条给出**放哪个测试文件**与**用哪个现有 helper**。

现成 helper（已实读）：

* `test/match/harness.js`：`DATA`（`:34`）、`makeMatch(o)`（`:36`）、`checkInvariants(m)`（`:172`）、`give` / `giveItem` / `chessOfTier` / `legalTileFor`。
* `test/helpers/battleHarness.js`：`makeBattle`（`:212`）、`checkInvariants(b)`（`:327`）、**`hashOf(v)`（`:382`）＝稳定 FNV 哈希，用来做「逐字节不变」的断言**。
* `test/helpers/wsClient.js`：`TestClient`（协议级测试，照 `test/match/annihilation-mode.test.js` 的用法）。
* `server/match/scheduler.js`：`VirtualScheduler`（真实 `Match` + 虚拟时间，不跑真浏览器）。

新建文件：**`test/match/zhajing-isolation.test.js`**（隔离）＋ **`test/content/zhajing-content.test.js`**（内容域真的装上了）。

---

### I-1 官方四档 × 单人/同盟：`visibleChess` 逐字节不变

**给定**：`new GameData(DATA, modeId)`，`modeId` 取 `mode_{single,multi}_{funny,normal,hard,abyss}` 与 `mode_*_annihilation` 全部 10 条。
**断言**：`gd.visibleChess` 与「把 `data/chess.json` 里所有 `zhajing === true` 的记录删掉后重建的 `gd`」得到的数组**完全相同**（`assert.deepEqual`），且 `gd.visibleChess.every(id => DATA.chess[id].zhajing !== true)`。
**放哪**：`test/match/zhajing-isolation.test.js`。**helper**：`test/match/harness.js: DATA` + 手工 `structuredClone` 造一份「无 zj 记录」的数据（`deepEqual` 而不是 `hashOf`，这样失败信息能指出差在哪一条）。
**为什么必须**：`pool.js:44`（`drawDisabledBonds` 的封禁计算）与 `pool.js:68`（`SharedPool` 的条目）都遍历 `visibleChess`；漏一条 = 主玩法的卡池多出 205 条。

### I-2 官方四档：`shopItemsByTier` 逐字节不变

**给定**：同 I-1 的 10 条 modeId。
**断言**：`hashOf(gd.shopItemsByTier)` 等于「删掉所有 `zjOnly === true` 道具后重建」的哈希；且每个 tier 数组里没有 `zjOnly` 道具。
**放哪**：同上。**helper**：`battleHarness.hashOf`。

### I-3 官方四档：可抽策略（`bandIds` + 策略草稿）逐字节不变

**给定**：同 I-1。
**断言**：①`gd.bandIds()` 不含任何 `bands[id].zjOnly === true`；②用**同一个种子**跑 `makeMatch({difficulty})` 的 `BAND_DRAFT`，草稿里出现的策略 id 序列与「无 zj 记录」的数据完全一致（`deepEqual`）。
**放哪**：同上。**helper**：`makeMatch`（带 `seed`）+ `VirtualScheduler`。
**为什么**：`bandAllowed` 的 `zjOnly` 门写在 `gamedata.js:1152`，是**唯一**一处；测试要钉住它，而不是钉住某个具体策略名。

### I-4 盟约记录：非 ZHAJING 下没有 `zj` 键、数值逐个相同

**给定**：`new GameData(DATA, modeId)`，10 条官方 modeId + `mode_single_zhajing`。
**断言**：
* 非 ZHAJING：对每个 `gd.bondIds`，`gd.bond(id)` **不含** `zj` 键，且 `hashOf(gd.bond(id))` 等于原始 `data/bonds.json[id]` 去掉 `zj` 之后的哈希（`assert.deepEqual(gd.bond(id), strippedBond)`）；
* ZHAJING：至少一个盟约的 `thresholds` / `bb` 与基础记录**不同**（证明 `merge: true` 真的生效了，不是把 `merge` 参数写反）。
**放哪**：同上。**为什么**：`merge` 写反是**对称的静默错误**——主玩法拿了覆盖块，或炸惊拿了基础值，两者都不会报错。

### I-5 `m.publicView()` 不长出 zj 键

**给定**：`makeMatch({ difficulty: 'NORMAL' })` 与 `makeMatch({ difficulty: 'ZHAJING' })`，各 `m.start()`。
**断言**：
* NORMAL：`m.publicView()` 的**键集合**等于「剥掉 `zhajing` / `enemyJibian` 后」的同一集合；`hashOf(m.publicView())` 与「不加这些键的代码路径」一致（实现上：直接断言 `!('zhajing' in v)` 且 `!('enemyJibian' in v)`）。
* ZHAJING：`v.zhajing === true`。
**放哪**：同上。**helper**：`makeMatch` + `m.publicView()`（照 `test/match/annihilation-mode.test.js:41` 的写法）。
**为什么**：`match/views.js:117` 的注释就是为这件事写的——「an official mode's public view stays byte-identical」。

### I-6 `data/versions/*` 的版本房间：`gd` 不出现 zj 字段

**给定**：`getVersionData(slug)` 读四条官方版本（`shared/versions.js:36-41`）。
**断言**：对该数据建 `new GameData(vdata, 'mode_single_normal')`：`gd.zhajing === false`、`gd.jibian() === null`、`gd.enemyJibian() === null`、`gd.allyScale === null`、`gd.visibleChess` 里没有 id 落在 `raw.chess` 的 zj 记录集合里。
**放哪**：`test/match/zhajing-isolation.test.js` 内（或挂在既有的 `test/match/version-host.test.js` 旁）。**helper**：`server/data.js` 的 `getVersionData`；`test/helpers/versionReplay.mjs` 里有可参照的装载方式。
**为什么**：`tools/build-data.mjs:3368` 的先例是 `if (IS_DEFAULT && ctx.research.annihilationRelics) …`——研究数据只进默认数据集。zj 记录必须照这条写法，否则四个版本构建也会带上 205 条 zj 记录（**而且没人看得出来**，因为非 ZHAJING 的收集器会过滤掉，但它们进了 `data/versions/*` 的 `cs`）。

### I-7 ZHAJING 的池子只含 zj 记录（不混主棋库）

**给定**：`makeMatch({ difficulty: 'ZHAJING', mode: 'solo' })`，看 `m.pool`。
**断言**：`[...m.pool.entries.keys()].every(id => DATA.chess[id].zhajing === true)`，且条数等于「zj 记录里 `tier` 合法的 visible 位」数量。
**放哪**：同上。**为什么**：这一条与 I-1 是一对——I-1 保主玩法干净，I-7 保炸惊**真的换库**（否则炸惊跑的还是主棋库，玩家看到「新干员一个都没有」）。

### I-8 主玩法的「读全表」路径看不到 zj 记录的 charId

**给定**：`getData()` + 官方四档 modeId。
**断言**：`operatorCharIds(DATA)`（`shared/protocol.js:315`，**遍历整份 `chess`**）里的每一条 charId 都能在「`visible !== false` 的记录」或 `backups` 的 自选池 里找到来源；即**新增 zj 记录不改变 `operatorCharIds(DATA)` 的大小**（用 `hashOf([...].sort())` 钉住）。
**放哪**：同上（或 `test/ui/skin-picker.test.js` 旁）。
**为什么**：`player/basics.js:162 setSkins` 用 `operatorCharIds` 判「这个 charId 本房间有没有」，它**不看 `visible`**。
若 zj 记录的 charId（`char_4182_oblvns` 等 9 位）进了这个集合，普通房间的皮肤选择器就会为一个不在其棋库里的干员提供皮肤 —— 一个**纯美观但真实存在**的泄漏。这条同时还钉住 `cultivationCharIds`（`shared/protocol.js:212`，**看** `visible`）——两者口径不同，是 3.3 里 `player/basics.js:21` 那一行的依据。

### I-9 内容域真的装上了（少一行 `DOMAIN_NAMES` = 全哑）

**给定**：`makeBattle({ modeId: 'mode_single_zhajing', content: 'full' })`（`battleHarness.makeBattle`）。
**断言**：`MODULES`（`content/index.js:91`）的 name 列表包含 `jibian` / `ejibian`，且各模块的 `install` / `registerMeta` 是函数（不是 `safeImport` 失败后的 `{}`）；`content/index.js:73` 的 `jibianBonds.loaded === true`。
**放哪**：`test/content/zhajing-content.test.js`。**helper**：`battleHarness.makeBattle` + `hashOf`。
**为什么**：`safeImport`（`content/index.js:44-51`）会把「文件不存在 / 语法错」吞成 `{}`，`installContent`（`content/index.js:419`）也只 `_handlerError` 不抛。**这是唯一能发现「整个惊变系统没装」的断言**。

### I-10 `allyScale` 只改 ZHAJING 的干员白值

**给定**：同一个 chess、同一份 `players[0]` 输入，两次 `makeBattle`（一次 `flags.allyScale = {atk:2.5,def:3,hp:3}`，一次不带）。
**断言**：带的那一次 `unit.base.atk/def/maxHp` 分别是 2.5×/3×/3×；不带的那一次与「当前 main 的 `makeBattle` 结果」**`hashOf(b.snapshot())` 相同**。
**放哪**：`test/content/zhajing-content.test.js`。**helper**：`battleHarness.makeBattle` + `hashOf`。
**为什么**：`battle/players.js:179` 的折算位置一旦挪到 buff 上（而不是白值），数值会**乘在百分比加成之后**，谁都看不出来。

### I-11 `effectsMeta` 的 key 前缀放行 `jibian`

**给定**：`MetaRegistry`（`server/match/effectsMeta.js`）。
**断言**：`registry.register('jibian:jibian_qiangqiang', handler)` **不抛** `bad key`；而 `registry.register('bogus:x', h)` 仍然抛。
**放哪**：`test/match/meta.test.js`（已存在）或 `zhajing-content.test.js`。
**为什么**：`KEY_RE`（`:73`）少一个前缀时，`TypeError` 在 `registerMeta` 里被 `content/index.js:433` 的 try/catch 吞掉——**99 张卡的整备侧全部静默失效，服务器照常启动**。

### I-12 golden 零位移

**给定**：`GOLDEN_FULL=1 node tools/golden.mjs`（288 场景）。
**断言**：零位移。特别的：`allyScale` / `bondLayerCap` / `enemyJibian` 进 `flags` 之后，**非 ZHAJING** 的 spec 对象不得多出任何键（`test/golden/*.json` 的摘要会抓到）。
**放哪**：不需要新测试——它本身就是门禁。**但**要在 PR 里贴出 `288 场景零位移` 那行输出。

---

## 五、与湮灭范式的对照

### 5.1 复用点：`gd.annihilation` 的 17 处门是怎么写的

湮灭的做法可以一句话概括：**「一个 nullable getter 当总门，谁需要谁 `if (this.gd.annihilation)`」**。0.3.3 里的实例（已实读）：

| 手法 | 湮灭的实例 | 炸惊照抄成 |
|---|---|---|
| **nullable 门 + 早退** | `gamedata.js:452 get annihilation`：`mode.annihilation` 不是对象 → `null` | `gamedata.js:188 this.zhajing`（布尔）+ 各 getter `if (!this.zhajing) return null` |
| **三目挂在收集器里** | `gamedata.js:166`（erosion 只在 ANNIHILATION 时取值） | `gamedata.js:207` / `:219` |
| **`flags` 走一个函数收口** | `gamedata.js:479 annihilationFlags(kind, round)` → 5 个建 spec 处 `...(this.gd.annihilation ? this.gd.annihilationFlags(...) : null)` | `gamedata.js:692 zhajingFlags()`，同样 5 处展开 |
| **公开视图只加键，不加结构** | `match/views.js:117` `...(this.gd.annihilation ? { endless, erosion } : {})` | 同形 |
| **层上限另开一条** | `settle.js:79` / `player/economy.js:49` 的 `gd.unlimitedLayers` | `gd.bondLayerCap`（**不是** Infinity，所以不能直接复用 `unlimitedLayers`） |
| **内容域注册** | `content/index.js:58` 里的 `'hazard','relics'` | 追加 `'jibian','ejibian','jibianBonds'` |
| **常量单独一个文件** | `shared/annihilation-constants.js`（12 行，头注释解释「`constants.js` 是每个 mod 都会覆盖的文件」） | `shared/zhajing-constants.js` |
| **一条链路 + 逐档断言** | 蚀流五环 + `test/match/annihilation-mode.test.js` 逐档断言 `m.publicView().erosion` | 第 3.6 节的五环 + I-5 / I-7 |

**可以直接拿走的结论**：`zhajingFlags()` 这个收口函数是湮灭踩过坑之后的选择——如果炸惊在 5 个建 spec 的地方各写一遍
`...{ allyScale, bondLayerCap, enemyJibian }`，其中一处漏写就是「boss 战不吃白值膨胀」这种**局部**失效，最难发现。

### 5.2 差异点：炸惊多两层

| 维度 | 湮灭 | 炸惊 |
|---|---|---|
| **数值来源** | 全部由 `GameData` **算出来**（蚀流指数表、`erosionExponent`、回合家族循环） | 一半是**读记录**：盟约阈值/数值袋/buff、装备、策略都是 `data/*.json` 里的**记录内容**被 `zj` 块覆盖 |
| **数据注入点** | 无。`GameData` 的 getter 就是全部 | **有**：战斗侧的 `content/support/index.js` 直接读**进程级** `gameData()` 单例，`GameData` 管不到 ⇒ 必须靠 `withZjView` 注入 `{bonds, combos}` |
| **卡牌系统** | 藏品（`data/relics.json`）是**数据记录 + 通用 handler**，没有 draft 家族 | 99 张卡是**代码**，有自己的 draft 家族（`family: 'jibian'`）、稀有度、重抽、羁绊、以及**跨阶段状态** |
| **棋盘外状态** | 藏品计数器（`counters`）与一次性装备 | 更多：`counters['jibian:*:*']` 十几种、`ps.jibianConsumed`（一次性卡的去重集合）、`ps.jibianFlags`（整备侧事实 → 战斗侧）、`m.enemyJibianCards`（全场共用、只增不减） |
| **阶段** | 蚀流不新增 PHASE | 敌方惊变揭晓在参考包里是一个**新 PHASE**（`PHASE.ENEMY_JIBIAN` / `HIDDEN_JIBIAN`）。见第 8 节 Q-3：本稿建议**不新增 PHASE**，改为 `m.public.enemyJibian` + 客户端动画，理由是 0.3.3 的每个 intent 都有一个 `WRONG_PHASE` 守卫，新增阶段要逐个审 |
| **难度常量** | `ANNIHILATION_DIFFICULTY` | `ZHAJING_DIFFICULTY`（同形） |

### 5.3 为什么不能直接把 `erosion` 那套搬过来

三条，每条都是「搬了就会错」而不是「搬了不够好」：

1. **`erosion` 是纯数字参数，`zj` 是记录内容。**
   `opts.erosion` 从 `Room` 一路传到 `GameData` 就完事；`zj` 覆盖块要在**两个进程内单例视图**里可见：
   `GameData._bonds`（服务端整备侧）与 `content/support/index.js` 的 `gameData().bonds`（战斗侧，服务端与浏览器各一份）。
   后者**不能**由 `GameData` 参数化——`bondRecord()` 是一个无参的模块级函数，被 `bonds/core.js`、`addon/battle.js`、
   几十个 kit 直接调用。所以必须注入（`withZjView`）。这就是「多一层」的物理原因。
2. **`erosion` 的每处门都在 `server/match/`；`zj` 的门要伸进 `server/sim/`。**
   `server/sim/` 是被浏览器 `/sim/` 原样服务的纯 ESM：不能 import `server/match/`，不能有 Node API，不能有
   `Math.random` / 时钟 / 引擎近似 Math（`AGENTS.md` 的硬规则，ESLint + `test/sim/detmath.test.js` 强制）。
   `withZjView` 的 `try/finally` **必须**保持同步——一旦有人在 `step()` 里 `await`，视图就会漏给同一进程的其它战斗。
   所以视图注入要写成「`step()` 全程包住」，并且约定：**sim 里不许出现异步**。
3. **`erosion` 不需要新增内容域，`zj` 需要。**
   蚀流只加 `hazard` / `relics` 两个域；炸惊要加三个（`jibian` / `ejibian` / `jibianBonds`）+ 5 条盟约的战斗实现
   （`bonds/addon/zjbonds.js`）+ 9 个新 kit + 248 条卫戍。任何一处 `DOMAIN_NAMES` 少写、任何一处盟约没注册，
   都是「不报错、少一半」。这就是第 4 节把 I-9 单列出来的原因。

顺带一条**不要照抄**的：参考包把 `DEFAULTS.benchSize` 直接改成 20（`modref gamedata.js:33`）。
0.3.3 的默认值是所有模式共享的，改它 = 动 golden。炸惊的 20 必须走 `mode.benchSize`。

---

## 六、0.3.1 → 0.3.3 移植注意

### 6.1 `content/support/index.js` 的 API：逐个核对

参考包 `jibian.js:140-146` 只有 6 条 import 语句、**10 个具名导入**（任务简报说的「7 个」按「support 里的 7 个」算）。
逐个核对 0.3.3 的现状：

| 导入 | 0.3.3 位置 | 签名 | 判定 |
|---|---|---|---|
| `directMods` | `content/support/index.js:361` | `({atk=0,def=0,hp=0}={}, extra=null)` | ✅ 一致 |
| `passiveBuff` | `:375` | `(battle, u, key, mods, extra={})` | ✅ 一致 |
| `playerOps` | `:301` | `(battle, pid, {fieldOnly=false}={})` | ✅ 一致 |
| `isMember` | `:278` | `(battle, u, bondId)` | ✅ 一致（内部多了 调和 的「核心盟约全享」分支，对炸惊无害） |
| `gainLayers` | `:409` | `(battle, {playerId,bonds,n,requireActive=true,source=null,reason='content',cap=Infinity,capKey=null}={})` | ✅ 一致 |
| `itemsOf` | `:247` | `(u)` → 装备 id 数组 | ✅ 一致 |
| `itemKeyOf` | `:59` | `(id)` | ⚠️ **语义变了**：0.3.3 是 `String(itemRecord(id)?.effectRef ?? id).replace(/_[ab]$/,'')`，参考包是直接剥后缀。对默认数据等价（官方记录没有 `effectRef`），对**内容集**与**版本数据**不等价。移植时用 0.3.3 的版本（共享 `zjItemKeyOf` 只管组合表比较，两者路径不同，见下） |
| `bondLayers` | `:189` | `(battle, pid, bondId)` | ✅ 一致 |
| `activeBondIds` | `:191` | `(battle, pid)` | ✅ 一致 |
| `spawnYanyou` | `content/tokens.js:1415` | `(battle, playerId, {atk,hp,atkMul=1,dmgTakenMul=1,count=1}={})` | ✅ 一致（不在 support 里，在 tokens） |

另外 `jibian.js` 还 import 了三处**非 support** 的：

| 导入 | 参考包 | 0.3.3 | 判定 |
|---|---|---|---|
| `activeBonds` / `ownedJibianIdsOf` | `./jibianBonds.js` | 待新增；且建议经 `content/index.js:73` 的守卫封装读（`jibianBonds.loaded`） | 新增 |
| `periodicDamage` | `../damage.js` | `attack/helpers.js:95`，`(amount)` | ⚠️ **路径变** |
| `weaknessRetype` / `addShieldLayer` | `./items/battle.js` | `content/items/battle.js:885` / `:897` | ✅ 一致 |
| `GEO` | `shared/constants.js` | `shared/constants.js:78` | ✅ 一致 |

`ejibian.js:35-40` 的 4 条：`passiveBuff` ✅、`applyElement` ⚠️（→ `attack/element.js:106`）、`createRng`/`deriveSeed` ✅（`sim/rng.js:7`/`:53`）、`isHitCount` ✅（`content/enemies.js:131` 再导出）。

**一条容易踩的语义差**：0.3.3 的 `itemKeyOf` 会走 `effectRef`，而 `shared/zjBonds.js` 的 `zjItemKeyOf` 是**直接剥后缀**。
组合表（`equipComboBonds`）用后者、装备槽判定用前者。两处都「对」，但**不要互相替换**——
在内容集/版本数据里 `effectRef` 会让两者给出不同的 key。这一条要写进 `zjBonds.js` 的头注释（已在落地版本里）。

### 6.2 另一个语义差：`support.itemRecord` 不认视图

参考包的视图是 `{bonds, items, combos}`，`itemRecord` 也走视图（`modref support:73`）。
0.3.3 落地的视图只有 `{bonds, combos}`，`itemRecord`（`:75`）**仍读单例**。
→ 结论：**炸惊的专属装备必须直接进 `data/items.json`**（带 `zjOnly: true`），不能指望「运行时替换一条装备记录」。
落地前要确认：参考包里 `ZJ.items` 到底改了哪几条记录、那些改动能不能表达成数据（`giveBondId` / `buff`）。`[ASSUMED]` 能。

### 6.3 `ver-*` 干员结构

0.3.3 比参考包多 20 个 `ver-*.js`（版本化干员），且 `content/kits/index.js` 有 `VERSION_KIT_FILES` / `KIT_CHAR_IDS` /
`TIER_KIT_KEYS_BY_CHAR`（`content/index.js:113-115`、`:176-179`）与「按 charId 找回 kit」的 `officialKitKey`（`:142-152`）。

* **9 个新干员的 kit 照本仓约定落位**：`kits/ops/<chessId>-<codename>.js`，进 `KIT_FILES`；**整文件覆盖必炸**（0.3.3 的 kit 文件已含 0.2.x 之后的修正）。
* 炸惊棋库的 104 个基础干员里，**只有 9 位是新的**（颂乐人偶五人 + `aigis`/`kormr`/`makoto`/`yukari`），
  其余 95 位是**同一批官方干员的炸惊形态**——它们的 kit 应该**复用**现有的 `chess_char_*` kit 文件（同样的 charId ⇒
  0.3.3 的 `officialKitKey` 会按 charId 找到它，这正是 `:121-126` 那段逻辑存在的理由）。**不要复制 95 份 kit**。
* `[ASSUMED]` 炸惊形态与官方形态的**差异**只在白值（`allyScale`）与特质（`garrisons` 里的 `garrison_zj_*`），
  不在 kit 代码里。若某个炸惊形态的技能行为与官方不同，那要单独一个 `ver-zj-*.js`，并按 `VERSION_KIT_FILES` 注册。

### 6.4 `gamedata.js` 的方法名变化（照抄会撞空）

| 参考包 | 0.3.3 | 备注 |
|---|---|---|
| `bossPoolHp(bossId, aliveCount, opts={hidden})` | `bossPoolHp(bossId, aliveCount, round)` | 第三参语义不同，见 3.7 |
| `get bossKeys()` | 无 | 要就新增 |
| `bloodPointKey` / `bloodPointDiff()` / `bossPoolHpMul` | 无 | 见 3.1 |
| `get spRounds()` 里读 `process.env` | 无，且不要加 | 见 3.7 |
| `spPhaseKind`（含 `process.env` 包裹） | 已落地，**无 env**（`gamedata.js:566`） | 干净版 |
| `chessInRoster` | 已落地（`:673`） | 名称保留，与参考包一致 |
| `get leftoverFundsKept` / `get interest` / `get shopGift` / `get enemyCountMul` / `get morphEquipSlot` / `diyDisabled` / `get banish` | **均无** | 按 3.1 / 3.8 分批加 |
| `mergeCount` / `poolCopies` | 0.3.3 的 `poolCopies` 多了 co-op 双倍（`:423`，`coopPoolMultiplier`） | 照 0.3.3 的，不要退回参考包版本 |
| `sellPrice` | 0.3.3 多了 `mode.chessSell` 覆盖（`:361` 附近） | 同上 |
| `get generation` | 0.3.3 有 `annihilation` 的三段分支（`:1085`） | 炸惊要**自己在最前面早退**：`if (this.mode.difficulty !== ANNIHILATION_DIFFICULTY) return over ? {...base, ...over} : base` —— 已在，直接复用 |
| `get dp` | 0.3.3 无 `damageCap` / `aspdCap` / `bossKeys`（`:1068`） | 可选加，且必须只在 `zhajing` 时出现 |
| `bans(difficulty)` | 0.3.3 有 `endless` 与 `ANNIHILATION` 的派生分支（`:1116`） | 炸惊走 `config.bans[difficulty]` 的默认路径，**不要**落进 ANNIHILATION 分支 |

### 6.5 `items/battle.js` 的 `weaknessRetype` / `addShieldLayer`

* `weaknessRetype(dmg, source, target)`（`content/items/battle.js:885`）：**两参语义保持不变**（它改写 `dmg` 的伤害类型）。
  赤霄剑法用它把全队伤害转弱点。⚠️ 0.3.3 的伤害管线是 `server/sim/attack.js` 的**有序结算**（0.3.2 起的 PRTS 顺序，
  `docs/design/engine.md`）。改类型**必须在结算的哪一步**要按新契约核对一次，不能照 0.3.1 的位置搬。
* `addShieldLayer(battle, target, key, cap = 1)`（`:897`）：签名一致，青排背部用它叠 999 层。
* 判断依据：`server/sim/AGENTS.md` 的结算 API 速查（`dealDamage` / `dealElementDamage` / `dealHPLose` / `heal` /
  `healElement` 与 hook 的选型）。移植这两个卡时先读它。

### 6.6 确定性

`server/sim/` 的硬规则（`AGENTS.md`）：无 Node API、无 `Math.random`、无时钟、无可被引擎近似的 Math
（`Math.hypot/sin/cos/atan2/pow/**` 走 `server/sim/detmath.js`），ESLint + `test/sim/detmath.test.js` 强制。

参考包里要清理的：

| 位置 | 现状 | 改成 |
|---|---|---|
| `modref choices.js:655` | `pool.splice(Math.floor(Math.random() * pool.length), 1)` | `m.rngDraft`（或 `createRng(deriveSeed(m.seed, 'jibian:roguelike'))`） |
| `modref choices.js:529` / `gamedata.js:567,582,665` | `process.env.SP_JIBIAN_FORCE` / `SP_ZHAJING_SKIP_SP` | 删（开发开关不进生产；要「无惊变的炸惊」用空 `spPhaseKinds` 表达） |
| `modref player/cheat.js` | 整份 `process.env` 测试模式 | 不移植（0.3.3 无此文件） |
| `modref ejibian.js:305,313` | `battle.rng.chance(0.001)` / `(0.1)` | ✅ `battle.rng` 就是种子化 RNG，**可以直接用**（这是对的写法） |

---

## 七、风险清单（静默失效）

按「发现难度 × 后果」排序。这一节的每一条都**不报错**。

| # | 风险 | 表现 | 怎么钉住 |
|---|---|---|---|
| **R-1** | `effectsMeta.js:73 KEY_RE` 少 `jibian` | 99 张惊变的**整备侧**全部不生效（`TypeError` 被 `content/index.js:433` 吞掉），服务器照常启动，玩家拿到一张什么也不做的卡 | **I-11** |
| **R-2** | `content/index.js:58 DOMAIN_NAMES` 少 `jibian`/`ejibian` | 惊变卡有卡面、有文案，**战斗侧一点效果也没有**（`safeImport` 把缺失文件变成 `{}`，`installContent` 只 `_error` 不抛） | **I-9** |
| **R-3** | `gd.zhajing` 门写错（例如拿 `modeId` 而 mode 记录的 `difficulty` 写错，或反之） | 最坏情况：**主玩法被污染**（一个普通房间用了炸惊的盟约数值/棋库）或炸惊退化成官方数值。两种都不报错 | **I-1 / I-2 / I-4 / I-7** 的正反两面 |
| **R-4** | `visibleChess` 过滤漏（例如只加了 `zhajing === true` 而忘了在非 ZHAJING 排除 `zhajing !== true`） | 主玩法卡池一次性多 205 条记录；商店、奖池、`drawDisabledBonds` 全部偏移。**golden 会动**（有救） | **I-1** + golden |
| **R-5** | `choices` 奖池 id 映射（`gd.chessInRoster`）没接进 `spDraft.rollPool` | 玩家拿到「灰毫」，但它是**普通记录**：同名、`baseId` 不同、**永远合不了精锐**。玩家会报「三个灰毫放一起没精锐」，而代码里没有任何错误 | **I-7** 的加强版：断言 `rollPool` 在 ZHAJING 下返回的 id 满足 `DATA.chess[id].zhajing === true`（对 `pool_char_pinus` / `pool_chess_glady` 各跑一次） |
| **R-6** | **版本数据被污染**：`tools/build-data.mjs` 的 zj 合并没按 `IS_DEFAULT` 门 | `data/versions/*/chess.json` 多出 205 条 zj 记录。**表面上什么都正常**（非 ZHAJING 的收集器会过滤），但四个版本的 `cs` 变了 → **所有版本房的存档/回放失效** | **I-6**；数据侧照 `:3368` 的 `if (IS_DEFAULT && …)` 写 |
| **R-7** | 协议 / 大厅的 `switch` 少 `case`，或 `setDifficulty` 白名单没收 `ZHAJING` | 建房被**静默改成标准难度**（`lobby.js:967-970` 的 `: DEFAULT_DIFFICULTY`），玩家开着「炸惊」玩官方局。与湮灭的五环是同一个坑 | 第 3.6 节的五环 + 一条 WS 级测试（`test/helpers/wsClient.js`）：`room.create{difficulty:'ZHAJING'}` 之后 `room.state.difficulty === 'ZHAJING'` |
| **R-8** | `hiddenCore.difficulties` 没有 `ZHAJING` | 炸惊**永远不出隐秘核心**：`finalAssault.js:137` 的 `hiddenEligible` 返回 false，玩家打完最终攻势就结束 | 一条 `gd.isHiddenRound(...)` / `hiddenEligible(gd,…)` 的断言 |
| **R-9** | `bossPoolHp` 拿不到 `bloodPoint.ZHAJING` | 静默回落 `Object.values().find()` = **娱乐（FUNNY）难度**的领袖血量（`gamedata.js:254` 的兜底） | 断言 `bossPoolHp('boss_1', 1) > bloodPoint.FUNNY`，或直接断言等值于 ZHAJING 列 |
| **R-10** | `withZjView` 只包了 `installContent`，没包 `step()` | 装配期是炸惊记录，**战斗中读回基础记录**：盟约阈值/数值在被 `bonds/*` 读的那一刻是普通模式的。表现为「炸惊的盟约改了但打起来没感觉」 | 一条 `makeBattle` + `b.step()` 的断言：战斗中途 `support.bondRecord('egirShip')` 的 `thresholds` 是炸惊的 |
| **R-11** | 惊变羁绊 / 惊变卡被主玩法的**读点**看到 | 见 7.1 的读点表 | **I-5**（publicView）+ **I-8**（charId 集合） |
| **R-12** | 参考包的 `Math.random` 带进 `server/match/` | golden 不稳（同种子跑出不同结果）、回放不可复现。⚠️ `server/match/` **不在** ESLint 的 sim 规则里，不会有人拦住 | 移植时逐行搜 `Math.random`；`grep -n "Math.random" server/match/` 必须为空 |

### 7.1 「zj 记录被主玩法的图鉴/收藏/随机池读到」的所有已知读点

这是本文最容易被忽略的一节：**收集器过滤的是「池子」，不是「映射」**。任何 `Object.entries(data.chess)` 的代码都看得见 zj 记录。

| 读点 | 文件:行 | 过滤？ | 后果 |
|---|---|---|---|
| `gd.visibleChess` | `gamedata.js:207` | ✅ 已门 | — |
| `gd.drawDisabledBonds` / `SharedPool` | `pool.js:44` / `:68` | ✅ 经 `visibleChess` | — |
| `operatorCharIds(data)` | `shared/protocol.js:315` | ❌ **看全部 chess** | 皮肤选择器为不在棋库里的 9 位干员提供皮肤（**I-8**） |
| `cultivationCharIds(chess, backups)` | `shared/protocol.js:212` | ✅ 要求 `visible !== false` | 主玩法安全；**ZHAJING 里反而功能缺失**（3.3 的 `player/basics.js:21`） |
| `checkLoadout` 的目标集合 | `server/match/player/basics.js:99` | 经 `gd.chess` + `visible`？→ 需按 `shared/protocol.js` 的 `LOADOUT` 校验核对 | `[ASSUMED]` 安全；要加一条「干员调配只列 `visibleChess`」的断言 |
| 图鉴 / S.W.E.E.P. | `public/js/screens/sweep.js`（读 `/data/*.json`） | ❌ 客户端直接读整份 `chess.json` | 图鉴里会列出 205 条 zj 记录（**在非 ZHAJING 房间也一样**，因为客户端读的是同一份文件） |
| 随机发放 / 升星奖励 | `Match.rollItemId` / `rollPool` / `acquire.grantChess` | 经 `pool`（`visibleChess`）✅ | 安全 |
| `data/choices.json` 的奖池 | `spDraft.rollPool` 的 `p.items` / `p.weighted` | ❌ **按 id 直查**，不过池子 | 见 **R-5**（这就是 `chessInRoster` 存在的原因） |

`[ASSUMED]` 客户端图鉴（`sweep.js`）那一条**是真实泄漏**：它读的是 `/data/chess.json` 原文。处置选项：
①让它按 `visible` 过滤（客户端本来就有页面级过滤？需核对）；②接受（图鉴展示全表是产品口径，由业主定）。见第 8 节 Q-4。

---

## 八、待裁决

写给业主 / Lead 的开放问题。每条给出「不决的后果」与本文的推荐，不自作决定。

**Q-1 敌方惊变要不要独立 PHASE？**
参考包用 `PHASE.ENEMY_JIBIAN` / `PHASE.HIDDEN_JIBIAN` 两个新阶段 + 阻塞式揭晓动画。
*不决的后果*：阶段一加，0.3.3 里**每一个** intent 的 `WRONG_PHASE` 守卫都要审一遍（`server/match/match/intents.js` 几十处），
客户端也要加一个新 phase 的渲染分支——这是「协议 switch 少 case」风险族里最大的一处。
*本文推荐*：**不新增 PHASE**。`startRound` 里同步抽牌（服务端、确定性），把结果放进 `m.public.enemyJibian`，
揭晓动画交给客户端自己播（`flickerMs` / `resultMs` 只是客户端的两个时长字段）。代价：动画期间玩家仍可操作整备；
收益：零协议改动、零守卫审查。若要「不可跳过」，再用 `paused` 那套帧级状态，而不用新阶段。

**Q-2 变形同构体「不占格」走 `gd.morphEquipSlot` 还是复用现成的 `morphPairing: 'plus'`？**
0.3.3 已经把这件事做成了**房间规则开关**（`shared/plugins/rules.js:36-39`、`morphSlotPolicy`、`invariants.js:105`），
而炸惊的模式字段是 `morphEquipSlot: true`。
*不决的后果*：两条路并行 → 两处装备槽判定口径不一致 → `invariants.js` 误报（`BAD_TARGET` / `carries N items`）。
*本文推荐*：**复用 `morphPairing: 'plus'`**，但**前提是**先裁决「内置玩法模式能不能声明房间规则」——
`rules` 现在是插件概念，并且**进 `cs` 哈希**（`shared/plugins/rules.js:6`）。若内置模式不许声明，就走 `gd.morphEquipSlot`，
并且 `_isMorphItem`（`player/items.js:109` 一带）与 `invariants.js:105` **必须共用同一个 policy 对象**。

**Q-3 `bondLayerCap: 9999` 怎么落地？**
0.3.3 的层上限是进程级 `bondLayerCapLive`（`shared/constants.js:130-140`，超限局用 `setBondLayerCap(9999)` 临时抬高）。
*不决的后果*：若照超限的做法，炸惊一局开局抬高全局值 → 同进程里**并行的普通房间**也会叠到 9999（跨房间污染，正是本项目最怕的那种）；若不抬高，炸惊的 9999 层上限不生效。
*本文推荐*：**不走全局**。按 `flags.bondLayerCap`（战斗侧）/ `gd.bondLayerCap`（整备侧）各自夹；
或者给 `layerGainRoom(before, n, cap?)` 加**可选**第三参，`undefined` 时行为与现在完全一致（golden 零位移）。
⚠️ 顺带指出：`setBondLayerCap` 这个全局开关**本身**就是超限模拟残留的跨房间风险点，建议记进 `docs/INFINITE_MODE.md` 的待办。

**Q-4 客户端图鉴（S.W.E.E.P. / 干员一览）要不要按模式过滤？**
它读 `/data/chess.json` 原文（`public/js/screens/sweep.js`），非 ZHAJING 房间也会看到 205 条 zj 记录。
*不决的后果*：图鉴里出现 104 个玩家在自己对局里遇不到的干员（纯展示污染，不影响玩法；但这是「不污染主玩法」最字面的一条）。
*本文推荐*：图鉴按 `visible === true && zhajing !== true` 过滤（**与 `visibleChess` 同一口径**，抽成 `shared/` 的一个
纯函数给两端共用），ZHAJING 房间反过来只显示 zj 棋库。这一条会改客户端，所以需要业主确认。

**Q-5 敌方惊变（`enemyJibian`）在本轮做不做？**
它是**全场共用、只增不减**的全局敌人增益，会影响出怪表（`match/waves.js` 现在没有 `plan` 参数）。
*不决的后果*：如果本轮不做，`gd.enemyJibian()` 会返回非 null 但没有任何地方消费它——**又一个静默空转**（和藏品钩子「写对了但没人调」同一类）。
*本文推荐*：**要么本轮做完（`waves.js` 的 `buildNormalWave` / `buildBossWave` 加 `plan` 参数，`startRound` 抽牌），
要么在 `gamedata.enemyJibian()` 里直接 `return null` 并在 `docs/EXTENSION_MODE.md §8` 写明「本轮未接入」**。
最不能接受的是「读得到、没人用」：它会让下一轮的实现者以为已经接好了。

---

## 附录 A：本文写作时的落地状态（2026-10-28 快照）

供 engine / data / content 三方对齐进度用。**行号会漂，符号不会。**

| 区 | 状态 |
|---|---|
| `shared/zjBonds.js`（142 行） | ✅ 已落地 |
| `shared/zhajingBase.js`（46 行） | ✅ 已落地 |
| `shared/zhajing-constants.js` | ⏳ **缺失**（`gamedata.js:185` 有 TODO 指向它；`difficulty === 'ZHAJING'` 目前是字面量） |
| `server/match/gamedata.js` | ✅ 大部分落地（`:188 zhajing`、`:197 zjCombos`、`:199 zjBondView`、`:207 visibleChess`、`:219 shopItems`、`:535 allyScale`、`:551 bondLayerCap`、`:554-566 spPhaseKinds`、`:579 jibian`、`:614 enemyJibian`、`:645-660 express*`、`:673 chessInRoster`、`:692 zhajingFlags`、`:898-901 spRounds 补洞`、`:1152 bandAllowed`）。⏳ 缺：`income`/`benchSize`/`equipPerChess`/`leftoverFundsKept`/`interest`/`hiddenBossHpMul`/`diyDisabled` |
| `server/sim/{Battle.js, battle/players.js}` | ✅ `this.zj` + `withZjView` + `allyScale` 折白值 |
| `server/sim/content/index.js` | ✅ `DOMAIN_NAMES` 含 `jibian`/`ejibian`/`jibianBonds` |
| `server/sim/content/support/index.js` | ✅ `ZJ` 视图 / `withZjView` / `combos` / `hasJibian` |
| `server/sim/content/{jibian,ejibian,jibianBonds,mujica,mujicaBond}.js` | ⏳ 未落地 |
| `server/match/choices.js`（`express` / `jibian` 家族、`applyDefault`） | ⏳ 未落地（`FAMILY_NAMES` 已加两个名字，其余未做） |
| `server/match/match/{phases,spDraft,settle,views,bossRounds,combat,intents,unitePhase}.js` | ⏳ 未落地 |
| `server/match/{effectsMeta,bondsMeta,builtinMeta,invariants,player/*}.js` | ⏳ 未落地（`effectsMeta KEY_RE` 是 R-1） |
| `server/lobby.js` / `public/js/screens/lobby.js` 的难度白名单 | ⏳ 未落地 |
| `docs/research/17..19-*.json` + `tools/build-data.mjs` | ⏳ 未落地（data 线） |
| `test/match/zhajing-isolation.test.js` / `test/content/zhajing-content.test.js` | ⏳ 未落地 |

## 附录 B：证据索引

| 类别 | 路径 |
|---|---|
| 方向与分工 | `handoff/ZHAJING-SPLIT-PLAN-2026-10-28.md`（§2 隔离架构、§3 P0–P6、§4 写域） |
| 规则分离的三条调查结论 | `handoff/EXTENSION-MODE-2026-10-28.md` §5.2 |
| 玩法包大厅（范式来源） | `docs/EXTENSION_MODE.md` §1–§3（尤其 §3.1 的 17 个钩子、§3.4 的两个静默坑、§3.3 建房通道） |
| 超限模拟（房间 mode 路线） | `docs/INFINITE_MODE.md` |
| 代码地图 | `docs/ARCHITECTURE.md` §1–§3 |
| 引擎 API / hooks / 测试 harness | `docs/SIM.md`（§4 伤害管线、§6 公开 API、§10 harness）、`server/sim/AGENTS.md` |
| 对局流程 / 商店 / 协议 | `docs/META.md`、`docs/design/match.md`、`docs/design/network.md` |
| 数据生成（不手改 `data/`） | `docs/DATA.md`、`tools/build-data.mjs`（`:3368` 是「research 只进默认数据集」的先例） |
| 参考实现 | `modref/v2.1/{shared/zjBonds.js, shared/zhajingBase.js, server/match/gamedata.js, server/match/choices.js, server/match/match/{spDraft,phases}.js, server/sim/content/{jibian,ejibian,jibianBonds}.js}` |
| 测试 helper | `test/match/harness.js`、`test/helpers/battleHarness.js`（`hashOf:382`）、`test/helpers/wsClient.js`、`server/match/scheduler.js` |
| 既有回归锁（写法参照） | `test/match/annihilation-mode.test.js`、`test/match/annihilation-erosion.test.js`、`test/match/layercap.test.js`、`test/match/morph-bonds.test.js` |

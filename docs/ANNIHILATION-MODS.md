# 湮灭模拟专属 mod 的隔离设计与「功能设置」界面规格

本文处理业主 2026-10-28 晚的第二批输入：**8 个 mod 包**（`modref/mods/`，只读）要被做成「**只在湮灭模拟生效**」
的能力，并把它们的开关收进**二级页（湮灭主题大厅）上的一套设置界面**。

* 上游：[`handoff/ZHAJING-SPLIT-PLAN-2026-10-28.md`](../handoff/ZHAJING-SPLIT-PLAN-2026-10-28.md) §2 的「模式标记 + 模式门」范式（已在炸惊上落地）。
* 姊妹文档：[`docs/ZHAJING.md`](ZHAJING.md)（同范式的第一个实例，本文大量引用它的 I-1..I-12）、[`docs/EXTENSION_MODE.md`](EXTENSION_MODE.md)（玩法包大厅 / 主题大厅）、[`docs/PLUGINS.md`](PLUGINS.md)（插件与内容集 `cs`）、[`docs/WORKSHOP.md`](WORKSHOP.md)（`workshop/` 工坊包，**这批 mod 的原始格式**）、[`docs/INFINITE_MODE.md`](INFINITE_MODE.md)（房间级开关的先例）。
* 规则是 `docs follow the code`。本文描述**当前工作区**的行为与**建议的落点**；建议部分标 `[ASSUMED]` 或「建议」。

> **本文的位置（已收口，2026-10-28 晚）**
> `docs/design/` 是 `docs/DESIGN.md` 的分卷目录，`test/docs-paths.test.js` 要求该目录下**每一个** `.md` 的标题都是
> `# DESIGN §N — …` + `Part of [DESIGN.md](DESIGN.md)`，章节号且须全局唯一、0 连续、被索引表登名（§0–§37 已占满）。
> 本文不是 DESIGN 的某一节，所以**不用数字编号标题**（否则 `test/helpers/designDocs.js` 会抛 `§N appears twice`），
> 也因此**已经搬到 `docs/ANNIHILATION-MODS.md`**（与 `EXTENSION_MODE.md` / `INFINITE_MODE.md` 并列，零测试代价），
> 与 `docs/ZHAJING.md` 同批处置完毕。将来若要升格成新的 DESIGN 分卷，再补 `docs/DESIGN.md` 的索引表那一行。

---

## 一、定位与边界

### 1.1 这 8 个包到底是什么

全部是**工坊包**（`workshop/<id>/pack.json`，manifest 1，`api: ">=1 <2"`，`app: "0.2.6"` / `"0.3.0"`），
不是 0.3.0 起的插件（`plugins/<id>/plugin.json`，manifest 2）。两类混在一起看会走错路，先分开：

| # | 包 | 形态 | 实际改动 | 我们的落点 |
|---|---|---|---|---|
| 1 | `egir-buff` | `bonds.json`（1 条盟约文案覆盖）+ `chess.json`（3 名干员 × 男女 = 6 条 `bonds` 覆盖）+ `battle/main.mjs`（77 行） | 【阿戈尔】开局按层数给 `atkFlat`；5 名档复活额外 +50 攻速 | **数据**（`bonds.egirShip.ann` 文案）+ **引擎**（一个 `bonds/*.js` 分支） |
| 2 | `comms-priority` | `meta/comms.mjs`（145 行，纯 `registerMeta`） | 简易通讯机 / 寻呼模块 的抽人改成「携带者层数最高的核心盟约优先」 | **引擎**（`builtinMeta.js` 两个处理器的一个分支） |
| 3–6 | `prep-loadout` / `unequip` / `morph-plus` / `shop-bond-bias` | 每个只有 `pack.json` 的 `behaviour: [{switch, option}]` | 就是 `shared/plugins/rules.js` 的四个开关 | **界面 + 路由**（开关**已经实现**，缺的是「谁能打开它」） |
| 7–8 | `rhodes-ship` / `kazdel-ship` | 完整 mod（`install.mjs` 49 189 B + `payload/packs/<id>/`） | 新盟约 `rhodesShip` / `kazdelShip`；各 2 件新装备（4 条记录 = `_a`/`_b` 各两条：rhodes 是 `_c_03_e`/`_c_04_e`，kazdel 是 `_c_01_e`/`_c_02_e`）；新特质 rhodes 22 条（24 条里 2 条已存在）/ kazdel 8 条（10 条里 2 条已存在）；给若干既有盟约加成员 | **数据**（`annOnly` + `annBonds`），**不要**搬那 500 KB 的 `chess.json` |

### 1.2 关键事实：这批包里有一半是**错的数据**，不能原样合并

我把两个大包的 `chess.json` 与本仓 `data/chess.json` 逐字段比过（脚本见 §6）：

| 包 | `chess.json` 条数 | 本仓已有 | 本仓**没有** | 结论 |
|---|---|---|---|---|
| `rhodes-ship` | 22 | 6 | **16**（全是 `chess_char_9_*`） | 本仓 `chess_char_9_*` 记录数 = **0** |
| `kazdel-ship` | 18 | 8 | **10**（同样 `chess_char_9_*`） | 同上 |

而「本仓已有」的那几条，是 **0.3.0 年代的整条快照**，字段差异远不止 `bonds`：

```
rhodes chess_char_6_12_a  mod: bonds ["rhodesShip","preciShip"]   ours: ["preciShip","visiShip","emptyShip"]
kazdel chess_char_4_26_a  mod: bonds ["miraShip","kazdelShip","rhodesShip"]   ours: ["miraShip"]
```

也就是说：**原样合并会「减」盟约**（`visiShip` / `emptyShip` 被抹掉），并可能把 0.3.3 已修过的 `tier` / `stats` /
`skills` / `talents` / `module` / `price` 回退（rhodes 6 条里有 2 条、kazdel 8 条里有 4 条在这些字段上不同）。

同样地，`records.json` 对 6 条既有盟约的 `members` / `visibleMembers` 覆盖是**纯增**（0 删除），增的绝大多数是
不存在的 `chess_char_9_*`，只有 `chess_char_6_23_a` / `chess_char_5_06_a` 这类真记录。

**结论：这两个包唯一能取的东西是「意图」，不是记录。** 意图 = ①两个新盟约；②新装备 2、新特质 22；
③「这些既有干员在湮灭里还算某个新盟约的成员」。第 ③ 项用一张小表表达（§2.1），不要 500 KB 快照。

### 1.3 四条边界

| 对照 | 是什么 | 为什么这批包**不该**走那条 |
|---|---|---|
| **插件内容集**（`plugins/<id>/`，manifest 2） | 房间选插件 → 一个内容集 → 自己的 `cs` 哈希 → 自己在 match host（子进程）里跑 | ①`plugins/*` 被 `.gitignore`（`.gitignore` 的 `plugins/*` 一段），**装不进仓库**，玩家默认没有；②内容集的 `cs` 把整个 `sim/**` 哈希进去，一动代码就掉存档（`handoff/EXTENSION-MODE-2026-10-28.md` §5.2）；③**每个房间都要手动勾**，业主要的是「进了湮灭就生效」；④这批包根本不是 manifest 2 |
| **官方版本数据**（`data/versions/*`） | 真·独立数据集 + 独立 host + 自己的 `cs` | 同上；且版本的语义是「同一套玩法、不同时期的官方数值」，不是「额外玩法」 |
| **工坊包**（`workshop/<id>/`，manifest 1） | **确实能装**（`server/workshop.js:101 loadWorkshop`），且**已经支持按房间物化**（`server/roomAssets.js:35 createRoomAssets` / `:58 forRoom` / `:82 applyWorkshop(official, chosen)`） | ①`workshop/` 在仓库外、运维手装（`WORKSHOP_DIR`，`server/workshop.js:43`），不是仓库内容；②按房间物化 ≠ 按**模式**：房间一旦勾了集合，任何难度都吃，**没有「只在湮灭生效」这个概念**；③overlay 是**整条记录覆盖**（`applyWorkshop`），正是 §1.2 那类回退的来源；④清单 `api >=1 <2` 是上一代的接口，本仓 0.3.3 的对外能力走插件（`docs/PLUGINS.md`） |
| **炸惊的范式**（`zhajing` / `zjOnly` / `zj` 块） | 记录标记 + 收集器过滤 + 同形覆盖块 | **这就是要复用的那条**。差别只在：炸惊的门是 `difficulty === 'ZHAJING'`，湮灭的门是 `gd.annihilation`（已经存在，`server/match/gamedata.js:452`） |

**一句话**：这批包要以**湮灭玩法包自带的规则与内容**进仓库——数据是生成物（`docs/research/*.json` → `data/*.json`），
引擎是 `gd.annihilation` 后面的分支，界面是主题大厅上的一个设置面板；**不装包、不选包、不产生新的 `cs`**。

### 1.4 与炸惊的差异（一句话版）

炸惊是**一个难度**（`ZHAJING`），它换棋库、加卡牌系统；湮灭 mod 是**一个玩法包里的可选能力**，它不换棋库、不加卡牌，
只在既有湮灭局里改 4 个开关 + 2 条盟约的数值 + 2 个装备的抽人规则 + 1 条盟约的战斗行为。
所以炸惊需要「子门」（`jibian` / `enemyJibian` / `allyScale`），湮灭 mod 只需要**一层门（`gd.annihilation`）+ 一套设置**。

---

## 二、三层落点

### 2.1 数据层：三个标记 + 一张小表

照炸惊的三个标记平移，命名带 `ann` 前缀，**互不干扰**（`check-mode-isolation.mjs` 现在只认 `zj*`，要同样加 `ann*`）：

| 标记 | 位置 | 语义 | 平行物 |
|---|---|---|---|
| `annOnly: true` | `data/bonds.json`、`data/items.json` 的**新记录** | 只有 `gd.annihilation` 非空的模式才收它 | `zjOnly`（`gamedata.js:219`、`:1152`） |
| `ann: { … }` | 既有记录的**覆盖块**（先只用于 `bonds`） | 湮灭下的覆盖字段；与 `zj` 块**同形、同一套合并规则** | `zj`（`shared/zjBonds.js`，179 行） |
| `annBonds: ['rhodesShip', …]` | `data/chess.json` 的记录 | **额外**盟约成员资格（并集，不是替换） | 无（炸惊没有这一项） |
| `annihilation: true` + `visible: false` | `data/chess.json` 的 **mod 自带干员**（26 条 = 13 名 ×两形） | 官方池的判据 `visible === true && zhajing !== true` 看不见它；`annihilationRoster` 按它的 `annBonds` 边 + 房间开关决定它进不进湮灭名册 | `zhajing: true`（同构：都不改 `isOfficialVisibleChess`） |
| 无标记 | `data/garrisons.json` 的 **mod 特质**（26 条） | 只经 `chess[].garrisonIds` 可达；`battleRuneKey` 缺省补 `null` | 炸惊的 248 条卫戍（同一口径） |

**为什么 `annBonds` 是「并集」而不是「覆盖 `bonds` 数组」**：这是 §1.2 的直接结论。
`bonds` 数组一改就是替换语义，而 mod 的意图是「还算这个盟约的成员」。所以：

```js
// 建议：一个纯函数，两端共用（shared/annBonds.js，与 shared/zjBonds.js 并排）
export function annBondsOf(record, enabled) {
  if (!enabled || !record || !Array.isArray(record.annBonds) || !record.annBonds.length) return record?.bonds ?? [];
  const out = Array.isArray(record.bonds) ? record.bonds.slice() : [];
  for (const b of record.annBonds) if (typeof b === 'string' && b && !out.includes(b)) out.push(b);
  return out;
}
```

**合并点在哪（这是本节的重点，两个读点都必须改，漏一个就是「界面算 6 人、战斗算 3 人」）**：

| 侧 | 读点 | 现状 | 改法 |
|---|---|---|---|
| 整备（match） | `server/match/bondsMeta.js:39 pieceBonds(gd, piece, rules)` → `:44 grantedBondsByMorph(...)` | 直接读 `piece.bonds`（`bondsOfPiece`） | 改为 `annBondsOf(gd.chess(id), gd.annihilation)` 打底，再叠 morph 授予 |
| 整备（计数） | `bondsMeta.js:54 membership(gd, ps)` / `:101 computeBonds` | 经 `pieceBonds` | 自动跟着上面改好 |
| 战斗（sim） | `server/sim/content/support/index.js:256 unitBonds(u)` | 读 `u.def?.bonds`（def 由 `simdata` 从进程级 `gameData().chess` 造） | **不能用 `u.def.bonds` 直接当答案**：sim 侧必须能拿到「这个房间开没开湮灭 mod」。走 §2.2 的 `Battle` 视图（与炸惊的 `ZJ` 视图同一个机制） |
| 盟约目录（展示） | `bonds[].members` / `visibleMembers` | 由数据管线派生（`server/plugins/gameplayRecords.js:82`、`server/plugins/forgeImport.js:1607`） | 生成器在湮灭数据集里把这批成员写进 `members`/`visibleMembers`，**纯展示**；权威仍是 `chess[].bonds ∪ annBonds` |

> `[ASSUMED]` `bonds[].members` **不是**权威成员表：`forgeImport.js:1594-1607` 的注释写明它是「让目录仍然列出
> 计数已经不再包含的那件棋子」，即**派生**字段。据此，`annBonds` 是真身、`members` 是影子。若实施时发现反过来，
> §3 的 I-4 会立刻红，届时改这一条即可。

**`bonds.egirShip.ann`**：只改文案（`desc` / `descRaw` / `effectDesc` / `effectDescRaw`）——阿戈尔本体数值已经是官方的
（`data/bonds.json` 的 `egirShip`），mod 的 `bonds.json` 只重写描述来提那两条新行为。所以它走 `ann` 块的「文本覆盖」，
数值仍来自官方记录 + §2.2 的两个引擎分支。

### 2.2 引擎层

#### (a) 四个开关：`gd.rulesOf()` 的读取顺序

**现状**：四个开关**已经全部实现并被消费**，只认 `m.rules`：

| 开关 | 消费点（已存在） | 默认（`options[0]`） |
|---|---|---|
| `shopBias` | `server/match/player/economy.js:78-86` → `server/match/pool.js:156 rollItem(rng, maxTier, stock, bias)` | `official` |
| `prepLoadout` | `server/match/match/platform.js:94`（+`server/lobby.js:1795` 的房间摘要） | `locked` |
| `morphPairing` | `server/match/bondsMeta.js:45`、`server/match/invariants.js:105-107`、`server/match/bot.js:2360`、`server/match/match/rehearsal.js:67/112` | `official` |
| `unequip` | `server/match/player/items.js:199-201`、`server/match/aiDigest.js:96` | `official` |

**缺口只有一处**：`m.rules` 目前来自 **插件内容集**（`server/match/Match.js:328` 收 `opts.rules`；`server/lobby.js:2171`
从 `room.content.rules` 发出）。没有插件的房间 ⇒ `rules` 是 `undefined` ⇒ 四个开关恒为官方默认。

**建议形状**（`[ASSUMED]`，需 Lead 裁决，见 §5 Q-1）：

```js
// server/match/gamedata.js —— 与 get annihilation 并排
/**
 * 四个规则开关的最终值。合并顺序（低 → 高）：
 *   ① 开关自己的缺省（shared/plugins/rules.js RULE_SWITCHES[name].options[0]）
 *   ② mode.annRules —— 数据侧默认（可选；将来某个玩法包想自带默认值就用它）
 *   ③ room.annMods —— 房主在设置面板里选的（**只有 gd.annihilation 非空时才看**）
 *   ④ 插件内容集的 rules —— 最强声明；与 ③ 冲突时它赢，并响一声（PLUGIN_RULE_CONFLICT 风格）
 */
rulesOf(name) { return ruleOption(this.rules, name); }
get rules() { /* 按上面四层合成，frozen */ }
```

四条约束：

1. **`annMods` 不进 `cs`。** 它与 `erosion` 同级（房间级设置，`room.state` 里发），不是内容集的一部分。
   这条必须写死：一旦进了 `cs`，换个开关就等于换内容集 → 独立 match host → 正是 §1.3 要避免的东西。
2. **只有 `gd.annihilation` 非空时 ③ 才生效**；官方四档、炸惊、超限房里 `room.annMods` 一律被忽略（且**不报错**，
   因为它是上一个房间的残留值时不该炸）。
3. **面板里能出现的行 = 数据说的**：哪几个开关出现在设置界面，由湮灭的 mode 记录声明（建议 `mode.annRules` 的键集，
   或 `mode.annMods: ['shopBias', …]`），**不在客户端写死四个**。理由与 `EXTENSION_MODES` 的「1 → N」同源。
4. **冲突要响**：插件与房间设置对同一开关给出不同选项时，插件赢 + 一条 `m.toast`（`i18n` 走 msgid，字面量先报 Lead）。

「内容」开关（§2.3 的 5–8 行：`egirBuff` / `commsPriority` / 两条新盟约）**不是** `RULE_SWITCHES` 的成员，
它们是布尔开关，同一份 `room.annMods` 承载，读取口单独一个：

```js
// 非湮灭模式恒 false —— 与 rulesOf 同一道门，但语义是「这个内容开了没有」
annMod(name) { return !!(this.mode && this.mode.annihilation && this.annMods && this.annMods[name] === true); }
```

这样两类开关共用一个「房间设置」对象、一条协议、一个面板，但**不会被 `ruleOption` 的白名单吞掉**
（`ruleOption` 对未知开关名返回 `''`，拿它读布尔开关永远是假 —— 这是最容易写出的一个静默 bug）。

#### (b) 阿戈尔的两条（`egir-buff/battle/main.mjs` 的第一条 + 第二条）

这个包**只做官方没有的两件事**，其余全交给官方 `bonds/core.js` 的 `installEgir`。移植时保持这个分工：

| 行为 | 落点 | 门 | 注意 |
|---|---|---|---|
| 开局按当前层数给 `atkFlat = 0.5 × 层数` | `server/sim/content/bonds/core.js` 的 `installEgir` 内，`battleStart` 里**官方 devour 之后** | `battle.flags.annMods?.egirBuff === true` | 必须有「晚于官方」的顺序保证：mod 用第二个 `battleStart` 监听器拿到「含吞噬叠加」的层数。在 `core.js` 里就是**同一个函数里排在 devour 之后**，比钩子顺序更可靠 |
| 5 名档「真的被救起来」的那名额外 +50 `aspd` | 同上，`death` 钩子（官方 `priority: 11`，我们排它后面） | 同上 | 判据「真的被救起来」= `u.alive && !u.removed`，且 `c.reason === 'killed' && !c.revivedBy`（mod 原文逐字） |

> 那个包 import 的是 `@battle/index.js`（工坊的 `registry.api` 别名，本仓**没有**）。等价物是
> `server/sim/content/support/index.js`：`bondActive`(:187)、`bondLayers`(:189)、`bondMembers`(:288)、
> `bondRecord`(:50)、`num`(:35)、`passiveBuff`(:375) —— **六个全在，签名一致**，不需要新 API。
> `atkFlat` 这个 mod 键在 0.3.3 的 `units.js` 里存在（与 `atkPct` 不同桶）——实施时先用一条 `makeBattle` 断言确认。

#### (c) 通讯机 / 寻呼模块（`comms-priority/meta/comms.mjs`）

**这是最容易做错的一处。** mod 的写法是 `registry.item('chess_item_2_06_e', …)`，但 0.3.3 的内置逻辑注册在
**buff key** 上（`server/match/builtinMeta.js:382` 的 `reg.register('effect:' + k, h)`）：

| 机制 | 键 | 谁注册 | 触发 |
|---|---|---|---|
| 装备处理器 | `item:<itemKey(effectRef ?? id)>` | 默认**没有任何内置处理器** | `effectsMeta.js:412 dispatchItem` |
| 效果处理器 | `effect:<buffKey>` | `builtinMeta.js:118`（简易通讯机）、`:171`（寻呼模块） | 装备的 `buffs[].key` 派发 |

所以：

* **在 `item:` 上加处理器 = 双发**（内置的 `effect:` 那一半照跑），不是覆盖。**不要这条路。**
* 正确做法：**在 `builtinMeta.js` 的两个处理器内部加一个分支**（最简单，零注册术语），或者注册
  `effect:use_equip_reward_char_chess_with_same_bond` 覆盖内置（`effectsMeta.js:93` 是「后注册赢」，
  但**注册顺序**成了隐式契约，脆）。

建议分支的口径：把 mod 的 `rewardBondOrder`（145 行里 34-53 行）作为纯函数搬进一个新模块
（建议 `server/match/bondReward.js` —— mod 的注释说它逐句移植自 `shared/bondReward.js rewardBondOrder`），
处理器里 `if (gd.annihilation && gd.annMod('commsPriority') === true) { …新口径… } else { …官方… }`。
（`annMod` 是「内容」开关的读法，见 §2.2(a) 末尾；四个 `rulesOf` 开关名走 `ruleOption`，`annMod` 只管
`egirBuff` / `commsPriority` / 两条盟约这类布尔内容开关。）

mod 用到的 `ctx` 成员 0.3.3 **全都有**（`effectsMeta.js:494 makeCtx`）：`gd`(:529)、`rng`(:530)、`layers`(:550)、
`pieceBonds`(:569)、`shopLevel`(:545)、`rollChess`(:649)、`grantChess`(:611)、`offerChess`(:717)、`toast`(:764)、
`buffParams`（`support/index.js:154`，mod 通过 `registry.api` 拿的就是它）。`gd.bondIds` / `gd.bond(id).isCore` /
`bondOrder` 也都在（`gamedata.js:196`）。

> ⚠️ **i18n 差异**：mod 的 `toastNothing` 用硬编码中文（因为工坊 API 没给 `msg`）。搬进内置处理器时必须改走
> `msg(...)` / `t(...)`（`builtinMeta.js` 现有那条就是这么写的）。**新增字面量先报 Lead**（沿用本仓纪律）。

#### (d) 两个新盟约的「效果」从哪来

> **2026-10-29 已落地**：两条盟约的战斗效果实现在 `server/sim/content/bonds/addon/annbonds.js`（21 个 bb 键全部有读点，
> 数值一律取自 `data/bonds.json`，语义反推处标 `[ASSUMED]`），整备侧另接「层数 → 断角」里程碑；两侧开关判据共用
> `shared/annihilation-constants.js` 的 `ANN_MOD_DEFAULT_ON` / `annModOn`。回归：`test/content/annihilation-bonds-effects.test.js`。

`rhodesShip` / `kazdelShip` 的**文案与数值袋**写在 `records.json` 的 `bonds` 里（`effectId: bondeffect_rhodes` 等），
但本仓 `bonds/*.js` 是按 bondId 手写的战斗实现 —— **新盟约没有实现就是「只有文案、没有效果」**（静默）。
所以这两个包的真正成本在**两条 `bonds/addon/*.js`**，`annOnly: true`，并在 `bonds/addon/battle.js` 的注册表里加两行。
（与炸惊的 5 条新盟约同一个做法；`bondeffect_rhodes` / `bondeffect_kazdel` 在本仓**没有**现成实现，是照数值袋手写的。）

### 2.3 界面层：主题大厅上的「功能设置」面板

**位置**：`public/js/screens/extensionThemeHall.js` 的 footer（`:73` 起），在「单人 / 同盟」与「蚀流」之间插入一个
`功能设置` 按钮（与 `攻略说明` 同形，`:67-70`），打开**同一个 Modal 族**的二级面板。

**为什么是主题大厅而不是房内**：主题大厅是「选完玩法包之后」的一屏（`docs/EXTENSION_MODE.md` §3.6），
业主的心智是「这个玩法包有哪些开关」；而**房内可改**是业主在超限上已经明确要求过的
（`handoff/EXTENSION-MODE-2026-10-28.md` §1.2：「同盟选择时的超限不要单独列出，改成像单人一样，可以在房间内选择超限难度」）。
所以两处都要，**同一套状态、同一套协议**（见 §2.3.3）。

#### 2.3.1 字段级规格（每行一个开关）

| 行 | `data-testid` | 标签（msgid） | 取值 | 默认 | 关闭时回到 | 说明行 |
|---|---|---|---|---|---|---|
| 1 | `ann-rule-shopBias` | `商店装备偏向已激活盟约` | `official` \| `bondBias` | `official` | 官方：装备槽不问盟约 | 「只偏置，不额外给装备」 |
| 2 | `ann-rule-prepLoadout` | `休整期可调整技能与模组` | `locked` \| `prep` | `locked` | 官方：调配锁定后不可改 | 「仅本座位未点准备时」 |
| 3 | `ann-rule-morphPairing` | `变形同构体不占格，仅配对最左盟约装备` | `official` \| `plus` | `official` | 官方：占一格，且每件都授予 | 「第二件变形同构体仍被拒」 |
| 4 | `ann-rule-unequip` | `可以卸下装备` | `official` \| `allow` | `official` | 官方：装上后只能精英化 / 合成 / 卖出 | 「退回手牌，手牌满进临时整备区」 |
| 5 | `ann-mod-egirBuff` | `阿戈尔加强` | `off` \| `on` | `off` | 官方 `installEgir` 原样 | 「开局按层数 +0.5×层数 攻击力；5 名档复活 +50 攻速」 |
| 6 | `ann-mod-commsPriority` | `通讯机与寻呼模块` | `off` \| `on` | `off` | 官方：随机同盟约干员 | 「优先携带者层数最高的核心盟约」；协议键是长名 **`commsPriority`**（`comms` 只是服务端别名） |
| 7 | `ann-mod-bond-rhodesShip` | `罗德岛盟约` | `off` \| `on` | **`on`**（2026-10-29 业主口径） | 官方：没有这条盟约 | 战斗侧 `annbonds.js`：3 名档攻/生命按层数、6 名档治疗加成 / 回技力 / 生命与元素回复 |
| 8 | `ann-mod-bond-kazdelShip` | `卡兹戴尔盟约` | `off` \| `on` | **`on`**（同上） | 同上 | 战斗侧：对受控目标伤害加成、攻速、真伤追击、9 名档「活性源石风暴」；整备侧 100 层 → 断角 |

> 5–8 行的中文标签以**已落地的四语言包**为准（`阿戈尔加强` / `通讯机与寻呼模块` / `罗德岛盟约` / `卡兹戴尔盟约`）；
> 2026-10-29 两条新盟约的效果接上后，去掉了原先的「（仅计数与展示）」后缀。
> 默认值口径：`rhodesShip` / `kazdelShip` **缺省开**（`shared/annihilation-constants.js` 的 `ANN_MOD_DEFAULT_ON`），
> 房间显式 `false` 才关；`room.state.annMods` 回显的是**显式**键（true 与 false 都发），缺省不进表。
> 面板实现在 `public/js/ui/annihilationSettings.js`；「确认」发送的是**生效值**（`annModsWire`），不会把默认开启的两条静默写关。

约定：

* **标签文字直接取 `shared/plugins/rules.js` 的 `RULE_SWITCHES[name].phrase[option]`**（1–4 行），
  那 4 句中文**已经在仓库里**，四语言包也已有条目（`public/js/ui/toasts.js:104` 用了同一批 msgid 做简称）——
  所以 **1–4 行零新增字面量**。第 5–8 行的标签是新字面量，**实施前先把确切字符串报 Lead**。
* 行 5–8 是「mod 开 / 关」，不是 `rules` 的二分选项：它们用同一套 `annMods` 对象承载（`{ egirBuff: true }`），
  但**语义不同**（一个改引擎行为、一个改内容）。界面上分成两组：「规则」（1–4）、「内容」（5–8），
  两组之间一条分隔线 + 组标题（`规则` / `内容`）。
* `aria`：每组是一个 `<div role="group" aria-label="规则">` / `"内容"`；每行是**单选组**（两枚 chip，`aria-pressed`）
  —— 与「单人 / 同盟」chips 同一形态（`extensionThemeHall.js:75-80`），不引入新控件种类。
* **矮屏**（≤520 px 高）：与 §3.6 的既有规则一致 —— 面板保留开关与「返回」，说明行让位（`.ann-set__hint` 隐藏）。
* **减动效**：面板本身不做入场动画（只有 Modal 的既有淡入）；若加了行高亮过渡，必须进 reduced-motion 归零名单
  （`public/css/screens/lobby.css` 的既有 reduced-motion 段）。
* **焦点**：复用项目 `Modal` 的焦点陷阱与 Esc；关闭后焦点回到「功能设置」按钮。

#### 2.3.2 面板的三种禁用态（必须显式，不能靠 disabled 样式猜）

| 情形 | 表现 |
|---|---|
| 玩法包 `status !== 'ready'` | 「功能设置」按钮不出（与「开始」同一条门） |
| 非房主 / 已开局（房内） | 整个面板 `aria-disabled="true"`，每行 `disabled`，顶部一条说明「仅房主可在开局前修改」 |
| 当前模式不是湮灭（理论上到不了，防御） | 面板不渲染 |

#### 2.3.3 设置存在哪里（推荐与理由）

**推荐：两条协议、一份状态 —— 大厅改默认值，房内可改；都落在 `Room.annMods`。**

| 环 | 落点 | 形状 |
|---|---|---|
| 建房 | `shared/protocol.js:542 'room.create'` 加一个可选字段 `annMods: isAnnMods`（进 `$optional`） | `{ shopBias?: 'bondBias', prepLoadout?: 'prep', morphPairing?: 'plus', unequip?: 'allow', egirBuff?: true, commsPriority?: true, bonds?: ['rhodesShip'] }` |
| 房内改 | 新增 `room.setAnnMods { annMods }` —— 与 `room.setErosion` **同形同权**（房主、未开局、非插件模式房、无版本投票） | `server/lobby.js` 的 `setAnnMods()` + `handleMessage` 的 `case`（**少写 case = 静默丢弃**，`handoff/EXTENSION-MODE-2026-10-28.md` §3 的坑 1） |
| 房间态 | `server/lobby.js` 的 `room.state` 加 `...(room.difficulty === ANNIHILATION_DIFFICULTY ? { annMods } : {})` | 只有湮灭房才长这个键（与 `:516` 的 `erosion` 同一条规矩） |
| 对局 | `Match` 收 `opts.annMods` → `GameData` → `gd.rules` / `flags` | `server/match/Match.js:328` 旁边一行 |
| `cs` | **不进**（见 §2.2 约束 1） | — |

**为什么不全押在大厅、也不全押在房内**：

1. 大厅（主题大厅）是**玩家选玩法的那一屏**，开关的「说明书」语义在那里最自然（`攻略说明` 就在旁边）；
   但大厅的按钮一旦点「开始」就建房走了，想反悔只能重开房 —— 业主在超限上已经因为这一点要求改成房内可改。
2. 房内可改给的是**最后确认的机会**（开局前），且与 `setErosion` 完全同形，服务端只有一处校验要加。
3. 只有一处状态（`Room.annMods`）⇒ 大厅只是它的初值来源，界面两份都读同一个 `room.state.annMods` / 大厅本地态，
   **不会出现「大厅显示关、房里显示开」**这种两套真相。

---

## 三、隔离不变量

### 3.1 八条不变量（A-1..A-8）

照 `docs/ZHAJING.md` 的 I-1..I-12 写。**每条都给「给定 / 断言 / 放哪」**；helper 沿用
`test/match/harness.js`（`DATA`/`makeMatch`/`checkInvariants`）与 `test/helpers/battleHarness.js`（`makeBattle`/`hashOf:382`）。
新建 `test/match/annihilation-mods.test.js`。

| # | 给定 | 断言 | 为什么必须 |
|---|---|---|---|
| **A-1** | `new GameData(DATA, modeId)`，`modeId` = 官方四档 × 单/同盟（8）+ 两条炸惊 | `gd.rulesOf(name)` 对四个开关**恒等于** `RULE_SWITCHES[name].options[0]`；`gd.annihilation === null` | `annMods` 漏进官方 = 官方局悄悄多出卸装备 / 休整期改技能。**这条同时钉住「开关只在湮灭里存在」** |
| **A-2** | 同上 10 条 modeId | `gd.visibleChess` 里没有任何 `annOnly` 盟约 / `annBonds` 的记录把 `bonds` 变长；`hashOf(gd.bondIds)` 等于「剥掉 `annOnly` + `ann` 块后」的基线 | 新盟约与成员资格不许出现在非湮灭池 |
| **A-3** | `data/chess.json` 里每条带 `annBonds` 的记录 | ①`annBonds` 里每个 id 在 `data/bonds.json` 中存在（**防 §1.2 那种指向不存在记录的静默空转**）；②记录本身的 `bonds` **没有**被 `annBonds` 改写（并集语义：`原始 bonds ⊆ 生效 bonds`） | 16+10 条 `chess_char_9_*` 就是不存在的；并集写错会「减盟约」 |
| **A-4** | `makeMatch({ difficulty:'ANNIHILATION', annMods })` 与不传 `annMods` | 不传时 `m.gd.rules` 等于官方缺省、`m.publicView()` **不长** `annMods` 键；传 `{ unequip:'allow' }` 时 `m.rulesOf('unequip') === 'allow'`，且 `m.publicView().annMods.unequip === 'allow'` | `publicView` 是「不污染」的边界（照 `match/views.js:117` 的写法） |
| **A-5** | 同一场比赛，`annMods = { egirBuff: true }` 与 `{}`，同一个 `makeBattle` 输入 | 前者【阿戈尔】5 名档复活的那名 `aspd` 高 50、开局 `atk` 高 `0.5×层数`；后者 `hashOf(b.snapshot())` 与当前 main **相同** | 阿戈尔改动只能在开关打开时发生 |
| **A-6** | `annMods = { commsPriority: true }` vs `{}`，装备 `chess_item_2_06_e_a` | 开关关：发放的干员与基线**同一个 id 序列**（同种子）；开关开：发放的一定属于携带者层数最高的核心盟约 | 双发 / 误改官方抽人是最容易漏的一处（§2.2(c)） |
| **A-7** | `data/versions/*` 四条官方版本 | `gd` 不出现 `annOnly` / `ann` / `annBonds` / `annMods`；版本数据里 `annOnly` 记录数 = 0 | 同 `ZHAJING.md` 的 I-6：版本 `cs` 一变，版本房存档全废 |
| **A-8** | `devtools/check-mode-isolation.mjs` 的矩阵 | 湮灭行新增两列（`annBonds` 条数 / `annMods` 门），且**只有湮灭两行非零** | 这条是回归门，不是新测试（见 §3.2） |

### 3.2 `devtools/check-mode-isolation.mjs` 该补哪几行

这个脚本已经是「全模式矩阵 + 方向性断言」（327 行），只需四处：

1. **`stripped(d)`（`:26-40`）** —— 现在是「把 zj 记录剥掉」。追加同样的三步：
   ```js
   for (const [id, r] of Object.entries(d.chess)) {           // chess: 去掉 annBonds
     if (!Array.isArray(r.annBonds)) continue;
     const { annBonds, ...rest } = r; chess[id] = rest;
   }
   // items / garrisons / bonds：跳过 annOnly，并去掉 ann 块（与 zj / zjOnly 同一个循环里加一个 ||
   ```
   加完这一步，**B 段（官方 8 + 训练）与基线逐字节比的那 6 条断言会自动覆盖湮灭 mod**，不用另写。
2. **`gates(g)`（`:46-48`）** —— 加 `g.annihilation && Object.keys(g.annMods||{}).length ? 'annMods' : null`，
   矩阵表就能一眼看出哪个模式开了设置。
3. **C 段（`:129-146`，湮灭）** —— 追加三条：
   ```js
   if (g.annBondsCount() && !g.annihilation) fail(modeId, 'annBonds 生效但模式不是湮灭');
   if (!eq(g.bondIds.filter(id => data.bonds[id]?.annOnly === true).length ? true : false, g.annihilation ? true : false))
     fail(modeId, 'annOnly 盟约的出现与湮灭门不一致');
   ```
4. **方向性断言（`:187-197`）** —— 加一行：`有 annMods / annBonds 门的 mode 集合必须 === 湮灭两个`。

`node devtools/check-mode-isolation.mjs`（exit 1 = 越界）与 `test/match/mode-isolation-matrix.test.js` 是同一套判据，
两边都要同步（脚本头注释 `:11` 写着这件事）。

---

## 四、风险

| # | 风险 | 表现 | 处置 |
|---|---|---|---|
| **R-1** | `install.mjs` 是**给旧加载器的通用安装器**（两个 mod 的 `install.mjs` **字节完全相同**，SHA-256 `240186079610B5CA161DF446D950D689551F41A9E139285D1338BB06BABCF840`，49 189 B），它要写 `payload/` 进目标目录 | 在本仓跑它 = 往仓库里写一堆包文件 + 可能覆盖 `data/*.json`（`chess.json` 里那些 0.3.0 快照！§1.2） | **绝不执行**。只从 `payload/packs/<id>/*.json` 取意图，`install.mjs` 当文档读 |
| **R-2** | 原样合并 `chess.json` | 6 条 / 8 条既有干员被**回退**（少盟约、旧 `stats`/`skills`/`talents`/`price`）；26 条指向不存在的 `chess_char_9_*`（静默空转） | §2.1 的 `annBonds` + A-3 的「目标必须存在」断言 |
| **R-3** | 美术不进 git：`bond_rhodesShip.png`(10.9 KB)、`bond_kazdelShip.png`(79.7 KB)、`trap_c_0{1..4}.png`(0.6–0.9 MB) | `AGENTS.md`「No game art in git」；`public/assets/` 已 gitignore | 图走本机导入（`tools/local-extract/` 或直接放 `public/assets/`），**只**把 `art/index.json` 的条目名进 `docs/research/`。缺图时界面必须仍成立（主题大厅已有这个先例：`<img onError>` 自隐，`extensionThemeHall.js:46-47`） |
| **R-4** | 脚本的确定性：`battle/main.mjs` / `meta/comms.mjs` 是 `.mjs` | `server/sim/` 禁 Node API / `Math.random` / 时钟 / 引擎近似 Math（`AGENTS.md`，ESLint + `test/sim/detmath.test.js` 强制）。两个 mod 都**没有** `Math.random`（已核对），但搬进 `server/match/`（不受 sim ESLint 管）后要靠人守 | 搬的时候一律走 `m.rngMeta` / `createRng(deriveSeed(...))`；`server/match/` 里 `grep -n "Math.random"` 必须为空 |
| **R-5** | `atkFlat` / `aspd` 这类 mod 键的桶 | 阿戈尔的「+0.5×层数 攻击力」是**固定加算**，若误写成 `atkPct` 会被所有百分比放大（100 层变 +50% 而不是 +50 点） | A-5 用绝对数值断言（不是比值）；实施前先跑一条 `makeBattle` 确认 `atkFlat` 在 0.3.3 生效 |
| **R-6** | `room.setAnnMods` 加了协议忘了 `case` | 客户端发了、服务端无 `case` ⇒ **静默丢弃**（`handoff/EXTENSION-MODE-2026-10-28.md` §3 坑 1 的同一处） | 与 `setErosion` 同一处 `handleMessage` switch；一条 WS 级测试断言 `room.state.annMods` 真的变了 |
| **R-7** | 面板里出现「没有实现的盟约」 | `rhodesShip` / `kazdelShip` 的 `bonds/addon/*.js` 没写 → 界面能开、游戏里只有文案没有效果 | A-1 的加强版：开关打开的房间里 `bondActive('rhodesShip')` 必须能真的成立（用 `makeMatch` + `give` 凑 3 名成员） |
| **R-8** | 设置与插件 `rules` 打架 | 一个开着 `unequip=allow` 的湮灭房又装了声明 `unequip=official` 的插件 | §2.2 的读取顺序（插件赢 + 响一声）；`invariants.js` 的装备槽断言两边共用 `morphSlotPolicy` 对象 |

---

## 五、裁决记录（2026-10-28 晚，Lead 已定）

本节取代原先的「待裁决」。Q-2 / Q-3 / Q-4 是 Lead 明确裁决的三条；Q-1 / Q-5 未另行裁决，按本文推荐执行（下面逐条注明）。

| # | 问题 | 裁决 | 对本文的影响 |
|---|---|---|---|
| **Q-1** | 四个开关收口在 `gd.rulesOf()` 还是 `room.rules` | **未另行裁决，按本文推荐执行**：`gd.rulesOf()` 收口（消费点不动，`Match` 把合成结果塞进 `opts.rules`），`annMods` 不进 `cs` | §2.2(a) 照写。若实施中与插件 `rules` 的冲突口径需要改，回来改本文 |
| **Q-2** | 「内容」四项是否各配一个开关 | **要。** 业主原话是「做一套设置界面」，四项（阿戈尔 / 通讯机 / 罗德岛盟约 / 卡兹戴尔盟约）**各一行开关**；两种强度由玩家自己决定，不由我们替他决定 | 面板 = **4 行 `RULE_SWITCHES`（i18n 已有）+ 4 行内容开关（新字面量，实施前报 Lead）**。A-5 / A-6 的开关断言因此成立 |
| **Q-3** | 两条新盟约的战斗效果本轮做不做 | **先判定再决定。** 实测结论：**不是纯数据驱动** ⇒ 按「面板显示这两行 + 标注本轮未接效果」处理 | 见下方 Q-3 实测。§6 第 6 行的「两条新盟约」据此**降级为「只出记录与展示」**，实现留到下一轮 |
| **Q-4** | 26 条 `chess_char_9_*` 怎么认领 | **不适用。** 本仓该类记录数为 0（已实测），不需要映射 | 按 A-3 的写法断言它们**不出现**在 `annBonds` 里；数据侧在 `docs/research/*.json` 注明「不适用，跳过」 |
| **Q-5** | `annMods` 要不要进 `room.state` | **未另行裁决，按本文推荐执行**：进（`erosion` 同款，观战与重连需要知道这一局开了哪些 mod） | §2.3.3 照写 |

### Q-3 实测：为什么不是纯数据驱动

Lead 的判据是「全部效果都在 `buffs` / `bb` / `bbStr` 里 ⇒ 本仓 `bonds/core.js` + buffs 通用引擎就能跑」。逐项实测：

**① 两条记录的形状本身是干净的**（与官方盟约同构，没有私有字段）：

| 字段 | `rhodesShip` | `kazdelShip` |
|---|---|---|
| `thresholds` / `countMode` / `isCore` | `[3,6]` / `BOARD` / `true` | `[3,6,9]` / `BOARD` / `true` |
| `bb` 键 | `base_atk` 0.25、`atk_per_stack` 0.005、`base_max_hp` 0.2、`max_hp_per_stack` 0.005、`power_bond_char_cnt` 6、`heal_scale` 0.2、`sp_interval` 2、`sp_per_interval` 1、`regen_hp_scale` 0.01、`regen_element_scale` 0.01 | `base_damage_scale` 0.2、`damage_scale_per_stack` 0.009、`power_bond_char_cnt` 6、`bonus_attack_speed` 50、`true_damage_scale` 0.2、`storm_char_cnt` 9、`storm_atk_scale` 0.2、`storm_base_damage_scale` 0.1、`storm_damage_scale_per_stack` 0.0045、`layer` 100、`count` 1 |
| `buffs` | 1 条：`env_gbuff_new` | 2 条：`env_gbuff_new` + `bond_layer_added_reward_equip` |
| `effectId` | `bondeffect_rhodes` | `bondeffect_kazdel` |
| `layerMilestones` | `[]` | `[{layer:100, mode:'every', effect:'bond_layer_added_reward_equip'}]` |

**② 本仓的机制是「按 bondId 登记 + 手写解释」，不是通用 runner** —— 三点：

1. **入口是一张按 bondId 索引的冻结表。** `server/sim/content/bonds/core.js:55` 的 `BUFF_KEYS`（bondId → 该盟约要读的
   buff key），配 `:69-71` 的 `bondBb(bondId, key = BUFF_KEYS[bondId])` → `S.buffParams(S.bondRecord(bondId), key)`。
   **新 bondId 不在 `BUFF_KEYS` 里 ⇒ `key` 是 `undefined`，且没有任何代码按 `rhodesShip` / `kazdelShip` 走分支** ——
   记录齐全、数据漂亮，但一行解释它的代码都没有。
2. **有些 `bb` 键确实有现成读点，可以照抄公式**（递归全扫 656 个 `server/` + `shared/` 文件）：
   `base_atk` / `atk_per_stack`（`bonds/addon/battle.js:139`、`core.js:197`）、`base_max_hp` / `max_hp_per_stack`
   （`core.js:592` 阿戈尔、`addon/battle.js:147`）、`base_damage_scale` / `damage_scale_per_stack`（`core.js:316` 维多利亚、
   `addon/battle.js:174`）、`power_bond_char_cnt`（`core.js:204`、`:235`）、`env_gbuff_new`（`addon/battle.js:107`）、
   `bond_layer_added_reward_equip`（`core.js:66`，维多利亚的层数奖励）。
3. **但另外 8 个键全仓没有任何读点**（同样递归扫描，命中数 0）：`sp_interval`、`sp_per_interval`、`regen_hp_scale`、
   `regen_element_scale`、`bonus_attack_speed`、`true_damage_scale`、`storm_char_cnt`、`storm_atk_scale`。
   它们分别是**罗德岛**的治疗/技力/回复三件套，与**卡兹戴尔**的龙卷风、真伤加成、攻速奖励 —— 本仓没有对应机制。

于是两条盟约的成本是**不对称**的（这也是「先判定」的价值所在）：

| | 可照现有公式写的 | 需要新写的 |
|---|---|---|
| `rhodesShip` | 攻/血两档（`core.js:197`、`:581` 同形） | 治疗加成、每 2 秒 +1 技力、每秒 1% 生命/元素回复（`heal_scale` / `sp_interval` / `regen_*` 在盟约侧无实现；`heal_scale` 只在 kit 里出现过） |
| `kazdelShip` | 伤害倍率两档（`core.js:316` 同形）、100 层层数奖励（`core.js:66` 同形） | **龙卷风（`storm_*` 四项）、真伤加成、攻速 +50** —— 三者全仓零实现，等于新机制 |

**③ 所以「能开出来」和「能生效」是两件事**，必须分开标注：

| 能力 | 新盟约没有实现时 |
|---|---|
| 成员计数 / 激活 / 档位（`computeBonds`） | ✅ 有（通用） |
| 层数累积（`addLayers`）与层数显示 | ✅ 有（通用） |
| 卡面：名称 / 图标 / `desc` / `effectDesc` / 档位阈值 | ✅ 有（`annOnly` + 美术条目） |
| **所有 `bb` 数值**（攻 / 血 / 治疗 / 技力回复 / 真伤 / 攻速 / 龙卷风） | ❌ **不生效**（新 bondId 不在 `BUFF_KEYS`，没有一行代码解释它） |
| **`layerMilestones`**（kazdel 的「100 层给一件装备」） | ❌ **不生效**（`bond_layer_added_reward_equip` 有实现，但只挂在维多利亚上：`core.js:66`；kazdel 要照抄一份） |

**④ 结论与处置**：本轮按 Lead 的裁决 —— **面板显示这两行**，并在行内说明与「已选内容」面板上标注
**「本轮仅计数与展示，数值与效果未接」**；实现成本已明确：每个盟约一条 `server/sim/content/bonds/addon/*.js`
（在 `BUFF_KEYS` 登记 + 逐字段解释上表 `bb`）+ kazdel 那条还要补 `bond_layer_added_reward_equip` 的层数奖励。
`[ASSUMED]` 这两条不需要 `data/effects.json` 记录：官方盟约的 `effectId`（`bondeffect_*`）在本仓**也不存在**
（实测 `bondeffect_rhodes` / `bondeffect_kazdel` / `act2autochess_bond_eff_rhodes` 在 `data/effects.json` 全部 absent），
说明 `effectId` 只是上游的标识符，不是本仓的执行入口 —— 这一点降低了对玩法包的依赖，是**好消息**。

> **一处需要 Lead 确认的措辞**：Lead 的原话是标注「本轮仅数值 / 未接效果」。实测表明**数值同样不生效**
> （新 bondId 没有解释代码，`bb` 一个字段都读不到），所以本文采用更准确的
> 「**本轮仅计数与展示，数值与效果未接**」。若 Lead 坚持原措辞，改这一行即可 ——
> 但「仅数值」会让玩家以为攻/血已经加了。

---

## 六、实施拆分（按能独立合入的顺序）

| # | 任务 | 写域 | 依赖 | 独立可合入？ |
|---|---|---|---|---|
| 1 | `docs/research/20-annihilation-mods.json`：4 个开关的缺省（本仓已有，无需搬运）+ `egirShip.ann` 文案 + `rhodesShip` / `kazdelShip` 记录 + 各 2 件装备（rhodes `_c_03_e`/`_c_04_e`、kazdel `_c_01_e`/`_c_02_e`）+ 新特质 rhodes 22 / kazdel 8 + `annBonds` 表（**只有真 id**） | `docs/research/` | — | ✅ 纯数据，不进 `data/` 也能合 |
| 2 | `tools/build-data.mjs` 合并第 1 项（照 `:3368` 的 `if (IS_DEFAULT && …)`）+ 重生成 `data/*.json` + `shared/annihilation-constants.js` 加 `ANN_MODS` 名单 | `tools/`、`data/`、`shared/` | 1 | ✅（golden 必须零位移） |
| 3 | `shared/annBonds.js`（纯函数）+ `bondsMeta.pieceBonds` 合并点 + `test/match/annihilation-mods.test.js` 的 A-2/A-3 | `shared/`、`server/match/bondsMeta.js` | 2 | ✅ 只影响湮灭 |
| 4 | `gd.rulesOf()` / `gd.rules` + `Match.opts.annMods` + `room.create.annMods` + `room.setAnnMods` + `room.state.annMods` | `server/match/gamedata.js`、`Match.js`、`server/lobby.js`、`shared/protocol.js` | — | ✅ 与 1–3 并行 |
| 5 | `builtinMeta.js` 两个处理器的分支 + `server/match/bondReward.js`（`rewardBondOrder` / `rollRewardChess`） | `server/match/` | 4 | ✅ A-6 前后红绿可验 |
| 6 | `bonds/core.js` 的阿戈尔两条（`annMods.egirBuff`）+ `bonds/addon/` 两条新盟约 | `server/sim/content/bonds/` | 2,4 | ✅（golden：非湮灭零位移） |
| 7 | 客户端：`extensionThemeHall.js` 的「功能设置」按钮 + 新 `public/js/ui/annihilationSettings.js`（面板）+ `lobby.css` 的 `.ann-set*` + 房内同一面板 | `public/js/`、`public/css/` | 4（要有协议才点得通） | ✅ 最后 |
| 8 | `devtools/check-mode-isolation.mjs` 四处补充 + `devtools/render-check-annihilation-room.mjs` 加面板一屏 | `devtools/` | 1–6 | ✅ 收口 |

**建议的合入顺序**：`4`（协议+门，最独立）→ `1`+`2`（数据）→ `3`（合并点）→ `5`（通讯机）→ `6`（阿戈尔+盟约）
→ `7`（界面）→ `8`（门禁）。每一批之后跑：
`GOLDEN_FULL=1 node tools/golden.mjs`（288 零位移）+ `node devtools/check-mode-isolation.mjs`（RESULT: OK）
+ `node --test test/match/zhajing-isolation.test.js test/match/annihilation-mods.test.js`。

---

## 七、数据缺口（2026-10-29 收口）

| # | 缺口 | 现状 | 影响 | 处置 |
|---|---|---|---|---|
| D-1 | 两条新盟约的 **6 / 9 名档在本仓到不了** | **已修复（2026-10-30，方案 A）**：13 名 mod 干员搬进名册后 `rhodesShip` **13 名**（阈值 `[3,6]`）、`kazdelShip` **11 名**（`[3,6,9]`），6 名档与 9 名档真实可达。唯一搬不了的 `chess_char_4_27_a` 两个包的 `chess.json` 都没有记录（连 `_b` 也没有），只进 `_extract.notes.unmatchedBondMembers.rhodesShip` | 3 / 6 / 9 名档全部可吃；`test/data.test.js` 的「阈值可达性守卫」钉住 `members.length >= max(thresholds)` 与「每个成员都有棋子记录」 | 阈值**保持包内原值不变**（搬人不是改设计）；缺口表见 §7.1 |
| D-2 | 卡兹戴尔的断角 `chess_item_c_01_e_a` 不在 `data/items.json` | **已补**：kazdel-ship / rhodes-ship 包里的 4 件 ×2 形（断角 / 提卡兹之根 / 罗德岛抑制环 / 罗德岛特制源石弧）经 `docs/research/20-annihilation-mods.json` 的 `items` → `tools/build-data.mjs` 生成进 `data/items.json` + `data/effects.json`（`annOnly`） | 里程碑「`<每叠加100层>` 发一件断角」原来计得清、`grantItem` 发不出去（不抛不重试＝静默失效），现在会真的发 | 生成期校验：`giveBondId` 必须指向 `annOnly` 盟约、`effectId` 必须解析到、golden 链双向往返 |
| D-3 | 4 件装备的**商店归属** | 包里普通形写的是 `hideInShop: false`（= 可售），但本仓没有湮灭专属商店池，且它们是「每 100 层发一件」的**奖励** | 若不排除，官方四档的商店 / 装备池与 `tools/golden.mjs` 的 EQUIPS 游标都会把它们当可发装备，整条发装备序列错位 | 数据侧统一 `hideInShop: true` + `shopExcluded: true` + `shopExcludedBy`（与战栗维式重锤 / 突变细胞同一口径）→ `isShopItem` 为 false，任何模式的池子都不含它们；工具侧（golden 的 EQUIPS）按 `annOnly` 排除。要在湮灭局里卖 mod 装备，需要引擎侧给一个**带 mod 门**的商店池 |

> 这 4 件装备的 `effect` 记录是**派生**的：包只发 `items`、不发 `effects`（两个包的 `records.json` 没有 `effects` 段），
> 所以按 `data/effects.json` 里 115 条 EQUIP 记录**唯一的那个形状**（`counterType` NONE / `continuedRound` -1 /
> `decoIconId` null / `enemyPrice` 0，生成期断言）从 item 反推 `name`/`desc`/`descRaw`/`buffs`/`params`。

### 7.1 13 名干员已搬进湮灭名册（2026-10-30，方案 A）

**输入**：`modref/mods/rhodes-ship/.../chess.json` 8 名（阿斯卡纶 9_09 / 霜叶 9_11 / 坚雷 9_13 / 阿米娅 9_14 /
煌 9_16 / 凯尔希 9_18 / Mon3tr 9_21 / 逻各斯 9_22）+ `kazdel-ship` 5 名（红豆 9_01 / 陨星 9_02 / 闪灵 9_04 /
赫德雷 9_06 / 维什戴尔 9_10），各 `_a` 基础 + `_b` 精英；以及它们引用的 26 条卫戍（`records.json.garrisons`）。
红豆引用的 `garrison_04_a/_b` 本仓已有（官方红豆 `chess_char_1_05`），不覆盖。

**数据（`docs/research/20-annihilation-mods.json` → `npm run build-data`）**：

| 项 | 值 |
|---|---|
| `chess` | 474 → **500**（+26），既有 474 条逐字节不变 |
| `visibleChess`（官方池） | **112 → 112 不变**（新记录 `visible: false`；`isOfficialVisibleChess` 一个字未改） |
| `garrisons` | 497 → **523**（+26），既有 497 条逐字节不变；effectKey 54 → 65 |
| `bonds.rhodesShip.members` | 5 → **13**（`visibleMembers` 同步） |
| `bonds.kazdelShip.members` | 4 → **11** |
| `annBonds` | 20 条棋 / 26 条边 → **46 条棋 / 56 条边**（新记录各带 1–2 条） |
| `annihilationRoster`（默认开关） | 官方 112 + 13 个干员位 = **125**（26 条记录的 `_a` 基础形） |

每条新 chess 打 `annihilation: true` + `visible: false`；`annBonds` 由两条 `annOnly` 盟约的 `members` 反推
（9_09 / 9_22 同时属两条，其余各属一条）。卫戍无标记，`battleRuneKey` 缺省补 `null`。`potDown` 由 build-data 用本仓
`shared/potential.js atRank` 重算（与包内值逐字节相同，warning 数仍 163）。

**服务端**：`server/match/gamedata.js annihilationRoster` 增加「`annihilation === true` 且 `annBonds` 里至少一条
mod 开关开着」的分支（官方记录走原分支，`isOfficialVisibleChess` 未改）；`server/lobby.js` 的
`room.loadout { mode:'annihilation' }` 校验自动跟着同一份名册。`Match` 的 `visibleChess` 因此默认 125。

**客户端**：`public/js/ui/loadoutModel.js` 新增 `annihilationRosterOf(list, annMods)`（与引擎同口径：官方可见棋 +
`annihilation` 干员、按房间 `annMods` 收窄；`shared/annihilation-constants.js` 的缺省表两侧共用）；`screens/loadout.js`
在 `setTier === 'annihilation'` 时用它（与炸惊那条同形），键盘 ←/→ 也走同一份名册；`ui/loadoutSync.js` 的
`flushAnnLoadout` 在发送前按当前名册过滤（房间关掉 mod 时，本机存的选择保留、只是不发，避免服务端整包 BAD_TARGET）。
持有页仍是官方 53 条（玩法干员不进那张表）。

**测试**：`test/data.test.js` 的「成员数到不了」改成**阈值可达性守卫**（`members.length >= max(thresholds)`、
每个成员都有棋子记录且 `annBonds` 认这条盟约、`4_27` 白名单、阈值仍是 `[3,6]` / `[3,6,9]`）；计数 474→500、
garrisons 497→523、annBonds 20→46 / 26→56；隔离套件（`annihilation-mods-isolation` / `mode-isolation-matrix` /
`annihilation-mods-default`）改成「官方 112 + mod 13 个干员位」，并加「全关 = 112」「关一条只少它带进来的」。

**仍未解决的悬挂点**（不自行放宽断言、不造数值）：

1. `chess_char_4_27_a`：两个包的 `chess.json` 都没有记录 → 不进 `members`，只进 `_extract.notes.unmatchedBondMembers`。
   罗德岛 13 名 → 阈值 6 可达；卡兹戴尔 11 → 阈值 9 可达，缺口不影响可达性。
2. 阿米娅的包内 `bonds` 引用 `rimBilliton`，本仓没有这条盟约（全树 0 记录）→ 导入时丢掉并记进
   `_extract.notes.droppedChessBonds`（否则 `validate.js` 的 bond missing 会让构建失败）。
3. Mon3tr 的「M3利爪」`chess_item_c_05_e_a` **两个包与本仓都没有**：`garrison_c_monstr_gain_*` 的 `bbStr.item`
   指向它 → 特质计得清、发不出（`grantItem` 对未知 item 返回 null，不抛）。需要业主决定是否补造该装备。
4. 8 条 `IN_BATTLE` 的 `custom_*` effectKey（`custom_gain_on_kills` / `_on_new_target` / `_on_skill` /
   `_scale_bonds_layers` / `_first_skill` / `_on_heal` / `_on_hurt_or_heal` / `_on_controlled`）**没有战斗侧处理器**：
   数据搬进来后这些特质在战斗里是惰性的（不报错、也不生效）。实现属战斗内容移植，另开。
5. 3 条 `SERVER_*` 的 `custom_*` 已在 `server/sim/content/garrisons/meta.js` 注册（`custom_grant_item_on_acquire` /
   `_on_sell` / `custom_transform_on_sell`，按包内 `desc` + `bb` 逐字实现），否则「every SERVER_* effectKey has a
   registered handler」那条原本绿的测试会红。「变为」按「售出后获得 N 个目标干员」实现，不占卡池副本。
6. 4 名干员没有手写 kit（阿米娅 / 霜叶 / 坚雷 / 陨星）：`setupUnitKit` 回落 generic，能上场但技能无专属行为。
   美术（avatar / portrait / spine）按项目规则不进 git，客户端走既有兜底。

---

## 附录：证据索引

| 类别 | 路径 |
|---|---|
| 输入包 | `modref/mods/{egir-buff,comms-priority,prep-loadout,unequip,morph-plus,shop-bond-bias,rhodes-ship,kazdel-ship}/`（只读） |
| 四个开关的定义 | `shared/plugins/rules.js:27-44`（`RULE_SWITCHES` + 中文 `phrase`）、`:67 ruleOption`、`:281 morphSlotPolicy`、`:317 morphBattleOpt` |
| 四个开关的消费点 | `server/match/player/economy.js:78-86`、`server/match/pool.js:156`、`server/match/match/platform.js:94`、`server/match/bondsMeta.js:45`、`server/match/invariants.js:105-107`、`server/match/player/items.js:199-201`、`server/match/aiDigest.js:96`、`server/match/bot.js:2360` |
| `rules` 的来源 | `server/match/Match.js:328`（`opts.rules`）、`server/lobby.js:2171`（`room.state`）、`:1795`、`:1325`/`:1344`（内容集） |
| 工坊包层（对照） | `server/workshop.js:43 WORKSHOP_DIR`、`:101 loadWorkshop`、`server/roomAssets.js:35/58/82`（按房间物化）、`shared/workshop.js applyWorkshop` |
| 插件内容集（对照） | `docs/PLUGINS.md`、`server/plugins/contentSet.js`、`server/plugins/identity.js`（`cs`）、`server/match/host/entry.js` |
| 湮灭的门（复用） | `server/match/gamedata.js:452 get annihilation`、`:479 annihilationFlags`、`:500 endless`、`:903 bans` |
| 炸惊的标记范式（照抄对象） | `server/match/gamedata.js:188/199/207/219/1152`、`shared/zjBonds.js`、`server/sim/content/support/index.js:62-71/74/256/322`、`server/sim/Battle.js:111/203/219` |
| 效果注册表 | `server/match/effectsMeta.js:93 register`、`:115 item()`、`:117 effect()`、`:412 dispatchItem`、`:494 makeCtx`、`:649 rollChess`、`:717 offerChess`、`:764 toast`；`server/match/builtinMeta.js:118`/`:171`/`:382` |
| 协议的房设置先例 | `shared/protocol.js:542 'room.create'`、`server/lobby.js` 的 `setErosion`/`room.state.erosion` |
| 界面落点 | `public/js/screens/extensionThemeHall.js:31/73-93`、`public/js/screens/lobby.js:832-843 createExtension`、`docs/EXTENSION_MODE.md` §3.6 |
| 门禁与测试 | `devtools/check-mode-isolation.mjs:26-40/43/46/129-146/187-197`、`devtools/check-zhajing-isolation.mjs`、`test/match/mode-isolation-matrix.test.js`、`test/match/harness.js`、`test/helpers/battleHarness.js` |
| 姊妹设计稿 | `docs/ZHAJING.md`（I-1..I-12、三层门、静默失效清单） |

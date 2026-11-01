# 炸惊模拟 · 规则 / 数值 / 隔离 只读核验（2026-10-29）

**性质**：只读调查。除本文件外没有改动任何代码 / 数据 / 测试，没有 git 写操作。
**范围**：炸惊局的规则与数据面（禁选、策略隔离、惊变重抽、羁绊、敌方惊变、锻造器）。界面实现由另外两条子代理负责，
本报告只在「客户端绕过了引擎判据」的地方点到文件行。

**结论摘要**（详细判据与修法见下文）：

| # | 主题 | 结论 |
|---|---|---|
| 1 | 禁选 `bans` 是否真的影响本局商店 | **部分成立**：只作用于「你自己的常规商店棋位」；特殊刷新 / 奖池 / 盟约 / 装备池都不受影响 |
| 2 | 两个 `zjOnly` 策略是否只在炸惊出现 | **服务端成立，客户端不成立**：`bandDraft` 的策略草稿网格读的是 `data.list('bands')` 全表 |
| 3 | 我方惊变重抽口径 | **数值上等价（每张一次），口径与展示不成立**：把 `jibian.rerolls`（4）当成了「总预算」，`rerollsLeft` 会多报 |
| 4 | 羁绊计数与揭示 | **数据/模块成立**（18 条逐字段一致、成员全在池里）；**文档「13 条」不成立**；35 张卡 0 羁绊是数据事实，不是缺陷 |
| 5.1 | 3 选 1 的「已拥有排除」 | **成立**（另含「同一手牌不重复」「投资未来只出 epic/legend/hidden」） |
| 5.2 | R15 隐秘惊变 | **部分成立**：抽取与两个整备侧效果成立；`ejibian_hidden_pandora` 全仓没有任何落点 |
| 5.3 | 敌方惊变整局累计 | **成立**（R1 / R6 各抽一张，之后每场战斗的 `flags.enemyJibian` 都带全部已抽到的 id） |
| 5.4 | 锻造器稀有度与 `g.forgeTake` 校验 | **成立**；一处可加固（`forge.roll === null` 时校验被跳过） |

**跑了哪些对照**（全部 0 fail，只读）：

```
node test/match/zhajing-mode.test.js            25/25
node test/match/zhajing-drafts.test.js           8/8
node test/match/zhajing-refresh.test.js          6/6
node test/match/zhajing-e2e.test.js             13/13
node test/match/zhajing-forge.test.js           14/14
node test/match/zhajing-death-return.test.js     6/6
node test/content/jibian-bonds.test.js           9/9
node test/content/jibian-cards.test.js          20/20
node test/content/zj-ops.test.js                20/20
```

---

## 1. 禁选 `bans` 是否真的影响本局商店

**判据**：`docs/ZHAJING.md` §2.1（收集器过滤表：`gd.shopItemsByTier` / `gd.bandIds` 各自的门）、§3.1 的
`bans(difficulty)` 行、§4 **I-2 / I-3**（官方四档的商店与策略池逐字节不变）。代码侧的同义规则写在
`server/match/pool.js` 的 `drawDisabledBonds`（房内随机禁选）与 `server/match/player/economy.js:70-123`（玩家自选禁选）。

**真实链路（逐跳，含文件:行）**

1. **建房 / 房内设置**：`room.bans` 由 `server/lobby.js:1231-1263 setBans` 处理。只接受 `mode:'zhajing'` + 炸惊房 +
   未开局；名额取 `data/config.json` 的 `bans.ZHAJING`（核验值 **core 3 / addon 4**）；每个 id 必须在 `bonds` 里、
   `isCore` 与所在列一致；服务端去重并按 data 顺序规范化；**每个座位各存一份**（不是房主权限）。
2. **回显**：`server/lobby.js:590`（`room.state.seats[].bans`）与 `:2336`（自己的 seat 详情）；`server/match/views.js:115`
   把它放进 `m.private.bans`（`m.public` 里没有）。
3. **进对局**：`server/match/PlayerState.js:187-193`：只有 `gd.zhajing` 且座位带 `bans.zhajing` 时才落地，
   形状 `{ zhajing: { core: [...], addon: [...] } }`，为空则 `bans = null`（其它模式与没填过的玩家逐字节不变）。
4. **实际消费点（唯一一处）**：`server/match/player/economy.js:75-82` 的 `_rollChessSlot()` 给 `pool.roll` 传
   `filter: (cid) => !this.chessBannedByPreselect(cid)`；判据在 `:117-123`：某棋的 `bonds` **全部**被禁才排除
   （与官方 `drawDisabledBonds` 同口径）。`server/match/pool.js:104-117 _eligible` 把同一个 filter 也应用到 `extra`
   （自选棋子的 stock），所以自选位同样会被排除。

**是否成立**：**部分成立**。具体地：

* 生效：该玩家**自己的常规商店棋位**（含自选棋子）。
* **不生效**（代码里没有读到 `bans`）：特殊刷新 / 资深干员 / 高级资深干员（`server/match/player/acquire.js:217`）、
  按盟约定制的特殊刷新（`server/match/choices.js:680`）、奖池抽取（`server/match/match/spDraft.js:409`、
  `effectsMeta.js:655` 的 `ctx.rollChess`）、商店**装备**位（`economy.js:95` → `pool.rollItem`）、盟约列表与盟约召唤。
* 另一套「禁选」是**房间级随机禁选**：`server/match/Match.js:494-502` 的 `drawDisabledBonds` + `SharedPool(banned)`，
  名额同样来自 `gd.bans(difficulty)`（`server/match/gamedata.js:1299-1312`）。它与玩家预选**互不覆盖**：房间抽中的
  禁选对所有人生效，玩家预选只影响自己。
* 所以「预选没生效」的真实读法应是：**它在，但只在自己常规商店的棋位上，且只在「这个棋的全部盟约都被禁」时才排除**；
  面板的「禁选盟约」并不会让那条盟约从商店/盟约列表里消失，也不会影响装备池与特殊刷新。

**修法（口径二选一，需要业主定）**

* A. 若「卡池预选」的语义是**本玩家所有抽取口**：把 `banSet()` / `chessBannedByPreselect()` 从 `player/economy.js`
  提升到 `PlayerState`（或 `match/banSelect.js`），在上面 4 个调用点组合 filter：
  `acquire.js:217`（特殊刷新按 tier）、`choices.js:680`（按盟约的特殊刷新）、`spDraft.js:409`（奖池）、
  `effectsMeta.js:655`（`ctx.rollChess` 的通用口）。**不要**动 `shopItemsByTier`（装备与盟约是另一维度）。
* B. 若语义是**只影响常规商店**：面板文案改成「本局商店不出现（同盟约全部被禁的干员）」，并在
  `docs/ANNIHILATION-MODS.md` 同级的规则文档里写死边界；补一条测试钉住「特殊刷新不受预选影响」。

**验收方式**

* 已有：`test/match/zhajing-mode.test.js`（bans 的协议与座位回显）、`test/match/zhajing-e2e.test.js`。
* 新增（口径 A）：同一 seed 下开 3 个核心 ban，断言 (a) `_rollChessSlot` 不产出被禁盟约的棋；
  (b) 特殊刷新（`acquire.refreshSpecial` 路径）同样不产出；(c) 未填 bans 的玩家同一 seed 的商店序列逐字节不变。
* 新增（口径 B）：断言特殊刷新**仍可**产出被禁盟约的棋，并在文档里说明这是有意为之。

---

## 2. 两个 `zjOnly` 策略是否真的只出现在炸惊

**判据**：`docs/ZHAJING.md` §2.1 的收集器行「`gd.bandIds` / `bandAllowed`」（非 ZHAJING 跳过 `b.zjOnly === true`）、
§4 **I-3**（官方四档可抽策略逐字节不变）、§7.1（「收集器过滤的是池子，不是映射」——所有绕过 `GameData` 的读点都要列）。

**数据现状**：`data/bands.json` 42 条，`zjOnly: true` 两条：
`band_zj_fuuka`（山岸风花）、`band_zj_si`（祀）。两条都是 `modeTypeList: ["SINGLE","MULTI"]`、**`sortId: 0`**
（= 排在任何官方策略之前）。

**服务端：成立（逐条已核）**

| 读点 | 文件:行 | 判据 |
|---|---|---|
| 白名单 | `server/match/gamedata.js:1335-1348` | `bandAllowed()` 对非炸惊拒 `zjOnly`；`bandIds()` 只列允许的 |
| 草稿候选 / 超时兜底 | `server/match/match/phases.js:165`、`:191`、`:235` | 全部走 `gd.bandIds()` |
| 选人校验 | `server/match/match/phases.js:225` | `!this.gd.bandAllowed(bandId)` → `ERR.BAD_TARGET` |
| 关注（focus） | `server/match/match/phases.js:216` | 同上 |
| 机器人 / 摘要 / 出招本 | `server/match/bot.js:194`、`aiDigest.js:52`、`botIoleta.js:36`、`playbook.js:183` | 都走 `bandIds()` / `bandAllowed()` |
| 其它模式隔离 | `test/match/zhajing-isolation` 与 `I-3` | 官方四档 `bandIds` 不含这两条 |

**客户端：不成立（这是业主说的「溢出到普通模式」）**

| 读点 | 文件:行 | 问题 |
|---|---|---|
| 策略草稿网格 | `public/js/screens/bandDraft.js:274` | `allowedBands(gd.list('bands'), modeType)` —— `gd.list` 是 `data.list`（`public/js/ui/gameComponents.js` 的 `makeLookups`），**整表 42 条** |
| 过滤函数本身 | `public/js/screens/bandDraft.js:79-84` | `allowedBands` 只按 `modeTypeList` 过滤，不看 `zjOnly` —— 这两条正好是 `SINGLE/MULTI` |
| 超时兜底 | `public/js/screens/bandDraft.js:129-138` | `timeoutBand(bands, taken, defaultId)` 用同一份未过滤列表；`sortId: 0` 让两条 zj 策略排在**最前** |
| 战绩 / 草稿记录 | `bandDraft.js:204-211`（`draftRecords`，入参 `data.get('bands')`）、`:384`、`public/js/ui/stats.js:405` | 历史记录口径（只有真打过炸惊才会出现），不算溢出，但同属「读全表」 |

**已就绪的正确工具没被用上**：`public/js/ui/zjView.js:69 officialBands(list, modeId)` 就是为这条写的三态过滤，
`sweep.js:204/420` 已经在用；`bonds.js:100-104` 也是同一套。策略草稿只是没接。

**是否成立**：服务端 **成立**；客户端 **不成立**（官方四档与湮灭房的策略草稿都会列出「祀」「山岸风花」，还排在最前；
点选会被服务端 `ERR.BAD_TARGET` 拒 → 玩家看到的是「一个点了没反应的选项」）。

**修法（一处，最小）**：`bandDraft.js:274` 改成
`allowedBands(officialBands(gd.list('bands'), pub?.modeId ?? pub?.difficulty), modeType)`（`officialBands` 从
`../ui/zjView.js` 引入，`bandDraft` 已有 `officialBonds` 的先例）。`timeoutBand` 的入参随之被过滤，无需再改。
`stats.js` / `draftRecords` 的历史口径不动（历史里出现炸惊策略是正确记录）。

**验收方式**：给 `public/js/ui/zjView.js officialBands` 加纯函数测试（`mode_single_normal` / `mode_multi_abyss` →
40 条且不含 `band_zj_*`；`mode_single_zhajing` → 42 条）；`devtools/render-check-*.mjs` 的官方房草稿一屏断言网格里
没有「祀」；炸惊房断言有。

---

## 3. 我方惊变重抽口径（`refreshSpCard` + `jibianRerollsLeft`）

**判据**：`docs/ZHAJING.md` §1.1（惊变 = 我方 99 张 + 三选一 + 重抽）、§5.2（炸惊比湮灭多一层卡牌系统）、
§3.3（局内 `match/*` 的钩子表）。重抽的**权威口径在参考实现**，本仓文档没有单独定义它。

**现状（我方）**

* `server/match/match/spDraft.js:137-161 refreshSpCard`：`used = s.rerolledBy[pid]`（**按槽 idx 记**），
  `limit = s.jibian.rerolls`（`data/config.json` 两个炸惊模式都是 **4**），判定 `if (limit <= 0 || used.size >= limit) return RATE`。
  即：**每槽最多一次 + 每人每阶段全局 4 次**（两者同时成立）。
* `server/match/player/basics.js:410-420 jibianRerollsLeft()`：返回 `limit - used.size`，客户端据此显示「重抽剩余 N 次」。

**参考实现（`modref/v2.1/server/match/match/spDraft.js:443-446`，含业主 2026-10-19 的裁决注释）**

> ★ 2026-10-13（用户口径）：重投预算【整局共用】…
> ★ 2026-10-19（owner）：改成「**每张卡各能刷新一次**」——同一阶段里刷新过的卡记在 `s.rerolled` 里，每张卡只允许
> 刷新一次；**不再用整局的 `ps.spRerollsUsed` 计数**（budget 仅作为「每卡次数」=1 的兜底）。

**是否成立**：**数值上等价，口径与展示不成立**。

* 等价的部分：手牌固定 3 张（`jibian.cards = 3`），而 `used` 最多只能有 3 个 idx，`used.size >= 4` 永远不触发 →
  实际效果就是「每张卡一次」，与参考一致。`jibian_kuaishou`（快手，+2 张牌）在池子里被显式剔除
  （`server/sim/content/jibian.js:1250` 的 `c.effectId !== 'jibian_kuaishou'`），所以手牌不会变成 5 张。
* 不成立的部分：
  1. **读错了 budget 的含义**：把 `jibian.rerolls`（数据 4）当「总次数」，参考把它当「每卡次数」的兜底（=1）。
  2. **`jibianRerollsLeft()` 会多报**：首屏显示「4 次」，而这一手最多只能刷 3 张（刷 1 张后显示 3，仍大于剩余可刷
     张数）。这是玩家能直接看到的口径错误。
  3. **潜在分岔**：一旦手牌张数 > 4（例如将来让快手生效、或把 `jibian.cards` 调大），第 5 张卡就会被 `RATE` 误拒；
     参考口径不会。同理，`used` 按 **idx** 记账、`handTaken` 每手重置：若同一个 draft 里给同一玩家再发一手
     （当前 `dealtFor` 保证了不会），新卡会因 `used.has(idx)` 被误判为「已刷过」。
  4. 统计字段缺失：参考只把 `spRerollsUsed` 当统计；我方没有对应计数（不影响规则，但如果要做战绩面板会缺数据）。

**修法**

* `spDraft.refreshSpCard`：判定改成只依赖「本手牌这一槽刷过没有」——`if (used.has(idx)) return fail(ERR.ALREADY)`；
  保留 `limit` 但改成**每卡次数**：`const perCard = Math.max(1, Math.trunc(Number(s.jibian.rerolls) || 1))` 只作为
  「同一槽可刷几次」的上限（参考实现取 1），**去掉 `used.size >= limit` 这条总预算判定**。
* `player/basics.js jibianRerollsLeft()`：改成「本手牌还能刷新几张」= `s.cards.filter((c) => !used.has(c.idx)).length`
  （或直接返回每卡剩余次数），并同步客户端文案（`public/js` 不在本线，交给 UI 代理）。
* 记账键从 idx 改成 **卡片 id**（同一 draft 重发手牌时不误判）。

**验收方式**：`test/match/zhajing-refresh.test.js:42-71` 现在钉的是旧口径（`rerollsLeft` 减 1、预算用尽 → `RATE`），
需要按新口径改写，并补三条：(a) 一手 3 张各刷一次都成功；(b) 同一槽第二次 → `ALREADY`（不是 `RATE`）；
(c) 下一阶段的**新**手牌可以再刷（`used` 不复用）。

---

## 4. 羁绊计数与揭示

**判据**：`docs/ZHAJING.md` §1.1 的惊变行（「13 条惊变羁绊」）、§3.5（`content/jibianBonds.js`「13 条惊变羁绊（纯函数，
数据内联）」）、§4 **I-9**（内容域真的装上了）、§3.2 的 `jibianGrantForBond`（刚凑齐时发卡）。

**数据与实现的比对（脚本实跑）**

* `data/jibianBonds.json` **18** 条 vs `server/sim/content/jibianBonds.js` 的 `BONDS` **18** 条：
  `id / name / tiers / members / effect` **逐字段相同（diff = none）**。参考包
  `modref/v2.1/server/sim/content/jibianBonds.js` 同样是 18 条 → 模块与参考一致。
* 两种炸惊模式的 `gd.jibian()`：`pool` **99 条且无重复**、`cards = 3`、`rerolls = 4`、
  `rarityWeights` 五档（normal 35 / rare 30 / epic 20 / legend 10 / hidden 5）、`noCoreBondLegendWeight = 20`。
* 18 条羁绊的 `members` **全部**在 99 张池子里（无悬空引用）；每条羁绊的首个门槛与
  `bondHintsFor()` 返回的 `need` 一致（diff = none）。
* 计数一致性：`activeBonds(owned)` 的 `have` 只数**去重后的已拥有卡 id**（`ownedJibianIdsOf` 读 `effects` 与
  `playerEffects` 两种形状，抽到重复卡只算一张）；羁绊之力（`jibian_jibangzhili`）是万能卡 ——
  `bondsOfCard()` 对它返回**全部 18 条**，符合卡面「它属于所有羁绊」。

**「有些卡没标羁绊」的数据事实**：99 张里 **35 张不参与任何羁绊**（属设计：羁绊只覆盖 64 张卡），
**7 张参与 ≥2 条**，1 张（羁绊之力）参与全部 18 条。完整清单见附录。所以「卡面没标羁绊」= 该卡确实不在任何
羁绊的 `members` 里，不是渲染丢字段。

**是否成立**：数据/实现 **成立**；**文档不成立**：`docs/ZHAJING.md:31` 与 `:279` 写「13 条惊变羁绊」，
实际是 **18 条**（参考包也是 18）。这是文档计数漂移，不影响运行。

**修法**：`docs/ZHAJING.md` 的 §1.1 表格行与 §3.5 那一行把「13 条」改成「18 条」（并把
`data/jibianBonds.json` 标成「人类可读镜像，运行时以 `content/jibianBonds.js` 内联表为准」——模块头注释已经这么写，
文档里没有）。**不要**改数据。

**验收方式**：`node test/content/jibian-bonds.test.js`（9/9 已绿）已覆盖表结构与计数；补一条「文档计数 == 模块条数」的
文档一致性断言（`test/docs-consistency.test.js` 里已有同类写法）。

---

## 5. 其它规则点（只列有证据的）

### 5.1 3 选 1 的「已拥有排除」——成立

* 判据：§1.1 惊变行 + §3.2 `choices.js` 的抽卡入口。
* 现状：`server/match/choices.js:500-542 jibianDraftCards` 用 `exclude`（已拥有）过滤池子（`:511-513`），
  同一手牌内也不重复（`:526` / `:540` 的 `pool = pool.filter((c) => c !== card)`）；`spDraft.js:78-81` 每手牌传入
  `_jibianOwned(ps)`（= `ownedJibianIds`），重抽 `:152-154` 用同一 `exclude` **并加上桌上现有的卡**，所以重抽不会
  刷出重复。`secondDrawOnly`（潘多拉魔盒）在 `server/sim/content/jibian.js:1250` 被排除出首发池。
  「投资未来」走 `onlyHighRarity`（`:516-518`），把池子和权重一起收窄到 epic/legend/hidden（标签与卡面一致）。
* 结论：成立。唯一口径细节：`_jibianOwnedAll()`（`spDraft.js:97-100`）在生成首发草稿时把**全房间**已拥有的卡都排除，
  这是参考实现的做法（避免队友看到同一张），不是缺陷。

### 5.2 R15 隐秘惊变——部分成立（一张卡没有落点）

* 判据：§3.3 的局内钩子（`drawEnemyJibian` / 隐秘核心）+ §1.1（敌方 21 张）。
* 现状：`data/config.json` 两个炸惊模式都有 `enemyJibian.hidden`（`enabled: true`、10 张隐秘卡池），
  `gd.hiddenRound = 15`、`lastRound = 14`；`server/match/match/phases.js:332` 每回合调 `drawHiddenJibian(r)`，
  它只在 `r === hiddenRound` 时抽：**1 张保底 `hidden` + 1 张常规池**，两张都进 `enemyJibianCards` / `enemyJibianList`
  （`hidden: true` 可分组），并立即调用 `applyHiddenMatchCards`（`phases.js:593`）。
* `applyHiddenMatchCards`（`server/sim/content/ejibian.js:510-543`）只处理 **2 张**：`ejibian_hidden_snap`（打响指，
  所有盟约层数 ×0.5）、`ejibian_hidden_purge`（诛伏赐死，清一个盟约）。其余 8 张是战斗侧效果（走 `flags.enemyJibian`
  的 `ejibian.js` 分发，已核 9/10 有落点）。
* **不成立的一处**：`ejibian_hidden_pandora`（潘多拉·敌，「随机获得 3 个敌方惊变，7.99% 为隐秘惊变」）在**全仓没有任何
  引用**（`server/`、`shared/`、`public/`、`tools/` 全查，只有 `data/config.json` 与 `docs/research/19-zhaijing-jibian.json`
  出现这个 id）。它会被抽到、会出现在「已选惊变 · 敌方」页，**但什么也不做**。
* 另核：`ejibian_jingtianmodaotuan`（惊天魔盗团，史诗）在 `server/match/player/round.js:23-27` 有落点
  （本回合结算把上回合剩余资金清零），不是缺口。
* 修法：给 `applyHiddenMatchCards` 加 `pandora` 分支 —— 用 match 的**独立派生随机流**
  （`deriveSeed(match.seed, 'hiddenPandora')`，不要用 `rngWaves`/`rngDraft`）从 `enemyJibian().pool` 抽 3 个不重复的
  普通卡，7.99% 概率改抽 `hidden.pool`，全部 append 到 `enemyJibianCards` 并写进 `enemyJibianList`
  （`hidden: true` 的三张），**不要**递归调用 `applyHiddenMatchCards`（防自激）。
  另：若「潘多拉·敌」抽到的卡里含 `snap`/`purge`，这两张的整备侧效果要不要立刻生效需业主定（当前口径：只有保底那张
  在抽取瞬间生效）。
* 验收：`test/match/zhajing-mode.test.js` 已有隐秘核心的用例；新增一条「注入 pandora 后 `enemyJibianCards` 增加 3 个
  id 且都不重复、且同一 seed 两次结果相同」。

### 5.3 敌方惊变整局累计——成立

* `server/match/match/phases.js:501-534 drawEnemyJibian`：每个配置回合（`enemyJibian.rounds = [1, 6]`）各抽 1 张，
  push 进 `enemyJibianCards`；`enemyJibianRoundsDone` 保证同一回合不重复抽。
* 每场战斗的 spec 都带**全部**已抽到的 id：`combat.js:115`、`bossRounds.js:152`、`intents.js:160`（重放/练习）、
  `bot.js:1348`（bot 预演），形如 `...(this.enemyJibianCards.length ? { enemyJibian: this.enemyJibianCards.slice() } : null)`
  → 与 `docs/ZHAJING.md` 的「整局累计」一致；非炸惊（含官方四档与湮灭）传 null，一行都不走。
* R15 的两张也走同一条 append 路径（§5.2），所以隐秘核心那场会带 R1 + R6 + 隐秘两张共 4 个 id。

### 5.4 锻造器稀有度与 `g.forgeTake` 校验——成立（一处可加固）

* 判据：§3.3 的局内钩子 + `shared/forgeData.js`（三档稀有度 70/20/10）+ §7 的静默失效口径。
* 现状：`server/match/player/acquire.js:410-427 forgeTake` 逐条校验：`forge` 存在（非炸惊 → `BAD_TARGET`）、
  `count > 0`（否则 `RATE`）、`opt` 存在、`rarity` 合法且 `opt.value[rarity]` 有值、`roll.rarity === rarity`、
  `optId ∈ roll.picks` —— 客户端无法凭空造卡或重放旧卡；成功后 `count -= 1` 并立刻掷下一轮（`:420-422`，用 `m.rngMeta`）。
  `forgeRoll()`（`:372-382`）惰性掷取，`grantForge()`（`:359-365`）只加计数不掷取。
* **可加固的一处**：`:416-417` 的两条校验都带 `if (roll && ...)`。当 `forge.roll === null` 且 `count > 0` 时（发放后、
  下一次 `m.private.forge` 推送之前），`g.forgeTake` 会**接受任意 `optId`/`rarity`** 并直接生效。正常客户端拿不到这个窗口
  （`grantForge` → `dirty()` → 下一次推送会走 `forgeView()` → `forgeRoll()` 补掷），但 bot / 外部 AI / 手写协议消息可以。
  建议把 `if (!roll) return fail(ERR.BAD_MSG, 'no roll')`（或先 `this.forgeRoll()` 再校验）。
* 验收：`test/match/zhajing-forge.test.js`（14/14 已绿）已覆盖正常路径；补一条「`forge.count > 0` 且 `forge.roll = null`
  时 `g.forgeTake` 被拒」。

### 5.5 预选 `bans` 不覆盖「特殊刷新 / 奖池」——同一处口径缺口（与 §1 同源，单列便于挂账）

见 §1 的「不生效」清单与修法。这里只强调**验收缺口**：现有测试只钉了「常规商店棋位」，没有任何一条断言
特殊刷新 / 奖池 / `ctx.rollChess` 是否受预选影响 —— 所以无论选哪种口径，都需要新增断言把边界钉住。

### 5.6 文档计数漂移

* `docs/ZHAJING.md:31`、`:279`：「13 条惊变羁绊」→ 实际 **18**（数据、模块、参考包三处一致）。
* 同文件 §7.1 的读点表里没有「客户端策略列表」这一行（§2 的发现问题），建议顺手补一行：
  `public/js/screens/bandDraft.js:274`（`data.list('bands')`，❌ 未过滤，见本报告 §2）。

---

## 附录 A：99 张惊变 카 与 18 条羁绊的映射（脚本输出）

* 池子：99 张、无重复（两种炸惊模式相同）。
* **0 羁绊的卡（35 张）**：
  `siwanghuigui, emoxieyue, 111fuhuoma, bolidapao, shuangguanghuan, renshibuwenjianjia, qiangqiang, moshubiaoyan,
  zhebeiwuqing, yuansudashi, nimobudao, wananjiaoguan, xunhuanwangfu, suoxiaoyinqing, chaodabei, chaoqianxiaofei,
  titawu, xixuexixing, shixue, bing, zuiegankuai, laozishiguanjun, dengdaixue, jiaxiangdi, gaojizishen, zishen,
  zibaokache, yingfenshen, jinjidiaopai, shuwanzhenyan, jibengong, heishan, lumang, longdechuanren, kuaishou`
  （均省略 `jibian_` 前缀；`kuaishou` 另被排除出首发池，见 `content/jibian.js:1250`）
* **多羁绊的卡（7 张）**：`shenmishangdian→cheat+true_investor`、`banteng→roguelike_fan+true_investor`、
  `touziren→steady+true_investor`、`jianshou→steady+toopainful`、`gaoluzhipiao→roguelike_fan+cheat+true_investor`、
  `jinjiuzhibei→roguelike_fan+true_investor`、`jibangzhili→全部 18 条（万能卡）`
* **18 条羁绊**：`ave_mujica, dmg2dmg, steady, glory, empathy, siracusa_wrath, freeship, roguelike_fan, cheat,
  modern_strongest, army_alert, great_seal, true_investor, toopainful, glorious_evo, steel_heart, craftsman, layers_fan`
  （每条的门槛：`tiers` 见 `data/jibianBonds.json`；二档 / 三档与 `bondHintsFor` 的 `need` 一致）

## 附录 B：本报告用到的临时脚本（已在 `$env:TEMP` / `tmp/` 下，交付时删除）

* `tmp/audit-jibian.mjs`：羁绊表 vs 数据、99 张卡 × 18 条羁绊、`activeBonds` / `bondHintsFor` / `ownedJibianIdsOf` 抽查。
* `tmp/audit-ejibian2.mjs`：敌方惊变 21 + 隐秘 10 张卡在 `ejibian.js` / `waves.js` / `phases.js` 的落点覆盖。

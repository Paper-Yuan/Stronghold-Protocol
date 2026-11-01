# 卡池份数与局内「剩余 N 张」审计（只读，2026-10-29）

审计范围：`align/0.3.0` 工作区（E:\Workbox\系统）。**本报告只读**：没有改任何代码 / 数据 / 测试，没有跑任何 git 写操作，唯一新增文件就是本文件。

---

## 0. 结论摘要

1. **份数从数据来，从引擎乘**：`data/config.json` 的 `economy.poolCopies` = `{1:12, 2:14, 3:18, 4:16, 5:8, 6:5}`（按阶，T1–T6），`poolCopiesOverrides` 11 条例外，`coopPoolMultiplier: 2`。`GameData.poolCopies()`（`server/match/gamedata.js:544-555`）取「override → 阶档位 → DEFAULTS」，**再乘 `isSolo ? 1 : coopPoolMultiplier`**。棋记录（`data/chess.json`）里**没有** `copies` / `count` / `poolCount` 字段，`config.modes.*` 里**也没有**份数字段。
2. **单人 ≠ 多人，已经不同**：同盟的每张卡份数是单人的 **2 倍**（实测表见 §2）。这个 ×2 是**按模式（`mode.type` / `mode_single_` 前缀）判定的，不按实际人数**：同盟房只有 1 个人时同样 ×2（§2.3）。装备库存（`itemPoolCopies`）**不翻倍**。
3. **局内「剩余 N 张」是假的**：商店卡面那个数字**不来自卡池**。`server/match/player/views.js:59` 的商店 slot 视图**不再带 `remaining` 字段**，于是客户端 `public/js/ui/shopBar.js:130` 每次都走**硬编码回退表** `{1:30, 2:25, 3:18, 4:12, 5:10, 6:7}`。这张表与单人的 12/14/18/16/8/5、同盟的 24/28/36/32/16/10、以及池子记录数（官方 16/17/19/22/19/19）**三者都不相等**，只有 T3 的 18 碰巧与单人相同。单人房与同盟房显示的**完全一样**——这才是「单人多人卡池数量应该不同，但看上去一样」的直接原因。
4. **根因一句话**：份数（数据 × 引擎的 `isSolo` 乘子）是对的，**卡面显示把它绕过去了**——0.2.5.1 曾由服务端发 `remaining`（`git show 4624e3b1 -- server/match/player/views.js`），现在的 `views.js` 不发，客户端只剩一张写死的表。
5. **附带发现（同一类「写死 vs 数据」）**：炸惊 `economy.benchSize = 20` 服务端已经生效（`PlayerState.js:236`，回归锁在 `test/match/extension-modes-regression.test.js:439`），但客户端所有整备区格位循环仍用 `GEO.HAND_SIZE = 10`（`shared/constants.js:85`），协议也把 `hand.idx` 卡在 0..9（`shared/protocol.js:530`）。**服务端能塞到第 20 格，客户端只画/只寻址前 10 格。**

---

## 1. 拷贝数从哪来（逐层）

### 1.1 数据层

| 事实 | 证据 | 复跑 |
|---|---|---|
| 全局份数表 + 同盟乘子 | `data/config.json`（**整个文件是单行**）`"poolCopies":` 在第 1 行第 120870 列，`"poolCopiesOverrides"` 第 120925 列，`"coopPoolMultiplier"` 第 121201 列 | `node "$env:TEMP\locate-keys.mjs"`（附录 B） |
| 份数表的生成处（`data/*.json` 不许手改） | `tools/build-data.mjs:3079-3086`：`benchSize: act.constData.maxDeckChessCnt`、`poolCopies: { 1: 12, 2: 14, 3: 18, 4: 16, 5: 8, 6: 5 }`、`coopPoolMultiplier: 2`、`itemPoolCopies: {1:4,2:6,3:7,4:8,5:7,6:3}` | `Select-String -Path tools\build-data.mjs -Pattern "poolCopies\|coopPool\|benchSize"` |
| 棋记录**没有**份数字段 | `data/chess.json` 共 474 条记录，键是 `chessId,baseId,goldenId,isGolden,tier,identifier,isHidden,isDiy,visible,chessType,backup,shopSortId,charId,name,appellation,rarity,profession,subProfessionId,subProfessionName,position,nationId,bonds,garrisonIds,price,sellPrice,upgradeNum,upgradeChessId,status,stats,immunities,rangeId,rangeGrid,dmgType,attackKind,projectile,canHitFly,targetPriority,trait,skill,talents,tokens,module,assets,skills,potDown`；`copies/count/poolCount/poolCopies/stock` 命中 **0** 条 | `node -e "const j=require('./data/chess.json');const k=Object.keys(j);console.log('records',k.length);console.log(k.filter(id=>['copies','count','poolCount','poolCopies','stock'].some(f=>f in j[id])).length)"` → `records 474` / `0` |
| 模式记录**没有**份数字段 | `config.modes.mode_single_annihilation` 的键：`modeId,name,code,sortId,type,difficulty,inScope,color,iconId,backgroundId,desc,effectDescList,featureList,unlockText,specialPhaseTime,activeBondIds,inactiveBondIds,inactiveEnemyKeys,lastRound,bossRound,hiddenRound,rounds,spRounds,combatTimeLimit,enemyScale,bossHpScale,upgradePrices,maxShopLevel,shopSlots,levelTagColors,stages,bossWeights,hiddenBossWeights,generation,annihilation,hiddenCore`（无 `poolCopies`） | 附录 B 的第二个片段 |
| 只有炸惊两个模式带 `economy` 覆盖块 | 12 个模式里只有 `mode_single_zhajing` / `mode_multi_zhajing` 有 `economy`（`income,incomeCap,chessPrice,benchSize:20,equipPerChess,interest,leftoverFundsLost`），**里面没有 `poolCopies`** | 附录 B 第三个片段 |

> 也就是说：**炸惊的池子份数与官方四档完全一样**，它只改了 bench 20 / 收入 / 价格 / 利息。这是「数据侧本来就允许按模式改份数，但没人用」的状态。

### 1.2 引擎层

| 环节 | 位置 | 说明 |
|---|---|---|
| 默认值 | `server/match/gamedata.js:97` | `poolCopies: { 1: 12, 2: 14, 3: 18, 4: 16, 5: 8, 6: 5 }`（`DEFAULTS`，数据缺字段时的兜底） |
| 模式经济块合并 | `server/match/gamedata.js:262-265` | `Object.keys(config)` 里凡 `mode` 也有的键（含 `economy`）按字段深合并进 `this.config`，然后 `this.economy = this.config.economy` —— **所以 `modes.*.economy.poolCopies` 天然可用**（炸惊的 `benchSize:20` 就是走这条） |
| 份数决定 | `server/match/gamedata.js:544-555` | `ov[baseId]` → `pc[tier]` → `DEFAULTS[tier]`；`:553` `const multiplier = this.isSolo ? 1 : posIntOr(this.economy.coopPoolMultiplier, 1);` `:554` `return base * multiplier;` |
| 谁算 solo | `server/match/gamedata.js:583-586` | `get isSolo() { … this.mode.type === 'SINGLE' \|\| /^mode_single_/.test(this.modeId) }`；`Match` 另有一层 `this.isSolo = this.mode === 'solo' \|\| this.gd.isSolo`（`server/match/Match.js:361`） |
| 装备份数（不乘乘子） | `server/match/gamedata.js:557-566` | `itemPoolCopies()` 直接返回 `itemPoolCopiesOverrides ?? itemPoolCopies[tier]`，**没有 co-op ×2** |
| 池子本体 | `server/match/pool.js:63-75` | 构造时对每个 `gd.visibleChess`（未被禁）取 `cap = gd.poolCopies(id)`，`entries` 就是「池子记录」，`cap` 是「每张卡份数」 |
| 扣/还的是**份数** | `server/match/pool.js:80`（`left`）、`83-89`（`take`）、`92-98`（`give`） | 普通 1 份、精锐 3 份（`mergeCount`）；`invariants.js:6` 写明不变量 `raw left + Σ 持有份数 == cap` |
| 抽卡按份数加权 | `server/match/pool.js:119-133` | 每格从「剩余份数」里均匀抽 1 份 |
| 自选（DIY）私有库存 | `server/match/player/diy.js:17-25`（注释）、`:203`（`const cap = gd.poolCopies(slotId)`） | 走同一个 `poolCopies()`，所以**也 ×2**（#650 的决定） |
| 池子记录 vs 份数 | `SharedPool.entries.size` = 记录数；`totalLeft()`（`pool.js:198-202`）= 份数总和 | 见 §2 表 |

### 1.3 `shared/` 里有没有相关常量

**没有。** `shared/` 下与卡池份数有关的命中为零：

```
Select-String -Path (Get-ChildItem shared -Recurse -File -Include *.js | % FullName) -Pattern "poolCopies|coopPool|POOL_COPIES"
→ No matches found
```

（`shared/constants.js:85` 的 `HAND_SIZE: 10` 是**整备区格数**，不是份数；见 §3.3。）

### 1.4 参考包 `modref/v2.1`（0.3.1-mod.4）对照

| 事实 | 证据 |
|---|---|
| 参考包的 `poolCopies()` **没有 co-op 乘子**：单人=多人 | `modref/v2.1/server/match/gamedata.js:495-501`（`poolCopies(baseId)` 直接返回，`:541` 只有 `isSolo` getter，全文无 `coopPoolMultiplier`） |
| 参考包的 `config.economy` **没有 `coopPoolMultiplier`** | `node -e "console.log(require('./modref/v2.1/data/config.json').economy.coopPoolMultiplier)"` → `undefined`；`poolCopies` 同样是 `{1:12,…}`，`benchSize: 10` |
| 参考包**有** INDEPENDENT POOL，但那是 100 座变体，与单/多无关 | `modref/v2.1/server/match/player/rules.js:4-16`（`INDEPENDENT POOL`：每人一份「原始完整份数」的私有池，100 座不互相抢）、`modref/v2.1/shared/banPick.js:5`、`modref/v2.1/server/match/invariants.js:39`。本仓**没有** `server/match/player/rules.js`（`Get-ChildItem server\match\player` 里没有），也没有 `shared/banPick.js` |
| 参考包**没有**卡面「剩余 N 张」 | `modref/v2.1/public/js/ui/shopBar.js` 全文只有「剩余可放置角色」（`:411`），没有 `剩余{n}张` |

> 本仓是**有意**偏离参考包的：`docs/ZHAJING.md:566` 明确写「0.3.3 的 `poolCopies` 多了 co-op 双倍（`:423`，`coopPoolMultiplier`）| **照 0.3.3 的，不要退回参考包版本**」。决定来源：`docs/history/0.3.0.md:3095-3105`（维护者 2026-10-15，GitHub #650），文档口径在 `docs/DATA.md:131`、`docs/PLAYING.md:69`。

---

## 2. 实测对照表

### 2.1 怎么复跑

脚本见**附录 A**（写到 `$env:TEMP`，不落仓库）。命令：

```powershell
cd "E:\Workbox\系统"
# 把附录 A 存成 $env:TEMP\audit-pool-copies.mjs
node "$env:TEMP\audit-pool-copies.mjs"
```

口径：`SharedPool(gd, { banned: [] })` 是「无禁卡」的纯容量表；`banned: drawDisabledBonds(gd, createRng(20261029)).banned` 是**真实一局**（禁盟约 → 禁卡，`server/match/pool.js:32-50`）。份数用 `poolCopies()`，记录数用 `entries.size`。

### 2.2 表

| 模式 | `isSolo` | 池记录数（无禁） | 池记录数（禁后，seed 20261029） | 总份数（无禁） | 总份数（禁后） | 每张份数 T1/T2/T3/T4/T5/T6 |
|---|---|---|---|---|---|---|
| `mode_single_funny` 标准·单人 | true | 112 | 81（禁 31） | 1345 | 976 | 12/14/18/16/8/5 |
| `mode_multi_funny` 标准·同盟 | false | 112 | 81（禁 31） | 2690 | 1952 | 24/28/36/32/16/10 |
| `mode_single_normal` 险境·单人 | true | 112 | 88（禁 24） | 1345 | 1077 | 12/14/18/16/8/5 |
| `mode_multi_normal` 险境·同盟 | false | 112 | 88（禁 24） | 2690 | 2154 | 24/28/36/32/16/10 |
| `mode_single_hard` 绝境·单人 | true | 112 | 88（禁 24） | 1345 | 1077 | 12/14/18/16/8/5 |
| `mode_multi_hard` 绝境·同盟 | false | 112 | 88（禁 24） | 2690 | 2154 | 24/28/36/32/16/10 |
| `mode_single_abyss` 终极·单人 | true | 112 | 88（禁 24） | 1345 | 1077 | 12/14/18/16/8/5 |
| `mode_multi_abyss` 终极·同盟 | false | 112 | 88（禁 24） | 2690 | 2154 | 24/28/36/32/16/10 |
| `mode_single_annihilation` 湮灭·单人 | true | 112 | 75（禁 37） | 1345 | 907 | 12/14/18/16/8/5 |
| `mode_multi_annihilation` 湮灭·同盟 | false | 112 | 75（禁 37） | 2690 | 1814 | 24/28/36/32/16/10 |
| `mode_single_zhajing` 炸惊·单人 | true | 97 | 83（禁 14） | 1205 | 1049 | 12/14/18/16/8/5 |
| `mode_multi_zhajing` 炸惊·同盟 | false | 97 | 83（禁 14） | 2410 | 2098 | 24/28/36/32/16/10 |

每张份数的**分布**（无禁卡，含 `poolCopiesOverrides` 例外；「张数×份数」）：

| 模式族 | T1 | T2 | T3 | T4 | T5 | T6 |
|---|---|---|---|---|---|---|
| 官方四档 / 湮灭（单人） | 5张×10 + 11张×12 | 1张×8 + 5张×12 + 11张×14 | 19张×18 | 22张×16 | 19张×8 | 19张×5 |
| 官方四档 / 湮灭（同盟） | 5×20 + 11×24 | 1×16 + 5×24 + 11×28 | 19×36 | 22×32 | 19×16 | 19×10 |
| 炸惊（单人） | 14×12 | 14×14 | 19×18 | 18×16 | 17×8 | 15×5 |
| 炸惊（同盟） | 14×24 | 14×28 | 19×36 | 18×32 | 17×16 | 15×10 |

（例外就是 `config.economy.poolCopiesOverrides` 那 11 条：T1 的 `chess_char_1_07/08/09/10/14_a` = 10，T2 的 `chess_char_2_11_a` = 8、`2_02/09/12/13/14_a` = 12。炸惊记录数 97 而非 112，是因为炸惊的 `visibleChess` 集合不同。）

自选库存（`gd.poolCopies('chess_char_5_diy1_a' / 'chess_char_6_diy1_a')`）：单人 8 / 5，同盟 16 / 10（**与共享池同步翻倍**）。
装备库存（`itemPoolCopies`）：单人 = 同盟 = 4/6/7/8/7/3（按首件，含 override 时 T4 首件为 7；**不翻倍**）。
`benchSize`：官方四档 / 湮灭 = 10，炸惊 = 20（`gd.benchSize`，`gamedata.js:502`）。

### 2.3 单人 vs 多人的差异到底是「按什么」判定的

实测（附录 C）：

```
coop room, 1 human   modeId= mode_multi_normal | isSolo= false | players= 1 | cap= 24 | total copies= 2264
coop room, 2 humans  modeId= mode_multi_normal | isSolo= false | players= 2 | cap= 24 | total copies= 2264
coop room, 4 humans  modeId= mode_multi_normal | isSolo= false | players= 4 | cap= 24 | total copies= 2264
solo room, 1 human   modeId= mode_single_normal | isSolo= true | players= 1 | cap= 12 | total copies= 1132
```

结论：
- **差异存在**，且是 ×2（`gamedata.js:553`）。
- 但**乘子只看模式标签，不看人数**：同盟房 1/2/4 人拿到同一份池子。同盟房只有一个人（或其余席位是 AI 托管/已淘汰）时，仍然拿到 2 倍池。
- **装备不翻倍**（`gamedata.js:557-566`），所以「干员池 2×、装备池 1×」是当前口径；`docs/DATA.md:132` 只描述了装备份数，没有提翻倍——这是**有意留白还是漏项，需要维护者定**。

如果「应该按人数区分」：正确的那一层是 **`GameData.poolCopies()` 的乘子**，而不是数据表。仓里已经有完全同构的先例：Boss 血池 `bossPoolShareOf(modeScale, cfgScale, isSolo, aliveCount)`（`server/match/gamedata.js:142-160`，调用点 `:389`），solo 取 `solo`、co-op 取 `coop × 存活人数`（上限 `aliveFull`）。份数若也要按人数，就该长成同一形状（`poolCopies × f(isSolo, aliveCount)`），**数字仍留在数据里**（`build-data.mjs` 的 `coopPoolMultiplier` 旁边加一个 per-player 键），而不是把份数搬进 `data/chess.json`。

---

## 3. 局内「剩余 N 张」到底显示的是什么

### 3.1 字段链

| 环节 | 位置 | 现状 |
|---|---|---|
| 客户端卡面 | `public/js/ui/shopBar.js:130` | `${slot?.remaining != null ? t('剩余{n}张', { n: slot.remaining }) : t('剩余{n}张', { n: ({ 1: 30, 2: 25, 3: 18, 4: 12, 5: 10, 6: 7 })[tier] ?? 18 })}` —— **回退表写死在客户端** |
| 服务端商店 slot 视图 | `server/match/player/views.js:59` | `{ kind, id, price, basePrice, sold, frozen }` —— **没有 `remaining`** |
| 协议/增量传输 | `shared/stateDelta.js`（无 `shop` 字段特化）、`public/dev/game-mock.js:164-183`（mock 的 slot 也没有 `remaining`） | 全链路都没有这个字段 |
| 历史 | `git show 4624e3b1 -- server/match/player/views.js` | 0.2.5.1（2026-10-13）**曾经发过**：`remaining = pool.left(s.id)`（连 mystery 槽一起）；`git log -S "剩余{n}张" -- public/js/ui/shopBar.js` → 只有 `4624e3b1`。现在 `HEAD` 里已没有。**移除它的提交不在本仓历史里**：`.git/shallow` 存在（浅克隆），`git log -G "remaining" -- server/match/player/views.js` 无输出，无法归因 |
| 文档/测试 | `Select-String` 扫 `docs/**` 与 `test/**` | 没有任何文档或测试描述/锁定这个数字；只有 `test/ui/standin-ui.test.js:259-261` 提到 `.scard__class` 这个**容器类名**（"文字位置让给「剩余 N 张」"），不看数值 |

实测（附录 D）：

```
=== official NORMAL solo (mode_single_normal) ===
shop slot keys = kind,id,price,basePrice,sold,frozen
slot.remaining = undefined -> client uses the hardcoded fallback table
=== official NORMAL coop x2 (mode_multi_normal) ===
slot.remaining = undefined
=== zhajing solo (mode_single_zhajing) ===
slot.remaining = undefined
```

### 3.2 它减的是「份数」还是「记录数」

- **池子本身减的是份数**：`SharedPool.left()`（`pool.js:80`）= `cap − 占用份数`，普通干员 1 份、精锐 3 份（`pool.js:5-15` 的头注释、`acquire.js:37-51`/`:106`）。记录数（`entries.size` = 112 / 97）**从来不参与扣减**，它只是「池子里有多少种卡」。
- **卡面显示的是第三种东西**：`30/25/18/12/10/7`。与单人份数（12/14/18/16/8/5）、同盟份数（24/28/36/32/16/10）、记录数（16/17/19/22/19/19）**都对不上**，只有 T3 的 18 与单人份数巧合相等。它在仓库里**没有任何来源标注**（无文档、无 research 引用、无测试），是 0.2.5.1 一次性加进来的常量。
- 因此 §2 的口径（份数）与 §3 的显示（常量）**不一致**，而且单人房和同盟房显示**逐字相同**——这正是「单人多人卡池数量应该不同」在**界面上**看不到差异的原因。

### 3.3 整备区 20 格 / 手牌相关显示是否同受「写死」影响

**是，而且比卡面更严重。**

| 层 | 位置 | 数值 |
|---|---|---|
| 数据 | `config.modes.mode_*_zhajing.economy.benchSize`（`data/config.json` 第 1 行第 75137 / 100932 列） | 20 |
| 引擎 | `server/match/PlayerState.js:230-236`（`this.hand = new Array(gd.benchSize …)`）、`gamedata.js:502` | 20 |
| 不变量 | `server/match/invariants.js:65` `ps.hand.length !== gd.benchSize` → 违规 | 锁 20 |
| 回归锁 | `test/match/extension-modes-regression.test.js:439` `assert.equal(h.m.players.get('p_0').hand.length, 20, 'BUG-1 回归：整备区 20 格')`、`test/match/zhajing-e2e.test.js:487-508` | 已修并锁住 |
| **协议** | `shared/protocol.js:527-532`：`if (v.area === 'hand') return isInt(v.idx, 0, GEO.HAND_SIZE - 1);` | **0..9** |
| **客户端** | `shared/constants.js:85` `HAND_ROW: 7, HAND_SIZE: 10`；所有格位循环都用它：`public/js/render/app.js:1325`、`public/js/render/drag.js:34/56`、`public/js/ui/gameLogic/placement.js:331/346`、`public/js/ui/gameLogic/shop.js:74`（「整备区已满」）、`public/js/ui/facing.js:240`、`public/js/ui/fallbackField.js:380/547` | **10** |

实测（附录 D，炸惊单人局）：

```
gd.benchSize = 20 | ps.hand.length = 20 | GEO.HAND_SIZE = 10
occupied bench slots = 0,1,...,19 | highest idx = 19
privateView.hand length = 20
protocol g.move to hand idx 9 = null | idx 10 = bad field to | idx 19 = bad field to
```

即：**服务端确实会把第 11～20 格填满（`idx` 到 19），`privateView.hand` 也真的发 20 个元素，但协议层拒绝 `hand.idx ≥ 10`，客户端也只画/只命中 10 个格位**（`drag.js:34` 把 `area:'hand', idx` 直接映射成 `{row: 7, col: idx}`，idx 10..19 会落到 row 7 col 10..19 —— 那里没有格位图形，因为格位是 `HAND_SIZE` 循环画出来的）。
**影响**：炸惊局里溢出的第 11 张及以后**看不见、拖不动、也没法指定放回某一格**（还能通过 `g.sell {uid}` 卖、通过 `to: {area:'board'}` 上场，所以不是完全死锁）。
`public/js/ui/zhajingRules.js:47-52` 的规则说明**会**正确写出「待部署区 20 格」，于是「说明 20 格 / 界面 10 格」自相矛盾。

> 这与「剩余 N 张」是**同一类病**：服务端/数据是对的，客户端把数值写死了。两处都不是份数口径的问题，而是**客户端不该有自己的一套数**。

---

## 4. 最小改法

### 4.1 判断：改哪一侧

| 目标 | 应该改哪里 | 理由（本仓既有做法） |
|---|---|---|
| 「剩余 N 张」显示真实余量 | **引擎 + UI**（`player/views.js` + `shopBar.js`） | 这个数是**每局每刻的状态**，不可能进 `data/*.json`；而且服务端 0.2.5.1 本来就发过（`4624e3b1`），只是后来丢了。改回一行即可，不动 golden（`tools/golden.mjs` 不 hash 任何视图，`grep privateView tools/golden.mjs` 无命中） |
| 炸惊 20 格在界面上真的能用 | **共享常量/协议 + UI**（`GEO.HAND_SIZE` 改为随局数据，或协议放宽到 `gd.benchSize`） | 同上：格数是模式数据（`modes.*.economy.benchSize`）决定的运行时值，客户端不该再有第二个 10 |
| 单人/多人份数「按人数」区分 | **引擎**（`gamedata.poolCopies` 的乘子），数字仍在**数据**（`build-data.mjs`） | 先例就是 `bossPoolShareOf(isSolo, aliveCount)`（`gamedata.js:142-160`）：形状（怎么随人数变）在引擎，数字在 `config` |
| 某个**模式**要自己的份数（比如炸惊想比官方多） | **数据**（`modes.<id>.economy.poolCopies`）+ `tools/build-data.mjs` | `gamedata.js:262-265` 已经支持模式级 `economy` 深合并，炸惊的 `benchSize:20` 就是这么进去的；`data/*.json` 不许手改（AGENTS.md「Generated data」） |

**一句话建议**：**先修显示（引擎/UI 侧，零 golden 风险），份数规则暂不动**——因为份数本身已经是「单人 ≠ 多人（×2）」，只是界面没显示出来；「按人数而不是按模式标签」是**规则变更**，要维护者拍板（AGENTS.md「Official first」：偏离官方是维护者的决定）。

### 4.2 要改的文件（按最小改动排序）

**A. 卡面「剩余 N 张」显示真实余量（推荐先做，1 个文件 + 1 个文件）**

1. `server/match/player/views.js:59` —— 恢复 `remaining`：

   ```js
   const slots = this.shop.slots.map((s) => {
     if (!s) return null;
     let remaining = null;
     if (s.kind === 'chess' && s.id) {
       const pool = typeof this.poolOf === 'function' ? this.poolOf(s.id) : this.m.pool;
       remaining = pool ? pool.left(s.id) : null;
     }
     return { kind: s.kind, id: s.id, price: this.priceOf(s), basePrice: s.basePrice, sold: !!s.sold, frozen: !!s.frozen, remaining };
   });
   ```

   `poolOf` 已经把「自选槽 → 该玩家私有库存」路由好了（定义在 `server/match/player/diy.js:210-213`：`return this.diyStock && this.diyStock.has(baseId) ? this.diyStock : this.m.pool;`，库存接口 `left/take/give` 在同文件 `:52-80`），所以这一行**同时修好**「自选卡显示的是不是自己那份」。
   ⚠️ 若这个仓仍保留 `mystery`（盲盒）槽的分支（`git show 4624e3b1` 里有），恢复时要保留 mystery 的 id 脱敏——当前 `views.js:59` 已经没有 mystery 分支，按现状写即可。

2. `public/js/ui/shopBar.js:130` —— 删掉回退表，只留 `remaining`；为老服务端/无 id 的槽显示 `—`（或整段不渲染），**不要再编数字**。

**B. 炸惊 20 格（次级，涉及协议，改动面更大）**

3. `shared/protocol.js:530` —— `hand` 的上界从 `GEO.HAND_SIZE` 改为「客户端自报的格数」不行；正确做法是把 `target()` 的 `hand` 上界放宽到 `GEO.HAND_MAX`（新增 = 20，`shared/constants.js:79-88` 的 `GEO`），服务端再用 `to.idx >= this.hand.length` 拒绝（`server/match/player/placement.js:53` 已经有这条检查）。
4. 客户端把 `GEO.HAND_SIZE` 的 7 处循环改为「`priv.hand.length`」（`render/app.js:1325`、`drag.js:34/56`、`placement.js:331/346`、`shop.js:74`、`facing.js:240`、`fallbackField.js:380/547`）。
   ⚠️ `render/board3d/layout.js` 的格位几何、`ui/fieldHost.js` 的触控带也要跟着扩到 20 格，**不是纯常量替换**——这也是我建议它单独一个 PR 的原因。

**C. （可选，需维护者决定）份数按人数**

5. `server/match/gamedata.js:544-555` —— 乘子从 `isSolo ? 1 : coopPoolMultiplier` 改为按存活/席位人数（形状照 `bossPoolShareOf`，`gamedata.js:142-160`）；数字新键加在 `tools/build-data.mjs:3079-3086`（`coopPoolMultiplier` 旁），并同步 `docs/DATA.md:131`、`docs/PLAYING.md:69`、`docs/history/0.3.x.md`。

### 4.3 需要新增/修改的测试

| 测试 | 动作 |
|---|---|
| `test/match/shared-stock.test.js:50-60` | **改**：在现有「solo 份数 / coop 双倍」断言之后，加一条「`privateView().shop.slots[0].remaining === m.pool.left(id)`」，并在买入后复查（这是显示口径与池子口径的一致性锁） |
| 新增 `test/ui/shop-remaining.test.js`（或并进 `test/ui/standin-ui.test.js`） | **新增**：给定 `slot.remaining = 3` → 渲染出「剩余3张」；给定 `remaining = undefined` → **不再**渲染 30/25/18/12/10/7 中任何一个（防止回退表复活） |
| `test/match/diy-shop.test.js:222`（`sp.diyStock.cap(T6A)` 已有） | **改**：加一条自选卡面 `remaining` 等于该玩家私有库存（`diyStock.left`）而不是共享池 |
| `test/match/zhajing-e2e.test.js:487-508`（BUG-1 已锁 20 格） | **加**（若做 B）：`validateC2S({t:'g.move', to:{area:'hand', idx:10}})` 通过 + 客户端格位循环用 `priv.hand.length` 的断言；现在这条会失败，可作为先行的「红测试」 |
| `test/data.test.js:440-442` | **不动**（份数没改时） |
| `test/match/pool.test.js:18`（`2 * (overrides ?? caps)`）、`test/golden-diy.test.js:33-35`（`factor`）、`test/match/diy-shop.test.js:230-231` | **只有**做 C（改乘子）时才改；它们把「×2」写死了 |
| `test/match/extension-modes-regression.test.js:419-421` | 注释已过时（说 `PlayerState.hand` 固定 10），**顺手更正**注释即可（代码已是 `gd.benchSize`） |

### 4.4 golden 会不会动

- **只做 A（显示）**：**不动**。`tools/golden.mjs` 的 digest 只记录 per-round per-player 的 `[alive, lp, funds, pending, shop level, deployed, …]`（`tools/golden.mjs:54`）、RNG 抽样数（`:114-118`）和战斗快照，**不 hash 任何 `privateView`/`publicView`**（`grep -n "privateView\|publicView" tools/golden.mjs` → 无命中）。加一个视图字段不进摘要。
- **做 B（20 格）**：**可能动 `matches`**。`ps.hand.length` 改变会影响 `stowPiece` 的落位（`player/pieces.js:78-83` 选第一个空格）、`acquire.js:328` 的溢出判定、`bot.js:1959` 的卖出启发式，进而改变 RNG 消耗顺序。跑 `npm run golden` 确认；若移动，按 `test/golden/README.md` 的规矩 `npm run golden:update` 并在 PR 里逐条列出。
- **做 C（改份数）**：**一定动**。抽卡是按份数加权（`pool.js:119-133`），份数一变 → 每格抽到的 id 变 → `matches` / `diy` 两个族的 digest 全动。仓里已有同型先例的实测记录：`tools/golden.mjs:262-264`「measured: 42 roster + 8 bonds + 20 fields scenarios moved on 2026-10-29 while the shop pool table looked equal」。`diy` 族显式记录「每回合自选卡的商店抽取」（`tools/golden.mjs:827`），所以**份数改动必然要 `golden:update`**。
- **golden 是否覆盖副本数本身**：`test/golden/*.json` 里 `poolCopies` / `coopPool` / `copies` 的命中为 **0**（`Select-String -Path (Get-ChildItem test\golden -Recurse -File) -Pattern "poolCopies|coopPool|copies"` → 无输出）。也就是说 **golden 没有直接断言份数**，它只是**间接**通过抽卡/落位被份数影响。

### 4.5 验证命令

```powershell
cd "E:\Workbox\系统"
node --test test/match/shared-stock.test.js test/match/pool.test.js test/match/diy-shop.test.js test/data.test.js test/golden-diy.test.js
node --test test/ui/standin-ui.test.js            # 若并进这里
node --test test/match/zhajing-e2e.test.js test/match/extension-modes-regression.test.js   # 若做 B
npm run golden                                     # 只做 A 时应当零移动
```

---

## 5. 未验证项与限制

1. **`remaining` 的移除提交无法归因**：本仓 `.git/shallow` 存在（浅克隆），`git log -G "remaining" -- server/match/player/views.js` 无输出，只能确认「0.2.5.1 有、HEAD 没有」。
2. **30/25/18/12/10/7 的出处未知**：没有文档、research、测试或注释提到它。若它其实来自某张官方截图（每阶「剩余」数字），需要维护者给出处，否则按「无来源常量」处理。
3. **炸惊 20 格的界面表现**：我只做了代码路径 + 数据路径核验（`privateView.hand` 20 项、协议拒绝 idx≥10、客户端循环 10），**没有在浏览器里截图确认**渲染位置。若要在报告外确认，用 `SP_E2E=1` 起一套炸惊局截图即可。
4. **没跑测试**：本次是只读审计，未执行 `node --test` / `npm run golden`（避免与并行会话的改动混淆，见 §4.4 的判别建议）。
5. **工作区是多个会话共用的未提交状态**：`server/match/player/views.js`（2026-10-28 22:43 写入，湮灭藏品 / 炸惊视图）与 `server/match/gamedata.js`（2026-10-29 13:43，+800 行）在我开工前就已是 `M`，属于别的会话。我核对过：这两处未提交改动**不涉及** `poolCopies` / `coopPoolMultiplier` / `benchSize` / `remaining`（`git diff server/match/gamedata.js | Select-String "^\+.*(poolCopies|coopPool|benchSize|copies)"` → 无输出；`views.js` 的 diff 只加 `relics`/`zjLoadout`/`annLoadout`/`bans`/`jibian`/`forge`），所以本报告的行号与结论对当前工作区成立。

---

## 附录 A：实测表脚本（存成 `$env:TEMP\audit-pool-copies.mjs`）

```js
// 只读审计脚本：卡池份数实测表（官方四档 × 单/同盟、湮灭、炸惊）
import { getData } from 'file:///E:/Workbox/系统/server/data.js';
import { GameData } from 'file:///E:/Workbox/系统/server/match/gamedata.js';
import { SharedPool, drawDisabledBonds } from 'file:///E:/Workbox/系统/server/match/pool.js';
import { createRng } from 'file:///E:/Workbox/系统/server/sim/rng.js';

const DATA = getData({ log: { warn() {}, error() {}, info() {}, log() {} } });
const MODES = [
  ['mode_single_funny', '官方·标准 单人'], ['mode_multi_funny', '官方·标准 同盟'],
  ['mode_single_normal', '官方·险境 单人'], ['mode_multi_normal', '官方·险境 同盟'],
  ['mode_single_hard', '官方·绝境 单人'], ['mode_multi_hard', '官方·绝境 同盟'],
  ['mode_single_abyss', '官方·终极 单人'], ['mode_multi_abyss', '官方·终极 同盟'],
  ['mode_single_annihilation', '湮灭 单人'], ['mode_multi_annihilation', '湮灭 同盟'],
  ['mode_single_zhajing', '炸惊 单人'], ['mode_multi_zhajing', '炸惊 同盟'],
];
const dist = (pool) => {
  const byTier = new Map();
  for (const [, e] of pool.entries) {
    if (!byTier.has(e.tier)) byTier.set(e.tier, new Map());
    const m = byTier.get(e.tier); m.set(e.cap, (m.get(e.cap) || 0) + 1);
  }
  return [...byTier.entries()].sort((a, b) => a[0] - b[0])
    .map(([t, m]) => `T${t}:` + [...m.entries()].sort((a, b) => a[0] - b[0]).map(([cap, n]) => `${n}张×${cap}份`).join(' ')).join(' | ');
};
for (const [modeId, label] of MODES) {
  const gd = new GameData(DATA, modeId);
  const open = new SharedPool(gd, { banned: [] });
  const drawn = drawDisabledBonds(gd, createRng(20261029));
  const real = new SharedPool(gd, { banned: drawn.banned });
  const total = (p) => [...p.entries.values()].reduce((n, e) => n + e.cap, 0);
  console.log(label, modeId, 'isSolo=' + gd.isSolo, 'records', open.entries.size, '/', real.entries.size,
    'copies', total(open), '/', total(real), 'banned', drawn.banned.length, '|', dist(open),
    '| bench=' + gd.benchSize);
}
```

## 附录 B：配置/数据的定位片段（一次性，`node -e` 或存成 `$env:TEMP\locate-keys.mjs`）

```js
// data/config.json 是单行文件，按「行:列」定位
import { readFileSync } from 'node:fs';
const lines = readFileSync('data/config.json', 'utf8').split(/\r?\n/);
for (const k of ['"coopPoolMultiplier"', '"poolCopies":', '"poolCopiesOverrides"', '"itemPoolCopies":', '"benchSize":20', '"benchSize":10']) {
  const at = []; lines.forEach((l, i) => { let p = l.indexOf(k); while (p >= 0) { at.push(`${i + 1}:${p + 1}`); p = l.indexOf(k, p + 1); } });
  console.log(k, '->', at.slice(0, 5).join('  ') || '(none)');
}
```

```powershell
# 模式记录的键（看有没有 poolCopies / economy）
node -e "const j=require('./data/config.json');for(const [k,v] of Object.entries(j.modes)){console.log(k, Object.keys(v.economy||{}).join(',')||'(no economy)')}"
# 棋记录的键（看有没有 copies/count/poolCount）
node -e "const j=require('./data/chess.json');const k=Object.keys(j);console.log(k.length, Object.keys(j[k[0]]).join(','))"
```

## 附录 C：人数 vs 乘子（存成 `$env:TEMP\audit-pool-teamsize.mjs`）

```js
import { makeMatch } from 'file:///E:/Workbox/系统/test/match/harness.js';
for (const [tag, o] of [['coop,1',{mode:'coop',humans:1}],['coop,2',{mode:'coop',humans:2}],['coop,4',{mode:'coop',humans:4}],['solo,1',{mode:'solo',humans:1}]]) {
  const h = makeMatch({ ...o, difficulty: 'NORMAL', seed: 11, fake: true }).start().toPrep();
  const m = h.m, id = [...m.pool.entries.keys()][0];
  console.log(tag, m.modeId, 'isSolo=' + m.isSolo, 'players=' + m.players.size, id, 'cap=' + m.pool.cap(id), 'total=' + m.pool.totalLeft());
  m.dispose();
}
```

## 附录 D：卡面字段与 20 格可达性（存成 `$env:TEMP\audit-pool-ui.mjs`）

```js
import { makeMatch } from 'file:///E:/Workbox/系统/test/match/harness.js';
import { validateC2S } from 'file:///E:/Workbox/系统/shared/protocol.js';
import { GEO } from 'file:///E:/Workbox/系统/shared/constants.js';
const show = (tag, h) => {
  const m = h.m, ps = [...m.players.values()][0], priv = ps.privateView();
  const slot = priv.shop.slots.find((s) => s && s.kind === 'chess');
  console.log(tag, m.modeId, 'slot keys =', slot ? Object.keys(slot).join(',') : '-', '| remaining =', slot && String(slot.remaining));
  console.log('  gd.benchSize =', m.gd.benchSize, '| hand.length =', ps.hand.length, '| GEO.HAND_SIZE =', GEO.HAND_SIZE);
  const free = ps.hand.filter((x) => !x).length;
  const ids = m.gd.visibleChess.filter((c) => !m.gd.isGolden(c) && m.pool.left(c) > 0 && !ps.allChess().some((p) => p.id === c));
  for (let i = 0; i < free + 1; i++) if (ids[i]) ps.acquireChess(ids[i]);
  const occ = ps.hand.map((p, i) => (p ? i : -1)).filter((i) => i >= 0);
  const uid = (ps.hand.find(Boolean) || {}).uid;
  console.log('  occupied =', occ.join(','), '| privateView.hand =', priv.hand.length);
  console.log('  g.move hand idx 9/10/19 =',
    validateC2S({ t: 'g.move', uid, to: { area: 'hand', idx: 9 } }),
    validateC2S({ t: 'g.move', uid, to: { area: 'hand', idx: 10 } }),
    validateC2S({ t: 'g.move', uid, to: { area: 'hand', idx: 19 } }));
  m.dispose();
};
show('solo', makeMatch({ mode: 'solo', difficulty: 'NORMAL', humans: 1, seed: 11, fake: true }).start().toPrep());
show('coop', makeMatch({ mode: 'coop', difficulty: 'NORMAL', humans: 2, seed: 11, fake: true }).start().toPrep());
show('zhajing', makeMatch({ mode: 'solo', difficulty: 'ZHAJING', humans: 1, seed: 11, fake: true }).start().toPrep());
```

## 附录 E：本报告引用的全部关键位置

| 主题 | file:line |
|---|---|
| 默认份数 | `server/match/gamedata.js:97` |
| 模式经济块合并 | `server/match/gamedata.js:262-265` |
| 份数决定 + ×2 | `server/match/gamedata.js:544-555`（乘子 `:553`） |
| `isSolo` | `server/match/gamedata.js:583-586`；`server/match/Match.js:361` |
| 装备份数（不 ×2） | `server/match/gamedata.js:557-566` |
| `benchSize` | `server/match/gamedata.js:502`；`server/match/PlayerState.js:230-236`；`server/match/invariants.js:65` |
| 池子 | `server/match/pool.js:5-15`、`63-75`、`80`、`83-89`、`92-98`、`119-133`、`198-202` |
| 自选私有库存 | `server/match/player/diy.js:17-25`、`52-80`、`203` |
| 数据生成 | `tools/build-data.mjs:3079-3086` |
| 文档口径 | `docs/DATA.md:131-132`、`docs/PLAYING.md:69-70`、`docs/ZHAJING.md:566`、`docs/history/0.3.0.md:3095-3105` |
| 卡面「剩余 N 张」 | `public/js/ui/shopBar.js:128-131`（`:130`） |
| 商店 slot 视图（无 remaining） | `server/match/player/views.js:59` |
| 历史（曾发 remaining） | `git show 4624e3b1 -- server/match/player/views.js`；`git log -S "剩余{n}张" -- public/js/ui/shopBar.js` |
| 整备区格数（客户端 10） | `shared/constants.js:85`；`public/js/render/app.js:1325`；`public/js/render/drag.js:34,56`；`public/js/ui/gameLogic/placement.js:331,346`；`public/js/ui/gameLogic/shop.js:74`；`public/js/ui/facing.js:240`；`public/js/ui/fallbackField.js:380,547` |
| 协议 hand 上界 10 | `shared/protocol.js:527-532`（`:530`） |
| 炸惊规则文案（20 格） | `public/js/ui/zhajingRules.js:47-52` |
| 回归锁 | `test/match/extension-modes-regression.test.js:417-442`（`:439`）、`test/match/zhajing-e2e.test.js:487-508` |
| 份数相关测试 | `test/data.test.js:440-442`、`test/match/shared-stock.test.js:50-60`、`test/match/pool.test.js:18`、`test/match/diy-shop.test.js:222,230-231`、`test/golden-diy.test.js:33-35` |
| golden | `tools/golden.mjs:54`（digest 字段）、`:262-264`（份数表改动的实测先例）、`:827`（diy 族记录商店抽取）、`test/golden/README.md` |
| 参考包 | `modref/v2.1/server/match/gamedata.js:495-501,541`、`modref/v2.1/server/match/player/rules.js:4-16`、`modref/v2.1/shared/banPick.js:5`、`modref/v2.1/public/js/ui/shopBar.js:411` |

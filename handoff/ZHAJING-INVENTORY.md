# 炸惊模拟 · 包内专属内容完整清单（inventory，2026-10-28）

> 任务：共享任务板 **task-1**（清单审计员）。只读调查，产物只有本文件 + [`modref/inventory.json`](../modref/inventory.json)。
> 参考包：`C:\Users\J1825\Downloads\炸惊模拟整合包公开版v2.1.zip`（1 441 833 621 B，解出根目录 `Stronghold-Protocol-0.3.1-mod.4`，
> `version.json` = `app 0.3.1-mod.4 / pack v2.1 / edition ZHAJING`）。已解压到 [`modref/v2.1/`](../modref/v2.1/)（跳过 `node_modules` 与 `public/assets`）。
> 本仓：`E:\Workbox\系统`，0.3.3。所有数字由 [`modref/tools-scan-*.mjs`](../modref/) 实测，命令见 §7。
>
> **红线遵守**：未改动 `modref/v2.1/` 任何文件、未改 `data/`、未改代码、未做任何 git 写操作。

---

## 0. 一页数字

| 维度 | 数字 | 说明 |
|---|---|---|
| 包内 `.js/.mjs/.css/.html` | **948** | 与本仓逐字节相同 258 / 仅上游漂移 395 / **含 zj hunk 120**（核心 62 + 痕迹 58）/ 包内独有 175 |
| 数据层 zj 记录 | chess 205 + garrison 248 + bonds 5 新（另 16 条既有带 `zj` 块）+ items 11 + tokens 15 + bands 2 + modes 2 + 2 个新文件 | 见 §1 |
| `data/` 字节净增 | **≈ +2.31 MB**（chess +1.71 MB、backups +0.20 MB、garrisons +0.14 MB、tokens +0.11 MB、config +0.05 MB、bonds +0.05 MB） | 计划稿 §5.7 的「+4 MB」偏高 |
| 引擎层 | 8 个模块 **3 785 行**＋未被计划稿收录的 forge 三件套 **575 行** | 见 §2 |
| 客户端 | `public/js/**`+`public/css/**` 扫描 274 个，**60 个命中**（16 个本仓无同名） | 见 §3 |
| 资产 | zip 内 assets 44 428 条 / 1 872 MB；本仓已装 37 903 个 / 3 291 MB；**只导炸惊相关 ≈ 1 216 个 / 212.4 MB** | 见 §4 |
| 惊变内容量 | 我方 **99** 张（normal 23 / rare 22 / epic 26 / legend 20 / hidden 8）、敌方 **21** 张（normal 6 / epic 8 / legend 7）、惊变羁绊 **18** 条 | 见 §1.6 |

**与计划稿 [`ZHAJING-SPLIT-PLAN-2026-10-28.md`](ZHAJING-SPLIT-PLAN-2026-10-28.md) 的实测修正**（本节数字是修正后的）：

| 计划稿说 | 实测 |
|---|---|
| 惊变羁绊 13 条 | **18 条**（`data/jibianBonds.json` 与 `server/sim/content/jibianBonds.js` 各 18 条） |
| `bans.ZHAJING {core:2, addon:2}` | **`{core:3, addon:4}`**（`modref/v2.1/data/config.json`） |
| tokens +15 = 惊变召唤物 | **是 0.3.1 上游新干员的召唤物**（2 条 `token_makoto_*` + 13 条其它干员的 token），惊变的召唤走 `jibian.js` 的 `spawn`，不走 `tokens.json` |
| 引擎新增 7 个文件 | 7 个之外还有 **forge 锻造器**（`shared/forgeData.js` + `server/sim/content/forge.js` + `public/js/ui/forge.js`，`DOMAIN_NAMES` 里有 `forge`），计划稿 §1.3 未收录 |
| `inScope` / `difficulty` 无异议 | `mode_single_zhajing.inScope` = **`false`**，且 `code:"AC-5"`、`sortId:6` 与**湮灭模拟完全相同**（同一 AC 编号冲突） |

---

## 1. 数据层

### 1.1 键级 diff 总表

对比 `modref/v2.1/data/X.json` ↔ `data/X.json`（顶层键 = 记录 id；`config` 比 `modes`，`skins` 比 `chars`）。

| 文件 | 本仓 | 包内 | added | removed | 共有但已改 | zj 标记 |
|---|---|---|---|---|---|---|
| `chess.json` | 266 | 473 | **+207** | 0 | 22 | 199 条 `zhajing:true`；207 条 `visible:false` |
| `garrisons.json` | 249 | 497 | **+248** | 0 | 2 | **无标记**（只靠 id 前缀 `garrison_zj_*`） |
| `bonds.json` | 23 | 28 | **+5** | 0 | 26（其中 21 条带 `zj` 块） | 21 个 `zj` 覆盖块 |
| `items.json` | 115 | 126 | +11 | 0 | 14 | 2 条 `zjOnly:true`；7 条 `jibian_*` 道具 `shopExcluded/hideInShop` |
| `tokens.json` | 22 | 37 | +15 | 0 | 1 | 无 |
| `bands.json` | 40 | 42 | +2 | 0 | 0 | 2 条 `zjOnly:true` |
| `config.json` | 11 modes | 11 modes | **+2 zj modes** / −2 湮灭 modes | | 0 | `difficulty:'ZHAJING'`、`bans.ZHAJING` |
| `stages` / `enemies` / `waves` | 13 / 249 / 38 | 同 | 0 | 0 | 0 / 0 / 0 | 完全复用 |
| `effects.json` | 361 | 361 | 0 | 0 | **3** | 无（`bondeffect_mira`/`eff_acarm070`/`eff_acgarm070`，上游漂移） |
| `bosses.json` | 10 | 10 | 0 | 0 | **10** | 差异**全部来自本仓**：0.3.3 给每条 boss 的 `bloodPoint` 多加了 `ANNIHILATION` 列。→ **炸惊不新增 bloodPoint 列**，它用 `bossHpScale.bloodPointKey:"bloodPointAbyss" + hpMul:5 + atkMul:6` 复用 ABYSS 列（`gamedata.js:235-245` 的 `bloodPointDiff()` / `bossPoolHpMul`） |
| `choices.json` | 9 顶层键 | 同 | 0 | 0 | 整文件 −20 B | 1 行命中（`jibian` 家族名） |
| `skins.json` | chars 174 / skins 273 | 183 / 285 | +9 chars / +12 skins | 0 | — | 9 个新干员的皮肤 |
| `assets.json` | 2 692 298 B | 2 690 030 B | — | — | −2 268 B | 清单里不含 zj 资产键（炸惊资产走 `local-assets`/直连） |
| `backups.json` | units 89 / tokens 38 | 95 / 40 | +6 units / +2 tokens | 0 | — | 6 条 `zhajing:true` 备份（5 颂乐人偶 + makoto） |
| `data/jibianBonds.json` | — | 4 714 B | **新文件** | — | — | 见 §1.6 |
| `data/zjDefaultLoadout.json` | — | 11 131 B | **新文件** | — | — | 见 §1.6 |

> 包内 `data/` 还带大量手工备份（`chess.json.zj-bak`、`bonds.json.zj-bak`、`bonds.json.zj-block-recovered.json`、
> `config.json.jibian-bak` / `ej-bak` / `diy-bak`、`garrisons.json.wang-bak` …）。**不要移植这些**，但它们是判读「哪些 hunk 是手改」的最好证据。

### 1.2 `chess.json`：炸惊棋库 207 条

**计数**：`chess_zj_*` **205** 条 + `chess_chen3_a/_b` **2** 条 = 207。205 条落在 **103 个 base** 上
（102 个 normal/elite 配对 + 1 条孤例 `chess_zj_pure_b`），**101 个不同 `charId`**：
`char_4116_blkkgt` 占 `zj_17` 与 `zj_91` 两个位、`char_263_skadi` 占 `zj_34` 与 `zj_pure`。

**字段口径（逐项实测）**：

| 字段 | 值 | 计数 |
|---|---|---|
| `visible` | `false` | 207/207（**注意：本仓 `chess.json` 本来就有 42 条 `visible:false`**，所以它不是 zj 的充分标记） |
| `zhajing` | `true` | 199/205 `chess_zj_*`；**6 条是 `false`**（`chess_zj_13_a/_b` 锡人、`zj_22_a/_b` 赫拉格、`zj_91_a/_b` 锏） |
| `zhajing` | 缺字段 | `chess_chen3_a/_b` 两条完全没有该字段 |
| `chessType` | `NORMAL` 149 / `PRESET` 54 / `null` 2 | `null` 的是 `chess_zj_chyue_a/_b` |
| `tier` | 1–6；`rarity` 6/5/4/1 | — |
| `baseId` | **等于自己的 `chessId`**（如 `chess_zj_01_a` 的 `baseId` 也是 `chess_zj_01_a`） | 205/205。`_b` 与 `_a` 是两条独立 base，靠 `upgradeChessId` 相连 |
| `goldenId` / `upgradeChessId` | `_a` 指向 `_b`，`_b` 为 `null`；`isGolden` 相反 | — |
| `garrisonIds` | 1–2 个 `garrison_zj_*`（少量指向 `garrison_mujica_*`） | 231 次引用、228 个不同 id |
| `statsBase` / `traitBase` / `talentsBase` / `modules` | **只出现在 `_b`**（精英）记录 | 102/205 |
| `form` / `pureStrong` / `diyFor` / `grantOnly` / `teamId` / `displayTokens` | **本仓不存在的字段** | 见 §1.2 末 |

代表性记录（`modref/v2.1/data/chess.json` → `chess_zj_01_a`，**摘录**：`trait/skill/talents/rangeGrid` 等长字段已省略）：

```json
{
  "chessId": "chess_zj_01_a", "baseId": "chess_zj_01_a", "goldenId": "chess_zj_01_b",
  "isGolden": false, "tier": 1, "identifier": 818, "isHidden": false, "isDiy": false,
  "visible": false, "chessType": "NORMAL",
  "backup": { "charId": "char_603_csnipe", "tmplId": null, "skillIndex": 2, "uniEquipId": null, "potRank": 0 },
  "shopSortId": 579, "charId": "char_103_angel", "name": "能天使", "appellation": "Exusiai",
  "rarity": 6, "profession": "SNIPER", "subProfessionId": "fastshot", "position": "RANGED",
  "nationId": "lungmen", "bonds": ["lateranoShip", "swiftShip", "penguinShip"],
  "garrisonIds": ["garrison_zj_01_a", "garrison_zj_01_2_a"],
  "price": 2, "sellPrice": 1, "upgradeNum": 3, "upgradeChessId": "chess_zj_01_b",
  "status": { "phase": 2, "level": 1, "skillLevel": 4, "equipLevel": 0 },
  "stats": { "maxHp": 1338, "atk": 464, "def": 136, "res": 0, "cost": 12, "blockCnt": 1, "bat": 1, "aspd": 100 },
  "zhajing": true
}
```

> `stats` 是**已经乘过 `allyScale`（hp×3 / def×3 / atk×2.5）的白值**；`statsBase` 才是原始白值。
> 客户端与引擎换算见 [`shared/zhajingBase.js`](../modref/v2.1/shared/zhajingBase.js)（`allyScaleOf` / `zhajingBaseStats` / `zhajingBaseStats` 的调用方见 §2）。

**`chess_chen3_a/_b` 不是炸惊记录**：无 `zhajing`、带 `diyRequirement` / `diyFor`、`char_1050_chen3`（赤刃明霄陈）——
它是 0.3.1 的 DIY 记录，别当 zj 移植（但 99 张惊变里 `jibian_chixiaojianfa` 会发「精锐赤刃明霄陈」，
用到的正是 `chess_zj_*` 里同 charId 的记录；两者不要混淆）。

**包内 `chess` 独有字段**：`zhajing, form, pureStrong, diyFor, grantOnly, teamId, displayTokens`；
**本仓独有**：`placeOnRanged`。→ 移植时 `docs/research/18-*.json` 的 schema 要按本仓 0.3.3 的字段集重排。

### 1.3 `garrisons.json`：248 条，**零隔离标记**

- added 248 = **238 条 `garrison_zj_*`** + **10 条 `garrison_mujica_{oblvns,mortis,dolris,amoris,tmoris}[_b]`**。
- 记录字段集合与 0.3.3 **完全一致**（`garrisonId, desc, descRaw, eventType, eventTypeDesc, eventTypeIcon, effectType, effectKey, battleRuneKey, charLevel, bb, bbStr, owners`），
  **没有 `visible` / `zhajing` / `zjOnly`**。→ 隔离**完全靠** `chess_zj_*.garrisonIds` 的反向可达性。
- 231 次引用全部能在包内解析（0 悬挂）；**22 条 `garrison_zj_*` 没有被任何 chess 引用**（列在 `inventory.json → data.garrisonZj.unreferencedGarrisons`，例如
  `garrison_zj_21_a`、`garrison_zj_46_a`、`garrison_zj_48_sub_kjr_a/_b`、`garrison_zj_61_sub_yaya_a/_b`、`garrison_zj_72_sub_lye_a/_b`、
  `garrison_zj_89_sub_yqlg1_a/_b`、`garrison_zj_89_sub_yqlg2_a/_b`、`garrison_zj_90_sub_hllp_a/_b`、`garrison_zj_90_2_a/_b`、`garrison_zj_91_2_a/_b`、`garrison_zj_25_2_a/_b`、`garrison_zj_41_2_a/_b`）。
  这 22 条**仍是真数据**（可能由惊变/锻造动态挂载），删掉会静默改变玩法 → 移植要整批带走。
- 记录样例（`garrison_zj_01_2_a`，逐字，全文就 1 行）：

```json
{"garrisonId":"garrison_zj_01_2_a","desc":"<获得时>获得等于当前调度中心等级的【拉特兰】层数（无需激活盟约）","eventType":"SERVER_GAIN","eventTypeDesc":"单次叠加","eventTypeIcon":"icon_bond","effectType":"SERVER_ADD_BOND_METHOD","effectKey":"SERVER_ADD_BOND_METHOD","battleRuneKey":null,"charLevel":0,"bb":{"multi":1},"bbStr":{"add_method":"shoplv","bond":"lateranoShip"},"owners":[]}
```

### 1.4 `bonds.json`：5 条新盟约 + 21 个 `zj` 覆盖块

- 新增 5 条：`suiShip`（岁）、`penguinShip`（企鹅物流）、`physicianShip`（医师）、`seesShip`（S.E.E.S.）、`mujicaShip`（颂乐人偶）。
- 带 `zj` 块的共 **21 条** = 既有 **16 条**（sargonShip, victoriaShip, kjeragShip, lateranoShip, egirShip, siracusaShip,
  kazimierzShip, swiftShip, skillfulShip, steadShip, deputShip, visiShip, miraShip, investShip, raidShip, maniShip）+ 新增 5 条。
- **有 2 条既有盟约没有 `zj` 块但整条记录被改**：`preciShip`、`soloShip`（上游漂移，需人工核对是否含 zj 语义）。

**逐条「覆盖了哪些键」**（键 = `zj` 块内的顶层键；`thresholds` 一列是 覆盖前→覆盖后 的档位数）：

| 盟约 | 本仓有 | 覆盖键 | thresholds |
|---|---|---|---|
| `sargonShip` | ✓ | bb, desc, descRaw, effectDesc, effectDescRaw, spec | — |
| `victoriaShip` | ✓ | bb, buffs, desc, descRaw, effectDesc, effectDescRaw, layerMilestones, spec | — |
| `kjeragShip` | ✓ | bb, desc, descRaw, effectDesc, effectDescParams, effectDescRaw, spec | — |
| `lateranoShip` | ✓ | bb, desc, descRaw, effectDesc, effectDescParams, effectDescRaw, spec | — |
| `egirShip` | ✓ | bb, countMode, desc, descRaw, effectDesc, effectDescRaw, spec, **thresholds** | 3 → 3 |
| `siracusaShip` | ✓ | bb, desc, descRaw, effectDesc, effectDescParams, effectDescRaw, spec | — |
| `kazimierzShip` | ✓ | bb, desc, descRaw, effectDesc, effectDescParams, effectDescRaw | — |
| `swiftShip` | ✓ | bb, desc, descRaw, effectDesc, effectDescRaw, spec | — |
| `skillfulShip` | ✓ | **仅 `bb`** | — |
| `steadShip` | ✓ | bb, desc, descRaw, effectDesc, effectDescRaw, spec, **thresholds** | 3 → 3 |
| `deputShip` | ✓ | bb, buffs, desc, descRaw, effectDesc, effectDescRaw, spec | — |
| `visiShip` | ✓ | bb, desc, descRaw, effectDesc, effectDescParams, effectDescRaw, layerMilestones, spec | — |
| `miraShip` | ✓ | bb, buffs, desc, descRaw, effectDesc, effectDescRaw | — |
| `investShip` | ✓ | bb, buffsAll, desc, descRaw, effectDesc, effectDescRaw, layerMilestones, spec, **thresholds** | 2 → 2 |
| `raidShip` | ✓ | bb, desc, descRaw, effectDesc, effectDescParams, effectDescRaw, layerMilestones, spec, **thresholds** | 2 → 2 |
| `maniShip` | ✓ | bb, desc, descRaw, effectDesc, effectDescRaw, spec | — |
| `suiShip` | **新** | activeType, bb, bondType, countMode, countsHand, desc, descRaw, effectDesc, effectDescRaw, maxCount, noStack, spec, thresholds | 0 → 3 |
| `penguinShip` | **新** | activeType, bb, bondType, countMode, countsHand, desc, descRaw, effectDesc, effectDescRaw, equipCombo, maxCount, noStack, spec, thresholds | 0 → 2 |
| `physicianShip` | **新** | activeType, bb, bondType, countMode, desc, descRaw, effectDesc, effectDescRaw, equipCombo, maxCount, noStack, spec, thresholds | 0 → 1 |
| `seesShip` | **新** | activeType, bb, bondType, buffsAll, countMode, desc, descRaw, effectDesc, effectDescParams, effectDescRaw, equipCombo, maxCount, members, noStack, spec, thresholds | 0 → 2 |
| `mujicaShip` | **新** | members, visibleMembers, equipCombo, bb | — |

**全局键频次**（21 条里有几条覆盖了它）：`bb` 21、`desc` 19、`effectDesc` 19、`descRaw` 19、`effectDescRaw` 19、`spec` 17、
`effectDescParams` 7、`thresholds` 8、`countMode` 5、`bondType` 4、`activeType` 4、`noStack` 4、`maxCount` 4、`equipCombo` 4、
`layerMilestones` 4、`buffs` 3、`buffsAll` 2、`countsHand` 2、`members` 2、`visibleMembers` 1。

新盟约 `mujicaShip.zj` 逐字（最短、可当模板）：

```json
{
  "members": ["chess_zj_oblvns_a", "chess_zj_mortis_a", "chess_zj_dolris_a", "chess_zj_amoris_a", "chess_zj_tmoris_a"],
  "visibleMembers": ["chess_zj_oblvns_a", "chess_zj_mortis_a", "chess_zj_dolris_a", "chess_zj_amoris_a", "chess_zj_tmoris_a"],
  "equipCombo": ["chess_item_mujica_mask"],
  "bb": { "attack_speed_per_stack": 0.1 }
}
```

既有盟约 `lateranoShip.zj` 摘录（展示「数值袋 + 文案 + spec 说明」三件套的写法）：

```json
{
  "bb": { "atk_per_consume": 0.2, "max_atk_for_consume": 4, "zj_damage_up": 0.6, "zj_damage_up_per_stack": 0.002 },
  "effectDescParams": [ { "index": 1, "format": "0%", "base": "zj_damage_up", "perStack": "zj_damage_up_per_stack" } ],
  "desc": "【拉特兰】干员开启技能获得的弹药量提升（受层数影响）\n<在场6名不同【拉特兰】干员>…",
  "spec": { "zj": "弹药量提升沿用原公式；新增对敌人伤害 ×(1 + 0.60 + 0.002*L)；消耗弹药叠攻 4%→20%/发，上限 200%→400%。" }
}
```

合并/剥离逻辑在 [`shared/zjBonds.js`](../modref/v2.1/shared/zjBonds.js)（180 行，纯函数），
唯一入口 [`server/match/gamedata.js:126-128`](../modref/v2.1/server/match/gamedata.js)：

```js
this.zjCombos = zhajing ? zjEquipCombos(this._bonds) : null;   // 合并前先取装备组合表
this._bonds = zjBondView(this._bonds, { merge: zhajing });      // 非炸惊：只剥掉 zj 键，记录逐字节还原
```

战斗侧另有一份注入（`server/sim/Battle.js:86-87`，同一个合并函数）→ **移植时两条路都要接**，只接 gamedata 会让 sim 侧静默看不到覆盖。

### 1.5 `config.json`：两条 mode 记录

`modes.mode_single_zhajing` / `modes.mode_multi_zhajing`；`bans` 新增 `ZHAJING: {core:3, addon:4}`。
`mode_single_zhajing` 与本仓 `mode_single_annihilation` 的字段差集（`+Z` = 炸惊独有，`-Z` = 湮灭独有，`≠` = 同名不同值）：

| 键 | 炸惊 | 湮灭（本仓） | 结论 |
|---|---|---|---|
| `difficulty` | `"ZHAJING"` | `"ANNIHILATION"` | 门 |
| `inScope` | **`false`** | `true` | ⚠ 炸惊档不出现在「本局范围」里 |
| `code` / `sortId` | `AC-5` / `6` | `AC-5` / `6` | ⚠ **与湮灭撞码** |
| `name` | `炸惊模拟（BETAv0.799325）` | `湮灭模拟` | 需换 i18n |
| `color` / `iconId` / `backgroundId` | `#17d9a0` / `mode_zhajing_icon` / `background_abyss` | `#5b0a14` / `mode_annihilation_icon` / `background_annihilation` | 图标资产需新增 |
| `lastRound` / `bossRound` / `hiddenRound` | 14 / 14 / 15 | 19 / 19 / 20 | — |
| `spRounds` | `[1,2,3,6,7,8,9,10,11,12]` | `[3,9,11,13,15,17]` | 惊变/快递/悬赏都挂在 sp 阶段 |
| `specialPhaseTime` | 150 | 150 | = |
| `upgradePrices` / `maxShopLevel` / `levelTagColors` / `bossWeights` / `hiddenBossWeights` | 同湮灭 | 同 | = |
| `activeBondIds` | 23 条 | 23 条（不同集合） | — |
| `inactiveBondIds` | `["emptyShip","investShip"]` | `[]` | — |
| `enemyScale` / `shopSlots` / `stages` / `rounds` / `combatTimeLimit` | 炸惊专用数值 | — | ≠ |
| `bossHpScale` | `{bloodPointKey:'bloodPointAbyss', unaffectedByEnemyScale:true, hpMul:5, atkMul:6, base…}` | 只有前两个键 | 新增 `hpMul/atkMul` |

**炸惊独有的 25 个键**（本仓任何 mode 都没有）：
`allyScale`(`{hp:3,def:3,atk:2.5}`)、`equipPerChess`(2)、`bondLayerCap`(9999)、`chessPrice`(`{2:{normal:2,golden:2}}`)、
`enemyCountMul`(1)、`enemyResMul`(`{add:20,cap:70}`)、`bountyCoinMul`(2)、`bountyAfterPhase`(false)、
`income[31]`、`incomeCap`(0)、`leftoverFundsKept`(true)、`interest`(`{capital:5,interest:1,max:2}`)、`shopGift`、`rewardOffer`、
`spPhaseKinds`、`expressPool`(17)、`expressCards`(6)、`expressGroups`、`jibian`、`enemyJibian`、`morphEquipSlot`(true)、
`diyEnabled`(false)、`benchSize`(20)、`damageCap`(0)、`hiddenBossHpMul`(2)。
**湮灭独有**（炸惊没有）：`featureList`、`generation`、`annihilation`、`hiddenCore`。

`jibian` / `enemyJibian` / `spPhaseKinds` 逐字（这三块是惊变系统的**数据契约**）：

```json
"jibian": { "cards": 3, "rarityWeights": {"normal":35,"rare":30,"epic":20,"legend":10,"hidden":5},
            "rerolls": 4, "pool": [ 99 条 {effectId,name,desc,rarity,flavor?,bond?,hidden?} ],
            "noCoreBondLegendWeight": 30 },
"enemyJibian": { "enabled": true, "round": 1, "rounds": [1,6], "rarityWeights": {"normal":7,"epic":2,"legend":1},
                 "pool": [ 21 条 ], "flickerMs": …, "resultMs": …, "testCards": …, "hidden": … },
"spPhaseKinds": { "1":"jibian","2":"express","3":"jibian","6":"jibian","7":"express","8":"jibian",
                  "9":"bountyHigh","10":"jibian","11":"bountyHigh","12":"express" }
```

### 1.6 两个新数据文件

**`data/jibianBonds.json`**（4 714 B）—— 惊变羁绊。结构 = `{_note, bonds:[…]}`，每条 `{id, name, tiers:[…], members:[卡 id…], effect:一句话}`。
**18 条**（计划稿说 13 条）：`dmg2dmg, steady, glory, empathy, siracusa_wrath, freeship, roguelike_fan, cheat, modern_strongest,
army_alert, great_seal, true_investor, glorious_evo, layers_fan, toopainful, ave_mujica, craftsman, steel_heart`。
共 **65 个不同 member 卡 id**；`tiers` 是「凑齐几张才生效」的档位（多数 `[2]` 或 `[2,3]`，`roguelike_fan` 是 `[3,6]`，`true_investor` 是 `[4]`）。
`_note` 原文：「惊变羁绊：凑齐 members 里的卡达到 tiers 阈值时生效。UI 里每张卡显示它所属羁绊的 (已有/阈值)。」

> ⚠ **数据文件只是人类可读镜像**：引擎用的是 `server/sim/content/jibianBonds.js:1-37` 内联的同一张表
> （文件头注释原文：「数据内联在这里（纯 JS，两端都能跑）；data/jibianBonds.json 只是人类可读的镜像。」）。
> 客户端只 fetch `/data/jibianBonds.json` 做展示。→ 移植时两份必须同改，否则 UI 与判定不一致。

**`data/zjDefaultLoadout.json`**（11 131 B）—— 炸惊默认模组装配表：
`{version:1, note:"…策略 A：取数据里第一个模组；只收有默认模组的干员…", count:84, byBaseId:{ 84 条 }}`，
每条 = `{op, module, moduleName, typeName, choices}`，键是 chess 记录 id（如 `chess_zj_01_a`）。
接入点：服务端 [`server/data.js:81-84`](../modref/v2.1/server/data.js) `setZjDefaultModules(out.zjDefaultLoadout)`、
协议 [`shared/protocol.js:107-122`](../modref/v2.1/shared/protocol.js)、客户端 [`public/js/data.js:62-63`](../modref/v2.1/public/js/data.js) `zjLoadout: 'zjDefaultLoadout.json'`。

### 1.7 被计划稿一笔带过的三处 zj 数据

| 文件 | zj 内容 | 隔离口径 |
|---|---|---|
| `items.json` | 7 条 `chess_item_jibian_*`（卡兑换道具：trophy/banteng/chaodabei/gaoluzhipiao/jisusongda×3）、3 条 `chess_item_sees_*`、1 条 `chess_item_mujica_mask_a` | 7 条 jibian 道具 `shopExcluded:true + hideInShop:true`（**无 `zjOnly`**）；`sees_armband_a` / `mujica_mask_a` 是 `zjOnly:true` |
| `bands.json` | `band_zj_si`（祀）、`band_zj_fuuka`（风花？） | 两条都是 `zjOnly:true` |
| `tokens.json` | 15 条：`token_makoto_thanatos` / `token_makoto_orpheus`（makoto 召唤）+ 13 条 0.3.1 上游新干员召唤物（kalts_mon3tr、wisdel_wward、phatm2_*、Wang 棋子…） | **无标记**，靠 `chess.tokens` 引用可达 |
| `backups.json` | +6 units（`zhajing:true`：5 颂乐人偶 + makoto）+2 tokens | 备份表，随 zj 干员走 |

---

## 2. 引擎层：公开导出与调用方

### 2.1 模块 → 导出 → 调用方

包内 8 个模块合计 **3 785 行 / 58 个导出**。下表「外部契约」列 = 移植后**必须保持的调用方**（全包 grep，含测试与工具）。

| 模块 | 行数 | 导出（行号） | 外部调用方（谁在用） |
|---|---|---|---|
| `server/sim/content/jibian.js` | 2542 | `doubleAmmoForJibian@263`、`installJibianBonds@315`、`heartsteelScale@496`、`install@502`、`SKADI_CORRUPTED@1446`、`jibianGarrisonExtra@1456`、`registerMeta@2512` | `server/match/player/round.js:13,323`（`SKADI_CORRUPTED` 判浊心斯卡蒂）；6 个测试用 `registerMeta`；`install`/`registerMeta` 由 `content/index.js` 泛化调用（见 2.2） |
| `server/sim/content/ejibian.js` | 574 | `cardsOf@45`、`install@98`、`registerMeta@411`、`MATCH_CARDS@428`、`SLIME_KEY@438`、`RUZHI_CHANCE@440`、`RUZHI_SLIME_TOTAL@446`、`LIANGBIAN_COUNT_MUL@448`、`ZHIBIAN_COUNT_MUL@449`、`HORDE_COUNT_MUL@451`、`YAJUE_ROUNDS@453`、`HEAVEN_CUT_GAME_S@460`、`HEAVEN_MIN_LIMIT_GAME_S@461`、`jibianRoll@474`、`heavenTimeLimit@486`、`matchJibianPlan@500`、`jibianDuckParams@521`、`applyHiddenMatchCards@538` | `server/match/match/phases.js:9,391,569`；`server/match/waves.js:46,313,705,779,802,808`；`server/sim/content/bands/meta.js:40,526` |
| `server/sim/content/jibianBonds.js` | 109 | `jibianBonds@37`、`WILD_CARD@42`、`bondsOfCard@45`、`ownedJibianIdsOf@60`、`activeBonds@73`、`bondHintsFor@90` | `server/match/choices.js:65,544,558`；`server/match/effectsMeta.js:47,202,216,261`；`server/match/player/economy.js:13,147`；`server/sim/content/garrisons/battle.js:46`；`jibian.js:143`；`mujica.js:3`；`tools/add-mujica-jibian.mjs:6` |
| `server/sim/content/mujica.js` | 177 | `MUJICA_CHARS@5`、`FEVER_MAX@6`、`FEVER_DURATION@7`、`isMujica@9`、`getFeverMax@19`、`getFever@33`、`isFeverActive@34`、`feverState@35`、`addFever@51`、`ensureMujica@117` | 5 个颂乐人偶 kit（`kits/ops/chess_zj_{amoris,mortis,oblvns,dolris,tmoris}.js`）、`kits/shared/mujica.js`、`mujicaBond.js`、4 测试 + `tools/verify-mujica-render.mjs` |
| `server/sim/content/mujicaBond.js` | 146 | `MUJICA_BOND@6`（`'mujicaShip'`）、`install@17`、`registerMeta@85` | **不在 `DOMAIN_NAMES`**；由 `server/sim/content/bonds.js:21` 作为 `PARTS` 第三段加载（`['bonds/core','bonds/addon','mujicaBond']`）；3 个测试 |
| `shared/zjBonds.js` | 180 | `zjBondIds@20`、`zjBondRecord@27`、`zjBondView@107`、`zjPatches@134`、`zjItemKeyOf@148`、`zjEquipCombos@154`、`equipComboBonds@171` | `public/js/data.js:32,447`；`server/match/bondsMeta.js:27,106,109`；`server/match/gamedata.js:17,126,128`；`server/sim/Battle.js:56,86,87`；`server/sim/content/support/index.js:21,216-219` |
| `shared/zhajingBase.js` | 53 | `ZHAJING_ALLY_SCALE@16`、`allyScaleOf@23`、`allyScaleFromConfig@31`、`zhajingBaseStats@41`、`isZhajing@52` | `server/sim/battle/players.js:15,179`；`public/js/ui/detailPanel.js:50,517`；`public/js/ui/gameLogic/loadout.js:6,74` |
| `shared/mujicaJibian.js` | 4 | `MORTIS_BEAST_CARD@2`、`MORTIS_BEAST_TRAIT@3` | `public/js/ui/gameLogic/mujicaTraits.js:1`；`mujicaBond.js:4`；`tools/add-mujica-jibian.mjs:7`；`test/mujica-beast.test.mjs` |

**调用点细节（生产代码，摘几条最能说明契约的）**：

```js
// server/match/player/round.js:321-324  —— SKADI_CORRUPTED 决定「浊心斯卡蒂」的淘汰/替换语义
.some((p) => p && p.kind === 'chess' && (SKADI_CORRUPTED.includes(p.id) || SKADI_CORRUPTED.includes(p.baseId)))

// server/match/match/phases.js:391  —— 每轮进特殊阶段前算一份敌方惊变 plan
this.jibianPlan = matchJibianPlan(this.rngWaves, r, this.enemyJibianCards);

// server/match/waves.js:705,779  —— plan 影响出怪量；特定敌方惊变卡改写波次
const plan = opts.plan || (opts.jibian ? matchJibianPlan(rng, round, opts.jibian) : null);
if (jibian && cardsOf({ flags: { enemyJibian: jibian } }).has('ejibian_quanjunchuji')) {

// server/match/effectsMeta.js:202  —— 惊变羁绊直接改写「获得时」效果倍率
if (jibianActiveBonds(ownedJibianIdsOf(ps)).some((a) => a.def.id === 'true_investor')) return Math.max(1, v) * 2;

// server/match/bondsMeta.js:109  —— 装备组合激活盟约（歼惊专属的第二条通路）
for (const id of equipComboBonds(items.map((it) => it.id), gd.zjCombos)) if (gd.bond(id) && !out.includes(id)) out.push(id);

// server/sim/battle/players.js:179  —— allyScale 折进干员白值（不是战场乘区）
const as = allyScaleOf(this.flags && this.flags.allyScale);
```

### 2.2 装配契约：模块必须满足的四条

1. **域模块**：`DOMAIN_NAMES` 里加名字即自动 `install(battle)` + `registerMeta(registry)`；
   少写一个名字 = 该模块**全哑且不报错**（`installContent` 用 `try/catch` 吞掉异常，`modref/v2.1/server/sim/content/index.js:277-280`）。
   - 包内：`[...'choices','jibian','forge','ejibian']`（`index.js:44`）
   - 本仓：`[...'choices','hazard','relics']`（`server/sim/content/index.js:54`）
   - → 要加 `'jibian'`、`'forge'`、`'ejibian'` 三个名字，且 `installContent` 的 `mode:'full'` 才会装上。
2. **`registerMeta(registry)`**：`registry.register('choice:<effectId>', { onChoicePick, …hooks })` 是本仓库里**唯一**的「惊变卡副作用」注册面
   （`jibian.js:2512-2541` 注册了 96 张卡的 `ON_PICK` + `HOOKS`，外加 3 个 `item:chess_item_jibian_jisusongda_*` 的 `onEquip`）。
3. **`install(battle)`**：战斗内常驻逻辑（`jibian.js:502` 2542 行里的大头、`ejibian.js:98`、`mujicaBond.js:17`、`forge.js:36`）。
4. **`mujicaBond.js` 走 `bonds.js` 的 `PARTS`**，不进 `DOMAIN_NAMES`；且 `bonds/addon/meta.js:252-254` 明确写着
   「本文件也注册过 `bond:mujicaShip`，后注册会覆盖先注册，放这里会被 mujicaBond 的 onRefresh 顶掉（已实测）」——
   **注册顺序有意义**，不要随手挪。

### 2.3 计划稿未收录的子系统：锻造器（forge）

| 文件 | 行数 | 导出 | 调用方 |
|---|---|---|---|
| `shared/forgeData.js` | 234 | `FORGE_KILLS_PER@21`、`FORGE_RARITY@24`、`isForgeRarity@33`、`FORGE_OPTIONS@42`、`forgeOptionById@97`、`optionsFor@100`、`rollRarity@103`、`drawForge@118`、`amountOf@134`、`applyForgePick@149`、`forgedEntries@163`、`forgedText@172`、`forgedCount@178`、`valueText@181`、`valueNote@190`、`forgeBattleMods@213`、`forgeModsEmpty@232` | 服务端 `match/player/acquire.js`（`forgeTake`）、战斗侧 `content/forge.js`、客户端 `public/js/ui/forge.js` |
| `server/sim/content/forge.js` | 110 | `BASE_CRIT@34`（0.05）、`install@36` | `DOMAIN_NAMES` 的 `'forge'` |
| `public/js/ui/forge.js` | 231 | `forgeOpen@50`、`forgeClose@52`、`forgedToggle@54`、`KillCounter@72`、`ForgeButton@91`、`ForgePanel@127`、`ForgedChip@180`、`ForgedPanel@192` | `public/js/ui/hud.js:36`（HUD 直接 import） |

它同时改了三处「引擎级」的东西，移植时不能漏：
`server/sim/units.js:220`（`crit`/`vamp` 两个新属性）、`server/sim/buffs.js:26-27`（`ADD_KEYS` 加键）、
`server/sim/damage.js:346`（`dmg` 事件第 5 位是暴击标记）、`shared/constants.js:238` + `server/sim/constants.js:238`（`damageCap`）。

### 2.4 不在注册表里的 5 张卡：跨模块内联钩子

99 张惊变里有 3 张（`jibian_erjiguan` / `jibian_yanrenhuifei` / `jibian_jibangzhili`）在 `jibian.js` 里**没有实现**，
2 张敌方惊变（`ejibian_quanjunchuji` / `ejibian_jingtianmodaotuan`）不在 `ejibian.js` 里 —— 它们散在别的文件：

| 卡 id | 实现位置 |
|---|---|
| `jibian_erjiguan`（二极管） | `server/match/effectsMeta.js:52,239-251`、`server/sim/content/garrisons/battle.js:63-71,254` |
| `jibian_yanrenhuifei`（炎国人会飞） | `server/match/bondsMeta.js:150,175-179`、`server/sim/content/bonds/addon/battle.js:415`、`server/sim/content/support/index.js:238-241` |
| `jibian_jibangzhili`（羁绊之力，= `WILD_CARD`） | `server/sim/content/jibianBonds.js:42`、`server/match/choices.js:652` |
| `ejibian_quanjunchuji`（全军出击） | `server/match/waves.js:779` |
| `ejibian_jingtianmodaotuan`（惊天魔盗团） | `server/match/player/round.js:32` |

→ **「把 5 个文件搬过去」不等于移植完**；这 10 处钩子都在 `match/` 与 `sim/` 的既有文件里，是 zj hunk 的一部分（§5）。

---

## 3. 客户端

扫描口径：包内 `public/js/**` + `public/css/**` 共 274 个 `.js/.css`，grep `炸惊|zhajing|jibian|惊变|zjOnly|zj` 有 **60 个命中**
（其中 43 个提到 `炸惊|zhajing`，31 个提到 `jibian|惊变`）。分类见下表；「本仓同名文件」一列是逐字节对比结果。

### ① 入口 / 大厅（5 个文件）

| 文件 | 行数 | zj 命中行 | 职责 | 本仓同名文件 |
|---|---|---|---|---|
| `public/js/screens/lobby.js` | 1138 | 13 | 大厅（炸惊入口按钮与难度档位） | 有（内容不同） |
| `public/js/ui/zhajingLoadoutButton.js` | 15 | 6 | 大厅右侧「炸惊模拟干员调配」入口（先切档再开调配） | **无（新增）** |
| `public/js/screens/lobbyFeed.js` | 209 | 4 | 大厅公共信息条（在线数 + 房间列表） | **无（新增）** |
| `public/js/main.js` | 493 | 1 | 客户端入口（命中处为惊变时序注释） | 有（内容不同） |
| `public/css/screens/lobby.css` | 2493 | 1 | 大厅样式（炸惊入口/难度卡） | 有（内容不同） |

### ② 局内面板（惊变三选一 / 已选惊变 / 一览 / 敌方惊变 / 锻造 / Fever）（42 个文件）

| 文件 | 行数 | zj 命中行 | 职责 | 本仓同名文件 |
|---|---|---|---|---|
| `public/js/ui/jibianList.js` | 283 | 82 | 「惊变一览」角落按钮 + 面板：读 /data/jibianBonds.json，只读一次、失败显示空 | **无（新增）** |
| `public/js/screens/sweep.js` | 603 | 39 | S.W.E.E.P. 战斗报告：列出本局惊变/锻造等统计 | 有（内容不同） |
| `public/js/ui/jibianPanel.js` | 171 | 37 | 「已选惊变」面板（我方/敌方/羁绊三页），读 m.private + /data/jibianBonds.json | **无（新增）** |
| `public/css/screens/game-panels.css` | 1315 | 36 | 局内面板样式（惊变卡/环/浮层） | 有（内容不同） |
| `public/js/screens/game.js` | 1627 | 27 | 局内屏（phase 分发）：惊变阶段、锻造入口、Fever HUD 挂载 | 有（内容不同） |
| `public/js/ui/choiceOverlay.js` | 303 | 17 | 机变/惊变三选一浮层（共享）：惊变卡美术、羁绊提示、重抽按钮 | 有（内容不同） |
| `public/js/ui/bondStrip.js` | 279 | 15 | 顶部盟约条与详情弹窗（zj 覆盖后的层数/门槛） | 有（内容不同） |
| `public/js/ui/gameLogic/bonds.js` | 428 | 13 | 盟约计数/成员/和谐/本局禁用的纯逻辑（含 zj 覆盖旁路） | 有（内容不同） |
| `public/js/ui/gameLogic/bingCue.js` | 77 | 12 | 惊变卡 jibian_bing 的「冰冰冰」音效判定 | **无（新增）** |
| `public/js/ui/enemyJibianOverlay.js` | 88 | 11 | 敌方惊变揭示浮层（规则14：每局第一次进战斗时翻一张） | **无（新增）** |
| `public/js/ui/detailPanel.js` | 1009 | 9 | 详情面板（白值折算 allyScale、锻造两行、惊变卡说明） | 有（内容不同） |
| `public/js/ui/shopBar.js` | 495 | 7 | 商店栏（炸惊卖价/板藤套现键位） | 有（内容不同） |
| `public/js/audio.js` | 1600 | 6 | 音频管理（惊变/锻造/Fever 音效路由） | 有（内容不同） |
| `public/js/render/app/info.js` | 81 | 6 | 战斗单位信息与死亡粒子（惊变相关标记） | 有（内容不同） |
| `public/js/render/app.js` | 2290 | 6 | 战场渲染主循环（Fever 能量条、锻造特效） | 有（内容不同） |
| `public/js/ui/gameActions.js` | 94 | 6 | 局内意图 g.*（sellBanteng / forgeTake 等） | 有（内容不同） |
| `public/js/battle/observe.js` | 207 | 5 | 观战标签（敌方惊变可见性） | 有（内容不同） |
| `public/js/ui/gameComponents.js` | 318 | 5 | 局内共享组件（富文本/图片兜底） | 有（内容不同） |
| `public/js/ui/jibianArt.js` | 19 | 5 | 惊变卡美术解析（三处面板共用） | **无（新增）** |
| `public/js/ui/assetUrls.js` | 239 | 4 | 资源 URL 解析（jibian/锻造图标） | 有（内容不同） |
| `public/js/ui/gameLogic/shop.js` | 231 | 4 | 商店价格/合并/报价纯逻辑（炸惊价格表） | 有（内容不同） |
| `public/js/ui/watchBonds.js` | 275 | 4 | 观战时的盟约栏数据源 | 有（内容不同） |
| `public/js/screens/bandDraft.js` | 354 | 3 | 策略 2/2 选择屏（炸惊 spPhaseKinds 的 express 分支） | 有（内容不同） |
| `public/js/ui/effectsList.js` | 65 | 3 | 生效中效果列表（bands/机变/惊变/卫戍） | 有（内容不同） |
| `public/js/ui/gameLogic/mujicaTraits.js` | 19 | 3 | 多首野兽卡的特质显示替换（MORTIS_BEAST_TRAIT） | **无（新增）** |
| `public/js/ui/hud.js` | 450 | 3 | 局内顶栏（锻造按钮挂点） | 有（内容不同） |
| `public/js/render/fx/kinds.js` | 176 | 2 | fx kind 表（锻造/惊变特效 id） | 有（内容不同） |
| `public/js/render/prepfield.js` | 154 | 2 | 整备场显示（惊变改动后的棋盘） | 有（内容不同） |
| `public/js/screens/banPicker.js` | 157 | 2 | 卡池预选（炸惊档的 ban 表） | **无（新增）** |
| `public/js/screens/briefing.js` | 111 | 2 | 本局信息确认（惊变相关说明） | 有（内容不同） |
| `public/js/ui/gameLogic/bench.js` | 22 | 2 | 待部署区规格（炸惊翻倍） | **无（新增）** |
| `public/css/screens/game.css` | 1014 | 2 | 局内主样式（惊变角标/环） | 有（内容不同） |
| `public/js/render/drag.js` | 291 | 1 | 整备拖拽交互（炸惊独立装备格） | 有（内容不同） |
| `public/js/render/units.js` | 2190 | 1 | 单位视图（装备格数/惊变标记） | 有（内容不同） |
| `public/js/ui/enemyDrawer.js` | 112 | 1 | 本局信息抽屉（敌方惊变一览） | 有（内容不同） |
| `public/js/ui/forge.js` | 231 | 1 | 锻造器 HUD：按钮/悬浮窗/击杀计数/已锻造面板 | **无（新增）** |
| `public/js/ui/gameLogic/draft.js` | 95 | 1 | 机变/策略草稿归一化（jibian 家族） | 有（内容不同） |
| `public/js/ui/gameLogic/equipSlots.js` | 78 | 1 | 装备槽位数（炸惊 morphEquipSlot 独立第三格） | **无（新增）** |
| `public/js/ui/gameLogic/modeRules.js` | 26 | 1 | 客户端需要的按模式小开关 | **无（新增）** |
| `public/js/ui/gameLogic/phases.js` | 233 | 1 | 阶段家族与横幅（惊变阶段横幅） | 有（内容不同） |
| `public/js/ui/gameLogic/placement.js` | 575 | 1 | 部署图与 canPlace 镜像（炸惊改动） | 有（内容不同） |
| `public/js/ui/matchInfo.js` | 191 | 1 | 本局信息（盟约与 ban 位） | 有（内容不同） |

### ③ 规则页 / 说明（1 个文件）

| 文件 | 行数 | zj 命中行 | 职责 | 本仓同名文件 |
|---|---|---|---|---|
| `public/js/ui/zhajingRules.js` | 62 | 28 | 炸惊规则介绍页（纯静态文案 + 图标） | **无（新增）** |

### ④ 干员调配（炸惊页签、快速配置、默认模组）（9 个文件）

| 文件 | 行数 | zj 命中行 | 职责 | 本仓同名文件 |
|---|---|---|---|---|
| `public/js/ui/loadoutSync.js` | 516 | 54 | 编队/持有/自选同步（炸惊档的存取与 zj 默认模组） | 有（内容不同） |
| `public/js/screens/loadout.js` | 1323 | 31 | 干员调配屏（炸惊页签、快速配置、默认模组） | 有（内容不同） |
| `public/js/ui/loadoutModel.js` | 609 | 21 | 干员调配纯逻辑（含炸惊记录的 baseId 归一） | 有（内容不同） |
| `public/js/ui/zhajingSwitch.js` | 27 | 13 | 干员调配屏的「普通 / 炸惊」页签切换 | **无（新增）** |
| `public/css/screens/loadout-jibian.css` | 114 | 9 | 干员调配「炸惊」页签样式 | **无（新增）** |
| `public/css/screens/loadout.css` | 1208 | 5 | 干员调配主样式（炸惊页签挂点） | 有（内容不同） |
| `public/js/ui/gameLogic/loadout.js` | 123 | 3 | 卡面技能/模组展示（zhajingBaseStats 折算） | 有（内容不同） |
| `public/js/ui/skinPicker.js` | 133 | 2 | 皮肤选择器（干员调配屏的「皮肤」分区） | 有（内容不同） |
| `public/js/ui/skins.js` | 197 | 2 | 干员皮肤：客户端状态与同步 | 有（内容不同） |

### 未归类：数据层与工具链（仅注释或间接命中）（3 个文件）

| 文件 | 行数 | zj 命中行 | 职责 | 本仓同名文件 |
|---|---|---|---|---|
| `public/js/data.js` | 541 | 23 | 数据懒加载（zjLoadout / bonds 的 zj 视图合并） | 有（内容不同） |
| `public/js/assets.js` | 993 | 1 | 资源清单（/data/assets.json） | 有（内容不同） |
| `public/js/render/app/view.js` | 149 | 1 | 相机与棋盘取景（炸惊棋盘尺寸） | 有（内容不同） |

**本仓没有同名文件的客户端文件（16 个）**：`public/js/screens/banPicker.js`、`public/js/screens/lobbyFeed.js`、`public/js/ui/enemyJibianOverlay.js`、`public/js/ui/forge.js`、`public/js/ui/gameLogic/bench.js`、`public/js/ui/gameLogic/bingCue.js`、`public/js/ui/gameLogic/equipSlots.js`、`public/js/ui/gameLogic/modeRules.js`、`public/js/ui/gameLogic/mujicaTraits.js`、`public/js/ui/jibianArt.js`、`public/js/ui/jibianList.js`、`public/js/ui/jibianPanel.js`、`public/js/ui/zhajingLoadoutButton.js`、`public/js/ui/zhajingRules.js`、`public/js/ui/zhajingSwitch.js`、`public/css/screens/loadout-jibian.css`

**CSS 命中（5 个）**：`public/css/screens/game-panels.css`（1315 行 / 36 命中）、`public/css/screens/game.css`（1014 行 / 2 命中）、`public/css/screens/loadout-jibian.css`（114 行 / 9 命中）、`public/css/screens/loadout.css`（1208 行 / 5 命中）、`public/css/screens/lobby.css`（2493 行 / 1 命中）

**归档要点**：
- 16 个本仓无同名的客户端文件是**纯新增**（其中 `jibianList.js` / `jibianPanel.js` / `enemyJibianOverlay.js` / `forge.js` /
  `zhajingRules.js` / `jibianArt.js` / `bingCue.js` 是「炸惊独有 UI」，其余 9 个是小工具模块/样式）。
- 42 个局内面板文件里，真正承载炸惊交互的是 **7 个**：`jibianPanel`（已选）、`jibianList`（一览）、`choiceOverlay`（三选一，共享）、
  `enemyJibianOverlay`（敌方）、`jibianArt`（美术）、`forge`（锻造）、`render/mujicaHud`（Fever）；其余是**被 zj 改动波及**的既有文件。
- 「规则页」在本仓只有 `ui/zhajingRules.js` 一页（62 行，静态文案 + 图标），没有独立的规则路由。

---

## 4. 资产：只导炸惊相关 ≈ 212 MB

口径：zip 中央目录条目（**未解压**，`modref/zip-entries.tsv`，51 517 条），只取 `public/assets/**`，再与本仓**已装**的
`public/assets/**`（37 903 个文件 / 3 291 MB）做**路径级差集**，得到「真需要导入」的增量。

| 集合 | zip 内条目 | 其中本仓已有 | **需导入** |
|---|---|---|---|
| `chess_zj_*` 的 101 个 `charId` | 7 952 个 / 605.9 MB | 6 864 个 / 400.3 MB | **1 088 个 / 205.5 MB** |
| 其中「本仓 chess 里没有的 34 个 charId」 | 2 516 个 / 257.3 MB | 1 653 个 / 95.8 MB | 863 个 / 161.4 MB |
| 其中颂乐人偶五人 | 294 个 / 89.9 MB | 0 | **294 个 / 89.9 MB** |
| `jibian`/`ejibian`/`mujica`/`forge` 命名的资产 | 170 个 / 16.4 MB | 0 | **170 个 / 16.4 MB** |
| **合计（101 charIds ∪ 命名资产）** | — | — | **1 216 个 / 212.4 MB** |

按资产组拆（需导入部分）：`char` 309 个 / 122.07 MB、`spine` 195 个 / 56.23 MB、`audio` 572 个 / 28.43 MB、
`local` 136 个 / 4.48 MB（惊变道具图镜像）、`bond` 1 个 / 0.64 MB、`item` 2 个 / 0.54 MB、`jibian` 1 个 / 0.04 MB。

**按干员分组（只列需导入量最大的 12 个；完整 34 个见 `inventory.json → assets.perNewChar`）**

| charId | 需导入文件 | 需导入字节 | 所属 |
|---|---|---|---|
| `char_4182_oblvns` 丰川祥子 | 60 | 20.05 MB | 颂乐人偶 |
| `char_4186_tmoris` | 60 | 19.05 MB | 颂乐人偶 |
| `char_4185_amoris` | 60 | 18.50 MB | 颂乐人偶 |
| `char_4184_dolris` | 54 | 17.00 MB | 颂乐人偶 |
| `char_4183_mortis` | 60 | 15.27 MB | 颂乐人偶 |
| `char_4217_makoto` | 103 | 10.82 MB | 0.3.3 新干员 |
| `char_4219_yukari` | 101 | 10.62 MB | 0.3.3 新干员 |
| `char_4218_aigis` | 101 | 6.21 MB | 0.3.3 新干员 |
| `char_4231_clemnt` | 36 | 5.32 MB | 上游新干员 |
| `char_4220_kormr` | 101 | 4.49 MB | 0.3.3 新干员 |
| `char_1052_kalts2` | 2 | 3.72 MB | 已有干员（缺 1 张立绘/语音） |
| `char_1035_wisdel` | 10 | 3.22 MB | 已有干员 |

**惊变图标 / 音效（`jibian` 命名，共 32 个条目 / 2.22 MB，全部需导入）** —— 逐条：

```
audio/sfx/jibian/bing_bing_bing.mp3        36 565 B
audio/sfx/jibian/heartsteel.mp3            20 940 B
audio/sfx/jibian/siwanghuigui.mp3         431 060 B
audio/sfx/jibian/yijieshenjiang.mp3        81 713 B
item/jibian_liuyan.png                    262 844 B
item/jibian_qingpaibeibu.png              302 636 B
jibian/liuyan.jpg                          38 188 B
local/items/jibian/*.png                   24 个（惊变卡面：banteng/chaodabei/gaoluzhipiao/jisusongda×3/mask/…）
```

> 结论：**「炸惊相关资产」≈ 212 MB / 1 216 个文件**（其中颂乐人偶五人 90 MB、惊变卡面与音效 2.2 MB，
> 其余 120 MB 是 34 个新干员的立绘 + spine + 语音）。若改为「只导 5 个颂乐人偶 + 惊变卡面音效」则约 **92 MB**。
> `public/assets/` 已 gitignore，AGENTS.md「no game art in git」不变。

---

## 5. 0.3.1 → 0.3.3 漂移分组

口径：包内 **948** 个 `.js/.mjs/.css/.html` 按相对路径与本仓同名文件逐字节对比（`public/assets`、`node_modules` 排除）。

| 组 | 文件数 | 含义 | 处置 |
|---|---|---|---|
| 组 1 逐字节相同 | **258** | 上游没动 | 不用管 |
| 组 2 仅上游漂移 | **395** | 内容不同，但包里该文件**一处 zj 标记都没有** | **不要整文件覆盖**；只有在移植时被 zj 逻辑碰到的那几行才看 |
| 组 3 含 zj hunk | **120** | 内容不同且含 `炸惊/zhajing/jibian/惊变/mujica/zjOnly` 命中 | **必须逐 hunk 移植**（核心 62 / 痕迹 58） |
| 包内独有 | **175** | 本仓没有这个路径（含 108 个带 zj 标记） | 新增（注意 0.3.3 的 `ver-*` 约定，§5.2） |
| 本仓独有 | **1971** | 0.3.3 新增/重命名 | 与本次迁移无关，但**是「整文件覆盖必炸」的主因** |

组 2 的分布（最能说明「上游漂移」的规模）：`server/sim` 184 个、`public/js` 96 个、`server/match` 19 个、`shared/plugins` 14 个、
`public/studio` 13 个、`public/css` 12 个、`server/http` 11 个、`server/plugins` 10 个、`server/studio` 10 个 —— 全是上游重构。

组 3 的分布：`public/js` 46、`server/sim` 32、`server/match` 31、`public/css` 4、`shared/*` 4、`server/lobby.js` 1、`public/index.html` 1、`server/data.js` 1。

### 5.1 组 3 — 含 zj hunk 的文件（120 个；按命中数降序）

（行号 = 包内该文件中命中 `炸惊|zhajing|jibian|惊变|mujica|zjOnly|zj` 的行，连续行已合并为区间；「前 12 段」之外的区间见 `inventory.json → drift.detail`。）

**A. 核心 62 个（≥5 处命中，改动必然涉及逻辑）**

| 文件 | 包内行数 | 命中 | zj hunk 大致行号（前 12 段） |
|---|---|---|---|
| `server/match/player/economy.js` | 592 | 86 | 4, 13, 38, 46, 67, 69-71, 86, 89-90, 108, 121, 137, 142 |
| `server/match/choices.js` | 807 | 73 | 65, 67, 139-140, 145-146, 148, 151, 156, 163, 167, 210, 212-213, 215 |
| `server/match/gamedata.js` | 966 | 72 | 17, 51, 91, 114-115, 118-119, 121-122, 126-128, 130, 132, 160, 170-171, 222 |
| `server/match/match/phases.js` | 598 | 62 | 9-10, 342-343, 369, 388, 391, 395, 398, 421, 426-429, 431-433, 437-438, 445-450 |
| `server/match/match/spDraft.js` | 621 | 57 | 23-24, 26, 34, 38, 56-63, 73, 80-81, 83, 85, 87, 98, 100-101 |
| `public/js/audio.js` | 1600 | 50 | 494, 641, 915, 1063, 1068, 1070, 1079-1080, 1096, 1187-1188, 1323-1328, 1330-1331, 1333-1340 |
| `server/match/effectsMeta.js` | 866 | 38 | 47, 52, 81-83, 199, 202, 209, 211-212, 216, 225-226, 236, 239, 249-251 |
| `public/css/screens/game-panels.css` | 1315 | 32 | 416-421, 454-455, 462, 468, 507, 735, 752, 780, 823-828, 851-853, 861, 877 |
| `server/sim/content/bonds/core.js` | 856 | 30 | 214-216, 247, 251, 253, 347, 349, 481, 483-484, 487, 515, 517, 519 |
| `shared/protocol.js` | 748 | 30 | 107, 109, 122, 141, 145, 147-148, 153, 177, 201, 224-226, 233, 284-286 |
| `server/match/player/views.js` | 218 | 29 | 31, 35-38, 46, 50, 55-56, 67-68, 98-99, 120, 125, 155-164, 166-167, 199 |
| `server/match/waves.js` | 1090 | 28 | 31, 45-46, 262, 313, 456, 507, 512, 542, 547, 557, 569, 607 |
| `public/js/screens/sweep.js` | 603 | 27 | 21, 150, 154-156, 164-165, 183, 185, 188, 201-203, 209, 213, 219, 223 |
| `server/sim/content/bonds/addon/meta.js` | 256 | 27 | 7, 28, 47-49, 53, 92, 112, 120, 122-123, 125, 129, 131, 133 |
| `public/js/screens/game.js` | 1627 | 26 | 79, 81, 89-90, 210, 597, 608, 793, 819-820, 1375-1377, 1380, 1385, 1521 |
| `public/js/ui/loadoutSync.js` | 516 | 26 | 46-48, 52-53, 58, 60-61, 70, 75, 82, 94, 96, 105-106, 114, 124-125 |
| `server/sim/content/jibianBonds.js` | 109 | 25 | 1, 4, 10-27, 37, 42, 52, 60, 67 |
| `server/sim/content/bands/meta.js` | 569 | 24 | 22, 40, 253-255, 258-261, 266, 269, 271, 274, 281, 313, 322, 477 |
| `shared/constants.js` | 532 | 22 | 94-95, 97, 104, 115, 119, 132, 135, 149, 160, 162, 168, 176-177 |
| `public/js/render/vfx/skillfx.js` | 1510 | 21 | 218-219, 898-899, 981, 1014-1015, 1017-1018, 1072, 1075, 1089, 1092, 1097, 1099, 1125 |
| `server/match/bondsMeta.js` | 424 | 19 | 27, 34, 41, 106, 128-129, 132, 149-150, 153-154, 156-157, 167, 175, 179 |
| `server/sim/content/bonds/addon/battle.js` | 689 | 19 | 70, 82, 91, 93, 143, 186, 188, 193, 195, 213-215, 413, 415 |
| `public/js/data.js` | 541 | 18 | 32, 61, 219, 366, 427-428, 431-433, 436-438, 441-442, 444, 446-448 |
| `public/js/screens/loadout.js` | 1323 | 18 | 62-63, 65, 777-778, 780, 816, 886, 889, 942, 945-946, 948, 980, 1144-1145 |
| `public/js/ui/choiceOverlay.js` | 303 | 18 | 28, 32, 35, 72, 78, 81, 97, 99-101, 103, 176, 212, 221 |
| `server/match/match/bossRounds.js` | 614 | 18 | 42-45, 47, 62, 81, 86, 116-118, 390, 553, 556, 590, 594-596 |
| `server/sim/content/garrisons/battle.js` | 887 | 18 | 46, 58, 63-64, 71, 78, 89, 91, 142, 254, 289, 399, 495 |
| `server/sim/content/support/index.js` | 416 | 18 | 21, 50, 53, 58, 61, 63, 65, 216-217, 234-236, 238, 241, 246-247 |
| `public/js/ui/loadoutModel.js` | 609 | 16 | 22-23, 236, 239, 241, 254, 256-257, 290, 292, 303, 456, 458, 460 |
| `server/match/match/views.js` | 454 | 16 | 130, 219, 221-224, 227, 230, 234-235, 238-239, 241, 244, 248-249 |
| `public/js/render/app.js` | 2290 | 15 | 173, 236-237, 606, 608, 814, 847, 1509, 1692, 1729-1730, 1735, 1739, 2224-2225 |
| `shared/zjBonds.js` | 180 | 15 | 1, 3-5, 19-20, 27, 37, 100, 107, 111, 118, 131, 141, 145 |
| `public/js/ui/gameLogic/bonds.js` | 428 | 13 | 186, 253-254, 284-289, 314-315, 407-408 |
| `shared/zhajingBase.js` | 53 | 13 | 1, 4, 8, 12-13, 15-16, 30, 33-34, 41, 51-52 |
| `public/js/screens/lobby.js` | 1138 | 12 | 40-43, 622, 624-625, 976-980 |
| `public/js/ui/bondStrip.js` | 279 | 12 | 158-159, 176-178, 182-183, 186-187, 189, 193-194 |
| `server/lobby.js` | 1904 | 12 | 239, 241, 246-247, 754-757, 933-934, 1134-1135 |
| `server/match/player/round.js` | 329 | 12 | 13, 20, 25, 29, 31-32, 77, 97, 198, 306, 321, 324 |
| `public/js/ui/detailPanel.js` | 1009 | 10 | 50, 57, 365-366, 473-474, 487, 515-516, 529 |
| `server/sim/units.js` | 327 | 10 | 43, 58, 111-112, 114, 148, 156, 158, 220-221 |
| `server/match/match/intents.js` | 144 | 8 | 25, 27, 31, 33, 45, 58, 130, 132 |
| `server/match/match/prep.js` | 157 | 8 | 12-16, 20, 22, 25 |
| `server/match/match/settle.js` | 235 | 8 | 88, 102, 114, 116, 135, 152, 155-156 |
| `server/sim/battle/players.js` | 278 | 8 | 15, 170, 172-173, 175, 186, 189, 222 |
| `public/js/ui/shopBar.js` | 495 | 7 | 14, 16, 19, 361, 363-365 |
| `server/match/match/messaging.js` | 352 | 7 | 120, 127, 153, 158-160, 165 |
| `server/match/player/acquire.js` | 530 | 7 | 83, 164, 176, 332, 362, 396, 408 |
| `server/match/player/basics.js` | 369 | 7 | 21, 140, 142-143, 145-146, 183 |
| `server/sim/Battle.js` | 216 | 7 | 56, 77, 83, 86, 107-108, 194 |
| `server/sim/content/index.js` | 294 | 7 | 44, 80-81, 85-86, 88, 99 |
| `server/sim/simdata.js` | 947 | 7 | 252, 604, 606, 612, 626, 672-673 |
| `public/js/render/app/info.js` | 81 | 6 | 4, 37-38, 40-42 |
| `public/js/ui/gameActions.js` | 94 | 6 | 56, 58, 62, 64, 78, 85 |
| `server/match/player/diy.js` | 293 | 6 | 141, 145, 149, 152, 154, 259 |
| `server/sim/content/bands/battle.js` | 302 | 6 | 16, 63-64, 79-80, 85 |
| `server/sim/snapshot.js` | 240 | 6 | 50-51, 53-55, 79 |
| `public/js/battle/observe.js` | 207 | 5 | 172, 179, 181-182, 184 |
| `public/js/render/vfx/wiring.js` | 1783 | 5 | 367, 527, 531, 1010, 1015 |
| `server/match/finalAssault.js` | 186 | 5 | 68, 71, 80, 82, 99 |
| `server/match/match/combat.js` | 202 | 5 | 65, 155, 158, 168, 170 |
| `server/sim/content/garrisons/meta.js` | 462 | 5 | 115, 152, 230-231, 234 |
| `server/sim/content/kits/index.js` | 202 | 5 | 32, 38, 53, 60, 67 |

**B. 痕迹 58 个（1–4 处命中；多为一行注释或单个 gd.zhajing 门，逐条核对再决定是否移植）**

| 文件 | 包内行数 | 命中 | 行号 |
|---|---|---|---|
| `public/js/ui/assetUrls.js` | 239 | 4 | 153-155, 158 |
| `public/js/ui/gameLogic/shop.js` | 231 | 4 | 137, 143, 195, 203 |
| `public/js/ui/watchBonds.js` | 275 | 4 | 32, 132-133, 140 |
| `server/match/fields.js` | 1161 | 4 | 878, 880-882 |
| `public/js/render/fx/kinds.js` | 176 | 3 | 13, 44, 66 |
| `public/js/screens/bandDraft.js` | 354 | 3 | 55-56, 58 |
| `public/js/ui/effectsList.js` | 65 | 3 | 11, 58-59 |
| `public/js/ui/gameLogic/loadout.js` | 123 | 3 | 6, 72, 74 |
| `public/js/ui/hud.js` | 450 | 3 | 365, 367, 398 |
| `server/match/audit.js` | 620 | 3 | 74, 157, 570 |
| `server/match/match/unitePhase.js` | 473 | 3 | 341, 343, 345 |
| `server/match/player/items.js` | 279 | 3 | 91, 163, 165 |
| `server/match/PlayerState.js` | 292 | 3 | 197-198, 241 |
| `server/sim/battle/lifecycle.js` | 257 | 3 | 64, 69, 243 |
| `server/sim/content/enemies/helpers.js` | 409 | 3 | 307-308, 312 |
| `server/sim/content/kits/ops/op-chen3.js` | 339 | 3 | 81-82, 85 |
| `public/css/screens/game.css` | 1014 | 2 | 904, 994 |
| `public/css/screens/loadout.css` | 1208 | 2 | 1155, 1160 |
| `public/index.html` | 151 | 2 | 58-59 |
| `public/js/render/prepfield.js` | 154 | 2 | 55, 66 |
| `public/js/screens/briefing.js` | 111 | 2 | 41, 43 |
| `public/js/ui/gameComponents.js` | 318 | 2 | 31, 34 |
| `public/js/ui/skinPicker.js` | 133 | 2 | 81-82 |
| `public/js/ui/skins.js` | 197 | 2 | 65-66 |
| `server/match/bot.js` | 2327 | 2 | 414, 1482 |
| `server/match/builtinMeta.js` | 374 | 2 | 127, 129 |
| `server/match/match/watch.js` | 308 | 2 | 240, 242 |
| `server/match/player/placement.js` | 400 | 2 | 47, 52 |
| `server/sim/battle/spawns.js` | 215 | 2 | 115, 118 |
| `server/sim/content/bonds.js` | 41 | 2 | 21-22 |
| `server/sim/content/devices.js` | 595 | 2 | 122, 159 |
| `server/sim/content/kits/ops/chess_char_5_05-ulpia.js` | 185 | 2 | 29, 31 |
| `server/sim/content/tokens.js` | 1839 | 2 | 1380, 1436 |
| `public/css/screens/lobby.css` | 2493 | 1 | 1501 |
| `public/js/assets.js` | 993 | 1 | 117 |
| `public/js/battle/runner.js` | 895 | 1 | 90 |
| `public/js/main.js` | 493 | 1 | 269 |
| `public/js/render/app/view.js` | 149 | 1 | 92 |
| `public/js/render/drag.js` | 291 | 1 | 33 |
| `public/js/render/fx/simfx.js` | 336 | 1 | 59 |
| `public/js/render/interp.js` | 468 | 1 | 77 |
| `public/js/render/units.js` | 2190 | 1 | 278 |
| `public/js/screens/game/early.js` | 19 | 1 | 9 |
| `public/js/ui/enemyDrawer.js` | 112 | 1 | 66 |
| `public/js/ui/gameLogic/draft.js` | 95 | 1 | 76 |
| `public/js/ui/gameLogic/phases.js` | 233 | 1 | 223 |
| `public/js/ui/gameLogic/placement.js` | 575 | 1 | 419 |
| `public/js/ui/matchInfo.js` | 191 | 1 | 89 |
| `server/data.js` | 177 | 1 | 81 |
| `server/match/invariants.js` | 241 | 1 | 81 |
| `server/sim/battle/blocking.js` | 151 | 1 | 48 |
| `server/sim/battle/deploy.js` | 275 | 1 | 239 |
| `server/sim/battle/economy.js` | 80 | 1 | 28 |
| `server/sim/buffs.js` | 227 | 1 | 26 |
| `server/sim/constants.js` | 286 | 1 | 238 |
| `server/sim/content/bonds/addon.js` | 15 | 1 | 5 |
| `server/sim/content/traitMods.js` | 228 | 1 | 167 |
| `server/sim/skills.js` | 671 | 1 | 384 |

**组 3 按目录分布**：`public/js` 46、`server/sim` 32、`server/match` 31、`public/css` 4、`shared/*` 4、`server/lobby.js` 1、`public/index.html` 1、`server/data.js` 1。

**逐字节相同但已含 zj 标记的文件：0 个** —— 说明炸惊内容**没有一处**是「以 0.3.3 原样存在」的，全部要做移植。

**包内新增且带 zj 标记的文件（108 个；这些是「新增」，不是「合并」，但仍要按本仓 0.3.3 的 API 改写）**

| 文件 | 行数 | 命中 |
|---|---|---|
| `server/sim/content/jibian.js` | 2542 | 392 |
| `server/sim/content/ejibian.js` | 574 | 88 |
| `server/sim/content/mujica.js` | 177 | 43 |
| `server/sim/content/mujicaBond.js` | 146 | 28 |
| `server/sim/content/bonds/addon/zjbonds.js` | 159 | 23 |
| `server/sim/content/forge.js` | 110 | 6 |
| `server/sim/content/kits/ops/chess_zj_oblvns.js` | 90 | 18 |
| `server/sim/content/kits/ops/chess_zj_dolris.js` | 84 | 13 |
| `server/sim/content/kits/ops/chess_zj_mortis.js` | 73 | 10 |
| `server/sim/content/kits/ops/chess_zj_tmoris.js` | 63 | 10 |
| `server/sim/content/kits/ops/chess_zj_amoris.js` | 54 | 6 |
| `server/sim/content/kits/shared/mujica.js` | 76 | 8 |
| `server/sim/content/kits/shared/mujicaNotes.js` | 83 | 5 |
| `server/sim/content/kits/ops/op-aigis.js` | 204 | 1 |
| `server/sim/content/kits/ops/op-kormr.js` | 113 | 3 |
| `server/sim/content/kits/ops/op-yukari.js` | 181 | 1 |
| `server/match/player/cheat.js` | 166 | 5 |
| `server/loadoutMemory.js` | 119 | 11 |
| `shared/forgeData.js` | 234 | 1 |
| `shared/mujicaJibian.js` | 4 | 1 |
| `shared/banPick.js` | 228 | 7 |
| `public/js/ui/jibianList.js` | 283 | 70 |
| `public/js/ui/jibianPanel.js` | 171 | 37 |
| `public/js/ui/zhajingRules.js` | 62 | 15 |
| `public/js/ui/gameLogic/bingCue.js` | 77 | 12 |
| `public/js/ui/enemyJibianOverlay.js` | 88 | 11 |
| `public/js/ui/zhajingSwitch.js` | 27 | 6 |
| `public/js/ui/gameLogic/mujicaTraits.js` | 19 | 5 |
| `public/js/ui/jibianArt.js` | 19 | 5 |
| `public/js/render/mujicaHud.js` | 35 | 4 |
| `public/js/screens/lobbyFeed.js` | 209 | 4 |
| `public/js/screens/banPicker.js` | 157 | 2 |
| `public/js/ui/gameLogic/bench.js` | 22 | 2 |
| `public/js/ui/zhajingLoadoutButton.js` | 15 | 2 |
| `public/js/ui/forge.js` | 231 | 1 |
| `public/js/ui/gameLogic/equipSlots.js` | 78 | 1 |
| `public/js/ui/gameLogic/modeRules.js` | 26 | 1 |
| `public/css/screens/loadout-jibian.css` | 114 | 9 |
| `tools/add-mujica-bond.mjs` | 55 | 14 |
| `tools/add-mujica-jibian.mjs` | 47 | 14 |
| `tools/import-mujica-data.mjs` | 226 | 14 |
| `tools/import-mujica-assets.mjs` | 216 | 11 |
| `tools/import-mujica-jibian-art.mjs` | 31 | 5 |
| `tools/merge-mujica-fx.mjs` | 59 | 8 |
| `tools/verify-mujica-render.mjs` | 25 | 6 |
| `test/mujica-*.test.mjs`、`test/jibian-*.test.mjs`、`test/sees-*.test.mjs`、`test/p3r-*.test.mjs`、`test/kormr-*.test.mjs`、`test/makoto-*.test.mjs`、`test/zj*.test.mjs`、`test/ejibian-*.test.mjs`、`test/bond-ban-consistency.test.mjs`、`test/block-count.test.mjs`、`test/multi-boss-hp.test.mjs`、`test/data-desc-format.test.mjs` | — | 2–42（约 55 个测试文件） |
| `tools/_*.mjs`（临时验证脚本 `_verify-r10`、`_dbg2`、`_diag-price` …） | — | 1–5 |

> 表中后两行做了归并；逐文件行数/命中数（含 55 个测试文件与 8 个 `tools/_*.mjs`）见 `inventory.json → drift.groups.packOnly` 与 `drift.detail`。

### 5.2 两组「看着像、其实不能整文件搬」的文件

1. **`server/sim/content/kits/**`**（实测：包内 `kits/ops/` 219 个 `.js`，本仓 230 个）。包内独有 9 个：
   `chess_zj_{amoris,dolris,mortis,oblvns,tmoris}.js` + `op-{aigis,kormr,makoto,yukari}.js`；本仓独有 20 个，**全部是 `ver-*.js`**
   （0.3.3 的版本化干员结构，包内一个都没有）。
   → 新干员要照本仓 `ver-*` 约定落位，`kits/index.js`（包内 5 处 zj 命中：32, 38, 53, 60, 67 行）的注册行由 engine 独占（计划稿 §4 已定）。
2. **`server/sim/content/bonds/{core,addon}/*`**：`core.js` 30 处、`addon/meta.js` 27 处、`addon/battle.js` 19 处 zj 命中，
   且包里新增 `bonds/addon/zjbonds.js`（159 行 / 23 处命中，本仓不存在）——**5 条新盟约的战斗实现**在这里，不在 `bonds.json`。

---

## 6. 最容易踩的 10 个坑（都有实测证据）

1. **`zhajing:true` 不是全集的判据。** `chess_zj_*` 有 6 条是 `zhajing:false`（13/22/91 三对），另有 2 条 `chess_chen3_*`
   根本没这个字段。按 `zhajing===true` 过滤会**静默少 6 条**；按前缀过滤会把 chen3 多算进来。
   包内的权威判据是 `gamedata.js:160` 的 `zhajing ? c.zhajing === true : (c.visible === true && c.zhajing !== true)`。
2. **`visible:false` 不能当 zj 标记**：本仓 `chess.json` 本来就有 42 条 `visible:false`。
3. **`garrisons.json` 零标记**：248 条新卫戍没有任何 `zhajing/zjOnly/visible`，隔离只靠 `chess_zj.garrisonIds` 可达性；
   而且有 **22 条 `garrison_zj_*` 没人引用**（会被「没引用就删掉」的直觉砍掉，砍了就改玩法）。
4. **`data/jibianBonds.json` 只是镜像**：引擎用 `jibianBonds.js:37` 的内联表。只改 JSON → UI 与判定不一致且**不报错**。
5. **`DOMAIN_NAMES` 少写名字 = 全哑**：`installContent` 用 `try/catch` 包住每个域模块（`content/index.js:277-280`），
   `'jibian'`/`'forge'`/`'ejibian'` 三个名字任何一个漏掉，都表现为「没效果、没日志」。
6. **`mujicaBond.js` 不在 `DOMAIN_NAMES`**，是由 `content/bonds.js:21` 的 `PARTS` 加载的；注册顺序还有讲究
   （`bonds/addon/meta.js:252-254` 实测「后注册会覆盖先注册」）。
7. **`spPhaseKind` 不能只清成 `null`**：`gamedata.js:559-562` 的注释写明「只把它清成 null 会落到 `choices.js:156` 的加权抽分支，
   `sch.families` 里本身就含 `jibian`，仍然会冒出惊变（第一版就踩了这个坑）」。→ 门的正确位置是**阶段入口**，不只是标签。
8. **5 张卡实现在别处**（§2.4）：`jibian_erjiguan` / `jibian_yanrenhuifei` / `jibian_jibangzhili` /
   `ejibian_quanjunchuji` / `ejibian_jingtianmodaotuan` 的实现散在 `effectsMeta`、`bondsMeta`、`support/index`、`waves`、`round`。
9. **代码撞码**：`mode_single_zhajing.code` 与湮灭**同为 `AC-5`**、`sortId` 同为 `6`，且 `inScope:false`。
   直接照搬配置会让房间页/难度卡出现两条 AC-5。
10. **`stats` 已乘过 `allyScale`**（`chess_zj_*` 的 `stats` 是放大后的白值，`statsBase` 才是原值）。
    移植时若再乘一次 = 数值爆炸；反过来只搬 `statsBase` 会丢失「按模式折算」的能力。
    换算入口是 `shared/zhajingBase.js`，调用方三处（`sim/battle/players.js:179`、`ui/detailPanel.js:517`、`ui/gameLogic/loadout.js:74`）。

---

## 7. 复现

```bash
# 0) zip 条目清单（不解压 assets；只读中央目录）
#    → modref/zip-entries.tsv（51 517 条，含字节数）
node -e "…"        # 见 modref/tools-scan-assets2.mjs 的读取方式

# 1) 数据层键级 diff（§1）
node modref/tools-scan-data.mjs      # → modref/out/data.json  (+ 控制台表)
node modref/tools-probe2.mjs         # chess/garrison 记录语义
node modref/tools-probe3.mjs         # bonds zj 覆盖 / config 字段差集 / items / tokens

# 2) 引擎层导出与调用方（§2）
node modref/tools-scan-engine.mjs    # → modref/out/engine.json
node modref/tools-print-engine.mjs   # → 每个导出的调用点

# 3) 客户端（§3）
node modref/tools-scan-client.mjs    # → modref/out/client.json
node modref/tools-md-client.mjs      # → §3 的 markdown 表

# 4) 资产（§4）
node modref/tools-scan-assets.mjs    # 全量分组
node modref/tools-scan-assets2.mjs   # 与本仓已装 assets 的差集（结论数字）

# 5) 漂移（§5）
node modref/tools-scan-drift.mjs     # → modref/out/drift.json（三组 + 每个文件的 zj 行号区间）
node modref/tools-md-drift.mjs       # → §5 的 markdown 表

# 汇总
node modref/tools-assemble.mjs       # → modref/inventory.json
```

产物：
- 人读 → 本文件 `handoff/ZHAJING-INVENTORY.md`
- 机读 → [`modref/inventory.json`](../modref/inventory.json)（`data` / `engine` / `client` / `assets` / `drift` 五段，每条都带源路径）
- 中间件（可删）→ `modref/out/*.json`、`modref/out/*.md`

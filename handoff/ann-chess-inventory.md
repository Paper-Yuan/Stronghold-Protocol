# 湮灭名册补齐 · 盘点（task-22，方案 A）

> 仓库：`E:\Workbox\系统`。目标：把湮灭 mod 自带的 13 名干员（26 条 chess + 26 条 garrison）搬进默认数据，
> 让 `bonds.rhodesShip`（阈值 `[3,6]`）与 `bonds.kazdelShip`（`[3,6,9]`）的 6 / 9 名档可达。
> 本文是动手前的盘点：包内字段 → 本仓 schema 的映射、garrison 来源、并入 `tools/build-data.mjs` 的方式、
> 以及仓库里所有会被本轮推进的硬编码位置。实现细节以代码注释为准，本文只记「来源与口径」。

## 0. 结论摘要

| 项 | 数量 | 说明 |
|---|---|---|
| 可搬干员 | 13 | 8 名 rhodes-ship 包 + 5 名 kazdel-ship 包（每个 `_a` 基础 + `_b` 精英） |
| 新增 chess 记录 | 26 | 全部字段包内有值，**没有任何字段需要 `[ASSUMED]`**（唯一例外见 §5 的 `rimBilliton`） |
| 新增 garrison 记录 | 26 | 18（rhodes）+ 8（kazdel）；另有 2 条被引用但本仓已有（`garrison_04_a/_b`）→ 不重复导入 |
| 新 chess 引用的 garrison 数 | 28 | 26 新 + 2 既有（`garrison_04_a/_b`，`owners` 是官方红豆 `chess_char_1_05_*`） |
| bonds 变化 | 2 | `rhodesShip.members` 5→13、`kazdelShip.members` 4→11（`visibleMembers` 同步） |
| 无法修复的悬挂 id | 1 | `chess_char_4_27_a`：两个包的 `chess.json` 都没有这条记录（连 `_b` 也没有） |
| 新代码 | 0 行新机制 | chess 只加三个标记（`annihilation` / `visible` / `annBonds`），garrison 原样搬运 |

`data/` 预期计数（默认版本，`npm run build-data` 报告）：

| 文件 | 现在 | 之后 | 依据 |
|---|---|---|---|
| `chess` | 474 | **500** | +26（13×2） |
| `visibleChess`（build 报告） | 112 | **112（不变）** | 新记录 `visible: false`，`isOfficialVisibleChess` 一字不改 |
| `garrisons` | 497 | **523** | +26 |
| `bonds` | 30 | 30（不变） | 只有两条既有新盟约的 `members`/`visibleMembers` 变大 |
| `annihilation` 名册（默认开关） | 112 | **125** | 官方 112 + 13 个干员位（26 条记录的基础形；`annihilationRoster` 的新分支） |
| `rhodesShip.members` | 5 | **13** | 5 既有 + 8 新 |
| `kazdelShip.members` | 4 | **11** | 4 既有 + 7 新（含 rhodes 包里的 9_09 / 9_22） |

## 1. 包内 chess 记录：字段清单与到本仓 schema 的映射

### 1.1 来源

| 包 | 路径 | 记录 |
|---|---|---|
| rhodes-ship | `modref/mods/rhodes-ship/rhodes-ship-mod/payload/packs/rhodes-ship/chess.json`（`chess` 键，22 条） | `chess_char_9_09` 阿斯卡纶 / `9_11` 霜叶 / `9_13` 坚雷 / `9_14` 阿米娅 / `9_16` 煌 / `9_18` 凯尔希 / `9_21` Mon3tr / `9_22` 逻各斯（各 `_a`/`_b`） |
| kazdel-ship | `modref/mods/kazdel-ship/kazdel-ship-mod/payload/packs/kazdel-ship/chess.json`（18 条） | `chess_char_9_01` 红豆 / `9_02` 陨星 / `9_04` 闪灵 / `9_06` 赫德雷 / `9_10` 维什戴尔（各 `_a`/`_b`） |

第 14 个缺口 id `chess_char_4_27_a` **在两个包里都没有记录**（`grep` 两个 `chess.json` 均 0 命中，也没有 `_b`），
所以搬不了；它只留在 `_extract.notes.unmatchedBondMembers.rhodesShip` 里，作为悬挂 id 记录。

### 1.2 字段清单（26 条记录实测）

包内 `_a` 基础形 45 个键、`_b` 精英形 49 个键（多 `modules` / `statsBase` / `traitBase` / `talentsBase`），
键集**恰好是本仓 `data/chess.json` 键集的子集**——`pack-only keys = ∅`。逐类映射：

| 类别 | 包内键 | 本仓处理 |
|---|---|---|
| 身份/配对 | `chessId baseId goldenId isGolden tier identifier shopSortId charId name appellation rarity profession subProfessionId subProfessionName position nationId price sellPrice upgradeNum upgradeChessId status` | 原样。`baseId`/`goldenId` 已自洽（`_a.upgradeChessId = _b`、`_b.upgradeChessId = null`），不需要 `normalizePairs` 的合成半身 |
| 战斗数值 | `stats immunities rangeId rangeGrid dmgType attackKind projectile canHitFly targetPriority trait skill talents tokens module modules statsBase traitBase talentsBase potDown` | 原样；`skill.level` 与 `status.skillLevel` 一致（`_a` 4 / `_b` 7），`skills[]` 恰好一条 `isDefault` 且等于 `skill`（无 `skill.isDefault` 脏标记），`_b.modules[]` 一条 `isDefault` 且 `module.active === true` + 三个 `*Base` 齐全——`shared/plugins/validate.js` 的 loadout/模块断言全部直接通过 |
| 站位 | `backup`（`{charId,tmplId,skillIndex,uniEquipId,potRank}`） | 原样。`chessType: PRESET` 的记录 `backup.charId === charId`；`NORMAL` 记录的补位 body（`char_615_acspec` / `char_604_ccast` / `char_601_cguard` / `char_605_cmedic` / `char_613_acmedc` / `char_612_accast` / `char_611_acnipe`）**全都在本仓 `data/backups.json` 的 units 里**，`status` 的 form 也都存在 → `validate.js` 的 stand-in 校验可过 |
| 引用 | `bonds garrisonIds tokens` | `garrisonIds` → 见 §2；`tokens`（3 个召唤物）都在 `backups.json` `tokens`；`bonds` 见 §5 的 `rimBilliton` 例外 |
| 外观 | `assets`（avatar/portrait/spine/skillIcon/subProfIcon） | 原样（美术资源不在 git；客户端按既有兜底画） |
| 包内可见性 | `visible: true`、`isHidden: false` | **强制改成 `visible: false`**（与炸惊同构：官方池的判据 `isOfficialVisibleChess` 看不见它） |
| 本仓新增标记 | — | `annihilation: true`（build-data/服务端/客户端按它认「mod 自带干员」）、`annBonds: ['rhodesShip',…]`（按盟约 `members` 反推，见 §1.3） |
| 包内没有的键 | — | 无需补：`zhajing` 不写（写 `false` 会被炸惊判据当炸惊记录）、`grantOnly`/`pureStrong`/`diyFor`/`displayTokens` 不适用于它们 |

### 1.3 与 `tools/extract-zhajing-research.mjs` 的对照

炸惊导入器（`18-zhaijing-content.json`）对包内 chess 的处理是三条可复用的规则：

1. **按包内标记选记录**，不按 `ref − data/` 差集（重跑后差集为空）。本轮同样：记录「本仓没有 **或**
   `annihilation === true`」→ 导入；已存在且不是我们的 → 只当「追加盟约」补丁（保持现有 `chessAnnBonds` 行为）。
2. **逐字段复制**（`CHESS_DROP` 只丢 `form` / `teamId` 两个死字段；本包的 9_* 记录一个都没有 → 不丢任何字段）。
3. **配对收尾**：炸惊要修 `upgradeChessId` 指向自己 / 借用 `baseId` 的三处，并合成 `chess_zj_pure_a`；
   本包 26 条**没有一处不合**，所以不需要 `normalizePairs`。

`annBonds` 的推导是**从盟约 `members` 反推**，不是抄 `chess.bonds`：
`annBonds = [b for b of newBonds if b.members.includes(chessId)]`。结果与包内 `records.bonds` 一致：
9_09 与 9_22 同时属于两个盟约（`['kazdelShip','rhodesShip']`），其余 11 名只属一个；`_b` 与 `_a` 同边。
这样 `members ↔ annBonds` 天然双向一致（`test/data.test.js` 与隔离测试都靠这一点）。

## 2. garrison 记录来源

两个包的 `records.json.garrisons`（不是单独的 `garrisons.json`；包目录里没有那个文件）：

| 包 | 全部 garrison | 被新 chess 引用 |
|---|---|---|
| rhodes-ship | 24 条 | 18 条（`garrison_c_ascln_k_a/_b`、`_frostl_`、`_durnar_`、`_amiya_`、`_huang_`、`_kalts_`、`_monstr_gain_`、`_monstr_sell_`、`_logos_`） |
| kazdel-ship | 10 条 | 8 条（`garrison_c_meteo_a/_b`、`_shining_`、`_hodrer_`、`_wisdel_`） |
| 本仓已有、被引用 | — | `garrison_04_a/_b`（红豆；`owners` 是官方 `chess_char_1_05_a/_b`）→ **不覆盖、不重复导入** |

- **键集与本仓完全一致**：`garrisonId desc descRaw eventType eventTypeDesc eventTypeIcon effectType effectKey battleRuneKey charLevel bb bbStr owners`。
  包内 26 条都**缺 `battleRuneKey`** → 导入时补 `null`（与炸惊 mujica 10 条同一规则；本仓 130+ 条无 rune 记录同值）。
- `owners` 已经指向新 chess id（`_a`/`_b` 各一条），导入后 `validate.js` / `test/data.test.js` 的 owner 校验可过。
- 选中判据：**被本轮新 chess 的 `garrisonIds` 引用**，且（本仓没有 或 它自己的 `owners` 指向 `annihilation === true` 的棋）。
  第二个条件是重跑幂等：重跑时记录已在 `data/garrisons.json`，但 `owners` 仍指向新棋 → 仍重新产出。
  `garrison_04_a/_b` 的 `owners` 是官方棋 → 永远走「本仓已有，跳过」。
- 包内**其它** garrison（`garrison_35_*`、`garrison_c_humus_*`、`garrison_c_rosmon_*`、`garrison_c_durnar_*` 已含、`garrison_10_*`）
  没有被新 chess 引用 → 不导入，记进 `_extract.notes.skippedGarrisons`。
- 注意：包内 26 条 garrison 的 `eventType` 分两类：`IN_BATTLE`（18 条，战斗侧）与 `SERVER_GAIN` / `SERVER_CHESS_SOLD`
  （8 条，整备侧）；`effectType` 一律 `CUSTOM`，`effectKey` 是 `custom_*` 家族（见 §5 的引擎缺口）。

## 3. 并入 `tools/build-data.mjs` 的方式（照 `zhajingContent` 的套路）

`applyAnnihilationMods()` 现有结构已经是「纯加法 + 标记门」，本轮只加两段，位置与 `applyZhajingContent` 一致：

```
main():
  buildChess/buildBonds/buildGarrisons/...            ← 官方数据（不变）
  if (IS_DEFAULT && research.zhaijingContent) { applyZhajingContent(files, content); …atRank 每档 }
  if (IS_DEFAULT && research.annihilationMods) {
    applyAnnihilationMods(files, mods)                ← 本轮扩展：garrisons → chess → bonds → items → cards → schedule
    for (const p of passes) for (chessId of mods.chess) p.chess[chessId] = atRank(rec, r)   ← 新增：新 chess 进每一档
  }
  validateAll / checkUnitFormParity / attachPotential / checkTextContracts
```

1. **garrisons 先并**（chess 的 `garrisonIds` 要在同一份 `files` 里能解析）：
   逐条 `files.garrisons[id] = rec`；撞到官方记录（`annihilation !== true`）就 throw，绝不覆盖。
2. **chess 再并**：`files.chess[id] = rec`；生成期断言：`rec.annihilation === true`、`rec.visible === false`、
   `garrisonIds` / `bonds` / `tokens` / `annBonds` 全部解析得到、`goldenId`↔`baseId` 互指、`upgradeChessId` 与配对规则一致。
3. **每档展开**：与炸惊同形 —— `p.chess[id] = atRank(rec, r)`（`r = 0…FULL_RANK`），让
   `attachPotential` 的 atRank 往返比较成立（新记录带包内 `potDown`，与炸惊记录一样）。
4. **配对/stand-in 豁免**：`isImportedChess(c)` 从 `'zhajing' in c` 扩成 `'zhajing' in c || c.annihilation === true`。
   理由与炸惊相同：这些是外部包的**已构建快照**，`checkUnitFormParity` / ACTIVE_RANGE 偏离检查是「本仓 builder 的输出」断言，
   不适用于导入快照；`shared/plugins/validate.js` 的通用引用检查仍对它们生效（见 §4 的规范化）。
5. **bonds 替换**：`newBonds` 依然是整条替换；`members` / `visibleMembers` 里保留「本仓已有 + 本轮新导入」的 id，
   只有 `chess_char_4_27_a` 落进 `unmatchedBondMembers`。
6. 既有 `chessAnnBonds`（20 条棋 / 26 条边）逐字节不变。

## 4. 生成期护栏与测试要跟着改的数

- `data/` 只能由 `npm run build-data` 生成（`data/` 不手改）。`public/data/` 由 `node tools/sync-static-web.mjs` 同步（客户端读它）。
- `build-data` 的 `visibleChess` 计数仍是 **112**（新记录 `visible: false`）；`chess` 计数 474 → **500**、
  `garrisons` 497 → **523**；warning 数应仍为 **163**（新记录不产生新的 potDown 注释噪音之外的警告）。
- `test/data.test.js` 的离线重建会逐字节比对 `data/`：所以必须先重跑导入器（`docs/research/20` 变了）再 build，二者一致。

## 5. 风险与悬挂点（动手前已知）

1. **`chess_char_4_27_a` 无记录**（两个包都没有）→ 不进 `members`，只进 `_extract.notes.unmatchedBondMembers`。
   罗德岛因此 13 名（阈值 6 可达）、卡兹戴尔 11 名（阈值 9 可达），不比包内 14/11 少到影响可达性。
2. **`rimBilliton` 盟约在本仓不存在**：`chess_char_9_14_a/_b`（阿米娅）的包内 `bonds` 是
   `["rhodesShip","visiShip","rimBilliton"]`，本仓 `data/bonds.json` 没有 `rimBilliton`（`grep` 全仓 0 条记录）。
   导入时**丢掉这个引用**并记进 `_extract.notes.droppedChessBonds`（否则 `validate.js` 的 `bond missing` 会让构建失败）。
   这是「包内有、本仓无」的悬挂引用，不是 `[ASSUMED]` 数值；效果 = 阿米娅在本仓少一条雷姆必拓盟约。
3. **Mon3tr 的「M3利爪」（`chess_item_c_05_e_a`）两个包都没有**：`garrison_c_monstr_gain_*` 的 `bbStr.item` 指向它，
   但 rhodes/kazdel 的 `records.items` 只有 `c_01..c_04`，本仓也没有 → 这条特质只能「计得清、发不出」（静默）。
   与上一轮 c_01..c_04 的缺口同类，需要业主决定是否补造该装备（**不自行造数值**）。
4. **8 个 IN_BATTLE 的 `custom_*` effectKey 没有战斗侧处理器**（`custom_gain_on_kills` / `_on_new_target` /
   `_on_skill` / `_scale_bonds_layers` / `_first_skill` / `_on_heal` / `_on_hurt_or_heal` / `_on_controlled`）：
   数据搬进来后这些特质在战斗里是**惰性**的（不会报错、也不生效）。实现它们属于战斗内容移植（另开）。
5. **3 个 SERVER_* 的 `custom_*` 有处理器覆盖测试**（`test/content/garrisons_meta.test.js:882`
   「every SERVER_* effectKey of the data has a registered handler」）：`custom_grant_item_on_acquire` /
   `custom_grant_item_on_sell` / `custom_transform_on_sell` 必须在 `server/sim/content/garrisons/meta.js` 注册，
   否则原本绿的测试会红。三者都按包内 `desc` + `bb`/`bbStr` 逐字实现（grantItem / grantChess），不新造机制。
6. **3 名干员与炸惊记录共用 charId**（`char_4133_logos` / `char_4179_monstr` / `char_1035_wisdel`），
   红豆还与官方 `chess_char_1_05` 共用 `char_290_vigna`：`charKeyMap` 的 `toChess` 只挑一个「slot」
   （新记录 `visible:false` 不是 slot），所以这些干员在两个玩法档的 `entries` 视图可能共用同一个 charId 键。
   这是既有的「同干员多棋子」限制，本轮不扩大，截图读数不依赖它。
7. **4 名干员没有手写 kit**（阿米娅 `char_002_amiya`、霜叶 `char_193_frostl`、坚雷 `char_260_durnar`、
   陨星 `char_219_meteo`）：`setupUnitKit` 回落到 generic，能上场但技能无专属行为。另 9 名有 `op-*.js`。
8. **美术资源**：`assets` 里的 avatar/portrait/spine 不在 git（项目规则），客户端按既有兜底；不影响名册/读数。

## 6. 硬编码「112 / 4 / 5」位置清单（`test/**`、`devtools/**`、`docs/**`）

### 6.1 必须改（数值会被本轮推进）

| 文件:行 | 现值 | 本轮之后 | 说明 |
|---|---|---|---|
| `test/data.test.js:91` | 标题「474 records … 112 visible」 | 500 / 112 | 标题 + 计数 |
| `test/data.test.js:95` | `474` | `500` | chess 记录数 |
| `test/data.test.js:258-283` | `withAnnBonds = 20`、`edges = 26` | `46` / `56` | 26 条新记录各带 1–2 条 `annBonds` 边 |
| `test/data.test.js:319-330` | 「成员数到不了 6/9 名档」 | 换成**阈值可达性守卫** | 断言 `members.length >= max(thresholds)` + 全部成员存在 |
| `test/match/mode-isolation-matrix.test.js:142-143` | `visibleChess === OFFICIAL_ROSTER`、`112` | 官方 112 + 13 个 mod 干员位 = 125 | 湮灭池预期 |
| `test/match/annihilation-mods-default.test.js:113-116` | 「缺省 = 官方名册（112 条）」 | 缺省 = 官方 + 26 | `expectedRoster()` 要含 `annihilation: true` 记录 |
| `test/match/annihilation-mods-default.test.js:209-210,261` | 同上（开/关名册） | 同上 | `off` 仍是官方 112 |
| `test/match/annihilation-mods-isolation.test.js:56,62,114` | `annChessIds.length = 20`、湮灭池与基线相等 | 46；基线剔除 `annihilation: true` 记录后池差 26 | 隔离基线口径 |
| `test/ui/ownership-roster.test.js:97` | `list.length = 474` | `500` | 224 visible / 53 持有页不变 |
| `test/ui/loadout.test.js:536-560` | 用 `visible !== false` 的 roster 断言 ann 盟约筛选 = 5 名成员 | 用 `annihilationRosterOf()`，断言 13 / 11 | 本轮客户端新函数 |
| `devtools/check-mode-isolation.mjs:133-134` | 湮灭 `visibleChess === officialRoster` | 官方 + 26（默认开关） | devtools 的隔离检查 |
| `docs/DATA.md:165` | `474 = 266 official + 207 zhajing + 1 scaffold` | `500 = … + 26 annihilation` | 数据地图 |
| `docs/DATA.md:322` | `497 = 249 official + 248 炸惊` | `523 = … + 26 annihilation` | 数据地图 |
| `docs/ANNIHILATION-MODS.md:460`（D-1） | 「5 / 4 名，6/9 名档到不了」 | 「13 / 11 名，可达；`4_27` 仍缺」 | 缺口表 |
| `docs/ANNIHILATION-MODS.md:80-118`（§2.1） | 三个标记 + 两张表 | 补 `annihilation: true` 与 chess/garrison 并表 | 数据层规格 |
| `docs/research/20-annihilation-mods.json` | 由导入器生成 | 重跑后新增 `chess` / `garrisons` 段、`unmatchedBondMembers` | **只能由导入器写**（带 `node tools/extract-annihilation-mods.mjs`） |

### 6.2 出现 112 但**不改**（官方/炸惊口径，或与名册无关）

| 文件:行 | 为什么不动 |
|---|---|
| `test/data.test.js:96`、`test/data-versions.test.js:97` | 官方 `visibleNonDiy` 仍是 112（新记录 `visible:false`） |
| `test/match/loadout.test.js:36`、`test/match/pool.test.js:16,208` | 官方四档的 visible / pool = 112 |
| `test/match/extension-modes-regression.test.js:235` | 官方四档卡池 112 |
| `test/sim/loadout.test.js:298-299` | `kitCoverage()` 只统计 `visible` 棋，仍是 112 |
| `test/ui/loadout.test.js:177,193,195` | `rosterOf()` 仍是官方 112（新记录不是 loadout slot） |
| `test/ui/loadout-cards.e2e.test.js:146,163`、`test/ui/loadout.e2e.test.js:117`、`test/ui/versions.e2e.test.js:235,237` | 浏览器套件里的官方档 112；默认关（`SP_E2E=1` 才跑） |
| `test/ui/ownership-roster.test.js:98` | `visible === true` 仍是 224 |
| `devtools/lib/zhajing-panels.mjs:835-836` | 已经写成 `pool.chessIds >= 112`（138 也通过）；只更新注释 |
| `docs/DATA.md:634,994` | 官方版本 profile 的计数（`act2autochess 266 …`），不是默认数据集 |
| `docs/design/*.md`、`docs/history/*.md` 的 112 | 官方名册 / 历史记录，本轮不动 |

### 6.3 「4 / 5 名成员」硬编码

| 文件:行 | 现值 | 处理 |
|---|---|---|
| `test/data.test.js:319-330` | 见 6.1 | 换成可达性守卫 |
| `docs/ANNIHILATION-MODS.md:460` | 5 / 4 名 | 改成 13 / 11 |
| `docs/research/20-annihilation-mods.json` `_doc` / `_extract.notes` | `skippedBondMembers 16`、`skippedChess 26` | 重跑导入器后自行更新（`unmatchedBondMembers: { rhodesShip: [chess_char_4_27_a] }`、`skippedChess` 清空） |
| `test/match/annihilation-mods-isolation.test.js:140` | `members.length >= thresholds[0]` | 保持；本轮之后更强（13 / 11） |

## 7. 验收口径（本盘点对应的执行顺序）

1. `node tools/extract-annihilation-mods.mjs`（重写 `docs/research/20-annihilation-mods.json`；`_extract` 里应有
   `chess 26` / `garrisons 26` / `unmatchedBondMembers`）。
2. `npm run build-data`（exit 0、0 error、warning 163、`chess=500`、`visibleChess=112`、`garrisons=523`）。
3. `node tools/sync-static-web.mjs`（客户端读 `public/data/`）。
4. 数据哈希对比：既有 474 条 chess 与 497 条 garrison 逐字节不变（新增记录按 id 追加）。
5. `test/data*` + `test/ui` 全量 + `test/content` 原本绿的；`npm run golden` 不动。
6. 真机 792×360：名册行数、罗德岛 13、卡兹戴尔 11 的截图与读数。

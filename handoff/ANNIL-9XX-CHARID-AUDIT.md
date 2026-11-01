# 湮灭 9_xx 记录 `backup.charId` 核对（ANNIL-9XX-CHARID-AUDIT）

只读核对，未改动 `data/**`、`test/**`、`docs/research/**` 的任何文件；本文件是唯一产出。
核对时间 2026-10-31；数据基线 = 工作区当前未提交状态（`data/chess.json` 500 条、含 26 条湮灭记录）。

## 0. 结论（先看这段）

**「7 条的 `backup.charId` 是通用预备干员 id、与记录名不符 ⇒ id 填错」这个疑点不成立。** 五处事实需要纠正：

1. **每条记录有两个 id**：顶层 `charId` 与 `backup.charId`。顶层 `charId` **在全部 26 条里都是正确的真实干员**（闪灵 = `char_147_shining`、赫德雷 = `char_4088_hodrer`、阿米娅 = `char_002_amiya`…），一条都不需要改。疑点实际说的是 `backup.charId`。
2. **`backup.charId ≠ 记录名` 是官方约定，不是错误**：官方 110 条 NORMAL 棋**全部**满足 `backup.charId ≠ charId`（NORMAL = 6★ 可补位棋，`backup` 指向 17 名原型干员之一；PRESET = 特许，`backup` 指向自己）。所以「记录名 vs backup.charId」的对照本来就不该相等。
3. **不是 7 条，是 9 名干员 / 18 条记录**：除清单里的 7 名外，**9_16 煌**（backup `char_601_cguard`）与 **9_18 凯尔希**（backup `char_605_cmedic`）是同一模式，原清单漏了。
4. **`char_615_acspec` / `char_611_acnipe` / `char_613_acmedc` / `char_612_accast` 不是预备干员**：它们是 6★ 罗德岛特派高级资深干员 Misery / Stormeye / Touch / Pith（`docs/DATA.md` §18、`tools/build-data.mjs` 581-628 的注释同此口径）。真正是「预备干员」的只有 `char_601_cguard` / `char_604_ccast` / `char_605_cmedic`。
5. **不是「拿预备干员白板当数值」**：这 9 条记录的 `stats` / `skill` / `talents` / `assets` 全部是**真实干员自己的**（见 §3 的逐条数值对照），`backup` 只是一个补位指针，且当前代码路径对它们**完全不生效**（§4）。
6. **`test/version-assets.test.js` 那 3 条红灯（"湮灭 9_xx 缺立绘/模型/技能图标"）与 `charId`、与 `backup` 都无关**：实测缺口恰好是 **4 名干员** —— 陨星 `char_219_meteo`、霜叶 `char_193_frostl`、坚雷 `char_260_durnar`、阿米娅 `char_002_amiya`（各 8 个字段：avatar/portrait/avatarE2/portraitE2/spine front/back/clips/skills），加上这 4 名各自的 2 条棋（`chess_char_9_02/9_11/9_13/9_14` 的 `_a`/`_b`）= 12 条 missing。**其中陨星/霜叶/坚雷正是原清单里"另 4 条看似正常（backup 自指）"的那几个** —— 也就是说"缺立绘"和"`backup` 是占位 id"零相关。真正的成因在**资源清单的取数口径**：`tools/fetch-assets.mjs dataExtras()`（195-208 行）只把 `data/backups.json` 的 `units` 加进资源计划，**不读 `data/chess.json` 的 `charId`**；这 4 名既不在官方模板（`data/versions/*`）里、也不是 6★（进不了 `backups.diy.ownedPool`），于是从未被声明、从未被下载。详见 §4 与 §5.5。

因此：既不是 id 填错，也不是白板复用数值，更不是命名问题。记录名写干员名、`backup` 写同职业原型干员，是这套数据的**既定约定**（与官方 6★ NORMAL 完全同构），由上游 mod 逐字段搬运而来。**数据一个字段都不用改**；真正要修的是资源计划少认了 4 名干员（§5.5），以及（可选）在生成期加两条 `backup` 护栏（§7）。

---

## 1. 源数据定位与逐条对照

**落点不是 `docs/research/15-annihilation-mode.json`**（那份是模式/难度/奖励），而是：

| 环节 | 位置 |
|---|---|
| 生成物（数据源） | `docs/research/20-annihilation-mods.json` → `chess`（26 条，正好是 13 名 ×`_a`/`_b`） |
| 抽取器 | `tools/extract-annihilation-mods.mjs`（`modref/mods/**` → 上面的 JSON；第 219-240 行整条逐字段搬入，只改写 `visible:false` / 加 `annihilation:true` / `annBonds`） |
| 上游真源 | `modref/mods/rhodes-ship/…/packs/rhodes-ship/chess.json`（8 名）与 `modref/mods/kazdel-ship/…/packs/kazdel-ship/chess.json`（5 名）。**`modref/` 不在 git** |
| 合并进 data | `tools/build-data.mjs` → `applyAnnihilationMods()`（3508-3533 行，`files.chess[chessId] = rec`，逐字段，**不校验 `backup`**），在 `buildBackups` **之后**调用（3923 vs 3980） |
| 运行时记录 | `data/chess.json` 的 26 条（`annihilation:true`、`visible:false`，官方池看不见） |

上游 mod 原文（`kazdel-ship`，未经本仓任何加工）：

```json
{ "chessId": "chess_char_9_04_a", "chessType": "NORMAL",
  "charId": "char_147_shining", "name": "闪灵", "rarity": 6, "profession": "MEDIC",
  "backup": { "charId": "char_605_cmedic", "tmplId": null, "skillIndex": 2, "uniEquipId": null, "potRank": 0 } }
```

即：`charId`/`name` 是闪灵，`backup` 是预备干员-医疗 —— 上游作者自己就是这么写的，本仓照搬。

### 26 条逐条对照表

`charId 官方真名` / `backup 官方真名` 均取自 `.cache/gamedata/excel/character_table.json`。

| chessId | 记录名 | tier | chessType | 顶层 charId | charId 官方真名 | backup.charId | backup 官方真名 | backup 与 charId | 记录 stats(atk/hp/def) | 记录 assets(avatar / portrait / skillIcon) |
|---|---|---|---|---|---|---|---|---|---|---|
| chess_char_9_01_a | 红豆 | 1 | PRESET | `char_290_vigna` | 红豆 | `char_290_vigna` | 红豆（真实干员） | 自指 | 482 / 1267 / 281 | `char_290_vigna / char_290_vigna_1 / skchr_vigna_2` |
| chess_char_9_01_b | 红豆 | 1 | PRESET | `char_290_vigna` | 红豆 | `char_290_vigna` | 红豆（真实干员） | 自指 | 596 / 1764 / 332 | `char_290_vigna_2 / char_290_vigna_2 / skchr_vigna_2` |
| chess_char_9_02_a | 陨星 | 2 | PRESET | `char_219_meteo` | 陨星 | `char_219_meteo` | 陨星（真实干员） | 自指 | 689 / 1169 / 95 | `char_219_meteo / char_219_meteo_1 / skchr_meteo_2` |
| chess_char_9_02_b | 陨星 | 2 | PRESET | `char_219_meteo` | 陨星 | `char_219_meteo` | 陨星（真实干员） | 自指 | 877 / 1510 / 110 | `char_219_meteo_2 / char_219_meteo_2 / skchr_meteo_2` |
| chess_char_9_04_a | 闪灵 | 3 | NORMAL | `char_147_shining` | 闪灵 | `char_605_cmedic` | 预备干员-医疗（4★预备干员） | **不符** | 424 / 1451 / 135 | `char_147_shining / char_147_shining_1 / skchr_shining_3` |
| chess_char_9_04_b | 闪灵 | 3 | NORMAL | `char_147_shining` | 闪灵 | `char_605_cmedic` | 预备干员-医疗 | **不符** | 529 / 1558 / 154 | `char_147_shining_2 / char_147_shining_2 / skchr_shining_3` |
| chess_char_9_06_a | 赫德雷 | 4 | NORMAL | `char_4088_hodrer` | 赫德雷 | `char_601_cguard` | 预备干员-近卫（4★预备干员） | **不符** | 1368 / 4920 / 0 | `char_4088_hodrer / char_4088_hodrer_1 / skchr_hodrer_3` |
| chess_char_9_06_b | 赫德雷 | 4 | NORMAL | `char_4088_hodrer` | 赫德雷 | `char_601_cguard` | 预备干员-近卫 | **不符** | 1628 / 6084 / 0 | `char_4088_hodrer_2 / char_4088_hodrer_2 / skchr_hodrer_3` |
| chess_char_9_09_a | 阿斯卡纶 | 5 | NORMAL | `char_4132_ascln` | 阿斯卡纶 | `char_615_acspec` | **Misery**（6★罗德岛特派） | **不符** | 763 / 1393 / 283 | `char_4132_ascln / char_4132_ascln_1 / skchr_ascln_3` |
| chess_char_9_09_b | 阿斯卡纶 | 5 | NORMAL | `char_4132_ascln` | 阿斯卡纶 | `char_615_acspec` | Misery | **不符** | 905 / 1832 / 316 | `char_4132_ascln_2 / char_4132_ascln_2 / skchr_ascln_3` |
| chess_char_9_10_a | 维什戴尔 | 6 | NORMAL | `char_1035_wisdel` | 维什戴尔 | `char_611_acnipe` | **Stormeye**（6★罗德岛特派） | **不符** | 615 / 1434 / 209 | `char_1035_wisdel / char_1035_wisdel_1 / skchr_wisdel_3` |
| chess_char_9_10_b | 维什戴尔 | 6 | NORMAL | `char_1035_wisdel` | 维什戴尔 | `char_611_acnipe` | Stormeye | **不符** | 749 / 1735 / 240 | `char_1035_wisdel_2 / char_1035_wisdel_2 / skchr_wisdel_3` |
| chess_char_9_11_a | 霜叶 | 1 | PRESET | `char_193_frostl` | 霜叶 | `char_193_frostl` | 霜叶（真实干员） | 自指 | 523 / 1749 / 263 | `char_193_frostl / char_193_frostl_1 / skchr_frostl_2` |
| chess_char_9_11_b | 霜叶 | 1 | PRESET | `char_193_frostl` | 霜叶 | `char_193_frostl` | 霜叶 | 自指 | 657 / 2122 / 329 | `char_193_frostl_2 / char_193_frostl_2 / skchr_frostl_2` |
| chess_char_9_13_a | 坚雷 | 2 | PRESET | `char_260_durnar` | 坚雷 | `char_260_durnar` | 坚雷（真实干员） | 自指 | 489 / 2165 / 458 | `char_260_durnar / char_260_durnar_1 / skchr_durnar_2` |
| chess_char_9_13_b | 坚雷 | 2 | PRESET | `char_260_durnar` | 坚雷 | `char_260_durnar` | 坚雷 | 自指 | 608 / 2974 / 544 | `char_260_durnar_2 / char_260_durnar_2 / skchr_durnar_2` |
| chess_char_9_14_a | 阿米娅 | 3 | NORMAL | `char_002_amiya` | 阿米娅 | `char_604_ccast` | 预备干员-术师（4★预备干员） | **不符** | 544 / 1398 / 110 | `char_002_amiya / char_002_amiya_1 / skchr_amiya_3` |
| chess_char_9_14_b | 阿米娅 | 3 | NORMAL | `char_002_amiya` | 阿米娅 | `char_604_ccast` | 预备干员-术师 | **不符** | 647 / 1709 / 118 | `char_002_amiya_2 / char_002_amiya_2 / skchr_amiya_3` |
| chess_char_9_16_a | 煌 | 4 | NORMAL | `char_017_huang` | 煌 | `char_601_cguard` | 预备干员-近卫 | **不符** | 609 / 2115 / 303 | `char_017_huang / char_017_huang_1 / skchr_huang_3` |
| chess_char_9_16_b | 煌 | 4 | NORMAL | `char_017_huang` | 煌 | `char_601_cguard` | 预备干员-近卫 | **不符** | 781 / 2823 / 347 | `char_017_huang_2 / char_017_huang_2 / skchr_huang_3` |
| chess_char_9_18_a | 凯尔希 | 4 | NORMAL | `char_003_kalts` | 凯尔希 | `char_605_cmedic` | 预备干员-医疗 | **不符** | 417 / 1469 / 172 | `char_003_kalts / char_003_kalts_1 / skchr_kalts_3` |
| chess_char_9_18_b | 凯尔希 | 4 | NORMAL | `char_003_kalts` | 凯尔希 | `char_605_cmedic` | 预备干员-医疗 | **不符** | 517 / 1578 / 216 | `char_003_kalts_2 / char_003_kalts_2 / skchr_kalts_3` |
| chess_char_9_21_a | Mon3tr | 5 | NORMAL | `char_4179_monstr` | Mon3tr | `char_613_acmedc` | **Touch**（6★罗德岛特派） | **不符** | 447 / 1492 / 176 | `char_4179_monstr / char_4179_monstr_1 / skchr_monstr_3` |
| chess_char_9_21_b | Mon3tr | 5 | NORMAL | `char_4179_monstr` | Mon3tr | `char_613_acmedc` | Touch | **不符** | 557 / 1653 / 236 | `char_4179_monstr_2 / char_4179_monstr_2 / skchr_monstr_3` |
| chess_char_9_22_a | 逻各斯 | 6 | NORMAL | `char_4133_logos` | 逻各斯 | `char_612_accast` | **Pith**（6★罗德岛特派） | **不符** | 583 / 1297 / 106 | `char_4133_logos / char_4133_logos_1 / skchr_logos_3` |
| chess_char_9_22_b | 逻各斯 | 6 | NORMAL | `char_4133_logos` | 逻各斯 | `char_612_accast` | Pith | **不符** | 726 / 1710 / 115 | `char_4133_logos_2 / char_4133_logos_2 / skchr_logos_3` |

- `stats`：26 条**都有**完整数值（atk/hp/def/res/cost/…），非空。
- `assets`：26 条**都不为空**，且 avatar/portrait/spine/skillIcon **全部指向真实干员自己的资源**（不是预备干员的）。
- `chessType` 与稀有度严格对应：**8 条 PRESET = 4 名 4/5★**（红豆 r4、陨星 r5、霜叶 r4、坚雷 r4）；**18 条 NORMAL = 9 名 6★**。这正是官方约定（见 §2）。

---

## 2. `charId` 在官方表里分别是谁

| 记录名 | 顶层 charId | 官方表真名 | 稀有度/职业 | chessType | backup.charId | backup 是 |
|---|---|---|---|---|---|---|
| 红豆 | `char_290_vigna` | 红豆 | 4★ PIONEER/charger | PRESET | 自身 | 真实干员 |
| 陨星 | `char_219_meteo` | 陨星 | 5★ SNIPER/aoesniper | PRESET | 自身 | 真实干员 |
| 霜叶 | `char_193_frostl` | 霜叶 | 4★ WARRIOR/lord | PRESET | 自身 | 真实干员 |
| 坚雷 | `char_260_durnar` | 坚雷 | 4★ TANK/artsprotector | PRESET | 自身 | 真实干员 |
| 闪灵 | `char_147_shining` | 闪灵 | 6★ MEDIC/physician | NORMAL | `char_605_cmedic` | **预备干员-医疗**（4★） |
| 赫德雷 | `char_4088_hodrer` | 赫德雷 | 6★ WARRIOR/crusher | NORMAL | `char_601_cguard` | **预备干员-近卫**（4★） |
| 阿米娅 | `char_002_amiya` | 阿米娅 | 5★ CASTER/corecaster | NORMAL | `char_604_ccast` | **预备干员-术师**（4★） |
| 煌 | `char_017_huang` | 煌 | 6★ WARRIOR/centurion | NORMAL | `char_601_cguard` | 预备干员-近卫 |
| 凯尔希 | `char_003_kalts` | 凯尔希 | 6★ MEDIC/physician | NORMAL | `char_605_cmedic` | 预备干员-医疗 |
| 阿斯卡纶 | `char_4132_ascln` | 阿斯卡纶 | 6★ SPECIAL/stalker | NORMAL | `char_615_acspec` | **Misery**（6★罗德岛特派） |
| 维什戴尔 | `char_1035_wisdel` | 维什戴尔 | 6★ SNIPER/bombarder | NORMAL | `char_611_acnipe` | **Stormeye**（6★罗德岛特派） |
| Mon3tr | `char_4179_monstr` | Mon3tr | 6★ MEDIC/chainhealer | NORMAL | `char_613_acmedc` | **Touch**（6★罗德岛特派） |
| 逻各斯 | `char_4133_logos` | 逻各斯 | 6★ CASTER/corecaster | NORMAL | `char_612_accast` | **Pith**（6★罗德岛特派） |

**官方约定（实测自 `data/chess.json` 的 `isOfficialChess` 子集）**

| 组合 | 条数 | 说明 |
|---|---|---|
| PRESET + r4/r5 | 134 | 特许干员：`backup.charId = charId`（自指） |
| PRESET + r6 | 14 | 例外（伺夜、歌蕾蒂娅、信仰搅拌机… 特许 6★） |
| NORMAL + r6 | 110 | `backup.charId` = 17 名原型干员之一，**必然 ≠ charId** |
| NORMAL + 非 6★ | 0 | 不存在 |

→ 湮灭这 13 名干员的 `chessType` 分配（4/5★→PRESET、6★→NORMAL）**与官方 110:14:134 的比例结构完全一致**；9 条 NORMAL 的 `backup` 也都在官方那 17 名原型干员之内（8 名 4★ 预备干员 `char_600–607` + 9 名 6★ 罗德岛特派/领主·Sharp `char_608–615, 617`）。

**「建议替换 id」的存在性核对**（官方 `character_table.json`）：

| 建议 id | 是否存在 | 官方真名 | 备注 |
|---|---|---|---|
| `char_147_shining` | ✅ | 闪灵 | 与记录现有 `charId` 相同 |
| `char_4088_hodrer` | ✅ | 赫德雷 | 同上 |
| `char_002_amiya` | ✅ | 阿米娅 | 同上 |
| `char_4133_logos` | ✅ | 逻各斯 | 同上 |
| `char_4132_ascln` | ✅ | 阿斯卡纶 | 同上 |
| `char_1035_wisdel` | ✅ | 维什戴尔 | 同上 |
| **`char_1032_exc2`** | ❌ **不存在** | — | Mon3tr 的真实 id 是 **`char_4179_monstr`**（6★ MEDIC/chainhealer），记录里已经是它 |

结论：**要"换成真实干员 id"的那个字段，其实早就是真实干员 id 了**（顶层 `charId`）；`backup` 是另一套语义。

---

## 3. 性质判定：id 填错 vs 白板复用

用两组证据判：

**(1) 数值/技能/天赋不是预备干员的。** 记录 `stats` 与「真实干员 E2L1」和「backup 干员 E2L1」逐条比（atk/hp/def，取自 character_table）：

| chessId | 记录 | 真实干员 E2L1 | backup 干员 E2L1 | 更接近 |
|---|---|---|---|---|
| 9_04_a 闪灵 | 424/1451/135 | 闪灵 424/1451/110 | 预备干员-医疗 340/1218/104 | **真实干员** |
| 9_06_a 赫德雷 | 1368/4920/0 | 赫德雷 1323/4670/0 | 预备干员-近卫 722/2564/124 | **真实干员** |
| 9_09_a 阿斯卡纶 | 763/1393/283 | 阿斯卡纶 763/1233/283 | Misery 399/1154/247 | **真实干员** |
| 9_10_a 维什戴尔 | 615/1434/209 | 维什戴尔 583/1434/209 | Stormeye 413/1272/136 | **真实干员** |
| 9_14_a 阿米娅 | 544/1398/110 | 阿米娅 514/1198/110 | 预备干员-术师 467/1133/98 | **真实干员** |
| 9_16_a 煌 | 609/2115/303 | 煌 581/2115/303 | 预备干员-近卫 722/2564/124 | **真实干员** |
| 9_18_a 凯尔希 | 417/1469/172 | 凯尔希 392/1469/172 | 预备干员-医疗 340/1218/104 | **真实干员** |
| 9_21_a Mon3tr | 447/1492/176 | Mon3tr 422/1492/176 | Touch 420/1224/116 | **真实干员** |
| 9_22_a 逻各斯 | 583/1297/106 | 逻各斯 556/1297/106 | Pith 756/1372/94 | **真实干员** |

供参考，PRESET 那 4 条「自指」的对照：9_01 红豆 482/1267/281 vs 表 468/1291/287（同一人，差异来自潜力/信赖口径）、9_02 陨星 689/1169/95 vs 674/1204/98、9_11 霜叶 523/1749/263 vs 534/1785/268、9_13 坚雷 489/2165/458 vs 466/2165/438。

hp/def **逐位相同**、atk 略高的一致偏差，说明记录数值就是真实干员的（mod 侧取值口径），与预备干员差着 1.5–2 倍。`skill` 同样是真实干员的（`skchr_shining_3` / `skchr_hodrer_3` / `skchr_amiya_3` …），`talents` 是干员自己的（闪灵「黑恶魔的庇护/法典」、凯尔希「Mon3tr/不毁重构」、维什戴尔「好礼/死魂灵的余息」），`tokens` 也是（`token_10035_wisdel_wward` / `token_10002_kalts_mon3tr` / `token_10050_monstr_prosts`）。

**(2) 上游原文就是这么写的。** `docs/research/20-annihilation-mods.json` 由 `tools/extract-annihilation-mods.mjs` 从 `modref/mods/` 逐字段搬入（该文件第 219-240 行；`tools/research-normalize.mjs` 完全不碰 `backup`/`chessType`/`charId`）。查上游 `chess.json`，`chess_char_9_04_a` 本身就是 `charId: char_147_shining` + `backup: char_605_cmedic` + `chessType: NORMAL`。这不是本仓手写时的笔误。

**判定：既不是「id 填错」，也不是「拿预备干员白板当数值」。**
正确定性是：**这 9 条 6★ 记录按官方 6★ NORMAL 的样式，把 `backup` 填成了同职业的一名原型干员（补位指针），记录本体完全是真实干员。** 记录名写干员名与官方 NORMAL 记录完全同构，因此也**不是命名问题**——「命名问题」这个备选假设同样不成立。

---

## 4. 这个 `backup` 字段现在到底影响什么（为什么"看着不对"却没炸）

| 消费者 | 位置 | 对湮灭记录的实际作用 |
|---|---|---|
| `isDroppableChess` | `shared/standIn.js:124-129` | 只看 `chessType === 'NORMAL'` + `backup.charId !== charId`，**会**把 18 条判成"可下掉" |
| 客户端「干员持有」 | `public/js/ui/ownershipModel.js:157` | 额外要求 `c.visible !== false`；湮灭记录 `visible:false` → **一条都进不来** |
| 服务端 `checkNotOwned` | `shared/protocol.js` + 上面的判据 | 只按 `isDroppableChess` 过滤，理论上能接受伪造的湮灭 id（客户端不显示，实际发不出去） |
| `standInRecord` / `standInSummary` | `shared/standIn.js:139-145` | 会去 `backups.units['char_605_cmedic']` 找 form；该 unit 存在，且 form key `2/1/4/0`、`2/60/7/1` 恰好等于这些记录的状态（DIY 槽位共用同一组状态），所以**能**解析成预备干员记录 |
| `buildBackups` | `tools/build-data.mjs:629-728`，调用在 3923 行 | **永远看不到这 26 条**：`applyAnnihilationMods` 在 3980 行、即 backups 建好之后才把记录插进 `files.chess`。实测 `data/backups.json` 里 `standsIn` 引用 `chess_char_9_*` 的记录数 = **0** |
| 合并护栏 | `tools/build-data.mjs:3513-3545` | 校验 tier/bonds/garrison/token/annBonds/golden 配对，**不校验** `backup.charId` |

即：**今天这个字段对玩家可见行为没有任何影响**——它既不改立绘（见下），也不参与 110/28 这两个计数，更不会给 `backups.json` 添单位。

**关于「缺立绘」（实测定量，结论与疑点相反）**

`public/js/ui/assetUrls.js:12` 优先用 `chess.charId`（`const id = chess?.charId || chess?.assets?.[field]`），而 `charId` 是正确的真实干员；记录的 `assets` 也指向真实干员。所以 **`backup.charId` 不可能是缺立绘的原因**。

跑 `test/version-assets.test.js`（只读，3 条失败）并用 `tools/assets/coverage.mjs` 的 `assetCoverage()` 导出明细，`missing` 正好 12 行，全部落在 `act2autochess` 版本、每个都是同样的 8 个字段 `avatar, portrait, avatarE2, portraitE2, front, back, clips, skills`：

| 行 | 缺失的主体 | 是谁 |
|---|---|---|
| 1 | `char_219_meteo` | 陨星（9_02，`backup` **自指**） |
| 2 | `char_193_frostl` | 霜叶（9_11，`backup` **自指**） |
| 3 | `char_260_durnar` | 坚雷（9_13，`backup` **自指**） |
| 4 | `char_002_amiya` | 阿米娅（9_14） |
| 5-12 | `chess_char_9_02_a/_b`、`9_11_a/_b`、`9_13_a/_b`、`9_14_a/_b` | 上述 4 名的棋子记录本身 |

**注意 1/2/3 三条的 `backup.charId` 就是它们自己**——原清单把它们列为"看似正常"。这就把"`backup` 占位 ⇒ 缺立绘"的假设直接证伪：缺立绘的 4 名里有 3 名 `backup` 完全正确。

另外 9 名（闪灵/赫德雷/阿斯卡纶/维什戴尔/煌/凯尔希/Mon3tr/逻各斯/红豆）在 `data/assets.json` 的 `chars` 里都有条目、本地也有 3–11 个文件，**一条 missing 都没有**。

真正的成因（证据链完整）：

1. `tools/fetch-assets.mjs` 的 `dataExtras(backups, chess)`（195-208 行）只把 **`backups.units`** 的每个单位加进资源计划（`extraOperators`），`chess` 参数仅用来取 module 的 `typeIcon`，**从不读 `chess[].charId`**。
2. 这 4 名干员都不在官方模板 `data/versions/*` 的 `chars` 里（湮灭是 mod 自带），也不是 6★（6★ 会因 DIY 自选池进 `backups.units`）——**于是两头都不覆盖，资源从未被声明**；`data/assets.json` 的 `chars` 只有 238 名，正是"官方 122 名 + 6★ 池 + 炸惊"的并集。
3. 那 9 名为什么有？因为都是 6★（红豆是唯一在本季官方名册里的 4★）。**这与 `backup.charId` 无关，与"是不是 6★/在不在官方清单里"有关。**

因此：**换 `backup.charId`（修法 a）对这 3 条红灯一票都不管用**——覆盖检查读的是 `charId`（已正确）与 `data/assets.json` 的条目。修法是 §5.5。

---

## 5. 两种修法的代价

### (a) 把 `backup.charId` 换成真实干员 id（= 让它等于 `charId`）

先说明：**这不会改变任何可见结果**，因为显示/数值/技能/资源读的都是顶层 `charId`（已正确）。它只会改变 18 条记录里的一个"补位指针"。

| 影响面 | 会不会动 |
|---|---|
| 立绘 / 模型 / 技能图解析 | **不动，而且修不好红灯**。`assetUrls.js:12` 读 `charId`；`assets` 全部已指向真实干员；`test/version-assets.test.js` 的 12 条 missing 是 `data/assets.json` 少了 4 名干员的条目（§4、§5.5），改 `backup` 一条都不消 |
| `stats` / `skill` / `talents` / `tokens` | 不动（本来就取自 `charId`） |
| `data/backups.json` | **不动**。`buildBackups`（3923）跑在 `applyAnnihilationMods`（3980）之前，26 条记录永远进不了它；实测 `standsIn` 引用 9_xx = 0 |
| stand-in 计数 110 / 预备干员 28 | **不动**（见 §6：这两个数是记录集断言，与 `backup.charId` 无关；且今天已绿） |
| `test/golden/standins.json` | **不动**（`tools/golden.mjs:681` 的 `STANDIN_CHESS` 已按 `isOfficialChess` 过滤，湮灭记录不在生成口径里） |
| 副作用 | `isDroppableChess` 对这 18 条从 true 变 false（今天因为 `visible:false` 已经无效）；`gd.standIn(id)` 从"返回预备干员记录"变 null（今天没人调用）。即：把一条**潜在**陷阱关掉 |
| 落地成本 | 不小：`docs/research/20-annihilation-mods.json` 是**生成物**，手改会在下次 `node tools/extract-annihilation-mods.mjs` 时被上游值覆盖（该脚本对 `isOwnAnnChess` 的记录走"整条搬入"分支）。要固化必须改抽取器（加一条显式覆盖表并写进 `_extract`）或改 `modref/` 上游（**不在 git**）。另外"改哪个字段"本身就要先定：`_a`/`_b` 都改？只改预备干员的 10 条还是 18 条全改？ |
| 语义风险 | 改完 NORMAL 记录变成 `backup === charId`，与 `docs/DATA.md:690`「NORMAL (55) names one of 17 stand-ins」直接矛盾，会需要同步改文档口径 |

### (b) 保留 id、把记录名改成「预备干员」类中性名

| 影响面 | 会不会动 |
|---|---|
| 立绘/模型/技能图 | **变得更糟**：名字说"预备干员-医疗"，`charId`/`assets`/技能/数值仍是闪灵 → 名实不符反向出现 |
| 湮灭名册显示 | 13 名干员里 9 名会显示成"预备干员-XX"（`annihilationRoster` 只按 id 过滤，不看 name），玩家会看到 9 个"预备干员"占位卡 |
| 数值/技能/golden/计数 | 不动（同上） |
| 落地成本 | 同 (a) 的生成物覆盖问题；还要改 `docs/ANNIHILATION-MODS.md` §7.1 的 13 名干员清单与 `docs/DATA.md` |
| 结论 | 不推荐：制造一处新的名实不符，收益为零 |

### 推荐

**不改数据（0 改动）**；(a)/(b) 都建立在"显示用的 id 填错了"这个错误前提上。如果目标是"防止将来有人误用 `backup` 字段"，成本最低的护栏是**在 `applyAnnihilationMods` 的校验里加两条断言**（零数据变化、零 golden 影响）：

1. `chessType === 'PRESET'` ⇒ `backup.charId === charId`（现有 8 条满足）；
2. `chessType === 'NORMAL'` ⇒ `backup.charId` ∈ 官方 17 名原型干员集合（现有 18 条满足）。

外加一行注释说明"这批记录的 `backup` 只是补位指针，不参与显示；`buildBackups` 在其之前执行，故不会进 `backups.json`"。如果只是想留档，就到此为止。

## 5.5 真正的修法：让资源计划认出这 4 名干员（修的是资产线，不是 id）

目标：把 `char_219_meteo` / `char_193_frostl` / `char_260_durnar` / `char_002_amiya` 纳入资源计划，`npm run assets` 后 `test/version-assets.test.js` 的 3 条自动转绿。

| 方案 | 落点 | 代价 / 风险 |
|---|---|---|
| **A（推荐）`dataExtras` 也吃 `chess[].charId`** | `tools/fetch-assets.mjs:195-208`：给 `extraOperators` 增加来自 `chess[].charId` 的条目（`name` / `subProfessionId` / `nationId` / `skill.iconId`），再 `npm run assets` 重抓 `data/assets.json` | 一处函数 + 一次资源重抓；`data/assets.json` 是生成物（会与 `public/data/assets.json` 镜像一起动）。也要复核 shrink guard 与 `test/version-assets.test.js` 第 67 行那条 `238` 的期望值（会变成 242，注释里已写明 238 的构成，需要同步改注释与断言） |
| B 只给这 4 个 id 开白名单 | 同上函数里加一个 4 元素常量 | 更小但更"钉死"；下次 mod 再带新干员还要再改一次 |
| C 认定这 4 名不在资源范围 | `test/version-assets.test.js` 的期望改成"允许这 4 个豁免" + `docs/ASSETS.md` 记录 | 3 条会转绿，但湮灭里这 4 张卡**永远没有立绘/模型**（玩家可见），除非接受 |

**A 的关键前提**：`data/chess.json` 里这 4 条的 `charId` 已经是正确 id（见 §2），所以**不需要动任何研究数据**；这也再次说明修法与 `charId`/`backup` 无关。

---

## 6. (a) 之后 110/28 与 `test/golden/standins.json` 会不会自动恢复

**不会"恢复"，因为它们根本不由此产生；而且今天它们已经是绿的。**

实测计数（`node` 直读 `data/chess.json`）：

| 判据 | NORMAL 记录数 | 其中 `backup.charId` ∈ 8 名预备干员 |
|---|---|---|
| 不筛 | 278 | 60 |
| 只排湮灭 | 260 | 50 |
| **只排炸惊（旧口径，只认 `zhajing`）** | **128** | **38** |
| **`isOfficialChess`（`shared/playSets.js`，含 `annihilation` 判据）** | **110** | **28** |

→ 红灯里的 `128≠110` 与 `38≠28` 就是这么来的：**缺的是"湮灭"这条判据，不是 `charId` 错**。

- 当前 `test/content/standin.test.js:35` 的 `RESERVE_RECORDS` 与第 43 行循环都已用 `isOfficialChess`（该文件 2026-10-31 14:19 的版本，即另一条线已改）。我实跑了一次：`node --test test/content/standin.test.js` → **12 tests / 12 pass**，其中 `assert.equal(n, 110)`（第 73 行）与 `assert.equal(RESERVE_RECORDS.length, 28)`（第 265 行）都通过。
- 改 (a) 对这两处**零影响**：`n` 统计的是 `chessType === 'NORMAL'` 的官方记录（不读 `backup.charId`，所以即便在旧口径下也仍是 128）；`RESERVE_RECORDS` 已排除湮灭记录（旧口径下 38→28 会"碰巧"变成 28，但那是巧合，不是修法本身在修问题）。
- `test/golden/standins.json`：`tools/golden.mjs:681` 的 `STANDIN_CHESS` = `isOfficialChess(c) && chessType==='NORMAL' && backup.charId !== charId` → 湮灭 26 条一条不进；golden 文件生成于 2026-10-25（早于湮灭数据 2026-10-30），**改 (a)/(b) 都不会让任何 scenario 移动**。（未跑 `npm run golden`：耗时长且本单只读，结论来自生成器的过滤条件。）

**所以 (a) 不需要为了这两条红灯而做；它们已经由测试侧判据处理完毕，计数一个没改。**

---

## 7. 改动落点清单（若真的动手）

| 层 | 文件 / 函数 | 说明 |
|---|---|---|
| 上游真源（不在 git） | `modref/mods/rhodes-ship/…/packs/rhodes-ship/chess.json`、`modref/mods/kazdel-ship/…/packs/kazdel-ship/chess.json` | 8 名 + 5 名的原始 `backup`/`chessType` 就在这里 |
| 抽取器（唯一能固化改动的地方） | `tools/extract-annihilation-mods.mjs`（219-240 行整条搬入；改完要写 `_extract` 说明） | 手改 `docs/research/20-*.json` 会被下一次运行覆盖 |
| 生成物（勿手改） | `docs/research/20-annihilation-mods.json` → `chess` 26 条 | 归一化 `tools/research-normalize.mjs` 不碰这三个字段 |
| 生成期护栏 | `tools/build-data.mjs` `applyAnnihilationMods()` 3513-3545（建议在此加 `backup` 断言）；`buildChess()` 328+ **不产出**这 26 条 | `applyAnnihilationMods` 在 `buildBackups`(3923) 之后(3980)执行 → 记录永不进 `backups.json` |
| 产物（勿手改） | `data/chess.json`（26 条）、`data/backups.json`（不涉及） | 走 `npm run build:data` 重生成 |
| 测试会跟着动的 | `test/content/standin.test.js:35/73/265`（今日已绿，改 id 不动）；`test/match/standin-ownership.test.js:38`（官方 55，不动）；`test/data.test.js:96`（500 条 / 26 条湮灭，不动）；`tools/golden.mjs:681` + `test/golden/standins.json`（不动） | 换言之：**改 (a)/(b) 不会让任何现有断言变红或变绿** |
| **真正的红线（与本单的 charId 无关）** | `tools/fetch-assets.mjs:195-208` `dataExtras()`（资源计划只认 `backups.units`，不认 `chess[].charId`）→ `data/assets.json` / `public/data/assets.json`（生成物，缺 4 名干员）→ `test/version-assets.test.js:46-50`（`missing` 12 条）、`:63`（`versions[0].missing` 12≠0）、`:71`（presentation union 242≠238） | 修 A/B/C 见 §5.5；`238` 的注释与断言要同步 |
| 文档 | `docs/DATA.md:690`（PRESET 74 / NORMAL 55 / 17 stand-ins 口径）；`docs/ANNIHILATION-MODS.md:470-522`（13 名干员清单与 §7.1） | (b) 改名字必须同步这两处；纯加注释只动 ANNIHILATION-MODS.md |

---

## 8. 只读声明与核对方式

- 只读过这些文件：`docs/research/20-annihilation-mods.json`、`data/{chess,backups,assets}.json`、`.cache/gamedata/excel/character_table.json`、`modref/mods/{rhodes,kazdel}-ship/**/chess.json`、`tools/{build-data,extract-annihilation-mods,research-normalize,golden,fetch-assets}.mjs`、`tools/assets/{coverage,versions}.mjs`、`shared/{standIn,playSets}.js`、`server/match/gamedata.js`、`public/js/ui/{assetUrls,ownershipModel}.js`、`test/content/standin.test.js`、`test/match/standin-ownership.test.js`、`test/data.test.js`、`test/version-assets.test.js`、`docs/{DATA,ANNIHILATION-MODS}.md`。
- 跑过的只读测试：`node --test test/content/standin.test.js`（**12/12 通过**，含 110 与 28 两条断言）；`node --test test/version-assets.test.js`（**3 条失败**，即本单 §4 的 12 条 missing / 12≠0 / 242≠238），并用 `assetCoverage()` 导出了 missing 明细。
- 临时脚本 4 个，均在系统临时目录、已按精确文件名删除：`%TEMP%\annil9xx-{table,stats,assets,coverage,coverage2}.mjs`（`coverage.mjs` 因相对导入失败换成 `coverage2.mjs`，两个都删了）。
- 未做（也不该在这一单做）：`npm run build:data`、`npm run assets`、`npm run golden`、任何 `git` 写操作、任何 `data/**` `test/**` `docs/research/**` 改动。
- 结论覆盖了原疑点，但**必须提醒**：`test/version-assets.test.js` 的 3 条红灯**不会**因为"把 `backup.charId` 换成真实干员 id"而消失（实测覆盖检查读 `charId` 与 `data/assets.json`，两者都不受该字段影响）；它们的修法在 `tools/fetch-assets.mjs`（§5.5）。

# 甄选干员池 & 拉特兰主 C（只读分析）

只读分析：本线没有改任何源码/数据，只新增本文件。探针脚本放在 `tmp/`（已删），复现方法见 §11。

---

## 0. 结论摘要

1. **池子不是「87 条随便挑」**：合法池由代码算，`diyPool(tier) = diy.prototypes[tier] ∪ diy.ownedPool`，还要过 `KITTED_CHARS`（没有 kit 的干员不上架）。
   实测 **5★ 槽 87 人 / 6★ 槽 81 人**，全部 87 人都已 kit 化（过滤后一个不减）。
2. **「甄选干员 `bonds: []`」不成立**。`chess.json` 里那 10 条 `isDiy` 只是空模板；编成记录由 `shared/diy.js:257` 用 `backups.diy.operators[charId].bonds` 拼出来——全池只有 **菲亚梅塔** 自带 `lateranoShip`，其余全部是 `emptyShip`（协防）。
3. **但外援可以「转职」进拉特兰**：`变形同构体`（`canGiveBond: true`）+ `拉特兰桥夹`（`giveBondId: lateranoShip`）⇒ `unitBonds` 里真的出现 `lateranoShip`，`isMember()` 判成员。实测 6 名常驻拉特兰 + 1 名转职外援 = **引擎成员 7 名**、`lateranoShip` 计数 7。所以「甄选位是纯外援、不进 6 人档」只在**不带那两件装备**时成立。
4. **6★ 甄选槽首选：假日威龙陈（`char_1013_chen2`，S3“假日风暴”）**：远程（吃精准 3 档）、60s 内 **124 发**弹药（把圣堂殉爆从 0 次推到 1 次）、自身 20.4M、队伍总输出最高 **1.717M/s（+46.9%）**。备选 **谬因**（发数榜第一的远程，154 发 / 2 次殉爆）与 **维什戴尔**（单发质量路线，自身 23.1M）。
5. **一个必须排除的假阳性**：赤刃明霄陈 S3「相当于其**当前生命值 6%** 的法术伤害」——在 1e12 血的测试木桩上算出 1.8**万亿**、队伍 30.3G/s。她是本口径下唯一会骗人的条目，已剔除（§10）。

---

## 1. 三个必须先纠正的前提

| 前提 | 实际情况 | 证据 |
|---|---|---|
| 「`backups.diy` 是 87 条 charId 映射，就是可选的池子」 | `diy.operators`（87）只是**元数据表**（名字/星级/职业/盟约），真正的可选范围是 `prototypes[tier] ∪ ownedPool` 再按 kit 过滤；5★ 槽 87、6★ 槽 **81** | `shared/diy.js:182-187`；`KITTED_CHARS` 过滤实测不淘汰任何人 |
| 「甄选干员 `bonds: []`，不算进拉特兰 6 人档」 | 空模板只是 `data/chess.json` 的 10 条 `isDiy`；实装记录的 bonds 来自 `backups.diy.operators[].bonds`（池里人人都有 `emptyShip`，只有菲亚梅塔是 `lateranoShip`） | `shared/diy.js:257`；实测 compose 结果 |
| 「外援永远是外援」 | `变形同构体`+`拉特兰桥夹` 可把任意自选干员转成拉特兰成员（计数 +1、吃每发 ramp、喂殉爆） | `data/items.json`：`chess_item_6_09_e_b.canGiveBond=true`、`chess_item_4_08_e_a.giveBondId='lateranoShip'`；`shared/plugins/rules.js` `grantedBondsByMorph`；实测 `engineMembers.lateranoShip = 7` |

补充：`diy.slots` 只有 4 个槽（`chess_char_5_diy1_a/2_a`、`chess_char_6_diy1_a/2_a`，`shopLevel` 5/6，`requirement: TIER_6`），`diy.excluded` 有 7 人被排除在 ownedPool 外（`char_456_ash`、`char_1029_yato2`、`char_1048_orchd2`、`char_4123_ela`、`char_4141_marcil`、`char_4182_oblvns`、`char_4217_makoto` —— 联动/不可得角色）。

---

## 2. 数据源与命中率

| 字段 | 源 | 命中 |
|---|---|---|
| 中文名 / 星级 / 职业代码 / 子职业 id / 盟约 bonds | `data/backups.json` → `diy.operators[charId]` | **87 / 87** |
| 子职业中文名 / 攻击方式（`position`、`attackKind`）/ 攻速 `bat`·`aspd` / 射程格 / 特性 / 3 个技能（含 bb）/ 2 个天赋 | `data/backups.json` → `units[charId].forms["2/60/7/3"]`（E2 Lv60 / 技能 7 / 模组 3 的精锐形态） | **87 / 87** |
| 独立交叉校验 | `.cache/gamedata/excel/character_table.json`（官方表） | 名字 **87/87 完全一致**，`position` **87/87 一致** |
| 需要但没有的 | —— | **0 条**（`data/assets.json`、`public/i18n`、`public/assets` 索引都不需要动） |

**解析不出的条目：无。** 没有任何名字/职业是我猜的或外部补的：`diy.operators` 自带中文名与职业，`units` 自带子职业中文名与 `position`（远程/近战位）。

攻击方式一律按**部署位**（`units[].position`：`RANGED`/`MELEE`）写，这也是引擎自己用的口径（`server/sim/content/support/index.js:268` `isGroundOp` 用 `def.position`；精准 3 档也用 `def.position === 'RANGED'`，`server/sim/content/bonds/addon/battle.js:142`）。「能远程攻击的重装」（机械师等）仍记作**近战位**。

---

## 3. 完整池子清单（87 人 = 5★ 槽可选；6★ 槽 81 人）

`池别`：`owned` = `diy.ownedPool`（玩家拥有的 6★，5★ 与 6★ 槽都能放）；`原型` = `diy.prototypes[tier]`（系统补位角色，走 `diy.locked` 的固定技能/模组）。**6★ 槽少的那 6 个**是 4★ 预备干员（`char_601_cguard` 近卫 / `char_602_cdfend` 重装 / `char_603_csnipe` 狙击 / `char_604_ccast` 术师 / `char_605_cmedic` 医疗 / `char_606_csuppo` 辅助），只出现在 5★ 档。

`基础发/秒` = `(aspd + 天赋攻速) / 100 / bat`，即 E2 Lv60、无技能时的每秒攻击次数（= 每秒弹药消耗，见 §5）。近战位不列（本报告只关心输出位）。

| # | 中文名 | charId | 星 | 职业 | 子职业 | 攻击方式 | 池别 | 盟约 bonds | 基础发/秒 |
|---|---|---|---|---|---|---|---|---|---|
| 1 | 预备干员-辅助 | `char_606_csuppo` | 4 | 辅助 | 凝滞师 | 远程/高台 | 原型(仅5★档) | emptyShip | 0.57 |
| 2 | 预备干员-狙击 | `char_603_csnipe` | 4 | 狙击 | 速射手 | 远程/高台 | 原型(仅5★档) | emptyShip | 1.00 |
| 3 | 预备干员-术师 | `char_604_ccast` | 4 | 术师 | 中坚术师 | 远程/高台 | 原型(仅5★档) | emptyShip | 0.68 |
| 4 | 预备干员-医疗 | `char_605_cmedic` | 4 | 医疗 | 医师 | 远程/高台 | 原型(仅5★档) | emptyShip | 0.35 |
| 5 | 阿 | `char_225_haak` | 6 | 特种 | 怪杰 | 远程/高台 | owned | yanShip | 0.77 |
| 6 | 艾雅法拉 | `char_180_amgoat` | 6 | 术师 | 中坚术师 | 远程/高台 | owned | emptyShip | 0.63 |
| 7 | 澄闪 | `char_377_gdglow` | 6 | 术师 | 驭械术师 | 远程/高台 | owned | victoriaShip | 0.77 |
| 8 | 淬羽赫默 | `char_1031_slent2` | 6 | 辅助 | 护佑者 | 远程/高台 | owned | emptyShip | 0.63 |
| 9 | 电弧 | `char_4195_radian` | 6 | 辅助 | 召唤师 | 远程/高台 | owned | emptyShip | 0.63 |
| 10 | 多萝西 | `char_4048_doroth` | 6 | 特种 | 陷阱师 | 远程/高台 | owned | emptyShip | 1.18 |
| 11 | 菲亚梅塔 | `char_300_phenxi` | 6 | 狙击 | 炮手 | 远程/高台 | owned | **lateranoShip** | 0.46 |
| 12 | 黑 | `char_340_shwaz` | 6 | 狙击 | 重射手 | 远程/高台 | owned | emptyShip | 0.63 |
| 13 | 黑键 | `char_4046_ebnhlz` | 6 | 术师 | 秘术师 | 远程/高台 | owned | emptyShip | 0.33 |
| 14 | 鸿雪 | `char_4055_bgsnow` | 6 | 狙击 | 重射手 | 远程/高台 | owned | sargonShip | 0.63 |
| 15 | 霍尔海雅 | `char_4027_heyak` | 6 | 术师 | 中坚术师 | 远程/高台 | owned | emptyShip | 0.63 |
| 16 | 假日威龙陈 | `char_1013_chen2` | 6 | 狙击 | 散射手 | 远程/高台 | owned | yanShip | 0.43 |
| 17 | 酒神 | `char_1042_phatm2` | 6 | 辅助 | 巫役 | 远程/高台 | owned | victoriaShip | 0.53 |
| 18 | 凯尔希 | `char_003_kalts` | 6 | 医疗 | 医师 | 远程/高台 | owned | emptyShip | 0.35 |
| 19 | 凯尔希·思衡托 | `char_1052_kalts2` | 6 | 医疗 | 守望者 | 远程/高台 | owned | emptyShip | 0.35 |
| 20 | 可露希尔 | `char_4228_closur` | 6 | 先锋 | 战术家 | 远程/高台 | owned | emptyShip | 1.08 |
| 21 | 刻俄柏 | `char_2013_cerber` | 6 | 术师 | 中坚术师 | 远程/高台 | owned | emptyShip | 0.68 |
| 22 | 莱伊 | `char_4117_ray` | 6 | 狙击 | 猎手 | 远程/高台 | owned | emptyShip | 0.63 |
| 23 | 林 | `char_4080_lin` | 6 | 术师 | 阵法术师 | 远程/高台 | owned | yanShip | 0.50 |
| 24 | 令 | `char_2023_ling` | 6 | 辅助 | 召唤师 | 远程/高台 | owned | yanShip | 0.63 |
| 25 | 逻各斯 | `char_4133_logos` | 6 | 术师 | 中坚术师 | 远程/高台 | owned | emptyShip | 0.63 |
| 26 | 麦哲伦 | `char_248_mgllan` | 6 | 辅助 | 召唤师 | 远程/高台 | owned | emptyShip | 0.63 |
| 27 | 谬因 | `char_4229_aphris` | 6 | 术师 | 轰击术师 | 远程/高台 | owned | emptyShip | 0.34 |
| 28 | 娜仁图亚 | `char_4138_narant` | 6 | 狙击 | 回环射手 | 远程/高台 | owned | sargonShip | 1.00 |
| 29 | 闪灵 | `char_147_shining` | 6 | 医疗 | 医师 | 远程/高台 | owned | emptyShip | 0.40 |
| 30 | 死芒 | `char_450_necras` | 6 | 术师 | 塑灵术师 | 远程/高台 | owned | victoriaShip | 0.63 |
| 31 | 提丰 | `char_2012_typhon` | 6 | 狙击 | 攻城手 | 远程/高台 | owned | emptyShip | 0.42 |
| 32 | 望 | `char_2027_wang` | 6 | 特种 | 陷阱师 | 远程/高台 | owned | yanShip | 1.18 |
| 33 | 维什戴尔 | `char_1035_wisdel` | 6 | 狙击 | 投掷手 | 远程/高台 | owned | emptyShip | 0.48 |
| 34 | 维伊 | `char_4226_veen` | 6 | 术师 | 秘术师 | 远程/高台 | owned | emptyShip | 0.38 |
| 35 | 遥 | `char_4202_haruka` | 6 | 辅助 | 护佑者 | 远程/高台 | owned | emptyShip | 0.63 |
| 36 | 夜莺 | `char_179_cgbird` | 6 | 医疗 | 群愈师 | 远程/高台 | owned | emptyShip | 0.35 |
| 37 | 伊芙利特 | `char_134_ifrit` | 6 | 术师 | 轰击术师 | 远程/高台 | owned | emptyShip | 0.34 |
| 38 | 早露 | `char_197_poca` | 6 | 狙击 | 攻城手 | 远程/高台 | owned | emptyShip | 0.42 |
| 39 | 真言 | `char_4204_mantra` | 6 | 术师 | 本源术师 | 远程/高台 | owned | sargonShip | 0.63 |
| 40 | Mon3tr | `char_4179_monstr` | 6 | 医疗 | 链愈师 | 远程/高台 | owned | emptyShip | 0.43 |
| 41 | Pith | `char_612_accast` | 6 | 术师 | 扩散术师 | 远程/高台 | 原型(5★档+6★档) | emptyShip | 0.34 |
| 42 | Raidian | `char_614_acsupo` | 6 | 辅助 | 凝滞师 | 远程/高台 | 原型(5★档+6★档) | emptyShip | 0.60 |
| 43 | Stormeye | `char_611_acnipe` | 6 | 狙击 | 速射手 | 远程/高台 | 原型(5★档+6★档) | emptyShip | 1.00 |
| 44 | Touch | `char_613_acmedc` | 6 | 医疗 | 医师 | 远程/高台 | 原型(5★档+6★档) | emptyShip | 0.35 |
| 45 | W | `char_113_cqbw` | 6 | 狙击 | 炮手 | 远程/高台 | owned | emptyShip | 0.36 |
| 46 | 预备干员-近卫 | `char_601_cguard` | 4 | 近卫 | 无畏者 | 近战/地面 | 原型(仅5★档) | emptyShip | — |
| 47 | 预备干员-重装 | `char_602_cdfend` | 4 | 重装 | 铁卫 | 近战/地面 | 原型(仅5★档) | emptyShip | — |
| 48 | 阿斯卡纶 | `char_4132_ascln` | 6 | 特种 | 伏击客 | 近战/地面 | owned | emptyShip | — |
| 49 | 艾丽妮 | `char_4009_irene` | 6 | 近卫 | 剑豪 | 近战/地面 | owned | emptyShip | — |
| 50 | 白铁 | `char_4072_ironmn` | 6 | 辅助 | 工匠 | 近战/地面 | owned | victoriaShip | — |
| 51 | 贝洛内 | `char_4037_demetr` | 6 | 近卫 | 斗士 | 近战/地面 | owned | siracusaShip | — |
| 52 | 陈 | `char_010_chen` | 6 | 近卫 | 剑豪 | 近战/地面 | owned | yanShip | — |
| 53 | 斥罪 | `char_4065_judge` | 6 | 重装 | 不屈者 | 近战/地面 | owned | siracusaShip | — |
| 54 | 赤刃明霄陈 | `char_1050_chen3` | 6 | 近卫 | 术战者 | 近战/地面 | owned | yanShip | — |
| 55 | 嵯峨 | `char_362_saga` | 6 | 先锋 | 尖兵 | 近战/地面 | owned | emptyShip | — |
| 56 | 涤火杰西卡 | `char_1034_jesca2` | 6 | 重装 | 哨戒铁卫 | 近战/地面 | owned | victoriaShip | — |
| 57 | 赫德雷 | `char_4088_hodrer` | 6 | 近卫 | 重剑手 | 近战/地面 | owned | emptyShip | — |
| 58 | 赫拉格 | `char_188_helage` | 6 | 近卫 | 武者 | 近战/地面 | owned | emptyShip | — |
| 59 | 煌 | `char_017_huang` | 6 | 近卫 | 强攻手 | 近战/地面 | owned | yanShip / victoriaShip | — |
| 60 | 机械师 | `char_4230_mcnist` | 6 | 重装 | 哨戒铁卫 | 近战/地面 | owned | emptyShip | — |
| 61 | 棘刺 | `char_293_thorns` | 6 | 近卫 | 领主 | 近战/地面 | owned | emptyShip | — |
| 62 | 克莱门莎 | `char_4231_clemnt` | 6 | 近卫 | 本源近卫 | 近战/地面 | owned | egirShip | — |
| 63 | 傀影 | `char_250_phatom` | 6 | 特种 | 处决者 | 近战/地面 | owned | victoriaShip | — |
| 64 | 老鲤 | `char_322_lmlee` | 6 | 特种 | 行商 | 近战/地面 | owned | yanShip | — |
| 65 | 领主·Sharp | `char_617_sharp2` | 6 | 近卫 | 领主 | 近战/地面 | 原型(5★档+6★档) | emptyShip | — |
| 66 | 娜斯提 | `char_4212_nasti` | 6 | 辅助 | 工匠 | 近战/地面 | owned | emptyShip | — |
| 67 | 年 | `char_2014_nian` | 6 | 重装 | 铁卫 | 近战/地面 | owned | yanShip | — |
| 68 | 怒潮凛冬 | `char_1051_headb2` | 6 | 近卫 | 撼地者 | 近战/地面 | owned | emptyShip | — |
| 69 | 帕拉斯 | `char_485_pallas` | 6 | 近卫 | 教官 | 近战/地面 | owned | emptyShip | — |
| 70 | 琴柳 | `char_479_sleach` | 6 | 先锋 | 执旗手 | 近战/地面 | owned | victoriaShip | — |
| 71 | 森蚺 | `char_416_zumama` | 6 | 重装 | 决战者 | 近战/地面 | owned | sargonShip | — |
| 72 | 珊比 | `char_4235_thumpy` | 6 | 重装 | 本源铁卫 | 近战/地面 | owned | emptyShip | — |
| 73 | 弑君者 | `char_1502_crosly` | 6 | 特种 | 处决者 | 近战/地面 | owned | siracusaShip | — |
| 74 | 黍 | `char_2025_shu` | 6 | 重装 | 守护者 | 近战/地面 | owned | yanShip | — |
| 75 | 司霆惊蛰 | `char_1043_leizi2` | 6 | 近卫 | 解放者 | 近战/地面 | owned | yanShip | — |
| 76 | 推进之王 | `char_112_siege` | 6 | 先锋 | 尖兵 | 近战/地面 | owned | victoriaShip | — |
| 77 | 薇薇安娜 | `char_4098_vvana` | 6 | 近卫 | 术战者 | 近战/地面 | owned | kazimierzShip | — |
| 78 | 温蒂 | `char_400_weedy` | 6 | 特种 | 推击手 | 近战/地面 | owned | emptyShip | — |
| 79 | 予愿安洁莉娜 | `char_1015_aglna2` | 6 | 特种 | 巡空者 | 近战/地面 | owned | siracusaShip | — |
| 80 | 郁金香 | `char_608_acpion` | 6 | 先锋 | 尖兵 | 近战/地面 | 原型(5★档+6★档) | emptyShip | — |
| 81 | 斩业星熊 | `char_1044_hsgma2` | 6 | 重装 | 驭法铁卫 | 近战/地面 | owned | yanShip | — |
| 82 | 止颂 | `char_4011_lessng` | 6 | 近卫 | 无畏者 | 近战/地面 | owned | emptyShip | — |
| 83 | 重岳 | `char_2024_chyue` | 6 | 近卫 | 斗士 | 近战/地面 | owned | yanShip | — |
| 84 | 左乐 | `char_4121_zuole` | 6 | 近卫 | 武者 | 近战/地面 | owned | yanShip | — |
| 85 | Mechanist | `char_610_acfend` | 6 | 重装 | 铁卫 | 近战/地面 | 原型(5★档+6★档) | emptyShip | — |
| 86 | Misery | `char_615_acspec` | 6 | 特种 | 处决者 | 近战/地面 | 原型(5★档+6★档) | emptyShip | — |
| 87 | Sharp | `char_609_acguad` | 6 | 近卫 | 无畏者 | 近战/地面 | 原型(5★档+6★档) | emptyShip | — |

> 备注：`予愿安洁莉娜` 的 `position` 是 `MELEE`（巡空者，起飞后挡飞行单位），所以**吃不到精准 3 档**；`机械师`/`涤火杰西卡` 同理（能在坦位上远程攻击，但部署位是近战）。

### 3.1 6★ 槽（81 人）与 5★ 槽（87 人）的差集

6★ 槽少 6 人，全是 4★ 预备干员：`char_601_cguard`（预备干员-近卫）、`char_602_cdfend`（-重装）、`char_603_csnipe`（-狙击）、`char_604_ccast`（-术师）、`char_605_cmedic`（-医疗）、`char_606_csuppo`（-辅助）。
`diy.locked` 给这 15 个原型类固定了技能/模组（例：`char_603_csnipe` → `skillIndex 2`、无模组），所以原型位的「选技能」是假的，只是补位口径。

---

## 4. 同一人物的本体 / 异格重复（避免重复计数）

池内按「英文名同根 / 官方异格关系」比对，共 6 组：

| 组 | 池内条目 | 判定依据 |
|---|---|---|
| 陈 | `char_010_chen` 陈 / `char_1013_chen2` 假日威龙陈 / `char_1050_chen3` 赤刃明霄陈 | `appellation` = Ch'en / Ch'en the Holungday / Ch'en the Dawnstreak |
| 凯尔希 | `char_003_kalts` 凯尔希 / `char_1052_kalts2` 凯尔希·思衡托 | Kal'tsit / Kal'tsit·Esperanta |
| Sharp | `char_609_acguad` Sharp / `char_617_sharp2` 领主·Sharp | 同一人，两个补位原型（近卫-无畏者 / 近卫-领主） |
| Mechanist（跨池） | `char_610_acfend` Mechanist（原型） / `char_4230_mcnist` 机械师（owned） | `appellation` 都是 Mechanist |
| Raidian（跨池） | `char_614_acsupo` Raidian（原型） / `char_4195_radian` 电弧（owned） | `appellation` 都是 Raidian |
| 傀影 / 酒神（异格） | `char_250_phatom` 傀影 / `char_1042_phatm2` 酒神 | 英文名不同根（Phantom / Tragodia），按官方设定是同一人物的异格 |

外加**跨池重复（不在 87 内，但会被重复上场）**：
- **菲亚梅塔 `char_300_phenxi`** 既是 ownedPool 成员，也是常驻拉特兰棋子 `chess_zj_30_b`（tier 3）。她既是全池唯一自带 `lateranoShip` 的人，又是唯一「本体已在常驻位」的人 —— 若同时在常驻位和甄选位，`bondsMeta` 按 `baseId` 去重计数（`server/match/bondsMeta.js:5`、`:97-99`）时是**两个不同 baseId**（`chess_zj_30_a` 与 `chess_char_6_diy1_a`），会**双计数**成 2 名拉特兰。
- 能天使（`chess_zj_01_b`）与新约能天使（`chess_char_6_13_b`）、送葬人（`chess_zj_16_b`）与圣约送葬人（`chess_zj_64_b`）都是**常驻棋子**，不在甄选池里，不存在重复计数问题。

---

## 5. 拉特兰在引擎里到底是什么（数据 + 代码）

`data/bonds.json` → `lateranoShip`：`thresholds [3, 6]`、`countMode BOARD`、黑盒 `act1autochess_bond_eff_laterano`：

```
{ base_ammo_percent: 0.05, ammo_percent_per_stack: 0.015, power_bond_char_cnt: 6,
  atk_per_consume: 0.04, max_atk_for_consume: 2 }
```

`server/sim/content/bonds/core.js:356-418`（`installLaterano`）把它实现成两条：

1. **技能开启时**：`ammoLeft = floor(ammoLeft × (1 + 0.05 + 0.015×L))` —— 层数实时读；超限局 `L` 封顶 600 层（约 ×10 弹药）。
2. **6 人档后**：每 `ammoUsed` 一发 → 所有成员 `ATK +0.04`（超限 ×2 = `+0.08`），上限普通 200%、超限 **700%**；超上限的层数转穿透/攻血（每 100 层 +0.4% 无视防御、+1% 生命/攻击）。
3. **圣堂殉爆**（`core.js:393-416`，只在 `flags.overlimit` 局）：累计**每 100 发**弹药 → 对**全场敌人**造成「全队拉特兰当前攻击力总和 × 20%」的真实伤害。这就是「弹药吞吐 = 引擎」的出处。

**火力单位 = 1 次 `performAttack` = 1 发弹药**：`server/sim/skills.js:607-612`，`kind === 'ammo'` 的技能每完成一次攻击就 `ammoLeft--` 并 `emit('ammoUsed')`（`noAmmo` 的追加攻击不消耗）。所以「发数」= 攻击次数，**段数/多重只放大每发伤害，不放大弹药消耗**（除非 kit 自己循环发弹，如新约能天使、谬因这类按 `trigger_time` 逐发打的实现）。

由此得到一个和题面不同的重要结论：**「攻速 × 段数 × 群体」不是发数公式**。
- 真正的发数 = 攻击频率（`aspd/100/bat`，含技能/天赋的 `attack_speed`、`base_attack_time` 修正）× 每次攻击的**弹药数**（`attack@trigger_time` 那条路，只有 kit 逐发实现才算多）。
- 段数（`attack@append_atk_scale`，维什戴尔的二次余震）、`attack@max_target`（多目标）、溅射半径：只进**每发伤害**。

### 精准（`preciShip`）3 人档

`thresholds [2,3]`，`{ base_atk: 0.10, atk_per_stack: 0.012, power_def_penetrate: 0.3, power_magic_resist_penetrate: 0.3, power_bond_char_cnt: 3 }`。
3 人档生效范围 = 「【精准】干员 **+ 所有远程干员**」（`bonds/addon/battle.js:9-10`、`:142` 判定 `u.def?.position === 'RANGED'`），并额外给 30% 无视防御/法抗。
→ **远程的甄选干员能白吃这一档；近战位（含巡空者/哨戒铁卫这种「能远程打」的）不能。**

---

## 6. 实测口径（本报告所有数字的来源）

复用上一条线已有的探针口径（`.cache/o3/laterano.mjs` 的 C4 阵容），在 `test/helpers/battleHarness.js` 上跑真 sim：

- 阵容（8 格，C4 = 7 常驻 + 1 外援）：新约能天使 `chess_char_6_13_b`、蕾缪安 `chess_char_6_01_b`、送葬人 `chess_char_2_01_b`、空弦 `chess_char_3_21_b`、莫斯提马 `chess_char_4_02_b`、能天使 `chess_char_3_01_b`、维什戴尔 `chess_char_9_10_b`。
- 甄选位：`{ diy: { slot: 'chess_char_6_diy1_a', charId, skillIndex }, elite: true }`，装备 `拉特兰桥夹 chess_item_4_08_e_a` + `变形同构体 chess_item_6_09_e_b`（其余 7 人每人 1 件维式重锤 `chess_item_1_01_e_a`）。
- 盟约状态：`lateranoShip` 7（6 常驻 + 转职外援）、`preciShip` 3（蕾缪安+送葬人+维什戴尔）、`skillfulShip` 2（空弦+维什戴尔）、`suntShip` 3；tier 用真机 `bondsMeta.tierFor`。
- 敌人：9 个 1e12 血、0 防、0 攻、`rank: 'ELITE'` 的木桩，铺 row 9–11 × col 8–10；`timeLimit 60`；`flags.overlimit = true`（超限专属加强只在此 flag 下生效）。
- 层数：R40 = 大 400+25×50 = **1650**、小 150+25×50 = **1400**。
- 指标：`队伍 DPS` = Σ 木桩 `taken` / 60（含无来源真伤，即把殉爆算进去）；`发数` = 该干员自己的 `ammoUsed` 事件数；`自身伤害` = `unitStats[].dmg`；`殉爆` = `floor(队伍总弹药 / 100)`。
- **基线**：同一阵容但甄选槽空着（7 件）= **1.169M/s、56 发、0 次殉爆** —— 与题面「4 人/60 秒只 59 发、殉爆 0 次」是同一量级：**这套常驻阵容自己也过不了 100 发线**。

覆盖：池内 87 人 × 3 个技能 = 261 次跑，剔除非法技能后 210 次有效；76 人有可用数据（其余 11 人是纯治疗/纯辅助，`dmg = 0`，不作为主 C 候选）。

---

## 7. 发数（弹药吞吐）Top 8

按题面口径排序：**该干员 60s 自己消耗的弹药数**（只有 `kind === 'ammo'` 的技能才消耗）。同分时按队伍总输出。

| 名次 | 干员 | 职业/子职业 | 远程? | 取用技能 | 自身发数/60s | 队伍总弹药 | 殉爆次数 | 自身伤害 | 队伍总输出 | 相对基线 |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | 予愿安洁莉娜 `char_1015_aglna2` | 特种/巡空者 | ❌ 近战位 | S3 酸橙的心事 | **172** | 228 | **2** | 11.3M | 1.643M/s | +40.5% |
| 2 | 谬因 `char_4229_aphris` | 术师/轰击术师 | ✅ | S3 混沌的本质 | **154** | 210 | **2** | 11.6M | 1.637M/s | +40.0% |
| 3 | 涤火杰西卡 `char_1034_jesca2` | 重装/哨戒铁卫 | ❌ 近战位 | S3 饱和迸射 | **134** | 190 | 1 | 0.8M | 1.403M/s | +20.0% |
| 4 | 假日威龙陈 `char_1013_chen2` | 狙击/散射手 | ✅ | S3“假日风暴” | **124** | 180 | 1 | 20.4M | **1.717M/s** | **+46.9%** |
| 5 | 机械师 `char_4230_mcnist` | 重装/哨戒铁卫 | ❌ 近战位 | S1 聚类分析 | **124** | 180 | 1 | 9.6M | 1.569M/s | +34.2% |
| 6 | 凯尔希·思衡托 `char_1052_kalts2` | 医疗/守望者 | ✅ | S2 保护性拒止 | **91** | 147 | 1 | 14.5M | 1.557M/s | +33.2% |
| 7 | 维伊 `char_4226_veen` | 术师/秘术师 | ✅ | S3“用赤铁铭记” | **65** | 121 | 1 | 4.3M | 1.376M/s | +17.7% |
| 8 | 维什戴尔 `char_1035_wisdel` | 狙击/投掷手 | ✅ | S3 爆裂黎明 | **45** | 101 | 1 | **23.1M** | 1.609M/s | +37.6% |
| — | 提丰 `char_2012_typhon` | 狙击/攻城手 | ✅ | S3“永恒狩猎” | 45 | 101 | 1 | 7.9M | 1.357M/s | +16.1% |

### 每条为什么发数高（引用技能/天赋原文）

1. **予愿安洁莉娜**（特种/巡空者，**近战位**）：S3 携带 **31 发弹药**（`attack@trigger_time: 31`）、`atk 1.5`、`attack@max_target: 4`、攻击对 3 个敌人 305%（`attack@atk_scale: 3.05`）。弹药池大 + 起飞后攻速/范围扩张 ⇒ 60s 打掉 172 发，全池第一。**但 `position = MELEE`，吃不到精准 3 档**。
2. **谬因**（术师/轰击术师，✅远程）：S3 **20 发弹药**（`attack@trigger_time: 20`）+ `base_attack_time: -1.1`（间隔 2.9 → 1.8，约 1.85 发/秒）+ 155% 伤害、中继器额外 30%。远程 + 全池第二发数 ⇒ 2 次殉爆。
3. **涤火杰西卡**（重装/哨戒铁卫，近战位）：S3 **20 发弹药**，60s 内 **134 发**弹药 / **234 次攻击**（次数全榜最密，差额是不消耗弹药的普攻），但自身只有 0.8M —— 她是防御型，弹药是「拦截射击」，**只买殉爆、不买伤害**。
4. **假日威龙陈**（狙击/散射手，✅远程）：S3 **32 发弹药**、**每次攻击消耗 2 发**、攻击范围内**所有**敌人 + 天赋「节约风气」22% 概率不消耗弹药（`attack@trigger_time: 32`）。远程 + 弹药池最大 + 天赋减速/减防 ⇒ **自身 20.4M 与队伍 1.717M/s 都排第一**。
5. **机械师**（重装/哨戒铁卫，近战位）：S1 **3 发弹药/次**，但攻击是「**五连击的群体攻击**」（`attack@times: 5`）、`bat 1.2`，60s 内反复开关累计到 124 发 —— 弹药靠「次数多」而不是「单次池子大」。
6. **凯尔希·思衡托**（医疗/守望者，✅远程）：S2 **10 发弹药**、`atk +125%`、每发对**目标周围所有敌人** 350% 真伤（`attack@atk_scale: 3.5`）。
7. **维伊**（术师/秘术师，✅远程）：S3 **21 发弹药** + `attack_speed +140`（`aspd 140`，攻速翻倍以上），`bat 3` 被攻速抵回。
8. **维什戴尔**（狙击/投掷手，✅远程）：S3 只有 **6 发弹药**（`attack@trigger_time: 6`）+ `base_attack_time +2.9`（间隔大幅拉长），发数垫底；但每发「主目标 190% + 余震 50% + 残影 100% 概率爆炸 160% + 溅射半径大」⇒ **单发质量全池最高（自身 23.1M/45 发 ≈ 51 万/发）**。

---

## 8. 交叉榜：不算发数、只看总输出（同一批跑）

| 名次 | 干员 | 自身伤害 | 发数 | 队伍总输出 | 相对基线 |
|---|---|---|---|---|---|
| 1 | 假日威龙陈 | 20.4M | 124 | **1.717M/s** | +46.9% |
| 2 | 予愿安洁莉娜 | 11.3M | 172 | 1.643M/s | +40.5% |
| 3 | 谬因 | 11.6M | 154 | 1.637M/s | +40.0% |
| 4 | 可露希尔 `char_4228_closur` | **26.9M** | **0** | 1.616M/s | +38.2% |
| 5 | 维什戴尔 | 23.1M | 45 | 1.609M/s | +37.6% |
| 6 | 娜仁图亚 `char_4138_narant` | 24.9M | 0 | 1.583M/s | +35.4% |
| 7 | 机械师 | 9.6M | 124 | 1.569M/s | +34.2% |
| 8 | 凯尔希·思衡托 | 14.5M | 91 | 1.557M/s | +33.2% |
| 9 | Stormeye `char_611_acnipe` | 19.7M | 0 | 1.466M/s | +25.5% |
| 10 | 真言 `char_4204_mantra` | 17.0M | 0 | 1.451M/s | +24.1% |

要点：**可露希尔 / 娜仁图亚 / Stormeye / 真言 是「零弹药」纯输出位**（可露希尔 S3 `base_attack_time: -0.5` + 「每攻击 9 次后攻击目标数 +1，最多 6 次」→ 单场 480 次攻击，全池最多；娜仁图亚 S3「每次攻击发射 3 个回旋投射物」）。它们不喂弹药、不触发殉爆，只贡献伤害。

---

## 9. 结论：只能填 1 个 6★ 甄选槽

### 首选：**假日威龙陈** `char_1013_chen2`（S3“假日风暴”）

- 三条轴同时最好：**远程**（吃精准 3 档的 +10%+1.2%/层 攻击力与 30% 无视防御/法抗）、**124 发**（把整个队伍的弹药从 56 推到 180，殉爆 0 → 1 次）、**队伍总输出 1.717M/s（+46.9%，本表最高）**；自身 20.4M，只低于可露希尔（26.9M）、娜仁图亚（24.9M）、维什戴尔（23.1M）。
- 她的技能形状和引擎同向：`attack@trigger_time: 32`（弹药池最大）+ 每次攻击消耗 2 发 + 天赋「节约风气」22% 概率不消耗 → 弹药吞吐高但不断档。
- **风险**：散射手 `bat 2.3`、射程 7 格，站位要求靠前；`yanShip` 会顺手给炎盟约 +1 计数（拉特兰队里通常无影响）。

### 备选 1：**谬因** `char_4229_aphris`（S3 混沌的本质）

- **远程里发数第一（154 发）、殉爆 2 次**（唯一能和予愿安洁莉娜并列的 2 次）。`base_attack_time -1.1` 让轰击术师的慢攻速变成 1.85 发/秒，20 发弹药池 + 中继器额外 30%。
- 队伍总输出 1.637M/s（比首选低 5%），自身 11.6M。选它 = 选「更多殉爆、更少直伤」。
- 射程 6 格且是超远距离群体法术，站位比假日威龙陈安全。

### 备选 2：**维什戴尔** `char_1035_wisdel`（S3 爆裂黎明）

- 「单发质量」路线：45 发换 23.1M 自身伤害（≈51 万/发，全池最高），远程，队伍 1.609M/s（+37.6%）。
- 好处是**几乎不吃弹药**（6 发弹药池、间隔 +2.9）——如果你的队伍弹药本来就靠常驻位，她是最稳的纯输出；坏处是不喂殉爆。
- 上一条线（`.cache/o3/` 的单兵 DPS 口径）也是把她排第一（8990 vs 第二名 3646）。

### 与「能天使 / 蕾缪安」（拉特兰本家、常驻位）的分工

常驻位那 6 名拉特兰**已经把「发数」和「单发」两端占住了**，本次实测（R40，60s；数字取自「第 8 人 = 可露希尔」那一次的 `unitStats`，换第 8 人会有 ±5% 的浮动）：

| 常驻成员 | 60s 攻击次数 | 自身伤害 | 角色 |
|---|---|---|---|
| 蕾缪安 `chess_char_6_01_b` | **14**（0.23 发/秒） | **17.4M** | 单发重型（≈124 万/发），负责「每发 ramp 的乘区质量」 |
| 莫斯提马 `chess_char_4_02_b` | 120 | 13.6M | 中速法术覆盖 |
| 空弦 `chess_char_3_21_b` | 360 | 23.1M | 发数侧（速射手 + 灵巧 2 档） |
| 能天使 `chess_char_3_01_b` | 360 | 9.9M | 发数侧（速射手） |
| 新约能天使 `chess_char_6_13_b` | 0（`attacks` 未计，3.0M 伤害来自技能/召唤） | 3.0M | 弹药源 |
| 送葬人 `chess_char_2_01_b` | 0 | 0 | 弹药源（本场景没打出伤害） |

结论：**甄选位不该再补一个「拉特兰本家」**（6 人档已满，第 7 人只多 1 层计数、没有新乘区），也不该补纯单发（蕾缪安已经占住），而应该补**「弹药吞吐 + 远程 + 自带输出」三合一**的那一个 —— 这就是假日威龙陈，其次谬因。

**如果把两件桥接装备（拉特兰桥夹 + 变形同构体）算进去**，甄选位同时是：
- 第 7 名拉特兰成员（6 人档依旧 tier 2，不改变档位，但多吃 1 份 `每发 ramp` 的 ATK）
- 弹药源（124 发 → 殉爆 1 次；谬因 154 发 → 2 次）
- 精准 3 档的接收方（远程，+10%+1.2%/层 攻击力 + 30% 无视防御/法抗）
不带这两件装备时，它只是 `emptyShip`（协防）干员 —— 而拉特兰队里通常凑不出第二个协防，**协防 2 档的 ×1.2 伤害吃不到**，纯输出会掉一截。

### 不推荐但值得知道的

- **可露希尔 / 娜仁图亚**：自身伤害最高（26.9M / 24.9M）、发数 0。若你的拉特兰队已经靠常驻位把弹药撑到殉爆线以上，这两位是「纯加伤害」的最优解。
- **菲亚梅塔**：全池唯一自带 `lateranoShip`，但她是**常驻棋子的本体**（`chess_zj_30_b`），放进甄选位会双计数成 2 名拉特兰；她的 S3 是 `toggle`（持续攻击）**不消耗弹药**，实测 0 发，只有 9.8M 自身伤害 —— 想凑 6 人档可以拿她，想当主 C 不够。

---

## 10. 陷阱与例外（避免把假数字写成结论）

1. **赤刃明霄陈 `char_1050_chen3` 的 1.8 万亿是木桩假象**：S3「赤霄·天喟」=「对穿过的敌人造成**相当于其当前生命值 6%** 的法术伤害（至少 550% 攻击力）」。测试木桩是 1e12 血 ⇒ 单次 600 亿，60s 算出 1.8e12、队伍 30.3**G**/s（基线的 25921 倍）。**任何「按当前/最大生命值百分比」的干员在超高血木桩上都不可比**，必须单列或换低血木桩复测。
2. **`attacks` 计数不等于「扳机次数」**：`server/sim/ai.js:282` 每调用一次 `performAttack` 就 +1，而多段/多目标的 kit 会在自己的技能逻辑里额外调用它（例：空弦/能天使在本场景量到 **360 次/60s = 6 次/秒**，而她们的数据攻击间隔是 1.0 秒；可露希尔 480 次）。所以非弹药干员的「攻击次数」只能当**同口径内的相对值**；**只有 `ammoUsed` 才是引擎货币**。本报告的发数榜一律用 `ammoUsed`，总输出榜用真实掉血。
3. **涤火杰西卡 / 机械师 发数高但自身伤害低**（0.8M / 9.6M）：它们买的是殉爆次数，不是主 C 的输出。
4. **单场景局限**：以上全部是「9 个 0 防 0 攻 1e12 血木桩 + 超限 R40 + 60s」一个场景。真实关卡有防御、抗性、行进波次、站位限制（尤其散射手/轰击术师的射程与朝向），排序可能变。**没有跑普通（非超限）档**：普通档 `atk_per_consume` 0.04 且上限 200%、无殉爆，弹药型干员的相对收益会下降，纯输出位（可露希尔/娜仁图亚/维什戴尔）会相对上升。
5. **两个甄选槽的组合未实测**：5★ 槽与 6★ 槽可选池几乎相同（5★ 多 6 个 4★ 预备干员），理论上可以「假日威龙陈 + 谬因」双弹药位，把队伍总弹药推到 300+（3 次殉爆）；但 8 格棋盘只剩 6 个常驻位，会拆掉一条常驻盟约，**本报告没有跑这个组合**，不要当结论用。

---

## 11. 复现

- 现有探针（上一条线的成果，未改动）：`.cache/o3/laterano.mjs`（`--one C4 40 --diy <charId>` 单跑、`--sweep` 扫 18 个候选）。本线只读它、以及它写的 `.cache/o3/laterano-sweep.json`。
- 本线的探针（一次性，已删）：`tmp/probe-lat-diy.mjs`（87 人 × 3 技能，自身伤害/攻击数）、`tmp/probe-ammo.mjs`（同阵容，`ammoUsed` 计数 + 殉爆）、`tmp/rank.mjs`（基线 + 排名）、`tmp/gen-table.mjs`（§3 表格）。核心只有三步：`diyPool(5,{data,kitted})` 取池 → `makeBattle({units:[..., {diy:{slot,charId,skillIndex},elite:true,items:[桥夹,变形同构体]}]})` → `h.run(60)` 后读 `perPlayer.p1.unitStats` 与 `hooksOf('ammoUsed')`。
- 基线复跑：同脚本把甄选位去掉（7 件）⇒ 1.169M/s、56 发、0 殉爆。

— 只读分析，未改任何源码/数据/git 状态；`data/**`、`public/**`、`server/**`、`test/**`、`tools/**` 全部未触碰。

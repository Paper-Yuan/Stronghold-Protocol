# 雷姆必拓（Rim Billiton）— 内容与引擎扩展点清单

本包 `workshop/rimbilliton/` 是一个**完整的对局内容包**：一名核心盟约（【雷姆必拓】/ 开拓心）、一批围绕它设计的卡池干员、装备、策略、
召唤物与「干员特质」，外加把这一切接进对局的**服务端逻辑**（`server.battle` + `server.meta`）与 **9 份干员/召唤物 kit**。
它不写任何客户端面板——所有界面（盟约条、商店卡、特质提示）都由引擎按数据与既有组件直接渲染。

玩法上，它是一个**「持仓干员 → 生命上限 → 真实伤害 / 全局攻击」的滚雪球核心盟约**：最后上场的一名【雷姆必拓】干员获得「开拓心」，
在场每一名**不重复**的成员都让持有者减伤 5%；持有者的生命上限按层数抬升，并把生命上限的一部分转化为**攻击附带的真实伤害**；
当场上凑够 6 名不同成员时，全体【雷姆必拓】干员按持有者**生命上限的 25%** 获得固定攻击。围绕「谁当持有者、怎么把它养肥、
怎么把层数与成员堆起来」展开，配套的特质/装备（发放干员、加层、复刻战斗中效果）都在服务这个循环。

**元数据**：`id: rimbilliton`，显示名「雷姆必拓」，包版本 `1.2.0`，作者 `the Rim Billiton mod`，`license: GPL-3.0-or-later`，
`gameVersion: 0.2.6`（本仓库引擎为 0.2.6），`combat: true`，`stripDiyOverlaps: true`（本包做成棋子的干员会从**自选编队池**里摘除，
避免同一干员同时以棋子与自选条目两种身份出现而效果重复）。**未声明任何前置包**：它的核心盟约 `bondType` 是 `SEASON`（非 `SIDE_STORY`），
与 `workshop/side-story/` 那套故事集接口**无关**。存在一处**跨包软耦合**：盟约成员含 `chess_char_5_25_a`（若叶睦），该棋子由
`workshop/ave-mujica/` 定义、但共用本包素材；策略文案自带说明「在【雷姆必拓】部分干员缺席时体验可能不完整」。
素材为二次创作（官方干员头像/立绘/皮肤/语音 + 自制图标），授权标注为 GPL-3.0-or-later。

---

## 1. 概览

| 面 | 内容 | 数量 |
|---|---|---|
| 数据 · `bonds.json` | 盟约（1 条新增核心 + 7 条覆盖官方盟约） | 8 |
| 数据 · `chess.json` | 棋子（8 名新干员 ×2【普通/精锐】 + 3 名官方干员 ×2 覆盖） | 22 |
| 数据 · `garrisons.json` | 干员特质 | 18 |
| 数据 · `items.json` | 装备（2 件 ×2【普通/精锐】） | 4 |
| 数据 · `effects.json` | 效果（盟约/策略/装备） | 6 |
| 数据 · `tokens.json` | 召唤物 | 1 |
| 数据 · `bands.json` | 策略（band） | 1 |
| `overrides` | 覆盖官方记录（6 条 `chess:` + 7 条 `bonds:`） | 13 |
| 素材 `art.chars` | 自带立绘/头像/Spine 的干员 | 4 |
| `bondIcons` / `itemIcons` | 盟约图标 1 / 装备图标 2 | 3 |
| `skins` | 时装 | 4 |
| `voices` / `voiceLangs` | 语音（jp 5 名；cn/en/kr 各 4 名） | 5 / 4 |
| 服务端 | `server.battle`（`battle/main.mjs`）+ `server.meta`（`meta/main.mjs`） | 2 模块 |
| 客户端 | —（`client: null`，无面板） | 0 |
| kit | `kits/*.js`（干员 8 + 召唤物 1） | 9 |
| 文件总数 | `assets/` 331 + 数据/逻辑 19 | 350 |

---

## 2. 盟约（8 条）

8 条里 **只有 `rimBilliton` 是本包新增**（`isCore: true`、`bondType: SEASON`、`identifier: 24`）；另外 7 条是把 mod 干员
**并进官方盟约成员表**的覆盖（只写 `bondId` + `members` + `visibleMembers`，机制沿用官方）。`thresholds` 与「每档效果」严格取自各条目的 `desc` / `bb`。

| id | 名称 | 核心/附加 | 阈值 | 一句话 |
|---|---|---|---|---|
| `rimBilliton` | 雷姆必拓 | **核心**（新增） | 3 / 6 | 开拓心持有者 + 6 名成员的全局攻击 |
| `siracusaShip` | 叙拉古 | 核心（覆盖） | 3 / 6 | 部署攻速 + 6 名隐匿/真伤/恐惧 |
| `preciShip` | 精准 | 附加（覆盖） | 2 / 3 | 攻击力% + 3 名穿透/扩范围 |
| `arcaneShip` | 奥术 | 附加（覆盖） | 2 / 3 | 法术易伤 + 3 名低血额外提升 |
| `steadShip` | 坚守 | 附加（覆盖） | 2 / 3 | 全体生命 + 3 名伤害分摊/反伤 |
| `deputShip` | 助力 | 附加（覆盖） | 2 / 3 | 防御 + 休整期结束全盟约层数 +2（3 名 +4） |
| `visiShip` | 远见 | 附加（覆盖） | 2 | 每 10 层发 2 资金 + 80/150 层降价 |
| `indomShip` | 不屈 | 附加（覆盖） | 2 / 3 | 地面干员被击倒概率重部署 + 3 名全场 +5 技力 |

### 2.1 `rimBilliton`（新增核心盟约）

- **阈值效果**（`bb`：`power_bond_char_cnt: 3`、`ex_bond_char_cnt: 6`）：
  - **≥3 名不同**：最后上场的 1 名【雷姆必拓】干员获得「开拓心」。场上每存在 1 位不重复的【雷姆必拓】干员，持有者**受到伤害 −5%**
    （`taken_reduce: 0.05`）；持有者**生命上限 +25%**（`hp: 0.25`，每层 `hp_per_stack: 0.0025`，即 +0.25%/层）；
    攻击时额外附带 **5% 生命上限的真实伤害**（`true_dmg: 0.05`，每层 `true_dmg_per_stack: 0.0005`）。
  - **≥6 名不同**：场上【雷姆必拓】干员获得等同于「开拓心」持有者 **25% 生命上限的攻击**（`atk_hp_share: 0.25`，加算/固定值）。
- **层数轴怎么涨**：核心盟约走引擎既有的「发层」通路（策略 / 卡 / 特质）。包内 `spec.layerGain` 注记 *“Economy-driven: sources that
  grant layers (strategies / cards) apply like every other core bond.”* 本包自带的层数来源见 §6：**黑** 获得时 +3（精锐 +6）、
  **蜜莓** 休整期每名不同成员 +2（精锐 +4）、**霜叶** 开技能 +1（精锐 +2）。
- **持有者规则**（`battle/main.mjs`）：以**休整期最后摆上场**的雷姆必拓成员为初始持有者（引擎把整盘摆放序写进 `input.placementOrder`，
  包从后往前找），战斗中再部署才更新「最后上场」；持有者阵亡时交给场上最后上场的存活成员。

### 2.2 七条覆盖盟约（把 mod 干员并进官方名册）

这 7 条与官方同名，本包只写最小覆盖记录（`bondId` + `members` + `visibleMembers`），把各包的 mod 干员并进成员表，
其余字段沿用官方（`visiShip` / `indomShip` 另把文案「到达→达到」「立刻→立即」）。逐条并入的成员：

| id | 本包 / 关联包并入的 mod 干员（`_a`） |
|---|---|
| `siracusaShip` | `chess_char_6_21_a`（予愿安洁莉娜，本包）、`chess_char_5_32_a`（八幡海铃，ave-mujica） |
| `preciShip` | `chess_char_5_24_a`（莱伊，本包）、`chess_ws_dos_holungday_a`（假日威龙陈，dossoles）、`chess_ws_col_jesca_a`（涤火杰西卡，columbia） |
| `arcaneShip` | `chess_char_4_27_a`（阿米娅，本包）、`chess_ws_col_aphris_a`（谬因，columbia） |
| `steadShip` | `chess_char_6_22_a`（珊比，本包）、`chess_ws_col_jesca_a`（涤火杰西卡，columbia） |
| `deputShip` | `chess_char_2_21_a`（蜜莓，本包）、`chess_char_5_30_a`（三角初华，ave-mujica）、`chess_ws_col_nasti_a`（娜斯提，columbia）、`chess_ws_col_ceylon_a`（锡兰，columbia） |
| `visiShip` | `chess_char_3_22_a`（黑，本包） |
| `indomShip` | `chess_char_5_25_a`（若叶睦，棋子定义在 ave-mujica）、`chess_ws_dos_crow_a`（羽毛笔，dossoles） |

> 合并语义：引擎对 `members` / `visibleMembers` **求并集**（`shared/workshop.js` 的 `OVERRIDE_UNION_LISTS`），
> 所以只写自己那几位即可、官方名单一条不丢；但**一条盟约只认一个包**（`PACK_ID_COLLISION`，id 字典序小的包保留），
> 一条官方盟约的 mod 干员须由这条盟约的**唯一主人**一起列 —— 本包是上表这 7 条的唯一主人，故其它包的干员也由本包一并点名。
>
> 各条官方盟约的**层数轴**由官方机制决定（本包不改），包内 `spec.layerGain` 只是注记：如叙拉古靠商店刷新、精准靠击杀/开技能/部署、
> 奥术靠获得干员/刷新/消费、坚守靠休整期结束/同行、助力靠休整期结束普发、远见靠进出休整期、不屈靠被击倒/升级。

---

## 3. 干员（22 条）

### 3.1 新增（8 名 → 16 条）

每条干员都有 `_a`（普通）与 `_b`（精锐，`isGolden: true`）两记录；精锐版的 `statsBase/traitBase/talentsBase/modules` 等只在 `_b` 出现。
所有新增干员的第一条盟约都是 `rimBilliton`。

| id | 名字 | 阶级 | charId | 盟约 | 特质（`garrisonIds`） |
|---|---|---|---|---|---|
| `chess_char_1_21_a/b` | 霜叶 | 1 | `char_193_frostl` | rimBilliton | `garrison_169_a/b` |
| `chess_char_2_20_a/b` | 暴行 | 2 | `char_230_savage` | rimBilliton | `garrison_167_a/b` + `garrison_167_prep_a/b` |
| `chess_char_2_21_a/b` | 蜜莓 | 2 | `char_449_glider` | rimBilliton, deputShip | `garrison_168_a/b` |
| `chess_char_3_22_a/b` | 黑 | 3 | `char_340_shwaz` | rimBilliton, visiShip, columbiaShip | `garrison_166_a/b` |
| `chess_char_4_27_a/b` | 阿米娅 | 4 | `char_1037_amiya3` | rimBilliton, arcaneShip | `garrison_165_a/b` |
| `chess_char_5_24_a/b` | 莱伊 | 5 | `char_4117_ray` | rimBilliton, preciShip | `garrison_163_a/b`（+ 召唤物 `token_10034_ray_sndbst`） |
| `chess_char_6_21_a/b` | 予愿安洁莉娜 | 6 | `char_1015_aglna2` | rimBilliton, siracusaShip | `garrison_161_a/b` |
| `chess_char_6_22_a/b` | 珊比 | 6 | `char_4235_thumpy` | rimBilliton, steadShip | `garrison_162_a/b` |

> 盟约 `rimBilliton` 的成员表共 12 条：上述 8 名（16 条 `_a`）+ 3 名覆盖追加（见 3.2）+ 1 名跨包成员 `chess_char_5_25_a`。
> 玩法口径上的「雷姆必拓卡池干员」= 这 8 名新增 + 借用素材的若叶睦，共 9 名（`pack.json.description` 亦自述「9 名卡池干员」）。

### 3.2 覆盖官方 id（3 名 → 6 条）

在 `pack.json.overrides` 里以 `chess:<id>` 声明，改动**只有一处**：`bonds` 数组**追加 `rimBilliton`**（`bonds` 属整段替换键，本包写的是完整数组）；
`garrisonIds` 指向的仍是官方特质（`garrison_47/73/51`，不在本包 `garrisons.json` 里），其它字段沿用官方。

| 官方 id | 名字 | 阶级 | charId | 覆盖后 bonds |
|---|---|---|---|---|
| `chess_char_3_02_a/b` | 断崖 | 3 | `char_294_ayer` | `["skillfulShip","rimBilliton"]` |
| `chess_char_4_06_a/b` | 寒芒克洛丝 | 4 | `char_1021_kroos2` | `["preciShip","rimBilliton"]` |
| `chess_char_4_14_a/b` | 莱恩哈特 | 4 | `char_373_lionhd` | `["swiftShip","preciShip","rimBilliton"]` |

---

## 4. 装备（`items.json`，4 条）

两件装备各有普通（`_a`）/精锐（`_b`）两条记录，`kind` 均为 `passive`。行为实现见 `battle/main.mjs` 的 `registerItemBehaviour`（§7）。

| id | 名字 | 阶级 | kind | `effectId` | 效果 |
|---|---|---|---|---|---|
| `chess_item_2_08_e_a/b` | 绿叶菜罐头 | 2 | passive | `eff_mod_greens_can` / `eff_modg_greens_can` | 受到伤害 ×0.95（精锐 ×0.9）；`giveBondId: rimBilliton`（仅配合变形同构体时携带者才算雷姆必拓成员） |
| `chess_item_6_12_e_a/b` | “幸福在途”补给包 | 6 | passive | `eff_mod_happy_supply` / `eff_modg_happy_supply` | 造成伤害 ×1.4（精锐 ×1.8）；若携带者为雷姆必拓成员，造成伤害时额外造成 1.4/1.8 之外的一记真实伤害 = **开拓心持有者生命上限的 2.5%**（精锐 5%） |

---

## 5. 策略 / 召唤物 / 效果

### 5.1 策略（`bands.json`，1 条）

| id | 名称 | 效果 |
|---|---|---|
| `band_kaituo` | 予愿安洁莉娜（策略效果名：**开拓大地**） | 首次激活【雷姆必拓】盟约时，立即获得 1 名**阶级等于调度中心**的精锐化【雷姆必拓】干员（`effectId: aceffect_band_62`）。休整期实现在 `meta/main.mjs`（§7），`modeTypeList: [SINGLE, MULTI]`，`totalHp: 26` |

### 5.2 召唤物（`tokens.json`，1 条）

| id | 名称 | kind | 说明 |
|---|---|---|---|
| `token_10034_ray_sndbst` | 沙地兽 | summon | 莱伊（`chess_char_5_24_a/b`）的召唤物：不受到攻击、只能部署在召唤者攻击范围内；战斗行为走 `kits/token_10034_ray_sndbst.js`（不攻击 / 无敌 / 禁疗） |

### 5.3 效果（`effects.json`，6 条）

| id | 名称 | `effectType` | 归属 |
|---|---|---|---|
| `aceffect_band_62` | 开拓大地 | BAND_INITIAL | 策略 `band_kaituo` |
| `bondeffect_rimbilliton` | 雷姆必拓 | BOND | 核心盟约 `rimBilliton` |
| `eff_mod_happy_supply` | “幸福在途”补给包 | EQUIP | 装备（普通） |
| `eff_modg_happy_supply` | “幸福在途”补给包 | EQUIP | 装备（精锐） |
| `eff_mod_greens_can` | 绿叶菜罐头 | EQUIP | 装备（普通） |
| `eff_modg_greens_can` | 绿叶菜罐头 | EQUIP | 装备（精锐） |

---

## 6. 干员特质（`garrisons.json`，18 条）

每条干员特质都有普通/精锐两版（内容多为数值差异）。`eventType` 决定触发时机（本包只用到 `IN_BATTLE` 战斗内、`SERVER_PREP_START` 进入休整期、
`SERVER_GAIN` 获得时）。`effectKey` 是效果的**派发键**：官方内置的（`SERVER_*` / `act1autochess_*`）用其官方实现，本包自定义的由
`battle/main.mjs` 的 installer/reader 处理（§7）。

| id | 归属干员 | eventType | effectKey | 效果（`bb`） |
|---|---|---|---|---|
| `garrison_169_a` | 霜叶（普通） | IN_BATTLE | `act1autochess_gar_event_useskill`（官方） | 开技能时使自身所属已激活盟约层数 +1（`bond_add_count:1`，最多 2 次） |
| `garrison_169_b` | 霜叶（精锐） | IN_BATTLE | 同上 | 开技能时使自身所属已激活盟约层数 +2，最多 4 次 |
| `garrison_167_a` | 暴行（普通） | IN_BATTLE | `SERVER_ADD_CHAR_NO_REDEPLOY`（本包） | 本场未陷入再部署 → 下个休整期额外获得 1 名阶级 ≤ 调度中心的【雷姆必拓】干员（`tier_key: deployment_center_level`） |
| `garrison_167_b` | 暴行（精锐） | IN_BATTLE | 同上 | 同上，获得 2 名 |
| `garrison_167_prep_a` | 暴行（普通） | SERVER_PREP_START | `SERVER_GRANT_NO_REDEPLOY_CHAR`（本包 meta） | 进入休整期时获得 1 名阶级 ≤ 调度中心的【雷姆必拓】干员 |
| `garrison_167_prep_b` | 暴行（精锐） | SERVER_PREP_START | 同上 | 获得 2 名 |
| `garrison_168_a` | 蜜莓（普通） | SERVER_PREP_START | `SERVER_ADD_ACT_BOND_LAYER_BY_BOARD_BOND_CHAR`（本包 meta） | 场上每有 1 名不同的【雷姆必拓】干员，使所有已激活盟约层数 +2（`count:2`；不会重复触发同一盟约，两名【雷姆必拓】只 +2 一次） |
| `garrison_168_b` | 蜜莓（精锐） | SERVER_PREP_START | 同上 | 每名不同成员 +4（`count:4`；不会重复触发同一盟约） |
| `garrison_166_a` | 黑（普通） | SERVER_GAIN | `SERVER_ADD_BOND_CHESS_ALL`（官方） | 获得时自身所属盟约层数 +3（无需激活盟约） |
| `garrison_166_b` | 黑（精锐） | SERVER_GAIN | 同上 | +6 |
| `garrison_165_a` | 阿米娅（普通） | IN_BATTLE | `SERVER_EXTRA_TRIGGER_BATTLE_EFFECT`（本包） | 其他干员触发的「战斗中」类效果额外触发 1 次（每名干员最多 1 次） |
| `garrison_165_b` | 阿米娅（精锐） | IN_BATTLE | 同上 | 额外触发 2 次，最多 1 次 |
| `garrison_163_a` | 莱伊（普通） | IN_BATTLE | `SERVER_COPY_FRONT_EFFECT_BATTLE`（本包） | 战斗开始时复制**身前一格**其他干员的「战斗中」类效果（`front_count:1`） |
| `garrison_163_b` | 莱伊（精锐） | IN_BATTLE | 同上 | 复制身前两格内（`front_count:2`） |
| `garrison_162_a` | 珊比（普通） | IN_BATTLE | `act_gar_eff_takenReduceByBond`（本包 reader） | 【雷姆必拓】每叠加 1 层，本干员受到伤害 −0.1%（`divide_num:1`,`taken_reduce:0.001`） |
| `garrison_162_b` | 珊比（精锐） | IN_BATTLE | 同上 | 每 5 层受到伤害 −0.2%（`divide_num:5`,`taken_reduce:0.002`） |
| `garrison_161_a` | 予愿安洁莉娜（普通） | SERVER_PREP_START | `SERVER_GAIN_PIONEER_HOLDER`（本包 meta） | 进入休整期时获得 1 名「开拓心」干员 |
| `garrison_161_b` | 予愿安洁莉娜（精锐） | SERVER_PREP_START | 同上 | 获得 2 名 |

---

## 7. 服务端逻辑

### 7.1 `server.meta`（`meta/main.mjs`，休整期/全局侧）

`pack.json.server.meta.registers` 恰有 4 条注册键，全部在 `registerMeta(registry)` 里落实：

| 注册键 | 处理器 | 做什么 |
|---|---|---|
| `band:band_kaituo` | `kaituoHandler` | 【开拓大地】：监听 `onBondActivate`，当激活的盟约是 `rimBilliton` 且本局未发过（`counter('band:kaituo:done')` 幂等），按其阶级 = `ctx.shopLevel()` 发放 `count` 名**精锐**雷姆必拓干员；参数在派发时从 `ctx.gd.band('band_kaituo')` 读，缺省回退 `{count:1, bond:'rimBilliton'}` |
| `garrison:SERVER_GAIN_PIONEER_HOLDER` | `gainPioneerHolder` | 读**战斗→休整期通用标记** `ctx.mark('holder')`（=上一场开拓心持有者棋子 id），复制其 `baseId`（无持有者不触发，最多 10 名） |
| `garrison:SERVER_GRANT_NO_REDEPLOY_CHAR` | `grantNoRedeployChar` | 读 `ctx.mark('noRedeploy')`（上场战斗未陷入再部署的棋子 defId），`rollChess({bond:'rimBilliton', maxTier: shopLevel()})` 后 `grantChess` 发放 `count` 名 |
| `garrison:SERVER_ADD_ACT_BOND_LAYER_BY_BOARD_BOND_CHAR` | `addActBondLayerByBoardBondChar` | 统计棋盘上**不重复**且带指定盟约（`bbStr.bond_id`）的棋子数 `n`，对每个已激活盟约 `ctx.addLayers(b, n * count)` |

用到的 `registry.api`（引擎提供的休整期辅助，见 `app/server/match/metaPack.js`）：`num`、`ids`、`bondOrder`、`chessOnBoard`、`metaBonds`；
以及 `ctx.*` 面：`gd`、`source`、`counter/setCounter`、`shopLevel`、`rollChess`、`grantChess`、`bondActive`、`addLayers`、`mark`，
`ctx.gd` 上的 `goldenIdOf` / `baseIdOf` / `band`。**meta 模块只允许 import 本包文件**，引擎辅助一律走 `registry.api`。

### 7.2 `server.battle`（`battle/main.mjs`，战斗侧）

全部注册在**模块顶层**完成（`install()` 为空，无需每场安装）。逐键列出：

| 注册 | 键 | 作用 |
|---|---|---|
| `registerBondInstaller` | `rimBilliton` | 核心盟约运行时：维护 `st.holder`（`battleStore 'rimbilliton:rt'`）、持有者 `bond:rimbilliton:heart`（生命上限 + 按在场不同成员的减伤）、6 档 `bond:rimbilliton:six`（按持有者最大生命 25% 给全体加算攻击）、持有者普通攻击命中时附带真实伤害（tag `bond:rimbilliton`），并 `setBattleMark(battle, pid, 'holder', …)` 交给休整期 |
| `registerGarrisonInstaller` | `act_gar_event_onhurt_add_bond_layer` | 若叶睦：受击时按 `max_count` 上限触发 `fireGain`（加层） |
| `registerGarrisonInstaller` | `SERVER_ADD_CHAR_NO_REDEPLOY` | 暴行（战斗侧）：记录本场是否陷入过再部署（`death` 且非 `FORCED_EXIT` 且 `respawnAt` 有限），`battleEnd` 时 `setBattleMark(…, 'noRedeploy', defId|null)` |
| `registerGarrisonInstaller` | `SERVER_EXTRA_TRIGGER_BATTLE_EFFECT` | 阿米娅：把自身塞进 `battle._rbAmplifiers`（`fireGain` 的放大器列表） |
| `registerGarrisonInstaller` | `SERVER_COPY_FRONT_EFFECT_BATTLE` | 莱伊：`battleStart` 时按 `frontOf` 取身前 1/2 格友军，用 `garrisonIdsOf` 找其 `IN_BATTLE` 特质并 `battle.rbAddGarrison(unit, g)` 动态挂上 |
| `registerGarrisonReader` | `act_gar_eff_takenReduceByBond` | 珊比：按引擎算好的 `it.k`（层数）应用 `dmgTakenMul` 减伤 buff（`passiveBuff`/`removeBuff`） |
| `registerItemBehaviour` | `chess_item_2_08_e` | 绿叶菜罐头：把 `dmg_taken_mul` 写进 `scope.stat('taken', …)` |
| `registerItemBehaviour` | `chess_item_6_12_e` | “幸福在途”补给包：写 `dmg` 乘算；雷姆必拓成员每次造成伤害（非 proc、非 element、打敌方存活目标）额外造成一记真实伤害 = `rimbHolder` 生命上限 × `true_damage_hp_scale` |

### 7.3 干员 / 召唤物 kit（`kits/*.js`，9 份）

- **干员 kit（8 份）**：`chess_char_1_21_a.js`（霜叶，tier1 手写）、`chess_char_2_20_a.js`（暴行，tier2 手写）、`chess_char_2_21_a.js`（蜜莓，tier2 手写）、
  `chess_char_3_22_a.js`（黑 → 复用 `@ops/op-shwaz.js`）、`chess_char_4_27_a.js`（阿米娅，手写）、`chess_char_5_24_a.js`（莱伊 → 复用 `@ops/op-ray.js`）、
  `chess_char_6_21_a.js`（予愿安洁莉娜 → 复用 `@ops/op-aglna2.js`）、`chess_char_6_22_a.js`（珊比 → 复用 `@ops/op-thumpy.js`）。
  复用型 kit 的惯例：把**默认技能**从 `skills` 挪到顶层 `skill`，并按卡池数据修正触发规则（如 S2/S3 的 `ACTIVE_RANGE`）。
- **召唤物 kit（1 份）**：`token_10034_ray_sndbst.js`（沙地兽）——走官方召唤物 kit 通道（`docs/WORKSHOP.md §4.7`），给召唤物挂 `invulnerable/noHeal` buff。

---

## 8. 素材

`pack.json` 声明的素材面：

| 面 | 内容 |
|---|---|
| `art.chars`（4） | `char_1037_amiya3`、`char_193_frostl`、`char_230_savage`、`char_449_glider`：各带 `avatar` / `avatarE2` / `portrait` / `portraitE2` + `spine.front` / `spine.back`（skel/atlas/textures + 动作映射） |
| `art.skills`（7） | `skchr_amiya3_1/2`、`skchr_frostl_1/2`、`skchr_glider_1/2`、`skchr_savage_2` |
| `art.bands` | `band_kaituo` → `band/band_kaituo.png` |
| `bondIcons` | `rimBilliton` → `bond/icon_rimBilliton.png` |
| `itemIcons` | `trap_2001_mod_happy`、`trap_2002_mod_greens` → `item/*.png` |
| `skins`（4） | `boc-frostl`｜破冰｜`char_193_frostl`；`sale-savage`｜又一年秋季｜`char_230_savage`；`nian-glider`｜洇灵雨｜`char_449_glider`；`sale-amiya3`｜寰宇独奏｜`char_1037_amiya3` |
| `voices` / `voiceLangs` | jp 语音 5 名（含 `char_4183_mortis`）；cn/en/kr 各 4 名（不含 mortis） |

> `art.chars` 的 Spine 动作映射（`anims`）已由项目 Spine 管线（`tools/assets/skel.mjs` + `tools/assets/anim-roles.mjs`）
> 对真实 `.skel` 重算：修掉了 `skill`/`skills` 退化成 `Attack` 的旧值（暴行 / 滑翔 / 近卫阿米娅 曾因此在开技能时只播普攻动作）。
> 霜叶的官方小人（本体与破冰时装）本身没有技能片段，`skill` 维持官方回退（借攻击片段）。

**落盘目录约定**（`assets/` 下，随包根相对路径，如 `char/avatar/…`）：`char/avatar`、`char/portrait`、`spine/op/<char>/{front,back}`、
`skin/op/<char>/{front,back}`、`skill`、`voice/{cn,en,jp,kr}/<char>`、`band`、`bond`、`item`。
引擎经 `/workshop-assets/rimbilliton/<rel>` 提供这些素材；CDN 上则落在 `packs/rimbilliton/<rel>` 命名空间（见 §9）。
> 除 `art.chars` 声明的 4 名外，包内 `assets/` 还额外落了 `char_4183_mortis` 的头像/立绘/Spine 与 jp 语音，以及 `char_4183_mortis` 的技能图——服务跨包成员若叶睦。

---

## 9. 引擎侧需要的支持

### 9.1 用到的引擎通用能力

| 能力 | 引擎位置 | 本包怎么用 |
|---|---|---|
| 战斗模块 SDK `@battle/mod.js` | `app/server/sim/content/support/mod.js` | `registerBondInstaller` / `registerGarrisonInstaller` / `registerGarrisonReader` / `registerItemBehaviour` 注册面；`setBattleMark`、`battleStore`、`bondLayers`、`bondMembers`、`reached`、`onLayers`、`onUnitDamaged`、`isEnemyTarget`、`ownTag`、`byUnit`、`fireGain`、`garrisonIdsOf`、`bp`、`isProc`、`procTags`、`memberOf`、`num`、`directMods`、`onField`、`allyAt`、`isOp`、`garrisonRecord`、`passiveBuff` |
| 战斗→休整期通用标记 | `app/server/sim/content/support/index.js`（`setBattleMark`）、`app/server/match/match/combat.js`、`app/server/match/PlayerState.js`（`ctx.mark`） | `holder` / `noRedeploy` 两个标量的跨阶段传递 |
| 动态挂特质 / 特效放大器 | `app/server/sim/content/garrisons/battle.js`（`battle.rbAddGarrison`、`battle._rbAmplifiers`） | 莱伊复制身前干员特质、阿米娅放大 `fireGain` |
| 摆放顺序 | `app/server/match/player/round.js`（`input.placementOrder`） | 战斗初始确定「开拓心」持有者 |
| 休整期包注册表 | `app/server/match/metaPack.js`（`registry.api`：`ids`/`bondOrder`/`chessOnBoard`/`metaBonds`） | `meta/main.mjs` 的四个处理器 |
| 战斗包通道 | `app/server/battlePack.js`（`@battle/mod.js` 顶层注册 + import 白名单） | 战斗模块一次性注册 |
| kit 通道 / 别名 | `shared/kitImports.js`（`@kit/` `@sim/` `@ops/`）、`app/server/sim/content/kits/ops/op-*.js`、召唤物 kit 通道 | 8 份干员 kit 与 1 份召唤物 kit |
| 组件与常量 | `app/server/sim/dir.js`（`frontOf`）、`app/server/sim/constants.js`（`FORCED_EXIT`、`COLS`）、`app/server/sim/content/bonds/core.js`、`app/server/sim/content/items/battle.js` | 方位/常量/盟约与装备 installer 的落点 |

### 9.2 改动过 / 依赖的引擎文件（仓库内点名）

- `app/server/sim/content/garrisons/battle.js` —— 提供 `battle.rbAddGarrison`（动态挂 `IN_BATTLE` 特质）与 `battle._rbAmplifiers`（额外触发放大器）两个
  **通用钩子**；注释即点名 `workshop/rimbilliton` 的战斗逻辑。本包的莱伊/阿米娅特质依赖它们。
- `app/server/http/static.js` —— 素材 CDN 命名空间规则：包素材 `/workshop-assets/<pack>/<rel>` → CDN `packs/<pack>/<rel>`；文档与代码注释点名
  **rimbilliton 复用了官方干员 id**，落在 `/assets/…` 会撞上游同名键，故必须走 `packs/` 命名空间。
- `app/test/official-data.mjs`、`app/docs/UPSTREAM-UPGRADE.md`、`app/docs/ASSETS.md`、`app/forge-flow-rimbilliton.mjs` —— 仅**提及/验证**本包
  （bundled 包说明、素材命名空间说明、本包专属的流程验证脚本），非运行期依赖。
- `app/workshop/ave-mujica/chess.json`（若叶睦带 `rimBilliton` 盟约）与 `app/workshop/ave-mujica/kits/chess_char_5_25_a.js`（注释指向
  `workshop/rimbilliton/…`）—— 跨包成员耦合的落点（另一个包的文件，本包不改）。

> 自 2026-10-12 起引擎已**不含任何 mod 专属代码**（`app/server/sim/mod/` 已移除），本包只经官方通道
> （`kits/`、`pack.json.server.battle`、`pack.json.server.meta`）接入。除上述**通用契约**外，引擎**没有**为本包新增挂载点。

---

## 10. 文件清单

```
workshop/rimbilliton/
├── pack.json                      # 包声明（content 7 表 / overrides 13 / server.battle+meta / art+bondIcons+itemIcons+skins+voices）
├── bonds.json                     # 8 条盟约（rimBilliton 新增 + 7 条覆盖官方）
├── chess.json                     # 22 条棋子（8 名新增 ×2 + 3 名官方覆盖 ×2）
├── garrisons.json                 # 18 条干员特质
├── items.json                     # 4 条装备（2 件 ×2）
├── effects.json                   # 6 条效果
├── tokens.json                    # 1 条召唤物（沙地兽）
├── bands.json                     # 1 条策略（开拓大地）
├── battle/main.mjs                # server.battle：盟约 installer + 特质 installer/reader + 装备行为
├── meta/main.mjs                  # server.meta：拓大地 band + 3 个休整期特质处理器
├── kits/                          # 9 份 kit
│   ├── chess_char_1_21_a.js       #   霜叶
│   ├── chess_char_2_20_a.js       #   暴行
│   ├── chess_char_2_21_a.js       #   蜜莓
│   ├── chess_char_3_22_a.js       #   黑（复用 @ops/op-shwaz.js）
│   ├── chess_char_4_27_a.js       #   阿米娅
│   ├── chess_char_5_24_a.js       #   莱伊（复用 @ops/op-ray.js）
│   ├── chess_char_6_21_a.js       #   予愿安洁莉娜（复用 @ops/op-aglna2.js）
│   ├── chess_char_6_22_a.js       #   珊比（复用 @ops/op-thumpy.js）
│   └── token_10034_ray_sndbst.js  #   沙地兽召唤物 kit
└── assets/                        # 331 个素材文件
    ├── band/                      #   1（band_kaituo.png）
    ├── bond/                      #   1（icon_rimBilliton.png）
    ├── item/                      #   2（trap_2001_mod_happy / trap_2002_mod_greens）
    ├── char/avatar (9) · char/portrait (9)
    ├── skill/                     #   9（技能图）
    ├── skin/op/<char>/{front,back}    # 4 名 × 8 = 32
    ├── spine/op/<char>/{front,back}   # 5 名 × 6 = 30（含 char_4183_mortis）
    └── voice/{cn,en,kr}/<char> (各 4×14) · voice/jp/<char> (5×14)   # 238
```

> 计数口径：全包 350 个文件 = 根目录 8 + `battle/` 1 + `meta/` 1 + `kits/` 9 + `assets/` 331。
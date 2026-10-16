# 哥伦比亚（Columbia）— 内容与引擎扩展点清单

`workshop/columbia/` 是**一条核心盟约**（`columbiaShip` / 哥伦比亚）的完整工坊 mod 包：1 条盟约 + 8 名盟约干员（16 条棋子，普通 / 精锐各半）
+ 8 件装备（含 1 件会「吃掉」其它装备的复杂装备**源石辅助仪**）+ 1 个策略（`band_columbia` / 谬因）+ 5 个召唤物 + 10 条效果 + 20 条干员特质。
玩起来是一套**围绕「携带装备数量」滚雪球**的阵营：源石辅助仪每回合把干员身上其余装备的数值与效果吸收进自己、随盟约层数放大，
盟约再把这件装备的件数折算成攻击力，越到后期越强。

`pack.json`：`version 1.0.0`、`gameVersion 0.2.6`、`author "the Columbia mod"`、`license "GPL-3.0-or-later"`、`combat: true`、
`stripDiyOverlaps: true`。盟约记录 `bondType: "SEASON"`、`isCore: true` —— 它是**核心盟约**，**不依赖任何前置包**
（`workshop/side-story` 只服务 `bondType: "SIDE_STORY"` 的附加盟约；本包没有用到它）。数据与素材走创意工坊叠加层，
官方 `data/*.json` 不被直接改动——对官方棋子的修改一律通过 `pack.json.overrides` 声明。

> 一句话：**盟约、干员、装备、召唤物全是数据；凡是「改客户端/服务端框架」的部分（装备格、已继承数据、装备吸收）都落在本包的
> `server.meta` / `server.battle` 两个模块里，靠引擎已开放的通用能力接进去。**

---

## 0. 概览

| 类别 | 数量 | 说明 |
|---|---|---|
| `content.bonds` | 1 | `columbiaShip`（核心盟约，`bondType: "SEASON"`） |
| `content.chess` | 20 | 新增 8 名干员 ×（普通 `_a` + 精锐 `_b`）= 16 条，+ override 官方 id 4 条（松果 / 溯光星源，各 `_a` / `_b`） |
| `content.garrisons` | 20 | 每名干员 2 条（卡夫卡普通 / 精锐各带「战斗中 + 休整期」两条） |
| `content.items` | 8 | 源石辅助仪 / 沙盘·α / 沙盘·β / 同行者，各普通 + 精锐 |
| `content.effects` | 10 | 2 条盟约 / 策略效果 + 8 条装备效果（每件普通 + 精锐） |
| `content.tokens` | 5 | 机动盾牌 / “质检专员” / “监工专员” / “应急承重小组” / 中继器 |
| `content.bands` | 1 | `band_columbia`（谬因；效果「混沌本质」） |
| `overrides` | 4 | `chess:chess_char_3_10_a/b`、`chess:chess_char_6_16_a/b` |
| `art.chars` | 4 | 直接干员立绘 / Spine：星极 / 锡兰 / 卡夫卡 / 刻刀 |
| `art.skills` | 8 | 4 名干员 × 2 个技能图标 |
| `bondIcons` | 1 | `columbiaShip` |
| `itemIcons` | 4 | 源石辅助仪 / 沙盘·α / 沙盘·β / 同行者 |
| `skins` | 4 | 4 套时装（`epoque-astesi` / `summer-ceylon` / `snow-kafka` / `marthe-cutter`） |
| 服务端模块 | 2 | `server.battle` = `battle/main.mjs`；`server.meta` = `meta/main.mjs` |
| 客户端面板 | 0 | 本包**不含**任何 `client.panels`（无客户端 UI 扩展） |
| 包内 kit | 4 | `kits/chess_ws_col_{aphris,nasti,jesca,heyak}_a.js`（复用官方 `@ops/` kit） |
| 文件总数 | 100 | 8 个数据文件 + 2 个服务端模块 + 4 个 kit + 86 个素材 |

---

## 1. 盟约（bonds.json）

| 字段 | 值 |
|---|---|
| id / `bondId` | `columbiaShip` |
| `name` | 哥伦比亚 |
| `identifier` | 31（决定盟约在数据里的排序） |
| `bondOrder` | 2 |
| `isCore` | `true`（核心盟约） |
| `bondType` | `"SEASON"` |
| `powerIdList` | `["columbia"]` |
| `iconId` | `icon_columbiaShip`（素材键，见 §6） |
| `activeCount` | 3（3 人激活） |
| `thresholds` | `[3, 6]`（3 人档 / 6 人档） |
| `thresholdTemplate` | `count_threshold_upward` |
| `countMode` | `BOARD`（按场上计数） |
| `countsHand` | `false` |
| `activeType` | `BATTLE` |
| `weight` | 10 |
| `effectId` | `bondeffect_columbia` |
| `members` / `visibleMembers` | 各 11 条（见下） |

**各档效果**（`desc` / `effectDesc`）：

| 档位 | 条件 | 效果 |
|---|---|---|
| 3 人 | 场上 3 名不同【哥伦比亚】干员 | ① 场上的【哥伦比亚】干员**视为额外携带 1 件装备**（受层数影响，每 50 层 +1）；② **首次激活时**获得 1 件**源石辅助仪**；③ **战斗开始时**每名【哥伦比亚】干员获得 `携带装备数量 × (20% + 0.1%·层)` 的攻击力 |
| 6 人 | 场上 6 名不同【哥伦比亚】干员 | 第一部分同款之外：**首次激活时**再获得 1 件**源石辅助仪**；**进入休整期时**获得 1 件**随机阶级的进阶装备** |

**层数轴怎么涨**：盟约层数本身走引擎的通用核心盟约机制（`bb` 里 `atk_per_item 0.2` / `atk_per_item_per 0.001` 是「每层」的百分比增量），
并由**干员特质**额外加层 —— 涤火杰西卡（休整期结束按携带装备数 ×3/×6）、锡兰（开技能时自身与身前一格 +2/+4，最多 4 次）、
星极（开技能时自身周围八格 +4/+8，最多 2 次）、卡夫卡（部署时 +2/+4）、刻刀（战斗开始时自身盟约 +1/+2）。两条衍生量：

- `extraCarried = extra_carry(1) + floor(层数 / extra_carry_per_layer(50))`（软数值层、非真实格位）
- `atkPerItem = atk_per_item(0.2) + atk_per_item_per(0.001) × 层数`

**盟约黑板（`bb` / `buffs[0].bb`，键 `env_gbuff_new`）**：`power_bond_char_cnt 3`、`ex_bond_char_cnt 6`、`atk_per_item 0.2`、
`atk_per_item_per 0.001`、`extra_carry 1`、`extra_carry_per_layer 50`、`item_id "chess_item_6_13_e_a"`、`golden_item_max_tier "shop"`。

**成员（11 条）**：`chess_char_3_10_a`（松果）、`chess_char_3_22_a`（黑）、`chess_char_6_16_a`（溯光星源）、
`chess_ws_col_aphris_a`（谬因）、`chess_ws_col_astesia_a`（星极）、`chess_ws_col_ceylon_a`（锡兰）、`chess_ws_col_cutter_a`（刻刀）、
`chess_ws_col_heyak_a`（霍尔海雅）、`chess_ws_col_jesca_a`（涤火杰西卡）、`chess_ws_col_kafka_a`（卡夫卡）、`chess_ws_col_nasti_a`（娜斯提）。
（`visibleMembers` 与 `members` 逐条相同。）

### 1.1 覆盖的官方盟约名册（附加盟约）

本包另外为两条**附加盟约**写了最小覆盖记录（只有 `bondId` + `members` + `visibleMembers`），把本包的干员并进它们的名册，
让这些 mod 干员在自身拥有的盟约里也能被看到（否则只在本包核心盟约里显示）：

| 官方盟约 | 加入的 mod 干员（`_a`） |
|---|---|
| `swiftShip`（迅捷） | `chess_ws_col_astesia_a`（星极）、`chess_ws_col_cutter_a`（刻刀）、`chess_ws_dos_takila_a`（龙舌兰） |
| `raidShip`（突袭） | `chess_ws_col_kafka_a`（卡夫卡） |

> 合并语义：引擎对 `members` / `visibleMembers` **求并集**（`shared/workshop.js` 的 `OVERRIDE_UNION_LISTS`），
> 所以只写自己那几位即可、官方名单一条不丢；但**一条盟约只认一个包**（`PACK_ID_COLLISION`），一条官方盟约的
> mod 干员须由这条盟约的**唯一主人**一起列（本包是【迅捷】【突袭】的主人）。

---

## 2. 干员（chess.json，20 条 = 新增 16 + override 4）

### 2.1 本包新增干员（16 条 = 8 名 × 普通 / 精锐）

普通（`_a`，`isGolden: false`）与精锐（`_b`，`isGolden: true`）成对：**精锐 = 同名干员的进阶形态**，`bonds` 相同、只有
`garrisonIds` 换成 `_b` 版本（数值更强）并带 `isGolden: true`。

| id（`_a` / `_b`） | 名字 | 阶级 | 职业 | 盟约 | 特质（garrison） |
|---|---|---|---|---|---|
| `chess_ws_col_aphris_a` / `_b` | 谬因 | 6 | CASTER | `columbiaShip` + `arcaneShip` | `garrison_col_aphris_a/_b`：战斗中每 N 层，自身装备基础数值 +0.1%；攻击速度 +5%/10% × 携带装备数 |
| `chess_ws_col_nasti_a` / `_b` | 娜斯提 | 5 | SUPPORT | `columbiaShip` + `deputShip` | `garrison_col_nasti_a/_b`：获得时获 1 件阶级等于调度中心的随机（进阶）装备 |
| `chess_ws_col_jesca_a` / `_b` | 涤火杰西卡 | 5 | TANK | `columbiaShip` + `steadShip` + `preciShip` | `garrison_col_jesca_a/_b`：休整期结束时按携带装备数给盟约 +3/+6 层 |
| `chess_ws_col_heyak_a` / `_b` | 霍尔海雅 | 4 | CASTER | `columbiaShip` + `miraShip` | `garrison_col_heyak_a/_b`：获得装备时额外获得 1 件阶级不超过该装备的随机（进阶）装备（每回合 1 次） |
| `chess_ws_col_astesia_a` / `_b` | 星极 | 4 | WARRIOR | `columbiaShip` + `swiftShip` | `garrison_col_astesia_a/_b`：战斗开始时自身与周围 8 格获 1/2 层护盾；开技能时使自身周围八格盟约 +4/+8 层（最多 2 次） |
| `chess_ws_col_ceylon_a` / `_b` | 锡兰 | 2 | MEDIC | `columbiaShip` + `deputShip` | `garrison_col_ceylon_a/_b`：开技能时自身与身前一格盟约 +2/+4 层（最多 4 次） |
| `chess_ws_col_kafka_a` / `_b` | 卡夫卡 | 2 | SPECIAL | `columbiaShip` + `raidShip` | `garrison_col_kafka_a/_b`（部署时盟约 +2/+4）+ `garrison_col_kafka_prep_a/_b`（无再部署则下个休整期得 1 件 1/2 阶装备） |
| `chess_ws_col_cutter_a` / `_b` | 刻刀 | 1 | WARRIOR | `columbiaShip` + `swiftShip` | `garrison_col_cutter_a/_b`：战斗开始时自身盟约 +1/+2 层（无需激活） |

**包内 kit**（`kits/<chessId>.js`，`import` 白名单 `@kit/ @sim/ @ops/`）：只有 4 名干员带包内 kit —— 它们**整体复用引擎自带的官方 op kit**，
把默认技能从 `skills` 映射提到顶层 `skill`：

| kit 文件 | 复用官方 kit | 对应干员 |
|---|---|---|
| `kits/chess_ws_col_aphris_a.js` | `@ops/op-aphris.js`（`char_4229_aphris`） | 谬因 |
| `kits/chess_ws_col_nasti_a.js` | `@ops/op-nasti.js`（`char_4212_nasti`） | 娜斯提 |
| `kits/chess_ws_col_jesca_a.js` | `@ops/op-jesca2.js`（`char_1034_jesca2`） | 涤火杰西卡 |
| `kits/chess_ws_col_heyak_a.js` | `@ops/op-heyak.js`（`char_4027_heyak`） | 霍尔海雅 |

其余 4 名（星极 / 锡兰 / 卡夫卡 / 刻刀）**没有包内 kit 文件**。

### 2.2 override 官方 id（4 条）

`pack.json.overrides` 声明 `chess:chess_char_3_10_a`、`chess:chess_char_3_10_b`、`chess:chess_char_6_16_a`、`chess:chess_char_6_16_b`；
`chess.json` 里对这 4 条**只写 `bonds` 一个字段**：

| 官方 id | 官方干员 | 官方原 `bonds` | 本包改为 | 改动的字段 |
|---|---|---|---|---|
| `chess_char_3_10_a` / `_b` | 松果（tier 3） | `["swiftShip","emptyShip"]` | `["swiftShip","emptyShip","columbiaShip"]` | 仅 `bonds` |
| `chess_char_6_16_a` / `_b` | 溯光星源（tier 6） | `["arcaneShip","skillfulShip"]` | `["arcaneShip","skillfulShip","columbiaShip"]` | 仅 `bonds` |

⚠ `bonds` 属于「整段替换」的键：官方盟约必须**连同哥伦比亚一起写全**，否则会把官方盟约整个抹掉。
另：黑（`chess_char_3_22_a`）也属于哥伦比亚盟约，但它由 `workshop/rimbilliton` 定义，**不在**本包 override 内。

---

## 3. 装备（items.json，8 条 = 4 件 × 普通 / 精锐）

`kind` 取值：`passive`（常驻被动）/ `consume_on_equip`（装备时销毁）。除「同行者」外均 `hideInShop: true`（不在商店直接售卖）。

| id（`_a` / `_b`） | 名字 | 阶级 | `kind` | 效果 | 效果 id（`_a` / `_b`） |
|---|---|---|---|---|---|
| `chess_item_6_13_e_a` / `_b` | 源石辅助仪 | 6 | passive | 装备格 **+2 / +4**；进入休整期时把携带者**其余装备**的效果与数值**继承**过来（可叠加）并**销毁**它们 | `eff_mod_col_pldevice` / `eff_modg_col_pldevice` |
| `chess_item_3_13_e_a` / `_b` | 沙盘·α | 3 | consume_on_equip | 装备时销毁，获得 **1 / 2** 位阶级等于调度中心的【哥伦比亚】干员 | `eff_mod_col_sandboxA` / `eff_modg_col_sandboxA` |
| `chess_item_3_14_e_a` / `_b` | 沙盘·β | 3 | consume_on_equip | 装备时销毁，获得 **2 / 4** 件阶级不超过调度中心的装备 | `eff_mod_col_sandboxB` / `eff_modg_col_sandboxB` |
| `chess_item_4_13_e_a` / `_b` | 同行者 | 4 | passive | 造成的伤害无视敌人 **10% / 20%** 防御力与法术抗性 | `eff_mod_col_fellow` / `eff_modg_col_fellow` |

其它字段：源石辅助仪 `price 3/5`、`upgradeChessId`（`_a`→`_b`，`upgradeNum 2`）；同行者 `giveBondId: "columbiaShip"`（配变形同构体使携带者视为盟约成员）。

### 3.1 重点：源石辅助仪（`chess_item_6_13_e`）是怎么落的

这是一件**数据 + 包内处理器**的复杂装备，**不是纯数据**：`params` 只声明参数，逻辑分别落在 `meta/main.mjs` 与 `battle/main.mjs`。

- **`params` / buff**（`env_gbuff_new_with_verify`，`bbStr.key: "mod_col_pldevice"`）：
  `slot_cap 2 / 4`、`inherit_ratio_per_layer 0.025 / 0.05`、`ratio_bond "columbiaShip"`、`inherited_key "columbia"`。
- **装备格 +2 / +4**（谁读 `slot_cap`）：引擎的 `app/shared/equipSlots.js` —— `容量 = 官方 2 + Σ(该干员携带装备的 params.slot_cap)`。
  服务端 `app/server/match/gamedata.js`、客户端 `app/public/js/ui/gameLogic/placement.js` / `detailPanel.js`、渲染 `app/public/js/render/units.js` 两端同源调用它。
- **「进入休整期时继承其余装备」**（`meta/main.mjs`，`registry.item('chess_item_6_13_e')` → `columbiaDevice()`）：
  - `onRoundStart`：遍历场 / 手牌 / 临时区的棋子，`absorbCarrier` 把携带者身上**除源石辅助仪与变形同构体以外的所有装备**的数值汇总
    （`NUM_KEYS`：`atk/def/hp/aspd/resFlat/redeploy/spRecovery/resIgnorePct/defIgnorePct/taunt`），可跨回合累加，写进棋子
    `piece.meta.data.columbia`（**两份**：装备自己的 `dev.uid` 与携带者的 `view.uid`），随后 `ctx.destroyPiece` 就地销毁被吸收的装备。
  - 被销毁装备里带 `giveBondId` 的盟约记进 `columbia.bondSources`；只要携带者**当前装备着变形同构体**（`chess_item_6_09_e`，`canGiveBond`），
    就经 `syncMorphGrants` 写进 `piece.meta.data.bondGrants`（引擎当作变形同构体的授予计数）。
  - `onEquip`：装备换人 / 出售回整备区后再装上时，把装备自己那份记录镜像到新携带者（效果不丢）。
  - `onDestroy`：装备被第 3 件顶替 / 销毁时，清掉携带者的已继承数值与盟约授予（进阶合成走 `_mergeItem` 不派发 `onDestroy`，故进阶后保留继承）。
- **战斗侧**（`battle/main.mjs`，`registerItemBehaviour('mod_col_pldevice', …)`）：读 `u.pieceData.columbia.mods`，按
  `1 + inherit_ratio_per_layer × 哥伦比亚层数` 缩放后挂到携带者身上（层数变化 `onLayers` 重算）；**正面数值吃加成，负面数值原样继承**。
- **变形同构体**（官方 id `chess_item_6_09_e`，本包不定义、只注册处理器 `morphItem()`）：装备状态一变就重算源石辅助仪继承来的盟约授予。
- **客户端展示**：装备卡列出「已继承的装备」，靠 `item.params.inherited_key === "columbia"` 从棋子视图的 `piece.itemData.columbia.items` 读
  （见 §8 `app/server/match/player/views.js` + `app/public/js/ui/detailPanel.js`）。

---

## 4. 策略（bands）/ 召唤物（tokens）/ 效果（effects）

### 4.1 策略（bands.json，1 条）

| id | 名字 | `effectId` | `effectName` | 效果 | 备注 |
|---|---|---|---|---|---|
| `band_columbia` | 谬因 | `aceffect_band_columbia` | 混沌本质 | 【哥伦比亚】盟约层**每叠加 50 层**时获得 1 件**沙盘·α** 和 1 件**沙盘·β**（可重复触发） | `sortId 43`、`iconId icon_columbia_hundun`、`totalHp 24`、`modeTypeList [SINGLE, MULTI]`、`bondIds ["columbiaShip"]`；`params.items` = 两件沙盘 |

### 4.2 召唤物（tokens.json，5 条）

| id | 名字 | `kind` | 所属干员 |
|---|---|---|---|
| `token_10032_jesca2_jckshd` | 机动盾牌 | summon | 涤火杰西卡（`chess_ws_col_jesca_a/_b`） |
| `token_10059_nasti_nstdef` | “质检专员” | summon | 娜斯提（`chess_ws_col_nasti_a/_b`） |
| `token_10060_nasti_nstchr` | “监工专员” | summon | 娜斯提 |
| `token_10061_nasti_nstbld` | “应急承重小组” | summon | 娜斯提 |
| `token_10070_aphris_pc` | 中继器 | summon | 谬因（`chess_ws_col_aphris_a/_b`） |

### 4.3 效果（effects.json，10 条）

| id | 名字 | `effectType` | 说明 |
|---|---|---|---|
| `bondeffect_columbia` | 哥伦比亚 | BOND | 盟约本体效果（额外携带装备 / 战斗开始攻击力 / 6 人发随机阶级进阶装备） |
| `aceffect_band_columbia` | 混沌本质 | BAND_INITIAL | 策略本体：盟约每 50 层获沙盘·α + β |
| `eff_mod_col_pldevice` / `eff_modg_col_pldevice` | 源石辅助仪 | EQUIP | 普通 +2 / 精锐 +4，继承比例 2.5% / 5% |
| `eff_mod_col_sandboxA` / `eff_modg_col_sandboxA` | 沙盘·α | EQUIP | 装备时销毁，发 1 / 2 位哥伦比亚干员 |
| `eff_mod_col_sandboxB` / `eff_modg_col_sandboxB` | 沙盘·β | EQUIP | 装备时销毁，发 2 / 4 件装备 |
| `eff_mod_col_fellow` / `eff_modg_col_fellow` | 同行者 | EQUIP | 无视 10% / 20% 防御与法抗 |

---

## 5. 干员特质（garrisons.json，20 条）

逐条 `effectKey` / 触发时机（`eventType`）。每名干员普通（`_a`）/ 精锐（`_b`）各一条（卡夫卡多一条「休整期」特质）。

| id | `effectKey` | `eventType` | 效果（`bb` 要点） |
|---|---|---|---|
| `garrison_col_aphris_a` | `COL_EQUIP_BASE_BY_BOND_LAYER` | IN_BATTLE | 战斗中，每 10 层使自身携带装备基础数值 +0.1%；攻击速度 +5% × 携带装备数（`divide_num 10, add 0.001, aspd_per_item 0.05`） |
| `garrison_col_aphris_b` | `COL_EQUIP_BASE_BY_BOND_LAYER` | IN_BATTLE | 同上，每 5 层 +0.1%；攻击速度 +10% × 携带装备数（`divide_num 5, aspd_per_item 0.1`） |
| `garrison_col_nasti_a` | `COL_GAIN_RANDOM_EQUIP` | SERVER_GAIN | 获得时，获得 1 件阶级等于调度中心的随机装备（`count 1, golden false`） |
| `garrison_col_nasti_b` | `COL_GAIN_RANDOM_EQUIP` | SERVER_GAIN | 同上，改为**随机进阶装备**（`golden true`） |
| `garrison_col_jesca_a` | `COL_ADD_BOND_BY_EQUIP_COUNT` | SERVER_PREP_FIN | 休整期结束时，自身每携带 1 件装备使【哥伦比亚】+3 层（`count 3, bond columbiaShip`） |
| `garrison_col_jesca_b` | `COL_ADD_BOND_BY_EQUIP_COUNT` | SERVER_PREP_FIN | 同上，+6 层（`count 6`） |
| `garrison_col_heyak_a` | `COL_GAIN_FRONT_EQUIP` | SERVER_GAIN_ITEM | 获得装备时，额外获得 1 件阶级不超过该装备的随机装备（每回合 1 次，`count 1`） |
| `garrison_col_heyak_b` | `COL_GAIN_FRONT_EQUIP` | SERVER_GAIN_ITEM | 同上，改为随机**进阶**装备（`golden true`） |
| `garrison_col_shwaz_a` | `SERVER_ADD_BOND_CHESS_ALL` | SERVER_GAIN | 获得时，自身所属盟约 +3 层（无需激活，`count 3`）；owner 为 `chess_char_3_22_a`（黑）|
| `garrison_col_shwaz_b` | `SERVER_ADD_BOND_CHESS_ALL` | SERVER_GAIN | 同上，+6 层（`count 6`）；owner `chess_char_3_22_b` |
| `garrison_col_astesia_a` | `COL_SHIELD_AND_SKILL_LAYER` | IN_BATTLE | 战斗开始时自身与周围 8 格获 1 层护盾（哥伦比亚每 20 层 +1）；开技能时使自身周围八格盟约 +4 层（最多 2 次）（`shield 1, shield_div 20, layer 4, max 2`） |
| `garrison_col_astesia_b` | `COL_SHIELD_AND_SKILL_LAYER` | IN_BATTLE | 同上，2 层护盾 / 每 10 层 +1；开技能 +8 层（最多 2 次）（`shield 2, shield_div 10, layer 8, max 2`） |
| `garrison_col_ceylon_a` | `COL_SKILL_SELF_FRONT_LAYER` | IN_BATTLE | 开技能时，使自身与身前一格盟约 +2 层（最多 4 次）（`count 2, max 4`） |
| `garrison_col_ceylon_b` | `COL_SKILL_SELF_FRONT_LAYER` | IN_BATTLE | 同上，+4 层（最多 4 次）（`count 4, max 4`） |
| `garrison_col_kafka_a` | `COL_DEPLOY_LAYER_NOREDEPLOY_EQUIP` | IN_BATTLE | 部署时【哥伦比亚】+2 层；若未陷入再部署，下个休整期获 1 件 1 阶装备（`layer 2, item_tier 1`） |
| `garrison_col_kafka_b` | `COL_DEPLOY_LAYER_NOREDEPLOY_EQUIP` | IN_BATTLE | 同上，+4 层 / 2 阶装备（`layer 4, item_tier 2`） |
| `garrison_col_kafka_prep_a` | `COL_KAFKA_PREP_EQUIP` | SERVER_PREP_START | 读战斗侧标记 `equipTier`，发放对应阶数装备（`bb {}`） |
| `garrison_col_kafka_prep_b` | `COL_KAFKA_PREP_EQUIP` | SERVER_PREP_START | 同上（`bb {}`） |
| `garrison_col_cutter_a` | `COL_START_OWN_BOND_NOACT` | IN_BATTLE | 战斗开始时自身所属盟约 +1 层（无需激活，`count 1`） |
| `garrison_col_cutter_b` | `COL_START_OWN_BOND_NOACT` | IN_BATTLE | 同上，+2 层（`count 2`） |

---

## 6. 服务端逻辑

`pack.json` 声明 `server.battle.module = "battle/main.mjs"`、`server.meta.module = "meta/main.mjs"`（均需 `combat: true`）。

### 6.1 `server.meta`（`meta/main.mjs`）注册的 10 个键（`server.meta.registers`）

| register 键 | 处理器 | 作用 |
|---|---|---|
| `bond:columbiaShip` | `columbiaBondPrep()` | 盟约休整期侧：3 人 / 6 人档各发 1 件源石辅助仪（`onBondChange` + counter 幂等）；6 人档每回合（`onRoundStart`）发 1 件随机阶级的**进阶**装备 |
| `band:band_columbia` | `columbiaBand()` | 策略混沌本质：`onLayers` 记「每 50 层」步长（`floor(to/step) − floor(from/step)`），每次跨过里程碑发 1 件沙盘·α + 1 件沙盘·β（可重复触发） |
| `item:chess_item_3_13_e` | `sandboxAlpha()` | 沙盘·α `onEquip`：发 `count` 位阶级 = 调度中心的【哥伦比亚】干员（精确阶级优先，池空回退 ≤） |
| `item:chess_item_3_14_e` | `sandboxBeta()` | 沙盘·β `onEquip`：发 `count` 件 ≤ 调度中心的装备 |
| `item:chess_item_6_09_e` | `morphItem()` | 官方**变形同构体**：装备状态变化（`onEquip` / `onDestroy`）时重算源石辅助仪继承来的盟约授予 |
| `item:chess_item_6_13_e` | `columbiaDevice()` | **源石辅助仪**：`onRoundStart` 吸收其余装备、`onEquip` 镜像继承、`onDestroy` 清继承（见 §3.1） |
| `garrison:COL_GAIN_RANDOM_EQUIP` | `nastiGainEquip()` | 娜斯提「获得时」发随机（进阶）装备 |
| `garrison:COL_ADD_BOND_BY_EQUIP_COUNT` | `jescaBondByEquipCount()` | 涤火杰西卡「休整期结束」按携带装备数加盟约层 |
| `garrison:COL_GAIN_FRONT_EQUIP` | `heyakGainEquip()` | 霍尔海雅「获得装备时」（`onGainItem`，引擎扩展 `SERVER_GAIN_ITEM`）额外获得 1 件 ≤ 该装备（`pieceCounter` 每回合 1 次） |
| `garrison:COL_KAFKA_PREP_EQUIP` | `kafkaPrepEquip()` | 卡夫卡「休整期」读 `equipTier` 标记发装备 |

> 说明：`registers` 列的是**休整期侧**（`server.meta`）通报的键；`chess_item_6_09_e`（变形同构体）本身是官方数据，本包只是**占用它的注册键**
> （官方数据里该装备 `buffs` 为空，引擎不会自作主张注册，故不冲突）。

### 6.2 `server.battle`（`battle/main.mjs`）注册的内容

模块顶层一次性注册（`install()` 为空，无每场逻辑）：

| 钩子 | 注册对象 | 作用 |
|---|---|---|
| `registerBondInstaller(BOND, installColumbia)` | `columbiaShip` | <战斗开始时> 每名【哥伦比亚】干员获 `(实际装备数 + extra_carry) × (atk_per_item + atk_per_item_per·层)` 攻击力；`onLayers` 重算，`deploy` / `death` 时刷新 |
| `registerItemBehaviour('mod_col_fellow', …)` | 同行者 | 把 `def_penetrate` / `magic_resist_penetrate` 映射为引擎的 `defIgnorePct` / `resIgnorePct` |
| `registerItemBehaviour('mod_col_pldevice', …)` | 源石辅助仪 | 读 `u.pieceData.columbia.mods`，按 `1 + inherit_ratio_per_layer × 层` 缩放挂到携带者，`onLayers` 重算 |
| `registerGarrisonInstaller('COL_EQUIP_BASE_BY_BOND_LAYER', …)` | 谬因 | 战斗中每 N 层，携带装备基础数值 +0.1%；攻击速度 +`aspd_per_item`×件数（单位「点」） |
| `registerGarrisonInstaller('COL_SHIELD_AND_SKILL_LAYER', …)` | 星极 | 战斗开始加护盾 + 开技能加层（`addShieldLayer`） |
| `registerGarrisonInstaller('COL_SKILL_SELF_FRONT_LAYER', …)` | 锡兰 | 开技能时自身与身前一格加层 |
| `registerGarrisonInstaller('COL_DEPLOY_LAYER_NOREDEPLOY_EQUIP', …)` | 卡夫卡 | 部署加层 + `battleEnd` 用 `setBattleMark(…,'equipTier', …)` 把阶数传给休整期 |
| `registerGarrisonInstaller('COL_START_OWN_BOND_NOACT', …)` | 刻刀 | 战斗开始时自身盟约加层（无需激活） |

**用到的引擎通用能力 / 导入**：`@battle/mod.js` 的 `registerBondInstaller` / `onLayers` / `registerItemBehaviour` / `addShieldLayer` /
`registerGarrisonInstaller` / `setBattleMark` / `num`（以及 `S.*`：`bondLayers` / `bondMembers` / `directMods` / `buffsOf` / `itemsOf` /
`gainLayers` / `unitBonds` / `passiveBuff` / `alliesAround` / `frontTile` / `allyAt` / `onField` / `isOp` / `N8` 等）；`@sim/constants.js` 的 `FORCED_EXIT`。
meta 侧经 `registry.api`（`num` / `buffsOf`）与 `registry.bond` / `registry.band` / `registry.item` / `registry.garrison` 接入。

---

## 7. 素材（`assets/`）

`pack.json` 的 `art` / `bondIcons` / `itemIcons` / `skins` 声明的素材，全部落在 `assets/` 下（包内相对路径即 `assets/` 之后，如 `art/char_274_astesi/avatar.png`）。

| 类别 | 内容 |
|---|---|
| `art.chars`（4） | `char_274_astesi`（星极）/ `char_348_ceylon`（锡兰）/ `char_214_kafka`（卡夫卡）/ `char_301_cutter`（刻刀）：各含 `avatar`、`avatarE2`、`portrait`、`portraitE2` 与 `front` / `back` 两套 Spine（`.skel`+`.atlas`+`.png`） |
| `art.skills`（8） | `skchr_astesi_1/2`、`skchr_ceylon_1/2`、`skchr_kafka_1/2`、`skchr_cutter_1/2` |
| `art.bands`（1） | `band_columbia` → `band/band_columbia.png` |
| `bondIcons`（1） | `columbiaShip` → `bond/icon_columbiaShip.png` |
| `itemIcons`（4） | `trap_2100_mod_col_pldevice`（源石辅助仪）、`trap_2101_mod_col_sandboxA`（沙盘·α）、`trap_2102_mod_col_sandboxB`（沙盘·β）、`trap_2103_mod_col_fellow`（同行者） |
| `skins`（4） | `epoque-astesi`「奇工妙想」/ `char_274_astesi`（时代）；`summer-ceylon`「悠然假日 HD49」/ `char_348_ceylon`（珊瑚海岸）；`snow-kafka`「纸板仙子」/ `char_214_kafka`（冰原信使）；`marthe-cutter`「拭刀」/ `char_301_cutter`（玛尔特） |
| `voices` / `voiceLangs` | 无（本包未声明语音） |

> `art.chars` / `skins` 的 Spine 动作映射（`anims`）已由项目 Spine 管线（`tools/assets/skel.mjs` + `tools/assets/anim-roles.mjs`）
> 对真实 `.skel` 重算：卡夫卡 / 刻刀 补上了按技能槽的 `anims.skills`（原来只写 `skill`，S2/S3 会复用 S1 片段）。
> 星极 / 锡兰 的官方小人（本体与「奇工妙想」「悠然假日 HD49」时装）本身没有技能片段（`["Attack","Default","Die","Idle","Start"]`，
> 与 PRTS 模型查看器一致），`skill` 维持官方回退（借攻击片段）。

**落盘目录约定**（均在 `assets/` 下）：干员立绘 `art/<charId>/{avatar.png,avatar_2.png,portrait_1.png,portrait_2.png,front/,back/}`；
技能图标 `art/skill/<skillId>.png`；策略图标 `band/<bandId>.png`；盟约图标 `bond/icon_<bondId>.png`；装备图标 `item/<trapId>.png`；
时装 `skin/op/<charId>/{avatar.png,portrait.png,front/,back/}`。

---

## 8. 引擎侧需要的支持

本包「加东西」不只在包内：它依赖（且部分文件里能看到为本包而立的）以下引擎能力。路径均为**相对仓库根**。

| 引擎文件 | 本包用它做什么 |
|---|---|
| `app/shared/equipSlots.js` | **装备格容量**的唯一扩展点：`params.slot_cap` 求和（源石辅助仪 +2/+4）。文件头注释即点名「哥伦比亚 mod 的源石辅助仪」 |
| `app/server/match/gamedata.js` | 服务端读 `equipCapacity()`（`import { equipCapacity } from '../../shared/equipSlots.js'`）算携带者装备格上限 |
| `app/public/js/ui/gameLogic/placement.js` | 客户端同一份 `equipCapacity`（拖装备时判断能否装下，含「满格也能装源石辅助仪」） |
| `app/public/js/ui/detailPanel.js` | 装备卡：装备格上限（`equipCapacity`）+ 读 `item.params.inherited_key`（`columbia`）列出「已继承的装备」 |
| `app/public/js/render/units.js` | 场上单位装备点位按 `params.slot_cap` 最多画到 6 个（源石辅助仪进阶 +4） |
| `app/server/match/player/views.js` | `itemData`：按装备声明的 `item.params.inherited_key`（例 `'columbia'`）把 `piece.meta.data[<键>]` 下发给客户端；无装备声明时逐字节不变 |
| `app/shared/kitImports.js` | kit / 战斗模块 import 白名单：为本包开放 `@ops/op-aphris.js`、`@ops/op-nasti.js`、`@ops/op-jesca2.js`、`@ops/op-heyak.js`（注释：「哥伦比亚 mod: 谬因 / 娜斯提 / 涤火杰西卡 / 霍尔海雅」） |
| `app/public/js/ui/richText.js` | 盟约卡的效果文本占位符 `formatBondEffect`：为本包加了 `effectDescParams[].perStep`（「每 50 层 **+1**」这类**计数**显示——本来只会渲染 `base + perStack × 层`，所以「视为额外携带的件数」永远是 1）。与 `battle/main.mjs` 的 `extraCarry` 用同一条 floor，卡面与战斗数值同源 |
| `app/server/match/effectsMeta.js` + `app/server/match/player/acquire.js` | **获得装备时**（`SERVER_GAIN_ITEM` → `onGainItem`）钩子：`acquire.js` 在 `acquireItem` 末尾派发，`effectsMeta.js` 的 `GARRISON_HOOK` / `_garrisons` 白名单按休整期钩子的方式遍历场上/整备区（装备本身不是棋子，`onGain` 只喂给获得的那枚棋子），供霍尔海雅「获得装备时」特质接入 |
| `app/test/match/columbia-device.test.js` | 源石辅助仪的装备格 / 吸收 / 替换路径测试 |
| `app/test/match/equipCapacity.test.js` | `shared/equipSlots.js` 装备格容量测试 |

**依赖的引擎通用能力（非本包专属）**：`server.meta` 的 `registry.bond / band / item / garrison`；`server.battle` 的
`registerBondInstaller` / `registerItemBehaviour` / `registerGarrisonInstaller` / `onLayers` / `setBattleMark`；
`ctx` 侧 `setPieceData` / `pieceData` / `destroyPiece` / `grantItem` / `grantChess` / `rollItem` / `rollChess` / `addLayers` / `shopLevel` / `rng` 等。
（`git log` 该仓库仅有单个快照提交，无法据提交历史逐条归属，以上按文件内注释与代码调用点核定。）

---

## 9. 文件清单

```
workshop/columbia/
├── pack.json                    # 包声明：content / overrides / art / bondIcons / itemIcons / skins / server
├── bonds.json                   # 1 条盟约 columbiaShip
├── chess.json                   # 20 条棋子（16 新增 + 4 override 官方 id）
├── garrisons.json               # 20 条干员特质
├── items.json                   # 8 件装备（4 件 × 普通/精锐）
├── effects.json                 # 10 条效果
├── tokens.json                  # 5 个召唤物
├── bands.json                   # 1 个策略 band_columbia
├── meta/main.mjs                # server.meta：盟约 / 策略 / 装备 / 休整期特质
├── battle/main.mjs              # server.battle：盟约战斗侧 / 装备行为 / 战斗特质
├── kits/
│   ├── chess_ws_col_aphris_a.js # 谬因（复用 @ops/op-aphris.js）
│   ├── chess_ws_col_nasti_a.js  # 娜斯提（复用 @ops/op-nasti.js）
│   ├── chess_ws_col_jesca_a.js  # 涤火杰西卡（复用 @ops/op-jesca2.js）
│   └── chess_ws_col_heyak_a.js  # 霍尔海雅（复用 @ops/op-heyak.js）
└── assets/
    ├── art/<charId>/…           # 4 名干员的立绘 / Spine（char_274_astesi / char_348_ceylon / char_214_kafka / char_301_cutter）
    ├── art/skill/…              # 8 个技能图标
    ├── band/band_columbia.png   # 策略图标
    ├── bond/icon_columbiaShip.png
    ├── item/…                   # 4 个装备图标
    └── skin/op/<charId>/…       # 4 套时装
```
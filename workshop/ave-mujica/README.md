# 颂乐人偶（Ave Mujica）— 内容与引擎扩展点清单

本包 `workshop/ave-mujica/` 是一个**完整的自走棋（卫戍协议）内容包**，而不是前置接口包：它带来一条
**核心盟约**「颂乐人偶（`aveMujica`）」、**5 名成员干员**（丰川祥子 / 三角初华 / 祐天寺若麦 / 八幡海铃 / 若叶睦，
每位含普通与精锐两版，共 10 条棋子）、每位成员的**专属特质（garrison）**、一个团队爆发机制 **Fever**，
以及一条策略「无忧梦呓」与配套美术/语音/时装。它把原来住在引擎 `server/sim/mod/ave-mujica/` 下的 mod 专属代码
**整体搬进了包内**（`battle/main.mjs` + `meta/main.mjs`），因此引擎不再含任何本 mod 的专属逻辑。

玩起来：集齐 5 名成员把盟约铺满 5 层，成员不断用普通攻击给团队 Fever 充能，满 450 触发 20 秒 Fever 状态，
期间成员近乎无视技力持续开技能；5 人成型时「所有效果翻倍」——攻速/停顿/凋亡损伤/资金/部署位全面拉满。

- `gameVersion`：**0.2.6**（`pack.json`）。
- **前置依赖：无。** 它的盟约 `bondType` 是 **`SEASON`**、`isCore: true`，是**核心盟约**（不是 `SIDE_STORY`），
  既不需要也不走 `workshop/side-story` 的那套接口。与 `workshop/rimbilliton`（雷姆必拓）**兼容**：若叶睦同时带
  `rimBilliton` 盟约，两包各自把自己那条盟约算进 5 人判定，互不覆盖（本包 `overrides` 为空）。
- **素材授权**：`pack.json.license` 为 **`GPL-3.0-or-later`**；包含头像/立绘/Spine/技能图/时装/语音等大量素材
  （`assets/` 共 167 个文件），分发与再创作前请留意该授权。

---

## 0. 概览表

| 面 | 项 | 数量 / 值 |
|---|---|---|
| 数据 `content` | `bonds` | 1（`aveMujica`） |
| | `chess` | 10（5 名成员 × 普通/精锐） |
| | `garrisons` | 10（`180/181/182/183/164` 各 `_a`/`_b`） |
| | `bands` | 1（`band_wuyouyoumeng`） |
| | `effects` | 1（`aceffect_band_wuyouyoumeng`） |
| 素材 `art` | `chars` | 5（`char_4182_oblvns` / `_4183_mortis` / `_4184_dolris` / `_4185_amoris` / `_4186_tmoris`） |
| | `skills` | 11 |
| | `bonds` | 1（`aveMujica` → `bond/icon_aveMujica.png`） |
| | `bands` | 1（`band_wuyouyoumeng` → `band/band_wuyouyoumeng.png`） |
| `bondIcons` / `itemIcons` | 无（本包用 `art.bonds` / `art.bands` 两家扁平表，未用顶层 `bondIcons`/`itemIcons`） |
| `skins` | 5（每名成员 1 套） |
| `voices` | 5 名 charId（`assets/voice/jp/<charId>/`，共 70 个 mp3） |
| 服务端模块 | `server.battle` | `battle/main.mjs`（`combat: true`） |
| | `server.meta` | `meta/main.mjs` |
| 客户端面板 | `client` | **无**（本包无 `ui/`、无面板、无数据表声明） |
| 行为层 | `kits/` | 5 个（每名成员一个 `<chessId>_a.js`） |
| 文件数 | 合计 | **180**（`assets` 167 / 数据 json 5 / `kits` 5 / `battle` 1 / `meta` 1 / `pack.json` 1） |

---

## 1. 盟约

| 字段 | 值 |
|---|---|
| `bondId` / `name` | `aveMujica` / 颂乐人偶 |
| `isCore` / `bondType` | **真 / `SEASON`** —— **核心盟约**（不是附加、不是 `SIDE_STORY`） |
| `identifier` / `bondOrder` | 30 / 20 |
| `activeCount` | 1（只需 1 名成员即激活） |
| `thresholds` | `[1, 2, 3, 4, 5]`（人数阈值逐档向上） |
| `thresholdTemplate` / `countMode` / `activeType` | `count_threshold_upward` / `BOARD` / `BATTLE` |
| `weight` | 10 |
| `members` / `visibleMembers` | 5（本包 5 名成员的**普通版** chessId） |
| 效果图 | `bond/icon_aveMujica.png`（经 `art.bonds`） |

### 1.1 人数阈值与每档效果（`desc`，由 `meta/main.mjs` 的 `bond:aveMujica` 逐档实现）

| 档 | 需要的成员数 | 效果 |
|---|---|---|
| 1 | 1 | 每刷新 **9** 次，获得 1 名阶级不超过调度中心的随机【颂乐人偶】干员（5 人时每 4 次） |
| 2 | 2 | **休整期结束时**，场上每有 1 名**不重复的**成员，使**所有已激活盟约**层数 +1（5 人时 +2） |
| 3 | 3 | 成员获得特质「进入休整期时额外获得 **1** 资金」，该效果最多生效 **2** 名成员 |
| 4 | 4 | 可部署干员数量上限 **+1**（5 人时 +2） |
| 5 | 5 | 【颂乐人偶】**所有效果翻倍**（`dblOf = tier>=5 ? 2 : 1`） |

### 1.2 盟约自带的 5 名成员战斗效果（黑板 `bb`，由 `battle/main.mjs` 的 installer 实现）

| 成员 | 效果 | 取值（`base` + `per_stack`×层数，5 人再 ×2） |
|---|---|---|
| 祐天寺若麦 Amoris | 成员**攻击力**提升 | `amoris_atk 0.25` + `amoris_atk_per 0.001`/层 |
| 八幡海铃 Timoris | 成员攻击命中时概率**停顿** | `timoris_prob 0.2` + `timoris_prob_per 0.0005`/层，停顿 `timoris_dur 1` 秒 |
| 若叶睦 Mortis | 成员攻击附带**凋亡损伤** | `mortis_pct 0.1` + `mortis_pct_per 0.0005`/层 × 攻击力 |
| 三角初华 Doloris | 成员获得的 **Fever 翻倍** | `fever_ratio 2` |
| 丰川祥子 Oblivionis | **非成员**干员也获得上述三项效果的 10% | `obliv_share 0.1`（5 人再 ×2） |

> 其余黑板键：`refresh_every 9`、`prep_layer 1`、`prep_fund 1`、`deploy_slot 1`。数据侧另带 `spec.tiers` /
> `spec.formulas` / `spec.assumed`（简化假设），供人读与对账。

### 1.3 层数轴怎么涨

基础层数走引擎核心盟约的通用经济规则（战斗内累积 + 回合）；本包**另加**如下 +层来源（都在包内代码里）：

| 来源 | 触发 | 加多少 | 上限 | 在哪 |
|---|---|---|---|---|
| 盟约 2 人 tier | 休整期结束，每名在场成员 | `prep_layer 1`×成员数（×2 if 5 人） | — | `meta/main.mjs` `onPrepEnd` |
| 祥子 garrison `AVEMUJICA_FEVER_KILL` | 战斗内击倒敌人 | `kill_layers`（普通 1 / 精锐 2） | 全场 `max_count`（12 / 12） | `battle/main.mjs` |
| 初华 garrison `AVEMUJICA_EXTRA_TRIGGER` | 祥子的击倒特质触发且初华在场 | `partner_layers`（1 / 2） | **每场 1 次** | `battle/main.mjs` |
| 海铃 garrison `AVEMUJICA_REFRESH_LAYERS` | 休整期手动刷新商店 | `layers`（1 / 2） | 该干员每回合 `max_count`（6 / 6） | `meta/main.mjs` |
| 若叶睦 garrison `garrison_164` | 战斗内自身受到伤害 | `bond_add_count`（5 / 10） | `max_count`（2 / 4） | 引擎内置 handler（见 §6） |

>「使已激活盟约层数 +n」= 对玩家**所有已激活盟约**加层（同「蜜莓」官方写法，含颂乐人偶自身）。

### 1.4 覆盖的官方盟约名册（本包成员身上的盟约）

5 名成员除 `aveMujica` 外还各带一条**官方盟约**（见 §2 的 `bonds` 列）。为了让这些成员在**自身拥有的盟约**里也能被看到，
本包为其中 3 条写了最小覆盖记录（只有 `bondId` + `members` + `visibleMembers`）：

| 官方盟约 | 加入的成员（`_a`） |
|---|---|
| `skillfulShip`（绝技） | `chess_char_5_31_a`（祐天寺若麦）、`chess_ws_dos_lin_a`（林，定义在 dossoles） |
| `miraShip`（奇迹） | `chess_char_6_30_a`（丰川祥子）、`chess_ws_col_heyak_a`（霍尔海雅，定义在 columbia） |
| `soloShip`（独行） | `chess_char_5_32_a`（八幡海铃） |

> 其余三条成员盟约（`deputShip` 助力 / `siracusaShip` 叙拉古 / `indomShip` 不屈）由 **rimbilliton** 统一出头（那里已覆盖这些官方盟约）。
> 合并语义：`members` / `visibleMembers` 走**求并集**（`shared/workshop.js` 的 `OVERRIDE_UNION_LISTS`），只写自己那几位、官方名单不丢；
> 但**一条盟约只认一个包**（`PACK_ID_COLLISION`），所以一条官方盟约的 mod 干员只能由它的**唯一主人**一起列。

### 1.5 Fever 怎么攒、怎么触发（战斗侧，2026-10-13 逐条接线）

- **状态**：每场战斗一份**团队值**（上限 **450**），存在 `battleStore(battle,'avemujica:st')` 的 `{ fever, until }` 里（每场重新从 0 起）。
- **攒的来源**（都走同一个 `gainFever`，共用乘数「三角初华在场 ×`fever_ratio`，5 人再 ×2」）：
  - **基础填充**：任何**成员**每次普通攻击命中造成伤害 **+2**（丰川祥子在场时，**非成员**干员也按 `obliv_share` 计）。
  - **五位成员「毋畏X」特质各自的增量** —— 数值**逐条取自该干员 chess 记录里那条特质的 `bb`**（不写死在代码里）：
    | 干员 | 特质 | `bb` 键 | 触发 | 值 |
    |---|---|---|---|---|
    | 丰川祥子 | 毋畏遗忘 | `fever` | 对敌人造成**任何**伤害（普攻与技能） | 3 |
    | 三角初华 | 毋畏悲伤 | `fever` | **治疗**【颂乐人偶】成员时 | 5 |
    | 祐天寺若麦 | 毋畏爱意 | `fever_per_sec` | **在场时每秒** | 3 |
    | 八幡海铃 | 毋畏恐惧 | `fever` | **使敌人停顿**（Timoris 减速命中）时 | 2 |
    | 若叶睦 | 毋畏死亡 | `cnt` | **自身受到一次伤害或损伤**时 | 3 |
  - **祥子 `AVEMUJICA_FEVER_KILL`**：`<战斗开始时>` `fever += floor(盟约层数 × fever_ratio)`（普通 0.5 / 精锐 1）。
- **触发**：`fever ≥ 450` ⇒ 清零、进入 **20 s Fever 状态**（期间每 0.5 s 给在场成员大量 SP 回复，近似官方「无视技力持续放技能」），
  并打引擎内置的 `fever` 特效（品红团队光环，锚在**一名在场成员**身上）。触发后进度**同步清零**，客户端图标跟着重置。

### 1.6 成员特质的「另一半」（2026-10-14 补齐）

每位成员的「毋畏X」特质除 Fever 增量外还有后半段（数值同样**逐条取自该干员 `chess.json` 里那条 `bb`**），
全部由战斗侧盟约安装器 [`battle/main.mjs`](battle/main.mjs)（`installAveMujica`）实现，团队/成员判定都在那一处：

| 成员 | 特质 | `bb` 键 | 效果 | 实现 |
|---|---|---|---|---|
| 三角初华 Doloris | 毋畏悲伤 | `bonus_scale` | **攻击范围内**成员攻击时，附带「初华攻击力 × bonus_scale」的**法术**伤害 | 成员普攻钩子 `onDmg` + `S.inRange(初华, 攻击者)` |
| 八幡海铃 Timoris | 毋畏恐惧 | `dmg_up` | **在场时**，成员对处于**停顿 / 恐惧**的敌人造成的伤害 ×(1 + dmg_up) | 全局 `hit` 钩子：`dmg.mul *= 1 + dmg_up` |
| 若叶睦 Mortis | 毋畏死亡 | `max_hp` | **在场时**，**全体成员**生命上限 +max_hp | `bond:avemujica:hp`（`directMods({hp})`；deploy / death / layerGain / 每 0.5 s 刷新） |
| 丰川祥子 Oblivionis | 颂乐音符 | `def_pen` / `res_pen` / `max_stack` | 场上每存在 1 个**音符**，成员无视敌人 def_pen 防御 / res_pen 法抗（最多 max_stack 层） | `bond:avemujica:note` → `{ defIgnorePct, resIgnorePct }` |

- **音符计数**：引擎未建模「音符」实体，近似为**祥子每造成一次对敌伤害实例记 1 个音符**，音符存活 **3 s**
  【`[ASSUMED]`：数据无存活时长，取约 2 个攻击间隔（`stats.bat` 1.3 s）】后消失；层数 = `min(max_stack, 在场音符数)`。
  祥子 S1「依次演奏 8 个音符」会连续记 8 个 ⇒ 期间快速逼近 `max_stack=10`。
- **穿透键名**：`defIgnorePct` / `resIgnorePct` 是**源（攻击者）侧**统计量，引擎 `mitigate` 按百分比扣防御 / 法抗。
- **增伤键名**：`hit` 钩子在减伤结算前改写 `dmg.mul`；**生命上限**走 `hpPct`（`directMods`）。
- 若叶睦那处原本只把 `hpPct` 加在**自身**（kit 内 `[ASSUMED]`），现改为**对全体成员生效**——team 判定回到盟约安装器。

---


## 2. 干员

本包 `overrides` 为**空**——**没有 override 任何官方 id**，10 条棋子全部是**新增加**的。

| chessId | 名字 / 代号 | 阶级 | 职业 | 盟约（`bonds`） | 特质要点（`garrisonIds`） |
|---|---|---|---|---|---|
| `chess_char_6_30_a` | 丰川祥子 / Oblivionis | 6 | WARRIOR·领主 lord | `aveMujica`, `miraShip` | `garrison_180_a`：战斗开始获得 ½ 层数 Fever；击倒敌人 → 全员盟约层 +1（≤12 次） |
| `chess_char_6_30_b` | 丰川祥子（精锐） | 6 | 同上 | 同上 | `garrison_180_b`：开场获得**全部**层数 Fever；击倒 → +2（≤12 次）。模组 `LOR-Y` 激活（攻速 +12） |
| `chess_char_5_30_a` | 三角初华 / Doloris | 4 | SUPPORT·吟游者 bard | `aveMujica`, `deputShip` | `garrison_181_a`：成员特质触发额外 +1 次；源为祥子时全员盟约层 +1（每回合 1 次） |
| `chess_char_5_30_b` | 三角初华（精锐） | 4 | 同上 | 同上 | `garrison_181_b`：额外触发 +2、同伴加层 +2。模组 `BAR-X` 激活（3 名以上同格 → 攻击力 +8%） |
| `chess_char_5_32_a` | 八幡海铃 / Timoris | 3 | SPECIAL·伏击客 stalker | `aveMujica`, `siracusaShip`, `soloShip` | `garrison_182_a`：战斗中刷新时自身所属盟约层 +1（≤6 次） |
| `chess_char_5_32_b` | 八幡海铃（精锐） | 3 | 同上 | 同上 | `garrison_182_b`：刷新 +2（≤6 次）。模组 `AMB-Y` 激活（闪避 50%→65%） |
| `chess_char_5_31_a` | 祐天寺若麦 / Amoris | 2 | WARRIOR·撼地者 hammer | `aveMujica`, `skillfulShip` | `garrison_183_a`：进入休整期时成员 <3 → +1 资金；否则 1 次免费刷新 |
| `chess_char_5_31_b` | 祐天寺若麦（精锐） | 2 | 同上 | 同上 | `garrison_183_b`：资金 +2 / 免费刷新 2 次。模组 `HAM-X` 激活（溅射 ≥3 敌 → 当次攻击 ×115%） |
| `chess_char_5_25_a` | 若叶睦 / Mortis | 5 | SPECIAL·傀儡师 dollkeeper | `aveMujica`, `rimBilliton`, `indomShip` | `garrison_164_a`：战斗内受伤时自身盟约层 +5（≤2 次） |
| `chess_char_5_25_b` | 若叶睦（精锐） | 5 | 同上 | 同上 | `garrison_164_b`：受伤 +10（≤4 次）。模组 `PUM-Y` 激活 |

**普通与精锐的差别**：精锐（`*_b`）`isGolden: true`、等级 60 / 技能 7 级、基础面板更高、模组（`modules`）为
1 级并**激活**；对应 garrison 的数值翻倍（见 §3），技能组也换成 `skillIndex: 2` 的那一套。所有成员 `price 3~5`、
`visible: true`、`isHidden: false`、`isDiy: false`。

---

## 3. 策略（`bands`）与效果（`effects`）

### 3.1 策略

| 字段 | 值 |
|---|---|
| `bandId` / `name` | `band_wuyouyoumeng` / 丰川祥子 |
| `modeTypeList` | `SINGLE`, `MULTI` |
| `totalHp`（初始生命） / `victorCount` | 21 / 3 |
| `effectId` | `aceffect_band_wuyouyoumeng`（无忧梦呓） |
| `bondIds` | `aveMujica` |
| 效果 | 每回合**首次**获得 `<颂乐人偶>` 干员时，获得 **1 位阶级等于调度中心的随机干员**（`count 1`） |

实现：`meta/main.mjs` 的 `registry.band('band_wuyouyoumeng', { onGain })`——本回合已触发过则跳过（`ctx.counter === ctx.round`），
命中条件为 `piece.kind === 'chess'` 且其 `bonds` 含 `aveMujica`。

### 3.2 效果

| `effectId` | 名字 | `effectType` | 说明 |
|---|---|---|---|
| `aceffect_band_wuyouyoumeng` | 无忧梦呓 | `BAND_INITIAL` | 与策略同源的初始效果，键 `band_wuyouyoumeng_first_gain_bond_gain_random_char`，`bb.count 1`、`bbStr.bond aveMujica` |

> 本包**没有**单独的盟约效果条目（`bondeffect_avemujica` 未落盘为 `effects.json` 条目）——盟约效果由 `bonds.json`
> 的 `bb`/`buff` 与 `battle`/`meta` 两段代码共同承担。

---

## 4. 干员特质（`garrisons`）

逐条列出 `effectKey`（`garrisonIds` 里的那个串）、触发时机 `eventType` 与效果：

| garrisonId | 归属干员 | `effectType` | `eventType` | 效果（`bb`） |
|---|---|---|---|---|
| `garrison_180_a` | 丰川祥子 | `AVEMUJICA_FEVER_KILL` | `IN_BATTLE` | 战斗开始 Fever += 层数 × `fever_ratio 0.5`；击倒敌人 → 所有活跃盟约层 `+kill_layers 1`（`max_count 12`） |
| `garrison_180_b` | 丰川祥子（精锐） | `AVEMUJICA_FEVER_KILL` | `IN_BATTLE` | 开场 Fever += 层数 × `1`；击倒 → `+2`（`max_count 12`） |
| `garrison_181_a` | 三角初华 | `AVEMUJICA_EXTRA_TRIGGER` | `IN_BATTLE` | 成员特质触发额外 `+extra_trigger 1` 次；触发者为祥子（`bbStr.partner oblivionis`）时全员盟约 `+partner_layers 1`，每场 1 次 |
| `garrison_181_b` | 三角初华（精锐） | `AVEMUJICA_EXTRA_TRIGGER` | `IN_BATTLE` | 额外触发 `+2`、同伴加层 `+2` |
| `garrison_182_a` | 八幡海铃 | `AVEMUJICA_REFRESH_LAYERS` | `SERVER_REFRESH_SHOP` | 刷新时使自身所属已激活盟约 `+layers 1`（`max_count 6`） |
| `garrison_182_b` | 八幡海铃（精锐） | `AVEMUJICA_REFRESH_LAYERS` | `SERVER_REFRESH_SHOP` | `+2`（`max_count 6`） |
| `garrison_183_a` | 祐天寺若麦 | `AVEMUJICA_PREP_REWARD` | `SERVER_PREP_START` | 进入休整期成员 <`check_count 3` → +`fund 1` 资金；否则 免费刷新 `refresh 1` 次 |
| `garrison_183_b` | 祐天寺若麦（精锐） | `AVEMUJICA_PREP_REWARD` | `SERVER_PREP_START` | 资金 `+2` / 免费刷新 `2` 次 |
| `garrison_164_a` | 若叶睦 | `act_gar_event_onhurt_add_bond_layer`（`effectType: ADD_BOND`） | `IN_BATTLE` | 受到伤害时使**自身**所属盟约 `+bond_add_count 5`（`max_count 2`，`battleRuneKey: env_gbuff_new_with_verify`） |
| `garrison_164_b` | 若叶睦（精锐） | 同上 | `IN_BATTLE` | `+10`（`max_count 4`） |

> 说明：`eventType` 里 `SERVER_PREP_START` = 进入休整期（本轮开始）、`SERVER_REFRESH_SHOP` = 手动刷新商店、
> `IN_BATTLE` = 战场内持续叠加。`AVEMUJICA_*` 这 4 条由**本包注册**（见 §5）；`garrison_164` 用的是**引擎内置**
> 的「受伤加层」handler（键 `act_gar_event_onhurt_add_bond_layer`，走 `env_gbuff_new_with_verify` 战斗 buff 键），
> 本包不写代码、也**不在** `pack.json` 的 `registers` 里点名。

---

## 5. 服务端逻辑

### 5.1 `server.battle`（`battle/main.mjs`，`combat: true`）

模块顶层**一次性**完成注册（服务端与浏览器各加载一次，两端都会注册）；`install()` 为空，无每场逻辑。

| 注册调用 | 目标 | 作用 |
|---|---|---|
| `registerBondInstaller('aveMujica', installAveMujica)` | 盟约 installer | 5 名成员特质（Amoris ATK / Timoris 停顿 / Mortis 凋亡损伤 / Doloris Fever ×2 / Oblivionis 10% 共享）+ **Fever 状态机**（上限 450，满触发 20 s，期间每 0.5 s 给在场成员大量 SP 回复） |
| `registerGarrisonInstaller('AVEMUJICA_FEVER_KILL', …)` | 祥子 | 开场按层数注入 Fever；击倒敌人 → 全员盟约加层 + 初华连携 |
| `registerGarrisonInstaller('AVEMUJICA_EXTRA_TRIGGER', …)` | 初华 | 把「成员特质额外触发」做进 `battle._rbAmplifiers` 放大器列表 |

用到的引擎钩子 / 读法（均来自包侧 SDK `@battle/mod.js`）：
`registerBondInstaller`、`registerGarrisonInstaller`、`reached`、`onLayers`、`onUnitDamaged`、`isEnemyTarget`、
`ownTag`、`num`；以及 `battleStore`、`bondLayers`、`bondMembers`、`playerOps`、`player`、`passiveBuff`、`directMods`、
`gainLayers`、`garrisonRecord`、`onField`、`fxOn`；战场对象上的 `battle.on(...)` / `battle.every(...)` /
`addBuff` / `removeBuff` / `applyStatus` / `dealDamage` / `rng`。

### 5.2 `server.meta`（`meta/main.mjs`）

**逐条**列出 `pack.json.server.meta.registers` 的 4 个键并说明：

| 注册键 | 类型 | 作用 |
|---|---|---|
| `bond:aveMujica` | 盟约 tier | 5 档效果：`onRefresh` 每 9 次发随机成员 / `onPrepEnd` 按成员数给全盟约加层 / `onRoundStart` 每回合 ≤3 名成员各 +1 资金 / `onBondChange` 4 人时当帧 `addDeployCap` / 5 人翻倍 |
| `garrison:AVEMUJICA_REFRESH_LAYERS` | 特质（休整期） | 海铃刷新时给其所属盟约加层；用 `ctx.incPieceCounter(uid,'avemujica:refresh')` 做「每回合上限」计数 |
| `garrison:AVEMUJICA_PREP_REWARD` | 特质（休整期） | 若麦进入休整期：成员数 `<check_count` → `grantFreeRefresh`；否则 `addFunds` |
| `band:band_wuyouyoumeng` | 策略 | 无忧梦呓 `onGain`：每回合首次获得成员 → `rollChess` + `grantChess` 发一名随机干员 |

用到的引擎通用能力：`registry.api.{ num, bondOrder }`（meta 模块只许 import 本包文件与 `registry.api`，不许 import 引擎）；
`ctx` 读法 `bond` / `gd.bond` / `gd.chess` / `counter`·`setCounter` / `round` / `shopLevel` / `rollChess` / `grantChess` /
`grantFreeRefresh` / `addLayers` / `addFunds` / `addDeployCap` / `bondCount` / `bondActive` / `band` / `band.buffs` /
`source`（含 `source.piece`、`source.bb`）/ `incPieceCounter`。

> 对比：**战斗侧**的 `AVEMUJICA_FEVER_KILL` / `AVEMUJICA_EXTRA_TRIGGER` 用 `registerGarrisonInstaller` 在
> `battle/main.mjs` 注册，**不出现在** `pack.json.server.meta.registers`；`registers` 只列 meta 模块的注册键。

### 5.3 客户端面板（`client.panels`：`ui/fever.js` + `ui/fever.css`）

战场上的【颂乐人偶】干员身边那颗**连音符 Fever 进度图标**：**半透明黑底剪影 + 品红自下而上填充**，触发 Fever 后清零 ⇒ 图标同步清空。
图标的**两张素材由业主提供**（`assets/ui/fever_note_empty.png` / `fever_note_full.png`）—— 同一枚实心连音符剪影、同尺寸、**像素级对齐**：
空态是黑、`alpha=72/255`（≈28%，业主从 24/255 调亮的）的半透明底，满态是实心 `rgb(235,63,116)`。实现就是把**满态那张按 Fever 比例从下往上切一条**、
用 `overflow:hidden` 的壳（底部对齐）叠在空态上；再给整个图标上两层 `drop-shadow` 沿剪影投阴影（素材本身没有描边）。
**没有为本包新增任何引擎扩展点**，靠三样**通用**能力拼出来：

| 需要什么 | 从哪来 |
|---|---|
| 谁在场上 | 本包多声明一条 `game.hud.topBar` 的**组件改写**，把顶栏 props 的 `pub`/`priv`/`myId` 抄进面板（顶栏每帧都有最新一份）；再对照只读 `chess` 表筛出棋盘上 `bonds` 含 `aveMujica` 的棋子 |
| Fever 当前值 | 本包 `battle/main.mjs` 把 `{ fever, cap, on, until }` 写进模块级表 `FEVER_LIVE.byPid[pid]`；面板从 `battleRunner.currentBattle().spec.workshopBattle` 里取到**同 URL**（`/workshop-battle/ave-mujica/battle/main.mjs?v=<hash>`）再 `import()` —— ES module 按 URL 去重，拿到的就是运行器加载的**同一个实例** |
| 贴在哪 | 引擎战场视图（`globalThis.__SP_VIEW__`，`ui/fieldHost.js` 挂载时写入）的 **`tileScreen(row, col)`** 把棋子所在的 **board 格子**映射成屏幕位置与大小（`public/js/render/app.js`）；面板用 `position: fixed` 把图标贴到该格**右下角**（干员模型右下方，尺寸/偏移都按「一格在屏幕上的高度」缩放）。**不用 `pieceScreenRect(uid)`** —— 实测它解析不了战斗单位（两枚在不同格上的棋子会返回**同一个**身体矩形 ⇒ 图标全叠一处） |

> 限制：**服务端跑战斗**（`SP_COMBAT=server`）时，本包的 `server.battle` 模块不在浏览器里执行 ⇒ `FEVER_LIVE` 为空 ⇒ 面板不画。
> 默认的客户端战斗（client-side combat）下正常。

---

## 6. 引擎侧需要的支持

### 6.1 引擎里与本包直接相关、需要保留的文件

| 引擎文件 | 位置 | 与本包的关系 |
|---|---|---|
| `app/public/js/render/fx/kinds.js` | 第 8–10 行 | 引擎内置的 **`fever` 特效类型**（品红团队光环，`dur: 20`），注释**点名** `workshop/ave-mujica` 的战斗逻辑；本包 `battle/main.mjs` 用 `S.fxOn(battle,'fever',…)` 打这个特效 |
| `app/shared/kitImports.js` | 第 56–57 行、第 88 行 | kit / 战斗模块的 **import 白名单**：`@kit/tier1.js`（第 56 行）、`@kit/tier2.js`（第 57 行）供 5 个 kit 使用；`@battle/mod.js`（第 88 行）是 `battle/main.mjs` 的注册面入口；`BATTLE_IMPORT_PREFIXES = ['@battle/','@sim/']`（第 47 行） |
| `app/server/sim/content/support/mod.js` | 第 28–29 行 | 战斗内容层 SDK / 注册面：`registerBondInstaller`（第 28 行）、`registerGarrisonInstaller`（第 29 行）——本包盟约与战斗特质的注册入口 |

**`app/server/` 与 `app/shared/` 中没有任何本 mod 的专属运行时代码**（`grep -i mujica` 两处均无命中）——本包
已把战斗/休整期逻辑整体内聚到包里，引擎只为它保留了上表这些**通用**能力与一处特效注释。

### 6.2 本包依赖的引擎通用能力（不是为本包新增，但本包用到了）

| 能力 | 载体 |
|---|---|
| 战斗内容层 SDK / `register*` 全局表 | `@battle/mod.js` → `server/sim/content/support/mod.js`（`BondInstaller` / `GarrisonInstaller`） |
| 休整期注册表契约 | `pack.json.server.meta` + `meta/main.mjs` 的 `registry.bond/garrison/band`（键 = `registers`；引擎侧见 `server/match/effectsMeta.js` 的 `garrison:`/`band:`/`bond:` 键名规则） |
| kit 双端加载与 `@kit/*`/`@battle/*` 白名单 | `app/shared/kitImports.js`（服务端 `server/workshop.js`、浏览器 `public/js/battle/runner.js` 共用同一张表） |
| 盟约/分队**扁平图集** `art.bonds` / `art.bands` | `app/shared/workshop.js` 的 `normalizePackManifest` / `ART_TABLES` / `BOND_ICON_CONFLICT`；消费端 `app/public/js/ui/assetUrls.js` 的 `bondIconUrl()` / `bandIconUrl()` |
| 「受伤加层」内置 garrison handler | `app/server/sim/content/garrisons/battle.js`（`bbStr.bond_add_type`，`bond_type: bond_self`，走 `env_gbuff_new_with_verify`）——`garrison_164` 靠它生效 |
| 战斗内 `fever` 特效类型 | `app/public/js/render/fx/kinds.js` |
| 战场视图 + `pieceScreenRect(uid)` | `app/public/js/ui/fieldHost.js`（`globalThis.__SP_VIEW__` 的写入点）、`app/public/js/render/app.js`（`pieceScreenRect` 的实现）；引擎自己的 `screens/game/standInTags.js` 用的是同一条 |
| 面板能 `import` 引擎站点模块 | `docs/WORKSHOP.md` 的「你的面板模块可以直接 import 引擎的流程」——本包面板由此 `import { battleRunner } from '/js/battle/runner.js'`（同 data-board） |
| 面板槽 `screen.game.overlay` / 组件改写 `game.hud.topBar` | `app/public/js/ui/extensions.js` 的槽与改写链；`app/public/js/screens/game.js` 的 `.mod-host` 宿主 |

### 6.3 与本包绑定的验证脚本（非引擎运行时，供参考）

- `app/forge-flow-avemujica.mjs`：本 mod（Forge 版）的 prep 流程验证（盟约激活、1/2/3/4/5 人各档、双盟约若叶睦）。
- `app/forge-kit-behavior.mjs`：用真实工坊 kit 加载器验证 Ave Mujica 的 kits。
- `app/test/workshopArtTables.test.js`：以本包 `art.bonds` / `art.bands` 为例钉住扁平图集契约。

---

## 7. 素材

### 7.1 `art.chars`（5 名成员，每名含头像/立绘/Spine）

- `char_4182_oblvns`、`char_4184_dolris`、`char_4186_tmoris`、`char_4185_amoris`、`char_4183_mortis`。
- 每人 4 张图：`char/avatar/<charId>.png`、`char/avatar/<charId>_2.png`（精英化头像 `avatarE2`）、
  `char/portrait/<charId>.png`、`char/portrait/<charId>_2.png`；外加 `spine/op/<charId>/{front,back}/` 的
  `.skel` / `.atlas` / `.png` 与动画映射（`idle`/`deploy`/`attack`/`skill`/`die`/`skills{0,1,2}`）。
- 注意 `char_4183_mortis` 的 `portrait` 指向 `char_4183_mortis_1.png`（其它成员是 `_2`）。
- `anims` 的 `skill`/`skills` 已由项目 Spine 管线（`tools/assets/skel.mjs` + `tools/assets/anim-roles.mjs`）对真实骨架重算：
  `char_4183_mortis` 原先把 `via:"attack"` 写进了技能片段，导致开技能时只播普攻动作，现已改回 `Skill_1`/`Skill_2`。

### 7.2 盟约 / 分队图标（走扁平表，非 `bondIcons`）

| 表 | 键 | 文件 |
|---|---|---|
| `art.bonds` | `aveMujica` | `bond/icon_aveMujica.png` |
| `art.bands` | `band_wuyouyoumeng` | `band/band_wuyouyoumeng.png` |

> 本包**未用**顶层 `bondIcons` / `itemIcons`（无道具）。`art.bonds` 与 `bondIcons` 是「同一件事的两种写法」，
> 不可对同一 id 两处都声明（会整包拒绝）。

### 7.3 `art.skills`（11 张技能图标）

`skchr_am_doloris_1/2`、`skchr_am_timoris_1/2`、`skchr_am_amoris_1/2`、`skchr_am_oblivionis_1/2/3`、
`skchr_mortis_1/2`（落盘 `skill/<名>.png`）。

### 7.4 时装 `skins`（5 套）

| `id` | `name` | `charId` |
|---|---|---|
| `avemujica-oblvns` | 旋律的主人 | `char_4182_oblvns` |
| `avemujica-mortis` | 提线的本我 | `char_4183_mortis` |
| `avemujica-dolris` | 笼中歌者 | `char_4184_dolris` |
| `avemujica-amoris` | 情热魔术师 | `char_4185_amoris` |
| `avemujica-tmoris` | 月下执行者 | `char_4186_tmoris` |

`series` 均为 `Ave Mujica`；每套含 `skin/op/<charId>/` 下的 `avatar.png`、`portrait.png` 与
`front|back/<charId>_avemujica_1.{skel,atlas,png}`。

### 7.5 语音 `voices`（5 名 charId）

每人一组，键为 `start` / `faceEnemy` / `select` / `place` / `skill1`~`skill4` / `resultFour` / `resultThree` /
`resultTwo` / `resultLose`；文件为 `assets/voice/jp/<charId>/cn_0xx.mp3`（共 70 个文件）。

### 7.6 落盘目录约定

```
assets/
  char/avatar/<charId>.png, <charId>_2.png
  char/portrait/<charId>.png, <charId>_2.png
  skill/<skillIcon>.png
  bond/icon_aveMujica.png
  band/band_wuyouyoumeng.png
  skin/op/<charId>/{avatar.png,portrait.png,front/,back/}
  spine/op/<charId>/{front/,back/}
  voice/jp/<charId>/cn_0xx.mp3
```

（`pack.json.art.*` 里的路径均相对 `assets/`；Spine 的 `textures`/`skel`/`atlas` 必须同目录。）

---

## 8. 文件清单

| 目录 / 文件 | 数量 | 关键文件名 |
|---|---|---|
| `pack.json` | 1 | 声明 `content` 5 表、`server.battle` + `server.meta`（`combat: true`）、`client.panels`（`ui/fever.js` 连音符 Fever 进度）、`art`、`voices`、`skins`；`overrides` 3 条 `bonds:` |
| `bonds.json` | 1 | `aveMujica` + 3 条官方盟约名册覆盖（`skillfulShip` / `miraShip` / `soloShip`） |
| `chess.json` | 10 | `chess_char_5_25_a/_b`、`5_30_a/_b`、`5_31_a/_b`、`5_32_a/_b`、`6_30_a/_b` |
| `garrisons.json` | 10 | `garrison_180_a/_b`、`181_a/_b`、`182_a/_b`、`183_a/_b`、`164_a/_b` |
| `bands.json` | 1 | `band_wuyouyoumeng` |
| `effects.json` | 1 | `aceffect_band_wuyouyoumeng` |
| `battle/` | 1 | `main.mjs` |
| `meta/` | 1 | `main.mjs` |
| `ui/` | 2 | `fever.js`（客户端面板）、`fever.css` |
| `kits/` | 5 | `chess_char_5_25_a.js`、`5_30_a.js`、`5_31_a.js`、`5_32_a.js`、`6_30_a.js` |
| `assets/` | 169 | `char/avatar`(10)、`char/portrait`(10)、`skill`(11)、`bond`(1)、`band`(1)、`skin/op`(37)、`spine/op`(27)、`voice/jp`(70)、`ui`(2，连音符 `fever_note_empty/full.png`) |
| **合计** | **184** | — |

---

## 9. 扩展这个包时的约定

- **新增成员**：在 `chess.json` 加 `_a`/`_b` 两条（`bonds` 至少含 `aveMujica`），在 `battle/main.mjs` 的
  `ROLE_BY_CHESS` 里登记 `chessId → 角色`（角色名决定它吃哪条成员特质），并在 `bonds.json` 的
  `members` / `visibleMembers` 里补上 `_a` 的 id；如需专属特质，再写 `garrisonIds` 并在 `garrisons.json` 出条目。
- **新增特质（`garrison`）**：`effectKey` 必须被某个 `registerGarrisonInstaller(key, …)`（`battle/main.mjs`）或
  `registry.garrison(key, …)`（`meta/main.mjs`）接住；后者还要把键写进 `pack.json.server.meta.registers`——
  它既是白名单也是房间摘要闸门的输入，**漏写会导致该特质静默不生效**。
- **新增策略 / 效果**：在 `bands.json` + `effects.json` 写数据，并在 `meta/main.mjs` 用
  `registry.band('<bandId>', …)` 接上处理器，同时更新 `registers`。
- **美术**：盟约图标写 `art.bonds`、分队图标写 `art.bands`（勿与顶层 `bondIcons` 对同一 id 重复声明）；新素材落盘
  见 §7.6 约定。
- **kit**：一个成员一个 `<chessId>_a.js`，只允许 import `@kit/*` / `@sim/` / `@ops/*` 白名单或本包 `kits/` 下的
  相对路径（`./…`，不得含 `..`）；战斗/休整期这种**整场级**逻辑不要塞进 kit，放 `battle/` 或 `meta/`。
- **注意**：本包为**核心盟约**（`SEASON`），改动 `thresholds` / `isCore` 会直接影响引擎的核心盟约抽签与调和规则，
  动手前先核对 `bonds.json` 语法。
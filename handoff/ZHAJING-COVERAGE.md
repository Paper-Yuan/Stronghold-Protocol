# 炸惊模拟 · 验收矩阵（coverage matrix，2026-10-28）

> 任务来源：Lead 2026-10-28。只读调查 + 只写本文件（统计脚本在 `modref/tools-*.mjs`）。
> 上游清单：[`ZHAJING-INVENTORY.md`](ZHAJING-INVENTORY.md)（§1 数据层 / §2 引擎层 / §3 客户端 / §5 漂移分组）与 `modref/inventory.json`。
> 本文回答一个问题：**「拆分是否完整」怎么逐项证明**。

---

## 0. 口径、快照与状态定义

### 0.1 快照

| 项 | 值 |
|---|---|
| 参考包 | `modref/v2.1`（`Stronghold-Protocol-0.3.1-mod.4`，edition ZHAJING） |
| 本仓 | `E:\Workbox\系统`，0.3.3 |
| 本仓状态快照时间 | 表 A/B/C/E：**2026-10-28 07:57 (+08)**；表 D 与下表：**2026-10-28 08:24 (+08)**（同一天两次，因为 data/kits 在这一小时内落地了） |
| 为什么强调快照 | 本仓正在被其他队友并行修改（engine/data/client 三个写域），下表「状态」列是**该时刻的实测**，不是最终值 |

**08:24 快照的本仓实况（关键，决定了下表的读法）**：

| 层 | 已落地 | 未落地 |
|---|---|---|
| 代码（引擎） | `jibian.js`/`ejibian.js`/`jibianBonds.js`/`mujica.js`/`mujicaBond.js`/`shared/zjBonds.js`/`shared/zhajingBase.js`/`shared/mujicaJibian.js`/`bonds/addon/zjbonds.js`；`DOMAIN_NAMES` 含 `jibian`、`ejibian`、`jibianBonds`；`gamedata.js` 的 `zhajing` 门 + 全套 getter；**8 个 `ZHAJING_KIT_FILES`**（表 D） | `forge.js` / `shared/forgeData.js` 两个文件**不存在**（`DOMAIN_NAMES` 也没有 `forge`）；7 处敌方惊变行为钩子、二极管、死亡回归等未接（见 §4） |
| 数据 | **已落地**：`chess_zj_*` 205 + `chess_chen3_*` 2、`garrison_zj_*` 238 + `garrison_mujica_*` 10、`bonds` 28 条（**21 条带 `zj` 块**、5 条新盟约）、`jibianBonds.json` 18 条、`mode_single_zhajing`（`jibian.pool` **99** / `enemyJibian.pool` **21** / `bans.ZHAJING {core:3,addon:4}`）、items 11 条 | **`data/zjDefaultLoadout.json`**（84 条默认模组表）仍缺 |
| 客户端 | 仅 `public/js/ui/zhajingRules.js`（规则页）+ 被改动的 `lobby.js` | 其余 **14 个**新文件（`jibianPanel`/`jibianList`/`enemyJibianOverlay`/`jibianArt`/`forge`/`zhajingSwitch`/`zhajingLoadoutButton`/`bingCue`/`mujicaTraits`/`bench`/`equipSlots`/`modeRules`/`render/mujicaHud`/`loadout-jibian.css`）+ 46 个既有文件的 zj hunk |
| kits | 238 个 ops，其中 **8 个 `chess_zj_*`**（`ZHAJING_KIT_FILES`）+ 20 个 `ver-*` | 结城理 `op-makoto.js`（757 行，`ZHAJING_KIT_FILES` 里注释待批次） |

**一句话（08:24 版）**：**数据层已通、引擎骨架已立、客户端还空** —— 现在这条玩法在服务端「抽得到、算得出」，但**局内没有一块界面能显示惊变**；`forge` 与 3 张卡（全军出击/死亡回归/二极管）仍是硬缺口。

### 0.2 状态定义（本文用）

| 状态 | 判据（可复现） |
|---|---|
| **已搬** | 本仓同名文件里，包内 zj 命中行有 ≥60% 能逐行找到（空白归一后相等）；或已由符号矩阵证明等价 API 存在 |
| **部分** | 0% < 命中行匹配 < 60%，或文件里的 zj 功能只搬了一部分（逐条在「验收点」列写明差什么） |
| **未开始** | 0 行匹配，且符号矩阵里对应的验收符号在本仓不存在 |
| **无同名/需新增** | 本仓没有这个路径 |

> ⚠ 表 A 的「状态」列是 **07:57** 的，且判据是「**代码文件**行级匹配」；**不反映 08:24 落地的数据层**。
> 所以读表时请把「表 A 状态」理解成「这个文件的 zj 代码搬没搬」，把 §0.1 上表理解成「整条玩法通没通」——两者不是一件事。

复现命令：`node modref/tools-probe-hunks.mjs core` / `... trace`（逐行匹配）、`node modref/tools-scan-symbols.mjs`（符号矩阵，88 个验收符号）。

### 0.3 三档证据强度（写在每行「验收点」里）

1. **符号级**（最强）：`grep 符号` 在本仓命中 → 例如 `gd.zhajing`、`jibianDraftCards`、`setZjDefaultModules`。
2. **行级**：包内的 zj 命中行能否在本仓找到。
3. **行为级**（最弱但要写）：如「本局抽得到该卡且有效果」——必须用 §4 的卡表 + 一条测试断言来闭环。

---

## 1. 表 A-1：核心 62 个文件（≥5 处 zj 命中）

> 120 个文件**全部**在本仓有同名路径（0 个「无同名」、0 个「本仓已重构掉」），所以不列「本仓对应路径」列——路径相同。
> 行区间 = 包内 zj 命中行（前 6 段；完整区间见 `inventory.json → drift.detail`）。
> 归属：`engine-core` = `server/match/**`、`server/sim/**`(非 content)、`shared/*`、`server/lobby.js`、`server/data.js`；`engine-cards` = `server/sim/content/**`；`client` = `public/**`。

| # | 包内文件 | zj 行区间（首 6 段） | hunk 一句话作用 | 归属 | 验收点（怎么证明被搬到了） | 状态 |
|---|---|---|---|---|---|---|
| 1 | `server/match/player/economy.js` | 4, 13, 38, 46, 67, 69-71 | 恶魔契约（目标生命当资金）`jibianLpPayment()`、板藤套现 `sellBanteng`、惊变计数器的经济钩子 | engine-core | 符号 `jibianLpPayment` / `sellBanteng`（本仓 **0 处**） | 未开始 |
| 2 | `server/match/choices.js` | 65, 67, 139-140, 145-146, 148 | 惊变家族名 `jibian:'惊变阶段'`、`jibianCard()`、`jibianDraftCards()`、稀有度先掷再取卡 | engine-core | 符号 `jibianCard`(repo 2 文件)/`jibianDraftCards`(repo 有)/`FAMILY_NAMES.jibian` | 部分 |
| 3 | `server/match/gamedata.js` | 17, 51, 91, 114-115, 118-119, 126-128 | **总开关**：`zhajing` 门、`visibleChess` 过滤、`zjBondView` 合并、`zjCombos`、`bans.ZHAJING`、`jibian()`/`enemyJibian()`/`spPhaseKind()`/`expressPool`/`zhajingFlags()` | engine-core | 11 个 getter 已存在；`bans.ZHAJING` 已与包内一致（`{core:3,addon:4}`）；**`enemyResMul`/`morphEquipSlot`/`damageCap`/`hiddenBossHpMul` 本仓 0 处** | 部分 |
| 4 | `server/match/match/phases.js` | 9-10, 342-343, 369, 388, 391 | 每轮算 `matchJibianPlan`（敌方惊变计划）+ 惊变「追忆」的回退挂点 | engine-core | 符号 `matchJibianPlan`(repo 有，2 文件)、`applyHiddenMatchCards`(repo **1/2**)；「追忆」回退 `_jibianRewindRound` 本仓 0 处 | 部分 |
| 5 | `server/match/match/spDraft.js` | 23-24, 26, 34, 38, 56-63 | 惊变阶段抽卡（`generateDraft`/`applyCard`/`jibianDraftCards`）、投资未来 pending 计数、8 张测试卡撤场理由 | engine-core | 符号 `jibianDraftCards`(repo 有)；`jibian:touziweilai:pending` 本仓 0 处 | 部分 |
| 6 | `public/js/audio.js` | 494, 641, 915, 1063, 1068, 1070 | Fever 音乐/音效路由 `mujicaBankForUnit`、？！冰？！ 的「冰冰冰」音效 | client | 符号 `mujicaFever`(repo 1 文件)、`bingCue`(repo **0**)、`mujicaBankForUnit`(repo 0) | 未开始 |
| 7 | `server/match/effectsMeta.js` | 47, 52, 81-83, 199, 202, 209 | `jibian:` 效果键派发、**二极管**概率、投资人类「获得时」翻倍、惊变羁绊的 prep 侧效果 | engine-core | 符号 `jibian:` 键前缀 + `DIODE`；`erjiguan` 本仓仅在盟约表出现，`effectsMeta.js` **0 处** | 未开始 |
| 8 | `public/css/screens/game-panels.css` | 416-421, 454-455, 462, 468, 507 | 局内惊变卡 / 三选一浮层 / Fever 卡面样式（`.spov--mujica-cards` …） | client | 选择器 `.spov--mujica-cards`、`.jibian` 系列类名（repo 0） | 未开始 |
| 9 | `server/sim/content/bonds/core.js` | 214-216, 247, 251, 253 | 龙的传人（炎盟约改由惊变召唤）、zj 覆盖把 `max_buff_stack_cnt` 抬到 9999 | engine-cards | 符号 `hasJibian(battle,…,'jibian_longdechuanren')`（repo 0 处） | 未开始 |
| 10 | `shared/protocol.js` | 107, 109, 122, 141, 145, 147-148 | `setZjDefaultModules()` / `zjDefaultModuleId()`：默认模组表的协议层 | engine-core | 符号 `setZjDefaultModules`（repo **0**）、`zjDefaultModuleId`（repo **0**） | 未开始 |
| 11 | `server/match/player/views.js` | 31, 35-38, 46, 50, 55-56 | 敌方惊变下发给客户端（`enemyJibian` 帧）、已选惊变私有视图 | engine-core | 符号 `gd.enemyJibian()` 在 views 的使用（repo 0） | 未开始 |
| 12 | `server/match/waves.js` | 31, 45-46, 262, 313, 456 | 敌方惊变的**出怪侧**：`matchJibianPlan` 改写 spawns、源石虫替换 `SLIME_KEY`/`RUZHI_SLIME_TOTAL`、天堂制造时限 | engine-core | 符号 `matchJibianPlan` 在 waves 的调用 + `SLIME_KEY`（repo 0） | 未开始 |
| 13 | `public/js/screens/sweep.js` | 21, 150, 154-156, 164-165 | S.W.E.E.P. 报告的炸惊视图（`setZjBonds`/`zjBondsEnabled`/`zjChessOf`） | client | 符号 `zjBondsEnabled`、`setZjBonds`（repo 0） | 未开始 |
| 14 | `server/sim/content/bonds/addon/meta.js` | 7, 28, 47-49, 53 | 奇迹的 zj 每层概率增量、助力读 zj 覆盖块（`buffParams` 需看合并视图） | engine-cards | 符号 `miraSettle` + zj 概率常量（repo 0） | 未开始 |
| 15 | `public/js/screens/game.js` | 79, 81, 89-90, 210, 597 | 挂载 `JibianPanel` / `EnemyJibianOverlay` / `ZhajingRulesButton` 三个浮层 | client | 符号 `JibianPanel` / `EnemyJibianOverlay` / `ZhajingRulesButton`（repo 全 0） | 未开始 |
| 16 | `public/js/ui/loadoutSync.js` | 46-48, 52-53, 58, 60-61 | 干员调配「普通 / 炸惊」两套 entries/ops 的存取（`LOADOUT_ZJ_PREF`） | client | 符号 `LOADOUT_ZJ_PREF`（repo 0） | 未开始 |
| 17 | `server/sim/content/jibianBonds.js` | 1, 4, 10-27, 37, 42 | 18 条惊变羁绊内联表 + `activeBonds`/`ownedJibianIdsOf`/`bondHintsFor`/`WILD_CARD` | engine-cards | 已 24/25 行匹配；repo 导出 6 个全在 | **已搬** |
| 18 | `server/sim/content/bands/meta.js` | 22, 40, 253-255, 258-261 | 炸惊专属策略「祀」「长兄如父」的 prep 侧 + `jibianDuckParams` 鸭爵 | engine-cards | 符号 `zj_si_grant_chyue` / `zj_fuuka_sees_deploy`（repo 0） | 未开始 |
| 19 | `shared/constants.js` | 94-95, 97, 104, 115, 119 | `DIFFICULTIES` 加 `ZHAJING`（第五档）、`EMPTY_*` 列表清空、层数上限 9999 | engine-core | 符号 `DIFFICULTIES` 含 `'ZHAJING'`（repo **不含**）；`bondLayerCap`(repo 4/16) | 未开始 |
| 20 | `public/js/render/vfx/skillfx.js` | 218-219, 898-899, 981, 1014-1018 | Fever 音符特效 `mujicaNotes` / `mujicaFever` 的渲染通道 | client | 符号 `mujicaNotes`（repo 0） | 未开始 |
| 21 | `server/match/bondsMeta.js` | 27, 34, 41, 106, 128-129 | 装备组合激活盟约 `equipComboBonds(items, gd.zjCombos)`、阈值缓存按合并视图 | engine-core | **装备组合已接**（`bondsMeta.js:49-51` 已有 `if (Array.isArray(gd.zjCombos) …) equipComboBonds(...)`）；差的是 zj 覆盖视图下的阈值缓存与其余注释级差异 | 部分 |
| 22 | `server/sim/content/bonds/addon/battle.js` | 70, 82, 91, 93, 143 | S.E.E.S 盟约（成员攻击/攻速按层）、炸惊坚守第 3 档（生命转攻击）、炎国人会飞 | engine-cards | 符号 `hasJibian` 使用 + S.E.E.S 常量（repo 0） | 未开始 |
| 23 | `public/js/data.js` | 32, 61, 219, 366, 427-428 | `zjBondView` 合并视图、`zjLoadout` 数据表、`setZjBonds` 通知订阅者 | client | 符号 `zjLoadout` / `setZjBonds`（repo **0**） | 未开始 |
| 24 | `public/js/screens/loadout.js` | 62-63, 65, 777-778, 780 | 挂 `ZhajingSwitch` 页签 + `JibianListButtons` 一览按钮、真实房间难度优先 | client | 符号 `ZhajingSwitch` / `JibianListButtons`（repo 0） | 未开始 |
| 25 | `public/js/ui/choiceOverlay.js` | 28, 32, 35, 72, 78 | 三选一浮层的惊变分支：稀有度、颂乐人偶三张卡的专属卡面、`resolveJibianArt` | client | 符号 `resolveJibianArt` / `MUJICA_CARD_IDS`（repo 0） | 未开始 |
| 26 | `server/match/match/bossRounds.js` | 42-45, 47, 62, 81 | 隐秘惊变揭示阶段（`_hiddenJibianDone`）+ 死亡回归的 Boss 轮挂点 | engine-core | 符号 `_hiddenJibianDone`、`hiddenJibian`（repo 0） | 未开始 |
| 27 | `server/sim/content/garrisons/battle.js` | 46, 58, 63-64, 71 | 二极管（惊变）在卫戍特质触发侧的 50/50 掷骰；`jibianActiveBonds` 旁路 | engine-cards | 符号 `DIODE_DOUBLE_CHANCE` / `jibian_erjiguan`（repo 0） | 未开始 |
| 28 | `server/sim/content/support/index.js` | 21, 50, 53, 58, 61 | 战斗内装 zj 盟约/装备视图（`bondRecord`/`itemRecord` 优先读它）、`equipComboBonds` | engine-cards | 已 10/18 行匹配；`equipComboBonds` 已接 | 部分 |
| 29 | `public/js/ui/loadoutModel.js` | 22-23, 236, 239, 241 | 炸惊档的 entries/ops 模型（与普通档互不覆盖） | client | 符号 `zhajing:` 字段 + `LOADOUT_ZJ_PREF`（repo 0） | 未开始 |
| 30 | `server/match/match/views.js` | 130, 219, 221-224, 227 | 下发敌方惊变池/回合计时（天堂制造改写 `combatTimeLimit`）、隐秘惊变帧 | engine-core | 符号 `hiddenJibian` / `enemyJibian` 帧字段（repo 0） | 未开始 |
| 31 | `public/js/render/app.js` | 173, 236-237, 606, 608 | Fever HUD 挂载 `createMujicaHud`、待部署区 2 排（炸惊 20 格） | client | 符号 `createMujicaHud`（repo **0**） | 未开始 |
| 32 | `shared/zjBonds.js` | 1, 3-5, 19-20, 27 | 盟约 `zj` 覆盖层：`zjBondIds`/`zjBondRecord`/`zjBondView`/`zjPatches`/`zjItemKeyOf`/`zjEquipCombos`/`equipComboBonds` | engine-cards | 14/15 行匹配；7 个导出全在 | **已搬** |
| 33 | `public/js/ui/gameLogic/bonds.js` | 186, 253-254, 284-289 | 普通/炸惊两套棋库 id 的互认（红叉、成员、面板） | client | 符号 `zjChessOf` 或 charId 回退（repo 0） | 未开始 |
| 34 | `shared/zhajingBase.js` | 1, 4, 8, 12-13, 15-16 | `allyScale` 折进白值：`ZHAJING_ALLY_SCALE`/`allyScaleOf`/`allyScaleFromConfig`/`zhajingBaseStats`/`isZhajing` | engine-cards | 8/13 行匹配；5 个导出全在 | 部分 |
| 35 | `public/js/screens/lobby.js` | 40-43, 622, 624-625 | 大厅「炸惊模拟干员调配」入口 `ZhajingLoadoutButton`、炸惊档位卡 | client | 符号 `ZhajingLoadoutButton`（repo **0**） | 未开始 |
| 36 | `public/js/ui/bondStrip.js` | 158-159, 176-178, 182-183 | 盟约条按「玩家实际在用的那一版棋库」取记录（zj 记录 / visibleMembers 补全） | client | 符号 `visibleMembers` + zj 映射（repo 0） | 未开始 |
| 37 | `server/lobby.js` | 239, 241, 246-247 | 大厅放行炸惊棋库的卡（`visible===false && zhajing===true` 豁免） | engine-core | 符号 `zjOnly = !!rec && rec.visible === false && rec.zhajing === true`（repo 0） | 未开始 |
| 38 | `server/match/player/round.js` | 13, 20, 25, 29, 31-32 | `SKADI_CORRUPTED`、死亡回归回退快照、利息（income/interest）、惊天魔盗团清零 | engine-core | 符号 `SKADI_CORRUPTED`(repo 1/2)、`_jibianRewindRound`(repo 0) | 部分 |
| 39 | `public/js/ui/detailPanel.js` | 50, 57, 365-366 | 详情卡白值折算 `allyScaleFromConfig`、多卫戍特质（`garrisonIds[1]`）、锻造两行 | client | 符号 `allyScaleFromConfig`(repo 1/2)、`mujicaTraits`(repo 0) | 未开始 |
| 40 | `server/sim/units.js` | 43, 58, 111-112, 114 | `aspdCap`（0=不夹攻速）、暴击/吸血进白值、`scaleMul` 乘区作废 | engine-core | 符号 `aspdCap`(repo 0)、`critRate`(repo 0) | 未开始 |
| 41 | `server/match/match/intents.js` | 25, 27, 31, 33 | 新增 C2S 意图：维多利亚的秘密刷新、死亡回归、板藤套现、支票提现 | engine-core | 符号 `sellBanteng` / `specialRefresh`（repo 1/6） | 未开始 |
| 42 | `server/match/match/prep.js` | 12-16, 20, 22, 25 | 隐秘惊变的整备阶段开场（一局一次） | engine-core | 符号 `_hiddenJibianDone`（repo 0） | 未开始 |
| 43 | `server/match/match/settle.js` | 88, 102, 114, 116 | 锻造器击杀计数 `FORGE_KILLS_PER`、集中一点（层数并流）、联战叠层 | engine-core | 符号 `FORGE_KILLS_PER` / `forgeOnKills`（repo **0**） | 未开始 |
| 44 | `server/sim/battle/players.js` | 15, 170, 172-173, 175 | `allyScaleOf` 直接改 `unit.base` 的白值（规则9 新口径） | engine-core | `allyScale` 在 players.js（repo 1 命中，**部分**） | 部分 |
| 45 | `public/js/ui/shopBar.js` | 14, 16, 19, 361 | 三张卡的自有按钮（维多利亚的秘密 / 板藤 / 支票）与图案来源 | client | 符号 `chess_item_jibian_banteng`（repo 0） | 未开始 |
| 46 | `server/match/match/messaging.js` | 120, 127, 153, 158-160 | 异戒神将音频播报、死亡回归大字播报与「只让发动者重选」 | engine-core | 符号 `jibian:jibian_siwanghuigui`（repo 0） | 未开始 |
| 47 | `server/match/player/acquire.js` | 83, 164, 176, 332 | 锻造器发放 `forgeTake`/`forgeOnKills`、死亡回归的「本阶段获得」标记、规则13 升星奖励 | engine-core | 符号 `forgeTake` / `forgeOnKills`（repo **0**） | 未开始 |
| 48 | `server/match/player/basics.js` | 21, 140, 142-143 | 部署上限 `deployCapBonus`（人事部文件夹）、炸惊形态皮肤键的放行口径 | engine-core | `deployCapBonus` 机制**已在**（`basics.js:30` / `effectsMeta.js:724`）；缺的是 builtinMeta 的 zhajing +1 分支（表 A-2 #26）与皮肤键放行口径 | 部分 |
| 49 | `server/sim/Battle.js` | 56, 77, 83, 86, 107-108 | 战斗构造时装 `zj` 视图（`zjBondView`/`zjEquipCombos`），非炸惊为 null | engine-core | 4/7 行匹配；`zjView` 已存在 | 部分 |
| 50 | `server/sim/content/index.js` | 44, 80-81, 85-86, 88 | `DOMAIN_NAMES` 加 `jibian/forge/ejibian`；kit 别名档（炸惊记录 → 兄弟 `chess_char_*` kit） | engine-core | repo `DOMAIN_NAMES` 已有 `jibian,ejibian,jibianBonds`，**缺 `forge`** | 部分 |
| 51 | `server/sim/simdata.js` | 252, 604, 606, 612, 626 | 炸惊记录的 baseId/kit 解析（同 tier 的 `chess_char_*` 优先） | engine-core | 符号 `chess_zj_` 引用（repo 0） | 未开始 |
| 52 | `public/js/render/app/info.js` | 4, 37-38, 40-42 | 敌方惊变染色 `ejibianFx`（'golden'/'rainbow'）与丢失皮肤归因 | client | 符号 `ejibianFx`(repo 1/3) | 未开始 |
| 53 | `public/js/ui/gameActions.js` | 56, 58, 62, 64 | 四个惊变按钮对应的 `g.*` 意图封装 | client | 符号 `g.sellBanteng` / `g.rewind`（repo 0） | 未开始 |
| 54 | `server/match/player/diy.js` | 141, 145, 149, 152 | `diyDisabled`：炸惊下自选编队不进池、但保留原始 picks 给「赤霄剑法」 | engine-core | 符号 `diyDisabled`（repo 0） | 未开始 |
| 55 | `server/sim/content/bands/battle.js` | 16, 63-64, 79-80 | 「祀 / 长兄如父」「山岸风花 神通法」的战斗侧（仅炸惊） | engine-cards | 符号 `zj_si_skill_layers` / `zj_fuuka_sees_deploy`（repo 0） | 未开始 |
| 56 | `server/sim/snapshot.js` | 50-51, 53-55, 79 | 把 `ejibianFx` / `ejibianCopy` 透传给客户端 | engine-core | 符号 `ejibianFx` / `ejibianCopy`（repo 0） | 未开始 |
| 57 | `public/js/battle/observe.js` | 172, 179, 181-182 | 观战标签里的惊变卡名解析（`jibian:` 前缀 → 卡表） | client | 符号 `jibian:` 前缀解析（repo 0） | 未开始 |
| 58 | `public/js/render/vfx/wiring.js` | 367, 527, 531 | Fever / 音符特效的接线与皮肤映射 | client | 符号 `mujicaFever` / `mujicaNotes`（repo 0） | 未开始 |
| 59 | `server/match/finalAssault.js` | 68, 71, 80, 82 | 共享血池吃 `bossPoolHpMul`(×5) + 敌方惊变「搞定他们的头儿」×0.5 | engine-core | 符号 `bossPoolHpMul` / `hiddenBossHpMul`（repo **0**） | 未开始 |
| 60 | `server/match/match/combat.js` | 65, 155, 158, 168 | 战斗 flags 传 `allyScale`/`bondLayerCap`/`enemyJibian`、伟大封印禁部署、异戒神将播报 | engine-core | 符号 `greatSealBanRound`(repo 1/4)、`enemyJibian:`(repo 0) | 未开始 |
| 61 | `server/sim/content/garrisons/meta.js` | 115, 152, 230-231 | 炸惊卫戍特质的语义修正（自身已激活盟约、灰毫双层、拉普兰德「每次刷新」） | engine-cards | 符号 `garrison_zj_18_a` 等注释锚点（repo 0）；另见 §5.2 的 4 个 0 实现 `effectKey` | 未开始 |
| 62 | `server/sim/content/kits/index.js` | 32, 38, 53, 60, 67 | 把 5 个颂乐人偶 kit 与 4 个新干员 kit 注册进 kit 表 | engine-cards | **已搬（8/9）**：本仓新增 `ZHAJING_KIT_FILES`（`kits/index.js:364-375`），注册键 = `chess_zj_*_a`、最后合并进 `KITS`（:476）、不进 `KITTED_CHARS`；缺 makoto（`:373` 注释待批次）。口径见 §5 | **已搬** |

**核心 62 汇总（07:57 代码快照；#62 已在 08:24 复核为已搬）**：**已搬 3**（`jibianBonds.js`、`shared/zjBonds.js`、`kits/index.js`）/ **部分 12**（choices、gamedata、phases、spDraft、bondsMeta、support/index、zhajingBase、player/round、player/basics、battle/players、Battle、content/index）/ **未开始 47**。

---

## 2. 表 A-2：痕迹 58 个文件——「纯注释」还是「真有行为」

> 这一节比搬运本身值钱：58 个文件里**只有 6 个是纯注释**，其余 **44 个带真行为/真契约**。
> 「判定」三档：**真有行为**（文件里有代码级差异，必须搬）/ **纯注释**（命中行只是说明，行为在别处已通用，不搬）/ **需核对**（命中行是注释，但它描述的行为是否已由 0.3.3 的通用代码覆盖，需要人看一眼）。
> 证据 = 包内命中行原文（`文件:行`）。

| # | 包内文件 | 判定 | 证据（包内:行） | 状态 |
|---|---|---|---|---|
| 1 | `public/js/ui/assetUrls.js` | 需核对 | 158 `@param key an assets.items key (an effect / 惊变 card id)` | 未开始 |
| 2 | `public/js/ui/gameLogic/shop.js` | **真有行为** | 137 `惊变「恶魔契约」(jibian_emoxieyue)…priv.lpPayment`；203 `规则10 … leftoverFundsKept 时全队资金不清零` | 未开始 |
| 3 | `public/js/ui/watchBonds.js` | **真有行为** | 132 `never shows above the mode's cap（炸惊 9999）`；140 `上限由参数/当前模式决定` | 未开始 |
| 4 | `server/match/fields.js` | **真有行为** | 878 `if (k.startsWith('jibian:')) owned.add(...)`；880-882 `jibianFlags` / `jiarudaqun` / `diecengshou` | 未开始 |
| 5 | `public/js/render/fx/kinds.js` | **真有行为** | 13 `mujicaImpact: { a:'blast', c:0xff7676, pt:true }`（fx kind 表项） | 未开始 |
| 6 | `public/js/screens/bandDraft.js` | **真有行为** | 56-58 `const zj = modeId.includes('zhajing')` / `.filter(b => b && (zj || b.zjOnly !== true))` | 未开始 |
| 7 | `public/js/ui/effectsList.js` | **真有行为** | 11 `import { resolveJibianArt }`；58-59 惊变卡图标分支 | 未开始 |
| 8 | `public/js/ui/gameLogic/loadout.js` | **真有行为** | 74 `record = { ...record, stats: zhajingBaseStats(record.stats, opts.allyScale) }` | 未开始 |
| 9 | `public/js/ui/hud.js` | **真有行为** | 367 `const forgeOn = modeId.includes('zhajing') \|\| priv?.testMode` | 未开始 |
| 10 | `server/match/audit.js` | **真有行为** | 74 `gd.leftoverKeptBands … \|\| gd.leftoverFundsKept`；570 `bossPoolHp(…, { enemyJibian })` | 未开始 |
| 11 | `server/match/match/unitePhase.js` | **真有行为** | 345 `flags: { layerGainsEnabled: !!this.gd.zhajing, …bondLayerCap: this.gd.bondLayerCap, enemyJibian }` | 未开始 |
| 12 | `server/match/player/items.js` | **真有行为** | 163-165 `叠加/同系列共格是炸惊专属规则` → `if (!this.gd.zhajing) return 0;` | 未开始 |
| 13 | `server/match/PlayerState.js` | **真有行为** | 197-198 保留的 diy picks（给赤霄剑法）；241 锻造计数（服务端权威） | 未开始 |
| 14 | `server/sim/battle/lifecycle.js` | **真有行为** | 64 `这一步期间装上盟约/装备视图(…见 Battle 构造里的 this.zj)` | 未开始 |
| 15 | `server/sim/content/enemies/helpers.js` | 需核对 | 307-312 次数不随 `hpMul`/复刻/百分比乘区变化（`pinBase` 语义） | 未开始 |
| 16 | `server/sim/content/kits/ops/op-chen3.js` | **真有行为** | 85 `const v = Number(battle && battle.jibianChen3WaveCap)`（没拿卡 = 150000） | 未开始 |
| 17 | `public/css/screens/game.css` | **真有行为** | 904 / 994 惊变羁绊卡面与「已选惊变」羁绊分页样式 | 未开始 |
| 18 | `public/css/screens/loadout.css` | **真有行为** | 1155 / 1160 `.lo-modes*`（`ui/zhajingSwitch.js` 的样式） | 未开始 |
| 19 | `public/index.html` | **真有行为** | 59 `<link rel="stylesheet" href="/css/screens/loadout-jibian.css" />` | 未开始 |
| 20 | `public/js/render/prepfield.js` | **真有行为** | 55 `待部署区两排…炸惊 20 格：benchRows` | 未开始 |
| 21 | `public/js/screens/briefing.js` | **真有行为** | 43 `const shownBonds = modeBonds(mode, gd.list('bonds'))`（按模式过滤 zj 专属盟约） | 未开始 |
| 22 | `public/js/ui/gameComponents.js` | **真有行为** | 34 `const zj = /zhajing/i.test(modeId)`（盟约合并视图开关） | 未开始 |
| 23 | `public/js/ui/skinPicker.js` | 需核对 | 81-82 两套棋库 id（`chess_char_1_01_a` vs `chess_zj_01_a`）导致皮肤查不到 | 未开始 |
| 24 | `public/js/ui/skins.js` | 需核对 | 65-66 精锐 id 服务端正确拒绝（`setSkins` 的 isGolden 判定） | 未开始 |
| 25 | `server/match/bot.js` | **真有行为** | 1482 `flags: { … allyScale, bondLayerCap, enemyJibian }`；414 规则5 稀有度先掷 | 未开始 |
| 26 | `server/match/builtinMeta.js` | **真有行为** | 129 `if (/zhajing/i.test(modeId))` → 人事部文档改为「可部署人数 +1」 | 未开始 |
| 27 | `server/match/match/watch.js` | **真有行为** | 240-242 联防观战每名玩家的效果列（含惊变）随帧带上 | 未开始 |
| 28 | `server/match/player/placement.js` | **真有行为** | 52 `if (cid.startsWith('chess_zj_60_5') && banned > 0 …)`（伟大封印） | 未开始 |
| 29 | `server/sim/battle/spawns.js` | **真有行为** | 118 `aspdCap: flags ? flags.aspdCap : undefined`（0 = 不夹攻速） | 未开始 |
| 30 | `server/sim/content/bonds.js` | **已搬** | 21-22 `PARTS = [['bonds/core'],['bonds/addon'],['mujicaBond']]`（2/2 行匹配） | **已搬** |
| 31 | `server/sim/content/devices.js` | **真有行为** | 159 `炸惊 adds damage_value + damage_value_per_stack × layers`（谢拉格风的炸惊版） | 未开始 |
| 32 | `server/sim/content/kits/ops/chess_char_5_05-ulpia.js` | 纯注释 | 29-31 说明 `chess_zj_04_a/_b` 沿用该 kit；无代码差异 | 不搬 |
| 33 | `server/sim/content/tokens.js` | 需核对 | 1380/1436 龙的传人：召唤分散落点、可指定部署上限（若已通用化则不用搬） | 未开始 |
| 34 | `public/css/screens/lobby.css` | **真有行为** | 1501 「快速炸惊（测试场）」按钮样式（若不做测试场入口可不搬） | 未开始 |
| 35 | `public/js/assets.js` | 纯注释 | 117 `Mirror of ui/assetUrls.js`（同 #1） | 不搬 |
| 36 | `public/js/battle/runner.js` | **真有行为** | 90 `keepsState: … \|\| (x[0]==='fx' && x[1]==='mujicaFever')` | 未开始 |
| 37 | `public/js/main.js` | 纯注释 | 269 死亡回归按下瞬间不播音（时序说明） | 不搬 |
| 38 | `public/js/render/app/view.js` | **真有行为** | 92 `benchMinRow = 待部署区多出来的那排（炸惊两排 = −1）` | 未开始 |
| 39 | `public/js/render/drag.js` | **真有行为** | 33 `待部署区走 benchTileOf，这样炸惊 20 格（2 排）也能站对` | 未开始 |
| 40 | `public/js/render/fx/simfx.js` | **真有行为** | 59 `kind === 'mujicaImpact' && skin === 'char_4185_amoris@avemujica#1'` | 未开始 |
| 41 | `public/js/render/interp.js` | **真有行为** | 77 `isCosmeticEvent: … && ev[1] !== 'mujicaFever'` | 未开始 |
| 42 | `public/js/render/units.js` | 纯注释 | 278 `morphEquipSlot 再给变形同构体一个独立格 ⇒ 最多 3 件`（行为在 equipSlots.js） | 不搬 |
| 43 | `public/js/screens/game/early.js` | **真有行为** | 9 `keepEarly: … \|\| (e[0]==='fx' && e[1]==='mujicaFever')` | 未开始 |
| 44 | `public/js/ui/enemyDrawer.js` | **真有行为** | 66 `bonds: modeBonds(config.modes[modeId], bonds)`（按模式过滤） | 未开始 |
| 45 | `public/js/ui/gameLogic/draft.js` | 需核对 | 76 服务端 private 帧的 `sp.turnDeadline` 倒计时 | 未开始 |
| 46 | `public/js/ui/gameLogic/phases.js` | **真有行为** | 223 战斗时限优先读 `m.public.combatTimeLimit`（天堂制造会改） | 未开始 |
| 47 | `public/js/ui/gameLogic/placement.js` | 纯注释 | 419 目前是虎狼丸（`garrison_zj_60_2_c/_d`）——数据 id 说明 | 不搬 |
| 48 | `public/js/ui/matchInfo.js` | **真有行为** | 89 炸惊局 ban 列表是 `chess_zj_*`，而 `visibleMembers` 多是 `chess_char_*` → 要认两次 | 未开始 |
| 49 | `server/data.js` | **真有行为** | 81-84 `setZjDefaultModules(out.zjDefaultLoadout)`（缺这行 → 默认模组表永不生效） | 未开始 |
| 50 | `server/match/invariants.js` | 需核对 | 81 「per-bond layer cap（炸惊抬到 9999）：no writer may pass it」 | 未开始 |
| 51 | `server/sim/battle/blocking.js` | **真有行为** | 48 惊变「轻拍背部」：阻挡位满 → 敌人穿过 | 未开始 |
| 52 | `server/sim/battle/deploy.js` | **真有行为** | 239 已达每回合再部署上限的干员不再复活（砾的炸惊卫戍=20 次） | 未开始 |
| 53 | `server/sim/battle/economy.js` | **真有行为** | 28 `mode 自己的 cap(9999) 走 battle flags；其它沿用官方 999` | 未开始 |
| 54 | `server/sim/buffs.js` | **真有行为** | 26 锻造器：暴击率/吸血 → `ADD_KEYS` 加键 | 未开始 |
| 55 | `server/sim/constants.js` | **真有行为** | 238 `damageCap`（防无限叠乘打穿；炸惊血量百亿级） | 未开始 |
| 56 | `server/sim/content/bonds/addon.js` | **真有行为** | 5 `addon/zjbonds.js 岁 / 企鹅物流 / 医师 —— 炸惊新增的三个盟约` → 必须 import 新文件 | 未开始 |
| 57 | `server/sim/content/traitMods.js` | 纯注释 | 167 史尔特尔 AFT-X / 斯卡蒂 DRE-Y / 空弦 MAR-Y 的 kit alias 说明 | 不搬 |
| 58 | `server/sim/skills.js` | **真有行为** | 384 `if (!u.mem?.mujicaFeverPaused) this.timeLeft -= dt;` | 未开始 |

**痕迹 58 判定汇总**：**真有行为 44** / 纯注释 **6**（#32, #35, #37, #42, #47, #57）/ 需核对 **7**（#1, #15, #23, #24, #33, #45, #50）/ 已搬 **1**（#30）。

> 结论：**不要把 58 个「痕迹」当低优先**。其中 44 个带真代码，而且多数是「开关/传参/一行 if」——正是最容易在移植时被当成注释漏掉的形状：
> `flags.layerGainsEnabled = !!gd.zhajing`（#11）、`if (!this.gd.zhajing) return 0`（#12）、
> `aspdCap: flags.aspdCap`（#29）、`if (!u.mem?.mujicaFeverPaused)`（#58）。这些漏掉**都不报错，只是玩法悄悄不对**。

---

## 3. 表 B：引擎层 8 模块 58 个导出的对照

简写：`J`=`server/sim/content/jibian.js`、`E`=`ejibian.js`、`JB`=`jibianBonds.js`、`M`=`mujica.js`、`MB`=`mujicaBond.js`、`ZB`=`shared/zjBonds.js`、`ZBase`=`shared/zhajingBase.js`、`MJ`=`shared/mujicaJibian.js`。

| # | 模块 | 导出 | 本仓同名/等价 | 负责 |
|---|---|---|---|---|
| 1-7 | J | `doubleAmmoForJibian` `installJibianBonds` `heartsteelScale` `install` `SKADI_CORRUPTED` `jibianGarrisonExtra` `registerMeta` | **7/7 已在**（`SKADI_CORRUPTED` 已被 `player/round.js` import） | engine |
| 8-25 | E | `cardsOf` `install` `registerMeta` `MATCH_CARDS` `SLIME_KEY` `RUZHI_CHANCE` `RUZHI_SLIME_TOTAL` `LIANGBIAN_COUNT_MUL` `ZHIBIAN_COUNT_MUL` `HORDE_COUNT_MUL` `YAJUE_ROUNDS` `HEAVEN_CUT_GAME_S` `HEAVEN_MIN_LIMIT_GAME_S` `jibianRoll` `heavenTimeLimit` `matchJibianPlan` `jibianDuckParams` `applyHiddenMatchCards` | **18/18 已在** | engine |
| 26-31 | JB | `jibianBonds` `WILD_CARD` `bondsOfCard` `ownedJibianIdsOf` `activeBonds` `bondHintsFor` | **6/6 已在** | engine |
| 32-41 | M | `MUJICA_CHARS` `FEVER_MAX` `FEVER_DURATION` `isMujica` `getFeverMax` `getFever` `isFeverActive` `feverState` `addFever` `ensureMujica` | **10/10 已在** | engine |
| 42-44 | MB | `MUJICA_BOND` `install` `registerMeta` | **3/3 已在**，且本仓**多导出一个** `MORTIS_BEAST_CARD`（见 #56-57） | engine |
| 45-51 | ZB | `zjBondIds` `zjBondRecord` `zjBondView` `zjPatches` `zjItemKeyOf` `zjEquipCombos` `equipComboBonds` | **7/7 已在** | engine |
| 52-56 | ZBase | `ZHAJING_ALLY_SCALE` `allyScaleOf` `allyScaleFromConfig` `zhajingBaseStats` `isZhajing` | **5/5 已在** | engine |
| 57 | MJ | `MORTIS_BEAST_CARD` | **无同名文件**；等价物 = 本仓 `mujicaBond.js` 已导出的 `MORTIS_BEAST_CARD`（内联） | engine |
| 58 | MJ | `MORTIS_BEAST_TRAIT` | **无同名文件，也无等价**（本仓 0 处）→ 多首野兽卡的特质文案缺失 | engine |

**小结**：58 个导出里 **56 个本仓有同名**、1 个有等价内联（`MORTIS_BEAST_CARD`）、**1 个真的缺**（`MORTIS_BEAST_TRAIT`）。
反过来，本仓比包内**多** 3 个导出（`jibian.js` 的 `picksOf` / `hasJibian`，`mujicaBond.js` 的 `MORTIS_BEAST_CARD`）——这是 0.3.3 的重构成果，**移植时以本仓的导出面为准，别为了对齐包内而删掉它们**（`hasJibian` 被 `bonds/core.js` 等 5 处调用）。

---

## 4. 表 C：99 张我方惊变 + 21 张敌方惊变（final review 主钥匙）

**用途**：这 120 行能把「handler 写了但没接」一次性照出来。三列就够：包内 handler 在哪、本仓 handler 在哪、有没有**第二个实现点**没接。

缩写：`n`=normal、`r`=rare、`e`=epic、`l`=legend、`h`=hidden。路径省略 `server/sim/content/` 前缀（`jibian.js:2046` = `server/sim/content/jibian.js:2046`）。
「本仓」列是 2026-10-28 07:57 快照实测；⚠ = 有**第二实现点**（外部文件）未接，卡能抽到但效果不完整/完全没有。

### 4.1 我方 99 张

| # | effectId | 稀有度 | 包内 handler | 本仓 handler | ⚠ 第二实现点 |
|---|---|---|---|---|---|
| 1 | `jibian_siwanghuigui` 死亡回归 | n | `jibian.js:2046` | `jibian.js:1663` | ⚠ `bossRounds.js`/`messaging.js`/`spDraft.js` 全 0 → **回归机制未搬，只有卡面** |
| 2 | `jibian_chixiaojianfa` 赤霄剑法 | l | `jibian.js:969` | `jibian.js:770` | ⚠ `spDraft.js` 0 → 发精锐赤刃明霄陈那段未接 |
| 3 | `jibian_cengshudaluan` 层数大乱 | h | `jibian.js:2037` | `jibian.js:1662` | ⚠ `spDraft.js:61` 包内有、本仓 0 |
| 4 | `jibian_xuedingedemao` 学丁哥的猫 | e | `jibian.js:880` | `jibian.js:696` | — |
| 5 | `jibian_zhuiji` 追忆 | h | `jibian.js:2031` | `jibian.js:1661` | ⚠ 回退挂点在 `phases.js:342`，本仓 0 |
| 6 | `jibian_shenmishangdian` 神秘商店 | e | `jibian.js:2097` | `jibian.js:1678` | — |
| 7 | `jibian_emoxieyue` 恶魔契约 | h | `jibian.js:2089` | `jibian.js:1675` | ⚠ `player/economy.js` 的 `jibianLpPayment` 未接 |
| 8 | `jibian_111fuhuoma` 111 符号码 | n | `jibian.js:2025` | `jibian.js:1660` | — |
| 9 | `jibian_shiguangzhimo` 时光之末 | r | `jibian.js:2019` | `jibian.js:1659` | — |
| 10 | `jibian_bolidapao` 玻璃大炮 | n | `jibian.js:250` | `jibian.js:129` | — |
| 11 | `jibian_fushi` 腐蚀 | n | `jibian.js:786` | `jibian.js:612` | — |
| 12 | `jibian_shuangguanghuan` 双光环 | n | `jibian.js:815` | `jibian.js:640` | — |
| 13 | `jibian_renshibuwenjianjia` 人事部文件夹 | e | `jibian.js:2115` | `jibian.js:1684` | ⚠ `builtinMeta.js` 的「部署+1」未接 |
| 14 | `jibian_daluandou` 大乱斗 | n | `jibian.js:838` | `jibian.js:659` | — |
| 15 | `jibian_qiangqiang` 强强 | n | `jibian.js:18` | `jibian.js:124` | — |
| 16 | `jibian_daoqiangburu` 刀枪不入 | n | `jibian.js:19` | `jibian.js:125` | — |
| 17 | `jibian_moshubiaoyan` 魔术表演 | n | `jibian.js:20` | `jibian.js:126` | — |
| 18 | `jibian_zhebeiwuqing` 遮被无情 | e | `jibian.js:21` | `jibian.js:1500` | — |
| 19 | `jibian_yuansudashi` 元素大师 | n | `jibian.js:22` | `jibian.js:927` | — |
| 20 | `jibian_nimobudao` 你摸不到 | e | `jibian.js:23` | `jibian.js:904` | — |
| 21 | `jibian_wananjiaoguan` 晚安教官 | e | `jibian.js:24` | `jibian.js:602` | — |
| 22 | `jibian_meiguozidan` 银质子弹 | n | `jibian.js:25` | `jibian.js:858` | — |
| 23 | `jibian_xunhuanwangfu` 循环往复 | r | `jibian.js:26` | `jibian.js:127` | — |
| 24 | `jibian_tankeyinqing` 坦克引擎 | e | `jibian.js:27` | `jibian.js:794` | — |
| 25 | `jibian_suoxiaoyinqing` 缩小引擎 | e | `jibian.js:28` | `jibian.js:826` | — |
| 26 | `jibian_chaodabei` 超大杯 | l | `jibian.js:29` | `jibian.js:1150` | — |
| 27 | `jibian_chaoqianxiaofei` 超前消费 | l | `jibian.js:30` | `jibian.js:1509` | — |
| 28 | `jibian_juanzeng` 捐赠 | e | `jibian.js:31` | `jibian.js:1146` | — |
| 29 | `jibian_wenmingdecunxu` 文明的存续 | r | `jibian.js:32` | `jibian.js:942` | — |
| 30 | `jibian_banteng` 板藤 | l | `jibian.js:33` | `jibian.js:1519` | ⚠ `economy.js` 的 `sellBanteng` + `shopBar` 按钮未接 |
| 31 | `jibian_rencaishichang` 人才市场 | n | `jibian.js:34` | `jibian.js:1522` | — |
| 32 | `jibian_xingjieshenti` 星界身体 | e | `jibian.js:35` | `jibian.js:603` | — |
| 33 | `jibian_panduolamohe` 潘多拉魔盒 | l | `jibian.js:36` | `jibian.js:1551` | — |
| 34 | `jibian_malubian` 马路边的钱 | r | `jibian.js:37` | `jibian.js:1146` | — |
| 35 | `jibian_titawu` 踢踏舞 | r | `jibian.js:38` | `jibian.js:858` | — |
| 36 | `jibian_xixuexixing` 吸血习性 | n | `jibian.js:39` | `jibian.js:884` | — |
| 37 | `jibian_shixue` 嗜血 | n | `jibian.js:40` | `jibian.js:593` | — |
| 38 | `jibian_bing` ？！冰？！ | r | `jibian.js:41` | `jibian.js:914` | ⚠ `audio.js` 的「冰冰冰」音效 + `bingCue.js` 未接 |
| 39 | `jibian_zuiegankuai` 罪恶快感 | r | `jibian.js:42` | `jibian.js:783` | — |
| 40 | `jibian_wocongshanzhonglai` 我从山中来 | e | `jibian.js:43` | `jibian.js:1534` | — |
| 41 | `jibian_325799` ？！325799？！ | l | `jibian.js:44` | `jibian.js:1571` | — |
| 42 | `jibian_daozhuanqu` 倒转区 | e | `jibian.js:45` | `jibian.js:1446` | — |
| 43 | `jibian_diecengshou` 叠层手 | r | `jibian.js:46` | `jibian.js:749` | ⚠ `fields.js` 的 `jibianFlags.doubler` 未接 |
| 44 | `jibian_laozishiguanjun` 老子是冠军 | n | `jibian.js:47` | `jibian.js:1578` | — |
| 45 | `jibian_yanguoyouji` 炎国游击 | e | `jibian.js:91` | `jibian.js:1643` | — |
| 46 | `jibian_dengdaixue` 等待雪 | l | `jibian.js:65` | `jibian.js:956` | — |
| 47 | `jibian_chunyinzidan` 纯银子弹 | l | `jibian.js:66` | `jibian.js:956` | — |
| 48 | `jibian_qishijingji` 骑士竞技 | l | `jibian.js:67` | `jibian.js:956` | — |
| 49 | `jibian_laobadao` 老霸道了 | l | `jibian.js:68` | `jibian.js:956` | — |
| 50 | `jibian_jiarudaqun` 加入大群 | l | `jibian.js:69` | `jibian.js:748` | ⚠ `fields.js:881` 未接 |
| 51 | `jibian_touziren` 投资人 | l | `jibian.js:92` | `jibian.js:1644` | ⚠ `effectsMeta.js` 的「获得时」翻倍未接 |
| 52 | `jibian_weiduoliyademimi` 维多利亚的秘密 | l | `jibian.js:72` | `jibian.js:1635` | ⚠ 特殊刷新 `specialRefresh`（repo 1/6） |
| 53 | `jibian_lala` 拉拉 | r | `jibian.js:74` | `jibian.js:1030` | — |
| 54 | `jibian_geigei` 鸽鸽 | l | `jibian.js:75` | `jibian.js:1590` | — |
| 55 | `jibian_xunjie` 迅捷 | n | `jibian.js:76` | `jibian.js:1608` | — |
| 56 | `jibian_jingzhun` 精准 | n | `jibian.js:77` | `jibian.js:1609` | — |
| 57 | `jibian_lingqiao` 灵巧 | r | `jibian.js:78` | `jibian.js:1610` | — |
| 58 | `jibian_jianshou` 坚守 | r | `jibian.js:79` | `jibian.js:1611` | ⚠ `bonds/addon/battle.js:91` 炸惊坚守第 3 档未接 |
| 59 | `jibian_huolibuzu` 火力不足 | r | `jibian.js:80` | `jibian.js:509` | — |
| 60 | `jibian_liuyan` 流言 | h | `jibian.js:81` | `jibian.js:411` | — |
| 61 | `jibian_qingpaibeibu` 轻拍背部 | r | `jibian.js:1274` | `jibian.js:1045` | ⚠ `battle/blocking.js:48` 未接 |
| 62 | `jibian_zheshe` 折折 | e | `jibian.js:1284` | `jibian.js:1055` | — |
| 63 | `jibian_jiaxiangdi` 家乡地 | e | `jibian.js:84` | `jibian.js:957` | — |
| 64 | `jibian_gaojizishen` 高级资深 | e | `jibian.js:70` | `jibian.js:1614` | — |
| 65 | `jibian_zishen` 资深 | e | `jibian.js:71` | `jibian.js:1615` | — |
| 66 | `jibian_zibaokache` 自爆卡车 | n | `jibian.js:85` | `jibian.js:1123` | — |
| 67 | `jibian_mofazhuanwuli` 魔法转物理 | n | `jibian.js:86` | `jibian.js:957` | — |
| 68 | `jibian_wulizhuanmofa` 物理转魔法 | n | `jibian.js:87` | `jibian.js:957` | — |
| 69 | `jibian_yingfenshen` 影分身 | r | `jibian.js:89` | `jibian.js:1639` | — |
| 70 | `jibian_jinjidiaopai` 金字招牌 | r | `jibian.js:90` | `jibian.js:1640` | — |
| 71 | `jibian_gaoluzhipiao` 高卢银行支票 | l | `jibian.js:108` | `jibian.js:1648` | ⚠ 提现键位（`shopBar`/`gameActions`）未接 |
| 72 | `jibian_jinjiuzhibei` 金酒之杯 | r | `jibian.js:110` | `jibian.js:368` | — |
| 73 | `jibian_jisusongda_normal` 极速送达(n) | n | `jibian.js:112` | `jibian.js:1170` | ⚠ 3 个 `item:chess_item_jibian_jisusongda_*` 注册在 `registerMeta` 尾部 |
| 74 | `jibian_jisusongda_rare` 极速送达(r) | r | `jibian.js:1412` | `jibian.js:1171` | ⚠ 同上 |
| 75 | `jibian_jisusongda_epic` 极速送达(e) | e | `jibian.js:1413` | `jibian.js:1172` | ⚠ 同上 |
| 76 | `jibian_erjiguan` 二极管 | e | **`garrisons/battle.js:63`**（无 jibian.js 实现） | 仅 `jibianBonds.js:28`（盟约表） | ⚠⚠ **`effectsMeta.js` 与 `garrisons/battle.js` 两处实现本仓全 0 → 抽到完全无效果** |
| 77 | `jibian_yanrenhuifei` 炎国人会飞 | r | **`bonds/addon/battle.js:415`** | `bondsMeta.js:108,111` + `support/index.js:314,319`（**缺 battle 侧**） | ⚠⚠ 3 个实现点只搬了 2 个 |
| 78 | `jibian_touziweilai` 投资未来 | n | `jibian.js:1975` | `jibian.js:1629` | ⚠ `spDraft.js` 的 pending 计数未接 |
| 79 | `jibian_chuncuideqiangda` 纯粹的强大 | e | `jibian.js:1965` | `jibian.js:1624` | ⚠ `battle/players.js:175` 未接 |
| 80 | `jibian_hongsongqishituan` 红松骑士团 | e | `jibian.js:1833` | `jibian.js:1525` | — |
| 81 | `jibian_shuwanzhenyan` 数万真言 | e | `jibian.js:673` | `jibian.js:515` | — |
| 82 | `jibian_sanyuewuri` 三日月 | l | `jibian.js:1311` | `jibian.js:1082` | — |
| 83 | `jibian_zonggongji` 总攻击 | e | `jibian.js:82` | `jibian.js:1082` | — |
| 84 | `jibian_wuxiaxian` 无限线 | l | `jibian.js:699` | `jibian.js:535` | — |
| 85 | `jibian_jibengong` 基本功 | l | `jibian.js:545` | `jibian.js:400` | — |
| 86 | `jibian_moguiyu` 魔鬼鱼 | r | `jibian.js:1928` | `jibian.js:1596` | — |
| 87 | `jibian_yinhezhanjian` 银河战舰 | e | `jibian.js:1776` | `jibian.js:1479` | ⚠ 颂乐人偶三张卡有专用卡面（`choiceOverlay.js` 的 `MUJICA_CARD_IDS`） |
| 88 | `jibian_yiwangnvshen` 遗忘女神 | e | `jibian.js:1783` | `jibian.js:1486` | ⚠ 同上 |
| 89 | `jibian_duoshouyeshou` 多首野兽 | h | `jibian.js:1791` | `jibian.js:1494` | ⚠ 同上 + `MORTIS_BEAST_TRAIT` 缺 |
| 90 | `jibian_heishan` 黑山 | h | `jibian.js:911` | `jibian.js:15` | — |
| 91 | `jibian_jibangzhili` 羁绊之力 | h | **`jibianBonds.js:42`**（`WILD_CARD`，无 jibian.js 实现） | `jibianBonds.js:52` ✅ | ⚠ `choices.js:652` 的抽卡排除逻辑未接 |
| 92 | `jibian_lumang` 鲁莽 | n | `jibian.js:1294` | `jibian.js:1065` | — |
| 93 | `jibian_jizhongyidian` 集中一点 | r | `jibian.js:1978` | `jibian.js:1632` | ⚠ `settle.js:102` 层数并流未接 |
| 94 | `jibian_longdechuanren` 龙的传人 | l | `jibian.js:524` | `jibian.js:375` | ⚠ `bonds/core.js:216` + `tokens.js` 分散落点未接 |
| 95 | `jibian_kuaishou` 快手 | h | `jibian.js:1507` | `jibian.js:1243` | ⚠ `spDraft.js:481` 未接 |
| 96 | `jibian_shuihaiyoumengxiang` 死海还有梦想 | e | `jibian.js:1787` | `jibian.js:1490` | — |
| 97 | `jibian_chouminglu` 臭名录 | r | `jibian.js:571` | `jibian.js:426` | — |
| 98 | `jibian_bawangxuekai` 霸王血铠 | r | `jibian.js:593` | `jibian.js:448` | — |
| 99 | `jibian_xinzhigang` 新志港 | l | `jibian.js:610` | `jibian.js:465` | — |

### 4.2 敌方 21 张

| # | effectId | 稀有度 | 包内 handler | 本仓 handler | ⚠ 第二实现点 |
|---|---|---|---|---|---|
| 100 | `ejibian_qiangqiang` 强强 | n | `ejibian.js:12` | `ejibian.js:9` | — |
| 101 | `ejibian_liangbianzhibian` 量变质变 | n | `ejibian.js:13` | `ejibian.js:10` | — |
| 102 | `ejibian_zhibianliangbian` 质变量变 | e | `ejibian.js:14` | `ejibian.js:11` | — |
| 103 | `ejibian_jixingjun` 急行军 | e | `ejibian.js:15` | `ejibian.js:12` | — |
| 104 | `ejibian_longren` 龙刃 | l | `ejibian.js:16` | `ejibian.js:13` | — |
| 105 | `ejibian_yajue` 谁选的鸭爵 | l | `ejibian.js:423` | `ejibian.js:402` | ⚠ `bands/meta.js:519` 的 `jibianDuckParams` 未接 |
| 106 | `ejibian_xianfazhiren` 先发制人 | n | `ejibian.js:17` | `ejibian.js:14` | — |
| 107 | `ejibian_ruzhiceshi` 入职测试 | e | `ejibian.js:422` | `ejibian.js:401` | ⚠ `waves.js:456` 源石虫替换未接 |
| 108 | `ejibian_douququ` 斗蛐蛐 | e | `ejibian.js:22` | `ejibian.js:19` | ⚠ `snapshot.js` 的 `ejibianFx='golden'` 未接（有金色特效才对） |
| 109 | `ejibian_qiangxingdingma` 强行顶吗 | e | `ejibian.js:421` | `ejibian.js:400` | ⚠ `waves.js:628` 同时进场未接 |
| 110 | `ejibian_zhendejiade` 真的假的 | n | `ejibian.js:18` | `ejibian.js:15` | ⚠ 彩虹特效（`ejibianFx='rainbow'`）同 108 |
| 111 | `ejibian_tongxingzheng` 通行证 | n | `ejibian.js:19` | `ejibian.js:16` | — |
| 112 | `ejibian_shenweinancanglei` 虚化 | n | `ejibian.js:20` | `ejibian.js:17` | — |
| 113 | `ejibian_jiban` 羁绊 | l | `ejibian.js:21` | `ejibian.js:18` | — |
| 114 | `ejibian_gaodingtouer` 搞定头儿 | e | `ejibian.js:23` | `ejibian.js:20` | ⚠ `finalAssault.js:82` ×0.5 血池未接 |
| 115 | `ejibian_yijieshenjiang` 异戒神将 | l | `ejibian.js:380` | `ejibian.js:22` | ⚠ `lifecycle.js:243` / `messaging.js:120` 播报与标记未接 |
| 116 | `ejibian_tiantangzhizao` 天堂制造 | l | `ejibian.js:481` | `ejibian.js:460` | ⚠ `waves.js:802` 战斗时限改写未接 |
| 117 | `ejibian_sakaziwushu` 坂崎武术 | e | `ejibian.js:24` | `ejibian.js:21` | — |
| 118 | `ejibian_quanjunchuji` 全军出击 | l | **`waves.js:779`**（无 ejibian.js 实现） | **MISSING（全仓 0 处）** | ⚠⚠ **唯一一张在 0.3.3 里完全没有 handler 的卡** |
| 119 | `ejibian_jingtianmodaotuan` 惊天魔盗团 | e | **`player/round.js:32`** | `round.js:22,26` ✅ | — |
| 120 | `ejibian_jiangshiweicheng` 僵尸围城 | l | `ejibian.js:25` | `ejibian.js:23` | — |

### 4.3 这张表照出来的 3 类静默失效

1. **卡在、效果不在**（49 张有 ⚠）：`jibian.js`/`ejibian.js` 的 handler 都在，但**第二实现点**（`waves.js`/`finalAssault.js`/`settle.js`/`fields.js`/`effectsMeta.js`/`bossRounds.js`/`snapshot.js`/`blocking.js`…）没搬 → 卡正常抽到、正常显示，**效果部分或全部不生效，且不报错**。最危险的三张：`jibian_siwanghuigui`（死亡回归：卡面在，回归机制没了）、`jibian_erjiguan`（二极管：两处实现全 0）、`ejibian_tiantangzhizao`（天堂制造：时限改写没了）。
2. **完全没有任何 handler**：`ejibian_quanjunchuji`（全军出击）——repo 全仓 0 处，`waves.js` 那段也没搬。
3. **卡在、池子也已就位（08:24 更新）**：07:57 时 `config.modes` 还没有 `mode_*_zhajing`、`data/` 也没有 `jibian.pool`/`enemyJibian.pool`，所以 120 张卡一张都抽不到；
   **现在数据层已落地**（`jibian.pool` 99 / `enemyJibian.pool` 21 / `bans.ZHAJING` 3-4），也就是第 1 条那 49 张「卡能抽到但效果不生效」**从今天起就是真实可复现的 bug**，不再是理论风险。
   → final review 里请优先跑「抽到卡 → 断言效果」这一层（§4 每行 ⚠ 列已给到包内的实现文件:行，可直接抄成用例）。

---

## 5. 表 D：9 个新干员 kit 的覆盖与落位

> **更正记录（2026-10-28 08:24，据 content 实测 + Lead 批准）**：本节此前写的「5 个颂乐人偶进 `KIT_FILES` 的 tier 组、4 个进 `OPERATOR_KIT_FILES`」**不成立**。
> 本仓 0.3.3 的解析链只认 **chess id 键**（`content/index.js:142-153` `officialKitKey`：默认数据上 `if (!isVersionData(data)) return byId;`，
> `byId = [def.baseId, def.id, bare].find(...)`），charId 键的 `op-*` 在本仓**永远命中不了**，会静默回落 generic kit。
> 现行口径 = `server/sim/content/kits/index.js:364` 的 **`ZHAJING_KIT_FILES`**（既有键序不变，最后合并进 `KITS`）。
> 依据：`server/sim/content/kits/README.md`「炸惊模拟 kits (ZHAJING)」一节 + `kits/index.js:354-375, 469-476` + `test/content/zj-ops.test.js`。

包内 kit 文件与数据是一一对应的（kit 里的 `charId` 决定它服务哪条 chess 记录）。下表的 chess / garrison / skill / module 全部从包内 `data/chess.json` 反查得到，可直接当 `docs/research/18-*.json` 的取材清单；
「本仓路径 / 注册键」列是 content 已落地的实测（`kits/ops/` 里已有这 8 个文件）。

| # | 包内 kit | 行数 | 干员 / charId | tier | 需要的 chess 记录（a/b） | 需要的卫戍 | 技能 / 模组 | **本仓路径 / 注册键（实测）** | 状态 |
|---|---|---|---|---|---|---|---|---|---|
| 1 | `kits/ops/chess_zj_tmoris.js` | 63 | 八幡海铃 `char_4186_tmoris` | 3 | `chess_zj_tmoris_a/_b` | `garrison_mujica_tmoris` + `_b` | `skchr_tmoris_2` / `uniequip_002_tmoris` | **`ops/chess_zj_tmoris-tmoris.js`** / `chess_zj_tmoris_a` | **已搬** |
| 2 | `chess_zj_amoris.js` | 54 | 祐天寺若麦 `char_4185_amoris` | 2 | `chess_zj_amoris_a/_b` | `garrison_mujica_amoris` + `_b` | `skchr_amoris_2` / `uniequip_002_amoris` | **`ops/chess_zj_amoris-amoris.js`** / `chess_zj_amoris_a` | **已搬** |
| 3 | `chess_zj_dolris.js` | 84 | 三角初华 `char_4184_dolris` | 4 | `chess_zj_dolris_a/_b` | `garrison_mujica_dolris` + `_b` | `skchr_dolris_2` / `uniequip_002_dolris` | **`ops/chess_zj_dolris-dolris.js`** / `chess_zj_dolris_a` | **已搬** |
| 4 | `chess_zj_mortis.js` | 73 | 若叶睦 `char_4183_mortis` | 5 | `chess_zj_mortis_a/_b` | `garrison_mujica_mortis` + `_b` | `skchr_mortis_2` / `uniequip_002_mortis` | **`ops/chess_zj_mortis-mortis.js`** / `chess_zj_mortis_a` | **已搬** |
| 5 | `chess_zj_oblvns.js` | 90 | 丰川祥子 `char_4182_oblvns` | 6 | `chess_zj_oblvns_a/_b` | `garrison_mujica_oblvns` + `_b` | `skchr_oblvns_3` / `uniequip_002_oblvns` | **`ops/chess_zj_oblvns-oblvns.js`** / `chess_zj_oblvns_a` | **已搬** |
| 6 | `op-kormr.js` | 113 | 虎狼丸 `char_4220_kormr` | 2 | `chess_zj_60_2_a/_b` | `garrison_zj_60_2_c/_d` | **无技能/无模组**（`rarity:1`，靠卫戍特质） | **`ops/chess_zj_60_2-kormr.js`** / `chess_zj_60_2_a` | **已搬** |
| 7 | `op-aigis.js` | 204 | 埃癸斯 `char_4218_aigis` | 4 | `chess_zj_60_3_a/_b` | `garrison_zj_60_3_c/_d` | `skchr_aigis_1` / `uniequip_002_aigis` | **`ops/chess_zj_60_3-aigis.js`** / `chess_zj_60_3_a` | **已搬** |
| 8 | `op-yukari.js` | 181 | 岳羽由加莉 `char_4219_yukari` | 3 | `chess_zj_60_4_a/_b` | `garrison_zj_60_4_c/_d` | `skchr_yukari_1` / `uniequip_002_yukari` | **`ops/chess_zj_60_4-yukari.js`** / `chess_zj_60_4_a` | **已搬** |
| 9 | `op-makoto.js` | **757** | 结城理 `char_4217_makoto` | 5 | `chess_zj_60_5_a/_b` | `garrison_zj_60_5_c/_d` | `skchr_makoto_3` / `uniequip_002_makoto` | `ops/chess_zj_60_5-makoto.js` / `chess_zj_60_5_a` —— **在 `ZHAJING_KIT_FILES` 里是注释掉的**（`kits/index.js:373-374`：文件不存在时会 ERR_MODULE_NOT_FOUND，让整个 content 测试套变红） | 待移植（批次待 Lead 定） |

**8/9 已落地**（`kits/ops/` 实测：`chess_zj_{amoris,dolris,mortis,oblvns,tmoris}-*.js` + `chess_zj_60_{2,3,4}-*.js`）；
`ZHAJING_KITS` 在 `KITS` 里**最后**合并（`kits/index.js:476`），既有 tier / standin / operator / version / diy 键序一位都不动。

### 5.1 为什么不能走 `OPERATOR_KIT_FILES`（三条实测理由，照抄即可回帖）

1. **解析链不认 charId**：`content/index.js:142-153` 的 `officialKitKey(def)` 在默认数据（`isVersionData(data)` 为假，本仓即如此）**只做**
   `byId = [def.baseId, def.id, bare].find(k => k in KITS)`。`OPERATOR_KIT_FILES` 的键是 charId（`char_4218_aigis`），**永远命中不了** → 棋子跑 generic kit，**不报错、不打日志**。
   包内 0.3.1 之所以行，是它的 `kitOf` 多一层 `reg[def.charId]` 兜底（还有 `def.kitSiblingId` 的 `chess_char_*` 兄弟兜底）；本仓 0.3.3 **两层都没有**，`simdata.js` 也没有 `kitSiblingId` 字段。
2. **会污染自选编队**：`OPERATOR_KIT_FILES` 的键会进 `KITTED_CHARS`（`kits/index.js:484-487`），即主玩法「自选编队」的合法人选；且 `test/content/kits_layout.test.js` 强制其 charId 必须在 `data/backups.json diy.ownedPool` 里。
   这 4 位是炸惊棋库的**普通商店棋子**（`chessType:'NORMAL'`），不是自选位 → 违反「只在炸惊下可获取」。
3. **文件名正则塞不进去**：`KIT_FILES` 那条测试把文件名钉成 `^(chess_char_\w+?)-([a-z0-9]+)\.js$`，`chess_zj_*` 放不进去。

> 反过来，`ZHAJING_KIT_FILES` 的注释把边界写死了（`kits/index.js:359-361`）：「These are SHOP chess of that mode, never 自选 picks: they are not keys of OPERATOR_KITS and not in `KITTED_CHARS`」。

### 5.2 这 9 位带来的卫戍/特质缺口（与表 A-1 #61 `garrisons/meta.js` 呼应）

9 条 `chess_zj_*` 的 `garrisonIds` 里，**只有 4 个 `effectKey` 在本仓 0 处实现**（其余复用既有实现）：

| effectKey | 出自 | 本仓 | 归属 |
|---|---|---|---|
| `act1autochess_gar_levitate_once` | `garrison_zj_60_4_c`（岳羽由加莉） | **0 处** | engine-cards |
| `act2autochess_gar_event_self_status` | `garrison_zj_60_3_c`（埃癸斯） | **0 处** | engine-cards |
| `no_deploy_slot`（bb 键） | `garrison_zj_60_2_c`（虎狼丸） | 仅出现在 `kits/ops/chess_zj_60_2-kormr.js`；`server/match/player/placement.js` 侧 **0 处** | engine-core |
| `MUJICA_AMORIS` / `MUJICA_TMORIS` 的 **prep 半边** | 若麦 / 海铃 | 只有 `mujicaBond.js`（battle 半边），`garrisons/meta.js` prep 半边 **0 处** | engine-cards |

**已经存在、不要记成缺口**：`act1autochess_gar_eff_attrByBond`（结城理 `garrison_zj_60_5_c`）与 `act2autochess_gar_event_onstart`（虎狼丸加层）——两者本仓 `server/sim/content/garrisons/battle.js` 已有实现（`test/content/garrisons_battle.test.js` 覆盖）。

### 5.3 隔离验收断言（可直接抄进回归）

`test/content/zj-ops.test.js:313-327` 已经跑通下面这组，**这是「不污染主玩法」最硬的一条**：

```js
for (const id of ZJ_IDS) {                                  // chess_zj_* 的 8 条（makoto 未移植前不在列）
  assert.equal(CHESS[id].zhajing, true, `${id}: zhajing`);
  assert.equal(CHESS[id].visible, false, `${id}: visible`);
  for (const modeId of ['mode_single_normal', 'mode_multi_normal', 'mode_single_hard', 'mode_multi_hard', 'mode_single_abyss']) {
    assert.ok(!new GameData(getData(), modeId).visibleChess.includes(id), `${modeId}: lists ${id}`);
  }
}
const zj = new GameData(getData(), 'mode_single_zhajing');
assert.equal(zj.zhajing, true, 'the ZHAJING mode flag');
for (const id of ZJ_IDS) assert.ok(zj.visibleChess.includes(id), `${id}: missing from the ZHAJING roster`);
assert.ok(!zj.visibleChess.some((id) => !id.startsWith('chess_zj_')), 'the ZHAJING roster is the 炸惊 chess only');
```

要点：**两个方向都断**——官方四档 + 同盟四档的 `visibleChess` 一条 `chess_zj_*` 都不能有；`mode_single_zhajing` 的 `visibleChess` **只能**是 `chess_zj_*`（主棋库一条都不许混进来）。
同一文件的其余用例还钉了每个 kit 的**精确数值**（`ATK 1119.43`、`鼓舞 = 30% ATK`、`恐惧 1.5s`…）与同种子同结果——可当表 D 的逐 kit 验收点。

---

## 6. 表 E：资产导入清单（1 216 个 / 212.4 MB 拆三档）

**口径**：zip 中央目录（未解压）里 `public/assets/**` 共 44 428 条；与本仓**已装**的 `public/assets/**`（37 903 个 / 3 291 MB）做路径级差集后，
「炸惊相关（101 个 `charId` ∪ `jibian/ejibian/mujica` 命名）」的增量 = **1 216 个 / 212.4 MB**。再把这 1 216 个分三档：

| 档 | 判据 | 文件数 | 字节 | 内容 |
|---|---|---|---|---|
| **必导** | 9 个新干员任一 `charId`，或路径含 `jibian`/`ejibian`/`mujica` | **825** | **128.8 MB** | 9 个 kit 干员的 char/spine/audio + 惊变卡面/图标/音效 |
| **可选** | 其余 92 个 `charId` 的缺失资产（它们在炸惊棋库里，但本仓缺部分立绘/语音/皮肤） | **388** | **83.5 MB** | 缺图会退回占位/默认模型，**不影响玩法正确性** |
| **不需要** | zip 里的手工残留 `*.orig-from-user.png` | **3** | 0.1 MB | 不是游戏资产 |

**必导档按资产组分**：`char` 68 个 / 73.2 MB、`spine` 102 个 / 31.9 MB、`audio` 536 个 / 24.2 MB、`local` 115 个 / 4.5 MB（惊变卡面镜像）、
`bond` 1 个 / 0.67 MB、`item` 2 个 / 0.57 MB、`jibian` 1 个 / 0.04 MB。
**必导档按干员分**：`oblvns` 60 / 20.1 MB、`tmoris` 60 / 19.1 MB、`amoris` 60 / 18.5 MB、`dolris` 54 / 17.0 MB、`mortis` 60 / 15.3 MB、
`makoto` 103 / 10.8 MB、`yukari` 101 / 10.6 MB、`aigis` 101 / 6.2 MB、`kormr` 101 / 4.5 MB、jibian/mujica 命名 125 / 6.8 MB。

### 6.1 可直接粘贴的导入命令（第一档：必导 825 个 / 128.8 MB）

> 已实测：`$dryRun = $true` 跑过一遍，报 **828**（= 825 必导 + 3 个 `.orig-from-user.png`），0 个已存在冲突。
> 把 `$dryRun` 改成 `$false` 即真正落盘；**已存在的文件一律跳过，绝不覆盖**。

```powershell
$zipPath = 'C:\Users\J1825\Downloads\炸惊模拟整合包公开版v2.1.zip'
$base    = 'E:\Workbox\系统\public\assets'
$prefix  = 'Stronghold-Protocol-0.3.1-mod.4/public/assets/'
# 9 个 kit 干员（必导的核心）
$ids = @(
  'char_4182_oblvns','char_4183_mortis','char_4184_dolris','char_4185_amoris','char_4186_tmoris',
  'char_4217_makoto','char_4218_aigis','char_4219_yukari','char_4220_kormr'
)
$kw = @('jibian','ejibian','mujica')          # 惊变卡面/图标/音效 + Fever 相关
$dryRun = $true                               # ← 确认无误后改成 $false

Add-Type -AssemblyName System.IO.Compression.FileSystem
$zf = [System.IO.Compression.ZipFile]::OpenRead($zipPath)
$add = 0; $skip = 0; $bytes = 0
try {
  foreach ($e in $zf.Entries) {
    if ($e.Name -eq '') { continue }                       # 跳过目录条目（zip 里有 2 688 个）
    if (-not $e.FullName.StartsWith($prefix)) { continue }
    $rel = $e.FullName.Substring($prefix.Length)
    if ($rel -like '*.orig-from-user.png') { continue }     # 手工残留，不是资产
    $hit = $false
    foreach ($id in $ids) { if ($rel.Contains($id)) { $hit = $true; break } }
    if (-not $hit) { foreach ($k in $kw) { if ($rel.ToLower().Contains($k)) { $hit = $true; break } } }
    if (-not $hit) { continue }
    $dest = Join-Path $base $rel
    if (Test-Path -LiteralPath $dest) { $skip++; continue } # 已装过 → 跳过，绝不覆盖
    if (-not $dryRun) {
      $dir = Split-Path -Parent $dest
      if (-not (Test-Path -LiteralPath $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
      [System.IO.Compression.ZipFileExtensions]::ExtractToFile($e, $dest, $false)
    }
    $add++; $bytes += $e.Length
  }
} finally { $zf.Dispose() }
'{0} 个 / {1:N1} MB 待导入；{2} 个已存在被跳过（dryRun={3}）' -f $add, ($bytes/1MB), $skip, $dryRun
```

预期输出：`828 个 / 128.9 MB 待导入；0 个已存在被跳过（dryRun=True）`（关掉 dryRun 后第二项会随实际已装量变化）。

### 6.2 第二档（可选 388 个 / 83.5 MB）——同一段代码，只换 `$ids`

```powershell
# 换成「炸惊棋库里的全部 101 个 charId」，其余变量与上面一致（含 dryRun 保护）
$zjIds = (Get-Content 'E:\Workbox\系统\modref\v2.1\data\chess.json' -Raw | ConvertFrom-Json).PSObject.Properties.Value |
  Where-Object { $_.chessId -like 'chess_zj_*' -and $_.charId } | ForEach-Object { $_.charId } | Sort-Object -Unique
$ids = $zjIds     # 101 个；预计新增 388 个 / 83.5 MB（其余已在库）
```

### 6.3 三条提醒

1. `public/assets/` 已被 gitignore（AGENTS.md「no game art in git」）——导入后**不要** `git add`。
2. 命令里 `public/assets/` 是**本仓**的资产根；包内 `public/assets/local/**` 也会落进来（115 个惊变卡面镜像在 `local/items/jibian/`），这是包内的既有布局，不要另行搬家。
3. 不要解压整包（1.44 GB / 51 517 条目）；上面按条目过滤是毫秒级，且不会碰到 `node_modules`。

---

## 7. 结论：现在还差什么（按归属汇总，08:24 复核）

| 归属 | 已完成 | 还差的（按「会不会静默失效」排序） |
|---|---|---|
| **data** | ✅ `mode_single_zhajing`（`jibian.pool` 99 / `enemyJibian.pool` 21 / `spPhaseKinds` / `expressPool` / `allyScale`…；`bans.ZHAJING {core:3,addon:4}`）、205 条 `chess_zj_*` + 2 条 `chen3`、238 `garrison_zj_*` + 10 `garrison_mujica_*`、28 条 bonds（21 带 `zj` 块 / 5 条新）、`jibianBonds.json` 18 条、items 11 条 | **`data/zjDefaultLoadout.json`**（84 条默认模组表）——缺它就只是「干员调配看不到默认模组」，不致命但属该模式专属内容 |
| **engine-core** | ✅ `zjBondView`/`zjCombos` 双路注入、`gamedata` 全套 getter、`allyScale` 折白值、`bonds/addon/zjbonds.js`、`shared/mujicaJibian.js`、8 个 `ZHAJING_KIT_FILES` | `forge` 整套（`shared/forgeData.js`+`content/forge.js`+`FORGE_KILLS_PER`/`forgeTake`/`forgeOnKills`/`BASE_CRIT`/`DOMAIN_NAMES` 的 `forge`）、`setZjDefaultModules`/`zjDefaultModuleId`、`jibianLpPayment`+`sellBanteng`、`hiddenJibian`（隐秘惊变揭示）、`_jibianRewindRound`（死亡回归）、`aspdCap`、`damageCap`、`morphEquipSlot`、`enemyResMul`、`hiddenBossHpMul`/`bossPoolHpMul`、`DIFFICULTIES` 加 `ZHAJING`、`zjOnly` 的大厅放行、`diyDisabled` |
| **engine-cards** | ✅ `jibian.js`/`ejibian.js`/`jibianBonds.js` 的 120 张卡 handler、8 个 zj kit | 7 张敌方惊变的行为钩子（`waves`/`finalAssault`/`bands/meta`）、`jibian_erjiguan` 两处、`jibian_yanrenhuifei` 的 battle 侧、龙的传人的 `bonds/core` 侧、`jibian_siwanghuigui` 的回归链、`ejibian_quanjunchuji`、§5.2 的 4 个 `effectKey`、`op-makoto.js`（757 行）+ 其 `ZHAJING_KIT_FILES` 一行 |
| **client** | ✅ `zhajingRules.js`（规则页） | **14 个新文件**（`jibianPanel`/`jibianList`/`enemyJibianOverlay`/`jibianArt`/`forge`/`zhajingSwitch`/`zhajingLoadoutButton`/`bingCue`/`mujicaTraits`/`bench`/`equipSlots`/`modeRules`/`render/mujicaHud`/`loadout-jibian.css`）+ 46 个既有文件的 zj hunk（含 `public/index.html` 的一行 `<link>`）—— **这是现在唯一挡「可玩」的整层** |
| **验收** | ✅ `test/content/zj-ops.test.js`（8 个 kit 的精确数值 + 双向隔离断言，见 §5.3） | 按本文 §1/§2 的「验收点」列补齐符号级断言；`GOLDEN_FULL=1 node tools/golden.mjs` 钉住 288 场景零位移 |

### 7.1 建议的验收顺序（能最早暴露静默失效）

1. **隔离不变量（已可跑）**：§5.3 那组断言——非 ZHAJING 难度 `visibleChess` 无 `chess_zj_*`、`mode_single_zhajing` 的 `visibleChess` 只有 `chess_zj_*`。数据已落地，**这条今天就能验收**。
2. **符号矩阵**：把 `modref/tools-scan-symbols.mjs` 的「本仓 0 处」符号当 checklist（08:24 复核后 `setZjDefaultModules`/`zjLoadout`/forge 系列/客户端组件仍在列）——清零为止。
3. **卡表闭环（现在最该做）**：`§4` 的 120 行里带 ⚠ 的 49 张，逐张给一条「抽到该卡 → 该效果生效」的 sim 级断言。**数据一落地，这 49 张就从「理论风险」变成真实可复现 bug**（§4.3 第 3 条）。最省事的写法是照包内 `test/jibian-*.test.mjs`。
4. **forge**：`FORGE_KILLS_PER`/`forgeTake` 一旦接上，`server/sim/units.js` 的 `crit`/`vamp` 白值会变 —— 这是唯一会移动 golden 的部分，先跑 golden 再合。
5. **真机**：`node devtools/render-check-extension-hall.mjs` + 房内 R1 惊变三选一（要等 client 层落地）。

---

## 8. 复现

```bash
node modref/tools-scan-repostate.mjs   # §0.1 本仓现状快照 → modref/out/repo-state.json
node modref/tools-probe-hunks.mjs core # §1 每个文件的 zj 行 + 本仓逐行匹配数
node modref/tools-probe-hunks.mjs trace# §2 痕迹 58 的命中行原文（判「注释 vs 行为」）
node modref/tools-scan-symbols.mjs     # §0.3/§7 88 个验收符号在本仓的存在性
node modref/tools-scan-cards.mjs       # §4 120 张卡的 handler 定位 → modref/out/cards.json
node modref/tools-scan-BDE.mjs         # §3/§5 导出对照与 kit→数据映射
node modref/tools-scan-E.mjs           # §6 资产三档 → modref/out/table-E.json
```

> 表 A/B/C/E 的状态列是 **2026-10-28 07:57 快照**；表 D 与 §0.1/§7 是 **08:24 复核**（data + kits 在这一小时落地）。
> 队友继续落代码/数据后，重跑上面命令即可刷新（`状态` 判据在 §0.2，是机械规则，不是人肉判断）；`node modref/tools-check-status.mjs` 可直接把表 A-1 的 62 行按 已搬/部分/未开始 分组打印，方便对比。


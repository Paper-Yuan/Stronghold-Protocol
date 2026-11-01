# 超限模拟 · 开发进度存档

> 存档时间：2026-10-19
> 状态：**阶段一完成**（机制骨架 + 数值曲线 + 六条大盟约重构 + 词条抉择 + 2 倍速），可进实机测试
> 分支：`main`，工作区干净

---

## 一、当前实现（已上线可测）

### 1.1 模式与准入

| 项 | 实现 |
|---|---|
| modeId | `mode_single_hard`（沿用 HARD 的框架，数值改查绝境表） |
| 识别 | `Match.isInfinite = opts.mode === SOLO_INFINITE` |
| 客户端 | `pub.isInfinite` 随 `m.public` 下发 |
| 战绩 | 独立房间 `solo_infinite`，不进常规统计 |

### 1.2 轮次结构

```
R1–R15   常规流程（R14 最终攻势 → R15 隐秘核心）
R16+     无限轮次
  ├─ 普通轮：3 种战术特训怪 × 4–20 只
  └─ Boss 轮：R20/25/30…（普通波次 + 额外 1 只领袖）
        └─ 打死领袖 → 下一轮开【词条抉择】
```

**Boss 轮不是「最终攻势」**：不建共享血池、没有加时、不分场，就是「有 Boss 的特殊普通轮次」。

### 1.3 敌人数值曲线（全部逐回合指数，基准 = 绝境 R15）

```
基准 R15:  hp×3.5832   atk×1.9487   spd×1.15

每回合：  hp ×1.06      atk ×1.0301   def ×1.0301   res ×1.0229   spd ×1.01
```

> **2026-10-20（A 方案）**：攻击从 ×1.0371 降到 ×1.0301（与防御同底数 1.16），
> 生命从 ×1.05 抬到 ×1.06，Boss 血同步到 ×1.06。
> `atk/hp` 从 0.31 降到 0.15（R60）—— 威胁从「会被打死」偏向「打不动」。

| 回合 | hp× | atk× | def× | res× | spd× | Boss 血× |
|---|---|---|---|---|---|---|
| R16 | 3.803 | 2.008 | 1.030 | 1.023 | 1.161 | 1.06 |
| R20 | 4.801 | 2.261 | 1.160 | 1.120 | 1.209 | 1.34 |
| R25 | 6.424 | 2.622 | 1.346 | 1.254 | 1.270 | 1.79 |
| R30 | 8.595 | 3.041 | 1.561 | 1.405 | 1.335 | 2.40 |
| R40 | 15.383 | 4.090 | 2.100 | 1.762 | 1.475 | 4.29 |
| R60 | 49.320 | 7.410 | 3.803 | 2.773 | 1.800 | 13.76 |
| R80 | 158.177 | 13.421 | 6.886 | 4.363 | 2.196 | 44.10 |

**def / res 各自一条曲线**（业主：结算逻辑不同，分别做）：
- `def` 是加算后乘百分比 → 底数 1.16
- `res` 是百分比减免（clamp 0–100）→ 底数 1.12

### 1.4 出怪逻辑

**七类战术特训敌人**（data/choices.json 的战术特训系列）：

```
飞行   enemy_1005_yokai / enemy_1040_bombd / enemy_1112_emppnt_2
频次   enemy_1195_sfyin / enemy_1203_sfhu / enemy_1207_sfji_2
损伤   enemy_1148_dssbr / enemy_1305_mhslim_2 / enemy_10067_ftsjc
持续   enemy_1270_nhstlk / enemy_1267_nhpbr_2 / enemy_1272_nhtank_2
隐匿   enemy_1019_jshoot / enemy_10034_cnvsax / enemy_1283_sgkill
折射   enemy_1169_duphlx / enemy_1168_dumage_2 / enemy_1174_duholy_2
护障   enemy_1355_mrfly_2
```

**规则**：随机选 3 类 → 每类抽 1 只（普通/精英 2:8）→ 每种出 `4 + floor((R-16)/5)` 只（上限 20）

| 回合 | 总数 | 种类 | 每种 |
|---|---|---|---|
| R16 | 12 | 3 | 4 |
| R25 | 16 | 3 | 5 |
| R30 | 19 | 3 | 6 |

### 1.5 词条抉择（TRAIT_DRAFT）

**触发**：R20/25/30… 打死领袖后的下一轮

**极性**：正 → 负 → 正 → 负…（`traitDraftCount % 2`）

**卡池**：

| 项 | 数量 |
|---|---|
| 正面词条 | 13（再生/浴血/坚守/强攻/意志/熟稔/灵巧/盛发/富足/破局/再起/共栖/集群） |
| 负面词条 | 14（腐蚀/颓势/破防/虚弱/脆壳/迟滞/暴露/萎靡/贫乏/壁垒/苛责/离散/蜂拥/不和） |
| 怪物池 | 普通 1 / 精英 25 / BOSS 6（共 32，另加 3 特化） |
| 等级权重 | 普通 5% / 精英 25% / BOSS 70% |

**三个特化**：

| id | 标题 | 怪 | 效果 |
|---|---|---|---|
| reid | 复仇-火与钢 | enemy_1539_reid | 生命+150%、抵抗、攻速+100、半血后攻击+100% 且受伤-60% |
| mdrock | 坚甲随身Ⅲ | enemy_1511_mdrock | 攻击+90%、生命+100%、法抗+45、护盾+100%、护盾CD→70% |
| xi | 气定神闲Ⅲ | enemy_1517_xi | 生命+50%、防御+250%、法抗+30、破桎而出间隔-50%、范围+100% |

**选中的怪**：下一轮出场，**不结算赏金**。

### 1.6 战斗倍速

```
R1–R15    gameSpeed = 1
R16+      gameSpeed = 2     ← 只影响战斗推进
```

**倒计时仍是 1 倍速**（`setDeadline` 与 gameSpeed 无关）。HUD 右上角有 `2×` 标记。

---

## 二、六条大盟约重构（全部 gate 在 `battle.flags.overlimit`）

| 盟约 | 超限改动 | 实现位置 |
|---|---|---|
| **炎** | 生命 +15% + 0.2%/层（30 层 = +21%） | `installYan` |
| **萨尔贡** | 层数每 100 层 +5% 攻击；娜仁图亚下每层 +6%（普通的一半）+ 借装备 | `installSargon` |
| **维多利亚** | 锤子 30 件封顶（750 层）；之后每 50 层 +1% 伤害 | `payHammers` + `installVictoria` |
| **阿戈尔** | 每层 +0.8% 攻击；复活 +50 攻速 | `installEgir` |
| **拉特兰** | 每发 4%→8%，上限 700%；每 100 发【圣堂殉爆】20% 全队攻击真伤 | `installLaterano` |
| **叙拉古** | 概率 3%→8%；+0.5% 目标最大生命；精英/首领 250 万上限；免疫控制→【血迹清算】 | `installSiracusa` |

### 2.1 文本一致性

- **文案只有一份、而且是在数据里**：超限盟约文案 = `data/bonds.json` 的 `inf` 覆盖块（源 `docs/research/22-overlimit-bonds.json`，
  `node tools/build-data.mjs` 生成）。界面不再各自写一份文案（早先写死在 `ui/overlimitBondText.js` 的一版已删除）。
- **局外**（S.W.E.E.P. 报告的盟约页）：`public/js/screens/sweep.js` 读 `inf` 块；强化行由
  `public/js/ui/overlimitBondText.js` 的 `overlimitValueSegments`（切段）+ `OverlimitValueLine`（渲染）画出。
- **局内**（盟约弹窗 `public/js/ui/bondStrip.js` 的 `BondPopup`）：超限局（`m.public.isInfinite`）的「盟约效果」渲染**同一个组件**，
  只有数值片段取强调色；普通 / 湮灭 / 炸惊逐字节不变（仍是原来的 `RichText`）。
- **分色逻辑只有一份**（业主 2026-11-01）：分词 + 渲染在 `ui/overlimitBondText.js`，颜色规则是与上下文无关的共享类
  `.olb-num`（`public/css/components.css`，全仓唯一一条），`sweep.css` 与局内样式都不再声明第二条。

### 2.2 实测 DPS 横向对比（`tools/bond-matrix.mjs`）

**测试条件**：5 干员（3 输出 + 1 医疗 + 1 重装）、3 件 tier4 装备、30 层、45 秒、同种子

| 大盟约 | 平均 DPS | 相对中位数 |
|---|---|---|
| 维多利亚 | 13,856 | 1.84× |
| 萨尔贡 | 10,767 | 1.43× |
| 拉特兰 | 8,452 | 1.12× |
| 叙拉古 | 7,556 | 1.00× |
| 卡西米尔 | 7,520 | 1.00× |
| 炎 | 6,825 | 0.91× |
| 阿戈尔 | 6,402 | 0.85× |
| 谢拉格 | 5,625 | 0.75× |

**加强后**（拉特兰 / 叙拉古 / 阿戈尔 / 炎）：

| 大盟约 | 改前 | 改后 | 变化 |
|---|---|---|---|
| 拉特兰 | 8,452 | 10,258 | +21% |
| 叙拉古 | 7,556 | 9,745 | +29% |
| 阿戈尔 | 6,402 | 7,430 | +16% |
| 炎 | 6,825 | 6,825 | 只加生命 |

**最强 / 最弱 = 2.46 倍**（第一轮 7.5 倍 → 第三轮 2.84 倍 → 当前 2.46 倍）

### 2.3 未解决

- **谢拉格** 仍是最弱（5,625，需 +34%）
- **维多利亚** 在「全员 3 件装备」下超标（13,856），但空手时最弱（3,076）——这是构筑深度，暂不削

---

## 三、怪物池规则

### 3.1 排除清单

| 类别 | 数量 | 理由 |
|---|---|---|
| BOSS | 33 | 走 Boss 轮 |
| 悬赏怪 | 88 | 走悬赏 / 词条抉择 |
| 召唤物/弹体（tokenOnly） | 8 | 不是独立敌人 |
| 召唤子怪 | 19 | 只由召唤者带出 |
| 次数怪（_msf / _vts） | 14 | Boss 分身 / 计数靶 |
| Boss 组件（tag:part） | 7 | 斩胄之剑 / 碎铳之簧 / 裂管之音 |
| 鸭爵套牌（enemy_20xx） | 16 | 策略召唤 |
| 炎佑 | 1 | 盟约召唤物 |

**当前池：90 只**（普通 48 / 精英 42 / 飞行 10）

### 3.2 Boss 随从

超限 Boss 从**原版模板**取随从：

```
R20 假想敌：铳
  enemy_9017_achunt_2   tag=boss    ← 本体
  enemy_9018_actrpa     tag=part    ← 碎铳之簧·甲
  enemy_9019_actrpb     tag=part    ← 碎铳之簧·乙
  enemy_9020_actrpc     tag=part    ← 碎铳之簧·丙
  enemy_1427_lrnazg / enemy_1042_frostd / enemy_9007_acelem
```

**`tag` 必须保留**：丢了会让客户端算 `counted=false`、服务端算 `counted=true`，上报被判 `uncounted leak` → 重模拟 → R20 卡死。

### 3.3 路径

- 普通波次：`NORMAL_RECT(9..12, 0..10)`
- Boss 波次：`BOSS_RECT(0..5, 0..20)`
- 筛选规则：**整条折线**（起、终、每个折点）都在矩形内
- 飞行怪：沿地面折点飞（不直冲蓝门）
- 上下路：地面路径均匀轮转，飞行路径上/下各一条

---

## 四、关键 bug 修复记录

| 问题 | 根因 | 修复 |
|---|---|---|
| R20 卡死 | Boss spawn 丢 `tag:'boss'` → 不绑血池 → 战斗挂到 timeLimit | 补 tag |
| R20 卡死（另一条） | Boss 随从丢 `tag:'part'` → counted 不一致 → 结果被拒 | 保留 tag |
| 怪从图外冒出来 | 路径未按战场矩形筛 | 整条折线筛 |
| 怪每次都一样 | `gd.data?.enemies` 是 undefined → 走三条兜底 | 改 `gd.raw.enemies` |
| R16–R19 没数值加成 | `k = floor((r-15)/5)` 在 R16–R19 是 0 | 改逐回合 |
| 回合数显示 `??` | HUD 用 `round > lastRound(14)` 判隐藏核心 | 加 `pub.isInfinite` |
| 60 秒超时误判漏怪 | wave 没 `timeLimit` → 兜底 60s，怪要 73s 才出完 | 按出怪节奏算 |
| 敌方预览显示基础值 | 预览没带 `mods` | previewOf 带 mods |
| 局内盟约文本是原版 | 局内读 `descRaw`，超限文本只在 sweep 里 | 文案进 `data/bonds.json` 的 `inf` 块；局内超限局用同一套数值分色 |

---

## 五、待办（下一阶段）

### 5.1 数值平衡

- [ ] **谢拉格** +34%（当前 5,625，中位数 7,556）
- [ ] 维多利亚 / 萨尔贡的溢出机制**未实测**（需 750 / 100 层以上）
- [ ] 叙拉古 0.5% 最大生命对高血 Boss 放大明显（250 万上限管着精英/首领）

### 5.2 机制

- [ ] 主动战术撤退（休整期【归档结算】按钮）
- [ ] 双 Boss（R45+）—— `buildInfiniteBossWave` 已有 `isDouble`，但未验证
- [ ] 词条抉择的客户端自动选（非人类回合）

### 5.3 未实现的设计项（来自 docs/INFINITE_MODE.md）

以下原设计**未实现**，当前用的是简化版：

| 原设计 | 当前实现 |
|---|---|
| 生命 $(1+0.13)^n$、攻击线性 $(1+0.05n)$ | 全部逐回合指数（业主改的） |
| 周期词条：每周期困难 + 每 3 周期正面 | 简化为「每个 Boss 轮后一次，正负交替」 |
| 拉特兰弹药 600 层封顶 | 未做（弹药量本身没封顶） |
| 阿戈尔吞噬改必杀真伤 | 未做（仍是 5000 物理） |
| 卡西米尔 6 人真伤 AOE | 未做 |
| 单次限伤 99,999,999 | 未确认 |
| BOSS 控制抗性（6 秒后 4 秒霸体） | 未确认 |

### 5.4 测试

- [ ] R16–R40 完整跑通（当前只验证到 R30）
- [ ] 双 Boss 轮（R45+）
- [ ] 词条抉择连续 5 次（正负交替）
- [ ] 手机端实机（APK 未包含最新改动）

---

## 六、关键文件索引

| 文件 | 职责 |
|---|---|
| `server/match/traits.js` | 词条池、怪物池、特化、flags 映射 |
| `server/match/match/traitDraft.js` | 词条抉择阶段、抽卡、选卡、下一轮出怪 |
| `server/match/infiniteWaves.js` | 无限波次生成、Boss 波次、七类出怪 |
| `server/match/match/phases.js` | `startRound` 的 Boss 轮判定、`_infiniteRoutes` |
| `server/match/match/bossRounds.js` | Boss 胜利后直接进词条抉择 |
| `server/match/gamedata.js` | `baseEnemyScale` 的 `overlimit` 分支 |
| `shared/infiniteMode.js` | `enemyInfiniteScale` / `getInfiniteBossHp` |
| `server/sim/content/bonds/core.js` | 六条大盟约的 overlimit 分支 |
| `public/js/ui/traitOverlay.js` | 词条抉择界面 |
| `public/js/ui/overlimitBondText.js` | 超限盟约文案的数值分色：切段 + 强调节点（局内局外共用一份） |
| `public/js/screens/sweep.js` | 盟约报告（含超限分支） |
| `tools/bond-matrix.mjs` | 盟约 DPS 测量工具（`--fair` / `--marginal` / `--headroom` / `--solve` / `--simulate` / `--final` / `--calibrate` / `--survive`） |

---

## 七、隔离保证

**所有超限改动都 gate 在 `battle.flags.overlimit`**：

```
Match.isInfinite
  ├─ gd.overlimit          → 敌人数值表（绝境）
  └─ battle.flags.overlimit → 六条盟约的加强
```

**普通模式永远不设这个 flag**。验证方式：

```
golden（288 场景）        全 match  ← 铁证
solo_normal/hard/abyss    publicView.isInfinite = false
```

---

## 九、词条（饰品）第一批 —— 数据 / 权重 / 选取流程 / UI（业主 2026-10-31）

> 效果先留桩（`impl: 'pending'`），选中只记录、不生效；逐条实装随后补 —— **第二批已实装 A 类 29 条、
> 第三批实装 B 类 6 条、第四批把 FGO-SP 做实（36/36，`pending` 归零）＋同批造出它要发的[万色悠滞之核]，见 §9.5**。

### 9.1 数据

| 项 | 落点 |
|---|---|
| research 源（业主手写表固化） | `docs/research/23-overlimit-relics.json`（36 条：LC 7 / LC-SP 7 / LC-EX 4 / 普通 FGO 16 / FGO-Ⅹ / FGO-SP；`AN-001…014` 空占位不收） |
| FGO-SP 发的装备（第四批） | `docs/research/25-overlimit-items.json`（[万色悠滞之核]，1 条 effect + 1 条 item，`olOnly` + `shopExcluded`）→ `data/effects.json` / `data/items.json`，见 §9.5 |
| 生成物 | `data/relicsOverlimit.json`（`tools/build-data.mjs` 的 `buildOverlimitRelics`，**不手改 `data/**`**） |
| 服务端读取 | `GameData.relicsOverlimit`（`overlimit` 关着恒为 null）→ `server/match/relicsOverlimit.js` |
| 客户端 | `public/js/ui/overlimitRelics.js` + `public/css/screens/overlimitRelics.css` |

表里 FGO-10 那一行就是 **FGO-Ⅹ**（罗马数字 10），所以「普通 FGO」实到 **16 条**（01–09 + 11–17），
业主口径里的「17 条」与「池 38 条」按本表就是 16 条 / 35 条（打完 R8 实为 34 条）。权重按池子重算，条数变化自动跟随。

### 9.2 权重（每条，百分比；`data.weights` 是唯一真源）

| 组 | 每条 | 说明 |
|---|---|---|
| LC-SP1–7 | 1.8 | 显式 |
| FGO-Ⅹ | 1.5 | 显式 |
| LC-EX1–4 | 0.02 | 显式 |
| FGO-SP | 0.01 | 显式 |
| 未被选走的 LC | 1 | 显式（打完 R8 剩 5 条 = 5%） |
| 普通 FGO | `rest` | `100 − 池里显式合计`，在池里剩下的 FGO 条目中均分（**不写死 4.753%**） |

打完 R8（5 条 LC）：显式合计 19.19%，rest 80.81 → 16 条普通 FGO 每条 5.0506%（按业主的 17 条口径是 4.753%）。

### 9.3 选取流程（复用既有三选一通道，不新增协议）

| 时机 | 池子 | 实现 |
|---|---|---|
| R3、R8（正常段） | 还没选过的 LC | `MatchPhases.afterRoundStart` → `enterRelicDraft`，选完接同一回合的机变 / 整备 |
| R16+ 每个 Boss 轮之后的下一回合 | 全池 − 已选走 | `MatchBoss.afterSettle`（与既有词条抉择同一时点，先词条、再 TRAIT_DRAFT） |

阶段 = `PHASE.SP_DRAFT`（family `overlimit`），选卡 = `g.choice { idx }` → `pickCard` → `_applyCard`（词条分支只记录），
收尾 = `finishSpDraft` → `finishRelicDraft`。随机 = `createRng(deriveSeed(seed, 'overlimit-relic:<kind>:<round>:<已选数>'))`，
不消耗 `rngDraft` / `rngMeta` / `rngWaves`。**无放回、无刷新**。

`m.private.relicsOverlimit = { picked: [id], pool: [id], nextAt: [round] }`（只在超限局下发）。

### 9.4 UI

三选一浮层复用炸惊 `.zjov` / `.zjcard`（`--zj-u` 缩放同一套）：名称 / 编号 / 效果（RichText）/ 风味 / 图标占位，
`impl: 'pending'` 的卡右上角一枚极小角标（文案暂借既有 msgid `t('暂不可用')`，待业主批「未实装」后再换）。

### 9.5 实装（业主 2026-10-31 第二批 + 第三批 + 第四批）

派单口径写「A 类 26 条 / B 类 10 条」，但表里逐条点名的其实是 **29 条**（5 LC + 7 LC-SP + 4 LC-EX + 13 FGO），
B 类 **7 条**（36 − 29）。第三批把 B 类做掉 6 条；**第四批把最后一条 FGO-SP 做实（36/36，`pending` 归零）**。

| 组 | 已实装（`impl`） | 未实装（仍 `pending`） |
|---|---|---|
| LC | 001 `burn_pool` · 002 `bleed` · 003 `tremor` · 004 `doom` · 005 `breath` · 006 `charge` · 007 `rupture` | — |
| LC-SP | SP1 `stat_fund` · SP2 `gamble` · SP3 `sad_gold` · SP4 `fire_vuln` · SP5 `hp_round` · SP6 `redeploy` · SP7 `dhyana` | — |
| LC-EX | EX1 `carry_funds` · EX2 `weakness` · EX3 `price_one` · EX4 `none` | — |
| FGO | 01 `fgo01` · 02 `fgo02` · 03 `fgo03` · 04 `fgo04` · 05 `fgo05` · 06 `fgo06` · 07 `fgo07` · 08 `fgo08` · 09 `fgo09` · 11 `fgo11` · 12 `fgo12` · 13 `fgo13` · 14 `fgo14` · 15 `fgo15` · 16 `fgo16` · 17 `fgo17` · Ⅹ `fgoX` · SP `fgoSP` | — |

**B 类的落点**（全在 `server/sim/content/overlimitRelics.js`，都 gate 在 `flags.overlimit`）：

| 条 | 机制 | 落点 |
|---|---|---|
| LC-001 `burn_pool` | 目标在[灼燃爆发]期间，我方伤害 50% 记进一条与爆发同寿的记分 buff；`onExpire` 一次性结算无来源法术伤害（封顶 99,990,000）并挂 防御 −15%（整场、不叠） | `damaged` priority 62 + `addBuff{onExpire}` |
| LC-003 `tremor` | 我方每对敌方施加 1 个负面（`statusApplied`）→ [震颤] +1 层；满 20 层清空并 +1 层[震颤爆发]（防御 −30% / 法抗 −20 / 受伤 +10%，`refresh:'stack'` 最多 5 层） | `statusApplied` priority 50 |
| FGO-01 `fgo01` | 全体敌方[篡改过去]（共享键、persist）+ 攻击 +30% + 对其伤害 +50% + 每次技能返还 20% 技力（`skillStart`，技力已扣之后） | `enemySpawn` / `hit` 5 / `skillStart` |
| FGO-03 `fgo03` | [死之渊] 标记 + 攻击 +70%（独立 buff）+ 首次被击倒 `reviveNow` 并摘掉这一场的状态（`mem.olAbyssOff`） | `death` priority **11.6**，排在 LC-SP6 的 11.5 之前 |
| FGO-06 `fgo06` | 攻击普通/精英 5%/2.5% 直接斩杀（`battle.kill`，Boss 不触发）+ 普攻 50% 回 1 技力 + 有其它暴击饰品时暴伤 +50% | `hit` priority 45 / `attack` / `critMul` |
| FGO-13 `fgo13` | 攻击 +50% + 技能伤害 +100% + 每次攻击 5% 强制眩晕 5 秒（force + resistApplied，免疫/抵抗都不减免），第 10/20/30… 次改 20 秒睡眠 | `attack` priority 40 / `hit` 5 |
| FGO-SP `fgoSP` | 整备期发一件[万色悠滞之核]（`ctx.grantItem`，一局一次）；携带它的干员 攻击 +50%，并声明[调和]成员资格（`u.mem.extraBonds` → `support.unitBonds`） | `registerMeta.onPrepStart` + `syncUnit` |

**FGO-SP 与它要发的[万色悠滞之核]（第四批）**：装备原先在本版数据里不存在（官方 act1/act2 的装备表都没有），
所以按湮灭 mod 的盟约奖励装那条范式，从 `docs/research/25-overlimit-items.json` 手写一条 effect + 一条 item，
由 `tools/build-data.mjs` 的 `applyOverlimitItems` **纯加法**并进 `data/effects.json` / `data/items.json`
（`olOnly: true` + `shopExcluded`：商店与装备池都抽不到，只能由这条词条发）。装备记录 id `chess_item_ol_01_e_a`、
名字[万色悠滞之核]、tier 6、永不合体（`upgradeNum: 100`）；**[ASSUMED]** 贴图复用变形同构体的图标
（`trap_1073_acarm073`，词条表只说「贴图从变形同构体改」，本仓没有那张改色图）。数值不写在装备记录里
（`buffs` 为空，与变形同构体同形），只由 `server/sim/content/overlimitRelics.js` 的 FGO-SP 分支给，避免两处各加一遍。

**[ASSUMED]**：「视作拥有[调和]盟约」不走装备记录的 `giveBondId`（那条路要求同时挂着变形同构体），而是由词条在
战斗侧把 `maniShip` 写进 `u.mem.extraBonds`（`support/index.js` 的 `unitBonds` 认这份名单，`isMember` / `bondMembers`
因此为真）。成员资格是**战斗期声明**：整备期的调和层数（`bondsMeta.pieceBonds`）不会因这件装备 +1。

**落点**

| 半边 | 文件 | 说明 |
|---|---|---|
| 状态 / 失效 / 战斗输入 | `server/match/relicsOverlimit.js` | `activeRelicIds` / `invalidatedRelicIds` / `overlimitBattleList` / `overlimitKeepsFunds` |
| 选中即到账 | `server/match/match/relicDraft.js` | LC-SP1 的 +10 资金（每名存活玩家） |
| 战斗输入 | `server/match/player/round.js` | `battleInput().relicsOverlimit = [{ id, at }]`（`at` = 选走它的回合；只在超限局、至少一条时出现） |
| 跨回合经费 | `server/match/player/round.js` `endPrep` | LC-EX1：保留 150%（`floor(funds × 1.5)`） |
| 整备期钩子 | `server/sim/content/overlimitRelics.js` `registerMeta` | FGO-09/14 每回合资金、FGO-17 每回合 2 次免费刷新、LC-EX3 干员价格改 1（全局 handler 排在盟约之前，远见仍可减到 0）、**FGO-SP 发放[万色悠滞之核]**（`ctx.grantItem`，`onPrepStart`，玩家计数器去重） |
| 词条发的装备 | `docs/research/25-overlimit-items.json` → `tools/build-data.mjs` `applyOverlimitItems` | `data/effects.json`（`eff_ol_core`）+ `data/items.json`（`chess_item_ol_01_e_a`），`olOnly`，商店不卖 |
| 战斗侧 | `server/sim/content/overlimitRelics.js` | 全部战斗效果；注册在 `content/index.js` 的 `DOMAIN_NAMES`（`overlimitRelics`） |

**失效条款**（表里两句）：`FGO-11` 被 `FGO_X` 顶掉、`FGO-13` 被 `FGO-09` 顶掉。失效发生在取用侧，
`picked` 记录 / 档案 / 词条页仍显示它们。

**复用**（不造平行系统）：`directMods` / `passiveBuff`（属性）、`hit` 改 `dmg.mul`（伤害与暴击）、
`addShieldLayer`（次数盾）、`spRecoveryFlat` / `gainSp` / `spCostMul`（技力）、`defIgnorePct` / `resIgnorePct`（无视防御法抗）、
`dmg.dodgeMode='ignore'`（无视闪避）、`weaknessRetype`（弱点伤害）、`applyStatus('fear')`、`dealDamage({type:'true', sourceless})`、
`reviveNow`（立即重部署，`death` priority 11.5 = 在不屈的 10 之前）、`battle.kill`（FGO-06 直接斩杀，与 `attack/health.js`
同一落点）、`statusApplied`（LC-003 数负面施加）、buff 的 `onExpire`（LC-001 爆发结束时结算）。

**[ASSUMED]**：暴击基础倍率 ×2（沿用锻造器），FGO-05 的「180% 暴击伤害」按替换读；LC-002 的防御 −20% 按每层；
LC-004 的「免疫负面」= 敌人免疫表里有任一负面项、额外 +10% 按「同一攻击者挂过负面」认；FGO-11 恐惧 5 秒；
「每次释放技能后」按 `skillStart`；LC-005 清空层数的那一下不再掷「20% 获得 1 层」；LC-EX1 的「每拥有一个饰品」
按生效条数（含自身）；「我方单位」= 干员（op），召唤物不单独挂。
B 类另加：LC-001 的记分 buff 与爆发同寿（第一次命中时对齐剩余时间）、「防御力 −15%」整场不叠；LC-003 一次施加
连带多条状态（寒冷→冻结）按每条 `statusApplied` 各计 1 层、爆完清空层数；FGO-06「攻击」按每次命中判一次（技能
命中也算）、Boss 不触发；FGO-13「每次攻击」含技能攻击、第 10 次起每 10 次改睡眠；FGO-01「返还 20% 技力」=
技能消耗 × 20%；FGO-03「清除该回合的此状态」= 这一场（一场就是一回）不再有[死之渊]。

**测试**：`test/content/overlimit_relics_effects.test.js`（36 条逐条数值 + 两条开关回归）、
`test/match/overlimit-relics.test.js`（数据 / 失效 / battleInput / 整备侧）。

### 9.6 负面词条（第二批）—— 触发 / 档位 / 权重与放回（业主 2026-10-31 第三单定稿）

表：`docs/research/24-overlimit-negative-relics.json` → `data/relicsOverlimitNegative.json`（**17 行**：D01–D15 +
D16A/D16B 蜚蠊那对；业主按「攻击害虫 / 防御害虫」合并算 16 项）；效果在 `server/sim/content/overlimitNegative.js`，
两条池子逻辑在 `server/match/relicsOverlimit.js`，落账在 `server/match/match/relicDraft.js`。两个池子与 36 条饰品
**互不混**（两个键、两条随机流、两套「已选走」），全部 gate 在超限局。

**A. 档位按回合过滤（不是抽到该条时随机取一档）**

| 触发点 | 候选 |
|---|---|
| R5、R11 | **只用 Ⅰ 档**（`LC-D01…D08` 这 8 条；无挡位条目**不在**这两个池子里） |
| 无限段 R50 之前 | **Ⅱ 档 + 无挡位条目** |
| 无限段 R50 之后（含 R50） | **Ⅲ 档 + 无挡位条目** |

判据入口 = `negativeTierIndexForRound(round)`（回合 → 0/1/2）与 `negativeTierOf(entry, round)`：同一回合永远同一档，
不掷骰。所以 D01（「我方每回合发放的经费 −2 / −4 / −6」）在 R5 = −2、R45 = −4、R55 = −6。

**B. 权重与放回**

| 类型 | 权重 | 抽中后 |
|---|---:|---|
| 有挡位（Ⅰ/Ⅱ/Ⅲ） | **1.0** | **留在池里**，可反复抽（跨阶段再抽到 = 升到更强的那一档）；**同档已拥有不再进候选**（B′，见下） |
| 无挡位 | **0.5**（有挡位的一半） | **移出池子**，本局不再出现 |

同一次三选一的三张仍互不相同、不加刷新。`data/relicsOverlimitNegative.json` 里每条 `weight: 1` 只是生成期占位
（表里没有权重列），真正的抽取权重由 `negativeWeightOf` 按「有无档位」给出。
`[ASSUMED]`①：同一条有挡位词条再次抽中时不叠加两份，而是把档位升到更高的那一档（Ⅱ 期抽过 D01 = −4，Ⅲ 期又抽到
= −6 覆盖前值，记录仍只有一条）；同档 / 更低档按「已拥有」处理，不改数值。

**B′. 空选修复（业主 2026-10-31 第四单）**：有挡位条目「留在池里」不等于「同档还能再抽到」——R5 选走 D01(Ⅰ) 后，
R11 的池子仍是 Ⅰ 档，若 D01 再出现，`takeNegativeRelic` 只会按「已拥有」回 false，玩家点了等于空选。所以
`negativePool` 在候选里剔除「已拥有且本次档位 ≤ 已拥有档位」的条目（`picked` 现在收 `{ id, tier }` 原样形状，
`relicDraft.enterRelicDraft` / `relicsOverlimitView` 都传 `negPicked`）；**更高档仍可出现**，用于升档覆盖
（Ⅰ 已拥有 → R45 的 D01@Ⅱ 仍在候选里）。纯 id（没档位）无从判断，沿用旧口径留在池里。
守卫：`test/match/overlimit-negatives.test.js` →「空选修复 B′…」+ 真实对局 R5→R11 的三张不含 R5 选走的那条。

**C. 无限段相位 = 按 Boss 轮交替**

| 上一 Boss 轮 | 三选一回合 | 池子 |
|---|---|---|
| R20 / R30 / R40 | R21 / R31 / R41 | **负面** |
| R25 / R35 / R45 | R26 / R36 / R46 | **饰品** |

落点 `NEGATIVE_EVEN_MODE = 'boss'`（`isNegativeInfiniteRound`）；8 次无限三选一里负面恰 4 次。
`[ASSUMED]`②：池子是全队共享的，所以「无挡位抽出即移出」= 移出全队后续候选；D16A / D16B 与其它无挡位条目同待遇
（0.5 权重、抽中一次即出池），它们互相点名的「同时拥有…翻倍」只在战斗侧生效。

**测试**：`test/match/overlimit-negatives.test.js`（档位 / 权重 2:1 大样本 / 放回 / 相位 R21·R26 / R41 与 R51 的档位）、
`test/content/overlimit_negatives_effects.test.js`（17 条逐条数值 + 两条开关回归）。

### 9.7 局外图鉴：S.W.E.E.P. 词条页的两段（业主 2026-10-31 第四单）

`public/js/screens/sweep.js` 的 `RelicsTab` 现在是**两段**：`词条`（36 条饰品，现状）+ `负面词条`
（`data/relicsOverlimitNegative.json` 的 17 条），各自按自己的表、自己的顺序、自己的计数（`Section count`）；
版式同一套 `sw-sec / sw-tile / sw-detail`，负面瓦片只多 `sw-disc--neg` / `sw-tile--neg` 两个修饰类，圆环与编号
用既有的 `neg` 分组色（`#ff4d4d` / `#ff8a8a`，与 `ui/overlimitRelics.js` 的浮层、已选面板同一套，`css/screens/sweep.css`）。
**不新增 msgid**：第二段的段名用既有的 `t('负面词条')`（四语包都有）；「饰品」这个字面量四语包里没有，本轮没有新增。
守卫：`test/ui/overlimit-relics.test.js`（两段 36 / 17、顺序不串、图标或首字回落、四语包键存在）。

---

## 八、提交记录（超限相关，倒序）

```
7eff8d0a  当前效果 = 公式代入层数
42b86041  局内盟约详情用超限文本
a9fcd4a8  「已选择」改底部横幅
e8b426fb  萨尔贡娜仁图亚 +6%/层
af54649b  维多利亚锤子 30 件封顶
24d7718d  六条文本写入公式
1a121461  炎 +15% 生命
8dfd8ae8  七类选 3 + 2 倍速 + 炎/萨/维文本
f7f3fbfe  敌方预览显示实际数值
582cdf70  三条文本分块
7872f201  局内文本与 sim 一致
8f2a3ffa  五条盟约加强
dc9be58f  Boss 轮 = 普通轮 + 领袖
4f626220  Boss tag:'boss' 修复
9a148541  4-5 地面 / 2-3 飞行
b0da0a97  鸭爵套牌全排除
4535ce3c  鸭爵/炎佑 + 上下路
e74550ff  Boss 组件 + 飞行路径 + 纯指数
b168954d  Boss 随从 tag + 时间限制
a0f6e50f  怪池 104 + Boss 随从 + 横幅
```

# 超限盟约 V2 · 改法定稿（六条 + S.W.E.E.P. 改名）

> 日期：2026-10-31　｜　范围：`E:\Workbox\系统`　｜　性质：**只读定稿**（本轮未改任何源码/数据/测试，无 git 写操作）
> 产出：本文件。所有「精确改法」都是**待业主确认后**才落地的补丁草案（行号按当前工作区 `HEAD` 状态核过）。
>
> 业主原话（六条 + 一条改名，逐条对应 §3）：
> 1. 萨尔贡：把攻击力上限去掉　2. 维多利亚 和 炎：加个生命值提升　3. 卡西米尔：把攻击力乘区翻倍
> 4. 阿戈尔：吞噬时继承 25% 攻击力　5. 谢拉格：6 人冰冻时间锁为 20 秒，寒风根据层数，每层给个 400 真伤
> 6. 拉特兰：锁 600 子弹上限，攻击力提升上限去掉　7. S.W.E.E.P. 盟约报告里的名字改为「XXX 超限」（仅超限视图）
>
> 纪律自检：未新增 `t('…')` / msgid（§4 给的是**拼接**做法）；未改 `data/** public/** server/** test/**`；探针脚本写在
> 系统临时目录（`%TEMP%\ol-probe.mjs`）并已按名删除，仓库内零残留；全程无 `git` 写操作。
>
> **读法**：§0.1 是「原话 → 代码事实」的核对；§0.2/§0.3 是两套口径（原话字面 vs 记忆里的「七盟约定稿」）；
> §1 总表；§3 逐条补丁；§4 S.W.E.E.P. 改名；§5 测试；§6 文本/文档同步；§7 [ASSUMED]；§8 探针原文。
> 若业主已按 §0.3 定稿，那么 §3.2.2 / §3.3 / §3.4 / §3.7 的**主方案**就是定稿口径，「备选」备注可以删。

---

## 0. 结论摘要（先看这一节）

### 0.1 六条里「机制其实不存在 / 已经在上一轮做过」的三种情况（必须先说清）

| 业主的说法 | 代码事实 | 处理 |
|---|---|---|
| 萨尔贡「攻击力上限」 | **不存在**任何 `max_atk*` 判据。萨尔贡的 ATK 上限来自**叠层上限** `max_buff_stack_cnt = 25`（`core.js:243` 读它当 `maxStacks`；每层 `base_atk=0.12` ⇒ `+300%`，`core.js:244/261`）。攻速用的是**同一个**叠层上限（+12×25 = +300）。 | 见 §3.1：超限把 `maxStacks` 抬到 9999（同时放开攻速，**必须让业主点头**）。炸惊（zj）块早已这么干过（`sargonShip.zj.bb.max_buff_stack_cnt=9999`），本次只是把同一手法搬到超限。 |
| 维多利亚 / 炎「加个生命值提升」 | **炎已经有**（2026-10-19 落地）：`YAN_HP_BASE=0.15` + `0.002/层`，gate 在 `flags.overlimit`（`core.js:190–199`；探针实测 L=30 时 `hpPct=0.21`，普通局无该键）。**维多利亚没有任何 hp 通道**（`installVictoria` 只有 `dmgDealtMul` 与 `atk`，探针实测六人无装备时 buff 列表为空）。 | 见 §3.2：维多利亚**新增**一条 hp 通道（每层 0.2%）；炎**一行不用改**，只剩「那个 +15% 基座要不要收」的确认。 |
| 卡西米尔「攻击力乘区」 | 没有「×乘区」这种东西。`bb` 里 `atk_when_born=0.2`（每次部署 +20%）与 **上限** `base_max_atk_when_born=0.5` + `max_atk_when_born_per_stack=0.01`（封顶 `0.5+0.01×L`），两者都是**直接乘算的 atkPct**（`core.js:773–778`）。业主在别处看到的 `1+0.25+0.01L` **不是卡西米尔**，是另一条盟约【突袭】`raidShip`（`data/bonds.json` → `raidShip.bb`）。 | 见 §3.3：定稿口径要求**两条都翻倍**——部署侧改 `core.js:773–778`，突袭侧改 `bonds/addon/battle.js:166/187–195`（§3.3-B）。 |

另外两处版本性事实，写进任何落地单之前都要知道：

- **`data/bonds.json` 是单行压缩 JSON**，没有「第 N 行」；本文件用 JSON 指针引用（如 `yanShip.bb.base_atk`）。
- **`public/sim/` 是被 git 跟踪的过期镜像，`/sim/` 实际由 `server/sim/` 提供**（`server/http/static.js:144`；`handoff/EXTENSION-MODE-2026-10-28.md:240`）。本批改动**只改 `server/sim/**`**，不要顺手跑 `tools/sync-static-web.mjs`（它会把 296 个镜像文件一起写脏）。

### 0.2 需要业主先拍板的数（其余按 [ASSUMED] 默认值可先落地）

| # | 待确认项 | 默认（[ASSUMED]） | 一句话影响 |
|---|---|---|---|
| Q1 | 萨尔贡去上限：只去 ATK，还是连攻速一起放开？ | 连攻速一起（同一叠层） | 只去 ATK 需要改 buff 结构，复杂且与炸惊口径不一致 |
| Q2 | 维多利亚生命值提升的形态 | 每层 `+0.2%`（`hp = 0.002×L`），3 人档起 | 若改成「固定 +30%」，L=0 就有收益；按 §0.3 的记忆口径是每层 0.2% |
| Q3 | 炎的生命值要不要动 | 不动（现有 `15% + 0.2%/层` 已含「每层 0.2%」） | 它上一轮已落地，业主这次可能只是没记住 |
| Q4 | 卡西米尔的「乘区」是否含【突袭】那条 | **含**：部署乘区 + 突袭乘区都 ×2（§0.3） | 突袭是**另一条盟约**（`raidShip`），要改的是 `bonds/addon/battle.js:187–195` |
| Q5 | 阿戈尔「25%」的真意 | **不是削弱**：吞噬仍全额继承，另按层 `+0.25% 基础攻击力`（§0.3） | 两种读法差一个「削/增」方向，必须二选一 |
| Q6 | 谢拉格 400 真伤打谁：全场敌人，还是只有被寒风挂上寒冷的 | **全场存活敌人** | 超限的 `ccResist` 会吃掉大部分寒冷，只打命中者 ⇒ 伤害常年为 0 |
| Q7 | 拉特兰「600 子弹上限」是保持现状还是也放开 | 保持现状（已经是 600） | 业主原话是「锁 600」，与现状一致 |
| Q8 | 叙拉古三条（3%→10%、+0.2% 当前生命、3 人档 +0.1%/层）是否同批落地 | 见 §3.7（**不在本次六条内**，按记忆口径与六条同批） | 记忆口径里它和六条是一批；本次任务书没列它 |

### 0.3 业主后续口径（**跨会话记忆**，落笔前请业主在本文上打勾）

> 来源：`dsh-mneme` 记忆「超限七盟约最终数值口径」（记录为「用户定稿」）。它**晚于**本节开头引用的原话，但**不是**本次
> 任务书里的原文，所以单列一节：若业主确认，则 §3 各条的默认值按本表覆盖；若不确认，就按 §3 的 [ASSUMED] 走。
>
> ⚠️ 两处**语义冲突**必须先解：阿戈尔（削弱 vs 增强）、卡西米尔（是否动【突袭】）。

| 盟约 | 记忆里的定稿口径 | 与本文 §3 默认值的差异 | 落地影响 |
|---|---|---|---|
| 萨尔贡 | 去掉 6 人档攻击力 `+300%` 上限 | 一致（§3.1） | 无 |
| 维多利亚 | **每层 +0.2% 生命值** | 与 §3.2.2 主方案一致（该节已按本口径写；固定 `+30%` 只作为备选留在文末） | 无需再改 |
| 炎 | **每层 +0.2% 生命值** | 与现状一致（`YAN_HP_PER_STACK = 0.002`），但会**丢掉**现状的 `+15%` 基座 | 二选一：保持 `0.15 + 0.002L`（现状）或改成纯 `0.002L`（若「基座 15%」是上一轮自己加的、这次要收掉） |
| 卡西米尔 | 攻击力乘区**部署与突袭两条都全翻倍** | §3.3 默认只动部署；**突袭是另一条盟约** | 额外改 `bonds/addon/battle.js:187–195`（`raidMods`），见 §3.3-B |
| 阿戈尔 | 吞噬**仍继承基础攻击**，并**额外每层 +0.25% 基础攻击力** | 与原话字面「继承 25%」方向相反（那个读法作为备选留在 §3.4-B） | 主方案见 §3.4-A（`atkFinal` 追加 `0.0025×L×base.atk`），吞噬继承部分**一行不动** |
| 谢拉格 | 6 人档冰冻锁 20 秒；寒风每层每次命中追加 400 真伤 | 一致（§3.5） | 无 |
| 拉特兰 | 保留 600 子弹上限；去掉消耗子弹叠攻的上限 | 一致（§3.6） | 无 |
| 叙拉古 | 真伤触发 3%→10%；补 0.2% 当前生命值真伤；3 人档补 0.1%/层 攻击力 | §3.8（附录，本文原范围外） | 见 §3.8 |

---

## 1. 六条总表（现状值 → 目标值 → 落点 → 待确认）

| # | 盟约 | 现状（键 / 值 / 落点） | 目标（超限） | 改动落点 | 待确认 | 规模 |
|---|---|---|---|---|---|---|
| 1 | 萨尔贡 `sargonShip` | 叠层上限 `max_buff_stack_cnt=25` ⇒ ATK `+12%×25=+300%`、ASPD `+12×25=+300`。`core.js:243`（`maxStacks`）、`core.js:244`（`perAtk=0.12`）、`core.js:260–262`（写 `bond:sargon:atk`）。另：每 100 盟约层 `+5%` ATK（`core.js:245–253`，已 gate） | 上限取消（叠层至 9999）⇒ ATK 随叠层线性上升 | `core.js:243` 一行 | Q1 | 1 行 |
| 2a | 维多利亚 `victoriaShip` | **无 hp 通道**。只有 `dmgDealtMul = 1.25+0.008L`（需携带装备，`core.js:314–320`）与 6 人 `atk +50%/件`（`core.js:323–331`）。溢出：750 层后每 50 层 +1% 伤害（已 gate） | 新增 `hp = 0.2%/层`（§0.3）或固定 `+30%` | `core.js:314–320` 的 `apply()` 内新增 3–5 行 | Q2 | 小 |
| 2b | 炎 `yanShip` | **已有**：`hp = 0.15 + 0.002×L`，gate 在 overlimit（`core.js:190–199`，常量 192–193） | 不动（或按 §0.3 收掉 15% 基座） | 同上（只改常量 192–193） | Q3 | 0–2 行 |
| 3 | 卡西米尔 `kazimierzShip` | `atkPct = min(0.5+0.01L, 部署次数×0.2)`（`core.js:773–778`；`bb.atk_when_born=0.2`、`base_max_atk_when_born=0.5`、`max_atk_when_born_per_stack=0.01`） | ×2（每次部署 +40%，上限 `2×`） | `core.js:773–778`（`apply()`） | Q4 | 2–3 行 |
| 3b | 突袭 `raidShip`（§0.3 追加） | `raidMods`：`atk = 0.25 + 0.01×L`、`hp = 0.25 + 0.01×L`（`bonds/addon/battle.js:187–195`，调用点 `:166`） | ×2 | `bonds/addon/battle.js:166 + 187–195` | Q4 | 3 行 |
| 4 | 阿戈尔 `egirShip` | 吞噬**全额**继承被吞噬者基础攻击力（`atkFinal = Σ t.base.atk`，`core.js:541–548`；注释 475–477 说明它是「最终加算」）。实测：两名 1000 攻被吞 ⇒ `atkFinal=2000` | 继承不变 + 每层 `+0.25% 基础攻击力`（§3.4-B） | `core.js:586–596` 的 `apply()`（新增 `atkFinal`），`core.js:542` 不动 | Q5 | 3–4 行 |
| 5 | 谢拉格 `kjeragShip` | 寒风每 25 s 一阵（`bb["bond_eff_kjerag[storm].interval"]=25`），寒冷时长 `20+0.1×L`（`.base_time=20`、`.time_per_stack=0.1`，`devices.js:172–178`）；**冻结时长 = max(剩余寒冷, 新寒冷) = 20+0.1L**（`server/sim/battle/status.js:218–243`；L>50 起才会冻，实测 L=60 ⇒ 25.73 s、L=300 ⇒ 49.73 s）。寒风**当前 0 伤害** | 冻结锁 20 s；每阵风每层 400 真伤 | `core.js:337–351`（新增 beforeStatus clamp + 传参）＋ `devices.js:140–178`（新增 `onGust`） | Q6 | 中（约 25 行） |
| 6 | 拉特兰 `lateranoShip` | 弹药 600 层封顶**已实现**（`core.js:364–368`，`Math.min(600, layers)`）；ATK 上限：`cap = overlimit ? 7 : bb.max_atk_for_consume(2)`（`core.js:389–391`），每发 `0.04×2 = 8%` | 弹药封顶保持；ATK 上限取消（`Infinity`） | `core.js:391` 一行 | Q7 | 1 行 |
| 改名 | S.W.E.E.P. 改名 | 超限视图目前把 5 条换成占位块（`sweep.js:54–55, 245–252`），名字取 `b.name`（`sweep.js:187, 250`）；详情页 `Hero` 名字取 `bond.name`（`sweep.js:211`） | 超限视图里被改写的盟约显示「XXX 超限」 | `sweep.js` 三处渲染 + 一个 helper | 受影响名单（见 §4.2） | 小 |
| 附录 | 叙拉古 `siracusaShip`（§0.3 追加） | 触发 `0.08`（`core.js:732–734`）；真伤 `5000+50L + 0.5% 目标最大生命`，精英/首领 ≤250 万（`core.js:746–754`）；6 人档才有（`core.js:731`） | 触发 10%；改「0.2% 当前生命」；3 人档 +0.1%/层 ATK | `core.js:733` / `746–754` / `731` 之后 | Q8 | 中 |

---


## 2. 机制前提（落地前必读）

### 2.1 `flags.overlimit` 是谁点亮的

- `Match.isInfinite` → `new GameData(..., { overlimit: true })`（`server/match/Match.js:359–362`，`server/match/gamedata.js:238–241`）。
- 三类战斗都会带上这个 flag：普通 `server/match/match/combat.js:119`、联防 `server/match/match/unitePhase.js:68`、Boss
  `server/match/match/bossRounds.js:155`。所以「gate 在 `battle.flags.overlimit`」在三种战斗里都成立。
- 同一条链还装了 `installInfiniteRule`（`combat.js:36` → `server/sim/infiniteRule.js`）：**控制类状态**（含 `cold`/`freeze`）
  有 `ccResist` 概率抵抗，精英/Boss 还有「10 s 窗口内累计受控 6 s ⇒ 4 s 霸体」的防木桩。§3.5 的谢拉格数值必须把它算进去
  （冻结的**名义**时长锁 20 s，实战时长通常远小于此）。
- 全局超限伤害规则：单次伤害在 `BOSS_HIT_LIMIT_INFINITE = 9_999_999_999` 处封顶（`public/sim/damage.js:452–455`）。
  §3.5 的 400×L 在可预见层数内远达不到，不需要额外处理。

### 2.2 炸惊（`zj` 覆盖块）与超限是两套东西，**不要混用**

`data/bonds.json` 里每条盟约可能有 `zj` / `ann` 覆盖块，由 `shared/zjBonds.js` 只在对应难度下合并（`gamedata.js:304–315`）。
超限（`solo_infinite` / `coop_infinite`）**不吃**这些块。所以：

- 不能靠改 `data/bonds.json` 的 `zj` 块来实现超限（既是数据文件——不许手改，也不在超限的合并路径上）。
- 反过来，`zj` 块里有些**数据声明但代码没实现**的键（`egirShip.zj.bb.zj_devour_cur_atk`、`kjeragShip.zj.bb[...damage_value]`
  = 2000+50L 的寒风真伤），别照抄——那是数据/代码漂移，`zj_` 键在 `core.js`/`devices.js` 里根本没有读取点。

### 2.3 数值常量放哪

`data/**` 本轮不许改，所以新增数字一律写成 `core.js` / `devices.js` 里的具名常量（仓库既有风格：`YAN_HP_BASE`、
`OVERFLOW_STEP`、`HAMMER_CAP_LAYERS`、`BLAST_EVERY`），并在注释里写「业主 2026-XX-XX（超限 V2）」+ 待确认标记。

### 2.4 「第三格挂件」的风险基线（引用既有实测，不必重跑）

`handoff/OVERLIMIT-ANCHOR-FINAL.md` §6.1 的「作为第三格挂件」倍数（同一 harness、官方池、合法摆位、R40 中位）：

| 盟约 | 挂件倍数 | 原始 R40 中位 | 本批改动会不会被挂件蹭到 |
|---|---:|---:|---|
| 维多利亚 | ×2.16 | 526k | 会：3 人档就生效（新增 hp = 0.2%/层） |
| 炎 | ×2.32 | 526k | 会：hp 本来就是 3 人档（本轮不动） |
| 萨尔贡 | ×0.99 | 389k | **不会**：ATK 只在 6 人档（`reached(..., 6)`） |
| 谢拉格 | ×0.99 | 370k | **不会**：寒风只在 6 人档；但**阵风打全场敌人**，联防里队友也吃伤害收益 |
| 拉特兰 | ×0.85 | 340k | **不会**：6 人档 |
| 阿戈尔 | ×0.73 | 319k | 会（定稿口径下是**正向**）：`installEgir` 在 3 人档就装，每层 0.25% 同样作用；若走「砍到 25%」的备选则变成负向 |
| 卡西米尔 | ×0.63 | 374k | 会：部署乘区在 3 人档就生效（`installKazimierz` 无 6 人门） |
| 突袭（§0.3 追加） | —（不在 13 条挂件表里） | — | 会：`raidShip` 2 人档就装，×2 后当挂件也翻倍 |

> 结论：会被第三格蹭到的是 维多利亚、炎、卡西米尔、突袭（都是纯增益）、阿戈尔（定稿口径下也是增益）。
> 只有「阿戈尔砍到 25%」那个备选会把挂件变弱，落地时按 Q5 的答案决定要不要提前说明。


---

## 3. 逐条详情

> 每条格式：**现状（带行号/键/实测）→ 目标 → 精确补丁 → 落地注意 → 影响面**。
> 所有补丁都以 `const INF = !!(battle.flags && battle.flags.overlimit);` 为门（与 `core.js:195/251/310/360/374/589/666/733/746`
> 现有写法一致）。

### 3.1 萨尔贡：去掉攻击力上限

**现状（已核）**

| 位置 | 内容 | 当前值 |
|---|---|---|
| `core.js:243` | `const maxStacks = Math.max(1, Math.floor(num(main.max_buff_stack_cnt, 25)));` | `25`（`data/bonds.json` → `sargonShip.bb.max_buff_stack_cnt`；娜仁图亚档 `sargonShip.bb` 的同名键也是 25） |
| `core.js:244` | `const perAtk = num(bb.base_atk, 0);` | `0.12`（`sargonShip.bb.base_atk`） |
| `core.js:260–262` | `bond:sargon:atk` = `perAtk × n × scale` | `n ≤ 25` ⇒ **`+300%` 封顶** |
| `core.js:264–280` | `addBuff(..., { key:'bond:sargon', maxStacks, mods:{ aspd: 12 } })` | ASPD 也被同一个 25 卡住 ⇒ `+300` 封顶 |
| `core.js:245–253` | `overflowAtk()`：每 100 盟约层 `+5%` ATK（已 gate） | 与叠层无关的额外通道，**保留** |

> 探针实测（40 次 `skillStart`，L=40）：普通局 `stacks=25, atkPct=3.0`；**带上 `overlimit` 仍然** `stacks=25, atkPct=3.0`
> —— 现状超限**没有**放开这个上限（放开它的只有炸惊的 `zj` 块）。

**目标**：超限局取消上限，ATK 随叠层线性上升（叠层仍受「每层独立计时 5+0.22L 秒」约束，等于靠技能频率堆）。

**精确补丁（`core.js:243`）**

```js
  // 业主 2026-10-31（超限 V2）：「萨尔贡把攻击力上限去掉」。上限就是这里的叠层上限
  // （max_buff_stack_cnt 25 → 每层 +12% ⇒ +300% ATK、+300 ASPD）。超限局抬到 9999，
  // 与炸惊 zj 块同一个数；普通 / 湮灭 / 炸惊的一帧不变。
  const INF_OL = !!(battle.flags && battle.flags.overlimit);
  const maxStacks = INF_OL ? 9999 : Math.max(1, Math.floor(num(main.max_buff_stack_cnt, 25)));
```

**落地注意**

1. 这一行同时放开**攻速**（同一个 buff 的 `maxStacks`）。Q1 若答「只去 ATK」，得改成「攻速 buff 保持 25 层 + 另发一条无上限的
   ATK buff」，与炸惊口径分叉，不推荐。
2. 娜仁图亚档（`main = share`）自动同享，ATK 是 `+6%/层 × n`（`NARANT_ATK_SCALE=0.5`，`core.js:239`）——Q1 一并确认。
3. 叠层 buff 数量上限从 25 → 9999，单场 buff 数组会变长（炸惊已长期跑 9999，性能可接受；但超限 + BOSS 长时战要留意）。

**影响面**：`bond:sargon:atk` 是成员自身的 `atkPct`，不外溢；普通模式 / golden 不动（无 `overlimit` 的 golden 场景，§5.1）。

---

### 3.2 维多利亚 + 炎：生命值提升

#### 3.2.1 炎（**已有**，只需决定是否上调）

| 位置 | 内容 | 当前值 |
|---|---|---|
| `core.js:192` | `const YAN_HP_BASE = 0.15;` | `+15%` |
| `core.js:193` | `const YAN_HP_PER_STACK = 0.002;` | `+0.2%/层`（30 层 = `+21%`） |
| `core.js:195–199` | `...(inf ? { hp: YAN_HP_BASE + YAN_HP_PER_STACK * L() } : {})` | 只在 `flags.overlimit` 下发 |

探针实测：L=30，`overlimit` ⇒ `hpPct=0.21`；普通 ⇒ 无 `hpPct`（键不存在）。
`docs/OVERLIMIT-PROGRESS.md:120` 也记着这一行。

**结论**：按 §0.3 的定稿口径「维多利亚 / 炎 各 +每层 0.2% 生命值」，**炎这一条已经满足了**（`YAN_HP_PER_STACK = 0.002`
就是每层 0.2%），落地时**一行都不用改**。唯一要业主点头的是：现状在每层 0.2% 之外还多一个 `+15%` 基座——

- **保持**（默认）：`hp = 0.15 + 0.002L`，L=0 时也有 15%。
- **收掉基座**：常量化成 `YAN_HP_BASE = 0`（改 `core.js:192` 一个数），L=0 时 0%、L=30 时 6%。同时
  `public/js/ui/richText.js:184–187` 的 `bb.__yan_hp = 0.15` 与 `overlimitBondText.js:16` 的 `(15+0.2×层数)%` 要跟着改（§6）。

#### 3.2.2 维多利亚（**新增**，当前完全没有 hp 通道）

| 位置 | 内容 | 当前值 |
|---|---|---|
| `core.js:314–320` | `apply()` 只发 `bond:victoria` = `{ dmgDealtMul: 1.25 + 0.008L + overflow }`，且**要求携带 ≥1 件装备** | 无 hp |
| `core.js:323–331` | 6 人档：`bond:victoria:atk` = `+50%/件`（进阶 `+80%`） | 无 hp |

探针实测：6 名无装备成员 ⇒ `u.buffs` 为空（`dmgDealtMul` 那条也没发），确认**没有任何 hp 键**。

**目标（§0.3 定稿口径）**：超限局 `hp = 0.2% × 层数`（与炎同一条每层项，不给固定基座），随层刷新。

**精确补丁（`core.js:314–320`，直接并进现有 `apply()` —— 它已经挂在 `onLayers` 上，层数一变就刷）**

```js
  const apply = () => {
    const layers = S.bondLayers(battle, pid, 'victoriaShip');
    const mul = num(bb.base_damage_scale, 1) + num(bb.damage_scale_per_stack, 0) * layers + overflowMul(layers);
    for (const u of members) {
      if (S.itemsOf(u).length >= 1) S.passiveBuff(battle, u, 'bond:victoria', { dmgDealtMul: mul });
      // 业主 2026-10-31（超限 V2 定稿口径）：「维多利亚 / 炎 各 +每层 0.2% 生命值」。
      // 本条此前**完全没有 hp 通道**（上面那条 dmgDealtMul 还要求携带装备）。超限局补一条纯每层项（无基座），
      // 与炎的 YAN_HP_PER_STACK 同一个数（core.js:193）。普通 / 湮灭 / 炸惊一帧不变。
      if (battle.flags && battle.flags.overlimit) {
        S.passiveBuff(battle, u, 'bond:victoria:hp', S.directMods({ hp: 0.002 * layers }));
      }
    }
  };
```

**落地注意**

1. **不要**塞进 `bond:victoria` 那条 buff：它带「必须携带装备」的门（`core.js:318`），塞进去会让 0 装备成员拿不到血。
2. 挂在 `apply()` 里（而不是安装时发一次）：`apply` 已由 `onLayers(battle, pid, 'victoriaShip', apply)` 驱动
   （`core.js:322`），层数涨了就刷新；`passiveBuff` 用固定 key，重复调用是替换，不会叠加。
3. 3 人档 / 6 人档：上面的写法在**3 人档**（`install` 在 3 人档就跑了）就生效 —— 与炎一致。若要 6 人档，把这一行挪到
   `if (!reached(battle, pid, 'victoriaShip', bb.power_bond_char_cnt)) return;` 之后。
4. 量级提醒：维多利亚在超限里能到 750+ 层（锤子封顶）甚至 9999 层。每层 0.2% 在 L=750 时是 `+150%`、L=9999 时是 `+1999.8%`
   —— **这是业主定稿口径**，落地前请在文档上确认这就是想要的斜率（固定 +30% 的替代方案写在本节末尾）。
5. 文本：`overlimitBondText.js:22` 那一行要加「生命值 +(0.2×层数)%」（§6）。

**替代方案（若业主反悔要固定值）**：把 `hp: 0.002 * layers` 换成 `hp: 0.3` 即可（一行），此时不再需要 `apply()` 里的层数。

**影响面**：只加成员自己的 `hpPct`，不改伤害；挂件（3 人维多利亚）也跟着变强（×2.16 的挂件倍数会再涨一点）。


---

### 3.3 卡西米尔：攻击力乘区翻倍

**现状（已核）**

| 位置 | 内容 | 当前值 |
|---|---|---|
| `core.js:774` | `cap = base_max_atk_when_born + max_atk_when_born_per_stack × L` | `0.5 + 0.01×L`（`kazimierzShip.bb`） |
| `core.js:775` | `bonus = max(0, min(cap, deploys × atk_when_born))` | 每次部署 `+0.2`（`atk_when_born=0.2`） |
| `core.js:776–777` | `S.passiveBuff(..., 'bond:kazimierz', S.directMods({ atk: bonus }))` | 直接乘算 `atkPct` |
| `core.js:779–783` | `deploy` 钩子：**该玩家任意干员**部署都 `st.deploys++`（含开局部署与再部署） | — |
| `core.js:786–803` | 6 人档：阻挡脉冲 `1.2×ATK` 真伤 + `0.3×ATK` 附加真伤 | 与「ATK 乘区」无关 |

探针实测（6 名成员）：L=0 / 100 / 500 时，26 次部署后的 `atkPct` = `0.50 / 1.50 / 5.20`（上限 `0.50 / 1.50 / 5.50`）。

> ⚠️ `1 + 0.25 + 0.01L` 是**【突袭】`raidShip`** 的再部署乘区（`data/bonds.json` → `raidShip.bb.base_atk=0.25`,
> `atk_per_stack=0.01`），**不是卡西米尔**。它是**另一条盟约**，实现在 `server/sim/content/bonds/addon/battle.js:187–195`
> 的 `raidMods()`。§0.3 的定稿口径明确「部署与突袭两条都全翻倍」，所以本轮要**同时改两处**（§3.3-B）。

**关键量化（决定「翻哪些项」）**

- 卡西米尔这一侧：上限咬住的区间是 `0.5+0.01L < deploys×0.2`。以 26 次部署（`5.2`）为例 ⇒ **L < 470 时上限是唯一决定项**。
- 因此：
  - **只翻「每次部署」**（`0.2→0.4`）：L<470 时 `bonus` 仍是 `min(cap, …)`，**一点变化都没有**（L=100 仍是 1.5）。
  - **只翻「上限」**（`0.5+0.01L → 1.0+0.02L`）：L=100 时 `1.5→3.0`，L≥470 时几乎无变化（那时上限已不咬）。
  - **两处都翻**：两个区间都吃到 —— **这是定稿口径（§0.3）**。
- 突袭那一侧：`atk = 0.25 + 0.01L`、`hp = 0.25 + 0.01L` 同在一个 `directMods` 里（文字也是一句「攻击力和生命值+{0}%」）。
  翻倍时**两个都翻**（只翻 atk 会让 `raidMods` 的显示公式与数据分离，且突袭的实战价值一半在血量）。

**精确补丁 A（卡西米尔：`core.js:771–778`）**

```js
function installKazimierz(battle, pid, bb, members) {
  const st = { deploys: 0 };
  // 业主 2026-10-31（超限 V2 定稿口径）：「卡西米尔把攻击力乘区翻倍」——部署乘区与突袭乘区两条都全翻倍。
  // 本条这一半 = 部署叠出来的 atkPct，由「每次部署 atk_when_born」与「上限 base_max_atk_when_born + 每层」两块共同决定。
  // 两块都 ×2（只翻一块会有一个层数区间完全无效：L<470 时上限先咬住，只翻每次部署等于没改）。
  const KAZ_ATK_SCALE = battle.flags && battle.flags.overlimit ? 2 : 1;
  const apply = () => {
    const L = S.bondLayers(battle, pid, 'kazimierzShip');
    const cap = (num(bb.base_max_atk_when_born, 0) + num(bb.max_atk_when_born_per_stack, 0) * L) * KAZ_ATK_SCALE;
    const bonus = Math.max(0, Math.min(cap, st.deploys * num(bb.atk_when_born, 0) * KAZ_ATK_SCALE));
    if (!(bonus > 0)) return;
    for (const u of members) S.passiveBuff(battle, u, 'bond:kazimierz', S.directMods({ atk: bonus }));
  };
```

**精确补丁 B（突袭：`bonds/addon/battle.js:166` + `187–195`）**

```js
    // （bonds/addon/battle.js:166，applyPassives 内 —— 这个函数已经有 `battle` 在手）
    st.raidMods = raidMods(bb, lv, battle.flags && battle.flags.overlimit ? 2 : 1);
```

```js
// bonds/addon/battle.js:187
// 业主 2026-10-31（超限 V2 定稿口径）：卡西米尔的「攻击力乘区」含【突袭】这条 —— 超限局把 raidMods 整体 ×2
// （atk 与 max_hp 同一条公式，一起翻；普通 / 湮灭 / 炸惊 k=1，逐字节不变）。
function raidMods(bb, lv, k = 1) {
  const mods = directMods({
    atk: (num(bb.base_atk) + num(bb.atk_per_stack) * lv) * k,
    hp: (num(bb.base_max_hp) + num(bb.max_hp_per_stack) * lv) * k,
  });
  const aspd = num(bb.base_attack_speed) + num(bb.attack_speed_per_stack) * lv;
  if (aspd) mods.aspd = aspd;
  return mods;
}
```

> 突袭的 buff 是在**跳过去之后**才挂的（`battle.addBuff(u, { key: KEY.raid, mods: st.raidMods })`，`addon/battle.js:456`），
> 而 `st.raidMods` 在每次层数变化时重算（`:166`）；对已在跳转态里的成员，`:167–170` 会把现有 buff 的 `mods` 换掉。
> 所以只改 `:166` + `:187` 两处即可，不需要碰跳转逻辑。

**影响面（A + B 合起来）**

- L=9999（超限层数上限）时卡西米尔 `cap = 100.49 → 200.98`，但 26 次部署只有 `10.4`，**上限基本不再咬**；等价于「每次部署 +40%」。
- 卡西米尔 6 人档脉冲按 `m.s.atk` 计算（`core.js:793`）⇒ **脉冲也跟着吃这份 ATK**，属于二次收益，落地后复测。
- 突袭乘区在 L=100 时 `atk 0.25+1=1.25 → 2.50`、L=500 时 `5.25 → 10.50`，**对血量同样生效**（`raidMods.hp`）。
- 挂件：`installKazimierz` 与 `raidShip` 都在 3/2 人档就装，卡西米尔（×0.63）与突袭当第三格也会变强。
- **口径提醒**：改突袭等于改了**一条不属于「六条大盟约」的常驻盟约**，只在 `flags.overlimit` 下生效；文档里要写明
  「卡西米尔乘区 = 部署 + 突袭」，否则以后看报告会以为突袭也被列进强化名单了（§6 已列）。


---

### 3.4 阿戈尔：吞噬继承 + 每层 0.25% 基础攻击力

> **两种读法必须先定**（这是本文件里唯一「同一句话两个相反方向」的地方）：
>
> - **原话字面**（任务书）：「吞噬时继承 25% 攻击力」⇒ 把现行的 100% **砍到 25%**（削弱）。
> - **§0.3 定稿口径**（记忆，「用户定稿」）：「吞噬**仍继承基础攻击**，并**额外每层 +0.25% 基础攻击力**」⇒ 继承**不动**，另加一条增益。
>
> 本节把**定稿口径**写成主方案（现状一行不改，只加一层），并把「砍到 25%」作为备选（两处补丁都给出）。

**现状（已核）**

| 位置 | 内容 | 当前值 |
|---|---|---|
| `core.js:541–542` | `let atk = 0, block = 0; for (const t of mine) { atk += num(t.base.atk, 0); block += num(t.base.blockCnt, 0); … }` | **全额** `base.atk` |
| `core.js:548` | `if (atk > 0) mods.atkFinal = atk;` | 以「最终加算」写入（不吃施法者的 ATK% 加成，见 475–477 行注释 / PRTS） |
| `core.js:543–547` | 战壕装备另给 `hpFlat`（被吞者基础 maxHp 之和） | 与本次无关 |
| `core.js:575` | 每个被吞者给 `= 等阶` 的盟约层数 | 与本次无关 |
| `core.js:586–596` | `apply()`：每层 `atkPct = 0.008`（超限）+ `hp = 0.35 + 0.01L` | 与本次相邻的另一条超限通道 |

探针实测（3 名阿戈尔排成一行，两两吞噬）：`e0_a`（吃了 2 个 1000 攻）⇒ `atkFinal=2000, blockCnt=4`；`e1_a` ⇒ `1000, 2`。
即**全额基础攻击力 + 全额阻挡数**。

**目标（定稿口径）**：`atkFinal += 0.0025 × L × 自身 base.atk`，随层刷新；吞噬继承、阻挡数、层数额度全部不动。

**精确补丁 A（主方案：`core.js:586–596` 的 `apply()` 里追加一项）**

```js
  const apply = () => {
    // 业主 2026-10-31（超限 0.19 已落地）：每层额外 +0.8% 攻击力
    const atkPerStack = battle.flags && battle.flags.overlimit ? 0.008 : 0;
    // 业主 2026-10-31（超限 V2 定稿口径）：「吞噬仍继承基础攻击，额外每层 +0.25% 基础攻击力」。
    // 用 atkFinal（最终加算，units.js:154–156 / ver-heidi.js:64 同一手法）：吃不到攻击力百分比，
    // 也不会反过来放大吞噬继承的那部分，正好对应文案里的「基础攻击力」。
    const atkFinalPerStack = battle.flags && battle.flags.overlimit ? 0.0025 : 0;
    const L = S.bondLayers(battle, pid, 'egirShip');
    for (const u of members) {
      const extraFinal = atkFinalPerStack * L * num(u.base.atk, 0);
      S.passiveBuff(battle, u, 'bond:egir', S.directMods(
        { atk: atkPerStack * L, hp: num(bb.base_max_hp, 0) + num(bb.max_hp_per_stack, 0) * L },
        extraFinal > 0 ? { atkFinal: extraFinal } : null,
      ));
    }
  };
```

**精确补丁 B（备选：按原话砍到 25%，`core.js:541–542`）**

```js
    let atk = 0, block = 0;
    // 备选读法：「吞噬时继承 25% 攻击力」（相对现行 100% 是削弱）。定稿口径下**不要**用这一段。
    const DEVOUR_ATK_SHARE = battle.flags && battle.flags.overlimit ? 0.25 : 1;
    for (const t of mine) {
      atk += num(t.base.atk, 0) * DEVOUR_ATK_SHARE;
      block += num(t.base.blockCnt, 0);
      marks.push([m, t]);
    }
```

**落地注意**

1. `atkFinal` 是加算键（`buffs.js:20–22`），会把「吞噬继承」和「每层 0.25%」**相加**，互不放大 —— 这正是文案要的
   「基础攻击力」语义；用 `atk`（百分比）会变成「每层 0.25% 的总攻击力」，与文案不符。
2. `apply()` 已挂在 `onLayers(battle, pid, 'egirShip', apply)`（`core.js:596`）：层数涨了就刷新，吞噬加的层数也会被算进去
   （吞噬发生在 `battleStart`，`onLayers` 在 `layerGain` 后一 tick 触发，符合预期）。
3. 量级：L=9999 时 `+0.0025×9999 = +2499.75%` 的基础攻击力（最终加算）；L=100 时 +250%。业主若只要小幅，改 `0.0025`。
4. 连吞链（A→B→C）不受影响：被吞时给的是 `t.base.atk`（基础面板），不含继承部分，也不含这条 `atkFinal`。
5. 文本：`overlimitBondText.js:25` 要加「每层额外获得基础攻击力的 0.25%」（记忆里标注了「超限文案须体现」）。

**影响面**：定稿口径下这是**纯增益**（阿戈尔挂件 ×0.73 也会往上走）；若走备选（砍到 25%），阿戈尔当挂件会被削。


---

### 3.5 谢拉格：冰冻锁 20 s + 寒风每层 400 真伤

**现状（已核 + 实测）**

| 位置 | 内容 | 当前值 |
|---|---|---|
| `core.js:350` | `if (reached(battle, pid, 'kjeragShip', bb.power_bond_char_cnt)) kjeragColdWind(battle, pid, bb);` | 6 人档才起风 |
| `devices.js:172–178` | `kjeragColdWind`：`interval`、`base_time`、`time_per_stack` 全读 bb；`duration = base + per × layers` | 每 25 s 一阵，寒冷 `20 + 0.1×L` 秒 |
| `devices.js:140–166` | `startColdWind`：每阵风对**全场存活敌人** `applyStatus(e,'cold')`，**不打任何伤害** | 伤害 = 0 |
| `server/sim/battle/status.js:218–243` | 目标已寒冷时再次寒冷 ⇒ 转**冻结**，时长 = `max(剩余寒冷, 新寒冷)`（`freezeFor`）；转冻结后**移除寒冷** | 冻结时长 = `20+0.1L`，且 **L>50** 才会冻（L×0.1+20 > 25） |
| `server/sim/battle/status.js:196` / `server/sim/infiniteRule.js:53–102` | 超限的 `ccResist` 概率抵抗 + 精英/Boss 受控 6 s/10 s ⇒ 4 s 霸体 | 名义时长 ≠ 实战时长 |

探针实测（6 名谢拉格，`overlimit: true`）：L=0 ⇒ 两阵风都只是寒冷（第二阵风前寒冷已过期）；L=60 ⇒ t≈50.2 时 `freeze=25.73`
（= 26 − 0.27）；L=300 ⇒ `freeze=49.73`。**敌人 HP 全程不变**（寒风零伤害）。

> 顺带记录：`kjeragShip.zj.block` 里写了「寒风 2000 + 50×L 真伤」（`zj.bb["bond_eff_kjerag[storm].damage_value"]`），
> 但 `devices.js` / `core.js` **从未读过这两个键** —— 数据声明、代码没实现。本轮不要照抄这个键名。

**目标**

1. 6 人档起，**冻结时长锁 20 s**（寒冷时长**不**改，否则会反过来把冻结弄没：阵风间隔 25 s，若寒冷只有 20 s，
   下一阵风时目标已不寒冷 ⇒ 永远不冻。这是本条的隐藏坑）。
2. 每阵风按谢拉格层数给真伤：**每层 400**，即 `amount = 400 × L`，对**全场存活敌人**逐个结算（Q6 默认）。

**精确补丁 A：`devices.js` —— 给 `startColdWind` 加「阵风回调」，给 `kjeragColdWind` 加真伤**

```js
// devices.js:140  startColdWind 的签名加一个 onGust（可选，纯加参数，默认 null ⇒ 现有调用逐字节不变）
export function startColdWind(battle, { playerId = null, interval, duration, first, ownerOnly = false, onGust = null } = {}) {
  // …（原样）…
    let n = 0;
    const seen = [];                       // 本阵风「考虑过」的敌人：与 cold 是否命中无关（见下）
    for (const e of battle.enemies) {
      if (!e.alive || e.hidden) continue;
      if (ownerOnly && playerId != null && e.ownerId !== playerId) continue;
      seen.push(e);
      if (battle.applyStatus(e, 'cold', { duration: dur, source: null })) n++;
    }
  // …（fx 不变）…
    if (onGust) { try { onGust(battle, { playerId, duration: dur, enemies: seen }); } catch { /* 盟约效果不得打断风 */ } }
```

```js
// devices.js:172  kjeragColdWind：多接一个 damagePerLayer（0 = 不伤害，普通/炸惊/湮灭原样）
export function kjeragColdWind(battle, playerId, bb = {}, { bondId = 'kjeragShip', damagePerLayer = 0 } = {}) {
  const interval = num(bb['bond_eff_kjerag[storm].interval'], 0);
  const base = num(bb['bond_eff_kjerag[storm].base_time'], 0);
  const per = num(bb['bond_eff_kjerag[storm].time_per_stack'], 0);
  const layers = () => num(battle.getPlayer(playerId)?.bonds?.[bondId]?.layers, 0);
  const onGust = damagePerLayer > 0
    ? (b, { enemies }) => {
      const amount = damagePerLayer * layers();
      if (!(amount > 0)) return;
      // 无来源真伤（与【圣堂殉爆】同一个口径）：不吃任何「造成伤害提升」，也不进任何玩家的伤害统计。
      for (const e of enemies) {
        if (!e.alive) continue;
        b.dealDamage({ source: null, target: e, amount, type: 'true', canDodge: false, tags: ['bond:kjerag:wind'] });
      }
      b.fx?.('aoe', { x: 0, y: 0, scale: 1 });
    }
    : null;
  return startColdWind(battle, { playerId, interval, duration: () => base + per * layers(), onGust });
}
```

> 注意：真伤打的是 `enemies: seen`（**所有存活敌人**），不是「寒冷命中的人」。超限的 `enemyClamp.ccResist` 会按概率整体
> 拒绝 `cold`（`infiniteRule.js:64–68`），如果只打命中者，这条强化在高层会**常年 0 伤害**（Q6）。

**精确补丁 B：`core.js:337–351` —— 冻结时长 clamp + 传 400**

```js
// 业主 2026-10-31（超限 V2）：6 人档起，冰冻时间锁 20 秒；寒风按层数每层 400 真伤。
const KJERAG_FREEZE_LOCK = 20;            // 秒
const KJERAG_WIND_TRUE_PER_LAYER = 400;   // 每层真伤
function installKjerag(battle, pid, bb, members) {
  // …原来那几行不变…
  if (reached(battle, pid, 'kjeragShip', bb.power_bond_char_cnt)) {
    const inf = !!(battle.flags && battle.flags.overlimit);
    if (inf) {
      // 寒冷 → 冻结 的时长在引擎里由「两段寒冷的较大值」决定（battle/status.js:218–243），盟约侧没有参数可以限它，
      // 所以在 beforeStatus 里把**无来源的敌方冻结**夹到 20 s。范围刻意收窄：side='enemy' 且 source==null，
      // 避免影响干员/藏品/其它来源的冻结（仓库内其它无来源冻结最长 10 s，见 relics.js:152）。
      battle.on('beforeStatus', (c) => {
        if (!c || c.status !== 'freeze' || c.source != null) return;
        if (!c.target || c.target.side !== 'enemy') return;
        if (c.duration > KJERAG_FREEZE_LOCK) c.duration = KJERAG_FREEZE_LOCK;
      });
    }
    kjeragColdWind(battle, pid, bb, { damagePerLayer: inf ? KJERAG_WIND_TRUE_PER_LAYER : 0 });
  }
}
```

**落地注意**

1. **不要**用「把 `time_per_stack` 改成 0」来实现 20 s 锁：那样寒冷 = 20 s < 阵风间隔 25 s，第二阵风时目标已不寒冷，
   **永远不会冻结**（这是本条最容易踩的坑；炸惊 zj 块正是这么写的，但炸惊的寒风是另一套判定）。
2. clamp 的 `source == null` 是当前唯一能区分「寒风造成的冻结」的判据（`startColdWind` 用 `source: null` 施加寒冷，
   冻结继承 `source`）。若担心误伤，可再加一条 `c.target.findBuff('cold') == null` 之类的辅助判断，但收益不大。
3. 20 s 是**名义**时长：超限的 `ccResist` / 精英霸体（§2.1）会把实战冻结压到 6 s 量级，落地后要按实测口径复测。
4. 每层 400 在 L=60 时是 24,000/阵风/敌人（≈ 960 DPS/敌人）；L=999 时约 40 万/阵风。对杂兵是秒杀级，对 Boss 侧
   `BOSS_HIT_LIMIT_INFINITE`（99.99 亿）不构成封顶。
5. 真伤是**无来源**：不享受维多利亚/奥术等「伤害提升」，也不触发叙拉古的 PRD（`siracusaRolls` 会排除 `bond:` 标签）。
6. 联防（两个玩家同场）：阵风打的是**全场敌人**，队友也吃伤害 —— 这是既有寒风就有的行为（风本身就打全场），
   但伤害从 0 变成有数字，属于「被别的锚蹭到」的正向泄漏，需要在落地单里说明。

---

### 3.6 拉特兰：锁 600 子弹上限（已实现）+ 去掉攻击力上限

**现状（已核 + 实测）**

| 位置 | 内容 | 当前值 |
|---|---|---|
| `core.js:360` | `const infAmmo = !!(battle.flags && battle.flags.overlimit);` | — |
| `core.js:364–368` | `cappedLayers = infAmmo ? Math.min(600, rawLayers) : rawLayers`；`mul = 1 + 0.05 + 0.015×cappedLayers` | 超限 **600 层封顶**（`1+0.05+0.015×600 = 10.05`；不封顶时 L=1000 会到 `16.05`） |
| `core.js:374–388` | 超限：`>600` 层每 100 层 ⇒ `+1% hp、+1% atk、+0.4% 无视防御` | 已有 |
| `core.js:389–391` | `per = atk_per_consume(0.04) × (inf?2:1)`、`cap = inf ? 7 : max_atk_for_consume(2)` | 超限每发 `8%`，**上限 `+700%`** |
| `core.js:396–402` | `if (st.bonus < cap) { st.bonus = Math.min(cap, st.used * per); … }` | 每发重算一次全体 `atk` |
| `core.js:404–416` | 【圣堂殉爆】每 100 发：全体拉特兰攻击力总和 × 20% 真伤 | 与 ATK 上限耦合（见下） |

探针实测：普通 201 发 ⇒ `atkPct = 2`（200%）；超限 201 发 ⇒ `atkPct = 7`（700%）。

**目标**：弹药 600 层封顶**保持**（已实现，业主原话就是「锁 600」）；**去掉 ATK 上限**（超限 ⇒ `Infinity`）。

**精确补丁（`core.js:391`）**

```js
  // 业主 2026-10-31（超限 V2）：「拉特兰攻击力提升上限去掉」。600 层弹药封顶保持不变（上一轮已实现）。
  // 超限每发 8%、无上限；普通仍是数据里的 200%。
  const cap = inf ? Infinity : num(bb.max_atk_for_consume, Infinity);
```

**落地注意**

1. `st.bonus < cap` 与 `Math.min(cap, …)` 在 `Infinity` 下都成立，不需要改循环。
2. 每消耗 1 发就 `passiveBuff(..., 'bond:laterano:ammo')` 重发一次（`core.js:401`），无上限后单场可达数千次 —— 现有实现本来
   就是每发重算，只是数值不再夹住（性能不变，数值变大）。
3. **耦合项**：【圣堂殉爆】按「全体拉特兰**当前**攻击力总和 × 20%」结算（`core.js:407–408`）⇒ ATK 无上限会**二次放大**殉爆。
   落地后必须把殉爆的单场总量也一起复测（若业主只想去「+700%」而不要殉爆爆炸，需要把 `BLAST_SCALE` 改成按基础攻击力，
   那是另一个决定，本轮先按「都放开」记录）。
4. 文本：`overlimitBondText.js:28` 的「至多 +700%，即 88 发叠满」要删掉上限描述。

---

### 3.7 叙拉古（§0.3 追加，**不在本次六条内**）

> 记忆口径把叙拉古和六条记成**同一批**（Q8）。它不改「六条」的结论，但如果落地单只做六条、下一批又忘了它，
> 报告和代码会对不上。这里给出落点，业主确认后同批落地。

**现状（已核）**

| 位置 | 内容 | 当前值 |
|---|---|---|
| `core.js:731` | `if (!six) return;`（6 人档之后才装 PRD / 真伤） | 3 人档**只有**攻速与隐匿（`core.js:719–729`） |
| `core.js:732–734` | `probMul = overlimit ? 0.08 / bb.prob : 1` → `prdConstant(bb.prob × probMul)` | 超限 **8%**（普通 3%） |
| `core.js:746–754` | `infSira`：`amount = base + maxHp × 0.005`；精英/首领 `≤ 2_500_000` | 超限 **+0.5% 最大生命**，250 万封顶 |
| `core.js:757–763` | 恐惧；免疫控制 ⇒【血迹清算】等额真伤 | 已有 |

**目标（定稿口径）**：触发 `3% → 10%`；真伤补 `+0.2% 当前生命值`（**当前**，不是最大）；3 人档补 `+0.1%/层` 攻击力。

**精确改法**

```js
// ① 触发概率（core.js:733）：8% → 10%
const probMul = battle.flags && battle.flags.overlimit ? (0.10 / Math.max(1e-9, num(bb.prob, 0.03))) : 1;
```

```js
// ② 真伤（core.js:749–754）：+0.5% 最大生命 → +0.2% 当前生命；250 万封顶是否保留待定
if (infSira) {
  const curHp = num(t.hp, 0);                       // 当前生命（不是 maxHp）
  const isElite = t.isBoss || (t.def && t.def.rank && t.def.rank !== 'NORMAL');
  amount = base + curHp * 0.002;                    // +0.2% 当前生命
  if (isElite) amount = Math.min(amount, 2_500_000);   // ← 若「当前生命」已经能无限涨，这个封顶要重新定
}
```

```js
// ③ 3 人档 +0.1%/层 攻击力（新增，放在 6 人档判断 core.js:731 之前）
if (battle.flags && battle.flags.overlimit) {
  const pct = 0.001 * S.bondLayers(battle, pid, 'siracusaShip');
  if (pct > 0) for (const u of members) S.passiveBuff(battle, u, 'bond:siracusa:atk', S.directMods({ atk: pct }));
}
```

**待确认（Q8）**：①「0.2% 当前生命」与现有的「+0.5% 最大生命」是**替换**还是**叠加**；②250 万封顶还留不留；
③3 人档那条要不要随层刷新（上面写法是一次性，若要随层刷新需挂 `onLayers`）。

**影响面**：叙拉古是本批唯一的「真伤按当前生命」通道，对高血 Boss 的实际收益比「最大生命」低（打到残血时归零），
但对杂兵更稳；触发 10% 会把 PRD 常数重算（`prdConstant(0.10)`），单场触发次数约 +25%。

---

## 4. S.W.E.E.P. 改名：「XXX 超限」（仅超限视图）

### 4.1 现在名字来自哪

| 位置 | 现在的渲染 | 数据来源 |
|---|---|---|
| `sweep.js:250` | `<span class="sw-tile__cap">${b.name}</span>` | `data/bonds.json` 的 `name`（如「萨尔贡」） |
| `sweep.js:187` | `<span class="sw-tile__cap">${name}</span>`（占位块 `PendingTile`） | 调用处传 `b.name`（`sweep.js:247`） |
| `sweep.js:211` | `<${Hero} … name=${bond.name} …>`（右侧详情面板标题） | 同上 |
| `test/ui/sweep.test.js:133–134, 155` | 三条**源码正则**断言（含 `name=${b.name}` 的逐字匹配）—— 改名会同时打破它们 | — |

超限视图目前只把 5 条改写成占位块：`OVERLIMIT_PENDING_BONDS = ['egirShip','lateranoShip','victoriaShip','sargonShip','siracusaShip']`
（`sweep.js:54`），其余 18 条仍走普通 `Tile`。

### 4.2 做法（不新增 msgid）

「超限」这个字面量**已经存在**于 `OVERLIMIT_COPY.label`（`sweep.js:61`，带 `// i18n-ignore`，且 `test/ui/sweep.test.js:163–165`
钉住了「只有 4 条新字面量」）。所以改名**一律用拼接**，不写新的 `t('…')`、也不新增第 5 条字面量：

```js
// sweep.js：插在 `OVERLIMIT_COPY` 定义之后（现第 65 行「};」之后、enemy grades 之前）。
// 与 OVERLIMIT_PENDING_BONDS 并列，扩一条「超限改了数值的盟约」名单。
// 业主 2026-10-31：这些盟约在超限视图里显示为「XXX 超限」。名字用拼接（不新增 msgid）：
// `${b.name} ${OVERLIMIT_COPY.label}`。
export const OVERLIMIT_REWRITTEN_BONDS = Object.freeze([
  ...OVERLIMIT_PENDING_BONDS,      // 阿戈尔 / 拉特兰 / 维多利亚 / 萨尔贡 / 叙拉古（上一轮的 5 条）
  'yanShip', 'kazimierzShip', 'kjeragShip',   // 本轮新增的三条（炎 / 卡西米尔 / 谢拉格）
]);
const REWRITTEN_BONDS = new Set(OVERLIMIT_REWRITTEN_BONDS);
/** 超限视图里被改写的盟约名：`name` 来自数据，后缀是已有的 OVERLIMIT_COPY.label —— 不新增 msgid。 */
const displayName = (b, overlimit) => (overlimit && REWRITTEN_BONDS.has(b.bondId) ? `${b.name} ${OVERLIMIT_COPY.label}` : b.name);
```

> 位置很关键：`OVERLIMIT_COPY` 在 `sweep.js:60–65`。新增块必须放在它**之后**（`displayName` 是惰性求值，但若有人顺手写
> `const SUFFIX = OVERLIMIT_COPY.label` 放在前面，会直接 TDZ 崩）。

```js
// sweep.js:238–252  BondsTab：三处名字统一走 displayName
function BondsTab({ m, sel, onSel, modeId = null, variant = DEFAULT_SWEEP_VARIANT }) {
  const overlimit = variant === 'overlimit';
  // …
  ${s.items.map((b) => {
    const name = displayName(b, overlimit);
    return overlimit && PENDING_BONDS.has(b.bondId)
      ? html`<${PendingTile} key=${b.bondId} name=${name} />`
      : html`<${Tile} key=${b.bondId} kind="bond" on=${sel === b.bondId} onClick=${() => onSel(b.bondId)} title=${name}>
        <span class="sw-disc">…</span>
        <span class="sw-tile__cap">${name}</span>
      <//>`;
  })}
```

```js
// sweep.js:203  BondPanel 加一个 prop（详情面板标题同样改名；官方视图不受影响）
function BondPanel({ bond, m, notOwned, variant = DEFAULT_SWEEP_VARIANT }) {
  // …
  <${Hero} src=${bondIconUrl(m, bond.bondId)} glyph=${true}
    name=${displayName(bond, variant === 'overlimit')} … />
```

调用处（`sweep.js` 里 `<${BondPanel}` 那一行）补 `variant=${view}`。

**为什么这样满足「不新增 msgid」**：`OVERLIMIT_COPY` 仍然是 4 条（测试 `sweep.test.js:163` 断言 `copyLines.length === 4`），
新增的 `displayName` 不包含任何 CJK 字面量（只有模板字符串与已有常量）。`node tools/i18n.mjs check --all --strict`
不会为这两个文件新增 `missing` 行（本轮已实测：该命令当前对 `sweep.js` / `overlimitBondText.js` 的输出为空）。

### 4.3 连带要改的测试（源码正则断言）

`test/ui/sweep.test.js:155` 目前逐字匹配：

```js
assert.match(sweep, /\? html`<\$\{PendingTile\} key=\$\{b\.bondId\} name=\$\{b\.name\} \/>`/);
```

改名后这一行不再成立，须改成（示例）：

```js
assert.match(sweep, /export const OVERLIMIT_REWRITTEN_BONDS = Object\.freeze\(\[/);
assert.match(sweep, /const displayName = \(b, overlimit\) => \(overlimit && REWRITTEN_BONDS\.has\(b\.bondId\) \? `\$\{b\.name\} \$\{OVERLIMIT_COPY\.label\}` : b\.name\);/);
assert.match(sweep, /<\$\{PendingTile\} key=\$\{b\.bondId\} name=\$\{name\} \/>/);
assert.match(sweep, /<span class="sw-tile__cap">\$\{name\}<\/span>/);
// 官方视图逐字节不变：displayName 的第二个参数为 false 时只能回落到 b.name
```

另外 §4.2 的名单要加断言：`OVERLIMIT_REWRITTEN_BONDS` 必须包含 8 条且都是官方 23 条里的（沿用该文件既有写法）。

### 4.4 后续（不在本轮）

五条占位块之所以还在，是因为**数值上一轮没定**。本轮定稿后，落地单里应把 `PendingTile` 换成可点开的真实 `Tile`，详情文本用
`overlimitBondText(bondId)`（`public/js/ui/overlimitBondText.js`）—— 那个文件目前**没有任何 import**（只有自引用），
落地时必须同时把六条/八条的文本按 §5.2 更新，否则报告里会出现「名字写着超限、正文还是原版」。

---

## 5. 影响面与测试清单

### 5.1 golden：应当**零移动**

- `test/golden/` 6 个文件（`bonds.json` / `diy.json` / `fields.json` / `matches.json` / `roster.json` / `standins.json`）
  **没有任何 `overlimit` 字段**（实测 grep 无命中），golden 场景也不会点亮 `flags.overlimit`。
- 所以本轮改动理论上**不会移动任何 golden 场景**。落地后照常跑 `npm run golden`；**如果出现移动，说明 gate 漏了**
  （最可能是把某个分支写在了 `if (inf)` 之外），按「不该动却动了」处理，不要 `golden:update` 掩盖。
- 反向核对：§3 的六条全部读 `battle.flags.overlimit`，普通 / 湮灭 / 炸惊的 `flags` 里都没有这个键。

### 5.2 需要新增/修改的断言（可直接照抄成 `test/content/bonds_core.test.js` 的新 test）

harness：`makeBattle({ defs, units, bonds, flags: { overlimit: true }, enemies: [{ key:'e_dummy', time:0 }] })`
（`test/helpers/battleHarness.js:212` 已支持 `flags`；`bondOn()` 见该测试文件头部）。建议一条 test 一个盟约：

| # | 断言 | 具体数值 |
|---|---|---|
| T1 萨尔贡 | 40 次 `skillStart` 后的叠层数与 ATK | 超限：`stacks = 40`、`bond:sargon:atk.mods.atkPct ≈ 40×0.12 = 4.8`；普通：`25` / `3.0`（现状，已实测） |
| T1b 萨尔贡 | 攻速同享上限 | 超限：`bond:sargon` 计数 = 40 且每条 `mods.aspd = 12` |
| T2 维多利亚 | 6 人、L=100、每人 1 件装备 | 超限：`bond:victoria:hp.mods.hpPct = 0.002×100 = 0.20`；普通：该键不存在 |
| T2b 维多利亚 | 0 装备成员也要拿到血 | 超限：`bond:victoria:hp` 存在（**证明没有走 `itemsOf(u).length>=1` 的门**） |
| T2c 维多利亚 | 层数变化后 hp 跟着变 | 超限：`addLayers(50)` 后 `hpPct` 从 `0.20` 变 `0.30`（证明挂在 `onLayers` 的 `apply()` 上） |
| T3 炎 | L=30 生命值 | 超限：`bond:yan.hpPct = 0.15 + 0.002×30 = 0.21`；普通：`undefined`（现状，已实测；若收掉 15% 基座则改为 `0.06`） |
| T4 卡西米尔 | L=100、2 次部署 | 超限（部署两处 ×2）：`min(3.0, 2×0.4)=0.8`；普通：`min(1.5, 0.4)=0.4` |
| T4b 卡西米尔 | L=100、26 次部署 | 超限：`3.0`（上限咬住）；普通：`1.5` —— 这条专门证明「上限也翻了」 |
| T4c 卡西米尔 | L=1000、26 次部署 | 超限：`10.4`（上限 `2×(0.5+10)=21` 不咬）；普通：`5.2` |
| T4d 突袭 | L=100、`raidMods(bb, 100, k)` | 超限（k=2）：`atkPct = 2×(0.25+0.01×100) = 2.50`、`hpPct = 2.50`；普通（k=1）：`1.25` / `1.25` |
| T5 阿戈尔 | 3 名阿戈尔排成一行、各 1000 攻，`overlimit` | 定稿口径：`bond:egir:devour.atkFinal` **仍是 2000**（继承不动），另外 `bond:egir` 里 `mods.atkFinal = 0.0025×L×1000`（L=40 时 `100`）；若走备选：devour 的 `atkFinal = 500` |
| T5b 阿戈尔 | 层数变化 | 超限：`addLayers(60)` 后 `bond:egir.mods.atkFinal` 从 `0.0025×40×1000=100` 变 `0.0025×100×1000=250` |
| T6 拉特兰 | 201 发弹药 | 超限：`atkPct ≈ 201×0.08 = 16.08`（无上限）；普通：`2`（现状，已实测） |
| T6b 拉特兰 | 600 层弹药封顶仍在 | `mul = 1+0.05+0.015×600 = 10.05`（不是 `16.05`），超限与普通口径按 `infAmmo` 分支各断一次 |
| T7 谢拉格 | L=60、6 人，跑到 t≈50.2 | 超限：`freeze.timeLeft ≈ 20`（clamp 生效）；**普通：≈26**（`20+0.1×60`） |
| T7b 谢拉格 | L=300、6 人 | 超限：`freeze.timeLeft ≈ 20`；普通：`≈50` |
| T7c 谢拉格 | 寒风伤害（L=60，dummy 1e12 HP） | 超限：t≈25.3 时 `enemy.hp = 1e12 − 400×60 = 1e12 − 24,000`；普通：`1e12`（零伤害） |
| T7d 谢拉格 | 3 人档不起风 | 超限：`cold` / `freeze` / 伤害都不存在（`reached(...,6)` 门） |
| T8 全局 | 普通模式一帧不变 | 以上全部数值在 `flags: {}`（无 overlimit）下与**当前**实现逐位相同 —— 就是 T1/T2b/T3/T4b/T4d/T5/T6/T6b/T7 的「普通」列 |
| T9 叙拉古（§3.7，若同批） | PRD 常数与真伤 | 超限：`prdConstant(0.10)`（普通 `prdConstant(0.03)`）；真伤 `base + 0.002×t.hp`；精英封顶仍 250 万 |


配套（非必须但建议）：

- `test/content/tokens_devices.test.js:864–872` 现有的「寒风时长」测试用默认 bb 构造 `startColdWind`，加 `onGust` 参数后
  **必须仍然通过**（默认 `null`）；建议同文件加一条 `onGust` 被调用一次的断言。
- `test/ui/sweep.test.js`：§4.3 的改名断言。
- `test/match/overlimit-audit.test.js` 不需要动（它测的是 `gd.overlimit` 与 Boss 时钟）。

### 5.3 跑法

```bash
node --test test/content/bonds_core.test.js test/content/tokens_devices.test.js test/ui/sweep.test.js
npm run golden          # 期望 6 个场景全绿（零移动）
npm run ci              # 全量：npm test + smoke + lint + imports + types
node tools/i18n.mjs check --all --strict   # 注意：本仓当前基线已有 248 条 en 缺失（与本轮无关），只核对不要新增
```

---

## 6. 文本 / 文档同步清单（落地同单完成，否则会「数值改了、报告还是旧话」）

| 文件 | 要改什么 |
|---|---|
| `public/js/ui/overlimitBondText.js:19` | 萨尔贡：`至多叠 25 层`、`至多 +300%` 删掉，改「无上限」 |
| 同上 `:16` | 炎：本轮不动；若收掉 15% 基座，改 `(0.2×层数)%` |
| 同上 `:22` | 维多利亚：追加「生命值 +(0.2×层数)%」；顺带核对它写的「每 50 层 +1% 伤害」与 `core.js:306–313` 一致（✓） |
| 同上 `:25` | 阿戈尔：「获得其基础攻击力」保留，另加「每层额外获得基础攻击力的 0.25%」（定稿口径明确「超限文案须体现」）；若走备选则改成「基础攻击力的 25%」 |
| 同上（新增） | 谢拉格：目前**没有**这一条文本，要新增「6 人：每 25 s 寒风，寒冷 `20+0.1L` 秒、冻结至多 20 秒，每层 400 真伤」 |
| 同上（新增） | 卡西米尔：目前**没有**这一条文本，要新增「每次部署攻击力 +40%，至多 `2×(0.5+0.01L)`；【突袭】再部署乘区同样翻倍」 |
| 同上（新增） | 叙拉古（若同批）：`8%→10%`、`+0.5% 最大生命 → +0.2% 当前生命`、3 人档 `+0.1%/层` 攻击力 |
| `public/js/ui/richText.js:173–188` | 超限局「当前效果」的数值替换（炎 `__yan_hp`、拉特兰 `atk_per_consume`、阿戈尔 `__egir_atk`、叙拉古 `prob`）—— 新增维多利亚 hp、卡西米尔 atk、谢拉格真伤（如需在「当前效果」里显示） |
| `docs/OVERLIMIT-PROGRESS.md:116–125` | §2 表：维多利亚加「hp 0.2%/层」、萨尔贡改「无叠层上限」、拉特兰改「ATK 无上限」、阿戈尔加「每层 0.25% 基础攻击力」、**新增卡西米尔 / 谢拉格两行**，另注明「卡西米尔乘区含【突袭】`raidShip`」 |
| `docs/INFINITE_MODE.md:78–121` | §4.1–4.5 与本次对齐；顺手订正已漂移的两处：§4.1 的「溢出转 1.5% 攻/防/0.5% 血」（代码是每 50 层 +1% **伤害**，`core.js:304–313`）、§4.3 的「+300 攻速与 +300% 攻击」（超限后无上限，需注明「本表按普通口径」） |
| `docs/history/`（当前 0.3.3）或下一版 history | 按 AGENTS.md「Docs follow the code」：规则变更要有 history 段落 + `node --test test/docs-consistency.test.js test/docs-paths.test.js` |

> 说明：`data/bonds.json` **不参与**本次改动（它是单行压缩 JSON 且由 `tools/build-data.mjs` 生成），所有新增数字都落在
> `core.js` / `devices.js` / `bonds/addon/battle.js` 的具名常量上。

---

## 7. [ASSUMED] 汇总（业主没明说、本文件先按此写的地方）

> 前置：§0.3 的「七盟约定稿口径」**优先于**下面的默认值；只有它没覆盖到的细节才落到这张表。

1. **[ASSUMED] 萨尔贡**「去上限」= 把叠层上限 `max_buff_stack_cnt`（25）在超限抬到 9999，**攻速与 ATK 同时放开**；娜仁图亚档同享。
   理由：ATK 与攻速共用一个叠层计数，只放开 ATK 需要拆 buff 结构，且炸惊的既有做法就是抬叠层上限。
2. **[ASSUMED] 维多利亚 hp** = `0.002 × 层数`（定稿口径），**3 人档起**，不要求携带装备，挂在 `onLayers` 的 `apply()` 上随层刷新。
3. **[ASSUMED] 炎 hp** = **一行不改**（`15% + 0.2%/层`；其中「每层 0.2%」已经满足定稿口径），15% 基座是否收掉待 Q3。
4. **[ASSUMED] 卡西米尔**「乘区翻倍」= 部署侧（`atk_when_born` 与上限两块都 ×2）**加**突袭侧（`raidMods` 整体 ×2，含 hp）。
5. **[ASSUMED] 阿戈尔**按定稿口径 = 吞噬继承**不动**，另加 `atkFinal += 0.0025 × L × base.atk`（最终加算，随层刷新）。
   「砍到 25%」的原话读法作为备选补丁保留在 §3.4-B。
6. **[ASSUMED] 谢拉格 400 真伤**：每阵风 × 每层 × 每个**存活敌人**（与寒冷是否命中无关）；`tags:['bond:kjerag:wind']`、
   无来源、真伤、不可闪避；只作用于敌人（不反伤）。
7. **[ASSUMED] 谢拉格 冻结 20 s**：只 clamp `side==='enemy'` 且 `source==null` 的冻结，不动寒冷时长；**不是**「寒冷也锁 20 s」。
8. **[ASSUMED] 拉特兰** 的「600 子弹上限」= 保持现状；只去掉 ATK 上限，且【圣堂殉爆】随之无上限（耦合项，落地后复测）。
9. **[ASSUMED] 改名范围** = 8 条（上一轮 5 条 + 炎 / 卡西米尔 / 谢拉格），只在 `variant === 'overlimit'` 时生效；官方视图逐字节不变。
   若叙拉古同批落地，名单已是 8 条（叙拉古本来就在上一轮那 5 条里）。
10. **[ASSUMED] 叙拉古（§3.7）**：`0.2% 当前生命`**替换** `0.5% 最大生命`（不是叠加）；精英/首领 250 万封顶暂留；
   3 人档 `+0.1%/层` 攻击力是**一次性**发放（若要随层刷新需挂 `onLayers`）。


---

## 8. 复现与探针（可删）

本轮所有「实测」数字来自一个一次性探针脚本（**系统临时目录**，不在仓库内）：
`%TEMP%\ol-probe.mjs` —— 用 `test/helpers/battleHarness.js` 的 `makeBattle` 造 6 人盟约 + 一个 1e12 HP 木桩，打印
谢拉格 cold/freeze 时长与敌人 HP、拉特兰 201 发后的 `atkPct`、阿戈尔吞噬的 `atkFinal`、卡西米尔 26 次部署后的 `atkPct`、
萨尔贡 40 次技能后的叠层数与 `atkPct`、炎 / 维多利亚的 buff 键列表。已按精确文件名删除，仓库零残留。

关键输出（原文）：

```
kjerag L=0:   @t=50.2 cold=19.73 freeze=null
kjerag L=60:  @t=50.2 cold=null  freeze=25.73
kjerag L=300: @t=50.2 cold=null  freeze=49.73     （三档 enemy hp 均不变 ⇒ 寒风零伤害）
laterano 普通 201 发: atkPct=2   超限 201 发: atkPct=7
egir devour: e0_a atkFinal=2000 blockCnt=4 / e1_a atkFinal=1000 blockCnt=2
kazimierz L=0/100/500: atkPct=0.50 / 1.50 / 5.20（上限 0.50 / 1.50 / 5.50）
sargon 普通/超限 40 次技能: stacks=25, atkPct=3.0000（两档相同 ⇒ 现状超限未放开）
yan L=30: 普通 hpPct=undefined / 超限 hpPct=0.21
victoria（无装备，6 人）: buffs 为空 ⇒ 无 hp 通道
```

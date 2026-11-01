# 炸惊模拟 → 独立玩法模式：拆分方案（2026-10-28 计划稿）

> 承接 [`EXTENSION-MODE-2026-10-28.md`](EXTENSION-MODE-2026-10-28.md) §5.2「规则分离：玩法包要各自独立的卡池 / 额外盟约 / 策略」。
> 输入包：`C:\Users\J1825\Downloads\炸惊模拟整合包公开版v2.1.zip`（1.44 GB，`Stronghold-Protocol-0.3.1-mod.4`）。
> 本仓：`E:\Workbox\系统`，版本 0.3.3，分支 `align/0.3.0`。**红线：从不 commit / checkout / stash / reset。**
>
> 本文是**计划**，不是既成事实。§2 的现状数字全部由脚本实测（命令见 §7）。实施进度回写到本文 §6。

---

## 0. 一句话结论

炸惊不是「一个难度档」，它是**一套独立的棋库 + 一套独立的卡牌系统（惊变 / 敌方惊变 / 惊变羁绊）+ 一层盟约覆盖**。
拆分的最小正确形状是：**一个 `ZHAJING` 玩法模式（difficulty）+ 两条 mode 记录 + 以「模式标记」而非「独立数据集」隔离的内容**，
沿用本仓湮灭模拟已验证的范式（`gd.annihilation` → 本文改为 `gd.zhajing` / `gd.jibian`），并用**隔离测试 + golden 零位移**钉死主玩法各版本。

---

## 1. 炸惊是什么（实测，不是转述）

### 1.1 包内数据 vs 本仓数据（键级 diff）

| 文件 | 本仓 | 包内 | 净增 | 说明 |
|---|---|---|---|---|
| `chess.json` | 266 | 473 | **+207**（205 条 `chess_zj_*` + `chess_chen3_a/_b`） | 炸惊**专属棋库**：104 个基础干员位（每个 normal/elite 两条记录） |
| `garrisons.json` | 249 | 497 | **+248**（238 条 `garrison_zj_*`） | 炸惊卫戍（对应上面那套棋库） |
| `bonds.json` | 23 | 28 | **+5**（`suiShip` / `penguinShip` / `physicianShip` / `seesShip` / `mujicaShip`） | 新盟约；其中 **21 条既有盟约带 `zj` 覆盖块** |
| `items.json` | 115 | 126 | +11（7 条 zj 相关） | |
| `tokens.json` | 22 | 37 | +15 | 召唤物（惊变召唤） |
| `bands.json` | 40 | 42 | +2（`zjOnly: true`） | 炸惊专属策略 |
| `enemies/stages/waves/bosses/effects/choices` | — | — | **0** | 敌人、关卡、波次完全复用 |
| `config.json` | 11 个 mode | 11 个 mode | **+2**：`mode_single_zhajing` / `mode_multi_zhajing` | `difficulty: 'ZHAJING'`、`code: 'AC-5'`、`color: '#17d9a0'` |
| `data/jibianBonds.json` | 无 | 4.7 KB | 新文件 | **惊变羁绊**（18 条：`dmg2dmg`/`steady`/`glory`/`empathy`/`siracusa_wrath`/`freeship`/`roguelike_fan`/`cheat`/`modern_strongest`/`army_alert`/`great_seal`/`true_investor`/`glorious_evo`/`layers_fan`/`toopainful`/`ave_mujica`/`craftsman`/`steel_heart`） |

### 1.2 炸惊模式记录里独有的东西（`mode_single_zhajing` 的字段）

`allyScale {atk:2.5, def:3, hp:3}`（白值膨胀，折进干员白值而非战场乘区）、`jibian {cards, rarityWeights, rerolls, pool:99}`、
`enemyJibian {enabled, rounds:[1,6], pool:21}`、`spPhaseKinds`（1/2/3/6/7/8/10/11/12 → `jibian` | `express` | `bountyHigh`）、
`expressPool`(17) / `expressCards`(6) / `expressGroups`、`morphEquipSlot`、`chessPrice`、`benchSize: 20`、`bondLayerCap: 9999`、
`income[31]` / `leftoverFundsKept` / `interest`、`specialPhaseTime: 150`、`hiddenBossHpMul: 2`、`bans.ZHAJING {core:2, addon:2}`。

**惊变（jibian）= 抽卡式增益/减益系统**：我方 99 张（普通/稀有/史诗/传说/隐秘 五档，第 1/2/4/7 回合各抽 3 选 1，可重抽 4 次），
敌方 21 张（第 1、第 6 回合各抽一次，全场共用、持续整局）。**惊变羁绊**把「凑齐若干张卡」变成新羁绊（13 条，含 Ave Mujica）。

### 1.3 引擎侧新增模块（包内 → 需移植）

| 文件 | 行数 | 职责 |
|---|---|---|
| `server/sim/content/jibian.js` | 2542 | 99 张我方惊变的效果注册表（`effectId → handler`） |
| `server/sim/content/ejibian.js` | 574 | 21 张敌方惊变 |
| `server/sim/content/jibianBonds.js` | 109 | 惊变羁绊（`activeBonds` / `ownedJibianIdsOf`） |
| `server/sim/content/mujica.js` + `mujicaBond.js` | 177 + 146 | Fever（颂乐人偶专属机制） |
| `shared/zjBonds.js` | 179 | **盟约 `zj` 覆盖层**（纯函数，服务端与浏览器共用） |
| `shared/zhajingBase.js` | 52 | `allyScale` 白值折算 |
| `shared/mujicaJibian.js` | 14 | 三张惊变 id 常量 |

### 1.4 新干员（kits）

包内 ktis 比本仓多 9 个：`chess_zj_amoris / dolris / mortis / oblvns / tmoris`（颂乐人偶五人）、`op-aigis / op-kormr / op-makoto / op-yukari`。
本仓比包内多 20 个 `ver-*.js`（0.3.3 的**版本化干员**结构）——**移植要照本仓的 `ver-*` 约定落位，不能整文件覆盖**。

### 1.5 隔离约定（包内已有，直接沿用）

包内 `server/match/gamedata.js` 已经用**记录标记**隔离，而不是独立数据集：

```js
// 包内 gamedata.js:154-160
return zhajing ? c.zhajing === true : (c.visible === true && c.zhajing !== true);
```

即：炸惊棋库记录 `visible:false, zhajing:true`；主玩法 `visibleChess` 要求 `visible===true`，**天然拿不到**；
装备/策略同理 `zjOnly:true`；盟约走 `zj` 覆盖块（`merge:false` 时只剥键，记录逐字节还原）。

---

## 2. 隔离架构：三条线，全部「按模式开门」

| 层 | 机制 | 主玩法为什么不受影响 | 怎么钉死 |
|---|---|---|---|
| **数据** | zj 记录进 `data/*.json`，带 `zhajing:true` / `zjOnly:true`；盟约带 `zj` 块 | `gd.visibleChess` / `shopItemsByTier` / `bands` / 盟约视图在非 ZHAJING 模式下**过滤掉**这些记录 | 测试：非 ZHAJING 模式下 `visibleChess` / 可购道具 / 可抽策略 / 盟约记录 **深比较等于**打补丁前 |
| **引擎** | `gd.zhajing`（难度门）+ `gd.jibian`（该 mode 有 `jibian` 才非空）+ `gd.enemyJibian` | 每处钩子都 `if (!this.gd.zhajing) return;`；与湮灭的 `gd.annihilation` 同一范式 | `GOLDEN_FULL=1 node tools/golden.mjs` 288 场景零位移 |
| **界面** | `EXTENSION_MODES` 加第二条（`id: 'zhajing'`, `status: 'ready'`），走主题大厅 + 「单人 / 同盟」 | 官方四档难度的选择器不读 `EXTENSION_MODES`；`DIFFICULTIES` 不加 `ZHAJING`（照湮灭：难度常量放 `shared/zhajing-constants.js`） | `test/ui/extension-modes.test.js` + 真机脚本 |

**为什么不走「独立数据集 / 内容集」**（`handoff §5.2` 的首选项）：那条路要求把 `data/extensions/zhajing/` 做成完整数据集、
在独立 match host（子进程）里跑、客户端下载并校验 `cs`。它能拿到最强的隔离，但**本轮收益与风险不成比例**：

1. 包内 0.3.1 的炸惊实现**本来就是按标记做的**，改成数据集要重写全部接线（1100+ 处 diff），收益只是「数据文件里不出现 zj 记录」；
2. `cs` 随每次 sim 代码改动而变（`identity.js` 哈希整个 `sim/**`），会把玩法包变成「一动代码就掉存档」的东西（交接 §5.2 已点名）；
3. 真正的污染风险不在「数据文件里有几条记录」，而在「**有没有代码路径在非 ZHAJING 模式下读到它们**」——那要用测试和门来管，数据集换不来。

**保留的退路**：若日后 zj 记录真的膨胀到干扰主玩法（例如图鉴 / 随机池出现 `chess_zj_*`），再把 zj 记录整体搬进
`data/extensions/zhajing.json`（一个文件、加载时按 mode 合并进 `chess` 映射）——那一步是**纯搬运**，不需要重写玩法。

---

## 3. 分层落地清单（P0–P6）

### P0 基线与护栏（Lead）——本轮的起点

* `GOLDEN_FULL=1 node tools/golden.mjs` 基线（288 场景）；
* 定位「会遍历 `data/*.json` / `public/js/**` 的测试」，确认新增 zj 数据不会撞上既有断言；
* 参考包解压到 `modref/v2.1/`（**不入 git**，见 §5 红线）；不参与 lint / imports 扫描（已验证：eslint 与 `tools/check-imports.mjs` 的
  glob 都锚在 `server|shared|tools|scripts|types|public/js`，`modref/` 不在其中）。

### P1 数据层：把炸惊数据变成「生成物」

* 新增 `docs/research/17-zhaijing-mode.json`（两条 mode 记录 + `bans.ZHAJING` + `hiddenCore.difficulties` 增量）、
  `18-zhaijing-content.json`（205 条 `chess_zj_*` / 248 条 `garrison_zj_*` / 5 条新盟约 / 21 条盟约 `zj` 块 / 11 条道具 / 15 条 token / 2 条 band）、
  `19-zhaijing-jibian.json`（我方 99 + 敌方 21 张惊变 + 13 条惊变羁绊）；
* `tools/build-data.mjs` 增加这三个源的合并步骤 → 重新生成 `data/*.json`（⚠ 生成器不幂等：**先输出到临时目录，只搬目标文件**，
  且逐文件 diff 报告 net 改动）；
* `shared/zhajing-constants.js`（`ZHAJING_DIFFICULTY = 'ZHAJING'`、`isZhajingMode(modeId)`）——**不加进 `DIFFICULTIES`**；
* 隔离测试 `test/match/zhajing-isolation.test.js`：官方四档 × 同盟/单人的 `visibleChess` / 可购道具 / 可抽策略 / 盟约记录
  与「无 zj 记录时」逐字节一致；ZHAJING 模式下这些池子**只**含 zj 记录（不混入主棋库）。

### P2 引擎层：惊变系统 + 盟约覆盖 + 白值膨胀

* `shared/zjBonds.js`（盟约 `zj` 合并）、`shared/zhajingBase.js`（`allyScale`）**照搬**（纯函数、无 Node API、确定性）；
* `server/sim/content/{jibian,ejibian,jibianBonds}.js`：2542 + 574 + 109 行，**按 0.3.3 的 support API 改写**（导入面已核对：7 + 4 + 0 个）；
* `server/sim/content/index.js` 的 `DOMAIN_NAMES` 加 `'jibian','ejibian'`（少这一行 = 全哑且不报错，交接 §3.4 的坑）；
* `server/match/gamedata.js`：`zhajing` / `zjCombos` / `zjBondView` / `visibleChess` / `zjToChar`（奖池 id 映射）/ `spPhaseKind` / `enemyJibian`；
* 钩子点（每处都按 `gd.zhajing` 开门）：`match/choices.js`（`applyCard` / `generateDraft` / `jibianCard`）、
  `match/match/{phases,spDraft?,settle,bossRounds,views,unitePhase}.js`、`match/player/{round,items,cheat,diy,views,basics,economy}.js`、
  `sim/{units,players,deploy,economy,lifecycle,damage,spawns,buffs,simdata,Battle}.js`、`content/{devices,forge,traitMods,support/index,bands/battle,garrisons/battle}`；
* `PlayerState` 的 `effects` / `jibianHas` / `jibianChequeValue`（惊变计数器与一次性卡）。

### P3 内容层：新干员 / 新盟约 / 新卫戍

* 9 个新干员 kits 按本仓 `ver-*` 命名与注册约定落位（颂乐人偶五人 + aigis / kormr / makoto / yukari）；
* 5 条新盟约 + 21 条 `zj` 覆盖块的语义（`zjBonds.js` 的合并规则已有 179 行注释写明，逐条对齐）；
* 炸惊卫戍（248 条）与惊变召唤物（15 条 token）；
* 每个新干员的**特质/技能/模组**在 ZHAJING 外的可见性：一律 `zhajing:true`。

### P4 客户端：入口 + 局内界面

* `EXTENSION_MODES` 第二条 `zhajing`（`status: 'ready'`，主题大厅、攻略说明可选）；
* 大厅第三张卡 → 主题大厅 → 单人/同盟 → `room.create { mode, difficulty: 'ZHAJING' }`；
* 局内：惊变三选一浮层、已选惊变面板（我方/敌方/羁绊三页）、惊变一览、炸惊规则页、干员调配炸惊页签；
* 房间：`ZHAJING` 难度在房间页的展示与 `room.setDifficulty` 校验；
* i18n：**新字面量必须先报 Lead 批准**（四语言包同批补齐，`node tools/i18n.mjs check --all --strict`）。

### P5 资产与真机

* 包内 `public/assets/{char,spine,audio,ui,skill,bond,token}/**` 只与炸惊相关的部分**本机导入**（`public/assets/` 已 gitignore；
  AGENTS.md「no game art in git」不变）；
* 真机：`node devtools/render-check-extension-hall.mjs`（三档视口）+ 新 `devtools/render-check-zhajing-room.mjs`（房内 → R1 惊变 → 战斗）。

### P6 文档与交接

* `docs/EXTENSION_MODE.md` 新增 §8「炸惊模拟」；`docs/DESIGN.md` 索引；`docs/history/` 当期文件；
* `handoff/ZHAJING-SPLIT-2026-10-28.md`（做了什么、剩什么、怎么接）；
* 全量验证：`npm test` 子集 → `npm run ci` → `golden` → `i18n --all --strict`。

---

## 4. 分工与写域（Agent Teams）

| 角色 | 责任 | 写域（互斥） |
|---|---|---|
| Lead（我） | 架构决策、任务拆分、冲突裁决、i18n 字面量批准、最终整合与验证 | `handoff/`、`docs/EXTENSION_MODE.md`、`public/i18n/` |
| inventory | 包内清单（文件级 / hunk 级 / 资产级） | `handoff/ZHAJING-INVENTORY.md`、`modref/inventory.json` |
| arch | 隔离设计与钩子清单（对照 0.3.3 实读） | `docs/design/ZHAJING.md` |
| data | P1 | `docs/research/17..19-*.json`、`tools/build-data.mjs`、`data/*.json`、`shared/zhajing-constants.js` |
| engine | P2 | `server/sim/content/**`、`server/match/**`、`shared/{zjBonds,zhajingBase}.js` |
| content | P3 | `server/sim/content/kits/**`、`garrisons/**`、`bonds/**` |
| client | P4 | `public/js/**`、`public/css/**` |

依赖：P1 → P2/P3 → P4；P5/P6 由 Lead 收口。P2 与 P3 都要往 `server/sim/content/index.js` 注册，**注册行由 engine 独占**，
content 只提交自己的文件并在任务里写明需要的注册项。

---

## 5. 红线与风险

1. **不 commit / checkout / stash / reset**；本线文件保持未提交（`?? / M`）。
2. **不手改 `data/*.json`**：只改 `tools/build-data.mjs` + `docs/research/*`，再重新生成（AGENTS.md）。
3. **确定性**：`server/sim/` 不得出现 `Math.random` / 时钟 / 引擎近似 Math；包内 AI 投票的 `Math.random()` 一律换 `createRng(deriveSeed(...))`。
4. **golden 零位移**：任何 sim/数据改动后 `GOLDEN_FULL=1 node tools/golden.mjs`。
5. **0.3.1 → 0.3.3 语义移植**：包内 512 个文件与本仓不同，绝大多数是上游漂移，**只挑炸惊相关 hunk**；整文件覆盖必炸。
6. **静默失效三连**：`DOMAIN_NAMES` 少写、协议 `switch` 少 `case`、`gd.zhajing` 门写错——三种都不报错。
7. **数据体积**：data 侧净增 **+2.1 MB**（chess +1.71 MB / garrisons +0.15 / tokens +0.10 / bonds +0.05 / config +0.07，实测）。可接受，但要在 `docs/DATA.md` 记一笔。
8. **参考包不入库**：`modref/` 是本轮临时解压目录（1.44 GB 包里取了 173 MB 源码/数据），收尾时说明可删。

---

## 6. 实施进度

收尾交接见 [`ZHAJING-SPLIT-2026-10-28.md`](ZHAJING-SPLIT-2026-10-28.md)（做了什么、踩了什么坑、还差什么）。

| 阶段 | 状态 | 备注 |
|---|---|---|
| P0 基线与护栏 | ✅ 完成 | golden 288 基线；`modref/` 不参与 lint / imports 扫描；沙箱写权限问题定位（**子代理写不进仓库既有子目录**，宿主侧 `write`/`edit` 可用） |
| P1 数据层 | ✅ 完成 | 三个 research 源 + `tools/extract-zhajing-research.mjs` + `build-data.mjs` 三源合并（带 `IS_DEFAULT` 门）；`data/{config,chess,garrisons,bonds,items,bands,tokens,jibianBonds}.json` 落地（净增 ≈ **+2.1 MB**，计划稿原估 +4 MB 偏高） |
| P2 引擎层 | ✅ 完成 | `gd.zhajing` 全部门 + 盟约 `zj` 覆盖层 + 白值折算 + 惊变阶段 / 敌方惊变 / 双方卡池 + `bonds/addon/zjbonds.js`；`zhajing-mode` 25 / `zhajing-bonds` 5 / `jibian-*` 45 全绿 |
| P3 内容层 | ✅ 完成 | **9/9** 新干员 kit（含结城理）+ 4 条炸惊卫戍 installer + `noDeploySlot`；`zj-ops` 18 条数值断言 |
| P4 客户端 | ✅ 完成 | 大厅第二条目（`forms` 声明）、`createExtension`、局内惊变三块、规则页、fx kinds 9 条 |
| P5 资产与真机 | ⏳ 未做 | 提取命令在 `ZHAJING-COVERAGE.md` §6.1（必导 825 个 / 128.8 MB，本机导入，`public/assets/` 已 gitignore）；真机脚本未跑 |
| P6 文档与交接 | ✅ 完成 | `docs/ZHAJING.md`、`docs/EXTENSION_MODE.md`（§1.3 / §2.1 / §2.3 / §3.3 / 新增 §8）、`handoff/ZHAJING-SPLIT-2026-10-28.md`、`devtools/check-zhajing-isolation.mjs`、四语言包 40 条 × 4 |

---

## 7. 复现本文数字

```bash
# 解压参考包（只取源码/数据，跳过 node_modules 与 public/assets）
#   → modref/v2.1/（1 144 条、173 MB）
node -e "…"   # §1.1 的键级 diff、§1.2 的 mode 字段、§1.3 的模块行数（脚本见 handoff 附件）
node tools/golden.mjs && GOLDEN_FULL=1 node tools/golden.mjs   # 基线
```

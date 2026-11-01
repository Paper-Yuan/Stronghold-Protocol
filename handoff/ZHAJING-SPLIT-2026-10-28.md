# 炸惊模拟 → 独立玩法模式：拆分交接（2026-10-28）

> 接在 [`EXTENSION-MODE-2026-10-28.md`](EXTENSION-MODE-2026-10-28.md) §5.2「规则分离」之后。计划稿是
> [`ZHAJING-SPLIT-PLAN-2026-10-28.md`](ZHAJING-SPLIT-PLAN-2026-10-28.md)，隔离设计全文是
> [`docs/ZHAJING.md`](../docs/ZHAJING.md)，包内清单与验收矩阵是 [`ZHAJING-INVENTORY.md`](ZHAJING-INVENTORY.md) /
> [`ZHAJING-COVERAGE.md`](ZHAJING-COVERAGE.md)。
>
> 仓库：`E:\Workbox\系统`，分支 `align/0.3.0`。**红线：从不 commit / checkout / stash / reset。** 本轮全部改动仍未提交。

---

## 0. 一句话

炸惊模拟已经是本仓**第二个 `ready` 的拓展玩法包**（`difficulty: 'ZHAJING'`、`AC-8`、`mode_single_zhajing` /
`mode_multi_zhajing`）：专属棋库 205 条、惊变 99 + 21 张、惊变羁绊 18 条、新盟约 5 条 + 21 条盟约的炸惊覆盖层、
9 个新干员 kit、局内三块界面全部落地。**主玩法零位移**：官方四档 × 单人/同盟的卡池、道具池、策略、盟约记录与
「把 zj 记录从数据里删掉」的基线**逐字节相同**，`GOLDEN_FULL=1` 288 场景 `ok`。

---

## 1. 隔离是怎么做到的（这是本轮的核心）

**不建独立数据集**（计划稿 §2 的决策）：zj 记录进同一份 `data/*.json`，用标记 + 模式门隔离。

| 层 | 标记 / 门 | 位置 |
|---|---|---|
| 数据 | `chess.zhajing: true`（roster）、`items/bands/bonds.zjOnly: true`、`bonds.zj` 覆盖块 | `data/chess.json` 等，由 `tools/build-data.mjs` 从 `docs/research/17/18/19-zhaijing-*.json` 生成 |
| 引擎 | `gd.zhajing`（唯一开关）、`gd.jibian()` / `gd.enemyJibian()` / `gd.allyScale` / `gd.spPhaseKind()` / `gd.zjCombos` | `server/match/gamedata.js`，常量在 `shared/zhajing-constants.js` |
| 视图 | 非 ZHAJING 时 `zjBondView(bonds, { merge:false })` 只剥 `zj` 键、剔 `zjOnly` 盟约 | `shared/zjBonds.js` |
| 战斗 | `Battle.zj` 视图 + `withZjView` 包住**装配与每一步 `step()`**（`battle/lifecycle.js`） | `server/sim/Battle.js`、`content/support/index.js` |
| 白值 | `flags.allyScale` 折进 `unit.base`（不是战场乘区） | `server/sim/battle/players.js` |
| 界面 | 条目 `difficulty: 'ZHAJING'` + `forms: ['solo','coop']`（无蚀流档位） | `public/js/screens/extensionModes.js` |

**四条硬验证（都能跑）**：

```bash
node devtools/check-zhajing-isolation.mjs          # 本轮新加：官方 11 个 mode × 有/无 zj 记录 逐字节对比 + ZHAJING 只含 zj + data/versions 未污染
node --test test/match/zhajing-room.test.js        # 5   建房链路
node --test test/match/zhajing-mode.test.js        # 25  模式门 / 盟约覆盖 / 惊变抽卡 / 泄漏
node --test test/content/zj-ops.test.js            # 18  9 个新干员的数值断言 + 双向隔离
GOLDEN_FULL=1 node tools/golden.mjs                # 288 场景零位移
```

`check-zhajing-isolation.mjs` 的输出（本轮实测）：11 个官方 mode 的 `visibleChess` / `shopItemsByTier` / `bonds` /
`bans` / `bossWeights` 与「剥掉 zj 记录」的基线**完全相同**；ZHAJING 的 roster 99 条**全部** `zhajing:true`、
`jibian.pool 99`、`enemyJibian.pool 21`、21 条盟约覆盖生效、`allyScale {atk:2.5,def:3,hp:3}`；`data/versions/*` 三个
官方版本目录里 0 条 zj 记录。

---

## 2. 这一轮落地了什么（按层）

### 2.1 数据（`docs/research` → `data/`）

* 新增三个源：`17-zhaijing-mode.json`（两条 mode 记录 + `bans.ZHAJING {core:3,addon:4}` + `hiddenCore.difficulties`）、
  `18-zhaijing-content.json`（205 条 chess / 248 条 garrison / 5 条盟约 / 21 个 `zj` 块 / 11 条道具 / 2 条策略）、
  `19-zhaijing-jibian.json`（99 + 21 张卡与池级参数）。抽取脚本 `tools/extract-zhajing-research.mjs`。
* `tools/build-data.mjs` 增加三源合并（**只在默认版本生效**：`IS_DEFAULT` 门，四个官方版本的 `cs` 不变），
  `data/jibianBonds.json` 是新文件（18 条，**从引擎表生成**，`test/content/jibian-bonds.test.js` 做 `deepEqual` 镜像锁）。
* 净增：chess +1.71 MB / garrisons +0.15 / tokens +0.10 / bonds +0.05 / config +0.07，合计 **≈ +2.1 MB**。
* 记录口径三处**按包内实情**（不是猜）：6 条 `chess_zj_13/22/91` 保持 `zhajing:false`（副本，不进 roster）；248 条
  garrison 零标记、靠 `chess_zj_*.garrisonIds` 反向可达（**22 条无人引用的也保留**）；虎狼丸记录**无技能**
  （`character_table.skills = []`，官方角色本来如此）。

### 2.2 引擎（新增 ≈ 3.4k 行内容注册表 + ≈ 400 行接线）

* 惊变：`server/sim/content/jibian.js`（我方 99 张的 prep 侧 `registerMeta` + 战斗侧 `install`）、`ejibian.js`（敌方 21 张 +
  Match 侧 `matchJibianPlan` / `heavenTimeLimit`）、`jibianBonds.js`（18 条羁绊，纯数据 + 纯函数）、`mujica.js` +
  `mujicaBond.js`（Fever 库 + 颂乐人偶盟约）。
* 盟约覆盖：`shared/zjBonds.js`（`zj` 块合并、`bondsAll`、按 buff 分派的 `bb` 覆盖、装备组合表）、
  `content/bonds/addon/zjbonds.js`（岁 / 企鹅物流 / 医师三条 zjOnly 盟约的**战斗侧**）。
* 白值：`shared/zhajingBase.js`。
* 阶段：惊变阶段（3 选 1、已拥有排除、重抽服务端半边 `refreshSpCard`）、敌方惊变 R1/R6 抽取 + 整局累计 + 揭晓 +
  `flags.enemyJibian` + 出怪 plan + 天堂制造时限。
* 钩子：`effectsMeta.js` 的 `KEY_RE` 放行 `jibian:`（**少这一行 99 张卡整备侧全灭**）、`isMember` 的两条惊变分支、
  `blockFull` emit、`onRoundWouldStart` / `onWouldEliminate` 两个新时机事件、4 条炸惊卫戍 installer、`noDeploySlot()`。
* 平台：`shared/protocol.js` 收 `difficulty: 'ZHAJING'`；`server/lobby.js` 的 `fallbackDifficulty` 保住玩法包难度（不降档）、
  `room.setDifficulty` / `room.setErosion` 在炸惊房拒绝。

### 2.3 内容（9 个新干员）

`server/sim/content/kits/ops/` 下 9 个文件：颂乐人偶五人（`chess_zj_{amoris,dolris,mortis,oblvns,tmoris}-*.js`）+
`chess_zj_60_{2,3,4,5}-{kormr,aigis,yukari,makoto}.js`。注册走**新列表 `ZHAJING_KIT_FILES`**、键是**棋-id**
（`chess_zj_*_a`）——0.3.3 的 `officialKitKey` 在默认数据上只认棋-id 键，`op-*` 的 charId 键会**静默回落到 generic kit**，
而且会进 `KITTED_CHARS` 变成主玩法自选位。理由写在 `kits/README.md` 与 `kits_layout.test.js` 头注释。每个 kit 至少
1 条**数值断言**（18 条）。

### 2.4 客户端

* `EXTENSION_MODES` 第二条 `zhajing`（`AC-8`、`#17d9a0`、`blast`、104 干员位 / 99+21 惊变 / ×2.5 攻、`status: 'ready'`，
  **不声明 `theme`**：没有主视觉就不造图路径）。
* 新增 `forms: ['solo','coop']`：无 `erosionTiers` 也能画「单人 / 同盟」两枚 chip；湮灭行为零变化。
* `createAnnihilation` → **`createExtension(id, erosion, party)`**：`difficulty` 取条目自己的值，`erosion` 只对声明了档位的包发送。
* 局内：`public/js/ui/jibian.js`（三选一浮层**两步确认** + 已选惊变三页：我方 / 敌方 / 羁绊）、`public/js/ui/zhajingRules.js`
  （规则速览，**每条数字从 `config.json` 现算**）、`public/css/screens/jibian.css`。简报只写**阶段名**、不写卡面。
* `render/fx/kinds.js` 补 9 个 kind（`jibianBing` / `mujicaNote` / `mujicaFever` + 6 个既有缺口）。

### 2.5 文案

新增 40 条 msgid，四语言包**行级追加**（160 行）：`ja` / `ko` / `zh-TW` 现在 **2640/2640（100%）**，`en` 2387/2640
——差的 **253 条是 §5.1 的历史缺口**（本轮一条没加）。

---

## 3. 这一轮踩的坑（都有实测证据，接手前必读）

1. **`tokens.json` 会遮蔽 `backups.tokens`，把主玩法打移位**。`simdata.js rawToken()` 先读 `raw.tokens[id]`、再回落
   `rawBackups().tokens[id]`；那 12 个召唤物本来就在 backups 里有完整记录，把包内版本放进 `tokens.json` 后
   variant 表被替换（只剩 `char_XXXX@2/60/7/3` 与 `chess_zj_*`），DIY 局的伤害/击杀整片位移。**二分实测**：只换
   `tokens.json` → MISMATCH，其余七个文件单独换 → 全 match。处置：`tokens.json` 保持 22 条，zj 的 variant 写进
   `backups.tokens[id].variants`（棋-id 键），官方 key 与 zj key 共存。
2. **`zhajing:true` 不是全集判据**：205 条 `chess_zj_*` 里有 **6 条 `zhajing:false`**（`zj_13` 锡人 / `zj_22` 赫拉格 /
   `zj_91` 锏）。只按 `=== true` 过滤，「官方子集」的枚举会把它们漏进去——`standins` 家族就是这么被打翻的。
   正确判据是 `'zhajing' in c || /^chess_zj_/`（与 build-data 的 `isImportedChess` 一致）。
3. **`tools/golden.mjs` 有四处枚举必须按标记过滤**：盟约 `bondIds`、盟约成员池、`STANDIN_CHESS`、`BANDS` / `EQUIPS`。
   漏一处就「新场景冒出来 / 老场景 Composition 变了」，而报错只是一串 `dmg` / `kills` 数字。
4. **注册了不存在的 prep 钩子会静默失效**：`MetaRegistry.register` 对未知钩子只 push 一条 warning。本轮抓到
   `onLayout` / `onWouldEliminate` / `onRoundWouldStart` 三个。**新增一条守卫测试**：用真实 `MetaRegistry` 跑
   `registerMeta` 并断言 `warnings` 为空——以后再拼错立刻红。
5. **`kits/index.js` 里登记了不存在的文件 = 整个 content 套件变红**（`ERR_MODULE_NOT_FOUND` 被每个内容域记一次）。
   文件与注册行必须同一提交。
6. **配方：别用 PowerShell 改带中文的源文件**（`Get-Content -Raw` + `Set-Content` 会按 ANSI 代码页解码）。
   本轮 `room.css` 因此被写坏过一次，靠 `git show HEAD:` 取字节副本 + `edit` 工具重写回去才修好。**只用 read/edit/write 工具**。
7. **子代理的沙箱写不进仓库既有子目录**（`EPERM`，ACL 是不可继承的会话级 grant），只有宿主侧 `write`/`edit` 能写；
   `node --test <file>` 在子代理里会因 spawn 被拒，需 `node <file>` 直跑。收尾的全量测试与生成器重跑由 Lead 执行。
8. **`tools/build-data.mjs` 不幂等**：一律 `--out <临时目录>` 再逐文件搬运，别直接写 `data/`。

---

## 4. 当前红（区分归属）

| 测试 | 内容 | 归属 |
|---|---|---|
| `test/i18n.test.js` / `i18n --strict` | `en` 缺 253 条（**本轮之前就有**，见 `EXTENSION-MODE-2026-10-28.md` §5.1） | 历史遗留，**不要机器翻译硬填** |
| `test/client-static.test.js` | `public/css/traitOverlay.css` 的 `color-mix()` 无回退 | 别的会话未提交改动 |
| `test/docs-consistency.test.js` | `char_102_texas.gacha is not planned by default` | 别的会话改了 `data/assets.json` |
| `test/ui/versions.test.js` | 「不读 research texts」守卫 | HEAD 既有 |
| `test/ui/ui-size.test.js` | `loadout.css` / `lobby.css` 的 `max(rem,px)` 地板 | HEAD 既有 |
| `eslint` 3 条 error | `match/match/platform.js:146`、`sim/content/bosses.js:843`、`sim/snapshot.js:52` | HEAD 既有（`git show HEAD:` 里就在） |
| `test/render` 的资产 / spine 类 | 本机缺少部分美术 | 环境 |

本轮修掉的：`test/content/{bands,items,standin}.test.js`、`test/match/{morph-bonds,annihilation-erosion}.test.js`
的「官方子集」计数断言（新增 zj 记录后必须按标记排除，断言名里已写 official only）。

---

## 5. 未完成（下一轮的清单，按“挡不挡可玩”排序）

1. **`data/zjDefaultLoadout.json` 未落**（84 条默认模组）→ 与「干员调配炸惊页签」一起做。
2. **干员调配炸惊页签**（独立 entries / ops；`shared/zhajingBase.js` 的白值折算与 `gd.allyScale` 已就绪）。
3. **重抽按钮**：服务端 `refreshSpCard` 已就绪，缺**协议键 `g.cardRefresh`**（缺协议时画按钮就是假按钮）。
4. **敌方惊变揭晓浮层**（`flickerMs` / `resultMs` / `pool` 转盘，数据面已就绪）；**惊变一览**（`jibianList` 式面板）；
   **观战者看队友的惊变**。
5. **forge 锻造器**：整套未接入（协议 + `PlayerState` + sim 打击链 + 客户端四件套）。连带惊变「黑闪」的暴击率 /
   暴击回技力在 forge 落地前是**惰性**的。`DOMAIN_NAMES` 里**故意不留 `forge` 空位**。
6. **四张惊变卡未接完**：`ejibian_quanjunchuji`（全军出击，要改出怪表）、`jibian_siwanghuigui`（死亡回归，要改阶段机）、
   `jibian_erjiguan`（二极管，实现在卫戍侧）、`jibian_zhuiji` / `jibian_shiguangzhimo`（两个时机事件已由 engine-core
   补上 `onRoundWouldStart` / `onWouldEliminate`，**可以解注释了**）。
7. **隐秘惊变**（R14 前的保底隐秘卡，`applyHiddenMatchCards` 未调用）。
8. **惊变阶段仍是「一房一池轮流挑」**，包内是「每人一副独立牌池」；改 per-player 要动 `sp` 结构与 `m.public.sp`。
9. **美术资产未导入**：`handoff/ZHAJING-COVERAGE.md` §6.1 有可直接粘贴的提取命令（必导 825 个 / 128.8 MB，
   `public/assets/` 已 gitignore，绝不覆盖已有文件）。**本轮没有执行**——只做了代码与数据。
10. **真机未跑**：`devtools/render-check-extension-hall.mjs` 三档视口 + 新写一个「房内 → R1 惊变 → 战斗」的脚本。

---

## 6. 接手顺序（建议）

1. 跑 §1 的四条命令建立基线（约 2 min + golden 90 s）；再跑 `node devtools/check-zhajing-isolation.mjs` 看隔离是否仍成立。
2. 读 `docs/ZHAJING.md`（114 行钩子表 + 12 条不变量 + 12 条风险），它把「哪一处该加什么判断」写到了行号级。
3. 想继续做玩法：先做 §5 的 3（重抽协议）与 4（揭晓 / 一览），它们都只差客户端 + 一个协议键。
4. 想继续做内容：`handoff/ZHAJING-COVERAGE.md` 表 C 是 99 + 21 张卡的覆盖表，表 A-2 是「痕迹 58 里真有行为 44 条」，
   照表逐条打勾即可。
5. 动任何 sim / 数据改动后：`GOLDEN_FULL=1 node tools/golden.mjs`。

---

## 7. 证据索引（本轮）

| 类别 | 路径 |
|---|---|
| 计划 / 清单 / 验收矩阵 | `handoff/ZHAJING-SPLIT-PLAN-2026-10-28.md`、`ZHAJING-INVENTORY.md`、`ZHAJING-COVERAGE.md` |
| 隔离设计 | `docs/ZHAJING.md`（114 行钩子表、12 条不变量、12 条风险、附录 A 状态快照） |
| 数据源 | `docs/research/17-zhaijing-mode.json`、`18-zhaijing-content.json`、`19-zhaijing-jibian.json`、`tools/extract-zhajing-research.mjs`、`tools/build-data.mjs`（三源合并 + `IS_DEFAULT` 门） |
| 数据 | `data/{config,chess,garrisons,bonds,items,bands,tokens,jibianBonds}.json` |
| 引擎 | `shared/{zjBonds,zhajingBase,zhajing-constants,mujicaJibian}.js`、`server/match/gamedata.js`、`server/sim/content/{jibian,ejibian,jibianBonds,mujica,mujicaBond}.js`、`server/sim/content/bonds/addon/zjbonds.js`、`server/match/{choices,effectsMeta,bondsMeta,waves}.js`、`server/match/match/{phases,spDraft,views,combat,bossRounds,unitePhase,intents}.js`、`server/sim/{Battle.js,battle/{lifecycle,players,economy,blocking}.js}` |
| 平台 | `shared/protocol.js`（`room.create.difficulty`）、`server/lobby.js`（`fallbackDifficulty`） |
| 内容 | `server/sim/content/kits/ops/chess_zj_*.js`（9 个）、`kits/shared/{mujica,mujicaNotes,mod-tier3}.js`、`kits/index.js`（`ZHAJING_KIT_FILES`）、`kits/README.md` |
| 客户端 | `public/js/screens/{extensionModes,extensionThemeHall,lobby,room,briefing,game}.js`、`public/js/ui/{jibian,zhajingRules}.js`、`public/js/render/fx/kinds.js`、`public/css/screens/{jibian,room,briefing}.css`、`public/js/ui/gameLogic/shop.js` |
| 测试 | `test/match/{zhajing-room,zhajing-mode,zhajing-isolation}.test.js`、`test/content/{zj-ops,zhajing-bonds,jibian-*}.test.js`、`test/ui/{zhajing,zj-bonds-view}.test.js`、`test/ui/extension-modes.test.js` |
| 工具 | `devtools/check-zhajing-isolation.mjs`（本轮新增：官方 11 mode × 有/无 zj 记录的逐字节对比） |
| 文案 | `public/i18n/{en,ja,ko,zh-TW}.json`（行级追加 **41 条** × 4） |
| 参考包 | `modref/v2.1/`（从 zip 解出的 0.3.1-mod.4 源码与数据，**未入库**，收尾可删；`modref/inventory.json`、`modref/tools-*.mjs` 是清单脚本；`eslint.config.js` 已把 `modref/**` 加进 ignores，别删那一条） |

---

## 8. 收尾补记（本轮最后一小时，都在 Lead 手里）

1. **客户端还有一处「官方房间里会多出 5 条盟约」的漏洞，已修**：`data.list('bonds')` 绕过 `GameData`，于是简报 /
   策略草稿 / 局内「本局信息」/ 卡池总览会把岁 · 企鹅物流 · 医师 · S.E.E.S · 颂乐人偶画进官方房间。新增
   `public/js/ui/zjView.js`（`isZhajingRoom` / `officialBonds`）并在四处调用点接通；判据测试与**接线守卫**
   （源码断言：不许再直接传全量盟约）在 `test/ui/zj-bonds-view.test.js`（4 条）。`test/ui/match-info.test.js` 的三条
   源码断言同步改成新形态。
2. **`effectsMeta.js` 的 `HOOKS` 补进 `onWouldEliminate` / `onRoundWouldStart`**：engine-core 加了两个时机事件的
   派发点，但没进 `HOOKS` 白名单，于是每次启动刷一条 `[meta] … is not a hook and will never run`（`dispatch` 本身
   不按这张表过滤，卡片其实是能跑的——但警告会误导后来人）。补进去之后警告消失，追忆 / 时光之末两张卡的契约正式
   成立。
3. **i18n 最终态**：`ja` / `ko` / `zh-TW` **2641/2641（100%）**；`en` 2388/2641，缺的 **253 条**是 §5.1 的历史缺口
   （本线 **0** 条）。最后补的一条是 `追忆：回到第 10 回合`（追忆卡解注释后新增的 toast）。
4. **数据最终态**（`data/`）：`mode_*.name` = `炸惊模拟`（包内 `炸惊模拟（BETAv0.799325）` 记进 research 的 `_doc`）；
   `backups.tokens` 38 → **40**（结城理两个 Persona 召唤物）+ 11 条既有召唤物各追加 `chess_zj_*` variant（**只加键**，
   官方 114 条 variant changed = 0）；`tokens.json` **保持 22 条未动**（原因见 §3.1）。`docs/DATA.md` 的体量行与
   六处计数已跟着改（5.8 → 7.9 MB，上限 9 MB）。
5. **`_zjbuild/` 已删**（生成物与一次性脚本）；`modref/` 保留作证据，可随时整目录删除。
6. **全量 `node tools/test-run.mjs` 仍有大量红，但与本线无关**（逐条看过报错，列在 §4）：`test/match/fuzz.*`
   的 `{"t":"g.contract"}` `bad field id`（`shared/protocol.js` 里 `g.contract` 这一条**在 HEAD 里不存在**，是别的会话
   未完成的改动）、assets / 打包 CLI / plugin studio / advisor / match host 那一批，以及 `test/android-blackscreen`
   的 shell 断言。**我这条线动过的文件都有自己的测试且全绿**：zhajing-room 5 / zhajing-mode 25 / zhajing-bonds 5 /
   zhajing-isolation 54 / zj-ops 18 / jibian-* 45 / ui/zhajing 6 / ui/zj-bonds-view 4 / extension-modes 21 /
   match-info 12 / data 30 / versions-keying 46 / annihilation 17+14 / lobby 74 / morph-bonds+erosion 18。
7. **最后一遍全绿证据**：`GOLDEN_FULL=1 node tools/golden.mjs` → roster 49 / bonds 46 / fields 22 / matches 21 /
   standins 10 / diy 140，`ok`；`npx eslint .` → 7 error，全部在 HEAD 里就存在（`platform.js:146`、`bosses.js:843`、
   `snapshot.js:52`、`render/app/info.js:68`、`settle.js:579/581`）；`node tools/check-imports.mjs` → 3 条既有 note；
   `node devtools/check-zhajing-isolation.mjs` → `OK`。

---

## 9. 第二轮：接入整合（同日更晚）

业主追加「继续接入整合，确保本体和湮灭不受影响」。这一轮把**端到端**跑通、把三个局内界面接上、并抓到并修掉**两个
只在真实对局里才看得见的产品 bug**。

### 9.1 端到端已跑通（真实 Match，不是 Stub）

`test/match/zhajing-e2e.test.js`（13 条）：seed 7 单人局走完 `INFO_CHECK → BAND_DRAFT → **R1 惊变三选一**
（`m.public.sp.family === 'jibian'`，3 张都来自 `gd.jibian().pool` 的 99 张）→ `g.choice { idx }` 落地
（`effects` 出现 `jibian:<id>`、`private.jibian.owned` 增长）→ **R2 快递** → 每回合真实战斗/结算 → **R9 RESULT**
（roundsPassed 8，我方惊变 4 张、敌方惊变 2 张 = R1+R6），`reportError 0 / log.error 0 / INTERNAL 0`。

### 9.2 抓到并修掉的两个 bug（都只有真实对局能看见）

| bug | 位置 | 症状 | 为什么以前看不见 |
|---|---|---|---|
| **BUG-1 整备区槽位不读 `gd.benchSize`** | `server/match/PlayerState.js` 的 `this.hand` | 炸惊应是 20 格，实际 10 格；**每局开局即违反 `invariants.js`**；连带 `bot.js` 的「整备区快满就卖」启发式在炸惊下永不触发 | 没有任何测试对炸惊局跑 `m.invariants()` |
| **BUG-2 `effectsMeta` 的 ctx 缺 `effects()`** | `server/match/effectsMeta.js` | 金酒之杯 / 倒转区 / 潘多拉魔盒 / 时光之末 / 325799 的整备侧 handler **每次触发都抛异常**（`ctx.effects is not a function`），卡完全无效 | 错误只进 `log.error`，`m.errorCount` 仍是 0，golden 与不变量都不动 |

修法：① 一行照参考包读 `this.gd.benchSize`；② 加 `effects: () => ps.effects.slice()`（**浅拷贝数组、元素是同一批 ref**——
包内那份 `map(e => ({...e}))` 会让 `params` 写回对不上对象）。两条各留永久回归用例（e2e 的「5 张卡逐张派发真钩子并断言
数值」+ 回归锁里「炸惊局 R1→R3 全量 `collectViolations` 为空」）。

### 9.3 又接完的三个玩法面

1. **重抽端到端**：`shared/protocol.js` 的 `'g.cardRefresh': { idx: 0..6 }` + `intents.js` 的 `case`（0.3.3 的 `g.*`
   switch 在这里，不是 `Match.js`）+ `spDraft.refreshSpCard` 的错误契约（`BAD_TARGET` / `RATE` / `ALREADY`）+ 客户端
   按钮（协议驱动：`C2S['g.cardRefresh']` 存在才画）。**普通局发这个键必拒**。
2. **同盟草稿改「每人一手 3 张」**：`spDraft._dealJibianFor` 在换人时重发，`exclude` = 该玩家已拥有 + 已被别人**选走**的卡；
   被选中的进 `sp.jibian.claimed`（真正离开牌库），只是摆过的回池子。`sp.cards` 形状不变 → 客户端零改动。
   4 人房从「每人 1 张」修成「每人 3 张」。
3. **隐秘惊变（R15）**：`phases.startRound` 在 `drawEnemyJibian` 后调 `drawHiddenJibian(r)`——保底 1 张 `hidden` 稀有度
   （`enemyJibian.hidden.pool` 10 张）+ 1 张普通池卡，双双进 `enemyJibianCards`/`enemyJibianList`（`hidden: true`），
   当轮执行 `applyHiddenMatchCards`（打响指 ×0.5 / 诛伏赐死清盟约层）；不新增 PHASE。`m.public.enemyJibian` 增
   `hidden` / `ordinaryCard` / `hiddenLabel` / `hiddenFlickerMs` / `hiddenResultMs`。官方四档与湮灭**一位不多、一格 rng 不耗**。

### 9.4 客户端三块

敌方惊变**揭晓浮层**（`flickerMs` 只在 `pool` 里翻牌、剔掉刚抽到的这张 → 定格前不泄露；可跳过；减动效直出；
只在「新抽到」时触发）、**惊变一览**（99 张按稀有度分组、已拥有打勾、纯只读）、**重抽按钮**（每卡一键、显示
`rerollsLeft`、0 次禁用但在、非我回合/已选完不画）。新增 1 条 msgid `惊变一览`（四包已补）。

### 9.5 本体 / 湮灭的回归锁（新的永久资产）

`test/match/extension-modes-regression.test.js`（11 条）：普通局 `m.public` 深扫零 `jibian|zj` 键 + 写死字段
（`modeId`/`difficulty`/`round 0`/`lastRound 14`/`bossRound 14`/`hiddenRound 15`）+ 数据面数字（visibleChess 112 /
bondIds 23 / 官方 `spRounds` 仍 `[6,9]` / 1..14 回合 `spPhaseKind` 全 null）+ **`m.private` 没有 `jibian` 键**
（`player/views.js` 是 `gd.zhajing ? … : {}`）；湮灭蚀流 1..6 阶梯、同盟湮灭、藏品三选一、毒雾真实掉血；以及
**两种顺序交替运行**后普通/湮灭的 `m.public`、`gd.bondIds`、每条盟约记录、`visibleChess`、道具池、策略池、`bans`、
`m.private` 与「本进程没跑过任何对局」的基线**逐字节相同**（`withZjView` 的泄漏锁）。

### 9.6 二轮验证（照抄可跑）

```bash
node --test test/match/zhajing-e2e.test.js test/match/zhajing-drafts.test.js test/match/zhajing-refresh.test.js \
           test/match/zhajing-mode.test.js test/match/zhajing-room.test.js test/match/zhajing-isolation.test.js \
           test/match/extension-modes-regression.test.js test/match/annihilation-mode.test.js \
           test/match/annihilation-erosion.test.js test/match/fuzz.test.js \
           test/content/zj-ops.test.js test/content/zhajing-bonds.test.js test/content/jibian-*.test.js \
           test/ui/zhajing.test.js test/ui/zhajing-panels.test.js test/ui/zj-bonds-view.test.js \
           test/ui/extension-modes.test.js test/ui/match-info.test.js test/infinite-room.test.js \
           test/data.test.js test/versions-keying.test.js
# → 358 tests, 358 pass, 0 fail

node devtools/check-zhajing-isolation.mjs     # OK：官方 11 mode × 有/无 zj 记录逐字节相同；data/versions/* 零 zj
GOLDEN_FULL=1 node tools/golden.mjs           # 288 场景 ok（93–110 s）
node tools/i18n.mjs check --all --strict      # ja/ko/zh-TW 2643/2643（100%）；en 缺 253 条 = 历史缺口
```

### 9.7 这一轮仍未做（挂账不变，只刷新了状态）

`forge` 整套、`ejibian_quanjunchuji`（全军出击，要改 boss 出怪表）、`jibian_siwanghuigui`（死亡回归，要改淘汰回滚状态机）、
干员调配炸惊页签 + `data/zjDefaultLoadout.json`、观战者看队友的惊变、美术资产导入（`ZHAJING-COVERAGE.md` §6.1）、真机脚本。

另有一条**与本线无关的既有红**：`test/ci-shards.test.js` 报 `ci-shards.json weighs files that are not test files`
——`ci-shards.json` 里留着 `test/ui/bond-collapse.e2e.test.js` 这个已不存在的键（别的会话删文件留下的），不在本线写域。

---

## 10. 第三轮：整合测试 + 各模式隔离 + 双端 UI（同日再晚）

业主追加「继续进行整合测试，并做好各模式隔离和双端 ui 适配」。这一轮没有新玩法，做的是**证据**：把「每个模式的池子
等于它应有的集合」「整条 ws 链路」和「炸惊每一屏在桌面/手机上都站得住」各自变成可复跑的东西，并顺手修掉 3 个缺陷。

### 10.1 全模式隔离矩阵（新）

| 产物 | 内容 |
|---|---|
| `test/match/mode-isolation-matrix.test.js`（21 条） | 逐模式断言「能看到的池子 = 它应有的精确集合」：`mode_training_1` + 官方 4 档 × 单人/同盟（8）+ 湮灭 2 + 炸惊 2 + 超限（`solo_infinite`/`coop_infinite` 推出的 modeId）。每组都钉 `visibleChess` / `shopItemsByTier` / `bandIds()` / `bondIds` + 逐条 `bond()` / `bans()` / `bossWeights()` / `stages` / `spRounds` / `spPhaseKind`，以及**玩法包专属字段的存在性**（`annihilation`+relics+hazard 只在湮灭；`jibian()`+`enemyJibian()`+`allyScale`+`zjCombos` 只在炸惊；官方四档三者皆 null） |
| `devtools/check-mode-isolation.mjs` | 同一套判据的 CLI，打印矩阵表（行 = 模式，列 = 棋库/道具/策略/盟约/藏品/毒雾/惊变/白值/门），越界 exit 1；当前 `RESULT: OK` |
| 三条方向性断言 | ① 只有湮灭有藏品/毒雾 ② 只有炸惊有惊变/白值膨胀/炸惊棋库 ③ **官方八档互相同构**（除 difficulty 与自身 mode 记录外逐字节相同），solo↔coop 只允许由 `bands[].modeTypeList` 解释的策略差异（当前 +0 / +0） |
| 版本数据 | 三个 `data/versions/*` 目录：7 modes、**0 条 zj**、无 `jibianBonds.json`、无玩法包字段 |

实测矩阵：官方 8 + 训练 = **112 棋 / 51 道具 / 40 策略 / 23 盟约**（relic/fog/jibian/ally 全无）；湮灭 2 = 同池 +
`annihilation`（fog、8 stages、9 spR）；炸惊 2 = **97 棋 / 53 道具 / 42 策略 / 28 盟约** + 惊变 99/21 + 白值 3/3/2.5。

### 10.2 整链路整合测试（新）

`test/zhajing-flow.test.js`（10 条，ws 平台层 + 真实 Match）：建房（单人/同盟，`room.state` 带 `difficulty: 'ZHAJING'`
且**无 `erosion` 键**）→ 房内拒绝（`setErosion` → `BAD_MSG`、`setMode(玩法包 modeId)` → `BAD_TARGET`、
`setDifficulty(ZHAJING)` → `BAD_MSG` 来自协议枚举）→ `room.ready` + `room.start` → `m.public.modeId` → 两客户端
`m.private` 各归自己 → 断线重连 → **反例**（普通/湮灭/炸惊三种房同链路，`room.state` 键集合只差 `erosion`）→
真实 Match 的 R1 草稿经 ws 广播 + `g.choice` 落地 + `g.cardRefresh`。

### 10.3 双端 UI 适配（新）

* `test/ui/zhajing-adapt.test.js`（12 条）：三档断点、矮屏让位与保留、6 处触摸地板、38 处字号地板、层级、
  reveal 的 `max-height`+滚动、减动效名单与顺序、简报阶段表换行、真机脚本参数与截图命名。
* `devtools/render-check-zhajing.mjs`：4 档视口 × 10 屏（大厅 → 拓展大厅 → 房间 → 规则 → 简报 → 敌方揭晓 →
  定格 → 惊变三选一 → 一览 → 已选惊变），断言 0 console error、无横向溢出、浮层在视口内、触摸目标尺寸；
  **四档全 `RESULT: OK`**，截图落在 `handoff/shots/zhajing-<w>x<h>-<step>.png`（4 × 10 = 40 张，同名覆盖可对比）。
* 修掉的 9 处（都是真机才看得见）：

| # | 症状 | 根因 | 修法 |
|---|---|---|---|
| 1 | 手机/桌面上惊变草稿横幅写「机变阶段」 | `public/js/ui/gameLogic/phases.js` 把 `SP_DRAFT` **硬编码**成机变阶段（`sp.family` 其实没丢） | 新增 `draftFamilyOf / isJibianDraft`（顶层缺失时退回卡上的 family），横幅出「惊变阶段 / MUTATION」，HUD 胶囊同步 |
| 2 | 敌方惊变揭晓「图压文、描述被裁」 | 回合过场板 `.mpop--round`（`--z-banner: 40`）压在 z 26 的揭晓上 | `.zjrev` → `fixed; z-index: 45`，卡面改**图左文右 grid**，定格帧描述 `clipped: false` |
| 3 | 667×375 揭晓只有 ~250×180、`跳过` 20px | 矮屏仍是 `min(6.4rem, 94vw)` | 矮屏 `width: 96vw` 全宽单列 + `跳过 ≥32px`（实测 40×32） |
| 4 | 已选惊变面板卡名截成「全军…」 | 稀有度块与名字抢同一 flex 行 | `.zjsel__top` 改 grid：名字占整列两行、稀有度下一行（实测 `cut: false`） |
| 5 | 手机上全体字号掉到 7–9px | `jibian.css` 字号是纯比例 | **38 处** `font-size` 全部 `max(<地板>px, calc(k * --t))`（10–18 六档） |
| 6 | `.zjbtn` / 重抽键 / 面板页签 / 关闭键在 844×390 只有 ~17.6px | 触摸目标随文字大小缩 | 全部 `max(.44rem, 24px)`（≤32px 的按 ui-size 守卫裸写 px） |
| 7 | **房内「规则」在手机上 0×0**（手机端唯一阅读入口消失） | `room.css` 的 `@media (max-height:520px)` 把 `.rs-tools` 整排 `display:none` | 该块里 `.rs-tools { display: contents }` + 只留 `[data-testid="zj-rules"]`，并给 24px 地板（14 → 24px） |
| 8 | 惊变一览在矮屏 6 列、四字名全被吃掉 | 列宽 `minmax(1.4rem, 1fr)` | 矮屏 `minmax(2rem, 1fr)`（3 列，名字读得全） |
| 9 | 回合/阶段过场板会短暂（≤2.5s）压在三选一上 | `.zjov` z 21 < 板 40（与机变 `.spov` z 20 同一策略） | **有意保留**（与机变一致；那块板写着当回合经济信息）。要改是一行 `.zjov { z-index: 45 }` |

竖屏 390×844 本仓给的是 `rotate-hint`（既有设计，证据 `zhajing-390x844-lobby.png`），不在矩阵内。

### 10.4 这一轮修掉的三个缺陷

1. **`visibleChess` 丢了 `grantOnly` 排除**（`server/match/gamedata.js`）：参考包 0.3.1 有 `c.grantOnly === true` 这一条，
   本仓移植时没带过来，全仓 `grantOnly` 是死字段 → 重岳 / 白铁（`chess_zj_chyue_*` / `chess_zj_ironmn_*`）被摆进
   炸惊商店，玩家可以不拿「祀」策略就买到。现在排除（炸惊棋库 **99 → 97**），数据侧的 4 条记录保留（策略发放
   `grant(..., { requirePool: false })` 不经过 `visibleChess`）。matrix CLI 从「越界 2 处」变 `RESULT: OK`。
2. **`m.private.jibian.rerollsLeft` 在草稿首帧是过期的 0**（`server/match/match/spDraft.js` 的 `enterSpDraft`）：
   它只 `markPublic()`，而 `jibianRerollsLeft()` 读 `this.sp`（此刻刚建好）→ 客户端「重抽」键整局 disabled。
   现在 惊变 草稿额外给每个存活玩家 `markPrivate(ps)`（其它家族不读 `sp`，不付这个成本）。实测首帧 `rerollsLeft = 4`。
3. **`data/` 不能字节级重建**（既有问题，顺手修掉）：`data/bonds.json` 的 `egirShip` / `miraShip` 两条 `spec` 是
   别的会话**只改数据不改 research** 的手改，导致 `tools/build-data.mjs --version act2autochess --offline` 复现不出
   `data/`。把这两段 spec 落回 `docs/research/02-bonds.json`（文本手术，1 空格缩进与其它内容一字未动）后，
   **`data/` 九个文件全部字节级重建**，`test/data-versions.test.js` 的复现断言恢复绿。同轮把该文件的默认版本
   期望计数（23/40 → 28/42）与数据文件名正则（允许驼峰 `jibianBonds.json` 与机器文件的连字符 `asset-hashes`）更新。

### 10.5 三档验证（照抄可跑）

```bash
node --test test/match/zhajing-{room,mode,isolation,e2e,drafts,refresh}.test.js \
           test/match/{extension-modes-regression,mode-isolation-matrix,annihilation-mode,annihilation-erosion}.test.js \
           test/zhajing-flow.test.js test/infinite-room.test.js test/lobby.test.js \
           test/ui/zhajing{,-adapt,-panels}.test.js test/ui/{extension-modes,ui-size,zj-bonds-view}.test.js
# → 322 tests, 322 pass, 0 fail

node devtools/check-mode-isolation.mjs   # RESULT: OK（每模式池子 = 应有集合；版本目录无玩法包字段）
node devtools/check-zhajing-isolation.mjs # OK（官方 11 mode × 有/无 zj 记录逐字节相同）
GOLDEN_FULL=1 node tools/golden.mjs      # 288 场景零位移
node tools/i18n.mjs check --all --strict # ja/ko/zh-TW 2643/2643（100%）；en 缺 253 条 = 历史缺口

# 双端真机（需 Chrome + 本仓服务端；PORT=3020 node server/index.js）
node devtools/render-check-zhajing.mjs   # 4 档 RESULT: OK，40 张截图 → handoff/shots/
```

### 10.6 仍未做（与前两轮相同，仅状态刷新）

`forge` 整套、`ejibian_quanjunchuji`（全军出击）、`jibian_siwanghuigui`（死亡回归）、干员调配炸惊页签 +
`data/zjDefaultLoadout.json`、观战者看队友的惊变、美术资产导入（`ZHAJING-COVERAGE.md` §6.1）、adb 真机。

---

## 11. 第四轮：炸惊房锁定 / 二级界面 / 湮灭专属 mod（同日深夜）

业主两条口径：①「炸惊锁定难度锁定卡池，进入房间时左下的『第二期下半』改为『炸惊一期』且暂时不能调整，难度也锁定；
因为卡池做了改动，因此在二级页面添加独立调整按钮，而不进入主内容的干员调配和 sweep 档案」；②「炸惊的卡池调整还是维持原版的
界面逻辑，毕竟炸惊也要和湮灭一样有二级界面」；③ 给湮灭加 8 个专属 mod（阿戈尔加强 / 通讯机与寻呼模块 / prep-loadout /
unequip / morph-plus / shop-bond-bias / 罗德岛盟约 / 卡兹戴尔盟约），「和炸惊同理，而且因为有功能改动也在二级页面补上一个对应的
功能设置界面」。

### 11.1 炸惊：房间锁 + 二级界面 + 卡池调整

| 项 | 落地 |
|---|---|
| 版本胶囊 | 炸惊房显示 **`炸惊一期`**、`disabled`、`title`/`aria-label` = `玩法包自带卡池，版本已锁定`、`data-locked="play-set"`；官方房仍走 `versionLabel()`（逐字节不变） |
| 难度胶囊 | `data-locked="play-set"`、虚线边 + 玩法包绿 + `cursor:help`，可点但只弹提示；⚙ 里的「模拟难度」行同步禁用；矮屏胶囊抬到 32px |
| 二级界面 | `EXTENSION_MODES[1]` 新增 `theme: { kicker: 'BLAST SIMULATION // FIELD MANUAL' }`（**不声明 `art`**，`.ext-theme__art-img` 为 0）；列表页只画「进入」，`单人/同盟` + `开始` + `规则` + `卡池调整` 都在二级页；留白只在 `[data-theme="zhajing"]` 里垂直居中（矮屏回顶部） |
| 卡池调整 | **回到原版界面逻辑**：点 `extension-pool-edit` 打开**既有的「干员调配」整屏**（`loadout.js`），顶上多两颗档位键（`普通` / `炸惊模拟`）；炸惊档名册 99 条（97 可抽取 ∪ 2 条 grantOnly，`策略` 短标），技能 / 模组下拉照原组件；返回键回二级页。**删掉了**上一版试做的独立 `zj-pool-editor` 面板 |
| 服务端 | `room.setDifficulty` / `setMode` / `setPlugins` → `BAD_TARGET`（`the play set locks the room …`）、`room.proposeVersion` → `VERSION_UNSUPPORTED`；`room.loadout` 加可选 `mode: 'zhajing'`（两档并存，`seat.zjLoadout` 独立字段，空档 = 逐字节现状）；`PlayerState.zjLoadout` 在炸惊局与 `loadout` 合并交给 `resolveLoadout` |
| 新增文案 | `炸惊一期` / `玩法包自带卡池，版本已锁定` / `卡池调整`（四包已补；`由策略发放` 最终未用，留在包里闲置） |

**不动湮灭**：湮灭房 `room.setDifficulty` 仍可把房间改回官方难度（既有规则），`test/zhajing-flow.test.js` 两个分支都钉住。

### 11.2 湮灭：8 个专属 mod

数据（`docs/research/20-annihilation-mods.json` + `tools/extract-annihilation-mods.mjs`，生成器 `--offline` 全绿、`data/` **字节级可重建**）：

* 新盟约 **`rhodesShip` / `kazdelShip`**（`annOnly: true`）+ `chess[].annBonds`（20 条棋 / 26 条边）+ `egirShip`/`raidShip` 的
  `ann` 覆盖块。包内 `chess.json` 303 KB/222 KB 是 0.3.0 旧快照（会减盟约、回退 tier/stats），**一律不合并记录**，只取 delta。
* 净增 **`bonds.json` +11.6 KB（28→30）/ `chess.json` +586 B**，其余 15 个文件逐字节不变。
* 两条新盟约**只有计数 / 层数 / 档位 / 卡面**，效果未接（`bondeffect_rhodes`/`bondeffect_kazdel` 的 8 个 `bb` 键在本仓 0 读点，
  属新机制），面板与文档都标「仅计数与展示」。
* 跳过：本仓没有的 26 条 `chess_char_9_*`、上游漂移字段、包自带美术（不进 git）、两个包相同的通用 `install.mjs`（不执行）。

引擎（`gd.annihilation` + 房间开关双重门）：

* **阿戈尔加强**：`installEgir` 内部（官方 devour 之后），开战 `unit.base.atk += 0.5×层数`（固定加算，不是乘区）、5 名档复活者 +50 攻速。
* **通讯机 / 寻呼模块**：`builtinMeta.js` 的两个内置处理器内部加分支（**不走 `item:` 注册，否则与 `effect:<buffKey>` 双发**），按「层数最高的核心盟约」优先抽人；与 `shopBias` 无重叠（后者只影响商店刷出的装备）。
* **`annBonds`**：战斗侧 `unitBonds(u, battle)` 的可选参 + 缓存键带开关组合；整备侧 `bondsMeta.pieceBonds`；两条盟约各按自己的开关。
* **`ann` 覆盖层**：`shared/zjBonds.js` 的 `overlayBondView(bonds, key, {merge})` 泛化（`zj` 行为逐字节不变），`gamedata` 里
  串一层 `overlayBondView(·, 'ann', { merge: this.annihilation !== null })` —— 官方四档与炸惊拿到的是剥掉 `ann`、删掉两条
  `annOnly` 的记录。

房间设置（`docs/ANNIHILATION-MODS.md` 的设计）：

* **`Room.annMods`**（与 `erosion` 同级、**绝不进 `cs`**），`room.create.annMods` + 新房内消息 `room.setAnnMods`；
  `room.state.annMods` **只在湮灭房**出现，只含 `true` 键；非湮灭房发 `setAnnMods` → `BAD_TARGET`。
* **`gd.rulesOf(name)`**：官方缺省 → `mode.annRules` → 房间 `annMods` → **插件内容集最强**；四个开关的消费点没动，只换了
  「值从哪来」。**`gd.annMod(name)`** 给四项内容开关（用 `rulesOf` 读它们永远是空，这是最容易写出的静默 bug）。
* **面板**：湮灭主题大厅 `extension-feature-settings` → `ann-feature-settings`，8 行 `role="switch"`（上 4 行直接借
  `RULE_SWITCHES[].phrase`，零新字面量；下 4 行是四条新词条，后两条标「仅计数与展示」），页脚 `下一局生效`、非房主/已开局
  只读（`由创建者设置`）。全关 = 官方行为（`battle.flags` 里连 `annMods` 键都没有）。

### 11.3 验证

```bash
node --test test/match/zhajing-{e2e,mode,room,room-lock,loadout,drafts,refresh,isolation}.test.js \
           test/match/{mode-isolation-matrix,extension-modes-regression,annihilation-mods-settings,annihilation-mods-isolation}.test.js \
           test/match/{annihilation-mode,annihilation-erosion}.test.js test/zhajing-flow.test.js \
           test/content/{annihilation-mods,zj-ops,jibian-bonds,jibian-cards}.test.js \
           test/ui/{zhajing,zhajing-panels,zhajing-adapt,zhajing-loadout,annihilation-settings,extension-modes,lobby-hub,zj-bonds-view,match-info,ui-size}.test.js \
           test/{data,data-versions,versions-keying,lobby,infinite-room}.test.js
# → 583 tests / 577 pass / 0 fail

GOLDEN_FULL=1 node tools/golden.mjs        # 288 场景零位移（本线四轮一共跑了 8 次，均为 ok）
node devtools/check-mode-isolation.mjs     # RESULT: OK
node tools/i18n.mjs check --all --strict   # ja/ko/zh-TW 2646/2646（100%）；en 缺 253 条 = 历史缺口
PORT=3020 node server/index.js & node devtools/render-check-zhajing.mjs  # 4 档 RESULT: OK，15 屏/档
```

### 11.4 仍未做

`forge` 整套、`ejibian_quanjunchuji`、`jibian_siwanghuigui`、`data/zjDefaultLoadout.json`（炸惊的默认模组表）、
观战者看队友的惊变、两套新盟约的**效果**（缺两个 `bondeffect_*` 处理器 + 8 个 `bb` 读点）、美术资产导入（含
`rhodesShip`/`kazdelShip` 的盟约图标）、adb 真机。`room.setAnnMods` 目前只有大厅入口（房内入口是死代码，语义已备）。

另：`test/ci-shards.test.js` 的既有红（`ci-shards.json` 残留 `test/ui/bond-collapse.e2e.test.js` 键）仍在，不在本线写域。

---

## 12. 第五轮：挂账清空（forge / 全军出击 / 死亡回归 / 观战 / 预填 / 美术）

业主口径：「挂账不变：forge 整套、全军出击、死亡回归、干员调配炸惊页签 + zjDefaultLoadout.json、观战队友惊变、美术资产导入、adb 真机 —— 这部分看看 forge 需不需要，除此之外全部做到对应模式里去」。

### 12.1 forge（锻造器）：**判定需要做，已做完**

判据不是「包里有就搬」：`g.forgeTake` 是**面向玩家的玩法**（包内 `public/js/ui/forge.js` 231 行：HUD 按钮 + 悬浮窗 + 计数 + 已锻造面板），发放来自精英击杀 1 个 / 每 40 击杀 1 个，并且我方惊变「黑闪」的暴击率靠它生效 —— 不做就是「一整块玩家可见的玩法缺失 + 一张卡死掉」。

| 层 | 落点 |
|---|---|
| 共享 | `shared/forgeData.js`（233 行：`FORGE_KILLS_PER=40`、三档稀有度 70/20/10、9 个选项表 + 数值文案、抽卡/应用/求和全是纯函数，rng 一律外部传） |
| 协议 | `g.forgeTake { optId, rarity }`（两字段必填，`rarity` 必须与 `rolled.rarity` 一致） |
| 状态 | `PlayerState.forge = { count, killsPaid, elites, forged, roll }`（**非炸惊为 null**）、`m.private.forge`、观战 `m.field.forge` |
| 发放 | `player/acquire.js` 的 `forgeOnElite`（三合一 / 升华各接一次）与 `forgeOnKills`（settle 累加后，含联防击杀、幂等） |
| 战斗 | `flags.forge`（普通场扁平）+ `flags.forgeByPlayer`（boss / 隐秘核心 / 联防按玩家索引；缺键整键不出现）；`server/sim/content/forge.js` 读两种形状，`range→rangeExtend`、`block→blockCnt`、`spMul→skill.spCostMul`（倍率 + `u.mem` 幂等），`crit`/`vamp` 由 forge 钩子**自己求和**（0.3.3 的 buffs 没有 `critRate` 键、会静默忽略；黑闪走同一个求和口） |
| 注册 | `DOMAIN_NAMES` 加 `'forge'`（漏了是静默失败），install 自带 `_forgeInstalled` 幂等护栏（双装 = 一次命中 ×4，已被测试抓住） |
| 客户端 | HUD 第四列（按钮带数量 / 击杀计数 `n · 本档/每档` + 进度条 / 已锻造徽标）；点卡发 `g.forgeTake`，**有存货接下一组、最后一个才关**；拿到新锻造器不主动弹窗；**数值表一行都没抄**（import `shared/forgeData.js`，测试钉住） |

### 12.2 全军出击（`ejibian_quanjunchuji`）

`waves.js` 新增 `bountyEnemyKeys(gd)`（129 条悬赏 → 86 个可抽 key）与 `applyQuanjunchuji`：boss 波里**非领袖小怪整体换成随机悬赏怪**，保留 `boss` / `part` / `preview.boss` / 本体 bossId / `rank BOSS` 五类；**数量、时间、间隔不动**（与 `countMul` 因此不叠加）；随机走波次流 rng（同 seed 同结果）；缺卡/空池时 `JSON.stringify(spawns)` 逐字节不变。

### 12.3 死亡回归（`jibian_siwanghuigui`）

**被动路径完整**（卡面写的就是「因目标生命归零淘汰时」）：`player/round.js` 的 `startRound` 末尾抓一份快照 `{ round, shop[3], uids:Set }`（只在炸惊 + 持卡时；其它模式零开销）；`deathReturnTrigger` 三重门（模式/卡/一局一次）→ `alive=true`、`lp = max(1, 按下时)+3`、回滚、卡改名「死亡回归（已消耗）」/描述「它不再保护你」、登记 `m._jibianRewindRound`；`afterSettle` 消费它 `startRound(同一回合号)`（不新增 PHASE）。**`funds` 不还原**（退回干员回池、钱不退）；本整备获得的棋子（uid 不在快照集合）`removeTokensOf` + `returnCopies` 回池；商店三槽还原；`pendingFunds=0`；一局一次。回退到惊变回合时只让发动者再选一次（`_jibianSoloPick`，**写入前判 `spPhaseKind === 'jibian'`** —— 否则标记会飘到下一个惊变回合，把所有人的草稿收窄成一个人）。**主动按钮 + 播报未做**（本仓客户端没有这个按钮，卡面语义是被动）。

### 12.4 观战队友惊变 / 炸惊档预填 / 美术 / adb

* **观战**：零新协议 —— `jibianFromEffects(field.effects, modeId)` 从效果栏取 `jibian_*` 条目（稀有度/风味/羁绊由模式池补），观战时第一页标题变 **`TA 的惊变`**，自己的 private 一点不动；顺手接 `m.field.forge`。
* **预填**：`data/zjDefaultLoadout.json`（生成物，83 条 `byBaseId` —— 包内 84 减掉赫拉格那条没打 `zhajing` 标记的）→ 只在**本机无存档**时预填，且只留「与记录默认不同」的条目（与服务端 `checkLoadout` 的「等于默认就不存」同一条规则）；普通档完全不碰。
* **美术**：新工具 `tools/import-extension-assets.mjs`（`--apply` 才写；`public/assets` 是 git-ignored）把 mod 包里的美术搬进工作树：两条湮灭新盟约的图标（`rhodesShip` / `kazdelShip`，`bond` 目录 23 → 25）；另外从炸惊包 zip 里按 charId 抽了新干员的 **700 个文件**（avatar/illust/portrait/skin_avatar/spine/voice）—— 炸惊 99 个干员位现在**没有一条缺图**（此前 9 个新干员 0 条美术）。仍缺：11 个 `zjOnly` 道具图标（包里本来就没有）、全量官方美术仍走 `tools/fetch-assets.mjs`（GB 级、会重写 `data/assets.json`，本轮未跑）。
* **adb 真机**：`adb` 在 `C:\Users\J1825\AppData\Local\Android\Sdk\platform-tools\adb.exe`，**当前没有设备连接**（`adb devices` 为空）；`devtools/render-check-mobile-adb.mjs` 需要先 `adb reverse` + 手机 Chrome 开调试。桌面四档视口已全绿，真机等设备插上再跑。

### 12.5 验证

```bash
node --test test/match/zhajing-{forge,death-return,drafts,e2e,mode,room-lock,room,loadout,refresh,isolation}.test.js \
           test/match/{mode-isolation-matrix,extension-modes-regression,annihilation-*}.test.js \
           test/content/{zj-forge-quanjunchuji,annihilation-mods,zj-ops,jibian-*,choices}.test.js \
           test/zhajing-flow.test.js \
           test/ui/{zhajing-forge,zhajing-loadout,annihilation-settings,zhajing,zhajing-panels,zhajing-adapt,zj-bonds-view,extension-modes,lobby-hub,ui-size}.test.js \
           test/{data,data-versions,versions-keying,lobby,infinite-room}.test.js
# → 659 tests / 653 pass / 0 fail

GOLDEN_FULL=1 node tools/golden.mjs        # 288 零位移（本轮共跑 4 次，全 ok）
node devtools/check-mode-isolation.mjs     # RESULT: OK
node tools/i18n.mjs check --all --strict   # ja/ko/zh-TW 2664/2664（100%）；en 缺 253 条 = 历史缺口
npx eslint .                               # 7 error，全部 HEAD 既有
node devtools/render-check-zhajing.mjs     # 四档 16 屏/档 RESULT: OK（新增 forge 一屏）
```

### 12.6 仍未做

死亡回归的**主动按钮 + 播报**（缺两条播报 i18n，客户端也没有这个按钮）；两条湮灭新盟约的**战斗效果**（`bondeffect_rhodes` / `bondeffect_kazdel` 的 8 个 `bb` 键在本仓 0 读点，面板已标「仅计数与展示」）；11 个 `zjOnly` 道具图标（包内没有）；全量官方美术（`fetch-assets`）；adb 真机（等设备）。

---

## 13. 收尾对账（2026-10-28 深夜，本线最终状态）

### 13.1 本线（炸惊 + 湮灭）全绿的部分

| 检查 | 结果 |
|---|---|
| `test/match/zhajing-*`（room / room-lock / mode / loadout / drafts / refresh / isolation / e2e / forge / death-return） | 全绿（其中 forge 14、death-return 6、isolation 54） |
| `test/match/annihilation-*`（mode 17 / erosion 14 / mods-settings 7 / mods-isolation 21） | 全绿 |
| `test/match/mode-isolation-matrix` / `extension-modes-regression` | 21 / 11 全绿 |
| `test/content/*`（189 文件） | 2775 pass / 0 fail |
| `test/data.test.js` / `data-versions` / `versions-keying` | 32 / 22 / 46（沙箱里 spawn 类会假红，非沙箱 shell 全绿） |
| `GOLDEN_FULL=1 node tools/golden.mjs` | **288 场景零位移**（本轮共跑 6 次，均 ok） |
| `devtools/check-mode-isolation.mjs` | RESULT: OK（提醒 4 条 = 3 条包内 `zhajing:false` 副本 + 1 条 `pure` 脚手架，都「任何模式抽不到」） |
| `tools/i18n.mjs check --all --strict` | ja / ko / zh-TW 100%；en 253 条历史缺口（非本线） |
| 真机四档视口（`render-check-zhajing.mjs`） | 16 屏/档 RESULT: OK，0 console error |

### 13.2 这一轮额外清掉的三类问题

1. **数据配对不自洽（曾让 30 个 `test/match` 文件红）**：`validate.js` 的「普通/精英配对」规则撞上 2 条自指的 `upgradeChessId` + 1 条没有 `_a` 的精英。修法在生成器侧（`*_b → null`、补 `chess_zj_pure_a` 脚手架），`data/chess.json` 473 → **474**，全量 `validateData` problems **11 → 0**。
2. **虎狼丸（官方无技能）**：`validate.js` 加**只认 `noSkill: true` 且确实空表**的窄豁免（`:240` 与 `:249` 两处），别处真丢 `skills` 照旧红。
3. **advisor 简报超 200 000 字符**：`server/ai/knowledge.js` 的 `operators` 改成官方子集（炸惊 199 条不再进官方简报）；`tools/ai/llm-knowledge.mjs` 改成**逐级检查预算**的裁剪（`enemies` → `bosses[].notes`/`bands[].insights` → `operators[].skills`），顺带修掉「无脑丢 enemies 后直接 return」的老 bug。`advisor-input` 6/6。
4. **`g.forgeTake` 进 fuzz 通用扫描**：按业主批的「省事版」在 `fuzz.test.js` 的 `GAME` 名单里排除（炸惊专属、`optId` 来自 `shared/forgeData.js` 的 9 条闭合表；其契约由 `zhajing-forge.test.js` 钉着）。
5. **三条「官方子集」断言**：`standin-ownership`（55 个可掉落 NORMAL）、`feedback1-placement`（远程位特质恰好 6 条）、`feedback1-gaps`（策略挂在关闭盟约上）——判据统一成 `!(zhajing === true || /^chess_zj_/)`，与 `check-mode-isolation` 同源。

### 13.3 仍未绿、且**不属于本线**的（`test/match` 约 29 条）

| 簇 | 条数 | 状态 |
|---|---|---|
| external-AI / advisor 子系统：外部 AI 最早一份 job 直接是 `prep`、里面没有 `g.band` 动作（`external-knowledge.test.js:87` 因此 TypeError），且 `gd.draftBands` 已是 `undefined` | ~10 | 已把实测事实与修复边界交 engine-core：这需要先定「bot 座位抽签：自动选还是发 job」的契约，不是本线能单方面改的 |
| `plugin-offers`（`battleCheck` 窗口不开） | 3 | 早于炸惊就红，属「插件窗口」线 |
| `connection`（`m.private` 多 `basePrice`）、`finalAssault`（隐秘核心抽签顺序多 `p_2`） | 2 | 别的会话的形状漂移 |

### 13.4 Android 端的 4 处 P0/P1（业主口径「先别改」，仍冻着）

`reportClientState` 回报链（页面 0 调用 ⇒ 12 秒黑屏看门狗**必弹**、诊断面板拿不到任何页面侧事实）、`MainActivity.kt:421` 不查 `length() > 0`、子资源错误与 uncaught handler 不落盘、`deviceTuning` 荣耀分支未纳入 `isDimensity`。完整 10 条探查结论见该轮对话；第一条影响 #4/#5/#6/#7 的可诊断性，建议优先放行。

---

## 14. 第六轮：A/B/C 收口（2026-10-29）

业主派下 client 队列的最后三项（A 名片立绘微调、B 头像+名片、C 卡池预选），本轮全部落地。三项都是同一个形状：
**模块 + 懒加载 CSS + 自带测试**；C 走的是早一轮就绪的 `room.bans`，**不需要新的服务端代码**；i18n 只新增 2 条 msgid（四包齐备），ja / ko / zh-TW 仍 100%。

### 14.1 分项账

| 项 | 改了什么 | 落在哪个文件 | 断言在哪 |
|---|---|---|---|
| A 名片立绘微调 | 座位卡立绘可切精一/精二、0.8–2.0× 缩放、框内拖拽、重置；按 charId 存本机 pref | `public/js/ui/cardArt.js`（267 行）、`public/css/screens/card-art.css`（4 994 B）、`public/js/screens/room.js:343` 入口 | `test/ui/card-art.test.js` **10 条** |
| B 头像+名片 | AccountPanel 改两分区（个人资料 / 名片）；`AccountMeChip` 首次有调用点；34 张名片索引 + 9 张手绘回退；房内自己座位牌回显本机名片 | `public/js/ui/accounts.js`（184 行）、`public/js/ui/namecards.js`、`public/css/screens/profile.css`（7 192 B）、`public/js/screens/lobby.js:917`、`room.js:366` | `test/ui/profile-panel.test.js`（条数以该文件实测为准） |
| C 卡池预选 | 房内 ban 面板：核心 3 / 附加 4，配额从 `config` 现算，满额直接不发请求 | `public/js/ui/banPicker.js`（141 行）、`public/css/screens/ban-picker.css`（2 855 B）、`room.js:880` | `test/ui/ban-picker.test.js` **9 条** |

### 14.2 A：名片立绘微调

* **两版立绘**：精二 = `char/illust/<id>.png`；精一 = `char/illustration/<id>_1.png`（0.6 MB 简略图，**必须显式读 `_1`**，用基础名会拿到精二）。精一在框内 `object-fit: contain` 等比居中 + 右上「简略图」角标；`_1` 不存在时 `<img onError>` 退回精二并**隐藏角标**（绝不拉伸）。
* **交互**：滑杆 / 桌面滚轮 / 键盘 ←→ / 触屏双指；`touch-action: none` **只加在框上**（页面其余部分照常滚动）；`重置` 回「精二 / 1.0× / 居中」。
* **持久化**：本机 pref `room.cardArt = { [charId]: { art, zoom, ox, oy } }`，**刻意不并进 `CARD_PREF`** —— 那份是「玩家选了哪个干员」（服务端已收，改形状会动同步链），而位置/缩放的服务端字段 engine-core 还没给。`normalizeCardArt` 幂等、缺字段/坏值一律回中立值（`clamp(undefined)` 会掉到下界 0.8× / -100%，测试专门钉了这一条）。
* **入口**：只有「自己的干员有立绘」才出 `[data-testid="seat-card-art"]`（文案「立绘调整」）；「更换立绘」`[data-testid="seat-card-pick"]` 的 picker 行为**一点没动**（`room-cards.e2e` 依赖它）。
* **样式**：`card-art.css` 由模块懒加载（`link[data-cardart]`），**不进 `public/index.html`**。

### 14.3 B：头像 + 名片

* **两分区**：根 `<div class="lacct" data-testid="profile">`；`[data-testid="profile-avatar"]`（`.lacct__pic` / `.lacct__note` / `.lacct__btns button`）与 `[data-testid="profile-card"]`（`[data-testid="profile-card-preview"]` + 「选择名片」键）。分区标题走 `t('个人资料')` / `t('名片')`。
* **入口**：`lobby.js` 的 `topbar__right` 里挂 `<AccountMeChip />` → `[data-testid="profile-entry"]`。这个组件此前是死代码，本轮第一次有调用点。
* **索引**：`data/namecards.json` **34 张**、`public/assets/namecard/` 下 **552 个 webp**（`tools/import-namecards.py` 生成；`public/assets` 是 git-ignored，不进库）。索引在 → `namecardChoices()` 给 34 条 `art:true`；索引缺失 → 回退 **9 条手绘** `art:false`，`NameCardLayer` 对不认识的 id **返回 null**（不画破图，名片区就只剩「选择名片」）。
* **房内回显**：`room.js:366`，`isMe` 时自己座位牌画本机名片；别人的座位牌仍只显示头像。
* **样式**：`profile.css` 由 `ensureProfileCss()` 懒加载（`link[data-profile]`），不进 `index.html`。

### 14.4 C：卡池预选

* **入口与面板**：炸惊房顶栏 `[data-testid="zj-bans-open"]`（文案「卡池预选」）→ `[data-testid="zj-ban-picker"]`；两列计数 `[data-testid="zj-ban-count-core"]` / `-addon`（形如 `2/3`、`0/4`）；盟约胶囊 `.zjban__chip[data-bond]` 带 `aria-pressed`；`重置` 清空两列。
* **配额不写死**：`banQuota()` 读 `data/config.json` 的 `bans.ZHAJING`（实测 `{"core":3,"addon":4}`），缺项回 3 / 4（与服务端同一个缺省）。
* **判据与服务端同源**：两列只按 `isCore === true` 分，与 `server/lobby.js:1227` 的逐条检查同一口径（错列 ⇒ `BAD_MSG`）；满额那一下**直接不生效、不发请求**，所以客户端画不出服务端会拒掉的组合。
* **协议**：`room.bans { mode:'zhajing', core, addon }`，服务端在 `server/lobby.js:1212`（`setBans`），非炸惊房 `BAD_TARGET`（:1217）。C 项不需要新的服务端代码，契约另由 `test/match/zhajing-bans.test.js` 钉着。
* 面板刻意不做参考包的「特别关心 ❤」：那是「每人一副独立牌池」的概念，本仓 `room.bans` 没有这个字段。

### 14.5 文案（只新增 2 条）

新增且四包齐备：`卡池预选`、`禁选的盟约只影响你自己的干员池：队友的池子不受影响，没填满的槽位由系统随机补。`

A/B 用到的 `立绘调整` / `精一` / `精二` / `简略图` / `拖拽调整位置` / `个人资料` / `名片` / `选择名片` 上一轮已在四包里（本次逐包复核：en / ja / ko / zh-TW 各 8 条全部命中），**未重复加**。

本次 `node tools/i18n.mjs check --all` 原样输出（2026-10-29 实测）：

```
public/i18n/en.json (English, en, complete): 2671 msgids used, 2423 translated (90.7 %), 248 missing, 0 errors
public/i18n/ja.json (日本語, ja, complete): 2671 msgids used, 2671 translated (100 %), 0 missing, 0 errors
public/i18n/ko.json (한국어, ko, complete): 2671 msgids used, 2671 translated (100 %), 0 missing, 0 errors
public/i18n/zh-TW.json (繁體中文, zh-TW, complete): 2671 msgids used, 2671 translated (100 %), 0 missing, 0 errors
```

en 的缺口本机实测是 **248** 条（§11–§13 记的 253 是更早的读数）。两者都是历史缺口、**不是本线新增**：本轮两条 msgid 在 en 里都有译文，四包 0 errors。

### 14.6 验证（照抄可跑）

本机沙箱里 `node --test` 会因 spawn 被拒而假红，**直跑测试文件**：

```bash
node test/ui/card-art.test.js       # tests 10 / pass 10 / fail 0
node test/ui/ban-picker.test.js     # tests 9  / pass 9  / fail 0
node test/ui/profile-panel.test.js  # 条数与 pass 数以该文件实测为准（本节写作时仍在并行编写）
node tools/i18n.mjs check --all     # 输出见 14.5

node -e "for (const f of ['public/css/screens/card-art.css','public/css/screens/ban-picker.css','public/css/screens/profile.css']) console.log(f, require('node:fs').statSync(f).size)"
# card-art.css 4994 / ban-picker.css 2855 / profile.css 7192

node -e "const j=JSON.parse(require('node:fs').readFileSync('data/namecards.json','utf8'));console.log(j.cards.length)"   # 34
node -e "const j=JSON.parse(require('node:fs').readFileSync('data/config.json','utf8'));console.log(j.bans.ZHAJING)"      # { core: 3, addon: 4 }
```

三个新 CSS **都没有进 `public/index.html`**，这是刻意的：三块都是模块懒加载。复核一行：

```bash
node -e "const s=require('node:fs').readFileSync('public/index.html','utf8');for (const n of ['card-art.css','ban-picker.css','profile.css']) console.log(n, s.includes(n))"
# card-art.css false / ban-picker.css false / profile.css false
```

### 14.7 仍未做

* **立绘的位置/缩放没有服务端字段**（engine-core 未给），所以只存本机：换设备不跟随，队友看不到你调过的构图。协议定了之后把 `{ art, zoom, ox, oy }` 并进 `room.card` 一起发，是这一项唯一剩下的活。
* **队友的名片**：房内只有「自己座位牌回显本机名片」；做「看到队友名片」还要一份房内广播或 `room.state` 字段。
* **卡池预选没有汇总视图**：服务端 `room.state.seats[].bans` 有每人名单，客户端只画自己的，没做「队友 ban 了什么」。
* **真机**：本轮只有代码与桌面层面证据，vivo V2520A / adb 没插上，`devtools/render-check-*.mjs` 的巡检未跑；`devtools/lib/zhajing-panels.mjs` 里 A/B/C 从 KNOWN 改真断言是并行的另一条，同轮进行。

### 14.8 归属边界（这些红不是本线的）

| 红 | 位置 | 归属 |
|---|---|---|
| 「room.css 字号地板」1 条 | `test/ui/seat-art.test.js`，`public/css/screens/room.css:577` 的 `max(11px, calc(.16 * var(--t)))` | 别的会话加的地板，不在本线写域 |
| `test/client-static.test.js` 大批 parse 红 | 环境（沙箱里 spawn 被拒） | 非代码问题 |
| external-AI / advisor / plugin-offers / connection / finalAssault 那几簇 | `test/match/`，清单见 §13.3 | 同前，本轮未动 |

---

## 15. 第七轮：业主追加的六项（2026-10-29）

业主这一轮追加了两批口径：①湮灭两个专属 mod「没出现且没生效」、炸惊专属干员缺图标、两个玩法包二级页要两枚按钮、玩法包档的调配不要档位横行；②手机端标题页感谢名单压住按键、名片只影响个人名片页与房内名字条、名片有差分。下面按项记账。

### 15.1 分项账

| 项 | 改了什么 | 落在哪个文件 | 断言在哪 |
|---|---|---|---|
| 湮灭两个 mod 的**效果** | 两条盟约的完整战斗实现：21 个 bb 键全部有读点（罗德岛：3 名档攻/生命按层数、6 名档治疗/回技力/生命与元素回复；卡兹戴尔：受控目标伤害、攻速、真伤追击、9 名档活性源石风暴），整备侧接「100 层 → 断角」；语义反推处逐条 `[ASSUMED]` | `server/sim/content/bonds/addon/annbonds.js`（新）、`server/sim/content/index.js`（注册一行）、`shared/annihilation-constants.js` | `test/content/annihilation-bonds-effects.test.js`（22 条：开关关 = 与官方基线逐字节相同；每个 bb 键至少一条数值断言） |
| 两条 mod **默认开启** | `ANN_MOD_DEFAULT_ON = ['rhodesShip','kazdelShip']` 作为唯一来源（整备 / 战斗 / 客户端共用）；`annModOn` = 显式压缺省；`gd.annMods` 保留显式 `false`；`bondIds`/`bond()` 按开关派生（两条都关 ⇒ 与官方四档逐项相等）；`room.loadout` 的湮灭名册改用同一份 `annihilationRoster` | `server/match/gamedata.js`、`server/lobby.js`、`server/sim/content/support/index.js` | `test/match/annihilation-mods-default.test.js`（23 条）、`annihilation-mods-settings.test.js`（7 条） |
| 开关**实时**影响调配 | 名册按 `annMods` 派生（挂已关闭盟约的棋被摘掉；开关切换后重新构造 GameData），装备池按 `giveBondId`/`requiresBondId` 过滤（数据补齐即生效） | 同上（`annihilationRoster` / `itemAnnModOff`） | 同上 + `mode-isolation-matrix`（21） |
| 战场契约 | `annihilationFlags()` 送**显式** boolean（true 与 false 都带；有显式键才长出这个键）；`room.state.annMods` 也回显显式键；「确认」发送**生效值**（`annModsWire` 按缺省补），不会把默认开启的两条静默写关 | `server/match/gamedata.js`、`server/lobby.js`、`public/js/ui/annihilationSettings.js` | `annihilation-mods-default` 的 flags 钉子、`ui/annihilation-settings`（8 条） |
| 炸惊专属干员**图标** | 素材侧其实齐（18 个技能 png 早就在 `public/assets/skill/`），缺的是 manifest：给 `patch-assets-local.mjs` 加 `skills` 槽位，add-only 合并 **skills 557→575 / skillsById 562→580**（零删除零改值），两份 `assets.json` sha1 `3f24fc49…` | `tools/import-extension-assets.mjs`（phase C 技能链路 + phase B 真实布局）、`tools/patch-assets-local.mjs`、`data/assets.json` + `public/data/assets.json` | `node tools/import-extension-assets.mjs` 的「清单里没有」= 0；`test/sync-static-web`（2） |
| 二级页两枚按钮 | 两个玩法包主题页左下、页脚横线**之上**：`S.W.E.E.P.报告`（`ext-sweep`）在上、窄版 `干员调配`（`ext-loadout`）在下，卡池调整保留最下 | `public/js/screens/extensionThemeHall.js`、`public/css/screens/lobby.css`（二级页样式在这里） | `test/ui/extension-modes`（21）、`zhajing`（7）、`ui-size`（11） |
| 调配**不再出现档位横行** | 玩法包档整行不渲染（条件渲染，不是 `display:none`），模式名改标在「说明」键右侧（`loadout-set[data-mode]`）；官方四档逐字节不变 | `public/js/screens/loadout.js`、`public/css/screens/loadout.css`、四条 devtools 调用点同步改读 `loadout-set` | `test/ui/zhajing-loadout`（12，含新增 1 条）、`devtools/{lib/zhajing-panels,render-check-zhajing}.mjs` |
| 标题页底栏 | 行序改成 [插件/法律][meta][感谢名单]；手机端感谢名单 72vw、滚动 32s→48s、减动效静止 | `public/js/screens/title.js`、`public/css/screens/title.css` | `ui-size`（11）、`lobby-hub`（28） |
| 名片范围与差分 | 名片底图只出现在个人名片页与房内名字条（大厅个人条不再画）；名片页加差分切换（`‹ 差分 1/5 ›`，按卡存在本机 pref）；素材侧清掉 34 个旧导入器残留目录（276 个文件全部是正卡的逐字节副本） | `public/js/ui/accounts.js`、`public/js/ui/namecards.js`、`public/css/screens/profile.css` | `test/ui/profile-panel.test.js`（13） |

### 15.2 这一轮新增的 3 条 msgid（四包一起加）

`罗德岛盟约`、`卡兹戴尔盟约`（去掉原先的「（仅计数与展示）」后缀）、`差分`。其余全部复用既有词条。

### 15.3 验证（照抄可跑）

```bash
# 25 个目标套件，合计 373 pass / 0 fail
node test/ui/{profile-panel,card-art,ban-picker,ui-size,lobby-hub,zhajing,zhajing-loadout,annihilation-settings,extension-modes,emotes,match-info,zj-bonds-view,sweep}.test.js
node test/match/{annihilation-mods-settings,annihilation-mods-default,annihilation-mods-isolation,annihilation-mode,mode-isolation-matrix,extension-modes-regression,zhajing-mode,zhajing-room}.test.js
node test/content/{annihilation-bonds-effects,annihilation-mods}.test.js
node test/{sync-static-web,data}.test.js

GOLDEN_FULL=1 node tools/golden.mjs      # 288 场景零位移（roster 49 / bonds 46 / fields 22 / matches 21 / standins 10 / diy 140），154 s
node tools/i18n.mjs check --all          # ja/ko/zh-TW 2672/2672（100%）；en 缺 248 条历史缺口（非本线）
npx eslint <本轮 25 个文件>               # 0 errors / 6 warnings（全部既有风格告警）
node test/docs-paths.test.js             # 8/8（全权限下 git spawn 正常）
```

### 15.4 仍未做 / 新挂账

* `kazdelShip` 的断角 `chess_item_c_01_e_a` 不在 `data/items.json`（里程碑计得清、发不出去）；两条盟约的 6 名 / 9 名档在现有成员数下到不了（罗德岛 5 人 < 6、卡兹戴尔 4 人 < 9）。
* 名片：差分在个人名片页可切；房内名字条走同一个 `NameCardLayer`，同一份本机 pref 会跟着变（所以「换了差分、房内也跟着换」）。`tools/import-namecards.py` 的 slug 兜底分支仍在（这一轮只清了 34 个残留目录、没有重跑导入器）。
* 全量官方美术（`fetch-assets`）与真机（vivo / adb）未跑；巡检脚本已改完但本机 puppeteer 起不了 Chrome（现在全权限下可跑 `node devtools/render-check-zhajing.mjs`，尚未执行）。
* `test/assets.test.js`（55/2）与 `test/version-assets.test.js`（1/5）的红**与补丁无关**：回滚 manifest 后逐条复跑，同样的 7 条红（spine png 尺寸 / 55 页表情 / 版本规划 union），属既有的本机美术缺口。

### 15.5 同轮修订（业主再审后的四条）

1. **差分显示不全**：预览框原来是 600×186（3.23:1），素材 `entry` 是 640×224（20:7），`object-fit: cover` 会把卡面上下各裁一条。现在 `.lacct__cardview` 与 `.nc-pick__shot` 都改成 `aspect-ratio: 20 / 7`，实测预览 363×127 对 640×224 比例误差 <0.03 ⇒ 整张卡完整显示。
2. **差分切不成功**：切换器原来只在个人资料面板里、且靠父级重画。现在 `NamecardVariantSwitch` 自己持有序号（换完立即换图），**选择器里也有一条差分条**（选中带差分的卡才出现），瓦片左上角标出该卡差分张数。实测：选 `card_00465a33` → 条上「差分 5/5」→ 点下一张 → 瓦片图立即换成 `entry_?_`（`switchedInPicker=true`），序号写进 `sp.pref.namecardVariant`，关面板重开仍是那一张。
3. **二级页「干员调配」与「卡池调整」重复**：两者打开的是同一屏，按业主要求**删掉「卡池调整」**（`extension-pool-edit` 不再渲染）。二级页左下只剩 `ext-sweep`（上）与 `ext-loadout`（下）。
4. **两枚按钮同宽**：`.ext-theme__dock` 改成 `grid` + `justify-items: stretch` + `width: max-content`，两枚按钮 `width: 100%`。实测炸惊二级页两枚都是 **115×32**、sweep 552–584 在 loadout 588–620 之上。

连带改动：`docs/EXTENSION_MODE.md` §8.5 的「卡池调整」行改成新口径（含 `loadout-set` 与删除理由）；`devtools/lib/zhajing-panels.mjs` 与 `devtools/render-check-zhajing.mjs` 的入口选择器/断言迁到 `ext-loadout`；`test/ui/{annihilation-settings,zhajing-loadout}.test.js` 同步。

### 15.6 二次修订（同日再一轮：差分交互、入口合并、挂账清零）

1. **差分「显示不全」**：`entry` 素材是 640×224（20:7），旧框 600×186（3.23:1）配 `object-fit: cover` 会裁掉上下。`.lacct__cardview` 与 `.nc-pick__shot` 都改成 `aspect-ratio: 20 / 7`；实测预览 363×127 与素材比例误差 <0.03。
2. **差分「切不成功」**：切换器改为自持序号（换完立刻重画），并在**名片选择器里**也放了一条差分条（选中带差分的卡才出现），瓦片左上角标出该卡差分张数。实测 35 瓦片 / 20 张带差分 / 20 个角标；点「下一张」瓦片图立刻换成 `entry_?_`，序号写进 `sp.pref.namecardVariant`，关面板重开仍是那一张。
3. **入口合并**：二级页删掉与「干员调配」同屏的「卡池调整」（`extension-pool-edit` 不再渲染），左下只剩 `ext-sweep`（上）/ `ext-loadout`（下），两枚**同宽**（实测均 115×32，sweep 552–584 在 loadout 588–620 之上）。devtools 两个脚本与 `test/ui/{annihilation-settings,zhajing-loadout}.test.js` 同步。
4. **挂账清零（本轮真的做掉了）**：
   - `test/assets.test.js` **55/2 → 57/0**：①`stats.ui` 639≠641 是清单过期（`patch-assets-local` 现在会重算 stats）；②42 个 local atlas 的 `pma: true` 是旧抽取器残留（extract.py 早已剥掉），已按现行口径清掉并备份到 TEMP。
   - `test/version-assets.test.js` **1/5 → 6/0**：重建清单补齐 28 行（炸惊 9 干员 + 18 条 chess）、补 2 张 Persona 召唤头像（从整合包取，各 51 518 B）、`plan.mjs` 的 token id 正则允许 `token_makoto_*`、`coverage.mjs` 登记 4 个源侧缺图的道具图标（`trap_c_01..04`，缺图不造图）。
   - `test/docs-consistency.test.js` **23/1 → 24/0**：断言从「清单里没有 prep 语音槽」改成「**plan** 不排 prep 槽」（清单是历史累积物），并允许 `voiceJp` 覆盖比 `voiceCb` 更多；唯一源侧缺条目的锡兰 `skill4` 已从清单里删掉并登记为已知缺口。
   - `data/` 缺口：8 件湮灭装备（`chess_item_c_0{1..4}_e_{a,b}`）按「每 100 层发一件」的奖励装落库（`annOnly: true` + `hideInShop: true` + `shopExcluded`），并在 `tools/golden.mjs` 的 EQUIPS 游标与 `gd.shopItemsByTier` 两处加 `annOnly` 门 —— **中途引发过一次 288 场景位移（42+8+20），已二分定位并修复，最终 golden 288 零位移**。
   - 名片导入器：`slugify` 的哈希兜底已正确，重跑一次到临时目录验证 **34 张 / 0 孤儿目录**（旧的 34 个 `card__N` 残留已删）。
5. **仍未做**：`fetch-assets` 的全量官方美术（GB 级、会重写 assets.json 之后必须重跑 `patch-assets-local --write`）；真机 vivo/adb 巡检；`render-check-zhajing.mjs`（本机全权限下可跑，尚未跑）；两条盟约 6/9 名档缺成员干员（`chess_char_9_*` / `chess_char_4_27` 本仓无记录）。

### 15.7 `fetch-assets` 全量美术：本机网络走不通（两次尝试，清单零改动）

业主批准后实跑了两遍，**都没能下载成功**，但**清单与工作树零改动**：

| 尝试 | 命令 | 结果 |
|---|---|---|
| 直连 GitHub | `node tools/fetch-assets.mjs` | 计划 17 552 文件 + 775 Spine；实际只下到 **1.3 MB / 70 个**，`[network] GitHub 下载失败`，剩 510 missing + 179 errors（字符 E2 立绘、4 个 `trap_c_0*` 图标、若干 token 头像） |
| 走镜像 | `node tools/fetch-assets.mjs --asset-source=mirror` | 镜像 `https://gh-proxy.com/`；只下到 **0.6 MB / 21 个**，654 missing + 140 errors（镜像策略连续 3 次失败即停） |

两次都以同一句收尾：`ERROR: data/assets.json NOT written — it would lose 36 entries the current one has`。
这正是 `shrinkGuard` 在保护：不加 `--allow-shrink` 时，**丢了 34 条 namecards + 2 个模式图标的新清单不会被写回**。
实测确认：`data/assets.json` 与 `public/data/assets.json` 的 sha1 在两次运行前后**完全相同**（`8660994d…`），
skills 575 / ui 641 / namecards 34 / stats.ui 641 全部原样；四个资产/文档套件仍 **57/0、6/0、24/0、2/0**。

为什么在真机/CI 能下、这里不能：仓库里的「缺失」分两类，**只有一类是网络**：
1. **网络类**（能靠重试/镜像解决）：干员 E2 立绘、少量敌人图标、部分语音。本机直连被挡、镜像三连失败即停。
2. **本地抽取类**（下载永远补不上）：40 个召唤物 Spine（`token:…:missing skel`）来自 `tools/local-extract/extract.py`，
   需要**游戏客户端文件**才能抽；`items.trap_c_01..04` 是湮灭包本身就没有的图标（已在 `coverage.mjs` 的
   `ITEM_ICON_GAPS` 登记，客户端走缺图兜底）；`char_4220_kormr` 的 E2 立绘同理（包内只有 `_1`）。

结论与下次口径：**换到能连 GitHub 的机器**再跑同一条命令（或 `SP_ASSET_SOURCE=mirror`），跑完**必须**补跑
`node tools/patch-assets-local.mjs --write`（否则 18 条技能图标 + 34 张名片 + 2 个模式图标会丢），随后
`node tools/sync-static-web.mjs`、`node test/assets.test.js`、`test/version-assets.test.js`。
本轮**没有**执行 `--allow-shrink`/`--prune`（那会真的删掉本地专属条目与 1846 个未引用文件，不可逆）。

### 15.8 改走「本地明日方舟客户端解包」（2026-10-29 下午）

网络两连败之后按业主指示改用本机客户端：`E:\YostarGames\Arknights_JP`（StreamingAssets 2.37 GB AB + PersistentData 20.5 GB）。
工具链与依赖都齐（UnityPy 1.25.4 / Pillow 12.3.0 / lz4 4.4.5，`python tools/local-extract/extract.py` 直接用）。

**抽出来的东西（全部写进 `public/assets/local/`，git-ignored）：**

| 命令 | 结果 |
|---|---|
| `extract.py --game … --only spine/token` | **36 个召唤物 Spine**（3 文件/个：skel + atlas + 合并后的 RGBA 页图），另外 4 个（`token_10066_closur_ourbase` / `_10068_kalts2_mtship` / `_10069_mcnist_mcgraf` / `_10070_aphris_pc`）在 JP 客户端这一版里**没有**，跳过 |
| `extract.py --game … --only spine/enemy` | **8 个敌人 Spine**（含此前只在社区别名里存在的 `enemy_1305_mhslim` / `_mhslim_2`） |
| `fetch-assets --local-spines` | 重写 `tools/assets/local-enemy-spines.json`（8 模型）与 `local-token-spines.json`（40 模型，含原有 4 个），随后 `--allow-shrink` 写回清单 |
| `patch-assets-local --write` | 把 add-only 槽位补回（skills 575 / namecards 34 / ui 641 的模式图标），两份 `assets.json` 再次逐字节一致（sha1 `1617341a…`） |

**结果（可在 `data/assets.json` 直接核）：** `tokens` 60 条里 **40 条带 `spineLocal`**（此前 0）；`enemies` 258 条里 **8 条带 `spineLocal`**；顺带把此前 42 个 local atlas 的 `pma: true` 问题**从源头修掉**（新抽取的 atlas 是 `size:` + 无 pma，与 `extract.py:863` 的现行口径一致）。

验证：`assets 57/0`、`version-assets 6/0`、`docs-consistency 24/0`、`sync-static-web 2/0`、`data 34/0`、`ui-size 11/0`、`profile-panel 14/0`、`annihilation-mods-default 23/0`（合计 171 pass / 0 fail）。抽取产物属性抽样：`token_10002_kalts_mon3tr`（skel 46 958 B / atlas 2 550 B / png 71 408 B，清单里带 anims/bounds/events），`enemy_1305_mhslim.atlas` 的页头是 `size: 256,256` + 无 `pma`。

**仍未拿到：** `char_4220_kormr` 的 E2 立绘（JP 客户端这一版只有 `_1`）、`char_4045_heidi` / `char_4184_dolris` 的 Back 模型、`items.trap_c_01..04` 四个图标（湮灭包里本来就没有，已登记 `coverage.mjs` 的 `ITEM_ICON_GAPS`）、以及上面 4 个新召唤物（客户端版本比内容旧）。这些**都不影响**清单自洽与任何测试。

⚠️ 复跑注意：`--local-spines` 会走完整流水线并以 `--allow-shrink` 写清单，**写完必须再跑** `node tools/patch-assets-local.mjs --write`，否则 34 张名片与 2 个模式图标会从清单里消失（本轮已按这个顺序执行）。

### 15.9 更正：`trap_c_01..04` 四个图标**是有的**（2026-10-29 下午复查）

上一节把「湮灭 4 件装备的图标」记成「包内本来就没有」，**这是查错了范围**：我只在炸惊整合包里找过。
实际位置在**湮灭两个 mod 自己的包里**：

```
modref/mods/kazdel-ship/kazdel-ship-mod/payload/packs/kazdel-ship/art/trap_c_01.png   (948×871, 648 968 B)
modref/mods/kazdel-ship/kazdel-ship-mod/payload/packs/kazdel-ship/art/trap_c_02.png   (764×987, 600 539 B)
modref/mods/rhodes-ship/rhodes-ship-mod/payload/packs/rhodes-ship/art/trap_c_03.png   (1069×718, 765 928 B)
modref/mods/rhodes-ship/rhodes-ship-mod/payload/packs/rhodes-ship/art/trap_c_04.png   (839×606, 923 963 B)
```

处置：按仓库道具图标口径（**高 160、保比例**，与既有 `public/assets/item/*.png` 一致，160×160 / 174×160 这类）
用 LANCZOS 转存为 `public/assets/item/trap_c_0{1..4}.png`（34–65 KB），再 `node tools/patch-assets-local.mjs --write --slots items`
→ 清单 `items` **+4**；`tools/assets/coverage.mjs` 里的 `ITEM_ICON_GAPS` 豁免**整条删除**（它本来就是误判的产物，
留着会掩盖真正的缺图回归）。

结果：`assetCoverage()` 里 8 条 `chess_item_c_0*_e_*`（4 普通 + 4 精英）全部 `icon: ok`，**`TOTAL missing rows: 0`**
——整张覆盖矩阵第一次清零。回归：`assets 57/0`、`version-assets 6/0`、`docs-consistency 24/0`、`sync-static-web 2/0`、`data 34/0`。

教训（写给后来人）：判断「素材有没有」时，**先按资产名在 `modref/` 全树找一遍**，再按包找；炸惊与湮灭是两套包，
不要因为一个包里没有就断言全仓没有。

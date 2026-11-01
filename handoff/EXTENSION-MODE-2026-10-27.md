# 拓展模式 · 交接（2026-10-27 收尾定稿，整合版）

> **本文取代两份旧交接**，它们是历史档案，不再作为入口：
> * `handoff/EXTENSION-MODE-2026-10-26.md` —— 超限线收口、拓展模式 S1 落地细账、四份研究报告的结论、8 步移植方案；
> * `handoff/ANNIHILATION-CLIENT-2026-10-27.md` —— 客户端三块接线与收尾那一轮的逐行细账。
>
> 两者仍有价值的内容都已并进本文；**任何与新代码冲突的说法以本文 + 代码为准**。
> 玩法包本身的设计规格（三态语义、版式、测试钩子、再加一个玩法包怎么加）仍在
> [`docs/EXTENSION_MODE.md`](../docs/EXTENSION_MODE.md)（7 节），本文不重复它。
>
> 仓库：`E:\Workbox\系统`，分支 `align/0.3.0`。工作区有**多会话未提交改动**，红线：**从不 commit / checkout / stash / reset**。
>
> **2026-10-28 之后请连 [`EXTENSION-MODE-2026-10-28.md`](EXTENSION-MODE-2026-10-28.md) 一起读**：那一份记第三轮的增量
> （n19 晕眩重做、超限改为房内开关、主题大厅的攻略说明、一级页版面收口、规则分离的调查结论），并记录了本轮
> `git checkout --` 弄丢 253 条译文的事故（其 §5.1，动手前必读）。**本文仍是架构与红线的主体**，那份只记增量。

---

## 0. 一句话

**这条线做完了，可以结项**。三条线全部落地并在真机上点通过：① 超限模拟入口收口；② 拓展模式（大厅第三张卡 + 选择拓展玩法大厅）；③ 湮灭模拟玩法包（服务端引擎 + 客户端三块界面 + 单人/同盟两种形态）。`EXTENSION_MODES[0].status` 已是 `'ready'`。

剩下只有两件**非阻塞**的小事：藏品选择期按空格的提示文案（要新增一条 msgid），以及历史无尽局记录的结算回放仍会写 `/14`（要改记录 schema）。

> **2026-10-27 晚追加**：收到 mod v3.2.0 后做了一轮对齐（§7.1）——8 条真 bug + 第二批触发点（悬赏完成信号 `bountyDone`、p43/p44 一次性装备）。`GOLDEN_FULL=1` 仍 288 场景零位移。剩下 2 条属产品决策（§7.2：n19 晕眩重做、增益浮层能否关闭）。
>
> **2026-10-28 凌晨追加**：业主点名的三项也做完了（§7.1b）——ready 提示文案（新词条 `请先完成藏品选择`，四包 2584 → 2585）、历史无尽局回放不再写 `/14`、n09「悬赏资金减半」。另在真机上（vivo V2520A / Chrome over adb）走通「大厅 → 拓展模式 → 湮灭模拟 → 房」。

---

## 1. 三条线的最终状态

| 线 | 状态 | 证据 |
|---|---|---|
| 超限模拟入口（大厅紫卡 / 同盟入口 / 房间 ∞ 胶囊 / 版本切换） | ✅ 已落地并实测 | `devtools/render-check-infinite-entry.mjs` 三档 OK；`lobby-versions 25/25`、`version-vote 8/8` |
| 拓展模式：大厅第三张卡 + 选择拓展玩法 | ✅ 已落地并实测 | `test/ui/extension-modes.test.js` 19/19；`devtools/render-check-extension-hall.mjs` 三档 + 同盟档 OK |
| 湮灭玩法包 · 服务端引擎 | ✅ 已落地并实测 | `annihilation-mode 8/8`、`annihilation-erosion 14/14`；`GOLDEN_FULL=1` 288 场景零位移 |
| 湮灭玩法包 · 客户端（藏品三选一 / 增益老虎机 / 图鉴 / 房内改档 / 局内角标） | ✅ 已落地并**真机**验收 | `devtools/render-check-annihilation-room.mjs` 蚀流 4 与 6 两档逐项通过 |
| 湮灭玩法包 · 单人 / 同盟两种形态 | ✅ 真机建过房 | `room.create { mode:'coop', difficulty:'ANNIHILATION', erosion:6 }` → `mode_multi_annihilation` |
| 玩法包条目 `status` | ✅ `'ready'` | 大厅芯片「可开局」、开始写着「开始 湮灭模拟」 |
| v3.2.0 对齐（藏品 bug、触发点、三项点名） | ✅ 三批修完，剩 2 条产品决策 | 8 条 bug + 悬赏完成信号与一次性装备 + ready 文案/无尽回放/n09；`annihilation-mode 17/17`、`stats 57/57`；`GOLDEN_FULL=1` 288 场景零位移 |
| 手机真机（Android + Chrome over adb） | ✅ 入口全流程通过 | `devtools/render-check-mobile-adb.mjs`：大厅 → 拓展模式 → 湮灭模拟 → 房，触控地板 24px、0 console error |
| 主题大厅（选中玩法包之后的二级界面） | ✅ 落地并三档 + 真机验收 | `extensionThemeHall.js` + `.ext-theme*`：原包主视觉（不息恶火）+ 封面排版；`extension-modes 20/20`、三档视口 + 真机 `RESULT: OK` |
| choco 研究区 | ⏸ 用户明令停手 | 不读不写 `E:\Workbox\choco` |

---

## 2. 这套东西是怎么组织的（架构地图）

### 2.1 一条「蚀流」值穿过五环

```
room.create { mode, difficulty:'ANNIHILATION', erosion:1..6 }
  → Room.erosion                      server/lobby.js        （房主开局前可 room.setErosion 改）
  → room.state.erosion                客户端房间胶囊 · 大厅简报
  → startMatch → Match.erosion        server/match/Match.js
  → new GameData(data, modeId, { erosion })
  → gd.erosion / gd.endless / gd.bans / gd.generation / gd.roundCfg / gd.bossHiddenPairs
  → m.publicView().erosion / .endless  （客户端与验收都读它）
```

**这条链任断一环都不会报错，只会静默降级成蚀流 1** —— 所以 `test/match/annihilation-mode.test.js` 断言的不是「能开局」，而是「`m.publicView().erosion` 真的等于房主选的那一档」。

`modeId` 由 `modeIdFor()` 推：`solo + ANNIHILATION → mode_single_annihilation`、`coop + ANNIHILATION → mode_multi_annihilation`。**湮灭不新增 room mode 字符串**。

### 2.2 档位与回合

| 蚀流 | lastRound | bossRound | hiddenRound | 说明 |
|---|---|---|---|---|
| 1–4 | 19 | 19 | — | 数据驱动；简报由客户端按档位覆盖成 19 |
| 5 | 30 | 29 | 30 | 引擎按档位合成，数据里没有 |
| 6 | **null** | 逐章一对 | 逐章一对 | **无尽湮灭**：只到全员淘汰；前四章是 `[14,15] [19,20] [24,25] [29,30]`，之后按章继续追加 |

藏品（negative 1-of-3）的开册回合：蚀流 2 → R1 / R5 / R9；蚀流 5、6 → 每个奇数回合；无尽局藏品抽尽后转「无尽加深」×1.2 递进。

### 2.3 代码落点

| 层 | 文件 | 内容 |
|---|---|---|
| 数据输入 | `docs/research/15-annihilation-mode.json`、`16-annihilation-relics.json` → `tools/build-data.mjs` | 手写内容在 research，生成 `data/config.json`、`data/bosses.json`、`data/relics.json` |
| 常量 | `shared/annihilation-constants.js` | `EROSION_MAX` / `EROSION_ENDLESS` / `ANNIHILATION_DIFFICULTY` |
| 难度名与色 | `shared/constants.js` | `DIFFICULTY_NAMES` / `DIFFICULTY_COLORS` 加 `ANNIHILATION`；**`DIFFICULTIES` 故意不加** |
| 协议 | `shared/protocol.js` | `room.create.erosion`、`room.setErosion`、`g.relic`、`g.relicSeen` |
| 房间 | `server/lobby.js` | `Room.erosion`、`room.state.erosion`（仅湮灭房）、`setErosion()`、`handleMessage` 的 `case 'room.setErosion'`、`fallbackDifficulty` **提前返回**（否则会被静默降级） |
| Match | `server/match/Match.js` | `this.erosion` → `new GameData(data, modeId, { erosion })` |
| 引擎 | `server/match/gamedata.js`（+380 行） | `gd.erosion` / `gd.endless` / `gd.annihilation` / `annihilationFlags()`、回合家族、`roundCfg` 的 R21+ 循环、`generation`、`bans`、`bossWeights`、`equipPerChess`、`unlimitedLayers`、`ENDLESS_ESCALATION_STEP` |
| 钩子 | `match/{phases,combat,bossRounds,intents,unitePhase,views,settle,prep,effectsMeta}`、`player/{prep,round,views,economy}`、`waves`、`sim/{ai,targeting,content/devices}`、`sim/content/index.js` | 17 个文件，**每一处都以 `gd.annihilation` 为门** |
| 玩法包模块 | `server/match/relics.js` 等 9 个 | 藏品抽取/图鉴/增益、毒雾、无尽加深；`sim/content/index.js` 的 `DOMAIN_NAMES` 补 `hazard` / `relics` |
| 结算 | `server/match/results.js` | 无尽局的「通过回合」按 `m.round` 算，不被第一章的 `bossRound 14` 封顶 |
| 大厅 | `public/js/screens/extensionModes.js`、`lobby.js`、`public/css/screens/lobby.css`、`public/css/theme.css` | `EXTENSION_MODES` 三条 + `ExtensionHall`；第三张卡 `ext`；`extOpen/extPick/extErosion/extParty` 四个 state；`createAnnihilation`；`--ext-*` 霜蓝令牌与整套 `.ext-*` 版式 |
| 房间 | `public/js/screens/room.js`、`public/css/screens/room.css` | `.rs-erosion-chips` / `.rs-erosion__chip`（1–6，6 档显示 `∞`，仅房主可改） |
| 局内 | `public/js/screens/game.js`、`public/js/ui/relics.js`、`public/js/ui/gameActions.js`、`public/css/screens/game.css` | `RelicOverlay`（三选一）、`PositiveSlotOverlay`（增益老虎机）、`RelicCodex` / `RelicCodexButton`（图鉴）、`.gm__erosion` 角标；`RELIC_DRAFT_PHASES` 门控 |
| 无尽局文案 | `public/js/ui/matchEnemies.js`、`public/js/ui/enemyDrawer.js`、`public/js/ui/gameLogic/result.js` | 「第 {r} 回合 · 最终攻势」先读逐回合的 `pub.bossRound`；结算对 `endless` 传 `lastRound: null` |
| 自查脚本 | `devtools/render-check-annihilation-room.mjs`、`devtools/render-check-extension-hall.mjs`、`devtools/render-check-infinite-entry.mjs` | 见 §4 |
| 动效评审演示页（不进构建） | `public/dev/motion-preview.html` + `public/dev/motion-preview.js`（`/dev/motion-preview.html`） | 五个可点模块各自「现状 / 优化」：抽卡节奏与几何、三选一两拍、双层浮层、蚀流三处字号、列表 stagger；截图 `handoff/shots/motion-preview-*.png`。结论见 §10（待实现清单） |

---

## 3. 这一线踩过、已经堵上的静默坑（按「会不会骗你」排序）

1. **`erosion` 五环任断一环 → 静默变蚀流 1**（不报错，界面一切正常，只是难度不对）。
2. **`sim/content/index.js` 的 `DOMAIN_NAMES` 缺 `hazard` / `relics`** → 藏品与毒雾**全哑且不报错**。
3. **`server/match/match/views.js` 的公开视图不发字段** → 客户端读不到 `erosion` / `endless`，角标与「无尽」分支静默不生效。
4. **`fallbackDifficulty` 不提前返回湮灭难度** → 建房时静默降级成标准模拟。
5. **两/三处显式消息分发**（`server/lobby.js` 的 `handleMessage` switch、`server/match/match/intents.js` 的 switch）：缺 `case` = 协议过、点击落空，**没有任何关键词能搜到**。已加：`room.setErosion`、`g.relic`、`g.relicSeen`。
6. **`server/match/relics.js` 原来用 `Math.random()`** 抽藏品与机器人投票 → 同 seed 重放会投出不同的票（票决定全队拿哪件藏品）。已改 `createRng(deriveSeed(m.seed, …))`，**别改回去**。
7. **`sim/content/devices.js` 的致命级缩放**（真正把 golden 打红的那条）：`aspdOf(-0.6)` 是 **−60 点攻速**，mod 的 `Math.max(-0.9, −60×1)` 让所有模式深水格从 −60 变成 −0.9。修法：`lethal === 1` 时每个缩放表达式必须恒等（`mul` / `floored` / `shrunk` 三个 helper）。
8. **客户端「非 `DIFFICULTIES` 的 difficulty」是陷阱**：任何 `DIFFICULTIES.includes()` 的查表都会把湮灭当成未知值静默落兜底（房间简报曾因此写「共 14 回合」）。校验要写 `DIFFICULTIES.includes(d) || d === ANNIHILATION_DIFFICULTY`。

---

## 4. 验证（照着跑）

```bash
# 本机沙箱下 node --test 会给每个文件 spawn 子进程而 EPERM ⇒ 逐文件直接 node
node test/match/annihilation-mode.test.js          # 17/17 链路验收 + 无尽局结算 + 藏品计数器/一次性装备 + n09
node test/match/annihilation-erosion.test.js       # 14/14 蚀流 1–6 阶梯表（含变异验证）
node test/match/results.test.js                    # 4/4   结算行
node test/ui/extension-modes.test.js               # 19/19 表、三行、芯片、单人/同盟、开始门控、空状态、CSS 契约、i18n
node test/ui/annihilation-endless-rounds.test.js   # 7/7   无尽局回合文案与结算的回归锁
node test/ui/lobby-hub.test.js                     # 27/27 官方四张难度卡没被动过
node test/ui/screen-fit.test.js                    # 6/6
node test/ui/version-vote.test.js                  # 8/8
node test/lobby-versions.test.js                   # 25/25
node test/content/items.test.js                    # 60/60 装备/消耗（p43/p44 的触发点在 equip 分支里）
node test/ui/stats.test.js                         # 57/57 记录与回放（无尽局 endless 往返、老记录不迁移）
node test/match/shared-stock.test.js               # 装备库存与替换
node test/versions-core.test.js                    # 历史版本的装备/计时
node test/docs-paths.test.js                       # 8/8
node tools/i18n.mjs check --all --strict            # 四包 2586/2586，0 missing / 0 errors
node node_modules/eslint/bin/eslint.js <改动文件>   # 0 error
node tools/check-imports.mjs                       # exit 0（3 条 server/sim/nodeData.js 既有违规已被仓库允许）
GOLDEN_FULL=1 node tools/golden.mjs                # 288 场景零位移（49/46/22/21/10/140），约 230 s
```

**四条硬断言**（断链会静默通过，所以钉在测试里）：

1. `m.publicView().erosion` 逐档等于房主选的 1–6，`endless` 只在 6 为真，蚀流 5 是 `lastRound 30 / bossRound 29 / hiddenRound 30`；
2. `new GameData(data, 'mode_single_normal')` 的 `erosion` 恒为 1、`lastRound` 仍 14，普通局的 `m.publicView()` 不长出 `erosion` / `endless` 键；
3. 无尽局结算的 `roundsPassed` 按实际回合算（R40 出局 = 39），其它模式仍按 `gd.bossRound` 封顶；
4. 藏品钩子有触发点：`settle` 的 `onBattleResult` 载荷带 `bountyDone`（p34 完成悬赏才叠、p39 按完成次数叠），`items.js` 在一次性装备真的消耗后才补/返（p43 每回合 ≤3 次、p44 返商店价）。

**真机（puppeteer-core + 本机 Chrome，需要 danger-full-access 才能 spawn Chrome）**

```bash
npm start                                        # 默认 3000（不是 3020）

# ① 局内全流程：房内胶囊 → 改档 → 开始 → 简报 → 策略草稿 → 协议启动！→ 增益老虎机 → R1 负面三选一
#    → 选卡 → canReady → 准备就绪（先过「剩余资金」确认框）→ 局内角标
SP_BASE=http://127.0.0.1:3000 SP_EROSION=4 SP_BUMP=0 node devtools/render-check-annihilation-room.mjs  # 角标「蚀流4」
SP_BASE=http://127.0.0.1:3000 SP_EROSION=4           node devtools/render-check-annihilation-room.mjs  # 改档到 6，角标「无尽湮灭∞」

# ② 大厅 → 房：三档视口 + 两种形态
SP_BASE=http://127.0.0.1:3000 SP_PARTY=solo node devtools/render-check-extension-hall.mjs
SP_BASE=http://127.0.0.1:3000 SP_PARTY=coop node devtools/render-check-extension-hall.mjs

# ③ 超限入口（另一条线，回归用）
SP_BASE=http://127.0.0.1:3000 node devtools/render-check-infinite-entry.mjs
```

判定是**逐项布尔**，不是「跑完就算过」。样子：

```
R1 relic overlay: {"phase":"PREP","round":1,"cards":3}
ready: {"clicked":".readybtn","ready":true,"phase":"COMBAT"}
final: {"endless":true,"lastRound":null,"badge":{"text":"无尽湮灭∞","cls":"gm__erosion is-endless"}}
text:  {"bad":null}
checks:{"okLobby":true,"okChips":true,"okBump":true,"okRelic":true,"okPicked":true,"okBadge":true,"okText":true,"errors":0}
```

**手机真机（Android + Chrome over adb，2026-10-27 通过）**

`devtools/render-check-mobile-adb.mjs` 用 `puppeteer.connect` 接**手机上的** Chrome（CDP over adb），量到的是真机视口/字体/触控尺寸；不是 puppeteer.launch 的伪造视口。

```bash
# 起服务（本机 3000 被别的会话占着就换 3001，下面同步改）
PORT=3001 node server/index.js &

# 一次性准备：adb daemon 会随命令结束被杀，所以 reverse/forward 与脚本必须放在**同一条**命令里
ADB="C:/Users/J1825/AppData/Local/Android/Sdk/platform-tools/adb.exe"   # 不在 PATH 上
"$ADB" reverse tcp:3001 tcp:3001
"$ADB" forward tcp:9333 localabstract:chrome_devtools_remote   # 别用 9222：本机常被别的 Chrome 调试端口占着
"$ADB" shell am start -a android.intent.action.VIEW -d http://127.0.0.1:3001/ com.android.chrome
SP_CDP=http://127.0.0.1:9333 SP_BASE=http://127.0.0.1:3001 node devtools/render-check-mobile-adb.mjs
```

判定同样是逐项布尔（vivo V2520A / Android 16 / Chrome 149，横屏 761×266 CSS px @dpr3）：

```
viewport: {"w":761,"h":266,"dpr":3,"overflowX":0,"ua":"...Android 10; K...Chrome/149..."}
hub:   {"cards":["solo","coop","ext"],"overflowX":0,"inView":true}
hall:  {"statuses":["ready","missing","missing"],"chips":["可开局","筹备中","筹备中"],"start":"开始 湮灭模拟",
        "tiers":["1","2","3","4","5","6"],"party":["solo","coop"],"footIn":true,"overflowX":0}
touch: {"tier":["24x24"×6],"party":["24x24","24x24"],"start":["110x44"]}      ← 触控地板 24px 全过
room:  {"mode":"solo","difficulty":"ANNIHILATION","erosion":1,"chips":6,"on":"1","pill":"湮灭模拟AC-5"}
leave: {"requested":true,"backToHub":true}
errors: 0
RESULT: OK
```

截图落在 `SP_OUT`（缺省 `handoff/shots`，本会话沙箱写不进那个目录，所以当时落在临时目录）：`mobile-<TAG>-{lobby,hall,room}.png`。

---

## 5. 坑与红线（动手前必读）

1. **绝不运行 mod 的 `install.mjs` / `patch-data.mjs` / `一键安装卸载.bat`**：它是全文件覆盖式安装包（109 新增 / 38 覆盖），会毁掉工作区里其他会话的未提交改动。要装只能在副本里。
2. **不碰 `E:\Workbox\choco`**（用户明令）。
3. **`data/*.json` 是生成物**：改 `tools/build-data.mjs` 或 `docs/research/1{5,6}-annihilation-*.json` 后重生成。**生成器不幂等**：重跑会把 `data/bonds.json` 的 `spec` 文本改短。重建后 `git diff --stat data/` 只应有 `config.json` / `bosses.json`（+ 新增 `relics.json`），**`bonds.json` 要还原**。
4. **`DIFFICULTIES` 里不能加 `ANNIHILATION`**：那是官方四张卡的来源（`lobby-hub.test.js` 钉着 4 张）。用 `shared/annihilation-constants.js` 的 `ANNIHILATION_DIFFICULTY`；难度名/色进 `DIFFICULTY_NAMES` / `DIFFICULTY_COLORS`。
5. **`shared/versions.js` 的 `roomModes` 不能动**（`versions-service.test.js` 钉死 `['solo','coop']`）；`solo_infinite` / `coop_infinite` 的唯一归一是 `baseRoomMode()`。湮灭不新增 mode：形态就是 `solo` / `coop` 本身。
6. **每个新钩子都门在 `gd.annihilation`**（`annihilationFlags()` 在非湮灭模式返回 `null`，别依赖被调方，调用点自己先判）。
7. **`server/sim/` 的确定性**：无 `Math.random`、无时钟、无引擎近似数学（用 `server/sim/detmath.js`）。
8. **客户端任何按难度取值的地方都要想一遍 `ANNIHILATION`**（见 §3.8）。
9. **任何新增 `t('…')` 必须同时进四包**（`i18n --all --strict` 会红）。优先复用既有词条：`单人` / `同盟` / `蚀流` / `无尽湮灭` / `可开局` / `筹备中` 都在四包里。今天四包是 **2586**（`请先完成藏品选择`、`进入` 是最后两条）。
10. **CSS 顺序即行为**：动画声明必须写在 `prefers-reduced-motion` 归零块之前；`color-mix()` 必须在同一规则里先写一条普通声明做回退（WebView 地板 Chrome 87，`client-static` 有守卫）。
11. **工作区是共享的**：动手前 `git diff -- <目标文件>`；判断「某能力是否已支持」用 `git show HEAD:<file>`（工作树混着别人未提交的中间态，本线因此误判过一次）；`node --test` 不行就跑单文件；PowerShell `Get-Content` 会毁 UTF-8（用 read 工具）。
12. **真机点「准备就绪」会先弹「剩余资金」确认框**（`gameLogic.readyFundsPrompt`，兜里还有钱时）：只点一次 `.readybtn` 不会让 `priv.ready` 变真，要先点弹框确认。别当成「canReady 坏了」。
13. **`ui/hud.js` 的 `hidden` 在无尽局恒为 false 是正确行为**：它只判「越过 lastRound」，跟 `hiddenRound` 无关（隐秘核心那一相位由 `phase === PHASE.HIDDEN_CORE` 覆盖）。回合框只渲染当前回合，**没有 `/N`** —— 别为了「对称」硬加一个。
14. **`m.public.lastRound` 在无尽局是 `null`，`m.public.bossRound` 是逐回合算的**：任何「第几回合开最终攻势」的文案都要先读 `pub.bossRound`，再回落到数据里的 `mode.bossRound`（定值 19）。
15. **多视口真机脚本会互相污染**：同一浏览器几档视口共用 localStorage，第一档建了房会把下一页直接带进房（`.mode-card` 找不到）。脚本每档收尾要 `room.leave` 并等回大厅。
16. **`status: 'ready'` 的门槛是「真机走完整条路」**，不是「代码写完」——这一条是 2026-10-27 定下的规矩，别为了赶进度提前翻。
17. **参考页 `public/dev/extension-hall-preview.html` 只是设计参考**（带演示控制条、状态开关），真实大厅没有那些控件；改版式时不要反向把参考页当规格。
18. **R1 的增益藏品浮层（z 90）会盖在负面三选一（z 88）之上**，点「收下」后才露出三选一 —— 与 mod 行为一致，**可保留**，别当 bug 修。
19. **`adb` 不在 PATH 上**（在 `C:\Users\J1825\AppData\Local\Android\Sdk\platform-tools\adb.exe`），而且 **adb daemon 会随每条命令结束被杀**：`adb reverse` / `adb forward` 必须和用它那条命令写在**同一次调用**里，否则下一条命令连接被拒（`ERR_CONNECTION_REFUSED`）。
20. **别用 9222 做 CDP 转发端口**：本机常有别的 Chrome 调试端口占着它，`adb forward` 会静默失败，`puppeteer.connect` 就接到了**本机**浏览器上（会去点别人页面里的按钮）。`render-check-mobile-adb.mjs` 因此在连上后先断言 UA 含 `Android`，不是手机就 exit 2；端口用 9333。
21. **手机上可能开着好几个同 URL 的标签页**：脚本要挑 `document.visibilityState === 'visible'` 那个，否则驱动的是后台页（渲染与定时器被节流，`room.leave` 之后等不到大厅）。收尾若没回大厅，`goto('/')` 一次即可（身份在 localStorage）。
22. **`handoff/shots` 在本机沙箱里写不进去**（目录 ACL 对受限令牌是拒绝写）：`SP_OUT` 指向临时目录即可，别以为是脚本坏了。

---

## 6. 决策记录（已落地；要推翻得连测试一起改）

1. 湮灭的难度名/色进 `DIFFICULTY_NAMES` / `DIFFICULTY_COLORS`，**不进 `DIFFICULTIES`**；校验用 `includes(d) || d === ANNIHILATION_DIFFICULTY`。
2. `extensionModeCount()` 数「列出」的条目（`status !== 'missing'`），不是 `ready` 数——否则大厅卡写「0 个玩法」而点进去有一条。
3. 毒雾 **60 s**（data 驱动；mod 硬编码 30）、**只伤我方**（mod 连敌人一起；`hazard.js` 明确「allies only」）。
4. `bans` 数值随本仓更小的盟约池缩水：e1–e4 `{5,5}`、e5 `{4,7}`、e6 `{0,0}`（e5 核心数 4 反而少于 e1 的 5，是 mod 的 floor 规则遇到小池子的结果）。
5. 非无尽档 `pairOfRound` 越过队尾返回最后一对（mod 会外推一个不存在的下一对）。
6. 湮灭的敌人曲线只加在 `enemyScale`，不动 `baseEnemyScale`（`waves.test.js:94` 钉着官方模式两者相等）。
7. 简报回合数由**客户端按档位覆盖**（1–4 → 19、5 → 30、6 → ∞）：mode 数据里只有 19，30/∞ 是引擎按档位合成的，客户端不能只读数据。
8. **`pending` 仍是合法状态**（条目列出、可看档案、能选档位，「开始」暗着等引擎）；今天没有条目用它，测试靠注入 `modes` 覆盖那套渲染。
9. **同盟形态复用既有词条 `单人` / `同盟` 与既有 room mode `solo` / `coop`**：`soloUnlimited` 只随 `mode === 'solo'`；两个 mode 大厅里同名「湮灭模拟 AC-5」，靠形态区分。
10. **无尽局的「通过回合」按 `m.round` 算**（`gd.endless` 分支），其它模式（含超限）仍按 `gd.bossRound` 封顶：无尽没有「满回合」，`gd.bossRound` 只是第一章那一对（14）。

---

## 7. v3.2.0 对齐与未做项

### 7.1 已对齐（2026-10-27 晚，两批）

**第一批：8 条真 bug**（`server/match/relics.js` / `server/sim/content/relics.js` / `server/sim/content/devices.js` / `data/relics.json`）

| # | 症状 | 落点 |
|---|---|---|
| 1 | 图鉴「N 层」恒为 1 | `relicStackInfo` / `relicCatalogExhausted` 改读 `ps.m.round`（`ps.round` 是每回合计数器对象） |
| 2 | n06 莱塔尼亚权杖完全没有负面 | `relicPrepStart` 里 `ps.lp = max(1, lp - n)`，放在「同盟只让创建者抽」的早退**之前** |
| 3 | 致命级地形把小怪卡死（0.15×0.15=2.25%） | `MIN_TERRAIN_MOVE_MUL` 0.15 → 0.5，深水硬编码 0.1 并入同一常量 |
| 4 | p20 黑洞协议 +50% 与文案「+150%」不符 | research 源 `hp: 0.5 → 1.5` 后 `build-data --offline` 重生成 `data/relics.json` |
| 5 | 同盟房 AI 座位永远 0 件藏品 | 新增 `relicRecipients`（全体存活，含 AI）供**发放**；抽卡/投票仍归真人 |
| 6 | 房主淘汰后抽卡永久卡死 | 「开始抽取」与平票定案改用 `relicDrawerOf`；`autoPickRelic` 超时从并列卡里随机定案 |
| 7 | p21 国王的水晶只做了 LP-2 | 补 `fx.rule.income`（+5 资金）与 `priceChess`（-1） |
| 8 | p12 生还者合约把联防也算了 | `onBattleResult` 排除 `ev.unite`（文案明写「不包括联防」） |

**第二批：触发点（本轮）**

* **悬赏完成信号（p34 / p39 / 乌萨斯）**：`server/match/match/settle.js` 在 `onBattleResult` 载荷里带 `bountyDone`——本场**击杀了悬赏目标**或**有悬赏资金入账**就算 1 次，一场最多 1 次；必须在 `relicBountyMul` **之前**算（乘数把资金压成 0 不代表悬赏没完成）。计数器由 `server/sim/content/relics.js` 的全局 handler 加：`counters.bountyDone` 与 `counters.bountyKills`（旧名同值，p39 仇名录与图鉴读它）。**p34 铿金征鼓的「完成悬赏额外 +1 层」以前挂在 `perfect` 上**（完美作战 ≠ 完成悬赏），现在按 `bountyDone`。
* **死导出已删**：`server/match/relics.js` 的 `relicOnBattleResult` 没有任何调用方——本仓的 `onBattleResult` 是**会被派发**的（`meta.test.js:49` 钉着派发链），两处各记一遍就是双计。
* **p43 复得之轮 / p44 果腹**：`server/match/player/items.js` 的装备分支里，一次性装备**真的离开场面之后**（`!ev.keep && !find(uid)`，所以 寻呼模块 / 信标 这类「先开个人选择、随后销毁装备」的同样算）调 `relicConsumableRefund`（补一件随机 `consume_on_equip` 装备，每回合 ≤3 次，`refundRound` 在 `relicRoundStart` 清零，随机数走 `m.rngMeta.pick` 保持确定性）与 `relicConsumableFree`（返还 `gd.itemPrice`）。被动装备不触发。

**验证**：`node test/match/annihilation-mode.test.js` **17/17**（第二批新增 5 条：p34 叠层口径、p39 层数、settle 载荷三种情形、p43 上限与重置、p44 返价；第三批新增 2 条 n09）；`annihilation-erosion 14/14`、`meta 8/8`、`results 4/4`、`content/items 60/60`、`shared-stock`、`versions-core` 全绿；eslint 0 error；`i18n check --all --strict` 四包 **2585/2585**；`GOLDEN_FULL=1` **288 场景零位移**（第二批后、第三批后各跑一次）；手机真机 `render-check-mobile-adb` **OK**。

### 7.1b 第三批（2026-10-28 凌晨，业主点名的三项）

| # | 项 | 落点 | 证据 |
|---|---|---|---|
| 1 | 藏品三选一开着时，「准备就绪」的提示说清是哪一步没做 | `public/js/ui/gameLogic/shop.js` 的 `shopBlockReason('ready')`：`priv.relics.draft` 在时返回新词条 `请先完成藏品选择`（四包一起加，**2584 → 2585**；en `Complete the Relic choice first` / ja `先に秘宝の選択を完了してください` / ko `먼저 유물 선택을 완료해 주세요.` / zh-TW `請先完成藏品選擇`） | `test/ui/gameLogic.test.js` 的 `shopBlockReason` 两条断言 |
| 2 | 历史无尽局的结算回放不再写 `/14` | `server/match/results.js`：`gd.endless` 时给 m.result 加 `endless: true`（**只在无尽局加键**，官方模式的键集合与键序不动）；`public/js/ui/stats.js`：`normalizeRecord` 只认字面 true 保留、`buildRecord` 抄进记录、`recordToResult` 还原、`COMPACT_FRAME` 加 `endless`（**不升 schema**） | `test/ui/stats.test.js` 新增 2 条（无尽往返 / 老记录仍落 14） |
| 3 | n09 酒神的印记（重铸）的「悬赏资金减半」 | `docs/research/16-annihilation-relics.json` + `data/relics.json`：desc 补「，悬赏资金减半」、`fx.postBountyMul: 0.5`（代码路径 `relicBountyMul` 本来就有） | `test/match/annihilation-mode.test.js` 新增 2 条（数据/倍率 + 结算减半，含无 n09 的对照组） |

验证：`annihilation-mode 17/17`、`stats 57/57`、`match-records-stats 4/4`、`results 4/4`、`annihilation-endless-rounds 7/7`；eslint 0 error；`i18n --all --strict` 四包 **2585/2585**；`GOLDEN_FULL=1` **288 场景零位移**。

**沙箱事实（值得记住）**：本会话**子进程**（node / pwsh）写工作区子目录一律 `EPERM`（`data`/`test`/`public/i18n`/`handoff/shots` 全 denied，`%TEMP%` 可写），只有 fs 工具（read/edit/write）能写仓库。所以 `build-data` 直写 `data/` 这条路走不通：第三批的做法是 `node tools/build-data.mjs --offline --out %TEMP%\…` 跑出生成器的真实产物，与仓库版逐字节比对（只差 n09 那一段）后用 `edit` 落成，落成后 sha256 与生成产物相同 —— `data/relics.json` 仍然是生成器输出，不是手写近似值。

### 7.1c 主题大厅（2026-10-28，业主点名的「二级界面」）

**新的四步流程**：大厅 → 选中「拓展模式」→ 挑选模式 → 选中「湮灭模拟」**进入** → **主题大厅**（原包美术）→ 单人 / 同盟 + 蚀流 → 开始 → 房。

| 层 | 落点 | 说明 |
|---|---|---|
| 数据 | `public/js/screens/extensionModes.js` 的 `EXTENSION_MODES[0].theme` | `{ art: '/assets/annihilation-intro/art/crimson-knight.webp', kicker: 'ANNIHILATION // FIELD MANUAL' }` —— 主视觉与封面眉题都逐字取自原包（`slide-01.webp`） |
| 列表页 | 同文件 `ExtensionHall` | 底部只剩「包名 + **进入**」；`entered` 时把 `.ext-theme` 渲染进同一个 Modal。没有 `theme` 的玩法包保持原样（开始 → `onPick`） |
| 主题大厅 | **新文件** `public/js/screens/extensionThemeHall.js` | 全屏主视觉 + 压暗层 + 封面上那只发光环（纯 CSS）+ 左侧赤红竖线 + 眉题/大标题/AC-5；底部 `单人 / 同盟`、`蚀流 1–6`、`开始 {name}`。无状态视图（状态仍在 `lobby.js`），`data-testid` 沿用 `extension-tiers` / `extension-party` / `extension-start`，另有 `extension-theme` / `extension-theme-back` |
| 路由 | `public/js/screens/lobby.js` | 新增 `extEntered`（与 `extPick` / `extErosion` / `extParty` 同一层）；关闭大厅复位；Esc / 返回在主题大厅里回列表而不是关屏 |
| 样式 | `public/css/screens/lobby.css` | `.ext-theme*` 一套；底栏复用 `.ext-tier` / `.ext-party__chip` 的结构，只把配色换成本包的赤红 / 余烬橙（`#e85c3a`）。**两档小屏覆盖写在文件末尾**——大厅与协议页的测试按「第一条 `max-width:900px` / `max-height:520px` 媒体块」取用，新的同查询块放前面会让那些断言读到错的块（`extension-modes.test.js` 的 `mediaBlock` 也为此加了 `contains` 参数） |
| 词条 | `public/i18n/*.json` | **新增 1 条 msgid：`进入`**（en `Enter` / ja `入る` / ko `들어가기` / zh-TW `進入`），四包 **2585 → 2586**。其余全部复用既有词条（单人 / 同盟 / 蚀流 / 无尽湮灭 / 开始 {name} / 返回） |

**验收**（三个桌面视口 + 一台真机，全绿）：

```
SP_BASE=http://127.0.0.1:3000 node devtools/render-check-extension-hall.mjs          # 1280×720 / 800×360 / 667×375 三档 OK
SP_BASE=http://127.0.0.1:3000 SP_VIEWPORT=1280x720 node devtools/render-check-extension-hall.mjs
# 真机（vivo V2520A / Chrome 149 / 横屏 761×266）：render-check-mobile-adb.mjs → RESULT: OK
```

- 桌面：`theme.art.ok=true`（1280×720 的主视觉真的加载）、眉题/名称/AC-5、蚀流 1–6、单人/同盟、`开始 湮灭模拟`、`footIn=true`、`overflowX=0`；`hall.enter = {text:'进入', testid:'extension-enter'}`。
- 真机：`theme.artOk=true`、触控地板全过（蚀流 24×24、形态 32×24、开始 71×44）、进房 `difficulty=ANNIHILATION`、0 console error、回到大厅。
- 截图：`handoff/shots/extension-theme-1280x720.png`（桌面）、`extension-theme-800x360.png` / `-667x375.png`（小屏）、`%TEMP%\…\shots\mobile-v2520a-theme.png`（真机）。

**测试**：`extension-modes.test.js` **20/20**（新增「主题大厅」一条 + 两条 chip 用例改到主题大厅里 + `mediaBlock` 支持按内容选块）；`lobby-hub.test.js` 27/27；eslint 0 error；`i18n --all --strict` 四包 **2586/2586**。


### 7.2 未做 / 待决策（非阻塞，按价值排）

1. ~~**n19「未尽的生命」晕眩重做**~~：**已落地（2026-10-28）**。`server/sim/constants.js` 加 `DEPLOY_PROTECT = 1.2`（本仓只当延时用，不是部署保护窗口）；`server/sim/content/relics.js` 的 deploy 钩子按 mod v3.2.0 重写：开局批次用 `stunArmed` 一次性闸门、延迟 `DEPLOY_PROTECT + 0.05` 后按已晕人数封顶再挑人，战斗中再部署只晕刚上场的这一名 `redeployDur` 秒，`ctx.move`（【移动】）不触发。`redeployDur` 经 `server/match/relics.js` 透传；`docs/research/16-annihilation-relics.json` 的 n19 同时改 `desc` 与 `redeployDur: 5`，`data/relics.json` 由生成器重出（**只在临时目录生成、只搬 relics.json**——直接写 `data/` 会顺带改短 `bonds.json`）。回归锁是 `test/content/relic-n19-stun.test.js`（3 条，其中 2 条在旧实现上会红）。详见 `docs/EXTENSION_MODE.md` §3.7。
2. **增益藏品浮层能不能关**：v3.2.0 反方向把 Esc / 遮罩 / × 全删了（服务端等「收下」才清 `pending`，可关会让弹窗永久挂着）。本仓保留可关，属产品口径，倾向保持现状。

（原第 1/2/3 项——ready 提示文案、历史无尽局回放、n09 悬赏资金减半——已于 2026-10-28 凌晨落地，见 §7.1b。）

**可选**

* ~~`public/js/ui/components.js` 可补 mod 的 `annihilation` 图标（划掉的 rook）~~：**已补（2026-10-28）**，`ICONS.annihilation` 带 `eo: true`（缺了它斜杠会填成实心条而不是挖空），`EXTENSION_MODES[0].icon` 已从 `sword` 换成它。
* 大厅卡那行是否同时显示「可开局数」（今天只显示列出数）。
* `docs/design/client.md` 大厅段落在了 §35 规则文本里，DESIGN 分节索引未加新节（docs 测试不强制）。
* 参考页待定的三处已各自定下，可再推翻：左侧档案只有矢量徽记（无真实美术图）；行高保留 88 / 64 / 56；两条「筹备中」占位**保留**（它们是「1→N 等距排布」的活证据，`extension-modes.test.js` 靠它们）。

**已知红（都不是本线，别修）**

| 测试 | 失败内容 | 归属 |
|---|---|---|
| `test/i18n.test.js` | 「未包裹中文字面量」半条（`public/js/resources/*`、`battle/damageStats.js`，含逐字节拷入的 `ui/relics.js`） | HEAD 既有 |
| `test/client-static.test.js` | `public/css/traitOverlay.css` 的 `color-mix()` 没有回退（784/785） | 别的会话未提交改动 |
| `test/docs-consistency.test.js` | `char_102_texas.gacha is not planned by default` | 别的会话改了 `data/assets.json` |
| `test/ui/versions.test.js` | 「不读 research texts」守卫（`ui/hubSections.js:226`） | HEAD 既有 |
| `test/match/finalAssault.test.js` | Hidden Core 配对上场顺序（14/15） | 别的会话改了 `server/match/match/bossRounds.js` |
| `test/ui/gameLogic.test.js` / `settle.test.js` / `match-topbar.test.js` | `compatMode` / `SettleTestMark` 断裂 / `TopBar` 新增 `onCombatSpeed` | 别的会话未提交改动 |

---

## 8. 证据索引

| 类别 | 路径 |
|---|---|
| 玩法包设计规格（分层、三态、版式、测试钩子、加新包） | `docs/EXTENSION_MODE.md`（7 节） |
| 超限线设计 | `docs/INFINITE_MODE.md` |
| mod 拆解（109 新增 / 38 覆盖、两个静默坑） | `E:\Workbox\.session-dump\team\annihilation\a\report.md` |
| 主仓接线图 | `…\b\report.md` |
| UI 规格 | `…\c\spec.md` |
| 移植裁决与 8 步方案 | `…\d\plan.md` |
| mod 原始包（已解包，**只读**） | `E:\Workbox\.session-dump\ext\annihilation\湮灭模拟-独立mod-v3.1.0\` |
| mod v3.2.0 原始包（已解包，**只读**；比 v3.1.0 多 9 增 18 改） | `E:\Workbox\.session-dump\ext\annihilation\湮灭模拟-独立mod-v3.2.0\` |
| v3.1.0 → v3.2.0 拆包比对报告（436 行，A/B/C/重点 Q1–Q5/D/E） | `E:\Workbox\.session-dump\ext\annihilation\DIFF-v3.1.0-v3.2.0.md` |
| 设计参考页 | `public/dev/extension-hall-preview.html` |
| 大厅截图（三档 + 大厅） | `handoff/shots/extension-hall-{1280x720,800x360,667x375}.png`、`extension-hall-lobby-*.png` |
| 大厅 → 房截图（单人 / 同盟） | `handoff/shots/extension-hall-room-{solo,coop}-1280x720.png` |
| 局内截图 | `handoff/shots/annihilation-{room,relic,game,game-ready}-1280x720.png` |
| 真机自查脚本 | `devtools/render-check-{annihilation-room,extension-hall,infinite-entry}.mjs` |
| 手机真机自查脚本（CDP over adb） | `devtools/render-check-mobile-adb.mjs` |
| 主题大厅（二级界面） | `public/js/screens/extensionThemeHall.js`、`lobby.css` 的 `.ext-theme*`；截图 `handoff/shots/extension-theme-{1280x720,800x360,667x375}.png` |
| 历史档案 | `handoff/EXTENSION-MODE-2026-10-26.md`（S1 细账 + 四份研究结论）、`handoff/ANNIHILATION-CLIENT-2026-10-27.md`（客户端逐行细账） |

---

## 9. 接手顺序（建议）

1. 读本文 §5（红线）→ §1（状态）→ §2（架构地图）；细节查 `docs/EXTENSION_MODE.md` 对应节。
2. 跑一遍 §4 的 `annihilation-mode` / `extension-modes` / `annihilation-erosion` 建立基线（约 10 s）。
3. 起服务端（3000）跑一遍 §4 的两个真机脚本，亲眼确认 R1 三选一与「开始 → 房」两条路。
4. 要动手机端就跑 §4 的 adb 一段（`render-check-mobile-adb.mjs`）；注意 §5 的 19–22 条坑。
5. 再动 §7 里的任何一件；动完必须重跑 `GOLDEN_FULL=1 node tools/golden.mjs` 确认 288 零位移。

---

## 10. 历史附录：这条线是怎么走到今天的

| 日期 | 做了什么 | 留下什么 |
|---|---|---|
| 2026-10-26 | 超限入口收口（大厅紫卡、同盟入口、房间 ∞ 胶囊、`baseRoomMode` 修版本切换）；拓展模式四路研究（mod 拆解 / 主仓接线 / UI 规格 / 移植裁决）+ 可点的设计参考页 v2 | 超限线全绿；拓展模式 S1 清单（后来 §5.8 全部落地）；三条判断：**不能跑 mod 安装器**、**湮灭不新增 room mode**、**引擎是独立的第二轮** |
| 2026-10-27 上午 | 拓展模式 S1 落地：`extensionModes.js` + 大厅第三张卡 + 全屏大厅（40/60、88/64/56 行高、霜蓝 `--ext-*`）+ 16 个单测 + 三档视口自查 | 大厅壳完成，条目还是「待接入」 |
| 2026-10-27 中午 | 湮灭引擎 8 步合并：数据 → 常量 → 难度 → 协议 → 房间 → Match → gamedata（+380 行）→ 17 个钩子 + 9 个玩法包模块 | 服务端一行不缺；golden 288 零位移；`annihilation-mode` / `annihilation-erosion` 钉住链路 |
| 2026-10-27 下午 | 客户端三块：藏品三选一浮层 + 增益老虎机 + 图鉴、房内蚀流胶囊、局内蚀流角标；修房间简报「共 14 回合」 | 界面接上，真机仍停在简报/策略草稿 |
| 2026-10-27 傍晚（本轮） | 真机走通全流程 → `status` 翻 `'ready'`；无尽局回合显示与结算修正；单人/同盟开关 + 真机建 coop 房；文档整合 | 本文 |
| 2026-10-27 晚 | 收到 mod v3.2.0 → 拆包比对（27 个文件、+3479/−1088）→ 8 条真 bug 落地；3 条核查后判定「本仓本来没坏」（收入/首购折扣/派发链）；4 条留作产品决策 | `DIFF-v3.1.0-v3.2.0.md` + §7.1 第一批 |
| 2026-10-27 夜里 | 补上第二批触发点：悬赏完成信号（`bountyDone`，p34/p39/乌萨斯）+ p43/p44 一次性装备钩子；删死导出 `relicOnBattleResult`；手机真机（Android/Chrome over adb）走通「大厅 → 拓展模式 → 湮灭模拟 → 房」 | §7.1 第二批；`annihilation-mode` 17/17；`render-check-mobile-adb` OK |
| 2026-10-28 凌晨 | 第三批（业主点名）：ready 提示文案 + 新词条（2585）、历史无尽局回放不再写 `/14`、n09 悬赏资金减半 | §7.1b；`stats 57/57`；golden 288 零位移 |
| 2026-10-28 凌晨（续） | 主题大厅：选中玩法包后的二级界面用原包美术（不息恶火 + 封面排版），单人/同盟与蚀流下沉到这一屏；新增词条 `进入`（2586） | §7.1c；`extension-modes 20/20`；三档视口 + 真机 OK |

更细的过程（每一行落在哪个文件、为什么）在 §8 的两份历史档案里；它们不再作为入口，只在需要考古时翻。

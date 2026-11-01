# 湮灭模拟 · 客户端细账（2026-10-27，**已归档**）

> **⚠ 本文已被整合取代**：[`handoff/EXTENSION-MODE-2026-10-27.md`](EXTENSION-MODE-2026-10-27.md) 是当前唯一入口
> （超限线 + 拓展模式大厅 + 湮灭引擎 + 客户端 + 收尾，一份读完）。本文留作**客户端那一轮的逐行细账**，只在考古时翻；
> 与新代码冲突时以新交接 + 代码为准。
>
> 参考：`docs/EXTENSION_MODE.md`（玩法包总参考，§2 = 状态、§3 = 引擎/客户端分层）。
> 分支 `align/0.3.0`；工作区仍有多会话未提交改动，**从不 commit/checkout/stash**。

---

## 0. 一句话

**这条线做完了**：服务端全绿，客户端三块（藏品三选一、房内蚀流选择器、局内蚀流角标）都在真机上点通过一遍，
`EXTENSION_MODES[0].status` 已经是 `'ready'`（`reason` 已删）——大厅第三张卡 → 选择拓展玩法 → 开始 → 房 → 简报 →
策略草稿 → 协议启动！ → PREP 的 R1 藏品三选一 → 选完能准备就绪，两档蚀流（4 / 6）各走了一整圈。

同一天还收口了三件旧尾巴：**无尽局的回合显示**（没有 `/undefined`，真正的问题是「写死 19 / 兜底 14」）、
**无尽局的「通过回合」**（不再被第一章的 `bossRound 14` 封顶）、**同盟形态的开关**（页脚 单人 / 同盟 →
`room.create.mode`，`mode_multi_annihilation` 真机建过房）。

真机验收脚本：`devtools/render-check-annihilation-room.mjs`（局内全流程）、
`devtools/render-check-extension-hall.mjs`（大厅 → 房，含 单人 / 同盟 与三档视口）。

---

## 1. 状态表

| 层 | 项 | 状态 | 证据 |
|---|---|---|---|
| 服务端 | 数据 / 常量 / 协议 / 房间 / Match / gamedata / 17 个钩子 / 9 个玩法包模块 | ✅ | `GOLDEN_FULL=1` 288 场景零位移；`test/match/annihilation-{mode,erosion}.test.js` **8/8** + 14/14 |
| 服务端 | 无尽局的「通过回合」（跑多远算多远，不封顶在 14） | ✅ 本轮修 | `server/match/results.js`；`annihilation-mode.test.js` 新用例 |
| 大厅 | 第三张卡、选择拓展玩法、蚀流 1–6 chips、**单人 / 同盟**、`createAnnihilation` | ✅ **真机通过** | `test/ui/extension-modes.test.js` **19/19**；`devtools/render-check-extension-hall.mjs` 三档视口 OK |
| 大厅 | 湮灭模拟条目 `status: 'ready'`（可开局） | ✅ 本轮翻 | `public/js/screens/extensionModes.js`；大厅芯片「可开局」 |
| 房间 | 蚀流胶囊（房主开局前改档） | ✅ **真机通过** | `devtools/render-check-annihilation-room.mjs` |
| 房间 | 简报（标题/效果/回合数） | ✅ | 截图 `handoff/shots/annihilation-room-1280x720.png` |
| 局内 | 藏品三选一浮层 / 增益老虎机 / 图鉴 / 蚀流角标 | ✅ **真机通过** | `annihilation-relic-*.png`、`annihilation-game-ready-*.png` |
| 局内 | 无尽局回合显示不写 `/N` | ✅ 本轮验 | 蚀流 6 `lastRound: null`，整页文本无 undefined/NaN |
| 玩法包 | 同盟形态（`mode_multi_annihilation`） | ✅ **真机通过** | `handoff/shots/extension-hall-room-coop-1280x720.png` |

---

## 2. 这一轮（2026-10-27）动了哪些行

### 2.1 前一段：客户端三块接线（原交接原文，仍准确）

| 文件 | 落点 | 内容 |
|---|---|---|
| `public/js/screens/game.js` | `:86` | `import { EROSION_ENDLESS }`（`shared/annihilation-constants.js`） |
| | `:103` | `import { RelicOverlay, RelicCodex, RelicCodexButton, PositiveSlotOverlay, normalizeRelicDraft } from '../ui/relics.js'` |
| | `:316-320` | `relicBusy` / `codexOpen` / `positiveReveal` / `relicRevealSeq` |
| | `:360-362` | `RELIC_DRAFT_PHASES` / `relicDraft` / `relicReveal` |
| | `:368-380` | 增益藏品老虎机的 effect + 收下时 `net.request('g.relicSeen')` |
| | `:388` | `editable` 追加 `&& !relicDraft`（三选一期间棋盘与商店只读） |
| | `:1878` | 蚀流角标 `.gm__erosion` |
| | `:2000` / `:2043` | `RelicOverlay`（个人 ChoiceOverlay 之后）/ `PositiveSlotOverlay`；另有 `RelicCodexButton`（TopBar 之后）、`RelicCodex`（SettingsModal 之前），按符号 grep 即得 |
| `public/js/ui/gameActions.js` | `:95-96` | `relic: (idx) => act('g.relic', { idx }),` |
| `public/css/screens/game.css` | `:892-902` | `.gm__erosion` 四行（18px→`.18rem`、72px→`.72rem`、字用 `calc(n * var(--t))`） |
| `public/js/screens/room.js` | `:56` | `import { ANNIHILATION_DIFFICULTY, EROSION_MAX }` |
| | `:530` / `:559` / `:744-748` | 蚀流胶囊 `.rs-erosion-chips` / `.rs-erosion__chip`（1–6，6 档显示 `∞`） |
| `public/js/screens/lobby.js` | `:157` / `:180` / `:186-190` | `difficultyInfo(roomMode, difficulty, erosion)`：湮灭也查 config，回合数 1–4 → 19、5 → 30、6 → ∞ |
| `devtools/render-check-annihilation-room.mjs` | 新增 | 建房 → 蚀流胶囊 → 改档 真机自查（本轮已扩成全流程，见 2.2） |

**零新词条**：那一轮四包仍是 2585/2585。角标与胶囊只用既有 `t('蚀流')` / `t('无尽湮灭')` / `t('由创建者设置')`；`∞` 是字形不是 msgid。

### 2.2 收尾这一轮

| 文件 | 落点 | 内容 |
|---|---|---|
| `public/js/screens/extensionModes.js` | `EXTENSION_MODES[0]` | `status: 'pending'` → **`'ready'`**，删掉 `reason` 与它那段注释；文件头与 `ExtensionHall` 的文档注释同步改写 |
| | `:108-111` | `PARTY_KINDS`（`N_('单人')` / `N_('同盟')`，零新字面量） |
| | `:151` / `:156` | 新增 props `party`（缺省 `'solo'`）/ `onParty`；`onPick(id, erosion, party)` |
| | `:235-240` | 页脚 `.ext-party` 两枚 chip（`data-testid="extension-party"`、`data-party`、`aria-pressed`），与蚀流 chips 同一个 `erosionTiers` gate |
| `public/js/screens/lobby.js` | `:747` | `extParty` state |
| | `:819-832` | `createAnnihilation(id, erosion, party)` → `room.create.mode = party === 'coop' ? 'coop' : 'solo'`；难度仍是 `ANNIHILATION`，`soloUnlimited` 只随 solo |
| | `:916` | hall 挂载多传 `party` / `onParty` |
| `public/css/screens/lobby.css` | `.ext-party` / `.ext-party__chip` | 霜蓝选中态（`--ext-400`）、24px 触控地板、窄屏 + 矮屏两条媒体分支 |
| `public/js/ui/matchEnemies.js` | `:66-68` / `:91` | 简报「第 {r} 回合 · 最终攻势」改为 `pub.bossRound ?? mode?.bossRound ?? pub.lastRound ?? 14`（数据里的定值 19 不再抢在前面） |
| `public/js/ui/enemyDrawer.js` | `:34-36` / `:61` | 同一条兜底链、同一修法（局内敌方情报） |
| `public/js/ui/gameLogic/result.js` | `:46-48` / `:53` | `noTotal = isInfinite \|\| r.endless \|\| pub.endless`：无尽局 `lastRound` 传 null，堵掉结算页的「/14」 |
| `server/match/results.js` | `:120-123` | 无尽局（`gd.endless`）的「通过回合」按 `m.round` 算，不再被第一章的 `gd.bossRound`（14）封顶；其它模式照旧封顶 |
| `devtools/render-check-annihilation-room.mjs` | 重写 | 全流程驱动：房 → 开始 → 简报 → 策略草稿 → 协议启动！ → 增益老虎机 → 负面三选一 → 选卡 → canReady → 准备就绪 → 角标；`SP_EROSION` / `SP_BUMP` 选档与改档 |
| `devtools/render-check-extension-hall.mjs` | 扩写 | 断言改 ready（芯片「可开局」、开始「开始 湮灭模拟」、档案「玩法包已就位」、`.ext-party`）；新增「开始 → 房」一步（`SP_PARTY=coop` 验同盟形态），每档结束 `room.leave` |
| `test/ui/extension-modes.test.js` | 5 条断言改写 | 依赖 pending 的断言改成注入 `modes`（`pendingTable()`）；ready 的真实表断言可开局 |
| `test/match/annihilation-mode.test.js` | 新增 1 条 | 无尽局结算 `roundsPassed` 按实际回合（7 → **8** 条） |
| `test/ui/annihilation-endless-rounds.test.js` | 新增 | 无尽局回合文案与结算的回归锁（7 条） |

**词条数变成 2584**：删掉 `reason` 那条 msgid 后，四包各 2584/2584（`i18n check --all --strict` 仍 0 missing / 0 errors）。**没有新增任何 msgid**。

---

## 3. 验证（照着跑）

```bash
# 逐文件直接跑：本机沙箱下 node --test 会 spawn EPERM（它要给每个文件 spawn 子进程）
node test/match/annihilation-mode.test.js           # 8/8   链路验收 + 无尽局结算
node test/match/annihilation-erosion.test.js        # 14/14 蚀流梯级（含变异验证）
node test/match/results.test.js                     # 4/4   结算行（本轮改了 teamRounds）
node test/ui/extension-modes.test.js                # 19/19 大厅、蚀流 chips、单人/同盟、状态
node test/ui/annihilation-endless-rounds.test.js    # 7/7   无尽局回合文案
node test/ui/lobby-hub.test.js                      # 27/27（官方四张难度卡没被动过）
node test/ui/screen-fit.test.js                     # 6/6
node test/ui/version-vote.test.js                   # 8/8
node test/lobby-versions.test.js                    # 25/25
node tools/i18n.mjs check --all --strict            # 四包 2584/2584
node node_modules/eslint/bin/eslint.js <改动文件>
GOLDEN_FULL=1 node tools/golden.mjs                 # 288 场景零位移（49/46/22/21/10/140），exit 0
node test/client-static.test.js                     # 784/785：唯一红是别人未提交的 traitOverlay.css
```

**真机（服务端 `npm start`，默认 3000，不是 3020；需要 danger-full-access 给 Chrome 的 spawn 权限）**：

```bash
# 局内全流程：蚀流 4（角标写数字）与蚀流 6（无尽角标 + lastRound null）
SP_BASE=http://127.0.0.1:3000 SP_EROSION=4 SP_BUMP=0 node devtools/render-check-annihilation-room.mjs
SP_BASE=http://127.0.0.1:3000 SP_EROSION=4           node devtools/render-check-annihilation-room.mjs

# 大厅 → 房：三档视口 + 同盟形态
SP_BASE=http://127.0.0.1:3000 SP_PARTY=solo node devtools/render-check-extension-hall.mjs
SP_BASE=http://127.0.0.1:3000 SP_PARTY=coop node devtools/render-check-extension-hall.mjs
```

两条全流程脚本的判定都是**逐项布尔**（不是「跑完就算过」），日志里能看到每一步的 phase / 屏幕 / 覆盖层：

- 局内：`R1 relic overlay: {"phase":"PREP","round":1,"cards":3}` → `ready: {clicked:".readybtn", ready:true, phase:"COMBAT"}` →
  角标 `蚀流4` / `无尽湮灭∞`（`is-endless`）；`text: {bad:null}`。
- 大厅 → 房：`hall.statuses: ["ready","missing","missing"]`、`chips: ["可开局","筹备中","筹备中"]`、
  `party: [{"id":"solo","on":true},{"id":"coop","on":false}]`、`room: {"mode":"coop","difficulty":"ANNIHILATION","erosion":6}`。

**两条硬断言**（断链时会静默通过，所以钉在测试里）：

1. `m.publicView().erosion` 逐档等于房主选的 1–6、`endless` 只在 6 为真、蚀流 5 是 `lastRound 30 / bossRound 29 / hiddenRound 30`；
2. `new GameData(data, 'mode_single_normal')` 的 `erosion` 恒为 1、`lastRound` 仍 14，普通局的 `m.publicView()` 不长出 `erosion`/`endless` 键。

---

## 4. 下一步（都不阻塞，按价值排）

### 4.1 藏品三选一期间按空格的文案（§4.4 遗留）

服务端 `setReady` 在草稿开着时回 `BAD_TARGET「请先完成藏品选择」`，客户端现在走
`shopBlockReason('ready', …)` 的「临时整备区不为空…」，不准确。要准就得把 `请先完成藏品选择` 加进四包
（**新增 msgid 会改严格门禁的计数：2584 → 2585**，记得四包一起加）。

### 4.2 历史无尽局记录的结算回放仍会写 `/14`

`public/js/screens/stats.js` 的回放（`pub = null`）没有 `endless` 标记，`normalizeResult` 只能落 14 兜底。
要修就得动记录 schema（`buildRecord` 落一份 `endless: true`），属数据迁移，逐条回放不受影响的老记录仍会写 `/14`。

### 4.3 可选的美术/交互

* `public/js/ui/components.js` 可补 mod 的 `annihilation` 图标（划掉的 rook）；大厅现在用 `sword`。
* R1 的增益藏品浮层（z 90）会盖在负面三选一（z 88）之上，点「收下」后才露出三选一 —— mod 行为一致，可保留。
* 蚀流 5 的「30 回合」在简报里是客户端按档位覆盖的（`lobby.js` 的 `difficultyInfo`），数据层只有 19：新增任何按难度/档位取回合数的地方都要想一遍这条。

---

## 5. 坑与红线

1. **绝不运行 mod 的 `install.mjs` / `patch-data.mjs` / `一键安装卸载.bat`**：会覆盖 38 个文件，包括其他会话的未提交改动。
2. **不碰 `E:\Workbox\choco`**（用户明令）。
3. **`data/*.json` 是生成物**：改 `tools/build-data.mjs` 或 `docs/research/1{5,6}-annihilation-*.json` 后重生成。**生成器不幂等**：重跑会把 `data/bonds.json` 的 `spec` 文本改短。重建后 `git diff --stat data/` 只应有 `config.json`/`bosses.json`（+ 新增 `relics.json`），**`bonds.json` 要还原**。
4. **`DIFFICULTIES` 里不能加 `ANNIHILATION`**：那是官方四张卡的来源（`lobby-hub.test.js` 钉着 4 张）。用 `shared/annihilation-constants.js` 的 `ANNIHILATION_DIFFICULTY`。
5. **`shared/versions.js` 的 `roomModes` 不能动**（`versions-service.test.js` 钉死 `['solo','coop']`）。湮灭不新增 mode，只加 difficulty + erosion（形态是 `solo`/`coop` 本身）。
6. **每个新钩子都门在 `gd.annihilation`**。曾经的 golden 红是 `sim/content/devices.js` 的致命级缩放没在 `lethal === 1` 时保持恒等：`aspdOf(-0.6)` 是 −60 点攻速，`Math.max(-0.9, −60×1)` 把所有模式的深水格从 −60 变成 −0.9。
7. **三处显式消息分发**：`server/lobby.js` 的 `handleMessage` switch（`room.setErosion`）、`server/match/match/intents.js` 的 switch（`g.relic` / `g.relicSeen`）、以及 `server/match/relics.js` 的收藏品档期。缺 `case` = 协议过、点击静默落空，**没有关键词能搜到**。
8. **`server/sim/` 的确定性**：无 `Math.random`、无时钟、无引擎近似数学。`server/match/relics.js` 原来是 `Math.random()`，已改成 `createRng(deriveSeed(m.seed, …))`——**别改回去**，票决定全队拿哪件藏品。
9. **客户端「非 DIFFICULTIES 的 difficulty」是陷阱**：任何 `DIFFICULTIES.includes()` 的查表都会把湮灭当成未知值静默落兜底（简报曾因此写「共 14 回合」）。
10. **任何新增 `t('…')` 必须同时进四包**（`i18n --all --strict` 会红）。优先复用既有词条：`单人` / `同盟` / `蚀流` / `无尽湮灭` / `可开局` 都在。
11. **CSS 顺序即行为**：动画声明写在 `prefers-reduced-motion` 归零块之前；`color-mix()` 必须在同一规则里先写一条普通声明做回退（WebView 地板 Chrome 87，`client-static` 有守卫）。
12. **工作区是共享的**：动手前 `git diff -- <目标文件>`；判断「某能力是否已支持」用 `git show HEAD:<file>`；`node --test` 不行就跑单文件；PowerShell `Get-Content` 会毁 UTF-8（用 read 工具）。
13. **真机「准备就绪」会先弹「剩余资金」确认框**（`gameLogic.readyFundsPrompt`，兜里还有钱时）——脚本/自动化点一次 `.readybtn` 不会让 `priv.ready` 变真，要先点弹框里的确认键。别把这个当成「canReady 坏了」。
14. **`ui/hud.js:491` 的 `hidden` 在无尽局恒为 false 是正确行为**：它只判「越过 lastRound」，跟数据里的 `hiddenRound` 无关；隐秘核心那一相位由 `phase === PHASE.HIDDEN_CORE` 覆盖。回合框只渲染当前回合，**没有 `/N`**，别为了「对称」硬加一个。
15. **`m.public.lastRound` 在无尽局是 `null`，`m.public.bossRound` 是逐回合算的**（`server/match/match/views.js`）：任何「第几回合开最终攻势」的文案都要先读 `pub.bossRound`，再回落到数据里的 `mode.bossRound`（定值 19）。
16. **多视口真机脚本会互相污染**：同一浏览器几档视口共用 localStorage，第一档建了房会把下一页直接带进房（`.mode-card` 找不到）。脚本里每档收尾要 `room.leave` 并等回大厅。

---

## 6. 决策记录（已落地，可再推翻但要连测试一起改）

1. `DIFFICULTIES` 不加湮灭；难度名/色进 `DIFFICULTY_NAMES`/`DIFFICULTY_COLORS`；校验用 `DIFFICULTIES.includes(d) || d === ANNIHILATION_DIFFICULTY`。
2. `extensionModeCount()` 数「列出」的条目（`status !== 'missing'`），不是 `ready` 数。
3. 毒雾 **60 s**（`data` 驱动，mod 硬编码 30）、**只伤我方**（mod 连敌人一起；`hazard.js` 明确「allies only」）。
4. `bans` 数值随本仓更小的盟约池缩水：e1–e4 `{5,5}`、e5 `{4,7}`、e6 `{0,0}`。
5. 非无尽档 `pairOfRound` 越过队尾返回最后一对（mod 会外推一个不存在的下一对）。
6. 湮灭的敌人曲线只加在 `enemyScale`，不动 `baseEnemyScale`（`waves.test.js:94` 钉着官方模式两者相等）。
7. 简报回合数由**客户端按档位覆盖**（1–4 → 19、5 → 30、6 → ∞）：mode 数据里只有 19，30/∞ 是引擎按档位合成的。
8. **`status: 'ready'` 的门槛是「真机走完整条路」**，不是「代码写完」：2026-10-27 走通后才翻的。`pending` 仍是合法状态（测试用 `modes` 注入覆盖），只是现在没有条目用它。
9. **同盟形态复用既有词条 `单人` / `同盟`**、复用 `solo`/`coop` 两个 room mode：不进 `DIFFICULTIES`、不加 room mode。`soloUnlimited` 只随 `mode === 'solo'`。
10. **无尽局的「通过回合」按 `m.round` 算**（`gd.endless` 分支），其它模式仍按 `gd.bossRound` 封顶：无尽没有「满回合」，`gd.bossRound` 只是第一章那一对（14）。

---

## 7. 证据索引

| 类别 | 路径 |
|---|---|
| 玩法包总参考（分层与状态） | `docs/EXTENSION_MODE.md` |
| 上一份交接（S1 大厅 UI、8 步方案、研究结论、引擎落地 §10） | `handoff/EXTENSION-MODE-2026-10-26.md` |
| mod 拆解（38 个 overlay / 27 个真含湮灭代码 / 两个静默坑） | `E:\Workbox\.session-dump\team\annihilation\a\report.md` |
| 主仓接线图 / UI 规格 / 移植裁决 | `…\b\report.md` / `…\c\spec.md` / `…\d\plan.md` |
| mod 原始包（已解包，**只读**） | `E:\Workbox\.session-dump\ext\annihilation\湮灭模拟-独立mod-v3.1.0\` |
| 真机截图（大厅三档 / 大厅档案） | `handoff/shots/extension-hall-{1280x720,800x360,667x375}.png`、`extension-hall-lobby-*.png` |
| 真机截图（大厅 → 房，单人 / 同盟） | `handoff/shots/extension-hall-room-{solo,coop}-1280x720.png` |
| 真机截图（房内胶囊 / R1 三选一 / 选完可准备） | `handoff/shots/annihilation-room-1280x720.png`、`annihilation-relic-1280x720.png`、`annihilation-game-ready-1280x720.png` |
| 自查脚本 | `devtools/render-check-extension-hall.mjs`、`devtools/render-check-annihilation-room.mjs` |

---

## 8. 已知红（都不是本线，别修）

| 测试 | 失败内容 | 归属 |
|---|---|---|
| `test/i18n.test.js` | 「未包裹中文字面量」半条（`public/js/resources/*`、`battle/damageStats.js`，含逐字节拷入的 `ui/relics.js`） | HEAD 既有 |
| `test/client-static.test.js` | CSS 守卫：`public/css/traitOverlay.css` 的 `color-mix()` 没有回退（784/785） | 别的会话的未提交改动 |
| `test/docs-consistency.test.js` | `char_102_texas.gacha is not planned by default` | 别的会话改了 `data/assets.json` |
| `test/ui/versions.test.js` | 「不读 research texts」守卫（`ui/hubSections.js:226`） | HEAD 既有 |
| `test/match/finalAssault.test.js` | 「boss preview and actual fields share each round's draw」的 Hidden Core 配对上场顺序（14/15） | 别的会话改了 `server/match/match/bossRounds.js` |
| `test/ui/gameLogic.test.js` / `test/ui/settle.test.js` / `test/ui/match-topbar.test.js` | `sanitizeSettings` 多出 `compatMode`；`settle.js` 的 `SettleTestMark` 断裂；`TopBar` 新增 `onCombatSpeed` | 别的会话的未提交改动 |

另：本机可能还有别的会话留下的常驻 `node tools/golden.mjs` 进程（RSS ~1.9 GB），只会拖慢、不改结果。

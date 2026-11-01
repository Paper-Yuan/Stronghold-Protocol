# 12 人真实战斗（非 FakeBattle）跑满 5 轮 —— 简单验证

- 时间：2026-10-31 23:56–00:00（本地时区；每轮墙钟耗时见 §4）
- 结论：**通过**（不崩、结算按存活人数平摊、联防三段全走到、`m.public` 血量不 NaN / 不变态）
- 顺带发现 1 个**真实 UI 缺陷**（只报不改）：12 人房平摊出小数后，顶部生命塔把原始浮点直接印出来（§7.1）
- 源码零改动、无 git 写操作、未碰 golden；临时脚本与本地服务端已清理（§9）

## 1. 环境与方法（没有造框架，用的都是仓库既有测试钩子）

```
node test/e2e/fastServer.mjs            # = server/index.js startServer + 真 Match（不是 StubMatch / FakeBattle）
PORT=3180 HOST=127.0.0.1
SP_TIMER_SCALE=0.2 SP_COMBAT_SPEED=6    # 既有钩子：阶段计时 ×0.2，战斗时钟 6 倍
SP_START_ROUND=1 SP_IDLE_BOTS=1 SP_AUTO_PLACE=1
SP_START_KITS=[[chess_char_4_23_a, chess_char_4_24_a, chess_char_3_06_a, chess_char_3_13_a, chess_char_1_12_a, chess_char_2_06_a]]
```

- 浏览器：`puppeteer-core@25` + 本机 Chrome，**1 个真浏览器页**（1280×720，截图时切 792×360，换视口不 reload）
- 11 个 AI：`__SP__.net.request('room.addBot')` 连发 11 次（就是房间里「添加 AI」按钮发的那条 C2S），
  和上一次 8/12 人房截图用的是同一条路（`handoff/shots/MULTI-REAL-SHOTS.md` §3.1）
- 建房：标题页 → 大厅 → 同盟模拟 → 创建同盟 → `room.setSeats { maxSeats: 12 }` → 补 11 个 AI → `room.start`
- 单真人房 = `loneHuman` ⇒ 所有阶段**无倒计时**（`Match.soloUntimed`），所以页内挂了一个小代理替「玩家」作答：
  `g.infoReady` / `g.band` / `g.choice` / `g.ready`（与 `test/match/zhajing-e2e.test.js` 用同一批 C2S）；
  **回合推进本身、战斗、结算全由服务端真跑**，代理只点按钮

座位（12/12，如实）：

| 席 | 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 名字 | **凯尔希** | AI·华法琳 | AI·阿米娅 | AI·惊蛰 | AI·杜宾 | AI·凯尔希 | AI·可露希尔 | AI·8 | AI·9 | AI·10 | AI·11 | AI·12 |
| 真/AI | 真人 | AI | AI | AI | AI | AI | AI | AI | AI | AI | AI | AI |

分队（`teamIndexOf(seat)`）：我方同盟 0–3 / 蓝方同盟 4–7 / 红方同盟 8–11。

### 为什么是「非 FakeBattle」

- `server/` 下 grep 不到 `FakeBattle`（它只存在于 `test/match/fakeBattle.js`）；本局 `Match` 没有 `fake` / `script` 选项
- `m.public.combatMode = "client"`：本浏览器作为 authority 收到 `b.start` 并**真跑自己的场**（5 轮共 16 条 `b.start`，
  16 条 `authoritative`；5 轮 × 3 块场 = 15，另 1 条未深究）
- 11 个 AI 的场由服务端 `_runOnServer` → `HeadlessJob` 跑**同一个 spec 上的真 `Battle`**（`server/match/match/clientCombat.js:167`）
- 结算数字（R5：25 只漏怪 / 12 人 = 2.083333）来自真实战报，不是脚本

## 2. 每轮实际日志摘要

下面是运行输出逐行照抄，只做了两处删减（不改字）：重复的空转行被删掉、`settle=[…]` 里前几轮的条目用 `…` 省略。
`R<回合> <阶段>/<我的状态>`，`ev` = 快照条数，`acts` = 代理替玩家点的次数：

```
[ 4.4s] Rundefined undefined/undefined ev=0  acts=0  rounds=[]             unite=[]              settle=[]                 errs=0
[ 5.9s] R0 BAND_DRAFT/deciding    ev=2  acts=2  rounds=[]             unite=[]              settle=[]                 errs=0
[ 7.5s] R1 PREP/acting            ev=5  acts=2  rounds=[1]            unite=[]              settle=[]                 errs=0
[ 9.1s] R1 COMBAT/combat          ev=7  acts=3  rounds=[1]            unite=[]              settle=[]                 errs=0
[13.7s] R1 COMBAT/done            ev=8  acts=3  rounds=[1]            unite=[]              settle=[]                 errs=0
[18.2s] R1 UNITE/helping          ev=9  acts=3  rounds=[1]            unite=[team]          settle=[]                 errs=0
[19.1s] shot UNITE 792x360 saved
[26.7s] R1 UNITE/helping          ev=11 acts=3  rounds=[1]            unite=[team,watch,cross] settle=[]              errs=0
[37.2s] R1 SETTLE/done            ev=12 acts=3  rounds=[1]            unite=[team,watch,cross] settle=[R1:thr0/loss0.000]  errs=0
[38.7s] R2 COMBAT/combat          ev=15 acts=4  rounds=[1,2]          unite=[team,watch,cross] settle=[R1:thr0/loss0.000]  errs=0
[64.4s] R2 SETTLE/done            ev=21 acts=4  rounds=[1,2]          unite=[team,watch,cross] settle=[R1…,R2:thr0/loss0.000] errs=0
[65.9s] R3 SP_DRAFT/acting        ev=23 acts=4  rounds=[1,2,3]        unite=[team,watch,cross] settle=[…R2]              errs=0
[67.4s] R3 COMBAT/combat          ev=25 acts=5  rounds=[1,2,3]        unite=[team,watch,cross] settle=[…R2]              errs=0
[97.6s] R3 UNITE/helping          ev=29 acts=5  rounds=[1,2,3]        unite=[team,watch,cross] settle=[…R2]              errs=0
[111.2s] R4 PREP/acting           ev=33 acts=5  rounds=[1,2,3,4]      unite=[team,watch,cross] settle=[…R3:thr0/loss0.000] errs=0
[139.8s] R4 UNITE/helping         ev=38 acts=6  rounds=[1,2,3,4]      unite=[team,watch,cross] settle=[…R3]              errs=0
[156.4s] R4 SETTLE/done           ev=41 acts=6  rounds=[1,2,3,4]      unite=[team,watch,cross] settle=[…R4:thr0/loss0.000] errs=0
[157.9s] R5 COMBAT/combat         ev=44 acts=7  rounds=[1,2,3,4,5]    unite=[team,watch,cross] settle=[…R4]              errs=0
[170.0s] R5 UNITE/helping         ev=46 acts=7  rounds=[1,2,3,4,5]    unite=[team,watch,cross] settle=[…R4]              errs=0
[198.8s] R5 SETTLE/done           ev=49 acts=7  rounds=[1,2,3,4,5]    unite=[team,watch,cross] settle=[…,R5:thr25/loss2.083] errs=0
[199.6s] shot SETTLE 792x360 saved
[199.6s] 5 settled rounds with UNITE + damage
[199.7s] events 52 errs 0 battles {"start":16,"authoritative":16} acts 8
[199.7s] result null
[199.7s] page problems []
[199.7s] rec errs []
[199.7s] server log tail ["fast server on http://127.0.0.1:3180 (timers ×0.2, combat 6×, first round 1)"]
```

## 3. 每轮逐项数据（`m.public` 实取值）

`hp` 是 `m.public.players[].hp`（= `max(1, floor(lp))`），顺序 P1…P12；`hpMax` 是各人构筑的血上限（各 strategie 不同）。

| 回合 | COMBAT 场数 | 存活 | hp（休整期） | hpMax | 联防 stage | `cross` | SETTLE `through` | 每人扣血 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| R1 | 12（1 客户端 + 11 服务端） | 12/12 | 28,27,28,29,28,29,28,26,23,24,27,30 | 28,27,28,29,28,29,28,26,23,24,27,30 | team → watch → cross | source 0 / leaked 0 | 0 | 0 |
| R2 | 12 | 12/12 | 同上 | 同上 | team → watch → cross | source 0 / leaked 0 | 0 | 0 |
| R3 | 12 | 12/12 | 同上 | 同上 | team → watch → cross | source 0 / leaked 0 | 0 | 0 |
| R4 | 12 | 12/12 | 同上 | 同上 | team → watch → cross | source 0 / leaked 0 | 0 | 0 |
| R5 | 12 | 12/12 | 25,24,25,26,25,26,25,23,20,21,24,27 | 同上 | team → watch → cross | source 0 / leaked 0 | **25** | **2.083333** |
| R6 | —（验证到此为止，已进 R6 休整） | 12/12 | 25,24,25,26,25,26,25,23,20,21,24,27 | 同上 | — | — | — | — |

每轮结构完全一致（真数据）：

- `fields` = 12 个 `n:<playerId>:normal`；R1 里本浏览器的场先 `done`（8.4s），11 个 AI 场继续
- UNITE 计划：`teams[0] helpers=1 leakers=3 watching=false`；`teams[1] helpers=0 leakers=4 watching=true`；
  `teams[2] helpers=0 leakers=4 watching=true`（AI 座位只就绪不摆干员 ⇒ 三队各漏 3/4/4）
- 联防场：先 `u0:unite`（我方队内，1 名 helper 出手）→ `watch`（蓝/红全漏，转观看）→ `x:unite`（跨队，`source=0`）→ SETTLE
- R5 跨队场留下 25 只 ⇒ `d = 25`，`n = 12`（全员存活），每人 **25/12 = 2.083333**，
  `m.public.uniteResult.losses` 12 条全等、且都等于 `through / 存活人数`

血条核对（R5）：凯尔希 28 → lp 25.916666…（显示 `floor` 25）、AI·12 30 → 27.916…（显示 27），
每一名玩家的差都恰是 2.083333 —— **平摊正确，没有 NaN / Infinity / 暴涨**。
（快照逐条断言：`Number.isFinite(hp) && Number.isFinite(hpMax) && Number.isFinite(lp)` 全部为真。）

## 4. 时序

| 回合 | 进入 COMBAT | 进入 SETTLE | 该轮墙钟 |
| --- | --- | --- | --- |
| R1 | 3.97 s | 32.9 s | ≈ 29 s |
| R2 | 34.3 s | 59.9 s | ≈ 27 s |
| R3 | 62.3 s | 105.7 s | ≈ 46 s（含机变 `SP_DRAFT`） |
| R4 | 107.5 s | 151.9 s | ≈ 46 s |
| R5 | 153.1 s | 193.9 s | ≈ 42 s |

**5 轮共 194 s（3 分 14 秒）**，远在 30 分钟预算内；没有卡在任何阶段。

## 5. 是否崩

| 侧 | 观测 | 结果 |
| --- | --- | --- |
| 服务端 | 进程全程存活，5 轮内无重启；`startServer` 关闭时正常退出（exit 0） | 未崩 |
| 服务端（错误计数，见 §6） | `m.errorCount = 0`、`m.errors = []`、`verifyStats.takeovers = 0` | 0 条 |
| 浏览器 | `pageerror` 0 / `console.error` 0 / `requestfailed` 0 / HTTP ≥ 400 0（`problems: []`） | 0 条 |
| `Match` | 5 轮里没有任何 `b.end { reason: 'takeover' }`、没有 `deadline` 超时接管 | 无 |

## 6. 补充一次「有日志的服务端」验证（为什么需要它）

`test/e2e/fastServer.mjs` 启动时传 `quiet: true`，而 `makeLogger(quiet)` 返回 `noopLog` —— **服务端一行都不打**，
所以第一局的 stdout 只能证明「进程没死」，证明不了 `Match.reportError` 没被调用。为此另跑了一局短验证
（3183 端口，`startServer({ quiet: false })` + 同一个「AI 只就绪」钩子，真人**不给干员**，2 轮）：

```
errorCount: 0
errors: []
verifyStats: { checked: 0, mismatches: 0, rejected: 0, takeovers: 0 }
1:SETTLE  through=48  losses=[4,4,4,4,4,4,4,4,4,4,4,4]     (48 / 12 = 4)
2:SETTLE  through=96  losses=[8,8,8,8,8,8,8,8,8,8,8,8]     (96 / 12 = 8)
page errs: []
```

即：**服务端错误计数为 0、无接管、无被拒结果**；这一局全员漏怪（真人也没干员），平摊同样是 `d / 12`。

## 7. 发现（只记录，未改源码）

### 7.1 12 人房血量出现小数后，顶部生命塔印原始浮点（**实测**）

`handoff/shots/room12-real-match-settle-792x360.png`（R5 结算后的 R6 休整）顶栏：

```
回合 6  …  25.916666666666668  …
```

- `m.public.players[0].hp` 是 **25**（`hpDisplay` = `max(1, floor(lp))`，正确），
  而 HUD 的生命塔显示 **25.916666666666668**（R5 实扣 2.083333 后的原始 `lp`）
- 定位：`public/js/ui/gameComponents.js` 的 `LpTower` → `<b class="num lp__val">${ok ? Math.max(0, value) : '--'}</b>`，
  没有任何取整/格式化；`public/js/ui/hud.js:706` 把 `lp`（`m.private.lp`）原样传进去
- 4 人房里 `lp` 一直是整数（伤害按漏怪只数整扣），所以这个分支从没暴露；**12 人房按存活人数平摊必然出小数**，
  于是每轮结算后都会出现这种 16 位小数。多人 HUD 的队内血条（`multiHud.js:176`）自己做了 `Math.max(1, Math.floor(p.hp))`，
  所以只有顶栏这一处露出来
- 按「不改源码」只报不修；改法大概率是 `LpTower` 里对 `value` 取整或复用 `hpDisplay` 的口径

### 7.2 简报期 `players[].hp` 全员 0（**实测，非缺陷**）

`INFO_CHECK` 的第一帧 `m.public.players[].hp` 全是 0、`hpMax` 全是 1 —— 此时还没选策略（血上限由 strategie 的 `startLp` 决定），
`BAND_DRAFT` 选完才落地（实测：`BAND_DRAFT` 中 P1 先变成 28，其余在 `BATTLE_CHECK` 全部落地为 22–45 不等）。
简报页不显示血条，所以没有视觉影响，但「全员 0 血」是这个阶段真实取值，记在此以免日后误判成 NaN。

### 7.3 单真人 12 人房没有倒计时（**行为说明，不是缺陷**）

`Match.soloUntimed` 在 `loneHuman`（只有 1 名非 AI 玩家）时为真 ⇒ 简报 / 盟约 / 机变 / 休整都不走倒计时，
必须由玩家操作才推进；本次用页内代理发 `g.infoReady` / `g.band` / `g.choice` / `g.ready`（4 个动作共 8 次，
其中 `g.ready` 每轮 1 次）。所以「12 人房挂机不动」会永久停在简报——这不是本次改动引入的问题，但联调时要按「真人会操作」来测。

## 8. 局限（如实）

- 不是 12 个真人浏览器：**1 个真浏览器 + 11 个 AI 座位**（任务允许的做法；每次 `room.addBot` 之后都等 `room.seats` 计数变化）
- AI 座位是「只就绪、不买不摆」（`SP_IDLE_BOTS=1` 且不给 `SP_BOT_CHESS`），**这是为了让漏怪必然发生**、
  从而跑出队内联防与扣血；这意味本局的 AI 战斗是「必漏」形态，不是 AI 正常运营的强度
- 只跑到 5 轮（R1–R5 结算 + 进 R6 休整），没有打到 RESULT 结算屏；任务要求是「≥5 轮」
- 第一局服务端是 `quiet` logger（见 §6），所以「不崩」的服务端侧证据来自那次额外的 `quiet:false` 短跑

## 9. 复现与清理

- 复现骨架（临时脚本已删）：`startRealServer({ port: 3180, fast: { timerScale: 0.2, combatSpeed: 6, startRound: 1, idleBots: true, autoPlace: true, kits: [UNITE_HOST_KIT] } })`
  → `new Client(puppeteer, base, 'host12', { w: 1280, h: 720 })` → `enter('凯尔希')` → `createCoop()`
  → `net.request('room.setSeats', { maxSeats: 12 })` → `room.addBot` ×11 → 装页内快照/错误钩子 + 自动作答 → `room.start`
  → 每 1.5 s 读快照，UNITE 时切 792×360 截图
- 服务端与浏览器随脚本 `srv.stop()` / `browser.close()` 退出，端口已释放
- 本次写入仓库的文件只有：`handoff/shots/TWELVE-REAL-MATCH.md`、`handoff/shots/room12-real-match-792x360.png`、
  `handoff/shots/room12-real-match-settle-792x360.png`（第三者用于记录 §7.1 的浮点现象）。源码零改动，无 git 写操作。

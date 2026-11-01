# 多人房联防条 `.gm-unite`：只在「真的在联防」时挂载（修前 / 修后实测）

- 时间：2026-11-01 00:06–00:2x（本地时区）
- 结论：**通过**。横条现在只在 `m.public.phase === 'UNITE'` **且** `m.public.unite.stage ∈ {team, watch, cross}` 时
  挂载；其余每一帧（PREP / COMBAT / SETTLE / 选卡浮层 / 联防已结束）**DOM 里没有这个节点**（不是 `display:none`、
  不是 `visibility:hidden`）。4 人房与既有模式一行未动；不新增 msgid；无 git 写。
- 证据：真服务端 `test/e2e/fastServer.mjs`（`server/index.js` 的 `startServer` + 真 `Match`）跑 12 人房（1 真人 +
  11 AI），每 250 ms 采样一帧；逐帧原始数据在 `handoff/shots/unite-gate.json`，792×360 的三张图在 §6。

## 1. 根因（两条，都有实测帧）

之前 `.gm-unite` 的渲染条件是 `pub.phase === PHASE.UNITE && pub.unite` —— 只问「有没有 unite 对象」，不问
「现在是不是真的在联防」。于是下面两种 `m.public.unite` 都会被画成横条：

1. **联防三段走完、结算还没到的那个窗口（实测复现，就是本单要修的那一帧）**：
   `server/match/match/unitePhase.js:293` 的 `_finishMultiUnite` 先把 `this.uniteStage = null`，再
   `later(DELAYS.COMBAT_END, () => this.settle(...))`；而 `views.js` 的 `_multiUniteView()` 当时写的是
   `const stage = this.uniteStage || 'team'`。所以那几帧服务端发的仍是 `phase: 'UNITE'` + `unite.stage: 'team'`，
   但场上**一个 live 的联防场都没有**（`m.public.fields = []`）。
   修前实测帧（`handoff/shots/unite-gate.json` 的 `before.leakFrame`，12 人房 R1，`at 24.48 s`）：

   ```
   phase=UNITE  stage=team  fields=[]  .gm-unite 数=1  left=63（11 个漏怪者：10×6 + 3）
   ```

   横条读作「联防阶段 / 队内联防 / 剩余敌人 63 / 联防中」—— 场上什么都没跑。**这就是“非联防阶段还挂着横条”的
   那一类帧**：它其实是 UNITE 阶段的尾巴（棋盘已回到休整样子，截图看起来就像 PREP），不是 PREP 本身。
2. **4 人房的 `unite` 形状**：`views.js` 给 4 人房发的是 `{ helpers, leakers }`（没有 `stage`）。它今天画不出横条
   只是因为 `isMultiRoom(pub)` 在 4 人房返回 null —— 一旦这层门有别的变化，`STAGE_TEXT[undefined] || STAGE_TEXT.team`
   这个回落就会把没有 stage 的 unite 画成「队内联防」。修后这条回落也删了。

修法（落点）：

| 落点 | 改动 |
| --- | --- |
| `public/js/ui/multiHud.js:51` | 新增 `UNITE_STAGES = ['team','watch','cross']`（冻结） |
| `multiHud.js:63–66` | 新增 `uniteLive(pub)`：`phase === 'UNITE' && unite && typeof unite.stage === 'string' && UNITE_STAGES.includes(unite.stage)` |
| `multiHud.js:163` | 渲染门 `const unite = pub.phase === PHASE.UNITE && pub.unite ? pub.unite : null` → `uniteLive(pub) ? pub.unite : null` |
| `multiHud.js:213` | `STAGE_TEXT[unite.stage] \|\| STAGE_TEXT.team` → `STAGE_TEXT[unite.stage]`（stage 已被门校验，回落是死代码、且会掩盖回归） |
| `server/match/match/views.js:360` | `const stage = this.uniteStage \|\| 'team'` → `this.uniteStage \|\| null`：三段结束后不再回落成 `'team'`，横条随最后一段一起消失（“联防结束后立即消失”） |
| `public/css/screens/multi-hud.css:19–21` | 注释写明挂载判据是 `uniteLive`，并说明这里一条 display/visibility 隐藏规则都没有 |

`_multiUniteView()` 的 JSDoc 同步改成 `stage: string|null`（`views.js:349–357`）。

## 2. 判据（一句话）

`uniteLive(pub)` 为真的唯一条件：`m.public.phase === 'UNITE'` **且** `m.public.unite.stage` 是三个已知 stage
之一。**不看对象存在与否**。用到的具体字段就两个：`pub.phase` 与 `pub.unite.stage`。

## 3. 修前 / 修后逐帧对比（真服务端，250 ms 采样，12 人房 R1；修后那次多采到 R2 休整期的 5 帧）

| 帧类型（phase:stage） | 修前 帧数 / 其中有横条 | 修后 帧数 / 其中有横条 |
| --- | --- | --- |
| BAND_DRAFT | 2 / 0 | 2 / 0 |
| BATTLE_CHECK | 2 / 0 | 2 / 0 |
| ROUND_START | 2 / 0 | 2 / 0 |
| PREP | 2 / 0 | 7 / 0 |
| COMBAT | 20 / 0 | 34 / 0 |
| UNITE:team | 30 / **30** | 34 / 34 |
| UNITE:watch | 2 / 2 | 1 / 1 |
| UNITE:cross | 31 / 31 | 36 / 36 |
| **UNITE（stage=null，三段已走完）** | **1 / 1** ← 本单要修的那一帧 | **1 / 0** |
| SETTLE | 3 / 0 | 1 / 0 |
| 合计 | 94 / 63 | 121 / 71 |

- 哪一帧有：`UNITE:team / watch / cross` 三段（72 帧里全部有，修前修后一致）。watch 段没有 live 场是规则本身
  （该队全漏、只有观看），横条在那里是**对的**。
- 哪一帧没有：PREP / COMBAT / SETTLE / 三段走完那一帧 —— 修后全部 `querySelectorAll('.gm-unite').length === 0`；
  修前「三段走完」那一帧是 1（唯一一处违规帧，`at 24.48 s`）。
- `.gm-teams`（队伍框）在**所有**帧里都还在（118 帧里 118 有），与横条无关 —— 它本来就是常态挂载的那一列。

## 4. `.gm-teams` 核查结论：没有同类问题，不改

逐条看过 `.gm-teams` 的挂载点：

- 它是唯一常态化挂载的块，且这正是定稿形态（「一框 = 一支队伍」，所有阶段都要能看队名 / `n/4` / 掉线倒下）。
- 它下面**没有**“常态多挂了一块”的节点：框头按钮是每框一个、永远在；`.gm-team__list` 只在 `openTeam === i` 时
  才存在于 vnode 里（不是 `display:none`）；另外两框用 `[hidden]` 属性（这是用户主动展开时的临时态，不是常态）。
- `.gm-teams.is-tail` 只在展开最后那一框时加（行高收紧），收起态没有。
- 8 人 / 12 人房的框数由容量算（2 / 3），空位框显示「空位 + 邀请」—— 那是席位状态，不是多余块。
- 唯一可以提的旁证：`aria-label="ALLIANCE"` 是写死的英文字面量（`multiHud.js:169`），不是 i18n 条目；但它不是
  “多挂的块”，本单不动（改它要新 msgid，与红线冲突）。

## 5. 几何：横条出现时不压盟约条 / 队伍框 / 角落键 / 效果列（792×360 同一帧实测）

UNITE（stage=team）帧，`getBoundingClientRect`：

| 元素 | rect `[left, top, right, bottom]` |
| --- | --- |
| `.gm-unite` | **144.00, 98.39, 744.00, 146.39**（600 × 48） |
| `.gm-teams`（3 框收起） | 8.00, 94.39, **96.00**, 202.39（88 × 108；框 1/2/3 的 y = 94.39 / 132.39 / 170.39） |
| `.gm__bonds`（盟约条） | 339.61, 54.39, 452.39, **94.31** |
| `.gm__corner`（左下角键） | 9.59, **316.41**, 157.59, 350.41 |
| `.gm__effects`（右侧效果列） | **755.28**, 96, 780, 124.47 |
| `.gtop`（顶栏） | 0, 0, 792, **42** |
| `.shopbar` | null（UNITE 期商店栏收起） |

余量：盟约条底 → 条顶 **4.08**；队伍框列右缘 → 条左缘 **48.00**；条右缘 → 效果列左缘 **11.28**；
条底 → 角落键顶 **170.02**；顶栏底 → 条顶 **56.39**。

交叠面积（`max(0, min(right) − max(left)) × max(0, min(bottom) − max(top))`，与上一轮同口径）：
`.gm-unite × .gm__bonds` / `× .gm-teams` / `× 每个可见 .gm-team`（3 框）/ `× .gm__corner` / `× .gm__effects` /
`× .shopbar` / `× .gtop` **全部 0.00**。条本身 `pointer-events: none`，压在棋盘上也不挡任何可点元素。

1920×1080 的算术（单测 `test/ui/multi-hud.test.js:221`）同一条：左缘 360、顶 246、高 120、右 1800，队伍框列右缘
240 < 360，盟约条底 236 < 246，条底 366 < 角落键顶 1000。

## 6. 截图（起真服务端重拍，792×360）

同一局同一帧只换视口（1280×720 → 792×360，不 reload），DPF=1，`captureBeyondViewport: false`；
每次拍摄前等两帧 `requestAnimationFrame` + 700 ms，并在拍摄前后各读一次 `__snap()` 记下“画出来的那一帧”
（逐帧数据在 `unite-gate.json` 的 `samples`）——忙的棋盘上截图会晚于 DOM 一两帧，这一条是本单踩过的坑。

| 文件 | 尺寸 | 字节 | SHA-256 |
| --- | --- | --- | --- |
| `handoff/shots/room12-unite-on-792x360.png`（联防阶段：条在） | 792×360 | 444736 | `d6ea053ecffb16fa7e388b712011145ddf01633c984ab3d483599eeec1ded9aa` |
| `handoff/shots/room12-unite-off-792x360.png`（非联防阶段：R2 休整期，条不在） | 792×360 | 378152 | `763969ec1c333f671e521e91c9a0a3e8df98b9d878f91bdd9e7e8989120491bd` |
| `handoff/shots/room12-unite-end-792x360.png`（旁证：三段走完、phase 仍 UNITE、stage=null，条已不在） | 792×360 | 479931 | `fd5ee7da08bd92b5924ca133c58658f38e03bd03b8b4e1af754cdfb22e50c317` |

三张图拍摄时的快照（`shot`/`POST` 各一条）：

```
shot unite -> ... (painted UNITE/team uniteEl=1)
POST {"name":"unite","phase":"UNITE","round":1,"stage":"team","uniteEl":1,"liveUnite":true}
shot after -> ... (painted PREP/null uniteEl=0)
POST {"name":"after","phase":"PREP","round":2,"stage":null,"uniteEl":0,"liveUnite":false}
shot end   -> ... (painted UNITE/null uniteEl=0)
POST {"name":"end","phase":"SETTLE","round":1,"stage":null,"uniteEl":0,"liveUnite":false}
```

## 7. 测试（ℹ 原文）

```
$ node --test test/ui/multi-hud.test.js
ℹ tests 18
ℹ suites 0
ℹ pass 18
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 187.0294

$ node --test test/ui/**/*.test.js
ℹ tests 1540
ℹ suites 286
ℹ pass 1501
ℹ fail 0
ℹ cancelled 0
ℹ skipped 39
ℹ todo 0
ℹ duration_ms 19319.6598

$ node --test test/match/teams.test.js test/match/room-seats.test.js test/ui/room-seats.test.js
ℹ tests 36
ℹ suites 1
ℹ pass 36
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 2212.7501

$ node --test test/match/*.test.js
✖ test/match/external-transports.test.js:113  stdio timeout cancels a slow request … (545.7ms)
  Error: transport  at server/ai/transport.js:105
（整目录级跑法下的这一条是**机器忙时的既有时序 flake**，与本单无关：单跑该文件 16/16 pass，
  见下面的复跑；本单没碰 server/ai/**）

$ node --test test/match/external-transports.test.js
ℹ tests 16
ℹ suites 0
ℹ pass 16
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 1997.9551

$ npm run typecheck
> stronghold-protocol-alliance@0.3.3-Yuan typecheck
> tsc --noEmit --checkJs -p jsconfig.json
（无诊断，退出码 0）

$ npx eslint public/js/ui/multiHud.js server/match/match/views.js test/ui/multi-hud.test.js
（0 errors；multi-hud.css 被 eslint 忽略，属既有配置）
```

未改动 golden：`server/match/match/views.js` 只是视图层，`server/sim/**` 与 `test/golden/*.json` 一个字节没碰。

### 7.1 本单新增的 4 个用例（`test/ui/multi-hud.test.js`）

| 行 | 用例 |
| --- | --- |
| 72 | `pubUnite(stage)`：按 `views.js` 的多人房形状造一份 12 人房 `m.public`（`stage` + 三队 + `left`） |
| 150 | 门的反例 10 条：PREP / COMBAT / SETTLE / SP_DRAFT / UNITE 但没有 unite / 4 人房形状（无 stage）/ `stage: ''` / `stage: 'settle'` / `stage: null` / PREP 里残留带 stage 的 unite —— 每条都断言 `.gm-unite` 数量 **0** 且 `uniteLive === false`；并断言 `.gm-unite` 的 CSS 规则里没有 `display:none` / `visibility:hidden`（不挂载才是判据） |
| 182 | team / watch / cross 三段：`role=status`、`aria-label=联防阶段`、阶段字（队内联防 / 观看其他队的联防 / 跨队联防）、状态字（联防中 / 观战中 + `is-done` 只在 watch）、`剩余敌人 6`、出手头像 2 个；`left` 缺失时不出「剩余敌人」 |
| 207 | 联防结束后立即消失：`stage: null` → 0；settle 帧（`unite: undefined`）→ 0；下一回合 PREP → 0；再联防 → 1 |
| 221 | 几何：792 与 1920 两套算术（列右缘 < 条左缘、盟约条底 < 条顶、条底 < 角落键顶、8 px 边距、条高 ≥ 32），并断言 `pointer-events: none` 与 `right: 1.2rem` |

## 8. 4 人房 / 既有模式不变

- `multiHudView` 的容量门一字未动（`isMultiRoom(pub)` 为假 ⇒ 返回 `null`），单测「4 人房：没有 maxSeats ⇒ 这一层
  不存在」继续通过，`props` / TeamPanel 挂载断言（`game.js:2012`）原样通过。
- `.gm-unite` 的 CSS 只有注释改动，规则体（`left/right/top/height` 等）一个字节没动。
- 服务端 `views.js` 的改动只在 `this.multiTeam` 分支（`_multiUniteView`）；4 人房仍发
  `{ helpers, leakers }`（`views.js:237–239`），键与值不变。
- `STAGE_TEXT` / 文案未动，没有新增任何 `t('…')`（单测逐条比对 `public/i18n/en.json` 通过）。

## 9. 清理与红线

- 临时脚本与中间产物（`.sp-tmp/unite-probe.mjs`、`.sp-tmp/publish.mjs`、两次运行的日志 / JSON / 预览图）已删除；
  `fastServer` 子进程随 `srv.stop()` 退出，浏览器实例已 `close()`，端口释放。
- 保留的证据：`handoff/shots/unite-gate.json`（逐帧 phase/stage/字段/横条数 + 几何 + SHA）与 §6 的三张图。
- 无 git 写：没有 commit / checkout / stash；本单改动的 `public/js/ui/multiHud.js`、`public/css/screens/multi-hud.css`、
  `server/match/match/views.js`、`test/ui/multi-hud.test.js` 与本报告、`unite-gate.json` 都保持未提交状态。
- 注意：`public/js/ui/multiHud.js` 在本单开工期间被另一条并行会话改过一处（`Math.max(1, Math.floor(hp))` →
  `lpDisplay(hp)`，顶栏浮点那条单）。本单的改动与它不冲突（只动渲染门与联防文案），合并在同一工作区文件里。

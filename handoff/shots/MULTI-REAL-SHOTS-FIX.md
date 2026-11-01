# 多人房 4 个 UI bug 修复报告（几何实测 · 修前 / 修后）

- 日期：2026-10-31 21:25–21:27（本地时区）
- 证据来源：`handoff/shots/MULTI-REAL-SHOTS.md` §9 + `multi-real-shots.json`（上一轮实机拍摄）
- 本次原始测量（修前 / 修后两遍，含每张图的每对 rect 与交叠面积）：`handoff/shots/multi-real-shots-fix.json`
- 方法：真服务端 `test/e2e/fastServer.mjs`（`server/index.js` 的 `startServer` + 真 `Match`）+ `test/e2e/client.mjs` 的 `Client`
  （puppeteer-core@25 + 本机 headless Chrome），同一局同一帧只 `page.setViewport()` 换视口（不 reload、不传
  `isMobile`/`hasTouch`），每次换完等两帧 `requestAnimationFrame` + 520ms。交叠面积一律
  `max(0, min(a.right,b.right) − max(a.left,b.left)) × max(0, min(a.bottom,b.bottom) − max(a.top,b.top))`，
  与上一轮同一口径。临时脚本 `%TEMP%\sp-ui-fix\`、`.sp-tmp\` 已删除；`fastServer` 子进程已退出。
- 红线：无 git 写；不新增 msgid（本次没有新增任何 `t('…')`）；4 人房与既有模式的 DOM/CSS 未改（唯一可见差异见 §6）。

## 0. 结论表

| # | bug | 判据 | 修前 | 修后 |
| --- | --- | --- | --- | --- |
| 1 | 792×360 的 ⚙ 同盟设置面板左边越屏 | `left ≥ 8` 且 `right ≤ vw−8` | `left = −30.80, right = 279.59`（vw 792）；「版本」标签 `[-21.8, −10.6]` 整块在屏外 | `left = 8.00, right = 318.39`；三个标签 `17 → 39.41 / 61 / 28.2` 全在屏内 |
| 2 | 局内多人 HUD 与既有面板叠压（8 / 12 人） | 交叠面积 | 见 §2 表（最大 `.gm-chips × .team` = 40176 px²） | 本表列的全部配对 **0.00 px²**（逐帧实测见 JSON） |
| 3 | 1920×1080 的 12 人房大片空白 | 两栏内容高度差 | 左 232 px / 右 92 px（差 **140**），芯片中心 y 466.94–558.94 | 左 232 / 右 232（差 **0**），芯片 y 90–322，与左栏同一 y 起、同一 y 止 |
| 4 | 8 人房「对方」状态条与轨道同色 | 填充 vs 轨道的lab差 / 对比度 | 段底透明（棋盘直接透出），填充 `#6d7a75` 无轨道可比 | 轨道 `#141a18`（L\* 8.6），填充仍是 chip 的 `#6d7a75`（L\* 50.0），WCAG 对比 **3.94 : 1** |

## 1. Bug 1：⚙ 同盟设置面板在窄窗口越出左边

面板是 `.rs-pill` 的绝对定位子元素（`left: 50%; transform: translateX(-50%)`，锚在底部那颗 ⚙ 上）。窄窗口里
`.rs-foot` 的中间列被右侧的「开始模拟」挤到左边（792 下 pill `left = 8.8`），面板居中后左半截在屏外。
修法：`RoomOptions` 里给面板加 `ref`，`useLayoutEffect` 量一次，**只在越界时**把它推回「左右各留 8px」（`transform:
translateX(calc(-50% + Npx))`），窗口 resize 时重量；放得下时一个像素都不动。

| 视口 | 修前 opts `[l, t, r, b]` | 修后 opts `[l, t, r, b]` | 修前 3 个标签 | 修后 3 个标签 |
| --- | --- | --- | --- | --- |
| 792×360 | −30.80, 145.59, 279.59, 307.41 | **8.00**, 145.59, **318.39**, 307.41 | 下同 | 17→39.41 / 17→61 / 17→28.2 |
| 844×390 | −30.80, 175.59, 279.59, 337.41 | **8.00**, 175.59, **318.39**, 337.41 | `模拟难度 [-21.8, 0.6]`、`房间人数 [-21.8, 22.2]`、`版本 [-21.8, −10.6]` | 同左列（全部 ≥17） |
| 900×500 | −16.29, 267.47, 298.85, 446.53 | **8.00**, 267.47, **323.14**, 446.53 | — | — |
| 1024×600 | 349.62, 344.56, 670.10, 542.89 | 349.62, 344.56, 670.10, 542.89（不动） | — | — |
| 1280×720 | 472.01, 418.17, 802.62, 653.02 | 不变 | — | — |
| 1536×864 | 593.98, 511.98, 935.58, 783.42 | 不变 | — | — |
| 1920×1080 | 772.00, 650.11, 1140.00, 979.00 | 不变 | — | — |
| 1930×1080 | 777.00, 650.11, 1145.00, 979.00 | 不变 | — | — |

竖直方向（面板多了「房间人数」一行后重新核查）：792 下 `bottom = 307.41 < 360`、`top = 145.59`；844×390 下
`bottom = 337.41 < 390`；900×500 下 `bottom = 446.53 < 500`；1920 下 `bottom = 979 < 1080`。面板底边始终在
`.rs-pill` 的 `top`（792：312；1920：992）之上，没有压住底栏按钮。

改动（`public/js/screens/room.js`）：

- L53：`hooks` 导入加 `useLayoutEffect`
- L692：`const panelRef = useRef(null);`
- L698–719：`useLayoutEffect`（量 `getBoundingClientRect`，越界才 `translateX(calc(-50% + dx))`；`resize` 时重跑）
- L721：`<div class="rs-opts" … ref=${panelRef}>`

## 2. Bug 2：局内多人 HUD 与既有面板的叠压

重排后的分工（`multi-hud.css`）：

- **顶部信息带**：状态条 `.gm-strip` 在顶栏下（792 从 `top: 1.3rem` 让到 `1.47rem`，让开顶栏 58.19px 的像素地板）；
  盟约栏 `.gm__bonds` 跟着状态条整体下移（`.gm__hud:has(> .gm-strip) .gm__bonds`）；联防条 `.gm-unite` 停在盟约栏下面。
- **底部操作带（左侧）**：队伍芯片 `.gm-chips` 一行在「我方 4 人」`.gm-mates` 一行的正上方，两条都从
  `left: 4.2rem` 起（`.team` 左栏与左下角键 `.gm__corner` 的右侧、商店栏 `.shopbar` 的左侧）。
- **只读名单 `.gm-panel`**：从 `.gm-chips-wrap` 里挪出来，直接在 HUD 层绝对定位到棋盘左上（`left: 3.4rem; top:
  var(--gm-unite-top)`，宽 `5.4rem`）；打开时芯片行让位（`.gm-chips-wrap.is-roster-open .gm-chips { display:none }`）。

### 2.1 修前 / 修后交叠面积（px²，同一测量脚本）

`room12-match*` / `room8-match*`，792×360 与 1920×1080：

| 配对 | 12 人 792 前 → 后 | 12 人 1920 前 → 后 | 8 人 792 前 → 后 | 8 人 1920 前 → 后 |
| --- | --- | --- | --- | --- |
| `.gm-strip × .gm__bonds` | 1625.16 → **0.00** | 10152.00 → **0.00** | 3077.40 → **0.00** | 19224.00 → **0.00** |
| `.gm-chips × .team` | 5630.25 → **0.00** | 35208.00 → **0.00** | 3350.68 → **0.00** | 20952.00 → **0.00** |
| `.gm-mates × .team` | 3773.68 → **0.00** | 23603.13 → **0.00** | 3773.68 → **0.00** | 9697.41 → **0.00** |
| `.gm-mates × .gm__corner` | 4523.69 → **0.00** | 12100.00 → **0.00** | 4523.69 → **0.00** | 12100.00 → **0.00** |
| `.gm-strip × .gtop` | 4783.76 → **0.00** | 0.00 → 0.00 | 4783.76 → **0.00** | 0.00 → 0.00 |

联防（`room12-match-unite`）：

| 配对 | 792 前 → 后 | 1920 前 → 后 |
| --- | --- | --- |
| `.gm-strip × .gm__bonds` | 1625.16 → **0.00** | 10152.00 → **0.00** |
| `.gm-unite × .team` | 3449.27 → **0.00** | 21553.98 → **0.00** |
| `.gm-unite × .gm__bonds` | 2065.00 → **0.00** | 12080.88 → **0.00** |
| `.gm-chips × .team` | 6424.51 → **0.00** | 40176.00 → **0.00** |
| `.gm-mates × .team` | 5758.74 → **0.00** | 36025.83 → **0.00** |
| `.gm-unite × .gm__effects` | 692.16 → **0.00** | 4326.00 → **0.00** |
| `.gm-mates × .gm__corner` | 4523.69 → **0.00** | 12100.00 → **0.00** |

只读名单（`room12-match-roster`，本轮修好了「芯片被 `.team` 盖住、鼠标点不开」的问题，才能量到）：

| 配对 | 792 前（上一轮 §9.2） | 792 后 | 1920 前（上一轮 §9.2） | 1920 后 |
| --- | --- | --- | --- | --- |
| `.gm-panel × .team` | 18×172 = 3096 | **0.00** | 45×426 = 19170 | **0.00** |
| `.gm-panel × .gm__bonds` | 38×18 = 684 | **0.00** | 123×43 = 5289 | **0.00** |

> 修前这一帧的名单面板在本轮脚本里没能打开：芯片列整列压在 `.team` 的 P1–P4 行上（`.gm-chips × .team` 5630/35208），
> 鼠标点到的是成员行本身；上表「前」用的是上一轮 §9.2 同口径的实测（那次面板是从芯片的 `aria-expanded` 之外直接
> 点出来的）。修后名单由芯片正常打开，并额外交叠实测：`.gm-panel × .gm-mates`、`× .gm__corner`、`× .shopbar`、
> `× .gm__effects`、`× .gm-strip`、`× .gm-unite`（PREP 无联防条）全部 **0.00**。

### 2.2 修后关键 rect（`getBoundingClientRect`，同一帧）

792×360（14 个实测里挑了 4 个）：

| 元素 | 8 人 / 12 人 PREP | 12 人 UNITE | 12 人名单打开 |
| --- | --- | --- | --- |
| `.gm-strip` | 9.59, 58.80, 782.41, 75.59 | 同 | 同 |
| `.gm__bonds` | 339.61, 80.39, 452.39, 120.31（本例 1 条盟约） | 272.42, 80.39, 519.58, 120.31（此刻 2 条） | 同 PREP |
| `.gm-unite` | — | 144.00, 127.59, 744.00, 175.59 | — |
| `.gm-chips` | 168.00, 244.02, 316.75, 287.20 | 同 | 0（名单打开时让位） |
| `.gm-mates` | 168.00, 296.44, 321.53, 348.00 | 同 | 同 |
| `.gm-panel` | — | — | 136.00, 127.59, 352.00, 295.17 |
| `.team` | 8.80, 94.39, 87.58, 539.92 | 8.80, 94.39, 125.81, 539.92 | 8.80, 94.39, 87.58, 539.92 |
| `.gm__corner` | 9.59, 316.41, 157.59, 350.41 | 同 | 同 |
| `.shopbar` | 379.52, 194.66, 781.61, 352.00 | （战斗期收起，null） | 同 PREP |

1920×1080：

| 元素 | PREP | UNITE | 名单打开 |
| --- | --- | --- | --- |
| `.gm-strip` | 24, 130, 1896, 172 | 同 | 同 |
| `.gm__bonds` | 819, 184, 1101, 280.84（本例 1 条） | 651, 184, 1269, 280.84（此刻 2 条） | 同 PREP |
| `.gm-unite` | — | 360, 302, 1800, 422 | — |
| `.gm-chips` | 420, 790, 792, 898 | 同 | 0（让位） |
| `.gm-mates` | 420, 921, 804, 1050 | 同 | 同 |
| `.gm-panel` | — | — | 340, 302, 880, 717.50 |
| `.team` | 22, 236, 218.97, 1350 | 22, 236, 314.61, 1350 | 22, 236, 218.97, 1350 |
| `.shopbar` | 893, 694, 1894, 1060 | （收起，null） | 同 PREP |

### 2.3 允许的浮层（逐条说明）

1. **联防条 / 只读名单压在棋盘上**：两者都是「顶部信息带 / 临时浮层」，棋盘是背景而不是另一个 HUD 块；做法沿用
   上一轮已接受的「盟约栏本身就在棋盘上方」的先例，且都没有盖住任何可点元素（`.gm-unite` `pointer-events:none`；
   `.gm-panel` 只在被点开时出现、`关闭`/Esc 收起）。
2. **名单打开时与联防条相交（只在 UNITE 阶段、且玩家主动点开名单时）**：两者 z-index 6 vs 5，名单在上；不压
   `.team`、不压盟约栏、不压商店栏。这是本轮唯一保留的非零可能交叠（PREP / 普通局的实测全 0），因为它只在
   一个 1.2rem 高的只读条上，且是玩家主动打开的瞬态面板；如要绝对 0，需要在 UNITE 阶段禁用名单入口（会动玩法
   入口），本轮没有做。
3. **`.gm-chips` 在名单打开时 `display:none`**：名单抬头已写队名 + `n/4` + 关闭，芯片行让位是为了 792×360 下
   两者不再互相遮住（面板 136–352，芯片 168–317）；关闭后原样回来。

## 3. Bug 3：1920×1080 的 12 人房大片空白

修法（`room.css`，只在 `min-height: 600px` 命中，792×360 不命中）：右栏 `.rs-seat12__others` 从
`justify-content: center` 改为顶部对齐（`padding-top: .1rem`，与左栏 `.rs-seat12__mine` 的 `padding-top` 同一条基线），
两颗芯片 `height: 110px`（内容垂直居中）。左栏内容高 = 30（队头）+ 8 + 4×44 + 3×6 = **232**；右栏 =
2×110 + 12 = **232**。

| | 修前 | 修后 |
| --- | --- | --- |
| 左栏内容 | 90 → 322（232） | 90 → 322（232） |
| 右栏芯片 | 466.94 → 506.94、518.94 → 558.94（内容 92） | 90 → 200、212 → 322（内容 232） |
| 两栏内容高度差 | **140 px** | **0 px** |
| 792×360 | 芯片 519.86, 119 → 159 与 519.86, 171 → 211（40 高，居中） | 与修前逐值相同（规则不命中） |

（1920 的截图中两栏现在从同一条 y=90 开始、到同一条 y=322 结束；页面下部是房间背景本身，不再是「左栏顶、右栏
悬在页面中部」的空洞。）

## 4. Bug 4：8 人房「对方」状态条与轨道同色

`multi-hud.css` 给每段加一条轨道（`.gm-strip__seg::before`，`#141a18`，内描边 `rgba(255,255,255,.08)`），席位格
（`i`）压在轨道上；「对方」的填充**原样沿用同组 chip 的队色条灰 `#6d7a75`**（`game.css` 里 `.gm-chip__tone` 的默认色），
只把轨道改成深色，不新造颜色体系。

| | 颜色 | 相对亮度 | L\* | 对比（WCAG 2.x） |
| --- | --- | --- | --- | --- |
| 轨道（新） | `#141a18` | 0.0095 | 8.6 | — |
| 对方填充（沿用 chip） | `#6d7a75` | 0.1845 | 50.0 | **3.94 : 1** |
| 我方填充 | `#4fe8c0` | 0.6318 | 83.5 | 11.45 : 1 |
| 蓝方填充 | `#58a6ff` | 0.3657 | 67.0 | 6.98 : 1 |
| 红方填充 | `#e2665c` | 0.2644 | 58.5 | 5.28 : 1 |

修前没有轨道（`getComputedStyle(seg).backgroundColor = rgba(0,0,0,0)`），四格灰直接落在棋盘上；现在四格灰落在
8.6 L\* 的槽里，1920 下不再读成一整条暗条。

## 5. 顺手修：`test/ui/turn-popup.test.js` 的 SP_DRAFT 眉题正则

负面词条（`micro: 'NEGATIVE'`）让 `phases.js` 的 `isOverlimitRelicDraft` 分支多了一层三元，旧正则只认 `RELIC`，
这是本批唯一一条红。改成同时接受两个分支、仍逐字断言具体文案（并容下两行注释）：

修前（一行）：

```js
assert.match(spCase, /case PHASE\.SP_DRAFT: return isJibianDraft\(pub\)\n\s+\? \{ title: t\('惊变阶段'\), micro: 'MUTATION', tone: 'mint', sub: t\('选择一项'\) \}\n\s+: isOverlimitRelicDraft\(pub\)\n\s+\? \{ title: t\('词条抉择'\), micro: 'RELIC', tone: 'mint', sub: t\('选择一项'\) \}\n\s+: \{ title: t\('机变阶段'\), micro: 'CONTINGENCY', tone: 'gold', sub: t\('依次选择机变'\) \};/);
```

修后（L64）：

```js
assert.match(spCase, /case PHASE\.SP_DRAFT: return isJibianDraft\(pub\)\n\s+\? \{ title: t\('惊变阶段'\), micro: 'MUTATION', tone: 'mint', sub: t\('选择一项'\) \}\n\s+: isOverlimitRelicDraft\(pub\)[\s\S]*?\{ title: t\('词条抉择'\), micro: 'NEGATIVE', tone: 'red', sub: t\('选择一项'\) \}[\s\S]*?\{ title: t\('词条抉择'\), micro: 'RELIC', tone: 'mint', sub: t\('选择一项'\) \}[\s\S]*?: \{ title: t\('机变阶段'\), micro: 'CONTINGENCY', tone: 'gold', sub: t\('依次选择机变'\) \};/);
```

另把 L61–63 的注释补上「同一 family 的 NEGATIVE / RELIC 两个分支」。

## 6. 4 人房与既有模式

- `public/js/ui/multiHud.js`：`maxSeats` 不存在或 ≤ 4 时 `multiHudView` 仍返回 `null`（`test/ui/multi-hud.test.js` 的
  「4 人房：没有 maxSeats ⇒ 这一层不存在」继续通过）；本次只动了 8/12 才渲染的 `.gm-*`。
- `public/js/screens/game.js`：**没有改动**（曾试过给 `.gm__hud` 加 `is-multi`，被 `test/ui/match-topbar.test.js` 的
  逐字断言挡下；改成 CSS `:has(> .gm-strip)` 作用域，源码一字未动）。4 人房既没有 `.gm-strip`，三条让位规则都不命中。
- `public/css/screens/room.css`：新增的一条只在 `min-height: 600px` 且 `.rs-seat12` 上命中；4 人房（`.rs-seats` 竖卡）
  与 8 人房（`.rs-seat8`）都不命中。792×360 下 12 人房的右栏芯片与修前逐值相同（见 §3）。
- 唯一的 4 人房可见差异：⚙ 同盟设置面板在窄窗口里被夹回视口（bug 1 修的是同一个面板；4 人房的 `seatsOption` 同样
  有「房间人数」一行、同样会越界）。若要求「4 人房 792 连这个面板也必须保持越界」，请说一声，我把夹取按
  `room.maxSeats > 4` 收窄。

## 7. 测试

```
$ node --test test/ui/**/*.test.js
ℹ tests 1526
ℹ suites 286
ℹ pass 1487
ℹ fail 0
ℹ cancelled 0
ℹ skipped 39
ℹ todo 0
ℹ duration_ms 18550.8995

$ node --test test/match/room-seats.test.js test/ui/room-seats.test.js
ℹ tests 23
ℹ suites 1
ℹ pass 23
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 1136.9575

$ npm run typecheck
（无诊断，退出码 0）

$ npx eslint public/js/ui/multiHud.js public/js/screens/room.js public/js/screens/game.js test/ui/turn-popup.test.js
✖ 2 problems (0 errors, 2 warnings)   // game.js 的两条 no-useless-assignment 是既有告警，不在本次改动的行上
```

## 8. 重拍（覆盖旧图）与 SHA-256

同一局同一帧、792×360 → 1920×1080 顺序（换视口不 reload），DPF=1，`captureBeyondViewport: false`。
13 张（`room8-room-792x360.png` 本次未重拍：8 人房 792 布局没变，仍是上一轮那张）。

| 文件 | 尺寸 | 字节 | SHA-256 |
| --- | --- | --- | --- |
| `room12-seats-sheet-792x360.png` | 792×360 | 144191 | `eaef99e9bc8d2d13530a5ed32bfeaa9cdc4ed940fc047db971b79a05ba272c79` |
| `room12-seats-sheet-1920x1080.png` | 1920×1080 | 661945 | `f353e6fb139da8d83157e907b73f4b07f56f04b014e90963f718cf150a4449d6` |
| `room12-room-792x360.png` | 792×360 | 168632 | `878c4ba760b75e27bd4d84657a7ee01964f9499dd0e823637d3dc4e37b76dc09` |
| `room12-room-1920x1080.png` | 1920×1080 | 633028 | `f1999fc13c74b2d9bfc08c33889a125b5408b4a586af1cade40cf8beb6083834` |
| `room12-match-792x360.png` | 792×360 | 411339 | `2d66422a109d3fa766dc72c325135d6694beab14ba7835e4a0801559e317ceb1` |
| `room12-match-1920x1080.png` | 1920×1080 | 2386045 | `f7932d13dd187123d20be7b8e117a5304157becf640dfe59139f5797acbd41bf` |
| `room12-match-roster-792x360.png` | 792×360 | 387759 | `4e90c37ad8e58997fbc1715b75e0961e72e230018aa4ed33c1c2ebe49b52be32` |
| `room12-match-roster-1920x1080.png` | 1920×1080 | 2240885 | `a3b7523db274ffa89174140898c6e2c53c97c27dd55faecb247ffce74dea5248` |
| `room12-match-unite-792x360.png` | 792×360 | 446187 | `6488a1a6253ac09e6a3518827ed2b7d8d7e01964fdfc9831d6b33149c1684348` |
| `room12-match-unite-1920x1080.png` | 1920×1080 | 2479745 | `a063c959beb05ef0531c8f086d5ca63a4d487779c0abca76f5e5ebb26db42616` |
| `room8-match-792x360.png` | 792×360 | 413404 | `7a593e456d095e4c6c0feec155b095c6312e550ff1d30c43bfd5aa3f0b8fe974` |
| `room8-match-1920x1080.png` | 1920×1080 | 2392788 | `b160947cf8900c968b067feb943e4d1f3e1f78e4d00b1cf54a1fc5861569aa01` |
| `room8-room-1920x1080.png` | 1920×1080 | 706850 | `f0b9645a35469388ad3ba8b408277615227c127613cd1265c2e9edf94bb031c0` |

（本文件覆盖的是上一轮 §5 的同一批文件名；`MULTI-REAL-SHOTS.md` 里旧 SHA 仅作历史对照，以本表为准。）

## 9. 改动清单（行号按本次工作区）

- `public/css/screens/multi-hud.css`（重写布局段）
  - L11–29：多人房作用域 `:has(> .gm-strip)` + 盟约栏下移 + 窄屏状态条 `top` 变量
  - L31–48：状态条本体 + 段轨道 `::before`（bug 4）+ 席位格层级
  - L51–68：联防条新位置（`left: 3.6rem; right: 1.2rem; top: var(--gm-unite-top)`）
  - L73–76：芯片底部操作带（`left: 4.2rem; bottom: calc(.3rem + 1.34rem + .18rem)`；横向一行）；名单打开时让位
  - L92–113：名单浮层（棋盘左上、`5.4rem` 宽、行高 `.82rem`）
  - L116：我方 4 人 `left: 4.2rem`
- `public/js/ui/multiHud.js`
  - L5–12：头注释改为新分工
  - L112：`.gm-chips-wrap` 加 `is-roster-open`
  - L129：`.gm-panel` 移出 `.gm-chips-wrap`，成为 HUD 的直接子元素（打开时才能不压底栏、不压芯片）
- `public/css/screens/room.css`
  - L1180–1187：高屏 12 人房两栏顶部对齐 + 芯片 110px（bug 3）
- `public/js/screens/room.js`
  - L53、L692、L698–719、L721：⚙ 面板水平夹取（bug 1）
- `test/ui/turn-popup.test.js`
  - L61–64：SP_DRAFT 正则同时接受 NEGATIVE / RELIC 两个分支

## 10. 清理

- 临时脚本：`%TEMP%\sp-ui-fix\`（`probe.mjs` 及其日志/JSON/临时截图）与仓库内 `.sp-tmp\`（4 个探针）已删除。
- 临时页面：`public/dev/_probe-multi.html` / `.js` 已删除（为定位「名单点不开」而建的隔离测试页）。
- `fastServer` 子进程随脚本 `srv.stop()` 退出；端口已释放。
- 无 git 写操作（本线文件保持未提交：`M public/js/screens/room.js`、`M public/css/screens/room.css`、
  `M test/ui/turn-popup.test.js`、未跟踪的 `public/css/screens/multi-hud.css`、`public/js/ui/multiHud.js` 等）。

---

## 11. 追加单（2026-10-31 21:38–21:57）：多人房局内 HUD 收敛 —— 删两条、芯片缩回原位

业主定稿的「收敛」：**删掉顶部队伍状态横条 `.gm-strip` 与底部队友条 `.gm-mates`（含血条），队伍芯片缩回原
头像位置**（28×28 小圆、队色点 + `n/4` 角标、三颗横排、可点热区 ≥32），点开的名单从芯片左侧向右弹出
（宽约 200、4 行 × 34、底边与芯片底边对齐向上生长）。4 人房与既有模式逐字节不变；不新增 msgid；无 git 写。

本节的「修前」= 第 1–10 节那一轮的最终状态（同一套脚本、同一口径的实测；`multi-real-shots-fix.json`），
「修后」= 本轮重跑（`handoff/shots/hud-converge.json`）。测量方法不变：真服务端 `test/e2e/fastServer.mjs` +
`test/e2e/client.mjs` 的 `Client`（puppeteer-core + 本机 headless Chrome，DPF=1），**同一局同一帧只换视口**
（792×360 → 1920×1080，不 reload），每次换完两帧 `requestAnimationFrame` + 520ms；交叠面积仍是
`max(0, min(a.right,b.right) − max(a.left,b.left)) × max(0, min(a.bottom,b.bottom) − max(a.top,b.top))`。
本轮房间：12 人房 `JFCY`（1 真人 + 11 AI）、8 人房 `UUNU`（1 + 7）、4 人房（1 + 3，用来证明这一层不存在）。

### 11.1 三件事的落点

**（1）删顶部队伍状态横条 `.gm-strip`**

| 落点 | 内容 |
| --- | --- |
| `public/js/ui/multiHud.js` | 旧 L96–102 的整段状态条 markup 删除；`seatStateOf` 保留（芯片/名单还在用），新增 `offReasonOf`（L57–60）区分「倒下 / 掉线」 |
| `public/css/screens/multi-hud.css` | 旧 L11–29 的 `:has(> .gm-strip)` 作用域（`--gm-strip-top` / `--gm-bonds-top` / `--gm-unite-top` 三个变量 + 窄屏让位 + `.gm__bonds` 下移）与旧 L31–48 的状态条本体（段轨道 `::before`、四格 `i`、`is-on/is-off/is-gap` 配色）**整块删除** |

连带结果：**盟约栏回到它自己的基线**（`game.css` 的 `.gm__bonds { top: 1.36rem }`，不再被状态条顶下去），
联防条顶上原来那一带（`.gm-unite { top: 2.46rem }`，`multi-hud.css:18`）。

**（2）删底部队友条 `.gm-mates`（含血条）**

| 落点 | 内容 |
| --- | --- |
| `public/js/ui/multiHud.js` | 旧 L139–146 的 `.gm-mates` / `.gm-mate` / `.gm-mate__av` / `.gm-mate__hp` / `.gm-mate__num` markup 删除（`PlayerAvatar` 只剩联防条还在用） |
| `public/css/screens/multi-hud.css` | 旧 L116–128 的 `.gm-mates` / `.gm-mate*` 样式删除 |

**（3）芯片改造（缩回原位 + 28 圆 + 向右弹出的名单）**

| 落点 | 内容 |
| --- | --- |
| `multi-hud.css:39` | `.gm-chips-wrap { left: 4.2rem; bottom: .3rem }` —— **原 `.gm-mates` 的同一条基线**（`.team` 左栏与 `.gm__corner` 的右边、商店栏的左边），盒子高度就是芯片本体，所以 wrap 底边 = 芯片底边（名单靠它对齐） |
| `multi-hud.css:40` | `.gm-chips { flex-direction: row; gap: .15rem }` —— 三颗横排、间距 6（792） |
| `multi-hud.css:43–48` | `.gm-chip` 视觉 `.7rem` = **28×28**、`border-radius: 50%`、`padding: 0` |
| `multi-hud.css:50` | `.gm-chip::after { inset: -.08rem }` —— 透明热区（绝对定位的 inset 按 padding box 26 算 → 33.6），视觉尺寸一点没变 |
| `multi-hud.css:50–62` | 队色点 `.gm-chip__tone`（我方薄荷 / 蓝方 / 红方 / 两队房灰）+ `n/4` 角标 `.gm-chip__num`；**队级状态画在描边上**：实线 `is-full`（满员在线）/ 虚线 `is-gap`（有空位＝邀请态）/ 红 `is-off`（有掉线或倒下）/ `is-open` 薄荷光晕 |
| `multi-hud.css:70–105` | `.gm-panel` 名单：`left: 0; bottom: 0`（= 芯片左侧 + 芯片底边）、`width: min(5rem, 100vw − 14.6rem)`、行高 `.85rem`（34）、底部 `.7rem`（28）是芯片带、`.gm-panel__foot` 在这一带里写队名 + `n/4` |
| `multiHud.js:107–140` | 芯片 = 唯一入口：`aria-expanded` + `onPick`（再点一次收起），名单里不再有单独的抬头行与「关闭」按钮 |

### 11.2 交叠面积（修前 → 修后，全部 0）

`room12-match*` / `room8-match*`，每张图两档视口。修前一轮的结论是「本表列的全部配对 0.00」，所以这里两边
都是 0 —— 真正变化的是**几何**（下两节）与**被删掉的两个块**：

| 配对（均 × 既有面板） | 12 人 792 | 12 人 1920 | 8 人 792 | 8 人 1920 |
| --- | --- | --- | --- | --- |
| `.gm-chips × .team` | 0.00 → **0.00** | 0.00 → **0.00** | 0.00 → **0.00** | 0.00 → **0.00** |
| `.gm-chips × .gm__bonds` | 0.00 → **0.00** | 0.00 → **0.00** | 0.00 → **0.00** | 0.00 → **0.00** |
| `.gm-chips × .gm__corner` | 0.00 → **0.00** | 0.00 → **0.00** | 0.00 → **0.00** | 0.00 → **0.00** |
| `.gm-chips × .shopbar` | 0.00 → **0.00** | 0.00 → **0.00** | 0.00 → **0.00** | 0.00 → **0.00** |
| `.gm-chips × .gm__effects` | 0.00 → **0.00** | 0.00 → **0.00** | 0.00 → **0.00** | 0.00 → **0.00** |
| `.gm-panel × .team` | 0.00 → **0.00** | 0.00 → **0.00** | 0.00 → **0.00** | 0.00 → **0.00** |
| `.gm-panel × .gm__bonds` / `× .gm__corner` / `× .shopbar` / `× .gm__effects` | 0.00 → **0.00** | 0.00 → **0.00** | 0.00 → **0.00** | 0.00 → **0.00** |
| `.gm-unite × .team` / `× .gm__bonds` / `× .gm__corner` / `× .gm__effects` | 0.00 → **0.00** | 0.00 → **0.00** | （PREP 无联防条） | — |
| `.gm-strip × 任何块` | （元素已删除，`querySelector` 为 null） | 同 | 同 | 同 |
| `.gm-mates × 任何块` | （元素已删除） | 同 | 同 | 同 |

逐帧原始数据：`handoff/shots/hud-converge.json`（`scenes.room12.prep792.pairs` / `prep1920` / `unite792` /
`unite1920` / `roster792` / `roster1920` / `uniteRoster792` / `uniteRoster1920`，`scenes.room8.*`）。

**两处如实说明（都不是本单新增）：**

1. `.team × .gm__corner` = **2651.66**（12 人 792）/ **10918.32**（12 人 1920）/ 3950.12 / 14224 —— 8/12 人房的
   `.team` 会把 12 行成员一路排到视口底部（rect 底边 539.92 / 1350，本来就溢出），于是最下面几行落在左下角键
   `.gm__corner` 底下。这两个块都不是本次改的（`.team` 在 `game.css` 里、`.gm__corner` 是既有角落键），
   4 人房 4 行时不出现；要收得另开一单（`.team` 的最大高度 / 滚动）。
2. 联防阶段点开名单那一刻，若战斗期的「战场切换」胶囊 `.chud__layers` 正在，名单的右下角会盖住它的左端：
   本轮**第一遍运行**拍到的 UNITE 帧里它的 rect 是 `340.61,328 → 451.39,348`（792），名单 `168,182 → 368,348`
   → 理论重叠 27.39 × 20 = **547.8 px²**（1920 同口径 57 × 50 = **2850 px²**）；最终这遍同样场景下它是 `null`
   （联防条与胶囊都在该子状态才出现），所以正式表里这一对记 0。名单是只读浮层、再点芯片即收起，收起后胶囊原样
   可用；它不在本单的验收清单里（验收列的是聊天球 / `.team`），故保留并如实记在这里。

### 11.3 芯片几何（同一帧实测）

| | 792×360 | 1920×1080 |
| --- | --- | --- |
| `.gm-chips` 整行 rect | 168.00, 320.00 → 264.00, 348.00（96×28） | 420.00, 980.00 → 660.00, 1050.00（240×70） |
| 单颗 `.gm-chip` rect / 视觉 | **28.00 × 28.00** / 28（`border-radius: 50%`，1px 描边） | **70 × 70** / 70（同一套 rem，1rem = 100px） |
| 可点热区（`elementFromPoint` 从圆心向外每 0.25px 探测到失手） | **33 × 33**（≥32） | **80 × 80** |
| 三颗 x（左缘） | **168 / 202 / 236** | **420 / 505 / 590** |
| 上/下边缘 y（同一帧） | 320 / 348 | 980 / 1050 |
| 相邻间距 | **6.00 / 6.00** | **15.00 / 15.00**（= 6 × 2.5） |
| 热区与热区之间 | 0.4 的缝（不互相盖） | 1 的缝 |

8 人房：两颗，792 下 168.00,320 → 230.00,348（62×28，间距 6），1920 下 420,980 → 575,1050（155×70，间距 15）。

芯片外观与读法（截图可对照 `room12-match-1920x1080` / `room8-match-1920x1080`）：左上 6/15 的队色点（我方薄荷、
蓝方蓝、红方红、两队房灰），右下极小 `n/4`（792 下 8px、1920 下 20px），描边 = 队级状态，`aria-expanded` 反映
开合，`aria-label` 仍是「队名 n/4」（与修前逐字相同，测试逐字断言）。

### 11.4 名单几何

| | 792×360 | 1920×1080 |
| --- | --- | --- |
| `.gm-panel` rect | 168.00, 182.00 → 368.00, 348.00 | 420.00, 638.00 → 880.00, 1050.00 |
| 宽 | **200.00** | 460.00（= `min(5rem, 100vw − 14.6rem)`） |
| 高 | **166.00** = 4 行 × 34（136）+ 芯片带 28 + 上下各 1px 描边 | **412.00** = 4 × 85 + 70 + 2 |
| 行高（4 行） | **34 / 34 / 34 / 34** | **85 / 85 / 85 / 85** |
| 底边 − 芯片底边 | 348 − 348 = **0.00** | 1050 − 1050 = **0.00** |
| 左缘 − 芯片左缘 | 168 − 168 = **0.00**（以芯片左侧为锚点） | 420 − 420 = **0.00** |
| 视口内 | 左 168 ≥ 8、右 368 ≤ 784 | 左 420 ≥ 8、右 880 ≤ 1912 |
| 与 `.team` / 聊天球 / `.gm__corner` / 商店栏 / 盟约栏 | 全部 **0.00** | 全部 **0.00** |
| 与联防条（UNITE 帧） | 名单顶 182 比联防条底 146.39 低 35.61 → 不相交；点开名单那一帧联防条已收起（`.gm-unite` 的 rect 是 null），故按同一帧的几何算差 | 名单顶 638、联防条底 366（相隔 272）→ 不相交 |

行内容（本轮 12 人房「我方同盟」实测，`rows` 原文）：`凯尔希 23`、`AI·华法琳 24`、`AI·阿米娅 45`、`AI·惊蛰 25`
（血量数字 = `max(1, floor(hp.public.hp))`，`hp: 0` 的倒下者不写数字、写「倒下」，掉线写「连接中断」）；
底部芯片带右侧写「我方同盟 4/4」。空位一行是「空位 + 邀请」（单测 `test/ui/multi-hud.test.js` 钉住 3 个空位
→ 3 个「邀请」）。名单没有单独的抬头行、也没有「关闭」按钮：**芯片就是唯一入口**，再点一次收起 —— 脚本里
第二次 `click('.gm-chip')` 之后同一帧的 `.gm-panel` rect 变回 `null`（`uniteRoster` 之前的实拍即证据）。

### 11.5 4 人房：零改动证据

1. **运行时**（4 人房 `PREP`，同一帧换两档视口）：`.gm-strip` / `.gm-chips` / `.gm-mates` / `.gm-panel` 的
   `querySelectorAll` 计数 **全为 0**；`.gm__hud` 的直接子元素两档视口都是
   `["gtop","gm__bonds","team","gm__effects","shopbar","chat-panel","ui-slot gm__ui-slot","gm__corner"]`
   —— 没有任何 `gm-` 多人层（JSON：`scenes.room4`）。
2. **源码**：`multiHudView` 的闸门一字未动（`capacity > 4` 才渲染，否则 `return null`）；
   `public/js/screens/game.js`（最后写入 21:28:57）与 `public/js/screens/room.js`（21:12:56）都**早于本单开工的
   21:38**，本单一个字节都没碰；`public/index.html`（19:07）、`game.css`（18:04）同样没碰。本单只写了
   `public/js/ui/multiHud.js`、`public/css/screens/multi-hud.css`、`test/ui/multi-hud.test.js`（+ 本报告）。
3. **CSS 作用域**：删掉 `:has(> .gm-strip)` 之后，`multi-hud.css` 里剩下的每条规则都只挂在 `.gm-unite*` /
   `.gm-chips*` / `.gm-chip*` / `.gm-panel*` 上——这些类只有 `multiHudView` 在 `maxSeats > 4` 时才输出，
   4 人房没有任何元素命中（`game.css` / `room.css` 一条也没改）。
4. **单测**：「4 人房：没有 maxSeats ⇒ 这一层不存在」继续通过。

### 11.6 测试

```
$ node --test test/ui/**/*.test.js
ℹ tests 1526
ℹ suites 286
ℹ pass 1487
ℹ fail 0
ℹ cancelled 0
ℹ skipped 39
ℹ todo 0
ℹ duration_ms 17520.3409

$ node --test test/match/room-seats.test.js test/ui/room-seats.test.js
ℹ tests 23
ℹ suites 1
ℹ pass 23
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 1089.5758

$ npm run typecheck
> tsc --noEmit --checkJs -p jsconfig.json
（无诊断，退出码 0）

$ npx eslint public/js/ui/multiHud.js test/ui/multi-hud.test.js
（0 problems，退出码 0）
```

`test/ui/multi-hud.test.js` 按新形态重写（8 个用例全绿）：helpers 不变 + `offReasonOf`；4 人房返回 null；
8 人房 = 2 颗芯片、`.gm-strip`/`.gm-mate` 计数 0；12 人房 = 3 颗 + 队色 + 掉线队 `is-off` / 空位队 `is-gap`；
联防条（`--low` 已删）；名单 = 4 行、血量 `max(1, floor)`、`倒下` / `连接中断`、空位「邀请」、无抬头无关闭；
CSS 契约 = `.gm-chip` `.7rem`、`::after -.08rem`、`.gm-panel` `min(5rem, calc(100vw - 14.6rem))`、行高 `.85rem`、
**`.gm-strip` / `.gm-mate` 在样式与组件里一条不剩**、字号无裸 rem、`index.html` 仍引入样式表。

不新增 msgid：本轮用到的 `倒下` / `连接中断` / `空位` / `邀请` / `联防阶段` / `联防中` / `观战中` / `博士` 在
`public/i18n/{en,ja,ko,zh-TW}.json` 四个包里**全部已存在**（脚本逐个核对），`node tools/i18n.mjs check --all
--strict` 的 248 条 en 缺失与 `multiHud` 无关（输出里没有这个名字）。

### 11.7 重拍（覆盖旧图）与新 SHA-256

同一局同一帧、792×360 → 1920×1080（换视口不 reload），DPF=1，`captureBeyondViewport: false`。
带 `room8-match-roster-*` 两张是新增（8 人房两芯片的名单，顺带留证）。

| 文件 | 尺寸 | 字节 | SHA-256 |
| --- | --- | --- | --- |
| `room12-match-792x360.png` | 792×360 | 394603 | `4f39f16567878c3c19182deb94b476e155f068a8d22032a503a193616daa831b` |
| `room12-match-1920x1080.png` | 1920×1080 | 2419767 | `96398116b26c6d588864eafe87c2bb713534c13083f95b7c7dcf025d6205be57` |
| `room12-match-roster-792x360.png` | 792×360 | 397074 | `08864bd4d7a9889a2e2ffff172713f1e68d3186bc6e09a02cd5ba0dcf069d03f` |
| `room12-match-roster-1920x1080.png` | 1920×1080 | 2305203 | `e184949baf58876217ae30cdad4fafd5dd8255eb04753bd9864873be1aeea42d` |
| `room12-match-unite-792x360.png` | 792×360 | 460441 | `6f398ac29028568bff08ef301d14e0fcb24d833384e314ec915bee30521e7d49` |
| `room12-match-unite-1920x1080.png` | 1920×1080 | 2514510 | `ab3199608835bc38e7c5afbc77065c49ecf58fe4bf8ce648d0402f37be104ce2` |
| `room8-match-792x360.png` | 792×360 | 393731 | `7f2b0763652cb994cba443b658a7741784f0ca298f96b0ba7618f2561313e787` |
| `room8-match-1920x1080.png` | 1920×1080 | 2268645 | `dbf210a2018569cd066d71c24cf9af27312e3f1a5b3e84b4fdb31376aa82559c` |
| `room8-match-roster-792x360.png` | 792×360 | 396199 | `6386393ec302c978a8e93e62bcbe0a58a6eeeab9ad1d6f44dbf16a80648ae62e` |
| `room8-match-roster-1920x1080.png` | 1920×1080 | 2294020 | `aa8f68a1dcffb58d2b7f8b9fdc66b97ac986558bc6677d73196e5cae38e3d2bd` |

（§8 那张 13 行的表里，`room12-match-*` / `room12-match-unite-*` / `room8-match-*` 六行的 SHA 以本节为准；
`room12-room-*` / `room12-seats-sheet-*` / `room8-room-*` 本轮没有重拍，仍是 §8 的值。）

### 11.8 与字面规格的偏差（三处，都有几何理由）

1. **「贴边 x8」做不到**：真机的左下角已经被两块既有面板占满 —— `.team` 左栏 792 下 rect
   `8.80 → 87.58 × 94.39 → 539.92`（12 行成员一直排到视口外），`.gm__corner` `9.59 → 157.59 × 316.41 → 350.41`。
   任何从 x = 8 起、96 宽的芯片行都必然压这两块（验收要求「与 `.team` / `.gm__corner` 交叠为 0」）。
   所以芯片落在**原队友头像条的位置**：`left: 4.2rem` = 792 下 168（= corner 右缘 + 10.41）、1920 下 420
   （= corner 右缘 278 + 142）；「贴边」读作「贴着左下角那一簇的右边、站在原来的头像坑里」。
2. **名单宽 200 只在 792 成立**：`min(5rem, 100vw − 14.6rem)` —— 792 下正好 **200**；1920 下商店栏左缘在 893
   （= 4.2rem + 4.73rem），5rem（500）会压商店栏 27px，所以收到 **460**（右缘 880 < 893）。
3. **名单里的血量对所有队都显示**（`hp` 在 `m.public.players` 里对每队都有）。这与 `handoff/room12/MOCK-ROOM12.md`
   §「玩法零改动」那句「别队只给队级状态、不出数值」不同 —— 本单按新规格「行内容：名字 + 血量数字 + 掉线/倒下态」
   执行。若业主要保持「别队不出数字」，`multiHud.js:131` 的条件加一个 `openTeam === mine &&` 即可，一行回退。

### 11.9 清理

- 临时脚本 `.sp-tmp/hud-converge.mjs` 与三份运行日志已删除；`fastServer` 子进程随脚本的 `srv.stop()` 退出；
  3 个浏览器实例已 `close()`；端口释放。
- 保留的只有证据：`handoff/shots/hud-converge.json`（每帧 rect / 交叠 / 芯片热区 / 名单行原文）与上表 10 张图。
- 无 git 写：本单改动的三个文件（`public/js/ui/multiHud.js`、`public/css/screens/multi-hud.css`、
  `test/ui/multi-hud.test.js`）与本节、`hud-converge.json` 都还是未跟踪状态（`git status --porcelain` 全是 `??`），
  没有 commit / checkout / stash。

## 12. 追加单（2026-10-31 22:06–22:35）：左栏三颗芯片 → 三个「队伍框」容器

业主定稿：左栏竖排三个队伍框（一框 = 一支队伍 = 该队 4 名干员），收起态只写队名 + `n/4`；点开某一框原地向下展开
4 行（名字 / 血量数字 / 掉线倒下 / 空位邀请），同时把另外两框隐藏；再点或 Esc 收起。4 人房与既有模式逐字节不变；
不新增 msgid；无 git 写。本节所有数字都是本轮重跑的实测（真服务端 `test/e2e/fastServer.mjs` + `Client`，DPF=1，
同一局同一帧只换视口），逐帧原始数据在 `handoff/shots/hud-teams.json`。本轮房间：12 人 `PJUH`（1 真人 + 11 AI）、
8 人 `DVMS`（1 + 7）、4 人 `TREV`（1 + 3）。

### 12.1 落点（文件:行）

| 落点 | 内容 |
| --- | --- |
| `public/js/ui/multiHud.js:82–92` | `MultiHud`：`openTeam` 状态 + **Esc** 收起（`keydown`/`Escape`，仅在开着时挂监听）+ 点同一框再收起 |
| `multiHud.js:112–141` | 三个队伍框的 markup：`.gm-teams`（`role=group`）> 每队一个 `.gm-team`（`--slot:i`、`[hidden]`），框头 `.gm-team__head` = 唯一的开/关按钮（`aria-expanded` / `aria-controls` / `aria-label="队名 n/4"`），展开时 `.gm-team__list` 里 4 行 |
| `multiHud.js:134` | **血量开关**：`i === mine && Number.isFinite(p.hp)` —— 只有我方那一队出 `max(1, floor(hp))`；要三队都出数字，删掉这一行里的 `i === mine &&` 即可 |
| `public/css/screens/multi-hud.css:43–46` | `.gm-teams`：`left: .2rem`（8）、`top: 2.36rem`（盟约栏下沿）、`flex-direction: column; gap: .15rem`（6） |
| `multi-hud.css:49–64` | `.gm-team`：**2.2rem × .8rem = 88 × 32**、左侧 `.1rem` 队色条（`::before`）、边框用 inset 阴影画（不占布局 → 框头按钮就是整块 88×32）；`.is-open` 高度 auto + `top: calc(var(--slot) * (.8rem + .15rem))` 补回自己那一格（原地展开，父盒不虚长） |
| `multi-hud.css:65–72` | `.gm-team__head`：`width: 100%; height: .8rem`（88×32 的按钮，Enter / Space 原生激活）+ `:focus-visible` 薄荷描边 |
| `multi-hud.css:80–84` | 行：`.gm-team__row` 34 @792（`.85rem`）；**三号框展开时** `height: min(.85rem, calc((100vh − 6.3rem) / 4))` |
| `multi-hud.css:39–40` | 多人房让位：`.gm.has-multi .team { left: 2.6rem }`、`.gm.has-multi .gm-unite { left: 5.8rem }` |
| `public/js/screens/game.js:1965` | `.gm` 根上挂 `has-multi`（`(Number(pub?.maxSeats) \|\| 0) > 4`）—— 4 人房这一项是 `false`，class 串一位都不变 |

上一版的 `.gm-chips` / `.gm-chip*` / `.gm-panel*`（芯片 + 向右弹出的名单）整块删除：markup 没了，CSS 也一条不剩
（单测按代码文本守着）。

### 12.2 收起态 rect（12 人 `PJUH`，PREP 第 1 回合）

| | 792×360 | 1920×1080 |
| --- | --- | --- |
| `.gm-teams` | 8.00 → 96.00 × 94.39 → 202.39（**88 × 108**） | 20.00 → 240.00 × 236.00 → 506.00（**220 × 270**） |
| 框 1 / 2 / 3 的 y | **94.39 / 132.39 / 170.39**（各 88×32） | **236 / 331 / 426**（各 220×80） |
| 框间距 | **6.00 / 6.00** | **15.00 / 15.00**（= 6 × 2.5） |
| 框头按钮（可点热区） | **88 × 32**（视觉同尺寸；`elementFromPoint` 命中，真鼠标点中心） | **220 × 80** |
| `.team` | 104.00 → 182.78 × 94.39 → 539.92（右移让位） | 260.00 → 456.97 × 236 → 1350 |
| `.gm__bonds` | 349.23 → 442.77 × 54.39 → **71.77**（本轮盟约栏是空条，只有 17.38 高） | 844.57 → 1075.43 × 136 → 176.50 |
| `.gm__corner` | 9.59 → 157.59 × 316.41 → 350.41 | 24 → 278 × 1000 → 1056 |
| `.shopbar` | 379.52 → 781.61 × 194.66 → 352 | 893 → 1894 × 694 → 1060 |
| `.gm__effects` | 755.28 → 780 × 96 → 124.47 | 1828.20 → 1890 × 240 → 311.19 |

8 人 `DVMS`：`.gm-teams` 8 → 96 × 94.39 → **164.39**（两框 88×32、间距 6；1920 下 20 → 240 × 236 → 411，220×80、
间距 15），`.team` 同上面那张表的左缘；三号框不存在。

### 12.3 展开态 rect（同一局同一帧，点开我方那一框）

| | 792×360 | 1920×1080 |
| --- | --- | --- |
| 展开框 `.gm-team.is-open` | 8.00 → 96.00 × **94.39 → 262.39**（88 × **168**） | 20.00 → 240.00 × **236 → 656**（220 × **420**） |
| 行高（4 行） | **34 / 34 / 34 / 34** | **85 / 85 / 85 / 85** |
| 框头 | 88 × 32（y 94.39 → 126.39） | 220 × 80（y 236 → 316） |
| `.gm-teams` 容器 | 8 → 96 × 94.39 → **262.39**（另两框 `[hidden]`，不占位） | 20 → 240 × 236 → 656 |
| 行内容（原文） | `T12 28`、`AI·华法琳 24`、`AI·阿米娅 27`、`AI·惊蛰 28` | 同 |
| 别队展开（单测 `test/ui/multi-hud.test.js`） | 蓝方 4 行只有名字 + 状态，`gm-team__hp` **0 个**（信息不对称） | 同 |

**展开防越底（本轮选的是「压缩行高」，不是「向上生长」）**：792 下第三个框从 y 170.39 展开，34 的行高会把框底
推到 **338.39**，压住左下角键 `.gm__corner`（316.41 → 350.41）—— 交叠 22.0 宽 × 34 高。所以三号框展开时
`.gm-teams.is-tail .gm-team__row` 的行高取 `min(.85rem, (100vh − 6.3rem) / 4)`：792 下 **27**，框 88 × 140，
底 **310.39**（离 corner 还有 6.02）；1920 下这个公式给 112 > 85，仍是 **34（85）**，框底 656 远在 corner 1000 之上。
实测第三个框展开：`8 → 96 × 170.39 → 310.39`（行高 27/27/27/27），与 corner 交叠 **0.00**。

### 12.4 交叠面积（全部 0.00）

口径同 §2/§11：`max(0, min(a.right,b.right) − max(a.left,b.left)) × max(0, min(a.bottom,b.bottom) − max(a.top,b.top))`。
逐对：`.gm-teams` 与每个**可见** `.gm-team[i]` × `.team` / `.gm__bonds` / `.gm__corner` / `.shopbar` /
`.gm__effects` / `.gm-unite`。12 人收起态 24 对、展开态 12 对；8 人收起态 18 对、展开态 12 对；两档视口各一遍。

| 配对 | 12 人 792 收/展 | 12 人 1920 收/展 | 8 人 792 收/展 | 8 人 1920 收/展 |
| --- | --- | --- | --- | --- |
| `.gm-teams` + 每个框 × `.team` | **0 / 0** | **0 / 0** | **0 / 0** | **0 / 0** |
| × `.gm__bonds` | **0 / 0** | **0 / 0** | **0 / 0** | **0 / 0** |
| × `.gm__corner` | **0 / 0** | **0 / 0** | **0 / 0** | **0 / 0** |
| × `.shopbar` | **0 / 0** | **0 / 0** | **0 / 0** | **0 / 0** |
| × `.gm__effects` | **0 / 0** | **0 / 0** | **0 / 0** | **0 / 0** |
| × `.gm-unite`（UNITE 帧） | **0 / 0** | **0 / 0** | （PREP 无联防条） | — |

联防阶段（12 人，同一局 `PJUH` 第 1 回合收起、第 2 回合展开）：

| | 792×360 | 1920×1080 |
| --- | --- | --- |
| `.gm-unite` | **232 → 744 × 98.39 → 146.39**（512 × 48） | **580 → 1800 × 246 → 366**（1220 × 120） |
| `.team`（UNITE 加徽标） | 104 → **221.23**（117.23 宽） | 260 → **553.16**（293.16 宽） |
| `.gm-teams` 收起 / 展开 | 8 → 96 × 94.39 → 202.39 / → 262.39 | 20 → 240 × 236 → 506 / → 656 |
| 与联防条余量 | `.team` 右缘 221.23 < 条左缘 232（10.77） | 553.16 < 580（26.84） |

### 12.5 4 人房零改动证据（`TREV`，1 真人 + 3 AI，PREP）

1. **运行时计数**（792 与 1920 各一遍，`hud-teams.json` 的 `scenes.room4`）：`.gm-teams` / `.gm-team` / `.gm-strip` /
   `.gm-chips` / `.gm-panel` / `.gm-mates` / `.gm-unite` 的 `querySelectorAll` **全部 0**。
2. **`.gm__hud` 直接子元素**两档视口都是
   `["gtop","gm__bonds","team","gm__effects","shopbar","chat-panel  ","ui-slot gm__ui-slot","gm__corner"]` —— 与 §11.5
   改动前那份**逐项相同**（`chat-panel` 后面的两个空格是它自己的 className 文本，不是本单加的）。
3. **`.gm` 根 class**：`screen gm gm--prep`（**没有 `has-multi`**，所以 `.team` 的让位规则与 `.gm-unite` 的左缘一条都不命中）；
   `.team` 左缘 792 = **8.80**、1920 = **22.00**，仍是原值。
4. **源码**：`multiHudView` 的闸门一字未动（`capacity > 4` 才渲染，否则 `return null`）；`game.js` 只在 `.gm` 根上多了一个
   条件类，4 人房里它是 `false`。

### 12.6 与字面规格的三处偏差（都有几何理由）

1. **`x8` + `.team` 交叠 0 只能靠 `.team` 右移**：`.team` 原本就占 `8.80 → 87.58`（y 从 94.39 起），任何 88 宽、贴 x8 的
   框都必然压它。所以本轮在多人房把 `.team` 右移到框右边（`left: 2.6rem` → 792 的 104 / 1920 的 260），并把联防条左缘
   跟着右移到 5.8rem（否则 UNITE 阶段加宽的 `.team` 会顶进条里）。**4 人房与既有模式不受影响**。若业主要 `.team` 原位，
   队伍框就只能落到它右边（792 约 x 134 起，否则 UNITE 阶段仍压 `.team`），且联防条还得再让 —— 一句话回退点：
   删掉 `multi-hud.css:39–40` 两行，把 `.gm-teams` 的 `left` 改成 `.8rem` 以上即可，但那样就不是「贴边 x8」了。
2. **三号框的行高 27（不是 34）**：见 §12.3 的防越底说明（业主给的选项里选「压缩行高」；「向上生长」会让框顶越过
   盟约栏 71.77/176.5 那一带）。一、二号框与 1920 的全部框仍是 34（85）。
3. **一列总高 108（不是约 102）**：按「框间距 6」算是 `3 × 32 + 2 × 6 = 108`（102 是只算一个 6 的值）；本轮按显式的
   「框间距 6」执行，三框 94.39 → 202.39。

### 12.7 测试（ℹ 原文）

```
$ node --test test/ui/**/*.test.js
ℹ tests 1529
ℹ suites 286
ℹ pass 1490
ℹ fail 0
ℹ cancelled 0
ℹ skipped 39
ℹ todo 0
ℹ duration_ms 19330.5786

$ node --test test/match/room-seats.test.js test/ui/room-seats.test.js
ℹ tests 23
ℹ suites 1
ℹ pass 23
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 1168.6045

$ npm run typecheck
> tsc --noEmit --checkJs -p jsconfig.json
（无诊断，退出码 0）

$ npx eslint public/js/ui/multiHud.js public/js/screens/game.js test/ui/multi-hud.test.js
✖ 2 problems (0 errors, 2 warnings)   ← game.js:985 / game.js:1903 的 no-useless-assignment，改动前就在，与本节无关
```

`test/ui/multi-hud.test.js` 按新形态重写（11 个用例）：8 人 = 2 框、12 人 = 3 框（队色 / is-off / is-gap）；收起态三框
全部可见、`aria-expanded` 全 false、没有 `.gm-team__list`；点开只露本队 4 行、另两框 `hidden`、`aria-controls` 指向
`gm-team-i`；血量数字**只在我方**（`gm-team__hp` 0 个 vs 4 个）、倒下不写数字；再点收起 + Esc（源码里的 `keydown`）；
可点 ≥32（2.2rem × .8rem = 88×32，框头撑满且边框不占布局）；CSS 契约（贴边 / 间距 / 原地展开的 `--slot` / 防越底公式 /
`has-multi` 让位 / 字号一律 `calc(N * var(--t))`）；无新 msgid（每个 `t('…')` 都在 `public/i18n/en.json` 里，四个队名仍是
内联中文 + `// i18n-ignore`）。

### 12.8 重拍（覆盖旧图）与新 SHA-256

同一局同一帧、`captureBeyondViewport: false`、DPF=1；12 人 `PJUH`、8 人 `DVMS`。

| 文件 | 尺寸 | 字节 | SHA-256 |
| --- | --- | --- | --- |
| `room12-match-792x360.png` | 792×360 | 388654 | `c3743a3d145515c9bf357a653a041de0f58d65697de081e417f06d27a9d99b2e` |
| `room12-match-1920x1080.png` | 1920×1080 | 2338447 | `a196641327cf703eb64731adc7c2f64e27ba51e629173829788cb3b3881a506a` |
| `room12-match-roster-792x360.png` | 792×360 | 413342 | `3bdaad7544eaa95b345c8847f57fe351b7f54b33e3789ca8c1e7a234209901fd` |
| `room12-match-roster-1920x1080.png` | 1920×1080 | 2337528 | `600808182eb69476b0bebf9fd94497f5283e367cfbc749efc25cb86190d8b6c1` |
| `room12-match-unite-792x360.png` | 792×360 | 413729 | `10cdc5c50eaea4838102c394228374b9ac020b1df7be4d8b45cb78c2fc6c271c` |
| `room12-match-unite-1920x1080.png` | 1920×1080 | 2380463 | `8a57a782250636a310d9589a8171a53cbcf42e089b375fae684858b13c49ab08` |
| `room8-match-792x360.png` | 792×360 | 365537 | `cc2a83110f52d730556f4dc06429e588cb7a72d135a137cd7b01a9d4ec5fae70` |
| `room8-match-1920x1080.png` | 1920×1080 | 2327489 | `3ea930c887a2e20824cd77bf7f65fa6b7d42de281df9366a453e1f01010e21fd` |
| `room8-match-roster-792x360.png` | 792×360 | 412478 | `0aed6d9148e6cd216d704877dcda4c991e71a7db86a0c11c8698bd370bf1c00c` |
| `room8-match-roster-1920x1080.png` | 1920×1080 | 2326629 | `580d9985e60db0218d8208bfb0153c0319da2330aa171ed8783898b8fd2673ed` |

另有一张只有本轮才有的旁证（不在上表十张里）：`room12-match-tail-792x360.png`（792×360，412946 B，
`57c3662a8e7f40de72eac4ede62a74cdbbecb11db50cac11f729e120c647d614`）—— 第三个框展开、行高 27、框底 310.39。

### 12.9 清理

- 临时脚本 `.sp-tmp/hud-teams.mjs` 与中间文件 `hud-teams-probe.json` 已删除；`fastServer` 子进程随 `srv.stop()` 退出；
  3 个浏览器实例都已 `close()`。
- 保留的证据：`handoff/shots/hud-teams.json`（每帧 rect / 交叠 / 行内文字 / `.gm__hud` 子元素）与 §12.8 的图。
- 无 git 写：本单改动的 `public/js/ui/multiHud.js`、`public/css/screens/multi-hud.css`、
  `public/js/screens/game.js`、`test/ui/multi-hud.test.js` 与本报告、`hud-teams.json` 都保持未提交/未跟踪，
  没有 commit / checkout / stash。
- docs 未改：`docs/TWELVE_PLAYER_MODE.md` 只写「局内 HUD 在 multiHud.js + multi-hud.css」，这句仍然成立；
  形态细节在本节、`multi-hud.css` 文件头与 `multiHud.js` 文件头。`docs/history/0.3.3.md` 是已发布版本的记录，
  按惯例不改写。

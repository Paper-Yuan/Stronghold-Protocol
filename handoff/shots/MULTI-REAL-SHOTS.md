# 8 / 12 人房全套实机图（真服务端 + puppeteer）

- 拍摄时间：2026-10-31 20:49–20:51（本地时区，日志见 §4 的时间戳）
- 服务端：`test/e2e/fastServer.mjs`（= `server/index.js` 的 `startServer` + 真 `Match`，只加了既有测试钩子）
- 浏览器：`puppeteer-core@25` + 本机 Chrome（`C:\Users\J1825\AppData\Local\Google\Chrome\Application\chrome.exe`），headless
- 产物：14 张 PNG，全部写在 `handoff/shots/`；源码零改动、无 git 写操作；临时脚本与本地服务端已清理（§10）

## 1. 结论速览

| 项 | 结果 |
| --- | --- |
| 截图 | 14 张（6 组必需 + 1 组额外的只读名单），每组都是同一局同一帧的 792×360 与 1920×1080 |
| `scroll == client` | **14/14 通过**（`documentElement.scrollWidth/Height === clientWidth/Height`，`body` 同值） |
| 页级溢出 | **14/14 为 0**（没有元素的盒子在「非 overflow 容器」里越出视口） |
| 控制台错误 | **0**（console.error 0 / pageerror 0 / requestfailed 0 / HTTP≥400 0，两个客户端各 0） |
| 座位 | 每个房间 **1 个真人（房主 `凯尔希`）+ 其余 AI 队友**；逐座位表见 §3，降级说明见 §8 |
| 伪造 | 无。联盟/联防的判定全部由 `server/match/teams.js`、`match/unitePhase.js` 真跑出来 |

## 2. 环境与方法

### 2.1 服务端

```
node test/e2e/fastServer.mjs
SP_TIMER_SCALE=1 SP_COMBAT_SPEED=2 SP_START_ROUND=3 SP_IDLE_BOTS=1 SP_AUTO_PLACE=1
SP_START_KITS=[["chess_char_4_23_a","chess_char_4_24_a","chess_char_3_06_a","chess_char_3_13_a","chess_char_1_12_a","chess_char_2_06_a"]]
PORT=<free>  HOST=127.0.0.1
```

本次实际监听 `127.0.0.1:58564`（启动即打 `fast server on … (timers ×1, combat 2×, first round 3)`）。

钩子的用途（都是仓库里已有的、带注释的测试钩子，不是为本次新增的）：

- `SP_START_ROUND=3`：第一轮直接是第 3 轮 —— 房主一开局就有一手 6 名干员可摆，不用从 1 级空手打三轮；
- `SP_START_KITS`：按「人类座位顺序」给房主一套 6 名萨尔贡干员（沿用 `test/ui/watch-bonds.e2e.test.js` 的 `UNITE_HOST_KIT`，那套在同样条件下能打满不漏）；
- `SP_AUTO_PLACE=1`：第一个休整期把手上干员按 `bot.js planLayout` 摆上场（不靠拖拽）；
- `SP_IDLE_BOTS=1`：AI 座位只点「就绪」，不买不摆 —— **它们因此必然漏怪**，这正是「队内联防」需要的那半场；
- **没有**传 `SP_BOT_CHESS`：AI 座位手里没有干员，漏怪 100%，房主（不漏）成为我方 4 人的 helper。

### 2.2 浏览器与「同一局同一帧改视口」

- 每个「玩家」是一个独立的 Chrome 进程 + 单标签页（`test/e2e/client.mjs` 的 `Client`：两个标签页会有一个被隐藏、动画帧停摆）。
- 截图一律 `page.screenshot({ captureBeyondViewport: false })`，DPI=1。
- 换视口只调 `page.setViewport({ width, height, deviceScaleFactor: 1 })`，**不传 `isMobile` / `hasTouch`**（传了 puppeteer 会重载页面），也不 `reload()`；换完等两帧 `requestAnimationFrame` + 520ms 再量再拍。
- 顺序固定：先 792×360（量 → 拍）→ 再 1920×1080（量 → 拍），所以每组两张是同一页面、同一局、同一帧（回合数、阶段、敌人波次完全相同）。

### 2.3 每张图都量的东西（探针）

在 `page.evaluate` 里对每个视口实测：

1. `documentElement.scrollWidth/scrollHeight` vs `clientWidth/clientHeight`，`body` 同值 → `scroll == client`；
2. 页级溢出：遍历 `body *`，盒子越出视口 **且** 没有任何 `overflow ≠ visible` 的祖先 → 计数（有裁切祖先的另记为 `clipped`，见 §6.2）；
3. 可点元素：`button, a[href], input, select, textarea, [role=button|switch|tab|radio|checkbox]` 中可见、未 disabled、矩形与视口相交的，取 `min(width, height)` 的最小值与 <32 的清单（用 `getBoundingClientRect`）；
4. 场景标记：`.gm-strip` / `.gm-chip` / `.gm-unite` / `.gm-mate` / `.gm-panel` / `.rs-seat8` / `.rs-seat12` / `.rs-opts` / `[data-testid="room-count"]` 的存在与文案；
5. 局内 HUD 与既有面板的**交叠面积**（`.gm-strip/.gm-unite/.gm-chips/.gm-panel/.gm-mates` × `.team/.gm__bonds/.shopbar`），见 §6.3。

`同盟通讯` 面板默认是展开的（会盖住房间右半屏），每组截图前用它自己的 `−`（`.spchat__fold`）折起来，再用 `aria-expanded` 与面板盒子确认已收起 —— 没有删除/隐藏任何 DOM。

## 3. 怎么建房 + 每个座位是真人还是 AI

### 3.1 建房与补位

1. 标题页输入呼号 `凯尔希` → 大厅 → `同盟模拟` → `创建同盟`（房型默认 4 席）；
2. 顶栏 `⚙`（`.rs-pill__gear`）打开「同盟设置」→「房间人数」分段点 `8` / `12`（`room.setSeats`），面板再点一次 ⚙ 收起；
3. 补座位：**宽版房间（8/12 席）里没有「添加 AI 队友」按钮** —— 那个按钮只画在 4 人名卡的空位上（`public/js/screens/room.js:416`），而 8/12 席是 `名片卡行`（`WideSeatRow`），空位只有「邀请」。
   因此本次用**页面自己的协议客户端**发同一条消息：`__SP__.net.request('room.addBot')`（就是按钮 `onAddBot` 会发的那条 C2S），服务端 `server/lobby.js:1920 addBot()` 真实处理、真实广播 `room.state`。每加一个都会等 `room.seats` 的占位数变化再发下一个。
4. 房间 A 先补到 **7/8** 拍房间图，再补到 **8/8** 开局；房间 B 直接补到 **12/12**。

> 说明：AI 名字用尽 `BOT_NAMES`（7 个）后，服务端回落到 `AI·8 … AI·12`（`lobby.js:1930`），所以 12 人房的 P8–P12 显示为 `AI·8`…`AI·12` —— 这是服务端既有行为，不是本次造假的痕迹。

### 3.2 座位表（真人 / AI 如实列出）

房间 A（`UHSX`，8 席，拍房间图时 7/8，开局时 8/8）：

| 席 | 名字 | 真人/AI |
| --- | --- | --- |
| P1 (0) | 凯尔希 | **真人**（本次唯一的人类浏览器） |
| P2 (1) | AI·华法琳 | AI |
| P3 (2) | AI·阿米娅 | AI |
| P4 (3) | AI·惊蛰 | AI |
| P5 (4) | AI·杜宾 | AI |
| P6 (5) | AI·凯尔希 | AI |
| P7 (6) | AI·可露希尔 | AI |
| P8 (7) | （空位，房间里显示「邀请」） | 房间图时为空；开局前补成 AI 座位 |

房间 B（`LSHA`，12 席，12/12）：

| 席 | 名字 | 真人/AI |
| --- | --- | --- |
| P1 (0) | 凯尔希 | **真人** |
| P2 (1) | AI·华法琳 | AI |
| P3 (2) | AI·阿米娅 | AI |
| P4 (3) | AI·惊蛰 | AI |
| P5 (4) | AI·杜宾 | AI |
| P6 (5) | AI·凯尔希 | AI |
| P7 (6) | AI·可露希尔 | AI |
| P8 (7) | AI·8 | AI |
| P9 (8) | AI·9 | AI |
| P10 (9) | AI·10 | AI |
| P11 (10) | AI·11 | AI |
| P12 (11) | AI·12 | AI |

分队（`teamIndexOf(seat)`，每队 4 席）：房间 A = 我方同盟(0–3) / 对方同盟(4–7)；房间 B = 我方同盟(0–3) / 蓝方同盟(4–7) / 红方同盟(8–11)。

## 4. 走到局内 / 联防的步骤

| 时刻 | 事件 |
| --- | --- |
| 20:49:50 | 房间 A `UHSX` 建立 |
| 20:49:51 | `room.setSeats 8`，补 6 个 AI → 占位 7（拍 `room8-room-*`，顶栏 `7/8`） |
| 20:49:54 | 再补 1 个 AI → 8/8 |
| 20:49:55 | 房主点 `开始模拟`（`room.start`，>4 人房的开局闸已拆，直接进 INFO_CHECK） |
| 20:49:55–56 | 简报 `准备就绪` → 盟约选择 `确认选择` → `BATTLE_CHECK` |
| 20:50:00–01 | `ROUND_START`（第 3 轮）→ `SP_DRAFT`（机变）选一张 → `PREP` |
| 20:50:08–10 | 拍 `room8-match-*`（休整期，HUD 全在） |
| 20:50:11 | 房间 B `LSHA` 建立 |
| 20:50:12 | `room.setSeats 12`，补 11 个 AI → 12/12 |
| 20:50:14–17 | 拍 `room12-room-*`、`room12-seats-sheet-*`（⚙ 面板，选中 12） |
| 20:50:18–23 | `开始模拟` → 简报 → 盟约 → `ROUND_START` → `SP_DRAFT` → `PREP` |
| 20:50:31–35 | 拍 `room12-match-*`、`room12-match-roster-*`（点开「蓝方同盟」芯片的只读名单） |
| 20:50:36 | 房主 `准备就绪`（`.readybtn`） |
| 20:51:14 | 阶段进入 **UNITE**（`team` 阶段） |
| 20:51:15–17 | 拍 `room12-match-unite-*` |

联防当时的 `m.public.unite`（服务端真数据）：

```json
{ "stage": "team",
  "teams": [
    { "index": 0, "helpers": ["p_1cc0290567", "ai_2d5bf620"], "leakers": ["ai_373f7de9", "ai_755b11eb"], "watching": false },
    { "index": 1, "helpers": [], "leakers": ["ai_bfa21662","ai_257a1dca","ai_20953d7e","ai_9e78816b"], "watching": true },
    { "index": 2, "helpers": [], "leakers": ["ai_cc70ab43","ai_ef68ed87","ai_0541e767","ai_0fb700f9"], "watching": true } ],
  "left": { "ai_373f7de9": 6, "ai_755b11eb": 6, "ai_bfa21662": 6, "…": 6 } }
```

即：我方 4 人里 2 人漏（P2、P3），2 人打满（房主 + P4），所以「队内联防」由**我方 2 名 helper** 出场拦截本队漏掉的敌人；蓝方/红方 4 人全漏 → `watching: true`（§7 末「不借人」，转观看）。HUD 上「剩余敌人 60」= 10 个漏怪者 × 6 只的合计。

## 5. 每张图

| 文件 | 尺寸 | 字节 | SHA-256 | 场景 |
| --- | --- | --- | --- | --- |
| `room8-room-792x360.png` | 792×360 | 189520 | `f31cda9367777239b5b5c2595fceef4287f6d1e0f213d01f1fe1516b75261ab4` | 8 人房双栏 54/46，顶栏 `7/8`，左右两个队头 `4/4`+`3/4`，P8 空位「邀请」 |
| `room8-room-1920x1080.png` | 1920×1080 | 694028 | `7574781291ed5f386b620e9bef1148755dd0a0bafc878863fb4762e93121d131` | 同上 |
| `room8-match-792x360.png` | 792×360 | 409826 | `77eb7df5f6e64feb3402e8768812a2cd796b1b3ab000eab5d8bb9110da19a5d6` | 局内休整（第 3 轮）：顶部 2 段状态条 + 2 颗芯片（我方 4/4、对方 4/4）+ 左下我方 4 人头像条（带血量数字） |
| `room8-match-1920x1080.png` | 1920×1080 | 2379359 | `a3e373dc09755f23ea4f6fa1a7719d1d8bd0f4b5444c617c564cfa24f416a40b` | 同上 |
| `room12-room-792x360.png` | 792×360 | 168320 | `4cf0f041794b1bcc69105b8252b411e4ecac45e2e76cbb07557555c596300183` | 12 人房：左 64% 我方 4 张名片卡（`4/4`），右 36% 两颗芯片「蓝方同盟 4/4」「红方同盟 4/4」 |
| `room12-room-1920x1080.png` | 1920×1080 | 643987 | `85f503f32524cebc3bd0141f43543af3aaff4e15a6c8ed2d2e0cb7a69c65e7f9` | 同上 |
| `room12-seats-sheet-792x360.png` | 792×360 | 143442 | `ea7f2316a462f5c290b8ae348f500e1b18a0a79e761aeef6513bd9eb96d86416` | ⚙ 同盟设置：`房间人数` 分段 `4 / 8 / 12`，**12 选中**，提示「将变成 3 队 × 4 人」 |
| `room12-seats-sheet-1920x1080.png` | 1920×1080 | 671226 | `1dec44c7b5c3ecd59ce218d1141999d6139b6ccaee3b33c37d50fae56729c67c` | 同上 |
| `room12-match-792x360.png` | 792×360 | 417848 | `0b65387a22010ed19c34cbc27c8b3f3045b83b521d40438567b80cd1f915af47` | 局内：顶部 **3 段**状态条 + **3 颗**芯片（我方/蓝方/红方 各 4/4）+ 左下我方 4 人血条 |
| `room12-match-1920x1080.png` | 1920×1080 | 2416813 | `cf683f78cb7ceebffaaa589f628cafb45a0704efb6bd0fe5b5c9ecaef96e6fb1` | 同上 |
| `room12-match-roster-792x360.png` | 792×360 | 382791 | `b4749f97c5b0648f4565dd1dffd520c83dcc25af82b98291d2774e0c905a3275` | 点开「蓝方同盟」芯片：只读名单 4 行（AI·杜宾 / AI·凯尔希 / AI·可露希尔 / AI·8），**只给名字、无血量数字** |
| `room12-match-roster-1920x1080.png` | 1920×1080 | 2215572 | `4c4b210704e21bafc04c3e7ebfff759b775960895bb03716535a2d2ebe31833f` | 同上 |
| `room12-match-unite-792x360.png` | 792×360 | 437620 | `16de9f581a23c868e86465dfe983a1bd163cce7f86497c30ceb23a46af27ae05` | 联防条（状态条下方）：「联防阶段 + 2 名出手干员头像 + 队内联防 + 剩余敌人 60 + 联防中」 |
| `room12-match-unite-1920x1080.png` | 1920×1080 | 2531043 | `136f732733ce3e59d184cd2ef3fb80ada1e57b3e67a18a97109ca49befd2ca4e` | 同上 |

（逐张实测数据：`handoff/shots/multi-real-shots.json`，与本报告同一次运行生成。）

## 6. 溢出与可点实测

### 6.1 总表

| 图 | scroll==client | scroll / client | 页级溢出 | 可点元素 | 最小可点边 | <32 的控件 |
| --- | --- | --- | --- | --- | --- | --- |
| room8-room-792x360 | ✅ | 792×360 / 792×360 | 0 | 11 | **12.00** | 6 |
| room8-room-1920x1080 | ✅ | 1920×1080 / 1920×1080 | 0 | 14 | 30.00 | 1 |
| room8-match-792x360 | ✅ | 792×360 / 792×360 | 0 | 30 | **12.59** | 8 |
| room8-match-1920x1080 | ✅ | 1920×1080 / 1920×1080 | 0 | 30 | 28.50 | 1 |
| room12-room-792x360 | ✅ | 792×360 / 792×360 | 0 | 12 | **12.00** | 6 |
| room12-room-1920x1080 | ✅ | 1920×1080 / 1920×1080 | 0 | 15 | 30.00 | 1 |
| room12-seats-sheet-792x360 | ✅ | 792×360 / 792×360 | 0 | 19 | **12.00** | 10 |
| room12-seats-sheet-1920x1080 | ✅ | 1920×1080 / 1920×1080 | 0 | 22 | 30.00 | 1 |
| room12-match-792x360 | ✅ | 792×360 / 792×360 | 0 | 34 | **12.59** | 11 |
| room12-match-1920x1080 | ✅ | 1920×1080 / 1920×1080 | 0 | 35 | 28.50 | 1 |
| room12-match-roster-792x360 | ✅ | 792×360 / 792×360 | 0 | 35 | **12.59** | 12 |
| room12-match-roster-1920x1080 | ✅ | 1920×1080 / 1920×1080 | 0 | 36 | 28.50 | 1 |
| room12-match-unite-792x360 | ✅ | 792×360 / 792×360 | 0 | 26 | **16.00** | 9 |
| room12-match-unite-1920x1080 | ✅ | 1920×1080 / 1920×1080 | 0 | 27 | 40.00 | **0** ✅ |

**没有任何一张出现页级滚动或页级溢出**；`body.scrollWidth/Height` 与 `documentElement` 同值。

### 6.2 被裁切（`clipped`）——不是页级溢出，但如实报数

探针把「盒子越出视口、但有 `overflow≠visible` 的祖先」单独记 `clipped`，不计入页级溢出：

| 图 | clipped 元素数 | 说明 |
| --- | --- | --- |
| room8-room-* / room12-room-* / room12-seats-sheet-1920 | 0（seats-sheet-792 为 22） | 房间页本身没有裁切 |
| room8-match-792x360 | 17 | 同盟成员列表（8 行）下半截落在 `.team` 自己的裁切容器里 |
| room12-match-792x360 / room12-match-roster-792x360 | 81 | 12 行成员列表，视口内只看得到 P1–P8 |
| room12-match-1920x1080 / roster-1920 | 49 | 同上（能看到 P1–P10） |
| room12-match-unite-* | 91 / 55 | 同上 + 联防阶段的多余行 |
| room12-seats-sheet-792x360 | 22 | `.rs-opts` 面板本身越界（见 §9.1） |

### 6.3 <32 的控件清单（`getBoundingClientRect`）

房间页（8 人 / 12 人两张一样，都是房间顶栏与底部胶囊，既有控件）：

| 控件 | 792×360 | 1920×1080 |
| --- | --- | --- |
| `button.plugtag`（原版标记） | 31×12 | 76×30 |
| `button.rs-key__copy`（复制） | 42×25 | — |
| `button.rs-key__link`（复制链接） | 28×25 | — |
| `button.rs-pill__diff`（标准模拟 AC-1） | 91×30 | — |
| `button.rs-pill__ver`（第二期下半） | 89×30 | — |
| `button.spchat__toggle`（展开/折叠聊天） | 24×24 | — |

⚙ 面板（`room12-seats-sheet-792x360` 额外）：`rs-opts__diff` 76×**14**、`rs-opts__ver` 69×**14**、`dpick__opt`（允许观战者接替 AI）75×**14**、`dpick__opt`（AI 队友最后选择）69×**14**。
**`房间人数` 的 4 / 8 / 12 分段按钮本身是 78×36 ✅**（两种视口都一样）。

局内（8/12 人相同）：

| 控件 | 792×360 | 1920×1080 |
| --- | --- | --- |
| `button.gtop__iconbtn.tapx`（本局信息） | 31×26 | ✅ ≥32 |
| `button.enemybtn.tapx`（敌方情报） | 55×26 | ✅ |
| `button.bond.bond--sm`（盟约芯片，5–7 个） | 21–22×31 | ✅ |
| `button.toolbtn--ice`（冻结 F） | 61×30 | ✅ |
| `button.toolbtn--amber`（刷新 1 R） | 80×30 | ✅ |
| `button.funds__collapse`（收起） | 29×13 | 70×29 |
| `button.gm-panel__close`（关闭，仅 roster 图） | 48×26 | ✅ |
| `button.vswitch__arrow`（左侧/右侧战场，仅联防图） | 16×16 | ✅ |

**多人 HUD 自己的可点元素全部达标**：`gm-chip` 36×36（792 与 1920 都是）、`gm-panel__close` 48×26（792）/ ≥32（1920）。
不达标的都是**房间里既有的**小图标键（盟约芯片、原版标记、聊天圆钮、冻结/刷新等），不是这次多人房新加的层 —— 但按要求如实列出。

## 7. 控制台 / 网络错误计数

`Client` 的监听口径：`console` 里 `type() === 'error'`、`pageerror`、`requestfailed`（媒体元素 `ERR_ABORTED` 不计，与仓库其它 e2e 一致）、`response.status() >= 400`。

| 客户端 | console.error | pageerror | requestfailed | HTTP ≥ 400 |
| --- | --- | --- | --- | --- |
| 房间 A / 局内（host8） | 0 | 0 | 0 | 0 |
| 房间 B / 局内 / 联防（host12） | 0 | 0 | 0 | 0 |

（`problems: { host8: [], host12: [] }`，见 `multi-real-shots.json`。服务端日志只有一行启动信息，无 error/warn。）

## 8. 降级说明（如实）

**没有做「12 个真人浏览器上下文」**，原因是 30 分钟预算内同时起 12 个 Chrome（每个都要载完游戏资源、走简报 / 盟约 / 机变 / 休整）不现实，而且仓库自己的 e2e 也是「一个玩家的一个 Chrome 进程」而不是一份浏览器多标签。实际做法是任务里允许的退路：

- 每个房间 **1 个真 page（房主）**，其余座位是**服务端 AI 队友**（`room.addBot`）；
- 为了让「队内联防」真的发生，AI 座位被造成「只有手牌没上场、必漏」的一方（`SP_IDLE_BOTS=1` 且不给 `SP_BOT_CHESS`），房主打满 —— 这是**真服务端跑出来的** 2 helper 队内联防，不是摆拍；
- **AI 补位的具体座位见 §3.2**：8 人房 1 真人 + 6 AI（第 8 席在房间图里是空位），12 人房 1 真人 + 11 AI。

如果后续要「多人真人」版，只需要多起 N 个 `Client`（各 1280×720 或 1920×1080）、用 `?room=<code>` 加入、每个都点 `准备就绪`，其余步骤与本报告 §4 完全一致 —— 本次没有做，不冒充。

## 9. 发现的问题（只记录，未改源码）

### 9.1 792×360 时 ⚙ 同盟设置面板左边越出屏幕（**实测**）

`room12-seats-sheet-792x360.png`：面板盒子 `left = −31px`（`w=310, h=162, right=280, bottom=307`），面板是 `position:absolute` 且带 `transform: translateX(-155.195px)`，锚在底部那颗 ⚙ 上（⚙ 在 `left=204, top=316`）。后果（同一测量）：

- `模拟难度` 标签 `left=−22, right=1`，只剩 1px；
- `房间人数` 标签 `left=−22, right=22`，半个字在屏外（截图里读作「…人数」）；
- `版本` 标签 `left=−22, right=−11`，**整块在屏外**。

1920×1080 正常（面板 `left=772`）。修法属于房间布局（弹层翻转/夹取），本次按「不改源码」只报不修。

### 9.2 局内多人 HUD 与既有面板叠压（**实测交叠面积**）

| 图 | 交叠 |
| --- | --- |
| room8-match-792x360 | `.gm-chips × .team` = 43×78px；`.gm-mates × .team` = 74×52px；`.gm-strip × .gm__bonds` = 113×15px |
| room8-match-1920x1080 | `.gm-chips × .team` = 108×194px；`.gm-mates × .team` = 183×53px；`.gm-strip × .gm__bonds` = 282×36px |
| room12-match-792x360 | `.gm-chips × .team` = 43×131px；`.gm-mates × .team` = 74×52px；`.gm-strip × .gm__bonds` = 214×15px |
| room12-match-1920x1080 | `.gm-chips × .team` = 108×326px；`.gm-mates × .team` = 183×129px；`.gm-strip × .gm__bonds` = 534×36px |
| room12-match-unite-1920x1080 | 另加 `.gm-unite × .team` = 291×74px、`.gm-unite × .gm__bonds` = 534×43px |
| room12-match-roster-1920x1080 | 另加 `.gm-panel × .team` = 45×426px、`.gm-panel × .gm__bonds` = 123×43px |

也就是：**队伍芯片列压在同盟成员列表（P1–P4 行）上、我方 4 人血条压在列表底部、状态条压在盟约条上**。器件矩形：

- 1920：`.gm-strip` (24,130) 1872×42；`.gm-chips` (36,190) 108×372；`.gm-mates` (36,921) 384×129；`.team` (22,236) 197×1114；`.gm__bonds` (693,136) 534×97；
- 792：`.gm-strip` (10,52) 773×17；`.gm-chips` (14,76) 43×149；`.gm-mates` (14,296) 154×52；`.team` (9,94) 79×446。

### 9.3 1920×1080 的 12 人房有大片空白

名片卡行高 44px×4 + 队头 30px，左栏在 1080 高度里只占顶部约 1/4；右侧两芯片是 `justify-content:center`，落在页面中部 —— 与左栏顶对齐不一致。792×360 下没有这个问题（见 `room12-room-792x360.png`）。

### 9.4 8 人房的状态条「对方」段不易分辨

`.gm-strip` 的我方 4 格是薄荷色实心、间隔清楚；对方/红方 4 格与轨道同色系，1920 下读起来像**一整条暗条**（`aria-label` 仍是 `我方同盟 4/4 ｜ 对方同盟 4/4`，数据正确）。属于配色可读性，不是数据错误。

## 10. 复现与清理

- 复现骨架（本次使用的临时脚本，跑完已删）：`startRealServer({ fast: { timerScale: 1, combatSpeed: 2, startRound: 3, idleBots: true, autoPlace: true, kits: [UNITE_HOST_KIT] } })` → `new Client(puppeteer, base, label, { w: 1920, h: 1080 })` → `enter('凯尔希')` → `createCoop()` → `setSeats(8|12)` → `net.request('room.addBot')` ×N → 截图 → `开始模拟` → 简报/盟约/机变 → `PREP` → 截图 → `.readybtn` → 等 `UNITE` → 截图；换视口只 `setViewport({width,height})`。
- 本次写入的仓库内文件：`handoff/shots/` 下 14 张 PNG、本报告、`multi-real-shots.json`（探针原始数据）。**没有别的仓库改动，没有任何 git 写操作。**
- 清理：临时脚本目录（`%TEMP%\sp-multishots`，含 `run.mjs`、`measure.mjs` 与日志）已删除；`fastServer` 子进程随脚本 `srv.stop()`（SIGTERM）退出，端口已释放。
- 说明：`handoff/shots/` 里原本就有前几轮会话留下的 mock 图（`room12-desktop-*`、`room12-dual-*`、`room12-mobile-*`、`room12-seats-sheet-4/12`、`room12-eight-split`、`room12-seats-switch-flow`），本次**没有动它们**；唯一重名的 `room12-match-unite-792x360.png` 是 17:43 的旧图，已被本次实机图覆盖。

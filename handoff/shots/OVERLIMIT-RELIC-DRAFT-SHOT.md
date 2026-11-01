# 超限词条三选一 · 实机截图报告

日期：2026-10-31 · 仓库：`E:\Workbox\系统` · 未改任何仓库源码，无 git 写操作。

## 一句话结论

词条三选一确实在**正常段 R3 的整备之前**由 `afterRoundStart` 弹出（`PHASE.SP_DRAFT`，`sp.family = "overlimit"`，`round = 3`，单人 `untimed`），三张卡是 `LC-003 / LC-002 / LC-006`。**但默认路径下这个浮层没有版式**（见下面「实机 bug」），本组交付图是在同一页面先打过一局炸惊（从而加载 `css/screens/jibian.css`）之后进超限房拍的；默认状态的原样截图见 `overlimit-relic-draft-unstyled-default-1920x1080.png`（同目录另有一份同内容、名为 `overlimit-relic-draft-unstyled-before.png` 的副本）。

## 实机 bug：超限词条浮层缺 `css/screens/jibian.css`

- `.zjov / .zjov__* / .zjcard / .zjcard__*` 的版式**全部**来自 `public/css/screens/jibian.css`，而这张样式表是**按需加载**的：
  `public/js/ui/jibian.js:41-53` 的 `ensureCss()` 只在 `JibianDraftView`（:252）、`JibianPanelView`（:450）、`EnemyJibianRevealView`（:530）里被调用。
- 超限这一侧 `public/js/ui/overlimitRelics.js:25-34` 的 `ensureRelicCss()` 只加载自己的补充样式 `public/css/screens/overlimitRelics.css`（该文件只有分组色条 / 未实装角标 / 眉题冷色，**没有 `@import`**），`public/index.html` 也没有全局引用 `jibian.css`。
- 于是**只在超限局里**（没打开过炸惊草稿 / 惊变面板 / 敌方惊变浮层）时，R3 弹出的词条三选一完全裸奔。实测（1920×1080，`document.styleSheets` 里没有 jibian.css）：

  | 元素 | 默认路径实测 | 有 jibian.css 时 |
  | --- | --- | --- |
  | `.zjov` | `0,0 1920×220.5`（只剩页面流里的条） | `280,0 1640×1080`（覆盖全屏） |
  | `.zjov__grid` | `0,121.5 1920×99` | `310,194 1560×836` |
  | `.zjcard` ×3 | 各 `1869×33 / 1688×33 / 1558×33`，三张横条、卡面文字不可读 | 各 `506.7×318.8 / 506.7×318.8 / 506.7×283.6` |

  证据图：`overlimit-relic-draft-unstyled-default-1920x1080.png`（真机默认路径，浮层只剩顶部一条，三张卡是 33px 横条；画面中部那条「词条抉择 / RELIC」是**阶段横幅** `mpop--phase`，不是浮层）。
- 一行修复（本轮**未**改动，按纪律不能改 `public/**`）：`overlimitRelics.js` 的 `ensureRelicCss()` 里顺带 `ensureJibianCss()`（从 `./jibian.js` 导入），或在 `game.js` 渲染 `OverlimitRelicOverlay` 时调用 `ensureJibianCss()`。
- 本报告的交付图走的是**玩家真能走到的路径**：同一页面先开一局炸惊（R1 的敌方惊变浮层会调用 `ensureCss()`），放弃模拟回大厅、再建超限房 —— 页面不重载，`link[data-jibian]` 一直在（拍图时实测 `document.styleSheets` 同时含 `jibian.css` 与 `overlimitRelics.css`）。不是注入 CSS，也没有改源码。

## 怎么进的房、怎么走到 R3

服务端：`PORT=3161 node server/index.js`（独立进程，数据目录用仓库默认 `data/` 只读；日志只写临时文件，用完已关）。端口 3161 在 3160–3180 区间内，没占用 3000。

浏览器：puppeteer-core + `C:/Users/J1825/AppData/Local/Google/Chrome/Application/chrome.exe`（headless），驱动方式照抄 `test/ui/real.e2e.test.js` 的 solo 用例：真鼠标点击、真拖拽部署、`.readybtn` + 「剩余资金」确认；没有新协议。

1. 标题页输入代号 → 开始 → 大厅。
2. **预载样式（见 bug 节）**：`room.create { mode: 'solo', difficulty: 'ZHAJING' }`（`devtools/*.mjs` 里同一写法）→ 开始模拟 → 准备就绪 → R1 敌方惊变浮层一出现，`link[data-jibian]` 就位（本次约 8 s）→ 顶栏退出 → 放弃模拟 → 回大厅。
3. 大厅 `.mode-card`「独立模拟」→ 选择模拟协议里 `[data-special="infinite"]`（特殊难度「超限模拟」）→ `.proto-start`「开始独立模拟」。
   - 房里实测：`mode = "solo_infinite"`，`difficulty = "ABYSS"`，座位 1/4（单人房，`isSoloRoomMode`）→ 即 `flags.overlimit` 局。
4. 「开始模拟」→ 简报 → 「准备就绪」→ 盟约草稿（`BAND_DRAFT`，点一张 `.dband` + 确认；起始 LP 28）。
5. **R1**：整备期买 2 个干员、拖上棋盘 2 个、准备 → 作战（画面上点一次 SPEED 2×）→ 结算，LP 28→28。
6. **R2**：同样买+部署 2 个、准备 → 作战 → 结算，LP 28→28。
7. **R3 开场**：`ROUND_START:3` → 立刻 `SP_DRAFT:3`，`sp.family = "overlimit"`、`relicKind = "lc"`、`round = 3`、`untimed = true`、`order` 只有自己 → `.zjov--relic` 浮层出现。全程 17:45:52 进房 → 17:47:24 弹卡，约 1 分 32 秒；三回合实际用时 09:45:52–09:47:31。

## 三张卡（拍图这一局，从 DOM 读）

| # | 编号（`.zjcard__rarity`，数据不翻译） | 名称 | `data-impl` | 角标 |
| --- | --- | --- | --- | --- |
| 1 | `LC-003` | 要不要来杯震颤爆发？ | `pending` | 「暂不可用」 |
| 2 | `LC-002` | 红绵花不是白棉花 | `bleed` | 无 |
| 3 | `LC-006` | 你是哪位？ | `charge` | 无 |

服务端同一帧的 `m.public.sp`：`{ family: "overlimit", relicKind: "lc", round: 3, untimed: true, cards: [LC-003, LC-002, LC-006] }`，与 DOM 一致；三张 `data-group="lc"`。浮层抬头 `OVERLIMIT // RELIC`、标题「词条抉择」、副标题「选择一项（无时间限制） · 点击卡牌选中，再次点击确认」、右上状态「当前轮到你决策」。

## 交付图

| 文件 | 尺寸 | 内容 |
| --- | --- | --- |
| `overlimit-relic-draft-1920x1080.png` | 1920×1080 | 浮层完整：眉题 / 标题 / 副标题 / 三张竖卡 / 未实装角标 |
| `overlimit-relic-draft-792x360.png` | 792×360 | 同一局同一手牌，同一 DOM，仅改视口宽高 |
| `overlimit-relic-draft-armed-792x360.png` | 792×360 | 点第一张卡后：卡抬起 + 卡内「确认选择 再次点击」+ 抬头右侧「确认选择」按钮 |

手机档实测（792×360）：`.zjov` 占满 `0,0 792×360`；`.zjov__head` `10,11.3 765.3×62.8`；三张卡各 `250.7×149.7 / 250.7×149.7 / 250.7×132.1`，全部 `inView`；`.zjov__grid` `scrollHeight 263 = clientHeight 263`（**不滚动、不被裁**）；`documentElement` 无横向溢出。桌面档三张卡 `506.7×318.8 / 506.7×318.8 / 506.7×283.6`，同样全在视口内。

拍法说明：两张图是**同一局、同一手牌、同一 DOM**，先 1920×1080 拍，再原地把视口改成 792×360 拍（与 `tmp/zjov-pair.mjs` 同一做法），没有重新开局。改视口时**只传 width/height**：传 `isMobile/hasTouch` 会让 puppeteer 重载页面（第一次尝试就这么截成了标题页，已丢弃）。

## 控制台 / 网络

- `console.error`、`pageerror`、`requestfailed`（除 `net::ERR_ABORTED` 的媒体/图片替换）、HTTP ≥ 400：**0 条**。
- 唯一一次异常是第一次拍 792 图时 puppeteer 因 `isMobile` 重载页面（脚本问题，不是页面报错）。

## 顺带观察（不算 bug，但影响出图）

- 词条三选一开出来的头几秒会叠一个「轮到你选」圆盘（`.sptp`，`ui/turnPopup.js`，本来是机变草稿的提示），它会盖住中间那张卡的文字，约几秒后自己退场。第一版 1920 图就被它挡了，最终图是等它消失后拍的。
- R3 这天同时有机变轮（`gd.spRounds()` 含 3），但词条先开、选完才接机变；本次只到词条浮层为止，没有继续选卡。

## 清理

- 3161 服务端已关；Chrome 由脚本退出时关闭。
- 临时驱动脚本 `tmp/ovl-shot.mjs`、`tmp/ovl-shot2.mjs` 与日志 `tmp/ovl-shot*.log`、`tmp/ovl-shot-result.json`、`tmp/ovl-evidence-*.png` 已删除（三张交付图 + 本报告 + 一份默认路径证据图保留）。
- 未修改 `public/**`、`data/**`、`server/**`、`test/**`，未做任何 git 写操作。

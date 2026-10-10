# 电脑端 UI 设计调研报告（PC-First Redesign Research）

> 版本：v1.0　日期：2026-10-10
> 范围：`sp-upgrade-2.1`（卫戍协议，塔防+自走棋混合，Preact SPA，同源 Web / Windows 桌面客户端 / Android）
> 目的：为「电脑端更合适的 UI 设计」提供一份可落地的、覆盖全部界面的研讨结论。
> 依据：仓库代码全面盘点（`public/js`、`public/css`、`public/admin`、`public/dashboard.html`）+ 既有 UI 决议文档研读 + 外部 PC 游戏 UI 最佳实践调研。

---

## 0. 结论速览（TL;DR）

电脑端体验的核心问题不是「移动端 UI 太小」，而是**整套信息架构仍是移动端的「页面流」**：全屏 overlay、底部抽屉、点按展开详情、断点全是 `max-*` 方向。PC 化要做的是把它改成**「仪表盘」**——对局内一切常驻同屏、hover 取代点按、快捷键覆盖高频操作、1280–1920 为基准断点、UI scale 滑条。

项目已有两条关键资产让这件事成本很低：

1. **端判定机制已就绪**：`device.js` 暴露 `sp-hover`（桌面=true）、`sp-coarse`（触屏）等 8 个特性类，红线已定「绝不按 UA/宽度分叉」。**PC 化不需要动 device.js，只需新增一层桌面正向样式 + 消费已有 class。**
2. **桌面正向样式层是空白的**：全库 CSS 约 85 处按能力类分支，其中正向命中桌面（`sp-hover` 非 `sp-coarse`）的几乎为 0；所有断点都是 `max-*` 收窄方向，无一条 `min-width` 桌面断点。这是一张白纸，可以直接按最佳实践落。

一句话总纲：**把「移动端放大版」改成「桌面优先 + 移动端加法」的对称三层制，1280/1440 为设计基准，超宽屏用中心安全区，所有详情面板 dock 化、hover tooltip 化、快捷键标准化（D/F/E/空格/Esc/数字键）。**

---

## 1. 现状盘点：全部界面与桌面适配度

下表覆盖 `public/` 下所有界面/屏幕/面板/弹窗（含 admin 与 dashboard）。「桌面适配度」：0=纯移动遗留；1=有断点但桌面仅是放大版手机布局；2=桌面双列/多列但缺桌面专属优化；3=桌面优先。

| 界面 | 文件 | 当前形态 | 适配 | 主要问题 |
|---|---|---|---|---|
| 标题 Title | `js/screens/title.js:198` + `css/screens/title.css` | 中央单列 + 4 角装饰 | 2 | 登录框固定 4.9rem 宽；`.sp-coarse` 全表 !important 覆写 |
| 大厅 Lobby | `js/screens/lobby.js:406` + `css/screens/lobby.css` | 双列 grid，max-width 1920 | 2 | 无桌面断点；4K 屏只有中央一条；无键盘导航 |
| 房间 Room | `js/screens/room.js:215` + `css/screens/room.css` | 4 列座位 grid + 底部 room-bar | 2 | 座位固定 3.8rem×4；宽屏留白；无断点 |
| 战前简报 Briefing | `js/screens/briefing.js:23` + `css/screens/briefing.css` | 双列 6.2rem+1fr | 2 | 左列固定 620px；无断点 |
| 策略选秀 BandDraft | `js/screens/bandDraft.js:164` + `css/screens/draft.css` | 三列 3.9rem+1fr+5rem | 2 | 左右固定像素；宽屏无扩展 |
| 对局 HUD（顶条/商店/策略条/团队/详情面板） | `js/screens/game.js:184` + `game.css`/`game-shop.css`/`game-panels.css` | 全屏 canvas + absolute overlay | 2 | safe-area 变量贯穿；`--tap-min:44px`；触屏放大规则可能误伤触屏笔记本 |
| 结算 Result | `js/screens/result.js:72` + `css/screens/result.css` | 双列 5.6rem+1fr | 2 | 零断点；左列固定 560px |
| 干员调配 Loadout | `js/screens/loadout.js:420/677` + `css/screens/loadout.css` | 全屏 fixed overlay，双列 1fr+7rem | 2 | 桌面无侧边抽屉形态；`.lo-sheet` 底部弹出是纯手机范式 |
| 装备总览 Equip | `js/screens/equipment.js:211/292` + `css/screens/equipment.css` | 复用 .lo 骨架 | 2 | 同上 |
| 盟约策略 AllianceCodex | `js/screens/alliances.js:354/466` + `css/screens/alliances.css` | 复用 .lo 骨架 | 2 | 同上 |
| 数据统计 Stats | `js/screens/stats.js:249/355` + `css/screens/stats.css` | 全屏 overlay，单列滚动 | 2 | 无多栏仪表板；断点全是收窄 |
| 玩法说明 Guide | `js/ui/guide.js:105` + `css/screens/guide.css` | 模态 + 16:9 图片 | 3 | 接近桌面友好，缺方向键翻页 |
| 设置 Settings | `js/ui/settings.js:77` + `components.css` Modal | Modal + 表单行 | 2 | Modal 限宽 6.4rem；无 Tab 分组键盘导航 |
| 匹配 MatchmakingModal | `js/screens/lobby.js:271` + `lobby.css` .mm-modal | Modal | 2 | 无桌面宽版；列表无键盘导航 |
| 无尽排行 Leaderboard | `js/ui/leaderboard.js:72` + `css/leaderboard.css` | Modal + 表格 | 2 | 900px 断点是收窄；无宽屏扩展 |
| **语音底部抽屉 `.lo-sheet`** | `js/ui/voicePicker.js` + `css/screens/loadout.css:776-801` | fixed bottom sheet | **0-1** | **纯 iOS 底部弹出，桌面应改右侧抽屉/原生 select** |
| 旋转提示 `.rotate-hint` | `theme.css:361-413` | 全屏遮罩 | 1 | **桌面窄窗口（<1024px 竖屏）也会被提示，逻辑误判** |
| 连接/负载/Toast/公告 | `js/ui/*.js` | 角落胶囊/横幅 | 3 | OK |
| **管理后台 Admin** | `public/admin/index.html` + `admin/admin.css` | 顶部条 + 4 列指标 + 表 | 2 | **独立设计系统，与游戏内 theme.css 不一致**；无断点 |
| **监控仪表盘 Dashboard** | `public/dashboard.html` | 4 列网格 | 3 | **项目里最桌面优先**，可作重写模板 |

**核心证据（移动横屏优先的根源）**：
- `public/index.html:6` meta viewport `user-scalable=no`，注释「A landscape game」。
- `theme.css:411` `(orientation: portrait) and (max-width: 1024px)` 触发 `.rotate-hint`「请将设备横屏」。
- `js/ui/device.js:129` 主动 `orientation.lock('landscape')`。
- `devices.css:19` 设 `--tap-min: 44px` 并给所有按钮套隐形 44px 命中区。

---

## 2. 双端适配体系现状（可复用资产）

**端判定**：`public/js/ui/device.js:82-95` 写入 `<html>` 8 个特性类，全部 feature-detected，运行时随输入设备热切换。

| class | 条件 | 桌面语义 |
|---|---|---|
| `sp-hover` | `(any-hover: hover)` | **桌面=true，正向覆盖首选前缀** |
| `sp-coarse` | `(any-pointer: coarse)` | 触屏=true |
| `sp-touch` | maxTouchPoints>0 等 | 触屏=true |
| `sp-fs` | Fullscreen API 可用 | 桌面=true |
| `sp-standalone` | display-mode standalone | PWA |
| `sp-reduced-motion` | prefers-reduced-motion | 用户偏好 |
| `sp-rotatable` | coarse 且非横屏 | 旋转提示 |
| `sp-no-hover` | 无 hover | 触屏 |

桌面精确锁定写法：**`html.sp-hover:not(.sp-coarse)`**。

**CSS 三层制现状**：加载顺序 `theme.css → components.css → screens/*.css → leaderboard.css → emotes.css → mobile.css → devices.css`。基础层即桌面布局（以桌面为默认态），`mobile.css`（400 行 66 处 `.sp-coarse`）与 `devices.css`（241 行）是最后追加的**补丁层**，不属于对称三层。

**桌面端可复用挂点**（全部现成，无需改 JS）：`html.sp-hover`、`html:not(.sp-coarse)`、`html.sp-fs`、`useDocClass()` 钩子、`--sp-vh` 真实视高、`detectFeatures().hover && !coarse` 判定、`@media (min-aspect-ratio: 19/9)` 超宽屏断点、右键 `contextmenu` 已接管（`device.js:241-250`）。

**构建开关**：`shared/capabilities.js` 的 `LOCAL_FEATURES = { endless, mods }`，目前仅 server 包改写。桌面端如需独占 UI 入口，可仿此模式在 `scripts/pack/desktop.mjs` 加改写位（现无改写逻辑，属新增）。

**体系红线**（勿违反）：端判定只用 `sp-hover` / `sp-touch && sp-coarse`，绝不按 UA、绝不按窗口宽度做功能分叉；媒体查询只允许出现在 `*.mobile.css` / `*.desktop.css`；静态 `<link>` 加载，不搞运行时按端注入（LAN/离线红线）。

---

## 3. 既有 UI 决议（已定案，勿重复研究）

来源：`docs/GLOBAL_VOICE_TRI_UI_ENDLESS_PLAN.md`（最高权威，D1–D6 + 三端拆分）、`docs/CF_MOD_TRI_PLAN.md`（UI 裁决六问终裁）、`docs/ENDLESS_MOD_DUAL_PLATFORM_PLAN.md`（P0–P9 + D1–D33）、`docs/MATCHMAKING_PRIVATE_ROOMS_PLAN.md`、`docs/SKIN_SHOP_PORTRAIT_PLAN.md`、`docs/mockups/README.md`。

**已定案的桌面端方向**：
- **三端拆分总原则**（GLOBAL_VOICE §3.2）：`<screen>.css`（端无关结构）→ `<screen>.desktop.css`（hover/大屏）→ `<screen>.mobile.css`（触摸/紧凑/安全区）；屏幕 JS 一屏一目录 `{index.js, <Name>Screen.js, desktop.js, mobile.js}`；`mobile.css`（389 行杂烩）解散到各 `<screen>.mobile.css`。
- **桌面优化清单**（GLOBAL_VOICE §3.5）：键盘导航全覆盖、hover 预览、多列布局（干员调配 4 列）、文字大小四档（接上游 #435）。
- **桌面下拉用原生 `<select>`**（语音选择器双端分叉已定，GLOBAL_VOICE §2.2）。
- **mod 目录浏览器桌面形态**：居中 Modal 三列网格、四动作 `btn--sm` 平铺 + hover + 键盘 ←/→（CF 问 2）。
- **admin mod 上传**：桌面 ≥720px 步骤条横向单行（CF 问 1）。
- **图鉴 mod 徽标**：桌面 hover tooltip、单击跳转、键盘 focus 同 tooltip（CF 问 6）。
- **PackFetchGate**：缺包 join 前全屏遮罩，桌面居中 480px（CF 问 4）。
- **私密房/快速匹配**（MATCHMAKING §2）：匹配弹窗加通栏主按钮「⚡ 快速匹配」，私密开关用 `.set-seg` 二段。
- **商店卡立绘同步**（SKIN_SHOP_PORTRAIT_PLAN）：选皮肤后 `.scard__art` 显示该皮肤半身像。

**样式基线**（mockups/README）：基线 = 游戏自己的样式表（theme/components/devices/loadout/game-panels/game-shop），字体用 `public/fonts/fonts.css`（Bender / Novecento Wide + Noto Sans SC）；根字号 `clamp(40px, min(100vw/19.2, 100svh/10.8), 240px)`，Web 1920×1080 下 1rem=100px。

**已产出 mockup**（`docs/mockups/`）：私密房/匹配 4 张、v0.2.2 融合参考、双端三层轴、干员调配/皮肤/设备/矩阵、每干员语音切换（已实现）、内置内容包 8 张、无尽 5 张、mod 装备/盟约图鉴 5 张、admin/总览。`docs/ui-reference/` 九屏静态 HTML 参考总览台（01-title ~ 09-endless-solo）。**审美仍需人工过目，结构化自检只替代几何验证。**

---

## 4. 外部最佳实践（桌面 PC 游戏 UI）

调研来源：Nielsen Norman Group《10 Usability Heuristics Applied to Video Games》、Game Accessibility Guidelines、Xbox Accessibility Guidelines XAG 101/102/106、MDN（pointer/hover 媒体查询）、WCAG 2.2、WAI-ARIA APG，及 TFT / Dota 2 / Slay the Spire / Bloons TD 6 / FF14 / Destiny 2 / 文明 6 产品惯例与超宽屏社区共识。

**4.1 信息架构：仪表盘，不是页面流**
- 对局 HUD 全要素常驻同屏（血/金币/波次/商店/板凳/战场），全屏 modal 是桌面最大反模式。TFT 商店、板凳、装备、羁绊、玩家列表全部常驻。
- 密度三档：对局 HUD（最高密度全 dock）> 大厅/编队（中密度双/三栏）> 结算/皮肤详情（低密度页面内面板，非移动式整屏切换）。
- 信息层级用「屏幕分区」而非「页面堆叠」：四角+上下边锚定，核心信息放角落，视线不离开中心战场。
- 面板 dock 化优先于 modal：编队/详情/排行榜/Admin 做成左右 dock 抽屉（320–480px 固定宽），可开关不遮罩战场；modal 只留破坏性确认。

**4.2 输入范式**
- **Hover tooltip 是一等信息载体**：棋子/装备/羁绊/敌人/波次图标 hover 200–300ms 出 tooltip，内容对齐移动端「长按详情」，支持「钉住」（悬停进 tooltip 不消失可滚轮翻页，Dota 2 做法）。
- **右键 = 上下文/快捷操作**：右键出售、右键打开干员菜单、右键关闭面板。
- **快捷键体系照抄自走棋/MOBA 事实标准**：D 刷新商店、F 购买经验、E 出售光标下棋子、空格=加速/暂停、数字键 1–8 切棋盘、Esc 关闭最上层、Enter 确认。所有快捷键可重映射（WCAG 2.1.4）。
- **方向键/WASD 网格导航**：编队网格/皮肤列表/商店行支持方向键+Enter，焦点循环规则按 XAG 112。
- **滚轮双职责**：战场滚轮=缩放；悬停在列表/表格上滚轮=滚动该列表（悬停捕获）。
- 桌面单击即选中，避免移动端「长按」（桌面不可发现）；双击仅作加速且必须有单击等价路径。

**4.3 响应式断点与超宽屏**
- 桌面侧断点 3 个：**<1280（兼容档，密度向移动靠拢）/ 1280–1919（基准布局，全部 dock 可用）/ ≥1920（同布局放大间距）**；2560+/4K 不改布局靠 UI scale。
- **超宽屏（21:9/32:9）**：主 HUD 锁定中心 16:9 安全区（参考 Destiny 2 HUD safe-area 内收），多出的侧边宽度给玩家列表/聊天/羁绊追踪器等二级 dock；32:9 宁可两侧留氛围背景，不要把商店条拉满全宽。
- 字号 token：正文 ≥18px @1080p 等效，大标题 ≥36px；文本可放大 200% 不丢内容。

**4.4 窗口与可定制**
- **UI scale 滑条 50%–200%**（FF14/WoW 通行范围），5% 步进实时预览，作用在根 rem/scale token。
- 面板定制三档：开关+位置预设（必做）→ 宽度拖拽（应做）→ 自由重排+重置布局（进阶）。布局按「断点×账号」持久化。
- 高对比模式 ≥7:1，正文 ≥4.5:1，HUD 颜色可改。

**4.5 Web 栈桌面化**
- `@media (pointer: fine)` / `(hover: hover)` 是移动/桌面交互分层的正确开关；混合设备用 `any-pointer`/`any-hover` 兜底。**hover 只做增强不做唯一路径**，所有 hover 信息必须有 click/键盘等价获取方式。
- focus-visible 可见焦点环；键盘可达性清单（WCAG 2.1/2.4）：全部功能键盘可操作、无键盘陷阱、焦点顺序符合视觉流、焦点可见、单字符快捷键可禁用/重映射。
- 模态桌面行为：焦点圈禁、Esc 关闭、点击遮罩关闭、关闭后焦点还原。
- 桌面专属细节：自定义光标（可购买/可放置/不可放置三态）、拖拽 pointer capture 并处理窗口失焦取消、聊天/ID 文本可选中（战场文字禁选）、`contextmenu` 接管右键、窗口 blur 自动暂停（PvE 段）。

**4.6 塔防/自走棋桌面 HUD 细节**
- **底部商店条**：居中固定高度（屏幕高 12–16%），内容区限宽（1440 下约 900–1100px，不拉满全宽）；从左到右：刷新(D)/购经(F)+金币 → 5 格商店位 → 锁定/其他。板凳紧贴商店上方一行 9 格。**常驻，不做点按钮弹出。**
- **干员详情面板**：默认**右侧 dock**（320–400px，可切左/隐藏），选中棋子时更新；不要在战场中央弹详情浮窗（挡战场是塔防大忌）。
- **战场缩放平移**：滚轮以光标为中心缩放（0.8×–2× 边界钳制）；平移三选二（中键/右键拖拽 + 空格拖拽 + 边缘推屏可关）；提供「重置视角」快捷键。
- **波次信息**：顶部中央当前波次/总波次 + 下一波倒计时 + 敌人构成预览图标（hover 出详情）；「呼叫下一波提前开始（奖励）」按钮放倒计时旁。
- **速度控制**：1×/2×/3× 与暂停放顶栏右侧或商店条右端，空格切换。
- **聊天/表情**：左下角可折叠聊天面板（Enter 打开 Esc 关闭），不打字自动淡出；表情/ping 用快捷键或战场右键轮盘。
- **玩家列表**（血/排名/羁绊）放左侧边栏，数字键跳转其棋盘。
- **结算**：中央战报卡片 + 左右分栏（伤害统计/经济曲线）同屏，不做移动式多页翻页；排行榜/Admin 用桌面表格（排序列、筛选条常驻、行 hover 高亮、密度切换）。

---

## 5. 桌面端设计方案（逐界面）

按「收益×成本」排序。**第一阶段（必做，收益最大）** = 断点系统 + 桌面覆盖层骨架 + hover/快捷键/详情面板 dock 化 + 语音抽屉改造 + rotate-hint 修正。

### 5.1 全局基础（先于所有界面）

1. **断点系统重做**：把散落的 640/700/760/767/900/1000/1100/1200 + 多种高度断点合并为桌面侧 3 档：**`<1280 / 1280–1919 / ≥1920`**，移动端档保留（sm 640 / md 768 / lg 1024）。桌面断点用 `min-width` 方向（现全库 0 处），只在 `*.desktop.css` 出现。
2. **新增 `desktop.css` 桌面正向覆盖层**：在 `index.html:46-47` 之间插入（mobile.css 后、devices.css 前），或按 GLOBAL_VOICE §3.2 拆成各 `<screen>.desktop.css`。前缀统一 `html.sp-hover:not(.sp-coarse)`，做成与 mobile.css 对称的「桌面加法」层。
3. **mobile.css 拆分**：按既定决议把 389 行杂烩解散到各 `<screen>.mobile.css`，媒体查询只在 mobile/desktop 层出现。
4. **rotate-hint 触发条件收紧**（`theme.css:411`）：`(orientation: portrait) and (max-width: 1024px)` → 加 `and (pointer: coarse)`，避免桌面窄窗口（分屏/小窗）被「请横屏」误伤。
5. **safe-area 变量隔离**：`--sa-*` 桌面恒为 0 的噪音规则收进 mobile 层，desktop 层不引用。
6. **UI scale 滑条**：设置页加「界面缩放 50%–200%」，作用根 rem token；叠加「文字大小四档」（接上游 #435，已定案）。
7. **键盘可达性**：全局 focus-visible 焦点环；Esc 关闭最上层面板 + 焦点还原；单字符快捷键在设置里可禁用/重映射。

### 5.2 对局 HUD（收益最大，桌面体验主战场）

- **详情面板 `.dpanel` 从浮窗改右侧 dock**：现 `game-panels.css:52` 绝对定位 left 2.3rem/top 2.22rem 浮在战场上。桌面改为右侧固定 dock（320–400px，可切左/隐藏），选中棋子/干员时更新，不遮战场。位置/开关持久化。
- **商店条限宽居中**：`game-shop.css` 桌面端内容区限宽约 900–1100px 居中，不拉满全宽；刷新(D)/购经(F)+金币 → 商店位 → 锁定。快捷键已有（D/F/Space），补齐 E 出售、数字键切换。
- **hover tooltip 全面铺开**：棋子/装备/羁绊/波次图标 hover 200–300ms 出 tooltip，内容同源移动端长按详情；tooltip 支持钉住。战场战场缩放：滚轮以光标为中心 0.8×–2×。
- **波次/速度**：顶栏已有回合数+倒计时，补「下一波敌人构成预览（hover 详情）」与「呼叫下一波」按钮；速度 1×/2×/3× + 空格暂停放顶栏右侧。
- **玩家列表侧边栏**：多人对局血量/排名/羁绊放左侧边栏，数字键跳转。
- **聊天面板**：左下角可折叠，不打字自动淡出；现 `game.css:871` 窄屏宽度 `min(56vw, 4rem)` 的桌面分支重做。

### 5.3 干员调配 / 装备 / 盟约 / 统计（全屏 overlay 群）

现 `.lo`（`loadout.css:9-18`）、`.st`、`equipment.css:10`、`alliances.css:10` 全是 `position:fixed; inset:0` 全屏覆盖，桌面打开完全吃掉背景。

- **桌面形态改为「中央非模态窗口」或「右侧 dock + 可拖宽」**：保留背景可见，可开关不遮罩；`.lo` 双列 `1fr+7rem` 在桌面升级为**干员调配 4 列**（GLOBAL_VOICE §3.5 已定案）。
- **统计 Stats 从单列滚动改多栏仪表板**：现单列滚动（`stats.css`），桌面改 2–3 列卡片网格，断点 1280/1920 分列数。
- **键盘导航**：Loadout `.lo-grid`、Lobby `.mode-cards`、BandDraft `.dband` 加方向键网格导航 + Enter 确认 + 焦点环。

### 5.4 语音选择器 `.lo-sheet`（桌面适配度 0，最刺眼）

现 `loadout.css:776-801` 是 `position:fixed; align-items:flex-end; max-height:70vh` 的 **iOS 底部弹出**，纯手机范式。

- **桌面端彻底废弃 bottom sheet**：按 GLOBAL_VOICE §2.2 已定案，桌面用**原生 `<select>`**（voicePicker.js 已有 coarse→底部弹层 vs 桌面原生 select 的分支，`voicePicker.js:95`）；确认桌面分支走原生 select，移除桌面上的 `.lo-sheet` 底部弹出。若需更丰富的列表，改**右侧抽屉**或**居中 Modal**，不做贴底弹出。

### 5.5 大厅 / 房间 / 简报 / 选秀 / 结算

- **超宽屏扩展**：`lobby.css:10` max-width 19.2rem（=1920px）在 2560/4K 只有中央一条；放宽到 24–28rem 或拆 3–4 列。`room.css:44` 座位固定 3.8rem×4、`draft.css:7` 左右固定像素、`result.css:11` 左列固定 560px、`briefing.css:36` 左列固定 620px——宽屏都不受益，改弹性或加桌面断点。
- **结算 Result 补桌面断点**：现零断点，1280 宽即溢出；改「中央战报卡片 + 左右分栏（伤害/经济）」同屏。
- **键盘导航**：大厅模式卡/房间座位/选秀卡片加方向键 + Enter。

### 5.6 Admin / Dashboard

- **风格统一到 theme.css design tokens**：`admin/admin.css` 用独立变量（`--bg-base/--mint`），与 `theme.css`（`--bg-0/--mint-500`）双轨并行，重做时对齐。
- **Dashboard 作模板**：`dashboard.html`（max-width 1440 + 1024/1100/600 断点 + 4/2/1 列网格）是项目内最桌面优先的现成范例，其他界面重写可参考其密度与断点思路。
- **Admin 补断点**：现几乎无响应式（只 max-width 1400px）；mod 上传步骤条桌面 ≥720px 横向（已定案）。

### 5.7 私密房 / 匹配 / mod 管理（已定案方向，直接实施）

按 §3 既有决议落地，桌面端形态已明确：匹配弹窗通栏主按钮；私密开关 `.set-seg`；mod 目录浏览器居中 Modal 三列网格 + 键盘 ←/→；mod 徽标 hover tooltip；PackFetchGate 居中 480px；admin mod 上传桌面横向步骤条。**注意 HANDOFF 提醒：正式实现必须走 Preact 状态，不能靠 DOM 注入（4 秒大厅广播会冲掉注入节点）。**

---

## 6. 实施路线（分阶段）

**阶段 1｜基础层（1–2 周，纯 CSS+少量 JS，零风险）**
- 断点系统重做（桌面 3 档 min-width）
- 新增 `desktop.css` / 各 `<screen>.desktop.css` 骨架，前缀 `html.sp-hover:not(.sp-coarse)`
- rotate-hint 触发加 `pointer: coarse`（修桌面误判）
- UI scale 滑条 + 文字四档（接已定案）
- 全局 focus-visible 焦点环 + Esc/Enter 焦点管理
- 语音选择器桌面走原生 `<select>`，移除桌面 bottom sheet

**阶段 2｜对局 HUD（2–3 周，收益最大）**
- 详情面板右侧 dock 化（可切左/隐藏，持久化）
- 商店条限宽居中 + 快捷键补齐（E 出售/数字键）
- hover tooltip 铺开（棋子/装备/羁绊/波次）+ 钉住
- 战场滚轮缩放 + 平移 + 重置视角
- 玩家列表侧边栏 + 聊天面板重做

**阶段 3｜全屏 overlay 群改造（2–3 周）**
- Loadout/Equip/Alliance/Stats 桌面改非模态窗口/右侧 dock，干员调配 4 列
- Stats 多栏仪表板
- 全界面方向键网格导航

**阶段 4｜超宽屏 + Admin + 收尾（1–2 周）**
- Lobby/Room/Result/Briefing/Draft 宽屏弹性布局
- Admin 风格统一到 theme tokens + 补断点
- 结算桌面分栏
- 私密房/匹配/mod 管理按既定决议实施

**验证**：每屏双端截图基线（desktop Chrome 1280/1920/超宽 + 手机视口）落 `docs/ui-reference/`；结构化自检（样式来源/字体/破图/塌陷/文字裁切）+ 人工审美过目（visual-judge 本环境不可用）。

---

## 7. 红线（勿违反）

1. 端判定只用 `sp-hover` / `sp-touch && sp-coarse`，**绝不按 UA、绝不按窗口宽度**做功能分叉。
2. 媒体查询只允许出现在 `*.mobile.css` / `*.desktop.css`；静态 `<link>` 加载，不搞运行时按端注入。
3. 桌面 hover 只做增强不做唯一路径，所有 hover 信息必须有 click/键盘等价获取方式。
4. 不整文件覆盖上游 UI；要功能按 device.js 特性类 + CSS 三层制重写并双端截图比对。
5. 正式实现走 Preact 状态，不靠 DOM 注入。
6. 界面数据驱动、包无关，筛选/分组/排序由 `data.list/lookup` 派生，不写死 id/枚举。

---

## 8. 关键文件索引

- 体系与端判定：`public/js/ui/device.js`、`public/css/theme.css`、`public/css/components.css`、`public/css/devices.css`、`public/css/mobile.css`
- 界面代码：`public/js/screens/*.js`、`public/js/ui/*.js`、`public/css/screens/*.css`
- 站外页：`public/admin/index.html` + `admin/admin.css`、`public/dashboard.html`（桌面模板）
- 构建开关：`shared/capabilities.js`、`scripts/pack/{index,desktop,mobile,server}.mjs`
- 既定决议：`docs/GLOBAL_VOICE_TRI_UI_ENDLESS_PLAN.md`、`docs/CF_MOD_TRI_PLAN.md`、`docs/ENDLESS_MOD_DUAL_PLATFORM_PLAN.md`、`docs/MOD_UI_ADAPTATION_PLAN.md`、`docs/MATCHMAKING_PRIVATE_ROOMS_PLAN.md`、`docs/SKIN_SHOP_PORTRAIT_PLAN.md`
- 样式基线与 mockup：`docs/mockups/README.md`、`docs/ui-reference/index.html`

---

*本报告由四路并行调研（界面清单盘点 / 双端适配体系 / 既有 UI 决议 / 外部 PC 最佳实践）汇总而成，供电脑端 UI 重设计研讨定稿。*

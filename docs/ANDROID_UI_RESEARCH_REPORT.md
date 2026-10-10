# 安卓端 UI 设计调研报告（全界面最佳方案）

> 日期：2026-10-10 ｜ 对象：`feature/v0.2.1-fusion-master`（sp-upgrade-2.1）
> 性质：**调研与选型报告**——只给结论与方案，不含实施改动。
> 调研依据：本仓库代码实况（`public/`、`android/`）、已定稿规划（`docs/GLOBAL_VOICE_TRI_UI_ENDLESS_PLAN.md` 等 6 份）、既有 mockup（`docs/mockups/`、`docs/ui-reference/`）、品类惯例（Arknights / Vampire Survivors / CR / TFT 手游）、硬规范（Material 3、Apple HIG、WCAG、Android Developers、web.dev）。

---

## 0. 一页结论（TL;DR）

1. **方向：维持锁横屏（`sensorLandscape`），不做竖屏适配投入。** 核心交互是"往战场精确放子"，与 Arknights/CR/TFT 同约定；竖屏只有 3 张真机截图在用且非主战场。省下的预算全投到横屏单手拇指区优化。
2. **端判定：继续走 device.js 特性类（`sp-touch && sp-coarse`），永不嗅探 UA、永不用宽度断点当端判定**（红线，主人已拍板）。Android 壳的存在用 `AndroidNative.isNativeApp()` 就地判断，不进 html 类。
3. **CSS：按定稿三层制执行——`<screen>.css`（结构，端无关）→ `<screen>.desktop.css` → `<screen>.mobile.css`；现有 542 行 `mobile.css` 杂烩按屏解散。** 全部静态 `<link>`，不搞运行时按端注入（LAN/离线红线）。
4. **每屏形态选型**（详见 §4）：**弹层全改底部动作面板（bottom sheet）、全屏工具屏改"列表/详情双态"、战斗 HUD 改"顶部信息带 + 底部商店带 + 右下拇指技能区"**。详细到每个界面见 §4 逐屏方案。
5. **战斗交互：部署/移动保持现有拖拽为主，新增"点选→点目标格"为并行路径**（Arknights 模型），两手抓；高刷/热降频/2D 降级链路已就绪，只需把 UI 反馈做满。
6. **硬指标**：触控命中 ≥48×48dp、间距 ≥8dp；正文 ≥14sp、HUD 关键数字 ≥18–20sp；动画只用 `transform/opacity`、单位根节点 `contain: layout paint`、对象池复用节点。

---

## 1. 平台硬约束（安卓 WebView 壳实况）

来源：`android/app/src/main/`、`docs/ANDROID.md`、`public/js/ui/device.js`、`public/css/devices.css`。

| 约束 | 实况 | 对 UI 的含义 |
|---|---|---|
| 打包形态 | 自研单 Activity WebView + 内嵌 Node（`libnode.so`），WebView 连 `127.0.0.1:3000`；`minSdk 24 / targetSdk 34`，仅 arm64-v8a | 不是浏览器——没有 URL bar，但有 WebView 全部怪癖 |
| 方向 | Manifest 锁 `sensorLandscape`，`configChanges` 自理旋转 | **横屏是第一公民**；UI 只需考虑横屏 + 少量竖屏兼容 |
| 刘海/cutout | `LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES` + 主题 `windowFullscreen=true`；另有原生 edge-padding 滑块（0–200px）同时作用于 WebView | safe-area 语义已被壳接管：`mobile.css:8-10` 把 `--sa-l` 清 0，**左侧安全区在安卓端实际为 0**；设计新 UI 时别把关键按钮贴左缘 |
| 状态/导航栏 | `enableFullscreen()` 隐藏系统栏（瞬态滑出），`FLAG_KEEP_SCREEN_ON` 常开 | 沉浸式已就绪；但**重进/onResume 后要恢复隐藏**（见 §5 坑） |
| 字体缩放 | `textZoom = 100` 硬锁，屏蔽系统 fontScale | 战斗 HUD 不会崩版；但设置/大厅文字界面若用 rem 仍会受系统字体影响（WebView 对 sp/em 生效）——见 §5.5 |
| 缩放/手势 | `useWideViewPort`、禁双指缩放、禁 ctrl+wheel、`touch-action: pan-x pan-y` 于 html、`manipulation` 于控件、`none` 于战场 canvas | 300ms 点击延迟已由 viewport meta 消除；橡皮筋/下拉刷新需 CSS `overscroll-behavior: none` 兜底 |
| 黑屏自救 | 12s 看门狗 + `reportClientState` + 渲染崩溃自动降 2D + `enableCompatMode()` | UI 必须给"降级到 2D/DOM 棋盘"留视觉态（不能依赖 WebGL 专属效果） |
| 高刷/热 | `isHighRefresh/setHighRefresh` 桥 + `__SP__.onThermalThrottle(bool)` 反推页面 | 高刷开关已在设置里；热降频时 UI 应自动减动画（接 `prefers-reduced-motion` 同款令牌） |
| 性能基线 | 硬件层默认关（老 OEM GPU 强开会黑屏）；渲染崩溃自动降 2D | 同屏多单位的战斗 HUD 必须按"合成器-only 动画 + 对象池"设计（§5.4） |

**双平台三轴模型（已定稿，不可违反）**：`device.js` 特性类 / `AndroidNative` 桥 / bundle tier（握手 `client.platform` + `client.bundle`）。判定"手机才加载"用 `sp-touch && sp-coarse`；"桌面才加载"用 `sp-hover`；判定"安卓壳"用 `AndroidNative.isNativeApp()`；判定资源档位用 `client.bundle`。

---

## 2. 设计基线（沿用现有视觉语言）

来源：`public/css/theme.css` + `components.css` + `devices.css`。**不改视觉，只改布局与交互。**

- **色彩**：near-black 绿灰表面（`--bg-0:#0c0f0e … --bg-4:#2d3632`）、薄荷绿主色（`--mint-500:#4ed8af`）、金色价格（`--gold:#ffc600`）、难度色（funny 琥珀 / normal 橙 / hard 红 / abyss 深红）、干员阶级 I–VI 色阶。描边 `--line/#2f3a35` 系。
- **字体**：CJK 正文 Noto Sans SC 系；数字 Bender/Rajdhani/Oxanium（Bender 为自带字体）；标题 Novecento/Oxanium。
- **标尺**：root `font-size: clamp(40px, min(100vw/19.2, 100svh/10.8), 240px)`——**844×390 安卓横屏下 1rem = 40px**。所有屏内尺寸用 rem 即自动随屏缩放；字号下限统一 `max(.xxrem, 8px)` 兜底（`devices.css` 现有模式）。
- **命中**：`--tap-min: 44px` 已在 `--tap-min` 令牌；安卓端按 §5.1 提到 **48dp**（Material 3）作为新组件基准，旧组件随三层制重构逐步抬升。
- **安全区**：`--sa-t/r/b/l = env(safe-area-inset-*, 0px)`；非战斗 `.screen` 收进 safe-area，战场画布全出血。**安卓端 `--sa-l` 为 0**（壳接管）。
- **动效**：`--ease-out`、`--t-fast/med/slow`；`prefers-reduced-motion` 全局缩短。
- **层级**：`--z-screen:1 / banner:40 / conn:60 / modal:80 / toast:90 / tooltip:95 / rotate:100`。

**安卓端新增令牌建议**（写入 `devices.css`，与现有体系同层）：

```css
:root {
  --tap-min-android: 48px;            /* Material 3 */
  --thumb-zone-r: 38vw;               /* 右下拇指自然弧半径（横屏） */
  --sheet-h-max: 72svh;               /* 底部动作面板最大高 */
  --sheet-radius: .14rem;             /* 面板圆角（沿用 bracket 语言的圆角化变体） */
}
```

---

## 3. 全局 UI 模式选型（4 个跨屏决策）

### 3.1 弹层体系：底部动作面板（bottom sheet）取代居中对话框

**现状**：设置、退出确认、房间列表（MatchmakingModal）、机变/奖励、敌方情报、装备替换等全部是居中模态；`voicePicker.js` 已有唯一先例——桌面 `select`、手机底部弹层（`loadout.css .lo-sheet*`）。

**选型**：**安卓端所有"选择/确认/详情"类弹层统一改为底部动作面板**。理由：
- 拇指区在下缘（Hoober 1,333 人研究：单手 49%、右拇指 67%），居中模态的确认钮常落在拇指够不到的中上区；
- 底部面板可被下滑手势关闭，符合触屏直觉；
- 与 `voicePicker` 已有先例一致，组件可复用。

**规格**：
- 从底部滑入（`transform: translateY(100%) → 0`，200ms `--ease-out`），背后半透 scrim（`rgba(6,9,8,.6)`）点击关闭；
- 高度 `min(内容, var(--sheet-h-max))`，顶部拖把手（12×2 胶囊）+ 标题行 + 关闭钮（右上，命中 48dp）；
- 主操作钮放面板**底部**（拇指最近处），危险操作（离开/移除）用 `--red` 描边区分；
- 面板内列表项高 ≥48dp；超过一屏用内部滚动（`touch-action: pan-y`）。
- **应用清单**：设置、退出确认、匹配房间列表、机变/奖励选择、敌方情报抽屉、装备替换、语音/皮肤选择、MOD 管理的 README/操作菜单、干员详情卡（见 §4.5）。

**例外**：纯信息 Toast、连接横幅（ConnectionBanner）保持顶/底条；`UiHosts` 命令式确认对话框保留居中（频率极低，且要用户停手确认）。

### 3.2 全屏工具屏：列表/详情双态（master-detail）取代桌面多栏

**现状**：干员调配（`loadout.js` 718 行）桌面是"左 112 网格 + 右详情"双栏；装备/盟约 codex 桌面宽表；统计 4 tab。844×390 上双栏被压到不可读（现状靠 `max-width:767px` 媒体查询硬压字号）。

**选型**：**安卓端全屏工具屏统一"列表/详情双态"**：默认全屏列表；点条目全屏切到详情；详情左上"‹ 返回"。参考 `docs/mockups/fusion-3-devices.png` 已渲染的"安卓 844×390 列表/详情"对应关系。

**规格**：
- 列表：左图右文行（高 ≥56dp），顶部吸顶筛选条（tier/class/bond/搜索）横滑；
- 切换用 `transform: translateX` 过场（150ms），保持返回栈；
- 应用：**干员调配**（网格→详情）、**装备 codex**、**盟约 codex**、**统计**、**MOD 管理**、**皮肤选择**（归入详情子页，见 §4.6）。

### 3.3 导航：一级入口外露 + 二级收纳，不用 bottom nav

**现状**：标题屏右上统计/MOD + 登录框三键；大厅顶部导航已有 6 个入口（装备/盟约/MOD/帮助/干员调配/无尽排行榜）+ 公告条；移动端 `mobile.css` 隐藏了标题屏右上重复入口。

**选型**：游戏大厅不用 Material bottom nav（工具 App 范式），沿用**全屏场景化边缘入口**：高频入口外露、低频收纳进一个"更多"底部面板。
- **一级外露**（每屏最多 5 个，命中 ≥48dp）：开始/无尽、干员调配、设置；
- **二级收纳**：装备/盟约 codex、MOD、帮助、统计、排行榜 → 收进右下"☰ 更多"底部面板；
- 公告条保留大厅顶部，但在 `sp-coarse` 降为单行跑马灯（`Ticker` 复用）。

### 3.4 横竖屏：锁横屏，竖屏仅"可用不优化"

- Manifest 已锁 `sensorLandscape`；Web 侧 `rotate-hint`（`index.html:74-79`）提示横屏——**保留此提示作为竖屏唯一投入**。
- 联机合作锁横屏（队友间战场几何一致）；单人/无尽未来若要竖屏，按模式分流另行立项，**本期不做**。
- 真机竖屏截图（`screen_lobby.png` 等 3 张）证明有人在竖屏看大厅——竖屏下大厅/标题保持"能看不崩"即可，不做专属布局。

---

## 4. 逐界面最佳方案

> 每屏给：现状 → 安卓最佳方案 → 关键规格。文件引用为现状锚点。

### 4.1 标题屏 TitleScreen（`screens/title.js` + `css/screens/title.css`）

**现状**：战术雷达背景 + 标题 + 昵称输入 + 开始钮 + 三键（无尽/统计/MOD）+ 右上统计/MOD；移动端已隐藏右上重复入口、登录框加宽、三键网格化；`detectFeatures().coarse` 关 autoFocus。

**安卓最佳方案**：保持"雷达主视觉 + 底部登录/入口区"单屏架构，按拇指区重排：
- 昵称框 + **开始**大钮置于下缘中央偏右（拇指弧内），开始钮高 ≥56dp、宽 ≥40vw，主色 mint；
- **无尽模式**（本地化后为主入口之一，D6）与开始对置左下，次强样式；
- 统计/MOD/帮助/设置收进右下"☰"底部面板（与 §3.3 一致），右上角完全腾空给服务器负载徽章（现 `mobile.css` 隐藏 ServerLoadBadge——保留隐藏，改在"更多"面板内显示一行文本）；
- 昵称输入：点按才弹软键盘（现状已对），键盘弹出时登录区整体上移（用 `--sp-vh` 已有令牌，避免被键盘遮）。

### 4.2 大厅 LobbyScreen（`screens/lobby.js` + `css/screens/lobby.css`）

**现状**：左栏 01 模式 / 02 匹配 / 03 加入，右栏 04 难度 / 05 无尽；MatchmakingModal 居中房间列表；顶部 6 入口 + 公告条；`AndroidNative.findRoom/connectToHost` 局域网搜房。

**安卓最佳方案**：**改单列纵向流（横屏内单列居中带，最大宽度 ~62vw）**，从上到下：公告条（单行跑马灯）→ 模式卡（独立/同盟 2 卡横排）→ 难度选择（4 胶囊横排，选中态难度色描边）→ **无尽大卡**（D5 定稿双端同带无尽，独立卡片保留）→ 主操作区：
- **主操作三选一外露大钮**：`快速匹配`（主）/ `创建房间` / `加入房间`（输邀请码）——不再藏进 02/03 编号步骤；
- **房间列表**改底部面板（§3.1）：列出公开房间（4s 自刷现状保留），行内"加入/观战"；顶部加"局域网搜房"入口（调 `AndroidNative.findRoom`）；
- 顶部 6 入口按 §3.3 收纳（外露：干员调配、设置；其余进"更多"）；
- 私密/公开切换（`:618-625`）保留在创建房间底部面板内。

### 4.3 房间屏 RoomScreen（`screens/room.js` + `css/screens/room.css`）

**现状**：4 座位卡 + 房主控制（难度/加减 AI/开始）+ 邀请码/复制链接 + 就绪 + 离开 + 观战席。

**安卓最佳方案**：
- **座位区 2×2 网格**（横屏天然适配），座位卡含头像/就绪态/AI 标/房主冠；点自己座位弹底部面板（换皮肤/语音快捷入口——接 `skinPicker`/`voicePicker` 的 sheet 形态）；
- **底部固定操作带**（安全区上方）：左 `离开`（次）→ 中 `邀请码`（点按复制 + 原生分享若有）→ 右 `就绪/开始`（主，≥56dp 高，准备就绪后 mint 实色）；
- 房主控制（难度/AI/开始）收进"房间设置"底部面板，仅房主可见入口；
- 观战席（`:148`）折叠为一行"观战 N ›"，点开底部面板列观战者（房主可移除，接 0.2.2 §27.50 SpectatorPill 语义）。

### 4.4 干员调配 LoadoutScreen（`screens/loadout.js` 718 行 + `css/screens/loadout.css` 803 行）

**现状**：全屏 overlay，3 顶层 tab（编队/持有/自选），桌面左 112 网格右详情；语音子 tab 是融合线超上游部分；皮肤 SkinSection 挂详情。

**安卓最佳方案**：**列表/详情双态（§3.2）**：
- **列表态**：顶部 3 tab + 吸顶筛选条（tier/class/bond/搜索/仅看已调整，横滑）；干员网格 4–5 列（844×390 下卡 ≥64dp 含阶级色边框）；
- **详情态**：点干员全屏进入，顶部"‹ 返回 + 干员名"，内容分 4 子 tab（技能/模组/数值/换装）+ 融合线第 5 子 tab"语音"——子 tab 用顶部胶囊横滑，内容区纵向滚动；
- 换装子页：皮肤单列大图列表（`skin_avatar` 273 张，缩略图懒加载 + `content-visibility` 省绘制），选中写 localStorage + `room.skins`（现状链路保留）；
- 语音子页：沿用 `voicePicker` 底部面板大按钮列表（已有 phone 渲染 `voice-switch-phone.png`，740×390）；
- 恢复默认等危险操作：底部面板内二次确认。

### 4.5 战斗屏 GameScreen（`screens/game.js` 1428 行 + `game.css`/`game-panels.css`/`game-shop.css`）——**本报告核心**

**现状**：三层叠放——战场 canvas 全出血（z0）→ vignette（z1）→ HUD（z3）；顶栏 TopBar（左 出口+ping / 中 回合+阶段+LP+信息 / 右 倒计时+就绪）；底部 ShopBar（LEVEL 卡 + 3–5 干员卡 + 道具卡 + 资金卡 + 放置/冻结/刷新）；长按 = 详情卡（520ms）；部署/移动走 `render/drag.js` 拖拽（含拖到自身格转朝向轮盘 FacingWheel）；temp 整备区有棋盘上标框 + 就绪钮下提示。

**安卓最佳方案——"顶部信息带 + 底部商店带 + 右下拇指区"**：

1. **顶部信息带**（高度 ≤.9rem，收进 safe-area）：
   - 左：退出 + ping + 观战胶囊；
   - 中：回合/阶段胶囊 + LP 塔 + 敌方预览 🔍（保留现有双 CheckBtn）；
   - 右：倒计时（Boss 回合 120s 红 DOT 警告保留）+ 暂停（单人）+ 设置齿轮。
   - **暂停/设置归右上簇**（塔防强约定，Arknights/Kingdom Rush/Bloons 同位），不再散放。
2. **底部商店带**（ShopBar，高频交互带）：
   - 干员卡**居中收拢而非拉满全宽**：3–5 张卡总宽控制在 ~60vw 内，两端留白给"资金卡（收起 ✕）"（左）和"刷新/冻结"（右）；
   - 每卡命中 ≥48dp；**去掉 ⓘ 角**（playtest #6 item 10 已确认 44px 热区盖确认条）——详情统一走**长按卡片**（520ms 现有机制）或卡片上滑；
   - 双击购买两段确认在触屏改为**点按一次出确认条→再点确认**（现状双击在触屏不可靠）；
   - 可放置数/冻结/刷新按钮实体放大（`devices.css` 矮屏档已有先例）。
3. **部署/移动交互：双轨并行**：
   - **主轨·点选→点目标**：点商店卡 → 战场合法格高亮（`canPlace` 复用 drag.js 的合法性计算）+ 卡片 ghost 跟随 → 点目标格放下；再点空白/按返回取消。这是 Arknights 模型，误触率低、无长距离拖动；
   - **副轨·拖拽**：保留现有 `render/drag.js` 全链路（拖到落点、拖到自身格出 FacingWheel 转朝向、拖到 temp 区）；熟练玩家一步操作；
   - 两轨共用合法性/高亮/ghost 视觉；朝向调整在点选轨下 = 放子后**点该子 → 底部弹出 FacingWheel 面板**（替代拖拽甩向）。
4. **temp 整备区**：保留棋盘标框 + 就绪钮下"N 个待处理"提示；新增**点 temp 区标框 → 底部面板列出待处理件**（可直接从面板拖到棋盘/出售），解决小屏上 temp 件难看清的问题。
5. **详情卡 DetailPanel**（845 行）：桌面右侧浮卡 → **安卓改底部面板**（§3.1）：长按任意单位/装置/干员卡弹出，含实况数值、攻击范围（0.2.2 §27.30 inspectRange 保留）、语音播放钮；下滑关闭。
6. **奖励/机变（RewardOverlay/ChoiceOverlay）**：居中三选一 → **底部面板大卡纵向三选**（每卡高 ≥64dp，单手可达）；敌方情报 EnemyDrawer 右侧抽屉 → 底部面板带 tab。
7. **队友面板 TeamPanel / 盟约条 BondStrip / 跑马灯 Ticker / 表情轮 EmoteWheel / 聊天 ChatBox**：
   - TeamPanel 桌面侧栏 → 安卓收进顶部信息带左下"队友 N ›"底部面板；
   - BondStrip 保留顶部细条，点开 BondPopup 用底部面板；
   - EmoteWheel 保留轮盘（触屏友好），触发钮放右下拇指区；
   - ChatBox 输入：点按展开到底部输入条（`adjustResize` 已配），战场不缩。
8. **性能红线（同屏多单位）**：
   - HUD/商店/面板动画只用 `transform/opacity`；血条用 `transform: scaleX()`；
   - 战场单位根节点 `contain: layout paint`；拖拽 ghost `will-change: transform`（仅拖拽期间）；
   - 单位节点对象池复用，不随生死增删 DOM（fallbackField 同理）；
   - 热降频（`__SP__.onThermalThrottle`）时：关 vignette 径向渐变动画、降 Ticker 频率、停非关键 glow——接 `prefers-reduced-motion` 同一令牌；
   - 渲染崩溃自动降 2D 时，HUD DOM 结构不变（现状已分层），但所有依赖 WebGL 视觉的 UI（如 3D 棋盘上的合并高亮）必须有 fallbackField 等价物。

### 4.6 战斗阶段屏：Briefing / BandDraft / Result

- **Briefing（`screens/briefing.js`）**：本局信息 1/2 确认——两列信息卡改单列纵向流，底部固定"确认/下一"主钮（≥56dp，右下）；
- **BandDraft（`screens/bandDraft.js`）**：策略 2/2 选择——候选策略改底部大卡纵向列表（同 §4.5.6）；已禁干员/盟约回看（#8 已修的 MatchInfoDialog）用底部面板；
- **Result（`screens/result.js` + ResultView）**：结算数据桌面多栏 → 安卓单列纵向流（战绩→伤害/经济图→干员表现），**底部固定双主钮**：`再来一局`（主，直接回房间，联机链路关键）/ `返回大厅`（次）；统计屏重看结算复用此布局。

### 4.7 装备总览 EquipCodex / 盟约总览 AllianceCodex（`screens/equipment.js`、`screens/alliances.js`）

- 全屏只读 overlay → **列表/详情双态**（§3.2）：列表行 = 图标 + 名称 + 盟约归属；详情态全屏展示普通/精锐对照；
- 包无关性（MOD 注入自动多出条目，`MOD_UI_ADAPTATION_PLAN` 已定）不变——列表天然容纳动态条目；
- 顶栏加盟约/部位筛选横滑胶囊。

### 4.8 统计 StatsScreen（`screens/stats.js` + `ui/stats.js`）

- 4 tab（总览/策略/战斗累计/对局记录）→ 顶部 4 胶囊横滑 + 内容单列流；
- 对局记录：列表行（时间/难度/结果/时长）→ 点行进 ResultView 双态（复用 §4.6 结算布局）；
- "本机数据"标注保留顶部。

### 4.9 设置 SettingsModal（`ui/settings.js`）

- 居中模态 → **底部全高面板**（`var(--sheet-h-max)` 用满）：
  - 分组：音量（BGM/SFX/Voice 滑块 + 语音语言 cn/jp 默认 jp，D1）/ 画面（伤害数字/画质/高刷新率——高刷调 `AndroidNative.setHighRefresh` 现状保留 / 棋盘视角）/ 联机（服务器 URL）/ 安卓本机服务（服务器设置/重启引擎/运行日志/重载页面——仅 `AndroidNative.isNativeApp()` 显示，现状已对）；
  - 滑块拇指 ≥48dp 宽；每行高 ≥56dp；
  - 快捷键提示在 `sp-coarse` 隐藏（现状 `:165-167` 保留）。

### 4.10 MOD 管理 ModUploadModal（`ui/modUploadModal.js`）

- 居中模态 → **全屏列表/详情双态**：列表 = 已装 MOD（启用开关/版本/大小）+ 底部"导入 .zip"主钮 + "服务器包"区（`/api/packs` 探测）；详情态 = README 展开 + 启用/停用/移除（底部面板二次确认）；
- 导入走系统文件选择器，进度条置顶；存储/生效链路（`modStorage`/`modSync`，10-10 并行会话三件套）UI 需补齐"存储成功→需重载生效"的状态提示（当前链路断裂处，见 `mod-management-live-build-watch`）。

### 4.11 其他组件

- **GuideHost**（19 页教程图）：横滑翻页 + 底部页点指示，双指缩放禁用（已全局禁）改"点图全屏"；
- **LeaderboardModal**：D2/D4 定稿多人无尽删除——此屏随无尽本地化改为"本地最佳"（localStorage `sp.endless.best.*`），列表/详情从简；
- **PreloadModal**：安卓端 `isNativeApp()` 已关 Web 预载 UI（`:562-565`）——保留，仅显示"资源已内置"；
- **Admin（`public/admin/`）**：独立静态站，**不在本次安卓适配范围**（管理操作假定桌面）；但按 GLOBAL_VOICE_TRI §3.4 仪表盘化方向保留；
- **Toast / ConnectionBanner / ServerLoadBadge**：Toast 底部上滑（避开底部商店带，放在其上方）；ConnectionBanner 顶部细条现状保留；ServerLoadBadge 移动端隐藏（现状）并在"更多"面板给文本态；
- **rotate-hint**：保留（§3.4）。

---

## 5. 硬数字与平台坑（落地规格）

### 5.1 触控
- **命中 ≥48×48dp**（Material 3；现 `--tap-min:44px` 的组件随三层制重构逐步抬到 48），**间距 ≥8dp**；
- 视觉图标可小（24dp），命中区用 `::before` 隐形扩区（`devices.css:63-71` 现有机理）；
- 高频操作（部署卡/技能/确认/就绪）置于**右下拇指自然弧**（横屏右手持机：锚定下缘、半径 ~38vw 的扇形）；左上/正上角只放低频信息钮；
- 提供**左右手镜像开关**（设置新增）覆盖左拇指用户（~33%）。

### 5.2 字号
- 正文/标签 ≥14sp；HUD 关键数字（回合/倒计时/LP/资金）≥18–20sp；Boss 倒计时 ≥24sp；
- 字号下限沿用 `max(.xxrem, 8px)` 兜底，但 8px 仅用于最不重要的角标——正文不得以 8px 出现；
- 文字用 rem（随 root clamp 缩放），**布局尺寸也用 rem**（本项目 root 已做屏宽适配，等价 dp 语义）。

### 5.3 刘海/安全区/手势
- 战场画布全出血；HUD/面板收 safe-area；**安卓端 `--sa-l = 0`**（壳 edge-padding 接管）——左缘按钮至少留 8dp 自留边距，不依赖 safe-area；
- Android 10+ 手势导航：左右边缘内滑 = 系统返回。**部署拖拽起点/技能手势避开屏幕最边缘 16dp**；壳侧如需可用 `setSystemGestureExclusionRects` 排除战场区（每边 ≤200dp 上限，且二次滑动仍触发返回——不能依赖）；
- 返回键：战斗内拦截弹"退出战斗？"底部面板（不直退）；大厅/房间按返回 = 返回上一级或退到标题。

### 5.4 动画/性能（同屏多单位）
- 帧预算 16.6ms，JS+样式+布局压进 ~10ms；
- **只动画 `transform/opacity`**；血条 `scaleX`；拖拽 ghost `will-change` 仅拖拽期；
- 单位根 `contain: layout paint`；列表 `content-visibility: auto`；节点对象池；
- 禁多单位 `box-shadow/filter: blur`（paint-heavy），用预渲染贴图；
- 热降频/2D 降级/`prefers-reduced-motion` 三路共用一套"减动画"令牌（`--t-*` 归零 + 关 glow/vignette 动画）。

### 5.5 已知 WebView 坑的处置现状与补强
| 坑 | 现状 | 补强 |
|---|---|---|
| 300ms 点击延迟 | viewport meta 已消 | 无需动作 |
| 双击/双指缩放 | device.js 已禁 | 无需动作 |
| 橡皮筋/下拉刷新 | 部分（`touch-action`） | `html,body { overscroll-behavior: none; }` 补齐 |
| 文本选择/长按放大镜 | 未全局禁 | `* { user-select: none; -webkit-touch-callout: none; }`，输入框单独开回 |
| 系统字体缩放 | `textZoom=100` 已硬锁 | 设置/大厅文字界面用 200% 字体实测一遍（弹性布局 + max-lines 省略） |
| 沉浸式重进丢失 | `enableFullscreen()` | onResume/onWindowFocusChanged 重新 hide（壳侧补一行） |
| 黑屏 | 看门狗 + 2D 降级已就绪 | UI 只需保证降级态下 DOM HUD 完整（§4.5.8） |
| 返回键误退战斗 | 未拦截 | §5.3 拦截方案 |
| 横竖屏 | 锁横屏 + rotate-hint | 无需动作 |

---

## 6. 与既有决策的对齐核对

| 既有定稿 | 本报告 |
|---|---|
| GLOBAL_VOICE_TRI D1 默认日语 | §4.9 保留 jp 默认 |
| D2 多人无尽删除 | §4.11 Leaderboard 转本地最佳 |
| D5 双端同码同功能、拆的是布局交互 | 全文遵循：无功能差异，只有形态差异 |
| D6 服务器包无无尽入口 | §4.2 无尽卡由 `LOCAL_FEATURES` 条件渲染（现状已对） |
| CSS 三层制 + 静态 link + 特性类快照选组件 | §0.3 + §2 令牌落 `devices.css` 同层；`mobile.css` 按屏解散时本报告 §4 即各屏 `.mobile.css` 的内容蓝本 |
| 端差异进特性类不进 UA（红线） | §0.2 + §1 三轴模型 |
| 双端截图基线落 `docs/ui-reference/` | 实施时每屏按 §4 出 844×390 渲染，与 `docs/mockups/` 现有 phone 图（mod-2/4/8、voice-switch-phone、endless-2）同管线 |
| 主人指令：上游 UI 不整搬，按 device.js 特性类 + CSS 三层重写并双端截图比对 | 本报告所有形态均按此产出；0.2.3 的"界面文字四档"（§28.14）并入时按 rem 体系做第四档，不引上游实现 |
| UI_PACKS §5 大厅/房间栏位约定 | §4.2/§4.3 重排未触碰 `.diff-list` 与房主操作区的既有扩展点语义（无尽卡、packs 入口保留各自槽位） |

---

## 7. 落地优先级建议（非实施，仅排序）

1. **P0 战斗屏**（§4.5）：顶部信息带 + 底部商店带居中收拢 + 点选部署轨 + 详情/奖励底部面板——玩家 90% 时间在此；
2. **P0 弹层体系**（§3.1）：bottom sheet 组件（从 `voicePicker` 的 `.lo-sheet` 提纯为公共组件），全弹层迁移；
3. **P1 标题/大厅/房间**（§4.1–4.3）：主链路三屏，配合无尽本地化改版一次到位；
4. **P1 干员调配双态**（§4.4）：第二大停留屏；
5. **P2 设置/MOD/统计/codex**（§4.7–4.10）：统一走双态 + 底部面板组件；
6. **P2 硬指标审计**（§5.1–5.3）：48dp 命中、返回键拦截、overscroll/user-select 补齐；
7. **P3 性能令牌**（§5.4）：`contain`/对象池/热降频减动画；
8. 全程双端截图基线（puppeteer 844×390 @2x）落 `docs/ui-reference/`，逐屏与桌面 1920×1080 对照。

---

## 附：调研来源

- 代码实况：`public/js/screens/*`、`public/js/ui/*`、`public/css/*`、`android/app/src/main/*`、`docs/ANDROID.md`；
- 已定稿文档：`docs/GLOBAL_VOICE_TRI_UI_ENDLESS_PLAN.md`（D1–D6、三层制）、`docs/UPSTREAM_023_MERGE_PLAN_V2.md`、`docs/ENDLESS_MOD_DUAL_PLATFORM_PLAN.md`、`docs/CF_MOD_TRI_PLAN.md`、`E:/Workbox/UI_PACKS_VS_ENDLESS_PLAN.md`、`E:/Workbox/MOD_UI_ADAPTATION_PLAN.md`；
- mockup 资产：`docs/ui-reference/`（10 屏 HTML）、`docs/mockups/`（含 844×390 phone 渲染管线）；
- 硬规范：Material 3 Accessibility（48dp/8dp）、Apple HIG（44pt/字号下限）、WCAG 2.1 SC 2.5.5、Android Developers（cutout/immersive/gesture navigation/fontScale）、Chrome Developers（300ms tap delay）、web.dev（rendering performance）、Hoober/Hurff Thumb Zone（1,333 人）；
- 品类惯例：Arknights、Vampire Survivors、Brotato、Kingdom Rush、Bloons TD 6、Clash Royale、TFT 移动端。

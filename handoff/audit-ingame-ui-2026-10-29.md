# 局内（炸惊 + 全部玩法）UI 四项审计 — 2026-10-29

范围：业主本轮提的四项 —— ①已选惊变 / 惊变一览从右侧撤掉；②锻造器 + 一览整合成一颗按钮放左上「炸惊模拟」右侧；
③左下角按钮排布与表情键尺寸、局内规则介绍按钮；④局内发言框触发逻辑 + 层级低于表情盘的透明聊天框。

方法：只读。全部结论来自 `read` / `grep` 静态定位（含 `git log`/`git show` 只读查询），**没有改任何代码 / 测试 / 数据**，
**没有跑 `node --test`**，**没有做任何 git 写操作**。下面每个「现状」都带 `文件:行`，每条「验收」都给了能直接抄的命令。

一句话结论（四项各自的根因）：

| # | 一句话根因 |
|---|---|
| ① | 「已选惊变」和「惊变一览」是两枚**绝对定位到右上角**的角标（`jibian.css:76-85`、`:213`，`top:92px; right:18px`），写法照抄藏品图鉴的挂点；它们挂在共享 HUD（`game.js:1937-1938`）里，所以只要炸惊房就出现在右上。 |
| ② | 锻造器那一列（`.gm__forgecol`，`forge.css:11-13`）业主 2026-10-28 已要求挪到**左上**，而一览角标仍留在**右上**，两者和左上那颗「炸惊模拟」是本轮之前三个互不相干的落点；整合必须动 `hud.js` 的 TopBar（`.gtop__meta` 是**竖排**列，`game.css:114`）与 `game.js` 的挂载。 |
| ③ | 左下角 `.gm__corner`（`game.css:700`）本来是一行，但 <768px 被 `devices.css:140/144` 强制 `flex-wrap: wrap-reverse` + 固定「3 键位」宽度（为了不被店铺栏盖住），而表情键 `.ewheel__btn` 沿用官方贴图尺寸 1.51rem 宽（`emotes.css:19-36`）→ **两行 + 大小不一**；「规则/玩法说明」是同一行里的 `.gm__guide`（`game.js:2018`，**没有 data-testid**）。 |
| ④ | 发言框在局内是受控组件（`game.js:1999`），但「打开」有三个互不一致的入口：角落**没有**按钮、面板里的 `.chat-trigger-btn`、以及 `chatBox.js:68-80` 的**全局 Enter 捕获**；「透明」是**死代码** —— `room-chat.css:147-155` 的 `background: transparent` 被同文件 `219-226` 的后一条同名规则覆盖成半透明 + 模糊，`z-index:110` 也被覆盖成 `2`。 |

---

## §0 先钉死：左下工具条是**一份**，所有玩法共用（对应 Lead 补充口径）

**只有一处渲染**（`grep -rn "gm__corner" public/js devtools` 的全部结果）：

| 位置 | 作用 |
|---|---|
| `public/js/screens/game.js:2003-2020` | **唯一** 的 `<div class="gm__corner">`（局内屏；四档 / 湮灭 / 炸惊 / 超限 全是这一个 `screens/game.js`） |
| `public/js/ui/fieldHost.js:128` | 只是**量**它（`cornerBand`，给战场/手牌留边），不渲染 |
| `public/css/screens/game.css:700-706`、`devices.css:100/102/140/144/152/156/159`、`game-panels.css:386`、`compat84.css:40` | 共享样式 |

结论：这套工具条**没有任何 `[data-difficulty="…"]` / `.gm--zhajing` 分支**（`grep -n "gm--" public/css/screens/game.css`
只有 `game.css:1150` 的 `.gm--combat .ff-badge`，与角落无关）。所以 §3 的改动**天生就是全模式一起生效**；
模式差异只由「服务端下不下发某个数据块」决定，而不是 CSS 分支：

| 角落按钮 | 类 / testid | 出现条件（谁决定） | 模式归属 |
|---|---|---|---|
| AI 协作 | `.btn.ai-participation-entry`（无 testid） | `room.aiTakeoverEnabled === true` 且非 solo 且官方版本（`ui/aiTakeover.js:17`） | 任何开了 AI 接管的房 |
| 作战统计 | `.gm__gear.gm__metrics`（无 testid） | `showMetrics = metricsSetting && !modRoom && !spectator`（`game.js:299`、`2007`） | 主机/开发开关，非模式 |
| 交流（表情） | `.gm__gear.ewheel__btn`（无 testid，`emotes.js:311`） | 非观战（`game.js:2006`） | 全部 |
| 干员调配 | `.lo-entry`（`data-testid="loadout-open"`，`loadout.js:1190`） | prep 且自己未准备且非观战（`game.js:2015-2016`） | 全部 |
| 设置 | `.gm__gear`（无 testid，aria-label 设置，`game.js:2017`） | 始终 | 全部 |
| **玩法说明（规则介绍）** | `.gm__gear.gm__guide`（**无 testid**，`game.js:2018`） | 始终 | 全部 |
| 全屏 | `.fsbtn.gm__gear.gm__fs`（无 testid，`ui/device.js:245`） | 浏览器支持全屏时 | 全部 |

模式专属的**额外** HUD 元素（都不在角落，去掉规则键时不受影响）：

| 元素 | 位置 | 归属 |
|---|---|---|
| 蚀流/无尽湮灭药丸 `.gm__erosion` | `game.js:1925`，`game.css:899-908`（`fixed; left:.18rem; top:.72rem`） | 仅湮灭（`pub.erosion` 存在时） |
| 锻造器列 `.gm__forgecol` | `game.js:1939-1944`，`forge.css:11-13` | 仅炸惊（`m.private.forge` 存在时） |
| 已选惊变 / 惊变一览角标 `.zjbtn` | `game.js:1937-1938`，`jibian.css:76-85/213` | 仅炸惊 |
| 藏品图鉴角标 | `game.js:1936` | 有 `priv.relics` 的模式（官方四档 + 炸惊） |
| 超限加速/词缀/词条徽记 | `hud.js:561-565`（顶栏右侧，`pub.isInfinite`） | 仅超限 |

---

## §1 已选惊变不要显示在右侧 + 去掉「惊变一览」按钮

### 1.1 现状（文件:行）

| 东西 | 组件 / 挂载 | DOM | testid |
|---|---|---|---|
| 已选惊变入口 | `JibianButton`（`ui/jibian.js:256-262`），挂载于 `game.js:1937` | `<button class="zjbtn">`，**.gm__hud 的直接子节点**（不在 `.gm__corner` 里） | `jibian-open` |
| 惊变一览入口 | `JibianCodexButton`（`ui/jibian.js:555-561`），挂载于 `game.js:1938` | `<button class="zjbtn zjbtn--codex">`，同上 | `jibian-codex-open` |
| 已选惊变面板 | `JibianPanel`→`JibianPanelView`（`ui/jibian.js:335-339` / `346-387`），挂载于 `game.js:2109-2110` | `.zjpanel`（`jibian.css:88`：`position:fixed; z-index:86`），三页签 `jibian-tab-mine/enemy/bond`、正文 `jibian-mine` / `jibian-mine-empty` / `jibian-enemy` / `jibian-enemy-empty` | `jibian-panel` |
| 惊变一览面板 | `JibianCodex`→`JibianCodexView`（`ui/jibian.js:550-552` / `513-547`），挂载于 `game.js:2111-2112` | 同一 `.zjpanel` 家族 + `.zjcodex`，分组 `jibian-codex-<rarity>` / 计数 `jibian-codex-count-<rarity>` / 每行 `jibian-codex-card-<id>` | `jibian-codex` |

定位规则：`jibian.css:76-85` `.zjbtn { position:absolute; top:92px; right:18px; z-index:14 }`；
`:213` `.zjbtn--codex { top: calc(92px + .56rem) }`（第二颗）；窄屏 `@media (max-width:760px)` 改成 `bottom:210px / calc(210px + .5rem)`（`:85`、`:215`）。

### 1.2 两种可能的「右侧」，都读到了

业主原话是「已选惊变不要显示在**右侧**」。代码里有两处「右侧」：

1. **右上角的两枚角标**（上面 1.1）—— `top:92px; right:18px`，就是字面意义的右上；这也是 §2 要整合的那颗「一览」。
2. **右侧效果列**：`game.js:1968` `<div class="gm__effects"><EffectsList effects=… /></div>`（`.gm__effects { right:.3rem; top:2.4rem }`，`game.css:680`）。
   `EffectsList`（`ui/effectsList.js:47-65`）把 `priv.effects` 前 10 条画成图标；而惊变卡在效果列里的 id 就是
   `jibian_<cardId>#<uid>`（`ui/jibian.js:220-241` 的 `jibianFromEffects` 注释与实现），**所以已选惊变也会以图标形式出现在右侧效果列**。

→ 建议：**两个都处理**（角标随 §2 并进左上那一颗；效果列里过滤掉 `jibian_` 前缀的 ref），并向业主确认他要的是哪一个。
过滤点只有一个：`game.js:1968` 传 `effects` 之前 filter（`e.id.split('#')[0].startsWith('jibian_')`），**不要**改 `ui/effectsList.js`（它同时服务其它模式）。

### 1.3 去掉「一览」角标后会红的断言 / 脚本（逐条）

| 文件:行 | 断言/行为 | 红的原因 | 改法 |
|---|---|---|---|
| `test/ui/zhajing-panels.test.js:192-195` | `JibianCodexButton` 的 testid 是 `jibian-codex-open`、title「惊变一览」、按钮上有数字 | 组件被删或改名就红 | 若按钮并入 §2 的新按钮：改成断言新组件（如 `zj-tools`）+ 保留 `jibian-codex-open` 别名则不用改 |
| `test/ui/zhajing-panels.test.js:197` | `GAME_SRC` 必须含 `<${JibianCodexButton} count=…` | `game.js` 不再挂它 | 改成断言新挂载（`<${ZjToolsButton} …>`） |
| `test/ui/zhajing-panels.test.js:198` | `GAME_SRC` 必须含 `<${JibianCodex} modeId=${pub?.modeId} owned=…` | 一览面板并入新面板后不再单独挂 | 同上 |
| `test/ui/zhajing.test.js:199-204` | `JibianButton({count:2})` 的 testid `jibian-open` / title「已选惊变」/ 文本含 2 | 组件被删就红 | 删掉这 6 行，或保留组件、只改挂载（推荐后者：单测继续守组件本身） |
| `test/ui/zhajing-adapt.test.js:122` | 触摸地板表里点 `.zjbtn min-height`（注释写「HUD 两颗角标」） | 角标没了 → `ruleOf(JIB,'.zjbtn')`（`:32-35`，`assert.ok(hits.length >= 1, '.zjbtn is declared')`）直接抛错 | 从 floors 表里删掉 `['.zjbtn','min-height']` |
| `test/ui/zhajing-adapt.test.js:176-185` | `.zjbtn`/`.zjbtn--codex` 定位与窄屏 `bottom` 两条 | 规则删了就红 | 整条 test 删掉（或改写为断言新按钮在顶栏内的定位） |
| `test/ui/zhajing-adapt.test.js:141-152` | **字号地板扫描**：`JIB`（jibian.css）里每个 `font-size` 都必须是 `max(<N>px, calc(k*--t))` | 若删 `.zjbtn` 规则时留下 `.zjbtn b { font-size }` 之类的孤儿声明，仍能过；但若删掉整块时误删 `.zjcodex__*` 的字号，会红 | 只删 `.zjbtn` / `.zjbtn--codex` 两条及窄屏那两条，别动 `.zjcodex__*` |
| `test/ui/zhajing.test.js:161-197` | 面板三页签、空态、敌方页 R1/R6、观战名 | 面板本身保留（并入新面板）→ 只要 `JibianPanelView` 不动就绿；若为「两页签」删掉「一览」以外的页也不受影响 | 不改 |
| `devtools/render-check-zhajing.mjs:390-392` | 每帧读 `codex` / `panel` / `tags.corner.{openBtn,codexBtn}` | 角标没了 → `tags.corner` 两个都是 null | 见下一条 |
| `devtools/render-check-zhajing.mjs:476-530` | 先点 `[data-testid="jibian-codex-open"]` 量一览、再点 `[data-testid="jibian-open"]` 量面板，各截图 `codex` / `panel` | 点不到 → 这两步的 `seen.codex` / `seen.panel` 永远是 null | 改成点新按钮 → 切新面板的「一览」/「已选」页签（选择器同步） |
| `devtools/render-check-zhajing.mjs:671-679` | `checks.codex`（99 张 5 组）、`checks.panel`（3 页签 ≥24px、敌方 ≥1 格）、`checks.cornerTouch`（两颗角标 ≥24px 且 inView） | 三个 check 全 FAIL | `checks.cornerTouch` 删掉或改成「新按钮在顶栏内、≥24px」；`codex`/`panel` 的选择器换成新面板 |
| `devtools/lib/zhajing-panels.mjs` | **不涉及** —— `grep -n "jibian\|zjbtn\|codex\|forge"` 在该文件里 0 命中（它测的是拓展大厅 / 二级页 / 名片 / 卡池预选 / 房间） | 不会红 | 不用动 |
| `devtools/render-check-mobile-adb.mjs:161` | 只查 `.ext-theme__foot`（二级页），与局内无关 | 不会红 | 不用动 |
| `handoff/ZHAJING-SPLIT-2026-10-28.md:348` | 文档里提到 `.zjbtn` | 只是文档 | 本轮不要求改；若动了角标，交接里补一句 |

补充：`test/ui/*.e2e.test.js` 里没有一处点 `jibian-open` / `jibian-codex-open`（`grep` 全仓只有上面这些命中），
所以 e2e 面不受影响。

### 1.4 建议改法

- 保留 `JibianButton` / `JibianCodexButton` 两个**组件**（单测继续守），但 `game.js` 不再挂它们；
  两个面板组件（`JibianPanel`、`JibianCodex`）也保留，作为 §2 新面板的两个页签内容。
- `jibian.css:76-85`、`:213-215` 的 `.zjbtn*` 四条规则随挂载一起删（`.zjbtn` 全仓只有这两个组件用）。
- 若业主指的是右侧**效果列**：改 `game.js:1968` 一处过滤（见 1.2）。
- 删之前先确认 §2 已经落地（否则炸惊局内就没有任何惊变入口了）。

### 1.5 风险 / 回归面

- `zjbtn` 的 `z-index:14` 与 `.gm__effects`（无 z-index，DOM 在 corner 之前）叠放顺序：删掉不影响任何现有层级。
- 触摸地板口径（`zhajing-adapt.test.js:120-136`）是**逐条列选择器**的，删规则必须同步删表项，否则那一条会以
  「`ruleOf` 找不到规则」的形式报错（不是断言失败，是抛错）。

### 1.6 验收

```powershell
# 静态：右角两枚角标与它们的 CSS 已经不存在
Select-String -Path public/js/screens/game.js -Pattern 'JibianButton|JibianCodexButton'   # 期望 0 行
Select-String -Path public/css/screens/jibian.css -Pattern '\.zjbtn'                      # 期望 0 行
# 组件与面板仍在（单测守）
node test/ui/zhajing.test.js
node test/ui/zhajing-panels.test.js
node test/ui/zhajing-adapt.test.js
# 真机（需服务端起在 3020）：一览/面板改到新按钮后
$env:SP_BASE='http://127.0.0.1:3020'; node devtools/render-check-zhajing.mjs
```

---

## §2 锻造器 + 一览整合成一颗按钮，放左上「炸惊模拟」右侧

### 2.1 现状（文件:行）

| 东西 | 组件 / 挂载 | DOM | 定位 |
|---|---|---|---|
| 左上「炸惊模拟」字样 | `TopBar`（`ui/hud.js:483`）里 `hud.js:517` `<${DifficultyTag} difficulty=${pub.difficulty} size="sm" />`；`DifficultyTag` 定义在 `ui/components.js:962-970`，文字来自 `DIFFICULTY_NAMES['ZHAJING']`（`build-data` 生成的中文「炸惊模拟」），样式 `.dtag`（`components.css:882-887`） | `.gtop__left > .gtop__meta > span.dtag` | `.gtop__left{display:flex;gap:.16rem}`（`game.css:113`）、**`.gtop__meta{display:flex;flex-direction:column;align-items:flex-start;gap:.06rem}`（`game.css:114`，竖排）** |
| 锻造器 | `ForgeButton`（`ui/forge.js:109-112`）→ `ForgeButtonView`（`:118-145`，按钮 `forge.js:125-131`），挂载于 `game.js:1939-1944` 的 `.gm__forgecol`（含 `KillCounter`、`ForgedChip`） | `<span class="forge"><button class="forge__btn" data-testid="forge-button">…` + `<span class="kills" data-testid="forge-kills">` + `<span class="fged"><button data-testid="forged-chip">` | `.gm__forgecol{position:absolute;left:18px;top:calc(92px + 1.12rem + .14rem);z-index:14}`（`forge.css:11-12`），窄屏 `bottom:calc(210px + 1rem)`（`forge.css:13`） |
| 锻造悬浮窗 | `ForgePanel`/`ForgePanelView`（`forge.js:152-163`/`169-209`），由 `ForgeButtonView` 内联渲染（`forge.js:132-143`） | `.forgeov`（`fixed; z-index:40`，`forge.css:44`）+ `data-testid="forge-panel"`（`forge.js:172`）、`forge-left`、`forge-card-<optId>`、`forge-forged` | 开关状态在模块级 `ui`（`forge.js:61-72`：`forgeOpen()/forgeClose()/forgedToggle()/forgeUi()`） |
| 惊变一览 | 见 §1.1（右上角，`jibian.css:213`） | | |

### 2.2 根因

锻造器与惊变角标是**两次独立落点**：业主 2026-10-28 只要求把锻造器列从右上挪到左上（`forge.css:8-10` 的注释写着
「包里 `.forge` 与 `.kills` 同在左上区，我们原来错放在右上」），而「一览」角标当时照抄藏品图鉴留在右上
（`jibian.css:76` 注释「与藏品图鉴同一个挂点（top 92px / right 18px）」）。两处都**不是**按「左上那颗模式名旁边」设计的，
所以「整合」本质上是**换挂载点 + 换锚**，不是样式微调。

### 2.3 建议 DOM 方案（一颗按钮 + 一个面板三页签）

按钮（左上，`炸惊模拟` 文字右侧，与文字同一行）：

```html
<!-- hud.js TopBar 内，替换 :517 那一行 —— 注意 .gtop__meta 是竖排列，需要一层横排 wrap -->
<div class="gtop__moderow">
  <${DifficultyTag} difficulty=${pub.difficulty} size="sm" />
  ${modeEntry || null}   <!-- 从 game.js 传进来的 slot（见下） -->
</div>
```

`modeEntry` 由 `game.js` 传（**保持数据归属在 game.js**，TopBar 不该知道 forge/jibian）：

```js
// game.js:1926-1934 的 <${TopBar} … /> 上新增
modeEntry=${forgeInfo || jibianShown ? html`<${ZjToolsButton}
    forge=${forgeShown} jibian=${jibianShown} count=${jibianCount}
    onClick=${() => setZjToolsOpen(true)} />` : null}
```

按钮本体（一颗，左侧「锻造器」图形 + 两个数字，替代现有 `.forge__btn` 与 `.zjbtn` 两颗）：

```html
<button type="button" class="gm__modetools" data-testid="zj-tools"
    aria-haspopup="dialog" aria-expanded=${open ? 'true' : 'false'}
    aria-label=${t('锻造器') + ' / ' + t('已选惊变')} title=…>
  <${GIcon} name="forge" />
  <b class="num" data-testid="zj-tools-forge">${forgeCount}</b>
  <span class="gm__modetools__sep" aria-hidden="true"></span>
  <${Icon} name="blast" /><b class="num" data-testid="zj-tools-jibian">${jibianCount}</b>
</button>
```

面板（一个 `.zjpanel`，三个页签）：

| 页签 | 内容来源 | 复用方式 |
|---|---|---|
| 锻造 | `ForgePanelView` 的**正文**（`forge.js:184-204`：卡格 + 已锻造一排 + 页脚） | 需要把 `ForgePanelView` 拆成 `ForgeCardsView`（纯正文，不画 `.forgeov` 外壳），`ForgePanel` 继续用外壳包它 → 老的单测（`zhajing-forge.test.js:85-102` 断言 `forge-panel`/`forge-left`/`forge-card-*`/`forge-forged`）可以只改 testid 断言层 |
| 已选惊变 | `JibianPanelView` 的三页内容（`jibian.js:372-383`） | 直接把 `JibianPanelView` 当子视图嵌进新面板的正文区（它自己就是 `.zjpanel__body` 内容；需要给它一个「不要外面板」的 prop 或抽出 `JibianTabs`） |
| 一览 | `JibianCodexView` 的分组正文（`jibian.js:527-544`） | 同上，抽出正文 |

口径建议：**页签 = 锻造 / 已选惊变 / 一览**（三个，不是一个面板两页签），因为三块数据源不同
（`priv.forge` / `priv.jibian`+`pub.enemyJibian` / `config.modes[ZHAJING].jibian.pool`），合并成两页会丢掉
「已选 vs 全部」的对照；若业主坚持两页，就把「已选惊变」与「一览」并成一页的两段（上：已选三页；下：全部按稀有度），
`zjcodex__*` 的 testid 全部保留。

### 2.4 会红的测试（逐条）

| 文件:行 | 断言 | 改法 |
|---|---|---|
| `test/ui/zhajing-forge.test.js:70` | `GAME_SRC` 里必须出现 `${forgeInfo ? html` + `<div class="gm__forgecol">` 这一段模板串 | 改成断言新挂载（`.gm__modetools` / `zj-tools`） |
| `test/ui/zhajing-forge.test.js:247` | `FORGE_CSS` 含 `.gm__forgecol { position:absolute; left:18px; top:calc(92px + 1.12rem + .14rem);` | 删掉或改为 `.gm__moderow` 的新规则 |
| `test/ui/zhajing-forge.test.js:248` | `@media (max-width:760px)` 里 `.gm__forgecol { top:auto; bottom:calc(210px + 1rem); left:12px; }` | 同上 |
| `test/ui/zhajing-forge.test.js:249` | `.gm__forgecol` 不许有 `right:`（「never the right corner again」） | 保留这条精神，改成对 `.gm__modetools` 的断言 |
| `test/ui/zhajing-forge.test.js:76/84/87/94/97` | `ForgeButtonView` 内部结构（`forge-button`/`forge-left`/`forge-card-*`/`forge-forged`） | 只要组件还画这些 testid 就绿；`ForgeButtonView` 若拆成两层，断言对象换成新的纯视图 |
| `test/ui/zhajing-forge.test.js:118-134` | `forgeOpen/forgeClose/forgeUi` 的模块级开关（「还有存货留在原地」） | 若新面板改用 props 受控，这条要重写为「面板页签切换不关窗 / 最后一张才关」 |
| `test/ui/zhajing-panels.test.js:197-198` | `GAME_SRC` 含 `JibianCodexButton` / `JibianCodex` 挂载 | 换成新挂载 |
| `test/ui/zhajing.test.js:199-204` | `JibianButton` testid/标题 | 保留组件则绿；删组件则重写 |
| `devtools/render-check-zhajing.mjs:533-582` | 点 `forge-button` → 量 `forge-panel`（`checks.forge`，`:618-620`） | 改成点 `zj-tools` → 切「锻造」页；`checks.forge` 的选择器同步 |
| `devtools/render-check-zhajing.mjs:671-679` | `checks.codex` / `checks.panel` / `checks.cornerTouch` | 同上（点新按钮 → 切页签） |
| `test/ui/ui-size.test.js`（守卫扫描 `public/css/**`） | 新按钮的 `min-height` 若 >32px 必须写 `max(<rem>, 32px, calc(Npx * var(--sp-ui,1)))`，≤32px 裸写 | 新规则按现有写法（参考 `forge.css:15` 的 `max(.44rem,32px)`） |

### 2.5 风险

1. **顶栏变宽**：`.gtop` 是 `grid-template-columns: minmax(0,1fr) auto minmax(0,1fr)`（`game.css:109`），
   左列加一颗按钮会挤压中央长条；`.gtop__band` 的两半是 `minmax(2.3rem, auto)`（`game.css:150`），
   667px 宽的手机上已经贴边 → 建议窄屏（`@media (max-width:767px)`）把按钮挪到模式名**下一行**（`.gtop__meta` 本来就是列），
   桌面才同行。这属于「全模式共用」样式，不带难度分支。
2. **锻造器列还有 `KillCounter` / `ForgedChip`**：它们不在按钮里，仍留在左上（原 `.gm__forgecol`），
   只把**按钮**并进顶栏 → 需要把 `game.js:1939-1944` 拆成两段（顶栏 slot + 左列计数）。
3. `forge-panel` 的开关是**模块级 store**（`forge.js:62`），与 `game.js` 的 `useState` 不共享；
   新面板要么继续用 `forgeOpen/forgeClose`（改动最小），要么统一成受控 props（`zhajing-forge.test.js:118-134` 要改）。

### 2.6 验收

```powershell
node test/ui/zhajing-forge.test.js
node test/ui/zhajing-panels.test.js
node test/ui/ui-size.test.js
# 真机：按钮在 .gtop__left 内、与 .dtag 同一行、≥24px、面板三页签都能开
$env:SP_BASE='http://127.0.0.1:3020'; node devtools/render-check-zhajing.mjs
# 静态确认没有难度分支
Select-String -Path public/css/screens/*.css -Pattern 'gm__modetools' -SimpleMatch   # 只应出现在 game.css
```

---

## §3 局内左下角按钮排布 + 表情键尺寸 + 规则介绍按钮

### 3.1 现状（文件:行）

容器：`game.css:700` `.gm__corner { position:absolute; left:.24rem; bottom:.24rem; display:flex; align-items:flex-end; gap:.1rem; z-index:130 }`
（`game.js:2003` 渲染）。按钮清单与模式归属见 **§0 的表**。逐个的样式来源：

| 按钮 | 尺寸来源 | 备注 |
|---|---|---|
| `.gm__gear`（设置 / 玩法说明 / 全屏 / 作战统计） | `game.css:701-706`：`width:.56rem; height:.56rem; display:grid; place-items:center` | 窄触屏放大到 `max(.56rem,32px,calc(34px*--sp-ui))`（`devices.css:100`），图标 `max(.28rem,17px)`（`devices.css:102`） |
| `.ewheel__btn`（交流/表情） | `emotes.css:19-25`：`height:.56rem; min-width:1.51rem; padding:0 .2rem 0 .14rem`；带贴图态 `emotes.css:32-36`：`width: max(1.51rem,32px,calc(72px*--sp-ui))`、`height: calc(w*55/151)` | **与其它键不同尺寸**：官方 `emoji_btn` 151×55 是长条，靠 `has-sprite` 撑开；图标 `.3rem`（`:26`） |
| `.lo-entry`（干员调配） | `loadout.css`（`LoadoutButton size="sm"`） | 只在 prep |
| `.ai-participation-entry`（AI 协作） | `.btn` 通用尺寸，**不是** `.gm__gear` | 只在开 AI 接管时出现，尺寸与其它键不同（次要问题） |

窄屏为什么会两行：

- `devices.css:139-141`（`@media (max-width:767px)`）：`.gm__corner { flex-wrap: wrap-reverse; align-content: flex-start; width: max(32px, calc(72px*--sp-ui), calc(3*.56rem + .2rem)) }` + 同块把 `.dpanel` 的 bottom 按「两行角落」抬高；
- `devices.css:143-147`（粗指针）：宽度换成 `calc(3*max(.56rem,32px,calc(34px*--sp-ui)) + .2rem)`；
- `devices.css:151-153`：`.gm.is-collapsed .gm__corner { flex-wrap: nowrap; width: auto }`（店铺收起时恢复一行）；
- `devices.css:155-159`：`.gm.is-collapsed.has-sp .gm__corner` 又回到 `wrap-reverse`；
- `game-panels.css:386`（≥768px 但开了机变浮层）：`.gm.has-sp .gm__corner { flex-wrap: wrap-reverse; align-content: flex-start; max-width: calc(2.8rem - .24rem - .1rem) }`。

### 3.2 根因

两条独立的历史决定叠在一起：
1. 窄屏换行是**为了让店铺栏不盖住角落**（`devices.css:133-138` 注释写明「the shop bar would cover the ⚙/📖/⛶ buttons — they wrap into a row above the 交流 button」），代价就是两行；
2. 表情键**没有**按 `.gm__gear` 改尺寸，它沿用官方 151×55 贴图（`emotes.css:32-36`），所以在同一行里比别的键宽一倍多，视觉上「表情位置不对」。

另外 `fieldHost.js:128` 的 `cornerBand` 是**实测**按钮矩形来给战场留边，`HUD_REM.cornerTop: 0.8`（`fieldHost.js:62`）是量不到时的退路；
`devices.css:141/147` 的 `.dpanel` bottom 手写了「两行高度」的镜像 —— 一旦改成一行，这三处必须一起改，否则详情卡会悬空。

### 3.3 建议改法（全部是共享样式，无难度分支）

改成「**一行、等尺寸**」：

```css
/* game.css —— 角落本身：一行不换行（所有模式同一份），宽高由按钮自己定 */
.gm__corner { position: absolute; left: .24rem; bottom: .24rem; display: flex; flex-wrap: nowrap; align-items: flex-end; gap: .1rem; z-index: 130; }
```

```css
/* emotes.css 末尾 —— 角落那份表情键与 .gm__gear 同尺寸（面板里的 .ewheel__item 不受影响） */
.gm__corner .ewheel__btn,
.gm__corner .ewheel__btn.has-sprite {
  width: max(.56rem, 32px, calc(34px * var(--sp-ui, 1)));
  height: max(.56rem, 32px, calc(34px * var(--sp-ui, 1)));
  min-width: 0; padding: 0; display: grid; place-items: center;
  background: rgba(8, 11, 10, .85); border: 1px solid var(--line-2); border-radius: 0; color: var(--text-lo);
}
.gm__corner .ewheel__btn .ewheel__label { display: none; }          /* 长条上的「交流」字不再需要 */
.gm__corner .ewheel__btn .icon { width: .28rem; height: .28rem; color: var(--mint-500); }
```

要改的选择器清单（**只这五处**，都是共享块）：

| 文件:行 | 改成 |
|---|---|
| `devices.css:140` | 删 `flex-wrap: wrap-reverse; align-content: flex-start;` 与固定 `width`，或整条删掉（`game.css:700` 的 nowrap 生效） |
| `devices.css:144` | 同上（粗指针那条只保留需要的） |
| `devices.css:152` | `.gm.is-collapsed .gm__corner` 变冗余（可保留，无害） |
| `devices.css:155-159` | `.gm.is-collapsed.has-sp` 的 wrap 规则删掉（机变浮层起点 `devices.css:146` 的 `left` 也要跟着从「三键宽」改成「实际一行宽」） |
| `game-panels.css:386` | `.gm.has-sp .gm__corner` 的 `flex-wrap: wrap-reverse` 改成 `nowrap`（`max-width` 同步去掉） |

连带必须一起改的两处「镜像」：`devices.css:141` / `:147` 的 `.dpanel:not(.dpanel--right) { bottom: calc(...) }`（按一行高度重算），
以及可选地把 `fieldHost.js:62` 的 `HUD_REM.cornerTop` 保持 `0.8`（`.24 + .56 = .8rem`，一行时更准）。

表情盘锚点：`.ewheel__panel` 现在是 `left:-.15rem; bottom:calc(100% + .02rem)`（`emotes.css:51`），
按钮变窄后建议 `left: 0; bottom: calc(100% + .06rem)`，保留 `devices.css:107` 的 `scale:1.3; transform-origin: 0 100%`。

### 3.4 「局内规则介绍按钮」：唯一渲染点、无 testid、去掉的影响面

- 渲染点：**只有** `game.js:2018`（`class="gm__gear gm__guide"`，`aria-label/title = t('玩法说明')`，`onClick = openGuide(0)`）。
  **没有任何 data-testid**（这一条要写进 §0 的表：角落键全都没有 testid，只有 aria-label）。
- `openGuide` 的其它入口（都不在局内 HUD）：`lobby.js:698`（同盟方式页）、`title.js:277`（标题页 `GuideButton`）、
  `settings.js:476`（设置弹窗里的「玩法说明」`set-guide`）、`sweep.js:453`（S.W.E.E.P. 报告里的 ⓘ）。
- 去掉后的可达性：局内仍可经 **设置弹窗 → 玩法说明**（`settings.js:476`）打开同一份 19 页手册 —— 这正是「去掉角落那颗」不丢功能的前提；
  如果连设置里的入口也不接受，就得再另找地方（不推荐）。
- 影响面：`grep -rn "gm__guide" test/ devtools/` **0 命中**（只有 `public/css/screens/game.css` 无该选择器），
  所以删这一颗 **不会** 让任何单测/脚本变红；受影响的是 `test/ui/*.e2e.test.js` 里那些用 `.gm__gear` 首匹配点设置的用例
  （见 3.5 的注意事项）。
- 所有模式一起删：这一颗是 `game.js` 里**无条件**渲染的（不在任何 `difficulty`/`forgeInfo`/`jibianShown` 门里），
  删掉就是四档 + 湮灭 + 炸惊 + 超限一起少一颗。

去掉后各模式角落剩什么：

| 模式 | 角落剩余 |
|---|---|
| 普通四档 / 超限 / 湮灭 | AI 协作（条件）/ 作战统计（开关）/ 交流 / 干员调配（prep）/ 设置 / 全屏 |
| 炸惊 | 同上（锻造器已在 §2 挪去顶栏，不由角落承载） |

玩法说明的替代入口建议写进 3.3 的同一条注释里（「局内只留设置，玩法说明从设置进」）。

### 3.5 会红的测试（逐条）

| 文件:行 | 断言 | 红的原因 | 改法 |
|---|---|---|---|
| `test/ui/issue5-fold-camera.test.js:109` | `game.css` 里 `.gm__corner { position: absolute; left: .24rem; bottom: .24rem;` 逐字 | 在 `:700` 里加 `flex-wrap: nowrap` **不影响**这条（它只匹配前缀）；但若重排声明顺序就会红 | 新增属性追加在行尾即可 |
| `test/ui/issue5-fold-camera.test.js:110` | `.gm__gear {\n  width: .56rem; height: .56rem;` 逐字 | 不动 `.gm__gear` 就绿 | 不改 |
| `test/ui/issue5-fold-camera.test.js:113` | `devices.css` 里必须**存在** `@media (max-width:767px){ .gm.is-collapsed .gm__corner { flex-wrap: nowrap; width: auto; } }` | 若把 152 行删掉就红 | 保留 152 行（无害） |
| `test/ui/ui-leftovers-3533.test.js:26-27` | `game-panels.css` 的 `@media (min-width:768px){ .gm.has-sp .gm__corner { flex-wrap: wrap-reverse; align-content: flex-start; max-width: calc(2.8rem - .24rem - .1rem); } }` 逐字 | 改 `wrap-reverse → nowrap` 就红 | 断言同步改成 nowrap |
| `test/ui/ui-leftovers-3533.test.js:32` | `devices.css` 含 `.gm.is-collapsed.has-sp .gm__corner { flex-wrap: wrap-reverse;` | 同上 | 同步 |
| `test/ui/playtest5-ui.test.js:96-99` | `devices.css` 窄触屏 `.gm__gear { width: max(.56rem,34px); height: … }` 与 `.gm__corner .gm__gear .icon { width: max(.28rem,17px) }` | 不动 `.gm__gear` 就绿 | 不改（表情键用的是新加的那条 `.gm__corner .ewheel__btn`） |
| `test/ui/emotes.test.js:493-494` | `game.css` **不许**出现 `.ewheel__btn`；`.ewheel__btn` 唯一定义在 `emotes.css` | 新规则必须写进 `emotes.css`（写进 game.css 会红） | 按下 3.3 放 emotes.css 末尾 |
| `test/ui/chat-box-css.test.js:36` | `.gm .chat-panel { left:.24rem; bottom:.9rem;` 逐字 | 若为一行角落重算 chat 的 bottom，会红 | 同步改（见 §4） |
| `test/ui/emotes.e2e.test.js:85/155/251`、`devices.e2e.test.js:39/211/261/352`、`real.e2e.test.js:307` | 点/量 `.ewheel__btn`（含 `has-sprite` 宽高比） | 尺寸变了可能红（e2e 默认关，`SP_E2E=1` 才跑） | 断言改成「与相邻 `.gm__gear` 同宽高 ±1px」 |
| `test/ui/mock.e2e.test.js:974` | 数 `.gm__corner button` 可见数 | 数量不变（只删 guide 时少一颗） | 期望值同步 |
| `test/ui/ai-takeover.e2e.test.js:18` | 点 `.gm__corner .ai-participation-entry` | 不受影响 | 不改 |
| `test/ui/hotkeys.e2e.test.js:47/109/122/238/279/300`、`bond-timers.e2e.test.js:50/67`、`hover-hotkeys.e2e.test.js:136/152`、`playtest2.e2e.test.js:348`、`mock.e2e.test.js:551`、`wake-lock.e2e.test.js:96`、`facing.e2e.test.js:147` | `page.click('.gm__gear')` 期望打开**设置** | ⚠️ **现在 `.gm__gear` 的首匹配其实是交流键**（`emotes.js:311` 给它加了 `gm__gear`，DOM 顺序 `game.js:2006` 在设置 `:2017` 之前）；这些 e2e 默认关，可能是既有隐患 | 建议顺手把角落键加 `data-testid`（`hud-settings` / `hud-emoji` / `hud-fs`），e2e 改点 testid；本轮若不动，至少在报告里记一笔 |

### 3.6 风险

1. **一行会不会又盖住店铺栏**：`devices.css:133-138` 的换行就是为了店铺栏；改成一行后按钮在 `bottom:.24rem`，
   店铺栏顶部在 `2.64rem`（`fieldHost.js:61` `shopBarTop`），一行高度 `.24+.56=.8rem` → 仍远低于店铺栏，不会重叠；
   真正受影响的是**战场下沿**（`cornerBand` 实测后会变小 → 手牌/长按区更宽，属正向）。
2. **`.dpanel` 的 bottom 镜像**必须同步（`devices.css:141/147`），否则详情卡悬在两行的高度上。
3. **44px 触控**：`devices.css:59/64` 给 `.gm__gear`/`.ewheel__btn` 加了 `::before` 命中区放大；新规则改了 `min-width:0` 与 `padding:0` 后，
   确认 `::before` 仍在（`:64` 那条是 `.sp-coarse` 作用域），否则手机上命中区掉到 34px。
4. `AiTakeoverPanel` 的按钮是 `.btn` 而不是 `.gm__gear`（`aiTakeover.js:17`），改完一行后它是唯一尺寸不同的键 —— 建议顺手给它 `.gm__gear`。

### 3.7 验收

```powershell
node test/ui/emotes.test.js
node test/ui/ui-leftovers-3533.test.js
node test/ui/issue5-fold-camera.test.js
node test/ui/playtest5-ui.test.js
node test/ui/ui-size.test.js          # 守卫扫 public/css 的所有 max(<rem>, <N>px)
# 真机（844×390 / 667×375 / 1280×720 三档，看：一行、宽高相同、店铺栏与手牌不打架）
$env:SP_BASE='http://127.0.0.1:3020'; node devtools/render-check-zhajing.mjs
# 浏览器里量（任意一局）：
# [...document.querySelectorAll('.gm__corner > *')].map(e=>[e.className, Math.round(e.getBoundingClientRect().width), Math.round(e.getBoundingClientRect().height), Math.round(e.getBoundingClientRect().top)])
# 期望：top 全相同（同一行）、宽高全约 34/56px（同一尺寸）
```

---

## §4 发言框触发逻辑 + 层级低于表情盘的透明聊天框

### 4.1 现状（文件:行）

| 东西 | 位置 |
|---|---|
| 局内挂载（受控） | `game.js:1999` `<${ChatBox} active=${chatOpen} onToggle=${setChatOpen} showTrigger=${true} />`；状态 `game.js:323` `const [chatOpen, setChatOpen] = useState(false)` |
| 面板结构 | `ui/chatBox.js:152-217`：`.chat-panel`（含 `.chat-header-bar` 的标题/弹幕/半收起、`.chat-log`、`active` 时的 `.chat-form`+`.chat-input`，非 active 时的 `.chat-trigger-btn` 💬） |
| 打开入口 1：全局 Enter | `chatBox.js:68-80`：`inMatch` 时 Enter 且未打开 → `setActive(true)`（`e.preventDefault(); e.stopPropagation()`）；Esc → 关 |
| 打开入口 2：面板内 💬 | `chatBox.js:209-215`（`showTrigger` 时）|
| 打开入口 3：角落按钮 | **不存在**。注释（`room-chat.css:135`「局内用角落的发言齿轮切换（受控）」、`:221`）是**过期口径** |
| 自动关 | `chatBox.js:205` `onBlur` 180ms 后若 draft 为空就 `setActive(false)` |
| 样式 | `room-chat.css:86-110` 基础 `.chat-panel`（`fixed; z-index:110; left:16px; bottom:16px; width:230px`，面板与日志 `pointer-events:none`，标题栏/表单/触发键 `auto`）；`147-155` `.gm .chat-panel`（**透明**、`left:.24rem; bottom:.9rem; width:2.5rem`、日志可滚）；`219-241` **后一条同名规则覆盖**（`z-index:2`、`width:min(4.6rem,46vw)`、`background:rgba(9,14,12,.78)`、`backdrop-filter:blur(7px)`、`border`、`box-shadow`） |
| 表情盘层级 | `emotes.css:50-51` `.ewheel__panel { position:absolute; left:-.15rem; bottom:calc(100% + .02rem); **z-index:5** }`；父层 `.ewheel`（`emotes.css:18` `position:relative`）在 `.gm__corner`（`game.css:700` `z-index:130`）里 |
| 相对层级 | 两者都在 `.gm__hud`（`game.css:49` `z-index:3`，`pointer-events:none`；子元素 `auto`）里：聊天 `z-index:2` < 角落 `130` → **表情盘本来就压在聊天之上** ✓ |

### 4.2 根因

1. **触发逻辑不一致**：角落里有设置/玩法说明/全屏，唯独聊天没有键 —— 它靠一个**全局键盘钩子**（Enter）和一个**面板内小键**打开，
   与「所有功能都是一颗角落按钮」的 HUD 约定不符；而 Enter 又与转向轮 `facingEnter`（`ui/facingWheel.js`，Enter 确认）抢键，
   现有实现靠 `stopPropagation()` 兜着，谁先谁后取决于监听顺序。
2. **「透明」是死代码**：`room-chat.css:147-155` 写的 `background: transparent; border-color: transparent; box-shadow: none`
   被同文件 `219-226` 的后一条同名规则（同特异性、源码在后）覆盖成半透明 + 模糊；`z-index:110`（`:87`）同样被 `:220` 的 `2` 覆盖。
   `test/ui/chat-box-css.test.js:30/42` 匹配的正是**前面那条**（正则 `assert.match(css, …)` 只要求文件里存在），所以测试是绿的，
   屏幕上却是半透明浮层 —— 这就是「透明聊天框」一直没做出来的原因。
3. **注释里的层级数字是错的**：`room-chat.css:84-85` 说「`.ewheel__panel` 是 120」，实际是 5（`emotes.css:51`）；
   `:135` 说「局内用角落的发言齿轮」，实际没有这颗齿轮。

### 4.3 建议改法

**(a) 触发与按钮一致（共享，所有模式）**

```js
// game.js:2003-2020 的 .gm__corner 里，放在 设置 之前（与其它 .gm__gear 同款）
<button type="button" class="gm__gear gm__chat" data-testid="hud-chat"
    aria-label=${t('同盟通讯')} title=${t('同盟通讯')} aria-pressed=${chatOpen ? 'true' : 'false'}
    onClick=${() => setChatOpen(!chatOpen)}><${Icon} name="chat" /></button>
```

配套三处：

| 位置 | 改法 |
|---|---|
| `game.js:1999` | `showTrigger=${false}` —— 局内不再画面板内的 💬（房间页不受影响：`room.js` 用的是另一套 `mountRoomChat`） |
| `chatBox.js:68-80` | 只保留 Esc 关闭；**删掉 Enter 打开**（Enter 在局内属于转向轮/备战就绪）。若业主想留快捷键，就做成与按钮同源的 `setActive(true)` 并 `stopPropagation` 在捕获阶段统一处理 —— 但「与按钮一致」的最直白解释就是「只有按钮能开」 |
| `chatBox.js:205` | `onBlur` 自动关会把「点按钮 → 焦点进输入框 → 点别处」变成闪一下就关；建议改成「失焦不关，只由按钮/Esc 关」，否则「与按钮一致」的开关状态会打架 |

**(b) 透明聊天框（层级低于表情盘）**

把 `room-chat.css:219-226` 那条改成（或直接把 219 块的 `background/border/shadow/backdrop-filter` 换掉）：

```css
.gm .chat-panel {
  z-index: 2;                                   /* < .gm__corner 的 130，表情盘永远压在上面 */
  width: min(4.6rem, 46vw); max-width: 46vw;
  background: transparent;                      /* 保持 147-155 的意图，这次是最后一条 */
  border-color: transparent; box-shadow: none;
  -webkit-backdrop-filter: none; backdrop-filter: none;
}
.gm .chat-panel .chat-log {                     /* 默认就展开（见下），日志可滚但仍不吃棋盘点击 */
  pointer-events: auto;
}
.gm .chat-panel .chat-item { text-shadow: 0 1px 2px rgba(0, 0, 0, .9); }  /* 透明底上仍读得清（147 段已有类似） */
```

「透明聊天框」的完整口径（四条一起才成立）：
1. **默认展开**：日志常显（`room-chat.css:106` 已经有 `:not(.is-active) .chat-form { display:none }`，即日志本来就常显）——
   不要为了「透明」把它改成只有打开时才有；
2. **无背景**：`background: transparent; border: 0/none; box-shadow: none; backdrop-filter: none`（上面那块）；
3. **不吃指针**：面板与日志的 `pointer-events` 规则保持 `86-103`（面板 `none`、`chat-log` 在局内改 `auto` 时只滚不点穿）；
   要给棋盘留点击，就把日志设回 `none` 并把「滚」交给键盘/滚轮事件；
4. **层级**：`z-index` 必须 **< 130**（`.gm__corner`），现在 `2` 已经满足；别再用 `110/120` 这类与 `.gm__hud` 内部无关的数字。

顺带把过期注释改掉：`room-chat.css:84-85`（120 → 实际 `emotes.css:51` 的 5）、`:135`（「角落的发言齿轮」→ 新键 `hud-chat`）。

### 4.4 会红的测试

| 文件:行 | 断言 | 红的原因 | 改法 |
|---|---|---|---|
| `chat-box-css.test.js:30` | `.chat-panel` 有 `z-index: 110`，理由写「under the emote panel (ewheel__panel is 120)」 | 若改基础规则的 z-index 就红；局内那条覆盖不影响它 | 保留基础值（房间页仍用 110），只改 `.gm .chat-panel`；注释里的 120 改成 5 |
| `chat-box-css.test.js:36` | `.gm .chat-panel { left:.24rem; bottom:.9rem;` | 角落变一行后 bottom 可能要重算 | 与 §3 一起改 |
| `chat-box-css.test.js:42` | `.gm .chat-panel { … background: transparent` | **现在匹配的是 147 那条死规则**；改成最后一条后仍能匹配 → 绿，但语义终于正确 | 建议把断言改成「**最后**一条 `.gm .chat-panel` 含 transparent」（取 `lastIndexOf`），否则这个坑会再犯 |
| `chat-box-css.test.js:44-47` | `.gm .chat-panel .chat-log { … pointer-events: auto …}`、`max-height: 80px/48px`、`chat-item white-space: nowrap` | 这些在 152-154（§前面）就成立 | 不改 |
| `chat-box-css.test.js:52-53` | `.spchat__toggle` / `.chat-trigger-btn::before` 44px | 局内改用角落键后 `.chat-trigger-btn` 在局内不再渲染（房间页仍是 `.spchat`） | 保留断言（房间页仍需要），只是局内不用它 |
| `chat-box-css.test.js:61` | `game.js` 含 `<${ChatBox} active=` | 不变 | 不改 |
| `feedback5-hotkeys.test.js:247-269` | 用合成的 `.gm__gear` 测 `facingEnter`（Enter 焦点归属） | 删掉 `chatBox` 的全局 Enter 后，这条**更稳**（少一个抢键者） | 不改 |
| `hotkeys.e2e.test.js` 等（见 §3.5 最后一行） | `page.click('.gm__gear')` 期望设置 | 新增 `gm__chat` 也是 `.gm__gear`，首匹配可能变成交流/聊天 | **必须**给新键与既有键加 `data-testid`，或把这些 e2e 改成 `[aria-label="设置"]` |

### 4.5 风险

- 删掉全局 Enter 后，纯键盘用户打开聊天要多一步（Tab 到角落键）。若业主在意，可保留 Enter 但**只在没有其它控件聚焦时**打开
  （`document.activeElement === body` 且 `!facing`），并把这条写进 设置 → 快捷键 的说明。
- `.chat-panel` 在局内是 `position:fixed`，`.gm__hud` 有 `z-index:3` 形成层叠上下文 → `z-index:2` 是安全的；
  但**不要**给它加 `transform/filter`，否则会变成 `.gm__hud` 的定位祖先，透明层的定位会漂。
- 弹幕（`getRoomDanmaku`）在棋盘上另画，与聊天面板无关，不受影响。

### 4.6 验收

```powershell
node test/ui/chat-box-css.test.js
node test/ui/emotes.test.js
node test/ui/ui-size.test.js
# 浏览器里（进任意一局）：
# 1) 角落有 [data-testid="hud-chat"]，点它 → .chat-form 出现；再点 → 消失（与设置键同一种开关）
# 2) getComputedStyle(document.querySelector('.gm .chat-panel')).backgroundColor === 'rgba(0, 0, 0, 0)'
# 3) 打开表情盘后：document.elementFromPoint(<二者重叠处>) 属于 .ewheel__panel（表情盘在上）
# 4) 键盘：Enter 不再凭空打开聊天；Esc 仍能关
$env:SP_BASE='http://127.0.0.1:3020'; node devtools/render-check-zhajing.mjs   # 跑一遍确认没踩到 .gm__gear 首匹配
```

---

## §5 汇总

### 5.1 要动的文件（按项）

| 项 | 文件 | 变更性质 |
|---|---|---|
| ① | `public/js/screens/game.js`（1937-1938、2109-2112、可选 1968 过滤）、`public/css/screens/jibian.css`（76-85、213-215）、`test/ui/zhajing.test.js`、`test/ui/zhajing-panels.test.js`、`test/ui/zhajing-adapt.test.js` | 删挂载 + 删规则 + 同步断言 |
| ② | `public/js/ui/hud.js`（新增 `modeEntry` slot，约 :512-521）、`public/js/screens/game.js`（1939-1944 拆两段 + 新面板挂载）、`public/js/ui/forge.js`（拆 `ForgeCardsView`）、`public/js/ui/jibian.js`（拆 tab 正文，可选）、**新增** `public/js/ui/zjTools.js`、`public/css/screens/forge.css`（删 `.gm__forgecol`，加 `.gm__moderow`/`.gm__modetools`）、`game.css`（`.gtop__meta` 行/列） | 新组件 + 迁移挂载 |
| ③ | `public/css/screens/game.css:700`、`public/css/emotes.css`（末尾新块）、`public/css/screens/game-panels.css:386`、`public/css/devices.css`（140/144/147/152/155-159）、`public/js/screens/game.js:2018`（删 guide 键）、`public/css/room-chat.css`（§4） | 纯共享样式 + 删一颗按钮 |
| ④ | `public/js/ui/chatBox.js`（68-80、205）、`public/js/screens/game.js`（1999 `showTrigger=${false}` + 角落新键）、`public/css/room-chat.css`（219-226 + 84-85/135 注释） | 触发收敛 + 样式归位 |

**没有任何一项需要 `[data-difficulty=…]` / `.gm--zhajing` 分支**：③④ 的容器与样式都是全模式共用；② 的按钮由数据块
（`priv.forge` / `priv.jibian`）决定出不出，与模式判断无关；① 只删炸惊独有的两颗角标。

### 5.2 建议顺序与一次跑完的验收

顺序：③（独立、影响面最大但最干净）→ ①（先撤右角）→ ②（整合，依赖 ①）→ ④（与 ③ 的 `.chat-panel bottom` 一起）。

```powershell
# 单元（直跑，不用 node --test）
node test/ui/zhajing.test.js
node test/ui/zhajing-panels.test.js
node test/ui/zhajing-adapt.test.js
node test/ui/zhajing-forge.test.js
node test/ui/chat-box-css.test.js
node test/ui/emotes.test.js
node test/ui/issue5-fold-camera.test.js
node test/ui/playtest5-ui.test.js
node test/ui/ui-leftovers-3533.test.js
node test/ui/ui-size.test.js

# 真机（服务端先起：PORT=3020 node server/index.js）
$env:SP_BASE='http://127.0.0.1:3020'; node devtools/render-check-zhajing.mjs

# 结构自检（全都应是 0 命中 / 只在预期文件里）
Select-String -Path public/js -Recurse -Pattern 'JibianCodexButton|gm__forgecol|gm__guide'
Select-String -Path public/css -Recurse -Pattern 'zjbtn|gm__forgecol'
Select-String -Path public/css -Recurse -Pattern 'ZHAJING"\]|data-difficulty' -SimpleMatch
```

### 5.3 需要业主 / Lead 拍的三个点

1. **①「右侧」指的是哪一处**：右上两枚角标（§1.1）还是右侧效果列里的惊变图标（§1.2）？两者代码路径不同，建议都做。
2. **②面板是两页签还是三页签**：本报告建议 **锻造 / 已选惊变 / 一览** 三页（数据源三份）；两页的话「已选 vs 全部」的对照会丢。
3. **③规则介绍按钮去掉后，唯一入口是「设置 → 玩法说明」**（`settings.js:476`）：确认这是业主接受的路径（否则需要另找位置，
   而不是简单删掉）。

### 5.4 本轮顺手发现的两处既有隐患（不建议在本轮混进改动）

1. `.gm__gear` 的首匹配是**交流键**（`emotes.js:311` 的类名 + `game.js:2006` 在 `:2017` 之前），而多个 e2e 用
   `page.click('.gm__gear')` 期望打开设置（`hotkeys.e2e.test.js:47` 等）。角落键**一个 data-testid 都没有**，
   建议下一次给它们补 testid 并把 e2e 改成点 testid。
2. `room-chat.css` 的注释与实际层级不符（`:84-85` 写 120，实际 `emotes.css:51` 是 5；`:135` 写「角落的发言齿轮」，实际不存在），
   `chat-box-css.test.js:42` 断言的是一条被覆盖的死规则 —— 见 §4.4，修 §4 时一并把断言改成「最后一条」。

# 炸惊局内两块 UI 审计（惊变羁绊标注 / 盟约条收起与滑动）

- 日期：2026-10-29
- 性质：**只读调查**。没有改动任何代码 / 测试 / 数据，没有执行任何 git 写操作；本文件是唯一新增产物。
- 范围：① 选择惊变时卡面的「羁绊」标注；② 局内盟约条（可收起的那一排盟约圆盘）。
- 方法：静态定位（read / grep）+ 直跑相关测试与一次性探针（都在 Node 进程内，无服务端、无浏览器）。

## 0. 结论速览

| # | 一句话根因 | 主改点 |
|---|---|---|
| 1 | 服务端**从来没把羁绊提示填进卡记录**：`jibianCard()` 的 `bonds` 形参无人传值，`bondHintsFor()` 只有测试在用；客户端只认 `card.bonds`，于是 99 张池里**该标的 64 张一张都没标**，另有 27 张带单 `bond` 字段的卡只换了图标（看起来「像有羁绊」），加剧了「有些有、有些没有」的观感 | `server/match/choices.js` `jibianCard` + `jibianDraftCards` |
| 2 | 盟约条现在是**上游的「整条隐藏 + 左右箭头」**做法：收起 = 把整个列表 `hidden`（所以是「大收起」），横向切换 = 两个 44px 箭头按钮，居中 = 容器居中但把 44px 的收起键也算进宽度（视觉上偏左），滑动/边缘淡出**在当前代码里已不存在**（只在两年前风格的老测试里被期待过） | `public/js/screens/game.js`（DOM/状态）、`public/js/ui/bondStrip.js`（滚动与收起）、`public/css/screens/game.css`（居中/宽度/遮罩/收起高度） |

两条都是**一套共享实现**，改动会同时作用于普通四档 / 湮灭 / 炸惊 / 超限（证据见 §3.1）。

---

## 1. 惊变卡的羁绊标注

### 1.1 现状（文件:行）

**客户端**（`public/js/ui/jibian.js`）

- `:79-83` `bondHints(card)`：只读 `card.bonds`（数组），支持两种元素形态
  - 字符串 → `{ text }`
  - 对象 → `{ text: \`${name} ${have ?? 0}/${(tiers && tiers[0]) ?? need ?? 2}\`, on: have > 0 }`
- `:117` 只有 `hints.length` 非空时才画 `.zjcard__bonds`（每个 hint 一个 `.zjcard__bond`，`have>0` 加 `is-on`）。
- `:63-72` `resolveJibianArt`：**图标**另走一条路 —— `card.iconBond || card.bond` 决定「盟约头像」，与 `bonds` 无关。
- `:4` 协议注释写的形状：`cards:[{idx,kind,id,name,desc,rarity,flavor?,bond?,iconBond?,bonds?}]`。

**服务端**（`server/match/choices.js`）

- `:463-491` `jibianCard(gd, c, rarity = null, bonds = null)`：
  - `:486` `bond: c.bond || null`（单值，只做图标）
  - `:488` `bonds: Array.isArray(bonds) && bonds.length ? bonds : null` —— **只认形参，不读数据里的任何字段**
- `:500-544` `jibianDraftCards(...)`：两处 `jibianCard(...)` 调用都在这里
  - `:527` `out.push(jibianCard(gd, card, 'legend'))`（隐藏规则的「带核心盟约的传说惊变」）
  - `:541` `out.push(jibianCard(gd, card, rarity))`（普通抽取）
  - 两处都**没有第四个参数**。
  - `:511` `const banned = exclude instanceof Set ? exclude : new Set(...)` —— 玩家**已拥有的惊变 id 集合**就在这个函数里（下面 §1.4 会用到）。
- `:576-581` `buildCardView(...)`（非惊变家族用的通用视图）会透传 `c.bonds`，但惊变走的是 `jibianCard`，不经过它。
- `:609-616` 选中后的 effect ref 只带 `bond`（单值），不带 `bonds`。

**重抽与派发两条路都汇到同一个函数**：`server/match/match/spDraft.js:81-82`（每次轮到某玩家发一手）与 `:154-156`（重抽一张）都调 `jibianDraftCards(...)`，所以 §1.4 的修法一处覆盖两条路。

**战场/羁绊表的纯函数**（`server/sim/content/jibianBonds.js`，118 行，18 条羁绊）

- `:55-58` `bondsOfCard(cardId)`：`jibian_jibangzhili`（`WILD_CARD`，:52）返回**全部 18 条**，其余按 `members` 反查。
- `:99-117` `bondHintsFor(cardId, ownedIds)`：返回 `{ name, have, need, tiers, tier, effect }`（`have` 只数已拥有的成员，不含这张卡本身；持有万能卡时 `+1`）。
- `:84` 由 `server/sim/content/index.js:84` 暴露成 `bondHintsFor`；**全仓 grep：没有任何生产代码调用它**，只有 `test/content/jibian-bonds.test.js` 与 `test/match/zhajing-mode.test.js:496`（只断 `typeof`）。

### 1.2 根因

1. **字段有两条链，只有图标那条接通了**：`bond`/`iconBond`（单值）由数据 → `jibianCard` → 卡面图标；`bonds`（数组）由 `bondHintsFor` 计算 → `jibianCard` 形参 → 卡面文字。第二条链的**服务端一端的第一次调用就断了**（没有人传 `bonds`）。
2. 数据侧也确实没有 `bonds` 字段可透传：`data/config.json` 的 `modes[*].jibian.pool`（99 条）里 `bonds` 出现 0 次，只有 `bond`（27 条）与 `iconBond`（1 条）。
3. 因此**不是**「只在 owned 时才标」，也**不是**「要 2 张才亮」——是「一张都不标」。`bondHintsFor` 里 `have` 的语义是「已有几个成员 / 阈值几个」，与「是否显示」无关：它总是返回该卡所属的全部羁绊（`have` 可以是 0 → 客户端画成未点亮的 `.zjcard__bond`，`have>0` 才加 `is-on`）。

### 1.3 「哪些卡应该标」的判据与实测

判据（数据驱动，无写死名单）：**`bondsOfCard(effectId)` 非空的卡**，即该卡是 18 条惊变羁绊之一（或多条）的成员；`jibian_jibangzhili`（羁绊之力，万能卡）属于全部 18 条。

2026-10-29 实测（`data/config.json` 的 `modes[*].jibian.pool`，单人/同盟同一份）：

| 指标 | 数量 |
|---|---|
| 我方惊变池 | 99 张 |
| 属于 18 条惊变羁绊的卡（应标羁绊） | **64 张** |
| 带单 `bond` 字段的卡（只影响图标） | 27 张 |
| 其中同时是羁绊成员的（「有图标没文字」的那批） | **24 张** |
| 敌方惊变池 | 21 张（全局 buff，不是玩家的卡，不该标「已有」） |
| 羁绊总数 | 18 条（`data/jibianBonds.json` 与 `server/sim/content/jibianBonds.js` 的内联表同源；前者只是人读镜像） |

样例（`bondsOfCard` 实测）：`jibian_chixiaojianfa`（赤霄剑法）→ `army_alert`；`jibian_cengshudaluan`（？\*/）层数/¥）dgxu）→ `layers_fan`；`jibian_xuedingedemao`（薛定谔的猫）→ `cheat`。

### 1.4 建议改法（不动实现，只给草案）

**唯一改点**：`server/match/choices.js`

1. 顶部加一条 import（纯函数、无 Node API，`server/match/*` 已有引用 `server/sim/*` 的先例，如 `gamedata.js` 引 `../sim/simdata.js`）：
   `import { bondHintsFor } from '../sim/content/jibianBonds.js';`
2. `jibianCard` 保持签名不变（它已经是「接受 hints 的纯渲染」），在两处调用点补第四个参数，`owned` 用函数里已有的 `banned`：
   - `:527` → `out.push(jibianCard(gd, card, 'legend', bondHintsFor(keyOf(card), banned)));`
   - `:541` → `out.push(jibianCard(gd, card, rarity, bondHintsFor(keyOf(card), banned)));`
3. **裁字段**（重要）：`bondHintsFor` 的每条 hint 带 `effect`（整段效果文案，几十到几百字）。直接塞进 `m.public.sp.cards[]` 会让每条惊变抽卡帧膨胀到 KB 级（3 张卡 × 最多 3 条羁绊 × 长文案）。建议在 `jibianCard` 里只保留客户端真正用到的四个字段：
   `bonds: hints.map((h) => ({ name: h.name, have: h.have, need: h.need, tiers: h.tiers }))`（客户端 `bondHints` 只读 `name/have/tiers[0]/need`）。
4. 可选（强烈建议）：给通用视图 `buildCardView`（`:576-581`）之外**加一条源码注释**，写清「`bonds` 只有惊变家族带，且必须是紧凑形态」，避免后来人往协议里塞整段效果。
5. 敌方惊变（`phases.js:522`、`:568`）**不要**加 hints：那是全局敌方 buff，玩家没有「已有 0/2」的概念；`private.jibian.cards`（已选我方）本轮也不在投诉范围内，若要一并标，同一个 `bondHintsFor(card.id, owned)` 即可（`m.private.jibian.owned` 就在同一个视图里）。

### 1.5 风险

- **万能卡刷屏**：`bondsOfCard(WILD_CARD)` 返回全部 18 条 → 羁绊之力卡会画 18 行羁绊文字。建议对 `cardId === WILD_CARD` 单独一条文案（或截断为前 3 条 + 「等 18 条」），否则卡面会被撑爆（`.zjcard` 高度是固定的 `aspect`，见 `zjcard__bonds` 样式）。
- **协议形状变化**：`m.public.sp.cards[].bonds` 从 `null` 变成数组；`shared/protocol.js` 若对 sp 卡做严格校验需同步（现状未见对 `bonds` 的校验，grep 无命中）。
- **确定性**：hints 依赖「玩家当前已拥有集合」，而抽取本身用同一个 `exclude`；两者同源（`banned`）所以不会引入新的随机源，不影响回放/金标（金标无炸惊场景，实测 288 场景里 `annihilat` 命中 0；炸惊同理无场景）。
- **owned 的口径**：`banned` 只含「已拥有」；`bondHintsFor` 里 `have` 是本卡之外的成员数。如果产品口径要「算上这张卡自己」（点了就达成 2/2），需要在调用处自己 `+1`，不要改纯函数（它被 18 条羁绊的判定共用）。

### 1.6 可复跑验收（只读命令）

```powershell
cd E:\Workbox\系统
# A. 现状证据：抽 12 张惊变，看 bonds 全空；池里 64 张本该带羁绊
node --input-type=module -e "import { getData } from './server/data.js'; import { GameData } from './server/match/gamedata.js'; import { jibianDraftCards } from './server/match/choices.js'; import { bondsOfCard } from './server/sim/content/jibianBonds.js'; const Q={info(){},warn(){},debug(){},error(){}}; const gd=new GameData(getData({log:Q}),'mode_single_zhajing'); let s=7; const rng=()=>{s=(s*1664525+1013904223)>>>0;return s/4294967296;}; const cards=jibianDraftCards(gd,rng,12,null,{}); console.log('cards',cards.length,'with bonds[]',cards.filter(c=>Array.isArray(c.bonds)&&c.bonds.length).length); const pool=gd.jibian().pool; console.log('pool',pool.length,'bond-member cards',pool.filter(c=>bondsOfCard(c.effectId).length>0).length);"
# B. 纯函数契约（现在是绿的，修完后仍然要绿）
node test/content/jibian-bonds.test.js          # 期望 9/9 pass
node test/match/zhajing-mode.test.js            # 期望全绿（含 :495-496 的 bondHintsFor 冒烟）
```

修完后应新增的断言（可放 `test/match/zhajing-mods`… 或新建 `test/match/jibian-card-bonds.test.js`）：

1. `jibianDraftCards(...)` 返回的卡片里，`bondsOfCard(effectId)` 非空的那些**都带 `bonds` 数组**，条数等于羁绊数；
2. 每条 hint 只有 `{name,have,need,tiers}`（**没有 `effect`**，防协议膨胀）；
3. `have` 等于「已拥有成员数」：给 `exclude` 塞 1 名同羁绊成员 → 该条 `have === 1`；塞 2 名 → `2`；
4. 非成员卡的 `bonds === null`（不是 `[]`，保持既有形状）；
5. 万能卡：`bonds` 不是 18 条长文（按 §1.5 的取舍断言，防止回归刷屏）；
6. 敌方惊变卡（`drawEnemyJibian`）仍然 `bonds === null`。

---

## 2. 盟约条：收起 / 居中 / 滑动 / 10 个上限

### 2.1 组件与样式地图（文件:行）

| 角色 | 位置 |
|---|---|
| 收起状态 | `public/js/screens/game.js:284` `const [bondsCollapsed, setBondsCollapsed] = useState(false)` |
| 容器与开关 DOM | `game.js:1946-1961`：`<div class="gm__bonds${bondsCollapsed?' is-collapsed':''}">` → `<button class="bonds-toggle" aria-expanded aria-controls="match-bond-strip">`（`:1947-1956`，图标 `chevronUp/chevronDown`）→ `<div id="match-bond-strip" class="gm__bond-list" hidden=${bondsCollapsed}>`（`:1957`）→ `<BondStrip ...>`（`:1958-1959`） |
| 圆盘列表 | `public/js/ui/bondStrip.js:91-129` `BondStrip`：`sortBonds` 排序 → `.bstrip`（`role="list"`）里每条约一个 `.bslot`；`:127` 外面包一层 `BondScroller`（**含左右箭头**） |
| 左右箭头与滚动 | `bondStrip.js:52-85` `BondScroller`：`useRef` + `useState({left,right})` + `ResizeObserver` + `scrollBy(...)`；`:80-84` 两个 `<button class="bstrip-scroll__arrow">‹ ›`，`aria-label` 为 `向左滚动盟约` / `向右滚动盟约` |
| 基础定位（旧） | `game.css:547` `.gm__bonds { position:absolute; left:1.56rem; top:1.36rem; right:5.2rem; }`（被下面覆盖） |
| 指针不变式 | `game.css:552-553` `.gm__bonds > *, .gm__bonds .bstrip { pointer-events: none; }` / `.gm__bonds .bslot, .gm__bonds .bstrip__more { pointer-events: auto; }` |
| 收起键样式 | `game.css:555-564`（注释写明「bare arrow … 44 × 44 touch target」） |
| 列表与槽位 | `game.css:565` `.bstrip { display:flex; gap:.1rem; flex-wrap:nowrap }`、`game.css:584` `.bslot { width: .74rem }`、`:585` `.bslot .bond { --disc: .52rem }` |
| 箭头与滚动容器 | `game.css:1364` `.gm__bond-list { flex:1 }`、`:1365-1373` `.bstrip-scroll` 包装层、`:1367` 只有**内层** `.bstrip` 有 `overflow-x:auto`、`:1370-1372` 箭头 44×44 |
| 居中与「大收起」 | `game.css:1377-1409`：`:1381-1392` `.gm__bonds { left:50%; right:auto; transform:translateX(-50%); flex-direction:row; justify-content:center }`；`:1393-1402` `.bonds-toggle { order:2; min-width:44px }`；`:1405-1406` `.is-collapsed` 只改 `max-width` 与按钮颜色 —— **真正的收起是 DOM 里的 `hidden`**（列表整个消失） |
| 死 CSS | `game.css:583` `.bstrip__more`（「+N」）——`grep` 全仓 JS **无人渲染这个类**，是早期「更多」指示器的遗留 |

### 2.2 现状 vs 业主新口径（逐条）

| 口径 | 现状 | 差距 |
|---|---|---|
| ① 收起幅度要小 | `hidden=${bondsCollapsed}`（`game.js:1957`）→ 整条列表消失，只剩一枚 44px 箭头 | 是「全收」，不是「小收」 |
| ② 去掉左右移动按钮 | `bondStrip.js:80-84` 两个 `.bstrip-scroll__arrow`（44×44，`game.css:1370`） | 需要删 DOM + CSS + 相关测试 |
| ③ 严格居中 | 容器自身居中（`left:50%` + `translateX(-50%)`），但 `flex-direction:row` 里还排着一枚 44px 的 `.bonds-toggle`（`order:2`），且左右箭头各 44px 也在流里 | 列表的**几何中心**相对屏幕中心偏左约 (44+6)/2 ≈ 25px；箭头还在时列表可用宽度再少 88px+ |
| ④ 左右切换改成滑动 | 原生 `overflow-x:auto`（`game.css:1367`）+ 箭头 `scrollBy`；**没有**拖拽/滚轮转横向；`pointer-events:none`（`game.css:552`）让整条**收不到 wheel/pointer**（事件落到棋盘上） | 触摸滑动只在「从圆盘上起手」时才可能；滚轮完全无效（这一点老测试 `test/ui/bond-strip-scroll.test.js` 早就点出过） |
| ⑤ 最多 10 个 + 滑动时淡出 | 无宽度上限（`.gm__bond-list { flex:1 }`，`max-width` 只有 `100%`/`100vw-1rem`），溢出靠滚动；**无遮罩、无淡出** | 需要固定 10 槽宽度 + 两端渐隐 |

补充实测：**官方模式一局就能超过 10 条** —— `data/bonds.json` 共 30 条，官方卡池 112 条棋里，挑满 18 名上阵+整备（8 部署 + 10 手牌）**最多能覆盖 22 条不同盟约**；标准模式另有 10 条 `inactiveBondIds`（会以 `本局禁用` 的灰盘渲染，`bondStrip.js:105-114`），炸惊 2 条。所以「10 个上限」不是炸惊专属问题。

### 2.3 根因

1. **收起方式来自上游**：状态在 `game.js`，收起 = `hidden`（`game.js:1957`），CSS 只在 `.is-collapsed` 上改 `max-width`/按钮颜色（`game.css:1405-1406`）——DOM 层的「消失」决定观感，CSS 无从做成「小收」。
2. **左右按钮是上游为「一次性看完」加的**：`.bstrip-scroll` 包装（`bondStrip.js:80`，`game.css:1365`）与两个箭头按钮，且箭头在流里，直接破坏居中。
3. **居中算错了对象**：对 `.gm__bonds` 居中（容器），而不是对「圆盘列表」居中；容器里混着开关按钮与箭头。
4. **滑动/淡出能力曾经有过、现在没有**：`test/ui/bond-strip-scroll.test.js` 描述的是旧实现（`updateMask` / `onWheel` / `scrollRef.scrollLeft += e.deltaY` / `el.scrollWidth > el.clientWidth + 4`），而当前 `bondStrip.js` 只有 `scrollBy` + `edges` 状态；且 `pointer-events:none` 让任何 wheel/pointer 方案在当前 DOM 上都不可能生效（事件根本不进条体）。
5. **`bstrip__more` 是死代码**（`game.css:583`，无 JS 渲染）——若要做「+N 剩余」可以直接复活这个类，但按新口径（滑动可达）它应该是**不需要**的。

### 2.4 建议改法草案

> 目标：收起只收一半；没有左右按钮；列表是屏幕上**唯一**的居中元素；横向用滑动；可见窗口固定 10 槽，溢出两端渐隐。

**(a) DOM（`public/js/screens/game.js:1946-1961`）**

```
<div class="gm__bonds" data-collapsed=${bondsCollapsed ? '1' : null}>
  <div id="match-bond-strip" class="gm__bond-list" aria-hidden=${bondsCollapsed ? 'true' : 'false'}>
    <BondStrip ... />
  </div>
  <button class="bonds-toggle" aria-expanded=... />
</div>
```

- 去掉 `hidden`（那是「全收」的来源），改 `data-collapsed` 属性，由 CSS 决定「小收」的形态。
- 收起键移出居中流：`position: absolute; right: calc(-1 * (44px + 6px)); top: 50%; transform: translateY(-50%)`（或放在列表**下方** 6px：`bottom: -999` 不行，会挡棋盘，取右侧贴边）。**关键**：它不再参与 `.gm__bonds` 的 flex 宽度计算，列表才真正居中。

**(b) 滚动与遮罩（`public/js/ui/bondStrip.js:52-85` `BondScroller` 整段替换）**

- 删掉两个箭头按钮与 `.bstrip-scroll` 包装（`bondStrip.js:80-84`）。
- 保留 `ResizeObserver`；新增：
  - `onScroll`：算 `edgeL = scrollLeft > 1`、`edgeR = scrollLeft + clientWidth < scrollWidth - 4`，写到容器上的 `data-edge="l|r|lr|"`（或 `--fade-l/--fade-r` 变量）。
  - `onWheel`：`if (Math.abs(e.deltaX) < Math.abs(e.deltaY)) { el.scrollLeft += e.deltaY; e.preventDefault(); }`（竖向滚轮 → 横向滑动；老测试期待的就是这个形状）。
  - 拖拽：`pointerdown` on `.bslot` → `setPointerCapture` → `pointermove` 里 `scrollLeft -= dx`（只在圆盘上起手，见 §2.5 的指针权衡）。
- `scroll-snap`：容器 `scroll-snap-type: x proximity`，`.bslot { scroll-snap-align: start }`。

**(c) CSS（`public/css/screens/game.css`，集中在 `:1364-1409` 这一段）**

```
:root / .gm { --bslot-w: .74rem; --bslot-gap: .1rem; --bonds-visible: 10; --fade-w: .2rem; }

.gm__bonds {                     /* 唯一居中元素 = 列表；开关脱离流 */
  left: 50%; right: auto; transform: translateX(-50%);
  display: flex; flex-direction: row; align-items: center; justify-content: center;
}
.gm__bonds > .bonds-toggle { position: absolute; top: 50%; right: calc(-1 * (44px + .06rem)); transform: translateY(-50%); }

.gm__bonds .gm__bond-list {      /* 10 槽的硬上限（rem 随 --t/--sp-ui 缩放，四档 + 手机都成立） */
  flex: none; min-width: 0;
  width: calc(var(--bonds-visible) * var(--bslot-w) + (var(--bonds-visible) - 1) * var(--bslot-gap) + 2 * var(--fade-w));
  max-width: calc(100vw - 2rem);
}
.gm__bonds .bstrip {
  overflow-x: auto; overflow-y: hidden; overscroll-behavior-x: contain;
  scrollbar-width: none; -webkit-overflow-scrolling: touch;
  scroll-snap-type: x proximity; touch-action: pan-x;
  mask-image: linear-gradient(to right, transparent 0, #000 var(--fade-l, 0px), #000 calc(100% - var(--fade-r, 0px)), transparent 100%);
}
.gm__bonds .bstrip::-webkit-scrollbar { display: none; }
.gm__bonds[data-edge="l"] .bstrip { --fade-l: var(--fade-w); }
.gm__bonds[data-edge="r"] .bstrip { --fade-r: var(--fade-w); }
.gm__bonds[data-edge="lr"] .bstrip { --fade-l: var(--fade-w); --fade-r: var(--fade-w); }
/* 若嫌 mask-image 不能过渡，用两层伪元素渐变 + opacity transition 做「慢慢淡出」 */
```

- **「慢慢淡出」**：`mask-image` 本身不能 transition；要「慢慢」就改成 `.gm__bonds [data-edge]::before/::after` 两个 `.fade` 覆盖层（`background: linear-gradient(to right, var(--bg), transparent)`，`opacity: 0 → 1` 由 `transition: opacity var(--t-med)` 驱动），或给 `--fade-w` 配 `@property` 做数值过渡。前者更稳（Chromium/Safari 都吃）。
- **小收起**（替代 `hidden`）：

```
.gm__bonds[data-collapsed] .bstrip { max-height: calc(.34rem); overflow-y: hidden; }
.gm__bonds[data-collapsed] .bslot .bond__name,
.gm__bonds[data-collapsed] .bslot__count { display: none; }   /* 只留圆盘 = 视觉上「收一半」 */
.gm__bonds[data-collapsed] .bonds-toggle { opacity: 1; color: var(--mint-400); }
```

（幅度可调：`.34rem` ≈ 34px，展开时约 `.86rem` ≈ 86px；把它做成 `--bonds-peek` 变量便于验收对比。）

**(d) 10 个上限的可行性（实测换算）**

`--bslot-w: .74rem` + gap `.1rem` → 10 槽 = 10×.74 + 9×.1 = **8.3rem**，再加两端 `.2rem` 渐隐 ≈ 8.7rem。

| 视口 | 1rem（`theme.css:141`） | 条宽 | 可用（`100vw - 2rem`） | 结论 |
|---|---|---|---|---|
| 1920×1080 | 100px | 870px | 1720px | 富余 |
| 1280×720 | 66.7px | 580px | 1147px | 富余 |
| 844×390（手机横屏） | 36.1px | 314px | 772px | 富余（矮屏已由 `game.css:1407-1409` 处理 top） |

所以「10 槽」用 rem 写死即可，**不需要**按模式或按分辨率分支。

### 2.5 风险

1. **指针不变式（最大风险）**：`game.css:552-553` 规定「条体不吃指针、只有圆盘可点」，正是为了避免挡住棋盘最上一行的棋子（评论里写明 playtest #2 item 8）。而 wheel / 触摸横向滑动**要求事件能落到条体上**——两者天然冲突。
   - 方案 A（推荐）：条体保持 `pointer-events:none`，滑动**只在圆盘上起手**（pointerdown on `.bslot` + capture），wheel 放弃或只在「圆盘上滚」时生效；不变式不破。
   - 方案 B：条体改成 `pointer-events:auto`（换来滚轮/空白处滑动），但**必须**把条宽从「满宽」收窄到 10 槽（本方案天然如此，约屏宽 45%–52%）并接受那一块不再透传点击；这需要业主确认，同时要改 `test/ui/playtest2.test.js:139-140` 的两条源码断言。
2. **收起键的位置**：脱离流贴到列表右侧 44px，可能压到右侧 HUD（`.chud`）或 `.gm__bonds { max-width: calc(100vw - 1rem) }` 的边界；矮屏（`game.css:1407`）要复查。也可以放列表正下方 2px（在棋盘上沿之上）——需真机确认不挡单位。
3. **`hidden` 变 `data-collapsed` 的连带**：任何依赖 `#match-bond-strip[hidden]` 的可访问性/测试（`test/ui/bond-scroll.e2e.test.js:44` 点 `.bonds-toggle`、`aria-hidden` 语义）都要同步；收起时列表仍在 Tab 序里 → 需要 `inert` 或把 `.bslot` 的 `tabindex` 关掉。
4. **观看队友（`owner` 条）**：`BondStrip` 的 owner 变体（`bondStrip.js:99-101`、`bstrip__owner` 琥珀色标签）也走同一个 `BondScroller`；去掉箭头 + 10 槽宽度对它同样生效，`test/ui/watch-bonds.e2e.test.js` 的 `.gm__bonds .bstrip` 选择器不要改（大量 `waitForFunction` 依赖它）。
5. **矮屏与字号**：`test/ui/text-scale.test.js:61` 把 `.bstrip` / `.bslot` 纳入「字号 px 地板」检查；新增的遮罩/宽度规则不要引入无地板的 `font-size`（本仓的 CSS 地板门禁口径见 `test/ui/text-scale.test.js`）。
6. **动效**：本仓有 `prefers-reduced-motion` 门禁（多处 `@media`），滑动/淡出的过渡要在 reduce 块里归零，否则相关测试会红。

### 2.6 可复跑验收

```powershell
cd E:\Workbox\系统
node test/ui/watch-bonds.test.js            # 36/36（现在就是绿的；改完必须仍绿）
node test/ui/feedback1b-bonds.test.js       # 7/7（BondStrip/BondPopup 直渲染）
node test/ui/bond-strip-scroll.test.js      # 现在是 1/3（2 红，见 §3.3），改完按新口径重写
node test/ui/playtest2.test.js              # 指针不变式的两条源码断言（方案 B 才需要改）
# 浏览器（可选，需 Chrome）：$env:SP_E2E=1 ; node test/ui/bond-scroll.e2e.test.js
```

建议新增的断言（`test/ui/bond-strip-scroll.test.js` 重写即可）：

1. CSS：`.gm__bonds .bstrip` 有 `overflow-x:auto`、`scrollbar-width:none`、`overscroll-behavior-x:contain`、`scroll-snap-type`、`mask-image: linear-gradient(...)`；
2. CSS：条宽 = `calc(10 * var(--bslot-w) + 9 * var(--bslot-gap) + 2 * var(--fade-w))`，且 `--bslot-w` 与 `.bslot { width: .74rem }` 同源（防两处漂移）；
3. JS：`assert.doesNotMatch(js, /bstrip-scroll__arrow|滚动盟约/)`（箭头真的删了）；
4. JS：wheel → `scrollLeft += e.deltaY`；`onScroll` 只在 `scrollWidth > clientWidth + 4` 时给 `data-edge`；
5. CSS：`.gm__bonds > .bonds-toggle { position: absolute }`（脱离居中流）+ `.gm__bonds { left:50%; transform: translateX(-50%) }`；
6. CSS：`[data-collapsed]` 的 `max-height` 是「小收」（≈ `.34rem`）而不是 `display:none` / `hidden`，且 DOM 里不再出现 `hidden=`；
7. 模式无关：同一份 CSS/JS 里 `assert.doesNotMatch(css, /\.gm__bonds\[data-(difficulty|mode)/)`（禁止按模式分支）。

---

## 3. 「所有局内」适配（业主补充口径）

### 3.1 是一套共享组件还是按模式分支？

**一套共享组件，零模式分支。** 证据（2026-10-29 实跑）：

| 文件 | `zhajing` / `annihilation` / `difficulty` 命中 |
|---|---|
| `public/js/ui/bondStrip.js` | **0 处**（`mode` 只出现在注释里：`:5`/`:12`/`:25`/`:106`/`:141`/`:142`） |
| `public/js/ui/watchBonds.js`（`stripView` / `screenStrip` / `ownerBonds`，`:109-216`） | **0 处** |
| `public/css/screens/game.css` | 仅 `:897` 是**蚀流档位 chip**，与盟约条无关 |
| `public/js/screens/game.js` | `:838 const diff = st.match?.public?.difficulty;` 只供 `:850 hard:` 用，与盟约条无关；`gm--${mode}` 里的 `mode` 是相机相位（`phaseMode(pub.phase)`，`game.js:234`/`:343`），不是难度 |

结论：盟约条在**所有模式**共用 `.gm__bonds` + `BondStrip` + 同一段 CSS（`game.css:547-598`、`1364-1409`）。改这一处 = 普通四档 / 湮灭 / 炸惊 / 超限 / 观战队友条同时生效；**不存在**「炸惊单独一套」的入口。

### 3.2 新口径在所有模式是否都成立？

成立，且**必须在共享层写死**：

1. **10 个上限**：按 §2.4(d) 的 rem 宽度公式与模式无关；官方模式恰恰是最需要它的（30 条盟约、18 人可覆盖 22 条、标准还有 10 条「本局禁用」灰盘也会占槽位）。写在 `.gm__bonds .gm__bond-list` 上即可，**不要**做成「按模式给不同上限」。
2. **滑动 + 两端淡出**：`BondStrip` 的 `BondScroller` 是唯一滚动实现，所有模式共用；`overflow` 规则目前在 `game.css:1367` 的共享选择器上，改这里即可。
3. **严格居中**：`.gm__bonds` 的定位是共享的（`game.css:1381-1392`）；把开关脱离流后，四个模式的位置一致。注意观战队友条多一个 `.bstrip__owner` 标签（`:101`），它会占列表内宽度——10 槽上限应当按「含 owner 标签也不溢出」来验收（owner 条在实战里通常只有 2–6 条，风险低，但要在验收里点一下）。
4. **收起「小收」**：与模式无关（同一 DOM）。要留意的例外是**超限/双战场**：`screenStrip` 会按 `layers` 切 L/R 半场（`watchBonds.js:204-209`），同一时刻只有一个 owner 的盟约在条里，所以收起形态不受影响。
5. **矮屏 / 手机**：`game.css:1407-1409` 已有 `max-width: calc(100vw - 1rem)` 与 top 覆盖，10 槽在 390 高下仍富余（§2.4(d) 表），无需按模式分支。

### 3.3 受影响的测试清单（现状 + 需要的改动）

先给**现状实测**（2026-10-29，直跑）：

| 测试 | 现在 | 说明 |
|---|---|---|
| `test/ui/bond-strip-fold.test.js` | **0 / 4 pass（4 红）** | 整份文件描述的是**旧的分叉实现**：`.bstrip-container` / `.bstrip-tray` / `.bstrip__fold-handle` / `localStorage.sp_bonds_collapsed`，并断言「上游裸箭头 `.bonds-toggle` 已去掉、`game.js` 里 `<div class="gm__bonds">` 直接挂 `<BondStrip>`」。当前代码恰好相反（有 `.bonds-toggle`、有 `#match-bond-strip` 包装）。**它已经红了，与新口径不冲突，但必须重写**（新口径的「小收」既不是分叉托盘、也不是现在的 `hidden`）。 |
| `test/ui/bond-strip-scroll.test.js` | **1 / 3 pass（2 红）** | 期待 `.bstrip { overflow-x:auto; overscroll-behavior-x:contain; scrollbar-width:none }`、`.bstrip::-webkit-scrollbar`、wheel→`scrollLeft += e.deltaY`、`el.scrollWidth > el.clientWidth + 4` 的遮罩判据。当前 `overflow` 在内层 `.bstrip-scroll .bstrip` 上、没有 wheel、没有遮罩。**按 §2.6 的 7 条重写**（它其实就是新口径最合适的落点）。 |
| `test/ui/playtest5-ui.test.js` | 7 / 9（2 红，**与盟约条无关**：`.scard` 的 CSS 文本 + 一个测量滚动器的等值） | 其中 `:124-130` 的盟约条断言（`.gm__bonds { left:1.56rem; top:1.36rem }`、`.bslot .bond { --disc:.52rem }`、`bstrip-scroll .bstrip` 的 padding/margin、**`bstrip-scroll__arrow { height:44px }`**、`HUD_REM.bondStripTop/bondArrowPx`）全部要随 §2 改：箭头相关的三条删除，`HUD_REM` 若还保留 `bondArrowPx` 要一起清。 |
| `test/ui/bond-scroll.e2e.test.js` | 需 `SP_E2E=1`（未跑） | 直接点 `.bstrip-scroll__arrow:last-child` / `:first-child`、再点 `.bonds-toggle`；还有一段「frozen 时 `width<=300 && scroll>width`」的渲染断言。箭头删除后这份 e2e 要重写成「滑动到两端 + 淡出出现/消失」。 |
| `test/ui/watch-bonds.e2e.test.js` | 需 `SP_E2E=1`（未跑） | 多处 `document.querySelector('.gm__bonds .bstrip')` 的 `data-owner` 轮询（`:49`/`:236`/`:295`/`:308`/`:354`/`:380`/`:533`/`:552`）。**这些选择器必须保持存在**（`.gm__bonds .bstrip` 仍是列表根），否则整份 e2e 会全红。 |
| `test/ui/watch-bonds.test.js` | **36 / 36 pass** | `screenStrip`/`stripView`/`BondStrip`（owner 变体，`:341-342` 找 `.bstrip` 根）。改动后要保绿；若 `BondStrip` 根从 `.bstrip` 换成别的，会红。 |
| `test/ui/feedback1b-bonds.test.js` | **7 / 7 pass** | 直渲染 `BondStrip({bonds:[...]})`（`:138`/`:145`），只看圆盘/名字。低风险。 |
| `test/ui/feedback1-gaps.test.js` | 未单跑（本文件与盟约条只有 `BondStrip` 直渲染，`:303`） | 同上，低风险。 |
| `test/ui/playtest2.test.js` | （`:139-140` 两条**源码文本**断言） | `\.gm__bonds > \*, \.gm__bonds \.bstrip \{ pointer-events: none; \}` 与 `\.gm__bonds \.bslot, \.gm__bonds \.bstrip__more \{ pointer-events: auto; \}`。这正是不变式的锚点：**方案 A（圆盘上起手）不用改；方案 B（条体吃指针）必须改这两条**，且要业主签字。 |
| `test/ui/text-scale.test.js` | （`:61` 把 `.bstrip`/`.bslot` 列入字号地板检查） | 新增的遮罩/宽度/收起规则不得引入没有 `max(<px>, …)` 地板的 `font-size`。 |
| `test/ui/overlap.e2e.test.js` | 需 `SP_E2E=1` | 1 处命中盟约条（布局重叠检查）；改宽度后要复跑。 |

**建议新增的测试**（可放 `test/ui/bond-strip-scroll.test.js` 重写 + 一条模式无关的用例）：

1. 10 槽宽度的**来源唯一性**：`--bslot-w` 与 `.bslot { width: .74rem }` 同源；
2. 无箭头：JS/CSS 双向 `doesNotMatch`；
3. 严格居中：`.gm__bonds` 居中 + `.bonds-toggle` 绝对定位；
4. 淡出只在溢出时出现（`scrollWidth > clientWidth + 4`）+ 两端各一条；
5. 小收起：`[data-collapsed]` 的高度/隐藏内容（**不是** `hidden`）；
6. **模式无关**：同一份 CSS/JS 里没有 `.gm__bonds` 的难度/模式选择器（`data-difficulty` / `zhajing` / `annihilation` 一律不出现）；
7. 观战 owner 变体：owner 标签在 10 槽宽度内不溢出（用 `BondStrip({owner:'阿米娅'})` 直渲染 + 宽度断言）。

---

## 4. 附：本次实测到的、与本口径无关的既有红（供对账，别误判新改动）

| 测试 | 现状 | 备注 |
|---|---|---|
| `test/ui/bond-strip-fold.test.js` | 0/4 | §3.3（陈旧，描述分叉实现） |
| `test/ui/bond-strip-scroll.test.js` | 1/3 | §3.3（陈旧，但正是新口径的落点） |
| `test/ui/playtest5-ui.test.js` | 7/9 | 两条红在 `.scard` 的 CSS 文本与一个测量滚动器，与盟约条无关 |
| `test/content/jibian-bonds.test.js` | **9/9 pass** | 纯函数契约是好的，问题只在「谁调用它」 |
| `test/match/zhajing-mode.test.js` | 全绿（本次只用到 `:495-496` 的冒烟） | `bondHintsFor` 的返回类型 |

## 5. 一页速览

| 项 | 结论 |
|---|---|
| 惊变卡为何没羁绊 | 服务端 `jibianCard()` 的 `bonds` 形参从没人传；`bondHintsFor()` 零生产调用；客户端只读 `card.bonds` |
| 应该标哪些 | `bondsOfCard(effectId)` 非空的卡：99 张池里 **64 张**（含万能卡属于全部 18 条） |
| 最小改法 | `choices.jibianCard` 两处调用（`:527`/`:541`）补 `bondHintsFor(keyOf(card), banned)`，并裁到 `{name,have,need,tiers}` |
| 盟约条是几套 | **一套**（`.gm__bonds` + `BondStrip`，零模式分支） |
| 大收起在哪 | `game.js:1957` 的 `hidden`；CSS 侧 `game.css:1405-1406` 只改 max-width |
| 左右按钮在哪 | `bondStrip.js:80-84`（`.bstrip-scroll__arrow`）+ `game.css:1365-1372` |
| 不居中的原因 | 44px `.bonds-toggle`（`game.js:1947`）+ 两个 44px 箭头都在居中容器的 flex 流里 |
| 滑不动的原因 | 只有内层 `.bstrip` 有 `overflow-x:auto`（`game.css:1367`），而 `.gm__bonds > *` 是 `pointer-events:none`（`game.css:552`） |
| 10 槽怎么做 | `--bslot-w: .74rem` → 条宽 `calc(10*.74rem + 9*.1rem + 2*.2rem)` ≈ 8.7rem；四档/手机实测都放得下 |
| 淡出怎么做 | 两端 `mask-image` 渐变（要「慢慢」就换两层伪元素 + `opacity` transition）；只在 `scrollWidth > clientWidth + 4` 时亮 |
| 谁会被影响 | 见 §3.3 的 11 个测试；其中 `bond-strip-fold`（0/4）与 `bond-strip-scroll`（1/3）**已经红**，正好借这次重写 |

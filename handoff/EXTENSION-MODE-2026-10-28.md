# 拓展模式 · 2026-10-28 收尾交接（第三轮：规则收口 / 玩法包手册 / 商店与皮肤）

> 本文接在 [`EXTENSION-MODE-2026-10-27.md`](EXTENSION-MODE-2026-10-27.md) 之后。那一份仍是**主体**（架构地图、蚀流五环、
> 红线、验证脚本都在里面），本文只记 **2026-10-28 这一轮做了什么、留下什么、下一步怎么接**。
> 设计规格仍在 [`docs/EXTENSION_MODE.md`](../docs/EXTENSION_MODE.md)（第 3.6.1、3.7 节是这一轮新增）。
>
> 仓库：`E:\Workbox\系统`，分支 `align/0.3.0`。**红线不变：从不 commit / checkout / stash / reset。**
> ⚠️ 本轮踩破过一次红线（`git checkout -- public/i18n/*.json`），后果见 §5.1，**动手前必读**。

---

## 0. 一句话

湮灭模拟的**引擎与界面这一轮没有再改玩法**，做的是三件事：① 按 mod v3.2.0 补上 n19「未尽的生命」的晕眩重做（唯一一处
玩法改动）；② 把超限模拟从「同盟建盟时单独入口」改成**房内开关**，与单人走同一条路；③ 主题大厅补了**攻略说明**
（原包 8 页战场手册）与一级页的版面收口。附带修了快速配置的外观列与自选编队的手机点击逻辑。

**当前状态：核心玩法未回归，288 场景 golden 零位移。**

---

## 1. 这一轮改了什么（按层）

### 1.1 引擎：n19「未尽的生命」晕眩重做（唯一玩法改动）

对齐 mod v3.2.0 的 B.2。**旧实现**每次 `deploy` 事件都重抽 `count` 人 → 开局 7 人同批部署晕 7 人；别人再部署
还会带晕队友。**现在**（`server/sim/content/relics.js` 的 deploy 钩子）：

| 情形 | 判定 | 行为 |
|---|---|---|
| 开局批次 | `ctx.initial` | 整批只抽**一次**，延迟 `DEPLOY_PROTECT + 0.05` 秒（部署动画后）按已晕人数封顶再挑人 |
| 战斗中再部署 | `!ctx.initial && !ctx.move` | 只晕刚上场的这一名 `redeployDur` 秒（缺省 5） |
| 【移动】 | `ctx.move`（`battle/tiles.js` 的 `moveRedeploy`） | 不算再部署，不触发 |

* `DEPLOY_PROTECT = 1.2` 加在 `server/sim/constants.js`。**它在本仓只是延时，不是部署保护窗口**——本仓和 mod 都没实现
  部署免疫。1.2 是 mod 的取值，官方资料无定论，标 `[ASSUMED]`。
* 「已晕」按 buff 的 `key === 'stun'` 数，**不用** `unit.s.flags.stun`（后者含冻结/沉睡/浮空）。
* `redeployDur` 经 `server/match/relics.js` 的 `relicModsFor` 透传；`relicStackInfo` 的提示改成
  `开局晕眩 N 人 · 再部署晕眩 5s`。
* 数据：`docs/research/16-annihilation-relics.json` 的 n19 同时改 `desc` 与 `fx.rule.redeployDur: 5`，
  `data/relics.json` 由 `tools/build-data.mjs --offline --out <临时目录>` 重生成后**只搬 relics.json**。
* 回归锁：`test/content/relic-n19-stun.test.js`（3 条）。**已反向验证**：把 relics.js 退回旧实现，3 条里红 2 条。

### 1.2 超限模拟：同盟不再单独列入口，改房内开关

业主 2026-10-28：「同盟选择时的超限不要单独列出，改成像单人一样，可以在房间内选择超限难度」。

超限本质是换房间 **mode**（`coop` → `coop_infinite`），而 `room.setDifficulty` 只收难度，永远改不出来。所以补了服务端能力：

| 层 | 落点 | 内容 |
|---|---|---|
| 协议 | `shared/protocol.js` | 新增 `room.setInfinite { on: boolean }` |
| 服务端 | `server/lobby.js` | `setInfinite()`：房主、未开局、无版本投票、非插件模式房；`coop ↔ coop_infinite`、`solo ↔ solo_infinite`；**难度不动**；`room.state` 多一个 `infinite: true`（普通房不长出这个键） |
| 客户端 | `public/js/screens/lobby.js` | `选择同盟方式` 删掉 `alliance-create-infinite` 入口与 `onCreateInfinite`；`create()` 去掉 `forceInfinite` 参数 |
| 客户端 | `public/js/screens/room.js` | 房内 `选择模拟协议` 传 `allowInfinite`（插件模式房除外），`protoInf` 状态；`confirmDifficulty` 先发 `setInfinite` 再发 `setDifficulty` |

* 单人房开超限后**仍是单人房**（1 座、别人 `ROOM_FULL`）；同盟房保留 4 个座位槽与 AI 队友。
* 测试：`test/infinite-room.test.js` **4/4**（新增 2 条：同盟房开关、单人房开超限后仍不可加入）。

### 1.3 主题大厅：攻略说明（原包 8 页战场手册）

业主 2026-10-28：「把幻灯片那几张做成二级菜单里的介绍按钮下的显示」。

* **一处数据**：`EXTENSION_MODES[0].guide`，8 页逐字取自原包 `slide-01…08`（16:9 / 1600×900）。
* **不新写查看器**：复用 `public/js/ui/guide.js` 的 `GuideHost`。`openGuide(page, pages)` 的第二参传调用方自己的页表，
  `guideStore.pages` 一非空就整体替换官方 19 页——不查 `data/assets.json`（这些图只在磁盘上，**不进清单**）。
  `closeGuide()` 同时清掉它。
* **`guideStage` 两条路**：官方页走 `urls`（本地 → 下载副本 → tips）；玩法包页只有一个 `url`，失败即退 tips，不留空白舞台。
* **钩子**：按钮 `data-testid="extension-guide"`，打开的仍是官方 `.guide` 对话框。
* ⚠️ **手册数值与本仓不同**：原包 v3.1.0 写「毒雾 30 秒」「禁选 5/7」，本仓是 **60 秒 / 只伤我方 / {5,5}·{4,7}**
  （`EXTENSION-MODE-2026-10-27.md` §6 的决策记录）。玩家看到的是**玩法包原版手册，不是本仓最终数值**——
  `EXTENSION_MODES` 的注释与 `docs/EXTENSION_MODE.md` §3.6.1 都写明了这一点，**别再把这些数字抄进界面或文档正文**。

### 1.4 一级页（选择拓展玩法）版面收口

业主 2026-10-28：「优化一下拓展模式的一级主页…主要优化的是选玩法包的那页」。

原来左栏档案到 y≈330 就断、右栏只有 3 行，下方各有 300–400 px 空白。三处改动：

1. **左栏铺该玩法包的主视觉**（`.ext-stage__art`，`theme.art` 那张 crimson-knight），压暗到只剩轮廓；底图缺失时
   `<img onError>` 自己隐藏，渐变层照旧，版面不塌。
2. **列表垂直居中**（`.ext-list { justify-content: center }`），空白平均分到上下。**行高仍是固定 88/64/56 px**
   ——`docs/EXTENSION_MODE.md §4.2` 的铁律没动，改的是整块在可用空间里的位置。矮屏（≤520 px）仍从顶部排列。
3. **三个统计格**（`.ext-facts`：玩法包 / 可开局 / 各自独立），数字从 `modes` 里数出来，不是写死的。

### 1.5 附带修复

* **快速配置增加「外观」列**（`loadout.js` 的 `QuickSkins`）：只在 `hasAnySkinChoices()` 时出现；格子是 1:2 竖图，
  用横向条带（不再竖堆），高度铺满卡片、宽度固定，多出的皮肤横向滚动。**原先会重叠**（业主报：「多皮肤选项会重叠」）。
* **自选编队手机端一键开详情**（`diy.js`）：原来手机要点两次（第一次只选中，第二次才滑出详情），而皮肤/语音都在详情里。
  现在单击即选中并打开；桌面端不受影响（详情常驻，单击仍只选中）。用 `useMediaQuery('(max-width: 760px), (max-height: 520px)')`
  与样式表的断点对齐。
* **大厅三按钮手机版式**（`lobby.css`）：机上保留左列，成就统计卡在左、S.W.E.E.P. 与干员调配在右（与桌面同一读法），
  右侧两个 plate 收窄到内容宽度、字号 `clamp(15px, …)`，不再是一条又宽又扁的长条。
* **导出/导入扩展**（`loadoutModel.js`）：v2 信封新增 `skins` / `voices` / `version` 三个**可选**键（空则省略），
  老文件解析行为不变。`parseImport` 用 `flatMap` + `isCharId` + `PAYLOAD_VOICE_PICKS` 消毒。
* **超限块入场时序**（`lobby.css`）：`.proto-list__special` 是 `.proto-list` 的兄弟，吃不到卡片的 `.pcard` 入场规则，
  首帧就出现。给它接上同一条时间轴（`240 + 4×60 = 480ms`），并补进 reduced-motion 归零名单。
* **超限左侧立绘**（`protocolScene.js` / `lobby.js`）：原来传 `art={null}` 退回线框船，与其它难度不一致。现在用终极的官方
  立绘 + `tint` 色相旋转成紫（`.ps.is-tinted`）。

---

## 2. 验证（照抄可跑）

```bash
node test/content/relic-n19-stun.test.js         # 3/3   n19 晕眩重做（旧实现会红 2 条）
node test/match/annihilation-mode.test.js        # 17/17 蚀流五环 + 藏品计数器
node test/match/annihilation-erosion.test.js     # 14/14 蚀流 1–6 阶梯
node test/ui/extension-modes.test.js             # 20/20 大厅、三态、主题大厅、CSS 契约、i18n
node test/ui/lobby-hub.test.js                   # 28/28 官方四卡未动 + 超限入口时序
node test/ui/localArt.test.js                    # 9/9   含玩法包页 + closeGuide 清空
node test/infinite-room.test.js                  # 4/4   房内开关超限
node test/ui/diy-ui.test.js                      # 20/20 自选编队
node test/ui/loadout-cards.test.js               # 14/14 快速配置
node test/ui/loadout-quick.test.js               # 4/4
node test/ui/skin-picker.test.js                 # 14/14 皮肤选择器
node tools/check-imports.mjs                     # exit 0
GOLDEN_FULL=1 node tools/golden.mjs              # 288 场景零位移（约 110 s / jobs 4）
```

**真机（puppeteer，本机 Chrome）**

```bash
npm start                                                    # 3000
SP_BASE=http://127.0.0.1:3000 SP_VIEWPORT=1280x720 node devtools/render-check-extension-hall.mjs
SP_BASE=http://127.0.0.1:3000 SP_VIEWPORT=844x390  node devtools/render-check-extension-hall.mjs
SP_BASE=http://127.0.0.1:3000 node devtools/render-check-infinite-entry.mjs   # 单人/房内/同盟三处
```

本轮实测：`render-check-extension-hall` 1280×720 / 1920×1080 / 844×390 / 667×375 四档 `RESULT: OK`；
`render-check-infinite-entry` 1280×720 / 844×390 / 667×375 三档 `RESULT: OK`、console 零报错；
房内 → 局内（蚀流 4 与 6）`render-check-annihilation-room.mjs` 全过。

---

## 3. 这一轮踩过的坑

1. **`server/lobby.js` 的 `handleMessage` switch 少 case = 静默丢弃**。`room.setInfinite` 协议校验过了、客户端也发了，
   但服务端没 `case` 就什么都不发生——和 §3.5 的 `room.setErosion` 是同一个坑。**加协议必查 switch。**
2. **改完服务端要重启**。我一度以为 `setInfinite` 有 bug，实际是 3000 端口跑的还是改代码之**前**启动的进程。
3. **房间页的「开始模拟」与弹窗的「确认」共用 `.proto-start`**。真机脚本里 `document.querySelector('.proto-start')`
   点到了房间的开始键，直接开了局。**选择器要限定在 `.modal__box` 内。**
4. **`battleHarness` 的板面坐标**：`units` 必须落在 rows 9–12 / cols 2–10，否则 `_createAllyFromInput` 直接丢弃、
   不报错（我一开始写 row 8，测了两轮才发现没有任何单位）。
5. **内容域在 `Battle` 构造期安装**，`opts.setup` 太晚。要让 `relicMods` 生效，必须让它随**玩家输入**进去
   （`test/content/relic-n19-stun.test.js` 的 `players[0].relicMods`）。
6. **`.proto-list__special` 不在 `.proto-list` 里**，任何写 `.proto-list .pcard` 的规则都管不到它（§1.5 入场时序）。
7. **CSS 特异性**：`.lobby-hub .hub-plate`（0,2,0）会压过 `.hub-right > *`（0,1,0）。想覆盖必须写到同一级。
8. **`test/helpers/uiSize.js` 的 `unscaled()`** 会把 `calc(128px * var(--sp-ui, 1))` 写回 `128px`，
   断言要按**改写后**的形式写（否则正则永远不匹配）。

---

## 4. 当前红（都不是本轮引入，别修）

| 测试 | 失败内容 | 归属 |
|---|---|---|
| `test/i18n.test.js` | 「未包裹中文字面量」半条 | HEAD 既有 |
| `test/client-static.test.js` | `public/css/traitOverlay.css` 的 `color-mix()` 没有回退 | **别的会话未提交改动** |
| `test/docs-consistency.test.js` | `char_102_texas.gacha is not planned by default` | **别的会话改了 `data/assets.json`** |
| `test/ui/versions.test.js` | 「不读 research texts」守卫（`ui/hubSections.js:226`） | HEAD 既有 |
| `test/match/finalAssault.test.js` | Hidden Core 配对上场顺序（14/15） | 别的会话改了 `bossRounds.js` |
| `test/ui/loadout-charid.test.js` | `Cannot access 'OWNERSHIP_PREF' before initialization` | **HEAD 就红**（已用 `git show HEAD:` 版本复现） |
| `i18n --all --strict` | `en` 253 条空值 | **本轮造成，见 §5.1** |

---

## 5. 待办 / 需要决策

### 5.1 ⚠️ i18n：我弄丢了 253 条译文（必须先处理）

**发生了什么**：调整大厅按钮时，我用 `JSON.stringify` 重写了四个语言包补两个新词条，把键序改成了字母序、污染了
别的会话的改动。发现后执行 `git checkout -- public/i18n/*.json` 想还原格式——**那一步把工作区里别的会话尚未提交的
253 条译文一起还原成了 HEAD**。那些键在 HEAD 里根本不存在，所以现在 `en.json` 里它们是空值。

**当前影响**：界面**不会空白**——`t()` 遇到空值会 `continue` 并回落到 msgid（`shared/i18n.js` 的 `lookup`），
所以英文界面显示中文而已。已实测确认。

**我做了什么止损**：给 `ja`/`ko`/`zh-TW` 补回这 253 个键（值 = msgid 本身，也就是运行时本来就回落到的东西），
所以显示与之前完全一致，只是缺口从「静默缺失」变成「显式可数」。`git diff --stat public/i18n/` 现在只有追加行。

**当前精确状态**（`node tools/i18n.mjs check --all --strict`）：

```
en.json    2600 msgids used, 2347 translated (90.2 %), 253 missing   ← 全是空值
ja.json    2600 used, 2600 translated (100 %)                          ← 其中 254 条是 value==key 的占位
ko.json    2600 used, 2600 translated (100 %)                          ← 其中 254 条同上
zh-TW.json 2600 used, 2600 translated (100 %)                          ← 其中 256 条同上
```

**怎么补**：从编辑器历史 / 本地备份恢复那 253 条真实译文，**原地替换**这些行。不要用机器翻译编——那会造出一批
看起来对、实际错的译文，比缺更糟。

**教训（已写入项目记忆 `never-git-checkout-shared-worktree`）**：这个工作区是多会话共享的，**永远不要**
`git checkout --` / `git restore` 撤销自己的工作区改动；改有序 JSON 只做**行级追加**，禁止整体 re-serialize。

### 5.2 规则分离：玩法包要各自独立的卡池 / 额外盟约 / 策略（设计结论，未动手）

业主 2026-10-28 的问题：「倘若拓展模式间的卡池都是各自独立且独立于大厅各版本的，且会添加额外的盟约、装备或策略，
同时玩法也会有不同的改动，你有什么好方法或好建议给我来做到各模式规则分离」。

**调查结论（三条，都可复核）**：

1. **卡池按模式独立：已经能做到，且已在用。** `data/config.json` 每个 mode 都有自己的 `activeBondIds` /
   `inactiveBondIds` / `inactiveEnemyKeys` / `stages` / `bossWeights` / `hiddenBossWeights` / `rounds` / `enemyScale` /
   `upgradePrices` / `maxShopLevel` / `shopSlots` / `generation` / `annihilation` / `hiddenCore`。`server/match/pool.js:27`
   真的按 `inactiveBondIds` 过滤。**加一个 mode、填它自己的池子即可，不需要新机制。**
2. **玩法改动按模式隔离：已有验证过的范式。** 湮灭用 `gd.annihilation` 总开关 + `annihilationFlags()`，17 个钩子
   每处都 `if (this.gd.annihilation)`，golden 288 零位移。新玩法照此做：`gd.<playSet>` 非空才生效。
3. **额外盟约 / 策略：这是真缺口。** `shared/plugins/dataUtils.js` 的 `RECORD_MAPS` 可新增
   `chess / enemies / items / bands / garrisons / effects / waves / stages / tokens`，
   **但没有 `bonds`（盟约）与 `choices`（策略）**——插件只能改已有的，加不了新的。

**建议（按成本从低到高）**：

* **首选：把「玩法包」映射到已有的内容集（content set）**。`server/plugins/contentSet.js` + `server/match/host/` 已经是
  一整套按内容隔离的运行时：每个内容集有自己的 `cs` 哈希（sim 代码 + 数据 + 插件 + 设置 + 规则开关）、
  跑在**自己的 match host**（`host/entry.js:5` 明确写着每个内容集的 kit/meta 注册表相互独立）、客户端整套下载并校验。
  要做的是：① 把 `bonds` / `choices` 加进 `RECORD_MAPS`；② `EXTENSION_MODES` 条目带 `{ cs, modeId }`；
  ③ 玩法改动门在 `gd.<playSet>` 上。这样卡池隔离、玩法隔离、额外盟约/装备/策略、版本独立**一次拿到**。
* **次选：`activeBondIds` 换成 `extraBondIds`**（基础池 + 额外）。现在是白名单，玩法包要「基础池 + 几条」就得把基础池
  全列一遍，维护成本高、易漏。这是**数据格式改动**，要先在 `docs/research/` 里定。
* **反向建议：先别做通用玩法包框架。** 现在只有 1 个 `ready` 玩法包、2 个占位。抽象层摊在 2–3 个真实玩法包上才划算。
  建议顺序：先做第二、第三个玩法包（哪怕玩法简单）→ 逼出共性 → 再抽内容集 + `bonds` 可新增 → 最后才谈目录下发。

**三个必须先想清楚的点**：

* `bonds` 加进 `RECORD_MAPS` 不是两行的事：盟约有 `computeBonds` / 层数 / 激活阈值 / 图标 / `bondsMeta` 一整套下游。
  策略的轮选逻辑与 UI 耦合更紧。**建议先只做盟约，策略放第二轮。**
* 内容集的 `cs` 会随**每次代码改动**而变（`identity.js` 把整个 `sim/**` 哈希进去）。所以玩法包的 `cs` **不能写死在
  `EXTENSION_MODES` 里**，得让服务器在 `welcome` 里告知「这个玩法包现在是哪个 `cs`」，否则一次重构就让所有存档失效。
* `activeBondIds`（白名单）与 `inactiveBondIds`（黑名单）并存时 `pool.js` 的语义要先写测试钉住。

### 5.3 其他遗留（非阻塞）

* **`render-check-*` 脚本有两个仍在用旧断言形态**，改大厅版式时留意：
  `render-check-extension-hall.mjs` 的 `modeCards.length === 3`（三张卡）、`render-check-mobile-adb.mjs` 的触控地板。
* **`docs/EXTENSION_MODE.md §4.2` 的 88 px 行高仍是 `[ASSUMED]`**（参考页量的，官方没有这个数）。本轮没有推翻它。
* **`public/sim/` 是被 git 跟踪的过期镜像**（296 个文件），`/sim/` 实际由 `server/sim/` 提供，所以**本地改 sim 不用同步它**。
* **增益藏品浮层能不能关**：仍是产品口径待定（`EXTENSION-MODE-2026-10-27.md` §7.2）。
* **玩法包手册的 8 张图不在 `data/assets.json` 里**（只在磁盘），所以它们不受「不提交游戏美术」的 .gitignore 保护，
  也不进素材包清单。若要随包分发，需先确认版权口径（AGENTS.md：no game art in git）。

---

## 6. 接手顺序（建议）

1. 读本文 §5.1（i18n 事故）与 §3（坑），再看 `EXTENSION-MODE-2026-10-27.md` §5（红线）。
2. 跑 §2 的 `relic-n19-stun` / `annihilation-mode` / `extension-modes` / `infinite-room` 建立基线（约 5 s）。
3. 起服务端跑 §2 的两个真机脚本，亲眼确认「大厅 → 主题大厅 → 攻略说明 8 页」与「房内开关超限」两条路。
4. 要动 §5.2 的规则分离，先读完那三条调查结论与三个「必须先想清楚的点」，别直接改 `RECORD_MAPS`。
5. 动完任何 sim / 数据改动，重跑 `GOLDEN_FULL=1 node tools/golden.mjs` 确认 288 零位移。

---

## 7. 证据索引（本轮）

| 类别 | 路径 |
|---|---|
| n19 晕眩重做 | `server/sim/constants.js`（`DEPLOY_PROTECT`）、`server/sim/content/relics.js`（deploy 钩子）、`server/match/relics.js`（`relicModsFor` / `relicStackInfo`）、`docs/research/16-annihilation-relics.json`、`test/content/relic-n19-stun.test.js` |
| 超限房内开关 | `shared/protocol.js`（`room.setInfinite`）、`server/lobby.js`（`setInfinite`）、`public/js/screens/lobby.js`（删 `onCreateInfinite`）、`public/js/screens/room.js`（`protoInf`）、`test/infinite-room.test.js` |
| 攻略说明 | `public/js/screens/extensionModes.js`（`EXTENSION_MODES[0].guide`）、`public/js/screens/extensionThemeHall.js`、`public/js/ui/guide.js`（`openGuide(page, pages)` / `guideStage` / `closeGuide`）、`test/ui/localArt.test.js` |
| 一级页版面 | `public/css/screens/lobby.css`（`.ext-stage__art` / `.ext-list` / `.ext-facts`）、`public/js/screens/extensionModes.js`（`ext-facts`） |
| 附带修复 | `public/js/screens/loadout.js`（`QuickSkins`）、`public/css/screens/loadout.css`（`.lo-q--skin`）、`public/js/screens/diy.js`（`narrow`）、`public/js/ui/loadoutModel.js`（`skins`/`voices`/`version`）、`public/js/ui/protocolScene.js`（`tint`） |
| 设计文档 | `docs/EXTENSION_MODE.md` §3.6.1（攻略说明）、§3.7（n19）、§3.6（主题大厅小屏） |
| 姊妹交接 | `handoff/EXTENSION-MODE-2026-10-27.md`（主体：架构地图、红线、决策记录） |

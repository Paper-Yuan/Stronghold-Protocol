# 拓展模式接入 · 交接文档（2026-10-26，**已归档**）

> **⚠ 本文已被整合取代**：[`handoff/EXTENSION-MODE-2026-10-27.md`](EXTENSION-MODE-2026-10-27.md) 是当前唯一入口
> （超限线 + 拓展模式大厅 + 湮灭引擎 + 客户端 + 收尾，一份读完）。本文留作**历史档案**：S1 大厅 UI 的落地细节（§5.8）、
> 8 步移植方案与四份研究报告的结论（§3）、引擎落地记录（§10）。与新代码冲突时以新交接 + 代码为准。

> 交接范围：主仓 `E:\Workbox\系统`（分支 `align/0.3.0`，HEAD `d69b30f2`，**工作区有 138 项未提交改动**，属多个会话）
> 本文覆盖三条线：① 超限入口收口（已落地）② 拓展模式接入研究（已出四份报告 + 计划）③ 参考实机页 v2（可点、已实测）。
> 接手前必读 §6「坑与红线」。

---

## 0. 一句话

**超限线已收口并验证；「拓展模式」的第三张卡与选择拓展玩法大厅已在 2026-10-27 接进真实代码并通过三档视口实测（§5.8）。仍没做的只有一件：湮灭玩法包引擎（一行都没搬），所以大厅里每条都是「待接入 / 筹备中」，开始按钮暗着。**

---

## 1. 现在的状态

| 线 | 状态 | 证据 |
|---|---|---|
| 超限模拟入口 | ✅ 已落地、已实测 | 大厅难度列表下方紫色特殊项、同盟「超限模拟 · 同盟」入口、房间 ∞ 胶囊；三档视口 0 console error（§2） |
| 超限房的版本选择 | ✅ 已修（两端） | `baseRoomMode` 唯一映射；solo/coop 两种超限房都能切版本；`lobby-versions` 25/25 |
| 拓展模式（第三张卡 + 二次选择大厅） | ✅ **已落地、已实测**（2026-10-27，见 §5.8） | `public/js/screens/extensionModes.js`、`lobby.js` 三卡、`docs/EXTENSION_MODE.md`；`devtools/render-check-extension-hall.mjs` 三档 `RESULT: OK` |
| 湮灭模拟玩法包（mod v3.1.0） | ✅ **服务端已全部落地、已实测**（2026-10-27，见 §10） | `server/match/gamedata.js` +380 行、12 个钩子、9 个新模块、`data/relics.json`；`GOLDEN_FULL=1` 288 零位移；`test/match/annihilation-mode.test.js` 7/7 |
| choco 研究区 | ⏸ 用户明令停手 | 不读不写 `E:\Workbox\choco` |

---

## 2. 本轮真正落地的代码（超限线）

`git diff --stat`（仅本线相关文件，共 16 文件 **+1221 / −76**；其中 `server/lobby.js` 的 68 行含其他会话的 room.chat 改动，本次只加 4 行）：

| 文件 | 改动 | 为什么 |
|---|---|---|
| `public/js/screens/lobby.js` | `MODE_CARDS` 保持两张；`ProtocolSelect` 新增 `allowInfinite`；`difficultyInfo` 走 `isSoloRoomMode` 并把 INFINITE 的 rounds 设为 `∞`；`create(mode, forceInfinite)`；同盟侧新增 `onCreateInfinite` | 超限不是官方难度，只在**大厅**的难度列表里出现；房间里的难度弹窗绝不能列它（否则会 `room.setDifficulty('INFINITE')`） |
| `public/css/screens/lobby.css` | `.pcard.is-infinite` 一整套（边框/名称/描述/效果/meta/选中/悬停）、`.proto-list__special` + 「特殊难度」分组线、`.ally-card--infinite` 紫条 + 入场动效 + 五态 | 让超限在视觉上是「第四种语义」，不抢官方橙/红难度轴 |
| `public/js/screens/room.js` | 难度胶囊 `is-infinite` 分支（∞ 取代难度徽记） | 一间超限房不该把自己显示成普通「终极模拟」房 |
| `public/css/screens/room.css` | `.rs-pill__diff.is-infinite` 紫底 + `.rs-pill__inf` 字形 | 同上 |
| `shared/versions.js` | 新增 `baseRoomMode()`（唯一映射：`solo_infinite→solo`、`coop_infinite→coop`） | 版本登记只写 `solo/coop`；不归一就会「该版本不支持当前的模拟方式」 |
| `public/js/ui/versionPicker.js` | `usable` 用 `baseRoomMode(roomMode)` | 症状的直接修复点 |
| `server/lobby.js` | `offered()` 改用 `baseRoomMode(mode)`（HEAD 只有 `isSoloRoomMode` 分支，`coop_infinite` 会 `VERSION_UNSUPPORTED`） | UI 放行 + 服务端拒绝 = 假修复 |
| `public/i18n/{en,ja,ko,zh-TW}.json` | 新增词条（「特殊难度」等），现 2519/2519 | 界面文案必须四语言齐全 |
| `test/lobby-versions.test.js` | 新增 4 个房间层回归（solo 即刻切 / coop 两人投票 / 非默认版本直接建 coop_infinite 房 / **切回不恢复难度**） | 把「难度单向缩水」这条既有规则钉死 |
| `test/ui/lobby-hub.test.js` | 超限特殊项用例 + `allowInfinite` 门控 + **CSS 顺序守卫**（动画必须写在 reduce 块之前，用 `lastIndexOf`） | 防止动效在减动效模式下静默失效 |
| `docs/INFINITE_MODE.md`、`docs/design/network.md` | 入口与 `VERSION_UNSUPPORTED` 语义同步 | 仓库规则：docs follow code |

**已验证（可复跑）**

```bash
cd E:\Workbox\系统
node --test test/ui/lobby-hub.test.js test/lobby-versions.test.js test/ui/versions.test.js \
  test/ui/version-vote.test.js test/match/infinite-versions.test.js test/infinite-room.test.js \
  test/ui/screen-fit.test.js test/ui/ui-size.test.js test/ui/text-scale.test.js test/match/coop-infinite.test.js
# → tests 107 / pass 106 / fail 1（唯一失败是 HEAD 既有的 research-texts 守卫，见 §6）

node tools/i18n.mjs check --all --strict     # → 四包各 2519/2519, 0 missing
node node_modules/eslint/bin/eslint.js <改动文件>  # → 0 error（server/lobby.js:2041 一条既有 warning）
```

浏览器实测（dev server，`SP_BASE=http://127.0.0.1:3022`）：

- `devtools/render-check-infinite-entry.mjs` → 1280×720 / 800×360 / 667×375 三档 `RESULT: OK`、`errors: 0`
  （单人超限房 1 座、同盟超限房 4 座、两间房里点开难度弹窗都只有 4 张官方卡、普通房胶囊无 ∞）

---

## 3. 拓展模式：四路研究结论（都在 `E:\Workbox\.session-dump\team\annihilation\`）

| 报告 | 一句话结论 |
|---|---|
| `a/report.md`（286 行） | mod 是**全文件覆盖式**安装包：109 新增 / 38 覆盖 / 0 与主仓一致；38 个 overlay 全部混着别家 mod（同盟残留 74 处、测试模拟 70 处），**一个都不能整份覆盖** |
| `b/report.md`（306 行） | 主仓接线图：第三张卡加 `MODE_CARDS` 即可复用 `HubEntry`；但 `openMode` 的 `else` 会把 `ext` 弹成同盟方式、`create()` 三分要改映射表、CSS 两处 `*2→*3`；**用全屏 Modal，不加路由**；**勿动 `roomModes`** |
| `c/spec.md`（44 KB） | UI 规格：第三卡 `id:'ext'` + `expand` 图标 + 等宽等高；大厅 1→N 网格；强调色用**霜蓝**不抢超限紫；动效沿用 `tr-right` |
| `d/plan.md`（本文件作者） | 裁决与验收：本轮只做 UI 壳；S0–S2 分阶段；8 条风险 |

**三个必须先知道的判断**

1. **不能跑 mod 的 `install.mjs`。** 它会覆盖 `server/lobby.js`、`Match.js`、`screens/{lobby,game,room}.js` 等 —— 正是工作区 138 项未提交改动的所在。
2. **湮灭不新增房间 mode 字符串。** 它 = `solo`/`coop` + `difficulty:'ANNIHILATION'` + `erosion:1..6`（蚀流），modeId 由 `modeIdFor()` 推出 `mode_single_annihilation` / `mode_multi_annihilation`。所以「拓展模式」入口将来只要把选中条目交给现有建房通道。
3. **玩法包引擎是独立的第二轮。** 最小移植集 = 9 个新文件 + 8 步 hunk 合并；两个静默坑：
   - `server/sim/content/index.js` 的 `DOMAIN_NAMES` 缺 `hazard`/`relics` → 藏品与毒雾**全哑且不报错**；
   - `erosion` 五环链路（`room.create → Room → startMatch → Match → GameData`）任断一环 → **静默降级为蚀流 1**，验收必须断言 `m.public.erosion`。

---

## 4. 参考实机页 v2（已交付，可点）

- 路径：`public/dev/extension-hall-preview.html`（32 KB，单文件、零依赖、不 import 游戏模块）
- 打开：`http://localhost:3022/dev/extension-hall-preview.html`，或直接双击文件
- 自查脚本：`E:/Workbox/.session-dump/team/annihilation/preview-check.mjs`（puppeteer-core + 本机 Chrome）

**版式**：大厅三张模式卡（独立/同盟/拓展）+ 二级菜单「左玩法档案舞台（40%）/ 右等距选项列表（60%）」。

**这轮解决的两个问题**

1. **间距不一致的根因**：选项原来把「简介 + 三条要点 + 原因」全塞进卡片，文案长短撑高卡片。现在选项只留 **一行简介**（`nowrap` + 省略号），要点搬到左侧档案；行高写死 **88px**（≤900 宽 64、≤520 高 56），`gap` 固定 **10/8/6px**。
   实测：三档视口 `equalHeights: true`、`equalGaps: true`。
2. **手机端不好看**：原来 ≤900 会把二级菜单压成单列、演示条折成竖排挡住内容。现在**所有尺寸同一套两列逻辑**（40/60 等比缩放），演示控制改成**顶部 34px 整宽细带**，不再遮内容。

**实测**：1280×720 / 800×360 / 667×375 均无横向溢出、0 console error、开始按钮 ≥44px、Esc 关闭后焦点回到大厅第三张卡；点行切换左侧档案、占位条目不可点、状态开关可切「可接入/可开局」、空状态可切。

**已知取舍**：左侧档案目前只有矢量徽记（没有真实美术图）；两条「筹备中」条目是**占位**，只为验证 1→N 等距排布；演示控制条只存在于参考页，真实大厅不会有。

---

## 5. 下一步：S1 真实落地清单（把参考页搬进游戏）

> 依据 `b/report.md` + `c/spec.md` + `d/plan.md`。这一轮**只做 UI 壳**，不做引擎。

### 5.1 新增 `public/js/screens/extensionModes.js`

- 导出 `EXTENSION_MODES`（冻结数组）、`extensionModeById`、`extensionModePlayable`、`extensionModeCount`；
- 导出大厅组件 `ExtensionHall`（照 `AllianceSelect` 的组织方式，用 `Modal` + `BackPlate`，全屏）；
- 条目字段与参考页一一对应：`id / name / en / code / color / icon / tags[] / desc / features[] / pack / status('ready'|'pending'|'missing') / reason?`；
- 首条：`annihilation`，`code:'AC-5'`，`color:'#5b0a14'`，`status:'pending'`。

### 5.2 `public/js/screens/lobby.js`

| 落点 | 改动 |
|---|---|
| `MODE_CARDS`（约 :117–130） | 追加 `{ id:'ext', name:N_('拓展模式'), en:'EXTENSION', icon:'expand', … }`，`points[0]` 用 `{n}` = 可玩条目数 |
| `openMode`（约 :753） | **必须显式分支**：`solo → setSoloOpen`、`ext → setExtOpen`、`else → setAllyOpen`（现在的 `else` 会把 ext 弹成同盟方式） |
| `create()`（约 :775–784） | `mode === 'solo' ? … : …` 改成映射表 |
| 新 state | `const [extOpen, setExtOpen] = useState(false)` |
| 挂载（约 :859） | `${extOpen ? html`<${ExtensionHall} …/>` : null}`，传 `onClose/online/busy/short` |

### 5.3 `public/css/screens/lobby.css`

| 落点 | 改动 |
|---|---|
| `:198`、`:1026–1046` | entries 列 `calc(var(--hub-entry-w) * 2 + var(--hub-gap))` → `* 3 + 2 * var(--hub-gap)`（两处） |
| `:471` 附近 | `.hub-entry--ext` 8 行（霜蓝 `--ext-*`、`expand` 图标、focus 环改霜蓝） |
| `:505`、`:518–520` | `.ext` 追加进 `modal__box.proto/.ally` 与 `proto-veil` 选择器组 |
| 文件末尾 | `.ext-*` 大厅样式（两列版式、行高、五态、`prefers-reduced-motion` 归零名单追加 `.ext-row`/`.ext-stage`），数值照 §4 |

### 5.4 `public/css/theme.css`

新增 `--ext-100…--ext-900`、`--ext-a35`、`--ext-glow`（#7cc6f2 系）；**不动 `--inf-*`**。

### 5.5 i18n（13 条 msgid，四语言）

拓展模式 / 拓展玩法 / 选择拓展玩法 / 湮灭模拟 / 待接入 / 可开局 / 筹备中 / 返回大厅 / 玩法包尚未接入本机 / 还没有可玩的拓展玩法 / 蚀流 1–6 / 藏品 / 玩法与难度独立于官方四档。
（`card.en` 的 `EXTENSION` **不是** msgid。）

### 5.6 会被打红的测试

| 文件:行 | 现状 | 改成 |
|---|---|---|
| `test/ui/lobby-hub.e2e.test.js:138` | `hub.entries == ['solo','coop']` | 加 `'ext'` |
| 同上 `:142` | `fit(page).out` 为空（溢出断言按两卡） | 按三卡重测 |
| `test/ui/lobby-hub.test.js`（CSS 钉子） | 两卡宽度公式 | 三卡（`* 3`） |
| `test/ui/lobby-hub.test.js:700` | 难度卡计数 4 | **不要动**（超限是列表外特殊卡） |
| `test/i18n.test.js:135–164` | 四包 `complete:true` | 补 13 条后仍 complete |
| 新增 | — | `ExtensionHall` 单测：三卡渲染、pending 禁用、Esc/返回焦点、`data-extension` 钩子 |

### 5.7 验收

1. `node --test` 上述文件全绿；`node tools/i18n.mjs check --all --strict` 四包 100%。
2. 三档视口手点：大厅三卡同一行、`ext` 进大厅、条目不截断、返回焦点正确、0 console error。
3. **基线不得变**：`GOLDEN_FULL=1 node tools/golden.mjs` 288 场景零位移；超限房行为（§2 的 render-check）保持不变。

### 5.8 落地结果（2026-10-27）

§5.1–5.7 全部做完。改动只落在本线文件，未碰其他会话的 138 项未提交改动。

| 文件 | 改动 |
|---|---|
| `public/js/screens/extensionModes.js` | 新增（207 行）：`EXTENSION_MODES` 三条、`extensionModeById/Playable/Count`、`defaultExtensionPick`、`ExtensionHall`。另加一个 `modes` prop（缺省 `EXTENSION_MODES`）让「ready / 全 missing 空状态 / 1→N」三态可测；`pack` 补 `N_()` |
| `public/js/screens/lobby.js` | `MODE_CARDS` 第三张卡（`ext` / `expand` / 霜蓝）、`openMode` 显式三分、`extOpen` + `extPick` 两个 state、大厅挂载（未传 `onPick`，因为没有 `ready` 条目） |
| `public/css/theme.css` | `--ext-100…900` + `--ext-a35` + `--ext-glow`（+12 行），`--inf-*` 未动 |
| `public/css/screens/lobby.css` | +337/−10：两处三卡列宽（`* 3 + 2 * gap`）、`.hub-entry--ext`、`.modal__box.ext` / `.ext__body` 进全屏弹窗组、整套 `.ext-*` 大厅（40/60、88/64/56 行高、10/8/6 间距）、reduce 块收编 `.ext-body .ext-row, .ext-body .ext-stage` |
| `public/i18n/{en,ja,ko,zh-TW}.json` | 每包 +31 条，2550/2550 |
| `test/ui/extension-modes.test.js` | 新增 16 个用例：表的不变量、四条派生函数、三行/芯片/占位、档案跟随选中、开始门控（ready/离线/busy）、空状态、Modal 与返回、大厅三卡接线、`--ext-*` 与 `.ext` 契约、行高梯级、减动效顺序、四语言词条 |
| `test/ui/lobby-hub.e2e.test.js` | `entries` 三卡；桌面加一段大厅实测（行高 88/间距 10、40/60、开始禁用、Esc 回焦第三张卡） |
| `devtools/render-check-extension-hall.mjs` | 新增：三档视口自查（大厅三卡 + 大厅版式 + 关闭焦点） |
| `docs/EXTENSION_MODE.md` | 新增 240 行（§2 = 今天没有可开局、§3 = 引擎落地后怎么接 `onPick`，与代码注释的引用对齐）；`docs/ARCHITECTURE.md` 索引两处；`docs/design/client.md` 大厅段补第三张卡与大厅 |

**已验证（可复跑）**

```bash
# 逐文件直接跑（本机沙箱下 node --test 会 EPERM：它要给每个测试文件 spawn 子进程）
node test/ui/extension-modes.test.js      # 16/16
node test/ui/lobby-hub.test.js            # 27/27
node test/lobby-versions.test.js          # 25/25
node test/ui/version-vote.test.js         # 8/8
node test/match/infinite-versions.test.js # 4/4
node test/infinite-room.test.js           # 2/2
node test/match/coop-infinite.test.js     # 4/4
node test/ui/screen-fit.test.js           # 6/6
node test/ui/ui-size.test.js              # 11/11
node test/ui/text-scale.test.js           # 12/12
node tools/i18n.mjs check --all --strict   # 四包 2550/2550，0 missing，0 errors
node node_modules/eslint/bin/eslint.js <改动文件>   # 0 error / 0 warning
node tools/check-imports.mjs               # pass
GOLDEN_FULL=1 node tools/golden.mjs        # 288 scenarios match · ok（103 s，零位移）
SP_BASE=http://127.0.0.1:3000 node devtools/render-check-extension-hall.mjs
# → 1280×720 / 800×360 / 667×375 三档 RESULT: OK（三卡同排同高、88/10→56/6、40/60、开始禁用、
#   「玩法包尚未接入本机」、Esc 回焦第三张卡、0 console error）
```

截图：`handoff/shots/extension-hall-{lobby}-{1280x720,800x360,667x375}.png`。

**与本文前几稿的三处出入（以代码为准）**

1. §5.5 说 13 条 msgid —— 实际提取器报 **30 条**，加上 `湮灭模拟 v3.1.0` 的包名共 31 条（本文那份 13 条是当时手写的估计）。
2. §5.6 说 `test/ui/lobby-hub.test.js` 的 CSS 钉子（两卡宽度公式）要改成三卡 —— 实际**没有测试钉住那条公式**，只改了 e2e 的 `entries` 数组；新增的 `extension-modes.test.js` 才把 `* 3 + 2 * gap` 钉住。
3. `extensionModeCount()` 数的是**列出**的条目（`status !== 'missing'`），不是 `ready` 的条目：否则大厅卡上会是「0 个玩法」，点进去却有一条。今天读作 `1 个玩法 · 不计入官方战绩`。

**已知红（都不是本线，没修）**：`research texts` 守卫（`ui/hubSections.js:226`）；`test/i18n.test.js` 的「未包裹中文字面量」半条（`public/js/resources/*`、`battle/damageStats.js`，HEAD 未改）；`docs-consistency` 的 `干员战斗语音`（别的会话改了 `data/assets.json`）；`client-static` 的 CSS 守卫在 `public/css/traitOverlay.css:338`（同一原因）；`docs-paths` 两条死在 `spawnSync git` 的 EPERM（环境）。

---

## 6. 坑与红线

1. **绝不运行 mod 的 `install.mjs` / `patch-data.mjs`**（覆盖 38 个文件，会毁掉 138 项未提交改动）。要装只能在副本里。
2. **不碰 `E:\Workbox\choco`**（用户明令）。
3. **不改 `data/*.json`**（AGENTS.md：生成物）。要加湮灭数据就改 `tools/build-data.mjs` 重生成，或加一次性迁移脚本 + 生成校验。
4. **不动 `shared/versions.js` 的 `roomModes`**（`test/versions-service.test.js:113` 钉死 `['solo','coop']`；`test/ui/versions.test.js:100–103` 钉死选择器必须走 `baseRoomMode`）；要扩只能扩 `baseRoomMode()` 一支。
5. **工作区是共享的**：138 项未提交改动来自多个会话。动手前先 `git diff -- <目标文件>` 存快照，改完逐 hunk 复核；不要 `git commit/checkout/stash/reset`。
6. **判断「某能力是否已支持」用 `git show HEAD:<file>`**，不能只看工作树 —— 工作树混着别人未提交的中间态，本轮就因此误判过一次（`coop_infinite` 服务端分支）。
7. **CSS 顺序即行为**：动画声明必须写在使用 `prefers-reduced-motion` 归零块**之前**，否则减动效静默失效（已加静态守卫）。
8. **既有的 1 条红测试不要修**：`research texts` 守卫（`public/js/ui/hubSections.js:226`，HEAD 既有，与本次无关）。

---

## 7. 证据索引

| 类别 | 路径 |
|---|---|
| mod 拆解 | `E:\Workbox\.session-dump\team\annihilation\a\report.md`（+`classify.json`/`hunks.json`/`diffs\` 38 个 diff） |
| 主仓接线 | `E:\Workbox\.session-dump\team\annihilation\b\report.md` |
| UI 规格 | `E:\Workbox\.session-dump\team\annihilation\c\spec.md` |
| 移植方案 | `E:\Workbox\.session-dump\team\annihilation\d\plan.md` |
| 参考实机页 | `public/dev/extension-hall-preview.html` |
| 参考页自查 | `E:\Workbox\.session-dump\team\annihilation\preview-check.mjs` |
| 参考页截图 | `E:\Workbox\.session-dump\team\annihilation\preview\v2-{lobby,hall,hall-ready,hall-empty}-{1280x720,800x360,667x375}.png` |
| 超限入口自查 | `devtools/render-check-infinite-entry.mjs` + `E:\Workbox\.session-dump\shots\infinite-entry-*.png` |
| mod 原始包（已解包） | `E:\Workbox\.session-dump\ext\annihilation\湮灭模拟-独立mod-v3.1.0\` |

---

## 8. 接手顺序（建议）

1. 读本文 §6（红线）→ §1（状态）。
2. 打开参考实机页点一遍（三档视口都拉一下），确认版式符合预期。
3. 读 `b/report.md` 的「落地清单」与 `d/plan.md` 的 S1，再动手 §5 的改动。
4. 动手前先跑一遍 §2 的测试基线，改完再跑一遍；最后跑 `npm run golden` 确认零位移。

---

## 9. 未做 / 待决策

- 拓展模式真实代码（§5）—— ✅ **已完成**（2026-10-27，§5.8）。
- 湮灭玩法包引擎（8 步合并）—— ✅ **服务端已完成**（2026-10-27，§10）；剩客户端接线（§10.4），做完把 `status` 改 `ready` 即可。§6 第 1 条仍然成立：**绝不能跑 mod 的 `install.mjs`**。
- 参考页待定的三处，落地时已各自定下（可再推翻）：左侧档案仍只有矢量徽记（无真实美术图）；行高保留 88/64/56；「筹备中」两条占位**保留**——它们是「1→N 等距排布」的活证据（§2.1 与 `extension-modes.test.js` 都靠它们）。
- 新增待决策：大厅卡那行要不要同时显示「可开局数」（今天只显示列出数，见 §5.8 第 3 点）；`docs/design/client.md` 那段落在了 §35 规则文本里，DESIGN 分节索引未加新节（docs 测试不强制）。
- 湮灭线的四个数字决策（都已按「跟本仓数据走」实现，可再推翻）：毒雾 60 s（mod 硬编码 30）、毒雾只伤我方（mod 连敌人一起）、`bans` 数值随本仓更小的盟约池缩水（e1–e4 `{5,5}`、e5 `{4,7}`、e6 `{0,0}`，其中 e5 核心数 4 反而少于 e1 的 5）、非无尽档 `pairOfRound` 越过队尾返回最后一对（mod 会外推一个不存在的下一对）。
- 超限线遗留（与本线无关，可另开）：`chat-box-css` 的 `.gm__bonds` 居中、`protocol-boot` 的 `tbanner`、`docs-consistency` 的干员语音资产，三条均 HEAD 既有失败。

---

## 10. 湮灭玩法包引擎落地（2026-10-27）

8 步合并全部完成，**服务端一行不缺**；客户端还差 3 处界面（§10.4）。全程没有跑 mod 的 `install.mjs` / `patch-data.mjs`。

### 10.1 落地清单

| 步 | 落点 | 关键点 |
|---|---|---|
| 1 数据 | `tools/build-data.mjs` + `docs/research/15-annihilation-mode.json`、`16-annihilation-relics.json`（输入）→ `data/config.json`、`data/bosses.json`、`data/relics.json`（生成物） | 数据规则没破：`data/` 仍是生成物，手写内容在 `docs/research/`（与 `01-core-data.json` 同类）。生成结果对 `bonds` 以外的表逐字节不变 |
| 2 常量 | `shared/annihilation-constants.js` | `EROSION_MAX` / `EROSION_ENDLESS` / `ANNIHILATION_DIFFICULTY` |
| 3 难度 | `shared/constants.js` | `DIFFICULTY_NAMES`/`DIFFICULTY_COLORS` 加 `ANNIHILATION`；**`DIFFICULTIES` 故意不动**（那是官方四张卡的来源，加了会让「选择模拟协议」多出第五张） |
| 4 协议 | `shared/protocol.js` | `room.create.erosion`、`room.setErosion`、`g.relicSeen`、`g.relic` |
| 5 房间 | `server/lobby.js` | `Room.erosion`（第 6 个位置参数）、`room.state.erosion`（仅湮灭房）、`setErosion()`、`handleMessage` 的 `case 'room.setErosion'`、`fallbackDifficulty` 提前返回（否则会被静默降级成标准模拟！） |
| 6 Match | `server/match/Match.js` | `this.erosion` + `new GameData(data, modeId, { erosion })` |
| 7 gamedata | `server/match/gamedata.js` +380/−8 | `gd.erosion`/`gd.endless`/`gd.annihilation`/`annihilationFlags()`、回合家族（`bossHiddenPairs` 到 600）、`roundCfg` 的 R21+ 循环、`generation`、`bans`、`bossWeights`、`equipPerChess`、`unlimitedLayers`、`export const ENDLESS_ESCALATION_STEP` |
| 8 钩子 | 17 个文件（`match/{phases,combat,bossRounds,intents,unitePhase,views,settle,prep,effectsMeta}`、`player/{prep,round,views,economy}`、`waves`、`sim/{ai,targeting,content/devices}`、`content/index.js`） | 每个都以 `gd.annihilation` 为门 |

另外 9 个玩法包模块逐字节落地（`server/match/relics.js` 等，见 `docs/EXTENSION_MODE.md` §3.1），`DOMAIN_NAMES` 补 `hazard`/`relics`，87 张藏品图 + 10 个介绍图放在 `public/assets/`（.gitignore，只能本地存在）。

### 10.2 验证（可复跑）

```bash
node test/match/annihilation-mode.test.js     # 7/7 —— 链路验收（下方两条硬断言）
node test/match/annihilation-erosion.test.js  # 14/14 —— 蚀流 1–6 的阶梯表
GOLDEN_FULL=1 node tools/golden.mjs           # 288 场景零位移（49/46/22/21/10/140）
node tools/i18n.mjs check --all --strict      # 四包 2585/2585
```
两条硬断言（断链时会静默通过，所以必须断言）：`m.publicView().erosion` 逐档等于房主选的 1–6 且 `endless` 只在 6 为真；`mode_single_normal` 的 `erosion` 恒为 1、`lastRound` 仍 14、公开视图不长出这两个键。

### 10.3 这一轮踩到/堵上的坑（比交接时的两条多三个）

1. **`devices.js` 的致命级缩放**（真正把 golden 打红的那条）：mod 把 `致命级 ×5` 直接乘进地形效果，而 `aspdOf(-0.6)` 是 **−60 点攻速**，`Math.max(-0.9, −60×1)` 让正常模式深水格的 −60 变成 −0.9，diy-049 的伤害/死亡立刻变。修法：`lethal === 1` 时每个缩放表达式都是**恒等**（`mul`/`floored`/`shrunk` 三个 helper）。
2. `annihilationFlags()` 在非湮灭模式返回 **`null`**（不是 `{}`），所以 `...null` 一直无害；但 4 个摊开点现在都自己先判 `gd.annihilation`，不再依赖被调方。
3. `server/match/relics.js` 原本用 `Math.random()` 抽藏品/机器人投票 → 同 seed 重放会投出不同的票（票决定全队拿哪件藏品）。已改成 `createRng(deriveSeed(m.seed, …))`。
4. 交接时那两条仍然成立且都堵上了：`DOMAIN_NAMES` 缺 `hazard`/`relics`（藏品与毒雾全哑不报错）、`erosion` 五环任断一环静默降级为 1（现在由 `annihilation-mode.test.js` 钉住）。
5. **生成器不是幂等的**：跑 `node tools/build-data.mjs` 会把 `data/bonds.json` 的 `spec` 文本改回较短的 research 版本（HEAD 里那份更详细，来源已对不上）。重建后请 `git diff --stat data/` 只应看到 `config.json` / `bosses.json`（+ 新增 `relics.json`），`bonds.json` 要还原。

### 10.4 还差什么（客户端，3 处 + 1 个开关）

1. **藏品三选一界面**（必须）：`public/js/ui/relics.js` 已落地但无人 import；要在 `screens/game.js` 渲染三选一并发 `g.relic { idx }` / `g.relicSeen {}`，`ui/gameActions.js` 补那行接线。**在此之前别把 `status` 改 `ready`**：服务端会在藏品未选时拒绝「准备就绪」，没有界面玩家会卡住（超时自动随机选一张只是兜底）。
2. **房内改档 UI**：`room.setErosion` 与 `room.state.erosion` 已就绪，`screens/room.js` 还没有那个 1–6 选择器（大厅侧的选择器已做，从大厅进房档位是对的）。
3. **局内显示**：蚀流角标、无尽局的回合显示（`m.publicView().endless` / `.erosion` 已在发）。
4. **同盟形态**：`createAnnihilation` 目前只建 `solo` 房；`mode_multi_annihilation` 的数据与引擎都在，缺大厅里的「单人/同盟」开关（一行 `mode: 'coop'` 的距离）。

做完 1–3，`EXTENSION_MODES[0].status` 改 `'ready'` 即完成接线（`lobby.js` 的 `createAnnihilation` 已接好）。

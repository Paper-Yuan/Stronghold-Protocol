# 装备 / 盟约显示纳入方案（内容包加载后界面自动适配）

- 目标分支：`E:/Workbox/sp-upgrade-2.1`，分支 `feature/v0.2.1-fusion-master`，HEAD `975585e1`
- 参考 mod：`E:/Workbox/mod-inspect/fanpack-mod`（为上游 pristine v0.2.1 做的整文件覆盖式安装包）
- 本文只写设计，不改任何生产代码。文中 `文件:行号` 一律标注来源：`[repo]` = 本仓库，`[mod]` = 该 mod 的 payload/安装包。
- 证据方式：本会话逐条 `Read` / `grep` / `node -e` 抽查，命令与结果见每节括注。**未运行任何测试套件**（任务未指定跑哪个），凡「通过/失败」均指我实测的静态核查，不指测试。

---

## 1. 结论摘要

**能不能纳入：能。** 以「只借数据契约 + 服务端 overlay 端口 + 落地两个只读界面 + 三处挂载点」的形式纳入，**不整文件覆盖**。

**为什么能自动适配：** 这两个界面从头到尾不认「包」这个字。`[mod] payload/public/js/screens/equipment.js:4` 的注释就是这条设计（"the pack's own goods arrive through the same merge … so they show up here too"）；数据入口只有 `data.load/get/list/lookup` 与 `useData`（`equipment.js:17,36-38,212-219`；`alliances.js:20,44-48,355`），没有一处 `fetch`、没有一处官方 id 白名单。所以「装了包自动多出装备/盟约」这件事的**唯一**触发条件是：服务端在 `/data/*.json` 上把包记录与包美术并进去。界面一行都不用改。

**代价（8 步，见 §6）：**

1. 新建 `public/js/screens/equipment.js`、`alliances.js`（按 mod 落地，改 3 处写死项）
2. 新建 `public/css/screens/equipment.css`、`alliances.css`（`.eq-*` 全仓为 0，见 §3）
3. 新建 `shared/customContent.js`、`server/packs.js`
4. 给 `server/index.js:392` 的 `createStaticHandler` 加 `overlay` 参数并插一段 `/data/<section>.json` 特判
5. `shared/packs.js:61` 的 `data` 从 `planned` 升 `supported` 并补 files 角色
6. 补 `giveBondBiasOnly` 语义（`ui/gameLogic/bonds.js`、`ui/detailPanel.js`）
7. 包美术通道（`public/assets/pack/` + `tools/fetch-assets.mjs` 的 pack 分支）
8. `public/index.html` 加两条 `<link>`；`main.js` / `lobby.js` / `room.js` / `briefing.js` 加挂载与入口

**不做的事（明确划掉）：**

- 不移植 `[mod] server/http/{static,files}.js` 那套目录重构。我们 `[repo] server/index.js` 是 953 行单体（`wc -l` = 953），`[repo] server/http/` 目录不存在；`PACK_RUNTIME_GAP_REVIEW.md:81`（不要移植那套目录重构）与 `:119`（同：不要连上游 `server/http/*` 一起拿）已给同一结论。**该文件不在仓库内**，实际位于 `E:/Workbox/PACK_RUNTIME_GAP_REVIEW.md`。
- 不整文件覆盖任何已分叉文件（10 个已分叉文件清单见 §3.3）。
- **不在 `server/data.js` 的 `loadData` 里合并**——与既有决策 P6 冲突（`[repo] docs/ENDLESS_MOD_DUAL_PLATFORM_PLAN.md:385`：「绝不在 `server/data.js` 的 `loadData` 里合并」）。本期先走「进程级 overlay」，逐房合并留给 P6 的 `server/mod/overlay.js:237`。这条是**需要拍板**的（见 §8）。
- 不在客户端给 codex 加「按包开关过滤」层。数据本身当门：服务端不并这条包，界面里就没有它。

---

## 2. mod 的装备显示与盟约显示各自怎么做的

### 2.1 装备图鉴（`[mod] payload/public/js/screens/equipment.js` 316 行 + `equipment.css` 65 行）

实测：`wc -l` → `316 / 65`。

- **性质**：纯客户端只读覆盖层，自己的 store（`equipment.js:27-32`，注释明说 read-only、no server sync）。
- **打开**：`openEquipCodex(from, sel)`（`:35-40`）先 `data.load('items'/'bonds'/'assets')` 再置 `equipStore.open=true`。
- **取数**：`EquipScreen` 用 `useData('items','bonds','assets')`（`:212`），美术清单 `m = data.get('assets')`（`:215`）。
- **建模型（纯函数）**：`codexRows(data.list('items'), id=>data.lookup('items',id))`（`:216`）取全部 `!isGolden`（`:59`），按 `cmpItems` 排序 = tier → shopSortId → name（`:46-48`），并用 `base.goldenId` 解析精锐件（`:60`）。
- **筛选与分组**：`filterRows` 按 tier / bond（含 `NO_BOND` 哨兵 `:80`）/ shopOnly（`hideInShop || shopExcluded`，`:95`）/ query（`:89-101`）；`groupByTier` 产出阶级段（`:104-112`）；`usedBonds` 从行里的 `giveBondId` 反推盟约下拉候选项（`:74-77`）——**候选项来自数据，不是写死的盟约表**。
- **渲染**：`EqFilters`（`:181-206`）→ 每个阶级一个 `.eq-tier` 段头 + `EqCard`（`:273-279`）→ 右栏 `EqDetail`（`:150-178`）显示图标、阶、售价、合成 ×N、商店不可售、盟约标签，以及「普通 / 精锐」两块 `RichText`。
- **交互**：Esc 关闭、←/→ 在筛选后网格里循环（`:228-246`）、选中卡 `scrollIntoView`（`:249-252`）；`EquipHost` 在简报结束或开局时自动关（`:292-307`），复用 `shouldAutoClose`（`:19` import 自 `./loadout.js`）。
- **服务端两条通路**（这是「自动多出来」的真正原因）：
  - `[mod] shared/customContent.js:108-125 mergeCustomContent` 在载入时按 `CUSTOM_SECTIONS` 段名浅合并包内容（改内存不改盘；`:120` 是同 id 整条替换）；
  - `[mod] server/index.js:59-76 customOverlay` + `:85-96 packArtManifest` 在**提供服务时**把合并后的 items/bonds 与包自有美术覆盖到 `/data/items.json`、`/data/assets.json` 上（`:106-118` 给 `/assets/pack/` URL 打 `?v=<size>-<mtime>`）。

### 2.2 盟约与策略总览（`[mod] payload/public/js/screens/alliances.js` 490 行 + `alliances.css` 91 行）

实测：`wc -l` → `490 / 91`。

- **入口**：`AllianceCodexButton`（`:484-490`）只在三处挂——`[mod] lobby.js:21/:319`、`room.js:24/:327`、`briefing.js:15/:99`；宿主 `<AllianceCodexHost/>` 由 `[mod] main.js:53` import、`:293` 挂一次（与 `<LoadoutHost/>` `:291`、`<EquipHost/>` `:292` 并列）。**战斗内没有入口**（全 payload grep `AllianceCodexButton` 只命中这三个文件）。
- **打开**：`openAllianceCodex(from, opts)`（`:43-54`）先 `data.load` 五个文件（bonds/bands/items/chess/assets，`:44-48`），再写 `allianceStore`（`:30-40`）；`tab` 只认 `'bonds'|'bands'`（`:49`，默认写死 `'bonds'`）。
- **排序**：`bondRows`（`:60-66`）isCore → bondOrder（缺记 99）→ 数据顺序；`bandRows`（`:69-75`）sortId → bandId。
- **两块内容**：盟约 tab（`:431`）/ 策略 tab（`:433`）。过滤条 `BondFilters`（`:313-333`，全部/核心/附加 + 生效阶段 + 搜索）与 `BandFilters`（`:336-349`，模式 chips + 搜索）。
- **网格**：盟约卡按 核心/附加 两组渲染，组标题写死为「核心盟约 / 附加盟约」（`:442`、`:445`），分组依据只有 `isCore`；`BondCard`（`:180-194`）核心加 mint 边框。
- **盟约详情 `BondDetail`（`:220-271`）**：事实标签串（计数 `:226`、生效阶段 `:238`、阈值 `:239`、层数上限 `maxCount` `:240`、`noStack` 警告 `:241`）；「效果」段逐层一行（`LayerChip` `:162-170` + `RichText(formatBondEffect(bond, layer))` `:249`）；「完整描述」`descRaw||desc`（`:252-255`）；「相关装备」`bondEquipment` chip，点开 `openEquipCodex`（`:256-263`）；「成员」`bondMembers`（`:264-269`），空时写「没有成员记录」（`:268`）。
- **策略详情 `BandDetail`（`:274-310`）**：totalHp / 模式 / victorCount / rewardModulus / 效果 / 相关盟约（由 `band.bondIds` 查 bonds，`:300-304`）/ unlockDesc。
- **生命周期**：capture 阶段 keydown（`:384-401`，Esc 关、←/→ 循环、单字符键 `stopImmediatePropagation` 防触发局内快捷键）；宿主 `AllianceCodexHost`（`:466-481`）用 `shouldAutoClose`（`:22` import、`:472` 调用）自动关，并在 `<html>` 加减 `sp-alliance-open`。

### 2.3 界面里哪些是包无关的、哪些绑死了官方

**包无关（已 grep 确认）：** `alliances.js` 里没有任何盟约 id / 盟约总数 / 成员 id / 策略 id / 图标文件名（全部来自 `data.list` / `data.lookup`）；`equipment.js` 里没有装备清单（全部来自 `data.list('items')`）；美术按 `bondId` / `trapId|iconId` 查表（`assetUrls.js:100-115`）。**结论：装了包自动多出卡兹戴尔与罗德岛，不需要改这两个界面。**

**绑死官方（逐条实测，附落点）：**

| 写死项 | mod 位置 | 后果 / 我们的处置 |
|---|---|---|
| 阶表 `ROMAN`(≤VI) / `TIERS=[1..6]` | `equipment.js:23-24` | 第 7 阶无筛选 chip、`ROMAN[tier]` 落空；分组段头是数据驱动的（`:104-112`）所以第 7 阶仍会画出来。改为按 `data.list('items')` 实际 tier 生成 |
| 阶配色类 `--t1..--t6` | `[repo] loadout.css:98-99,151-152` | 新阶的 `lo-chip--t{t}` / `lo-card--t{t}` 无规则（`:100` 的 `color: var(--tc)` 无回落） |
| `NO_BOND='__none'` | `equipment.js:80` | 内部哨兵，保留即可 |
| 「普通件=`!isGolden`、精锐件=`goldenId`」 | `equipment.js:59-60` | 字段约定，包必须遵守（见 §4） |
| 商店可售 = `hideInShop || shopExcluded` | `equipment.js:95` | 隐藏货仍列出，只在详情标「商店不可售」 |
| 排序固定 tier→shopSortId→name | `equipment.js:47` | 契约 |
| `PHASE_NAMES` 只认 BATTLE/ALL | `alliances.js:153` | 我们 `data/bonds.json` 里 调和(maniShip) 的 `activeType='MANI'` → 既不显示标签也不进过滤器（`:115-122`、`:238`） |
| `MODE_NAMES` 只认 LOCAL/SINGLE/MULTI | `alliances.js:155` | 我们 bands 40 条取值齐备 |
| `COUNT_NAMES` 只认 BOARD/HAND/DECK/GLOBAL | `alliances.js:157` | 我们 bonds 有 `BOARD_AND_DECK`(3 条) 与 `BOARD_ALL_CHESS`(1 条) → `:226` 会把这 4 条印成英文枚举（`t(undefined)` 返回 `''`） |
| 层号罗马字 + ≤6 用八角 `TierChip`、>6 写 `+N`；上限夹到 10 | `alliances.js:27,81,166-167` | 与分支 TierChip 口径需对齐 |
| 盟约只分两组、组标题写死 | `alliances.js:442,445` | 包两条新盟约 `isCore:true` → 必落「核心盟约」组 |
| 默认 tab `'bonds'`；打开写死 load 五个文件名 | `alliances.js:44-48,49` | 契约 |
| `HARMONY_BOND='maniShip'` | `[repo] ui/gameLogic/bonds.js:131`（mod 同处 `:138`） | 官方 id 硬编码；新盟约走不进这条特判 |
| 跨模块 `shouldAutoClose` / `openEquipCodex` | `alliances.js:22,23` | 我们已有 `shouldAutoClose`（`loadout.js:664`），没有 `equipment.js` → 要么一并落地，要么改落点 |
| 中文 msgid 写在代码里 | `equipment.js:129,165,262…`、`alliances.js:226…` | `t()` 在 DEFAULT_LANG 下原样回落 msgid（`[repo] shared/i18n.js:467-471`） |
| 用词与分支不一致 | `alliances.js:226`「含手牌 / 只算精锐」vs `[repo] ui/bondStrip.js:170`「含整备区」 | 同一份 bonds.json 两套说法 |
| 死代码 `BondTag` | `alliances.js:173-177` | 全文件无引用，是 `.eq-bond` 的唯一使用者 |
| `.eq-*` 样式依赖 | `alliances.js` 用 17 个 `.eq-*` 类（见下） | 全仓 `.eq-*` 规则数 = **0** |

`.eq-*` 实测：`grep -o "eq-[a-z_-]*" alliances.js | sort -u` → `eq-bond, eq-bond--lg, eq-bond__icon, eq-detail, eq-detail__art, eq-detail__head, eq-detail__id, eq-detail__name, eq-detail__tags, eq-eff, eq-eff__head, eq-eff__k, eq-eff__micro, eq-eff__text, eq-filters, eq-list, eq-meta`（17 个）；`grep -o "\.eq-[a-z_-]*" equipment.css | sort -u` 给出 23 条规则（含 `.eq-card*`、`.eq-tier*`、`.eq-tierchip` 等）；`grep -rho "\.eq-[a-z_-]*" [repo] public/css/ | sort -u | wc -l` → **0**。
另有 `<LpTower size="xs">`（`alliances.js:205`）在分支没有规则：`grep -rn 'lp--' [repo] public/css/` 只有 `game.css:145-151` 的 `sm/md/lg/danger/team`，**无 `.lp--xs`**；mod 自己的 CSS 里也没有（`grep -rn lp--xs [mod] payload` 零命中）。

---

## 3. 我们分支的现状与差异

### 3.1 已有（可直接复用，逐个实测）

| 依赖 | 位置（`[repo]`） | 实测 |
|---|---|---|
| `shouldAutoClose(st, phase, inMatch, wasInMatch)` | `public/js/screens/loadout.js:664` | 同名同签名，与 mod 两屏的 import/调用一致 |
| `LoadoutHost` / `LoadoutButton` | `loadout.js:671` / `:702` | 宿主与入口的现成样板 |
| 常驻 Host 位 | `public/js/main.js:398` `<${LoadoutHost} />` | 唯一 Host 位 |
| 大厅/房间/简报入口 | `lobby.js:509` / `room.js:322` / `briefing.js:90` | 各一个 `<${LoadoutButton} from=… />` |
| 组件 | `components.js:36 Fragment`、`:43 ICONS`、`:86 Icon`、`:99 MicroLabel`、`:124 Button`、`:195 TierChip`、`:666 Spinner`、`:803 TextField` | mod 用到的 8 个字形（book/crown/warn/info/search/check/chevronLeft/close）全在 `:44-77` |
| 游戏组件 | `gameComponents.js:65 Img`、`:89 RichText`、`:209 LpTower`、`:229 BondGlyph`、`:238 BandIcon` | 全在；`.bandicon--xl` 在 `game-panels.css:48` |
| store | `store.js:33 createStore`、`:213 useStore` | 三参形式兼容 |
| 数据层 | `data.js:116 base '/data/'`、`:134 urlFor`（注释 `:23`「Unknown names are allowed too」）、`:359 useData`、`:248 invalidate` | 全在 |
| 美术取数 | `assetUrls.js:100 bondIconUrl`、`:110 itemIconUrl` | 与 mod 逐字节相同（mod 只多一个 `tokenPortraitUrl`） |
| 盟约数值 | `richText.js:166 formatBondEffect`，`:170 const bb = bond.bb` | 只认顶层 `bb` |
| 效果公式 | `richText.js:166-185` | 与 mod 语义一致 |
| `.lo-*` 骨架 | `public/css/screens/loadout.css` | `grep -o '\.lo[a-z_-]*' | sort -u | wc -l` → **138**；`:98-99` `--t1..t3`、`:151-152` `--t1..t3`（t4..t6 在紧邻行） |
| `items.json` 字段 | `data/items.json` 115 条 | `node -e` 核对：13 个所需字段 100% 覆盖；59 条非精锐（`!isGolden`）、56 条 `isGolden=true`、112 条非空 `goldenId`（含精锐件自指，如 `chess_item_1_01_e_b.goldenId` 指向自己）、36 条带 `giveBondId` |
| `bonds.json` | 23 条 / isCore 8 条 | `countMode {BOARD:19, BOARD_AND_DECK:3, BOARD_ALL_CHESS:1}`；`activeType {BATTLE:19, ALL:3, MANI:1}`；23/23 有 `descRaw` 与 `visibleMembers`；23/23 有 `bb` |
| `bands.json` | 40 条 | 首条 `band_bldsk` 带 `modeTypeList/totalHp/bondIds/victorCount/rewardModulus/unlockDesc`，字段齐备 |
| 服务端枚举 | `server/match/gamedata.js:91`（`bondIds` 由 `Object.keys(bonds)` 排序生成）、`bondsMeta.js:199` | 包记录自动进视图 |

### 3.2 缺（这是「今天会失败」的清单，逐条实测）

1. **四个界面文件不存在**：`ls public/js/screens/` 无 `equipment.js`/`alliances.js`；`ls public/js/ui/` 无；`public/css/screens/` 无 `equipment.css`/`alliances.css`。
2. **`/data/*.json` 永远吐盘上那份**：`server/index.js:392` 的 `createStaticHandler` 无 `overlay` 参数；`:393-394` 的 `/data/` mount 直接 `path.resolve(dataDir)`；`:696` 调用也不传。mod 的端口在 `[mod] server/http/static.js:120-134`（命中 overlay 段即吐内存 JSON + `ov-<section>-<sha1 前12>` ETag + `Cache-Control: no-cache`）。
3. **没有 packs 运行时**：`server/index.js:393-399` 的 mounts 里没有 `/packs/`；全仓 `grep -rn scanPacks|createPackRegistry server/` 零命中；`[repo] shared/packs.js:61` 仍是 `data: { status: 'planned' }` 且无 files 角色（mod 版 `shared/packs.js:61-74` 给了 records/chess/tokens/variants/art）。
4. **服务端数据载入没有合并钩子**：`server/data.js:58 loadData(dir,{log,expected})`、`:91 getData({dir,log})` 都没有 `custom` 选项；`shared/customContent.js` 整个文件不存在（`ls shared/` 无）。
5. **`giveBondBiasOnly` 语义缺失**：`node -e` 计数 ours=0 条带该字段（mod = 18 true + 97 false）；`ui/gameLogic/bonds.js:62-68` 与 `ui/detailPanel.js:231` 都没有这个开关。
6. **`.eq-*` 整屏无样式**：全仓 0 条（见 §2.3）；`.lp--xs` 也没有。
7. **美术通道整条缺失**：`ls public/assets/` 无 `pack/`；`grep -c pack tools/fetch-assets.mjs` → **0**；`data/assets.json` 里 `items` 键 59（mod 60）、且**没有** `trap_c_01`/`kazdelShip`。
8. **i18n 运行时已在，缺的是交付路径与接线**：`shared/i18n.js`（`registerLangs`/`setLang`/`addMessages`）、`shared/i18nPacks.js`、`shared/i18nData.js` 都在，`shared/packs.js:56-57` 的 `lang` 类型已是 `status:'supported', live:true`；缺的只是 `public/i18n/*.json` 数据文件（`ls public/i18n` No such file）与 UI 侧接线 `public/js/ui/lang.js`（不存在）→ 新界面 msgid 只能回落中文原文。
9. **`test/data.test.js:135-136`** 断言 `bonds` 23 条 / isCore 8 条——只有保持「包 overlay 是 opt-in、测试不加载」才继续绿（这正是 mod 自己的约定，`[mod] shared/customContent.js:9`）。
10. **`invalidate` 全仓无调用点**：`grep` 只命中 `data.js:248` 定义——跨房间换包集合会拿上一局的 bonds 列表。

### 3.3 照搬会踩掉什么（为什么不建议整文件覆盖）

mod 是**整文件覆盖式**安装包（`[mod] manifest.json`：`kinds {overlay: 37, new: 21}`，共 58 个文件）。实测对比：

| 文件 | 我们 | mod | 覆盖会丢 |
|---|---|---|---|
| `server/index.js` | 953 行 / 46102 B | 12153 B（上游瘦入口） | admin/lobby/matchmaking/loadGuard/3D 预载等整段融合代码 |
| `public/js/main.js` | 25094 B | 19192 B | `ServerLoadBadge`（我们 4 处）、皮肤同步 `installSkinsSync`（我们 2 处） |
| `public/js/screens/lobby.js` | 30447 B | 20652 B | `OnlinePill`（我们 2 处）、皮肤（我们 1 处） |
| `public/index.html` | 6426 B，sha256 DIFFERS | 同字节数 | 我们新增的 `<link rel="modulepreload" href="/vendor/three.module.js">` 与 `three.core.js` 两行 → 静默去掉 3D 战场预载 |
| `data/assets.json` | 1690910 B | 1126169 B | mod 多一个 `modules` 段（131 键）我们**没有**；chars 我们 209 / mod 213、items 59/60、skills 524/529、skillsById 526/533 均 DIFF（`node -e` 逐段比） |
| `data/items.json` | 170806 B（与上游逐字节相同） | 173821 B | 20 条记录改了 `tier`/`giveBondId`（见下）+ 新增 `giveBondBiasOnly`；整文件覆盖会把这些修正带入，但**下次重新生成 items.json 又丢光** |
| `public/js/screens/loadout.js` | 48983 B | 55611 B | — |
| `public/css/screens/loadout.css` | 50749 B | 47802 B | mod 缺我们的 10 个选择器（`.lo-dtab*`、`.lo-skin*`、`.lo-skins`）→ 覆盖即丢皮肤选择段与详情 tab |
| 其余 10 个 | — | — | `server/data.js`、`shared/packs.js`、`server/sim/content/index.js`、`server/sim/{buffs,damage,units}.js`、`server/match/{pool,gamedata}.js`、`server/sim/content/{bonds,tokens}.js`、`public/js/screens/{room,briefing}.js` 全部 sha256 DIFFERS |
| 8 个目标在我们仓库**根本不存在** | — | — | `server/packs.js`、`server/http/static.js`、`server/http/files.js`、`server/match/player/economy.js`、`public/i18n/{en,ja,ko,zh-TW}.json`（hash 比对 ABSENT）→ 照搬会在 953 行单体旁凭空长出上游 `server/http/` 树与一份没人加载的 `public/i18n/` |

**`data/items.json` 的 20 条差异（`node -e` 逐字段比，正是「不能整文件覆盖」的实证）：**

```
chess_item_5_02_e_a.tier: 5 -> 3          chess_item_5_02_e_b.tier: 5 -> 3
chess_item_5_09_e_a/_b.giveBondId: null -> "kazimierzShip"
chess_item_6_01_e_a/_b: null -> "kazimierzShip"    chess_item_6_02_e_a/_b: null -> "lateranoShip"
chess_item_6_03_e_a/_b: null -> "yanShip"          chess_item_6_04_e_a/_b: null -> "egirShip"
chess_item_6_05_e_a/_b: null -> "victoriaShip"     chess_item_6_06_e_a/_b: null -> "kjeragShip"
chess_item_6_07_e_a/_b: null -> "sargonShip"       chess_item_6_11_e_a/_b: null -> "siracusaShip"
```

mod 侧这 18 条同时 `giveBondBiasOnly: true`（`[mod] data/items.json` 统计 true=18/false=97）。这些修正必须落在**生成侧**（`tools/build-data.mjs`，见 §6 第 6 步），不能靠覆盖。

> 注：`[mod] data/chess.json`、`data/items.json`、`data/assets.json` 三份 overlay 文件我核过，**不含**包内容（items 里无 `chess_item_c_01_e_a`、assets 里无 `trap_c_01`/`kazdelShip`）——它们是另一批重生成，不是包内容的载体。这进一步说明「照抄 mod 的文件」与「官方字节不变」的目标相悖。

**结论：不整文件覆盖。** 只取 `equipment.js` / `alliances.js` / 两个 CSS / `shared/customContent.js` / `server/packs.js` 这 6 个「新文件」作底稿，其余全部按落点改。

---

## 4. 数据契约：界面自适应所依赖的最小字段集

界面自适应的判据是「合并结果 + 覆盖层正确」，不是「界面认识包」。因此下面每份字段集都是**冻结契约**：包加载后这些字段的语义必须与官方一致，界面才能不改一行。

### 4.1 盟约记录（`/data/bonds.json`）

`bondId` / `name` / `isCore` / `bondOrder` / `thresholds[]` / `maxCount` / `countMode` / `countsHand` / `countsGoldenOnly` / `activeType` / `noStack` / `effectName` / `effectDescRaw` / `effectDescParams[]` / `bb` / `desc` / `descRaw` / `members[]` / `visibleMembers[]`

- 读取点：`alliances.js:61-65`（isCore,bondOrder）、`:79-83`（thresholds,maxCount）、`:89-92`（effectDescRaw+effectDescParams+bb→formatBondEffect）、`:101`（visibleMembers ?? members）、`:125-136`（搜索命中 name/effectName/desc/descRaw/activeType）、`:183-192`、`:222-241`、`:252-255`。
- **双份契约**：展示侧 `formatBondEffect` 读**顶层 `bond.bb`**（`[repo] richText.js:170`），模拟侧读 **`bonds[].buffs[0].bb`**（`[mod] docs/CUSTOM.md:94`）。fanpack 两条都写了（`[mod] records.json:54` 顶层 bb、`:66/:69` buffs 数组与 `buffs[0].bb`）。**包只写一份，界面数字或战斗数值必缺一份。**
- 分支现状：23 条、`bb` 23/23、`visibleMembers` 23/23。

### 4.2 装备记录（`/data/items.json`）

`id` / `name` / `tier` / `shopSortId` / `isGolden` / `goldenId` / `desc` / `descRaw` / `giveBondId` / `hideInShop` / `shopExcluded` / `price` / `mergeable` / `upgradeNum` / `iconId` / `trapId`

- 读取点：`equipment.js:46-48,58-61,64-71,89-101,150-177`；美术 `assetUrls.js:110-115`（`items[iconId] || items[trapId]`）。
- 字段约定：**普通件 = `!isGolden`**（`:59`）；**精锐件 = `goldenId` 指向的 id**（`:60`）；排序 tier→shopSortId→name（`:47`）；商店可售 = `!(hideInShop || shopExcluded)`（`:95`）。
- 隐藏货（`hideInShop`/`shopExcluded`）**仍然列出**，只在详情标「商店不可售」并受 shopOnly 过滤（`:52-53,95,165`）。
- 分支现状：115 条，13 个所需字段 100% 覆盖（`node -e` 实测）。**缺 `giveBondBiasOnly`（0 条）**——这是 §6 第 6 步要补的。

### 4.3 棋子 / 成员（`/data/chess.json`）

`chessId` / `name` / `appellation` / `tier` / `shopSortId` / `bonds[]` / `baseId`

- 读取点：`alliances.js:100-105 bondMembers`（tier→shopSortId→name 排序）、`MemberRow :211-217`；`ui/gameLogic/bonds.js:77-81 pieceBondIds`（`:62` 是 `grantedBonds`）。
- **成员 id 查不到时 `:104` 的 `.filter(Boolean)` 直接丢行**——所以「包棋子没并进 chess 数据」只会安静地少人，不报错。成员段的空态文案（`:268`）必须留着。
- 分支现状：266 条。

### 4.4 策略记录（`/data/bands.json`）

`bandId` / `sortId` / `name` / `modeTypeList[]` / `totalHp` / `effectName` / `desc` / `descRaw` / `bondIds[]` / `victorCount` / `rewardModulus` / `unlockDesc`

- 读取点：`alliances.js:70-73`、`:142-145`、`:199-206`、`:276-288`、`:298`、`:301`、`:305`。分支 40 条，字段齐备。
- **注意：`bands` 不在 `CUSTOM_SECTIONS` 里**（`[mod] shared/customContent.js:27` 只有 bonds/items/chess/tokens/garrisons/effects），尽管 `[mod] docs/PACKS.md:130` 把 `bands` 列为 records 的角色之一 → **包在 records.json 里写 `bands` 会被静默丢弃**（我直跑 `mergeCustomContent` 验证过）。§6 第 3 步要补。

### 4.5 特质（garrisons，盟约详情之外的展示面）

`eventTypeIcon`（icon_battle/icon_gold/icon_bond/icon_support → UI 拼 `garrisonTypeIcon/<key>` 精灵键）/ `eventTypeDesc`（作战能力/整备能力/单次叠加/持续叠加/特异化）/ `descRaw`（优先于 `desc`）

- 读取点：`[repo] ui/detailPanel.js:311`（`garrisonTypeIconKey`；`eventTypeIcon` 处理在 `:312-314`）、`:318`（`GarrisonBlock`）、`:324`（`eventTypeDesc`）、`:327`（`descRaw || desc`）。fanpack 的 34 条 garrisons 每条都带 `eventTypeDesc`（`[mod]` 统计 34/34）。

### 4.6 美术（`/data/assets.json`）

`items[iconId|trapId]` / `bonds[bondId]` / `bands[bandId]`

- 读取点：`assetUrls.js:100-102`（bond）、`:110-115`（item）、`:106`（band）。
- 包自有美术的键就是 `trapId` / `bondId`（`[mod] records.json:2974-2986` 的 `assets` 段），文件必须落在 `public/assets/pack/<key>.png`（`[mod] install.mjs:239-251`），否则取数返回 `null`、界面退回自己的字形：盟约图标回落 `crown`（`[mod] equipment.js:131`）、装备图标回落 `book`（`[mod] equipment.js:141,156`）；分支侧 `gameComponents.js:229 BondGlyph` 是首字兜底（`gameComponents.js` 里 grep 不到 `crown`，`:175/:186` 属 `GLYPHS` 定义，与 crown 无关）。
- **不许整文件覆盖 `data/assets.json`**（两份不同快照，见 §3.3）。正确做法是 delta 合并：base manifest 展开 + 包的 bonds/items 覆盖，正是 `packArtManifest` 的写法（`[mod] server/index.js:85-96`）。

### 4.7 词条（i18n）

- **文案层**：msgid = 中文原文；`t()`/`tParts()` 在当前语言为 zh 或查不到译文时**原样返回 msgid**（`[repo] shared/i18n.js:467-471`、`:499`）。新界面的按钮/标题走这条。
- **内容层**：记录里的 `name`/`desc`/`descRaw` **不走 `t()`**，直接渲染（`equipment.js:144,160`；`alliances.js:188,235`）。包内容的 `name` 是中文原文，en.json 里没有对应键（`[mod]` 逐键查过全部 MISSING）——缺词条不会让界面空，只会永远是中文。
- mod 自带的界面译文是硬编码进语言包 JSON 的（`[mod] public/i18n/en.json`：`'装备总览'→'Equipment Codex'` 等）。**新界面的多语言完全依附于这四个被覆盖的语言文件。**

---

## 5. 留给 mod 的端口清单

「界面不许写死什么」= 第三方内容包新增同名字段/记录后界面仍能正确显示的前提。

| 端口名 | 位置（`[repo]` 落点 / `[mod]` 参考） | mod 提供什么 | 界面不许写死什么 |
|---|---|---|---|
| 数据段合并口 | 新建 `shared/customContent.js`（底稿 `[mod] shared/customContent.js:108-125`） | 按 `CUSTOM_SECTIONS` 逐段浅合并；同 id 整条替换（`:120`） | 不许在界面里写死段名清单或 id |
| 静态 overlay 口 | `server/index.js:392` 签名加 `overlay`；插在 `:443` 之后、`:457 fsp.stat` 之前（参考 `[mod] server/http/static.js:120-134`） | `/data/<section>.json` 命中 overlay 即吐内存 JSON + 内容哈希 ETag + `no-cache` | 不许改 URL 模板、不许 fetch 别的路径（客户端只认 `/data/<name>.json`，`data.js:116,134`） |
| 包注册表口 | 新建 `server/packs.js`（底稿 `[mod] server/packs.js:104-156`）；`server/index.js:393-399` mounts 后加特判 | `/packs/index.json` + `/packs/<id>/<file>`；签名=名字/大小/mtime，最多每秒重扫一次 | 不许硬编码包 id / 文件路径 / 包数量 |
| 包类型表 | `shared/packs.js:61`（升 supported + files 角色，参考 `[mod] shared/packs.js:61-74`） | `data` 类型的 role→文件角色（records/chess/tokens/variants/art） | 不许假设只有 records 一个文件、不许假设扩展名只有 `.json` 之外的东西 |
| 覆盖层段集合口 | `server/index.js` customOverlay 等价物；段集合必须 ⊇ `public/js/battle/runner.js:108 SIM_DATA_FILES` | 合并后整段 JSON（不是增量）；带棋子时连 `backups` 一起下发 | 不许漏段、不许改「包带棋子→下发 backups」规则 |
| 美术清单口 | `server/index.js` 里 packArtManifest 等价物（参考 `[mod] server/index.js:85-96`） | 把 `records.assets.items/bonds` 并进 `data/assets.json`；`/assets/pack/**` 打 `?v=<size>-<mtime>` | 不许写死 sprite 路径、不许按 id 分支 |
| 美术拷贝口 | 新建 `public/assets/pack/`；`tools/fetch-assets.mjs` 加 pack 分支（参考 `[mod] install.mjs:239-251`、`art/index.json:1-9`） | `art/<key>.png` → `public/assets/pack/<key>.png` | 不许假设图片在包目录下可被直接 URL 访问（`art` 角色只收 `.json`，`[mod] shared/packs.js:72`） |
| 图标取数口 | `public/js/ui/assetUrls.js:100-102,110-115`（已有） | 键 = `bondId` / `trapId|iconId` 的映射 + 缺图回落 | 不许写死 sprite 路径或按 id 特判 |
| 成员查询口 | `alliances.js:100-105 bondMembers`（纯函数） | `visibleMembers ?? members`（`:101`），查不到静默丢行（`:104`） | 不许写死成员名单 / 条数 / 顺序 |
| 相关装备口 | `alliances.js:108-112 bondEquipment`（纯函数） | `!isGolden && giveBondId === bondId` | 不许写死装备清单 |
| 盟约枚举口 | `alliances.js:60-66,357` | `data.list('bonds')` + 运行时排序 | 不许写死盟约 id / 总数 / 顺序 |
| 核心/附加口 | `alliances.js:63,128-129,190,442-446` | 只读记录上的 `isCore` | 不许维护「哪些是核心盟约」的 id 清单 |
| 枚举可缺项口 | `alliances.js:153-157,226,238`（补 `COUNT_NAMES` 缺项） | 未知键落原始值或整条省略，绝不当校验门 | 不许把 PHASE/MODE/COUNT 枚举当白名单 |
| 阶/层号口 | `equipment.js:23-24`（tier 从数据派生）、`alliances.js:27,162-170` | 分组段头数据驱动；层号 ≤6 用八角、>6 写 `+N` | 不许写死 `TIERS=[1..6]` / 罗马字上限 |
| 自动关闭口 | `public/js/screens/loadout.js:664`（已有） | `shouldAutoClose(st, phase, inMatch, wasInMatch)` | 界面不许自己造生命周期 |
| 挂载点口 | `main.js:398`（+1 Host）；`lobby.js:509` / `room.js:322` / `briefing.js:90`（各 +2 入口） | 一个常驻 Host 位 + 三处「挨着干员调配」的入口按钮 | 不许自开常驻展开的独立面板（`docs/mockups/README.md:59`） |
| 样式骨架口 | `public/css/screens/loadout.css` 的 `.lo-*`（已有 138 个）+ 新建 `.eq-*` | 骨架 `.lo-top/.lo-body/.lo-grid/.lo-card/.lo-chip/…` + 阶配色类 | 不许私有化骨架、不许写死 1..6 阶配色 |
| i18n 出口 | `shared/i18n.js:467-471,499` | msgid=中文原文，缺词条回落 msgid | 不许假设内容名有译文 |
| `giveBondBiasOnly` 口 | `ui/gameLogic/bonds.js:62-68`、`ui/detailPanel.js:231`（补守卫） | 区分「授予成员」与「仅商店偏向/归类」 | 不许把 biasOnly 装备当盟约成员 |

---

## 6. 施工落点（分步 + 验收）

> 每步的「验收」都是可执行核查；我**没有**在本会话跑过它们（本会话只做静态核查），标注为「待执行」。

**第 1 步 · 落地两个只读界面（最小可跑）**
- 新建 `public/js/screens/equipment.js`：按 `[mod] equipment.js` 落地，改 `:24` 的 `TIERS=[1..6]` 为按 `data.list('items')` 实际出现过的 tier 生成；`:23 ROMAN` 保留 `|| t` 回落；`:131/141/156` 的 `Img fallback` 保留。
- 新建 `public/js/screens/alliances.js`：按 `[mod] alliances.js` 落地，改三处——`:157 COUNT_NAMES` 补 `BOARD_AND_DECK` / `BOARD_ALL_CHESS`；`:226`「含手牌 / 只算精锐」改成与 `[repo] ui/bondStrip.js:170` 一致的「含整备区」；`:205 LpTower size="xs"` 改成 `'sm'` 或补 `.lp--xs` 规则。`:63/:128-129/:190/:442-446` 只读 `isCore`、`:101 visibleMembers ?? members`、`:104 filter(Boolean)`、`:268` 空态文案**原样保留**。
- 验收（待执行）：`node --check` 两个文件；`grep -n "TIERS\|COUNT_NAMES"` 确认改动；起服后 `/data/items.json` 仍是官方 115 条时界面显示 115 条装备（回归：数据未变则界面不崩）。

**第 2 步 · 两个 CSS + 接线**
- 新建 `public/css/screens/equipment.css`（底稿 `[mod] equipment.css`，65 行）与 `alliances.css`（底稿 `[mod] alliances.css`，91 行）；或把 `alliances.js` 依赖的 17 个 `.eq-*` 类并进 `alliances.css`。
- `public/index.html:40` 之后照 `loadout.css` 写法加两条 `<link rel="stylesheet" href="/css/screens/equipment.css">` / `alliances.css`（**别连带删掉 three.modulepreload 两行**）。
- 验收（待执行）：`grep -c 'equipment.css\|alliances.css' public/index.html` = 2；`grep -rho '\.eq-[a-z_-]*' public/css/ | sort -u | wc -l` > 0；`.lp--xs` 或改 `size='sm'` 二选一落地。

**第 3 步 · 合并层（`shared/customContent.js`）**
- 新建 `shared/customContent.js`：以 `[mod] shared/customContent.js` 为底，`:27 CUSTOM_SECTIONS` **至少补 `bands`**（否则我们 40 条策略走的是这条，包写 bands 静默无效——我直跑 `mergeCustomContent` 验证过）；最好从 `PACK_TYPES.data.files` 角色表派生。`:108-125` 的浅合并语义（整条替换，`:120`）与 `hasCustomContent` 保留。
- 验收（待执行）：合成数据单测——官方 `victoriaShip.members=['a','b','c']` + 包同名记录只写 `['packPiece']` → 合并后 `members` 变成 `['packPiece']`（证明是整条替换，不是并集）；`bands` 段能进合并结果。

**第 4 步 · 包运行时 + overlay 端口**
- 新建 `server/packs.js`（底稿 `[mod] server/packs.js`，13573 B）：`readDirSorted` → `pack.json` 必须存在 → `readJson`（8MB 上限）→ `normalizeManifest` → `status !== 'supported'` 直接 skip → 每角色 `isFile + inside(dir)` → type=data 时全部 `.json` 解析一次，任一坏则整包跳过。
- `server/index.js:393-399` mounts 后加 `/packs/index.json` 与 `/packs/<id>/<file>` 特判（`PACK_RUNTIME_GAP_REVIEW.md:79`；**不要移植 `server/http/*` 目录重构**，见 `:81`）。
- `server/index.js:392` 的 `createStaticHandler` 签名加 `overlay`；在 `:443` 之后、`:457 fsp.stat` 之前插入 `[mod] server/http/static.js:120-134` 那段「命中 overlay 段即吐 JSON + **内容哈希** ETag」；`:696` 调用点传 overlay。
- 验收（待执行）：`node --input-type=module` 跑 `scanPacks`——正常包 loaded、坏 JSON/越界路径/缺文件/未支持类型各被 skip（fail-closed）；`curl /data/items.json` 在包加载后条数 = 115 + 包内新增，且 `ETag` 以内容 sha1 开头。

**第 5 步 · 包类型升级**
- `shared/packs.js:61` 的 `data` 从 `status:'planned'` 升 `supported` 并补 files 角色（`[mod] shared/packs.js:61-74`）。
- **与 P5 重叠**：`[repo] docs/ENDLESS_MOD_DUAL_PLATFORM_PLAN.md:221` 要求把 files 从 role→单路径改成 role→数组；`:222` 要求包目录落点 = `public/packs/<id>/**`，而 mod 用根目录 `packs/<id>/`。**落点必须先定**（见 §8）。
- 验收（待执行）：`shared/packs.js:192-202` 的 files 校验接受新形状；`PACK_TYPES.data.status === 'supported'`。

**第 6 步 · `giveBondBiasOnly` 语义**
- `ui/gameLogic/bonds.js:62-68`：按 `[mod] ui/gameLogic/bonds.js:69-73` 改成显式 `if (r.canGiveBond || r.giveBondBiasOnly) continue;`。
- `ui/detailPanel.js:231`：按 `[mod] detailPanel.js:215,235` 加 `if (item && item.giveBondBiasOnly) return null;` 与 `&& !it.giveBondBiasOnly`。
- `data/items.json` 的**生成侧**（`tools/build-data.mjs`）：**本仓库没有 `ITEM_BOND_BINDINGS` 这个符号**（全仓 grep 只命中本文档自身；它只出现在 mod 的 `docs/CUSTOM.md` 与 mod 源码注释里）。items 的盟约绑定实际来自 `buildItems`（`tools/build-data.mjs:1435`）读 `act.trapChessDataDict` 的 `t.giveBondId`（`:1468`），再叠 `ITEM_RULES`（`:1422`）/`SHOP_EXCLUDED_ITEMS`（`:1402`）。所以要**先定位/新建一张绑定表**，再据此补 `giveBondBiasOnly` 字段，并落 mod 那 20 条 `tier`/`giveBondId` 修正（见 §3.3）。**别整文件覆盖。**
- 验收（待执行）：`grep -n giveBondBiasOnly` 命中两处守卫；`node -e` 计数 items.json 里 `giveBondBiasOnly` 命中 115 条（18 true / 97 false）；`test/custom/item_bonds_custom.test.js` 类回归（**我们需新建**：mod 是 payload 安装包，不含 `test/` 目录）验证「变形同构体不授予」。

**第 7 步 · 美术通道**
- 新建 `public/assets/pack/`；给 `tools/fetch-assets.mjs` 加 pack 分支（现 `grep -c pack` = 0），照 `pack.json` 的 `files.art` → `art/index.json`（6 个键）→ `public/assets/pack/<key>.png`。
- `[mod] pack.json` 实测 6 张：`bond_kazdelShip`/`bond_rhodesShip`/`trap_c_01..trap_c_04`。
- **APK 需重建**（`android/app/src/main/assets/app_bundle.zip` 是预打包快照）。
- 验收（待执行）：`ls public/assets/pack/` 6 个 png；`curl /data/assets.json` 在包加载后含 `items.trap_c_01` 与 `bonds.kazdelShip`。

**第 8 步 · 挂载与入口**
- `main.js:398` 附近加 `<${EquipHost} />` 与 `<${AllianceCodexHost} />`（照 `[mod] main.js:52-53,292-293` 的 import/挂载方式，**不要拿 mod 的 main.js 整份覆盖**）。
- `lobby.js:509` / `room.js:322` / `briefing.js:90` 在既有 `LoadoutButton` 旁各加 `EquipButton` + `AllianceCodexButton`（mod 对应 `lobby.js:318-319` / `room.js:326-327` / `briefing.js:98-99`）。
- 验收（待执行）：`grep -c EquipHost\|AllianceCodexHost public/js/main.js` = 2；`grep -c EquipButton public/js/screens/{lobby,room,briefing}.js` 各 1；按 `docs/mockups/README.md:59` 的交互（默认收起的二级菜单、不做常驻展开的独立面板）走查。
- **可选第 9 步 · i18n**：新建 `public/i18n/{en,ja,ko,zh-TW}.json` 与接线（`PACK_RUNTIME_GAP_REVIEW.md:74/79` 的 `public/js/ui/lang.js` 352 行 + main.js 注册），否则新界面 msgid 只能回落中文原文。

---

## 7. 风险与不成立条件

1. **「整文件覆盖」在 10 个已分叉文件上不成立。** 任一覆盖都会丢我们分支的功能（§3.3 表：3D 预载、服务器负载徽标、皮肤同步、皮肤选择段/详情 tab、admin/matchmaking/loadGuard）。条件：只要 mod 的安装方式是「上游 pristine + 包」的整文件替换，它对融合分支就永远不能用。
2. **「一个包一套界面代码」不成立。** 界面的收录、排序、分组、筛选候选项、成员、相关装备全部由数据派生（§2.3 已 grep 确认无写死 id）。为一个包改界面 = 把「包无关」变成「包耦合」，且下一个包又要改一次。条件：只要界面继续用 `data.list`/`useData` 且服务端 overlay 正确，一个包零界面改动即可显示。
3. **枚举写死是「新数据露馅」的定时炸弹。** `COUNT_NAMES` 缺 `BOARD_AND_DECK`/`BOARD_ALL_CHESS` 已让我们 4 条盟约印英文（`alliances.js:157,226`）；`PHASE_NAMES` 缺 `MANI` 已让调和无标签（`:153,238`）；`TIERS=[1..6]` 会让第 7 阶包无 chip（`equipment.js:24`）。条件：只要第三方包引入未列枚举值就会触发。
4. **`giveBondBiasOnly` 不补，包内 6 阶签名装备会被误判为盟约成员。** 我们 `items.json` 0 条带该字段、两处守卫都没有（`ui/gameLogic/bonds.js:62-68`、`ui/detailPanel.js:231`），而 mod 的 18 条 biasOnly 装备一进数据就会画出「视为【X】成员」行。条件：先补语义，再进包。
5. **盟约数值双份不约定，界面数字与战斗数值必不一致。** 展示侧只读顶层 `bb`（`richText.js:170`），模拟侧读 `buffs[0].bb`（`CUSTOM.md:94`）。条件：包必须两份都写，或把 `formatBondEffect` 改成回落 `buffs[0].bb`。
6. **成员表不并集，包覆盖官方盟约就丢官方成员。** 合并层 `:120` 是整条替换、从不读 `members`。条件：成员并集必须在**生成包记录时**做（`tools/build-custom.mjs` 的活，`CUSTOM.md:90-93`）；若想让任意第三方包都不踩，需改合并层语义——那要先定「包能不能删成员」的规则。
7. **「按房间选包」这条路现在不存在。** `mergeCustomContent` 接受包列表，但 `[mod] server/data.js:134` 是「所有 `type==='data'` 的包全合并」；`customOverlay` 在 `startServer:156` 一次性算好、进程生命周期内不变。要落 `docs/mockups/README.md:61-62` 的两级控制，得把「本局启用哪些包」同时穿透到 (a) 合并结果、(b) sim 注入、(c) 每房间/每请求 overlay。**本期若不做，只能「全开/全关」。**
8. **`invalidate` 无调用点 → 跨房间换包拿旧表。** 客户端 `data.js` 文件缓存是页面级的（`:172`），跨房间换包集合时必须走 `invalidate`（`:248`），否则 codex 继续用上一局的 bonds/items。
9. **overlay 的 ETag 必须用内容哈希。** 用长度或 mtime 会让等长重建后的旧表留在浏览器里（`[mod] server/http/static.js:124-128` 记录的「录武官 3 阶」事故：`data.js` 用 `cache:'no-cache'`，等长重建后浏览器 304 拿旧表，商店显示 5 阶而服务端按 3 阶计费）。
10. **覆盖层段集合必须 ⊇ 客户端模拟器。** `[repo] public/js/battle/runner.js:108 SIM_DATA_FILES` 缺一段即拒绝开打（`:155-156`）；「包带棋子时必须连 `backups` 一起下发」（`[mod] server/index.js:72-73`）规则要保留。
11. **`art` 角色只收 `.json`（`[mod] shared/packs.js:72`）**，所以包内 PNG 不经 `/packs/` 提供，只能靠安装器/工具拷贝；`/assets/pack/**` 的 `no-cache`（`[mod] server/http/files.js:197`）与 `?v=` 戳缺一个，换图后浏览器继续显示旧图标。

---

## 8. 需要用户拍板的点

1. **`data` 包的目录落点**：mod 用根目录 `packs/<id>/`，P5 要求 `public/packs/<id>/**`（`ENDLESS_MOD_DUAL_PLATFORM_PLAN.md:222`，理由是 `tools/bundle-android.mjs:60-64` 只复制 `public/`，根目录 `packs/` 进不了 APK）。**先定落点，否则 P5 与 mod 的包都装不进去。**
2. **`files` 的形状**：mod 是 role→单路径，P5:221 要 role→数组（表达多个 kit）。取哪个？
3. **合并落点**：照 mod 放 `server/data.js` 的 `loadData`（快，但进程级单例会让 mod 泄漏进非 mod 房）vs 按 P6 逐房 `server/mod/overlay.js:237`（正确，但工程量大、本期可能来不及）。**我建议本期先走「进程级 overlay、默认零包」，逐房合并留给 P6**，但这与 P6 的既有决策直接冲突，需确认。
4. **本期是否落「按房间选包」**：不落则只能全开/全关，且与 mockups README 的两级控制模型有差距。
5. **是否补 `giveBondBiasOnly` 语义并重生成 `items.json`**（含 mod 那 20 条 tier/giveBondId 修正）——涉及官方数据文件的重生成，动到 `data/items.json` 的字节。
6. **盟约数值双份契约**：要求包同时写顶层 `bb` 与 `buffs[].bb`，还是改 `richText.js:170` 优先读 `buffs[0].bb`？
7. **成员表并集**：只在生成器做，还是改合并层对 `members`/`visibleMembers` 做并集（改语义，需先定「包能不能删成员」）？
8. **层数上限 10 与罗马字 `+N`** 是否与分支 TierChip 口径一致（`alliances.js:81,167`）。
9. **i18n 本期是否接线**（`public/i18n/` + `lang.js`），否则新界面只显示中文原文。
10. **用词统一**：「含整备区」（分支现有）vs「含手牌 / 只算精锐」（mod），层数上限表述是否统一。

---

## 9. 各端改进 UI 图

> 本节为成稿（原「占位，第 4 阶段产出」已替换）。图是「内容包加载之后」的状态，用的是参考 mod 的真实包内容；**本期没有改动任何生产代码**，这两个界面仍是**提案**。

### 9.1 交付物（实测尺寸 / 字节）

| 文件 | 实测尺寸 | 字节 |
|---|---|---|
| `docs/mockups/mod-ui-equipment-web.png` | 1920×1080 | 1,021,281 B |
| `docs/mockups/mod-ui-equipment-phone.png` | 844×390 | 269,243 B |
| `docs/mockups/mod-ui-alliances-web.png` | 1920×1080 | 941,693 B |
| `docs/mockups/mod-ui-alliances-phone.png` | 844×390 | 200,598 B |
| `docs/mockups/mod-ui-overview.png` | 1920×4650 | 2,952,976 B |

`mod-ui-overview.png` 是上面四张的 **1:1 拼合**（无拉伸、无裁切；Web 1920 满宽、手机 844 靠左，右侧留白放该图小标题），另带**端口图例、提案状态、内容来源**三块说明。

### 9.2 生成脚本

- `docs/mockups/render-mod-equipment-ui.mjs` → `mod-ui-equipment-{web,phone}.png`
- `docs/mockups/render-mod-alliances-ui.mjs` → `mod-ui-alliances-{web,phone}.png`
- `docs/mockups/render-mod-content-overview.mjs` → `mod-ui-overview.png`（只拼合四张单图，不重新渲染界面）
- 交付前的几何 / 墨量检查脚本：`docs/mockups/png-gate.cjs`（只读 PNG 头与解压后的字节分布，判尺寸与是否空白）

三个渲染脚本的样式、类名、字体、尺寸全部取自仓库源码（本分支 `public/css/*.css` 与 `public/fonts/fonts.css`，加 mod 的 `equipment.css` / `alliances.css` 提案块），数据用官方 `data/*.json` + 参考 mod 的真实包内容。图上圆标 + 图例的端口名与 §5 的端口清单逐字一致。

### 9.3 逐张说明

**装备总览 · Web（`mod-ui-equipment-web.png`，1920×1080，端类 `sp-hover sp-fs`）与手机（`mod-ui-equipment-phone.png`，844×390，端类 `sp-touch sp-coarse sp-no-hover`）**

- 画的是装了内容包之后的「装备总览」：**品阶分段（I–VI）+ 卡片网格 + 右栏详情**（普通 / 精锐两块并排）。
- 筛选维度（品阶 / 盟约 / 仅看商店可售）与盟约候选项**全部由数据派生**（`filterRows` 的 `usedBonds` 从行里的 `giveBondId` 反推），不是写死的盟约表。
- 包内装备（如「提卡兹之根」，盟约归属「卡兹戴尔」）与官方装备**同一条列表、同一张卡**——界面不认识「包」。
- 4 个端口圆标 + 图例：① 阶 / 层号口（阶级 chip 与分段由数据实际 tier 派生）；② 盟约枚举口（候选由 `giveBondId` 反推，包内盟约自动长进筛选条）；③ 数据段合并口 + 美术清单口（包内件与官方件同列表、同卡、同阶色，图标同源）；④ `giveBondBiasOnly` 口（**「仅归类·非盟约成员」这一处**：biasOnly 装备只标「仅归类」，不算盟约成员）。
- 手机端把筛选收成一行、详情走抽屉。

**盟约与策略总览 · Web（`mod-ui-alliances-web.png`，1920×1080）与手机（`mod-ui-alliances-phone.png`，844×390）**

- 画的是「盟约与策略总览」：**核心 / 附加两组网格 + 盟约详情**（层数 chip、成员、相关装备、特质、策略 tab）。
- 包内两个核心盟约「卡兹戴尔 `kazdelShip` / 罗德岛 `rhodesShip`」用**包内徽记美术**、与官方盟约**同一套版式**。
- 成员行体现「**官方成员 ∪ 包内干员**」的并集语义（包内成员带「包」标）。
- `eventTypeDesc` / `eventTypeIcon` / `descRaw` 富文本与缺字段兜底（`descRaw` 缺项 → 回落 `desc`）在图里可见。
- 5 个端口圆标 + 图例：① 数据段合并口 + 盟约枚举口（包内 2 条盟约与官方 23 条同一条 `data.list('bonds')`、同一张卡）；② 核心 / 附加口（分组只读 `isCore`，包内核心盟约自动进「核心盟约」组）；③ 成员查询口（`visibleMembers ?? members`，并集 + 包内成员带「包」徽标）；④ 美术清单口（包徽记经 overlay 并进 `assets.bonds/items`）；⑤ 图标取数口（缺图回落名字字形）。入口（大厅 / 房间 / 简报）在图例里（挂载点口）。

### 9.4 质量证据（如实）

- **本环境没有 visual-judge（provider-not-found）**，所以质量证据不是模型目视，而是：脚本末尾的**结构化自检**（样式来源、端类与尺寸、字体加载、破图数、塌陷数、文字裁切、图例是否压住网格、各条带墨量）+ `png-gate.cjs` 的尺寸与墨量检查。
- 两个渲染脚本在仓库根各重跑过一次，均 **exit 0** 且自检「**全部通过**」（破图 0、塌陷 0、文字裁切 无）。
- **审美仍需人工过目。**

### 9.5 内容来源与范围

- 本期**没有改动任何生产代码**；这两个界面仍是提案。
- 图是「内容包加载之后」的状态，用的是参考 mod 的真实包内容：盟约 `kazdelShip` / `rhodesShip`；包内装备 **5 件 / 10 条记录**；包美术 **6 张**（`bond_kazdelShip`、`bond_rhodesShip`、`trap_c_01..trap_c_04`）。
- 风格基线 = 游戏自己的样式表（沿用 `.lo-*` 骨架 + `.eq-*` 自有块），与 `docs/mockups/README.md:38-62` 的「内置内容包 + 房主选择」交互一致（默认收起的二级菜单、不做常驻展开的独立面板）。

## 10. 复核结论与未决事项

**证据方式**：本节由一位**没有参与本文档撰写的独立复核员**给出。复核方式 = 逐条去仓库（`E:/Workbox/sp-upgrade-2.1`）与参考 mod（`E:/Workbox/mod-inspect/fanpack-mod`）里**复现文档里的关键事实断言**（带 `文件:行号` 的那些），**不改任何文件**。本次共核实 **27 条**（大部分 confirmed；其中 10 条 refuted 已按实际改正，落在 §3.1 / §3.2 / §4.1 / §4.3–§4.6 / §6 第 6 步 / §1）。**复核没有运行任何测试套件。**

§8「需要用户拍板的点」继续保留；本节与其交叉引用、不重复。

下面是复核认定的**硬问题**（按严重度排列，不淡化）：

1. **按 §6 字面施工，overlay 拿不到合并后的包数据。** §6 只新建 `shared/customContent.js` 与 `server/packs.js`、给 `createStaticHandler` 加 `overlay` 参数，却**没有任何一步在「载入数据之后、计算 overlay 之前」调用 `mergeCustomContent` 把包记录并进去**。mod 的 `customOverlay(data)` 读的是已经并好的 `data[section]`（`[mod] server/index.js:59-66`），而合并发生在 `loadData` 里（`[mod] server/data.js:97`，`{ custom: true }`）——可 §1 又明令**不许在 `loadData` 里合并**。照 §6 落地只会服务官方未合并数据，**包内容永远不出现**。必须补这一步：在 overlay 计算前完成合并，且不违反 §1 的约束。

2. **服务端权威模拟没有纳入。** mod 覆盖了 `server/sim/content/{index,bonds,garrisons}.js` 并新增 `server/sim/content/{bonds,garrisons,kits}/custom.js`，以及 `server/match/{pool,gamedata,bondsMeta}.js` 与 `server/match/player/economy.js`。文档只做显示端，但 §5/§7 又要求「覆盖层段 ⊇ 客户端模拟器」、包带棋子要连 `backups` 一起下发。**未决前提**：这个包本期是「图鉴能看」还是「对局能打」？若要对局，服务端 sim/match 的包适配谁来补、算不算本期范围？

3. **`stripPackOperators` 语义没列。** `shared/customContent.js` 会把「被包变成棋子的干员」从 `backups.json` 的自选（diy）里剔除（`[mod] shared/customContent.js:22,77-99`），mod 的 `customOverlay` 因此要连 `backups` 一起下发（`[mod] server/index.js:69-73`）。§5 只提了「带棋子时下发 backups」，没提这条**剔除规则**，落地时容易漏（客户端会给出服务端已拒的选择）。

4. **两个新界面没有测试计划。** mod 的模型是纯函数（`[mod] equipment.js:11` 注释「the tests drive it without a DOM」；`codexRows`/`filterRows`/`groupByTier` 在 `equipment.js:58/89/104`，`bondRows`/`bondMembers`/`bondEquipment` 在 `alliances.js:60/100/108`），§6 却只安排 `node --check`。缺这些纯函数的单测，回归无保障。

5. **`sp-equip-open` / `sp-alliance-open` 的 html class 切换没列。** 它们定义在 mod 的 `equipment.css:10` / `alliances.css:10`（遮住底屏，同 `.sp-loadout-open` 的做法；分支里 `loadout.css:366` 已有先例）。§6 第 2 步若只并 17 个 `.eq-*` 类，会漏掉这两条与 `equipment.css` 的其余规则。

6. **`bands` 段只补 `CUSTOM_SECTIONS` 不够。** 还要经过 `server/match` 的 bands 视图与 `bandAllowed` 校验（`server/match/gamedata.js:445`、`:454-455`）、`bands.json` 进 `SIM_DATA_FILES`（`public/js/battle/runner.js:108`）、客户端 `bandDraft.js:50 allowedBands` 的校验等，包新增 / 修改 bands 的**可达性没有覆盖**。

7. **Android 侧收尾。** 文档只在第 7 步（美术）提了「APK 需重建」，但新增的 JS / CSS / 数据（`equipment.js`、`alliances.js`、两个 CSS、overlay 逻辑）同样进不了预打包的 `android/app/src/main/assets/app_bundle.zip`（`tools/bundle-android.mjs:59-63` 只复制 `public/`、`server/`、`shared/`、`data/`）。**重建应列为全局收尾步骤**，不只是美术那一步。

8. 上面第 1–7 条里有若干会转化为新的待拍板项（尤其第 1、2 条），建议并入 §8 一并确认。

---

## 附：本会话实测命令（供复核）

```bash
# 分支与文件
git -C E:/Workbox/sp-upgrade-2.1 log --oneline -3                      # HEAD 975585e1
ls sp-upgrade-2.1/public/js/screens/ public/js/ui/ public/css/screens/ # 无 equipment/alliances
wc -l server/index.js                                                  # 953

# 落点与已有件
grep -n "export function shouldAutoClose\|LoadoutHost\|LoadoutButton" public/js/screens/loadout.js
grep -n "LoadoutHost" public/js/main.js                                # :398
grep -n "LoadoutButton" public/js/screens/{lobby,room,briefing}.js      # :509 / :322 / :90
grep -n "createStaticHandler\|mounts" server/index.js                   # :392 / :393 / :696
grep -o '\.lo[a-z_-]*' public/css/screens/loadout.css | sort -u | wc -l  # 138
grep -rho '\.eq-[a-z_-]*' public/css/ | sort -u | wc -l                  # 0
grep -rn 'lp--' public/css/                                             # 无 lp--xs

# 数据面（node）
node -e '…'   # items 115 条、13 字段 100% 覆盖、giveBondBiasOnly=0、giveBondId=36、与 mod 差异 20 条
node -e '…'   # bonds 23 条/isCore 8；countMode {BOARD:19,BOARD_AND_DECK:3,BOARD_ALL_CHESS:1}；activeType 含 MANI:1
node -e '…'   # bands 40 / chess 266 / assets items 59 bonds 23；assets 无 trap_c_01、无 kazdelShip
node -e '…'   # mod items biasOnly true=18/false=97；mod assets 有 modules(131 键) 我们无；chars 209/213 等

# mod 侧
wc -l [mod] payload/public/js/screens/equipment.js  # 316
wc -l [mod] payload/public/js/screens/alliances.js  # 490
wc -l [mod] payload/public/css/screens/{equipment,alliances}.css  # 65 / 91
grep -o "eq-[a-z_-]*" [mod] alliances.js | sort -u  # 17 个
grep -n "EquipHost\|AllianceCodexHost" [mod] public/js/main.js      # :52-53 / :292-293
grep -n "EquipButton\|AllianceCodexButton" [mod] public/js/screens/{lobby,room,briefing}.js
node -e 'require("[mod]/manifest.json")'            # kinds {overlay:37, new:21}, n=58
```

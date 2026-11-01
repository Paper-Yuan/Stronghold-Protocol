# 拓展模式（玩法包）上手手册

> 写给**第一次接手拓展模式这条线**的人（人或 AI）：读完这一篇，你能在 30 分钟内知道每个结论该去哪份文件核对、
> 改一个玩法包要动哪几处、以及哪几件事今天已经踩过坑。**规格书是 [`docs/EXTENSION_MODE.md`](EXTENSION_MODE.md)**
> ——它描述「现在是什么样、为什么这样」；本文只做三件事：**路线图**、**判据清单**、**验收与坑**。两者冲突时以代码为准，
> 并按仓库规则回来改文档（`AGENTS.md` 的「Docs follow the code」）。

本文的每条结论都指到真实文件与函数名，行号是 2026-10-30 的读数。数据类计数（112 / 99 / 125 等）都可以用 §6.1 的
探针脚本在当前工作区重新量一遍——**不要凭印象引用数字**。

## 目录

| 节 | 读完你会知道 |
|---|---|
| §1 | 这条线的文件地图，以及一次点击在浏览器与服务端之间走哪几个函数 |
| §2 | 三个池子（官方 112 / 炸惊 99 / 湮灭 125）的判据差异，和「引擎与客户端必须同时改」的铁律 |
| §3 | 数据从 research JSON 变成 `data/*.json` 的链路，以及生成期的护栏 |
| §4 | 服务端：`gamedata.js` / `lobby.js` 各管什么，`annMods` 开关怎么穿到名册与战斗 |
| §5 | 客户端：大厅 → 二级页 → 干员调配 → 回传，每一层归哪个函数 |
| §6 | 该跑哪些测试与工具，以及每个守卫在钉什么 |
| §7 | 今天真踩过的六个坑（症状、根因、改法） |
| §8 | 15–25 条可勾选的 checklist（每条带命令或断言点） |
| §9 | 术语表与交叉索引 |

---

## 1. 五分钟地图：文件与一次点击的路径

**这一步做完什么会变：** 你手上有一张表，能把任何一个「界面不对 / 名册不对 / 数量不对」的问题定位到具体文件与函数，
而不是先 `grep` 整个仓库。

### 1.1 文件职责表

| 文件 | 职责（入口符号） | 谁读它 |
|---|---|---|
| `public/js/screens/extensionModes.js` | 玩法包**唯一真源** `EXTENSION_MODES`（`Object.freeze` 的数组，`:59`）；派生函数 `extensionModeById`(`:152`) / `extensionModePlayable`(`:160`) / `extensionModeCount`(`:169`) / `defaultExtensionPick`(`:177`)；大厅组件 `ExtensionHall`(`:242`) | `lobby.js`、二级页、测试 |
| `public/js/screens/lobby.js` | 大厅三张卡 `MODE_CARDS` 与 `openMode`（`ext` 必须显式三分）；建房通道 `createExtension`(`:857`) → `net.request('room.create', …)` | 浏览器 |
| `public/js/screens/extensionThemeHall.js` | 选中玩法包后的**二级页** `ExtensionThemeHall`(`:110`)、战场手册 `ExtThemeCodexView`(`:65`)；主题背景图 `<img class="ext-theme__art-img">`(`:129`) | `lobby.js` |
| `public/js/screens/loadout.js` | 干员调配整屏；**调配档**判定 `setTier`(`:684`)、名册选择 `roster`(`:693-698`)、档位标签 `playSet`(`:743`) | 浏览器 |
| `public/js/ui/loadoutModel.js` | 名册谓词：`isLoadoutSlot`(`:553`)、`rosterOf`(`:555`)、`zhajingRosterOf`(`:568`)、`annihilationRosterOf`(`:582`)、`bondIdsOf`(`:629`)、`filterRoster`(`:639`) | `loadout.js`、`loadoutSync.js`、测试 |
| `public/js/ui/loadoutSync.js` | 档位切换与回传：`flushAnnLoadout`(`:389`)、名册裁剪 `annRosterIds`(`:410`) | `loadout.js` |
| `public/js/ui/assetUrls.js` | 素材解析：`chessAvatarUrl`(`:28`)、`chessPortraitUrl`(`:51`)——**解析不到就是 `null`** | 全客户端 |
| `server/match/gamedata.js` | 引擎侧判据：`isOfficialVisibleChess`(`:37`)、`annModBonds`(`:46`)、`annihilationRoster`(`:65`)、`itemAnnModOff`(`:93`)、`GameData.visibleChess`(`:325`) | `lobby.js`、`Match`、测试、`devtools` |
| `server/lobby.js` | `normalizeAnnMods`(`:338`)、`annModsEcho`(`:357`)、`room.loadout` 的湮灭分支(`:1970-1991`)、`annihilationRoster` 的 import(`:253`) | 服务端 |
| `shared/annihilation-constants.js` | `EROSION_MAX`、`ANNIHILATION_DIFFICULTY`、`ANN_MOD_DEFAULT_ON`(`:22`)、`annModOn`(`:31`)——**两侧共用的缺省表** | 引擎 + 客户端 |
| `tools/build-data.mjs` | `applyAnnihilationMods`(`:3473`)、`isImportedChess`(`:3285`)、build 报告的 `visibleChess` 计数(`:3944`) | 数据生成 |
| `docs/research/20-annihilation-mods.json` | 导入器的产物（**只能由 `tools/extract-annihilation-mods.mjs` 写**） | `build-data` |

### 1.2 一次「进入湮灭房并开始」的点击

```
[lobby.js] MODE_CARDS.ext → openMode('ext') → setExtOpen(true)
  → ExtensionHall（extensionModes.js）选条目 + 蚀流 + 单人/同盟
  → onPick → lobby.js createExtension(id, erosion, party)          // :857
      net.request('room.create', { mode, difficulty: 'ANNIHILATION', erosion, annMods? })
  → server: Lobby.create → modeIdFor(mode, difficulty) → 'mode_single_annihilation'
  → 房内「干员调配」→ loadout.js：setTier='annihilation'
      roster = annihilationRosterOf(data.list('chess'), roomAnnMods)   // :696
  → loadoutSync.js flushAnnLoadout() → room.loadout { mode:'annihilation', entries }
  → server: Lobby.loadout 湮灭分支 → checkLoadout(entries, …, { roster: annihilationRoster(...) })
```

两条纪律从这张图里就能读出来：

1. **名册只有一份口径**：`loadout.js` 与 `lobby.js` 各自调用客户端/引擎的同一个判据，谁都不许「差不多」。
2. **房间开关是活的**：`room.annMods` 一变，`room.state` 会重广播，客户端重算名册、服务端重校验
   （`lobby.js:1970-1991` 与 `loadout.js:692` 的 `roomAnnMods`）。

### 1.3 上手路线（照这个顺序花时间最省）

| 时段 | 做什么 | 完成标志 |
|---|---|---|
| 第 1 个 10 分钟 | 读本文 §1 + §2.1 的两张表 | 能不看文档说出 112 / 99 / 125 各是谁 |
| 第 2 个 10 分钟 | 跑 §6.1 探针 + `node devtools/check-mode-isolation.mjs` | 五个读数与你预期的完全一致 |
| 第 1 小时 | 读 `extensionModes.js` 的 `EXTENSION_MODES` 里湮灭那一条（`:61-102`）与 `loadout.js:680-710` | 能画出一张「大厅 → 房内 → 调配档」的调用图 |
| 第 2 小时 | 读 `gamedata.js:37-101` 与 `loadoutModel.js:553-595` 并**并排**对照 | 能指出 §2.3 的三处分叉各在哪一行 |
| 第 1 天 | 按 §8 的 checklist 走一遍（不改代码，只看断言） | 每个勾选项都知道它为什么存在 |
| 第 2–3 天 | 挑 §7 里任意两个坑复现一次（`devtools` 的脚本是可运行的） | 能自己判断「这是脚本坑还是产品坑」 |

---

## 2. 池子：官方 112 / 炸惊 99 / 湮灭 125

**这一步做完什么会变：** 你能一眼看出「名册少了几条」是三处判据里的哪一处不一致造成的，并且知道改一边而忘另一边时，
数字会怎么变。

### 2.1 三个数是什么（2026-10-30 实测）

| 口径 | 函数 | 记录数 | 判据（逐项） |
|---|---|---|---|
| **官方可见棋** | `server/match/gamedata.js:37` `isOfficialVisibleChess`；客户端同一档用 `rosterOf` → `isLoadoutSlot`(`loadoutModel.js:553`)，判据写法不同但今天同为 112（差异见 §2.3 #3） | **112** | `!isGolden && !isDiy && !isHidden && grantOnly !== true && Number.isInteger(tier) && visible === true && zhajing !== true` |
| **炸惊名册** | 客户端 `public/js/ui/loadoutModel.js:568` `zhajingRosterOf` | **99** | `zhajing === true && !isGolden && typeof chessId === 'string'`（**不**要求 `visible`） |
| **炸惊商店池** | 引擎 `GameData.visibleChess`（`gamedata.js:325-333`，`zhajing` 分支） | **97** | 炸惊名册 − `grantOnly === true`（重岳 / 白铁 2 条只能由策略授予，不进商店） |
| **湮灭名册** | 引擎 `gamedata.js:65` `annihilationRoster`；客户端 `loadoutModel.js:582` `annihilationRosterOf` | **125** = 112 + **13** | 官方分支同上 + `annBonds ∩ modBonds` 至少一条开着；mod 自带干员（`annihilation === true`）走同一套过滤，只把 `visible === true` 换成 `annihilation === true` |

数量关系用一句话记：**112 是基座，炸惊 99 是另一份名单（不是子集），湮灭 125 是基座 + 13 个 mod 干员位**。
13 来自 26 条 `annihilation: true` 记录里的 **`_a` 基础形**（`_b` 精英形 `isGolden: true`，被 `!c.isGolden` 挡掉）：
`data/chess.json` 现在 500 条，其中 `annihilation: true` 26 条（13 基础 + 13 精英）。

### 2.2 三个容易读错的中间数

| 你会量到的数 | 它是谁 | 为什么**不是**池子 |
|---|---|---|
| 224 | `visible === true && zhajing !== true` 的原始条数 | 它正好是 **112 条官方基础形 + 112 条 `_b` 精英形**（官方 `_b` 也是 `visible: true` + `isGolden: true`）；`isOfficialVisibleChess` 的 `!isGolden` 一条就砍掉一半，其余条件（`isDiy` / `isHidden` / `grantOnly` / 整数 `tier` / `zhajing`）今天在这 112 条上一条都不命中 |
| 199 | `zhajing === true` 的记录总数 | = 99 条基础形 + 100 条 `_b` 精英形（`isGolden: true`）；另有 4 条 `grantOnly`（2 基础 + 2 精英，重岳 / 白铁）只能由策略授予，不进商店 |
| 26 | `annihilation: true` 的记录数 | 一半是精英形；名册要的是 13 个「干员位」（记录是 13 对 `_a`/`_b`） |

### 2.3 判据差异：三处，任何一处都会让两侧数字分叉

| # | 维度 | 引擎（`gamedata.js`） | 客户端（`loadoutModel.js`） | 分叉后果 |
|---|---|---|---|---|
| 1 | 「哪些 `annBonds` 边算内容 mod」 | `annModBonds(bonds)`(`:46`)：**从数据里**取 `annOnly === true` 且属于 `ANN_CONTENT_NAMES` 的盟约 | `modEdges` = `annBonds.filter((b) => ANN_MOD_DEFAULT_ON.includes(b))`(`:585`)：**写死缺省表** | 数据新增第三条 `annOnly` 盟约却没进 `ANN_MOD_DEFAULT_ON` 时：引擎把它当 mod 边，客户端当「陌生边」→ 只由它带进来的棋在客户端**多出来** |
| 2 | 官方记录没有任何 mod 边时 | `brought.length === 0 || brought.some(on)`(`:80`)——**无边 = 保留** | `modEdges(c).length === 0 \|\| kept(c)`(`:592`)——同一条 | 谁写成「有边就必须都开着」谁就**少人**（3 条的复现见 §2.4） |
| 3 | 精英形 | 官方分支靠 `!isGolden` 排除（官方 `_b` 是 `visible: true` + `isGolden: true`，`:37`） | 显式再排一次 `baseId && baseId !== chessId`(`:591`) | 今天等价；但若某条官方 `_b` 的 `isGolden` 丢了，引擎会多出它、客户端不会 |

> 今天（2026-10-30）两侧在默认开关下**逐项相等**：`annihilationRoster(chess,bonds,null)` 与
> `annihilationRosterOf(list,null)` 都返回同一组 125 个 id（实测 `engine only = []`、`client only = []`）。
> 但请把这句话当成**被测试钉住的不变量**，而不是巧合：引擎侧有
> `test/match/annihilation-mods-default.test.js:154`「`annihilationRoster` 与 `GameData.visibleChess` 逐项相等」，
> 客户端↔引擎的**跨侧**对等目前只有 `test/ui/loadout.test.js:555` 的 `125` 与 `test/ui/zhajing-loadout.test.js:194`
> 的正则（它钉的是「`loadout.js` 用哪个函数」）。**跨侧逐 id 对等没有专门测试**——这是本线最该补的一条（§8 第 14 项）。

### 2.4 铁律：`server/match/gamedata.js` 与 `public/js/ui/loadoutModel.js` 必须同时改、口径必须逐项相同

**今天刚踩过：客户端比引擎少 3 条。** 复现方式与机制（都能在 §6.1 的探针里重跑）：

```
data/chess.json 里只有非 mod 边（steadShip / swiftShip / raidShip）的官方基础形，正好 3 条：
  chess_char_1_04_a  深巡     annBonds: ["steadShip"]
  chess_char_4_12_a  歌蕾蒂娅 annBonds: ["swiftShip"]
  chess_char_5_05_a  乌尔比安 annBonds: ["raidShip"]
客户端若把「annBonds 有边 ⇒ 每条边都必须是内容 mod 边」当判据，这 3 条会被判出局 ⇒ 122 ≠ 引擎 125。
引擎的写法是 brought = annBonds ∩ modBonds，空集就保留（gamedata.js:72-80）。
```

把这条教训变成可执行的检查顺序（改池子时按顺序做，**一步都不许跳**）：

1. **先读两处判据**：`gamedata.js:37` + `:65-82`，和 `loadoutModel.js:553-595`。逐行并排看，不要「看着差不多」。
2. **同一次提交里改两边**：引擎加分支 → 客户端加对应分支；引擎改边过滤 → 客户端改边过滤。
3. **两边的过滤函数名必须能一一对应**（今天是 `isOfficialVisibleChess` ↔ 官方分支、`annihilationRoster` ↔
   `annihilationRosterOf`）；名字对不上就说明口径已经分叉。
4. **跑两侧计数**：引擎侧 `test/match/annihilation-mods-default.test.js`（125 / 全关 = 112 / 关一条只少它带进来的）、
   客户端侧 `test/ui/loadout.test.js:536-564`（125 + 盟约筛选 = 成员表）。
5. **跑隔离矩阵**：`devtools/check-mode-isolation.mjs:133-140` 会断言湮灭的 `visibleChess` 等于「官方 + 13 个干员位」；
   它跑的是引擎侧，客户端侧靠 `test/ui/zhajing-loadout.test.js` 的正则钉住调用点。
6. **任何一侧出现「看起来对但数目不对」**：先怀疑边过滤（§2.3 的 #2），再怀疑 `visible` 与 `annihilation` 的互换，
   最后才怀疑排序/去重。

### 2.5 开关（`annMods`）只影响「谁进来」，不影响「谁是官方」

- 缺省表只有两条：`ANN_MOD_DEFAULT_ON = ['rhodesShip', 'kazdelShip']`（`shared/annihilation-constants.js:22`）。
- `annModOn(annMods, name)`(`:31`) 的语义是**显式压缺省**：房间写 `{ kazdelShip: false }` 才关（`lobby.js:338`
  `normalizeAnnMods` 把 `false` 留下来，`lobby.js:357` `annModsEcho` 只回显显式键）。
- 实测：默认 125；只关 `rhodesShip` → 116；只关 `kazdelShip` → 118；两条全关 → **105**（= 官方 112 减去「只由 mod
  带进来的 7 条官方棋」）。全关时 `bondIds` 与官方四档逐项相同（`test/match/annihilation-mods-default.test.js:162-176`）。
- **`isOfficialVisibleChess` 一个字都不许改**：官方 112 是 golden 与官方四档的基线，动它等于动全仓（§7.5）。

### 2.6 一条湮灭干员记录长什么样（`data/chess.json` 的 `chess_char_9_01_a`，摘录）

```
{
  "chessId": "chess_char_9_01_a",     // 名册/id 的键，也是客户端 roster 的 chessId
  "baseId": "chess_char_9_01_a",      // 基础形指向自己（客户端 §2.3 #3 的 baseId 检查就靠它）
  "goldenId": "chess_char_9_01_b",    // 精英形；名册只收基础形
  "isGolden": false,                  // _b 是 true ⇒ 被 !isGolden 挡掉
  "tier": 1,                          // 必须是整数（isOfficialVisibleChess 与客户端都查）
  "isHidden": false, "isDiy": false,
  "visible": false,                   // ★ mod 干员必须 false：漏打就是 §7.5
  "annihilation": true,               // ★ 引擎/客户端认「mod 自带干员」的唯一标记
  "annBonds": ["kazdelShip"],         // ★ 只收内容 mod 边（由盟约 members 反推）
  "bonds": ["kazdelShip", "indomShip"], // 包内原值：比 annBonds 宽（indomShip 是普通盟约，不进 mod 边集合）
  "garrisonIds": ["garrison_04_a"],
  "upgradeChessId": "chess_char_9_01_b",
  "name": "红豆", "charId": "char_290_vigna", "rarity": 4, "profession": "PIONEER"
}
```

读这条记录时只要记住三个标记：**`annihilation: true`（我是 mod 干员）+ `visible: false`（官方池看不见我）+
`annBonds`（我在湮灭下属于哪几条盟约）**。注意 `bonds` 与 `annBonds` **不是同一张表**：`bonds` 是包内的原生盟约
（可以含 `indomShip` 这类普通盟约），`annBonds` 只保留内容 mod 边——名字里的 `ann` 说的是「湮灭这一层」。其余字段与
官方记录同 schema（`data/chess.json` 的键集是它们的超集，`handoff/ann-chess-inventory.md` §1.2 做过逐键对照：
`pack-only keys = ∅`）。

### 2.7 一眼验证「边过滤」没写错

```bash
node --input-type=module -e "
import fs from 'node:fs';
const chess = JSON.parse(fs.readFileSync('data/chess.json','utf8'));
const list = Object.values(chess);
const { ANN_MOD_DEFAULT_ON } = await import('./shared/annihilation-constants.js');
// 只有非 mod 边的官方基础形：这 3 条必须留在名册里（少一条就是 §2.4 的复现）
console.log(list.filter((c) => !c.isGolden && c.visible === true && c.zhajing !== true
  && (c.annBonds || []).length && !(c.annBonds || []).some((b) => ANN_MOD_DEFAULT_ON.includes(b)))
  .map((c) => c.chessId));   // ['chess_char_1_04_a','chess_char_4_12_a','chess_char_5_05_a']
"
```

---

## 3. 数据链：research → `data/` → 客户端

**这一步做完什么会变：** 你新增/修改一个玩法包的棋子时，知道只能改哪里、生成期会在哪一行把你拦住。

### 3.1 三段链路

```
modref/mods/<pack>/…/chess.json           包内原始快照（不在 git 关注的产物里）
  ↓ tools/extract-annihilation-mods.mjs   （研究归档器；炸惊用 tools/extract-zhajing-research.mjs）
docs/research/20-annihilation-mods.json   研究产物（唯一出处；手改会被下次重跑覆盖）
  ↓ npm run build-data（tools/build-data.mjs）
data/*.json                               生成物：**永不手改**
  ↓ node tools/sync-static-web.mjs
public/data/*.json                        客户端读的那一份
```

| 环节 | 关键函数 | 它保证什么 |
|---|---|---|
| 导入 | `tools/extract-annihilation-mods.mjs` | 逐字段复制包内记录；`annBonds` 由盟约 `members` 反推（`annihilation ↔ members` 双向一致） |
| 合并 | `tools/build-data.mjs:3473` `applyAnnihilationMods(files, mods)` | 纯加法：卫戍先并、chess 再并、bonds 替换、items/effects 同批；撞到官方记录直接 `throw` |
| 生成期护栏 | `build-data.mjs:3507-3520` | `annihilation === true`、`visible === false`、`tier` 整数、`bonds`/`garrisonIds`/`tokens` 全部解析得到、`annBonds` 非空 |
| 报告 | `build-data.mjs:3944` `visibleChess: …filter((c) => !c.isGolden && c.visible).length` | 官方池计数（应当永远是 112） |
| 只在默认数据集 | `build-data.mjs:3285` `isImportedChess` | 导入快照不参与「本仓 builder 输出」的配对/站位断言（炸惊先开的先例） |

### 3.2 三条数据纪律

1. **`data/` 不可手改**：`AGENTS.md` 的硬规则；`test/data.test.js` 的离线重建会逐字节比对。
2. **新记录必须 `visible: false`**：`build-data.mjs:3512` 会 `throw`（"visible must be false"），
   `test/data.test.js:1237` 再钉一遍 research 侧。
3. **`members` 与 `annBonds` 是同一张表的两面**：`members` 由盟约写、`annBonds` 由棋子写；`test/data.test.js:338-358`
   双向校验（成员存在、`annBonds` 认这条盟约、`visibleMembers` 同步、`max(thresholds)` 可达）。

---

## 4. 服务端：两个文件把「数据」变成「名册」

**这一步做完什么会变：** 你能回答「服务端凭什么拒绝我这条调配」，并知道 `annMods` 从协议一路穿到战场。

### 4.1 `gamedata.js` 的三层

| 层 | 符号 | 读的人 |
|---|---|---|
| 纯谓词（无状态） | `isOfficialVisibleChess`(`:37`)、`annModBonds`(`:46`)、`annihilationRoster`(`:65`)、`itemAnnModOff`(`:93`) | `lobby.js`、测试、`devtools` |
| 实例视图 | `GameData.visibleChess`(`:325`)、`bondIds`(`:355`)、`annMods` 冻结(`:265`)、`shopItemsByTier`(`:340-354`) | `Match` |
| 战斗标志 | `annihilationFlags(kind, round)`(`:639`)，把显式 `annMods` 送进 `flags.annMods`(`:658-659`) | sim |

注意 `annihilationRoster` 的注释里仍写着「默认名册 = 官方 112 + 26 条 = 138」——那是**方案 A 之前的旧算式**；
今天的真值是 **125**（26 条记录里只有 13 条 `_a` 基础形能进名册）。以 `:58` 附近的注释和 `docs/ANNIHILATION-MODS.md`
§7.1 的表格为准，改代码时顺手把那句注释改掉（纯注释，不动逻辑）。

### 4.2 `lobby.js` 的四处

| 位置 | 作用 |
|---|---|
| `normalizeAnnMods`(`:338`) | 只收 boolean；`comms` 归一成 `commsPriority`；未知名字丢掉 |
| `annModsEcho`(`:357`) | `room.state.annMods` 只回显**显式**键（缺省不进表，客户端用同一份缺省表渲染） |
| `Lobby.loadout` 湮灭分支(`:1970-1991`) | 只接受 `difficulty === 'ANNIHILATION'` 的房；名册取 `annihilationRoster(data.chess, data.bonds, room.annMods)`；写成 `session/seat.annLoadout`；局内交给 `match.setLoadout(…, 'annihilation')` |
| 建房 | `room.create` 收到 `mode + difficulty`（+ 蚀流 `erosion`）后由 `modeIdFor` 派生 `mode_single_annihilation` / `mode_multi_annihilation` |

**拒绝语义**：名册里没有的 id ⇒ `checkLoadout` 整包失败（`BAD_TARGET` / `BAD_MSG`），**不会**部分保存。
客户端因此要在发送前先按名册裁剪（`loadoutSync.js:396-397`），否则玩家关掉一条 mod 后每次编辑都会失败一次。

### 4.3 一条容易忽略的对称性

`room.loadout` 有**三份互不覆盖**的档案：官方 `.loadout`、炸惊 `.zjLoadout`、湮灭 `.annLoadout`（`lobby.js:1955-2020`）。
写错档位（例如在官方房发 `mode:'annihilation'`）会被 `BAD_TARGET` 拒掉——这是有意的：**玩法包的调配永远不污染官方档**。

---

## 5. 客户端：五层，一层一个函数

**这一步做完什么会变：** 你知道「大厅卡片 / 二级页 / 干员调配 / 回传」各归谁，改界面时不会把状态放到错的层。

### 5.1 层次表

| 层 | 文件:符号 | 要点 |
|---|---|---|
| 卡片 | `lobby.js` `MODE_CARDS` + `openMode` | `solo / ext / else` **必须显式三分**，落进 `else` 会把拓展模式弹成「选择同盟方式」 |
| 大厅列表 | `extensionModes.js` `ExtensionHall`(`:242`) | 只画 `EXTENSION_MODES` 里的东西；行高固定、一行简介（`docs/EXTENSION_MODE.md` §4.2） |
| 二级页 | `extensionThemeHall.js` `ExtensionThemeHall`(`:110`) | 主题背景 `.ext-theme__art-img`(`:129`)；条目没声明 `theme.art` 就**不画** `<img>`（`test/ui/extension-modes.test.js:287`） |
| 调配档 | `loadout.js` `setTier`(`:684`) → `tierMode`(`:687`) → `tierBonds`(`:688`) → `roster`(`:693-698`) | 三档各走各的：`zhajingRosterOf` / `annihilationRosterOf(…, roomAnnMods)` / `rosterOf` |
| 回传 | `loadoutSync.js` `flushAnnLoadout`(`:389`) | 发送前按 `annRosterIds()`(`:410`) 裁剪；`annEntries` 留在本机不删 |

### 5.2 为什么「盟约筛选」要单独一个函数

湮灭那两条盟约（`rhodesShip` / `kazdelShip`）只把成员写在 **`bonds[].members`** 上，棋子的 `bonds` 里一条都没有
（`data/chess.json` 对这两个 id 的引用数是 0）。所以 `bondIdsOf(chess, tierBonds)`(`loadoutModel.js:629`) 把
「盟约自己的 `members`」也算成这名干员的盟约，`filterRoster(…, tierBonds)`(`:639`) 用它做筛选与搜索。
`tierBonds` 必须是**这一档能看见的盟约**（`officialBonds(list, mode)`）：官方档不传 `annOnly` / `zjOnly`，所以官方档
逐字节不变（`test/ui/loadout.test.js:536-564`）。

### 5.3 素材缺失时的正确答案是 `null`

`assetUrls.js` 的契约写在文件头：**只返回 manifest 里存在的 URL，解析不到就返回 `null`，由调用方画兜底**。
湮灭 mod 的 13 名干员现在都有本地素材（2026-10-31 最后 4 位——陨星 `char_219_meteo` / 霜叶 `char_193_frostl` /
坚雷 `char_260_durnar` / 阿米娅 `char_002_amiya`——按干员补齐，`test/ui/assetUrls.test.js` 的 `ANNIL_LOCAL_ART`
写死它们此刻解析出的具体路径），所以这条兜底改由一个**没有**素材条目的合成记录守着：同一文件
「a chess whose character has no manifest entry still resolves to null」断言它**必须**是 `null`——不能是
「一条既不在清单里也不是 `null` 的 URL」，也不能为了「看起来有图」去造路径。

---

## 6. 测试与验收

**这一步做完什么会变：** 你有一个可以照抄的命令清单和一张「每个守卫在钉什么」的表，改完不会靠肉眼确认。

### 6.1 一条探针（当前工作区实测，改池子前后各跑一次）

```bash
# 在仓库根目录；只读，不写任何文件
node --input-type=module -e "
import fs from 'node:fs';
const chess = JSON.parse(fs.readFileSync('data/chess.json','utf8'));
const bonds = JSON.parse(fs.readFileSync('data/bonds.json','utf8'));
const g = await import('./server/match/gamedata.js');
const m = await import('./public/js/ui/loadoutModel.js');
const list = Object.values(chess);
const ids = (a) => a.map((c) => c.chessId);
console.log('official', list.filter(g.isOfficialVisibleChess).length);            // 112
console.log('zhajing roster', m.zhajingRosterOf(list).length);                   // 99
console.log('ann engine', g.annihilationRoster(chess, bonds, null).length);     // 125
console.log('ann client', m.annihilationRosterOf(list, null).length);           // 125
const a = new Set(g.annihilationRoster(chess, bonds, null));
const b = new Set(ids(m.annihilationRosterOf(list, null)));
console.log('engine-only', [...a].filter((x) => !b.has(x)));                    // []
console.log('client-only', [...b].filter((x) => !a.has(x)));                    // []
console.log('all mods off', g.annihilationRoster(chess, bonds, { rhodesShip: false, kazdelShip: false }).length); // 105
"
```

> 沙箱提示：`node --test test/…` 在受限环境里可能被 `spawn EPERM` 挡住；等价做法是直接
> `node test/ui/loadout.test.js`（每个测试文件都是可执行的 ESM 入口）。

### 6.2 守卫清单（每个测试钉什么）

| 测试 | 钉住的不变量 |
|---|---|
| `test/data.test.js:96,103` | `chess` 500 条、官方可见 **112**（标题与断言同时写着） |
| `test/data.test.js:338-358` | 两条盟约的**阈值可达性**：`members.length >= max(thresholds)`、每个成员有棋子且 `annBonds` 认这条盟约、`4_27` 白名单、阈值仍是 `[3,6]` / `[3,6,9]` |
| `test/data.test.js:1237` | research 导入的每条 chess `visible === false` |
| `test/match/annihilation-mods-default.test.js:122-160` | 默认 125、全关 105（= 官方 112 − 只由 mod 带进来的 7 条）、`annihilationRoster === visibleChess` 逐项 |
| `test/match/annihilation-mods-isolation.test.js:56-140` | 关掉 mod 后池子回落、成员数仍 ≥ 阈值 |
| `test/match/mode-isolation-matrix.test.js:142-146` | 隔离矩阵：官方 112 / 湮灭 125 |
| `test/ui/loadout.test.js:536-564` | 客户端的 125 + 盟约筛选恰好等于 `members` |
| `test/ui/zhajing-loadout.test.js:192-196` | `loadout.js` 的三档名册调用点（正则钉死） |
| `test/ui/zhajing-loadout.test.js:340-356` | 矮屏仍然**画**背景图（§7.1） |
| `test/ui/ownership-roster.test.js:102-104` | 持有页 = 官方可见棋；13 条 mod 干员默认 `visible: false` |
| `test/ui/assetUrls.test.js` 的 `ANNIL_LOCAL_ART` / 兜底合成记录 | 4 位湮灭干员解析到写死的路径；没有素材条目仍是 `null`（§7.6） |
| `devtools/check-mode-isolation.mjs:133-140` | 引擎侧隔离：湮灭 `visibleChess === 官方 + 13`，且不受炸惊影响 |

### 6.3 一次完整验收（按顺序）

```bash
node tools/extract-annihilation-mods.mjs     # 只有改了数据源时才跑；会重写 docs/research/20
npm run build-data                           # exit 0、0 error、visibleChess=112、warning 163
node tools/sync-static-web.mjs               # data/ → public/data/
node test/data.test.js                       # 逐个文件直跑（受限沙箱里 node --test 可能被 spawn 挡住）
node test/match/annihilation-mods-default.test.js
node test/match/annihilation-mods-isolation.test.js
node test/ui/loadout.test.js                 # UI 套件同理，逐个跑
node devtools/check-mode-isolation.mjs       # 引擎侧隔离
npm run golden                               # 不应有任何移动；动了就停下报告
```

> 不受限的机器上 `node --test test/ui/**/*.test.js` 一条就够；**报错行要原样贴出来**（仓库规则：PR 描述要贴摘要行）。

---

## 7. 坑清单（今天真踩过的六个）

**这一步做完什么会变：** 六个「看起来能用、实际不生效」的坑各自有症状、根因和改法，下次 5 分钟内能认出来。

### 7.1 矮屏把背景图 `display:none` 掉

- **症状**：手机（≤520 高）二级页是纯深色底，桌面版有主视觉；`_e2e` 读数 `.ext-theme__art-img` 为 0。
- **根因**：矮屏媒体查询为了省空间直接 `display: none`，把「版式收紧」写成了「删掉内容」。
- **现在的规则**：`public/css/screens/lobby.css:1806-1818` 的 `@media (max-height: 520px)` 里
  `.ext-theme[data-theme] .ext-theme__art-img { display: block; opacity: .5; }`——**同一张图、只收一档不透明度**，
  遮罩与对比度规则不动。
- **钉住它**：`test/ui/zhajing-loadout.test.js:356` 用正则断言这行 CSS；`devtools/render-check-extension-hall.mjs:124`
  会真的读 `img.complete && naturalWidth`。
- **教训**：媒体查询里只允许「收小 / 换布局」，不允许「删内容」；删内容要业主决定并写进 `docs/EXTENSION_MODE.md`。

### 7.2 `ensureLobby` 只判 `.mode-card` 就以为在大厅

- **症状**：从「干员调配」或另一个玩法包返回后，脚本再进二级页**不渲染**；点击全打在看不见的层上。
- **根因**：`devtools/lib/zhajing-panels.mjs:165` 的旧实现只看 `.mode-card` 在不在 DOM 里。拓展弹层、二级页、
  干员调配整屏（`.lo-top`）、S.W.E.E.P. 报告都是**盖在大厅上面**的层，底下 hub 连同三张 `.mode-card` 还在（实测
  干员调配打开时 `.mode-card` 有 3 张）。
- **现在的规则**：按**可见性**判定（`getComputedStyle` 的 `display`/`visibility` + `getBoundingClientRect` 宽高），
  任何可见的 `.modal__box` / `.lo-top` / `[data-testid="extension-theme"]` / `.sw-report` 都算挡路；先点干员调配自己的
  `.lo-back`，其余逐层 `Escape`，最后兜底 `goto('/')`。
- **同类**：`ensureTheme`(`:217`) 也按可见性判定，并且**每次都从头走**（叠层的 `Escape` 次数每次都不一样）。
- **教训**：脚本里的「到了某个界面」一律按**可见**判定，不按 DOM 存在判定。

### 7.3 用外层轮询量动画时长

- **症状**：藏品三选一的「启动 → 三张卡出现」实测 3.2–4.5 s，与设计节奏（≈1.74 s）差一倍以上。
- **根因**：`devtools/render-check-annihilation-room.mjs:153-202` 的外层循环 700 ms 一轮，而这段节奏
  （900/1120/1340 + 40 停轮 + 360 揭晓）比轮询粒度还短；外层 `Date.now()` 把等待、截图和 `evaluate` 往返一起算进去。
- **现在的规则**：时钟放进页面里——点击前记 `performance.now()`，`MutationObserver` 记每张 `.rlc` 进 DOM 的时刻，
  判据只用**页面内两个时间戳相减**；`polledMs` 只留作对照、不参与判定。
- **教训**：任何「等待某元素出现」的时长，只要小于轮询间隔，就必须在页面内测量。

### 7.4 盟约 `members` 与阈值不对称（6 名档 / 9 名档不可达）

- **症状**：`rhodesShip` 阈值 `[3,6]`、`kazdelShip` `[3,6,9]`，但 2026-10-29 之前 `members` 只有 5 / 4 名——
  玩家的第 6、第 9 名档**永远吃不到**，界面上却没有任何报错。
- **根因**：数据缺口（mod 自带干员没搬进来），且当时没有断言把「阈值可达」写下来。
- **现在的规则**：`test/data.test.js:338-358` 是**阈值可达性守卫**——`members.length >= max(thresholds)`、每个成员都能
  在 `data/chess.json` 找到且不是精英形、`annBonds` 认这条盟约、`visibleMembers` 同步、阈值保持包内原值
  （`[3,6]` / `[3,6,9]`，搬人不是改设计）。今天 13 / 11，`chess_char_4_27_a` 是唯一白名单（两个包都没有记录）。
- **教训**：**任何「N 名成员解锁」的规则，都要有一条「成员数 ≥ 最高阈值」的断言**，否则缺口是静默的。

### 7.5 `visible: true` 泄漏（导入记录漏打 `visible: false`）

- **症状**：官方可见棋从 112 变成 138；更糟的是 `tools/golden.mjs` 的 EQUIPS 游标整体错位（2026-10-29 实测
  42+8+20 个场景位移）。
- **根因**：包里记录写的是 `visible: true`、`isHidden: false`；照抄进 `data/chess.json` 就等于把它们塞进官方池。
- **现在的规则**：三重护栏——`build-data.mjs:3512` 生成期 `throw`；`test/data.test.js:1237` 钉 research 侧；
  `test/ui/ownership-roster.test.js:103` 钉「13 条 mod 干员默认全部 `visible: false`」。另外 `isOfficialVisibleChess`
  里的 `visible === true` 是**唯一**的官方入口，改它就是动全仓。
- **教训**：新玩法包的数据一律「自己的标记（`annihilation` / `zhajing`）+ `visible: false`」，官方池靠标记看不见它们。

### 7.6 无素材要解析成 `null`，不要造 URL

- **症状**：控制台 404 噪音；或者为了「有图」拼一条 `/assets/char/…` 的路径，图裂在玩家脸上。
- **根因**：导入的干员本机没有素材（不在官方名册，也没下载过）时，如果为了「有图」拼路径，图就裂在玩家脸上；而
  `assetUrls.js` 的契约是「只返回 manifest 里存在的 URL」。（2026-10-31 起这 4 位已补齐素材，历史情形仍可能重现。）
- **现在的规则**：`chessAvatarUrl` / `chessPortraitUrl` 解析不到就返回 `null`，**调用方画兜底**；
  `test/ui/assetUrls.test.js` 的 `ANNIL_LOCAL_ART` 写死这 4 位此刻解析出的具体路径，兜底则由一条**没有**素材条目
  的合成记录断言 `null`；其余有素材的仍走严格断言（必须命中 manifest）。
- **教训**：素材是**可选输入**；「有没有图」是渲染问题，不是名册问题——不能因为没图就把干员从名册里删掉
  （删了罗德岛/卡兹戴尔又回到不可达）。

---

## 8. Checklist（照着勾，15–25 条）

改动前（理解现状）

- [ ] 1. 读 `docs/EXTENSION_MODE.md` 的 §1–§3 与本文 §2；在 `public/js/screens/extensionModes.js:59` 找到 `EXTENSION_MODES` 里你要动的那一条。
- [ ] 2. 跑 §6.1 探针，记下四个数（官方 / 炸惊名册 / 引擎湮灭 / 客户端湮灭），今天应是 `112 / 99 / 125 / 125`。
- [ ] 3. `node devtools/check-mode-isolation.mjs` 通过（改之前先知道基线是绿的）。

改判据（池子）

- [ ] 4. 引擎侧只改 `server/match/gamedata.js` 的 `annihilationRoster` / `isOfficialVisibleChess`；后者**默认不动**（官方 112）。
- [ ] 5. 客户端侧**同一次提交**改 `public/js/ui/loadoutModel.js` 的对应过滤器，逐项对齐 §2.3 的三行（边集合、无边保留、精英形）。
- [ ] 6. 边过滤语义保持「`annBonds ∩ modBonds`」：断言「只有 `steadShip`/`swiftShip`/`raidShip` 边的 3 条官方棋仍在名册里」。
- [ ] 7. 名册长度断言：默认 125、全关 105、只关 `rhodesShip` 116、只关 `kazdelShip` 118（任一不等 ⇒ 停手查边过滤）。
- [ ] 8. `visible === true` 泄漏检查：`node -e "…count(isOfficialVisibleChess)…"` 必须仍是 112。

改数据（导入新干员/新盟约）

- [ ] 9. 只改 `tools/extract-*.mjs` + `docs/research/*.json`（由工具写），**不手改 `data/`**。
- [ ] 10. `npm run build-data`：exit 0、0 error、`visibleChess=112`、warning 仍是 163（数目变化必须在报告里解释）。
- [ ] 11. `node tools/sync-static-web.mjs` 后，`data/` 与 `public/data/` 的差异只有新增记录（既有记录哈希不变）。
- [ ] 12. 盟约可达性：`members.length >= max(thresholds)`，且每个成员 `!isGolden` 且 `annBonds` 含该盟约。
- [ ] 13. 悬挂 id 只许进 `_extract.notes.unmatchedBondMembers`（今天只有 `chess_char_4_27_a`），**不许进 `members`**。

测试

- [ ] 14. 补一条**跨侧逐 id 对等**断言：`annihilationRoster(chess,bonds,annMods)` 的 id 集合 === `annihilationRosterOf(list,annMods)` 的 `chessId` 集合（默认 / 单关 / 全关三种开关）。这是今天缺的那条。
- [ ] 15. `node test/data.test.js`、`node test/match/annihilation-mods-default.test.js`、`node test/match/annihilation-mods-isolation.test.js` 全绿。
- [ ] 16. `node test/ui/loadout.test.js`、`node test/ui/zhajing-loadout.test.js`、`node test/ui/ownership-roster.test.js`、`node test/ui/assetUrls.test.js` 全绿。
- [ ] 17. `npm run golden` 零移动；有任何移动 ⇒ 停下报告，不改 golden。

界面 / 真机

- [ ] 18. 矮屏（792×360 或 ≤520 高）二级页：`.ext-theme__art-img` 存在、`display: block`、`opacity: .5`（§7.1）。
- [ ] 19. 大厅「拓展模式」卡 → 二级页 → 干员调配 → 返回：每一层都用**可见性**判定，没有把点击打在隐形层上（§7.2）。
- [ ] 20. 干员调配按盟约筛选「罗德岛」= 13 人、「卡兹戴尔」= 11 人；关掉一条 mod 后对应成员从筛选里消失。
- [ ] 21. 无素材的 4 位干员在列表里是兜底占位（不是裂图、不是 404），且在名册与盟约计数里仍然存在（§7.6）。
- [ ] 22. 房间改 `annMods` 后：`room.state` 重广播 → 客户端名册立刻变 → 编辑不再整包 `BAD_TARGET`（§4.2）。

收尾

- [ ] 23. 文档同步：本文 §2 的表格 + `docs/ANNIHILATION-MODS.md` §7.1 + `docs/EXTENSION_MODE.md` 里凡写「湮灭名册 = 官方 112」的句子。
- [ ] 24. 没有新增界面字符串字面量，也没有新增 i18n key（文案复用既有 msgid，例如模式名那几个字；`node tools/i18n.mjs check --all --strict` 通过）。
- [ ] 25. 报出你跑的**每一条命令的摘要行**，以及 §6.1 的五个读数（官方 / 炸惊 / 引擎 / 客户端 / 全关）。

---

## 9. 术语与交叉索引

**这一步做完什么会变：** 你和别人说「池子」「开关」「调配档」时，指的是同一个东西。

| 词 | 含义 | 出处 |
|---|---|---|
| 玩法包 / play set | 与官方四档**并列**的额外玩法（湮灭 / 炸惊），不是难度、不是房间模式 | `docs/EXTENSION_MODE.md` §1.1、`extensionModes.js:59` |
| 调配档 / tier | 干员调配屏的一档：`official` / `zhajing` / `annihilation` | `loadout.js:684-687` |
| 池子 / 名册 / roster | 屏幕上能调配的棋子集合；引擎叫 `visibleChess` / `annihilationRoster` | §2 |
| 内容开关 / `annMods` | 房间级 boolean 表，两条内容 mod 缺省开 | `shared/annihilation-constants.js:22,31` |
| `annBonds` | 棋子在湮灭下**额外计入**的盟约边（由盟约 `members` 反推） | `build-data.mjs:3504-3520` |
| `annOnly` | 只属于湮灭的盟约 / 装备标记（官方与炸惊看不见） | `gamedata.js:46`、`test/data.test.js:304-336` |
| `grantOnly` | 只能由策略授予、不进商店的记录（重岳 / 白铁等） | `gamedata.js:327-332` |
| 隔离 | 「玩法包的数据不得漏进官方四档」这条不变量 | `test/match/*isolation*`、`devtools/check-mode-isolation.mjs` |

**继续读**：规则与状态机 → [`docs/EXTENSION_MODE.md`](EXTENSION_MODE.md)；湮灭数据缺口与修复记录 →
[`docs/ANNIHILATION-MODS.md`](ANNIHILATION-MODS.md) §7；炸惊 → [`docs/ZHAJING.md`](ZHAJING.md)；数据地图 →
[`docs/DATA.md`](DATA.md)；代码地图 → [`docs/ARCHITECTURE.md`](ARCHITECTURE.md)。

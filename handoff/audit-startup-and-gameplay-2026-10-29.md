# 启动加载文案 + 炸惊局内玩法巡检（2026-10-29，只读调查）

调查人：zj-icons（子代理）。**本文件是本次唯一的写入**：没有改代码 / 测试 / 数据，没有 git 写操作。

---

## 摘要（先给结论）

| # | 主题 | 结论 | 严重度 |
|---|---|---|---|
| A1 | 启动加载文案 | 现在只报 `正在解压游戏运行环境与资源… (1/3)`，且**每个分片解压完都喊一次「作战资源释放完成」**；中间进度用了写死的 `(fileCount / 9200)`（真实总量 44,463）。可以按包显示「第几个包 · MB · 文件数」：`bundle.parts` 已有每片字节数与 sha256，但**没有文件数**；两种拿法都可行（推荐给 `bundle.parts` 加一列，回退用 `assets.openFd` 读 zip 中央目录）。 | P2（体验） |
| B1 | 整备区落位 | **不成立**：服务端炸惊 `hand.length = gd.benchSize = 20`，客户端 5 处仍写死 `GEO.HAND_SIZE = 10` → 第 11–20 格的干员**没有垫片、拖不进去、点不到**，但仍会被服务器正常买入/发放（`handFull()` 也不会报满）。 | **P1（局内可玩性）** |
| B2 | 盟约层上限 9999（规则1） | **不成立**：`sim/battle/economy.js` 的 `layerGainRoom(live, Infinity) > 0` 短路在 **999** 就把整次增益判 0，`modeCap` 分支永远到不了；match 侧 `settle.js:82` / `economy.js:49` 也没有 `bondLayerCap` 分支；`invariants.js` 用全局 999 判据，所以不会报错。 | **P1（规则不符，静默）** |
| B3 | 锻造器 `g.forgeTake` | 基本成立（三档稀有度、击杀 40、精锐、两次确认），但 **roll 为空时服务端跳过 rarity/picks 校验**（`acquire.js:415-417` 的 `if (roll && …)`）→ 可挑任意合法选项/档位。建议 fail-closed。 | P2（可利用面窄） |
| B4 | 惊变（我方） | 成立：每次 3 张、按 `spPhaseKinds` 的 1/3/6/8/10 五个回合各抽一手、排除已拥有 + 已被选走、重抽 4 次且每格一次、羁绊 18 条按 `tiers` 阈值计。 | — |
| B5 | 敌方惊变 | 成立：R1/R6（`enemyJibian.rounds`）各抽 1 张、整局累计并进每份战斗 spec、可揭晓；隐秘惊变只在 `hiddenRound`(R15) 抽「保底 hidden + 1 张普通」，`enemyJibianRoundsDone` 幂等。 | — |
| B6 | 禁选 `bans` | 成立：房间禁选进 `seat.bans → PlayerState.bans → m.private.bans`，只影响**该玩家自己的棋池抽取**（`economy.js:70-82` 的 `pool.roll` filter + `chessBannedByPreselect`），没选时 options 逐字节不变；mode 级随机禁仍在 `Match.js:494 drawDisabledBonds`。 | — |
| — | 既有测试 | `zhajing-*` + `zj-ops` + `zhajing-bonds` 共 **136 条全绿**（命令见附录）。 | — |

---

# 一、初次启动的加载文案：按包显示实际素材数量

## 1.1 现状（文件:行）

| 位置 | 现状 |
|---|---|
| `android/.../AssetManagerHelper.kt:47` | `onProgress("正在解压游戏运行环境与资源…")` |
| `AssetManagerHelper.kt:62-65` | 用 `context.assets.list("")` 过滤 `^app_bundle\.part\d+\.zip$` 再 `sorted()` 得到分片清单 |
| `AssetManagerHelper.kt:68-71` | 循环里 `onProgress("… (${index + 1}/${partNames.size})")` —— **只有序号，没有这一片的大小/文件数** |
| `AssetManagerHelper.kt:115-142` | `unzip()`：`fileCount` 每片从 0 重新数，进度文案写死 `("正在释放作战资源包 ($fileCount / 9200)…")` |
| `AssetManagerHelper.kt:141` | `unzip()` 末尾**无条件** `onProgress("作战资源释放完成，正在启动引擎…")` → 3 片会喊 3 次「完成」 |
| `MainActivity.kt:654-658` | `ensureAssetsExtracted(this) { msg -> runOnUiThread { tvLoadingStatus.text = msg } }` —— 唯一把分片进度显示出来的调用 |
| `MainActivity.kt:222`、`:638` | 另外两处 `ensureAssetsExtracted(applicationContext) {}` / `(this) {}`：**传空 lambda，完全没有文案**（远程模式 / 预取） |
| 其它刷新点 | `:641` 正在连接目标服务器、`:652` 正在准备本地运行资源、`:684` `R.string.server_starting`、`:706` 连接错误、`:742` 正在接入指挥链路、`:494` 显存重置 |

`tvLoadingStatus` 本身的刷新机制是好的：**子线程 → `runOnUiThread`**，没有跨线程写 View 的问题。缺的只是「每片一条、带数字」的文案与数据来源。

## 1.2 ①`bundle.parts` 的格式（`tools/bundle-android.mjs` 写出）

`tools/bundle-android.mjs:299-304`：

```js
const lines = jobs.map((j) => {
  const h = crypto.createHash('sha256').update(fs.readFileSync(j.target)).digest('hex');
  return `${path.basename(j.target)}\t${fs.statSync(j.target).size}\t${h}`;
});
fs.writeFileSync(PARTS_MANIFEST, `${lines.join('\n')}\n`, 'utf8');   // android/app/src/main/assets/bundle.parts
```

即**三列 TSV、每片一行**：`<文件名>\t<字节数>\t<sha256>`。仓库里现有这份文件（真实构建产物，只读实测）：

```
app_bundle.part01.zip	868236847	83acb6cf06d81d0aafef91c55bdf99962b07e20bf0f08fe6fb90f81abd85195c
app_bundle.part02.zip	1884415246	c283bd0e8ee80bdcea29fea465e74c9677fcced1418bb94e4f3f641b9a9c0f11
app_bundle.part03.zip	477673473	7e3a4f8d269ee6b01f1fa5d4cf98b8920c30ea06892e69a990fb89b632fec4df
```

**每片的真实文件数（我用 .NET ZipArchive 读中央目录量的，只读）**：

| 分片 | zip 字节 | 解压后字节 | **文件数** |
|---|---|---|---|
| `app_bundle.part01.zip` | 868,236,847（828 MiB） | 1,066,684,088（1,017.3 MiB） | **22,819** |
| `app_bundle.part02.zip` | 1,884,415,246（**1,797.1 MiB**） | 1,887,052,165（1,799.6 MiB） | **2,273** |
| `app_bundle.part03.zip` | 477,673,473（455.6 MiB） | 857,286,894（817.6 MiB） | **19,371** |
| 合计 | 3,230,325,566 | 3,811,023,147 | **44,463** |

三个分片都是**独立 zip、文件集合互不重叠**（`bundle-android.mjs:215-262` 的 `planParts` 按 `server|shared|data|node_modules` → 其它 → `public/assets/*` 的优先级贪心装箱，每片 ≤1800 MiB），所以「第几个包」就是按文件名排序的下标，不需要拼接。

**两个坑（顺手记下）**：
1. `bundle.sha256` 的内容是 `0.3.3-f1a7d9fe4952d459-parts3`，而 `-parts${licenseTargets.length}`（`bundle-android.mjs:389`）里的 `3` 是**许可证文件目标数**，不是分片数。这次的 3 片纯属巧合相等 —— **不要**拿版本串里的 `partsN` 当「第几个包」的来源，否则换一次分片就会错。
2. 三个分片里**目录条目数为 0**（44,463 个条目全是文件），数文件时不用跳过目录项。

## 1.3 ②Kotlin 侧能否在解压前读到每片的文件数与字节数

**能，两条路，都不需要解压。**

**证据（字节数）**：`bundle.parts` 就是 assets 里的一个小文本（292 B），`context.assets.open("bundle.parts")` 直接读。

**证据（文件数 / 解压后字节）**：`android/app/build.gradle:88-89`

```gradle
aaptOptions {
    noCompress 'zip', 'mp3', 'png', 'skel', 'atlas'
}
```

→ `app_bundle.partNN.zip` 在 APK 里是 **stored（未压缩）** 的，所以 `context.assets.openFd(name)` 返回一个真正可 seek 的 `FileDescriptor + startOffset + declaredLength`；用 `FileInputStream(fd).channel.position(startOffset + …)` 读到 zip 的 EOCD（尾部 ≤64 KiB）就能拿到中央目录，**几十 KB 读**即可数出 `totalEntries` 与 `Σ uncompressedSize`。代价与风险都比全量解压一遍小两个数量级。

> 注意 ZIP64：3 个分片都 <2 GiB，中央目录不是 ZIP64；但实现必须处理「EOCD 里出现 0xFFFF/0xFFFFFFFF 就退回兜底文案」，否则将来单片超 4 GiB 时会静默读错。

## 1.4 ③`tvLoadingStatus` 的刷新点

见 1.1 的表。要点：
- 只有 `MainActivity.kt:654-658` 这条链会把 `onProgress` 接到 UI；`:222` 与 `:638` 传的是空 lambda（**远程模式与预取不显示解压进度**）。
- 文案会在解压结束后被 `:684`（`R.string.server_starting`）覆盖，所以分片文案不需要「清空」，只要最后一片之后别再喊「完成」。
- `tvLoadingStatus` 在 `:63` 声明、`:191` 绑定，属于 `layoutLoading` 那一屏。

## 1.5 建议改法（每片一条文案）

**文案形状**（照业主给的例子，用 MiB，与 `1,797 MB` 对齐）：

```
正在解压素材包 2/3（第 2 个包 · 1,797 MB · 2,273 个文件）
```

解压过程中的细进度（把写死的 9200 换成这一片的真实文件数）：

```
正在释放作战资源包 (1,200 / 2,273)…
```

只在**最后一片**结束后喊一次：`作战资源释放完成，正在启动引擎…`

**数据来源（推荐顺序）**

1. **`tools/bundle-android.mjs`：`bundle.parts` 加第 4 列 `entries`**（改一行 + 一处计数）：
   ```js
   // 在写完每片之后数一次（python 侧已有 zipfile，或写完后用 python 读一次 len(zf.infolist())）
   return `${path.basename(j.target)}\t${fs.statSync(j.target).size}\t${h}\t${entries}`;
   ```
   Kotlin 端按「3 列或 4 列都接受」解析，**老包（3 列）照样能显示 MB，只是没有文件数**。
2. **回退：`assets.openFd()` + 迷你 EOCD 读取器**（约 60 行，ZIP64 判到就放弃），只在 `bundle.parts` 缺 `entries` 时用。它同时能给出「解压后字节」，可用于更精确的「预计释放 1.8 GB」提示。
3. **再回退**：维持今天的文案 `正在解压游戏运行环境与资源… (i/n)`（业主真机上是可用的，只是信息少）。

**Kotlin 侧骨架**（示意，不落地）：

```kotlin
private data class PartInfo(val name: String, val bytes: Long, val entries: Int?)

/** `bundle.parts`: `<name>\t<bytes>\t<sha256>[\t<entries>]`; unparsable lines are skipped. */
private fun readParts(context: Context): Map<String, PartInfo>

fun ensureAssetsExtracted(context: Context, onProgress: (String) -> Unit): Boolean {
    …
    val parts = readParts(context)                 // name → PartInfo
    val partNames = context.assets.list("")
        ?.filter { Regex("^app_bundle\\.part\\d+\\.zip$").matches(it) }?.sorted() ?: emptyList()
    for ((index, name) in partNames.withIndex()) {
        val info = parts[name]
        val mb = info?.let { String.format(Locale.ROOT, "%,d", it.bytes / 1048576) }
        val files = info?.entries?.let { String.format(Locale.ROOT, "%,d", it) }
        onProgress(
            if (mb != null && files != null) "正在解压素材包 ${index + 1}/${partNames.size}（第 ${index + 1} 个包 · $mb MB · $files 个文件）"
            else "正在解压游戏运行环境与资源… (${index + 1}/${partNames.size})"
        )
        context.assets.open(name).use { stream -> unzip(stream, targetDir, onProgress, info?.entries, last = index == partNames.lastIndex) }
    }
```
`unzip()` 相应的两处改动：`fileCount % 300 == 0` 时用 `info?.entries` 当分母（没有就保持原样）；末尾的「完成」文案加 `if (last)`。

## 1.6 风险

| 风险 | 说明 | 缓解 |
|---|---|---|
| 多读一次 assets | `bundle.parts` 292 B，可忽略；若走 `openFd` 路线要读 EOCD（≤64 KiB/片） | 只在 `entries` 缺列时走 `openFd`；try/catch 全包，任何异常退回旧文案 |
| `bundle.parts` 与实际分片不一致 | 例如手工删了一片 / 旧包残留 | 以 `assets.list("")` 的实际名单为准，清单只当「补充信息」；找不到就回退 |
| 行尾/编码 | 生成端写 `\n`，Kotlin `bufferedReader().useLines` 兼容 `\r\n` | 解析前 `trim()`，跳过空行 |
| 数字本地化 | `String.format` 不指定 Locale 会在阿拉伯语等环境输出不同数字 | 固定 `Locale.ROOT`（或 `Formatter.formatFileSize`，但它是十进制 MB，会显示 1.84 GB，和业主例子不一致） |
| 生成端改动 | 加第 4 列会改 `bundle.parts` 的内容 → `bundle.sha256` 的哈希随之变化（本来就该变） | 版本戳天然变化，正好触发一次重解压；注意这会让**所有**用户首启重新解压一次（3.2 GB） |

## 1.7 验收

1. 真机首启（版本文件不匹配）：`logcat` 里能看到 3 条不同文案，序号递增、MB 与文件数与 1.2 的表一致；第 3 条之后才出现「作战资源释放完成」。
2. 第二次启动：`_bundle_version` 命中 → 一条都不出现，直接 `server_starting`。
3. 删掉 `bundle.parts` 重打包：文案退回 `正在解压游戏运行环境与资源… (i/n)`，不崩。
4. 单片包（`SP_BUNDLE_PARTS` 未开）：沿用 `app_bundle.zip` 分支的旧文案（本次不改那条分支）。
5. 单测/静态检查：本仓无 Android 单测；以 `./gradlew :app:assembleRelease` 通过 + 1 的 logcat 为准。

---

# 二、炸惊局内玩法巡检

## 2.0 判据与复跑

- 主线一：`docs/ZHAJING.md` §四「隔离不变量」I-1…I-12（§4.1-4.12，文档 344-445 行）——它们钉的是**隔离**（官方四档逐字节不变等），局内玩法规则不在这 12 条里，所以下面用「§三 3.3 局内钩子表 + 各模式记录 + 现有测试」作为玩法判据，并把每条落到代码行。
- 主线二：`handoff/ZHAJING-SPLIT-2026-10-28.md` §9.3（三个玩法面）、§12.1（forge）、§13.1/13.2（已验收口径）。
- 复跑（本次全部实跑，输出见附录 A）：

```bash
node test/match/zhajing-e2e.test.js        # 13 pass
node test/match/zhajing-drafts.test.js     # 8 pass
node test/match/zhajing-refresh.test.js    # 6 pass
node test/match/zhajing-mode.test.js       # 25 pass
node test/match/zhajing-room.test.js       # 5 pass
node test/match/zhajing-isolation.test.js  # 54 pass
node test/content/zhajing-bonds.test.js    # 5 pass
node test/content/zj-ops.test.js           # 20 pass
```

数据面（`data/config.json` 的 `mode_single_zhajing`，与 `mode_multi_zhajing` 相同）：

- `economy.benchSize = 20`、`bondLayerCap = 9999`、`lastRound = 14`、`bossRound = 14`、`hiddenRound = 15`
- `jibian = { cards: 3, rerolls: 4, pool: 99, rarityWeights: {normal:35, rare:30, epic:20, legend:10, hidden:5}, noCoreBondLegendWeight: 20 }`
- `spRounds = [1,2,3,6,7,8,9,10,11,12]`，`spPhaseKinds = {1:jibian, 2:express, 3:jibian, 6:jibian, 7:express, 8:jibian, 9:bountyHigh, 10:jibian, 11:bountyHigh, 12:express}`
- `enemyJibian = { enabled: true, rounds: [1,6], rarityWeights: {normal:7, epic:2, legend:1}, flickerMs: 3000, resultMs: 3000, hidden: { enabled: true, label: '隐秘惊变', pool: 10 张 } }`

---

## 2.1 购买干员后的整备区落位（与手牌/已部署区边界）—— **不成立（P1）**

**判据**：炸惊整备区 20 格（`data/config.json` `economy.benchSize=20`；`docs/ZHAJING.md` §3.3 `PlayerState.js` 行「炸惊模拟's 20」），手牌/整备区与战场是两套区域：「买的干员落整备区、只有拖到棋盘才算部署」。

**现状**

| 层 | 文件:行 | 代码事实 |
|---|---|---|
| 服务端（对） | `server/match/PlayerState.js:236` | `this.hand = new Array(this.gd && this.gd.benchSize ? this.gd.benchSize : HAND_SIZE).fill(null)` → 炸惊 20 格 |
| 服务端（对） | `server/match/gamedata.js:502` | `get benchSize() { return posIntOr(this.economy.benchSize, DEFAULTS.benchSize); }`（`DEFAULTS.benchSize = 10`） |
| 服务端（对） | `server/match/invariants.js:65` | `if (ps.hand.length !== gd.benchSize) fail(...)` → 20 格是**硬约束** |
| 服务端（对） | `server/match/player/placement.js:53` | `to.area === 'hand'` 时校验 `to.idx < this.hand.length`（20，正确） |
| 服务端（对） | `server/match/player/pieces.js:82-88` | 落位 = `freeSlot(this.hand)`（20 格里第一个空位），满了才进 `temp` |
| 客户端（**错**） | `shared/constants.js:85` | `HAND_ROW: 7, HAND_SIZE: 10,  // hand slot idx = col 0..9` —— 这是**官方**的 10 格常量（`board` 是 21 列，`shared/constants.js:80`） |
| 客户端（**错**） | `public/js/ui/gameLogic/placement.js:331` | `if (!Number.isInteger(idx) || idx < 0 || idx >= GEO.HAND_SIZE) return no('BAD_TILE', …)` → 客户端**拒绝**把棋子放进第 11–20 格 |
| 客户端（**错**） | `public/js/render/drag.js:56` | `if (row === geo.HAND_ROW && col >= 0 && col < geo.HAND_SIZE) return { area: 'hand', idx: col }` → 只有 col 0–9 能被识别为「放到整备区」 |
| 客户端（**错**） | `public/js/ui/facing.js:240` | 自动找空位 `for (let i = 0; i < GEO.HAND_SIZE; i++) …` → 永远只找 0–9 |
| 客户端（**错**） | `public/js/ui/fallbackField.js:380`、`:547` | 备用渲染器同样 10 格 |
| 客户端（**错**） | `public/js/render/app.js:1325` | `legalTiles` 只对 `i < GEO.HAND_SIZE` 计算整备区可落格（拖动高亮） |
| 客户端（**错**） | `public/js/ui/gameLogic/shop.js:73-76` | `handFull()` = `hand.length >= GEO.HAND_SIZE && hand.every(p => p != null)`：20 格时 `every` 覆盖 20 格 → **前 10 格满了也不算满** |
| 视图（对） | `server/match/player/views.js:96` | `hand: this.hand.map(...)` 发的是**全 20 格** |
| 视图（对） | `server/match/match/views.js:479-480` | 侦察队友时 `for (let i = 0; i < ps.hand.length; i++)` → 也是 20 |
| 渲染坐标 | `public/js/render/drag.js:96` | 整备区棋子的世界坐标 `col = t.idx` → idx 10–19 会画到 **row 7 的 col 10–19**（第 7 行是整备行，右半是镜像区），不是垫片位置 |

**根因**：`GEO.HAND_SIZE` 是「官方 10 格」的常量，被当成了**模式无关**的容量；炸惊把容量改成 20 只改了服务端状态，客户端的**垫片高亮 / 拖放识别 / 自身校验 / 自动落位 / 满仓判定**这 5 处仍读 10（3D 垫片网格由同一批几何常量生成，同样只到 10 列；这一条未在真机复核，属代码判定）。服务端接受第 11–20 格，客户端既画不出也拖不进，于是：
1. 第 11–20 个买到的干员**在界面上消失**（状态里在，`m.private.hand` 里有，UI 没有垫片）；
2. `handFull()` 永远不报满 → 商店继续允许购买，买到的继续往看不见的格子里堆；
3. 队员/观战视图（`match/views.js`）会把这 20 格当单位发给渲染层，但渲染层按 col=idx 画在非垫片位置 → 可能和镜像整备区重叠。

**建议改法**（三选一，按代价排序）

1. **最小闭环（推荐先做）**：让客户端把「整备区容量」当数据读，而不是当常量。
   - 服务端 `player/views.js` 的 private view 增 `benchSize: this.hand.length`（或在 `m.public.meta` 里给一次），客户端 `GEO.HAND_SIZE` 的 5 个读点改成 `priv.benchSize ?? GEO.HAND_SIZE`。
   - 渲染：整备区 pad 由「row7 col0..9」改成「两排 ×10」（新增第二排 `HAND_ROW2`）或「一排 20 格」（需要改 `shared/constants.js` 的 `FIELD`/镜像与相机，代价大、会碰官方模式 → 不推荐）。
2. **折中**：保持 10 格 pad，但第 11–20 格折进「第二排」（纯客户端布局，不碰官方模式的几何常量），拖动/掉落识别改成 `idx % 10` + 行号。
3. **止血**：若短期不改 UI，就把炸惊 `benchSize` 临时调回 10（改 `data/config.json`，属数据域）——**会违背参考包口径**，只能当临时方案。

**风险**：改 `shared/constants.js` 的几何会影响官方四档 / 湮灭（红线：官方 `visibleChess` 与布局逐字节不变）。所以方案 1/2 都必须把新容量**只**在炸惊视图里生效（用 view 字段，不改常量默认值）。

**验收**：
1. 新单测（`test/ui/` 或 `test/match/`）：炸惊 private view 带 `benchSize: 20`；`handFull()` 在 20 格全满时才 true。
2. 真机：炸惊局买 12 个干员 → 12 个都能看到、都能拖回整备区、都能拖上棋盘；第 10 个之后不出现「隐形棋子」。
3. 隔离：`node test/match/zhajing-isolation.test.js` 与官方四档的 `m.private` 逐字节断言仍绿（未选 bans / 非炸惊时 view 不多字段）。

---

## 2.2 惊变（我方）：每回合抽卡数 / 已拥有排除 / 重抽 / 羁绊计数 —— **成立**

| 判据 | 现状（文件:行） | 结论 |
|---|---|---|
| 每个「惊变回合」一手 3 张 | `data/config.json` `jibian.cards = 3`；`server/match/match/spDraft.js:80-82` `const n = …Number(jb.cards) \|\| 3; jibianDraftCards(..., n, exclude, ...)` | ✔ |
| 哪些回合抽 | `spRounds = [1,2,3,6,7,8,9,10,11,12]` + `spPhaseKinds` → 惊变在 **R1/R3/R6/R8/R10 共 5 手**（R2/R7/R12 是快递，R9/R11 是高额悬赏） | ✔（不是「每回合」——每回合抽卡是误解，实际是 5 个指定回合） |
| 每人各抽（不是全场共用） | `spDraft.js:74-86` `_dealJibianFor(ps)`，`s.dealtFor` 记录当前是谁的手牌；`spDraft.js:62` `if (jibian) for (const ps of alive) this.markPrivate(ps)` | ✔ |
| 已拥有排除 | `spDraft.js:78-79` `const exclude = this._jibianOwned(ps); for (const id of jb.claimed \|\| []) exclude.add(id);`；`_jibianOwned` = `ownedJibianIds(ps)`（`spDraft.js:94`）；`ownedJibianIdsOf` 再导出见 `sim/content/index.js:73-81` | ✔（已拥有 + 已被别人选走都排除；只是摆过没选的回池） |
| 重抽次数 | `jibian.rerolls = 4`；`spDraft.js:146-151` `limit = …rerolls`，`used = s.rerolledBy[playerId]`，`if (used.has(idx) \|\| closed \|\| !s.cards[idx]) BAD_TARGET`，`if (limit <= 0 \|\| used.size >= limit) RATE` → **每格一次、每人共 4 次**，错误码契约 `BAD_TARGET / RATE / ALREADY`（`:128-133` 的注释与代码一致） | ✔ |
| 重抽不重复 | `spDraft.js:152-154` 新卡的 exclude = 已拥有 + **当前桌面上的所有卡** | ✔ |
| 非炸惊局发 `g.cardRefresh` | `spDraft.js:140-141` 先判 `gd.zhajing !== true` → `BAD_TARGET`（不会静默接受） | ✔ |
| 惊变羁绊计数 | `data/jibianBonds.json` → `bonds` 数组 **18** 条（每条 `{id,name,tiers,members,effect}`）；`server/sim/content/jibianBonds.js:82-97` `activeBonds(ownedIds)`：按 `members` 命中数 `have` 累加，`tiers`（如 `[2,3]`）是**阈值**不是序号，取最大命中档，支持 `WILD_CARD` 加 1 | ✔（18 条，docs 早期写的 13 条已过时） |
| 无核心盟约的隐藏加权 | `spDraft.js:108-117` `_jibianNoCore(ps)` → `noCoreBondLegendWeight = 20` | ✔ |

**注意**：一套对局里 `cards=3 × 5 手 = 最多 15 张候选`，但 `rerolls=4` 是**整局预算**（`rerolledBy` 按玩家累加，不按手重置）——与「每格一次」叠加后，实际能重抽的格子总数 ≤4。这是符合包内口径的，但客户端文案如果写成「每回合 4 次」就会误导。

---

## 2.3 锻造器：击杀计数 / 精英击杀 / 多档稀有度 / `g.forgeTake` 两次确认 —— **成立，但有一处 fail-open**

| 判据 | 现状（文件:行） | 结论 |
|---|---|---|
| 只在炸惊存在 | `PlayerState.js:280` `this.forge = this.gd && this.gd.zhajing ? { count:0, killsPaid:0, elites:0, forged:{}, roll:null } : null`；所有入口 `if (!this.forge) return` | ✔（官方/湮灭零影响） |
| 击杀计数 | `shared/forgeData.js:19` `FORGE_KILLS_PER = 40`；`acquire.js:395-402` `forgeOnKills()`：`due = floor(stats.kills / 40)`，`gain = due - killsPaid`，幂等 | ✔ |
| 何时结算击杀 | `server/match/match/settle.js:62` `ps.forgeOnKills()`（每回合结算一次） | ✔ |
| 精英击杀 | `acquire.js:120`（三合一把干员变精锐）+ `:145`（原位晋升）各 `this.forgeOnElite()` → `acquire.js:385-389` `elites++` 且给 1 个 | ✔ |
| 多档稀有度 | `shared/forgeData.js:22-27` `FORGE_RARITY = normal 70 / epic 20 / legend 10`；`rollRarity(rng)` 用模式种子流 | ✔ |
| 选项与档位数值 | `shared/forgeData.js:31-52` 9 个选项，`min` 限制出现的最低档（`range` 只 legend、`block` epic 起），每档数值表齐全 | ✔ |
| 两次确认（客户端带 `optId` + `rarity`） | `shared/protocol.js:704` `'g.forgeTake': { optId: isStr(24), rarity ∈ {normal,epic,legend} }`；`match/intents.js:49-52` 显式 `case`；`match/platform.js:146-152` `guard(() => ps.forgeTake(optId, rarity))`；`acquire.js:413-417` 校验选项存在且 `opt.value[rarity]` 存在、`roll.rarity !== rarity → BAD_TARGET`、`!roll.picks.includes(optId) → BAD_TARGET` | ✔（真两次：选项 + 档位都要对上服务端那次 roll） |
| **fail-open 风险** | `acquire.js:415-417` 三处都是 `if (roll && …)`：**`this.forge.roll` 为 null 时，档位与「是否在这手牌里」两条校验整体跳过**。`roll` 只在 `forgeRoll()`（`acquire.js:372-382`，由 `forgeView()` / `privateView` 触发）里惰性抽；`grantForge()`（`:359-365`）不抽。所以「刚拿到锻造器、视图还没推下来」这一帧里，客户端可以发任意 `(optId, rarity)`（只要该档位有值，例如 `range+legend`、`sp+legend`）而必被接受 | ⚠️ 建议改：`forgeTake` 里先 `this.forgeRoll()`，拿不到就 `fail(ERR.RATE, 'no forge left')`，**不要**在 roll 为空时放行 |

**为什么现在没被测试抓到**：`test/match/zhajing-*.test.js` 里 forge 用例都先取过一次视图（`m.private.forge.rolled`），所以 `roll` 恒非空。建议补一条「未取视图直接 `forgeTake`」的用例（期望 RATE/BAD_TARGET，而不是成功）。

**验收**：新用例 `g.forgeTake {optId:'range', rarity:'legend'}` 在**没有**先读视图的玩家上应被拒；现有 `zhajing-e2e` 的 forge 流程仍绿。

---

## 2.4 盟约：层数 / 档位 / `zj` 覆盖 / 禁选 `bans` 是否真影响本局商店

### 2.4.1 禁选 `bans` —— **成立（两层都成立）**

| 判据 | 现状（文件:行） | 结论 |
|---|---|---|
| 房间层：房主/每个真人座位各设自己的禁选 | `server/lobby.js:1222-1262` `setBans`：只在 `mode==='zhajing' && difficulty===ZHAJING` 且未开局；配额来自 `config.bans.ZHAJING`（core 3 / addon 4）；逐条校验 bond 存在、`isCore` 列别正确、数量不超限；结果 `Object.freeze` 后进 `session.bans` 与 `seat.bans` | ✔ |
| 只有炸惊房接受 | `lobby.js:1236` `if (mode !== 'zhajing' \|\| room.difficulty !== ZHAJING_DIFFICULTY) return fail(ERR.BAD_TARGET, 'bans are a ZHAJING option')` | ✔ |
| 传到对局 | `lobby.js:2336`/`2396` 把 `bans` 放进 seat 记录；`PlayerState.js:187-193` 只在 `gd.zhajing && seat.bans` 时收（机器人不可能有），`Object.freeze` 后写 `this.bans` | ✔ |
| **真的影响本局商店** | `player/economy.js:70-82` `_rollChessSlot()`：`const banned = this.banSet(); this.m.pool.roll(this.m.rngShop, { …, ...(banned ? { filter: (cid) => !this.chessBannedByPreselect(cid) } : null) })`；`banSet()`（`:104-109`）空集合 → null；`chessBannedByPreselect`（`:117-123`）「一个棋子的**全部**盟约都被禁 → 不出现，任一盟约还活着 → 照旧出现」＝官方 `pool.js:32 drawDisabledBonds` 的同一规则 | ✔ |
| 没选禁选时逐字节不变 | 同上：`banned === null` 时 options 对象**不新增 `filter` 键**（`:79` 用 spread 条件插入） | ✔ |
| mode 级随机禁（另一层，仍在） | `Match.js:494-498` `drawDisabledBonds(gd, rngSetup)` → `SharedPool({banned})`；`pool.js:32-49` 按 `gd.bans(difficulty)` 抽 D 集合 | ✔ |

**唯一要留意的**：禁选**只过滤棋子**（`_rollChessSlot`），不过滤道具（`_rollItemSlot`，`economy.js:84-97`）与自选件（`diyRollEntries`）。这与「禁选的是盟约 → 影响以盟约为聚合单位的棋子池」的设计一致；如果业主期望「连道具也不出相关盟约」，那是一条**新需求**，不是 bug。

**验收**：`test/match/zhajing-room.test.js`（5 条）覆盖配额/列别/开局后拒绝；建议补一条对局内断言：给某玩家 3 个核心禁选后，其商店 roll 里不再出现「所有盟约都在禁选集」的棋子，而**队友**的商店不受影响（`test/match/zhajing-*.test.js` 里目前没有这条 exact 断言）。

### 2.4.2 层上限 9999（规则1）—— **不成立（P1，静默）**

**判据**：`data/config.json` `modes[*].bondLayerCap = 9999`；参考包「规则1：盟约层数上限 9999」。

**现状**

| 层 | 文件:行 | 事实 |
|---|---|---|
| 数据 + 访问器 | `gamedata.js:679` `get bondLayerCap() { return this.zhajing ? posIntOr(this.mode.bondLayerCap, null) : null; }`；`gamedata.js:830-838` `zhajingFlags()` 把 `bondLayerCap` 放进战斗 flags | ✔ 数据通了 |
| 战斗内（sim） | `server/sim/battle/economy.js:52` `const modeCap = …flags.bondLayerCap`；`:53` `if (!uncap && !(layerGainRoom(live, Infinity) > 0)) return 0;`；`:58` `if (!uncap && Number.isFinite(modeCap) && modeCap > 0) add = Math.max(0, Math.min(add, modeCap - live));` | **✘ 短路在前**：`layerGainRoom` 用的是全局 `BOND_LAYER_CAP = 999`（`shared/constants.js:118`），层数到 999 时 `layerGainRoom(live, Infinity) === 0` → `:53` 直接 `return 0`，**永远走不到 `:58` 的 modeCap**。所以炸惊在战斗内也叠不到 9999 |
| match 侧（回合结束结算） | `server/match/match/settle.js:82` `const add = this.gd.annihilation && this.gd.unlimitedLayers ? Math.floor(n) : layerGainRoom(before, Math.floor(n));` | **✘ 没有 `bondLayerCap` 分支**（文档 §3.3 标 ⏳ 的那一条没落地） |
| match 侧（整备期加层） | `server/match/player/economy.js:49` 同一行的复制 | **✘ 同上** |
| 不变量 | `server/match/invariants.js:27` `import { PHASE, BOND_LAYER_CAP }`，`:20`/`:75` 用全局 999 判 | ✘ 用 999 判据，所以**永不报错**（这也是它一直静默的原因） |
| 进程级抬升（另一条路） | `shared/constants.js:123-137` `setBondLayerCap` 的注释说「超限局在 Match 构造时把这里抬到 9999」；`match/platform.js:381` 只负责恢复；`public/js/battle/simWorkerRuntime.js:53` 浏览器侧按 cap 抬 | ⚠️ 只有**超限**走这条路；炸惊没有调用 setBondLayerCap（全仓只有 platform 的恢复与 worker 的设置），而且文档明确警告「不要用全局开关」（会抬高同进程里的普通房） |

**根因**：规则1 只做到「把 9999 放进 flags」，三处实际写层的地方（sim `addLayers`、settle、player `addLayers`）都还以全局 999 为闸，且**闸在 cap 判断之前**；invariants 也仍按 999 判，导致「违反规则」这件事没有任何红灯。

**建议改法**（最小、不碰全局开关）

1. `server/sim/battle/economy.js`：把 `modeCap` 判断**放到** `layerGainRoom` 短路之前，语义改成「有效上限 = `min(全局 cap, modeCap ?? ∞)`」，例如：
   ```js
   const modeCap = Number(this.flags && this.flags.bondLayerCap) > 0 ? Number(this.flags.bondLayerCap) : Infinity;
   const cap = Math.min(BOND_LAYER_CAP_EFFECTIVE(), modeCap);   // 需要一个读取当前生效上限的访问器
   if (!uncap && live >= cap) return 0;
   let add = uncap ? Math.max(0, Math.floor(ctx.n)) : Math.min(layerGainRoom(live, ctx.n), cap - live);
   ```
   注意 `layerGainRoom` 是纯函数、被 serve/sim 两侧共用，别改它的签名（会碰官方模式）。
2. `server/match/match/settle.js:82` 与 `server/match/player/economy.js:49`：加一支 `const cap = this.gd.bondLayerCap; if (cap) add = Math.max(0, Math.min(n, cap - before)); else add = layerGainRoom(...)`（文档 §3.3 原本就是这么写的）。
3. `server/match/invariants.js`：上限判据改成 `Math.min(BOND_LAYER_CAP, gd.bondLayerCap ?? Infinity)`（否则改完 1/2 后不变量会立刻误报）。
4. 视图：`player/round.js` 的 `bondsView` 若按全局 cap 夹，也要同步（`:138` 附近）。

**风险**：`sim/` 是浏览器与服务器共用的纯 ESM，`BOND_LAYER_CAP` 是模块级可变值（`setBondLayerCap`）；如果实现里读它而不是读传入的 `flags`，会重蹈「同进程串味」。改动必须**只**读 `flags.bondLayerCap` 与常量默认值，不调用 `setBondLayerCap`。golden 零位移（普通模式 flags 里没有 `bondLayerCap` → 分支死）。

**验收**：
1. 新单测：炸惊局把某盟约叠到 1000（`g.test` 或直接 `addLayers`）→ 层数 = 1000（今天会是 999）。
2. `node test/match/zhajing-isolation.test.js` 与官方四档 golden 仍绿。
3. `invariants` 在炸惊局 1000 层时不报错、在 10000 层时报错。

### 2.4.3 档位 / `zj` 覆盖 —— **成立**

- `zj` 记录覆盖：`sim/Battle.js:111` `this.zj = zjViewFor(this.modeId)`，`content/support/index.js:62-74` 模块级 `ZJ` + `withZjView` 栈式还原，`bondRecord` 走 `own((ZJ && ZJ.bonds) || gameData().bonds, id)` → 盟约数值按炸惊覆盖读；`lifecycle.js:73` 的 `step()` 整体包在 `withZjView` 里（否则战斗中读回基础记录）。
- 档位（tiers）：盟约档位是 `data/bonds.json` 的 `tiers`/`layers` 阈值，与炸惊覆盖同一套 `computeBonds`；`jibianBonds.js` 的 `tiers` 是惊变羁绊的阈值（见 2.2），两者不混。
- 组合盟约：`content/support/index.js:295` 的 `equipComboBonds(items, ZJ.combos)`（炸惊专属配对，如「护盾无人机 + 变形同构体 → 企鹅物流」）。

---

## 2.5 敌方惊变：R1/R6 抽取 / 整局累计 / 揭晓 / 隐秘惊变 R15 —— **成立**

| 判据 | 现状（文件:行） | 结论 |
|---|---|---|
| R1/R6 各抽 1 张 | `data/config.json` `enemyJibian.rounds = [1,6]`；`phases.js:509-534` `drawEnemyJibian(round)`：`if (!ej.rounds.includes(round)) return null` | ✔ |
| 只抽一次（幂等） | `phases.js:513-515` `enemyJibianRoundsDone` 集合 + `has(round)` 早退 | ✔ |
| 档位权重 | `phases.js:516-519` 先 `weightedPick(rngWaves, ej.rarityWeights)`（normal 7 / epic 2 / legend 1）再在该档 pool 里均匀取；档位为空则整池兜底 | ✔ |
| 整局累计、每份战斗都带 | `phases.js:523-530` 追加进 `enemyJibianCards` + `enemyJibianList`；战斗 spec 的 flags 都 spread 了 `{ enemyJibian: …slice() }`：`match/combat.js:115`、`match/bossRounds.js:152`、`match/unitePhase.js:68`、`match/intents.js:160`（重放/侦察）、`bot.js:1348` | ✔ |
| 揭晓（不提前泄露） | `phases.js:531` `this.enemyJibian = { round, rarity, card }` + `markPublic()`；`match/views.js:257` 把 `enemyJibianList` 全量给客户端（带 `round/rarity/hidden`）；`config.enemyJibian.flickerMs/resultMs = 3000/3000` | ✔（翻牌时长在数据里，客户端按它演） |
| 本回合战斗计划 | `phases.js:335-336` `matchJibianPlan(this.rngWaves, r, this.enemyJibianCards)` → 出怪表；`phases.js:361`/`:447` 传给 `buildNormalWave`/`buildBossWave` | ✔ |
| 隐秘惊变 R15 | `phases.js:330-332` 每回合 `startRound` 先 `drawEnemyJibian(r)` 再 `drawHiddenJibian(r)`；`phases.js:550-596`：`r !== gd.hiddenRound` 早退（炸惊 15）→ 保底 1 张 `hidden` 池（10 张）+ 1 张普通池 → 两张都进 `enemyJibianCards`/`enemyJibianList`（`hidden: true`）→ `applyHiddenMatchCards(this, [guarantee.id])` 立刻改 match 侧（打响指把每层盟约砍半、诛伏赐死清零），不新增 PHASE | ✔ |
| 其它模式零影响 | 每个入口第一行 `if (!this.gd.zhajing) return null`；`enemyJibian()` 访问器在非炸惊返回 null；flags 里没有 `enemyJibian` 键（空数组时不 spread） | ✔（`zhajing-isolation` 54 条覆盖） |

**留意**：`drawHiddenJibian` 的 `record(ordinary, false)` 把「同一回合的普通卡」也标成非 hidden，而 `this.enemyJibian` 只保留 guarantee —— 客户端若按 `m.public.enemyJibian.card` 演「这一轮的敌人惊变」，会**只看到隐秘那张**，普通那张只在 `enemyJibianList` 里。这是设计取舍（`hiddenResultMs` 演完再揭普通卡），但如果业主期望两张同屏，需要客户端读 `list` 而不是 `enemyJibian`。

---

## 2.6 隔离不变量（I-1…I-12）与本次巡检的关系

- 这 12 条钉的是**隔离**（官方四档 `visibleChess`/`shopItemsByTier`/`bandIds`/盟约记录/`m.publicView()` 无 zj 键/`data/versions/*` 无 zj/池子只含 zj/内容域装上/`allyScale` 只改炸惊/`effectsMeta` 放行 `jibian`/golden 零位移），**不含**上面的玩法规则。本次实跑 `zhajing-isolation`（54 条）+ `zhajing-mode`（25 条）全绿，说明隔离面成立。
- 与玩法相关的两条新增证据（本次读到的代码位置）：`effectsMeta.js:79` 的 `KEY_RE` 已含 `jibian`（漏了会让 99 张卡的整备侧静默失效）；`sim/content/index.js:58` 的 `DOMAIN_NAMES` 已含 `jibian`/`ejibian`/`jibianBonds`。

---

# 三、问题清单（按严重度，建议照这个顺序处理）

| # | 问题 | 位置 | 影响 | 建议 |
|---|---|---|---|---|
| 1 | 炸惊整备区 20 格 vs 客户端 10 格 | `shared/constants.js:85` + `public/js` 5 处（见 2.1） | 第 11–20 个干员隐形、拖不进、`handFull` 不报满 | private view 出 `benchSize`；客户端 5 处改读它；pad 改两排 |
| 2 | 盟约层上限 9999 未生效 | `sim/battle/economy.js:52` 短路顺序 + `settle.js:82` / `player/economy.js:49` 无分支 + `invariants.js:75` 用 999 | 规则1 不符，且完全静默 | 3 处按 `flags.bondLayerCap` 取 min，不碰全局 `setBondLayerCap` |
| 3 | `g.forgeTake` roll 为空时 fail-open | `player/acquire.js:415-417` | 可绕过「档位/这一手」校验 | `forgeTake` 内先 `forgeRoll()`，空则 RATE |
| 4 | 启动文案信息量/分片「完成」重复 | `AssetManagerHelper.kt:69`/`:134`/`:141` | 首启体验差，长解压期看起来卡死 | `bundle.parts` 加 entries 列 + 每片一条文案 + 只最后一次喊完成 |
| 5 | 远程模式/预取不显示解压进度 | `MainActivity.kt:222`、`:638`（空 lambda） | 远程模式首启无反馈 | 两处改成传 `tvLoadingStatus` 的 lambda（或明确设计为静默并在文档里写清） |
| 6 | 敌方隐秘惊变的「普通卡」不进 `m.public.enemyJibian` | `phases.js:588-591` | 客户端只演隐秘那张 | 若要同屏，客户端读 `enemyJibianList`（数据已给全） |

---

# 附录 A：本次实跑输出

```
node test/match/zhajing-e2e.test.js        → ℹ tests 13 | ℹ pass 13 | ℹ fail 0
node test/match/zhajing-drafts.test.js     → ℹ tests 8  | ℹ pass 8  | ℹ fail 0
node test/match/zhajing-refresh.test.js    → ℹ tests 6  | ℹ pass 6  | ℹ fail 0
node test/match/zhajing-mode.test.js       → ℹ tests 25 | ℹ pass 25 | ℹ fail 0
node test/match/zhajing-room.test.js       → ℹ tests 5  | ℹ pass 5  | ℹ fail 0
node test/match/zhajing-isolation.test.js  → ℹ tests 54 | ℹ pass 54 | ℹ fail 0
node test/content/zhajing-bonds.test.js    → ℹ tests 5  | ℹ pass 5  | ℹ fail 0
node test/content/zj-ops.test.js           → ℹ tests 20 | ℹ pass 20 | ℹ fail 0
```

# 附录 B：量分片文件数的只读方式（复跑用）

```powershell
Add-Type -AssemblyName System.IO.Compression.FileSystem
foreach ($p in 'app_bundle.part01.zip','app_bundle.part02.zip','app_bundle.part03.zip') {
  $z = [System.IO.Compression.ZipFile]::OpenRead((Resolve-Path "android\app\src\main\assets\$p"))
  "{0}: entries={1} uncompressed={2}" -f $p, $z.Entries.Count, (($z.Entries | Measure-Object Length -Sum).Sum)
  $z.Dispose()
}
```

# 附录 C：本次未做的（明确边界）

- 没有改任何 Kotlin / JS / 数据 / 测试；没有跑真机、没有起服务端、没有跑 `gradlew`。
- `android/app/build/outputs/apk/release/app-release.apk` 在调查期间**正被另一个会话重打包**（两次读到 3,255,463,661 B 与 891,312,011 B），所以本报告不引用 APK 内的压缩属性；`noCompress` 的结论来自 `android/app/build.gradle:88-89` 源码。
- `forge` 的 9 个选项数值、稀有度权重来自 `shared/forgeData.js` 的注释与常量，未做逐档数值的运行时抽样。
- 隔离子句（I-1…I-12）本身未逐条重跑 CLI（`devtools/check-zhajing-isolation.mjs` 需起服务端/Chrome）；以 `zhajing-isolation.test.js` 54 条替代。

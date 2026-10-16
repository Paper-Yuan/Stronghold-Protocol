# 把本仓库（0.2.6 fork）的功能迁移到上游 v0.3.0 底座

> 自动生成自 `git ls-tree 2bed2e7f`（本仓库最后一个提交）与当前工作树：**在本仓库存在、上游没有、且当前无人 import** 的模块。
> 这些就是「合并时取上游实现」导致断线的自有功能，需要重新接线到 0.3.0 的架构上。

## A 远程 mod 拉取 / CDN（边缘 + 服务端 + 客户端）（19）

- `functions/assets/[[path]].js`
- `functions/mods/[[path]].js`
- `functions/workshop/[[path]].js`
- `functions/ws.js`
- `public/js/mods/align.js`
- `public/js/resources/cacheHint.js`
- `public/js/resources/entry.js`
- `public/js/resources/profiles.js`
- `public/js/resources/service.js`
- `public/js/ui/modManagerModal.js`
- `public/resource-sw.js`
- `server/http/customStatic.js`
- `server/http/mods.js`
- `server/modDispatch.js`
- `server/modRegistry.js`
- `server/roomAssets.js`
- `server/roomPack.js`
- `server/workshop-watcher.js`
- `shared/modSurface.js`

## B 皮肤 / 语音（5）

- `public/js/ui/roomVoice.js`
- `public/js/ui/skinPicker.js`
- `public/js/ui/voicePicker.js  [已不存在]`
- `public/voice-widget.js`
- `server/roomVoice.js`

## C 聊天 / 语音房（3）

- `public/chat-widget.js`
- `public/js/ui/chatBox.js`
- `public/js/ui/roomChat.js`

## D 管理端 / 运维（4）

- `public/admin/admin.js`
- `public/js/ui/announcement.js`
- `server/admin.js`
- `server/publicApi.js`

## E 客户端 UI / 资源加载（13）

- `public/fullscreen-guide.js`
- `public/js/battle/aiDanmakuEvents.js`
- `public/js/battle/damageStats.js`
- `public/js/ui/damagePanel.js`
- `public/js/ui/dpsPanel.js`
- `public/js/ui/hubCarousel.js`
- `public/js/ui/hubSections.js`
- `public/js/ui/pickAnyOverlay.js`
- `public/js/ui/preloadModal.js`
- `public/js/ui/screenFit.js`
- `public/js/ui/seatArt.js`
- `public/js/ui/serverPicker.js`
- `public/js/ui/settingsPolish.js`

## F 其他（1）

- `shared/formProjection.js`

---

## 数据层：**不要**用合并后的 `tools/build-data.mjs` 重生成 `data/`（重要）

合并时 `tools/build-data.mjs` 的 6 处冲突取了**上游版**。上游的生成器**产不出本仓库的内容**：

| 文件 | 本仓库提交版 | 上游生成器产出 |
|---|---|---|
| `data/config.json` | 106 KB / 4525 行 | 61 KB / 1 行 |
| `data/tokens.json` | 244 KB / 9900 行 | 119 KB / 1 行 |
| `data/backups.json` | 2.06 MB | 1.60 MB（本仓库的 DIY 人选 `clemnt` 等消失） |

实测后果：跑一次 `node tools/build-data.mjs` 会让 **35 个本仓库内容用例变红**
（`op_clemnt` 25、`kits_layout`、`new-modules-023`、`diy`、`golden` …），并触发 golden 硬规则。

**当前状态**：`data/{config,tokens,chess,backups,bonds}.json` 保持**本仓库内容**；`test/data.test.js` 的 2 个失败是
**本仓库既有的**（提交的数据是手工整理过的，而两版生成器都写紧凑 JSON，`offline rebuild` 那条一直红）。

**要真正修好**：把本仓库 `build-data.mjs` 相对基线新增的 118 行（它比上游版短 689 行、但输出更多字段）
与上游版逐块合并 —— 在两个生成器合并之前，`data/` 只能视为**手工数据**，任何重生成都会破坏内容。

---

## 待决：AI 队友弹幕（`public/js/battle/aiDanmakuEvents.js`）

* 这个 405 行的模块（AI 队友在你漏怪 / 联防成功 / 羁绊叠层时发言）**没有任何文件 import 它**，功能未接线；
  它反过来 import `store.pushChatMessage`（本轮的聊天链路已经通了）。
* `test/ui/ai-danmaku-events.test.js` 期望这些话进 `store.chatMessages`，但 `emitDanmaku()` 的默认是
  `chat = false`（注释写明「只作为纯弹幕飘屏展示，不存储在对话框中」），且**没有任何调用点传 `chat: true`** →
  两个用例失败。这两个文件与合并前逐字节一致，所以是**本仓库既有**的矛盾。
* 要接线必须先定：AI 的话进不进聊天记录？（进 = 测试通过、聊天面板会混入 AI 台词；不进 = 改测试）。

---

## 客户端模组缓存：服务端这一面已就绪，客户端接线待做（Phase C 下半）

**服务端（本轮完成，已实测）**

| 面 | URL | 状态 |
|---|---|---|
| 模组目录 | `GET /mods/catalog.json` | 200，66 KB，列出每个包与其每个文件的 sha256 |
| 包文件 | `GET /mods/file/<pack>/<path>` | 200（`server/http/mods.js`；`sync.js` 的 `fileUrl()`） |
| 房间数据面 | `GET /room-data/<digest>/<name>.json` | 200（本轮新增，`server/http/workshopServe.js`） |

`/room-data/` 的语义（W-B）：**只有真的被某个房间声明过的摘要**才作答（`createRoomAssets.byDigest` 的登记来自
`create`/`setMods` 的 `forRoom`），文件名白名单就是 `DATA_FILES`；未登记摘要 / 未登记文件名 / 非法摘要一律 404。
实测：`/room-data/vanilla/chess.json` → 266 棋子；真实房间摘要 → **276**（官方 + ave-mujica）；`/data/chess.json` 仍是 266。

**客户端（待接线；三个模块都在，但没有任何文件 import 它们）**

1. `public/js/mods/store.js`（305 行）—— OPFS / IndexedDB / 内存三级后端，键 `mods/<pack>/<path>`。
2. `public/js/mods/sync.js`（307 行）—— 拉 `/mods/catalog.json`、比哈希、按并发/重试/超时下载缺的文件，
   `modDigest`/`modManifestDigest`/`sha256Hex` 校验。
3. `public/js/mods/align.js`（151 行）—— `roomDataBase(mods, welcomeMods)`：房间声明了集合就返回 `/room-data/<摘要>/`，
   否则 `/data/`（普通房间逐字节不变）。

接线点（已探明）：
  * `public/js/data.js` 的 `createDataStore({ base = '/data/' })` —— base 可注入，换面就靠它；
  * 对局侧要把**房间那一份**数据喂给 sim（`/sim/simdata.js` 的 `setSimData`），不只是 UI 的 store；
  * 浏览器的 kit 执行还需要 `@kit/` / `@sim/` 的解析 —— 服务端现在是**改写后**再给浏览器（`rewriteKitImports`），
    而 `shared/kitImports.js` 的 `kitImportMap()` **没有任何消费者**；从缓存里跑包字节这条路要先把这一环定下来。

---

## 剩余测试失败的定性（方法：把同一个套件放到本仓库 `2bed2e7f` 的 worktree 上跑）

全量基线：**7820 用例 / 7733 通过 / 62 失败**（第 5 轮是 65）。逐簇定性结果：

| 套件 | 处数 | 结论 | 依据 |
|---|---|---|---|
| `match/community-round30` | 7 | **本仓库既有** | 在本仓库树上同样 6+1 失败 |
| `ui/playtest5-ui` | 3 | **本仓库既有** | 在本仓库树上同样 3 失败 |
| `match/plugin-host` | 3 | 负载抖动 | 单独跑 7/7 |
| `lobby`（GRACE 回放） | 1 | 负载抖动 | 与 `golden` 并发时抖动；HEAD~1 同样 |
| `data.test` | 2 | **合并造成** | 在本仓库树上 **28 通过 / 0 失败** |
| 其余 ~46 | — | 既有门与既有差异 | 见下 |

### 更正第 5 轮的判断：本仓库的数据**就是**它自己生成器的产出

在本仓库树上 `test/data.test.js` 全过（含 "offline rebuild reproduces data/ byte-for-byte"）。所以第 5 轮我写的
「提交的数据是手工整理过的」是**错的** —— 真相是：**本仓库的生成器**（`tools/build-data.mjs`，比上游版短 689 行
但输出更多字段）产出这份数据；合并时那个文件的 6 处冲突取了上游版，于是「数据对不上生成器」。
**把本仓库的生成器 hunk 并回来，`data/` 就能重新生成**，那 2 个失败与「不敢重生成」的限制一起消失。

### 本轮的回归与修复（重要教训）

客户端 kit 注入把 `InPageSimHost.start` 改成了 `async`，而 runner / 工人线程 / runner 测试都是**建完立刻同步读**
`host.battle` → `Cannot read properties of null (reading allyUnits)`，一次全量里多出 **36 处失败**（`runner` 12、
`runner-pending` 14、`feedback1-runner-forms` 10 …）。修复：`start` 恢复同步，kit 表由**已经是异步的调用方**先 await
好再传进 `opts`（页面 `runner.js`、工人线程 `simWorkerRuntime.js`；排练 worker 本来就是先解析后建候选）。该 6 个套件
回到 67/67。

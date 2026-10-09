# 修复版（v0.2.1-fusion 修复包）改动评审与部署建议

## 0. 证据位置、被评审对象、行号约定

**证据根目录：`E:\Workbox\fix-release-analysis\`**（下称「分析目录」）——本文所有引用都相对它：

| 路径 | 内容 |
|---|---|
| `fix/` | 修复版 4 个文件的**改动后全文**（`server/matchmaking.js`、`server/lobby.js`、`public/js/render/app.js`、`public/js/ui/facingWheel.js`） |
| `prev/` | 上一版同名 4 文件的**改动前全文** |
| `diffs/01-server-matchmaking.diff` … `04-facingWheel.diff` | old→new 的 unified diff |
| `probes/click-lag-probe{,2,3}.tmp.mjs` | 修复包新增的 3 个探针脚本 |
| `SCOPE.md`、`BRANCH_STATE.md` | 范围与方法、分支状态取证 |

**被评审包**：`C:\Users\J1825\Downloads\stronghold-v0.2.1-fusion-server-release 修复版.zip`
（625,583,575 字节，sha256 `c8ca4e230c9a9dd3646b38bf3d93aa8e44b5e86d7760d47c2fc84ec77f9d634b`，
包内 `package.json` = `stronghold-protocol-alliance@0.2.1-fusion`，打包时间 2026-10-09 08:10）。
**参照包**：`E:\Workbox\Stronghold-Protocol-v0.2.1-Server.zip`（599,841,618 字节，md5 `e1094db7211d6ecacb235a36b0633f39`）。

**解包副本**（本次实跑用的树）：`%TEMP%\zf\` = 修复版解包，`%TEMP%\oldrel\` = 上一版解包，`%TEMP%\vendorchk2\pixi.min.js` = 包内 vendored Pixi。
`%TEMP%\mm-harness.mjs`、`%TEMP%\mm-idle.mjs` = 撮合场景/空转定时器桩脚本。

**「开发分支」**：`E:\Workbox\sp-upgrade-2.1` 工作树，分支 `feature/v0.2.1-fusion-master`，HEAD `0f52a0b6`（本次 `git rev-parse HEAD` 实测）。修复包是它的一个**离线补丁分支**：源码基线是提交 `728bf350`，改动没进分支。

**行号约定**：`fix/x:12` = 分析目录 `fix/x` 第 12 行；`prev/x:12` 同理；`包内 p:12` = `%TEMP%\zf\p` 第 12 行（客户端文件不在 `fix/` 里，只能引用解包树）；分支文件写 `分支 p:12`。

## 1. 结论

**这是 5 项互不相关的修补；其中 4 项在开发分支里完全不存在，照它部署能生效，但重新从分支打包会全部丢失。**

- 5 项 = ① 撮合队列排空后停表；② 进房/加入/观战停发 `lobby.stats`；③ 房间列表 `maxSeats` 由 10 改 `MAX_SEATS`（=4）；④ 备战期帧率由不封顶改封 120；⑤ 朝向轮跟随循环由每帧 rAF 改 ~30Hz。
- 只有 ④ 在分支里已存在（`分支 public/js/render/app.js:586` 的 `return 120`）；①②③⑤ 分支里没有，`BRANCH_STATE.md` 本身也已过时（它记 HEAD `83d6a233`，实为 `0f52a0b6`）。
- **最重要的建议：可以照它部署，但必须先把 ①②③⑤ 搬回分支并提交**，否则下次从分支打包，这次修的东西全没了；且**不要把「高刷点击延迟已解决」写进发布说明**——本次没有任何运行期证据（第 5 节）。

## 2. 「高刷显示器点击延迟」这个分组从哪来

它不是本文的归纳，也不是仓库里的正式文档：全仓 `grep -rn "点击延迟|click lag|click-lag|输入延迟|input lag" docs/ *.md` **只命中本文档自身**。可追溯的来源有三处：

1. 本次评审材料把 ①②④⑤ 描述为「被放进本次发布包的『高刷显示器点击延迟』修复组」；
2. 修复包新增探针的头部注释：`probes/click-lag-probe.tmp.mjs:1-2`「measures main-thread long tasks + click input delays」；
3. 仓库里最接近的成文条目是 `docs/OPTIMIZATION_AND_PR_PLAN.md:120-137` §2.3.6「高帧率模式设置修复与 60/120 帧上限锁定」（对应 ④）。注意 §2.3.5（:110-118）讲的是「二段式调向」交互，**不是** ⑤ 的 30Hz 改动；①③ 该文档未提。

即：分组标签只存在于分析材料和探针命名里，没有一份可引用的 scope/发布说明定义它包含哪几项。发布说明 `RELEASE_NOTES_v0.2.1.md` 只写了 DIY 修复与打包产物，**没有**点击延迟相关表述。

## 3. 逐文件

### ① `server/matchmaking.js` —— 队列排空后停表（低风险）

- **改了什么**（三处，与 `diffs/01-server-matchmaking.diff` 唯一 hunk `@@ -269,50 +269,53 @@` 对应）：
  1. 删 `prev/server/matchmaking.js:272` 的 `if (this.queue.size === 0) return;`（diff 第 7 行）；
  2. 新增 `fix/server/matchmaking.js:273` 的 `if (this.queue.size > 0) {` 包裹分桶逻辑（diff 第 25 行）；
  3. 新增 `fix/server/matchmaking.js:318` 的 `if (this.queue.size === 0 && this.roomQueue.size === 0) this.stop();`（diff 第 90 行）。
- **解决什么问题**：旧版全文无任何 `this.stop()` 调用，只要发生过一次入队，1 秒定时器永久空转。
- **机制**：`stop()` `clearInterval` 并置 `running=false`（`fix/server/matchmaking.js:45-53`）；下次 `enqueue` 调 `start()` 重新装表（:38-43，调用点 :90/:106）。
- **风险（低）**：停表只挂在 `tick()` 末尾，`dequeue/removePlayer/clearQueue/cancelRoomQueue` 清空路径不直接停表，「两队列已空但表还装着」最多再存在 1 个 tick（≤1s），会自愈。**它不治点击延迟**（第 2 节）。另注：`stop()` 除 `clearInterval` 外还会 `this.queue.clear(); this.roomQueue.clear();`，调用点在 `size===0` 之后故无副作用。
- **本次实跑证据**：`node %TEMP%\mm-harness.mjs` → 11 条快照差分中 6 条仅 `running/timerArmed` 由 `true→false`，其余字段两版全同；`S3_roomQueued` 与 `S6_beforeScatter` 保持 `running:true`（未过度停表）；`S2_afterDequeue` 两版均 `running:true,timerArmed:true`（队列已空但还没到下一次 tick，印证「晚 1 个 tick」）。`node %TEMP%\mm-idle.mjs` → `OLD {running:true,timerArmed:true,nowCallsAfterDrain:3,broadcastsAfterDrain:0}` / `NEW {...,nowCallsAfterDrain:0,...}`（3.2s 窗口；`nowCalls` 是 `lobby.now()` 调用数，tick 每次恰调一次，属代理指标）。

### ② `server/lobby.js` —— 停发大厅广播 + maxSeats（中风险）

- **改了什么**：`create`/`join`/`spectate` 各加 `session.wantsLobbyStats = false;`（`fix/server/lobby.js:517`/`:542`/`:659`；diff 第 8/17/35 行）；房间列表 `maxSeats: 10` → `MAX_SEATS`（`fix/server/lobby.js:578`；diff 第 25-26 行）。4 个 hunk（`diffs/02-server-lobby.diff:3,12,21,30`）。
- **解决什么问题**：服务端每 4 秒把整个房间列表推给 `wantsLobbyStats` 为真的会话；玩家进房后客户端已切到房间屏，不再渲染大厅列表，这份推送是纯无用流量 + 主线程 JSON 解析。`maxSeats=10` 会把 4 座位的房间显示成「2 / 10」（`包内 public/js/screens/lobby.js:329` 用 `${r.humans} / ${r.maxSeats || 10}`）。
- **机制**：把「是否要大厅推送」从客户端请求标记（`match.queue`/`room.list` 置真，`fix/server/lobby.js:359`/`:361`）改为入房时服务端主动撤销；广播循环按该标志过滤（`fix/server/lobby.js:602`）。`MAX_SEATS=4` 见 `包内 shared/constants.js:8`。
- **风险（中）**：
  - **确定性漏洞（静态读码可复现）**：房间屏「匹配队友」按钮（仅房主可见，`包内 public/js/screens/room.js:333`）发 `match.queue`，`fix/server/lobby.js:359` 无条件先置真再入队，而房内分支对房主返回 `ok` 且**不会**重新走 `create/join`（`fix/server/matchmaking.js:67-93`；补人只把散人 join 进来，:228-248）。`startMatch/onMatchEnd/removeMember` 都不重置 → 房主点过一次后，在本房间（含整场对局）持续收到 4 秒一次的列表。
  - **进房窗口竞态**：`room.list` 是每 4 秒（匹配弹窗，`包内 public/js/screens/lobby.js:276`）和每 6 秒（大厅屏，:433）轮询的，若某次请求在 `room.join/create` 之后才到达服务端，会把标记重新置真，此后整场对局恢复接收广播。
  - **出房侧未处理**：离房不恢复标记，靠客户端大厅屏挂载时立即 poll 一次 `room.list`（`包内 public/js/screens/lobby.js:426,432`）自愈。
- **本次实跑证据**：`grep -n "wantsLobbyStats\|maxSeats"`（分析目录）→ fix 侧恰 6 处（359/361 置真、602 读取、517/542/659 置假），prev 侧仅 359/361/598 且 `maxSeats: 10`；`diff -u prev/server/lobby.js fix/server/lobby.js | grep -c '^@@'` = **4**。

### ③ 同文件 `maxSeats`（并入 ②，独立列因它是唯一纯 UI 数据修正）

- **改了什么/机制/风险**：见 ②。房间列表 `maxSeats` 从写死 10 改为 `MAX_SEATS=4`，与 `Room.seats` 分配长度一致（`fix/server/lobby.js:163` 用 `MAX_SEATS`）。**低风险**，无副作用；客户端回退值 `|| 10` 不再被用到。

### ④ `public/js/render/app.js` —— 备战期帧率封顶 120（中风险）

- **改了什么**：`getTargetFps()` 备战/休整分支 `return 0;` → 两行注释 + `return 120;`（`fix/public/js/render/app.js:581-583`；`prev/public/js/render/app.js:581` 为 `return 0;`；`diffs/03-render-app.diff:3-11`，唯一 hunk，1 删 3 增）。
- **解决什么问题**：PixiJS 中 `maxFPS=0` 表示不封顶，144/165Hz 屏上备战渲染跟屏幕刷新率跑，造成 CPU 尖峰与放置点击延迟（改动自带注释 `fix/public/js/render/app.js:581-582` 也这么写）。
- **机制**：`updateFpsLimit()` 把 `getTargetFps()` 写入 `app.ticker.maxFPS`（`fix/public/js/render/app.js:585-589`；触发点 :594/:1125/:1550/:1886/:2103/:2110）。Pixi ticker 跳过未达 `_minElapsedMS` 的帧，跳过帧的时间累积进下一帧 delta，动画时序不漂。
- **风险（中）**：
  - **120 这个值选得不干净**：vendored Pixi 判定为 `(t - _lastFrame) | 0` 整数截断后与 `1000/120=8.3333` 比较（源码片段见 `%TEMP%\vendorchk2\pixi.min.js`，md5 `45f1bf40bd0eb4b479286fcd70d591ba`，与 `分支 public/vendor/pixi.min.js` 相同）。**本次实跑**（脚本见下）：120Hz 面板 10s 内只跑 95.7fps、144Hz→111.9、165Hz→110，帧间隔在 8.33/16.67ms 两值间跳，与注释「Cap at the intended 120」不符。
    ```js
    // 复现 vendored Pixi ticker：rAF 时间戳取刷新率整数倍（理想等间隔 vsync）
    function sim(refresh, maxFPS, seconds = 10) {
      const minElapsed = maxFPS === 0 ? 0 : 1000 / maxFPS, step = 1000 / refresh;
      let lastFrame = 0, runs = 0;
      for (let i = 1; i <= seconds * refresh; i++) {
        const t = i * step;
        if (minElapsed) { const n = (t - lastFrame) | 0; if (n < minElapsed) continue; lastFrame = t - n % minElapsed; }
        runs++;
      }
      return +(runs / seconds).toFixed(2);
    }
    // sim(120,120)=95.7  sim(144,120)=111.9  sim(165,120)=110  （maxFPS=0 时分别 120/144/165）
    ```
  - **只封了 Pixi ticker，不是备战期总帧预算**：`包内 public/js/screens/game/standInTags.js:79` 的常驻 rAF 不受 `maxFPS` 约束（成本低）。`fix/public/js/ui/facingWheel.js:88/90` 的 `pinLoop` 同为 rAF，但两个字段视图都实现了 `holdPiece`（`fix/public/js/render/app.js:2075`、`包内 public/js/ui/fallbackField.js:493`），`pinLoop` 实际不可达。
  - **既有缺陷（两版相同，非本次引入）**：web/桌面端「动态高刷新率」开关**不生效**——`包内 public/js/ui/settings.js:36` 走 `sanitizeSettings`，其返回对象（`包内 public/js/ui/gameLogic/settings.js:19-35`）没有 `highRefresh` 字段，store 里根本没这个键；`fix/public/js/render/app.js:2101` 只在 `typeof s.highRefresh === 'boolean'` 时才写入，故 web 端恒为默认 `true`（`fix/public/js/render/app.js:441`）。**用户无法手动把备战期退回 60**，只剩两条自动路径：**「8 秒无画布输入」**（`idleSec > 8` 则 60，`fix/public/js/render/app.js:579-580`；计时器只由 canvas 的 `pointerdown/pointermove` 喂，:474-475、:590-591）与**「热降档」**（`thermalThrottled` 为真则 60，:573/:577，由 :2109 置位）。
- **本次实跑证据**：`diff -u prev/... fix/... app.js | grep -c '^@@'` = **1**；`grep -n highRefresh` 显示 `highRefresh === false` 守卫在 prev:576 与 fix:576 **都存在**。

### ⑤ `public/js/ui/facingWheel.js` —— 跟随循环改 ~30Hz（低风险）

- **改了什么**：三处「跟随相机/窗口」的 per-rAF 重投影循环（`useTileScreen`、Stripes 3D 板下挂 SVG、Stripes overlay）改 `setTimeout(1000/30)` 节流（`fix/public/js/ui/facingWheel.js:155/164`、`:401-402`、`:419-420`；3 个 hunk `diffs/04-facingWheel.diff:3,29,46`）。
- **解决什么问题**：朝向轮打开且相机仍在 750ms 滑行时，每次 tick 对每个范围格子做 `getBoundingClientRect` + 4 角投影（`fix/public/js/render/app.js:2062-2065`），高刷屏上逐帧执行占满主线程，造成指针输入延迟。
- **机制**：把重投影频率从显示器刷新率解耦为固定 ~30Hz；`alive` 守卫移入 loop（:162），cleanup 由 `cancelAnimationFrame` 改 `clearTimeout`（:167/404/422）。手势判定用已绘制的 `live.current.g`（:208），与视觉自洽，不会选错方向。
- **风险（低）**：① 视觉副作用是刻意取舍（注释 :153-154、:399-400）：相机滑行期轮盘/条纹相对平滑棋盘有 ~33ms 台阶感。② 实际频率约 25–29Hz（`1000/30` 取整 + tick 耗时）——**定时器语义推断，未运行验证**。③ 这是缓解措施，**不是根因修复**（根因是每格 `getBoundingClientRect` + 逐角投影的成本，本次未改）。
- **本次实跑证据**：`diff -u | grep -c '^@@'` = **3**；`grep -n "requestAnimationFrame\|setTimeout\|FOLLOW_MS"` → fix 侧仅 :88/:90 两处 rAF（都在不可达的 `pinLoop`），prev 侧为 :158/:392/:408/:410。

## 4. 已确认 vs 存疑（口径标注）

口径：**【实跑】**= 本次评审实际执行命令并读到输出；**【转述】**= 仅转述给定材料，本次未复跑；**【未验证】**= 无运行期证据或仅有估算/模拟。

| 结论 | 口径 |
|---|---|
| 两包源码差异仅 4 文件 + 3 探针；4 份 diff 与 `fix/`、`prev/` 副本一致 | **【实跑】** hunk 数实测 1/4/1/3；fix 副本与包内文件 md5 相同（材料另证 sha256 相同） |
| ①②③⑤ 分支完全没有；④ 分支已有，`highRefresh` 开关两版共有 | **【实跑】** 分支 `grep`：matchmaking:272 只有提前 return、无 `this.stop()`；lobby 无 `= false`、`maxSeats: 10`@577；facingWheel 无 `FOLLOW_MS`/`setTimeout`、6 处 rAF；app.js:580/586 |
| `BRANCH_STATE.md` 过时（HEAD 实为 `0f52a0b6`） | **【实跑】** `git rev-parse HEAD` |
| ① 改动本身无功能 bug；两版队列字段逐项相同 | **【实跑】** `node %TEMP%\mm-harness.mjs`（11 快照）、`node %TEMP%\mm-idle.mjs` |
| ② 房主「匹配队友」后仍持续收 4 秒列表（确定性漏洞） | **【实跑】静态读码**；未运行服务器 |
| `diffs/01/02/04` 可直接 `git apply` 到分支，`03` 不能（已含 120） | **【实跑】** `git apply --check -p3`：01/02/04 输出「APPLIES CLEANLY」，03 报 `patch does not apply` |
| 安卓端出房能自愈（大厅屏会立即 poll + 每 6s poll） | **【实跑】** 解包 `%TEMP%\app_bundle.zip`（来自 APK）读 `public/js/screens/lobby.js:426/432/433`，与 web 端该文件 md5 相同（`3d90443e…`） |
| 安卓 APK 内嵌 `server/lobby.js`、`server/matchmaking.js` 是**上一版**（无本次修复） | **【实跑】** APK 内 `server/lobby.js` md5 `96b26f01…` == `prev/server/lobby.js`；无 `= false`、`maxSeats: 10`、无 `this.stop()` |
| ③ maxSeats 修正正确、低风险 | **【实跑】静态读码** |
| ④ 120 封顶在 120Hz 面板掉到 ~96fps、144/165Hz 到不了 120 | **【实跑】模拟**：`node %TEMP%\pixi-fps-sim.mjs`（脚本见 ④），对 vendored ticker 的理想 vsync 重放；**真机未验证** |
| ④ 开关不生效属既有缺陷（两版相同） | **【实跑】静态读码**（材料另证两版 settings 文件逐字节相同） |
| ② 进房窗口 `room.list` 竞态命中率约 1–3% | **【未验证】估算**：材料只给「窗口 ~10–150ms」；按 命中率≈窗口/轮询周期（4s 或 6s）复算 = `10/6000≈0.17%` ~ `150/4000≈3.75%`，与材料同量级。材料未写明其模型，**未实测** |
| ⑤ 30Hz 循环实际约 25–29Hz | **【未验证】** 定时器语义推断 |
| 「高刷显示器点击延迟已被消除」 | **【未验证】** 无运行期证据 |
| 随包脚本 `node --check` 全部通过 | **【转述】** 本次未复跑 |
| 开发分支测试基线 620 tests / 617 pass / 1 fail / 2 skipped | **【转述】** 本次未复跑 |

## 5. 本次没有验证的部分（务必如实对外说明）

1. **发布包不含测试、不含 docs**（`SCOPE.md:45`）——仓库测试测的是仓库代码，不是这个包。
2. **3 个 click-lag 探针脚本本次未执行**（需 Chrome/puppeteer-core + 真实服务器，`SCOPE.md:46-47`）；包内也 grep 不到任何探针结果文件。
3. 探针也覆盖不到这些改动：三探针只加载 `包内 public/dev/game-mock.html`（浏览器内 mock，不连 WebSocket），点击的是商店卡/刷新/观战/设置（`probes/click-lag-probe.tmp.mjs:90-111`；`probes/click-lag-probe2.tmp.mjs:66-74` 只 `querySelector` 不派发指针事件；`probes/click-lag-probe3.tmp.mjs:45-88`）。**本次实跑** `grep -i "matchmaker|match.queue|lobby|socket" probes/*.mjs` 无命中（exit 1）。注：探针确实 `import('./server/index.js')` 启动了真实服务器（`probes/click-lag-probe.tmp.mjs:9-10`），但撮合流程未被触发。
4. 因此「高刷点击延迟是否真被消除」目前**只有代码层依据**。撮合停表对客户端流量/渲染也没有可测影响（旧版空转仅 1 次/秒、0 次广播）。
5. **安卓端**：已确认 APK 内客户端大厅屏会 poll（自愈成立，见第 4 节）；但 APK 内嵌的**服务端**是上一版、不含本次修复——若安卓端在本地跑自己的服务端（fused/host 模式），部署这个服务器包**不会**更新它，需另出 APK。**该端是否真会启用内嵌服务端，本次未确认。** 最坏情况：若某端大厅屏不发 `room.list`，该端玩家出房后收不到大厅推送，房间列表停留在旧快照，直到手动刷新或重进大厅路由。

## 6. 建议（可执行）

**A. 必须并回分支（否则下次打包丢失）——直接应用现成 diff，不必照文字重做。**
分析目录 `diffs/` 下已有 old→new 补丁，**本次实测** `git apply --check -p3`：`01-server-matchmaking.diff`、`02-server-lobby.diff`、`04-facingWheel.diff` **可直接应用**（输出「APPLIES CLEANLY」），`03-render-app.diff` 不能（分支已含 `return 120`，无需再并）。执行：

```bash
cd E:/Workbox/sp-upgrade-2.1
git apply -p3 E:/Workbox/fix-release-analysis/diffs/01-server-matchmaking.diff
git apply -p3 E:/Workbox/fix-release-analysis/diffs/02-server-lobby.diff
git apply -p3 E:/Workbox/fix-release-analysis/diffs/04-facingWheel.diff
```

（`fix/` 下有改动后全文可逐字比对。`app.js` 的 ④ 分支已有，**无需再并**。）

**B. 合并后需补的三件事**
1. ② 的确定性漏洞建议顺手补全：把 `lobby.stats` 广播过滤改为按「会话当前是否有房间」判断，或在 `startMatch/onMatchEnd/removeMember/cancelRoomQueue` 路径重置 `wantsLobbyStats`，堵住房主「匹配队友」后整场收列表的路径。
2. ④ 的 120 建议评估改成 60 或改用不受整数截断影响的封顶方式，避免 120Hz 面板抖动到 ~96fps。
3. ④ 的 `highRefresh` 开关失效是既有缺陷，若产品上需要「用户可退回 60」，需另修 `sanitizeSettings` 保留 `highRefresh` 字段。

**C. 并完跑什么**：`node --test`（分支基线 620 tests / 617 pass / **1 fail** / 2 skipped、exit 1——那 1 个红灯是既有失败，不是本次引入，合并后不应**新增**红灯）；重点看 `test/lobby.test.js`、`test/match/*.test.js`；对 4 个改动文件跑 `node --check`。

**D. 部署前验证（本次全未做，建议补）**
- 真机/浏览器在 120/144/165Hz 屏上分别测备战期实际帧率（验证 ④ 的真实表现，尤其 120Hz 是否掉到 ~96）。
- 桩服务端：房主建房 → 发 `match.queue` → 断言该 session 的 `wantsLobbyStats` 是否仍为 true（验证 ② 的确定性漏洞）。
- 进房/观战后观察是否仍每 4 秒收到 `lobby.stats`；进出房间各若干次统计竞态命中率。
- 大厅列表 UI 断言 `maxSeats` 显示为 4（不再是「2 / 10」）。
- 撮合队列排空后确认 1 秒定时器停止（`running=false`）、重新入队能重新装表。
- 若要把「点击延迟」写进发布说明，先补跑 3 个探针或做真机输入延迟测量；否则不要下这个结论。

**E. 文档同步**：合并后更新 `fix-release-analysis/BRANCH_STATE.md`（HEAD 已过时）与本评审的第 4 节口径；把 ①②③⑤ 记入 `docs/OPTIMIZATION_AND_PR_PLAN.md`（该文档目前只覆盖 ④ 与另一项调向交互改动）。

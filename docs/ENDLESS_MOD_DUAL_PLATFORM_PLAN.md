# 无尽独立化 × mod 双端打包 · 分步实施计划（2026-10-09）

- **对象仓库**：`E:/Workbox/sp-upgrade-2.1`，分支 `feature/v0.2.1-fusion-master`，`APP_VERSION = '0.2.1-fusion'`（`shared/constants.js:6`）
- **本文性质**：施工计划。**未改动任何生产代码**，只写这一份文档。
- **上游材料（六份修订稿，本文的施工依据）**：
  - 打包 `E:/Workbox/plan-drafts/packaging-final.md`
  - 无尽 `E:/Workbox/plan-drafts/endless-final.md`
  - 房主选包与私密房 `E:/Workbox/plan-drafts/modflow-final.md`
  - mod 内容 `E:/Workbox/plan-drafts/modcontent-final.md`
  - 素材 CF `E:/Workbox/plan-drafts/assets-final.md`
  - 本地算与服务器对接 `E:/Workbox/plan-drafts/localcompute-final.md`
- **风险输入（六份质疑 + 跨块审查）**：`plan-drafts/{packaging,endless,modflow,modcontent,assets,localcompute}-critique.md`、`plan-drafts/cross-conflicts.md`。本文不重复它们的内容，只在 §7 逐条给出**处置结论**与**不成立条件**。
- **已有评审（不重复，直接引用）**：`E:/Workbox/UI_PACKS_VS_ENDLESS_PLAN.md`（两轴分区；**其中 §3.2/§3.3 的 UI 落点与 §4.2 的合并落点已被本次推翻，见 §7 对齐表 C1/C2/C3/C7**）、`E:/Workbox/ENDLESS_PATCH_VS_MOD_MANAGEMENT.md`、`E:/Workbox/PACK_RUNTIME_GAP_REVIEW.md`、`E:/Workbox/FORGE_MOD_TOOLING_REVIEW.md`、`sp-upgrade-2.1/docs/HANDOFF_NEXT_2026-10-09.md`

---

## 0. 证据基线与施工纪律

### 0.1 本次（写这份计划时）实跑核对过的锚点

在 `E:/Workbox/sp-upgrade-2.1` 下执行，全部命中：

| 断言 | 命令 | 结果 |
|---|---|---|
| 基线提交 | `git rev-parse --short HEAD` | `975585e1`；`git status --porcelain \| wc -l` → **21**（写本文时）。**独立复核时实测为 22**，多出的第 22 条正是**本计划文件自身**（`?? docs/ENDLESS_MOD_DUAL_PLATFORM_PLAN.md`，落盘晚于第一次计数）→ 21 自洽，照抄会得到 22 |
| `modeIdFor` 是 2 参 | `grep -n modeIdFor shared/constants.js` | `24:export const modeIdFor = (roomMode, difficulty) =>` |
| `room.create` 无 `packs`/`variant` | `sed -n '293,300p' shared/protocol.js` | `'room.create': { mode, difficulty }`（`:297`） |
| 服务端唯一 `modeIdFor` 调用点 | `grep -n "modeId: modeIdFor" server/lobby.js` | `991` |
| 引擎拿 data 的入口 | `grep -n "data: this.safeData()" server/lobby.js` | `998`（大厅四处校验在 `829/858/884/901`） |
| 挂载表无 `/packs/` | `grep -n "prefix: '/" server/index.js` | `394 /data/`、`395 /shared/`、`397 /sim/`、`398 /` |
| `BUILD_INPUTS` | `grep -n BUILD_INPUTS server/index.js` | `152`（值 `['public/index.html','public/js','public/css']`） |
| 单例 data 载入点 | `grep -n "loadData(dataDir" server/index.js` | `675`（`dataDir` 在 `671`） |
| Android 复制表 | `grep -n "copyRecursive(path.join(ROOT" tools/bundle-android.mjs` | `60 server` / `61 shared` / `62 data` / `63 public` / `64 package.json` |
| 桌面排除表是前缀匹配 | `grep -n "SKIP_TRACKED\|const wanted = all.filter" scripts/make-windows-bundle.mjs` | `58 SKIP_TRACKED = ['test/']`、`478` 过滤 |
| headless 只排素材 | `grep -n EXCLUDE_PREFIXES -A3 scripts/make-headless-server.mjs` | `70`、`71 'public/assets/'`；`524-529` 单独复制 `data/local-assets.json` |
| ES2020 门禁目录 | `sed -n '23,34p' test/es2020-syntax.test.js` | `public/js`、`shared`、`server/sim/content`（+`spec.js`/`Battle.js`） |
| 静态检查扫描根 | `grep -n "JS_FILES\|CSS_FILES" test/client-static.test.js` | `147 public/js`、`1172 public/css` |
| 无 productFlavors | `grep -c productFlavors android/app/build.gradle` | `0`（`versionCode 21` 在 `:20`，`applicationIdSuffix ".debug"` 在 `:36`） |
| Gradle 任务与产物名写死 | `grep -n "const RELEASE\|const VARIANT\|gradleArgs\|finalApk" scripts/build-android.mjs` | `13`、`148`、`158`、`197` |
| 内容层是进程单例 | `sed -n '36,54p' server/sim/content/support/index.js` | `let DATA = null; gameData()`；六个 `*Record(id)` **不带 data 参数**；`setGameData` 注释「Tests only」 |
| 缺羁绊即整份结果被拒 | `grep -n "return bad('bond')" server/match/fields.js` | `834` |
| `PACK_TYPES` 两个 planned | `grep -n "PACK_TYPES\|status: 'planned'\|PACKS_URL" shared/packs.js` | `44`、`55`、`60 assets`、`61 data` |
| 现无 pack 目录与能力位 | `ls -d packs public/packs overlays shared/capabilities.js public/endless` | 6 个全部 `No such file or directory` |
| `scripts/pack/` 存在且未跟踪 | `ls scripts/pack` | `_lib.mjs desktop.mjs index.mjs mobile.mjs server.mjs` |
| mode 数 | `node -e "Object.keys(require('./data/config.json').modes)"` | 9 条，无 endless |
| 两份 config 一致 | `cmp -s data/config.json public/data/config.json` | 相同 |
| 两份 `assets.json` 已漂移 | `cmp -s data/assets.json public/data/assets.json` | 不等（`assets-final.md` §2.2 记 1,690,910 vs 1,990,039 字节） |
| 无尽入口宿主 | `grep -n "title-login\|onClick=\${start}" public/js/screens/title.js` | `258`、`266` |
| 结算/顶栏/BGM 落点 | `grep -n` | `public/js/ui/hud.js:317`、`public/js/audio.js:94`、`public/js/store.js:111`、`public/index.html:42` |
| 版本耦合六处 | `sed -n '14,52p' test/version.test.js` | `18` `pkg.version`、`27` CHANGELOG 首条、`31` README badge、`35` title 屏 `v${APP_VERSION}`、`38` 启动 banner、**`39` `/healthz` 的 `app: APP_VERSION`**；`:36` 是反向断言（`!/PROTOCOL v1/`）；`:19` 另断言 `PROTOCOL_VERSION === 1`；**`:49` 是 README 英文摘要（`mode *Stronghold Protocol: Alliance*`），与版本无关——前一版把它误标成反向断言** |
| 服务器包/桌面引擎白名单 | `grep -n "ALLOW_TRACKED_PREFIXES\|EXCLUDE_PREFIXES" scripts/make-server-bundle.mjs` | `50`、`74` |
| 镜像同步器 | `grep -n "copyRecursive" tools/sync-static-web.mjs` | `27 shared→public/shared`、`30 data→public/data`、`32 server/sim→public/sim`；**`:43-51` 会在复制完 `server/sim` 之后有意改写 `public/sim/simdata.js`** |
| simdata 的**有意**改写 | `diff server/sim/simdata.js public/sim/simdata.js` | 只有一处 `480,487c480`：`if (IS_NODE) {…}` → `/* browser: nodeLoader omitted (setSimData injects data) */`。**重跑 sync 也修不掉，这是设计**（`tools/sync-static-web.mjs:43-51`） |
| sim 镜像现状 | `diff -rq server/sim public/sim \| wc -l` | **27**（26 个 `differ` + `Only in server/sim: nodeData.js`）→ **重跑 sync 后应只剩 2 行**：`simdata.js` 的有意改写 + `nodeData.js` |
| 两份 `shared` 镜像漂移 | `diff -rq shared public/shared` | `shared/diy.js` 与 `shared/packs.js` **两个**文件漂移（**不止 `packs.js`**） |
| 素材目录是**符号链接** | `find public/assets -maxdepth 1 -type l`；`find public/assets -type f \| wc -l`；`find -L public/assets -type f \| wc -l` | 11 个一级 symlink（`audio band bond enemy item local prof skill spine token ui`，含二级共 13 个）；**不跟随只有 271 个文件，`-L` 才是 13,101**；`public/assets/local -> /e/Workbox/系统/public/assets/local/`——**3D 棋盘贴图就在 `local` 下面** |

**没跑的**：本次**没有执行任何打包命令、没有跑 `node --test`、没有跑 e2e/golden、没有访问 CF/R2**。§0.1 全部是 `git`/`grep`/`sed`/`ls`/`cmp`/`node -e` 的定点核对。因此下文所有「验收标准」都是**设计**，不是已通过的结果。

### 0.2 三条施工纪律（不遵守则后面的门禁全部失效）

1. **行号只对「`975585e1` + 冻结后的干净工作树」成立。** 六份修订稿各自记录的工作树快照互不相同（`plan-drafts/packaging-final.md` §0 记录了两小时内两次 `git status` 的差异）。**开工前必须先冻结基线（P0），冻结之后重核一遍本文引用的行号。**
2. **`docs/HANDOFF_NEXT_2026-10-09.md` 记的 HEAD 是 `0f52a0b6`，与六份修订稿和本次实测的 `975585e1` 不一致。** 基线到底是哪个提交、以及 `HANDOFF` §6 的「引擎补到 0.2.x」移植是否先做，属于必须先拍板的事项（§8 决策 D1/D2）。
3. **同一文件不得被两条工作流同时改。** 已知在飞区域：`server/sim/**`（引擎移植）、`scripts/make-headless-server.mjs`、`tools/bundle-android.mjs`、`android/app/build.gradle`、`scripts/build-android.mjs`。本计划的 P1/P2/P4/P5 都碰这些文件。
4. **`public/assets/**` 里有 11 个一级符号链接（含 `local`，3D 棋盘贴图就在它下面），任何「全量素材」步骤必须显式跟随链接。** 实测：`find public/assets -type f | wc -l` = **271**，`find -L public/assets -type f | wc -l` = **13,101**。不跟随的失败方式是**静默的**——上传成功、HTTP 200 正常，只是 3D 棋盘退回 2D。这条同时约束 P1 的 Android 复制（`tools/bundle-android.mjs:63` 复制 `public/`）与 P8 的 `tools/push-assets.mjs`。

---

## 1. 一页总览：四条方向 → 阶段映射，谁挡谁

### 1.1 映射

| 用户方向 | 落在哪些阶段 | 一句话交付 |
|---|---|---|
| **① 无尽独立入口 + 独立新 UI + 不带 mod + 仅本地单人 + 服务器不搭载 + 分开打包** | **P1**（打包机制/能力位）→ **P2**（无尽数据层）→ **P3**（无尽 UI 与入口）→ **P4**（无尽包出齐） | 主包与无尽包两个产物；无尽包 = 共享内核 + `endless/` + `public/endless/` + `ENDLESS=true/MODS=false`；服务器包不含无尽数据 |
| **② 房主创房时弹窗选 mod + 私密房 + 本地全量包必含全部 mod + 本地计算 + 房内只读显示** | **P5**（pack 运行时与索引）→ **P6**（内容层合并/去单例）→ **P7**（弹窗、私密房、握手） | 房主弹窗 → `room.create.packs` → 服务端逐房合并快照 + 强制私密 + 令牌；房内只显示「🔒 私密 + 包名」 |
| **③ 调研 mod 能支持什么（新干员/新装备/新盟约 + 素材美术）** | §6 的表（结论）+ **P5/P6** 的交付物 | 三类内容的「现状 / 缺口 / 所需文件」表 + 三道内容门禁 |
| **④ 重构服务器与双端联系：素材走 CF 预载（含 3D 棋盘）、普通战斗与 mod 计算本地、服务器只保留能跑 mod 对局的部分** | **P8**（素材 CF）→ **P9**（服务器收口）；本地计算部分在 **P6** | URL 契约 + 降级优先关系；服务器保留清单 + 三包体内容矩阵 |

### 1.2 依赖图（谁挡谁）

```
P0 冻结基线与镜像复原 ──┬─→ P1 能力位与打包机制 ──┬─→ P2 无尽数据层 ─→ P3 无尽 UI ─→ P4 无尽包出齐
                        │                        │
                        │                        └─→ P5 pack 运行时与索引 ─→ P6 内容层合并 ─→ P7 弹窗/私密房 ─┐
                        │                                                                                  │
                        └─→ P8 素材走 CF（门禁 0 挡住 R2 段）────────────────────────────────────────────┴─→ P9 服务器收口
```

- **最长关键路径**：`P0 → P1 → P5 → P6 → P7 → P9`。
- **可并行**：无尽线（P2→P3→P4）与 mod 线（P5→P6→P7）在 P1 之后互不阻塞；P8 与两条线并行，但它的 R2 镜像段被「门禁 0」（CF 控制台事实）挡住，**仓库内的 `/packs/**` 路由不依赖门禁 0，拆到 P5 先做**（对齐 C17）。
- **三个硬依赖**：
  1. **P2 必须先于 P3**：无尽入口按钮的可见性门控读的就是 `config.modes` 里那 4 条 mode（`plan-drafts/endless-final.md` §2.11）。
  2. **P1 必须先于 P4 与 P5**：`shared/capabilities.js` 是 P4 门禁 2 的断言对象，也是 P7 里 `MODS` 位的来源（对齐 C18/C22）。
  3. **P6 必须先于 P7**：`client.content` 的 `snapshotHash` 由 P6 的合并实现产出（对齐 C12）。
- **两处必须同一次 schema 变更落地**：`shared/protocol.js:297` 的 `variant` 与 `packs` 并列新增（对齐 C9/C18）；`server/lobby.js` 的 `Room` 字段一次性加全（对齐 C8）。

---

## 2. 分阶段清单

> 每个阶段的「要动的文件」都带行号；行号基于 §0.1 的实测。**P0 之后必须重核。**

### P0 · 冻结基线与镜像复原（所有阶段的共同前置）

- **目标**：把工作树变成可复现基线；修掉已提交的镜像漂移；让「两端一致」这条纪律从第一天起就成立。
- **要动的文件**：
  - 提交未跟踪的构建链：`scripts/pack/{_lib.mjs,index.mjs,server.mjs,desktop.mjs,mobile.mjs}`（`ls` 实测存在、`git status` 为 `??`）；`package.json` 的 `pack:*` 四条。
  - 处理 `tools/bundle-android.mjs:11`（被跟踪文件 import 未跟踪目录）——建议把 `tools/bundle-android.mjs` 加进两个服务端引擎的 `EXCLUDE_PREFIXES`（`scripts/make-server-bundle.mjs:74`、`scripts/make-headless-server.mjs:70`），与 `scripts/build-android` 同源处理。
  - 重跑 `node tools/sync-static-web.mjs`（`tools/sync-static-web.mjs:27/30/32`）：修 `public/sim/**` 的 26 个落后文件、`public/data/assets.json` 漂移、`public/shared/` 的 `packs.js` **与 `diy.js`** 漂移。**注意 `:43-51` 会改写 `public/sim/simdata.js`——这是设计，重跑不会也不该消除它。**
  - 新增**一条**镜像门禁（唯一所有者，对齐 C13）：落在 `test/client-static.test.js`，断言 ① `server/sim/**` 与 `public/sim/**` 一致，**例外恰好两处**：`nodeData.js`（只在 server 侧）与 `simdata.js`（`:43-51` 的有意改写）；② `data/assets.json` 与 `public/data/assets.json` 深比较相等；③ **`shared/**` 与 `public/shared/**` 全目录一致**——必须覆盖 `packs.js` **与 `diy.js`**（实测这两个当前都漂移），`constants.js` 由这一条一并覆盖，不单列。
- **交付物**：一个干净提交；一份「基线普查」记录（分套跑测试的红项数，照 `docs/HANDOFF_NEXT_2026-10-09.md` §5 的方式）。
- **验收**：
  1. `git status --porcelain` 为空；
  2. `node -e "await import('./scripts/make-windows-bundle.mjs')"` 成功（H1 的直接判据）；
  3. **镜像门禁的判据（重跑 sync 之后）**：`diff -rq server/sim public/sim` 只剩 **2 行** —— `Files server/sim/simdata.js and public/sim/simdata.js differ`（有意改写）与 `Only in server/sim: nodeData.js`；`diff -rq shared public/shared` **无输出**；`diff -rq data public/data` **无输出**（含 `assets.json`）。**「只剩 nodeData.js」是错的判据**：`simdata.js` 的差异是脚本有意制造的，永远存在。
  4. `cmp -s data/assets.json public/data/assets.json` 返回 0；
  5. 分套跑测试（`node --test test/content/*`、`test/sim/*`、`test/data.test.js`、`test/match/*`、`test/render/*`、`test/golden.test.js`、`test/ui/*`、`test/server/*`），把红项数记为基线。**不要裸跑 `node --test`**（`docs/HANDOFF_NEXT_2026-10-09.md` §7 记录它会挂）。
- **依赖**：无。
- **预计规模**：0.5–1 人日（不含并发写入者的停手等待）。

### P1 · 能力位与打包机制（capabilities + 变体 + 排除表）

- **目标**：让三条发布管线能产出「主包」与「无尽包」两种变体，且**共享内核逐字节相同**；服务器包不含无尽字节。
- **要动的文件**：
  - **新增** `shared/capabilities.js`（默认 `ENDLESS = false`、`MODS = true`）与镜像 `public/shared/capabilities.js`（`tools/sync-static-web.mjs:27` 的产物；两份都要存在，因为 Node 服务场景读 `shared/`（`server/index.js:395` 挂载 `ROOT/shared`），纯静态托管场景读 `public/shared/`）。
  - `scripts/pack/desktop.mjs`：参数解析 `:18-25` 加 `--endless` + 未知参数硬报错；`name` `:27` 区分变体；`outDir` `:28`；`rmrf` `:35`；透传 `:36-39`。
  - `scripts/pack/mobile.mjs`：`apkIn` `:31-33`（加 flavor 段）、`outDir` `:49`、`apkOut` `:51`、`SHA256.txt` `:55` 与 `app_bundle.zip` `:59` **两变体分目录**（否则必然互相覆盖）。
  - `scripts/pack/index.mjs`：`PIPELINES` `:22`、`all` `:39`、透传 `:50`；新增 `pack:endless` / `pack:endless:mobile` npm script。
  - `scripts/pack/server.mjs`：参数解析 `:20-28` **显式拒绝** `--endless`（服务器不搭载无尽）。
  - `scripts/make-windows-bundle.mjs`：`SKIP_TRACKED` `:58` 加 `endless/`、`public/endless/`；过滤 `:478`；`parseArgs` `:71` 加 `--endless`；在**暂存副本**里写 `app/shared/capabilities.js` 与 `app/public/shared/capabilities.js`。
  - `scripts/make-server-bundle.mjs`：`EXCLUDE_PREFIXES` `:74` 加 `endless/`、`public/endless/`。
  - `scripts/make-headless-server.mjs`：`EXCLUDE_PREFIXES` `:70`（`public/assets/` 在 `:71`）同上；并处理 `data/local-assets.json` 的假清单缺陷（`:524-529`，对齐 C24）。
  - `tools/bundle-android.mjs`：复制表 `:60-64`——顶层 `endless/` 天然不进（不在表里）；`public/endless/` 会被 `:63` 的 `public/` 整目录复制带上 → 必须在 `:63` 后删除暂存的 `public/endless/`（或给 `copyRecursive` 加过滤）。
- **交付物**：`shared/capabilities.js` ×2；`--endless` 变体；`pack:endless` 入口；排除表四张（桌面 `SKIP_TRACKED`、两个服务端 `EXCLUDE_PREFIXES`、Android 复制表）同轮改完。
- **验收**（照 `plan-drafts/packaging-final.md` §4，本文只保留可执行形状）：
  1. **门禁 1（主包不含无尽字节）**：`node scripts/pack/index.mjs desktop --no-node --no-zip --out <tmpA>`；断言 `<tmpA>/app/public/endless` 与 `<tmpA>/app/endless` 不存在、`<tmpA>/app/shared/capabilities.js` 含 `ENDLESS = false`、两份 `config.json` 都不含 `mode_single_endless`。
  2. **门禁 4（服务器不搭载无尽，负向）**：`server --no-deps --no-zip --out <tmpB>` 与 `server --headless --no-deps --no-zip --out <tmpC>`，断言 `endless/`、`public/endless/` 不存在且 `ENDLESS = false`。
  3. **门禁 3（防分叉，显式允许清单）**：比对 `<tmpA>` 与无尽包暂存，**除 6 组外逐字节相同**：`shared/capabilities.js`、`public/shared/capabilities.js`、`endless/**`、`public/endless/**`、`data/config.json`、`public/data/config.json`。第 7 处差异即失败。
  4. **门禁 5（干净检出可构建）**：`node -e "await import('./scripts/make-windows-bundle.mjs')"` + `node --test test/windows-bundle.test.js` 全绿。
  5. `pack:endless` 与 `pack` 的产物落在**不同目录**，`SHA256.txt` 不同名不同目录。
- **依赖**：P0。
- **预计规模**：1–1.5 人日（不含 Android flavor，那在 P4）。

### P2 · 无尽数据层（overlay + 引擎语义 + 终止与结算）

- **目标**：4 条 `mode_single_endless_<diff>` 由**构建期注入**产生（不改仓库里的 `data/config.json`）；引擎在 `isEndless` 下的五件事（末回合 / 领袖排期 / 波次抽签 / 强度 / 计时）语义正确；一局的终止条件有定义。
- **要动的文件**：
  - **新增** `endless/overlays/modes.json`（**不是** `overlays/endless/modes.json`，理由见 §7 对齐 C3）；`endless/tools/make-endless-modes.mjs`（生成器，确定性）；`endless/tools/apply-endless-overlay.mjs`（注入器）。
  - **注入目标只能是打包器的暂存副本，绝不能是仓库的 `data/` 与 `public/data/`。** 按字面注入仓库会同时踩三条：① 工作树变脏 → `scripts/build-android.mjs:92-97` 记录、`:180-191` 比对的 P0-1 干净树门禁 `exit 1`；② 主包的 `data/config.json` 会含 `mode_single_endless_*` → P1 门禁 1 直接失败；③ 仓库的 `data/config.json` 是 `tools/build-data.mjs` 的生成物（`:3252-3253`、`:3265-3278`），手改会在下次生成时被整体覆盖。**落法：`scripts/make-windows-bundle.mjs` 与 `tools/bundle-android.mjs` 在暂存目录写完之后、打包之前，对暂存里的 `data/config.json` 与 `public/data/config.json` 调注入器**（源文件不动）。`SP_ENDLESS` 的 e2e 钩子（见下）注入的是**临时目录**，不是仓库。
  - 注入器的调用方式：**只能在 `--endless` 分支里动态 import**（`endless/` 在主包里不存在，顶层静态 import 会让主包的 `scripts/` 带着坏引用——与 H1 同类）。
  - **4 条 mode 的 `inScope` 取 `true`（诚实值）。** 仓库内 `data/config.json` 仍是 9 条（`inScope.length === 8`），所以 `test/data.test.js:242` 保持绿；**但产物必须被单独覆盖**：`test/endless-data.test.js` 要**对注入后的临时 config 复用同一套形状断言**（断言 `Object.keys(modes).length === 13`、`inScope.length === 12`、4 条 endless 的 `stages`/`upgradePrices`/`rounds`/`enemyScale` 全部过校验）。否则这条断言永远只覆盖仓库那份、覆盖不到真实产物（`test/data.test.js:245-259` 的逐 mode 校验就是按 `inScope` 决定跑不跑的）。
  - `shared/constants.js:24`：`modeIdFor(roomMode, difficulty, variant)`（2 参调用行为不变）；同步 `public/shared/constants.js`；P0 的门禁已守同源。
  - `server/match/gamedata.js`：`:69` 之后新增 `isEndless`（**只认 `mode.lastRound === 0`**，不认 variant 字符串）；`:279-282` `lastRound` 前置 `return 0`；`:283` `bossRound` 保留单值 + 新增 `isBossRound(r)`；`:316-321` `prepTime` 在 `isEndless` 下读 `rounds[].prepTimeData`；`:287-290` `roundCfg`、`:361-369` `baseEnemyScale` **不改**（强度靠数据展开，见下）。
  - `server/match/waves.js:218-221` `roundPick`：`round > picks.length - 1` 时取模复用（**一处覆盖两个调用点**：`buildNormalWave:365`、`buildBossWave:396`）。
  - `server/match/Match.js`：`:712 soloUntimed` 加 `&& !this.gd.isEndless`；`:1560` 改 `this.gd.isBossRound(r)`；`:1240` 的 `layerGainsEnabled` 用 `isBossRound(this.round)`；`:1900 endPrep()` 同；`:3239-3250` Final Assault 收尾在胜利时 `startRound(round+1)`；`:904` 下发 `lastRound: 0` + `endless: true` + `isBossRound`。
  - `server/match/results.js:95` `teamRounds` 加 `isEndless` 前置分支；`:124-157` 返回体加 `endless`/`lastRound`/`survivedRounds`。
  - `server/match/StubMatch.js:96-98`、`server/match/audit.js:315/468`、`tools/balance.mjs:486`（后两者 `endless-final.md` §5 自陈未读全，**施工时必须单独过一遍**）。
  - `test/e2e/fastServer.mjs:163` 加 `SP_ENDLESS` 钩子（把 `data/` 复制到临时目录 → 注入 → `startServer({ dataDir })`）；`server/index.js:884` 的 `main()` 建议加 `SP_DATA_DIR`（1 行）以便手动验收。
- **交付物**：`endless/overlays/modes.json`（4 条，R1..R42 地平线，`enemyScale` 单调不减）；两个工具脚本；引擎改动；`test/endless-data.test.js` + `test/match/endless.test.js`。
- **验收**：
  1. `test/endless-data.test.js`：4 条 mode 都在、`lastRound === 0`、`bossRound === 14`、`hiddenRound === null`、`max(rounds) === max(enemyScale) === 42`、每条 round 有 `template` 或 `bossTemplates`、`prepTime === null`、`enemyScale` 的 hp/atk 随周期单调不减（**R15 不得出现 `3.583181 → 1.333` 那种断崖**）；**并对注入后的临时 config 复用 `test/data.test.js:245-259` 的整套形状校验（`modes` 13 条、`inScope` 12 条）**。
  2. `test/match/endless.test.js`：bot-only 无尽跑到 R21 以上，断言 **R16+ 每回合 `wave.spawns` 非空**且敌人 key 集合 ≠ 6 个 placeholder（`enemy_1422_lrsldr` 等）、R21/R28 走领袖波、清掉领袖战后回合继续、`pub.isBossRound` 在 R14/R21/R28 为 true 而 R15/R20 为 false。
  3. 现有 mode 行为零回归：`node --test test/data.test.js test/match/*.test.js`（`test/data.test.js:242` 的 `inScope.length === 8` 因 overlay 不在仓库 config 里而保持绿）。
  4. `test/golden/*` 不变（`GOLDEN_FULL=1 node --test test/golden.test.js`）。
- **依赖**：P0、P1（`endless/` 的排除表已就位）。
- **预计规模**：3–5 人日。

### P3 · 无尽 UI 与入口（`public/endless/**` + 主页独立按键）

- **目标**：主页首页出现**独立按键**，进入一个**独立新 UI**（不共用大厅/房间屏），美术风格一致；按键可见性由所连服务器的 `config.modes` 决定（fail-closed）。
- **要动的文件**：
  - **新增** `public/endless/js/*`（出击前屏 = 难度 + 说明；局内顶栏分支；结算分支；排行榜）+ `public/endless/css/endless.css`。**所有新字节放这里**（对齐 C1；`public/js` 与 `public/css` 已被两道门禁覆盖，新目录必须显式加进去，见下）。
  - `public/js/screens/title.js:266` 与 `:267` 之间插第二个 `<Button>`；`:12` 加 `modeIdFor` import、`:18` 加 `getConfig`、`:191` 附近加 `useData('config')`；门控 `!!getConfig()?.modes?.[modeIdFor('solo', difficulty, 'endless')]`；点击 → `enterSession()`（`:72-80`）→ 在线后 `net.request('room.create', { mode:'solo', difficulty, variant:'endless' })`。**这个模块只能动态 import**（见 P3 红线）。
  - `public/js/store.js:111` 的 JSDoc 加 `'endless'`；`:113-120 selectRoute` 在 `if (s.room?.inMatch) return 'game';` **之前**插 `if (s.room?.variant === 'endless') return 'endless';`。
  - `public/js/main.js:57 SCREENS` 加 `endless` 项——**并且必须同时改 `:388 const Screen = SCREENS[route] || LobbyScreen;`**：`:57` 是一张**同步**组件表、`:388` 直接把它当组件渲染，光改 `:57` 做不了动态 import。做法二选一：① `:388` 改成「能力位为真时先 `await import()` 到本地 state，未就绪时渲染一个加载态」；② 把 `endless` 项做成一个**只在 `ENDLESS` 为真时才被 import 的壳组件**。**只改 `:57` 不改 `:388` 无法施工。**
  - `public/js/audio.js:94` `bgmKeyFor` 白名单加 `'endless'`（否则静音）。
  - `public/js/ui/hud.js:317` 的 `hidden` 加 `pub.lastRound > 0`；难度标签换「无尽 · 终极」。
  - `public/js/ui/gameLogic/camera.js:21/48/53`、`public/js/screens/briefing.js:67`、`public/js/ui/enemyDrawer.js:57` 改读 `pub.isBossRound`。
  - **无尽排行榜（净新增）**：`public/endless/js/endlessBoard.js` + `public/endless/css/endless.css`。**持久化落点写死为 WebView 的 `localStorage`**（键 `sp.endless.best.<difficulty>`），**不新增 Android 侧文件、不做 native 桥**——客户端在 APK 里也跑在 `http://127.0.0.1:3000` 的 WebView 源上，`localStorage` 可用。**边界必须写进文案**：服务端零持久化（`grep -rn "writeFile\|persist" server/*.js` 只命中 `server/admin.js:68` 的一句注释），所以跨设备归零、清缓存/重装即失；mockup 的「共 N 位博士上榜」**不实现**。
  - `public/js/screens/result.js:100-106` 与 `public/js/ui/gameLogic/result.js:47` 加无尽分支。
  - `public/index.html`：新 `<link>` 必须插在 `:42` 的 `/css/devices.css` **之前**（`test/client-static.test.js:1191` 断言它是最后一个样式表）。
  - **质量门禁扩根**（这一步是无尽包的立身之本）：`test/es2020-syntax.test.js:23-34` 的 `dirs` 加 `public/endless/js`；`test/client-static.test.js:147/1172` 的 walk 根加 `public/endless/js`、`public/endless/css`。
  - `server/index.js:152 BUILD_INPUTS` 加 `'public/endless/js'`、`'public/endless/css'`，同步改 `test/build.test.js:27`（主包里该目录不存在 → 0 条目 → 主包 build tag 不受影响）。
- **交付物**：独立入口按键 + 独立出击前屏 + 局内/结算无尽分支；新目录进入两道质量门禁与 build tag。
- **红线**：**`public/js/**` 里的任何共享文件不得对 `public/endless/**` 有顶层静态 import**；只能「能力位为真时的动态 import」。否则主包（排除 `public/endless/`）会 `ERR_MODULE_NOT_FOUND`（与 P0 的 H1 同类缺陷，对齐 C16）。
- **验收**：
  1. `node --test test/client-static.test.js test/es2020-syntax.test.js test/build.test.js` 全绿；
  2. 主包桌面端暂存里 `grep -r "public/endless" app/public/js` 只命中能力位守卫行，无静态 import；
  3. 真服务器实景：**用 `SP_ENDLESS` 钩子注入到临时 data 目录**（不碰仓库 `data/`）后打开页面 → 主页出现独立按键 → 进入无尽 → 打到 R16+ 有敌人、R21 有领袖战、结算显示「存活回合」；改一版 `public/endless/js` 后 `/healthz.build` 变化、已打开页面重载（`public/js/ui/buildGuard.js`）。
- **依赖**：P2（门控读的就是那 4 条 mode）。
- **预计规模**：2–3 人日。

### P4 · 无尽包出齐（Android flavor + 双包验收 + 版本与更新通道）

- **目标**：主包与无尽包**两套 APK 能装在同一台设备上**；无尽包的门禁 2 通过；版本与更新通道定死。
- **要动的文件**：
  - `shared/constants.js`（新增 `ENDLESS_VERSION`）+ `public/shared/constants.js`（同源镜像，两份必须逐字节相同）。
  - `android/app/build.gradle`：`defaultConfig`（`:16-27`）之后加 `flavorDimensions += "edition"` 与 `productFlavors { main {}; endless { applicationIdSuffix ".endless"; versionCode 100 } }`（flavor 后缀可与 buildType 后缀叠加 → `com.paper.stronghold.endless.debug`）。
  - `scripts/build-android.mjs`：`:13` 旁加 `FLAVOR` 解析；`:148 VARIANT` → 由 flavor × buildType 拼任务名（`assembleMainRelease` / `assembleEndlessRelease` / …）；`:158 gradleArgs` 用任务名；`:149 outDir` 加 flavor 段；`:154-156` 的三个候选产物路径跟 flavor；`:197` 产物名带 flavor；`:139-144` 调 `tools/bundle-android.mjs` 时**透传 flavor**（两个 flavor 的 `app_bundle.zip` 内容不同）。
  - `tools/bundle-android.mjs:15 ZIP_TARGET` 是固定路径 → **两个 flavor 必须串行构建**（`app_bundle.zip`/`bundle.sha256` 在 `.gitignore:55,56`，覆盖不弄脏工作树）。
  - **版本**：主包继续用 `shared/constants.js:6 APP_VERSION`；无尽包**新增** `ENDLESS_VERSION`（不复用 `APP_VERSION`，否则 `test/version.test.js:18/27/31/35/38/39` 六处会挡）。**落点必须是 `shared/constants.js` 与它的镜像 `public/shared/constants.js`，两份逐字节相同**——门禁 3 的 6 组允许差异里**不含** constants.js，即它必须在主包与无尽包里**声明一次、值相同**（在主包里是一个未被读取的常量，无害）。**不要做成「只在无尽包里改 constants.js」**，那会当场触发门禁 3。`test/version.test.js` 的六处断言只钉 `APP_VERSION`，新增常量不影响它们。
  - **更新通道**：本轮**不新增自更新器**（仓库里不存在任何版本清单/更新检查，`plan-drafts/packaging-final.md` §2.6 #22）。唯一机制 = `/healthz.build`（`server/index.js:152/177/194`，`/healthz` 在 `:767`）+ `public/js/ui/buildGuard.js`，P3 已把无尽 UI 纳入。
- **交付物**：两个 flavor；`dist/mobile/main/` 与 `dist/mobile/endless/`；`ENDLESS_VERSION`。
- **验收**：
  1. **门禁 2**：`desktop --endless` 的暂存里 `public/endless` 存在、两份 `capabilities.js` 含 `ENDLESS = true`、`data/config.json` 有 4 条 `mode_single_endless_*`；
  2. `mobile --endless --release` 的 `SHA256.txt` 与主包目录里的不同；两个 APK 的 `applicationId` 不同（`.endless`），同机可并存；
  3. **门禁 6（回归）**：`node --test`（分套）全绿 + `node scripts/pack/index.mjs all` 三端产物形状与今天一致（`scripts/pack/server.mjs:52`、`desktop.mjs:46` 的 ZIP 自检仍打印）；
  4. mobile 打包必须在**干净工作树**上跑（`scripts/build-android.mjs:92-97` 记录 `git status --porcelain`，`:180-191` 在 Gradle 后比对，任何差异即 `exit 1`）。
  5. **无尽包冒烟（形状断言之外，必须实跑）**：桌面无尽包解压 → 起本地 Node → 打开页面 → **主页出现独立按键** → 进入无尽 → 打到 **R16 有敌人、R21 有领袖战** → 结算显示「存活回合」；无尽 APK 安装后**飞行模式离线**跑同一条路径。
  6. **主包负向冒烟**：主包桌面/APK 启动后**主页不出现无尽按键**，且手动构造 `room.create{variant:'endless'}` 被 `ERR.BAD_MSG` 拒绝。
- **依赖**：P1（机制）、P2（数据）、P3（UI）。
- **预计规模**：2–4 人日（Android flavor 是本计划里最大的一块单点工作量）。

### P5 · pack 运行时与索引（内容层交付方唯一化）

- **目标**：把「包」变成可枚举、可校验、可分发的东西；**纯仓库内**，不等 CF。
- **要动的文件**：
  - **新增** `server/packs.js`：`loadPackIndex()` / `packById(index, id)`（唯一交付方 = 本阶段，对齐 C11）。
  - `server/index.js` 挂载表（`:394-398`）：`/packs/` 不需要新挂载（`:398` 的 `/` → `public/` 已覆盖 `/packs/**`）；需要的是 `shared/packs.js:43` 声称的 `server/http/static.js` **不实现**，改为在现有 static handler 上加索引特判（`/packs/index.json` 由生成物提供）。
  - `shared/packs.js:55-62`：`PACK_TYPES.data` 从 `planned` 升 `supported` 并补 `files` 角色；**`files` 的形状从「role → 单路径」改成「role → 数组」**（一个 role 只能一个文件的现状表达不了多个 kit，`plan-drafts/modcontent-final.md` §2.9）。
  - **包目录落点 = `public/packs/<id>/**`**（对齐 C4：`tools/bundle-android.mjs:60-64` 只复制 `server/shared/data/public/package.json` → 仓库根 `packs/` 永远进不了 APK；`server/index.js:398` 的 `/` 挂载让 `public/packs/` 自动成为 `/packs/**`）。撤回 `shared/packs.js:44` 之外的任何根目录 `packs/` 方案。
  - 索引生成：从 `public/packs/*/pack.json` 生成 `public/packs/index.json`（`{version, app, packs:[{id,name,hash,app}]}`）——**这是房主弹窗的唯一数据源**（对齐 C10：撤回 `data/packs.json` 这个名字）。
  - 校验器（复用真引擎的分层校验 + 三道内容门禁，见 §6）。
- **交付物**：`server/packs.js`；`PACK_TYPES.data` 扩形状；`public/packs/index.json` 生成步骤；`pack.json` 的包级内容 hash（对包内每文件 sha256 汇总）。
- **验收**：
  1. `test/` 内新增：`PACK_TYPES.data` 的 `files` 数组形状被 `shared/packs.js:192-202` 接受；非法包 id / 空内容 / 坏 JSON → 跳过并报告（fail-closed），服务器继续跑；
  2. `curl` 打本地服的 `/packs/index.json` 返回索引；`/packs/<id>/<file>` 返回文件；
  3. 包级 hash 复算一致；两端可独立复算。
- **依赖**：P0、P1。
- **预计规模**：2–3 人日。

### P6 · mod 内容层（逐房合并 + 去单例 + 客户端合并路径）

- **目标**：房主选的包只影响**这一间房**；服务器与客户端看到同一份合并快照。
- **要动的文件**（**这是本计划最大的一块**）：
  - **新增** `server/mod/overlay.js`：纯函数 `mergeOverlay(baseData, packs) → { data, hash }`（默认只加法、覆盖需显式 `overrides`、fail-closed），**返回前调 `server/data.js:38` 导出的 `deepFreeze`**。
  - **新增** `shared/contentSnapshot.js`：合并 + hash 的**双端共用**实现（放 `shared/`，`tools/sync-static-web.mjs:27` 会镜像到 `public/shared/`）。
  - **内容层去单例化**（采纳 `plan-drafts/localcompute-final.md` §3.2 的清单，对齐 C7）：
    - `server/sim/content/support/index.js:37-44` 的 `DATA` 与 `:81-89` 的 `CORE` → **按 data 对象分桶**（不是「传个参数」，两个并发 mod 房 + 一个官方房仍只有一份）；`:48-53` 六个 `*Record(id)` 加 `data = gameData()` 默认参；`:119 topActiveBond` 同理。
    - `server/match/effectsMeta.js:116-126 createRegistry` 传 `data` 给 `registerBuiltins`；`:129-132 getDefaultRegistry` 保留（官方房行为逐字节不变）；`server/match/builtinMeta.js:296-297` 已接受 data 参数，只需调用方传。
    - `server/sim/content/index.js:210-215`、`bands/meta.js:495-498/486/383`、`choices.js:298-299/162/190/361` 把 data 绑进 handler 闭包。
    - `server/match/Match.js:265` 保留 `opts.registry || getDefaultRegistry()`，但 `server/lobby.js:988-1005` 的 Match opts 里**必须传房级 `registry`**。
    - **battle 侧 16 处**（`bands/battle.js:212,253,258`；`bonds/addon/battle.js:89`；`bonds/core.js:68,78,85,216,634`；`garrisons/battle.js:82,91,163`；`items/battle.js:111,115,862,924`）：让 `Battle` 额外保留 `opts.data`（`server/sim/Battle.js:91` 旁加一行），helper 从 battle 取。**这一条只在选「能力 A」时必须做**（§8 决策 D15）。
  - `server/lobby.js`：`:494 create()` 接 `packs`；`:511 new Room(...)` 后写 `room.modData`；`:998 data: room.modData ?? this.safeData()`；`:829/858/884/901` 四处玩家级校验改用 `room.modData ?? this.safeData()`（**不改这四处，mod 干员在 `room.loadout` 就被拒**）。
  - 客户端合并路径（建议取 `plan-drafts/modcontent-final.md` §2.3 的**路径 (a)**）：`public/js/data.js:116` 的 `base` 从固定字符串改成可取值函数（`:273 export const data = createDataStore()` 是**导入期创建的单例**，这是主要改动量）；`public/js/battle/runner.js:142 loadBrowserSim({ dataBase })`（`:186` 注入点已存在）；端点未命中**必须回落到静态文件**（`:155-157` 缺任一 `SIM_DATA_FILES` 就 `throw`）。
- **交付物**：逐房合并；去单例化；客户端合并；`shared/contentSnapshot.js`。
- **验收**：
  1. `test/match/*` + `test/golden/*`：**无包时行为逐字节不变**（`public/js/battle/runner.js:139-141` 的「never run one」告警、`server/match/pool.js:25-40` 的抽签都不许漂移）；
  2. 新测试：同一进程内「官方房 + 两个不同快照的 mod 房」并发开局，各自卡池/商店/结算互不污染；
  3. 新测试：启用任意 pack 后，4 条无尽 mode 仍在且 `lastRound === 0`（无尽锁的数据面，`plan-drafts/endless-final.md` §2.8 第 4 道锁）；
  4. `server/match/fields.js:834` 的 `bad('bond')` 在 mod 房下不再触发（服务器持有同一份快照）。
- **依赖**：P5。
- **预计规模**：4–6 人日（battle 侧 16 处 + 客户端 base 可变是主要成本）。

### P7 · 房主弹窗与强制私密房（协议 + 令牌 + 一致性）

- **目标**：只有房主能选；选了 ≥1 个包 ⇒ 房间强制私密，只能凭邀请码/邀请链接进入；房内只做只读显示。
- **要动的文件**：
  - `shared/protocol.js:297 room.create` **并列**加 `variant`（P2 已定语义）与 `packs`（`$optional`）；`:298 room.join` 与 `:323 room.spectate` 各加 `key`（**不改 `code` 的长度语义**，令牌走独立字段）；新增一条 C2S 消息 **`client.content`**（照 `:317 client.bundle` 的形状，payload = `{ packs:[{id,hash}], snapshotHash }`——**一条消息两层**，对齐 C12）；`S2C`（`:378-391`）加 host-only 的 `room.inviteKey` 单播。
  - `server/lobby.js`：`Room`（`:155-187`）加 `variant`/`private`/`packs`/`inviteKey`/`modData`/`contentHash`（**一次加全**，对齐 C8）；`toState()`（`:204-219`）带 `variant`/`private`/`packs`/`contentHash`（**不带 `inviteKey`**）；`create()`（`:494`）的校验顺序**不可调换**：① endless 锁（`variant==='endless' && packs` 非空 ⇒ `ERR.BAD_MSG`，**唯一实现者 = 本阶段**，对齐 C9）② mode 门（`packs` 非空 ⇒ `mode==='coop'`）③ 索引存在性 **fail-closed**（索引缺失 ⇒ 拒绝带包创房，不是放行）④ 逐项 `packById` 命中 + hash + `app` 区间 ⑤ 房主 `client.content` 覆盖比对 ⑥ 写字段 + `room.private = packs.length > 0` + 生成 `room.inviteKey`。
  - **`client.content` 与 `room.create` 的时序（必须写死，否则第 ⑤ 步无数据可对）**：客户端在连接建立/`hello` 之后**立即**上报 `client.content`；服务端第 ⑤ 步读 `session.client.content`，**缺失即拒绝带包创房（fail-closed，与索引缺失同处理），不是「跳过比对」**。第 ⑤ 步比对的对象就是**发起创房的那个会话**（房主自己即发起人），因此不存在「等别人上报」。客户端收到 `ERR.BAD_TARGET`/`ERR.BAD_MSG` 后：重新上报 `client.content` → 重试一次 → 仍失败则提示「本地内容与所选包不一致」并关闭弹窗，**不降级成不带包创房**。
  - `server/lobby.js:527-550 join()` / `:646-670 spectate()`：私密房要求 `key`（等长比较），失败返回**与「房不存在」同码** `ERR.ROOM_NOT_FOUND`（不给探测信号）；新增 `joinFailPerMin`（默认 20）滑动限流（复用 `:499-505` 的 `limitKey` 范式）。
  - `server/lobby.js:562-594 getLobbyStats()`：`:573` 的 coop 过滤后加 `if (r.private) continue;`（一处覆盖 `lobby.stats` 与 `room.list`，`:632-642 listRooms()` 首行即 `getLobbyStats()`）；`:588 roomsCount` 扣掉私密房。
  - `server/matchmaking.js:66-94 enqueue()`：私密房拒绝（新错误码 `PRIVATE_ROOM`，范式见 `shared/constants.js:129/151`）；**明确推翻** `docs/MATCHMAKING_PRIVATE_ROOMS_PLAN.md:61` 的既有决定（这是设计反转，不是补漏）。
  - `server/index.js:780-789 /lan/room`：私密房要求 `key`，否则 404。
  - `public/js/screens/createRoomModal.js`（**新增**，用 `public/js/ui/components.js:395` 的 `Modal`）+ `public/css/mod.css`（新增）；`public/js/screens/lobby.js:454 create()` 加 `if (!MODS) … else openCreateModal()` 钩子（动态 import）。
  - `public/js/screens/room.js`：`inviteLink` `:71-76` 带 `key`；`InviteBox` 落点 **`:164` 的标签行**（对齐 C-H4：`:307-310` 归无尽轴、`:321-343` 本块也不碰）；`:333` 的「匹配队友」对私密房不渲染。
  - `public/js/main.js`（`client.content` 上报接线、深链 `key`）、`public/js/store.js:90 ui.pendingJoin`。
  - `android/.../NetworkUtils.kt:127/151`（`findRoom(code,key)`）——**开工前必须确认 `sp-android-client` worktree 的归属**（对齐 C25）。
- **交付物**：弹窗；`room.create.packs`；强制私密 + 令牌 + 限流；`client.content` 比对；房内只读显示。
- **验收**（照 `plan-drafts/modflow-final.md` §5.1 的 11 条，落在 `test/lobby.test.js` / `test/matchmaking.test.js` / `test/admin.test.js`，不新起文件）：
  1. 带 `packs` 建房 → 不进 `lobby.stats.rooms` / `room.list.rooms`，`roomsCount` 不增加；
  2. 只带 `code` join 私密房 → 失败且错误码 == `ERR.ROOM_NOT_FOUND`；连续 21 次错误 join → `ERR.RATE`；
  3. `/lan/room` 对私密房不带 `key` → 404，带正确 `key` → 200；
  4. `mode:'solo' + packs` → `ERR.BAD_MSG`；`variant:'endless' + packs` → `ERR.BAD_MSG`；
  5. 索引为 null 时带包创房 → 拒绝（**不是放行**）；
  6. 私密房 `enqueue()` → `{ error:'PRIVATE_ROOM' }`；
  7. **握手 fail-open 兜底**：新客户端 → 旧服务器发 `room.create{packs}` 时，旧服务器静默丢字段的行为**必须被客户端侧识破**（收到 `room.state` 不带回自己请求的 packs/hash ⇒ 不当作 mod 房）；`create()` 侧对任何非空 `packs` 无法解析出快照时**拒绝创房，不降级成普通房**。
- **依赖**：P5、P6、P1。
- **预计规模**：3–4 人日。

### P8 · 素材走 CF（URL 契约 + 3D 棋盘 + 降级）

- **目标**：进入服务器时素材不经过游戏服务器；含 3D 棋盘素材。
- **要动的文件 / 动作**：
  - **门禁 0（无代码改动，不过不许开工）**：查清 CF Pages 项目的构建输出目录与 `/assets/*` 今天由 Function 还是 Pages 静态兜住、Pages 域名、R2 是否开通、隧道域名与 Pages 是否同 zone、生产主服上有没有 `data/local-assets.json` 与 `public/assets/local/**`。交付物 = 写进仓库的 `wrangler.toml`（`pages_build_output_dir` + `r2_buckets`）+ 五条书面答案。
  - **新增** `tools/push-assets.mjs`：镜像 `public/assets/**` **全量 13,101 文件**（**不用 manifest 当上传清单**，manifest 只登记 11,614 条）+ `public/fonts/**` + `data/local-assets.json` + **`public/packs/<id>/assets/**`（mod 素材）**；key = 相对路径；`put` 后 `head` 回读 etag 校验。
    - **mod 素材这一条不能省**：§3.1 与 P9 把 `public/packs/<id>/assets/**` 排除出 headless（「走 CF」），如果 push-assets 不推 `public/packs/**`，**headless + CF 部署下 mod 素材无人提供**——两头都以为对方在发。
  - **必须显式跟随符号链接**（方向 ④ 能不能达成，全靠这一条；失败方式是静默的）：`public/assets` 下 11 个一级条目是 symlink（`audio band bond enemy item local prof skill spine token ui`），`public/assets/local -> /e/Workbox/系统/public/assets/local/`，**3D 棋盘贴图就在 `local` 下面**。实测 `find public/assets -type f` = **271**、`find -L public/assets -type f` = **13,101**。用 `readdirSync(withFileTypes)` 或裸 `find` 会「上传成功、HTTP 200 正常、只是 3D 退回 2D」。**验收必须含计数断言：上传对象数 ≥ 13,101**（「抽 20 条 URL 都返回 200」查不出这个）。
  - 改 `functions/assets/[[path]].js` 第 2 层（`:20` 的 `onrender` 硬编码 → `env.RENDER_FALLBACK_URL || ''`，默认关）；新增 `functions/media/[[path]].js`、`functions/data/local-assets.json.js`；隧道外壳侧按 §5 的决策挂 Worker 路由或维持主服发。
  - **版本化**：新增 `rev` 字段（生成处 `tools/fetch-assets.mjs:319` 附近），URL 拼 `?v=<rev>`；修 `public/js/assets.js:203` 的 query 敏感比较（否则 `localSpineEntry()` 全灭）；`public/js/screens/diy.js:169` 改 manifest 查表、`:183` 兜底拼 `rev`。
  - 修 `functions/assets/[[path]].js:44` 的 jsdelivr 正则（4 段 vs 3 段，实测 1057 条 skel 只有 341 条命中）。
- **交付物**：R2 镜像；出口；`rev`；`wrangler.toml`。
- **验收**（照 `plan-drafts/assets-final.md` §4 阶段 1 的 8 条，全部实跑）：**R2 侧对象数 ≥ 13,101（证明跟随了符号链接）**；`/assets/...` 200 + etag + 304；`Range` → 206；`/media/<bgm>` → 200 `audio/mpeg`；**`/assets/local/map/autochess/TX_autochessi_D.webp` → 200**（**这条只有跟随 `local` symlink 才可能通过**）；**`/data/local-assets.json` → `source:"local-client"` 且 `count:1481`**；随机抽 20 条（**样本必须同时来自 `data/assets.json` 与 `data/local-assets.json`**）；关掉 Render 后 1–7 全绿；`node --test test/assets.test.js test/media-url.test.js test/preload.test.js test/client-static.test.js` 全绿。
- **依赖**：P0；R2 段依赖门禁 0。**`/packs/**` 的仓库内部分已在 P5 完成，不依赖门禁 0。**
- **预计规模**：2–4 人日 + 门禁 0 的等待。

### P9 · 服务器只保留 mod 对局必需部分（三包体收口）

- **目标**：按「素材走 CF + pack 走 `/packs/**` + 服务器持有 mod 数据与 kit」把服务器产物收口；headless 的定位定死。
- **要动的文件**：`scripts/make-headless-server.mjs`（`ALLOW_TRACKED_PREFIXES:48`、`EXCLUDE_PREFIXES:70`、`local-assets` 复制 `:524-529`）；`scripts/make-server-bundle.mjs:50/74`；`scripts/pack/server.mjs`；`server/index.js` 的静态挂载与 `/packs/` 索引；`server/admin.js:203-213` + `public/admin/admin.js:238-245`（私密房可见性，§8 决策 D14）。
- **交付物**：§3 的构建矩阵落地；服务器保留/可去清单。
- **验收**：
  1. **产物冒烟（三条可执行步骤，替代纯形状断言）**：
     - **headless**：解压 → `node server/index.js` 起服 → `/healthz` 200 → 建一个官方 coop 房 + 一个带 `packs` 的 mod 房 → **mod 房放一个 bot 座位跑完一轮** → `SP_VERIFY=all` 下 `_verifyResult` 无 mismatch；
     - **完整服务器包**：离线启动 + 3D 棋盘可用；
     - **主包桌面/APK**：启动后主页**无**无尽按键。
  2. headless 包解压后 `public/assets/` 为空、**`data/local-assets.json` 为空桩（不是真清单）**、游戏能启动；
  3. §3.1 内容矩阵逐格核对通过（含 `public/packs/<id>/**.json` 在 headless 里存在）。
- **依赖**：P5、P6、P8。
- **预计规模**：1–2 人日。

---

## 3. 分开打包：构建矩阵

### 3.1 内容矩阵（替代「两套互不引用的两种包体」，对齐 C14/C6/C20）

| 内容 | 主包（server/desktop/mobile） | 无尽包（desktop/mobile） | headless 服务器包 |
|---|---|---|---|
| `server/` `shared/` `data/` `public/`（除 `endless` 相关） | ✅ | ✅ | ✅ |
| `public/assets/**`（官方素材） | ✅ | ✅ | ❌（走 CF） |
| `public/assets/local/**` + `data/local-assets.json` | ✅ | ✅ | ❌ **且必须空桩**（修 `:524-529` 的假清单缺陷） |
| `public/packs/<id>/**.json`（mod 数据 + `pack.json`） | ✅ | ✅ | ✅（否则 mod 房算不了） |
| `public/packs/<id>/assets/**`（mod 素材） | ✅ | ✅ | ❌（走 CF，**且 P8 的 `push-assets.mjs` 必须推 `public/packs/**`**，否则这一格无人提供） |
| `server/sim/content/kits/**`（含 mod kit） | ✅ | ✅ | ✅ |
| `endless/**` + `public/endless/**` | ❌ | ✅ | ❌ |
| `shared/capabilities.js` + `public/shared/capabilities.js` | `ENDLESS=false, MODS=true` | `ENDLESS=true, MODS=false` | `ENDLESS=false, MODS=true` |

- **`MODS` 位的诚实边界**（对齐 C21）：无尽包**物理上仍带全部 mod 数据与 kit**（方向 ② 要求本地全量包必含全部 mod）。因此「不能加载 mod」的精确含义 = **不出现 mod 入口 + 服务端拒绝 `packs` + 不合并 mod 数据 + 无尽屏不渲染 pack UI**（`plan-drafts/endless-final.md` §2.8 的四道锁）。**代码加载门控不了**：`kits/*.js`、`bonds/*.js` 的 installer 在任何进程/页面加载时都会执行（`plan-drafts/modcontent-final.md` §3 第 4 条）。若需求要求「物理上不含 mod 代码」，那只能放弃「本地全量包必含全部 mod」——两者不可兼得（§8 决策 D26）。
- **主包允许残留的字节**：只有 `public/js/screens/title.js` 的能力位守卫行、`public/js/screens/lobby.js` 的 `MODS` 守卫行、`shared/capabilities.js` 的 `ENDLESS = false`。门禁 1 因此断言「目录不存在」而不是「零命中字符串」。

### 3.2 共享代码怎么复用而不分叉

1. **单源**：`server/`、`shared/`、`data/`、`public/`（除 `public/endless`）、`package.json` 逐字节相同。
2. **差异只允许 6 组**（门禁 3 的显式允许清单）：两份 `capabilities.js`、`endless/**`、`public/endless/**`、`data/config.json`、`public/data/config.json`。
3. **差异的产生方式**：全部在**暂存副本**里改，源文件不动。纪律先例：`tools/bundle-android.mjs:19-28`（打包器禁止自动修改受控文件）、`tools/sync-static-web.mjs:43-51`（构建期对副本做改写）。
4. **新字节只放新目录**：无尽快独有的东西进 `endless/`（打包器脚本 + overlay）与 `public/endless/`（UI）；mod 独有的进 `public/packs/`。**没有 bundler**（`docs/DESIGN.md` 的 no-bundler 约束），所以排除靠「按路径丢文件」，不靠树摇。
5. **跨目录引用纪律**：被排除目录里的模块**只能被动态 import**，且必须在能力位分支内。共享文件里的守卫写成 `if (MODS)` / `if (ENDLESS)`，**不得有顶层静态 import**（对齐 C16）。建议加一条门禁：扫 `public/js/**`、`server/**` 里对 `public/endless`、`endless/`、`public/packs` 的静态 import。
6. **符号链接与「全量」的关系**：`public/assets/**` 的 11 个一级条目是 symlink（含 `local`，3D 棋盘贴图所在）。所有「全量素材」步骤——Android 的 `tools/bundle-android.mjs:63` 复制 `public/`、CF 的 `tools/push-assets.mjs`——**必须跟随链接**，判据用**文件计数（≥13,101）**，不能用「抽样 20 条 URL 都 200」。

### 3.3 版本与更新通道

| 项 | 主包 | 无尽包 |
|---|---|---|
| Web/桌面/服务器版本 | `APP_VERSION`（`shared/constants.js:6`），被 `test/version.test.js:18/27/31/35/38/39` 钉住 | **新增 `ENDLESS_VERSION`**（不复用 `APP_VERSION`） |
| `shared/constants.js` + `public/shared/constants.js` | **逐字节相同** | **逐字节相同**（门禁 3 的允许差异**不含** constants.js ⇒ `ENDLESS_VERSION` 只声明一次、两包同值，主包里是一个未被读取的常量） |
| Android 版本 | `build.gradle:20 versionCode 21` + flavor `main` | flavor `endless` 用独立自增序列（如 100+），`applicationIdSuffix ".endless"` |
| 更新检查 | **不存在**（无版本清单/更新器） | 同上；唯一机制 = `/healthz.build`（`server/index.js:152/177/194`）+ `public/js/ui/buildGuard.js` |
| 产物目录 | `dist/{server,desktop,mobile}/<主包名>` | `dist/desktop/<name>-Endless-*`、`dist/mobile/endless/` |
| 发布入口 | `node scripts/pack/index.mjs all`（`all` 语义不动） | 新增 `pack:endless` / `pack:endless:mobile` |

**本轮不做自更新器**：没有既有基础设施，且 `test/version.test.js` 的六处耦合会让「两条版本序列」的改动面变大。要加就单开一轮（§8 决策 D3）。

---

## 4. mod：全量包内置 + 本地计算 + 与服务器对接

### 4.1 数据流（谁解析 / 谁合并 / 谁校验）

```
[构建期]
  public/packs/<id>/pack.json + *.json（内容数据）+ assets/**
  server/sim/content/kits/ops/<name>.js  →  登记 kits/index.js 的 KIT_FILES  →  重跑 tools/build-kits-registry.mjs（写 server + public 两份）
  mod 素材 → 复制进 public/packs/<id>/assets/**  →  合并进 data/assets.json 与 public/data/assets.json（两份都要）
  生成 public/packs/index.json = {version, app, packs:[{id,name,hash,app}]}      ← 弹窗的唯一数据源
  kit 校验：ES2020 可解析（test/es2020-syntax.test.js:23-34）+ 确定性静态检查 + 装备效果完整性

[运行期 · 客户端]
  启动读 /packs/index.json（本地服务器发，APK 离线可用）→ 房主弹窗勾选项
  本地合并：shared/contentSnapshot.js  →  snapshotHash

[运行期 · 服务端]
  房主 room.create{mode:'coop', difficulty, variant, packs:[{id,hash,app}]}
    → create() 六步校验（P7）
    → room.modData = mergeOverlay(this.safeData(), packs)（deepFreeze 后）   ← 服务端合并，逐房
  加入者 room.join{code, key} + client.content{packs, snapshotHash}  → 服务端比对，不一致 ⇒ 不给座位
  开局：m.public.contentHash  → 客户端在 loadBrowserSim 之前比对，不等 ⇒ 不跑那一场
  对局：战斗逐 tick 在客户端（默认 Match.js:169 envClientCombat）；服务器持有同一份快照 + kit，可随时重算
  结算/观战：服务器有快照即可（results.js:90-98 buildResult 用 m.gd 取名字）
```

**解析方**：客户端与服务端**各自解析**同一份 pack 目录（`shared/contentSnapshot.js` 是双端共用实现）。
**合并方**：服务端**逐房**合并（`server/mod/overlay.js`）；客户端为渲染/仿真在本地合并同一份。**绝不在 `server/data.js` 的 `loadData` 里合并**——那里是进程级单例（`server/data.js` 的 `let singleton` + `server/index.js:671-675`），会让 mod 泄漏进所有非 mod 房（`plan-drafts/modcontent-critique.md` §3-H2）。
**校验方**：服务端做 id/hash/app 的存在性比对 + 内容感知的合法性（卡池/商店/波次/校验都是内容感知的，`server/match/fields.js:834` 缺羁绊即整份结果被拒）；**服务端不 import 客户端提供的 JS**（红线见 §7）。

### 4.2 握手带什么

| 层 | 内容 | 载体 | 理由 |
|---|---|---|---|
| 包集合 | `[{id, hash, app}]` | `room.create.packs` + `client.content.packs` | 证明「拿了哪些包、版本区间对不对」 |
| **合并快照** | `snapshotHash` | `client.content.snapshotHash` + `m.public.contentHash` | `packs:[{id,hash}]` **只证明拿了哪些包，不证明合并结果一致**（官方 `data/*.json` 一变，合并结果就变） |
| 包级完整性 | `pack.json` 的每文件 sha256 汇总 | 只在包内自校验 | 与「合并快照 hash」是两个不同层次 |
| 引擎版本 | **降级为可选** | 不建议独立字段 | `public/sim` 落后 `server/sim` 26 个文件是**构建期镜像过期**，修法是重跑 sync + 门禁（P0），不是版本协商 |
| 协议版本 | **不动** | — | `shared/constants.js:3 PROTOCOL_VERSION = 1`；`server/net.js:651-652` 不等即拒绝 hello ⇒ 升版本会**在第一帧打掉所有旧客户端** |
| `hello` | **不动** | — | `shared/protocol.js:295` 只有 `name/token/version`；`client.content` 照 `:317 client.bundle` 的形状**新增独立消息** |

**一条消息两层**（对齐 C12）：`client.content` 同时带 `packs` 与 `snapshotHash`；`client.bundle`（`:317`，已有 `server/lobby.js:922-932` 的语义）保持不动，两者并列上报。

### 4.3 服务器最少需要什么（能力矩阵）

**结论：只有 hash 不成立。** 卡池的唯一来源是服务器自己的 chess 数据（`server/match/pool.js:56-68` 只遍历 `gd.visibleChess`，过滤条件在 `server/match/gamedata.js:76-79`）；校验与编排都是内容感知的。但「快照」要拆成两件：

| 件 | 服务器必须持有吗 |
|---|---|
| **数据快照**（合并后的 chess/items/bonds/effects/… JSON） | **必须**（卡池、商店、校验、编排、结算） |
| **kit**（`server/sim/content/kits/ops/*.js`） | **只有在服务器需要重算 mod 战斗时才必须** |

| mod 房规则 | 服务器需要 | 代价 |
|---|---|---|
| **A. 全能力**（与官方房一致：允许 bot、允许掉线接管、`SP_VERIFY` 照跑、安卓 `compat_mode` 照跑） | 数据快照 **+ kit** | 服务器包内置全部 mod kit；内容层去单例要**含 battle 侧 16 处**；与「房内只做简单显示」相容 |
| **B. 只算元游戏**（禁 bot、禁接管、mod 房关 `SP_VERIFY`、`compat_mode` 下 mod 房不可开） | 只要数据快照 | 内容层只需改 prep 侧；**但要在房间规则 + UI 上钉死四条**，与方向 ②「房内不做改动」冲突；且安卓 `compat_mode` 是**进程级**环境变量（`NodeServerService.kt:198-199` 启动时设一次），**今天无法按房间粒度表达** |
| **C. 只做信令** | 什么都不需要 | **走不通**：消灭权威对局（`server/match/` 就是权威本体）、种子落到房主（`server/lobby.js:984-985`）、重连/托管依赖服务器状态 |

**推荐 A**（§8 决策 D15）。选 A 的三个必须动作：① mod 房不额外禁 bot，但 `room.state` 要让客户端知道本房是 mod 房（否则 `compat_mode` 用户看到「本地不跑、服务器跑」）；② mod 房不进撮合池（P7 已定）；③ 观战者收到的是状态帧，不需要 mod 数据。

**如实说的反直觉结论**：在当前架构下「本地算 mod」**几乎不降低服务器 CPU**（默认客户端权威，服务器本来就不跑在线人类的战斗；bot 排练 `Match.js:158` 每轮 3 场、接管重算 `:2376-2382`、`SP_VERIFY:2613-2634`、安卓 `compat_mode` 在 mod 房里与官方房同量级）。**它是一条正确性方案，不是性能方案。**「降低服务器压力」的真实杠杆是**素材走 CF**（P8）与 **pack 不走服务器静态分发**（P9）。

### 4.4 房主弹窗与强制私密房的协议落点（汇总）

| 落点 | 文件:行 | 内容 |
|---|---|---|
| 协议 schema | `shared/protocol.js:297` | `room.create` **并列**加 `variant` + `packs`（`$optional`） |
| 令牌入房 | `shared/protocol.js:298` / `:323` | `room.join` / `room.spectate` 加 `key` |
| 一致性上报 | `shared/protocol.js`（新，照 `:317`） | `client.content { packs, snapshotHash }` |
| 令牌单播 | `shared/protocol.js:378-391` | `S2C` 加 host-only `room.inviteKey` |
| 房间字段 | `server/lobby.js:155-187` | `variant` / `private` / `packs` / `inviteKey` / `modData` / `contentHash`（一次加全） |
| 状态下发 | `server/lobby.js:204-219` | 带 `variant`/`private`/`packs`/`contentHash`，**不带 `inviteKey`** |
| 强制私密 | `server/lobby.js:494` | `room.private = room.packs.length > 0`（**服务端自算，忽略客户端传的 `private`**） |
| 可见性 | `server/lobby.js:573` / `:588` | `if (r.private) continue;` + `roomsCount` 扣减 |
| 撮合排除 | `server/matchmaking.js:66-94` | 私密房 → `PRIVATE_ROOM` |
| 局域网 | `server/index.js:780-789` | 私密房要求 `key`，否则 404 |
| 房内显示 | `public/js/screens/room.js:164` | `🔒 私密 · 包名`（只读，不做选择器） |

---

## 5. 素材走 CF：URL 契约与降级策略

### 5.1 URL 契约

| 路径 | 谁发 | 缓存 | 备注 |
|---|---|---|---|
| `/assets/**` | **CF（R2 绑定）**，服务器兜底 | 现在 30d immutable → 改 `?v=<rev>` | `functions/assets/[[path]].js:33/60` |
| `/fonts/**` | 同上 | 同上 | |
| `/media/<无扩展名>` | **CF 必须实现**（按 `AUDIO_EXTS` 试 R2 key） | 1d | 不实现则音频仍走主服（`server/index.js:434-438/501-543` 实现了它 → 静默不算实现） |
| `/assets/local/**` | R2 + **本地包内置层** | 同 `/assets/**` | 3D 棋盘贴图/网格（`data/local-assets.json` 的 1,481 条**全部** `/assets/local/…`） |
| `/data/local-assets.json` | **CF 也要发** + 本地包内置 | `no-cache` | **3D 棋盘的开关**；缺失 → `source:'none'` → `boardArtListed()` false → 静默降级 2D |
| `/packs/<id>/**` | 服务器 `/packs/**`（= `public/packs/`）+ CF 同前缀 | 独立策略 | **不要混进 `/assets/*`**，两者必须能分别统计与设缓存 |
| `/vendor/three.module.js` | **app 外壳**，不进 R2 | | 3D 棋盘 = 贴图/网格（R2/本地）+ three.js 运行时（外壳） |
| `/data/*.json`（除 `local-assets.json`） | 服务器 | | 游戏逻辑，服务器权威 |
| `/sim/**`、`/js/**` | 服务器/外壳 | | **不进 R2** |

**推荐做法：所有素材 URL 保持站点相对（同源）**——CF 的职责是让这些路径在 CF 外壳下**同源可用**（Pages Function + R2 绑定 / 隧道侧 Worker 路由），而不是把 URL 换成绝对 CDN 域。这样 `public/js/media.js:35-36`（跨域原样返回）与 `shared/packs.js:247 isLocalUrl`（只收 `/…`）**一行都不用改**；只有当外壳无法同源时才需要改它们（条件性工作，归 P8）。

**版本化用换 URL，不用换响应头**：同一条 URL 上今天已经在发 30 天 immutable（`functions/assets/[[path]].js:33/60`、`MainActivity.kt:362/377`），浏览器缓存**撤不掉**；而素材会被 in-place 重写（`server/index.js:131-132` 的注释：atlas + png + skel 必须同时换）→ 旧 atlas + 新 skel 是**画错**。`?v=<rev>` 的六个实测好处（Android 只看 path、`/media/` query 透传、`preloadModal.js:175-177` 的 `startsWith('/')` 仍成立、自建服已把带 `v=` 当 immutable）见 `plan-drafts/assets-final.md` §3.3。

### 5.2 降级策略（含 3D 棋盘与 APK 内置层的优先关系）

**优先关系（从高到低）**：

```
① 本地包内置层（APK 的 app_bundle.zip / 桌面便携包 / 完整服务器包的 public/assets/**）
      ↓ 未命中
② CF（R2 绑定 / Worker 路由）
      ↓ 未命中
③ 服务器兜底（server/index.js:398 的 `/` → public/，或 /assets/ 专用挂载）
      ↓ 未命中
④ 静默降级（3D 关掉 → 2D；或 404）
```

- **APK 恒走 ①**：`MainActivity.kt:349 val path = uri.path`、`:355-356` 只按 path 前缀匹配、从 `File(bundleDir, "public$path")` 取 → **query 被完全忽略，本地内置层永远先命中**。所以**APK 的 3D 棋盘必须由内置层提供**（`public/assets/local/**` + `data/local-assets.json`），这也是无尽包与主包都必须带 `public/assets/local/**` 的原因（否则两个包的美术风格不一致）。
- **网页（Pages / 隧道外壳）走 ②**，未命中回落 ③；③ 要求**不得改写路径**。
- **自建服/局域网（无 CF）**：③ 就是源，用「完整服务器包」。
- **headless（无 CF）**：**不承诺 3D 棋盘与素材**；且必须修「有 1481 条清单、每个文件都 404」的现存缺陷（`scripts/make-headless-server.mjs:524-529` 复制真清单但 `public/assets/` 被 `:71` 排除）——改为**空桩**。
- **官方本地素材能否进 R2**（`public/assets/local/**` 69 MB + `data/local-assets.json`，`.gitignore:6/12` 明写 NEVER committed）是决策点：进 R2 是让**网页端** 3D 棋盘成立的唯一路径；不进就必须接受「网页端只有 2D 棋盘」（§8 决策 D21）。

---

## 6. 现有 mod 能支持什么（现状 / 缺口 / 所需文件）

> 数字来自 `plan-drafts/modcontent-final.md` §1 的实测（该文 §6 记录了 `node -e` 原始输出）。缺口列是**施工必须补的**。

### 6.1 新干员

| 项 | 内容 |
|---|---|
| **现状** | `data/chess.json` 266 条 / 121 个真实 `charId`（另有 8 条无 `charId` 的 DIY 记录，`isDiy:true visible:false assets:null`）。进商店池是数据驱动的：`server/match/gamedata.js:76-79` = `c.visible && !c.isGolden && !c.isDiy && !c.isHidden && Number.isInteger(c.tier)`。kit 注册是**构建期静态清单**：`server/sim/content/kits/index.js:161` 静态 import + `tools/build-kits-registry.mjs:15-16` 一次写 server 与 public 两份。`data/backups.json` units 88 / tokens 38 / diy.ownedPool 71。 |
| **缺口** | ① 只塞一条 chess 记录**不进池**（`localcompute-final.md` §1.6 实跑：`gd.chess('chess_mod_1')` 为真但 `visibleChess.includes(...)` 为假）；② 客户端实际还依赖 `shopSortId`（`public/js/ui/loadoutModel.js:314`、`public/js/ui/ownershipModel.js:92` 的三级排序）、`name`/`appellation`、`charId` + `assets.avatar`（`public/js/ui/assetUrls.js:19-27`）——**缺 `charId` 或 `assets.avatar` 画不出立绘**；③ `KITTED_CHARS`（`kits/index.js:174`）是静态导出 → mod 干员**不能作为「自选」pick**（要支持得改 `shared/diy.js`，本轮不做）；④ kit 文件落在 `server/sim/content/`，受 ES2020 门禁（`test/es2020-syntax.test.js:23-34`）→ 禁 `\|\|=`/`&&=`/`??=`、禁顶层 await、禁 class 字段；⑤ kit 解析顺序是 `charId → baseId → id → 去 _a/_b`（`server/sim/content/index.js:43-71`），无 `charId` 的干员靠 `baseId` 挂 kit。 |
| **所需文件** | `public/packs/<id>/chess.json`（一条记录，必填 `chessId`/`baseId`/`visible:true`/`tier`/`price`/`shopSortId`/`name`/`appellation`/`charId`/`bonds[]`/`stats`/`skills`/`talents`/`assets{avatar,portrait,spine,skillIcon,subProfIcon}`）+ `backups.json`（非 PRESET 干员的形态数据，可选）+ `kits/ops/<name>.js` + `kits/index.js` 登记 + 重跑 `tools/build-kits-registry.mjs` + `assets.json` 的 `chars/skills/skillsById` 条目 + 素材（avatar/portrait/spine skel+atlas+textures/skill icon）+ 可选 `tokens.json`/`garrisons.json`/语音 `audio/voice/{jp,cn}/{charId}/*.mp3` |
| **可支持性** | ✅ 数据 + kit + 素材三层都能做到；限制只有两条：不能作「自选」pick；必须 ES2020。 |

### 6.2 新装备

| 项 | 内容 |
|---|---|
| **现状** | `data/items.json` 115 条 / 59 个 `trapId`；`server/sim/simdata.js:67-69 isShopItem` **不要求有战斗效果**（只看 `itemType==='EQUIP'`、非 golden/隐藏/排除、`tier` 是整数）；`data/effects.json` 361 条，`item effectId missing 0`（115/115 命中）。行为两层：战斗内 `server/sim/content/items/battle.js:861-896 installItem`（`STAT_BUFFS` 在 `:77-82`，**恰好 5 个键**；未知 `bbKey` 在 `:878-882` **静默掉下去**）；准备期 `server/match/effectsMeta.js:129-132 getDefaultRegistry()`（**进程级单例**）。 |
| **缺口** | ① 没有 schema、没有「有没有战斗效果」的门禁 → **无效装备照样上架照样卖**（必须加 F1 门禁）；② meta 注册表是进程级单例且 `registerBuiltins` 不传 data（`:119`）→ mod 装备若依赖「引擎 built-in 风格」的键解析，注册表里不会有它，**mod 的 meta 处理器必须像 `server/sim/content/items/meta.js` 一样静态注册 + 自带显式键**；③ `STAT_BUFFS` 是 5 键封闭集合，不是通用属性词表。 |
| **所需文件** | `public/packs/<id>/items.json`（必填 `id`/`trapId`/`itemType:'EQUIP'`/`tier`/`shopSortId`/`price`/`iconId`/`effectId`/`buffs[{key,bbKey,bb,bbStr}]`/`name`/`desc`）+ `effects.json`（一条 `effectType:'EQUIP'`，`effectId` 必须命中）+ `assets.json.items[trapId]` + 图标 PNG；行为要么只用那 5 个键（纯数据），要么写 `items/battle.js` 的 `BY_BUFF`/`BY_ITEM` 或 `items/meta.js` 的静态 `registerMeta`。 |
| **可支持性** | ✅ 但**必须配 F1 门禁**，否则「静默无效但会卖」是必然结果。 |

### 6.3 新盟约

| 项 | 内容 |
|---|---|
| **现状** | `data/bonds.json` 23 条（core 8）；`bond effectId missing 0`（23/23）。行为硬编码：核心 8 个在 `server/sim/content/bonds/core.js:599-608 INSTALLERS` + `:610-624 install()`；追加 15 个在 `bonds/addon/battle.js` / `bonds/addon/meta.js`。进池：`server/match/pool.js:25-40 drawDisabledBonds` 从 `gd.bondIds` 里 `weight>0` 且不在 `mode.inactiveBondIds` 的抽。**成员关系运行期走棋子自己的 `bonds[]`**（`server/sim/content/support/index.js:211-220 bondMembers → isMember`），`bonds.json.members` 只是面板/spec 展示。计数模式数据驱动（`server/match/bondsMeta.js:81-83` 读 `countMode`，三种模式）。 |
| **缺口** | ① **mod 作者只改 `members` 而漏掉 `bonds[]` → 盟约永不激活**（必须在文档与校验器里写死）；② 新 `countMode` 或「类调和」特判**必须动 `server/match/bondsMeta.js`**（`:28 HARMONY_BOND`、`:29 DEPUTY_BOND`、`:120-137` 特判）——这是「不碰 `server/match/`」红线的**登记例外**，必须逐条登记；③ `weight>0` 的 mod bond 会**改变官方对局的禁用盟约抽取候选集**（`pool.js:25-40`）→ 这正是「必须逐房合并、不能进程单例」的理由。 |
| **所需文件** | `public/packs/<id>/bonds.json`（必填 `bondId`/`isCore`/`identifier`/`bondOrder`/`countMode`/`thresholds[]`/`maxCount`/`weight`/`iconId`/`effectId`/`desc`）+ `effects.json`（`effectType:'BOND'`）+ `assets.json.bonds[bondId]` + 图标 PNG + installer（复用既有 `countMode` 则**不必**动 `bondsMeta.js`）+ **mod 干员的 `bonds[]` 里写上该 bond id**。 |
| **可支持性** | ✅ 数据 + installer 能做到；条件：沿用既有三种 `countMode` 则零例外；否则要登记改 `bondsMeta.js`。 |

### 6.4 素材与美术资源

| 项 | 内容 |
|---|---|
| **现状** | 官方素材清单由 `tools/fetch-assets.mjs` 从 `docs/research/*.json` 生成；`tools/assets/plan.mjs:312` 只遍历 `docs/research/07-assets.json.operators`（138 个）→ **不在其中的角色拿不到 URL**。`data/assets.json` 值是站点相对 URL（实测样本 `/assets/char/avatar/char_1012_skadi2.png`）。客户端解析在 `public/js/ui/assetUrls.js:19-133`（另有一套同名的 `public/js/assets.js`）。音频走 `public/js/media.js:19 AUDIO_PATH`，跨域在 `:35-36` 原样返回。`shared/packs.js:247 isLocalUrl` 只收 `/…`。 |
| **缺口** | ① **mod 素材走不进现有生成器**（只认 `docs/research/07-assets.json.operators`）→ 必须新开一条路径，**不动** `tools/fetch-assets.mjs` / `tools/assets/plan.mjs`；② mod 素材要**同时**写 `data/assets.json` 与 `public/data/assets.json`（这两份在 HEAD 里就已经不一致）；③ 包级 hash 无处存（`data/assets.json` 的全局 `hash` 已冻结不可信）→ 由 `pack.json` 自带；④ 3D 棋盘的 1,481 条 `/assets/local/**` **不在** `data/assets.json` 里（出现 0 次），只镜像 manifest 的脚本永远漏掉它。 |
| **所需文件** | 包内 `assets.manifest.json`（**新格式，本计划定义**）+ 素材文件 → 复制进 `public/packs/<id>/assets/**`；合并步骤产出两个补丁对象，分别 merge 进两份 `assets.json` 的 `chars`/`skills`/`skillsById`/`items`/`bonds`/`tokens` 子表；URL 形态 = `/packs/<id>/assets/<相对路径>`（同源，`isLocalUrl` 天然通过）。 |
| **可支持性** | ✅ 机制可做到；**卡点是「谁来生成」与「两份都要写」**，不是技术不可行。 |

### 6.5 三道内容门禁（缺一条就会静默出错）

| 门禁 | 拦什么 | 依据 |
|---|---|---|
| **F1 装备效果完整性** | 未知 `bbKey` 静默失效但照样上架 | `items/battle.js:847-852 hasBattleEffect` 的条件；不满足则**拒绝该包并报错** |
| **F2 确定性** | `Math.random()` / `Date.now()` 的 kit 会**静默**造成 `SP_VERIFY` 不一致 | `server/match/Match.js:2616-2634 _verifyResult` 用 `resultDigest` 比对；静态检查 + `tools/golden.mjs` 家族（**mod 内容另建一族摘要，不进官方 `test/golden/*.json`**） |
| **F3 ES2020 可解析** | 旧 Android WebView 黑屏 | `test/es2020-syntax.test.js:23-34`（`server/sim/content` 在扫描范围内）；禁 `\|\|=`/`&&=`/`??=`、禁顶层 await、禁 class 字段 |

---

## 7. 风险与红线

> 每条只写**处置结论**与**不成立条件**；证据与推导见对应质疑/冲突文档，本文不重复。

### 7.1 会让方案跑不通的（blocker）——已在 P0–P2 消化

| # | 风险 | 出处 | 处置 / 不成立条件 |
|---|---|---|---|
| R1 | 构建链吊在未跟踪的 `scripts/pack/` 上 → 干净检出 `ERR_MODULE_NOT_FOUND`，`node --test` 一起挂；**已打出的桌面包里就带着坏引用** | `packaging-critique.md` §3-H1 | **P0**：提交 `scripts/pack/`；把 `tools/bundle-android.mjs` 排除出服务端包；门禁 5 进 CI。**不做则后续全部白做。** |
| R2 | `SKIP_TRACKED` 是字符串前缀匹配，加 `endless/` 挡不住 `public/endless/**` → 门禁 1 必失败 | `packaging-critique.md` §3-H2 | **P1**：`SKIP_TRACKED` 逐条列 `endless/`、`public/endless/`（或改按段匹配）。 |
| R3 | Android 第二个包做不出来（无 flavor、`.debug` 与 `.endless` 不能叠加、`versionCode` 单值、`build-android.mjs` 写死任务名与产物名） | `packaging-critique.md` §3-H3 | **P4**：加 flavor dimension + 改 `build-android.mjs`。**这不是「加个 `--endless`」的规模。** |
| R4 | `mobile` 两变体在 `dist/mobile/` 撞名（`SHA256.txt`、`app_bundle.zip` 固定名） | `packaging-critique.md` §3-H4 | **P1**：两变体各给输出目录。 |
| R5 | `public/shared/` 镜像与「只允许 3 处差异」自相矛盾，且该镜像**已在漂移**（`\|\|=`）且无门禁 | `packaging-critique.md` §3-H5 | **P0/P1**：门禁 3 重写为 6 组显式允许清单；P0 的门禁守两份 `shared` 同源。 |
| R6 | `modeIdFor` 是 2 参 → 3 参门控**恒真**；新命名下缺 config 条目会变成**一间没有敌人的空房**（不是「退回普通单人」） | `endless-critique.md` §3-B1 | **P2**：`modeIdFor` 加第 3 参 + `server/lobby.js:991` 传 `room.variant` + `create()` 里 fail-closed 拒绝配置里没有的 mode。 |
| R7 | `roundCfg` 一处改两处好**不成立**：`roundPick` 用真实回合号，`picks` 只到 15 → **R16 起每一波都出 6 个 placeholder 敌人**（不是空波次，但类型轮换失效） | `endless-critique.md` §3-B2 | **P2**：改 `roundPick` 取模；测试按**真实后果**写。 |
| R8 | 强度断崖：`baseEnemyScale` 不循环 → R16 `1 × 1.333 = 1.333`，比 R15 的 `3.583181` **掉 63%** | `endless-critique.md` §3-B3 | **P2**：数据展开到地平线 42 回合（**不在热路径加循环**）；测试守单调不减。 |
| R9 | 「官方 server 包一个字不改」**不成立**：`server/match/*` 的改动会被 `tools/bundle-android.mjs:60-64` 原样拷进每个包 | `endless-critique.md` §3-B4 | 契约改为「**引擎改动进所有包**（在官方包里是死代码）；**只有那 4 条 mode 不进官方包**」。 |
| R10 | 内容层是**进程级单例** → 「引擎一行不改」**是假的**；mod 会泄漏进所有非 mod 房（卡池 + 禁用盟约抽签都会漂移） | `localcompute-critique.md` §1；`modcontent-critique.md` §3-H2 | **P6**：逐房注入 + 去单例化（含 battle 侧 16 处）；**禁止**在 `server/data.js` 的 `loadData` 里合并。 |
| R11 | 握手 **fail-open**：`validateC2S` 只遍历 schema 键 → 新客户端向旧服务器发 `packs` 会被静默丢弃，房间按官方房创建，**状态在握手完成前就分叉** | `localcompute-critique.md` §1（#11） | **P7**：`create()` 对非空 `packs` 无法解析出快照时**拒绝创房**；客户端收到不带回 packs/hash 的 `room.state` 时**不当作 mod 房**。**不要在 `validateC2S` 里加全局「未知键即拒」**（会破坏既有前向兼容）。 |
| R12 | 私密房唯一凭证是 **4 字符码 × 24 字母表 = 331,776**，`room.join` **无失败限流**；`server/net.js:45-46` 每连接 40 msg/s × `:54` 每网络 512 连接 ≈ 2 万次/s → **全空间约 16 秒穷举** | `modflow-critique.md` §3-H3 | **P7**：32 字符邀请令牌 + join 失败限流 + `/lan/room` 对私密房要求 key。**「密钥已足够」的结论不成立。** |
| R13 | `/lan/room` 无 private 判断、无限流；安卓 `NetworkUtils.kt:131` 扫 `/24` 的 254 个地址 → 局域网内可枚举 | `modflow-critique.md` §1（#12） | **P7**：同上；若不愿改原生，退路是「私密房一律不参与局域网发现」（§8 决策 D12）。 |
| R14 | 「有且仅有房主能选」**不可能由服务端保证**（本地加载层服务端看不见） | `modflow-critique.md` §3-H2 | 口径改为三层：**选择权/记录权协议保证；加载层不保证；一致性靠 `client.content` 自报比对**（能挡全部无意的两端分叉，不防作弊）。 |
| R15 | 「服务端 pack id 白名单」**无法实现**（服务端侧没有任何 pack 代码或清单） | `modflow-critique.md` §3-H1 | **P5/P7**：改为「**索引存在性 + hash + app 区间**」，索引缺失 ⇒ **fail-closed 拒绝带包创房**（不是放行）。 |
| R16 | 「素材全走 CF」+「本地全量内置」在 headless 上正相反；`--headless` 会稳定发一份 **1481 条的假清单**（有 `data/local-assets.json`、没有 `public/assets/local/`） | `cross-conflicts.md` C20/C24 | **P9**：headless 的定位必须拍板（§8 决策 D25）；无论怎么定，**假清单缺陷必须修**。 |
| R17 | 「零客户端改动」的素材路线 **不成立**：同一条 URL 上今天已在发 30 天 immutable，改响应头撤不掉；素材会被 in-place 重写（旧 atlas + 新 skel = 画错） | `assets-critique.md` §3-H2 | **P8**：换 URL（`?v=<rev>`），不换响应头。 |
| R18 | 「同一个 `app_bundle.zip` + 一个开关」**不成立**：`AssetManagerHelper.kt:34-77` 的判据只有版本串，没有「包含哪些目录」的表达能力 | `assets-critique.md` §4 | **P1/P4**：分别产出两种包体，不引入运行时开关。 |
| R19 | 3D 棋盘整块没被覆盖：`data/local-assets.json` 是 gitignored 的**开关**，服务端缺它时给空桩 → `boardArtListed()` false → **3D 静默降级 2D** | `assets-critique.md` §2.1/§2.2 | **P8**：`/assets/local/**` **与** `data/local-assets.json` 一起推 R2；验收必须含这两条（草案的「抽 20 条 manifest URL」永远抽不到它）。 |
| R20 | 无尽「不能加载 mod」的锁**对不上 mod 的代码加载模型** | `cross-conflicts.md` C21 | **P1**：文件级排除 + `MODS` 位；**需求文字如实降级**为「不出现入口 / 不合并数据」，代码仍在包里（§3.1）。 |

### 7.2 高——必须有门禁（否则静默出错）

| # | 风险 | 出处 | 处置 |
|---|---|---|---|
| R21 | 新无尽 UI 逃过两道为安卓 WebView 存在的门禁 | `packaging-critique.md` §2.2 | **P3**：把 `public/endless/{js,css}` 加进 `test/es2020-syntax.test.js:23-34` 与 `test/client-static.test.js:147/1172` |
| R22 | 无尽 UI 不在 `BUILD_INPUTS` 里 → 改它不推高 `/healthz.build`，已打开页面不重载 | `packaging-critique.md` #26 | **P3**：加 `public/endless/{js,css}`（主包里 0 条目，无害）+ 改 `test/build.test.js:27` |
| R23 | 装备未知 `bbKey` 静默失效但照样上架 | `modcontent-critique.md` §3-H6 | **P5/P6**：F1 门禁（§6.5） |
| R24 | 非确定性 kit 静默破坏 `SP_VERIFY` | `modcontent-critique.md` §2（漏项 4） | **P5**：F2 门禁 + golden 另建一族 |
| R25 | mod 干员在**开局前**就被 `room.loadout`/`ownership`/`diy`/`skins` 拒掉 | `localcompute-critique.md` §1（#12） | **P6**：`server/lobby.js:829/858/884/901` 四处改用房级快照 |
| R26 | `public/sim` 落后 `server/sim` 26 个文件且无门禁 → 方向 ④ 的 CF 静态客户端一上线就跑过期内核，`SP_VERIFY` 判定恒为 mismatch | `localcompute-critique.md` §3（#5） | **P0**：重跑 sync + 门禁（唯一所有者）。**门禁的例外只有两处**：`nodeData.js`（只在 server 侧）与 `simdata.js`（`tools/sync-static-web.mjs:43-51` 的有意改写）——写错这条会让 P0 永远红 |
| R27 | `kits/*.js` 等价于任意代码执行；方向 ② 要求「无论选不选都要」→ **所有 mod 的模块顶层代码在任何进程/页面加载时都会执行** | `modcontent-critique.md` §3-H7；`UI_PACKS_VS_ENDLESS_PLAN.md:221` | **红线**：包来源必须可信（随全量包内置 / 官方审核），**本轮不开放玩家自助装包**。 |
| R28 | `docs/MATCHMAKING_PRIVATE_ROOMS_PLAN.md:61` 原文**明确允许**房主在私密房点「匹配队友」——本方案**推翻**它 | `modflow-critique.md` §1（#8） | **P7**：写成设计反转，进覆盖账；`enqueue()` 拒绝私密房 |

### 7.3 会让方案不成立的「条件」（汇总）

- **「本地算 mod 降低服务器 CPU」不成立**：默认客户端权威（`server/match/Match.js:169`），服务器本来就不跑在线人类的战斗；bot 排练（`:158`，每轮 3 场）、接管重算（`:2376-2382`）、`SP_VERIFY`（`:2613-2634`）、安卓 `compat_mode`（`NodeServerService.kt:198-199`）在 mod 房里**与官方房同量级**。→ 它是**正确性方案**。
- **「mod 房必须全员在线」不成立**（低估）：只要房里有一个 bot，每轮准备阶段服务器就要跑 3 场 mod 战斗；coop 房允许 1 人类 + 3 bot 开局（`server/lobby.js:803-813`、`:748-761`）。
- **「服务器按 hash 从 CF 拉快照」（方案 A）/「房主推送快照」（方案 B）作废**：pack 走服务器 `/packs/**` + 服务器包内置 mod 数据与 kit 之后，A 多余、B 撞 `server/index.js:68 WS_MAX_PAYLOAD = 64*1024` 且与「服务端不读包内容」的红线冲突。
- **「一进程一快照」对「一个服务器同时开官方房 + mod 房」走不通**：`server/index.js:806/816` 的唯一 WS 入口在升级帧里**没有房码**，无法按房分流；可行变体是「官方服 / mod 服两个部署」，但那就不是方向 ④ 说的「检测到 mod 房间开放后启用」。
- **「无尽快数值」的默认口径**：地平线 42 回合（6 个领袖周期）是**设计建议，不是实测值**；「最后一轮算不算存活回合」「领袖是否换」「`spRounds` 是否按 14 周期重复」都是拍板项（§8 决策 D8）。

### 7.4 跨块冲突的对齐结论（C1–C25 逐条）

| # | 冲突 | 对齐结论 | 落到 |
|---|---|---|---|
| C1 | 无尽 UI 落点 `public/js/**` vs `public/endless/**` | **落 `public/endless/**`**（新字节只放新目录；排除是前缀，门禁 1/3 可判）；`public/js/screens/title.js` 只留一行守卫 + 动态 import。代价：必须把新目录加进两道质量门禁与 `BUILD_INPUTS`（P3） | P3 |
| C2 | overlay 落点 `overlays/endless/modes.json` vs `endless/data/config.endless.json` | **唯一实现 = `endless/overlays/modes.json` + `endless/tools/{make,apply}-*.mjs`**；撤回 packaging 的 `config.endless.json` 写法 | P2 |
| C3 | `overlays/` 会漏进主包（桌面引擎是 `git ls-files` 驱动） | **overlay 不放顶层 `overlays/`**，放 `endless/` 下（主包按前缀排除）；同理 `tools/make-endless-modes.mjs` 会漏进服务器包（`tools/` 在 `ALLOW_TRACKED_PREFIXES:50` 里），所以两个脚本也放 `endless/tools/` | P2 |
| C4 | mod 素材/pack 落点三选一 | **`public/packs/<id>/**`**（APK 与 `/packs/**` 两处天然成立）；撤回仓库根 `packs/` | P5 |
| C5 | mod 素材 URL 前缀 `/assets/*` vs `/packs/*` | **`/packs/<id>/<file>`**；`isLocalUrl`/`media.js` 的改动归 P8（且在同源方案下**不需要改**） | P5/P8 |
| C6 | headless 要不要带 mod | **带 mod 数据 + kit**（选能力 A 的前提）；`public/packs/<id>/assets/**` 与 `public/assets/**` 排除 | P9 |
| C7 | `Match.js:259/260/275`「不用改」 vs 24 个单例读点 | **采纳去单例化清单**，删掉「一路流到底」；内容层归 P6 | P6 |
| C8 | `Room`/`toState`/`create` 三块重复认领字段 | **一块一个字段**：`private`/`packs`/`inviteKey` 归 P7；`modData` 归 P6；`contentHash` 归 P7；**同一次改动落地** | P6/P7 |
| C9 | 「endless + packs 拒绝」写了两遍 | **唯一实现者 = P7 的 `create()` 第 ① 步**；P2 只写门禁/测试 | P7 |
| C10 | `data/packs.json` 是孤儿 | 弹窗数据源 = **`public/packs/index.json`**（与 `shared/packs.js:44 PACKS_URL='/packs/'` 一致）；撤回 `data/packs.json` | P5 |
| C11 | `server/packs.js` 交付方空转 | **唯一交付方 = P5**；其余块只写消费契约 | P5 |
| C12 | `client.packs` vs `client.content`，三种 hash 语义 | **一条消息两层**：`client.content { packs, snapshotHash }`；`pack.json` 的包级 hash 只做完整性 | P7 |
| C13 | 镜像重同步被四块各写一遍 | **P0 一个所有者跑一次 sync + 一条门禁**（例外仅 `nodeData.js` + `simdata.js`，且必须覆盖 `shared/diy.js`），其余只引用 | P0 |
| C14 | 两种「两种包体」分类法互不引用 | 合成 §3.1 的一张内容矩阵；「无尽 APK 是否齐全」= ✅（否则两包美术风格不一致） | §3 / P9 |
| C15 | modflow 引用的是草案不是 final | 本文 §7.4 与 §2 即权威引用；`plan-drafts/*-draft.md` 不再作为施工依据 | 全文 |
| C16 | `if (!ENDLESS)` 死代码 vs 按路径丢文件 | **被排除目录只允许动态 import**（守卫分支内）；建议加一条「无静态 import 被排除路径」的门禁 | P1/P3 |
| C17 | assets 的「门禁 0」挡住其它块的 `/packs/**` | **拆开**：纯仓库内的 `/packs/` 路由 + `server/packs.js` 在 P5 先做；只有 R2 镜像段等门禁 0 | P5/P8 |
| C18 | modflow 的第一步是别的块的交付物，而 packaging 没有阶段表 | 本文 §1.2 即跨块阶段表；`capabilities.js`（P1）与 `variant`（P2）都显式排在 P7 之前 | §1 |
| C19 | packaging 的无尽包门禁要等 endless 的数据步 | P4 显式依赖 P2/P3；P4 接受 P2 的 overlay 交付物 | P4 |
| C20 | 「素材走 CF」与「服务器能跑 mod 对局」在 headless 上正相反 | **headless 定位先拍板**（§8 决策 D25）；默认按「headless 不是 mod 房服务器」处理，则 mod 房限定在完整服务器包 | P9 |
| C21 | 无尽锁 vs mod 代码加载模型 | 采纳文件级排除 + `MODS` 位；需求文字如实降级 | P1 |
| C22 | 能力位：packaging 造 `MODS`，modflow 用 `ENDLESS`，endless 谁都不用 | **P7 用 `MODS`；P3 消费 `ENDLESS`**（`ENDLESS` 的消费方 = P3 的入口门控 + P1 门禁 2） | P1/P3/P7 |
| C23 | modflow §4.3 的引用被 localcompute 自己否掉 | 改写为**能力矩阵 A**，删掉「必须全员在线」 | P6/P7 |
| C24 | headless 的 `data/local-assets.json` 缺陷无人认领 | 写进 **P1 的 headless 引擎改动清单**（`:524-529` → 空桩） | P1 |
| C25 | modflow 要改 `NetworkUtils.kt` vs assets 说 Android「不改」 | 两者不矛盾（不同文件）；但 `sp-android-client` worktree 正占着 `MainActivity.kt`/`AssetManagerHelper.kt` 一族 → **P7 开工前确认归属** | P7 |

---

## 8. 需要用户拍板的决策点

> 每条给**推荐默认值**；不拍板则按默认值推进，但 D1/D2/D15/D16/D25 会直接改变阶段内容，建议先拍。

| # | 决策 | 推荐 |
|---|---|---|
| **D1** | 基线提交：`975585e1`（六份修订稿与本次实测）还是 `docs/HANDOFF_NEXT_2026-10-09.md` 记的 `0f52a0b6`？ | 以 P0 冻结后的提交为准 |
| **D2** | `HANDOFF` §6 的「引擎补到 0.2.x」移植与本计划并行还是先做？`server/sim/**` 是双方都要碰的区域 | 先冻结（P0），移植与 P2/P5 错开文件 |
| **D3** | 无尽包是否要独立版本号？ | 要 → 新增 `ENDLESS_VERSION`（不复用 `APP_VERSION`） |
| **D4** | Android 两个包是否要装在同一台设备？ | 要 → 必须加 product flavor（P4 的规模已按此估） |
| **D5** | 主包允许残留「能力位守卫行 + `ENDLESS=false`」，还是要求**零无尽字节**？ | 允许守卫行（零字节只能走整文件 overlay = 分叉，**不成立**） |
| **D6** | 无尽只做一档还是四档数据？排行榜是否只有「终极」上榜？ | 四档数据、UI 只做一档（默认「终极」） |
| **D7** | 标题屏上放不放四档难度选择？ | 不放（默认终极，难度挪到出击前屏） |
| **D8** | 无尽快数值三连：①「存活回合」最后一轮算不算（默认 `m.round - 1`）②领袖战是否换领袖（默认同一只）③`spRounds` 是否按 14 回合周期重复（默认是） | 按默认 |
| **D9** | 无尽有没有「称号」？ | 不发（`victory` 恒 false，语义未定） |
| **D10** | 无尽排行榜存在哪？服务端零持久化，「服务器不搭载」下只能存本机（换设备归零，mockup 的「共 1240 位上榜」不可能） | 存本机（`localStorage` / `filesDir`） |
| **D11** | `serverLoadBadge` 在无尽屏显不显示？ | 保持现状（显示） |
| **D12** | 私密房访问控制强度：32 字符令牌 + join 限流，还是只加限流沿用 4 位码？ | 令牌 + 限流（否则 §7 R12 的 16 秒穷举成立） |
| **D13** | 安卓局域网发现：私密房要求带 `key`（改 `NetworkUtils.kt`），还是一律不参与局域网发现（不改原生）？ | 带 `key`；若 `sp-android-client` 冲突则退到「不参与」 |
| **D14** | 管理后台是否列出私密房的 code / 令牌 / 包名？ | 列出 code + 包名，**令牌脱敏** |
| **D15** | **mod 房能力 A 还是 B**（是否允许 bot / 掉线接管 / `SP_VERIFY` / 安卓 `compat_mode`）？ | **A**（与「服务器包内置 mod 数据+kit」一致；B 要与「房内只做简单显示」冲突，且 `compat_mode` 是进程级无法按房表达） |
| **D16** | **内容层去单例：逐房注入 vs 一进程一快照？** | 逐房注入（一进程一快照无法按房分流，与方向 ④ 不符） |
| **D17** | 红线措辞确认：服务器「**不 import 客户端提供的 JS**」，而不是「服务器不带 kit」？ | 按前者（否则 C6 与 C23 会一直互相矛盾） |
| **D18** | 握手 hash 语义：只 hash pack 集合，还是 hash「官方 data + pack 合并后的快照」？ | 合并快照（代价：官方 `data/*.json` 一变，所有 mod 房 hash 跟着变，需要灰度/版本共存设计） |
| **D19** | 包 id 是否允许 `.`？（`shared/packs.js:68` 允许，`public/js/data.js:173` 不允许） | 禁止包 id 含 `.`（改一处比改两处安全） |
| **D20** | `public/sim` 镜像门禁是否本轮就做？ | 做（P0；不做则方向 ④ 上线第一天 `SP_VERIFY` 恒 mismatch） |
| **D21** | 官方本地素材（`public/assets/local/**` 69 MB + `data/local-assets.json`）能否进 R2？ | 进（否则**网页端**只有 2D 棋盘） |
| **D22** | 隧道入口（`game.jyuanblog.cc.cd` → 主服）的素材由谁发？ | 挂 Worker 路由走 R2（否则「素材不走服务器」对该入口不成立） |
| **D23** | 网页端离线是否承诺？ | 不承诺（无 Service Worker，`CacheStorage` 只写不读）；离线只有 APK 有 |
| **D24** | 服务器包是否彻底不带素材？（自建服/局域网场景没有 CF） | 保留「完整服务器包」（含素材）与「headless」两种 |
| **D25** | headless 是不是「mod 房服务器」？ | 不是 → mod 房限定在完整服务器包；headless 排除 `public/packs/**` 并修假清单缺陷 |
| **D26** | 若要求无尽包**物理上不含 mod 代码**，就必须放弃「本地全量包必含全部 mod」——二选一 | 保「全量内置」，无尽包靠 `MODS` 位 + 入口/数据隔离 |
| **D27** | `inviteKey` 传输：host-only 单播（新增 S2C 类型）还是放进 `room.state`？ | 单播（放 `room.state` 会让令牌随任何成员帧走） |
| **D28** | 私密房是否禁止撮合（推翻 `docs/MATCHMAKING_PRIVATE_ROOMS_PLAN.md:61`）？ | 禁止（否则「只能凭邀请码/链接进入」不成立） |
| **D29** | mod 包是否允许玩家自助安装？ | 不允许（`kits/*.js` 等价于任意代码执行） |
| **D30** | 4 条 endless mode 的 `inScope` 取值？ | `true`（诚实值）+ `test/endless-data.test.js` 对**注入后的临时 config** 复用 `test/data.test.js:245-259` 的整套校验；若改 `false`，则这 4 条的 `stages`/`upgradePrices`/`rounds`/`enemyScale` 全部不被校验 |
| **D31** | 无尽排行榜的存储介质？ | 统一用 WebView 的 `localStorage`（`sp.endless.best.<difficulty>`），**不做 Android native 桥**；接受「跨设备归零、清缓存/重装即失」 |
| **D32** | 确认接受 `ENDLESS_VERSION` 只声明一次、主包里留一个未被读取的常量（门禁 3 不允许 constants.js 有差异）？ | 接受 |
| **D33** | 确认「无尽包物理上仍带全部 mod 数据与 kit，只是 `MODS=false` 关入口/关合并」？ | 接受（若要求物理不含 mod 代码，见 D26 的二选一） |

---

## 9. 附：本次未验证 / 未运行的

1. **没有执行任何打包命令**（`node scripts/pack/index.mjs ...`、三个 `make-*.mjs`、`build-android.mjs`、`tools/bundle-android.mjs` 全未运行）。§2 的全部验收标准都是**设计**。
2. **没有跑 `node --test`**（连部分也没跑）。「现有测试全绿」不是本次结论。
3. **没有访问 CF / R2**（无凭据）。§5 的 URL 契约与门禁 0 的五条事实**全部未确认**；`wrangler.toml`、R2 桶、Pages 构建输出目录在仓库里零痕迹。
4. **没有解包 `android/app/src/main/assets/app_bundle.zip`**，没有核对它的文件清单（`plan-drafts/modcontent-final.md` §1.7 记 19,578 条 / 617,970,213 字节，mtime `Oct 9 16:55`；该数字带时间戳，施工前重测）。
5. **mod 素材在 CF 上的最终 URL 形态未定**（取决于 D21/D22）。
6. **`server/match/audit.js`、`tools/balance.mjs` 未读全**（只核了 `audit.js:315/468`、`balance.mjs:486`）；无尽下会不会误报、balance 工具会不会跑 0 轮**未知**。
7. **`endless/overlays/modes.json` 的 42 回合地平线是设计建议，不是实测值**；没有跑过一局 42 回合验证难度曲线。
8. **没有 profile 服务器每局 CPU**；§4.3「几乎不降低服务器 CPU」是结构推断（`Match.js:158` 的「~20–300 ms each」是代码注释自述）。
9. **没有改代码去试去单例化的真实改造量**；P6 的清单是静态 grep 的结果（`plan-drafts/localcompute-final.md` §8 #8 记 24 个读点 + battle 侧 16 处），**没有做调用图闭包，可能有遗漏**。
10. **没有跑 `node tools/sync-static-web.mjs`**。因此「重跑之后 `diff -rq server/sim public/sim` 只剩 2 行」「`diff -rq shared public/shared` 变空」是**按脚本源码推断**（`tools/sync-static-web.mjs:27/30/32` 是整目录复制，`:43-51` 只 patch `simdata.js`），不是跑出来的。
11. **`find -L public/assets` = 13,101 是本次实测**（`find public/assets -type f` = 271），但**「上传到 R2 之后的对象数」未验证**（无 CF 凭据）。
12. **没有解包 `app_bundle.zip` 核对「Android 复制是否已跟随符号链接」**；`tools/bundle-android.mjs:63` 复制 `public/` 是否解引用 `public/assets/*` 的 symlink，本次只读了 `_lib.mjs:93 copyDir` 的注释（跟随目录型链接），未实跑。

---

## 10. 复核结论与未决事项

### 10.1 独立复核**确认**（本文写作时也逐条实跑复现过）

| 断言 | 复核判据 |
|---|---|
| HEAD `975585e1`；`git status --porcelain \| wc -l` = 21（本文写作时）/ 22（复核时，多出的是本计划文件自身） | `git rev-parse --short HEAD`、`git status --porcelain` |
| `server/sim` 落后 **26** 个文件 + `nodeData.js` 只在 server 侧 | `diff -rq server/sim public/sim \| wc -l` → 27 |
| `public/sim/simdata.js` 的差异是**有意改写**，重跑 sync 也修不掉 | `diff server/sim/simdata.js public/sim/simdata.js` → 只有 `480,487c480`；`tools/sync-static-web.mjs:43-51` |
| `shared/` 镜像漂移的是 **`packs.js` 与 `diy.js` 两个** | `diff -rq shared public/shared` |
| `public/assets` 是符号链接，**不跟随只有 271 个文件**，`-L` 才 13,101；`local -> /e/Workbox/系统/public/assets/local/` | `find public/assets -maxdepth 1 -type l`、`find … -type f \| wc -l`、`find -L … \| wc -l` |
| 版本耦合是 `test/version.test.js` 的 **18/27/31/35/38/39**；`:36` 是反向断言；**`:49` 与版本无关** | `sed -n '14,52p' test/version.test.js` |
| `public/js/main.js:57` 是**同步**组件表，`:388` 是渲染点 | `sed -n '55,60p;386,390p' public/js/main.js` |
| P0-1 干净树门禁在 `scripts/build-android.mjs:92-97`（记录）与 `:180-191`（比对） | `sed -n '90,100p;178,182p' scripts/build-android.mjs` |
| `productFlavors` = 0；`versionCode 21`；`.debug` 是 buildType 后缀 | `grep -c productFlavors android/app/build.gradle`、`grep -n versionCode` |
| `packs/`、`public/packs/`、`overlays/`、`shared/capabilities.js`、`public/endless` 全部不存在 | `ls -d …` 6 个全部 `No such file or directory` |
| `data/config.json` 9 条 mode、无 endless；两份 config 逐字节相同 | `node -e`、`cmp -s` |
| 挂载表 `394/395/397/398`、`BUILD_INPUTS:152`、`loadData:675` | `grep -n` |
| Android 复制表 `tools/bundle-android.mjs:60-64`；`SKIP_TRACKED` 在 `:58`、过滤在 `:478`；headless `EXCLUDE_PREFIXES:70`（`public/assets/` 在 `:71`）+ `:524-529` | `grep -n` / `sed -n` |
| 内容层是进程级单例（`support/index.js:37-53`）；缺羁绊整份结果被拒（`fields.js:834`）；`PACK_TYPES` 两个 `planned`（`shared/packs.js:60/61`） | `sed -n` / `grep -n` |

### 10.2 复核指出、本次已**改正**的（逐条落在上文）

| # | 原计划的问题 | 改正位置 |
|---|---|---|
| 1 | P0 门禁 ① 与验收 3 要求「只剩 `nodeData.js`」——**永远不可能通过**（`simdata.js` 的有意改写） | §0.1 新增两行证据；P0 要动的文件 + 验收 3；R26；C13 |
| 2 | P0 镜像门禁漏 `shared/diy.js` | P0 门禁 ③ 改为「`shared/**` 与 `public/shared/**` 全目录一致」 |
| 3 | `git status` = 21 照抄会得到 22 | §0.1 首行加注（第 22 条是本计划文件自身） |
| 4 | `test/version.test.js` 漏 `:39`、误标 `:49` 为反向断言 | §0.1 版本行改正 |
| 5 | **P2 注入目标没写清**，按字面注入仓库会踩三条（脏树 / 门禁 1 失败 / 被 `build-data` 覆盖） | P2 新增「注入目标只能是打包器暂存副本」一条 |
| 6 | 4 条 endless mode 的 `inScope` 未规定，仓库侧断言覆盖不到产物 | P2 规定 `inScope: true` + `test/endless-data.test.js` 对**注入后的 config** 复用整套校验；P2 验收 1；新增 D30 |
| 7 | `main.js` 只给 `:57`，没给真正渲染的 `:388` | P3 明确必须同时改 `:388`（含两种落法） |
| 8 | 无尽排行榜只说「存本机」，无落点 | P3 写死 `localStorage` 键 + 不做 native 桥 + 边界文案；新增 D31 |
| 9 | `ENDLESS_VERSION` 的落点没写，且门禁 3 不允许 constants.js 有差异 | P4 文件清单加 `shared/constants.js` ×2；§3.3 加一行；新增 D32 |
| 10 | 三套产物只有形状断言，没有可执行冒烟 | P4 验收 5/6、P9 验收 1 |
| 11 | P7 缺 `client.content` 与 `room.create` 的时序 | P7 新增时序一条（缺失即 fail-closed 拒绝带包创房；不降级重试语义） |
| 12 | P8 素材镜像不跟随符号链接会**静默**漏掉 3D 棋盘 | §0.2 新增纪律 4；§3.2 新增第 6 条；P8 跟随链接 + 计数断言 ≥13,101；P8 验收首条 |
| 13 | mod 素材在 CF 侧无人提供（push-assets 不推 `public/packs/**`） | P8 push-assets 补 `public/packs/<id>/assets/**`；§3.1 矩阵该格加注 |
| 14 | 未列「无尽包物理上仍带 mod」的确认项 | 新增 D33 |

### 10.3 复核也**无法确认**、仍标未决的

1. **CF / R2 的五条事实**（Pages 构建输出目录、`/assets/*` 今天由谁兜、Pages 域名、R2 是否开通、隧道 zone 关系）——仓库零痕迹、本环境无凭据。**门禁 0 依然挡住 P8 的 R2 段**（P5 的 `/packs/` 仓库内部分不受影响）。
2. **上传后 R2 侧对象数**（≥13,101 这条只能在上传后验）。
3. **Android 复制是否已解引用 `public/assets/*` 的 symlink** —— 未跑 `tools/bundle-android.mjs`，只读了 `_lib.mjs:93` 的注释。
4. **「重跑 sync 后 diff 只剩 2 行」** —— 按脚本源码推断（`tools/sync-static-web.mjs:27/30/32` 整目录复制、`:43-51` 只 patch `simdata.js`），**未执行** `node tools/sync-static-web.mjs`。
5. **服务器每局 CPU 构成**（无 profile）；**`server/match/audit.js`、`tools/balance.mjs` 未读全**；**42 回合地平线是设计值不是实测值**。

### 10.4 用户仍需拍板的（按阻塞强度排序）

| 优先级 | 决策 | 为什么阻塞 |
|---|---|---|
| 1 | **D1** 基线提交（`975585e1` vs `0f52a0b6`）+ **D2** 引擎移植与本计划的先后/并行 | 决定 P0 冻结点与行号基准；`server/sim/**` 是双方都要碰的区域 |
| 2 | **D16** 内容层逐房注入 vs 一进程一快照；**D15** mod 房能力 A vs B | 决定 P6 是否要动 battle 侧 16 处、服务器包是否内置 mod kit |
| 3 | **D25** headless 是不是「mod 房服务器」；**D24** 是否保留完整服务器包 | 决定 P9 的排除表与 C20 的对立怎么解 |
| 4 | **D4** Android 两包是否同机并存（决定 P4 加不加 flavor） | P4 是本计划最大的单点工作量 |
| 5 | **D12/D13/D14** 私密房访问控制强度、局域网发现、后台可见性 | 决定 P7 是否改原生 `NetworkUtils.kt` 与新增 S2C 类型 |
| 6 | **D21/D22** 官方本地素材能否进 R2、隧道入口素材由谁发 | 决定网页端 3D 棋盘成不成立 |
| 7 | **D23** 网页端离线是否承诺 | 决定是否要做 Service Worker |
| 8 | **D8** 无尽快数值三连、**D10/D31** 排行榜存储、**D9** 称号 | 只影响 P2/P3 的细节，不阻塞开工 |
| 9 | **D3/D32** `ENDLESS_VERSION` 的形态与「主包留一个未读取常量」 | 影响 P1/P4 的门禁 3 白名单 |
| 10 | **D30** endless mode 的 `inScope`；**D33** 接受「无尽包物理上带 mod」 | 影响 P2 的测试覆盖范围与需求文字 |

**开工前的最后一条**：P0 冻结之后，**重新核对本文所有行号**（§0.1 的表格就是核对清单），再进 P1。


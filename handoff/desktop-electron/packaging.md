# 桌面端一键启动 · 打包与分发方案

> 角色：**打包与分发**（electron-packaging）。本文件只做只读调研与方案，不含代码补丁。
> 仓库事实全部取自 `E:\Workbox\系统` 当前工作区（2026-10-31 实测），标注 `文件:行号` 的可直接核对。
> 标「估算」的数字需要在本机实测确认；标「需确认」的是我无法从仓库单方面判定的决策点。

---

## 0. 结论摘要

| # | 问题 | 结论 |
|---|---|---|
| 1 | 打包形态 | **免安装 zip（electron-builder `--dir` + 自研 zip）** 为主；NSIS 安装包为备选；**排除 MSIX**、**排除单文件 portable** |
| 2 | Node server | **主进程内 `startServer()`**（不 spawn），因为 `startServer` 已经是可编程调用的导出函数且支持 `port: 0`；但**必须先解决 `fork()` 的 `process.execPath` 陷阱** |
| 3 | asar 与资源路径 | **干脆不用 asar**（`asar: false`），代码与资源同为普通目录；客端不会断（全是 HTTP 根相对 URL），服务端靠 `serveDirs` 现有选项改指向，**不必改服务器代码** |
| 4 | 自动更新 | **不做 electron-updater**，沿用仓库既定的「手动更新包」口径；「有新版本」用 `/api/app/version` 做一次性提示，不自动替换文件 |
| 5 | 构建流水线 | **electron-builder**（不是 forge）；CI 只产出**无素材版**，全量版仍在维护者本机产出 |
| 6 | 风险 | 体积（⌈~350 MB / ~1.4 GB⌉）、启动时间（`buildTag` 扫 45 MB `data/` + assetIndex 扫 39k 文件）、未签名杀软误报、素材缺失降级、与 `npm run dev/start` 的入口冲突 |

**一句话**：这个项目的结构对 Electron 极其友好——客户端是纯 HTTP 相对路径、服务器已经是可编程 `startServer()`、素材本来就在 git 之外。真正的工作量不在「让它跑起来」，而在**三类路径必须放在只读区之外**（可写目录 → `userData`、素材 → 普通目录、子进程入口 → asar 之外）。

---

## 1. 事实基线（先看数，再看选择）

### 1.1 入口与启动模型

- `package.json:24` — `"main": "server/index.js"`；`"type": "module"`；`engines.node >= 22`；**无 build 步骤**（客户端是原生 ESM，`public/vendor/` 由 `tools/vendor.mjs` 在 postinstall 复制）。
- `server/index.js:116` — `export async function startServer(opts = {})` 已是**正式导出 API**，文件头 `:41-42` 写明「Programmatic use (tests)」，支持 `{ port: 0, quiet: true }`，返回 `{ port, host, url, ..., close }`。
- `server/index.js:315` — `if (isProcessEntry(import.meta.url)) runMain(...)`：**被 import 时不会自己监听端口**。这是主进程内直接 `import` 的安全前提，已具备。
- 端口/绑定：`server/http/config.js:51-56` — 默认 `PORT 3000`、`HOST '::'`（双栈单 socket，`config.js:42`）。
- 端口探测已有现成实现：`tools/doctor.mjs:139` — `probePort()` 返回 `'ours' | 'free' | 'busy' | 'denied'`（`'ours'` 靠 `/healthz` 判定）。

### 1.2 子进程：最关键的坑

- `server/match/host/index.js:22-29`：匹配宿主默认 **`transport: 'process'`（`child_process.fork`）**；`'worker'`（worker_threads）**只有显式要求时**才用，原因写在注释里——**worker 线程 OOM 会拖垮整个进程**（exit 134），子进程 OOM 只死自己。
- `server/match/host/index.js:137`：`fork(ENTRY, [], { execArgv: [...], serialization: 'advanced', ... })` —— **没有传 `execPath`**，因此默认用 `process.execPath`。**在 Electron 主进程里 `process.execPath` 是 `electron.exe`，不是 node**。
- `server/match/host/childHost.js:14-23`：沙箱路径 `sandboxProcessOptions()` **白名单重建 env**（只留 `NODE_ENV` / `SP_PLUGIN_SCRIPTS` / `SP_VERIFY` / `SP_COMBAT` / `SP_BOT_EMOTES`），并传 `--permission --allow-fs-read=...`（Node 22 权限模型参数）。这意味着**连 `ELECTRON_RUN_AS_NODE=1` 都继承不过去**，且这些参数给 `electron.exe` 会直接报错。
- 同类 `fork` 还有三处：`server/plugins/trustedRuntime.js:12`、`server/studio/trialChild.js:91`、`server/studio/check.js`；`spawnSync(process.execPath)` 一处：`server/plugins/scriptPreflight.js:30`。
- **好消息**：`server/lobby.js:2460-2462` 显示，**普通房间根本不开子进程**——
  ```
  const match = modded && this.hosts ? this.hosts.create(...)
    : versioned && this.versionHosts ? this.versionHosts.create(...)
      : new this.MatchClass(opts);   // ← 默认走这里，同进程
  ```
  只有「装了玩法插件的内容集房间」和「非默认官方版本房间」才 `fork`。而默认版本是 第二期下半（`index.js:165` 的 `versions.defaultId`），其余三个版本默认启用（`versions.nonDefault.length > 0` → `versionHosts` 会被创建，但**首个该类对局才 fork，不在启动时**）。
- `server/workers/pool.js:9,125`：`simPool` 用 `worker_threads`，**在 Electron 主进程可用**。

### 1.3 资源与体积（实测，2026-10-31）

| 目录 | 体积 | 文件数 | 是否进 git |
|---|---|---|---|
| `public/assets` | **3,461.5 MB** | 39,058 | ❌ `.gitignore:12` |
| ├ `char` | 1,788.8 MB | 2,012 | |
| ├ `audio` | 830.8 MB | 17,324 | |
| ├ `spine` | 436.3 MB | 3,293 | |
| ├ `local`（本机提取） | 314.8 MB | 14,133 | |
| └ `ui` / `enemy` / `skill` / 其余 | 39.5 / 10.9 / 10.9 / ~26 | ~1,500 | |
| `public/fonts` | 0.6 MB | 13 | ❌ `.gitignore:13` |
| `public/`（去 assets/fonts/vendor，**含 stray `patch.zip` 191.1 MB**） | 257.3 MB | 1,062 | |
| 核心代码+数据（server+shared+data+public 去素材） | **≈ 115 MB** | — | ✅ |
| `node_modules`（含 dev） | 133.6 MB | 9,674 | ❌ |

- 生产依赖实测：`ws` 0.1 + `acorn` 0.5 + `ses` 4.5 + `htm` 0.1 + `preact` 1.5 + `pixi.js` 19.6 + `three` 19.5 + `pixi-spine` 3.5 ≈ **49 MB**，其中 pixi/preact/three 真正被浏览器用的是 `public/vendor/` 里的复制品（**3.5 MB**）。
- **`data/` 45.0 MB 与 `public/data/` 45.0 MB 几乎同尺寸**（85 vs 84 文件）——**需确认**是否为历史双份；若能去掉一份，核心体积立减 45 MB。
- 已发布产物（`artifacts/`）：完整包 zip **1,141 MB**、APK **1,187 MB**。
- `docs/DEPLOY.md:390` 给出「可分发素材」的权威口径：素材包 **30,936 文件 / 990 MB / zip 约 711 MB**（只含 manifest 列出的美术），远小于本机 3.46 GB（后者含额外语音、皮肤、本机提取）。
- `public/patch.zip`（191 MB）被 `.gitignore` 的 `*.zip` 覆盖，`tools/package.mjs` 的 `git ls-files` 白名单天然排除它——**但 `server/http/appApi.js:48` 会去读 `public/patch.zip` 做热更新**，桌面包不含它时 `/api/app/version` 的 `hotUpdate.supported` 自动为 `false`（`appApi.js:74`，行为优雅，非报错）。需知悉：桌面版**没有**手机端那套补丁热更新。

### 1.4 Electron 运行时能力

- 最新稳定 Electron **45.2.1**（2026-10-30）→ **Node 24.22.1 / Chrome 156**（查 `releases.electronjs.org/releases.json`）。远高于 `engines: >=22`，**不需要外挂 node.exe**。

### 1.5 现有分发与更新的既定口径

- `server/update.js:26-28` 结尾明确写着：**“No network, no automatic update: the update zip is a manual download from GitHub Releases.”**
- `docs/DEPLOY.md:151-162`：更新包 = 只含差异文件的 zip，玩家**手动解压覆盖**，启动时按 `MANIFEST.json` 校验并应用。
- `tools/package.mjs` 是自研发布工具（`npm run package` / `package:lite` / `--update` / `--assets`），**白名单来自 `git ls-files`**，`--lite` 就是「不带素材、首次启动由 setup 下载」。
- CI（`.github/workflows/ci.yml`）：`ubuntu-latest` + `windows-latest` 矩阵，只跑测试；**没有任何 release / 打包 job**。发版是维护者本机手动跑。

---

## 2. 六个问题的结论

### 2.1 打包形态：免安装 zip 为主

**结论**：electron-builder 产出**免安装目录**，再用现有 zip 逻辑压缩成 `Stronghold-Protocol-v<版本>-desktop-x64.zip`。NSIS 安装包作为备选（只在需要开始菜单/卸载/自动更新时才启用）。**MSIX 与单文件 portable 排除。**

**理由**：
1. **体积**：素材是几百 MB～GB 级。NSIS/portable 每次升级要重装或整包替换；zip 解压即用、删目录即卸载，与项目现有「解压即玩」的玩家习惯完全一致（`docs/DEPLOY.md:156` 的升级方式就是解压覆盖）。
2. **单文件 portable 的致命伤**：electron-builder 的 portable target 每次启动都把 Electron 运行时**解压到临时目录**，带 700 MB～3 GB 素材时每次冷启动都多几十秒到几分钟，且杀软会盯着这个行为。直接排除。
3. **MSIX 的致命伤**：微软商店/侧载 MSIX **强制要求代码签名**（无证书装不上）；且 MSIX 的虚拟化文件系统对「往安装目录写 `.cache/`、`plugins/`、`data/local-*.json`」极不友好。对一个必须写本机状态的游戏服务器，纯负收益。
4. **NSIS 备选的理由**：如果后续要做「一键更新」（复用 `UPDATE.json` 机制）或文件关联，安装包才值得。当前**无更新需求**（见 2.4），所以不必先上。

**目标体积（估算，需实测）**：

| 形态 | 下载 | 安装后 |
|---|---|---|
| 精简版（无素材，首启下载/导入） | **~110–150 MB** | ~330–380 MB |
| 全量版（含 990 MB 素材，zip 后 711 MB） | **~800–880 MB** | ~1.4 GB |

拆解：Electron win32-x64 运行时 ≈ 95–110 MB（zip）/ ~250 MB（解包）+ 代码与数据 zip 后 ≈ 25–30 MB + 生产 `node_modules`（可裁到 ~7 MB，见 3.4）+ 素材 711 MB。

**风险**：
- 免安装 zip 仍带 **Mark-of-the-Web**：从浏览器下载的 zip 解压出的 `electron.exe` 继承「来自 Internet」标记，**SmartScreen 仍会拦**（见 5.3）。zip 不是绕过签名问题的银弹。
- 解压 39k 个小文件在机械盘/杀软实时扫描下很慢（用户体感「解压要五分钟」）。缓解：全量版走素材包单独导入（复用 `public/js/assetPack.js`），主包只留精简素材。

### 2.2 Node server 怎么办：主进程内 startServer()

**结论**：**Electron 主进程 `import` 并调用 `startServer()`，不用 spawn 子进程**；先修 `fork` 的 `execPath` 问题，或在桌面版把 `SP_MATCH_HOST` 固定为 `worker`。

**理由**：
1. `startServer()` 已经是干净的可编程 API（`server/index.js:116`），支持 `port: 0` 并**返回真实端口**（`:259` `actualPort`）——这正是「动态探测端口」需要的，不需要写 `.port` 文件再读回来。
2. `isProcessEntry` 守卫（`:315`）保证 import 不会自动 listen，**无需抽新函数、无需改服务器结构**。`close()`（`:263`）可以干净地挂在窗口关闭事件上。
3. 单进程 = 无控制台黑窗、无孤儿进程、无「关窗后 server 还在占 3000 端口」的经典 bug。
4. **保持 `server/index.js` 作为唯一真相**：`npm start`、`npm run dev`、`scripts/launch.mjs`、NSSM、systemd 全部不变（符合 2.6 的共存要求）。
5. **不能 fork `server/index.js`**：它的 `argv[1]` 会命中 `isProcessEntry`（`server/http/boot.js:84-94`）→ 走 `runMain` → 执行 `applyPendingUpdate(ROOT)`（`boot.js:169`），**会按 `UPDATE.json` 删改安装目录里的文件**。对一个桌面应用来说这是不可接受的自毁路径。只有 `import` 才安全。
   （实测参考：`port: 0` 起服约 **1622 ms**、`close()` 1–3 ms 且端口立即释放——这对「关窗即退」的体验是够的。）

**必须配套修的两点（这才是真正的工作量）**：
- **`fork` 的 `execPath`**：`match/host/index.js:137` 与 `trustedRuntime.js:12` 等在 Electron 下会去启动 `electron.exe`。二选一：
  - (a) 桌面版强制 `SP_MATCH_HOST=worker` —— 代价：worker OOM **会拖垮整个桌面应用**（注释 `index.js:22-29` 说明得很清楚）；
  - (b) 让这些 `fork` 带上 `env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }` 或 `execPath` 指向随包分发的 node —— 但**沙箱路径 `childHost.js:14-23` 白名单重建 env**，需要在服务器侧加一个 escape hatch（例如读一个 `SP_NODE_EXEC` 环境变量），这是**唯一必须碰服务器代码的地方**。
  - 建议 **(b)**，且只加「一个环境变量读 `execPath`」的最小改动；否则「换官方版本 / 装插件」这两个功能在桌面端直接坏掉。
- **`--permission --allow-fs-read=<INSTALL_ROOT>`**：Node 权限模型参数在 `ELECTRON_RUN_AS_NODE` 下可用，但 `INSTALL_ROOT` 来自 `childHost.js:6` 的 `import.meta.url` → 外置后的实际路径要与该范围一致（见 3.3）。

**端口策略（推荐）**：
1. 先 `probePort(3000)`：`'ours'` → 不做局域网服务，直接连本机已有服务器（复用，符合 `scripts/launch.mjs:157` 的「双击两次无害」体感）；
2. `'free'` → 用 3000（**局域网可预期、与手机端/网页版口径一致**，队友输地址不用问端口）；
3. `'busy'` → 依次探 3001…3010；
4. 全占用 → `port: 0` 拿任意端口，**必须在 UI 上显示真实端口**（`startServer` 返回的 `port`）。
不写 `.port` 文件：窗口是我们自己开的，端口直接存在主进程内存即可；只有「用浏览器打开」这个外部动作需要把端口拼进 URL。

**风险**：
- 绑定 `::`（`config.js:42`）**必然触发 Windows 防火墙弹窗**（首次运行）。这不是 bug，但必须在文档/UI 里提前说明，否则玩家以为卡死。
- 固定 3000 会与玩家本机已有的 `npm start` 撞；`'ours'` 判定可优雅复用，但**版本可能不同**——建议「复用的服务器版本与桌面版不一致」时提示而非静默。
- 选 (b) 意味着桌面版依赖 `electron.exe` 的 `ELECTRON_RUN_AS_NODE` 语义；Electron 大版本升级时要回归这条路径。

### 2.3 asar 与资源路径

**结论**：**不用 asar**（`asar: false`）。整个应用就是一个普通目录：`server/`、`shared/`、`desktop/`、`public/`、`data/`、`packs/`、`node_modules/` 平铺。若坚持要 asar，则 `server/` 必须 `asarUnpack`（理由见下面第 2 条），代价是「一半在包里一半在包外」的混乱。

**理由**：
1. **asar 在这里买不到什么**。asar 的收益是「少几万个文件的目录项、装得更快」；而本项目光素材就 39,058 个文件，早就必须外置。为了 589 个 `server/` 文件引入一层只读虚拟文件系统，换来 realpath 语义、子进程可读性、写盘失败三类风险，**不划算**。
2. **`RUN_AS_NODE` 子进程读不到 asar**——这是决定性的一条。匹配宿主的 `entry.js` 一旦以「`electron.exe` + `ELECTRON_RUN_AS_NODE=1`」身份启动（见 2.2），它就是一个**纯 Node 进程**；asar 支持来自 Electron 的 fs 补丁，不在纯 Node 里。**`server/` 留在 asar 内 → 换官方版本 / 装玩法插件时子进程直接加载失败。** 这条与 `local-server.md` 的结论一致。
3. **客户端不会断**——已核实：`public/index.html` 只用根相对 URL（`/manifest.json`、`/icons/...`）；`public/js/**` 里 **没有任何 `__dirname` / `file://` / `process.cwd()`**（grep 无命中）。桌面窗口 `loadURL('http://127.0.0.1:<port>')`，客户端**一行都不用改**，也顺带继承了服务器的 CSP（`http/csp.js`）。
4. **服务端路径可以完全靠现有选项接管**：`server/http/config.js:74-80` 的 `serveDirs()` 已经支持 `publicDir / dataDir / sharedDir / packsDir / pluginsDir` 五个选项覆盖。所以外置后只需 `startServer({ publicDir: …, dataDir: …, … })`，**不需要改服务器代码**。
5. **只读安装目录下的写操作必炸**。当前服务器会写：`.cache/asset-hashes.json`（`http/assetIndex.js:99`）、`plugins/`（插件作者写文件夹，含 studio 钥匙）、`var/`、`workshop/`、日志。`assetIndex` 已有现成选项 `startServer({ assetIndex: { cacheFile } })`（`index.js:95`）可指到 `userData`；其余见 `local-server.md` 的「5 个写盘根」。
6. **性能**：`http/assetIndex.js:216` 会 `readFile` 每一个素材文件算内容哈希；`http/files.js:126` 的 ETag 键用了 `stat.ino`。外置到真实目录后这些行为与今天完全一致。
7. **`realpath` 依赖重**：`http/static.js` 有多处 `fsp.realpath` 做穿越防护（`:151,162,164,166,245,324,349,355`），`assetIndex.js:135` 也有一处。asar 内 realpath 的行为在大版本间有过回归史，**不要拿它赌**。

**关于 `simDir`**：`server/index.js:129` 的 `simDir = path.join(ROOT, 'server', 'sim')` **是硬编码、不在选项里**。但既然 `server/` 本来就要外置（第 2 条），只要 `ROOT` 解析到安装目录，它自然就跟着对——**不必新增 `simDir` 选项，仍不用改服务器代码**。

**风险**：
- 打包态与开发态的资源根不同（打包态在安装目录，开发态是仓库根），必须由**一个** `paths.mjs` 统一解析，否则「开发能跑、打包就白屏」。
- `server/` 平铺在用户可写的安装目录里 → **代码可被用户/恶意程序改动**（没有签名，本来就没有完整性保证）。若在意，可只把 `server/` 放到 `Program Files` 或做启动时自检。
- 素材若走「首启导入」而非内置，`assetIndex` 首次索引 39k 文件仍需时间（但它在后台 `assetIndex.start()`，不阻塞窗口）。
- `public/patch.zip` 不在包内 → 手机端式热更新在桌面版**不存在**（`appApi.js:74` 会如实报 `supported: false`）。

### 2.4 自动更新：不做，只做「有新版本」提示

**结论**：**不引入 electron-updater / 不做自动更新**。沿用仓库既有口径——手动下载更新包。桌面版只加一个**可关闭、失败静默**的版本检查。

**理由**：
1. 仓库已经有明确立场：`server/update.js:26-28`「No network, no automatic update」，`docs/DEPLOY.md` §7 整节都是手动更新流程。桌面端另起一套自动更新会**制造两个平行的更新语义**，是维护灾难。
2. **开源非商业 + 无代码签名**：没有证书，electron-updater 的自动替换等于「无验证地远程执行代码」，既不可信也不该做。
3. 体积：全量版 700–900 MB，自动下载的体验成本远高于「去 Releases 点一下」。
4. **几乎零成本的替代**：`server/http/appApi.js:64-79` 的 `GET /api/app/version` 已经返回 `{ app, build, serverNow, hotUpdate }`。桌面版只需：
   - 启动时（或 24h 一次）请求 `https://api.github.com/repos/sganggs/Stronghold-Protocol/releases/latest`，比对 `tag_name` 与 `package.json.version`；
   - 有新版 → 窗口内一条提示 + 链接到 Releases 页（**不自动下载**）；
   - 请求失败/GitHub 不可达/离线 → **完全静默**（中国大陆网络下大概率失败，必须当成常态设计）。
   - 连远程服务器时，可直接用该服务器的 `/api/app/version` 显示「你对面的服务器是 vX，你是 vY」。

**风险**：
- 隐私：一次外网请求会暴露 IP 与被使用版本。**默认开启还是默认关闭，是待拍板项**（建议默认开启但可在设置里关，且只在启动后延迟若干秒发一次）。
- 「提示了却不能一键升」的落差，必须把文案写成「去 Releases 下载新版 zip」，而不是「立即更新」。
- 版本号口径要统一：`package.json.version`（0.3.3）vs `shared/constants.js` 的 `APP_VERSION` vs git tag `v0.3.1.1`。**打包前必须确认三者一致**，否则提示会误报。

### 2.5 构建流水线：electron-builder

**结论**：**electron-builder**（声明式 `electron-builder.yml`），不走 electron-forge。CI 用 GitHub Actions `windows-latest` 出**无素材版**，全量版维护者本机出。

**理由**：
1. **electron-forge 与本项目结构相冲**：forge 的默认模板强绑 webpack/vite 构建链，而本项目的核心约定是「**vanilla ESM、无构建步骤**」（`docs/ARCHITECTURE.md:35-36`）。引入 forge 等于为了打包引入一套构建系统，收益为负。
2. electron-builder 的 `files` / `extraResources` / `directories.output` / `artifactName` 正好覆盖 2.3 与命名需求（`tools/package.mjs:822` 的 `Stronghold-Protocol-v<版本>` 命名可直接对齐）。
3. **`--dir` 出目录，再复用现有 zip 逻辑压缩**：避开 electron-builder 自带的 zip target 对 700 MB 素材重复压缩（慢且不可控），也让压缩工具与 `tools/package.mjs` 保持一致（`zip` 或 `bsdtar`，见 `package.mjs:91`）。
4. **打包文件白名单直接复用 `tools/package.mjs`**：它已经用 `git ls-files` 算好了「玩家需要什么」（含排除 LLM 集成、`public/dev/`、`test/`、维护者工具）。`node tools/package.mjs --dry-run --list` 的输出可以作为 electron-builder `files` 的输入，**保证桌面包与网页发布包口径一致**（不重复造白名单，也就不会漏掉 `server/match/llmRelease.js` 的排除）。

**CI 怎么产**：
- 现有 `ci.yml` 是 `ubuntu-latest` + `windows-latest` 测试矩阵，**没有 release job**。新增一个独立 workflow（`workflow_dispatch` 手动触发 + tag 触发），`runs-on: windows-latest`。
- **硬约束**：`public/assets` 在 git 之外（`.gitignore:12`），**CI runner 上根本没有素材**。所以：
  - CI 只能产出**精简版**（无素材，或首启下载）；
  - 全量版要么维护者本机出，要么在 CI 里先从 GitHub Releases 下载 711 MB 素材包再组装（可行但慢、且要处理 Releases 的 2 GB 单文件限制）。
  - **建议**：CI 只出精简版作为「有构建产物、可回归」的保障，全量版沿用现有手工流程。
- 打包需要 `npm ci --omit=dev`（`tools/package.mjs` 已经这么做；`postinstall` 会跑 `vendor.mjs` 生成 `public/vendor`）。

**签名（无证书）**：
- 现实后果：`electron.exe`（以及 NSIS 安装包）**必然触发 SmartScreen「Windows 已保护你的电脑 · 未知发布者」**，需要点「更多信息 → 仍要运行」。**没有技术手段能消除**——自签名证书不被信任链认可，等于没签。
- 可行的缓解（只能在文档和体验层面）：
  1. **以 zip 分发**并写清楚「解压后首次运行会提示未知发布者」 + 截图指引——比安装包少一层 UAC；
  2. **不要用 UPX 压缩**、不要自解压 stub（这两者是误报重灾区）；
  3. 在 README/Releases 说明里给出**每个产物的 SHA-256**（`tools/package.mjs` 已有摘要逻辑，`MANIFEST.json` 也有 `sha256`），让用户能自己校验；
  4. 长期方案：Azure Trusted Signing / SignPath OSS 免费签名计划（需组织资质与年限，**短期不可得**）；
  5. 每次发版后向 Microsoft 提交 false-positive（杀软误报时的唯一申诉渠道）。
- **风险**：未签名的 Electron + 「起 HTTP 监听 + fork 子进程 + 首次联网」三件套，是杀软启发式的高危组合，**误报率会明显高于现有的纯 node + zip 分发**。这是桌面化最大的隐性成本。

### 2.6 风险清单

| 风险 | 具体表现 | 缓解 |
|---|---|---|
| **体积** | 精简 330–380 MB / 全量 ~1.4 GB 安装后；解压 39k 小文件慢 | 全量版走「素材包单独导入」（复用 `public/js/assetPack.js` + 标题画面的「导入素材包」）；生产 `node_modules` 裁掉 pixi/three（43 MB） |
| **启动时间** | `http/buildTag.js:23` 的 `BUILD_INPUTS` 含 `data`（45 MB），启动时 `statSync` 全树；`assetIndex` 后台扫 39k 文件 | 打包时**固化 build tag**（作为构建产物写入，跳过运行时扫描）；`assetIndex` 保持后台启动（现状已是 `index.js:254`）；延迟窗口显示或用 splash |
| **杀软误报** | 未签名 + 起监听 + fork + 联网 → 启发式命中；Defender/360 拦截 | 见 2.5；**首次运行引导加上「防火墙允许」说明** |
| **离线资产** | 无素材时客户端 404、战场景缺失、语音退化为中文（`docs/DEPLOY.md:254`） | 只降级不崩：`docs/ASSETS.md` 口径已有 fallback；提供「导入素材包」入口与「素材目录」设置 |
| **与 `npm run dev/start` 的关系** | `package.json:24` `main` 是 `server/index.js`，Electron 会把**服务器**当渲染入口；端口 3000 与开发服务器互抢 | **不改 `main`**；用 electron-builder `extraMetadata.main = desktop/main.mjs` 把打包后的 `package.json.main` 改成桌面入口（源码仓库保持原样，`npm start/dev` 不受影响）；端口冲突靠 `probePort` 分级处理 |
| **子进程 fork** | 换官方版本 / 装玩法插件时 `fork` 到 `electron.exe` 失败 | 见 2.2（`execPath` / `ELECTRON_RUN_AS_NODE`） |
| **只读安装目录** | `.cache`、`plugins/`、`logs/` 写入失败 | 全部迁 `app.getPath('userData')` |
| **双份 data** | `data/` 与 `public/data/` 各 45 MB | **需确认**用途后删一份，省 45 MB |

---

## 3. 关键设计细节（落地前必须定稿）

### 3.1 目录布局（打包后）

```
Stronghold-Protocol/                 ← 解压后的一个文件夹（与现有 zip 同名口径）
├─ Stronghold Protocol.exe           ← electron.exe 改名
├─ *.dll / locales/                  ← Electron 运行时
├─ resources/
│  ├─ app/                           ← 代码（无 asar）：server/ shared/ desktop/ schemas/ package.json node_modules/
│  │  ├─ server/index.js             ← startServer() 的入口（被 import）
│  │  └─ server/match/host/entry.js  ← 以 RUN_AS_NODE 起子进程，**必须**在 asar 外
│  └─ public/ data/ packs/           ← 资源（extraResources，与 app/ 并列即可）
├─ 启动说明.txt                       ← 首次运行/防火墙/素材导入/杀毒误报
└─ (userData, 不在这里)               ← .cache/ plugins/ logs/ var/ workshop/ 设置
```

> 注：`resources/app/` 是 electron-builder 在 `asar: false` 时的默认布局；`public|data|packs` 用 `extraResources` 时默认落在 `resources/` 下。**最终相对关系以构建后实测为准**，但关键是「都普通目录、都在 asar 外」。

### 3.2 可写目录（必须迁到 userData）

| 现状路径 | 用途 | 桌面版目标 |
|---|---|---|
| `.cache/asset-hashes.json` | 素材内容哈希缓存（`assetIndex.js:99`） | `startServer({ assetIndex: { cacheFile } })` → `userData/cache/asset-hashes.json` |
| `plugins/` | 服务器所有者插件 + 工作室写盘 | `presets`：`pluginsDir` → `userData/plugins`（首次启动从包内模板复制） |
| `logs/` | 日志 | `userData/logs` |
| `data/local-assets.json`、`data/local-fx.json` | 本机提取清单 | 允许包内只读；用户导入的另放 `userData` |

### 3.3 外置目录与路径解析顺序

1. **打包态**：`process.resourcesPath` + `public|data|packs|node_modules`；
2. **开发态**：仓库根（`import.meta.url` 回退）；
3. 由**一个** `desktop/paths.mjs` 决定，禁止各处硬编码——否则开发/打包行为分叉。
4. `childHost.js:6` 的 `INSTALL_ROOT` 基于 `import.meta.url`，外置后要保证它就是 `resources/` 那一层（否则沙箱 `--allow-fs-read` 范围不对）。

### 3.4 体积优化（可选）

- 生产 `node_modules` 只保留 `ws` + `acorn` + `ses`（≈5 MB）；`pixi.js`/`three`/`preact`/`htm`/`pixi-spine` 浏览器侧用 `public/vendor/`（3.5 MB）即可，**可省约 43 MB**。
  **已核实**：`server/` 里没有任何 `from 'pixi…'` / `from 'three'`（grep 无命中）——这些包只在 `tools/vendor.mjs` 构建 `public/vendor/` 时需要，属于**构建期依赖**而非运行期依赖。打包流程应是「先 `npm ci`（含 dev）→ 跑 vendor → 再裁 node_modules」，顺序错了会打出白屏包。
- 删 `public/dev/`（8.3 MB）、`test/`、`docs/` 大部分——`tools/package.mjs` 的白名单已经这样做了，**直接复用**。

---

## 4. 推荐方案 vs 备选方案

| 维度 | **推荐方案** | 备选 A | 备选 B |
|---|---|---|---|
| 形态 | 免安装 zip（electron-builder `--dir` + 自研 zip） | NSIS 安装包 | 单文件 portable / MSIX |
| 适用 | 当前需求（解压即玩、无更新） | 后续要「开始菜单/卸载/一键更新」时 | ❌ 不推荐 |
| 体积 | ~330 MB / ~1.4 GB | 略小（压缩率更高） | portable 每次启动解压，体感最差；MSIX 无证书装不上 |
| 更新 | 手动替换目录（与现有 `UPDATE.json` 口径一致） | 安装包覆盖安装 | 不适用 |
| 签名要求 | 无（但 SmartScreen 会提示） | 无（UAC + SmartScreen 双重提示） | MSIX **强制**签名 |
| 风险 | 解压慢、MOTW 提示 | 卸载会删 userData 需特别处理 | 大文件场景不可用 |

| 维度 | **推荐方案** | 备选 A | 备选 B |
|---|---|---|---|
| server | 主进程内 `startServer()` + 修 `fork` 的 `execPath` | `utilityProcess.fork()` 承载整个服务器 | `spawn` 独立 `electron.exe`（`ELECTRON_RUN_AS_NODE=1`） |
| 优点 | 单进程、端口可变、`close()` 可控、无黑窗 | Electron 官方子进程 API，崩溃隔离好 | 与现有 CLI 行为最接近、可复用 `launch.mjs` 的 stdout |
| 缺点 | worker OOM 会拖垮 app（若选 worker 传输） | **需要新写一个 bridge**（`child_process.fork` 不认 utilityProcess），改动面反而最大 | 需管理孤儿进程、要处理 stdout、多一份 300 ms 启动开销 |
| 结论 | ✅ 采用 | 若后续要「服务器崩溃不影响窗口」再演进 | ❌ 首版不做 |

| 维度 | **推荐方案** | 备选 |
|---|---|---|
| 构建 | electron-builder | electron-forge |
| 理由 | 声明式、`extraResources` 强、不碰构建链 | 强绑 webpack/vite，与「无构建步骤」冲突 |

| 维度 | **推荐方案** | 备选 |
|---|---|---|
| 更新 | 不做自动更新 + `/api/app/version` + Releases 比对提示 | electron-updater |
| 理由 | 与 `update.js:26-28` 的既定口径一致、无签名下不远程执行代码 | 需要签名、需要托管更新源、与手动更新包语义冲突 |

---

## 5. 实施步骤（step by step）

> 全部为**新增**文件为主；对现有文件的改动只有第 6 步一处（可选）。不写代码细节，只给路径与要点。

### 阶段一：能跑起来（最小可用）

1. **新增 `desktop/main.mjs`** — Electron 主进程入口：
   - 解析路径（调 `desktop/paths.mjs`）→ `import { startServer } from '../server/index.js'`；
   - `startServer({ port: <探测结果>, host: '::', publicDir, dataDir, sharedDir, packsDir, pluginsDir, assetIndex: { cacheFile }, studio: false })`；
   - `BrowserWindow` 就绪后 `loadURL(srv.url)`；窗口关闭 → `srv.close()` → `app.quit()`。
2. **新增 `desktop/paths.mjs`** — 唯一的路径真相：打包态 `process.resourcesPath`、开发态仓库根、`userData` 下的 `cache/plugins/logs`。
3. **新增 `desktop/port.mjs`** — 复用 `tools/doctor.mjs` 的 `probePort()`：`ours → 复用`、`free → 3000`、`busy → 3001..3010`、全占 → `0`；返回真实端口。
4. **新增 `desktop/preload.mjs`** — 只暴露窗口控制与「打开外部链接」，**不暴露 Node**（`contextIsolation: true`、`nodeIntegration: false`、`sandbox: true`）。
5. **改 `package.json`**（唯一必需的现有文件改动）：
   - `devDependencies` 加 `electron`（**不要**加到 `dependencies`，免得进生产包）；
   - `scripts` 加 `"desktop:dev": "electron . --desktop"`、`"desktop:build": "node scripts/build-desktop.mjs"`；
   - **`main` 字段保持不变**（`server/index.js`），靠 `extraMetadata` 覆盖打包态的 `main`。
6. **（可选，需评审）`server/match/host/childHost.js` + `server/match/host/index.js`** — 让 `fork` 接受 `SP_NODE_EXEC`（或为 `env` 增加 `ELECTRON_RUN_AS_NODE=1`）：
   - 这是**唯一**触碰服务器代码的地方；不做的后果是「换官方版本 / 装玩法插件」在桌面端失效。
   - 若暂时不做：桌面版启动时设 `SP_MATCH_HOST=worker` 并在文档里写清「插件/多版本场景可能拖垮应用」。

### 阶段二：能打包

7. **新增 `desktop/package.json`（或 `electron-builder.yml` 的 `extraMetadata`）** — 打包态的 `main` 指向 `desktop/main.mjs`、`name`/`productName`/`version` 与 `package.json` 对齐。
8. **新增 `electron-builder.yml`** — 关键字段：
   - `asar: false`（见 2.3）；`files`：复用 `node tools/package.mjs --dry-run --list` 的白名单（`server/`、`shared/`、`desktop/`、`schemas/`、`package.json`、许可证）；
   - `extraResources`：`public/`、`data/`、`packs/`、`node_modules`（或裁剪后的 prod 依赖）；
   - `win.target: [dir]`（目录 + 自研 zip，**不用 portable/nsis 起步**）；`artifactName`：`Stronghold-Protocol-v${version}-desktop-x64.${ext}`；
   - `public/`、`data/`、`packs/` 走 `extraResources`（**不要**塞进 `files`，见 2.3）。
9. **新增 `scripts/build-desktop.mjs`** — 编排：`npm ci --omit=dev` → 固化 build tag → `electron-builder --dir` → 用现有 zip 逻辑压缩 → 输出 `artifacts/`（与 `.gitignore:8` 一致）→ 打 SHA-256 摘要。
10. **新增 `.github/workflows/desktop-release.yml`** — `workflow_dispatch` + tag 触发、`runs-on: windows-latest`、`npm ci`、构建**精简版**、`actions/upload-artifact`。**明确注释**：runner 上没有 `public/assets`（gitignored），所以不出全量版。

### 阶段三：体验与文档

11. **新增 `desktop/settings.mjs`** + 设置页字段 — 「连接方式：本地服务 / 远程服务器」（**沿用手机端 APK 的既有口径，不另起说法**）、端口、素材目录、是否检查更新。
12. **新增 `docs/DESKTOP.md`** — 首次运行、防火墙提示、SmartScreen「仍要运行」、素材导入、更新方式（手动替换）、与 `npm start` 的关系。
13. **新增 `handoff/desktop-electron/` 下的落地记录** — 与本文并列。

### 需要新增的界面文案（**待确认，未写入代码**）

按仓库规矩（新增 `t('…')` 必须先报字面量），以下是**候选字面量**，需业主确认后才写入 i18n：

| 场景 | 候选中文 | 候选英文 |
|---|---|---|
| 连接方式 | `本地服务` / `远程服务器` | `Local server` / `Remote server` |
| 服务器启动中 | `正在启动本地服务…` | `Starting the local server…` |
| 端口被占用 | `端口被占用，已改用 {port}` | `Port in use — using {port} instead` |
| 防火墙提示 | `如果 Windows 弹出防火墙提示，请选择「允许访问」` | `If Windows asks about the firewall, choose "Allow access"` |
| 首次运行签名提示 | `首次运行可能提示「未知发布者」，选择「更多信息 → 仍要运行」` | `Windows may warn about an unknown publisher — choose "More info → Run anyway"` |
| 有新版本 | `发现新版本 {version}，前往 Releases 下载` | `Version {version} is available — download it from Releases` |
| 素材缺失 | `未找到游戏素材，可导入素材包后重试` | `Game assets not found — import an asset pack and retry` |

> 注：手机端 APK 已有「本地/服务器」相关文案，**必须先去 `public/i18n/` 对齐现有 msgid**，不要新建平行说法。

---

## 6. 待拍板 / 需要确认

| # | 事项 | 影响 |
|---|---|---|
| 1 | **免安装 zip vs NSIS 安装包** | 决定是否要处理 UAC 与卸载时保留 userData |
| 2 | **要不要「有新版本」检查**（默认开还是关） | 影响隐私口径与首次联网行为 |
| 3 | **本地服务是否默认启动**，还是先显示「本地/远程」选择页 | 影响产品形态（也影响 `connect-ux` 那份方案） |
| 4 | **素材内嵌（全量 1.4 GB）还是首启导入/下载** | 影响体积、首启体验、CI 策略 |
| 5 | **是否允许改 `childHost.js` 的 env/execPath** | 决定「换官方版本 / 装插件」在桌面端是否可用 |
| 6 | `data/` 与 `public/data/` 是否重复（各 45 MB） | 能省 45 MB |
| 7 | 版本号三处（`package.json` / `shared/constants.js` `APP_VERSION` / git tag）是否一致 | 决定「新版本提示」是否误报 |
| 8 | 是否接受「桌面版没有 patch.zip 热更新」 | 与手机端功能对等性 |

---

## 7. 我没能验证的事（诚实清单）

1. **Electron 运行时体积**：45.2.1 的 win32-x64 解包/压缩体积是按历史经验**估算**（~250 MB / ~95 MB），未实测。
2. **`RUN_AS_NODE` 子进程能否读取 asar 内脚本**：本方案已用 `asar: false` 整体规避；若将来改用 asar，这是**必须优先实测**的一条（读不到 → 换版本/插件功能静默失效）。同时 `static.js` 的 6 处 `fs.realpath` 在 asar 内的行为也要一并实测。
3. **`fork` 在 `ELECTRON_RUN_AS_NODE` 下的完整可用性**（尤其 `--permission` + `--allow-fs-read` 组合）未实测；这是阶段一第 6 步的验收点。
4. **CI 上 electron-builder 的耗时**（Windows runner 下载 Electron 镜像 + 压缩）未测。
5. **未做任何写入仓库的改动**；本文是唯一产物。
6. 本环境 `web_search` 无 API key，Electron 版本事实来自 `releases.electronjs.org/releases.json` 直接抓取（2026-10-30 数据）。

---

## 附：与其它两份方案的分工边界

- **本文**：形态、asar/资源布局、构建与签名、体积、更新策略。
- `local-server.md`：`startServer()` vs `child_process.fork`、端口探测细节、userData 迁移。
- `connect-ux.md`：入口页面、字段、中文文案、状态与窗口行为。
- 三份在 `PROPOSAL.md` 合并；**端口策略与「本地/远程」口径必须三份一致**（本文 2.2 的「固定 3000 优先」是建议基线）。

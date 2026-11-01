# 桌面端一键启动 · 本机服务嵌入

角色：**本机服务嵌入**（local-server）。仓库 `E:\Workbox\系统`。

范围：服务端在 Electron 里怎么跑、端口与地址、写盘目录、本地/服务器两档的口径、离线素材、风险。
**打包形态（asar / 签名 / 自动更新 / 体积与杀软）不在这里**，归 `handoff/desktop-electron/packaging.md`。

> **packaging.md 当前不存在**（`handoff/desktop-electron/` 目录尚未建立，2026-10-31 核对）。因此本文按独立成篇写，
> 只在「asar 与 fork/写盘」「素材体积」两处留了给打包角色的接口，不重复它的内容。若它后出现，本文与它的交叉点
> 见 §7「跨角色接口」。
>
> 本文只读调研 + 方案，**不含代码补丁**；文中出现的 `startServer({ … })` 只是现有 API 的参数形状，不是补丁。
> 调研期间未修改仓库任何源码。

---

## 0. 结论摘要

| # | 问题 | 结论 |
| --- | --- | --- |
| 1 | 服务端怎么跑 | **主进程内 `import { startServer }`**，不 fork `server/index.js`。`startServer` 本来就是可编程入口（`server/index.js:116`，文件头 `:41-42` 明写测试用法），~180 个测试文件就是这么用的，同进程并发多实例也有先例。fork 会让 `runMain` 跑 `applyPendingUpdate(ROOT)`（`server/http/boot.js:169`），在安装目录里删改文件——对桌面端是灾难。 |
| 2 | 端口与地址 | 默认 3000，**启动前探测**；占用时退避（lan 档不可退避，见下）。真实端口取 `srv.port`（`server/index.js:258-260`，`port:0` 时是内核分配）。窗口直接 `loadURL(srv.url)`，客户端 WS 从 `location` 派生（`public/js/net.js:103-106`），**不需要把端口注入渲染进程**；端口只在「换档/换端口后重载」时走 IPC。绑地址：**一律 `0.0.0.0`**（对齐 APK `NodeServerService.kt:195` 与 `docs/START-MODES-PLAN.md:3`），只有 lan 档提示防火墙。 |
| 3 | 数据目录 | `startServer` 的 `dataDir` **不是**用户数据目录，它是只读的游戏数据（`data/*.json`）。真正写盘的有 **5 处**，分散在 5 个根：`.cache/asset-hashes.json`、`plugins/`（含 studio 钥匙）、`var/`（`SP_STATE_DIR`）、`workshop/`（`SP_WORKSHOP`）、日志（服务端自己不写，要我们接管）。前两个有 `startServer` 选项，后两个**只能走环境变量**。 |
| 4 | 本地 vs 服务器 | **原样搬 APK 的三张卡**：`solo` / `lan` / `remote`，字段同名同义（`server_mode` + `server_role` + `remote_url`，`MainActivity.kt:41-44`）。solo 与 lan 是**同一实现**（只在 UI 上差别，`:1186-1188`）。连远程时**本地服务要关**（与 APK 的保活前台服务不同，桌面端留着只占端口）。记住上次选择并预选，但每次启动仍先问（`:1094-1096`）。 |
| 5 | 离线可用性 | `public/assets` **39,058 文件 / 3.38 GB**（本机实测），gitignore。**默认不内嵌**：lite 包 + 首启（或首次进本地档）下载，复用已有的 full/lite 机制（`tools/package.mjs` 的 `--lite`）。缺素材**不阻塞进游戏**（`docs/MANDATORY-PRELOAD.md`：强制预载已被业主关掉），只是没图。 |
| 6 | 风险 | 最硬的三条：①服务端**没有任何 HTTP 鉴权**（`server/http/routeMount.js:20`），绑 `0.0.0.0` + 公网 = 裸奔；②全部 `fork()` 家族在 Electron 主进程里会用 `electron.exe` 当 Node（需 `ELECTRON_RUN_AS_NODE=1`）；③`close()` 不会自己跑（要挂 `before-quit`，并自备 5s 上限——服务端那份超时逻辑在 `boot.js`，in-process 用不到）。 |

**实测数据**（本机，只起不玩；脚本放 `%TEMP%`，未动仓库）：

| 项目 | 值 |
| --- | --- |
| `startServer({port:0, studio:false, pluginsDir:<userData>/plugins, assetIndex:{cacheFile:<userData>/cache/asset-hashes.json}})` 到绑定 | **1622 ms** |
| `/healthz` | `ok:true app:0.3.3 rooms:0 sockets:0` |
| `/lan/room?code=ABCD`（无此房） | `404`（符合 `server/http/appApi.js:105-106`） |
| `await srv.close()` | **1–3 ms**，端口立即释放（`PORT_AFTER_CLOSE=free`） |
| 素材哈希索引 | 启动后 4 s 仍是 `building:true, files:0`（39k 文件后台建，不阻塞监听） |
| 从另一个入口 `import` `server/index.js` | **不会自动监听**（`isProcessEntry` 为假），`startServer` 正常可取 |

---

## 1. 参照：手机端（APK）现在是怎么做「本地 / 服务器」的

这是**必须对齐的参照**，逐条给证据。

### 1.1 存储字段与档位

`android/app/src/main/java/com/paper/stronghold/MainActivity.kt`：

| 常量 | 行 | 值 | 含义 |
| --- | --- | --- | --- |
| `KEY_SERVER_MODE` | `:41` | `"local"` / `"remote"` | 引擎形态：本机引擎 / 别人的引擎 |
| `KEY_SERVER_ROLE` | `:43` | `"solo"` / `"lan"` / `"remote"` | 上次点的**哪张卡**（P1-3 补的） |
| `KEY_REMOTE_URL` | `:44` | 地址 | 远程地址 |
| `DEFAULT_LOCAL_URL` | `:54` | `http://127.0.0.1:3000` | 本机引擎固定 3000 |
| `DEFAULT_LAN_URL` | `:56` | `http://121.4.51.247/` | 「去加朋友」默认填值（**不带 `:3000`**） |
| `BACKUP_REMOTE_URL` | `:57` | `https://wei.jiangjiangze.icu/` | 备用，点一下替换 |

`docs/START-MODES-PLAN.md:3` 把设计意图写死了：

> 三档按**角色**切，不按传输切：①自己玩 ②开服给同伴 ③去加朋友。代码上只有两个形态——本机引擎 / 别人的引擎；
> ①②的差别不是网络，是"要不要把地址交给同伴"。`HOST` 一律保持 `0.0.0.0`（不再尝试回环绑定，已回档过一次）。

### 1.2 选择器（三张卡，每次启动先问）

`showServerSwitchDialog(asLauncher)` — `MainActivity.kt:964-1203`。要点：

- 首次启动它**替代** `startStartupFlow`，页面在 WebView 导航之前就已经定了去哪（`:964-968` 注释、`:634-653` 的 `startStartupFlow`）。
- 游戏内齿轮打开同一个对话框（`asLauncher=false`）：保留「取消」= 不动存的选择（`:1162-1165`）；启动版没有取消，返回键 = 走本地流程（`:1166-1169`）。
- 预选**上次那张卡**（`:1047-1051`）：`savedRole` 优先，老版本才用 `mode` 反推。
- **solo 与 lan 是同一实现**（`:1186-1188` 原注）：

  > 「自己玩」与「开服给同伴」都跑本机引擎（`KEY_SERVER_MODE` 都是 local），差别只在记不记住这张卡。

- ②档（lan）的地址列表：`NetworkUtils.allUsableAddresses()`（`NetworkUtils.kt:43-99`）按**网卡类型**标注
  （`Wi-Fi 局域网` / `虚拟专网 (UU/Tailscale/ZeroTier)` / `以太网/共享网络`），Wi-Fi 优先；点一下复制全部（`MainActivity.kt:1040-1068`）。
- ③档（remote）的地址规范化：`normalizeServerUrl`（`:1212`），**有 scheme 无端口时不补 3000**（`:1210-1211` 注释点明，`docs/START-MODES-PLAN.md:36` 的 P0-1 已是历史）。

### 1.3 本机引擎怎么起（APK 侧）

`NodeServerService.kt`（前台保活 Service，JNA 绑 `libnode.so`，8 MB 栈线程）：

- `:192-204` 设环境：`PORT=3000`、**`HOST=0.0.0.0`**、`NODE_ENV=production`，然后 `chdir(bundleDir)`
- `:212` `argv = ["node","--no-warnings", serverScript]`
- `:175-190` 把 fd1/fd2 `dup2` 到 `server.log`，`:246-274` tailer 镜像到 250 行环形缓冲
- `:276-309` 每 500 ms 打 `http://127.0.0.1:3000/healthz`，最多 30 次；就绪后发通知「本地服务已就绪 · 端口 3000」
- `:236-243` Node 线程优先级降到 `NORM_PRIORITY-1`（避免和服务端抢 UI 线程）

### 1.4 服务端为宿主准备的三条端点

`server/http/appApi.js`（文件头 `:1-12` 自己说明是「启动器 / Android 宿主用的三个只读端点」）：

| 端点 | 行 | 用途 |
| --- | --- | --- |
| `GET /api/app/version`（别名 `/api/version`） | `:58-80` | 版本 + 热更补丁是否存在（**只在真的有补丁文件时才宣称支持**，否则客户端会拿到 404 并报错） |
| `GET /api/app/patch.zip` | `:83-99` | `dist/patch.zip` → 退回 `public/patch.zip`，都没有就 404（404 是正常状态） |
| `GET /lan/room?code=XXXX` | `:101-116` | 局域网房间探针，**只答私网/虚拟专网**（`isPrivateAddress` `:25-38`，公网一律 404 `:102`，两个 404 长得一样） |

`/lan/room` 的对端就是 APK 的 `NetworkUtils.probeRoom`（`NetworkUtils.kt:150-166`），扫描器 `findRoom` 默认 `port = 3000`（`:127`）。

### 1.5 客户端里**没有**「本地/远程」这个概念

- WebSocket 地址从 `location` 派生：`public/js/net.js:103-106`（`ws(s)://<location.host>/ws`）→ **档位完全由「窗口加载了哪个 origin」决定**，客户端内部没有开关。
- `public/js/ui/modManagerModal.js:18` 有个 `DEFAULT_REMOTE_SERVER = 'http://101.37.150.107:3000'`，`:63` 用 `location.hostname === 'localhost'` 判「单机」—— 那是**模组同步**的临时逻辑，**不是档位**，桌面端不要抄这个地址（与 `MainActivity.kt:56-57` 不一致）。

**推论（本文所有设计的起点）**：桌面端的档位只存在于**壳层**（Electron 主进程 + 启动页），游戏客户端无感。
Electron 里「本地」= 主进程里的 http 服务器；「远程」= 窗口加载别人的 origin。两者对客户端是同一个东西。

---

## 2. Electron 里怎么跑服务端

### 2.1 结论

**主进程内 `import { startServer } from './server/index.js'`**，不 fork。

### 2.2 依据：它本来就是可编程的

`server/index.js:1-42` 的文件头把启动顺序和克制点写得比任何方案都清楚：

```
// Programmatic use (tests): `const srv = await startServer({ port: 0, quiet: true }); … await srv.close();`
// The server only auto-listens when this file is the process entry point.
```

- 签名：`startServer(opts)` — `server/index.js:116`，JSDoc 在 `:83-115`，可传 `port / host / quiet / log / publicDir / dataDir /
  sharedDir / packsDir / pluginsDir / versions / assetIndex / studio / matchHost / roomCode / …`
- 返回：`{ port, host, url, server, wss, lobby, network, registry, packs, traffic, assetIndex, views, studio, eventLoop,
  simPool, close }`（`:286`）
- 自动监听守卫：`:315` `if (isProcessEntry(import.meta.url)) runMain(…)`；`isProcessEntry` 在 `server/http/boot.js:84-94`
  （比较 `argv[1]` 的 realpath，或 `pm_id`/PM2 环境，或 argv 里出现 `server/index.js`）
- **已实测**：从另一个入口 `import` 时 `isProcessEntry` 为假 → 不监听 → `startServer` 仍可用（§0 表）

### 2.3 依据：可多次、可编程、可并发

- 仓库里 **~180 个测试文件**用 `startServer({ port: 0, ... })`（`test/**`）。
- **同进程并发多实例**有先例，不是理论：
  - `test/studio/studio.test.js:202` 起第一个，`:234` 同时起第二个 `const other = await startServer({…, studio:false})`
  - `test/ipv6-bind.test.js:123-143` 同时存在 `::`、`::1`、`0.0.0.0` 三个
  - `test/traffic.test.js:69,121,131` 三实例并存
- **实测**：`port:0` 得到 `55649` 之类的随机端口，`close()` 后端口释放。

### 2.4 `startServer` 内的副作用清单（全部可编程受控）

| 副作用 | 行 | 桌面端影响 |
| --- | --- | --- |
| `getData()` 进程单例 / 传了 `dataDir` 就 `loadData` 自己一份 | `:132`，`server/data.js:95-107` | 传 `dataDir` 即隔离；不传会命中单例（第二个实例复用第一份） |
| `computeVanillaContent` 读 sim+shared+data 字节算 `cs` | `:135` | 只读；**素材缺失不改变 `cs`**（好事，见 §6） |
| `createPluginRegistry` + `packs.refresh(true)` 扫盘 | `:140-141` | 读 `packs/`（内置）与 `plugins/`（要指到 userData） |
| `createAssetIndex`（后台建哈希，可能落 `.cache/asset-hashes.json`） | `:144` | **写盘点 1**，见 §4 |
| `createPluginPolicy / createContentSets / createRoomSets` | `:150-152` | 读 `plugins/config.json` |
| `createMatchHosts` ×2 | `:156, :163` | **会 fork 子进程**（默认 transport `'process'`），见 §2.6 |
| `createRoomWorkerPool` | `:166` | worker_threads（Electron 主进程可用） |
| `createStudio`（默认开） | `:189` | 写 `plugins/` + `plugins/.studio-key` |
| `createTrustedRuntime` | `:190` | **启动即 fork 一次**（`server/plugins/trustedRuntime.js:12`） |
| `resetBuildTag()` / `buildTag(ROOT)` | `:195-196` | 进程级变量，每实例重算 |
| 绑定失败时的自清理块 | `:204-252` | 已经把 network/hosts/simPool/trustedRuntime 全关掉再抛 → **Electron 重试是安全的** |
| `close()` | `:262-284` | 顺序：lobby.shutdown → hosts → versionHosts → simPool → eventLoop → network → assetIndex → studio → trustedRuntime → http（含 500 ms 强断） |

### 2.5 `startServer` **不含**的三件事（Electron 要自己拿主意）

`server/http/boot.js` 里那套是「作为进程运行」才有的：

1. `applyPendingUpdate(ROOT)` —— `:169`（只在 `runMain`）→ **能删改安装目录里的文件**。in-process 方案自动绕开，这是选它的第二个理由。
2. `printBanner` —— `:100-111`（Local / LAN / Studio / cloudflared 四行）→ Electron 要换成自己的 UI。
3. `SIGINT/SIGTERM` → `shutdownHandler` —— `:136-157`，含 `shutdownTimeoutMs()`（`:120-123`，默认 5 s，可 `SP_SHUTDOWN_TIMEOUT_MS`）与「第二次信号立即 exit 1」。
   **Electron 没有这些信号**，要自己实现等价的 `before-quit` + 5 s 上限（见 §7 风险 4）。

### 2.6 为什么**不** fork `server/index.js`

| 维度 | in-process `import startServer` | `child_process.fork('server/index.js')` |
| --- | --- | --- |
| 更新包 | 不进 `runMain` → **不会**动安装目录 | `isProcessEntry` 为真 → **跑 `applyPendingUpdate(ROOT)`**（`boot.js:169`），按 `UPDATE.json` 删旧文件、校验 `MANIFEST.json`，不符就 exit 1 |
| 端口 | `srv.port` 直接拿到（`:258-260`） | 要 parse 子进程 stdout 或轮询 `/healthz` 才知道；`EADDRINUSE` 也发生在子进程里 |
| 日志 | 传 `log` 对象即可进同一文件（`makeLogger` `config.js:249-257`，或自造 tee） | 要走 `stdio:'pipe'` 或 IPC 转发 |
| 关停 | `await srv.close()`，实测 1–3 ms | 要发 IPC/信号 + 等退出 + 兜底 kill |
| 崩溃隔离 | ❌ 服务端异常会带倒主进程 | ✅ 这是 fork 唯一真优势 |
| Electron 额外坑 | 无 | 必须 `ELECTRON_RUN_AS_NODE=1`，否则 `process.execPath`=`electron.exe`（见 §2.7） |

崩溃隔离的代价可以用别的方式补：`process.on('uncaughtException'|'unhandledRejection')` 记日志 + 一次自动重启
（`runMain` 自己就是「log 但不致命」的口径，`boot.js:165-166`），比背 fork 的三个坑划算。

### 2.7 ⚠ 真正的硬点：`fork()` 家族在 Electron 主进程里会拿 `electron.exe` 当 Node

服务端不止一个进程边界，**这些和「要不要 fork server/index.js」无关，改不了**：

| fork 点 | 文件:行 | 何时发生 |
| --- | --- | --- |
| match host（`process` transport，**默认**） | `server/match/host/index.js:137`、`childHost.js:10` | 首个带插件/非默认官方版本的对局**才**起，不在启动时 |
| trusted runtime | `server/plugins/trustedRuntime.js:12` | **启动时立即** |
| studio 检查 / 试用 | `server/studio/check.js`、`server/studio/trial.js` | 用 studio 时 |
| 脚本预检 | `server/plugins/scriptPreflight.js:30`（`spawnSync(process.execPath, …)`） | 插件脚本 |

这些 `fork()` 都不传 `execPath`，默认取 `process.execPath`。在 Electron 主进程里那是 **`electron.exe`**：
不设 `ELECTRON_RUN_AS_NODE=1` 就会把 `electron.exe` 当 node 起 → 再开一个 app 实例 / 空窗口 / IPC 协议对不上。

**两条路，建议 a 为主**：

- **a. 启动前设 `process.env.ELECTRON_RUN_AS_NODE = '1'`**（Electron 官方支持的环境变量，只影响此后 spawn 的子进程，
  主进程自身不受影响，因为主进程已经在跑）。
  - 风险：需确认 `serialization:'advanced'`（match host）与 `stdio:[…,'ipc']`（trusted runtime）在 RUN_AS_NODE 下都正常——它们就是 node，应该正常，但要**实测一次带插件的对局**。
- **b. `SP_MATCH_HOST=worker`**（`server/index.js:154-156`）把 match host 换成 worker_threads。
  - **代价写在源码注释里**（`:153-155`）：worker 线程里 OOM abort **会拖死整个服务端**。
  - 且它**只**管 match host，trusted runtime / studio 仍走 fork。

无论 a/b，启动日志里都应打印 transport（`[healthz]` 的 `versions.hosts.transport` 已带，`server/http/routes.js:71`），让运维看得见。

---

## 3. 端口与地址

### 3.1 默认与真相

- 默认 `PORT=3000`、`HOST='::'`（`server/http/config.js:52-56`，`DEFAULT_BIND_HOST` `:42`）。
- `::` 是**一个双栈 socket**；只在 `EAFNOSUPPORT/EADDRNOTAVAIL/EINVAL` 时退 `0.0.0.0`（`config.js:64-66`，重试循环在 `server/index.js:204-228`）。
- **真实端口**永远看 `srv.port`（`:258-260`，从 `server.address()` 读）；`port:0` 时是内核分配。返回的 `url` 也按实际绑定的 host 生成（`displayHost` `boot.js:78-81`：`0.0.0.0`/`::` → `localhost`）。

### 3.2 占用冲突怎么处理

**已有现成探测，别自己写**：`tools/doctor.mjs:140` `probePort(port, host='::')` → `{state:'ours'|'free'|'busy'|'denied', health?}`：

- `'ours'` = **本机已经有本站**答 `/healthz`（判据 `ok===true && 'uptimeSec' in json`）→ 正好解决双开（§7-3）
- `'free'` = 能 listen
- `'busy'` = 别的程序占着
- `'denied'` = `EACCES`（特权端口）
- 内部 `canListen` 已经把「`::` 不行就试 `0.0.0.0`」这条与服务端 `bindCandidates` 对齐了。
- `scripts/launch.mjs` 已经在用它做「已经开着就直接开浏览器」。

`EADDRINUSE` 在 `startServer` 里是**抛出**（`test/ipv6-bind.test.js:189` 断言过），且**抛之前已经把自己建的东西全关了**（`index.js:242-252`）→ 退避重试是安全操作。

**建议策略**：

| 档 | 端口策略 | 理由 |
| --- | --- | --- |
| solo（自己玩） | `上次用过的端口` → `3000` → `3001…3009` → `0`（随机） | 没人要连，动态端口无害 |
| lan（开服给同伴） | **必须 3000**，被占就报错让用户腾 | ⚠ 硬约束：APK 的房主地址列表、`NetworkUtils.findRoom(port=3000)`（`:127`）、扫描器、`/lan/room` 默认端口**全部写死 3000**（`docs/START-MODES-PLAN.md:43` 的 P1-6 明写这条没落地）。桌面端若在 lan 档用动态端口，手机端**必然找不到也连不上** |
| remote（去加朋友） | 不监听 | 见 §5.4 |

`'ours'` 时的处置见 §7-3（复用 vs 换端口）。

### 3.3 怎么把端口告诉渲染进程

**结论：不需要注入端口——URL 本身就是真相。**

- 客户端 WS 从 `location` 派生（`public/js/net.js:103-106`）→ 主进程 `loadURL(srv.url)` 就够了。
- 环境变量方案**不可行**：渲染进程是浏览器上下文，没有 `process.env`。要注入只能 `preload` + `contextBridge`。
- 需要 IPC 的只有两件事：
  1. **换档/换端口后重载**：`webContents.send('sp:server', {port, host, url, mode})`，然后 `loadURL(newUrl)`。
  2. **诊断面板**要显示「本机地址 + 状态码」（对齐 APK `docs/ANDROID.md` §3.3）→ 复用 `srv.url` + `/healthz`。
- `srv.url` 在绑 `0.0.0.0` 时是 `http://localhost:<port>`（`displayHost` `boot.js:78-81`）——给**本机窗口**用正好；给**同伴**的地址要用 §3.4 的列表，两者别混。

### 3.4 局域网访问（手机连电脑）

- **绑 `0.0.0.0`**（不是默认的 `::`）。依据：`NodeServerService.kt:195` 明写 `HOST=0.0.0.0`；`docs/START-MODES-PLAN.md:3` 「`HOST` 一律保持 `0.0.0.0`（不再尝试回环绑定，已回档过一次）」。
- **地址列表有两份实现，必须用带类型标注的那份**：

| 实现 | 位置 | 有 kind 标签 | 适用 |
| --- | --- | --- | --- |
| `lanUrls(port)` | `server/http/boot.js:51-71` | ❌ 只有 URL 数组 | 启动 banner |
| `classifyAddresses()` + `KIND_LABEL` | `tools/doctor.mjs:79-112` | ✅ `lan`/`vpn`/`public`/`virtual`/`linklocal` | **面向玩家的「开服地址列表」** |

  APK 的 ② 档正是按类型标的（`NetworkUtils.kt:43-99`：`Wi-Fi 局域网` / `虚拟专网 (UU/Tailscale/ZeroTier)` / `以太网/共享网络`），
  桌面端必须一致，否则「UU/Tailscale 开服」这一档用户选不出来（`docs/START-MODES-PLAN.md:25-31` 整节在讲这个坑）。

- **`classifyAddresses` 在 `tools/` 里**——那是开发者工具目录，不该被运行时依赖。建议抽到 `shared/`（如 `shared/netAddresses.js`），
  `tools/doctor.mjs`、`scripts/launch.mjs` 与 Electron 三处共用。这是本文**唯一建议改仓库源码**的一处（§9）。
- **防火墙**：`tools/doctor.mjs` 的 `firewallHints(port)` 已经有 Windows `netsh advfirewall` 规则检查/创建文案（含「把网络改为专用」提示）
  与 macOS `socketfilterfw` 那套。桌面端**首次进 lan 档**时用等价提示；不要静默绑 `0.0.0.0`——Windows 会弹 node 进程的防火墙框，
  用户点「取消」后 LAN 静默打不开，比不提示更糟。

---

## 4. 数据目录

### 4.1 先纠正一个容易搞错的语义

`startServer({ dataDir })` 的 `dataDir` **不是**「用户数据目录」，它是**只读的游戏数据**（`data/*.json`，85 文件 / 45 MB）：

- `server/http/config.js:74-83` `serveDirs()` → `dataDir = ROOT/data`
- `server/data.js:69,102` 只加载；`http/static.js`、`http/assetViews.js` 只服务它
- 已 grep 全部 `writeFile*`/`mkdir*`：**`data/` 下运行时没有任何写入**

所以「把 `dataDir` 指到 `app.getPath('userData')`」是**错的**（会把只读数据也搬过去）。真正要搬的是另外 5 处。

### 4.2 写盘点清单（逐条）

| # | 路径 | 默认位置 | 依据 | 桌面端改法 |
| --- | --- | --- | --- | --- |
| 1 | `.cache/asset-hashes.json` | `<ROOT>/.cache/` | `config.js:94-102` `assetIndexOptionsFrom`；写入 `http/assetIndex.js:121` | **`startServer({ assetIndex: { cacheFile: <userData>/cache/asset-hashes.json } })`**。注意默认只在 `publicDir === ROOT/public` 时才有 cacheFile；打包后 `public/` 在 asar 内 → 写到 asar 里必失败。退路：`assetIndex:false`（退回 size-mtime ETag） |
| 2 | `plugins/`（含 `.studio-key`） | `<dirname(packsDir)>/plugins` | `config.js:81`；钥匙 `server/studio/key.js:17,27`；写入 `plugins/install.js:521,597,636`、`plugins/pack.js:291`、`studio/files.js:62,81,156,166,201,224`、`studio/candidate.js:31,50,82,97` | **`startServer({ pluginsDir: <userData>/plugins })`**。⚠ 默认值是「packsDir 的兄弟目录」，**只改 `packsDir` 会连带改错位**，必须显式传 `pluginsDir` |
| 3 | `var/`（模组状态） | `<ROOT>/var` | `server/modModules.js:32-34` `stateRootFor` → `SP_STATE_DIR` 或 `<repo>/var`；写入 `modRegistry.js:99,115-119`、`modModules.js:113,119,120` | **只能环境变量 `SP_STATE_DIR=<userData>/var`**（`startServer` 没有这个选项）→ §9 建议新增 |
| 4 | `workshop/`（创意工坊） | `<ROOT>/workshop`（**本机不存在**，用到才建） | `server/workshop.js:43`；读写在 `playerAdmin.js:358,368,383,451,501,581`（`SP_WORKSHOP \|\| WORKSHOP_DIR`） | **只能环境变量 `SP_WORKSHOP=<userData>/workshop`** |
| 5 | **日志** | 服务端**自己不写文件** | `config.js:249-257` `makeLogger` 只 console；`logs/` 只在 `server/update.js:83` 的 KEEP 名单出现 | **必须自建**：主进程做一个 tee（写 `<userData>/logs/server.log`）+ 250 行环形缓冲（对齐 APK `NodeServerService.kt:175-190, 246-274` 与 `docs/ANDROID.md` §3.3）。APK 用 `dup2` 重定向 fd1/fd2，**Electron 里没有等价物**，只能走 `log` 回调 |
| 6 | `dist/patch.zip`、`public/patch.zip` | `<ROOT>/` | `server/http/appApi.js:48` | **只读**，不要改。`server/update.js` 的 `applyPendingUpdate` 只在 `runMain`（`boot.js:169`）→ in-process 自动绕开 |

补充：

- `ROOT` = `server/http/../..`（`config.js:28`）。打包进 asar 后 `path.resolve` 得到 `…/app.asar`；**读**没问题（Electron patch 了 fs），
  **写**会失败，`fork()` 也读不了 asar 内的脚本 → 两条都指向 §7-5。
- 实测已确认：把 1、2 指到临时目录后启动，那些目录里**什么都没多出来**（索引 4 s 内未完成，未落盘），
  说明「不指就写进安装目录、指了才隔离」的行为与源码一致。

---

## 5. 「本地 vs 服务器」怎么落

### 5.1 口径：原样搬三张卡，不要另起说法

| 桌面端 | APK 对应 | `server_mode` | `server_role` |
| --- | --- | --- | --- |
| 自己玩 | ① 自己玩 | `local` | `solo` |
| 开服给同伴 | ② 开服给同伴 | `local` | `lan` |
| 去加朋友 | ③ 去加朋友 | `remote` | `remote` |

- 字段名、取值、语义**逐字对齐** `MainActivity.kt:41-44`（连大小写都照抄：`local`/`remote`、`solo`/`lan`/`remote`）。
- 存储位置：APK 是 `SharedPreferences("stronghold_prefs")`；桌面端对应 `app.getPath('userData')/config.json`
  （键名建议沿用 `server_mode` / `server_role` / `remote_url`，便于将来互导）。
- **solo 与 lan 是同一实现**，只在 UI 上分开（`:1186-1188`）→ 桌面端不要为它们写两套启动逻辑。

### 5.2 落在哪：启动选择页（推荐）

1. **先建窗口、先显示选择页**，此时**没有任何服务在跑**。
   选择页必须是 `loadFile` 的本地 HTML —— **不能**用游戏页面，因为游戏页的 WS 派生自 `location`（`net.js:103-106`），
   而此刻还没有 origin。
2. 选 solo/lan → 起本地服务 → `loadURL(srv.url)`。
3. 选 remote → 校验地址 → `loadURL(remote_url)`。
4. 记住上次的 `server_role` 并**预选**（`:1047-1051`），但**每次启动仍先问**（`:1094-1096` 的副标题原文：
   「上次连的是 … · 点「连接」继续，或换一台」/「选一个进入。每次启动都会先问这个。」）。
5. 游戏内设置里再开同一张卡：带「取消」= 保留原选择（`:1162-1165`）。

### 5.3 记住上次 vs 每次先问

APK 两者都做：预选上次那张卡，同时保留「每次启动先问」。桌面端照抄，**不要**做成「记住并直连」——
`docs/START-MODES-PLAN.md` 的三档是**角色**选择，用户换场景很频繁（今天自己玩、明天和朋友开、后天去别人的服务器）。

### 5.4 连远程时，本地服务要不要关

**要关。** 与 APK 有一个**实质差异**必须说清：

- APK 的本地引擎是**前台保活 Service**（`NodeServerService.kt`），留在后台是它的设计（通知栏「本地服务已就绪 · 端口 3000」）。
- 桌面端没有「后台保活」这个概念，本地服务留着只会**占住 3000**、吃掉一个对局池、跑着心跳。

具体做法：

- **一次性选择（默认）**：一个进程只跑一个引擎，天然不冲突。选 remote 就根本不起 `startServer`。
- **运行中换档**：先 `await srv.close()`（`:262-284`，实测 1–3 ms，`lobby.shutdown('shutdown')` 会把房间收掉），
  **再** `loadURL(remote)`。顺序不能反。
- **唯一该保留本地服务的场景**：本人仍要拿这台电脑给手机当房主，同时自己去看别人的服务器 —— 这是**另一个功能**
  （「边跑本地服务边连远程」），不建议本轮做；真要做得在 UI 上单独表达，否则用户会以为自己在「远程模式」而端口还开着（安全问题，§7-1）。

### 5.5 与客户端 UI 的对齐点（交给 connect-ux，本文只记事实）

- 文案落点已被 `docs/START-MODES-PLAN.md` §「文案落点」逐行指定过（`dialog_server_switch.xml:65/:74/:102/:111/:139/:148` 等），
  **桌面端要做的是同一套中文字面量**，不是新写一套。
- 那两个默认地址要定一个并集中成常量：`MainActivity.kt:56-57`（`http://121.4.51.247/` + `https://wei.jiangjiangze.icu/`）
  vs `public/js/ui/modManagerModal.js:18`（`http://101.37.150.107:3000`，**模组同步用，不是档位**）→ 桌面端只取前者。
- ⚠ 按仓库 i18n 规矩（`AGENTS.md`「Interface strings go through `t('…')`」+ 业主偏好：新增字符串要先报字面量），
  桌面端新增的任何中文字面量**必须先报给业主逐条确认**，不得直接落代码。本文不含新文案。

---

## 6. 离线可用性（素材）

### 6.1 事实

| 项目 | 值 | 依据 |
| --- | --- | --- |
| `public/assets` | **39,058 文件 / 3.38 GB**（本机实测） | `Get-ChildItem` 实测 |
| `public/fonts` | 13 文件 / 0.6 MB | 同上 |
| `data/` | 85 文件 / 45 MB（**提交进库**） | 同上 |
| `.cache/` | 231 文件 / 140 MB（构建缓存，gitignore） | 同上 |
| gitignore | `public/assets/`、`public/fonts/`、`data/local-assets.json`、`.cache/`、`plugins/*` | `.gitignore` |
| 素材来源 | `npm run assets` → `tools/fetch-assets.mjs`，**安装期下载**，从不提交 | `docs/ASSETS.md:5` |
| gitignore 注释里的体积 | `~270 MB` | ⚠ **0.2.x 时代的数字**，与实测 3.38 GB 差一个量级（现含 skin/voice/local scene）→ 别引用旧数字 |

### 6.2 现成的两套机制（不要新写）

- **A. 发布包已有 full / lite 两档**：`npm run package`（带美术）/ `npm run package:lite`（不带美术，`npm run setup` 首启下载）——`tools/package.mjs` 文件头。
  另有一个 Windows 便携包先例：`scripts/make-windows-bundle.mjs:55` `ASSET_DIRS = ['public/assets','public/fonts','public/vendor']`（node.exe + app/ + 三个素材目录）。
- **B. 客户端自己有下载/缓存**：`public/js/assetDownload.js`、`resources/routing.js`、`assetPack.js`、`assetCache.js`；
  `docs/MANDATORY-PRELOAD.md` 说明业主 2026-10-08 已**关掉强制预载** → **缺素材不会卡住进游戏**，只是没图。
  `data/assets.json` 是提交进库的清单；`data/local-assets.json` 是 per-machine（缺了走 fallback，`http/static.js:102` 的 `LOCAL_ART_MANIFESTS` 处理）。

### 6.3 三条路线

| 路线 | 安装包 | 优点 | 缺点 |
| --- | --- | --- | --- |
| **1. lite + 首启下载**（推荐） | ~200–300 MB | 安装包可控；可选（不下也能玩远程）；复用 `fetch-assets` 的断点续传 | 要写下载 UI/进度；首次要网 |
| 2. 全量内嵌 | 3.4 GB+ | 装完即离线 | 4 万个小文件塞进 NSIS/asar，装 4 万文件极慢、杀软扫描更慢（packaging 角色详述）。APK 1.24 GB 是**单文件 + 原生读**，桌面端没有这个便利 |
| 3. 独立素材包（可选装） | 主体小 + 可选包 | 素材与程序目录分离，顺带解决 §4 写盘 | **需要新增 `assetsDir`/多根挂载选项**——现在 `publicDir` 是单一根，`/assets` 只能来自 `publicDir/assets`（`http/static.js` 挂载表）。成本最高，中期目标 |

### 6.4 一个重要澄清：离线 ≠ 有素材

- 真正「离线可玩」要的是**不需要外网**：`SP_VERSIONS` 默认开四个官方版本，其数据在 `data/versions/<slug>/`（本地）；
  `fetch-assets` 只在安装期要网。→ **lite 包 + 首次联网下载一次 = 之后完全离线**。
- **素材缺失不改变内容哈希**：`computeVanillaContent`（`index.js:135`）只算 sim/shared/data 的字节，不算 art
  → 不会因为素材不全导致 `cs` 不一致、进不了房。这点不用额外处理。
- 下载器落地注意：`tools/fetch-assets.mjs` 是 **CLI**，Electron 里不能直接当函数调 → 要么 `ELECTRON_RUN_AS_NODE=1` 起一个子进程跑它
  （正好复用 §2.7 的开关），要么把核心逻辑抽成可 `import` 的模块。前者改动小，推荐。

---

## 7. 风险（机制 → 依据 → 处置）

### 7.1 本地服务被外部访问 ⚠ 最高优先

- **机制**：服务端**没有任何 HTTP 鉴权**——`server/http/routeMount.js:20` 原话：「引擎其余 HTTP 面逐字一致 —— **没有认证**」；
  公开端点（`/api/create_room` 等，`server/publicApi.js`）也无凭据。
- **触发条件**：`host:'0.0.0.0'`（APK 口径，§3.4）+ 机器在公网 / 3000 被端口转发 / 起了隧道。
- **已有缓解**：
  - `/lan/room` 只答私网（`appApi.js:25-38, 102`）
  - studio 三重门：地址 + `Host` 名 + 变更要 `X-SP-Studio` 头（钥匙在 `plugins/.studio-key`，`server/studio/gate.js:106`），
    且 `SP_STUDIO=local|off` 可收到只回环或关掉（`gate.js:28-32`）
  - 测试房在公网会被拒（`lobby.js` 的 `SP_TEST_MODE` 守卫）
- **处置**：①默认档 = **solo**，只有用户选 ②lan 才 `0.0.0.0`；②每次绑非回环时把「本机地址 + 这是给同网络的人用的」
  写进日志与 UI；③`studio:false`（单机玩家不需要插件工作台）；④`TRUST_PROXY` 保持 `auto`（`config.js:242-247`）。

### 7.2 端口被占用

见 §3.2。额外一点：`'busy'` 说明**是别人的程序**占着 → 别硬熬，换端口；`'denied'` 只在特权端口出现，桌面端不该遇到。

### 7.3 双开实例

- **两道防线都要**：
  1. `app.requestSingleInstanceLock()` —— 同用户双开（第二个实例 `app.quit()` + 已有窗口 `show()/focus()`）。
  2. `probePort` 的 `'ours'` 判据（`tools/doctor.mjs:140`）—— 防**另一个用户/另一份安装**占着 3000。
     `'ours'` 时两个选择：直接 `loadURL('http://127.0.0.1:3000')` 复用（友好），或换端口（安全）。建议**先比对 `app`/`build`**
     （`/healthz` 里有 `app` 与 `build`，`http/routes.js:57-60`）：同一个 build 才复用，否则换端口并提示版本不一致。
- 注意 `EADDRINUSE` 抛出前自清理已完成（`index.js:242-252`）→ 重试安全。

### 7.4 退出时残留进程 ⚠ 最实际

- **in-process 没有「自己的子进程」**，但有服务端 fork 出来的：match host（**首个**带插件/非默认版本的对局才起）、
  version hosts、trusted runtime（**启动即建**）。
- `srv.close()` 的关闭顺序已经正确（lobby → hosts → versionHosts → simPool → … → http），`index.js:262-284`。
- **但 `close()` 不会自己跑**。必须：
  1. `window-all-closed` / `before-quit` → `event.preventDefault()` → `await srv.close()` → 再 `app.quit()`（并防重入）。
  2. **自己实现 5 s 上限**：服务端那份是 `shutdownTimeoutMs()`（`boot.js:120-123`）+ `shutdownHandler`（`:136-157`），
     **只被 SIGINT/SIGTERM 用**，Electron 没有信号 → 要写等价物，否则一个卡住的 rehearsal 会挂住退出。
  3. **先 `close()` 再 `window.destroy()`**：服务端靠 `closeIdleConnections` + 500 ms 后 `closeAllConnections`（`index.js:276-281`）；
     若先销毁窗口，客户端的重连逻辑（`public/js/net.js`）可能在关停中途又拉一次连接。
- **实测提醒**：调研中一次「`close()` 后立刻 `process.exit(0)` 且仍有 `fetch()` socket 活着」触发了
  `Assertion failed: !(handle->flags & UV_HANDLE_CLOSING), src\win\async.c`；隔离复现（三种退出方式 × 有无索引）均**未复现**。
  → 结论不是「close 不安全」，而是**退出别用 `process.exit()`，走 `app.quit()` 让事件循环自然收尾**。
- Windows 特有：任务管理器强杀不跑 `before-quit` → 那种情况无解，但也不会有残留（父死子随之 terminate）。

### 7.5 asar 与 fork/写盘（跨角色，需与 packaging 对齐）

- `fork(fileURLToPath(...))` 指向 asar 内脚本 → **RUN_AS_NODE 子进程读不了 asar** → 必须 `asarUnpack`：
  至少 `server/match/host/`、`server/plugins/`、`server/studio/`（被 fork 的入口都在里面）。
- `public/` 3.38 GB / 39k 文件进 asar 会让首个 `stat` 变慢，且 `.cache` 写入必失败 → `public/` 也应 unpack（或不打包进 asar）。
- 更省事的方案：**不用 asar**（或只 asar 主进程代码，`server/` + `public/` 平铺）——这属于打包角色的决定，本文只提约束。

### 7.6 「装完是旧的」

`server/update.js` 的 `UPDATE.json` 机制在 in-process 下**不跑**（好事），但反过来说：安装目录里若残留一个 `UPDATE.json`，
将来有人用 `npm start` 跑同一个目录就会动文件。→ **安装包不要带 `UPDATE.json`**（请 packaging 确认）。

### 7.7 绑地址会改变受信行为

`server/plugins/trusted.js:39` `isUnspecifiedAddress(host)` + `:47` `trustedHostAllowed(host, mode)`；
`server/index.js:238-241` 在 `trustedHostAllowed` 为假时**关掉 trustedRuntime**。绑 `0.0.0.0`（unspecified）与绑回环在这条上行为不同
→ 这是 §10-1「solo 档绑什么」的一个**真实行为差异**，不只是安全偏好。

---

## 8. 两栏对照：本地模式 / 远程模式

### 8.1 本地模式（solo + lan）

| 需要什么 | 具体 | 依据 |
| --- | --- | --- |
| 跑服务端 | 主进程 `import { startServer }` | `server/index.js:116` |
| 可写目录 | `pluginsDir`、`assetIndex.cacheFile`、`SP_STATE_DIR`、`SP_WORKSHOP` → userData | §4.2 |
| 端口 | solo：可动态；**lan：必须 3000** | §3.2 |
| 绑地址 | `0.0.0.0` | `NodeServerService.kt:195`、`START-MODES-PLAN.md:3` |
| fork 子进程 | `ELECTRON_RUN_AS_NODE=1`（或 `SP_MATCH_HOST=worker`） | §2.7 |
| 日志 | 自建 tee → `<userData>/logs/server.log` + 250 行环形 | §4.2-5 |
| 素材 | lite 包时**必须先下载**，否则没图（但不阻塞游玩） | §6 |
| 地址展示 | lan 档要 `classifyAddresses` 的分类列表 + 复制 | §3.4 |
| 防火墙 | 首次进 lan 档给提示 | §3.4 |
| 生命周期 | `before-quit` → `await srv.close()` + 5 s 上限 | §7.4 |
| **不需要** | `remote_url`、地址规范化、证书 | — |

### 8.2 远程模式（remote）

| 需要什么 | 具体 | 依据 |
| --- | --- | --- |
| 地址输入与规范化 | 同 APK `normalizeServerUrl`：有 scheme 无端口**不补** 3000 | `MainActivity.kt:1212`、`:1210-1211` |
| 持久化 | `remote_url`（+ 备用地址一行，点一下替换） | `:44`、`:1120-1125` |
| 本地服务 | **不起**（或先 `close()` 再导航） | §5.4 |
| 失败 UI | 重试 / 直接设置 / 诊断日志（APK 有 `btnRetryConnect`、`btnShowDiagLogs`、`layoutFailedActions`） | `MainActivity.kt:65-68` |
| TLS | 用户填 `https://` 时走系统根；自签需额外处理（APK 注释里特意没给 https 补 3000，是为了 443 域名） | `:1210` |
| 素材 | **不需要**（远端服务端发 `/data/assets.json` 与 art） | `http/static.js`、`http/assetViews.js` |
| 可选加速 | 「本地有同名且哈希一致就地发」——APK 的 `AssetFastPath.kt:12-22`（**只对别人的服务器生效**，本机引擎走它纯烧 CPU，`:56-58`）。桌面端可后续再加 | `android/.../AssetFastPath.kt` |
| **不需要** | 端口、`0.0.0.0`、素材下载、写盘目录（除日志与配置）、`ELECTRON_RUN_AS_NODE` | — |

### 8.3 两者共用

启动选择页（三张卡）· `userData/config.json`（`server_mode`/`server_role`/`remote_url`）· 诊断与日志面板 ·
窗口尺寸/渲染降级（`?render=fallback` 那条链，`docs/ANDROID.md:143-146`）· 单实例锁。

---

## 9. 实施步骤（含文件路径）

> 全部为**新增**或**既有文件的最小改动**；无补丁代码。分三档。

### 9.1 能马上做（无外部依赖、无待拍板项）

1. **`desktop/main.js`**（新增）— Electron 主进程：单实例锁 → 建窗 → 显示启动选择页（`loadFile`）→ 按档位起服务或导航；
   `before-quit` 里 `await srv.close()` + 5 s 上限；`process.env.ELECTRON_RUN_AS_NODE='1'` 在**第一次 `startServer` 之前**设。
2. **`desktop/server-host.js`**（新增）— 把 `startServer` 包一层，负责：userData 路径映射（§4.2 的 4 个可写根）、
   端口探测与退避（lan 档不退避）、日志 tee + 环形缓冲、`close()` 生命周期与超时。**这是唯一 import `server/index.js` 的文件**，
   便于将来换实现。
3. **`desktop/store.js`**（新增）— `userData/config.json`，键 `server_mode` / `server_role` / `remote_url`（对齐 `MainActivity.kt:41-44`）。
4. **`desktop/launcher.html` + `desktop/launcher.js`**（新增）— 三张卡 + 地址栏 + 「连接」按钮 + 地址列表 + 复制。
5. **`desktop/preload.js`**（新增）— `contextBridge` 暴露 `spServer.get()` / `spServer.state()`（仅换档重载与诊断用）。
6. **验证一条**（不改代码）：确认打包后 `isProcessEntry(import.meta.url)` 为假——本文已用「另一个入口 import」实测过，
   仍需在真实 Electron 里复验一次（argv 形态不同）。

### 9.2 需要决策（等 §10 拍板）

7. **solo 档绑回环还是 `0.0.0.0`** —— 影响 §7.1 暴露面与 §7.7 受信行为。定了才写 `server-host.js` 的绑地址分支。
8. **`ELECTRON_RUN_AS_NODE` vs `SP_MATCH_HOST=worker`** —— 定了才写 `server-host.js`（以及是否要实测带插件对局）。
9. **素材路线**（lite/全量/独立包）—— 定了才写下载器与 `package.json` 的打包脚本。
10. **是否支持「远程模式同时保留本地服务」** —— 定了才决定启动选择页是三张卡还是三张卡 + 开关。

### 9.3 建议改仓库源码（都很小，但要走 PR 规矩）

| 文件 | 改动 | 为什么 |
| --- | --- | --- |
| `shared/netAddresses.js`（新增） | 把 `tools/doctor.mjs:79-112` 的 `classifyAddresses` + `KIND_LABEL` + `hostUrl` 移过来，`tools/doctor.mjs` 与 `scripts/launch.mjs` 改为 import | 运行时（Electron）要这份带类型的地址列表；`tools/` 不该被运行时依赖。**顺带消除与 `server/http/boot.js:51-71` `lanUrls` 的重复** |
| `server/http/config.js` + `server/modModules.js` | 给 `startServer` 增加 `stateDir` / `workshopDir` 选项，`stateRootFor` 接受注入 | 现在只能靠 `SP_STATE_DIR` / `SP_WORKSHOP` 环境变量——进程级全局，与「主进程内可编程启动」的口径不一致（第二个实例无法用不同目录）。改动面中等，可延后 |
| `docs/DESKTOP.md`（新增） | 按 `AGENTS.md`「Docs follow the code」记桌面端运行方式 | 文档规矩 |
| `package.json` | 新增 `desktop` / `desktop:build` script | 与 packaging 角色对齐（两个角色都别各自加） |

### 9.4 有外部依赖（排最后）

11. 下载器（若走 lite）：`tools/fetch-assets.mjs` 以 `ELECTRON_RUN_AS_NODE=1` 子进程方式跑，或抽模块。
12. 独立素材包（若走路 3）：需要新增 `assetsDir`/多根挂载选项，动 `http/static.js` 挂载表 —— 单独一轮。

---

## 10. 待拍板（交给 lead / 业主）

| # | 问题 | 选项与影响 |
| --- | --- | --- |
| 1 | **solo 档绑 `0.0.0.0` 还是 `127.0.0.1`** | ①`0.0.0.0`（对齐 APK `NodeServerService.kt:195` 与 `START-MODES-PLAN.md:3`，但 solo 也在局域网上可访问，且有 §7.7 的受信差异）；②`127.0.0.1`（solo 最安全，但**与「一律 0.0.0.0，不再尝试回环绑定，已回档过一次」直接冲突**）。⚠ 这是本文与既有设计文档唯一冲突的地方，需要业主明示 |
| 2 | **lan 档端口是否允许动态** | 建议**不允许**（APK 侧扫描器与地址全部写死 3000，`NetworkUtils.kt:127`）。允许动态 = 桌面端开服时手机必然连不上 |
| 3 | **fork 策略：`ELECTRON_RUN_AS_NODE` 还是 worker transport** | 前者稳（真进程隔离）但要实测带插件对局；后者省进程但**worker 里 OOM 会拖死服务端**（`server/index.js:153-155` 注释） |
| 4 | **远程模式下本地服务能否继续跑** | 影响 §5.4、§7.1 与启动页形态（三卡 vs 三卡+开关）。建议**不能**（初版） |
| 5 | **素材路线** | lite+首启下载（推荐）/ 全量内嵌 / 独立素材包；以及是否需要新增 `assetsDir` |
| 6 | **是否保留插件 studio** | 建议 `studio:false`（单机玩家用不到，少一个写盘根 + 少一个 fork 点 + 少一条安全面） |

---

## 11. 跨角色接口（给 packaging / connect-ux）

**给 packaging.md**（它还不存在）：

- `server/` 与 `public/` 需要 **asarUnpack 或干脆不用 asar**（被 `fork()` 的入口读不了 asar；`public/` 3.38 GB/39k 文件）。
- 安装包里**不要带 `UPDATE.json`**（§7.6）。
- 素材体积数字请重新测：`.gitignore` 注释里的 `~270 MB` 已过时，实测 3.38 GB。
- 若采用 lite 包，需要给「首启下载」留一个启动期窗口/进度页（与本文 §6.3 路线 1 联调）。

**给 connect-ux.md**：

- 档位字段与取值**已由 APK 定义死**（`server_mode`/`server_role`/`remote_url`，§5.1），不要另起说法。
- 三张卡的中文字面量在 `docs/START-MODES-PLAN.md` §「文案落点」里逐行指过，桌面端照搬；**新增文案须先报字面量**（i18n 规矩）。
- 远程默认地址取 `MainActivity.kt:56-57` 那一组，**不要**用 `public/js/ui/modManagerModal.js:18`。
- 诊断面板要对齐 `docs/ANDROID.md` §3.3 的四项（连通性探测、局域网 IP、日志视图、一键复制）。

---

*调研方式：只读阅读 + 三次隔离实测（import 自动监听探测、programmatic `startServer` 计时与写盘核对、退出路径对比），
实测脚本均放 `%TEMP%`，未修改仓库源码，未做任何 git 写操作。*

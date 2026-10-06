# 第三方启动器兼容性对照

对照对象：[`Starst796/Stronghold-Protocol-Server-Launcher`](https://github.com/Starst796/Stronghold-Protocol-Server-Launcher)（下称"启动器"，commit `ec49b41`）
被对照方：本仓库（`server/index.js` + `tools/` 这套对外接口）

启动器是上游 `sganggs/Stronghold-Protocol` 的下载/启动外壳，它自己声明"不修改游戏逻辑"。核对下来这个声明基本属实：**它把 npm 安装、素材下载、诊断全部委托给项目自带的 `tools/*.mjs`**，所以绝大多数接口对得上。真正会出事的地方集中在**更新链路**和**素材产物**两处，见下一节。

## 1. 结论摘要

| 档 | 数量 | 说明 |
| --- | --- | --- |
| ✅ 已对齐 | 14 项 | Node 下限、`/healthz`、六个环境变量、`tools/` CLI 面、素材清单解析、CHANGELOG 格式、优雅关闭…全部实测可用 |
| ⚠️ 脆弱 | 8 项 | 现在能跑，但靠的是"两边恰好写死同一个值"，任一侧改动即静默失效 |
| ❌ 冲突 | 3 项 | 见下 |

三个需要优先处理的问题：

1. **`强制更新` 对 fork 分支是毁灭性的**（`repo.mjs:309-318`）。启动器固定 `git fetch <上游> master` 然后 `merge --ff-only`；本仓库当前分支 `feature/android-v0.1.5.1-pre` 相对上游 master 是 **领先 42 / 落后 12**，ff-only 必失败 → 界面提示"勾选强制更新" → 一点就是 `git reset --hard FETCH_HEAD`，**当前分支指针直接被搬到上游 master**。本仓库的 42 个提交只剩 reflog 和远端能救。
2. **`只下素材` 会把 git 跟踪的文件改脏**。`tools/fetch-assets.mjs` 要写 `data/assets.json`（**该文件被 git 跟踪**，且此刻工作区就是 ` M data/assets.json`）。于是"补素材 → 工作区变脏 → ff-only 更新失败 → 引导用户勾强制更新 → 第 1 条"形成完整链条。上游 #186/#73 刚动了素材链路（新增 `tools/assets/audio.mjs`、`plan.mjs` 改动），合并后玩家**必须**再跑一次素材下载，这条链被踩中的概率会明显上升。
3. **诊断步骤用错端口**（`index.mjs:159-160`）。doctor 这一步的 env 只有 `process.env`，没注入 `serverEnv(cfg)`，也没传 `--port`，而 `tools/doctor.mjs:151` 是 `Number(process.env.PORT) || 3000`。用户在配置里改成 3001 后，"环境诊断"报的仍是 3000 的端口/防火墙结论——**恰好是唯一会告诉他"防火墙没放行"的那个功能**。

另有一处启动器自己失效的假设：它给 `setup.mjs` 传了 `SP_LAUNCHER=1`（`index.mjs:142`），但**全仓库没有任何代码读这个变量**（已 grep 确认），意图中的"由启动器接管时改变行为"目前是空转。

## 2. 启动器的实际数据流

```
启动器.bat / start.sh    → 找 node（自带 runtime/ 的 msi 或便携 zip）→ Node≥22 检查
  └ launcher/index.mjs   → 监听 127.0.0.1:7878（自动挑空闲端口，pickPort 试 40 个）
       一键部署 = ①git clone --depth=1 --branch master <源> → game/
                  ②node tools/setup.mjs --quiet     ← 依赖/前端库/素材全在这一步
       启动服务器 = spawn(process.execPath, ['<dir>/server/index.js'],
                          env={...process.env, PORT,HOST,SP_COMBAT,SP_VERIFY,TRUST_PROXY,DEBUG})
                  → 轮询 GET http://127.0.0.1:<port>/healthz，40s 内 json.ok 为真即"运行中"
       更新 = git fetch <源>/master → merge --ff-only（勾选强制则 reset --hard）→ setup.mjs --quiet
       诊断 = node tools/doctor.mjs（optional，退出码忽略）
```

关键点：**它绕过了 `scripts/launch.mjs`**，直接 spawn `server/index.js`。

## 3. 逐项对照

### ✅ 已对齐（实测通过）

| 启动器假设 | 本项目事实 | 证据 |
| --- | --- | --- |
| 需要 Node ≥ 22，24 可用 | `engines: ">=22"`；CI 跑 22 与 24 | `package.json`、`.github/workflows/ci.yml:21-23` |
| 入口 `<dir>/server/index.js` | 是，且 `main()` 由 `isMain()` 保护，可直接 spawn | `server/index.js:795,804` |
| `GET /healthz` 返回含 `ok:true` 的 JSON 即就绪 | 恒 200 + `{ok:true, version, app, uptimeSec, build, sockets, sessions, ...}` | `server/index.js:697-704` |
| `PORT` 数值 / `HOST` 绑定地址 | 一致；非法值抛 `RangeError` | `server/index.js:649-651` |
| `SP_COMBAT=client\|server` | 只有字面 `server` 改变行为，传 `client` 无害 | `server/match/Match.js:170` |
| `SP_VERIFY=off\|sample\|all` | 完全一致（含 `sample` ≈1/8） | `Match.js:172-175,266` |
| `TRUST_PROXY=auto\|1\|0` | 一致，未知值回落 `auto` | `server/index.js:617-622` |
| `DEBUG` 非空即开 | 一致 | `server/index.js:630` |
| 委托 `tools/setup.mjs` / `vendor.mjs` / `fetch-assets.mjs` / `doctor.mjs` | 四个文件都在，`--quiet`、`--concurrency=N` 都是真 flag | `tools/setup.mjs:341`、`tools/fetch-assets.mjs:27,75` |
| 必需依赖名单 `ws,pixi.js,pixi-spine,preact,htm` + 必需 vendor 5 个文件 | 与 `tools/doctor.mjs` 的常量**逐字相同** | `launcher/lib/repo.mjs:18-19` |
| 素材完整度按 `data/assets.json` 里 `/assets/`、`/fonts/` 字符串抽查 | 实测：清单解出 7383 条引用，抽样 200 条**全部命中**，误报 0 | 本地跑过一遍 `assetStats` 等价逻辑 |
| 素材可中断续传 | 是，账本 + 重试 + 镜像回退 | `tools/assets/downloader.mjs` |
| SIGTERM 能停服，8s 超时再强杀 | 服务有优雅关闭（`room.closed{reason:'shutdown'}`、socket 1001），远小于 8s | `server/index.js:830-831,781` |
| 默认分支叫 `master` | 是 | `git remote show` |
| 局域网分享列 `http://<私网IP>:<port>` | 与本项目地址分类口径一致，`/lan/room` 只对本机/私网应答 | `server/index.js:321,710` |
| CHANGELOG 按 `## <版本> — <日期>` 解析 | 本项目格式正是这个（em dash），且被测试锁住 | `test/version.test.js:24-29` |

### ⚠️ 脆弱（能跑，但没有约束保护）

1. **`tools/` 的 CLI 面是隐式契约。** 启动器写死了 `setup.mjs --quiet`、`fetch-assets.mjs --concurrency=N`、`doctor.mjs`、`vendor.mjs` 四条命令与参数；`doctor.mjs` 遇到未知参数直接 `throw → exit 2`（`:167`）。改名、改参数风格、把 `--quiet` 拆成 `--log-level`，启动器就静默失败。
2. **两份一模一样的常量。** `RUNTIME_PACKAGES` / `VENDOR_REQUIRED` 在 `tools/doctor.mjs` 和 `launcher/lib/repo.mjs:18-19` 各有一份。本项目以后加一个必需 vendor 文件，只有 `inspectInstall()` 会误报"依赖不全"，没有任何测试会发现。
3. **`server/index.js` 被当成公开入口。** 项目自己的受支持入口其实是 `scripts/launch.mjs`（离线整合包生成的 `启动游戏.bat` 就是 `launch.mjs --no-setup`），它带前置 setup 与 30s 就绪探测。启动器绕过它，将来 `launch.mjs` 里新加的前置校验对启动器用户不生效。
4. **`probeHealth()` 固定 127.0.0.1**（`game.mjs:30`）。`HOST` 默认 `0.0.0.0` 没问题；一旦有人填具体网卡地址（非回环），启动器会在 40 秒后报"启动超时"，而服务器其实活着。
5. **版本语义错位。** 远程版本取自 highestTag（`version.mjs:15,46`），上游 tag 到 `v0.1.3` 为止；本地版本取 `package.json.version` = `0.1.3`。判定用的是"本地 HEAD ≠ 远端 master"，所以未打 tag 的中间状态会**永远提示有更新**，UI 显示成"本地 0.1.3 → 远程 0.1.3"。本项目 Android 侧的 `0.1.5.1-pre` 只在 `android/app/build.gradle` 里，`package.json` 看不到。
6. **"就绪"不含素材。** `inspectInstall().ready` 只看 package.json + node_modules + vendor（`repo.mjs:87`），素材只抽样 200 条。全新装机可能一片绿但美术全是 404。
7. **压缩包式更新只覆盖不删除。** `mergeCopy()`（`repo.mjs:208-217`）把新代码叠在旧目录上，保留 `node_modules/.cache/public/{assets,fonts,vendor}`，但**不会删掉上游已重命名/删除的文件**。本项目 `server/` 曾有文件重排的话，残留旧文件会被 ESM import 到。
8. **Node 运行时路径不一致。** 启动器整合包 Windows 只带 `node-v24.21.0-x64.msi`，走 `msiexec /i` → **需要 UAC**；本项目 `make-windows-bundle.mjs` 刻意用便携 zip（pin `v22.23.3`，带 sha256）做到无管理员。两套东西放同一台机器上会给出两套体验，且启动器版本 24 与项目 pin 版本 22 不同（CI 覆盖 22/24，功能上没问题）。

### ❌ 冲突

| 冲突 | 影响 |
| --- | --- |
| ff-only / `reset --hard` 对分叉分支 | 见 §1 第 1 条。**最严重** |
| `data/assets.json` 被跟踪 + fetch-assets 会写它 | 见 §1 第 2 条。上游因此"天生"会产生脏工作区 |
| `SP_LAUNCHER=1` 无人读取 | 启动器以为做了"由外部接管"标记，实际是空转；将来若项目实现该变量，语义要和启动器作者对齐 |

## 4. 建议

### 4.1 本项目侧：把隐式假设变成显式契约（真正"确保兼容"的做法）

按性价比排序。

**P0 — 处理 `data/assets.json` 的脏工作区问题**（三选一，推荐第一个）
- 只在内容真的变化时写文件（写前比对，无 diff 不落盘）；这一条同时解决"每次 setup 都 M 一下"和"误提交"。
- 或把它加入 `.gitignore` + 提供 `data/assets.lock.json`（跟踪、只读、由 `build-data` 生成）作为校验基线。
- 至少：`docs/DEPLOY.md` 加一节写清"下载素材会修改 `data/assets.json`，这是正常现象；**不要**在启动器里勾强制更新"。

**P0 — 明确声明 fork 不要用启动器更新**
在 `docs/DEPLOY.md` 的启动器章节写一句：本仓库（Android 分支）与上游 master 分叉，可以用启动器做**部署 / 启动 / 诊断**，但更新请用 `git pull` 走自己的远端。

**P1 — 给机器可读出口，让第三方不必抄常量**
- `tools/doctor.mjs --json`：输出 `{contract:1, node, missingPackages[], missingVendor[], assets:{total,missing}, port:'ours|free|busy|denied', firewall:{state,cmd}, addresses:[...]}`。现在 doctor 只有带符号的人类文本，第三方只能复制常量。
- `GET /healthz` 增加 `missingAssets` / `ready` 字段（纯增量，`buildGuard` 不受影响）。
- 加一个 `docs/LAUNCHER-CONTRACT.md`（或本文件精简版）列出受支持的公共面：6 个环境变量、`/healthz` 字段、4 条 `tools/` 命令及其 flag、`server/index.js` 路径、CHANGELOG 标题格式、默认分支名。**并说明改动它们算破坏性变更**。

**P1 — 用测试把契约钉住**
扩到 `test/version.test.js` 旁边，例如断言：`doctor.mjs` 的 `RUNTIME_PACKAGES`/`VENDOR_REQUIRED` 与 `package.json` deps + `vendor.mjs` 实际产物一致；`/healthz` 返回体的 key 集合包含承诺字段；四条 `tools/*.mjs --help` 里 flag 名字还在。这类断言是唯一能防"启动器静默失配"的东西。

**P2 — 版本与 tag 策略**
每次 master 发布都打 `vX.Y.Z` tag（启动器远程版本只来自 tag，不打就永远显示旧版本）；保持 `## X.Y.Z — 日期` 的 em dash 格式（启动器的正则 `^([\w.\-+]+)\s*[—–-]\s*(\S+)?` 不认 `[X.Y.Z]` 方括号写法）；默认分支若要从 `master` 改名，必须先通知启动器作者——它 `ls-remote refs/heads/master` 是硬编码。

**P2 — 防火墙与局域网**
`coop` 场景下 Windows 拦入站是最高频故障，而启动器只会"诊断出来说一句"。项目侧可让 `doctor --json` 直接给出 `firewall.cmd`（现成命令在 `docs/DEPLOY.md`：`netsh advfirewall firewall add rule name="Stronghold Protocol" dir=in action=allow protocol=TCP localport=3000 profile=private,domain`），启动器就能一键复制/执行。另外分享链接建议优先给 `/lan/room?code=XXXX` 邀请链接（本项目已有该路由，且只对本机/私网回答）而不是裸 `http://IP:port`——和"只填邀请码不填 IP"的既定方向一致。

**P2 — 本地客户端素材在启动器里永远拿不到**
`setup.mjs` 的提取分支要求 TTY 或 `-y/--local`；非 TTY 时 `ask()` 返回 `null` → 明确跳过（`tools/setup.mjs:110-113,449`）。启动器只传 `--quiet`，所以装了明日方舟客户端的玩家通过启动器**永远**没有 3D 棋盘贴图。要么在 DEPLOY 里写明需要 `node tools/setup.mjs --local`，要么在契约里给启动器留一个"提取本地素材"按钮位。

### 4.2 可以给启动器作者提的 issue（每条独立可提）

1. **更新前判断是否分叉/是否同源**：拿 `gitInfo(dir).remote` 与 `source.git` 比对，不一致或分支不是 `master` 时禁用 ff-only/reset 两条路径，只做提示。同时把"强制更新"的文案从"丢弃本地修改"改成会真的说清 `git reset --hard FETCH_HEAD` 会把当前分支指向上游 master。这是最有价值的一条。
2. **doctor 步骤注入 `serverEnv(cfg)` 并传 `--port=${cfg.port}`**（`index.mjs:159-160`）。
3. **`SP_LAUNCHER` 要么实现要么删掉**：目前它对项目行为没有任何影响。若要"由启动器接管"，实际有效的做法是给 setup 传 `--no-local`（避免无意义扫描）或后续由 doctor 提供 `--json`。
4. **素材完整度改用 `doctor --json` / 清单全量校验**，并把 `ready` 计算纳入素材；现在只看 200 条抽样且不含美术。
5. **`probeHealth` 用配置里的 host**，非回环绑定时不要用 127.0.0.1 判定死活。
6. **启动走 `node scripts/launch.mjs --no-setup --port N`**，跟着项目自己的入口走，项目以后加的前置检查才自动生效。
7. **控制面板无 CSRF 防护**：`httpd.mjs` 只绑 `127.0.0.1`，但我没看到 Host/Origin 校验，而 `/api/deploy`（跑 npm）、`/api/open`、`/api/quit` 都是 POST。任何网页用 DNS rebinding 或跨源表单提交都可能触发。建议校验 `Host: 127.0.0.1:PORT` + 一次性 token。*（这条也是反向提醒：本项目 Android 内嵌 Node 若将来暴露同类本地面板，同一个坑要提前避开。）*
8. **Windows 集成包改用便携 zip**（和本项目 `make-windows-bundle.mjs` 的 `v22.23.3` + sha256 一致），避免 msiexec 弹 UAC，并统一 Node 版本。

## 5. 一句话给决策

启动器可以放心用在自己的开发机上做**部署 / 启动 / 诊断**三件事；**更新一律走 git 自己的远端，永远不要勾"强制更新"**。项目侧真正需要动手的是 P0 两条（`data/assets.json` 无变化不写盘、DEPLOY 里写清 fork 不更新），剩下的都是把已经存在的隐式契约显式化，成本不高但能防住以后所有第三方外壳。

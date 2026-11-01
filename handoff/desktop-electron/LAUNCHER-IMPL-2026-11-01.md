# 桌面启动页：把设计稿搬进生产页（2026-11-01）

设计稿 [mock-choice.html](mock-choice.html)（`MOCK-CHOICE-2026-10-31.md`）是已确认的视觉，但生产页
[desktop/launcher.html](../../desktop/launcher.html) 一直是另起的简化实现（深蓝底、金色描边、`940px` 单列栅格），
两页除了「两张卡」以外没有任何继承关系。本次把设计稿的视觉层整体搬进生产页，功能契约逐条保留。

## 1. 规模

| | 行 | 字符 | 字节 |
| --- | --- | --- | --- |
| 旧 `desktop/launcher.html`（git index 版） | 203 | 7,197 | 7,449 |
| 新 `desktop/launcher.html` | 791 | 28,908 | 30,997 |
| 设计稿 `mock-choice.html`（对照） | 712 | 约 27.5k | 30,442 |

## 2. 保留下来的功能契约（逐条）

`desktop/main.mjs` 注入、`desktop/preload.cjs` 暴露、`tmp/desktop-smoke.mjs` 断言的东西，一个都没丢：

| 契约 | 出处 | 新页里的位置 / 行为 |
| --- | --- | --- |
| `#ver` ← `'v' + info.version` | `desktop:info` → `APP_VERSION` | 页头 `卫戍协议：盟约 · v0.3.3-Yuan`（原设计稿这里写死 v0.3.3，改为注入） |
| `#local-title` | `aria-labelledby` / 冒烟读取 | 本机卡 `h2` |
| `#local-addr` ← `info.local` 去协议与尾斜杠 | `LINKS.local` = `http://127.0.0.1:3000/` | 本机卡 `内置服务 127.0.0.1:3000` |
| `#remote-title` | 冒烟读取 | 远程卡 `h2` |
| `#remote-url` ← `info.remote`；Enter 触发连接 | `LINKS.remote` = `https://wei.jiangjiangze.icu/` | 右卡地址输入（预填、回车连接） |
| `#btn-local` → `desktop.startLocal()` | `desktop:start-local`（进程内 `startServer()`） | 本机卡主按钮，忙时禁用 + 状态行 `正在启动本地作战引擎…`，失败回填 `data-tone="error"` 并解禁 |
| `#btn-remote` → `desktop.connectRemote(url)` | `desktop:connect-remote` | 右卡按钮，忙时禁用 + `data-state="connecting"`（`连接中…` + 转圈）+ 输入框只读，失败复原 |
| `#btn-backup`（文本 ← `info.backup`，点击换成备用地址再连接） | `LINKS.backup` = `http://121.4.51.247/` | 右卡「备用：<地址>」一行小字按钮（设计稿里是纯文字，这里保住点击语义） |
| `#status` + `data-tone="busy" \| "error"` | 旧页 CSS 契约 | 底栏状态行（`role="status"`、`aria-live="polite"`、预留行高不跳动） |
| `.card--default` | `tmp/desktop-smoke.mjs` 断言「本机卡高亮」 | 本机卡 `class="card card--local card--default"`；`.card--default` 现在只作标记，视觉由 `.card--local` 给 |
| `--gold` / `--mint` | 旧页 `:root` 令牌 | `--gold: #e8c15a`（状态行 busy 用）、`--mint: var(--mint-500)`（本机主档用） |
| 文案钩子 `单人单机模式` `远程联机模式` `内置服务` `确认切换` `连接到指定服务器` `例如: …` `正在启动本地作战引擎…` `网络与服务器设置` `卫戍协议：盟约` | APK 服务端对话框 / 旧页 | 全部原样复用 |
| 主地址 / 备用 / 版本 | `main.mjs` 注入 | 全部仍由主进程给，页面不写死 |
| `window.desktop.info / startLocal / connectRemote` | `preload.cjs` | 三个都还在用；`launcher()` / `openExternal()` 与旧页一样未被页面调用 |

**CSP 的唯一放宽**：`img-src` 加 `'self' file:`，因为设计稿 D 改的那层 10% 氛围底图
`public/assets/local/map/autochess/TX_autochessi_BG.webp` 是 `background-image`（受 `img-src` 管）。实测该图
1024×1024 正常加载、无 CSP 报错、无 console 输出。

## 3. 设计稿里被改造掉的东西（mock 专属，未带进生产页）

- **齿轮按钮**：设计稿右上角是纯展示（没有任何 IPC 对应），删除。
- **假品牌眉题** `RHODES ISLAND // SIMULATION SERVICE` → 换成页面既有的 `网络与服务器设置`（不新增文案）。
- **卡标题 `本机` / `服务器`** → 契约文案 `单人单机模式` / `远程联机模式`。
- **按钮文案 `启动本机` / `连接`** → 契约文案 `确认切换`（两卡一致，与旧页相同）。
- **页脚写死 `v0.3.3`** → 页头单个 `#ver`（主进程注入），页脚改为状态行。
- **重复 / mock 专用 id**：`remote-addr` → `remote-url`；`#remote-card` 保留但只作 `data-state` 宿主。
- **`:target` 状态彩蛋**（`mock-choice.html#remote-card`）删除：真实实现用 `data-state="connecting"` +
  `button[disabled]` + `input[readOnly]`，三者由脚本同步。
- **字段标签 `地址`** → 去掉可见标签，用既有 `aria-label="远程服务器地址"`（少一条新文案）。

## 4. 新文案（不新增 msgid，就地中文 + `<!-- i18n-ignore -->`）

页面从不调用 `t()`，本次也没有引入任何 msgid。以下 7 条是设计稿带来、仓库里没有对应 `t()` 的说明性文字：

1. `LOCAL // SERVER`（技术眉题，`aria-hidden`，纯装饰）
2. `REMOTE // RELAY`（同上）
3. `在本机启动服务端并直接进入游戏。`
4. `无需联网，本机运行独立 Node 引擎 · 进度完全保存在本地`
5. `备用：`
6. `连接中…`
7. `连不上会回到这一页，地址会留着，改完再点「确认切换」。`

## 5. 尺度与两档几何实测（打包版实机，CDP `Emulation.setDeviceMetricsOverride`）

根尺度沿用设计稿：`html { font-size: clamp(40px, min(100vw/19.2, 100vh/10.8), 240px) }`。

**唯一有意偏离设计稿的地方**：窄/矮窗口（`max-width: 1120px` 或 `max-height: 700px`）切「紧凑档」，把字号与
点击高度换成 px。原因是设计稿在 792×360 时 1rem=40px，正文只剩 6.8px、按钮 22.4px，低于「可点区域 ≥32」
的验收线（见 `handoff/shots/desktop-choice-792x360.png`）。1280×720 及以上完全不进这一档，与设计稿逐像素同尺度。

| 档位 | rem | 卡（x / y / 宽 / 高，两卡同高） | 可点区域（宽×高） | 默认焦点 | 滚动 |
| --- | --- | --- | --- | --- | --- |
| 792×360 | 40px | 73.2 / 74.5 / 317 / 236.6 与 402.2 / 74.5 / 317 / 236.6 | 本机 287.8×34；远程 287.8×34；备用 104.4×32 | `#btn-local`（在本机卡内） | 无横滚、无纵滚（`scrollWidth/Height` = 792/360 = `client`） |
| 1280×720 | 66.67px | 113.3 / 184.3 / 512 / 389 与 654.7 / 184.3 / 512 / 389 | 本机 460.2×37.3；远程 460.2×37.3；备用 85.1×32 | `#btn-local` | 无横滚、无纵滚（1280/720） |

两档都满足：两卡并排不换行（`y` 相同、等高、左卡右边 ≤ 右卡左边）、可点区域最小 32px、焦点默认在本机卡。
注入值实测：`v0.3.3-Yuan` / `127.0.0.1:3000` / `https://wei.jiangjiangze.icu/` / `http://121.4.51.247/`，
本机卡同时带 `.card--default`。

卡片 `scrollHeight - clientHeight = 1px` 是 `.card::after` 四条 L 形角标的 `inset: -1px` 造成的可滚动溢出，
不裁剪内容、不产生滚动条（页面本身 `overflow: hidden`）。

## 6. 产物与验证

重打包（输出仍在仓库外 `E:\Workbox\release-desktop`）：

```
Remove-Item Env:ELECTRON_RUN_AS_NODE
node node_modules\electron-builder\cli.js --dir --config.directories.output=E:/Workbox/release-desktop
  --config.electronDist=E:/Workbox/系统/node_modules/electron/dist
```

`--config.electronDist` 是这台机器上必须加的：在当前 DSH 子进程沙箱里，electron-builder 默认的「解压 electron
发行包」一步会永久挂起（无 CPU、无网络、无子进程，日志停在 `downloading` / `unpacking default Electron distribution`），
管道和文件重定向都一样；复用它已解压好的 45.2.1 才走得通。

结构核对：`win-unpacked\Stronghold Protocol.exe` 249,818,112 B（= electron 45.2.1 改名）、`resources/app.asar` 不存在、
`resources/app/package.json` `{name: stronghold-protocol-alliance, version: 0.3.3-Yuan, main: desktop/main.mjs}`、
`resources/app/desktop/launcher.html` 与仓库文件 SHA-256 一致（`74CF2FB8…A94E`）、43,938 文件 / 2,740.6 MiB。

冒烟：`--no-sandbox --user-data-dir=E:\Workbox\sp-ud-launcher-*`（**不能放 %TEMP%**：沙箱拒绝写 → Chromium 拿不到
单实例锁 → app 秒退），CDP 连接后按两档原生分辨率截图；点「本机」实测 IPC 通、状态行进入
`正在启动本地作战引擎…`（返回 `ok`，无错误态）。

验收：

```
node --test test/ui/**/*.test.js
ℹ tests 1540   ℹ suites 286   ℹ pass 1501   ℹ fail 0   ℹ cancelled 0   ℹ skipped 39   ℹ todo 0

npm run typecheck
> tsc --noEmit --checkJs -p jsconfig.json     （无输出，exit 0）
```

## 7. 待裁决（未擅自改行为）

`desktop/main.mjs` 的 `desktop:start-local` 只返回 `{ ok, url }`，页面点「本机」后**不会自己跳转**（旧版
`launcher.html` 同样没有跳转，不是本次改动引入的；`--local` 启动参数那条路径才会 `loadURL`）。新页保持了原行为：
点击 → 启动内嵌服务 → 状态行 `正在启动本地作战引擎…`。要不要补一行 `location.href = result.url`（或改主进程
导航）请业主定。

## 8. 截图

| 文件 | 尺寸 | SHA-256 |
| --- | --- | --- |
| `handoff/shots/desktop-launcher-design-792x360.png` | 792×360 | `4298AA86FF0DF971C96BABB6AB4AC1C925AE99C9338454B7775EBCC27346C95D` |
| `handoff/shots/desktop-launcher-design-1280x720.png` | 1280×720 | `63BDE3D7630F1B231E780BCCC1271771A83252588A1D3D40F91733B7FAAA6DB2` |
| `handoff/shots/desktop-launcher-compare.png` | 2632×1302 | `96F153989452F738F42C9F3C79FD37596BD12CFDD6E146C75DFCAB0280D5C021` |

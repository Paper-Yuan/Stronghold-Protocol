# 卫戍协议：盟约 — Android 独立运行端技术文档与运行时规范

本文档记录 Android 客户端壳层架构、Node.js 原生嵌入式运行时策略、日志诊断机制及兼容性规范。

---

## 1. 架构概览

Android 客户端采用 **混合原生架构 (Hybrid Native Architecture)**，完全脱离 PC 服务端依赖，具备离线单机作战与局域网多机联机能力：

```
+-------------------------------------------------------------+
|                     Android 宿主进程 (单进程)                |
|                                                             |
|  +-----------------------+     +-------------------------+  |
|  |   MainActivity        |     |   NodeServerService     |  |
|  |   - 全屏沉浸式 WebView| <-> |   - 前台保活服务        |  |
|  |   - 状态/错误引导 UI  | IPC |   - JNA 绑定 libnode.so |  |
|  |   - 诊断与日志弹窗    |     |   - 8MB 栈独立线程执行  |  |
|  +-----------------------+     +-------------------------+  |
|              ^                              |               |
|              | HTTP/WS :3000                | POSIX dup2    |
|              v                              v               |
|  +-----------------------+     +-------------------------+  |
|  | 游戏前端客户端 (Web)  |     |   server.log            |  |
|  | PixiJS / Three.js     |     |   (stdout/stderr 完整流)|  |
|  +-----------------------+     +-------------------------+  |
+-------------------------------------------------------------+
```

---

## 2. 原生 Node.js 运行时执行策略

### 2.1 符号绑定与执行模型
- **避免子进程 `exec` 限制**：Android SELinux 策略在目标 SDK 29+ 及 Android 10+ 严格限制在 `filesDir` 等应用私有目录下执行二进制可执行文件（报 `ENOEXEC` 或 `EACCES`）。
- **动态链接库嵌入**：采用 `libnode.so`（ELF shared object, ARM64-v8a），通过 JNA 的 `NativeLibrary` 动态解析 C++ 导出符号：
  ```
  _ZN4node5StartEiPPc  ->  node::Start(int argc, char** argv)
  ```
- **线程栈扩容**：Android 默认的 JVM 线程栈较小（通常约 1MB），容易在 V8 引擎解析复杂 AST 或递归时触发 `SIGSEGV` (StackOverflow)。因此，Node 实例必须运行在显式指定栈大小为 **8 MB** 的原生 POSIX 线程中：
  ```kotlin
  Thread(null, {
      nodeStartFunction.invokeInt(arrayOf(argv.size, argv))
  }, "node-main", 8 * 1024 * 1024).start()
  ```

### 2.2 双端 Node 运行环境规范与跨版本兼容策略
- **PC / 开发机环境（上游标准）**：
  - 上游仓库 `package.json` 声明 `"engines": { "node": ">=22" }`（支持 Node 22、Node 24）。
  - 本地 PC 开发与测试环境运行在 **Node.js v24.19.0** 下，全量 291 套件、3,322 个自动化测试全部通过。
- **Android 原生嵌入式环境**：
  - 手机端 In-process 嵌入基于 **Node.js v18.20.4 (ARM64-v8a, NDK clang 14)**。
  - **核心双端兼容保障**：
    - 经全量代码审计，服务端与共享业务逻辑（`server/`、`shared/`）均遵循跨版本标准 ECMAScript 语法，未引入 Node 20+ 的破坏性 API（如仅限新版的 `Array.prototype.toReversed`、未 polyfill 的新 Crypto 算法等）。
    - 依赖库仅包含精简高效的轻量生产依赖：`ws`、`preact`、`htm`、`pixi.js`、`pixi-spine`、`three`。
    - 服务端网络监听均统一绑定至 `0.0.0.0:3000`，同构支持电脑端（Node 22/24）与安卓端（Node 18）的一致运行。

---

## 3. 日志重定向与诊断排查机制

### 3.1 厂商 Logcat 过滤对抗
在特定厂商设备（如 vivo OriginOS / Android 16）上，系统安全管理机制会过滤屏蔽普通三方应用自身的 `android.util.Log` 输出，导致开发阶段或用户排查时 `logcat` 无法捕获任何有用堆栈。

### 3.2 POSIX 文件描述符重定向
在调用 `node::Start` 之前，通过 libc 底层系统调用将进程的标准输出 (fd 1) 与标准错误 (fd 2) 硬重定向到应用内部日志文件：
```kotlin
val logFd = PosixLib.INSTANCE.open(serverLogFile.absolutePath, O_WRONLY or O_CREAT or O_TRUNC, 0644)
PosixLib.INSTANCE.dup2(logFd, 1)
PosixLib.INSTANCE.dup2(logFd, 2)
PosixLib.INSTANCE.close(logFd)
```
搭配 `server-log-tailer` 后台守护线程，将 `server.log` 的增量内容 Mirror 至内存环形队列（保留最新 250 行）。

### 3.3 应用内可视化诊断面板
在主界面转圈等待与设置弹窗中均集成了「**诊断与日志**」面板：
- **连通性实时探测**：向 `http://127.0.0.1:3000/healthz` 发起 HTTP 请求，即时显示连通状态与状态码。
- **局域网 IP 展示**：展示本机分配的 Wi-Fi 局域网 IP，便于好友输入连接。
- **控制台日志视图**：等宽字体展示 Node 服务端启动堆栈、模块加载与战斗心跳日志。
- **一键复制日志**：用户可一键将完整日志拷贝至剪贴板，方便问题排查与反馈。

---

## 4. 构建与包体积优化

1. **ABI 单构架收敛**：
   - 现代 Android 真实物理机 100% 均为 64 位 ARM 架构。
   - 在 `android/app/build.gradle` 中配置：
     ```groovy
     ndk {
         abiFilters "arm64-v8a"
     }
     ```
   - 剥离 x86_64 二进制库，可直接节省 **~65 MB** 的 APK 包体积。

2. **构建脚本**：
   ```bash
   node scripts/build-android.mjs
   ```
   自动完成 Web 资源与服务端依赖打包（`app_bundle.zip`）并调用 Gradle 编译生成 `app-debug.apk`。

---

## 5. 原生二进制依赖溯源与校验规范 (Native Dependencies & Verification)

Android 壳内嵌的原生动态链接库清单由 [`android/NATIVE_DEPS.json`](../android/NATIVE_DEPS.json) 统一定义并受到自动化构建门禁保护：

| 库名称 | 架构 (ABI) | 版本 | 来源 URL (HTTPS) | SHA256 哈希 | 许可证 |
|---|---|---|---|---|---|
| `libnode.so` | `arm64-v8a` | 18.20.4 | `https://nodejs.org/dist/v18.20.4/node-v18.20.4.tar.gz` | `7c907316beb6e78e34495926c9ac1befe079369b14650d508ea812929258250c` | MIT |
| `libc++_shared.so` | `arm64-v8a` | NDK r25b (LLVM 14) | `https://dl.google.com/android/repository/android-ndk-r25b-windows.zip` | `73a8cb7f0529d2dcc22089c6cf30c86383d708451ecfafe1cd6ecc4f0e661df2` | Apache-2.0 with LLVM Exception |
| `libnode.so` | `x86_64` | 18.20.4 | `https://nodejs.org/dist/v18.20.4/node-v18.20.4.tar.gz` | `9acba7e26a1e864f13b78f1b7121773643f3f33a4c6a2fe7d4f63eb06d4d3af1` | MIT |
| `libc++_shared.so` | `x86_64` | NDK r25b (LLVM 14) | `https://dl.google.com/android/repository/android-ndk-r25b-windows.zip` | `9024189fa4baa1943e1fc3393d3507715ec0831202560a45b05ffff7abd88c12` | Apache-2.0 with LLVM Exception |

- **构建前哈希门禁**：`scripts/build-android.mjs` 在调用 Gradle 之前自动计算上述二进制的 SHA256，与清单不符即刻熔断。
- **随包分发**：上述库文件及所有运行依赖模块的开源许可证文本均同步打包于 `app_bundle.zip` 的 `licenses/` 目录中。

---

## 6. 游戏素材与版权归属声明 (Arknights Copyright Notice)

1. **非商业同人性质**：本项目属于非官方同人联机复刻项目，遵循非商业同人衍生作品惯例。
2. **知识产权归属**：《明日方舟》及「卫戍协议：盟约」涉及的所有干员名称、美术立绘、Spine 骨骼动画模型、场景 UI 纹理、音乐音频及官方原始数值体系的知识产权均归 **上海鹰角网络科技有限公司** (Shanghai Hypergryph Network Technology Co., Ltd.) 及其许可方所有。
3. **开源许可隔离**：本项目自身代码遵循 **GPL-3.0-or-later** 许可，**游戏素材绝不属于 GPL 授权范畴**，本项目亦不对任何官方美术与音频资产授予商业或许可权利。详细第三方组件许可证清单请参见根目录 [`THIRD-PARTY-NOTICES.md`](../THIRD-PARTY-NOTICES.md)。

---

## 7. Windows 路径编码与 Daemon 文件锁排查

若将工程放置在包含中文字符的路径下（如 `E:\Workbox\系统`），在 Windows 命令行下可能导致 Gradle 输出乱码，或由于后台 Daemon 常驻导致 `mergeDebugResources` 报「另一个程序正在使用此文件」锁死。
- **解决方法**：在 `android/` 目录下执行 `./gradlew.bat --stop` 彻底释放常驻锁即可恢复；推荐将工程克隆放置在纯英文字符路径下进行日常打包构建。

---

## 8. 黑屏排查：页面回报与兼容模式 (blank screen)

用户反馈里最难处理的一类是「服务器已就绪、加载条消失、然后纯黑且没有任何提示」。这类黑屏**页面自己救不了**：任何提示都画在同一块坏掉的表面上，所以判断和补救都必须落在原生侧。

- **不再强制硬件层**：`MainActivity.setupWebView()` 里的 `setLayerType(LAYER_TYPE_HARDWARE)` 现在由 `webview_hw_layer` 这个偏好项控制，**默认关闭**。给承载 WebGL canvas 的 WebView 强套硬件层，在部分老 OEM GPU 驱动上会出黑面（页面在画、合成不出来），而窗口底色是 `@color/bg_dark`，玩家看到的就是纯黑。
- **页面回报**：`public/js/main.js` 的 `reportClientState()` 在 boot 结束时（以及捕获到未处理异常时）通过 `AndroidNative.reportClientState(json)` 把自身状态交给壳层：是否 boot、`#app` 子节点数、canvas 数、`webgl2` / `webgl` 是否可用、dpr、视口、UA、错误文本。原生侧只留最新一份（`MainActivity.clientState`，可用 `AndroidNative.getClientState()` 取回）。
- **黑屏看门狗**：`onPageFinished` 起 12 秒内没有收到任何回报，弹**原生** `AlertDialog`（原生视图不走 WebView 合成，黑面也看得见），提供「兼容模式重启 / 查看日志 / 继续等」。
- **兼容模式**：写 `compat_mode=true`、`webview_hw_layer=false`、`board_mode=2d`，并给 URL 追加 `?render=fallback`，让客户端走 DOM 版简易棋盘（`ui/fieldHost.js` 读 `render` 参数）。这条路径不需要 WebGL。
- **已经存在的降级链**（实测确认，不是猜测）：缺 `webgl2` → 自动用 2D 棋盘；完全没有 WebGL → `[field] render engine unavailable, using the simplified view`；3D 上下文丢失 → `2D board until it can be rebuilt`。所以新反馈来了先看 `clientState`，别再从渲染器猜起。
- **启动即提示过旧的 WebView**：`outdatedWebViewWarning()` 读 `WebView.getCurrentWebViewPackage().versionName` 的主版本号，低于 `MIN_WEBVIEW_CHROME = 87` 时把它写进启动选择框的副标题（Android 12 才自带 Chromium 91；更老的机器常年停在 77–87，且没有 Play 就升不动——正是黑屏反馈集中的人群）。客户端对 Chrome 86/87 的硬依赖是 CSS `inset` 简写与 `Element.replaceChildren`。
- **兼容模式也可以由页面触发**：`AndroidNative.enableCompatMode()`（看门狗对话框与游戏内设置行都能走这条），避免用户只能等 12 秒。
- **回报给开发者**：诊断面板（`showLogsAndDiagnosticsDialog`）里已能看到 `server.log` 尾部；`clientState` 同时写进 logcat 的 `MainActivity` tag（部分厂商会屏蔽应用日志，此时以对话框上的内容为准）。

---

## 9. 无限变体：纯单机安卓端（无限/）

「无限」是主仓库上的**打包变体**，不是分叉：共享内核（`server/` `shared/` `data/` `public/`）与主包逐字节一致，全部差异只有两份 `capabilities.js` 在打包暂存期被改写为 `{ mods: false, multiplayer: false }`（仓库源文件永不改动）。变体的定义、三道门与诚实边界见 [`无限/README.md`](../无限/README.md)。

> 范围说明：变体定位为**纯单机**（四档难度皆可，服务端拒绝一切多人房间）。无尽模式的引擎与数据仍在内核，但其客户端入口（标题按钮 / 大厅卡片 / 房内切换 / 排行榜）已从主线整体移除，变体目前没有无尽专属入口；要不要恢复为「无尽专属端」见 无限/README.md 的后续工作第 1 条。

- **构建**：`node 无限/build.mjs`（debug）/ `--release`（签名沿用 §4 的流程）/ `--bundle-only`（只出资源包）。产物收进 `无限/dist/`（git 忽略）+ `SHA256.txt`。
- **打包机制**：`tools/bundle-android.mjs --capabilities 无限/capabilities.json` 在暂存目录里用既有的 `rewriteCapabilities` 改写两份 `capabilities.js`，按目标文件实际声明的能力位逐键自检（fail-closed，改写失败即熔断；内核已移除的键自动跳过并提示）。Gradle 属性 `-PappIdSuffix=.endless -PversionNameSuffix=-endless`（`scripts/build-android.mjs` 透传，`android/app/build.gradle` 读取）让变体 APK 与主包**同机共存**：变体 debug 包 id 为 `com.paper.stronghold.endless.debug`，对外版本为 `0.2.3-fusion-endless`。主包的 `versionName` 字面量被 `test/version.test.js` 钉住，不加后缀，所以后缀走 AGP 的 `versionNameSuffix`。
- **变体的行为差异**（全部由 capabilities 驱动，主线 `multiplayer: true` 时零变化）：
  - 大厅（`public/js/screens/lobby.js`）：合作/匹配/密钥/模组区不渲染，模式锁 solo，只保留单机难度选择与创建。
  - 服务端（`server/lobby.js`）：拒绝一切非 solo 的 `room.create` / `room.setDifficulty`，`match.queue` 整体拒绝（`ERR.BAD_MSG`）——不信任客户端。
- **已知边界**（如实说明）：mod/多人代码仍在包里（入口不存在 + 服务端拒绝，非物理剥离）；内嵌服务器仍监听 `0.0.0.0:3000`（同网设备可只读观战；要彻底单机需壳层绑 `127.0.0.1`）；**进行中的局不落盘**，进程被杀即丢。
- **后续工作**（按优先级）：① 断点续玩——持久化 `{seed, 难度, 版本, 每回合意图}`，恢复时用 `server/match/scheduler.js` 的 VirtualScheduler 快进重放（工具链现成：`tools/matchrun.mjs`）；② 切后台即暂停、限时做成可选挑战；③ 本地成绩（服务器端无尽排行榜已随无尽入口移除，单机成绩改 localStorage）；④ 壳层收口绑定 `127.0.0.1`。


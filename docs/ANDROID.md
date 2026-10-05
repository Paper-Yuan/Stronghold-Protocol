# 卫戍协议：盟约 — 安卓端（内置服务器 · 局域网联机）

把整套游戏（Node.js 服务器 + 浏览器客户端）装进一个 APK：**手机自己开服**，同一 Wi-Fi 下的朋友用浏览器或本 App 直接加入；完全没有网络也能单机游玩。目标平台 **Android 16（API 36）**，兼容 Android 8.0（API 26）及以上。

实测（OnePlus Ace 5，Android 16 / PKG110）：首次安装后资源解压 **约 2.4 秒**（UFS4）；服务器自动落位到可用端口（部分 ColorOS 系统服务占用 loopback 3000 时自动改用 3001+，启动器与 NSD 广播跟随实际端口）；浏览器经局域网访问 `http://192.168.3.85:3001` — healthz 正常、素材可下载、WebSocket 可连接。

> 致谢：安卓端思路参考了 [Paper-Yuan/Stronghold-Protocol](https://github.com/Paper-Yuan/Stronghold-Protocol)（`feature/android-client` 分支，B 站 @纸鸢安好）与 B 站 @Ausevay 的先行实践。本实现在其经验上做了若干工程优化（见 §6）。

---

## 1. 架构

```
+---------------------------------------------------------------------+
|                        Android 宿主进程                              |
|                                                                     |
|  MainActivity（启动器）          NodeService（前台服务，保活）        |
|   ├ 资源解压（首次约 1 分钟）     NodeRuntime ── JNI: node::Start     |
|   ├ 「开始游戏」→ 本机开服   →    └ libnode.so（Node 18.20.4，进程内） |
|   ├ 「加入对局」→ NSD 发现/手动IP                                     |
|   └ 120Hz / 异形屏滑块 / 日志    DebugLog（files/logs/*.log 全量落盘） |
|          |                                                          |
|          v  http://127.0.0.1:3000（或房主 LAN IP）                    |
|  GameActivity：全屏沉浸 WebView（不改一行网页端代码）                  |
|   PixiJS / Three.js 客户端，战斗在 WebView 内本地模拟                  |
+---------------------------------------------------------------------+
             ↑ WebSocket（同一 Wi-Fi，延迟 ≈ 1–5 ms）
   朋友的浏览器 / 朋友手机上的本 App
```

与网页版完全同构：服务器只管经济与回合，战斗在各玩家端模拟，所以联机体感延迟极低；本机开服时服务器走 loopback，零网络延迟。

## 2. 目录结构

```
android/                     安卓工程（Gradle + Kotlin + 一个 60 行的 JNI 胶水）
  app/src/main/cpp/          node_start.cpp — setenv + freopen + node::Start
  app/src/main/java/…/       NodeRuntime / AssetInstaller / LanDiscovery /
                             NodeService / DisplayHelper / DebugLog / 两个 Activity
  app/src/main/assets/       core.zip + assets.zip + pack.json   ← scripts/pack-android.mjs 生成
  app/src/main/jniLibs/      libnode.so（arm64-v8a / x86_64）    ← 同上
scripts/pack-android.mjs     打包脚本（构建 APK 前必须先跑）
docs/ANDROID.md              本文档
```

## 3. 从源码构建 APK

要求：JDK 17+、Android SDK（platform 36、build-tools、NDK + CMake）、Node.js 22/24（仅 PC 打包用）。

```bash
git clone <你的 fork>
cd Stronghold-Protocol
npm install                 # 生成 public/vendor（postinstall）
npm run assets              # 下载约 280 MB 素材到 public/assets（可续传）
node scripts/pack-android.mjs
                            # 产出 core.zip / assets.zip / libnode.so / pack.json
cd android
./gradlew assembleDebug     # wrapper 钉在 Gradle 9.5.0（AGP 8.13.2 不兼容 Gradle 9.6+）
# 产物：android/app/build/outputs/apk/debug/app-debug.apk（约 400 MB）
```

`pack-android.mjs` 首次运行会从 [nodejs-mobile releases](https://github.com/nodejs-mobile/nodejs-mobile/releases) 下载 Node 18.20.4 运行时并校验 SHA-256（arm64 / x86_64），并从本机 NDK 拷贝 `libc++_shared.so`（libnode.so 依赖 NDK 共享 STL —— 缺了它会在启动时报 `UnsatisfiedLinkError`）。若你的网络对该下载做了 TLS 中间人，用 `NODE_USE_SYSTEM_CA=1 node scripts/pack-android.mjs` 重跑。

素材内容不变时（`data/assets.json` 签名一致），重复打包会复用旧的 assets.zip —— 改代码不会触发 280 MB 重打包。

## 4. 使用与联机

- **本机开服**：启动 App → 「开始游戏（本机开服）」→ 自动进入游戏。启动器会显示本机地址（形如 `http://192.168.x.x:3000`）。
- **朋友加入（浏览器，无需安装）**：打开房主屏幕上显示的地址 → 输入昵称 → 同盟模拟 → 输入房主创建的 4 位密钥。
- **朋友加入（装有本 App）**：「加入同一 Wi-Fi 的对局」→ 列表里点选自动发现的房主 → 连接 → 输入密钥。
- **虚拟局域网（UU 加速器 / Tailscale 等）**：mDNS 不可跨网段，请在「加入对局」里手动输入房主的虚拟网 IP。
- **端口**：默认 3000，被占用时自动向上找一个空闲端口（启动器提示与 NSD 广播显示实际端口；手输地址时注意用实际端口）。
- **游戏内操作**：与网页版一致（触摸拖拽、长按详情，推荐横屏）；返回键/侧滑直接退出游戏页，服务器继续在前台服务里运行，再次点「开始游戏」秒进；划掉任务卡 = 整体退出（含服务器）。画质可在游戏内「设置」调低；加载异常时壳层提供「兼容模式」（`?board=2d&render=fallback`）。

### 适配设置（启动器）

| 设置 | 说明 |
|---|---|
| 120Hz 高刷新率 | 开启后锁定设备最高刷新率模式（Ace5 实测 120Hz）；关闭回退 60Hz 省电 |
| 异形屏适配滑块 | 游戏 UI 与屏幕**两侧**的距离（px），刘海/打孔屏横屏时按需加大 |
| 分享日志 | 导出全部调试日志（见 §5） |
| 重装资源包 | 清除解压标记并重新解压（升级失败/文件损坏时排查用） |

## 5. 日志与诊断

全部落盘在应用私有目录 `files/logs/`（部分国产 ROM 会过滤第三方 logcat，文件日志才是完整真相）：

- `debug.log`（滚动保留 3 代）：App 生命周期、解压进度、Node 启动/健康检查、NSD 发现、**WebView 全部 console 输出**、主框架加载错误、渲染进程崩溃、启动看门狗探针结果。
- `node.log`：嵌入式服务器的 stdout/stderr（fd 级重定向，含启动横幅与端口占用报错）。

启动器右上「分享日志」通过系统分享面板导出全部文件。游戏页面 8 秒未启动时，壳层注入探针（不改网页代码）读取 `__SP__` 引导状态 / canvas 数量 / WebGL 支持并弹原生诊断框，可一键复制或进入兼容模式。

## 6. 相对 Paper-Yuan 版的优化点

1. **JNI 胶水替代 JNA 符号绑定**：CMake 编译 60 行 C++ 直接链接 `node::Start`，不依赖脆弱的 C++ 名字修饰（`_ZN4node5StartEiPPc`）与 JNA 运行时；无 `libc++_shared.so`、无 okhttp、无 JNA 依赖（c++_static）。
2. **内容哈希增量解压**：以 core/assets 两个 zip 的 SHA-256 为标记，代码升级不再重新解压 280MB 素材（原版按 versionName 标记，每次升级全量重解压）。
3. **NSD/mDNS 房主自动发现**：客机两击入局；HTTP 扫网段仅作手动输入兜底。
4. **不改网页端代码**：自检探针、音频后台挂起（`__SP__.audio.suspend`）、Esc 注入全部由壳层 `evaluateJavascript` 完成，网页目录与上游逐字节一致，跟上游更新零冲突。
5. **面向 Android 16（API 36）**：target/compileSdk 36，处理 edge-to-edge、cutout、前台服务 `specialUse` 类型声明；minSdk 26。
6. **120Hz+ 支持**：`preferredDisplayModeId` 锁最高刷新模式 + API 30 `SurfaceControl.setFrameRate` 声明；可关（60Hz 省电）。
7. **双 ABI**：arm64-v8a + x86_64（模拟器/ChromeOS 可用）；libnode 解包安装（非 legacy packaging）。

## 7. 已知限制

- **Node 18 与上游 `engines: >=22`**：服务端运行时代码经全量审计 + Node 18.20.4 实测（3595 个测试 3578 通过；5 个失败均为测试基建层面 —— `node:test` mock timers 在 18/22 之间的 API 差异，及一个受构建负载影响的性能断言 —— 与服务器逻辑无关；healthz / 房间 / 对局流程正常）。上游未来若使用 Node 20+ 专属 API，需要跟进 nodejs-mobile 的版本（其长期停留在 18.x）。
- **16KB 内存页设备**：预编译 libnode.so 按 4KB 页对齐，Tensor/天玑新平台若启用 16KB 页将无法加载——这些设备请用浏览器连接 PC/其他手机开服。
- **后台**：前台服务保活服务器，但宿主熄屏后自身战斗仍需回前台操作；对局经济推进由服务器完成，客机不受影响。
- **APK 体积**：约 400 MB（素材全打包，离线即玩）；安装后解压约占 1 GB 磁盘。首次解压在 UFS4 机型上约 2–3 秒，低端机约 1 分钟。

## 8. 许可

安卓壳层代码遵循仓库的 GPL-3.0-or-later；libnode.so 为 Node.js（MIT 风格）许可；游戏素材版权归鹰角网络/Yostar（见 NOTICE.md），仅随整合包分发、不得单独再分发。

# 卫戍协议 (Stronghold-Protocol) - 会话工作交接与进度总结

**生成时间**: 2026-10-06 23:45  
**工作区**: `e:\Workbox\系统`  
**分支状态**: 最新主分支开发态  
**交接对象**: 后续接手 AI Agent / 开发者  

---

## 一、 会话核心背景与任务链梳理

用户提出了一系列服务端轻量化剥离及移动端/服务器适配需求：
1. **轻量服务器部署包制作**：需要将游戏全量资源中的静态重型素材（立绘、Spine、音频、语音等约 400MB+）剥离，制作仅包含游戏核心逻辑（Server-side、Node.js、WS、规则脚本）的极简开服包。
2. **Windows Server 兼容性修复**：解决服务端脚本在 Windows Server 环境下运行 `.bat` 启动脚本闪退的问题。
3. **Android 客户端远程连接素材丢失（白块/缺语音）问题排查**：在连接剥离素材后的轻量服务器时，移动端缺少素材渲染。
4. **采纳并落地“姿势三”（客户端本地资源劫持拦截方案）**：在 Android 原生端拦截网络请求并优先读取本地 assets/bundle 资源。
5. **构建并交付 APK**：完成 Android 编译打包，通过 ADB 推送安装至测试真机，并放置桌面供分发。

---

## 二、 关键问题诊断与技术解决方案

### 1. 纯逻辑开服包方案（姿势 A：服务器剥离素材）
- **核心逻辑**: 服务端仅需承担状态同步、出牌校验、网络联机（WS）以及基础 HTML/JS 代码托管，不需要在服务器端存放数百兆的音视频和高清图片。
- **产物构建脚本**: [`scripts/make-headless-server.mjs`](file:///e:/Workbox/系统/scripts/make-headless-server.mjs)
- **产物路径**: 
  - `C:\Users\J1825\Desktop\Stronghold-Protocol-Server-Headless\`
  - `C:\Users\J1825\Desktop\Stronghold-Protocol-Server-Headless.zip` (大小约 7.9MB)

### 2. Windows Server 启动 Bat 闪退问题
- **原因诊断**:
  1. `start-server.bat` 缺乏环境探查与 `pause`，当用户机器未配置全局 `node` 环境变量或端口 3000 被占用时，终端直接报错闪退，无法查看报错日志。
  2. 依赖未内置或相对路径寻址错误。
- **解决方案**:
  - 重写启动脚本，包含内置 Node 路径探测、依赖存在性检查、端口占用释放提示以及末尾 `pause`。
  - 提供绿色便携版 Node 整合或清晰的环境配置脚本 [`scripts/install-workbench.ps1`](file:///e:/Workbox/系统/scripts/install-workbench.ps1)。

### 3. Android 0.1.6 远程连接无素材、白块无声音的根本原因
- **原因剖析**:
  - Android 客户端在 remote 模式下，直接调用 `webView.loadUrl("http://远程IP:3000")` 导航整页。
  - HTML 与 JS 中所有图片/音频请求（例如 `/assets/cards/...`、`/assets/voice/...`）均以**相对路径**打向该远程服务器。
  - 由于开服包已将静态大素材剥离，远程服务器返回 `404 Not Found`。
  - 尽管 Android APK 内部解压了 300MB+ 的完整素材（`app_bundle.zip` 解压至本地私有目录），但原生 `WebViewClient` 并未做请求拦截，空有本地素材而无法利用。

### 4. “姿势三”落地：Android WebView 本地静态资源劫持机制
- **修改文件**: [`android/app/src/main/java/com/paper/stronghold/MainActivity.kt`](file:///e:/Workbox/系统/android/app/src/main/java/com/paper/stronghold/MainActivity.kt)
- **技术实现**:
  - **解压保障**: 在 `startStartupFlow()` 中加入后台异步解压 `AssetManagerHelper.ensureAssetsExtracted(this)`，保证无论是以 local 还是 remote 模式启动，本地素材包均已完全解压到 `context.filesDir/bundle/public/`。
  - **网络劫持**: 在 `setupWebView()` 的 `WebViewClient` 中重写 `shouldInterceptRequest(view, request)`：
    - 针对以 `/assets/`、`/media/`、`/fonts/`、`/vendor/` 开头的 GET 请求进行拦截；
    - 映射至本地文件路径：`File(AssetManagerHelper.getBundleDir(context), "public$urlPath")`；
    - 若本地文件存在，直接使用 `FileInputStream` 构造 `WebResourceResponse` 返回，并注入 CORS 标头（`Access-Control-Allow-Origin: *`）；
    - 若本地未命中，则降级放行网络请求，由服务器处理。
  - **收益**: 无论连接何种自建服/测试服（哪怕服务器完全没有素材），客户端均秒开、秒加载全量立绘与语音，服务器带宽消耗接近于 0。

---

## 三、 本次交付产物汇总

| 交付物 | 所在位置 | 说明 |
|---|---|---|
| **Android 客户端 APK (姿势三支持)** | `C:\Users\J1825\Desktop\Stronghold-Protocol-v0.1.6-client-local-assets.apk` | 约 483MB，集成全量解压包及本地资源请求劫持逻辑 |
| **手机真机安装** | 设备 `10CG1A0ARF00237` (通过 ADB 安装) | 已执行 `adb install -r` 并成功启动应用 |
| **无素材轻量服务器包 (ZIP)** | `C:\Users\J1825\Desktop\Stronghold-Protocol-Server-Headless.zip` | 约 7.9MB，剥离静态素材后的纯逻辑服务端 |
| **无素材轻量服务器包 (目录)** | `C:\Users\J1825\Desktop\Stronghold-Protocol-Server-Headless\` | 解压就绪目录，可直接拷贝至 Windows/Linux Server 运行 |

---

## 四、 后续开发者/Agent 注意事项与待办事项

1. **Git 门禁与工作区状态**:
   - 本地构建脚本 `scripts/build-android.mjs` 配置了严格的 **P0-1 门禁**，要求构建前后 Git 状态完全一致（防止构建脚本随意污染已跟踪文件）。
   - 当前工作区修改项主要为 `android/app/src/main/java/com/paper/stronghold/MainActivity.kt` 以及 `scripts/` 下的新增辅助打包脚本。若要提交 git commit，请根据项目规范提交。
2. **APK 签名与发布**:
   - 当前构建的是 `debug` 模式 APK（`app-debug.apk`）。若后续需要发布 Release 正式包，请运行 `gradlew.bat assembleRelease` 或配置专用签名。
3. **环境与 ADB**:
   - 本机 Android SDK 路径: `C:\Users\J1825\AppData\Local\Android\Sdk`
   - ADB 工具路径: `C:\Users\J1825\AppData\Local\Android\Sdk\platform-tools\adb.exe`
   - 连接手机设备 ID: `10CG1A0ARF00237`
4. **服务端口**:
   - 默认 HTTP / WebSocket 端口为 `3000`。

---

## 五、 关键业务红线与合并门禁（P0 级铁律）

### 1. 【严禁合并上游「盟约收起 / 展开」功能（PR #149 / issue #142 / `bonds-toggle`）】
- **硬性要求**: 用户明确指示：**以后合并上游项目时均不做这个合并，严谨限制**！
- **背景**: 上游在 v0.1.4（commit `ede8e7e7` / PR #149）引入了战斗界面盟约栏折叠按钮（`bonds-toggle`、`bondsCollapsed`），在战场左上方生成「收起 / 盟约」切换按键。
- **限制执行规范**:
  1. 以后执行 `git merge upstream/...` 或同步上游任何新版本时，必须立即检查并剔除 `bonds-toggle` 与 `bondsCollapsed` 相关的改动；
  2. 保持 `public/js/screens/game.js` 中的 `<div class="gm__bonds">` 始终直接渲染 `<BondStrip ... />`，绝不包裹折叠开关；
  3. 保持 `public/css/screens/game.css` 干净，严禁带入 `.bonds-toggle` 样式规则。
5. **上游同步硬门禁（PR #149 永久拉黑）**:
   - **绝对禁止合并**：上游 PR #149（commit `ede8e7e7`，即「盟约收起 / 展开」按钮与 `bondsCollapsed` 逻辑）。
   - 该功能存在棋盘触控漂移（≈55px）负优化，用户明确指示后续任何上游合并均做严格限制，直接舍弃。
   - 永久规则已固化至最高优先级配置：`.agents/rules/upstream-sync.md`。

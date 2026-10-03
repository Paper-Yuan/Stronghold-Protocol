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

明日方舟「卫戍协议：盟约」安卓端 v0.1.5.1-pre（战斗引擎加载失败修复 + 方向轮视口塌陷与触控直选增强）

本版本为紧急修复与预发布测试包（Pre-release）。
紧接着 **v0.1.5-pre** 解决了视口黑屏之后，进一步根除了真机测试反馈的 **战斗引擎加载失败（Unexpected reserved word）** 以及 **在棋盘上放置干员时无法换方向** 两大问题。

---

### 主要修复与改进

#### 1. 彻底根除「战斗引擎加载失败，请刷新页面重试 · Unexpected reserved word」
- **物理根因**：顶层 `await`（Top-level await）属于 **ES2022** 特性（Chromium 89+ 引入）。在没有 Google Play 服务、系统自带老旧 WebView（Chromium 80–88，如荣耀 MagicOS / 华为等设备）的机器上，V8 引擎在模块顶层遇到 `await` 时会将其视作语法保留字，直接抛出 `SyntaxError: Unexpected reserved word`，导致前端战斗引擎无法实例化。
- **改写与降级**：
  - `server/sim/content/bands.js`、`server/sim/content/bonds.js`、`server/sim/content/index.js` 改写为标准的 ES 静态 `import`，消灭全部动态顶层 await；
  - `server/index.js` 在向浏览器分发 `/sim/simdata.js` 时自动剥离 Node 专有的顶层 await 代码块，前端获得的源码达到 **100% ES2020 语法纯度**，同时完全不破坏本地 Node 进程的数据读取；
  - `public/js/ui/buildGuard.js` 数字分隔符 `60_000` / `5_000` 平整化为 `60000` / `5000`；
  - 全量 130+ 个前端与模拟器文件通过 ES2020 严格语法门禁（0 错误）。

#### 2. 彻底解决「无法在棋盘上放置干员 / 无法换方向」
- **CSS 物理回退**：
  - [game-panels.css](file:///e:/Workbox/系统/public/css/screens/game-panels.css) 中为全屏方向交互层 `.fwheel`、`.fwheel__stripes`、`.fwheel__svg` 全面补齐 `top: 0; left: 0; right: 0; bottom: 0; width: 100%; height: 100%;` 物理回退；
  - 根除 Chromium < 87 下丢弃 `inset: 0` 导致全屏拦截容器计算宽高塌缩为 0px × 0px、无法接收触控滑动事件的物理故障。
- **移动端触控交互增强**：
  - **点击箭头直接选向（Tap-to-commit）**：四个 Chevron 箭头增加透明触控判定区与点击事件，手机玩家轻点任意箭头即可直接朝着该方向落子部署；
  - **轻点中心就地落子**：玩家拖拽干员到格子上后，若轻触中心区域（450ms 内短按且未滑动），以默认朝向（RIGHT 或原面向）直接完成部署，不再强制要求划出死区；
  - **触控容错扩大**：扩大手势有效判定区域，保留左上角显眼的「✕ 点击取消」红色按钮与拖回中心取消机制，彻底消灭手滑误触撤销。

---

### 直接覆盖安装即可

与 v0.1.2 / v0.1.3 / v0.1.4 / v0.1.5-pre 使用同一把官方签名密钥，`versionCode` 递增至 **9**，**不需要卸载**，下载后直接覆盖安装，所有游戏进度与配置自动保留。

---

### 安装包校验与信息

```text
文件: Stronghold-Protocol-v0.1.5.1-pre.apk
大小: 323,883,612 字节 (308.89 MB)
SHA-256: 6a894993e0d605b4c42329d5d2e32161d52deb74298bbb053109566d8bd75589
包名: com.paper.stronghold
versionCode: 9
versionName: 0.1.5.1-pre
minSdk: 24 (Android 7.0+)
目标架构: arm64-v8a
签名证书: CN=Stronghold Protocol (unofficial fan remake), O=Paper-Yuan, C=CN
```

PowerShell 验签命令：
`Get-FileHash .\Stronghold-Protocol-v0.1.5.1-pre.apk -Algorithm SHA256`

---

> **【免责声明】**
> 本项目为**非官方、非商业的同人复刻移植作品**，与鹰角网络 (Hypergryph) / Yostar 无关。
> 游戏内涉及的所有《明日方舟》相关美术、音乐、音效、文本及数据等内容，其版权均归原权利人所有。

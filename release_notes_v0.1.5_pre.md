明日方舟「卫戍协议：盟约」安卓端 v0.1.5-pre（上游 0.1.3 核心同步 + 黑屏塌陷与不出怪综合修复包）

本版本为面向老旧 Android 与测试反馈机型的**预发布测试包（Pre-release）**。
不仅完整同步并合入了上游 **v0.1.3** 的全部核心机制与修复，更从物理层根治了 **v0.1.4.1** 在老旧设备（特别是没有 Google Play、WebView 常年停在 Chromium 80–86 的荣耀 MagicOS / 华为等设备）上的**界面视口塌陷黑屏**与**战斗引擎解析失败不出怪**两大物理级根因。

---

### 主要更新与修复

#### 1. 完整同步上游 v0.1.3 核心更新与逻辑
- **功能同步**：观战队友手牌、临时整备区、装备与盟约策略；联防专属防守 BGM；咒愈师特性对每次伤害吸血、收割者/武者技能命中吸血修复；最终攻势领袖预览与高台歌蕾蒂娅规则对齐；
- **语音保留**：在合并冲突中通过脚本重新派生，完整保留 Android 端专属的 **120 位干员部署语音链路**，不因同步上游而丢失。

#### 2. 根除 Chromium < 87 下的界面 0×0 塌陷黑屏（0.1.4.1 黑屏首因）
- **物理定位回退**：Chromium 87 之前不受支持的 `inset: 0` 曾导致根级容器 `.app-root` 与 `.screen` 尺寸塌缩为 0px × 0px，`overflow: hidden` 将全部界面裁除而只露底色。现已全面补齐 `top: 0; left: 0; right: 0; bottom: 0; width: 100%; height: 100%;` 物理回退；
- **看门狗假撤防修复**：`reportClientState` 增加真实渲染视口测量，尺寸塌缩时标记为未就绪，绝不诱使壳层看门狗误撤防，确保 12 秒原生逃生弹窗在异常时必能弹出；
- **真·软件渲染与视觉分层**：WebView 底色设为中性灰 `0xFF2A2F2E`，告别死黑观感；兼容模式显式切为 `View.LAYER_TYPE_SOFTWARE`，彻底避开老 GPU 驱动驱动级合成崩溃。

#### 3. 根除战斗中「不出怪」的 SyntaxError 语法解析失败
- **ES2020 语法降级**：将 `/sim/` 目录下 7 个文件中的全部 18 处 `??=` / `||=` 逻辑赋值解构为标准 ES2020 语法，将战斗引擎最低解析门槛拉回到 Chrome 80，消灭老 WebView 加载 `/sim/spec.js` 时的解析级 SyntaxError；
- **双保险权威引擎**：兼容模式下由内置 Node.js 进程打入 `SP_COMBAT=server`，提供权威战斗逻辑物理结算保底。

---

### 直接覆盖安装即可

与 v0.1.2 / v0.1.3 / v0.1.4 / v0.1.4.1 同一把签名，`versionCode` 升至 **8**，**不需要先卸载**，进度与设置全部保留。

---

### 安装包校验与信息

```text
文件: Stronghold-Protocol-v0.1.5-pre.apk
大小: 323,892,352 字节 (308.89 MB)
SHA-256: a26e95844a5c890ff3cde6425cec9566c4edcf26b36d34d0e561b7f31a127892
包名: com.paper.stronghold
versionCode: 8
versionName: 0.1.5-pre
minSdk: 24 (Android 7.0+)
目标架构: arm64-v8a
签名证书: CN=Stronghold Protocol (unofficial fan remake), O=Paper-Yuan, C=CN
```

验签（PowerShell）：
`Get-FileHash .\Stronghold-Protocol-v0.1.5-pre.apk -Algorithm SHA256`

---

> **【免责声明】**
> 本项目为**非官方、非商业的同人复刻移植作品**，与鹰角网络 (Hypergryph) / Yostar 无关。
> 游戏内涉及的所有《明日方舟》相关美术、音乐、音效、文本及数据等内容，其版权均归原权利人所有。

# 目标仓库调研与交接备忘录：BBleae/Stronghold-Protocol

**生成时间**: 2026-10-07  
**基准工程**: `Paper-Yuan/Stronghold-Protocol` (`e:\Workbox\系统`)  
**目标工程**: `BBleae/Stronghold-Protocol` (`https://github.com/BBleae/Stronghold-Protocol`)  
**交接对象**: 后续接手 AI Agent / 开发者  

---

## 一、 背景与生态拓扑

在《明日方舟：卫戍协议》同人复刻项目中，存在以下关联协同仓库：

| 仓库名称 | 维护者 / 归属 | 核心定位与技术侧重点 |
|---|---|---|
| **`sganggs/Stronghold-Protocol`** | 上游主仓库 | 官方同人 Web 自走棋核心逻辑，1-4 人联机对战标准实现。 |
| **`Paper-Yuan/Stronghold-Protocol`**<br>*(本机当前仓库)* | 纸鸢安好 (Paper-Yuan) | **移动端与轻量化核心**：Android 原生 APK、内嵌 Node.js、本地静态资源拦截（姿势三）、7.9MB 纯逻辑 Headless 开服包。 |
| **`BBleae/Stronghold-Protocol`**<br>*(本次调研目标)* | 晴猫 (BBleae) | **玩法扩展与 Serverless 核心**：线上部署于 `https://stronghold.lunar.ag`，深度集成了 `Slapq` 与 `jingjiangze` 的外援系统、战斗回放与 Cloudflare Workers 架构。 |
| **`jingjiangze/...` & `Slapq/...`** | 核心社区贡献者 | 提供 Node 兼容网关、外援技能审查修正、对战匹配队列等。 |

本地 Git 远程配置已就绪：
- `bbleae` -> `https://github.com/BBleae/Stronghold-Protocol.git`（已 fetch 全量分支）。

---

## 二、 目标仓库高价值资产拆解（可利用性分析）

经比对 `origin/0.1.6.1...bbleae/master`，BBleae 仓库具有 **5 大核心功能资产** 可供本项目吸收利用：

### 1. 外援（甄选）干员扩展系统（★ 极高价值，最推荐落地）
- **功能机制**：
  - 在官方 112 名固定干员卡池之外，增加“私人外援”席位（五阶 / 六阶各 2 个名额）。
  - 外援属于每名玩家的私人独立卡池，队友不可见、不可抢，大幅提升单人与联机可玩性。
- **已实现代码资产**：
  - **78 名外援干员手写机制**：`server/sim/content/kits/waiguan/*.js`（涵盖凯尔希、令、伊芙利特、年、煌、早露、阿、琴柳、嵯峨、推进之王、可露希尔、老鲤、灰烬、焰狐龙梓兰等）。
  - **工程规范与审查**：`docs/WAIGUAN-KITS.md`（定义了费用账本、自动释放策略、消耗型召唤物、模组约束等硬性规范）。
  - **工具链**：`tools/gen-waiguan-kits.mjs`（自动生成注册表）、`tools/assets/waiguan-operators.json`。
  - **多媒体素材支持**：78 名外援语音清单 (`tools/assets/voice.mjs`) 与 25 个召唤物模型。
- **可利用方案**：
  - 这套系统逻辑自包含度极高，不侵入核心 UI 布局。可直接作为独立扩展包（Kits Extension）移植到本项目。

### 2. 战斗录像回放与战绩系统（Replay Engine，★ 高价值）
- **功能机制**：对战过程中全量记录战斗事件序列，单局结束后生成对局档案，支持在浏览器中步进重放整局战斗，并统计常用干员和胜率。
- **核心文件**：
  - `worker/replay-engine.js`、`tools/build-replay.mjs`
  - 前端界面：`public/js/screens/replay*`、`test/ui/replay-screen.e2e.test.js`
- **可利用方案**：
  - 提取其 Replay 数据序列化与前端回放组件，为 Android 客户端和 Web 端补充“战绩复盘与回放”功能。

### 3. 完整观战系统（Spectator Mode）与 8 人联机模式（★ 中高价值）
- **功能机制**：
  - 允许观众进入正在进行的对战房间，实时同步队友战场、整备区、攻击范围、策略轮选与领袖血条。
  - 独立分支 `bbleae/feat/8-players` 支持将同盟模拟最大人数从 4 人提升至 8 人（房主可配 4-8 席位）。
- **核心文件**：
  - 分支：`remotes/bbleae/feat/8-players`、`remotes/bbleae/fix/spectator-issues`
  - 代码：`worker/rooms/spectators.js`、`public/js/screens/game.js` 观战端渲染补丁。

### 4. Cloudflare Workers / Serverless 架构（★ 中高价值）
- **功能机制**：利用 Cloudflare Workers + Durable Objects 搭建无服务器化的大厅网关、房间运行时与快速对战匹配系统。
- **核心文件**：`worker/` 目录全套脚本、`wrangler.jsonc`。
- **与本项目的契合点**：与本项目当前交付的“7.9MB 纯逻辑 Headless 开服包”理念相通，可作为下一代零运维成本的公共房间大厅技术储备。

### 5. 本地离线资源包管理（Resource Pack ZIP，★ 中等价值）
- **核心脚本**：`tools/resource-pack.mjs`。
- **功能机制**：支持将素材打包为 ZIP，网页端可直接导入/导出本地 ZIP 填充 CacheStorage，断点续传。
- **与本项目的契合点**：与本项目 Android 端的“WebView 本地素材劫持（姿势三）”形成 Web 与 App 端的互补。

---

## 三、 🚨 关键业务红线与合并禁区（P0 级铁律，必读！）

> [!CAUTION]
> **绝对禁止直接执行 `git merge bbleae/master`！**

1. **触碰 P0 铁律：上游 PR #149 / issue #142（盟约折叠开关 `bonds-toggle`）**：
   - **红线背景**：上游在 v0.1.4 引入了战斗界面盟约栏折叠按钮（`bonds-toggle`、`bondsCollapsed`），在战场左上方生成折叠开关。在触屏设备上会导致 **棋盘触控判定漂移（≈55px）** 的严重负优化。本项目已在 `.agents/rules/upstream-sync.md` 中将其永久拉黑。
   - **BBleae 现状**：BBleae 仓库最新的提交 `bef482f4`（*“A phone's 休整期 starts with the bond strip folded; the 盟约 button unfolds and folds it”*）**正好是针对该折叠逻辑的手机端改动**。
   - **执行原则**：如果全量 merge，必定破坏移动端操作体验并踩穿红线！所有代码必须**单向 Cherry-pick 或手动抽离**，严禁引入 `bonds-toggle` 和 `bondsCollapsed`。

2. **资源与构建门禁限制**：
   - BBleae 仓在 `tools/build-data.mjs` 中将大量外援语音与模型默认并入全局清单。
   - 若不加甄别地合并，会导致项目构建出来的 Android 安装包或服务端安装包体积再度膨胀，必须遵循本项目的“静态大资源与服务端逻辑解耦”策略。

---

## 四、 推荐实施路线与操作指引

后续接手者若要将 BBleae 的成果融入当前项目，推荐按以下步骤执行：

### 阶段一：抽离并接入「外援干员系统」（首选）
1. 创建专用特性分支：
   ```bash
   git checkout -b feature/waiguan-kits origin/0.1.6.1
   ```
2. 单向检出/引入外援核心逻辑（不触碰 UI 主界面）：
   ```bash
   git checkout bbleae/master -- server/sim/content/kits/waiguan/
   git checkout bbleae/master -- docs/WAIGUAN-KITS.md
   git checkout bbleae/master -- tools/gen-waiguan-kits.mjs
   git checkout bbleae/master -- tools/assets/waiguan-operators.json
   ```
3. 审查干员技能与通用召唤物合入情况，运行单元测试：
   ```bash
   node tools/gen-waiguan-kits.mjs
   npm test
   ```

### 阶段二：接入「战斗录像与回放（Replay）」
1. 检出回放核心逻辑文件：
   ```bash
   git checkout bbleae/master -- tools/build-replay.mjs
   git checkout bbleae/master -- test/ui/replay-screen.e2e.test.js
   ```
2. 提取 `public/js/screens/replay*.js`，核对 UI 依赖无误后注册进屏幕路由。

### 阶段三：评估 8 人模式与大厅网络网关
- 若需要 8 人房间：查阅 `git log -p bbleae/feat/8-players`，评估房间座位同步逻辑对当前 Android 客户端的屏幕适配影响后再做决定。

---

## 五、 状态自检清单（Handover Checklist）

- [x] `bbleae` 远程地址已配置并成功 fetch。
- [x] 目标仓 5 大模块架构与核心路径已归档。
- [x] P0 红线（PR #149 盟约折叠及 issue #142 相关代码）已明确标注拦截要求。
- [x] 提供了安全合入的隔离分支与文件级别抽取指南。

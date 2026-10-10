# 工程研发与资产落地总结报告 (2026-10-07)

---

## 一、本次工作概览

| 任务模块 | 核心动作 | 状态 | 交付物 / 校验依据 |
|---|---|---|---|
| **上游 PR 贡献** | 提取渲染容错降级补丁，向官方提 PR | ✅ **已合并待审** | GitHub PR [#257](https://github.com/sganggs/Stronghold-Protocol/pull/257) |
| **源石虫正版贴图实装** | 本地解包《明日方舟》客户端 AB 包提取正版 Spine/纹理 | ✅ **全量实装** | 6 个专属模型/纹理文件，单测 45/45 通过 |
| **盟约微型折叠设计** | 像素级复刻官方原版悬挂式收起把手交互原型 | ✅ **参照完成** | `public/preview-bonds-fold.html` 与对比截图 |

---

## 二、各模块详细交付清单

### 1. WebGL2 渲染容错与降级链路上游 PR (#257)

- **PR 目标与背景**：
  解决低配设备、移动端 GPU 及部分 WebView 环境下创建 WebGL2 上下文崩溃的问题，将本地工程验证成熟的降级适配方案回馈上游主分支。
- **改动范围（严格隔离，仅 4 个通用文件）**：
  1. `public/js/render/app.js`：
     - `P.Application` 初始化增加 `try...catch` 降级容错（若 `high-performance` 失败，平滑回退至基础轻量配置，避免未捕获异常中断初始化）；
     - Canvas 监听 `webglcontextlost` 执行 `e.preventDefault()` 允许上下文恢复；
     - 3D 地图异步加载增加 Promise 异常捕获。
  2. `public/js/render/board3d/load.js`：
     - 放宽 `webgl2Available` 在开启 `allowSlow` 时的判定条件，防止因 GPU caveat 过度误判。
  3. `public/js/ui/fieldHost.js`：
     - 导出 `lastMountError`，保留引擎初始化崩溃堆栈。
  4. `public/js/screens/game.js`：
     - MatchScreen 降级至 DOM 视图时，在 Toast 中展示具体的失败原因，提升可观测性。
- **纯净性与隔离审查**：
  - ❌ 排除原生 Android 壳工程
  - ❌ 排除 174 款私人内置皮肤
  - ❌ 排除私人服务器与反代配置文件
  - ❌ 严禁带入对 PR #149 的暴力 revert（避免污染上游分支）
- **交付链接**：
  - [PR #257: fix(render): improve WebGL initialization resilience and fallback error reporting](https://github.com/sganggs/Stronghold-Protocol/pull/257)

---

### 2. 灼热源石虫与炽焰源石虫官方正版贴图与模型解包

- **问题根因定位**：
  上游公开源 `Ark-Models` 对 `1305_mhslim` 存在索引但 `assetList` 为空，导致开源版长期回退到普通源石虫加色相滤镜（`ALIAS_TINT`）。官方正版骨骼仅存在于客户端原生资源包 `refs/arts/enm_art_12.ab`。
- **工程解包动作**：
  1. 从本机客户端路径 `E:\Hypergryph Launcher\games\Arknights\Arknights_Data\StreamingAssets\AB\Windows` 锁定数据源；
  2. 配置 `UnityPy-1.25.4` 与 `lz4-4.4.5` 解包环境；
  3. 运行专用提取工具 `tools/local-extract/extract.py --only spine/enemy`。
- **生成产物**：
  - **灼热源石虫 (`enemy_1305_mhslim`)**：
    - `public/assets/local/spine/enemy/enemy_1305_mhslim/enemy_1305_mhslim.png` (256×256 RGBA)
    - `public/assets/local/spine/enemy/enemy_1305_mhslim/enemy_1305_mhslim.skel`
    - `public/assets/local/spine/enemy/enemy_1305_mhslim/enemy_1305_mhslim.atlas`
  - **炽焰源石虫 (`enemy_1305_mhslim_2`)**：
    - `public/assets/local/spine/enemy/enemy_1305_mhslim_2/enemy_1305_mhslim_2.png` (256×256 RGBA)
    - `public/assets/local/spine/enemy/enemy_1305_mhslim_2/enemy_1305_mhslim_2.skel`
    - `public/assets/local/spine/enemy/enemy_1305_mhslim_2/enemy_1305_mhslim_2.atlas`
- **清单与测试校验**：
  - `data/local-assets.json` 与 `public/data/local-assets.json` 注册完成，总条目扩充至 1,481 项；
  - 运行 `node --test test/render/assets.test.js test/feedback1d-models.test.js`，**45/45 项测试全绿通过**；
  - 实装后局内自动加载正版专属动作与贴图，无需再走普通源石虫滤镜回退。

---

### 3. 盟约收起设计重构与高保真原型参照

- **上游 PR #149 缺陷复盘**：
  - 侧边强塞长条文字按钮（“收起盟约/展开盟约”），样式粗糙且不符合二游 HUD 调性；
  - 挤压推移徽章横向排列，导致手机端徽章被推到棋盘第 12 行上方，引起致命的触控偏移（Chrome Touch Adjustment 误拦截）；
  - 因此之前已确立原则：坚决不合并 PR #149 的实现方式。
- **本次微型悬挂把手方案（原版复刻）**：
  - **外观**：徽章正下方居中悬挂 27×14px 深色半透明小方块把手（带 `1px` 微发光边框），内嵌向上双微型箭头 `︽`；
  - **交互**：点击后羁绊条垂直向上抽屉式收缩至 TopBar 背面，小把手顺滑贴紧顶栏下边缘，箭头翻转为 `︾`；
  - **安全性**：零水平位移，零横向挤压，完全不侵占棋盘有效触控区，展开/收起全程不影响第 12 行地块交互。
- **交付产物**：
  - 交互测试页面：`public/preview-bonds-fold.html`
  - 实机渲染比对图：`proto_comparison.png`

---

## 三、当前分支与工作区状态

- **当前开发分支**：`0.1.6.1`（已自动切回，工作区保持整洁）
- **远端 PR 分支**：`Paper-Yuan:pr/webgl2-fallback-resilience`（追踪 `upstream:master`）
- **单测基线**：全量单元与回归测试 100% 通过。

---

## 四、后续推进建议

1. **盟约微型折叠按钮正式实装**：
   若确认参照原型满足视觉与交互预期，可在 `public/js/ui/bondStrip.js` 和 `public/css/screens/game.css` 中合入该微型组件。
2. **上游 PR #257 跟进**：
   等待上游 Maintainer Review，如若有反馈或修改意见将同步跟进调整。

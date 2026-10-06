# 明日方舟「卫戍协议：盟约」安卓端 v0.1.5.2 发版说明

## 版本概况
- **分支**: `feature/android-v0.1.5.2`
- **版本号 (VersionName)**: `0.1.5.2`
- **内部构建号 (VersionCode)**: `14`
- **发布日期**: 2026-10-06

---

## 核心更新与优化内容

### 1. 深度适配旧版 Android WebView（Chromium 80–84 / Android 7–9）
- **CSS `inset:` 全局物理坐标回退**：
  - 地毯式补齐 9 个核心 CSS 文件中全部 55+ 处 `inset:` 的 `top/left/right/bottom/width/height` 物理回退，根除容器在老旧内核下计算值为 `auto`、坍塌为 0×0 的问题。
  - 覆盖范围：战场主画板（`.gm__field`、`.gm__hud`）、DOM 棋盘与棋子、调配全屏界面、机变弹窗（`.spov`）、商店卡片、战前简报、玩法说明、结算页及通用组件。
- **玩法说明 16:9 比例兼容降级**：
  - 针对 Chromium 80–84 缺失 `aspect-ratio` 特性，为 `.guide__page` 补齐基于视口的 `height: calc(...)` 显式比例回退。
- **运行时语法与特性垫片补全**：
  - `public/js/ui/compat.js` 补齐 `String.prototype.replaceAll` 与 `Promise.any` 标准 polyfill（Chromium 85 特性）。

### 2. 战场及调配体验深度优化
- **调配界面触控与视口优化**：
  - 修复调配容器高度未撑满的问题，明确启用触控纵向滑动 (`touch-action: pan-y; -webkit-overflow-scrolling: touch;`)。
- **干员头像即时渲染**：
  - `<UnitThumb>` 组件默认启用 `loading="eager"`，杜绝老旧浏览器 IntersectionObserver 对动态网格图片的延迟挂起。
- **幽灵攻击中断与空挥拦截链**：
  - 敌人阵亡时，Spine 轨道立即解除普攻循环并平滑归位至待机姿势；
  - 攻击事件识别目标存活状态，目标死亡时拦截起手挥刀与攻击音效/特效。
- **开局部署语音降噪与连点防抖**：
  - 开局批量部署单位静音，压制多干员同时出场时的杂乱重叠语音与 SFX；
  - 连点同一干员时引入播放防抖，避免瞬间双重混音。
- **机变卡片与费用 HUD 优化**：
  - 悬赏卡片解析怪物的中文名称并完整显示；
  - 悬赏怪物卡面图添加 `contain` 比例保护；
  - 费用 HUD 具备物理尺寸保护并支持单人 DP 独立提取。

### 3. 原生壳与交互适配增强 (PR #5 合并)
- **120Hz 高刷新率模式支持**：
  - 新增 `DisplayHelper` 模块，在连接设置中提供「120Hz 高刷新率」开关，突破 ColorOS 等厂商系统锁定 60Hz 的限制，兼顾丝滑触控与省电续航。
- **异形屏/刘海屏边距滑动条适配**：
  - 设置界面提供 0–200 px 实时双侧留白缩进滑动条，彻底解决挖孔/刘海屏横屏遮挡战场与操作区的问题。
- **持久化滚动日志与一键分享**：
  - 新增 `FileLogger` 引擎，将核心生命周期、WebView 控制台日志及 Node 服务标准输出写入 `debug.log`（2MB × 3 轮转）；
  - 诊断与日志弹窗新增「分享日志」按钮，通过系统分享面板导出，方便真机排错。

---

## 校验与产物
- **文件**: `Stronghold-Protocol-v0.1.5.2.apk` / `Stronghold-Protocol-release.apk`
- **架构**: `arm64-v8a`
- **测试通过率**: 84 / 84 测试用例 100% PASS
- **SHA-256**: `86ABDAA8B5EFAB0D95698D4DFF7B08195C5E062D1C483BF24DC9B962258CC5A7`

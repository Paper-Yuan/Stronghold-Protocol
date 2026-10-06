# 上游同步黑名单与合并限制规范（UPSTREAM SYNC RULES）

> 本规范对所有后续会话、AI Agent 及开发者永久生效。

## 严格禁止合并的 PR / 提交（永久黑名单）

### 1. PR #149（commit `ede8e7e7`）及「盟约收起 / 展开」功能
- **黑名单特征代码**：
  - CSS 类名：`.bonds-toggle`、`.gm__bond-list`
  - JS 状态/属性：`bondsCollapsed`、`aria-controls="match-bond-strip"`
  - 测试用例：`test/ui/bond-collapse.e2e.test.js`
- **禁止理由**：
  1. 该收起/展开按钮破坏了棋盘顶部边缘的触控判定，在特定屏幕分辨率（如 844×390）下导致触控位移 ≈55px，点击棋盘第 12 行干员误触发盟约浮层。
  2. 经过实机测试与项目审查，确认该特性为体验劣质改动。
  3. **用户核心指令：以后合并上游项目时均不做这个合并，严谨限制。**
- **执行规范**：
  - 未来任何从上游（`upstream/master`、`upstream/dev` 或其他分支）拉取、合并（`git merge` / `git cherry-pick` / `rebase`）代码时，**必须完全排除 PR #149**。
  - 若整个批次合并不可避免带入了该提交，必须在合并阶段立即重置并还原：
    - `public/js/screens/game.js` 的 `gm__bonds` 保持为原生 `<BondStrip .../>`，不引入 `bonds-toggle` 和 `bondsCollapsed`。
    - `public/css/screens/game.css` 清除 `.bonds-toggle` 与 `.gm__bond-list` 相关规则。
    - 绝不允许影响线上阿里云服务器的稳定运行。

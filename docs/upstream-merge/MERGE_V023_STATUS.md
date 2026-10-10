# v0.2.3 合并状态与结论（2026-10-10 会话产出）

分支 `merge/v0.2.3`（worktree `E:/Workbox/sp-upgrade-merge`），合并提交 `7b02d1d2`。
**结论：该合并节点不可直接并入 `feature/v0.2.1-fusion-master`——树不自洽，需一轮逐文件整合。**

## 一、做了什么

| 批次 | 数量 | 处置 |
|---|---|---|
| 陈旧上游快照（HEAD 内容存在于 v0.2.3 历史） | 112 | 取上游（`--theirs`） |
| 双方都改过 | 109 | **取我们侧**（`--ours`），上游版本归档 `docs/upstream-merge/v0.2.3-conflicted/`（70 个 UU，4.2MB） |
| 增删冲突 | 4 | `kits/tier{1,4,5,6}.js` 按上游删除（内容搬 `kits/shared/`），我们的版本归档 `our-deleted-by-upstream/` |
| 黑名单 | 1 | `test/ui/bond-collapse.e2e.test.js` 保持删除（`.agents/rules/upstream-sync.md`，PR #149） |
| 自动合并 | 906 | 上游改动与我不重叠的部分直接并入 |
| 版本 | — | package.json（上游为底 + 保留我们 scripts/devDeps）/ lock / APP_VERSION / README badge / CHANGELOG → `0.2.3-fusion` |
| ES2020 改写 | 1 | `server/sim/content/bosses.js` 的 `(ab.pulses ||= []).push(...)` → 显式条件赋值 |

## 二、为什么不可直接并入：影子冲突实锤

「取我们侧」的捷径让**上游新增的客户端子系统**与**我们保留的旧模块**混搭，产生悬空依赖：

| 症状 | 实例 |
|---|---|
| 导出缺失（静态 import 图 10 处红） | 上游 `screens/cultivation.js` 要 `loadoutModel.js` 的 `opsOf`；上游 `ui/gameLogic.js` 要 `gameLogic/settings.js` 的 `VOICE_LANGS`；上游 `ui/lang.js` 要 `constants.js` 的 `DEV_BUILD`；`ui/loadoutSync.js` 同类 |
| 测试大面积红 | `test/ui/*.test.js`：**162 测试 / 81 失败**（合并前 557 / 0）；`test/data.test.js + golden`：31 / 3 失败 |
| 失败集中在**上游新子系统** | 语言包切换（`a delayed language…`、`startup applies the stored language…`）、每干员语音、`audio`、`devices`、`cultivation` |

根因正是 `docs/UPSTREAM_023_MERGE_PLAN_V2.md` §3 风险 1 预言的**同名异构**：上游 0.2.2/0.2.3 的
i18n（`public/i18n/**`、`ui/lang.js`）与每干员语音（`voicePrefs.js`/`operatorVoice.js`/`VOICE_LANGS`）
与我们本地的 `VOICE_LANG`/`voiceLang`（日语默认、双语语音层）**平行演化**；我们缺上游 i18n 子系统
（见记忆 `fusion-lacks-i18n-subsystem`），而上游的新客户端文件假定它存在。

## 三、两条出路（需用户拍板）

**出路 1（计划原意，2–3 天）：逐文件整合。**
按 `docs/UPSTREAM_023_MERGE_PLAN.md` §2 的 2a–2g 分组，把上游新子系统的支撑模块一并接进来
（`ui/lang.js` + `public/i18n/**` + `voicePrefs.js`/`operatorVoice.js` + `loadoutModel.js` 的 `opsOf` 等），
并处理语音层的择一弃一/适配层。`docs/upstream-merge/v0.2.3-conflicted/` 里的 70 个上游版本就是逐个复核的输入。

**出路 2（快，符合「以我为主」）：窄合并——排除上游与本地平行演化的子系统。**
把上游新增、且依赖我们保留模块的客户端子系统**排除出本次合并**（i18n `ui/lang.js`/`public/i18n/**`、
每干员语音 `voicePrefs.js`/`operatorVoice.js`、`cultivation.js` 及其测试），只保留自洽的部分
（引擎规则、UI 改进、PWA、对局恢复、房主重刷、bot 表情、文字大小、图标）。
代价：本次不获得上游的 i18n 与每干员语音（我们已有自己的 `VOICE_LANG` 方案）。

## 四、未做的（如实声明）

- golden 未重生成（引擎变化后必做；计划 2f）。
- 70 个归档的上游版本未逐 hunk 复核。
- 真实浏览器/真机冒烟未跑。
- **不部署、不 push 远端**（阿里云红线）。

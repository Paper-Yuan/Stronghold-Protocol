# 上游 v0.2.3「可合并内容」调研与做法（2026-10-10）

> 配套图：`merge-classification.png`（同目录）。数据来源：`git merge-tree`、冲突分类脚本、`client-static` 与 `test/ui` 实跑。
> 前提：用户指令「**UI 更贴我这边**（否则手机端不好选皮肤）」+ `.agents/rules/upstream-sync.md`（PR #149 永久排除）+ 不部署不 push。

## 一、一句话结论

上游 0.2.3 里**能安全拿的（引擎规则、测试、工具、独立新功能）已经拿到**；**UI 与皮肤链已按你的要求保住**；
真正卡住整棵树的是**上游新子系统与我们的同名异构**——i18n、每干员语音、渲染层重构，以及 4 个「未接线」的新功能。
**建议按「窄合并」收口**：删掉/排除 C 类，树即自洽，UI 100% 是我们的。

## 二、分类与做法（A/B/C/D）

### A 类 · 可直接用（上游改动与我们不重叠，已自动并入 906 文件）

| 内容 | 状态 | 做法 |
|---|---|---|
| 引擎与规则 `server/sim/**`、`server/match/**` | 已并入 | **保留**。这是合并的主要价值（上游修的同源 bug） |
| 测试 `test/**`、工具 `tools/**`、文档 `docs/**` | 已并入 | 保留 |
| 内容数据 `data/*.json` 多数段 | 已并入 | 保留（assets.json 另按 checkAssets 校验） |
| `pwa.js` + manifest + icons（安装到桌面） | 已并入，**已被 5 处引用** | 保留，可用 |
| `diag.js` | 已并入，已被 4 处引用 | 保留，可用 |
| **`resumeMatch.js`（对局恢复）** | 已并入，**0 引用** | ⚠ 死代码：上游接在它的 `main.js` 上，我们保了自己的 `main.js`。**要用就在我们的 main.js/lobby.js 补一处 import + 挂载（约 1 小时/个）**，不用则删 |
| **`setupReroll.js`（房主重刷）** | 已并入，**0 引用** | ⚠ 同上 |
| **`botEmotes.js`（bot 表情）** | 已并入，**0 引用** | ⚠ 同上 |
| **`setupVote.js`（开局投票）** | 已并入，**0 引用** | ⚠ 同上 |

### B 类 · 保我们（UI 以我们为主；冲突处已 `--ours`）

- **皮肤选择链（你最关心的）**：`screens/loadout.js`、`css/screens/loadout.css`、`ui/loadoutModel.js`、`ui/loadoutSync.js`、`screens/diy.js` —— 上游都改过、**都是冲突 → 我们保住了**；`ui/skins.js`、`ui/assetUrls.js`、`data/skins.json`（两份）上游**没动**；`public/js/assets.js` 自动并入了上游 28 行改进，但**我们的皮肤分支（73-75 / 164-166 / 220-221）保留完好**（上游本身无皮肤逻辑，`opts.skin` 零命中）。
- 其余 55 个 public/ 冲突文件 + 54 个非 public 冲突文件：我们的融合层（自选干员/满潜/双语语音/整备区/无尽入口/mod 管理/统计页/撮合）与手机端适配，**全部保持我们侧**。

### C 类 · 需整合或排除（**树不自洽的根因**）

| 项 | 症状（实测） | 两个做法 |
|---|---|---|
| **上游 i18n**：`ui/lang.js` + `public/i18n/{en,ja,ko,zh-TW}.json` | 静态 import 图红（`lang.js` 要 `constants.js` 的 `DEV_BUILD`，我们没有）；语言包切换类测试整批红 | **排除**（删 `ui/lang.js` + `public/i18n/**` + 其测试）｜**整合**（补上游 i18n 运行时接线 + `DEV_BUILD` 常量，1–2 天） |
| **上游每干员语音**：`voicePrefs.js`、`operatorVoice.js`、`VOICE_LANGS`（`gameLogic/settings.js` 导出） | import 图红（上游 `ui/gameLogic.js` 要 `VOICE_LANGS`）；与我们的 `VOICE_LANG`/`voiceLang`（日语默认、双语语音层）**同名异构** | **排除**（保留我们的 `VOICE_LANG`，UI 文案与默认值都是我们的）｜**整合**（数据层用上游 `voicePrefs`，展示层保留我们的，需适配层） |
| **`screens/cultivation.js`**（培养屏） | import 图红（要 `loadoutModel.js` 的 `opsOf`，我们没有） | **排除**（删该屏）｜**整合**（给 `loadoutModel` 补 `opsOf` 导出） |
| **渲染层双套** | 我们的 `render/app.js`(119KB) + `render/fx.js`(120KB) **与** 上游拆出的 `render/app/**`(6) + `render/fx/**`(15) **同时存在**，21 处内部引用指向模块版 | **保留我们的单文件版**（改动最小、与我们的渲染改动一致）→ 删上游 21 个模块文件｜**迁到模块版**（把我们的渲染改动搬进上游模块，工作量大） |

### D 类 · 永久排除（你的规则）

PR #149「盟约收起/展开」：`.bonds-toggle`、`.gm__bond-list`、`bondsCollapsed`、`test/ui/bond-collapse.e2e.test.js`。
**本次合并已排除**（该测试保持删除，全仓未见黑名单特征）。

## 三、建议的做法（窄合并收口，约 0.5–1 天）

1. **保留 A 类**（含引擎规则）；**保留 B 类**（UI 与皮肤链）。
2. **删除 C 类**：`public/js/ui/lang.js`、`public/i18n/**`、`public/js/ui/voicePrefs.js`、`public/js/ui/operatorVoice.js`、`public/js/screens/cultivation.js`、`public/js/render/app/**`、`public/js/render/fx/**` 及其专属测试。
3. **补回被上游改动牵动的导出**（若有残留引用）或调整引用方指向我们的实现。
4. 四个「未接线」新功能（对局恢复/房主重刷/bot 表情/开局投票）**逐个决定**：要用就补接线，不用就删文件。
5. 之后：ES2020 门禁（已 0 处）→ golden 重生成 → 全量测试 → 三端打包冒烟。
6. 语音与 i18n 若日后要与上游同轨，单开一轮「语音/i18n 同轨」任务（我们已有自己的方案，不急）。

## 四、如实声明

- 本文的「红/绿」数字来自 `merge/v0.2.3` 工作树的实跑（UI 162 测试/81 失败；client-static import 图 10 处红）。
- 70 个归档的上游版本（`v0.2.3-conflicted/`）尚未逐 hunk 复核——它们是「出路 1 逐文件整合」的输入。
- 皮肤链路结论基于静态核查（皮肤分支在合并结果中存在、`loadout*` 取我们侧）；**真机/浏览器手测未跑**。
- 不部署、不 push 远端。

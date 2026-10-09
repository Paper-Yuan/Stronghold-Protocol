# 交接：sp-upgrade-2.1 测试基线与融合方向（2026-10-09）

- **仓库**：`E:\Workbox\sp-upgrade-2.1`（工作区主目录是 `E:\Workbox`）
- **分支**：`feature/v0.2.1-fusion-master`，HEAD `0f52a0b6`，版本号 `0.2.1-fusion`
- **本文性质**：给下一个会话/工程师的交接。**改动全在工作树、未提交**（git 里没有本次的任何 commit）。

---

## 1. 一句话现状

分支上约 **34 个测试红**（基线约 58），红的主因**不是测试过时，而是「数据/引擎版本错配」**：
数据与 kit 已是 v0.2.x，引擎还停在 upstream **feedback4**（0.1.4 级）。
方向决策已收敛为 **A：把引擎补到 0.2.x**（理由见 §3）。

---

## 2. 核心发现（证据）

| 事实 | 判据 |
|---|---|
| 代码基准 = upstream `feedback3`/`feedback4` | `upstream/feedback3`(`a0a5419e`) 是 HEAD 祖先且 merge-base 就是它；`feedback5+` 全部不是祖先 |
| 数据/kit 却是 v0.2.x | 融合提交 `2c167ebd`（"v0.2.0/v0.2.1 fusion"）与 `b804089d`（2026-10-07 导入的 DIY kit，232 文件）把 0.2.x 内容拿了进来 |
| 具体错配：`ACTIVE_RANGE` 规则 | 数据里 **78 条 / 39 个技能**声明它（`data/chess.json`），但 `tools/build-data.mjs` 与 `server/sim/skills.js` 里是 **0** → 引擎不认，静默退回旧规则，**39 个技能释放时机错** |
| 所以两组测试都红 | HEAD 版测试断言 `DEFAULT`、master 版断言 `ACTIVE_RANGE`，两边都失败，集合几乎不相交 |
| 计划文档的前提是错的 | `docs/TEST_BASELINE_BURN_DOWN_PLAN.md` 判 content 31 红为「过时测试、真 bug 0」——实测不成立。已在该文档加了修订头 |
| 本仓库数据用满潜/模组默认值 | 隐现 E1Lv55 ATK **422**，上游 spot check 写 399 → `test/data.test.js` 的硬编码官方值对不上，属 fork 有意偏差 |

---

## 3. 方向决策：A / B（已收敛为 A）

| | 做法 | 结论 |
|---|---|---|
| **A. 引擎补到 0.2.x（feedback5/6）** | 继续按批移植上游引擎 | **推荐**：与分支名/版本 `0.2.1-fusion`、与已导入的 0.2.x 数据一致 |
| B. 数据降回 0.1.4 | `data/chess.json` 的 `ACTIVE_RANGE`→`DEFAULT` 并补 `build-data.mjs` | 不推荐：改生成结果不改生成器，下次重新生成就白改；且丢掉上游规则修复 |

**辅助对话1（`sess_f90aa686`）的合并分析独立支持 A**：它实算合并有 **183 冲突、其中 126 个是「过时的上游快照」**，主张的合并策略是「**把该恢复的上游副本恢复回来 + 再叠本地独有层**」。
「引擎停在 feedback4 而数据是 0.2.x」正是一个典型的「上游快照没恢复」症状 → 按它的思路走就是 A。

---

## 4. 本次已做（工作树，未提交，均已实测）

1. **`test/client-static.test.js` 挂起修复** → **284/284 绿、exit 0**。裸 `node --test` 不再被它拖死。
   - 改法：可恢复断线时断言 `net.pendingCount === 1`（在途请求被保留），welcome 后回 `{t:'ok', rid}` 再 `await p`。
2. **移植上游 `ACTIVE_RANGE` 引擎支持**（`01fddd30`，`server/sim/skills.js` 4 处共 24 行）：
   - `TICK_RULES` 加 `'ACTIVE_RANGE'`；`_triggerKeys()` 按 `s.baseRangeExtend` 扩展并缓存 `_trigExt`；`_defaultCondition(range = null)` 接受绝对 key 网格；dispatch 加一条分支。
   - 连带取上游同批次 5 个测试文件：`test/sim/{feedback1f-fence,playtest6-skills,feedback1-transform,feedback1e-skillrange}.test.js`、`test/content/kits_alt_t2.test.js`。
   - **隔离验证零回归**：`git stash push -- server/` 前后跑 `test/render/*` 都是 4 红，同一批。
3. **11 个 content 测试文件对齐**到「本仓库引擎支持的最高上游版本」：10 个取 `upstream/master`，**`enemies_bosses` 保留 HEAD**（master 版含 23 个 feedback5–7 特性测试，引擎没有）。

**当前工作树改动**：`server/sim/skills.js` + 16 个测试文件（`client-static`、`kits_alt_t2/t3/t4/t6`、`kits_t1t2/t3/t4/t5/t6`、`summon_loadout_conflicts`、`tokens_devices`、`feedback1-transform`、`feedback1e-skillrange`、`feedback1f-fence`、`playtest6-skills`）。

---

## 5. 分套普查（分 glob 跑，勿用裸 `node --test`）

| 套件 | 基线红 | 现在红 |
|---|---|---|
| `test/content/*` | 31 | **7** |
| `test/sim/*` | 13 | **10** |
| `test/data.test.js` | 4 | 4 |
| `test/match/*` | 1（`merge.test.js:321`） | 1 |
| `test/render/*` | 4 | 4（既有） |
| `test/golden.test.js` | 4 | 4 |
| `test/ui/*` · `test/server/*` · `client-static` | 0 · 0 · 挂起 | **0 · 0 · 0** |
| 合计 | ≈58 | **≈34** |

**剩余红项归因**：content 的 7 个是 feedback5/6 未移植项（`外勤医疗 Touch`/WE2、`#322`/`#324`/`#325` PR #329、`灵知 S2`）；sim 的 10 个中 3 个已随移植转绿，其余为「数据声明 ACTIVE_RANGE 与 feedback4 测试互斥」及 `#18 安洁莉娜`、`F5 rule 3`、`ring healers` 等；data 4 个是满潜/模组默认值差异；match 1 个是 `_fillHandFromTemp`。

---

## 6. 下一步（按优先级）

1. **合入修复包的 3 个补丁**（现成、低风险、不并就丢）：
   ```bash
   cd E:/Workbox/sp-upgrade-2.1
   git apply -p3 E:/Workbox/fix-release-analysis/diffs/01-server-matchmaking.diff
   git apply -p3 E:/Workbox/fix-release-analysis/diffs/02-server-lobby.diff   # 建议改造：按「会话是否有房间」过滤，而非标记位
   git apply -p3 E:/Workbox/fix-release-analysis/diffs/04-facingWheel.diff
   ```
   `03` 不要并（分支已含 ④ `return 120`）。详见 `docs/FUSION_FIX_RELEASE_REVIEW.md`。
2. **按 A 继续移植上游引擎**：`01fddd30` 的 WE2（`1559614e`，谬因 S2 / 薇薇安娜 S3）、`e33ee3db`、PR #329 批次；每批带上游同批测试。
3. **`_fillHandFromTemp`**（`test/match/merge.test.js:321`）：真 bug，但**高风险**——记忆里记着移植过一次，修好这个却弄坏 3 个 temp 测试 + golden 大改，被回退。放最后。
4. **golden 4 红**：基准过期，**先定 A 再重生成**（`node tools/golden.mjs --update`，逐族 review，单独提交）。
5. **data.test.js 4 红**：需判断「改测试以匹配本仓满潜值」还是「查数据本身」。
6. **render 4 红**：既有、原因未查（fx kind literal 缺视觉、Back 骨架 fall、Begin/Idle 剪辑）。
7. 之后才是计划文档的 Phase 4 收尾、真机实测、部署。

---

## 7. 不要提交 / 环境坑

- **未跟踪产物**：`.edge_data/`、`cloudflared-linux-amd64.deb`、`test_ports.py`、`docs/mockups/`、若干 `*_PLAN.md`。`E:\Workbox\nul` 是垃圾文件。
- **`node --test` 不要管道给 grep**（Windows Git Bash 会挂）；先重定向到文件。**分套 glob 跑**，不要裸 `node --test`。
- `test/data.test.js` 不要取 `upstream/master` 版——它 `import shared/potential.js`，本仓库没有，会直接 `ERR_MODULE_NOT_FOUND`。
- **`visual-judge` 子代理在本环境起不来**（`provider-not-found`），会话模型也无图像输入 → 渲染产物只能程序化验证，别声称「我看了图」。
- 发布说明**不要写「高刷点击延迟已解决」**——无运行期证据（详见修复包评审 §5）。

---

## 8. 相关会话与文档

- **主会话**：`sess_7eeee24f`（测试基线 burn-down）。
- **辅助对话1**：`sess_f90aa686` — 上游 v0.2.2 合并分析（183 冲突 / 126 过时快照）、修复包评审、`docs/mockups/` 融合 UI 参考图。
- **辅助对话2**：`sess_6e24ebc4` — v0.2.2 与本改动的优劣对比。
- **文档**：`docs/TEST_BASELINE_BURN_DOWN_PLAN.md`（含修订头）、`docs/FUSION_FIX_RELEASE_REVIEW.md`、`docs/OPTIMIZATION_AND_PR_PLAN.md`、`docs/DEVELOPER_HANDOVER_SUMMARY.md`、`docs/mockups/README.md`。
- **部署**：生产主服 `101.37.150.107:3000`（PM2 `stronghold`）+ Cloudflare 隧道 `game.jyuanblog.cc.cd`；仓库有 **5 个 remote**（bbleae / jingjiangze / origin / upstream / xinhai），推哪个未定。

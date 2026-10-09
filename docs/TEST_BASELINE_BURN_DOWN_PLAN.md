# 测试基线收尾计划（过时测试、temp→手牌真 bug、golden 重基准）

> ## ⚠️ 修订（2026-10-09 续做，HEAD `0f52a0b6`）— 第 1 节的前提是错的
>
> **第 1 节把 `test/content/*` 的 31 个红判成「过时测试、真 bug 0」，实测不成立。真因是「数据/引擎版本错配」。**
>
> - 本分支的 `data/chess.json`、`server/sim/content/kits/**`（含 shared tier）来自融合提交 `2c167ebd`
>   （"v0.2.0/v0.2.1 fusion"）与 `b804089d`（2026-10-07 导入的完整 DIY 干员 kit）；而 `server/sim/skills.js`
>   等引擎只到 upstream **feedback4**（0.1.4 级）。判据：`ACTIVE_RANGE`（上游 feedback5 `01fddd30` 引入）
>   在本仓库数据里出现 78 条 / 39 个技能，`tools/build-data.mjs` 与 `skills.js` 里却是 0。
> - 因此 **HEAD 版测试与 master 版测试都红**（前者按旧规则断言 DEFAULT，后者按新引擎断言 ACTIVE_RANGE），
>   两组几乎不相交；`test/sim/*` 有 13 个红、`test/data.test.js` 有 4 个红同属此因（计划第 1 节的「四处红项」是**严重低估**）。
> - 本仓库数据还用「满潜 / 模组」默认值（如 隐现 E1Lv55 ATK 422，上游 spot check 写 399），
>   故 `data.test.js` 的硬编码官方数值对不上——属 fork 的有意偏差，不是回归。
>
> ### 本轮已做（工作树，未提交）
> 1. **Phase 1.1 完成**：`test/client-static.test.js` 挂起修复，**284/284 绿、exit 0**（裸 `node --test` 不再被拖死）。
> 2. **引擎补 `ACTIVE_RANGE`**（移植上游 `01fddd30`，`server/sim/skills.js` 4 处，约 24 行）：引擎必须支持
>    自己发布的数据声明的规则，否则 39 个技能按初始范围而非运行范围释放（真实行为 bug，非测试问题）。
>    连带取上游同批次的 5 个测试文件（`test/sim/{feedback1f-fence,playtest6-skills,feedback1-transform,feedback1e-skillrange}`、
>    `test/content/kits_alt_t2`）。**render 4 红为既有（隔离验证移植前后一致），移植零回归。**
> 3. **测试文件对齐**：11 个 content 文件取「本仓库引擎支持的最高上游版本」——10 个用 `upstream/master`，
>    `enemies_bosses` 保留 HEAD（master 版含 23 个 feedback5–7 特性测试，引擎没有）。
>
> ### 本轮后普查（分套 glob 跑）
> | 套件 | 基线红 | 现在红 |
> |---|---|---|
> | `test/content/*` | 31 | **7** |
> | `test/sim/*` | 13 | **10** |
> | `test/data.test.js` | 4 | 4（满潜/模组默认值差异） |
> | `test/match/*` | 1（merge:321） | 1 |
> | `test/render/*` | 4 | 4（既有） |
> | `test/golden.test.js` | 4 | 4 |
> | `test/ui/*` · `test/server/*` · `client-static` | 0 · 0 · 挂起 | **0 · 0 · 0** |
> | 合计 | ≈58 | **≈34** |
>
> ### 剩余红项的归因（全部指向同一错配）
> - content 7：`外勤医疗 Touch`(ACTIVE_RANGE/WE2)、`enemy_10027_vtsk`、`斩胄之剑/破胄之锤`、`信仰搅拌机 S1`(#325)、
>   `异客 S3`(#322)、`歌蕾蒂娅 S3`(#324)、`灵知 S2` —— 均为 feedback5/6 的 `1559614e`(WE2)、PR #329 等未移植项。
> - sim 10：`#15`… 中 3 个已随移植转绿，其余为 `PR #12 kit lines`、`data: six deviated 重装`、`real battle deviated`
>   （数据声明 ACTIVE_RANGE 与 feedback4 测试互斥）及 `#18 安洁莉娜`、`F5 rule 3`、`ring healers` 等未定项。
>
> ### 需要定夺的范围决策（阻塞全绿）
> 二选一，本计划不做单方面决定：
> - **(A) 把引擎补到 0.2.x（feedback5/6）**：与分支名/版本 `0.2.1-fusion`、与已导入的 0.2.x 数据一致；
>   代价是继续移植 `01fddd30` 的 WE2、`e33ee3db`、PR #329 等批次 + 重基准 golden。
> - **(B) 把导入的 0.2.x 规则数据降回 0.1.4**（`data/chess.json` 的 `ACTIVE_RANGE`→`DEFAULT`，并补 `tools/build-data.mjs`）：
>   与交接文档「0.1.6.1 基线 + 上游 0.1.4 规则」一致；代价是丢掉上游的规则修复，且需重生成数据。
>
> 第 2–4 节（Phase 2 `_fillHandFromTemp`、Phase 3 golden、Phase 4 收尾）**未开始**；Phase 3 的 golden 归因需先定 A/B。

---

- **创建时间**：2026-10-09
- **目标分支**：`feature/v0.2.1-fusion-master`
- **前置**：`docs/OPTIMIZATION_AND_PR_PLAN.md`（A–E 阶段）与 `docs/DEVELOPER_HANDOVER_SUMMARY.md`
- **改动性质**：测试对齐 + 一处 `server/match` 引擎修复 + golden 摘要重基准；无协议、无资源改动

---

## 1. 背景：四处红项（均在 HEAD 上已存在，根因已定位）

| 套件 | 现象 | 根因 | 性质 |
|---|---|---|---|
| `test/content/*` | 31 / 1175 失败 | 本地 11 个测试文件与**旧 upstream 提交逐字节相同**（`kits_t1t2`=ffdb1293、`kits_t3`=6464e4b4、`kits_t5`=ee70c608、`kits_t6`=ca3d0572、`enemies_bosses`=3500ef2d、`tokens_devices`=a4d69b6b…），而代码已是融合后的新行为 | 过时测试 ×31，真 bug 0 |
| `test/client-static.test.js` | 卡死不退出（245/246 过），并拖死裸 `node --test` | `:513` `await assert.rejects(p, e => e.code === 'DISCONNECTED')`，但 `public/js/net.js` 在可恢复断线时**故意保留**在途请求（resilience 特性，`test/net-resilience.test.js:88-138` 已覆盖），`p` 永不 settle | 过时断言 ×1 |
| `test/match/merge.test.js:321` | 1 / 537 失败（temp/hand 不变式） | 融合时丢了 upstream 的 `_fillHandFromTemp`（temp→手牌自动移入），而 `server/match/invariants.js:62` 要求它 | **真 bug ×1** |
| `test/golden.test.js` | 4 / 6 失败（53/53 fast 场景全动，`rngDraws` 也动） | 摘要最后生成于 `bbe59b9a`(2026-10-06)，此后 `server/sim` 多次变更（`b804089d` professions.js+130 / tokens.js+314、`2c167ebd` 融合、`cff7122a` v0.1.4）却再没重生成 | 基准过期 |

**已定方向**：content 整体替换 upstream 版本；golden 先查根因再重生成。

---

## 2. Phase 0 — 落文档
本文件。沿用仓库 `*_PLAN.md` 惯例，便于留档与交接。

## 3. Phase 1 — 修过时测试（不动 sim，低风险）

### 1.1 修挂起（1 处）
`test/client-static.test.js:509-530`（`'drop → pending rejects, reconnect with backoff, hello again'`）
- 删掉 `await assert.rejects(p, …)`；drop 后断言 `net.pendingCount === 1`（在途请求被保留）。
- 最后的 welcome 之后队列会重发 `room.leave`：取 `ws().last('room.leave')`，回 `{ t: 'ok', rid }`，再 `await p`。
- 效果：该文件能退出，**裸 `node --test` 也就能跑完**（这是全量跑挂死的唯一原因）。
- 语义对齐 `test/net-resilience.test.js:88-138`。

### 1.2 替换 11 个 content 测试文件
整体取 `upstream/master:test/content/<file>.test.js`：
`kits_t1t2 / kits_t3 / kits_t4 / kits_t5 / kits_t6 / kits_alt_t3 / kits_alt_t4 / kits_alt_t6 / enemies_bosses / tokens_devices / summon_loadout_conflicts`。

- 依据：本地文件 == 旧 upstream 提交（无本地独有断言可丢），代码已是新行为。
- 替换后**逐文件跑**；若带进 0.2.2 独有测试导致**新的**红，逐个处理（补数据或按仓库惯例 `{ skip: '…' }` 标注并记原因）。
- 六类断言变化（供 review 对照）：
  - **A** heal → `hpRegen`（9 处）
  - **B** 专属 buff → 共享 `protect`（2）
  - **C** 满潜 / 模组数值（7）
  - **D** 触发规则 `DEFAULT→ACTIVE_RANGE`、`SP_FULL→NEVER`（4）
  - **E** 0.2.0 伤害帧时序（2）
  - **F** kit 机制（6）

### 1.3 验证
`node --test test/content/*.test.js` 与 `test/client-static.test.js` 全绿；`git diff --stat server/` 为空（确证没碰 sim）。

## 4. Phase 2 — 修那个真 bug（temp→手牌自动移入）

- **2.1** `server/match/PlayerState.js`：补 `_fillHandFromTemp()`（照 upstream `server/match/player/pieces.js:101`）+ 在 `recompute()` 里 `_liftOutOfRange()` 之后调用 + 头部注释改为准确描述。
- **2.2** 移植 upstream 为它改写过的 3 个测试：`test/match/economy.test.js`（ready-gating + `fillHand()` 辅助）、`test/match/prep-bench.test.js`（PR #129）、`test/match/merge.test.js:133`（先填满手牌再放 temp、用 `acquireChess`）。
- **2.3** 验证：`node --test "test/match/*.test.js"` → 537/537（golden 单列）。

## 5. Phase 3 — golden：先查根因，再重生成

### 3.1 归因全局分歧（为什么 53/53 场景 + `rngDraws` 全动）
- 只读比较逐族看动了什么：`node tools/golden.mjs --family roster`（比较模式，不改文件），对 `bonds/fields/matches` 同做。
- 看候选提交改了什么：`git show --stat b804089d`、`2c167ebd`、`cff7122a`，重点 `server/sim/professions.js`、`tokens.js`、`simdata.js`、`Battle.js`。
- 二分定位"第一处让 digest 变的提交"：在候选提交上 `git stash` 当前改动后跑 `node tools/golden.mjs --fast`。
- **判定标准**：每处字段移动都能对应到有意的、有 CHANGELOG/文档记录的变更（满潜满加成默认、`ACTIVE_RANGE`、heal→`hpRegen`、`庇护`共享 buff、professions 重写）。`rngDraws` 变化要能解释（多半是 professions/满潜带来的新数值路径）。

### 3.2 确认后重生成
`node tools/golden.mjs --update`，**逐族 review diff**，**单独一个提交**，提交信息写明：哪些族/场景移动、每个移动归因到哪次有意变更。

### 3.3 若发现无法归因的移动
视为疑似回归，**停下来定位，不重生成**，回报后再定。

## 6. Phase 4 — 验证与收尾
- 分套 glob 跑全并记录：`test/match/*`、`test/ui/*`、`test/content/*`、`test/server/*`、顶层 `test/*.test.js`（含 golden）；确认**裸 `node --test` 能正常退出且全绿**。
- 更新 `docs/DEVELOPER_HANDOVER_SUMMARY.md` 的"验证状态"章节与项目记忆。

---

## 7. 风险与对策

| 风险 | 对策 |
|---|---|
| 整体替换带进 0.2.2 独有测试 | Phase 1.2 逐文件跑，只处理**新增**的红；不为了绿而乱改 |
| golden 重生成丢安全网 | 放到最后、单独提交、逐族 review、每处移动要归因 |
| `_fillHandFromTemp` 是 sim 变更 | 与 golden 重生成同一叙事批次；先让 Phase 1–2 其它套件全绿再重生成 |
| 归因不出 `rngDraws` 变化 | 停在 Phase 3.1，回报，不盲目重生成 |

## 8. 交付与工作量

- 提交拆分：① 过时测试（content + client-static）② temp→手牌真 bug ③ golden 重生成（含归因说明）。
- 工作量：Phase 0–1 ≈ 1h；Phase 2 ≈ 1h；Phase 3 ≈ 1–2h；Phase 4 ≈ 1h。合计约半天。

# 上游 0.2.3 整合调研与计划（2026-10-10）

- **对象仓库**：`E:/Workbox/sp-upgrade-2.1`，分支 `feature/v0.2.1-fusion-master`
- **本文性质**：调研 + 施工计划。**本次未改动任何代码**（只读调研，工作区有并行会话的未提交 mod 工作，见 §0.2）。
- **上游状态**：`upstream/master` = `1db8e510` = tag `v0.2.3`（2026-10-10 03:19 +0800 打的，就是今天凌晨）。

---

## 0. 结论概览

### 0.1 一句话结论

**0.2.3 本体是个小版本（相对 0.2.2 只有 32 个提交、203 个文件、+9750/−3675），但对我们来说实际是"0.2.2+0.2.3"两个版本一起整合**——因为 0.2.2 从未真正合并进我们的分支（上次 v0.2.2 调研只做了分析、没动手）。相对分叉点合计 561 个上游提交要吸收。

### 0.2 当前仓库与工作区状态（关键约束）

| 项 | 状态 |
|---|---|
| 分叉点（merge-base） | `9f93096e`（上游 feedback4，10-08 前后） |
| 我们领先 | 116 个提交（fusion 层：自选干员、271 皮肤、双语语音、整备区规则、loadGuard、撮合/房……见 §3.4） |
| 上游领先 | 561 个提交（0.2.2 的 525 + 0.2.3 的 32 + 其他 4） |
| 工作区 | **脏**：约 110 条状态（54 文件 +6269 行已暂存、42 未暂存、34 未跟踪），暂存区版本号已是 `0.2.2-fusion`。**正在被另一个会话活跃写入**（调研期间 08:08–08:16 仍有截图与 `data/endless-records.json` 落盘） |

**纪律**（延续 [[sp-upgrade-concurrent-session-hazard]]）：合并是高风险动作，动手前必须（a）与并行会话确认它已提交或暂停；（b）`git status --porcelain | wc -l` 清零或接近清零；（c）探测 mtime 确认无活跃写入。

### 0.3 为什么不能等 0.2.4

上游 **每天打一个 tag**（10-07 → 10-10：0.2.0/0.2.1/0.2.2/0.2.3）。等版本意味着差距只会更大，而 0.2.3 带来了我们本地层的直接竞争项（#436 每干员语音 → 已被 PR #453/#455 演进；#437 自选干员 → 官方明确拒绝联动干员但本地系列已实现克莱门莎）。**建议尽快合并，越晚越贵**。

---

## 1. 测量数据（2026-10-10 实测）

方法同上次 v0.2.2 调研（[[upstream-merge-v022-findings]]）：`git merge-tree --write-tree HEAD v0.2.3`，冲突文件按"HEAD 的 blob 是否存在于上游历史"分类。

| 指标 | v0.2.2 调研（10-09） | v0.2.3 本次（10-10） |
|---|---|---|---|
| 上游领先我们 | 525 | 561 |
| 冲突文件总数 | 183 | **214** |
| 陈旧上游快照（直接取上游） | 126 | **115**（`kits/ops` 85 个 + UI/gameLogic 12 + sim 4 + 其他） |
| 本地真实增量（需逐个手工合并） | 52 | **94** |
| modify/delete | 5 | 5（`kits/tier1/4/5/6.js` 被上游搬到 `kits/shared/`，行首见 `92a179e7`；`bond-collapse.e2e.test.js` 是 PR #149 黑名单，保持删除） |

冲突升幅 183→214、本地增量 52→94 的原因：**我们这边 10-09 又落了 11 个新提交**（feedback5 移植、整备区/手牌规则、golden 重生成等），与上游 0.2.2/0.2.3 的改动在同样的文件上叠加了。

### 1.1 94 个本地增量文件按目录

| 目录 | 数量 | 典型文件 | 合并动作 |
|---|---|---|---|
| `server/sim/content/kits/ops` | 21 | `chess_char_5_05-ulpia.js` 等 | 上游 0.2.3 改了其中 1 个（ulpia）；其余 20 个是**本地 DIY 干员 kit**，上游没有 → 无冲突按 add 处理 |
| `public/js/ui` + `gameLogic` | 13 | `settings.js`（文字大小 vs 语音偏好）、`gameActions.js` | 0.2.3 改了 settings/gameActions → 真冲突，逐 hunk 看 |
| `public/js/screens` | 7 | `game.js`（PR #149 黑名单落点）、`title.js`、`loadout.js`、`diy.js` | 真冲突；game.js 按黑名单规则处理 |
| `public/css/screens` | 6 | | 0.2.3 改了 7 个 css（文字大小换行）→ 大部分取上游 |
| `shared/` | 4 | `constants.js`（版本号）、`protocol.js`、`diy.js`、`packs.js` | 全是本地层；protocol 0.2.3 改了（match recovery）→ 逐字段对齐 |
| `server/match` + `server` | 7 | `Match.js`、`bot.js`、`lobby.js`、`net.js`、`index.js` | 0.2.-only 图形/牌库改动在上游 0.2.2 已走一遍；0.2.3 又叠了 match recovery (#431)、bot 表情 (#444) |
| `test/golden` 4 + `test` 若干 | ~12 | `matches.json`/`roster.json` 等四大 golden | **上游 golden 是他们引擎的结果**；我们重生成（与 c85452ca 同法） |
| 其他 | | `tools/fetch-assets.mjs`（上游 #421 严格模式）、`data/assets.json` | 取上游 + 本地 token/语音清单合并（[[sp-upgrade-assets-manifest-gotcha]]） |

### 1.2 41 个"热点文件"

`本地增量 ∩ 0.2.3 直改` = 41 个文件（既是我们改过的，又是 0.2.3 期间上游又改的）。这 41 个是本次合并的手工对齐核心，其余可按 §2 的批量策略处理。

---

## 2. 整合计划（分批吸收,每批可验证、可中止）

### 阶段 0 — 前置（半天内可完成）

- [ ] **与并行会话协调**。工作区 110 条脏状态必须先落commit或暂存——这批 mod/无尽/排行榜工作正是未来 0.2.4-fusion 的内容，不能丢。**协调统一在合并窗口内暂停写入**（详见 §5 并发纪律）。
- [ ] 在独立分支 `merge/v0.2.3`（自 `feature/v0.2.1-fusion-master` 切出）上操作，绝不直接在 fusion-master 上 merge。
- [ ] 域名访问确认：`gh` 可用（已验证），上游 fetch 正常。
- [ ] 基线快照：`git merge-tree --write-tree HEAD v0.2.3` 的输出留档（本次已存 `/tmp`，落库到 `docs/upstream-merge/`）。

### 阶段 1 — 大块批处理（1 天）

分三个子批，每批一次 `git merge --no-commit` 后按策略解冲突、跑测试、提交：

**批 A：陈旧快照清场（115 个文件）**
```bash
# 策略:HEAD 侧是我们从上游历史复制的旧快照,上游已前进 → 全部取上游
git checkout v0.2.3 -- <115 个陈旧快照路径>
```
- 结束后 `git rev-list --objects v0.2.3 | grep <blob>` 抽查 10 个验证取的是 0.2.3 版本。

**批 B：上游 0.2.2 已删/搬目录（tier 文件）**
- `kits/tier1/4/5/6.js` 按上游删除（内容已搬进 `kits/shared/tierN.js`,92a179e7），同时保留我们若有的本地 tier 扩展(见 §4.1 DIY 层冲突)。
- `bond-collapse.e2e.test.js` **保持删除**(PR #149 黑名单,`.agents/rules/upstream-sync.md`)。

**批 C：纯新增文件(add/add 132 减去陈旧快照后剩余)**
- 主要是 `public/icons/`(新安装图标×10)、`op-clemnt.js`(克莱门莎)、docs。逐一 `git checkout v0.2.3 --` 采用。

### 阘段 2 — 本地增量手工合并（2–3 天,核心工作量）

41 个热点文件按子系统分组处理,每组一commit:

| 组 | 文件 | 要点 |
|---|---|---|
| 2a 版本与协议 | `constants.js`、`protocol.js`、`package.json` | APP_VERSION → `0.2.3-fusion`;protocol 对齐 0.2.3 新字段(match recovery、每干员语音偏好、文字大小) |
| 2b 语音与设置 | `audio.js`、`settings.js`、`gameLogic/settings.js`、`audio.test.js` | **三路交汇**:上游 0.2.3 的每干员语音(CN/JP/跟随全局)+我们 4354 条双语语音层。注意 PR #455(EN/KR/native dub)还在 open,先只合并已进 tag 的 CN/JP 版本 |
| 2c 引擎与内容 | `Battle.js`、`skills.js`、`kits/index.js`、`tokens.js`、`content/index.js`、`bonds/addon/battle.js` | 上游 0.2.3 规则修正(蕾缪安通缉、死芒召唤物触发、守卫治疗、Fartooth 叠层、克莱门莎 S2)与本地移植的 feedback5 规则在同一批文件;**先上游后本地补丁**——上游修的正是我们移植的同源 bug,逐 hunk 判断哪个新 |
| 2d 服务器与撮合 | `lobby.js`、`Match.js`、`bot.js`、`net.js`、`index.js` | match recovery (#431) 与我们房主重刷/撮合层交汇;bot 表情 (#444) 是独立新功能,直接取上游 |
| 2e UI 屏幕 | `game.js`+`game.css`(PR #149 黑名单落点,恢复 `<BondStrip>` 原状)、`title.js`/`title.css`、`loadout.js`/`diy.js`、`lobby.js` | 文字大小四档(#435)与我们手机适配/统计页层并存;install icon (#413) 取上游 |
| 2f golden 与测试 | 4 个 golden JSON + harness | **不手工合并,合并完成后统一重生成**(c85452ca 同法:node --test 跑通后 `--update-golden` 重录,再人工抽查 diff) |
| 2g 工具 | `fetch-assets.mjs`、`data/assets.json` | 取上游严格模式;assets.json 用 checkAssets/sync-voices-manifest 校验([[sp-upgrade-assets-manifest-gotcha]]):DIY token 不被裁、双语语音分组不 flatten |

### 阶段 3 — 验证与收尾（1 天）

- [ ] 全量测试(`--test-name-pattern` 分批,勿管道 grep,[[git-stash-rpc-risk]]):sim/content/match/ui/e2e。
- [ ] golden 重生成 + 抽查 3 个场景与上游 CHANGELOG 描述一致。
- [ ] 浏览器冒烟:标题页→建房→整备→战斗一回合→结算;顺手验证 0.2.3 新功能(文字大小、每干员语音、恢复对局)。
- [ ] Android 端:两阶段预载仍工作,`scripts/pack/` 三端打包冒烟(跨盘 rename EXDEV、junction 陷阱,[[sp-upgrade-pack-pipelines]])。
- [ ] PR #149 黑名单自查:`grep -rn "bondsCollapsed\|gm__bond-list\|bonds-toggle" public/ test/` 应为空。
- [ ] CHANGELOG 写 `0.2.3-fusion` 段;merge branch → fusion-master(建议 `--no-ff` 保留合并节点)。
- [ ] **不部署**。部署/推送另行确认(阿里云服务器红线,[[sp-upgrade-worktree]])。

### 工期估算

| 阶段 | 估算 | 说明 |
|---|---|---|
| 阶段 0+1 | 1 天 | 机械操作为主 |
| 阶段 2 | 2–3 天 | 41 个热点文件 × 平均 3–5 个 hunk |
| 阘段 3 | 1 天 | 测试+golden+双端冒烟 |
| **合计** | **4–5 天** | 一个熟练操作者(或本会话)顺序执行 |

---

## 3. 上游开发动向(2026-10-10 时点)

### 3.1 发布节奏:日更

10-07(v0.2.0)→ 10-08(v0.2.1)→ 10-09(v0.2.2)→ 10-10(v0.2.3)。dev/master 同步推进,feedback3 分支已并入 master。**合并窗口要卡在两次 tag 之间**,否则又要多吸收一天的变化。

### 3.2 0.2.3 的构成(32 提交, 203 文件)

- **内容**: 六星克莱门莎(三技能+天赋+潜能+练度)、黍/乌尔比安模组;数值国服 2.7.81。
- **功能**: 四档文字大小(#435)、每干员 CN/JP 语音偏好(#436)、添加到桌面(#413)、房主重刷开局(#77/#408)、恢复本机对局(#431)。
- **规则**: 蕾缪安通缉(#428)、死芒召唤物触发(#439/#440)、守卫无敌人治疗(#406)、赤刃明霄陈对空自动开技、远牙替身叠层(#415/#429)、克莱门莎 S2 舱位让出。
- **渲染**: 推拉保留朝向(#418/#427)、held-pose 复用与倒计时纹理共享(#434)、技能音效补齐(#410)。
- **人机**: bot 高阶卡抢卡缓解(#407)、bot 表情回应(#444)、余音/刺玫/泡泡递归上限修复。

### 3.3 社区动向值得注意的三件事

1. **#454 插件框架 issue(10-09 新开,0 评论)**:玩家要求 addons 目录式插件系统(MC Mod 管理器模式)。这**正中我们 ENDLESS_MOD 计划的赛道**——我们的 mod 化/包运行时层([[endless-patch-vs-builtin-mod-management]]、[[sp-upgrade-pack-runtime-gap]])与上游潜在方向撞车。上游若做官方插件框架,我们整个 mod 层要重新定位(从"代码级覆盖"迁到官方插件协议),**这是本次调研发现的最大战略信号**。
2. **PR 流水线兴旺**:30 个 open PR,10-09 一天开了 10 个。大量社区贡献被 owner 以 "0.2.3: integrate ..." 系列提交批量吸收——owner 的合并习惯是**先攒 PR、一次性 integrate、然后打 tag**。
攒 PR 期结束的标志是 CHANGELOG 出现版本号段落。
3. **#437 自选干员边界确认**:owner 明确**不做联动干员**(丰川祥子等,版权风险),但克莱门莎已实现。我们的 fusion 层 20 个 DIY 干员若要上游化,只能走非联动系列;更大的可能是保持本地层。

### 3.4 与我们本地层的对照表

| 领域 | 上游 0.2.3 | 我们 fusion 层 | 整合倾向 |
|---|---|---|---|
| 自选干员 | 克莱门莎 1 个,非联动 | 20 个 DIY 干员 + 4354 双语语音 + 皮肤 | 保持本地层;上游的 op-clemnt.js 若与我们 DIY 干员撞名/撞机制则 ours |
| 皮肤 | 无皮肤系统 | 271 全量皮肤 | 保持本地层 |
| mod/包运行时 | 无(#454 仍在讨论) | pack runtime + mod 菜单(进行中) | 保持本地层,但**盯紧 #454** |
| 整备区/手牌 | — | 满手拒绝购买/自动补位(7bedd9a5) | 保持本地层(上游 #82 未实现) |
| 语音偏好 | CN/JP/全局(0.2.3 新) | 双语语音库 | **三路合并**(2b 组) |
| 版本号 | 0.2.3 | 0.2.2-fusion(并行会话暂存) | → 0.2.3-fusion |
| match recovery | 0.2.3 新(#431) | 无 | 取上游 |
| PR #149 盟约折叠 | 已进上游 | **黑名单永久排除** | 保持排除 |

---

## 4. 风险与红线

| 风险 | 等级 | 缓解 |
|---|---|---|
| 并行会话写入合并中的工作区 | **高** | 阶段 0 的协调是硬前提;合并期切独立分支+独立 worktree(`git worktree add`)隔离 |
| PR #149 阶段性回流 | 高 | 每批解冲突后 grep 黑名单标记;黑名单规则文件已在 `.agents/rules/upstream-sync.md` |
| golden 大面积翻红 | 中 | 预期内:上游引擎变了,统一重生成而非逐个对齐 |
| assets.json 误裁 DIY token | 中 | fetch-assets 严格模式跑完用 checkAssets 验清单数(38 token + 双语分组) |
| 测试基线本就有 12 项失败 | 中 | 合并前先跑一遍基线留档,合并后对比"新增失败",不追存量(数据/引擎偏斜是根因) |
| 上游 0.2.4 又出 | 中 | 合并窗口卡 tag 间隙;完成后立即打 `v0.2.3-fusion` tag 固定 |
| 撞名:上游克莱门莎 vs 本地 DIY | 低 | `op-clemnt.js` 是 A(add),无 git 冲突;但需验证 kits/index 注册表和 golden roster 不重复计数 |
| 阿里云线上服务器 | 红线 | 全程不部署、不 push 到远端(除非用户明确要求) |

---

## 5. 并发会话纪律(操作时必读)

1. 合并操作前 `git status --porcelain | wc -l` 必须 ≤ 5,且 `ls -lt` 前 20 名无 10 分钟内 mtime。
2. 切实做到"独立 worktree":`git worktree add ../sp-merge-023 -b merge/v0.2.3`——并行会话在主 worktree 的脏文件不受影响,我们在新 worktree 里从干净的 HEAD 切分支。
3. 合并 commit 落在 `merge/v0.2.3`,由用户确认后再 `--no-ff` 进 fusion-master。
4. **不 push**、**不部署**。5 个 remote 都不动。

---

## 6. 明确不做的事

- 不在本次合并中做 endless mod 计划(§ 见 `docs/ENDLESS_MOD_DUAL_PLATFORM_PLAN.md`)的任何施工——它是独立轨道,等 0.2.3-fusion 落地后基于新基线重启。
- 不实现 #454 插件框架(那是上游 owner 的决策,我们只跟踪)。
- 不处理 bbleae/jingjiangze/xinhai 等 fork 远端的差异。
- 不动 `E:/Workbox/系统` 老工作区与 fanpack-mod(那是面向原版 0.2.1 的独立产品线,[[fanpack-mod-installer]])。

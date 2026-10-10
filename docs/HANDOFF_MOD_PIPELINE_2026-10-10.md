# 交接：mod 分发管线施工进度与基线红项（2026-10-10）

> 本文件是 `docs/CF_MOD_TRI_PLAN.md` 施工的交接页。计划本体是唯一事实源；本页只记「做到哪、什么红、为什么红」。

## 一、已落库阶段（15 个 commit，全部带测试）

| 阶段 | commit | 内容 |
|---|---|---|
| A1 | `9e7b9bc4` | 皮肤补录 271→273（**实测干员 174**，指南原文「173」系笔误） |
| A0 | `4137ffdd` | 工作区收编：mod 链路文件/文档/packs 内容包 + `.gitignore` 补 `server/.mod-staging|.mod-cache` |
| A0-4 | `658c5a10` | 镜像归一（`shared↔public/shared` 0 diff；`server/sim↔public/sim` CRLF 归一 0 内容 diff） |
| A0 收尾 | `cbccadda` / `4454e767` | 打包管线 `scripts/pack` 统一 + 服务器包无尽剔除 + 0.2.2-fusion；无尽客户端入口与 mod 弹窗收编 |
| D1 | `df1ad8a8` | 静默拉取与缓存（catalog 清单 + zip 按需；`modStorage` v2；`server/mod/packCache.js`） |
| C1 | `581dc29f` | 管理员上传（裸 body、64MiB、幂等、PK 魔数；三路由 + 契约 E2E） |
| B1 | `d038885b` | pack 契约（`PACK_TYPES.data` 升 supported 八角色、files 归一为数组、`modCatalog` 判鲜 API） |
| B1-0 | `b14fb1fb` | CF 五条事实 + wrangler 骨架（**R2 方案后被用户拍板作废**，仅留档） |
| C2-0 | `6ac9d60e` | acorn 就位 + 修并行会话带入的两处 ES2021 语法（数字分隔符 / `\|\|=`） |
| C2 | `2163e07b` | 五道验证管线（独立 fork 子进程、合并器注入、skip≠pass、报告契约） |
| C3 | `298ac5a8` | 发布链（验证后拆分 → 素材上第三方 CDN → 瘦身 zip → catalog 聚合 `/mods/index.json`） |
| B3 | `55de973e` | 能力位开关（`shared/capabilities.js`）+ 入口条件渲染 + 打包期改写替换正则抠标签 |
| E3 | `166141c0` | 后台 MOD 流水线（上传→验证→发布端点 + 可视化卡片） |

**门禁（四道，全绿）**：`tools/assert/{mod-routes,modSyncWiring,modverify-merger,no-mod-bundling}.mjs`

## 二、基线红项（5 项，**记录用、不作门禁**，按蓝图 A0-8 纪律）

基线对比对象 = 本批施工前的 `975585e1`（用临时 worktree 实测，已清理）。

| 红项 | 现象 | 归因 | 处置 |
|---|---|---|---|
| `test/data.test.js` → `config: modes, rounds and templates` | 断言 `mode_single_endless_funny: solo prep untimed`（`65 !== null`） | A0 收编时吸收了并行会话**已暂存**的 `data/config.json`（+8 个 `mode_*_endless_*`，基线 9 模式 → HEAD 17 模式）。无尽模式的 `prepTime=65` 违反既有「solo 模式 prep 无计时」不变量 | **不修**：无尽模式在「无尽出服」（P6/D4）阶段整批删除，届时该断言自然恢复；若要提前修，归并行会话或 P6 |
| `test/golden.test.js` × 4（roster/bonds/fields/matches） | 存储摘要不匹配 | 同上：A0 收编吸收了并行会话已暂存的引擎改动（`server/sim/{ai,skills}.js`、`content/{devices,items/meta}.js`、一个 kit 文件），而 `test/golden/*.json` 是这些改动**之前**生成的（`c85452ca`） | **不修**：golden 重生成是 A2 合并后 + F 阶段的动作（蓝图 §2-C2-5 与 A0-8 均如此规定）；现在重生成会把并行会话的 WIP 行为固化成基准 |

**这两类红的共同根因**：A0「工作区收编」按计划把并行会话已暂存的改动落进了 HEAD，而 golden/config 的期望值尚未随之更新。这不是本批 mod 施工引入的缺陷——本批所有新测试与门禁全绿。

## 三、下一步与硬前置

- **A2（0.2.2 → 0.2.3 合并，5.5–6.5 天）是硬前置**：D2（逐房 overlay，5–6 天）与 D4（房主弹窗/私密房，3–4 天）都在热文件上，必须先合并。合并前需：并行会话停手 + 工作区清零（`docs/UPSTREAM_023_MERGE_PLAN_V2.md` 的纪律）。
- 合并后：D2 → D4 → E1/E2/E4 → F（含 golden 重生成、真实 CDN 推送验收、三端打包冒烟）。
- 未跑过的验收（如实声明）：真实 CDN 推送（无凭据/未联网）、真实打包产物解包检查（capabilities=false 且页面无无尽按钮）、gate5 渲染冒烟（无 CHROME_PATH）、gate4 的 `mismatches===0`（A2 后首跑校准）。

## 四、施工纪律备忘

- 本仓库 `git stash list` 里有 **3 条其他分支的旧 stash**；`git stash pop` 不带参数会弹出它们并污染工作区（本会话已踩过一次，用 `git reset --hard HEAD` 恢复，旧 stash 未丢失）。要 pop 自己的 stash 必须 `git stash pop stash@{N}` 并先确认 N。
- 分套跑测试，别裸跑 `node --test`（会挂）；`node --test test/ui/*.test.js` 这种 glob 形式可用，目录形式不行。

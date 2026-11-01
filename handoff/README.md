# handoff/ — 历史交接与发布笔记

旧的会话交接、皮肤计划、发布说明都归到这里。它们只作存档，不参与构建，也不进发布包
（`tools/package.mjs` 的白名单只收 README/CHANGELOG/玩家文档）。

## 当前该读的那一份

**`ZHAJING-SPLIT-2026-10-28.md`** — 炸惊模拟（`difficulty: 'ZHAJING'`）独立玩法包这条线，六轮全记在同一份里；
最新的 **§14 是 A/B/C 收口**（名片立绘微调 / 头像+名片 / 卡池预选），接手先看 **§13 的全绿对账与「不属于本线」的红名单**。
主体架构与红线仍在 `EXTENSION-MODE-2026-10-27.md`（两份配合看，新的只记增量）；拓展模式第三轮的增量（含 §5.1
弄丢的 253 条译文）在 `EXTENSION-MODE-2026-10-28.md`，动 i18n 之前仍要读。

| 文件 | 内容 |
|---|---|
| `ZHAJING-SPLIT-2026-10-28.md` | **炸惊模拟玩法包（本线最新）**：隔离设计、forge / 全军出击 / 死亡回归 / 观战 / 预填 / 美术、收尾对账、§14 A/B/C 收口 |
| `EXTENSION-MODE-2026-10-28.md` | **拓展模式第三轮**：n19 / 超限房内开关 / 攻略说明 / 版面 / 规则分离调查 / i18n 事故 |
| `EXTENSION-MODE-2026-10-27.md` | **拓展模式主体**：架构地图、蚀流五环、三条线的状态、红线、决策记录、验证脚本 |
| `EXTENSION-MODE-2026-10-26.md` | 拓展模式第一轮：超限线收口、S1 落地清单、四份研究报告的结论 |
| `ANNIHILATION-CLIENT-2026-10-27.md` | 客户端三块接线与收尾那一轮的逐行细账 |
| `OVERLIMIT-FUN-2026-10-26.md` | 超限模拟（无限模式）设计与落地 |
| `UI-FEATURES-2026-10-25.md` / `UI-FIX-2026-10-25.md` | 界面功能与修复那两轮 |
| `HANDOFF-2026-10-24.md` | 更早的一轮交接 |
| `CONVERSATION_HANDOVER_SUMMARY.md` | 早期会话交接摘要 |
| `SESSION_HANDOFF_0.1.6.md` | 0.1.6 阶段的交接 |
| `SKINS-BUILTIN-PLAN.md` | 内置皮肤方案（`test/skins.test.js` 头部注释引用） |
| `RELEASE-INFO.json` | 0.2.5 发布元数据 |
| `release_notes_v*.md` / `release_notes_v025.txt` | 0.1.5 / 0.1.6 / 0.2.5 的发布说明 |

当前版本的变更记录请看根目录的 [CHANGELOG.md](../CHANGELOG.md)。

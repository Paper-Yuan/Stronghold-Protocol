# 服务器更新公告（仅服务器端）UI 方案 + 无尽服务器端清空修订

> 日期：2026-10-10 · 基线：`feature/v0.2.1-fusion-master`（对外 0.2.2-fusion）
> 上游文档：`docs/SERVER_UI_DESIGN_RESEARCH.md`（本方案是其 §3 admin 与 §4 玩家侧的细化）
> 两条用户指令：① 无尽模式在服务器端**清空**（设计范围零残留）；② 新增「**仅服务器端有的**更新公告」并规划其 UI。

---

## 0. TL;DR

1. **更新公告做成一个三层系统**：服务端以结构化条目（标题/正文/级别/频道/有效期/版本）为源 → **admin 后台有专属「公告」页**做撰写/发布/下线/排期（这就是"仅服务器端有"的管理形态）→ 玩家侧三处只读出口（大厅公告条升级、title 公告指示、房间维护警示）。管理动作只发生在服务器端；玩家永不撰写。
2. **数据模型用"静态种子 + 运行时热改"**：启动从环境变量/JSON 种子读入（兼容现有 `ANNOUNCEMENTS`），运行期通过 admin API 增删改并落盘到 `server/data/announcements.json`（与 `endless-records.json` 同款持久化模式），不重启即可换公告。
3. **传播用双通道**：玩家侧 REST 拉一次 + `lobby.stats` 同款 WS 推送即时刷新；admin 侧并入已规划的 SSE 流（`event: announcement`）。
4. **频道化**：`channel: ops`（运维广播/维护预警，进 lobby+room）与 `channel: update`（版本更新公告，进 title+lobby），admin 全部可见。级别 `info/warn/crit` 决定颜色与是否置顶。
5. **无尽清空**按已定案严格执行：服务器包**构建期**裁掉全部无尽入口（含本次新增公告系统里的"无尽榜单变动"文案位）；服务端**运行时**无尽数据面（records/结算分支/两条 API）标记为"待随路线 A 删除"，本方案的所有 UI 不含任何无尽元素。
6. 施工挂进路线图 **S2（API）/ S3（admin 页）/ S4（玩家侧接线）**，与已定的路线 A 合并前置不冲突。

---

## 1. 背景与现状核实（已逐行验证）

### 1.1 现有公告链路——**断的**

| 环节 | 文件 | 状态 |
|---|---|---|
| 服务端解析 | `server/index.js:660 parseAnnouncements()` | ✅ 完整（支持 JSON 数组或换行分隔，去重，≤200 字，≤50 条） |
| 服务端来源 | `process.env.ANNOUNCEMENTS` 或 `opts.announcements` | ✅ 但只能启动时注入，**改公告要重启** |
| 服务端 API | `server/index.js:943 GET /api/announcements` → `{ok, announcements}` | ✅ 已暴露 |
| 客户端组件 | `public/js/ui/announcement.js`（琥珀色滚动条，6s 轮播，`aria-live=polite`） | ✅ 完整，挂在大厅（lobby.js:24 import） |
| 客户端数据 | `store.announcements` | ❌ **全库无任何代码写入**——组件永远拿到空数组直接 `return null` |

**结论**：公告条从未亮过。它读 `store.announcements`，但 `store.js`/`net.js`/`data.js`/`main.js` 里没有任何 fetch `/api/announcements` 或 WS 赋值的逻辑。这是一处"UI 与 API 都建好、中间没接线"的半成品——本次正好重做并升级。

### 1.2 现有"广播"是另一回事

admin 的「全服广播」（`POST /api/admin/broadcast` → `admin.broadcast()` 遍历所有房间发 `room.chat`）是**即时聊天消息**，弹在对局聊天里，阅后即焚、无历史、无级别、无持久化。它**不等于**更新公告，但新系统可以复用它的管理入口心智（都是"服务器对全服说话"）。

### 1.3 无尽在服务器端的分布（清空的靶子）

| 位置 | 内容 | 性质 |
|---|---|---|
| `shared/capabilities.js` | `LOCAL_FEATURES.endless` 开关 | 构建期挡客户端入口（已定） |
| `server/records.js` | `endlessLeaderboard/All()` + 落盘 `data/endless-records.json` | **运行时数据面** |
| `server/match/results.js:90-152` | 结算的 endless 分支（bestRounds/roundsSurvived/ranked） | **运行时引擎面** |
| `server/match/Match.js`、`sim/*` | 散点 | 引擎面 |
| `server/index.js:947 /api/endless/leaderboard` | 公开排行榜 REST | 运行时 API |
| `server/index.js:800 /api/admin/endless` | admin 排行榜 API | 运行时 API（且**无 UI 消费**，已核实） |

**分层原则**（与 D4/D6 对齐）：
- **客户端包**：构建期 `endless:false` 即零入口——这是已定案的"清空"。
- **服务器运行时**：上述数据面/引擎面**随路线 A 合并一并物理删除**（不是关开关），删后 `server/` 树 `grep endless` 应为 0。本方案所有 UI 在设计期就不引用它们。

---

## 2. 目标与原则

### 2.1 「仅服务器端有」的确切含义

- **管理面**（撰写/发布/排期/下线/广播）只存在于服务器端 admin 后台——玩家端永远没有公告编辑器。
- **数据源**只在服务器（内存 + 落盘 JSON + env 种子），客户端纯消费。
- 与"全服广播"统一到一个管理心智下：广播 = 公告的一种即时推送形态（见 §3.4）。

### 2.2 设计原则

1. **不重启换公告**（现状痛点）：运行期热改 + 落盘。
2. **结构化**：从"纯字符串数组"升级为带元数据的条目，支持级别/频道/有效期/版本/链接。
3. **频道化投放**：运维消息与版本更新分频道，按界面位置过滤。
4. **向后兼容**：现有 `ANNOUNCEMENTS` env / `/api/announcements` 返回形状平滑迁移，旧客户端不炸。
5. **双端同码**（玩家侧出口）：出口 UI 走 device.js 三层制；admin 侧是第三端独立静态站。
6. **零无尽**：本方案任何 UI 不含无尽元素。

---

## 3. 数据模型与 API

### 3.1 公告条目 schema

```jsonc
{
  "id": "a_20261010_001",          // 服务端生成，稳定
  "channel": "update",              // "update"(版本更新) | "ops"(运维/维护)
  "level": "info",                  // "info" | "warn" | "crit"  → 颜色与置顶
  "title": "0.2.2-fusion 已上线",    // ≤40 字
  "body": "新增每干员语音切换…",      // ≤280 字，公告条省略、详情看全文
  "url": null,                      // 可选「查看详情」外链（如 release notes）
  "version": "0.2.2-fusion",        // 可选：标记所属版本
  "publishAt": "2026-10-10T12:00:00Z",
  "expireAt": null,                 // 可选：到期自动下线
  "pinned": false                   // 置顶（crit 隐式置顶）
}
```

落盘：`server/data/announcements.json`（append + 重写，模式同 `endless-records.json` 的原子写）。启动顺序：env `ANNOUNCEMENTS` 种子 → 叠加落盘文件 → 内存表（id 去重，落盘优先）。

### 3.2 服务端模块（新增）

`server/announcements.js`（仿 `records.js` 的单例 + 原子写）：
- `list({ channel, active })` —— 过滤频道、剔除过期
- `publish(entry)` / `update(id, patch)` / `remove(id)` / `pin(id, flag)`
- `broadcast(entry)` —— 即时推送（见 §3.4）
- 启动钩子 `seedFromEnv(raw)` 兼容 `parseAnnouncements` 旧格式（纯字符串 → `{channel:'ops', level:'info', body:str}`）

### 3.3 API

**公开（玩家侧，只读）**：
- `GET /api/announcements?channel=` → `{ ok, announcements: [...] }`（向后兼容：旧客户端不传参时仍返回全量，且为每个条目补 `body`；旧形状是纯字符串数组的，`Accept` 版本头或查询 `v=2` 区分——推荐直接改返回对象数组 + 在 lobby 客户端同步升级，服务器包与客户端同版本发布，无旧客户端顾虑）

**Admin（写，鉴权 + CSRF + 审计）**：
- `GET /api/admin/announcements` —— 全量含过期/未来排期
- `POST /api/admin/announcements` —— 发布（或排期）
- `PATCH /api/admin/announcements/:id` —— 改/置顶/延期
- `DELETE /api/admin/announcements/:id` —— 下线（软删，留审计）
- `POST /api/admin/announcements/:id/broadcast` —— 即时推送到在线玩家（可选；见 §3.4）

**负载可视化顺带**：把 `LoadGuard.summary()` 接入 `overview`（调研报告 P0 项），公告页发布 crit 运维公告时可在 UI 上联动显示当前负载档。

### 3.4 传播（玩家侧如何即时收到）

双通道，按成本取最低：
1. **REST 首拉**：title 进入与 lobby 挂载时 `GET /api/announcements`（带 channel 过滤），写入 `store.announcements`——**这一步就是修复 §1.1 的断链**。
2. **WS 即时推**：复用现有 `lobby.stats` 推送通道的服务端广播机制，新增 S2C 事件 `announce.update { items }`——admin 发布/broadcast 时全服在线客户端即时刷新，无需等轮询。协议登记进 `shared/protocol.js S2C`（一行），不占新连接。
3. `room.chat` 保持现状（admin 全服广播的即时弹窗），并允许从公告一键转广播（crit 级运维公告发布时可勾选「同时弹窗推送」）——把旧广播收编为公告的一个动作，而不是两套并行。

Admin 侧：并入调研报告已定的 SSE `/api/admin/stream`，加 `event: announcement`。

---

## 4. UI 设计

### 4.1 Admin 后台：新增「公告」页（仅服务器端的核心形态）

挂在调研报告的五页 IA 里，作为第六个导航项（或并入「总览」的运维区——**推荐独立页**，因为它是高频运维动作）：

```
sidebar: 🛡总览 · ▦房间与撮合 · ♟玩家 · ▤内容MOD · 📣公告 · ≣日志与审计
```

**页内三段**：

1. **撰写卡（顶部）**
   - 频道选择：`[ 版本更新 | 运维维护 ]` 二段开关（`.btn` radio，mint/amber 对应）
   - 级别：`info / warn / crit` 三枚色块 pill（蓝/黄/红，选定 crit 时自动勾「置顶」并出现「同时全服弹窗推送」复选框）
   - 标题输入（40 字计数）+ 正文 textarea（280 字计数， monospace）+ 可选 URL + 可选版本号
   - 排期：「立即发布 / 定时」切换 + datetime 输入 + 可选过期时间
   - 主按钮「发布公告」（写操作 → **二次确认** modal，显示投放范围预览：「将推送给 在线 N 人 · title+lobby 出口」）
2. **在列公告表（中部）**
   - 列：状态灯（生效中/已排期/已过期）/ 级别色块 / 频道 chip / 标题 / 发布时间 / 有效期 / 操作（置顶·编辑·转广播·下线）
   - crit/置顶行排在最上；过期行灰化收进「历史」折叠区
3. **投放说明（底部只读）**
   - 一行小字：各频道出现在哪些玩家出口（见 §4.2 矩阵）——让运维发之前就知道会亮在哪

设计语言：全部用调研报告 §6 的令牌共享清单 + badge 五变体；撰写卡用 `.brackets` 括弧面板；表格 `tabular-nums`。**同步交付 admin.css 新增层**（红线 C11）。

### 4.2 玩家侧出口（三处，全部只读、双端同码）

| 出口 | 频道 | 级别呈现 | 现状改造 |
|---|---|---|---|
| **大厅公告条**（lobby 顶部，已有 `.announcement-bar`） | ops + update | info=琥珀（现状色）/ warn=橙 / crit=红底白字 + 常驻不轮播 | **修复断链**：lobby 挂载时拉取 + `announce.update` 推送写入 store；多条 6s 轮播保留 |
| **Title 公告指示**（title 登录盒上方，新增） | update 为主 | 有未读更新公告时显示一枚 `.announcement-dot` 小红点 + 一行最新标题；点击弹 `.modal` 公告详情列表 | 新增小组件 `ui/announcementCenter.js`（详情列表：标题/正文/版本/日期/「查看详情」链接） |
| **房间维护警示**（room 顶栏下，条件显示） | ops 且 warn/crit | 仅当存在 warn/crit 运维公告（如「23:00 停机维护」）时在房间等待室顶部显示一条横幅，提示「维护将至，请尽快开始对局」 | 复用 `.announcement-bar` 变体 |

投放矩阵（admin 页底部说明文字照此写）：
- `update` → title（红点 + 详情）+ lobby 公告条
- `ops` info → lobby 公告条
- `ops` warn/crit → lobby 公告条（置顶/红）+ room 横幅 + （可选）全服弹窗推送

**移动端**：三处出口都走现有三层制——公告条在 `.sp-coarse` 下缩短为单行省略 + 点击展开 modal；title 红点尺寸按 44px 命中区；room 横幅允许两行。`max(.xxrem, Npx)` floor 照守。

### 4.3 不做什么

- 玩家端**不做**公告撰写/点赞/评论（D29 同源的"玩家不产生服务端内容"边界）。
- **不做**邮件/Push 通知（无账号系统，昵称即身份，无触达通道）。
- **不做**富文本/Markdown 渲染（正文纯文本 + 一个外链——降低 XSS 面；若将来要富文本，走严格白名单 sanitize，另立项）。
- 公告系统**不含**任何"无尽榜单变动"文案位（零无尽）。

---

## 5. 无尽服务器端清空（修订条）

本节是对 `SERVER_UI_DESIGN_RESEARCH.md` 的修订与执行口径：

1. **设计范围**：本方案与调研报告中的所有服务器端 UI（admin 五页 + 公告页 + 玩家出口）**不含任何无尽元素**——无榜单卡、无入口、无文案位。调研报告 §3.3 页 4 已正确不含；§1.2 提到的 `/api/admin/endless` 在本方案明确为**删除项**而非"补 UI"。
2. **构建期（已定案，复述为口径）**：服务器包 `LOCAL_FEATURES.endless=false` 构建期改写，客户端无尽入口零渲染。
3. **运行时（随路线 A 执行的删除清单）**：
   - 删 `server/records.js` 的 `endlessLeaderboard/All` 与 `data/endless-records.json` 读写（历史战绩数据如何处理需拍板——见开放问题 Q1）
   - 删 `server/index.js:947 /api/endless/leaderboard` 与 `:800 /api/admin/endless` 两条路由
   - 删 `server/match/results.js` 的 endless 结算分支与 `Match.js`/`sim/*` 散点
   - 验收口径：路线 A 合并后 `grep -rn endless server/` = 0
4. **过渡期**：路线 A 完成前，这些 API 仍在线，admin 新 UI **不消费**它们（不为将删之物做界面）。

---

## 6. 施工计划（挂进既定路线图）

前置：路线 A 合并完成（既定顺序约束）。本方案拆入 S2/S3/S4：

| 阶段 | 内容 | 产出 | 预估 |
|---|---|---|---|
| S2+ | `server/announcements.js`（schema/落盘/种子兼容）+ 公开 GET + admin CRUD/broadcast API + `announce.update` S2C 协议登记 + 审计接入 | 带测试（admin.test.js 同款） | 1–1.5d |
| S3+ | admin「公告」页（撰写卡/列表/投放说明）+ admin.css 公告层 + SSE `event: announcement` | 页面 + mockup 渲染自检 | 1d |
| S4+ | 玩家侧接线：lobby 公告条修复断链（REST+WS）+ title 公告红点与详情 modal + room 维护横幅 + 移动端适配 + i18n 预留 | 三处出口 + 截图比对 | 1–1.5d |
| （路线 A 内） | 无尽运行时删除清单（§5.3） | grep=0 验收 | 并入合并 |

合计约 3–4 个工作日。每阶段同步交付 CSS 与测试登记（红线 C10/C11）。

## 7. 开放问题

| # | 问题 | 建议 |
|---|---|---|
| Q1 | 无尽删除后，`data/endless-records.json` 历史战绩是否保留归档？ | 建议：打包前导出一份只读快照存档到 `docs/archive/`，线上文件随删除一并清 |
| Q2 | 公告是否要"按客户端 bundle 形态过滤"（如只对 androidFull 推某条）？ | 建议：v1 不做，频道已够用；有真实诉求再加 `audience` 字段 |
| Q3 | crit 公告的"全服弹窗推送"是否打断对局内玩家？ | 建议：对局内只在聊天插播（现状广播行为），弹窗仅 title/lobby/room 显示——不抢对局焦点 |
| Q4 | 公告与 admin 全服广播的旧入口（运维控制台里的输入框）去留？ | 建议：公告页上线后，旧输入框改为"快速广播"快捷方式（=发一条 ops/info 公告并勾选推送），UI 上收编为一处 |
| Q5 | title 公告的"未读"判定 | 建议：以 `publishAt` 对比 localStorage 最近已读时间戳，纯客户端，不落库 |

---

## 8. 来源

- 现状代码：`server/index.js:660/728/943`、`server/announcements`（无，新建）、`public/js/ui/announcement.js`、`public/js/screens/lobby.js:24`、`public/css/leaderboard.css:162`、`server/records.js`、`server/match/results.js:90-152`、`server/loadGuard.js:138`
- 定案：`docs/GLOBAL_VOICE_TRI_UI_ENDLESS_PLAN.md`（D4/D6 无尽清零）、`docs/SERVER_UI_DESIGN_RESEARCH.md`（§3 admin IA / §4.4 公告层次 / §6 令牌共享 / §7 路线图）
- 外部模式：公告中心参照 PlayFab/Photon 的运营公告形态；投放矩阵参照 Steam 客户端更新公告 + DRG 维护横幅

# 服务器端 UI 设计调研报告（终稿）

> 调研日期：2026-10-10 · 基线：`feature/v0.2.1-fusion-master`（对外版本已升 0.2.2-fusion）
> 方法：四路并行调研（admin 后台代码审计 / 客户端联机屏盘点 / 规划文档挖掘 / 外部最佳实践）+ 主线交叉核实（mockup 渲染资产、协议事件面、API 缺陷实地验证）
> 定位：这是「研讨出的最好结果」——现状证据 + 已定约束 + 业界模式 → 每个界面的推荐设计。施工在路线 A 合并（0.2.2→0.2.3）之后启动（既定顺序约束）。

---

## 0. TL;DR —— 十项结论

1. **服务器端 UI = 三类界面，不是一类**：① admin 运维后台（已有，需重建）；② 玩家侧服务器驱动屏（大厅/房间/匹配/模组——大体成熟，缺几个关键按钮）；③ 监控落地页（`dashboard.html` + `/healthz`，遗留需整合）。前两者语言不同但应共享同一套设计令牌。
2. **admin 重建已是定案**（GLOBAL_VOICE_TRI_UI_ENDLESS_PLAN §3.4/§3.5）：独立静态站、零依赖原生 ESM、沿用游戏设计令牌、只读优先 + 写操作二次确认。本报告在其上补齐了信息架构、组件清单与数据缺口。
3. **推荐 IA：左侧导航五页** —— 总览 / 房间与撮合 / 玩家 / 内容(MOD) / 日志与审计。外部实践（Pterodactyl/Grafana/Socket.IO Admin UI/Colyseus monitor）与现有素材全部收敛到这个形态。
4. **最紧急的可见性缺口不是美观，是"看不见"**：LoadGuard 三档熔断状态在服务端完整存在（`server/loadGuard.js`）但 API 不暴露、UI 无渲染——服务器红档拒新会话时运维毫无感知。这是 P0。同类的还有两个"有 API 无 UI"：`/api/admin/endless`（且按 D4 定案应随无尽剔除删除）、staged 删除（manager 已实现，只差一行 DELETE 路由）。
5. **实时模型：日志与指标从 2s 轮询改 SSE 单通道**（`event: log` / `event: stats`），操作仍走普通 POST。小 VPS 上 SSE 比 WS 实现便宜得多，且自带断线续传；游戏内 WS 不动。另修复已核实的 `overview.clients` 字段名 bug（UI 读 `webFull`、服务端只输出 `webPreloaded`，该值恒 0）。
6. **玩家侧最大功能缺口：大厅快速匹配按钮**。撮合引擎（`server/matchmaking.js`）、HUD、取消 UI 全部就绪，`queueMatch()`（lobby.js:486）写好了但**没有任何控件调用它**——"唯一缺口 = 一个按钮"。落位采纳 preview-matchmaking.html 的右下主行动集群方案。
7. **mod 市场（发现/浏览）在任何规划文档中都是空白**——CF 管线只到"上传→五道验证→发布→catalog"。已存在的设计是"内容包池"两级控制（运营端定池子 → 房主定本局）。报告给出从"池"到"市场"的分阶段路线，不假装已有定案。
8. **三个已核实的 API↔UI 缺陷**：`overview.clients` 字段名不匹配；`/api/admin/endless` 有 API 无 UI（应删）；staged 上传无 DELETE 路由。另有一处政策绕过：发布按钮无条件带 `allowPending: true`，架空了「skip 项需显式放行」的 C4 语义。
9. **两套后台视觉语言必须合并**：现行 admin（朴素深色）与旧 dashboard.html（战术 HUD：六边形/括弧/难度色块）风格割裂。方向已定——统一到游戏的 `.brackets`/MicroLabel/Bender 数字体系，admin 用密度更高的运维变体。
10. **顺序约束不变**：P6 服务器管理页重构必须在路线 A 合并之后动工（P0 设计稿可提前）；私密房字段（`private`/`packs`、令牌脱敏、🔒 徽标）按 modflow-final 落点吸收进新仪表盘，不再往旧 312 行字符串上加东西。

---

## 1. 范围与现状总图

### 1.1 「服务器端 UI」的三类界面

| 类 | 界面 | 现状 | 数据源 |
|---|---|---|---|
| ① 运维后台 | `/admin`（public/admin/*） | 825 行静态站（index 163 + js 418 + css 244），2s 轮询 | `/api/admin/*` 11 个端点 |
| ② 玩家侧服务器驱动屏 | title/lobby/room/匹配弹窗/排行榜/mod 管理 | 成熟（设计系统完整），有 10 项缺口 | WS 协议（C2S 30+ 事件 / S2C 20+ 事件）+ REST |
| ③ 监控落地 | `public/dashboard.html` + `/healthz` | 737 行遗留单用途页（WS 监听 lobby.stats），风格与 admin 割裂；`/healthz` 纯 JSON | WS / HTTP |

### 1.2 服务端 UI 数据面（已核实）

**Admin REST**（server/index.js:778-891）：`overview` / `rooms` / `logs?since` / `endless` / `broadcast`(POST) / `drain`(POST) / `mods/upload` / `mods/staged` / `mods/:id/status` / `mods/catalog` / `mods/:id/verify` / `mods/:id/publish`。
**游戏 WS 协议**（shared/protocol.js:293-396）：会话/房间 15 个 C2S + 撮合 3 个（`match.queue/cancel`、`room.list`）+ 局内一批；S2C 含 `lobby.stats`、`match.status/found`、`server.maintenance`。
**公开 REST**：`/api/endless/leaderboard`、`/api/packs`、`/mods/index.json`（CF 聚合，modSync 消费）、`/healthz`。

### 1.3 设计系统现状（玩家侧，已成熟）

- 令牌集中在 `css/theme.css`：近黑绿灰面 `--bg-0..4`、mint `#4ed8af`/glow `#17f9b7`、金/琥珀/冰蓝、难度梯度四色；Noto Sans SC + Bender 数字 + Novecento 微标。
- 根缩放机制：`1rem = 100 设计 px @1920×1080`，`clamp(24px, min(100vw/19.2, 100svh/10.8), 240px)`——「双端同码」的核心；小字全部 `max(.xxrem, Npx)` floor。
- 组件：`.brackets` 四角括弧、`.micro` 英文微标、`.topbar` 三段式、`.section-label` 序号框、`.btn--*--*`、`.modal`、`.me-chip`/`.ping-pill`/`.online-pill`/`.status-dot`。
- 双端三层制：`device.js` 特征类（`sp-coarse` 等，纯 feature detect，全库无 UA/宽度 JS 嗅探）+ `devices.css`（safe-area/44px 命中区/短屏压缩）+ `mobile.css`（`.sp-coarse` 前缀覆写）。
- admin 当前**没用**这套系统（admin.css 自带一套朴素深色），旧 dashboard.html 用了部分 token。合并方向 = 玩家侧令牌 + 运维密度变体。

---

## 2. 已定案的硬约束（设计不可逾越）

来源：GLOBAL_VOICE_TRI_UI_ENDLESS_PLAN（最新拍板）/ ENDLESS_MOD_DUAL_PLATFORM_PLAN / plan-drafts/modflow-final / UI_PACKS_VS_ENDLESS_PLAN。

| # | 约束 | 对 UI 的影响 |
|---|---|---|
| C1 | 三端 UI 彻底分别优化；服务器管理页独立成静态站 | admin 不参与 device.js 特征类体系，是「第三端」 |
| C2 | admin 技术选型：零依赖原生 ESM、无构建链、沿用 components.css 令牌、现有鉴权、只读优先 + 写操作二次确认 | 不引框架/打包器/图表库（sparkline 手绘 canvas） |
| C3 | 服务器无尽**清空**（D4/D6；构建期 `LOCAL_FEATURES.endless=false` + 运行时数据面随路线 A 物理删除） | admin 不出无尽榜单卡；`/api/admin/endless`、`/api/endless/leaderboard`、`records.js` 榜、结算 endless 分支全部删除（清单见 SERVER_UPDATE_ANNOUNCEMENT_UI_PLAN §5）；服务器包玩家页无无尽入口 |
| C4 | 多人无尽已删除（D2） | 无多人无尽房间形态 |
| C5 | 顺序：路线 A 合并后动工 P6（P0 设计稿可提前） | 本报告即 P0 设计稿 |
| C6 | 私密房：32 字符 base64url 令牌 + join 限流；admin 列 code + 包名、**令牌脱敏**；不进 `room.list`/撮合/LAN（D12/D14/D28） | admin 房间表加 🔒 徽标 + 包名；撮合面板不含私密房 |
| C7 | mod 两级控制：运营端定池子 → 房主定本局 → 公开匹配锁原版；池子数据源 = 构建期 `packs/index.json`，禁止运行期目录扫描 | admin「内容包池」面板；玩家大厅默认收起的二级入口；设置页只读一行 |
| C8 | 玩家不能自助安装 mod（kits=任意代码执行，D29） | 玩家侧只有「浏览/查看」，无安装按钮；市场 UI 的 CTA 是「通知房主/运营」而非「下载」 |
| C9 | 服务器分发的 `public/` 经构建期裁剪，与桌面/APK 不同一份 | UI 设计须考虑「服务器版玩家页」是裁剪版；admin 静态站是否走 LOCAL_FEATURES 开关未定（开放问题 O9） |
| C10 | 新 UI 目录必须加进 es2020-syntax / client-static 测试 + BUILD_INPUTS | 施工红线 |
| C11 | 新增 UI 必须同步交付 CSS（pluginpack 43/130 类名无样式的反面教材） | 施工红线 |

---

## 3. 界面一：Admin 运维后台（重建）

### 3.1 现状审计要点（已逐行核实）

**结构**：单列长滚 1400px：4 统计卡 → 排空横幅 → 运维控制台（广播/排空/刷新）→ 房间表 → MOD 流水线（staged + catalog 两表）→ 日志流（level 过滤）。
**已核实缺陷**：
- `overview.clients` 字段名不匹配：服务端输出 `{androidFull, webPreloaded, webStream}`（server/admin.js:149），UI 读 `clients.webFull`（admin.js:312）→ 该值恒 0。
- `/api/admin/endless` 有 API 无 UI 消费（且按 C3 应删）。
- staged 上传无 DELETE 路由（`ModUploadManager.remove()` 已实现，server/index.js 未暴露）。
- 发布按钮**无条件**带 `allowPending: true`（admin.js:283），绕过 C4「显式放行」语义。
- API 已暴露但 UI 未消费：`drainComplete`、`loadAvg[3]`、`heapTotalMb`、房间 `hostId/spectators/createdAt/seats[].ready`、验证报告 `gates[].name/detail/durationMs`、日志 `meta`。
- LoadGuard（status/loadScore/lagMs/freeMemMb/红黄阈值）完全不在 overview，熔断对运维不可见。
- 反馈用阻塞式 `alert()`；无 toast、无 loading 态、无审计轨迹（recordAdminLog 无 actor）。

### 3.2 外部模式收敛

Pterodactyl / Grafana / Socket.IO Admin UI / @colyseus/monitor 四处一致的模式：
1. **左 sidebar + 内容区**（一级导航 ≤7 项，顶部只放全局状态）；
2. **首屏三段式**：stat 卡（带 sparkline + 环比）→ 关键时序图 → 「需要注意的」异常列表；
3. **列表行 drill-down 抽屉**（不跳新页），抽屉内放成员/快照/操作；
4. 操作集：会话级断连/踢/临时封禁，房间级锁房/强制结束/房广播，全局广播/优雅停机——**破坏性操作二次确认 + 审计**；
5. 日志面板标配：级别 + 模块 + 文本搜索 + 暂停/跟随滚动；
6. 无 Grafana 栈时的最简告警：页内阈值规则 + 顶部 banner + 浏览器 Notification（alert on symptoms）。

### 3.3 推荐信息架构（五页）

```
┌ sidebar ─────────────┬ content ─────────────────────────┐
│ 🛡 总览 Overview      │ stat 卡×6(带 sparkline) / 负载熔断灯 │
│ ▦ 房间与撮合 Rooms     │ 时序图(CPU/MEM/在线/房间) / 异常列表  │
│ ♟ 玩家 Players        │ …                                 │
│ ▤ 内容 MOD            │                                    │
│ ≣ 日志与审计 Logs      │                                    │
├ footer: 版本 · 排空状态 · 健康 │                             │
```

**页 1 · 总览**：
- stat 卡：在线连接/会话、房间/对战中、CPU、内存(RSS/Heap)、ELS 负载分、撮合队列深度；每卡 60 采样点（5min @5s）canvas sparkline + 环比箭头。
- **负载熔断灯**（P0 新增）：绿/黄/红大灯 + ELS/CPU/lag/freeMem 四条进度带 + 阈值刻线（黄 160 / 红 200）——数据源 = LoadGuard.summary() 接入 overview。
- 排空横幅升级：剩余房间数 + 预计等待 + `drainComplete` 态 + （可选）取消排空。
- 异常列表：最近 error 日志 5 条、满载房、异常断连。

**页 2 · 房间与撮合**：
- 房间表列：code（高亮）/ 🔒私密徽标 + 包名（C6）/ 模式难度 / 人数(含 bot 徽标与客户端形态徽章) / 状态 / 回合阶段 / 存活 / 创建时间。
- **行点击 → drill-down 抽屉**：席位详情（ready/seat/playerId/客户端形态）、观战席、近 1 分钟事件、操作（房广播 / 强制结束(二次确认) / 锁房）。
- 撮合队列区：各 (mode,difficulty) 桶深度 + 入队速率（撮合只服务公开房，C6）。
- 私密房令牌**脱敏显示**（如 `x7…Q9m`，点击不展开完整值——只显示脱敏态，完整值不出 API）。

**页 3 · 玩家**（新 API）：
- session 表：名字/playerId/客户端形态(bundle 徽章)/连接时长/所在房/延迟。
- 操作：强制断开 / 踢出房 / 临时封禁(带时长) / 备注——二次确认 + 审计。

**页 4 · 内容（MOD）**：三个子区
- a) **流水线**：上传（裸 body zip，幂等 sha256——契约保留）→ staged 表（加「上传时间」列 + 删除按钮（新 DELETE 路由））→ 行展开**五闸门报告卡**（gate 中文名/pass-fail-skip 色块/detail 失败原因/durationMs）→ 发布（skip 项需显式勾选「放行发布」，修复无条件 allowPending）。
- b) **内容包池**（采纳 mod-4-admin-pool mockup，见 §3.4）：池子开关（运营端定池子）+ 校验拒绝原因（fail-closed 跳过并报告）+ catalog 表（版本/sha256/大小/CDN url）+ 下架/回滚。
- c) catalog 条目版本历史 + 校验 badge。

**页 5 · 日志与审计**：
- 日志：SSE 流（替换 2s 轮询；`?since=` 增量）+ level/模块/文本搜索/房或人过滤/meta 展开/暂停跟随/导出。
- 审计：所有管理操作（登录/广播/排空/踢人/publish）append-only 列表：时间/操作者/IP/参数哈希（不记原始 token）。

**贯穿**：toast 系统替换 alert()；按钮 loading/禁用态；空态文案统一；表格数字 `tabular-nums` 右对齐；badge 五变体（ok/warn/err/info/neutral）；`role="log" aria-live` 等可访问性。

### 3.4 已有视觉素材（直接可用）

- **mod-4-admin-pool.png**（已渲染）：内容包池面板——池子表（ID/名称/版本/类型 chip/作者/池子状态开关/校验状态含失败原因红字）+ 头部计数「内容包池 (4) 可用 2 被拒 1」+ 副标「运营端决定池子，房主决定本局启用」。设计语言与现行 admin 一致，直接采纳为新站「内容」页 b 区。
- **mock-4-admin-private-rooms.png**（已渲染）：房间表 🔒私密徽标列 + 版本徽标带 build hash + 客户端形态徽章行——已部分落地（现行 admin 已有 🔒 与徽章），新站吸收。
- 旧 dashboard.html 的战术 HUD 元素（六边形 logo、折角、难度色块、座椅格）→ 提取为 admin 的装饰层，与玩家侧视觉对齐。

### 3.5 实时模型与安全

- **SSE 单通道** `/api/admin/stream`：`event: log` / `event: stats`(5s 快照) / `event: rooms`(变更时)；15s `: keepalive`；响应 `X-Accel-Buffering: no`；CF 下注意 100s 闲置。操作仍走 POST fetch。游戏 WS 不动。
- **安全基线**（OWASP + Socket.IO Admin UI 做法）：token 从 sessionStorage/URL 迁 `__Host-` HttpOnly Cookie（Secure/SameSite=Strict/Path=/admin）+ 登录下发一次性 CSRF header + 登录按 IP 限流（5 败锁 15 分钟）+ idle 15–30min/absolute 8h 过期 + 敏感操作（广播/排空/publish/踢人）二次确认或重输 + 未认证一律 404（不暴露存在性）+ 可选 admin 路径改名 + CF Access 外包认证 + 响应头 `no-store/nosniff/CSP default-src 'self'` + HSTS。

---

## 4. 界面二：玩家侧服务器驱动屏（补齐缺口）

现状整体成熟（§1.3），以下是按优先级排序的缺口与推荐设计。

### 4.1 P0：大厅快速匹配按钮（引擎全就绪，只差按钮）

- **缺口**：`server/matchmaking.js` 撮合完整（(mode,difficulty) 分桶、4 人成团、10s AI 补齐、`match.status/found` 推送）；`queueMatch()`（lobby.js:486）+ `.matchmaking-hud`（进度/计时/取消）就绪；**无控件调用**。
- **推荐落位**（采纳 preview-matchmaking.html 重设计稿，对应 matchmaking.png）：右下「主行动集群」——主按钮 `.btn--quick-match`「快速匹配同盟 AUTOMATIC ALLIANCE MATCHING」（mint 斑马纹大键 + 三连折线箭头）+ 次按钮「自建私人同盟」；左侧 02/03 区重构为 `.join-tabs` 分段页签（公开集结频段 = `.alliance-chip` 双列网格：密钥 + 难度色标签 + 房主名 + 座位 n/4 + 「接驳 >」 / 密钥定向接入）。
- 备选（更小改动）：MatchmakingModal 统计条下方加通栏快速匹配按钮（mock-3-matchmaking-modal 形态）。推荐前者——把「匹配」从弹窗提升为大厅级主行动。
- **匹配状态机单屏化**：`空闲 → 搜索中(已等待 Xs · 池内 N 人) → 找到房(3s 倒计时) → 加入中 → 失败给「改为自建房」下一步`；可取消常驻；回显当前桶（模式/难度）。

### 4.2 P1：房间列表能力（MatchmakingModal 升级）

- 现状：4s 轮询平铺列表，无筛选/排序/骨架屏。
- 推荐：难度 chip 行内显示（已有）+ 过滤（隐藏已满/隐藏进行中/仅好友——好友系统无，先前两档）+ 稳定排序（Lethal Company 证明 20 行纯文字只要排序稳定不跳行就够用）+ 刷新骨架屏 + 「进行中」房聚合观战视图。
- 私密房天然不进列表（C6），无需锁图标区分。

### 4.3 P1：mod 内容 UI——从「池」到「市场」的分阶段

**已定案（C7/C8）形态**：
- 玩家大厅：内容包二级入口（默认收起），采纳 mod-1-lobby-packs 系列 mockup（大厅底部内容包区 + 房间徽标 + 设置只读行）。
- 房主：建房/房内选包弹窗（mod-6-room-packs mockup），公开匹配锁原版。
- 同步链路：modSync（`/mods/index.json` → sha256 判新 → 按需拉 zip）已静默运行，缺**可见进度 UI**（目前只进 `store.ui.modSync`）。
- 现有 ModUploadModal 全内联 style、与设计系统不一致——**重写为设计系统组件**并保留本地 zip 导入能力。

**开放的市场阶段（任何文档均未定案，标为研究方向）**：
- 参照 Thunderstore/mod.io：卡片列表（名/作者/一句话/分类 chip/下载数缩写/相对更新时间）+ 左侧过滤 + 排序 + 详情页（README + 版本历史 + **校验 badge**（= admin 五道验证结果，让玩家对安全性有感知））。
- CTA 不是「下载安装」（C8 禁止玩家自助安装），而是「查看/收藏/通知房主服务器上有新包可启用」。
- 依赖未定项：第三方 CDN 包元数据 schema、`/mods/index.json` 聚合策略（缓存/签名/降级）。

### 4.4 P2：其余缺口（按价值排序）

| 缺口 | 推荐 |
|---|---|
| 服务器统计仅无尽榜 | 路线 A 后再议服务端战绩持久化；暂保留本机 stats + 导出/导入 |
| 匹配状态细节 | 见 4.1 状态机；`match.found` 加过渡（「已为你填入房间 X」） |
| 维护/公告层次 | **已升级为专项方案** `docs/SERVER_UPDATE_ANNOUNCEMENT_UI_PLAN.md`（2026-10-10）：公告做成三层系统——admin「公告」页（仅服务器端管理）→ 结构化条目（频道/级别/排期）→ 玩家三处出口（大厅公告条修复断链 + title 红点 + room 维护横幅）。负载胶囊手机端恢复为迷你点。 |
| 观战入口分散 | mm 列表「进行中」聚合成「正在直播的对局」区 |
| 一致性债 | `.lobby-priv-row`/`.private-tag`/`.room-match-hud`/ModUploadModal 内联 style → 入设计系统；title/lobby/room 接 i18n（shared/i18n.js 已有，统计/盟约屏已接入） |

### 4.5 玩家侧必须保留的优点

统一战术工业语言（brackets/MicroLabel/Bender/斑马纹）；双端三层制无 UA 嗅探；服务器规则 UI 化严谨（房主开始即就绪、观战不占席、私密房不进公开列表、断线重连通知、错误码人性化文案）；性能细节（覆盖层未开不加载、轮询带 cancel、inFlight 防双击）；兜底文案（config.json 缺失时官中 fallback）；可访问性（role/aria/Esc 层级/reduced-motion）。**新设计一律站在这些机制上，不另起炉灶。**

---

## 5. 界面三：监控落地页（dashboard.html + /healthz）

- **dashboard.html**（737 行，WS 听 lobby.stats，「战术中继与大厅全局监控」）：功能与新 admin 总览页重叠。推荐：**废弃其独立地位**，视觉元素（六边形/折角/难度色块/座椅格）提取进新 admin；若保留公开状态页价值，则改为无鉴权的极简 `/status` 落地页（在线数/负载档/维护公告——三要素，玩家向），与 admin 分离。
- **/healthz**：当前纯 JSON。按定案做「人类可读化」——形态未定（开放问题 O6），推荐：admin 总览页内嵌健康卡（版本/build/协议/uptime/熔断档/最近部署），同时保留 JSON 供 PM2/探针；不另做独立文本页。

---

## 6. 跨界面设计系统（合并方向）

1. **令牌共享清单**（admin 从 theme.css/components.css 取）：`--bg-0..4`、`--mint-500/glow`、`--gold/--amber/--ice`、难度四色、`--text-hi/md/lo/dim`、字体三件套、`--t-fast/med/slow`、`--ease-out`；组件取 `.brackets/.micro/.num/.btn/.modal/.topbar/.status-dot`。admin 专属增量：badge 五变体、进度带、sparkline 容器、抽屉、toast——全部新写 CSS（红线 C11），放 `admin/admin.css` 一层，不改游戏组件。
2. **密度双轨**：玩家侧保持现有宽松密度；admin 侧表格行高 32–36px、12–13px 字号（Grafana 运维密度），但同令牌同字体。
3. **状态色语义统一**：绿正常/黄警告/红错误/蓝信息/紫特殊——颜色只表状态不表装饰；与难度四色（游戏语义）分区使用，不混。
4. **双端规则**：admin 是第三端（C1），不做 device.js 特征类，仅做响应式兜底（stat grid auto-fit、表格 overflow-x、窄屏 sidebar 折成顶栏）；玩家侧继续三层制，任何上游 UI 不整份搬入，按特征类 + CSS 三层重写并双端截图比对（既定指令）。

---

## 7. 施工路线图（按定案顺序 + ROI）

**前置**：路线 A 合并（0.2.2→0.2.3）完成。

| 阶段 | 内容 | 依据 | 预估 |
|---|---|---|---|
| S0（可与合并并行） | 本报告评审定稿；admin IA/组件 mockup 渲染（复用 docs/mockups/render-*.mjs 管线 + png-gate 自检） | C5「P0 设计稿可提前」 | 1–2d |
| S1 | admin 安全基线：Cookie 会话 + CSRF + 限流 + 404 隐蔽 + 审计日志骨架 | §3.5 | 1d |
| S2 | API 补齐：LoadGuard 入 overview、修 clients 字段名、staged DELETE 路由、房间 `private/packs` 字段、`/api/admin/stream` SSE | §3.1/§3.3 | 1–2d |
| S3 | admin 静态站五页重建（总览含熔断灯 + sparkline、房间钻取、MOD 三区、日志 SSE、审计）+ 令牌共享 + 测试登记（C10） | §3.3 | 3–4d |
| S4 | 玩家页：快速匹配主行动集群 + 匹配状态机（4.1）；MatchmakingModal 升级（4.2） | §4.1/§4.2 | 2–3d |
| S5 | 内容包池落地（admin b 区 + 玩家大厅二级入口 + 房主选包弹窗 + modSync 进度 UI + ModUploadModal 重写） | §3.3/§4.3 | 3–4d |
| S6 | 监控落地整合（dashboard.html 退役或改 /status；healthz 健康卡）；玩家页一致性债 + i18n | §5/§4.4 | 1–2d |
| S7（研究方向） | mod 市场：CDN 元数据 schema + `/mods/index.json` 聚合策略 + 浏览 UI（CTA=通知房主） | §4.3 | 待门禁 0 解锁 |

合计约 12–18 个工作日（不含 S7）。每阶段交付都带 CSS（C11）与测试登记（C10）。

---

## 8. 开放问题清单（需拍板）

| # | 问题 | 现状 | 建议 |
|---|---|---|---|
| O1 | admin 写操作完整清单 | 只定「只读优先、写二次确认」 | §3.3 页 2/3/4 列出的操作集（房广播/强制结束/锁房/断开/踢/封禁/备注/上下架/放行发布） |
| O2 | 私密房令牌脱敏形态 | 定「脱敏」未定形态 | `x7…Q9m` 截断掩码，API 不出完整值 |
| O3 | admin 是否需要解散私密房 / 查看邀请历史 | 未定 | 给「强制结束」（不区分公私），不给邀请历史（令牌本就不落库为宜） |
| O4 | 撮合队列是否进 admin | 未定 | 进页 2 小区（只读桶深度） |
| O5 | 负载指标采集/聚合粒度 | 未定 | LoadGuard.summary() 现状直出 + 5s 采样 60 点 |
| O6 | /healthz 人类可读化形态 | 未定 | admin 内嵌健康卡 + 保留 JSON |
| O7 | admin 是否做 i18n/移动端深度适配 | 未定 | 中文-only 起步 + 响应式兜底（§6.4） |
| O8 | 多实例/多服务器管理 | 未提及 | 暂单进程；预留 overview 加 `instanceId` 字段 |
| O9 | admin 静态站是否走 LOCAL_FEATURES 开关 | 未定（headless 包 mod 池区是否渲染） | 走：MODS=false 时隐藏内容页；与 capabilities.js 能力位合并统一命名 |
| O10 | mod 市场全套（schema/聚合/浏览 UI） | 空白 | S7 研究方向；先解门禁 0（CF/R2 五条事实） |

---

## 9. 已文档化的陷阱（施工红线，去重）

打包构建：禁整文件 overlay 求「零无尽字节」（分叉）；无尽注入只打打包器暂存副本不改仓库 config.json；`public/assets/**` 11 个一级符号链接必须 `find -L`（否则 3D 棋盘静默退 2D，271 vs 13,101 实测）；共享 JS 对 endless 只能动态 import；新 UI 目录必须登记测试 + BUILD_INPUTS。
数据包：禁在 `loadData` 合并 mod（逐房注入 D16）；不拿上游 `server/http/*` 重构（与 953 行单体 index.js 冲突）；不拿上游 data/i18n 或 Forge golden 当基线；内容包不许写 `modes`。
协议：validateC2S 对未知键 fail-open——带包创房必须 fail-closed 拒绝（不加全局「未知键即拒」）；`variant` 与 `packs` 并列不合并；`inviteKey` 走 host-only 单播不进 `room.state`。
私密房：4 字符码 16 秒可穷举（必须 32 字符令牌 + 限流）；私密房禁撮合（推翻旧 MATCHMAKING 计划）；私密房不走 LAN 发现。
素材 CF：禁 in-place 改素材 URL（30 天 immutable 撤不掉），换 `?v=<rev>`；headless 1481 条假清单必修；`/assets/local/**` 与 `data/local-assets.json` 必须一起推 R2；push-assets 不能省 `public/packs/**`。
流程：同一文件不得两条工作流并改（server/sim、make-headless-server、bundle-android 等在飞）；行号引用只对冻结工作树成立；不 apply 无尽补丁 overlay；内容包不碰 `server/match/`；大厅不新开 05 无尽独立段（已被 D4 废弃）；mockup 渲染需结构自检 + png-gate（不能只看图片加载成功），docs/mockups/ 未跟踪不能当证据；新增 UI 必须同步交 CSS（pluginpack 43/130 反面教材）。

---

## 10. 来源索引

**代码（已逐行核实）**：`public/admin/{index.html,admin.js,admin.css}`、`server/admin.js`、`server/admin/{modUploads,cfStorage}.js`、`server/modverify/{run,report}.js + gates/`、`server/loadGuard.js`、`server/index.js:740-891`、`shared/protocol.js:293-396`、`public/js/screens/{title,lobby,room,stats}.js`、`public/js/ui/{leaderboard,announcement,serverLoadBadge,chatBox,modUploadModal}.js`、`public/js/net/{modSync,planPackFetch}.js`、`public/css/{theme,devices,mobile,components}.css`、`public/dashboard.html`、`public/preview-matchmaking.html`。
**定案文档**：`docs/GLOBAL_VOICE_TRI_UI_ENDLESS_PLAN.md`（§3.4/§3.5 admin 定案、D2/D4/D6）、`E:\Workbox\ENDLESS_MOD_DUAL_PLATFORM_PLAN.md`（D5/D12-D28/D29）、`E:\Workbox\plan-drafts\modflow-final.md`（admin 字段落点）、`E:\Workbox\UI_PACKS_VS_ENDLESS_PLAN.md`（两级控制）、`docs/MATCHMAKING_PRIVATE_ROOMS_PLAN.md`（部分被推翻）。
**渲染资产**：`docs/mockups/mod-4-admin-pool.png`（内容包池）、`mock-4-admin-private-rooms.png`（🔒徽标）、`mock-3-matchmaking-modal.png`（匹配弹窗）、`mock-1-lobby-private-room.png`（大厅私密开关）、`mod-1..8-*.png`（内容包玩家侧）、`E:\Workbox\matchmaking.png`（preview 重设计稿）。
**外部参照**：Socket.IO Admin UI、Pterodactyl、@colyseus/monitor、Agones+Grafana、Grafana dashboard 最佳实践、MDN SSE、OWASP Session/CSRF Cheat Sheets、Thunderstore/mod.io、Steam Server Browser、Deep Rock Galactic、htmx 文档。
**调研代理**：admin 审计 / 客户端屏盘点 / 文档挖掘 / 外部实践（2026-10-10 四路并行）。

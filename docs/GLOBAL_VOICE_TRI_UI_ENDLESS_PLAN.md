# 全语种语音 × 单干员可改 × 三端 UI 彻底拆分 × 无尽出服 · 综合方案（2026-10-10，决策已定稿）

- **对象仓库**：`E:/Workbox/sp-upgrade-2.1`（分支 `feature/v0.2.1-fusion-master`，git HEAD `975585e1`；工作区有并行会话未提交的 0.2.2 部分移植 + endless/统计/packs 工作，见 [UPSTREAM_023_MERGE_PLAN_V2.md](UPSTREAM_023_MERGE_PLAN_V2.md)）
- **本文性质**：设计研讨 + 施工计划（P0–P9 分阶段）。**未改动任何代码。**
- **四个需求**（用户 2026-10-10 下午）：
  1. 语音做成**全语种**（不止中/日）且**可以按单个干员**改动；
  2. UI 在**双端分别适配**（手机/电脑）；
  3. **三端**（手机/电脑/**服务器端管理界面**）UI 彻底分别优化、**所有都做分别拆分**；
  4. **无尽模式完全从服务器端剔除**。

## ✅ 决策定稿（用户 2026-10-10 拍板，全文以此为准）

| # | 决策点 | 定稿 |
|---|---|---|
| D1 | 语音默认语种 | **全局默认日语（jp）**。上游 cn 默认是我们唯一的有意分歧点，记入 CHANGELOG「有意与上游不同的调整」 |
| D2 | 多人无尽 | **直接删除，不迁移**。`mode_multi_endless_*` 四条目随服务器剔除一并消失，CHANGELOG 明示行为变化 |
| D3 | mobile APK 语种 | **内置全部语种**（cn/jp/en/kr/native 五棵树全量）。实测代价：PR #455 增量 168.7MB（未压缩口径），按现有 APK 压缩比折算约 +140MB，APK 从 643MB → **约 780MB**。接受此体积 |
| D4 | 无尽剥离深度 | **本地化 + 服务器端彻底剥离，代码 UI 完全不留**。不保留任何无尽服务器代码/UI 残留；客户端无尽转为纯本地模式，服务器侧零无尽痕迹 |
| D5 | 双端代码形态（10-10 晚补充） | **手机端与电脑端是同一套代码，都带无尽**——无尽在双端都是本地跑，没有"某端独占"的形态分叉。屏幕拆分（P4）拆的是**布局与交互**的端差异，不是功能集差异；无尽入口/本地模拟/本机纪录两端共用同一实现 |
| D6 | 服务器包的无尽入口（10-10 晚补充） | **服务器连无尽入口都不给**——服务器分发的 bundle（`pack/server.mjs` 产物，含其 `public/` 静态目录）必须连 UI 入口都不含无尽，否则浏览器从服务器拿到的静态资源里还有无尽素材与入口、等于变相从服务器下发。剔除要发生在**打包层的一个结构化开关点**，不是产物后处理 |

---

## 0. 一页结论

| 需求 | 方案核心 | 关键决策 | 工作量 |
|---|---|---|---|
| 全语种语音 | 以本地 `voiceLang` 解析器为底座扩语种枚举 + 吸收上游 `voicePrefs.js` 的 per-char 覆盖模型；**不照搬 PR #455 的四棵树** | 语种 = 单一 `VOICE_LANGS` 表 + manifest 按语种分树；回退链统一 | 3–4 天 |
| 单干员改动 | 上游 `OperatorVoice`（0.2.3 已进 tag）扩展为全语种版；设置存储 `voiceOverrides[charId]` | 本地存储，不进 wire 协议（room.loadout） | 含上 |
| 三端 UI 拆分 | CSS 拆三层（base/desktop/mobile）+ 屏幕 JS 按端拆 `screens/<name>/`（`<name>.js` 共享 + `mobile.js`/`desktop.js` 端差异）+ 服务器管理页从 312 行裸 HTML 升级为独立静态站 | **继承 device.js 特性类体系，不按 UA**（[[sp-upgrade-dual-platform-axes]]） | 5–7 天 |
| 无尽出服 | 服务器删 62 处真实代码足迹（9 文件）+ 8 个 config 模式条目 + 2 个 API；无尽转为**客户端本地模式**（mod 层轨道） | 无尽不再是服务器难度，`mode_*_endless_*` 从 `data/config.json` 移除 | 2–3 天 |

**总工作量估算：10–14 天**（单人顺序执行；部分可与 0.2.3 合并路线 A 并行）。

**与 0.2.3 合并的顺序关系（重要）**：本方案的前提是先完成 [V2 计划的路线 A](UPSTREAM_023_MERGE_PLAN_V2.md)（合并 0.2.2 → 0.2.3），因为：
- `OperatorVoice`/`voicePrefs.js`/`operatorVoice.js` 是 0.2.3 的干净 add，合并后直接拿到，不用自己写；
- 0.2.3 的文字大小四档（#435）会改全部 CSS 字号行，先合并避免拆分 CSS 白做两遍；
- 无尽出服要动的 `gamedata.js`/`results.js` 正是 0.2.2 引擎合并的重写热点，先后顺序反了会冲突放大。

**推荐总排期**：路线 A 合并（5.5–6.5 天）→ 本方案 P1–P9（10–14 天）。若用户要并行，仅 P6（服务器管理页）和 P0（设计稿）可提前。

---

## 1. 现状盘点（实测锚点）

### 1.1 语音系统

**本地层**（`public/js/audio.js:895-936` 的 `voice()` 解析器）：
- 全局 `voiceLang`：`'jp' | 'cn'`，默认 jp（`audio.js:466`）；
- 查找链：`modVoicePacks`（Mod 包热切换）→ `manifest.audio.voice[curLang][charId][slot]` → `voice[altLang]`（**回退到另一语言**）→ `voice[charId]`（无语言层）→ `chars[charId].voice`；
- manifest 结构（`data/assets.json`）：`audio.voice.{jp|cn}.<charId>.<slot> → url`，每语种 191 干员；
- 素材现状：`public/assets/audio/voice/` 只有 `cn/`、`jp/` 两棵树。

**上游 0.2.3 层**（tag v0.2.3 实读）：
- `public/js/voicePrefs.js`（14 行）：`VOICE_LANGS = ['cn','jp']` 冻结表 + `sanitizeVoiceOverrides()`（charId 正则校验、上限 512 条）+ `voiceLangFor(charId, globalLang, overrides)`；
- `public/js/ui/operatorVoice.js`（25 行）：干员调配/自选详情里的「此干员语音」下拉（跟随全局/中文/日本語），存 `settings.voiceOverrides`，**刻意不进 room.loadout**（本地偏好）；
- 回退语义：「缺失的日语语音会回退到中文」（UI 文案即契约）。

**PR #455（open，未进 tag）**——全语种参考实现：
- 四棵素材树 `voiceEn`/`voiceKr`/`voiceNative` + `voiceNativeLangType`（44 干员本土语言），CN+JP+EN+KR+本土五档；
- 素材增量 **+5,712 文件 / +176 GB**（EN 182 / KR 182 / native 44 干员），fetch-assets 加 `--no-optional-voice` 开关；
- `audio.voiceLine` 按树挑选并沿 JP 同款回退；设置页加「本土语言」开关；换主语言/本土语言时**清空** per-op 选择；
- 打包：`FULL_ZIP_OPTIONAL_VOICE` 默认 false（维护者显式开启才进全量包）。

**影子冲突**（V2 计划已警告）：我们 `audio.js` 的 `voiceLang`+modVoicePacks vs 上游 `VOICE_LANGS`+voicePrefs——本方案 §2 就是它的解法。

### 1.2 三端 UI 架构

**桌面/手机（同一 Web 包）**：
- CSS：`theme.css`（变量）+ `components.css` + 15 个 `screens/*.css` + **`mobile.css`（389 行、仅 1 个 @media，靠 device.js 特性类选择）** + `devices.css`（最后加载：安全区/触摸命中区/减动效/全屏，特性类 `sp-touch/sp-coarse/sp-hover/sp-fs/sp-standalone/sp-reduced-motion` 挂 `<html>`）；
- JS：`main.js:455` 探测 `globalThis.AndroidNative`（原生桥）；screens 15 个平铺文件（不分子目录，仅 `game/` 有拆分先例：`marks.js`/`overlays.js`/`standInTags.js`）；
- 已有约束（记忆 [[sp-upgrade-dual-platform-axes]]）：三轴判定 = device.js 特性类 / AndroidNative 桥 / bundle tier——**绝不用 UA 或宽度**。

**服务器端管理页**：`server/admin.js`（271 行）+ `server/debug.js`（41 行），内联 HTML 字符串、无独立 CSS、无框架；已有端点 `/api/admin/endless`、`/api/admin/*`。**这是三端里最简陋的一端**。

**打包**：`scripts/pack/{index,mobile,desktop,server}.mjs` 三管线（[[sp-upgrade-pack-pipelines]]）。

### 1.3 无尽模式服务器足迹（全量实测，剔注释/英文误命中）

**真实代码足迹 = 9 个文件、62 处、8 个模式条目、2 个公开 API + 1 个管理 API：**

| 文件 | hits | 内容 |
|---|---|---|
| `server/match/gamedata.js` | 31 | `isEndless` getter、`endlessBossPoolScale/Index/First/Step/Every`、回合循环、数值外推 |
| `server/match/results.js` | 10 | `endlessBest/BestNew`、存活回合结算、排行榜资格（仅 ABYSS 档上榜） |
| `server/match/Match.js` | 7 | `pub.endless`/`bossStep` 广播、`startFinalAssault` 血池缩放、`recordEndlessResult` |
| `server/records.js` | 6 | `data/endless-records.json` 落盘、`endlessLeaderboard(All)` |
| `server/index.js` | 4 | `GET /api/endless/leaderboard`、`/api/admin/endless` 路由 |
| `server/match/audit.js` | 2 | Boss 血池 `endlessBossPoolScale` 乘子 |
| `server/admin.js` | 2 | 管理页无尽榜单段 |
| `shared/constants.js` | ~20 | `ENDLESS_*` 常量、`isEndlessDifficulty/endlessBaseOf/endlessDifficultyFor`、`DIFFICULTY_NAMES` 无尽档 |
| `data/config.json` | 8 条目 | `mode_{single,multi}_endless_{funny,normal,hard,abyss}`（由 `tools/endlessMode.mjs` 生成，`patch-endless.mjs` 就地补丁） |

**客户端足迹**（保留，转为本地模式）：`title.js`（无尽入口按钮）、`room.js`（难度选择器无尽切换）、`lobby.js`、`result.js` + `gameLogic/result.js`（存活回合结算展示）、`hud.js`、`leaderboard.js`（读 `/api/endless/leaderboard`——**出服后此组件失去数据源，见 §4.3**）。

**sim 侧**：`Battle.js`/`generic.js`/`fields.js` 的 "endless" 命中均为注释或英文词义（"an endless skill"），**无无尽耦合**——引擎层天然干净，剔除不需要动 sim。

---

## 2. P1–P2：全语种语音 + 单干员改动

### 2.1 架构（P1：数据与解析）

```
data/assets.json
  audio.voice: {
    cn: { <charId>: { <slot>: url } },   // 既有
    jp: { ... },                          // 既有
    en: { ... },                          // P1 新增树（fetch-assets 拉取）
    kr: { ... },                          // P1 新增树
    native: { ... }                       // P1 新增树（44 干员本土语言）
  }

shared/voiceLangs.js（新文件，唯一真相源）
  export const VOICE_LANGS = ['cn','jp','en','kr','native'];
  export const VOICE_LANG_NAMES = { cn:'中文', jp:'日本語', en:'English', kr:'한국어', native:'本土语言' };
  export const VOICE_LANG_FALLBACK = { native:['native','jp','cn'], en:['en','jp','cn'], kr:['kr','jp','cn'],
                                       jp:['jp','cn'], cn:['cn','jp'] };   // 每语种回退链（D1：兜底 jp）
```

**决策与理由**：
- **不照搬 PR #455 的 `voiceEn`/`voiceKr` 平铺四键**——它把语种枚举散进 manifest 顶层键名，每加一语种都要改 audio.js 的树挑选逻辑。我们已有 `voice.{lang}` 嵌套结构（就是为多语种设计的），直接扩枚举即可，**这也是对 PR #455 的结构性改进**（将来若上游合入 #455，我们的嵌套结构反而好合并——树形状相同）。
- **回退链集中成表**：现状 `altLang` 硬编码二语种互退（`audio.js:915`）；五语种后回退必须显式声明（native→cn、en→cn…），单一 `VOICE_LANG_FALLBACK` 表驱动，解析器循环走链。
- **mod 包兼容**：`modVoicePacks` 查找保持不动（它在 manifest 之前、按 `{lang:{charId:{slot}}}` 三层，天然兼容新语种）。

**解析器改造**（`audio.js` `voice()`）：
1. `curLang = voiceLangFor(realCharId, this.voiceLang, this.voiceOverrides)`——**逐干员覆盖在这里生效**（单干员改动的核心接入点）；
2. 回退循环 `for (const lang of [curLang, ...VOICE_LANG_FALLBACK[curLang]])` 依次查 modVoicePacks → manifest；
3. 末级兜底保持 `vRoot[charId][slot]` → `chars[charId].voice` 不变。

### 2.2 设置与 UI（P2：全语种选择器 + 单干员下拉）

**全局**（`settings.js`，替换我们的 `VOICE_LANG` 二元数组）：
- 「语音语言」按钮组扩为五档（名字用各自文字书写，i18n-ignore，与上游惯例一致）；
- **默认日语（D1 定稿）**：`audio.js:466` 的 `voiceLang = 'jp'` 默认值保留，与上游 cn 默认的分歧记入 CHANGELOG「有意与上游不同的调整」；`voicePrefs.js` 里上游把 `voiceLangFor` 兜底写死为 `globalLang === 'jp' ? 'jp' : 'cn'`，合并时改为**兜底 jp**（回退链所有末点从 cn 改为 jp，见 §2.1 回退表更新）；
- 换全局语种时**清空 `voiceOverrides`**（沿用 PR #455 的语义：避免隐藏的逐干员旧选择造成困惑）。

**单干员**（吸收并扩写上游 `operatorVoice.js`，0.2.3 干净 add）：
- 干员调配/自选详情的「此干员语音」下拉：跟随全局 / 中文 / 日本語 / English / 한국어 / 本土语言；
- **只列出该干员实际有素材的语种**（从 manifest 反查 `Object.keys(voice).filter(l => voice[l][charId])`）——比上游的固定三选一更诚实，也是"单干员可改"的体验核心；
- 预览一行（点击播一段 `place` 槽），沿用上游设想；
- 存储 `settings.voiceOverrides`（IndexedDB/localStorage 本地），`sanitizeVoiceOverrides` 直接采用上游实现（512 条上限 + charId 正则）。

**双端 UI 差异**（对接 P4 拆分）：桌面下拉用原生 select；手机端换成底部弹出的大按钮列表（44px 命中区，sp-coarse 特性类判定）。

### 2.3 素材与打包（D3 定稿：APK 内置全部语种）

- `tools/fetch-assets.mjs` 增加语种维度：**默认拉全部语种**（D3），保留 `--voice cnjp` 开关用于本地开发瘦身（**注意 [[sp-upgrade-assets-manifest-gotcha]]：重跑后必须 checkAssets 验 38 个 DIY token 与双语分组仍在**）；
- **mobile APK 内置五棵树全量**（D3）。实测口径（2026-10-10，对 0.2.1-fusion APK 解包）：
  - 现有 APK 643MB = `app_bundle.zip` 589MB（其中 `assets/` 568MB：spine 183.6 + audio 169.4 + char 85.7 + …）+ libnode 16.9MB；
  - 语音现状 cn 60.0MB + jp 75.7MB（压缩后）≈ 135.7MB / 5732 文件；
  - PR #455 增量 168.7MB 未压缩（EN 182 / KR 182 / native 44 干员，+5712 文件），按现有语音压缩比（164MB→135.7MB ≈ 0.83）折算压缩后 **约 +140MB**；
  - **预估新 APK ≈ 780–790MB**（Google Play AAB 上限 4GB 内、但国内直装包需注意部分渠道 800MB 限制；apk 下载分发无实质障碍）。
  - 语音门禁（`tools/bundle-android.mjs` → `sync-voices-manifest.mjs` 的 `verifyVoicesManifest`）自动覆盖新语种树——门禁只对「磁盘语音未登记」报错，新树登记进 manifest 即通过，**无需改门禁逻辑**，但要跑一次 `node tools/sync-voices-manifest.mjs --write` 并按 gotcha 记忆核查 DIY 分组；
- desktop/server 全量包含全语种（与 mobile 一致，无 OPTIONAL_VOICE 分层——既然 D3 定了全内置，分层开关没有存在价值，比 PR #455 的维护者 opt-in 模型简单）；
- **按干员适配（D3 附加要求）**：单干员下拉只列该干员有素材的语种（§2.2 已设计）；全局切换器在干员无素材时走回退链（en→jp→cn）；统计页加「语音覆盖」一栏（每干员有哪几语种）作为玩家可查的适配表。

### 2.4 验收

- 单测：`voiceLangFor` 五语种回退矩阵、`sanitizeVoiceOverrides` 边界、`voice()` 解析顺序（mod 包优先于 manifest、逐干员覆盖优先于全局）；
- 冒烟：全局切 EN→无 EN 素材的干员回退 CN；单干员设 KR 只影响该干员；换全局清空覆盖；
- 打包：mobile APK 体积不显著增长；desktop zip 含全语种树。

---

## 3. P3–P5：三端 UI 彻底拆分与优化

### 3.1 总原则

1. **一屏一目录**：`public/js/screens/game/` 的拆分先例（`marks.js`/`overlays.js`）推广到全部屏幕；
2. **端差异进特性类，不进 UA**（红线，[[sp-upgrade-dual-platform-axes]]）：所有「手机才加载」的判定 = `sp-touch && sp-coarse`（或窄屏 CSS），「桌面才加载」= `sp-hover`；
3. **CSS 三层制**：`<screen>.css`（结构，端无关）→ `<screen>.desktop.css`（hover/大屏增强）→ `<screen>.mobile.css`（触摸/紧凑/安全区）；
4. **服务器管理页独立成站**：不再是 server/*.js 里的 HTML 字符串。

### 3.2 CSS 拆分（P3）

```
public/css/
  theme.css            变量（字号变量化，接 0.2.3 文字大小四档）
  components.css       组件库（端无关）
  devices.css          特性类工具层（既有，不动）
  screens/
    title.css / title.desktop.css / title.mobile.css
    lobby.css / …      （15 屏 × 3）
```

- **mobile.css（389 行杂烩）解散**：按归属屏幕拆进各 `*.mobile.css`；`devices.css` 保留（它是特性类工具不是屏幕样式）；
- 加载方式：全部静态 `<link>`（现状就是），**不搞运行时按端注入**——浏览器对未命中的特性类规则开销可忽略，静态链接保证 LAN/离线可用（项目既有红线）；
- 桌面层只在 `sp-hover` 下生效（hover 态、多列布局、大间距）；手机层在 `sp-coarse` 或 `max-width: 720px` 下生效（44px 命中区、单列、底部弹出、安全区 inset）。

### 3.3 屏幕 JS 拆分（P4）

```
public/js/screens/
  title/
    index.js          共享逻辑（状态、net 调用）
    TitleScreen.js    布局组装
    desktop.js        桌面专属块（悬停卡、键盘导航）
    mobile.js         手机专属块（底部大按钮、PWA 安装条）
  room/ lobby/ game/ …（15 屏同构）
```

- 端组件的挂载由 `device.js` 的特性类快照（一次性判定）在 `index.js` 里选择：`const EndlessCard = features.coarse ? MobileEndlessCard : DesktopEndlessCard`——**构建时不动态 import**，保持单包（三端打包管线已按 tier 裁剪 bundle，运行时只做挂载选择）；
- `game/` 屏（最大）优先拆：HUD、商店、面板、棋盘交互各自的端差异最重；
- 每屏拆完跑该屏的 ui 测试 + 双端浏览器截图比对（mockup 管线，[[sp-upgrade-mockup-render-pipeline]]；visual-judge 不可用，程序化校验，[[visual-judge-unavailable]]）。

### 3.4 服务器管理页（P5）

```
server/admin/          （新目录，静态站）
  index.html  admin.css  admin.js
server/admin.js        → 收缩为纯 API 路由（/api/admin/*），页面改为 serve 静态文件
```

- 一页式仪表盘分卡片：房间列表、在线会话、负载熔断状态（loadGuard/MAINTENANCE/BUSY）、封禁管理、无尽榜单（**若 P9 先行则此项随无尽出服删除**）、素材/版本信息；
- 技术选型：**零依赖原生 ES 模块 + 现有 components.css 设计 token**（管理页不值得引入构建链；与游戏 UI 同视觉语言）；
- 权限：沿用现有 admin 鉴权；只读优先，写操作（踢人/封禁）二次确认。

### 3.5 优化清单（每端各自的"彻底优化"重点）

| 端 | 优化点 |
|---|---|
| 桌面 | 键盘导航全覆盖（0.2.3 已有快捷键基建）、hover 预览、多列布局（干员调配 4 列）、文字大小四档（#435 上游已进，接住） |
| 手机 | 44px 命中区全覆盖审计、底部弹出替代全部下拉/对话框（选择性、语音、设置）、横竖屏适配（devices.css 已有横屏基建）、PWA 安装条（0.2.3 `pwa.js` 接住）、**无尽入口本地化后的主屏改版**（§4.3） |
| 服务器 | 管理页从 312 行裸 HTML 到仪表盘、/healthz 人类可读化、负载可视化（三档熔断状态）、静态资源缓存头审计 |

### 3.6 验收

- 每屏双端截图基线（desktop Chrome + 手机视口）落入 `docs/ui-reference/`；
- `grep -rn "max-width\|min-width" public/css/screens/*.css`：媒体查询只允许出现在 `*.mobile.css`/`*.desktop.css`；
- 管理页在 375px 视口可用（管理员手机急救场景）；
- 三端打包产物均构建成功且 mobile APK 不增长（UI 拆分不应加资源）。

---

## 4. P6–P7：无尽模式完全出服（D4 定稿：服务器端代码与 UI 零残留）

### 4.1 语义定义（D4 定稿，比原方案更激进）

「**彻底剥离，代码 UI 完全不留**」= 服务器代码、服务器 UI、wire 协议、config 数据、**服务器分发 bundle** 五层全部归零：

**服务器代码层**：
- `server/match/gamedata.js` 删 31 处（`isEndless`/`endlessBossPoolScale`/`endlessBossIndex`/回合循环外推全部删除——非无尽路径数值**一字不变**，血池乘子恒 1）；
- `server/match/Match.js` 删 7 处（`pub.endless`/`bossStep` 广播、`recordEndlessResult` 调用）；
- `server/match/results.js` 删 10 处（`endlessBest/BestNew` 参数、存活回合结算分支）；
- `server/match/audit.js` 删 2 处（血池缩放乘子）；
- `server/records.js` **整文件删除**（唯一职责就是无尽记录）；
- `server/index.js` 删 `/api/endless/leaderboard` + `/api/admin/endless` 路由与 import；
- `server/admin.js` 删无尽榜单段（P5 管理页重构时直接不包含无尽卡片）。

**服务器 UI 层**：管理页无尽榜单卡片、`/api/admin/endless` 数据源——P5 重构后的管理页**不出现任何无尽入口**。

**数据层**：
- `data/config.json` 删 8 个 `mode_{single,multi}_endless_*` 条目；
- `tools/endlessMode.mjs`/`patch-endless.mjs`/`endlessscalecheck.mjs`/`apply-endless.mjs` 从 build-data 链摘除（文件本身移到 `tools/local-endless/` 供客户端本地模式用，不删——本地化还要用它的配置生成逻辑）；
- `data/endless-records.json` 停止读写（文件保留作历史数据归档，不再被任何代码引用）。

**wire 协议层**：`pub.endless`/`bossStep` 字段从广播里消失；`shared/protocol.js` 若有对应 schema 行一并清。

**shared/constants.js 特殊处理**：`ENDLESS_*` 常量与 `isEndlessDifficulty`/`endlessBaseOf`/`endlessDifficultyFor` **保留**——它们是客户端本地模式的运行依据；服务端文件的 import 链清干净即达到"服务器端不留"，常量本身在 shared 层是客户端资产。

### 4.1.1 服务器分发包的无尽入口剔除（D6 定稿——比代码剥离更进一层）

**问题本质**：`pack/server.mjs` 产出的服务器包里带 `public/`（浏览器从服务器加载的全部静态资源）。如果这套静态资源里有无尽入口/素材，玩家打开服务器页面就还能进无尽，素材就仍在"从服务器下发"。

**现状（实测，并行会话 10-10 已做一半）**：`scripts/pack/server.mjs` 现在用**正则后处理**剔除——对产物 `server/index.js` 正则删 `/api/endless/leaderboard` 路由、删 `data/endless-records.json`、对 `lobby.js`/`title.js` 正则抠掉 `<${LeaderboardButton}>`/`<${EndlessCard}>` 标签。**方向正确、手法脆弱**：正则跨行匹配产物代码，上游一改模板结构就静默失效；且只抠了两个屏幕，无尽素材文件本身仍在包里。

**定稿方案——单一开关点，数据驱动**：

1. **构建时常量**：`shared/constants.js` 增加 `export const LOCAL_FEATURES = { endless: true }`（客户端语义：本包带无尽）。`tools/bundle-server.mjs`/`make-server-bundle.mjs` 在**生成服务器包的 public/ 时**把它改写为 `{ endless: false }`（构建器直接产出改写后的文件，不做产物后处理）；
2. **入口统一走开关**：客户端所有无尽 UI 入口（`title.js` 无尽按钮、`lobby.js` 无尽卡片、`room.js` 无尽切换——D2 后 room 侧本来就要删）改为 `LOCAL_FEATURES.endless &&` 条件渲染。服务器包的浏览器页面因此**连入口都不渲染**，不是渲染了再隐藏；
3. **素材清单裁剪**：服务器包的 `public/assets` 构建时按 manifest 剔除无尽专属素材（无尽波次复用常规素材，实际增量主要是本地模拟入口图标一类——先 grep 素材依赖再定裁剪范围，宁少勿错：**裁剪只删"仅无尽引用"的文件**，引用计数从 `data/assets.json` 反查）；
4. **`public/sim` 镜像与服务器包**：本地模拟所需的 `public/sim/`（264 文件）**不进服务器包**（服务器包的浏览器页面没有无尽入口，自然不需要模拟器）；双端包（desktop/mobile）全量保留；
5. **`pack/server.mjs` 的正则后处理段整体删除**（被上述结构化机制取代）——这是对并行会话已交付工作的重构替换，不是推翻其方向。

**为什么开关放构建时而不是运行时**：服务器运行时探测自己"是服务器"再隐藏入口，等于把无尽代码和素材照常发下去、只是不显示——素材仍从服务器下发，违背 D6。**构建期改写**让服务器包物理上不含这些字节。

### 4.2 无尽去哪：客户端本地模式（P7，D5：双端同一实现）

无尽本来"就是社区改造模式"（`endlessMode.mjs` 头注原话）。出服后：
- `title.js` 的「单人无尽」按钮改为**纯本地对局**：不起服务器 room，走本地模拟（`public/sim/` 264 文件本地镜像就是干这个的——P7 第一件事是 diff `gamedata.js` 无尽分支 vs `public/sim/` 镜像，缺口（回合循环、Boss 周期、数值外推）搬到 `public/sim/` 对应文件）；
- 排行榜：`leaderboard.js` 失去 API 数据源 → 改读**本机统计**（0.2.2 统计页 record store 的 best/bestNew 字段），标题从「排行榜」改为「本机纪录」；跨设备排行不做（mod/云端轨道，另议）；
- **多人无尽（D2 定稿）：直接删除，不迁移**。`room.js` 难度选择器的无尽切换整个删除（单/多人都不可开无尽房）；`lobby.js` 无尽卡片逻辑删除。行为变化在 CHANGELOG 明示。

**D5 落点——双端零分叉**：无尽本地模式的全部代码（入口按钮、本地模拟调用、本机纪录页、结算分支）在**手机端与电脑端是同一份**（同一 `public/` 源码、同一实现）。端差异只存在于 P4 拆分出的布局层（手机端无尽入口是主屏大按钮 + 底部弹出结算；桌面端是卡片 + 侧栏纪录），**判定逻辑、存储、模拟器调用完全共享**。desktop 包与 mobile APK 都带完整 `public/sim/` 与无尽素材（APK 体积口径已含）。

### 4.3 涉及的 UI 改动（与 P4 合流）

- `room.js` 难度选择器删无尽切换与 `toggleEndless`（`room.js:183-205`）——D2 已定，单/多人都不留；
- `lobby.js` 无尽卡片改为 `LOCAL_FEATURES.endless` 条件渲染（D6：服务器包构建时置 false，双端包恒 true）；
- `result.js` 的无尽结算分支（存活回合/新纪录横幅）**保留**——本地模式结算仍走同一 result 屏，这属于客户端 UI 不属于服务器残留；
- `hud.js:317` 的无尽 lastRound=0 逻辑保留（本地对局需要）；
- `title.js` 无尽按钮保留但走本地（`title.js:229-243,314`），并加 `LOCAL_FEATURES.endless` 条件。

### 4.4 风险

| 风险 | 缓解 |
|---|---|
| 本地模拟器（public/sim）缺无尽运行时 | P7 第一步先出缺口清单（gamedata 无尽分支 vs public/sim 镜像 diff），确认工作量再动工；这是 P7 唯一的真实不确定项 |
| golden 测试含无尽场景 | 合并 0.2.3 后重生成 golden 时**排除无尽场景**（顺序又是对的） |
| 现有玩家无尽记录 | `data/endless-records.json` 保留文件、代码不再引用；统计页本机记录不受影响 |
| **并行会话的无尽在线化轨道与 D4 互斥** | 并行会话暂存的 `records.js`/`leaderboard.js`/`/api/endless/*` 是「无尽在线化」方向；D4 定稿后这些工作**不合并、在其轨道内废弃**。执行 P6 前必须与该会话知会：其 endless 在线部分（records/leaderboard/API）停止，统计页/packs/mod 轨道不受影响。**D6 追加**：其 `pack/server.mjs` 正则剔除段会被本方案的结构化开关替换（方向认可、手法升级），知会时一并说明 |
| `LOCAL_FEATURES` 改写与 0.2.3 合并的交织 | 开关机制是本地新增代码（shared/constants.js + 各入口条件渲染），不与上游文件同 hunk 冲突；但要在路线 A 合并**之后**做，避免 merge 时把它当成冲突侧 |
| 素材引用计数裁剪误删 | 只裁"仅无尽引用"的文件，引用表从 manifest 反查；裁完跑双端本地启动冒烟 + 服务器包页面冒烟（无无尽入口、常规模式正常） |
| 主线 golden 与 e2e 引用无尽模式 | P6 删除后同步移除 `test/` 内无尽场景文件（先 grep 清单再删，与 `mode_*_endless_*` 配对的 fixture 一并清）；**双端本地无尽保留自己的 e2e**（本地模式冒烟） |

### 4.5 验收（D4+D6 加严）

- `grep -rni "endless" server/ data/config.json shared/protocol.js` → **零命中**（注释也不留，D4 要求"完全不留"）；
- `shared/constants.js` 的 `ENDLESS_*` 仅被 `public/`、`tools/local-endless/` 引用，`server/` 零引用；
- `data/config.json` 无 `mode_*_endless_*`；服务器建房 API 对 `ENDLESS_*` 难度返回明确错误（lobby 校验删除后走非法难度拒绝路径）；
- **（D6）服务器包产物解包检查**：`public/js/` 内无 `LOCAL_FEATURES.endless === true`（构建改写生效）、无尽入口不渲染（浏览器打开服务器页面源码与运行时 DOM 均无无尽按钮）、`public/sim/` 不在服务器包、无尽专属素材不在服务器包 assets；
- **（D5）双端包产物检查**：desktop 包与 mobile APK 都含 `public/sim/`、无尽入口、无尽素材；两端本地无尽均可玩且行为一致（同一 golden/同一实现）；
- 单人无尽在浏览器本地可玩（不起 room）、结算进本机统计、本机纪录页可查；
- 全量测试 + golden（无尽服务器场景移除后；本地无尽场景保留）绿。

---

## 5. P0 与 P8–P9：排期总表

| 阶段 | 内容 | 依赖 | 工期 |
|---|---|---|---|
| P0 | 设计稿：三端各屏线框 + 语音选择器交互稿（mockup 管线出图，用户过目后开工） | 无 | 1 天 |
| **前置** | **路线 A：合并 0.2.2 → 0.2.3**（V2 计划） | 并行会话落库 | 5.5–6.5 天 |
| P1 | 语音数据层：语种表/回退链（兜底 jp）/manifest 扩五树/fetch-assets 默认全语种 | 前置 | 1.5 天 |
| P2 | 语音 UI：全局五档（默认日语）+ 单干员按素材适配下拉 + 双端形态 | P1 | 1.5 天 |
| P3 | CSS 三层拆分（15 屏 + mobile.css 解散） | 前置 | 2 天 |
| P4 | 屏幕 JS 目录化拆分（game/lobby/title 优先） | P3 | 2.5 天 |
| P5 | 服务器管理页独立站（不含无尽卡片） | 无（可与前置并行） | 1.5 天 |
| P6 | 无尽出服：服务器五层归零（代码/UI/协议/数据/**分发包**） | 前置 + 与并行会话知会 | 1.5 天 |
| P7 | 无尽本地化：title 入口/本地模拟缺口补齐/本机纪录页（D5：双端同一实现） | P6 | 1.5 天 |
| P8 | 三端优化清单逐项过（§3.5）+ APK 全语种体积验证（≈780MB）+ 服务器包无无尽入口验证 | P3/P4/P5 | 1.5 天 |
| P9 | 收尾：CHANGELOG 0.2.4-fusion（D1–D6 全部记入）、三端打包、golden、双端截图基线归档 | 全部 | 1 天 |

**关键路径**：前置合并 → P1→P2→P3→P4→P8（语音与 UI 串行约 9 天）。P5 可与前置合并并行。P6/P7 动工前必须完成与并行会话的方向知会（§4.4）。

---

## 6. 决策点（2026-10-10 全部定稿，存档备查）

| # | 决策点 | 结果 |
|---|---|---|
| 1 | 语音默认语种 | ✅ **全日语（jp）**——回退链兜底全部改为 jp，与上游 cn 默认的唯一有意分歧 |
| 2 | 无尽本地化的多人档 | ✅ **直接删除，不迁移**——room.js/lobby.js 无尽切换一并删，CHANGELOG 明示 |
| 3 | P6/P7 与并行会话无尽轨道 | ✅ **方向定为「本地化+服务器零残留」**——并行会话的「无尽在线化」成果（records.js/leaderboard API）不再合并，其轨道内废弃；统计页/packs/mod 轨道不受影响。执行 P6 前需向该会话知会 |
| 4 | mobile APK 是否内置全语种 | ✅ **内置全部语种**——预估 APK 643MB → ≈780MB（+140MB 压缩后），按干员素材自动适配语种菜单 |
| 5 | 双端代码形态 | ✅ **手机/电脑同一套代码、都带无尽（本地跑）**——无尽实现零分叉，端差异只在 P4 布局层；desktop 与 mobile 包都含 `public/sim/` 与无尽素材 |
| 6 | 服务器分发包的无尽入口 | ✅ **连入口都不给**——`LOCAL_FEATURES.endless` 构建时开关（服务器包置 false、双端包恒 true），入口条件渲染 + `public/sim` 与无尽素材不进服务器包；替换并行会话 `pack/server.mjs` 里的正则后处理（方向认可、手法升级为结构化） |

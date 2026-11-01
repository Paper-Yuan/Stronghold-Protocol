# 功能补全与素材高清化交接（2026-10-25 第二轮）

**分支**：`align/0.3.0`（承接 [UI-FIX-2026-10-25.md](UI-FIX-2026-10-25.md)）
**范围**：局内聊天/弹幕、超限特殊组件、手机端适配、首期干员素材 404、皮肤内置（273 套）、全幅立绘、皮肤语音

---

## 0. 一句话现状

- 房间/局内**文字聊天 + 弹幕**恢复：协议 `room.chat` / `room.chat.history`、服务端广播与内存历史、房间可拖动面板、对局 `ChatBox`。
- **超限模式**的客户端链路补齐：`g.traitChoice` / `g.retreat` / `g.combatSpeed` 三个意图，词条抉择面板、双 Boss 全屏预警、顶栏 ∞/倍速/本局词条。
- `public/index.html` 恢复 `room-chat.css` / `room-voice.css` / `traitOverlay.css` / `bossPhaseWarn.css` 四个样式表。
- 首期 64 名干员的缺失素材由 `fetch-assets` 重新下载（详见 §4）。
- 皮肤内置恢复：`data/skins-installed.json` 从 174 套扩到 273 套；注入器只写本机存在的文件，不写远程 URL。
- 全幅立绘（`skin/{portraitId}b.png`，≥1024px）经 `tools/fetch-illusts.mjs` 落地，并写入 `chars[].illust` 与皮肤 `illust`。

---

## 1. 聊天与弹幕

### 1.1 协议（`shared/protocol.js`）

| C2S | 字段 | 说明 |
|---|---|---|
| `room.chat` | `text`（1–120，trim 后非空）、`code?`（4 位房间码） | 服务端裁到 `CHAT_MAX = 100`，去控制字符 |
| `room.chat.history` | `code`（4 位房间码） | 向请求者推 `room.chat.history { code, messages }` |

`S2C` 增加 `room.chat`、`room.chat.history`。广播帧形状：
`{ t:'room.chat', id, code, playerId, name, seat, isSpectator, text, at, time }`（`at`/`time` 同值：前者给测试与记录，后者给 `ui/roomChat.js`）。

### 1.2 服务端（`server/lobby.js`）

- 导出 `CHAT_MAX = 100`、`CHAT_CD_MS = 1000`、`CHAT_KEEP = 80`。
- `Room.chat`：不在房间 → `NOT_IN_ROOM`；同一会话 1 秒内第二条 → `RATE`；控制字符剔除、trim、裁到 100，空 → `BAD_MSG`；广播给全体（含发送者与观战者，观战者 `seat=-1`）。
- `Room.chatHistory`：仅请求者，最近 80 条；`code` 不符 → `NOT_IN_ROOM`。
- 无持久化：重连后只能看到重连后的历史（内存环形）。

### 1.3 客户端

| 文件 | 改动 |
|---|---|
| `public/js/main.js` | `net.on('room.chat')` → `pushChatMessage` + `getRoomDanmaku().show`；`roomIdentityChanged` 时 `clearChat()` |
| `public/js/screens/room.js` | `mountRoomChat()`（可拖动面板 + 弹幕） |
| `public/js/screens/game.js` | `<${ChatBox} active=${chatOpen} onToggle=${setChatOpen} showTrigger=${true} />` |
| `public/js/ui/chatBox.js` | 在线时不再本地重复弹幕（等服务器回显）；离线仍本地回显 |
| `public/js/ui/roomChat.js` | 12 处界面字符串改走 `t()`（4 个语言包已补） |

### 1.4 样式 / i18n

`index.html` 恢复 `room-chat.css`、`room-voice.css`；`room-chat.css` 追加手机安全区、输入框 16px、32–44px 触控覆盖；`devices.css` 给聊天/超限按钮补 44px 隐形热区。新字符串已进 `en` / `ja` / `ko` / `zh-TW`。

---

## 2. 超限特殊组件

### 2.1 协议与分派

`g.traitChoice { idx: 0..5 }`、`g.retreat {}`、`g.combatSpeed { speed: 1|2 }`；`server/match/match/intents.js` 分派到既有的 `pickTrait` / `retreatNow` / `setCombatSpeed`。

### 2.2 界面

| 组件 | 位置 | 数据 |
|---|---|---|
| `TraitOverlay`（已存在，本次挂载） | `game.js` 覆盖层 | `m.public.trait { round, polarity, cards, turn, picks }` |
| `BossPhaseWarn`（已存在，本次挂载） | 全屏 | `m.public.phase === BOSS_PHASE2_WARN` |
| `InfiniteSpeedToggle`（新，`ui/infiniteHud.js`） | 顶栏右侧 | `m.public.speedPref` → `g.combatSpeed` |
| `TraitBadge`（新，同文件） | 顶栏右侧 | `m.public.traitMods[]`，按回合列出正/负词条与合计 |

样式沿用 `game.css` 既有的 `.gspeed*` / `.gtrait*`（含短屏、竖屏手机覆盖），未引入新的视觉体系。

---

## 3. 手机端

- `room-chat.css`：横屏短屏下聊天面板贴安全区、限高、输入 16px、按钮 ≥32px；窄屏（≤420px）宽度收敛。
- `traitOverlay.css`：撤退按钮贴右下安全区、≥32px；≤480px 卡片高度收敛。
- `devices.css`：聊天与超限控件加 44px 隐形热区。
- `devtools/render-check.mjs`：支持 `SP_VIEWPORT=WxH`，同一套流程跑 1280×720 / 667×375 / 932×430。

---

## 4. 素材：404 修复、皮肤 273 套、全幅立绘、语音

### 4.1 首期 64 名干员

`data/assets.json` 有 229 个干员，但第一期独有的 64 名（`char_198_blackd`、`char_133_mm`、`char_109_fmout`…）的 avatar / portrait / Spine / 技能图标文件在磁盘缺失 —— 这就是浏览器 404 / 加载失败的来源。`fetch-assets` 的计划本来就覆盖四版本并集，重跑即补齐。直连 GitHub 在本机不可用，改用镜像：

```bash
node tools/fetch-assets.mjs --concurrency=12 --voice-all --asset-source=mirror
```

### 4.2 皮肤与立绘

| 步骤 | 工具 | 输出 |
|---|---|---|
| 皮肤头像 | `fetch-skin-avatars.mjs` | `char/skin_avatar/{stem}.png`（273 张） |
| 立绘小图 | `fetch-skin-portraits.mjs` | `char/portrait/{stem}.png`（180×360） |
| 皮肤 Spine | `fetch-skin-spines.mjs` | `spine/op/{charId}/{stem}/…` |
| 全幅立绘 | `fetch-illusts.mjs`（新） | `char/illust/{charId}.png`、`char/illust/skin/{stem}.png` |
| 内置清单 | `set-skins-installed.mjs`（新） | `data/skins-installed.json`（273 套） |
| 目录 | `build-skins.mjs` | `data/skins.json` |
| 皮肤语音 | `fetch-skin-voices.mjs`（扩展） | `data/skin-voices.json`（按内置清单） |
| manifest | `inject-skins-assets.mjs`（重写） | `chars[].skins` / `chars[].illust` / `stats.*` |

`inject-skins-assets.mjs` 只写磁盘真实存在的文件（头像必需；立绘/Spine 可选），绝不写远程 URL；`fetch-assets` 重跑时会把当前 manifest 中文件仍在的 `skins` / `illust` 带进新 manifest（`report.preservedBundled`），避免静默丢失与 shrink guard 误报。

> **设计边界**：仍然是「构建期内置」，没有 `room.skin.install`，服务器不下载、不改写共享 manifest；插件覆盖仍优先。详见 `docs/SKINS.md` 的「打包期内置皮肤」。

---

## 5. 验证命令与结果（2026-10-25 实测）

### 5.1 聊天 / 超限 / 皮肤语音

```
node test/lobby-chat.test.js            → 6/6 通过（协议、广播、观战者 seat -1、1 s 限流、控制字符、CHAT_MAX=100）
node test/ui/chat-box-css.test.js       → 5/6；唯一失败是既有的 .gm__bonds 居中断言（与本轮无关）
node test/ui/danmaku.test.js            → 4/4 通过
node test/match/trait-draft.test.js     → 8/8 通过（含 g.traitChoice / g.retreat / g.combatSpeed 的协议边界）
node test/ui/skin-voices.test.js        → 4/4 通过（皮肤语音优先、缺槽回落、native 无皮肤树）
node test/ui/skin-picker.test.js        → 14/14 通过
node test/data.test.js                  → 30/30 通过
```

### 5.2 素材

```
node tools/assets/coverage.mjs --files
  第二期下半 986 records / 0 missing
  第二期上半 941 records / 0 missing
  第一期下半 785 records / 0 missing
  第一期上半 771 records / 0 missing
  （修复前：第一期上/下各 64 条缺失）

node -e 校验 chars[].illust / skins[].{avatar,portrait,illust,spine} 的每个 URL：
  missing injected files 0
```

- 干员全幅立绘：**228 / 229**（`char_4231_clemnt` 上游无图）。
- 皮肤：**273 套** 全部写入 manifest；头像 273、立绘小图 273、全幅立绘 **271**（`char_1042_phatm2@sightseer#4`、
  `char_4204_mantra@sightseer#4` 上游 404）、Spine 174（其余为「仅更换头像与立绘」）。
- 皮肤语音：18 款带战斗语音的皮肤 → **16 款**有可用条目（838 个文件落地，56 个上游缺失），
  `data/skin-voices.json` 按 cn/jp/en/kr 生成，`audio.js voiceLine` 在穿着该外观时优先播放。
- `data/assets.json`：`stats.skins = 273`、`stats.charsWithSkins = 174`、`stats.illusts = 228`；
  文件数 22,788、约 1.7 GB（磁盘）。

### 5.3 渲染（无头 Chrome，本机 3012 端口）

| 视口 | 检查 | 结果 |
|---|---|---|
| 1280×720 | 标题页 / 大厅 | 0 应用错误（外部感谢名单偶发失败单独标注） |
| 932×430 | 标题页 / 大厅 | 0 应用错误 |
| 667×375 | 标题页 / 大厅 | 0 应用错误 |
| 667×375 / 1280×720 | `render-check-chat.mjs`：`.spchat__panel` 可见、fixed、230×220、视口内 | 通过 |
| 667×375 | `render-check-hud.mjs`：ChatBox 2 行、`.gspeed.is-fast`、1× 点击回调、词条弹层 2 行、均未越界 | 通过 |

外部资源（`ganxiemingdan.jiangjiangze.icu` 感谢名单、`fonts.gstatic.com` 字体）失败只作为「external」提示，
不计入应用错误；`devtools/render-check*.mjs` 已按来源区分。

### 5.4 回归

```
npm run golden → roster 49 / bonds 46 / fields 22 / matches 21 / standins 10 / diy 140 全部 match
node devtools/check-live-graph.mjs → 174 files，唯一 1 条是 runner.js 注释里的示例（既有误报）
node tools/i18n.mjs check en <本轮 7 个客户端文件> --strict → 121/121，0 missing
```

已知与本轮无关的既有失败（仍存在）：

- `test/assets.test.js`：`every Spine model loads…` 卡在本地提取的 `enemy_1305_mhslim` atlas（缺 size/pma）。
- `test/skins.test.js`：`Match.setSkins` 一条（合并遗留）。
- `test/version-assets.test.js`：2 条依赖 Python 的 FX 提取用例（`spawnSync` 返回 9009 = 本机无 Python）。
- `test/ui/chat-box-css.test.js`：`.gm__bonds` 居中一条。

---

## 6. 2026-10-25 追加：聊天显示、mod/脚本控制台、过场定位

### 7.1 聊天框

- 局内 `ChatBox`：标题栏（同盟通讯 + 未读数）、弹幕开关移到标题栏、半收起；每条消息拆成「座位 / 名字 / 时间 / 正文」，
  面板加半透明底与轻模糊，宽度从 2.5rem 提到 `min(4.6rem, 46vw)`，短屏隐藏时间列保留名字与正文；未读角标同时出现在
  标题与触发按钮上。
- 房间 `roomChat`：面板 320×300（手机 360×300 底部抽屉），手机/矮屏默认收起成右下角圆点，点开再显示；
  标题、气泡、输入行与未读角标统一成通讯面板样式。
- 验证：`test/ui/chat-box-css.test.js` 5/6（既有 `.gm__bonds` 一条）；`devtools/render-check-chat.mjs`
  667×375 / 1280×720 均通过；`render-check-hud.mjs` 检查标题、两行消息、倍速与词条弹层均未越界。

### 7.2 mod / 脚本控制台（手机端）

- 对局内真正的 mod 入口是房间的「插件」面板（`room.setPlugins` → 脚本 / 内容模组）：`components.css` 新增手机/矮屏规则，
  列表限高可滚动、每行 ≥44px、开关 44×44，标签可换行不挤爆顶栏。
- 插件工作台的「测试控制台」`/studio/console.html`：`console.css` 新增手机规则（单列、画布 44vh、输入/按钮 38–44px、
  安全区内边距、顶栏换行）。
- 验证：`test/lobby-plugins.test.js` 24/24、`test/mods-align.test.js` 7/7、`test/ui/plugins-client.test.js` 18/18、
  `test/ui/plugins-content.test.js` 17/17；新增 `devtools/render-check-mobile-ui.mjs`，667×375 与 932×430 下
  插件行 44px、开关 44×44、列表可滚动、控制台单列且无横向溢出。

### 7.3 过场动画定位

- 发现并修复一个真 bug：`bossPhaseWarn.js` 的 markup 用 `bpwarn__*`，而 `bossPhaseWarn.css` 全部写的是 `warn__*`，
  导致双 Boss 预警**整块没有样式**（不居中、没有横板）。已统一为 `warn__*`。
- 新增 `devtools/render-check-transitions.mjs`：在真浏览器里量回合板、阶段板、阶段横幅、结果框、「轮到你选」、
  双 Boss 预警、词条抉择的矩形；判定中心偏差 ≤6% / 8% 且不越界。
- 结果：667×375 与 1280×720 均 8/8 通过（词条卡片、回合板、预警、TurnPopup 等全部居中且在视口内）。

### 6.4 真实链路复检（同一轮）

| 检查 | 脚本 | 结果 |
|---|---|---|
| 房间聊天 + 弹幕（真实服务器） | `devtools/render-check-chat-live.mjs` | 667×375：1 条气泡文字正确、弹幕层同步、面板 360×300 在视口内、0 错误 |
| 局内聊天 + 弹幕（真实单人局 INFO_CHECK → BAND_DRAFT → BATTLE_CHECK） | `devtools/render-check-chat-match.mjs` | 667×375：面板 168×82；1280×720：307×76；均有气泡与弹幕、0 错误 |
| 手机端把脚本 mod 装进房间 | `devtools/render-check-plugin-load.mjs` | 667×375 与 932×430：`release-script` 开关可点，随后 `room.content.vanilla=false`、`plugins=['release-script']`、`execution='sandbox'`，0 错误 |
| 插件面板 / 脚本控制台布局 | `devtools/render-check-mobile-ui.mjs` | 667×375 与 932×430：插件行 44px、开关 44×44、列表可滚动；控制台单列、无横向溢出 |

> 说明：`release-script` 是仓库内的示例脚本插件；测试前它的 lock 过期，`node tools/plugin.mjs pack release-script`
> 重打后沙箱模式加载成功（`SP_PLUGIN_SCRIPTS=sandbox`）。这一步只验证「房间选中插件 → content 生效」的链路，
> 不代表生产环境默认允许脚本。

---

## 7. 残余与待办

- 首期 64 名干员已修复；`coverage --files` 四版本 0 missing。
- 2 张皮肤全幅立绘、1 张干员全幅立绘、56 个皮肤语音文件上游不存在（404）；客户端按既有规则回落（半身像 / 干员原语音）。
- 全幅立绘体积大（约 1.7 GB 磁盘）；`tools/fetch-illusts.mjs --ops-only|--skins-only|--max=N` 可分批，
  失败重跑幂等。
- `fetch-assets` 现在会保留 manifest 里「文件仍在磁盘」的 `skins` / `illust` / 技能音效池 / 语音槽位
  （`report.preservedBundled` / `preservedSfxPools` / `preservedVoice`）；但 `stats.skins` / `stats.illusts`
  由注入器写入，重跑 `fetch-assets` 后要再跑一次 `node tools/inject-skins-assets.mjs`。
- `node --test` 在本机沙箱下会 `spawn EPERM`；本轮以 `node <file>.test.js` 单文件运行，CI 不受影响。

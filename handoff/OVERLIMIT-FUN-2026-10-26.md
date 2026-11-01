# 超限模拟娱乐化 ①②③ · 可行性研讨与演示页

**日期**：2026-10-26  
**范围**：里程碑 + 超限档案、词条重抽/跳过/锁定、Boss 词缀 + 风险契约  
**演示页**：`public/dev/overlimit-preview.html`（可交互，`/dev/overlimit-preview.html`）

---

## 0. 一句话结论

①②可以低风险先做；③的「狂暴 / 召唤」有现成机制，可先上；「护盾 / 反伤」需要新增 Boss 受击钩子，放二阶段。
「最高单刀」需要 sim 统计，也放二阶段。演示页已用真实主题变量与游戏字体做出四页可交互原型。

---

## 1. 现有基础（研讨依据）

| 能力 | 现状 | 位置 |
|---|---|---|
| 无限轮次 | R16+ 普通轮、每 5 轮 Boss、R45+ 双 Boss 两阶段 | `server/match/infiniteWaves.js`、`bossRounds.js` |
| 词条抉择 | `trait = { round, polarity, cards, idx, order, picks }`；正负交替；卡 = 怪 + 词条 | `server/match/match/traitDraft.js`、`traits.js` |
| 词条池 | 正面 13 / 负面 14；特化 reid / mdrock / xi | `traits.js` |
| Boss 波 | `buildInfiniteBossWave` 返回 `primaryBoss / secondaryBoss / isDouble / bossPhase / spawns / scale` | `infiniteWaves.js:294` |
| 结算 | `buildResult` 输出 `roundsPassed / victory / reason / players[].trophies/reward`，**无超限专属字段** | `server/match/results.js:90` |
| 种子 | `Match opts.seed`；`lobby` 用 `seedFn()` 生成；无房间级 seed 选项 | `server/match/Match.js:299`、`server/lobby.js:2041` |
| 样式 | 超限紫 `--inf-300/400/500/600`、发光 `--inf-glow` | `public/css/theme.css:39` |
| 原型页 | `public/dev/trait-preview.html`、`hud-preview.html`、`double-boss-preview.html` | `public/dev/` |

---

## 2. 逐项可行性

### 2.1 里程碑 + 超限档案（可行，低风险）

- 只在 `m.isInfinite` 时给 `m.result` 追加：
  ```js
  overlimit: {
    maxRound, bossKills: [{ round, name }],
    traitMods: [{ round, name, polarity, text }],
    maxLayers: { bondId: layers }, bestBond: { id, layers }
  }
  ```
- `bossKills` 在 Boss 血池归零处记录；`maxLayers` 在每回合结束取 `ps.layers` 最大值。
- 客户端 `screens/settle.js` 加「超限档案」卡；`ui/stats.js` 记本机最佳（localStorage）。
- **不做最高单刀**：sim 没有最大单次伤害统计，加它要动 `Battle` 统计/快照，可能影响 golden 与回放。

### 2.2 词条重抽 / 跳过 / 锁定（可行，低风险）

- 状态扩展：`trait.rerollsLeft = 1`、`trait.skips = 0`、`trait.locked = card | null`。
- 重抽：`rngMeta` 重新抽 3 张（排除已选词条），次数 -1；确定性。
- 跳过：本次不产生 `traitSpawn`，`traitSkips++`，下一轮开始资金 +1。
- 锁定：保存一张卡；本次从剩余两张中选；下次 `drawTraitCards(..., { locked })` 必带该卡。
- 协议：`g.traitReroll {}`、`g.traitSkip {}`、`g.traitLock { idx }`；`views.js` 暴露 `rerollsLeft/skips/locked`。
- 客户端 `ui/traitOverlay.js` 加按钮与状态；`test/match/trait-draft.test.js` 加状态机用例。

### 2.3 Boss 词缀（第一版 2 个，可行；护盾/反伤二阶段）

- 狂暴：Boss 半血时攻速 +50%、攻击 +20%（纯数值钩子，低风险）。
- 召唤：每 20 秒召唤 1 只随从；必须 `tag:'part'` / `countInTotal:false`，避免漏怪计数与重模拟。
- 抽取：`drawBossAffix(rngMeta)`；`wave.affix`；`m.public.bossAffix`；HUD/`bossPhaseWarn` 显示。
- **护盾**需要 `addBuff(shield/shieldHits)` 的 per-boss 实施；**反伤**需要 Boss 受击钩子；两者都放二阶段。
- 测试：`test/match/boss-affix.test.js`（确定性、阈值、召唤不计漏怪）。

### 2.4 风险契约（可行，成本中高）

- 状态 `m.contract = { id }`，只在 `isInfinite` 且下一轮是 Boss 轮时可选。
- 阶段复用 PREP 弹层（不新增 PHASE），协议 `g.contract { id }`。
- 契约：`extraElite`（+1 精英，奖励词条 +1）、`timeLimit`（90 秒，资金 +2）、`enemyAspd`（敌方攻速 +20%，重抽 +1）。
- `buildInfiniteBossWave` 读 `m.contract` 应用；客户端 `ui/contractOverlay.js` 三选一。
- 测试：`test/match/contract.test.js`（普通模式拒绝、超限生效、奖励只发一次）。

### 2.5 演示页（已完成）

- `public/dev/overlimit-preview.html` + `overlimit-preview.js`（外链，CSP 允许；内联脚本会被 `script-src 'self'` 拦）。
- 复用 `theme.css` / `components.css` / `fonts.css` 与 `--inf-*`；斜切角、细线框、等宽数字、紫/绿双强调。
- 四页：档案（R30/R45/R60 切换、Boss 击杀、词条、最高层、最佳柱状图）、词条（三卡、锁定、重抽、跳过、已选条）、Boss 词缀（4 个，护盾/反伤标二阶段）、契约（三选一 + 摘要）。
- 自检：`devtools/render-check-overlimit-preview.mjs`，1280×720 与 667×375 均 0 错误、无横向溢出、交互通过。

---

## 3. 里程碑

| 阶段 | 内容 | 状态 |
|---|---|---|
| M0 | 本研讨文档 | 完成 |
| M1 | 演示页 + 自检 | 完成 |
| M2 | 超限档案（result 字段 + 结算卡 + 本地最佳） | 待做 |
| M3 | 词条重抽/跳过/锁定（协议 + 状态机 + UI） | 待做 |
| M4 | Boss 词缀：狂暴 + 召唤 | 待做 |
| M5 | 风险契约（PREP 弹层 + Boss 波应用） | 待做 |
| M6 | 全量验证（golden 不变、普通模式字节不变、渲染） | 待做 |

---

## 4. 边界与风险

- 全部 gate 在 `solo_infinite` / `m.isInfinite` / `battle.flags.overlimit`；普通模式 result 与 golden 不变。
- 随机全部 `createRng(deriveSeed(seed, ...))`；不用 `Math.random`。
- 召唤词缀必须 `tag:'part'` / `countInTotal:false`，并测漏怪计数。
- 契约动 PREP/Boss 波，必须只对超限生效；每步可单独回退。
- 不做：最高单刀、护盾/反伤词缀（二阶段）、每日种子/本地榜（④）、付费/广告/随机刷层。

---

## 5. 演示页查看

```bash
cd E:/Workbox/系统
npm start                 # 3000 被占则 PORT=3001
# 浏览器打开
# http://127.0.0.1:3000/dev/overlimit-preview.html
```

截图：`handoff/shots/olo-{file,trait,affix,contract}-{1280x720,667x375}.png`（本机 `.session-dump/shots/`）。

---

## 6. 2026-10-26 第二轮：M5 收尾 + 手机适配 + 超限同盟 + 倍速倒计时 + 盟约条

### 6.1 M5 风险契约（完成）

- 协议 `g.contract { id }`；`bossRounds.offerBossContract()`（Boss 轮 PREP 挂三选一）与 `chooseContract()`；
  `views` 输出 `contractOffer / contract`；`enterTraitDraft` 支持 `traitBonusReroll`。
- 客户端 `ui/contractOverlay.js` + `css/screens/contractOverlay.css`，`game.js` 在 PREP 挂载；四语言 i18n。
- 测试 `test/match/contract.test.js` 8/8：普通模式拒绝、非 Boss 轮无 offer、elite/time/aspd/none 效果与奖励。

### 6.2 局内聊天层级（修复）

- 之前 `.chat-panel` 是 `fixed z-index:110`，而表情面板 `.ewheel__panel` 没有 z-index、挂在 `.gm__corner` 里，
  于是聊天盖住表情、点不到。
- `.gm .chat-panel` 改为 `z-index:2`（高于战场、低于整个 `.gm__hud`），表情/设置始终在它之上。
- `devtools/render-check-chat-match.mjs` 增加「打开表情 → 点中表情 → 面板关闭」断言；667×375 通过。

### 6.3 WebView 84 兼容

- 新增 `public/css/compat84.css`（在 `theme.css` 之后、`components.css` 之前）：
  `@supports not (inset: 0)` 给全屏层/弹层展开 `top/right/bottom/left`；`@supports not (aspect-ratio: 1/1)` 给方形棋子/卡面 `min-height`。
- JS 侧已有 `ui/compat.js` 在 `main.js` 首行 polyfill `Object.hasOwn / .at / structuredClone`；新增
  `test/ui/webview84-compat.test.js` 4/4 钉住顺序与回退。
- 说明：84 上以「可玩」为目标，不保证像素级一致；`aspect-ratio` 的方形元素做了兜底。

### 6.4 六种比例 UI 复检

`devtools/render-check-aspects.mjs`，一次跑 7 个视口：

| 视口 | 结果 |
|---|---|
| 20:9 800×360 | OK（无溢出、聊天/表情/HUD 均在视口内、表情可点） |
| 19.5:9 844×390 | OK |
| 21:9 840×360 | OK |
| 16:9 1280×720 | OK |
| 4:3 1024×768 | OK |
| 竖屏 360×780 | OK（显示「请横屏」提示，不溢出） |
| 667×375 横屏 | OK |

截图：`handoff/shots/aspect-*.png`。

### 6.5 超限 · 同盟（coop_infinite）

- `shared/infiniteMode.js` 新增 `COOP_INFINITE`，`isInfiniteMode` 认两种；`isSoloRoomMode` 仍只认 solo 两种。
- `protocol.room.create` 允许 `coop_infinite`；`lobby.offered` 把 `coop_infinite` 归一为 `coop` 难度表。
- 大厅新增「超限模拟 · 同盟」入口（4 座、可加 AI、终极难度）。
- 人数数值：Boss 血池 `1 + 0.6×(n-1)`（2/3/4 人 1.6/2.2/2.8×）；普通波次数量 `1 + 0.15×(n-1)`。
- `m.result.overlimit.partySize` 记录人数。
- 测试 `test/match/coop-infinite.test.js` 4/4；`devtools/render-check-coop-infinite.mjs` 验证建房(4 座)/加 AI/开局 `isInfinite`。

### 6.6 二倍速随切随变 + 倒计时

- `combat.js`：`deadline = limit / gameSpeed`（原来超限固定按 1×，导致 2× 提前打完、倒计时不动）；
  记录 `_combatLimit / _combatStartAt`。
- `bossRounds.js`：Boss 轮 `clockDiv = gameSpeed`，记录 `_overtimeGapGt`。
- `_reclockForSpeed(old, next)`：按已推进游戏秒重算 `deadline` 与 `overtimeAt`；`setCombatSpeed` 在战斗中调用。
- 测试 `test/match/combat-speed.test.js` 5/5（1×→2× 减半、2×→1× 恢复、剩余 0 立即结算、Boss 加时、instant 场不变）。

### 6.7 盟约条居中 + 收起

- `.gm__bonds` 从左上（left 1.56 / right 5.2）改为**顶部 HUD 下方水平居中**（`left:50% + translateX(-50%)`），
  按钮移到列表右侧，图标改为 `chevronDown / chevronUp`，收起时列表 `hidden`、只留按钮。
- `fieldHost` 不再把盟约条底部当作棋盘可点区下界（它已回到顶部）。
- `devtools/render-check-bonds.mjs`：667×375 与 1280×720 均通过（中心偏差 0px、收起/展开、不压队伍/商店）。

### 6.8 验证汇总

- 超限相关单测：档案 5 + 词条 8 + 词条 2.0 7 + 词缀 5 + 契约 8 + 倍速 5 + 同盟 4 + 无限房 2 = 44 例全过。
- `npm run golden`：49/46/22/21/10/140 场景全部一致（exit 0）。
- 六尺寸 + 聊天/表情 + 盟约条 + 同盟建房全部通过。
- 已知既有缺口：`node tools/i18n.mjs check --all --strict` 仍有 106 条其它模块的历史缺失（本次新增字符串均已 100%）。

---

## 7. 2026-10-26 第三轮：i18n 清零 + 四版本超限验证（发现关键 bug）

### 7.1 i18n 全量清零

- 补齐 106 个历史缺失 msgid，四语言各 106 条（en/ja/ko/zh-TW），覆盖 `achievements`、`modManagerModal`、
  `serverRedirectModal`、`announcement`、`matchFlow`、`hubSections`、`matchPlates`、`title`、`lobby` 等 16 个文件。
- `个` 只作量词后缀、英文无对应词：`modManagerModal` 改为「已启用 + 数字」，删掉该 msgid（四语言同步删除）。
- 结果：`node tools/i18n.mjs check --all --strict` → **四个语言各 2510/2510，0 missing，0 errors**。
- 仍存在的另一个既有测试：`test/i18n.test.js` 的「no Chinese literal left unwrapped」会列出 `resources/*`、
  `battle/damageStats` 等未用 `t()` 包裹的中文——那是另一类工程债（不是缺失翻译），本轮未动。

### 7.2 四个版本下的超限（发现并修复一处关键 bug）

**现象**：`Match` 的组合列表（`Match.js` 末尾的 `for (const part of [...])`）**漏了 `MatchTraitDraft`**，
于是 `enterTraitDraft` / `pickTrait` / `rejectTraitLock` 等方法在真实对局里根本不存在。R20 Boss 打完后，
`bossRounds` 的回调 `this.enterTraitDraft(...)` 抛 `TypeError: this.enterTraitDraft is not a function`，
被 `guard` 捕获，阶段永远停在 `FINAL_ASSAULT` —— 也就是「R20 打完就卡住，永远看不到词条抉择」。

- 为什么之前没发现：`trait-draft.test.js` 直接调用 `MatchTraitDraft.prototype`，绕过了 `Match` 的组合；
  浏览器检查也只到 R1–R15。
- 修复：`Match.js` 导入 `MatchTraitDraft` 并加进组合列表（`MatchBoss` 之后），并留注释。
- 复测：R20 打完 → `TRAIT_DRAFT` → 选词条 → R21 `PREP`，`errors = 0`。

**四版本结果**（`test/match/infinite-versions.test.js`，每个版本用自己的 `data/versions/<id>` 数据）：

| 版本 | 单人终极难度 | 结果 |
|---|---|---|
| act2autochess（第二期下半，默认） | ABYSS | OK：R20 Boss → 词条抉择 → R21 |
| act2autochess@V2_1（第二期上半） | 无，fallback HARD | OK |
| act1autochess（第一期下半） | 无，fallback HARD | OK |
| act1autochess@V1_1（第一期上半） | 无，fallback HARD | OK |

> 第一期与第二期上半的数据里没有 `mode_single_abyss`，`fallbackDifficulty` 会降到 HARD，这是数据事实；
> 超限仍按该版本自己的 `enemyScale` 与 Boss 池运行，曲线基准比默认版本软，但流程完整。

- `devtools/render-check-infinite-versions.mjs`：四个版本都能建房（`room.create`）并开局，`isInfinite=true`、
  `modeId=mode_single_*`、0 错误。
- 回归：`trait-draft 8/8`、`trait-enhance 7/7`、`contract 8/8`、`infinite-curve 2/2`、`infinite-room 2/2`；
  `npm run golden` 全部一致（49/46/22/21/10/140，exit 0）。

---

## 8. 「请选择策略」过场位置错误（类名冲突）

**现象**：进入 `BAND_DRAFT` 时，横幅贴在屏幕底部、只露出下半截，并盖住策略卡。

**根因**：两个组件都用 `.tbanner` 这套类，但样式来源不同、互相渗透：

| 组件 | 样式文件 | 定位写法 |
|---|---|---|
| `ui/matchIntro.js` 的 `TurnBanner`（已无引用） | `css/screens/draft.css` | `position: relative` + 容器 `place-items:center` |
| `ui/turnBanner.js` 的 `TurnBanner`（`bandDraft.js` 实际使用） | `css/screens/protocol-boot.css` | `position:absolute` + `top: calc(50% - 110*--px)` |

`draft.css` 在 `protocol-boot.css` 之后加载，把 `turnBanner` 的 `.tbanner__band` 改成了 `position:relative`，
却没覆盖 `protocol-boot.css` 里的 `top: calc(50% - 110 * var(--px))` —— 相对定位下这条 `top` 把横幅从
居中位置又往下推了约 250px，于是贴底。

**修复**：两套样式彻底隔离，不再共用同一组选择器。

- `matchIntro.js` 根加 `tbanner--intro`，`draft.css` 的规则改为 `.tbanner--intro` / `.tbanner--intro .tbanner__x`；
- `turnBanner.js` 根加 `tbanner--turn`，`protocol-boot.css` 的规则改为 `.tbanner--turn` / `.tbanner--turn .tbanner__x`
  （选择器列表里的第二、三段也逐段加了前缀，避免 `.a, .b` 泄漏）；
- `--px / --teal / --ink` 仍定义在 `.tbanner--turn` 上，尺寸继续按 1920×1080 设计稿缩放。

**验证**：新增 `devtools/render-check-draft-intro.mjs`，进入 solo 局的 `BAND_DRAFT`，量 `.tbanner__band`：

| 视口 | 结果 |
|---|---|
| 1280×720 | cy 360 / 中心 360 ✅ |
| 667×375 | cy 187 / 中心 187.5 ✅ |
| 800×360（20:9） | cy 180 / 中心 180 ✅ |
| 1024×768（4:3） | cy 384 / 中心 384 ✅ |

横幅高度随视口缩放（147 / 76 / 73px），不再压住策略卡；`render-check-transitions` 1280/667 仍 8/8 通过。

---

## 9. 机型渲染适配（荣耀 / 小米天玑 / WebGL 拒绝）

### 9.1 为什么没有照搬 `Downloads/main.js` 的补丁

那份补丁直接改写 `WebGLRenderingContext.prototype.bindTexture/texImage2D`，并在荣耀/小米 Mali 上让
`getContext('webgl2')` 返回 `null`。本作渲染器（PixiJS）与官方特效（`render/vfx/gl.js`）**都是 WebGL2**，
`vfx/system.js` 里 `renderer.context?.webGLVersion !== 2` 直接判不支持——照搬会整屏黑，而不是变流畅。
另外 `bindTexture(target, null)` 是引擎的**解绑**语义，替换成 1×1 纹理必然导致纹理泄漏 / 采样错乱。

所以改成「能力探测 → 降档参数」：不拒绝上下文，只降分辨率、关 MSAA、限帧；真的拿不到 WebGL2 才回退 2D。

### 9.2 实现

- 新增 `public/js/ui/deviceTuning.js`（纯函数，可单测）：
  `detectDeviceTuning({ ua, gpu, webgl2, chrome })` → `{ family, quality, maxPixelRatio, antialias, frameCap, force2d, reasons }`；
  `probeGpu()` 一次性读 `WEBGL_debug_renderer_info`；`resolveTuning(t, 'auto'|'smooth'|'hd')` 处理用户覆盖。
- 规则：
  | 机型 | 判定 | 结果 |
  |---|---|---|
  | 荣耀 / 华为 | Chrome<110 或 GPU=Mali | 低画质、1×、关 MSAA、30 帧 |
  | 荣耀 / 华为 | 新内核 + 非 Mali | 保持高画质 |
  | 小米 / 红米 | 天玑或 GPU=Mali | 中画质、1.25×、关 MSAA、45 帧 |
  | 小米 / 红米 | GPU 读不到（WebView 屏蔽） | 中画质、1.5×、45 帧（保守） |
  | 小米 / 红米 | 骁龙（Adreno） | 高画质 |
  | 任意 | WebGL2 被标 caveat | 再压一档（只压不升） |
  | 任意 | 真的没有 WebGL2 | `force2d`，走 2D 棋盘 |
- `render/app.js`：`dpr()`/`boardDpr()` 叠加 `tuning.maxPixelRatio`；Pixi 与 3D 的 `antialias` 受 `tuning.antialias` 控制；
  `tuning.force2d` 时 `want3d=false`；`frameCap<60` 时设置 `app.ticker.maxFPS`。
- 荣耀「渲染前置」：荣耀系或限帧设备给 canvas 加 `transform: translateZ(0)` + `will-change: transform`，强制 GPU 合成层，
  避免 WebView 首帧白屏 / 撕裂。
- 设置新增「机型兼容」：自动 / 流畅 / 高清（`compatMode`，默认 `auto`，持久化在 `sp.pref.settings`）。

### 9.3 验证

- `test/ui/device-tuning.test.js` 9/9：荣耀旧/新、小米天玑/未知 GPU/骁龙、caveat、force2d、用户覆盖、设置清洗。
- `devtools/render-check-device-tuning.mjs`：6 组 UA + 模拟 GPU 全部命中预期档位；设置行渲染三个按钮，点「流畅」后
  `sp.pref.settings.compatMode === 'smooth'`，0 页面错误。
- i18n 四语言仍 2514/2514。

### 9.4 说明 / 待真机

- 判断依据是 UA + GPU 名；部分 WebView 屏蔽 renderer，此时小米系走保守中档、荣耀系按 UA 判。
- 帧率上限依赖 Pixi `ticker.maxFPS`；若老版本 Pixi 没有该字段会静默跳过（已 try/catch）。
- 真机（荣耀 MagicOS、Redmi 天玑）需各跑一局确认：首帧不白屏、连续 10 分钟不降亮度 / 不崩。



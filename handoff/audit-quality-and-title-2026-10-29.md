# 只读审计：设置「画面质量」加两档 + 首页感谢名单/版本号归位（2026-10-29）

审计人：子代理 title-footer。范围：只读调查，**未改动任何代码/测试/数据**（除了本文件）。仓库 E:\Workbox\系统，分支 align/0.3.0。

一句话结论：
1. 「画面质量」目前只有 低 / 中 / 高 三档，实际控制的是 **PIXI 渲染分辨率上限、3D 棋盘分辨率上限、创建期的 MSAA、3D 阴影开关、粒子预算、眼睑裁剪、impostor 贴图分辨率**；真正的瓶颈是 `dpr = min(devicePixelRatio, QUALITY_RES[q], tuning.maxPixelRatio)` 这一行——**只往表里加两档不会有任何画质变化**，必须同时放开「机型兼容」的 cap 和（可选）引入超采样；`host.js` 里甚至已经躺着半个 `extreme` 档（表里有键、UI 与校验里没有）。
2. 首页版本号现在在**底栏第二行**的右侧（不在右下角），因为上一轮把感谢名单挪成了独立的最底一行；感谢名单在手机上还是**居中**的（起点不在左下）。把 meta 整块并回最底一行即可做到「感谢名单左下 + 版本号右下」，同时底栏从 3 行回到 2 行（顺带解决上一轮多出来的高度）。

---

## 一、设置 →「画面质量」：现状

### 1.1 档位枚举与整条链路

| 环节 | 落点（文件:行） | 现状 |
| --- | --- | --- |
| 展示表 | `public/js/ui/settings.js:120` | `QUALITY = [['low', N_('低')], ['medium', N_('中')], ['high', N_('高')]]`，注释写明「显示顺序 低/中/高，存储值 high/medium/low」 |
| 选择器 UI | `public/js/ui/settings.js:520-526` | `.set-seg` + `role="radio"`，点一下 `updateSettings({ quality: id })`；该行**没有 set-hint**（机型兼容行才有，见 `:534`） |
| 默认值 | `public/js/ui/gameLogic/settings.js:45` | `DEFAULT_SETTINGS.quality = 'high'`（默认档 = 高） |
| 校验白名单 | `public/js/ui/gameLogic/settings.js:46,87` | `const QUALITIES = ['high','medium','low']`；`sanitizeSettings` 里 `QUALITIES.includes(r.quality) ? r.quality : DEFAULT_SETTINGS.quality` → **不在表里的值一律回落 high** |
| 类型声明 | `public/js/ui/gameLogic/settings.js:66` | JSDoc `quality: 'high'\|'medium'\|'low'` |
| 写路径 | `public/js/ui/settings.js:87-89` → `:73-74` | `updateSettings(patch)` → `settingsStore.set(sanitizeSettings({...}))`；订阅里 `savePref('settings', sanitizeSettings(s))` |
| 读路径（启动） | `public/js/ui/settingsStore.js:7` | `createStore(sanitizeSettings(loadPref('settings', null)))` |
| 传给渲染 | `public/js/ui/fieldHost.js:235` → `:323` | 建视图时 `settings: settingsStore.get()`；之后 `settingsStore.subscribe((s) => viewRef.current?.setSettings?.(s))` |
| 渲染读取 | `public/js/render/app.js:222, 255, 256, 274, 517, 2005, 2011, 2307-2309` | 见 1.2 |
| 分辨率表 | `public/js/render/app/host.js:86, 89, 92-93, 123` | `QUALITY_RES = { extreme: 3.5, high: 3, medium: 2, low: 1 }`、`BOARD_RES = { extreme: 3.0, high: 2.75, medium: 2, low: 1 }`、`MOBILE_QUALITY_RES`/`MOBILE_BOARD_RES = { extreme: 2.5, high: 1.75, … }` |
| 诊断 | `public/js/diag.js:328` | 只把 `quality ${settings.quality}` 打进诊断文本 |

### 1.2 每一档实际控制什么

| 参数 | 落点 | 低 | 中 | 高 | 说明 |
| --- | --- | --- | --- | --- | --- |
| PIXI 渲染分辨率 | `render/app.js:255` `dpr()` | 1 | 2 | 3 | `min(devicePixelRatio, QUALITY_RES[q], tuning.maxPixelRatio)`，运行中经 `resize()` 的 `app.renderer.resolution = res`（`:2125`）生效，不用重建上下文 |
| 3D 棋盘分辨率 | `render/app.js:256` `boardDpr()` → `board3d.resize(..., boardDpr())`（`:2127`） | 1 | 2 | 2.75 | 同上 `min(devicePixelRatio, BOARD_RES[q], tuning.maxPixelRatio)` |
| PIXI MSAA | `render/app.js:274` | 关 | 关 | 仅当 `devicePixelRatio < 1.5 && tuning.antialias` | **创建期**参数，运行中改不了 |
| 3D 板 MSAA | `render/app.js:517` | 关 | 开（`quality !== 'low' && dpr<2 && tuning.antialias`） | 同中 | 创建期 |
| 3D 阴影 | `render/app.js:517` `shadows:` + `board3d/scene.js:728-736 setQuality` | 关 | 开 | 开 | 运行中可切（`shadowMap.enabled` + `key.castShadow`） |
| 眼睑裁剪（stencil） | `render/app.js:2005 pickClipping` | 关 | 关 | **只有 'high'** 且场上 ≤1 个带裁剪骨骼 | 加档不改这里，新档会「更高质量却更差」 |
| impostor 刷新间隔 | `render/app.js:2011 pickImpostorInterval` | 12 | 26 | 44（else 分支，等于「高及以上」都用 44） | |
| 粒子上限 | `render/fx/limits.js:5` `MAX_PARTICLES` | 360 | 800 | 1400 | `particles.js:18` `MAX_PARTICLES[q] \|\| MAX_PARTICLES.high` → 新键天然可加 |
| 低档特效简化 | `fx/arrivals.js:62,75`、`fx/beams.js:84`、`fx/numbers.js:112`、`fx/simfx.js:114,123,136,173,229,241`、`fx/zones.js:201`、`render/units.js:894` | 只区分 low | — | — | 新档自动等同于「非 low」 |
| impostor 贴图分辨率 | `render/impostor.js:44` | — | — | `this.res = Math.max(1, Math.min(2, renderer.resolution))` | **上限硬编码 2**：超清/极致下人群精灵仍是 2×，不会跟着变锐 |
| 3D 阴影图尺寸 | `render/board3d/scene.js:45`（`size: 2048`）、`:233`（移动端 1024） | — | — | 固定 | 构造期定，切档改不了 |

### 1.3 关键发现（这些是「加两档」能不能真正提高画质的根因）

- **F1 分辨率被双重封顶，加表无效。** `app.js:255-256` 是 `min(devicePixelRatio, QUALITY_RES[q], tuning.maxPixelRatio)`。桌面 DPR=2 时 `high` 的 3 已经被 `devicePixelRatio` 封在 2；`tuning.maxPixelRatio` 在「其它」家族是 2（`ui/deviceTuning.js:62`）、小米天玑 1.25（`:77`）、小米 GPU 未知 1.5（`:81`）、荣耀旧内核 1（`:69`）。所以 **能真正提高分辨率的是 `tuning.maxPixelRatio`，不是 `QUALITY_RES`**——除非新档引入「超采样系数」（`devicePixelRatio × SS`），而当前公式里 `devicePixelRatio` 永远在 min 里，**任何档都不可能超过设备 DPR**。
- **F2 `extreme` 是半截实现。** `host.js:86,89,92-93` 四张表里都有 `extreme`（3.5 / 3.0 / 2.5 / 2.5），但 `settings.js:120` 没有它、`gameLogic/settings.js:46` 不认它、`app.js:2307` 白名单也不认它。等于「极致」的地基放了一半，谁都没接完。
- **F3 `setSettings` 三档硬编码会静默丢值。** `app.js:2307` `if (s.quality === 'high' || s.quality === 'medium' || s.quality === 'low') settings.quality = s.quality;`——UI 点了新档，`sanitizeSettings` 放行、持久化也存了，但渲染层直接忽略，表现为「点了没反应」。这是加档最容易漏的一处。
- **F4 `pickClipping` 只认 `'high'`**（`app.js:2005`）。加档后 `ultra`/`extreme` 会丢掉眼睑 stencil 裁剪（`spine.js _eyeMaskFallback` 的替代路径），出现「档位更高、观感反而不如高」的错位。
- **F5 `tuning.quality` 是死字段。** `ui/deviceTuning.js:42-98` 算出来的 `quality`（honor→low、xiaomi→medium、apple/other→high）**没有任何渲染代码读它**（`app.js` 只读 `tuning.force2d / maxPixelRatio / antialias / frameCap`，见 `:238,255,256,274,292,517,2108`）。所以设置里「机型兼容」那句「流畅 = 强制最低档；高清 = 强制最高档」（`settings.js:534`）实际只作用于分辨率 cap、MSAA、限帧，画质档位本身不受它影响。加档前必须先定两者的优先级。
- **F6 没有纹理分辨率开关。** 全仓没有 `textureScale`、`BaseTexture` 的 `maxWidth/maxHeight`、`PIXI.settings.RESOLUTION`、spine 贴图缩放之类的旋钮；素材是服务端预烤的一套 webp（`data/assets.json` 只有单一尺寸）。**「超清/极致」能提升的是渲染目标分辨率、MSAA、阴影、粒子密度，不可能把贴图本身变清晰**，这点要在 UI 文案里说清（否则玩家会期待「贴图更细」）。
- **F7 2D 回退不读 quality。** `ui/fallbackField.js:518` 只是 `st.settings = {...st.settings, ...s}`，2D 画布不看画质档。弱机回退后两档无差别，属可接受，但要写进文档。
- **F8 缺少 GPU 上限保护。** 一旦允许分辨率超过设备 DPR（超采样），backing store = `CSS 尺寸 × res`：1920×1080 在 res=4 时是 7680×4320（约 33 MP，RGBA ≈ 132 MB/画布，还要再加 3D 板画布）。旧移动 GPU 的 `MAX_RENDERBUFFER_SIZE` 常见 4096，超了会创建失败/黑屏。现在之所以安全，全靠 `devicePixelRatio` 在 min 里封着——**改公式时必须同时按 `gl.MAX_RENDERBUFFER_SIZE` 夹一次**。
- **F9 MSAA 与阴影图尺寸是「创建期」参数。** `app.js:274` 的 antialias 只在 `new P.Application` 时定；`board3d/scene.js:233` 的 `key.shadow.mapSize` 也是创建期。运行中能改的只有 `renderer.resolution`（`:2125`）和阴影开关（`setQuality`）。所以「超清开 MSAA」只对**下一局/重建视图**生效——如果业主期望「切档立刻变锐」，那就得把质量增益放在分辨率（SS）上，MSAA 只当附赠。

---

## 二、画面质量：建议改法

### 2.1 档位设计（默认不变）

- 枚举：`low / medium / high / ultra / extreme`，标签 `低 / 中 / 高 / 超清 / 极致`。
- **默认仍是 `high`**（`DEFAULT_SETTINGS.quality` 不动），旧存档 `high|medium|low` 全部继续有效 → **无需数据迁移**；未知值仍回落 `high`（`gameLogic/settings.js:87` 已有行为）。
- id 复用：`extreme` 沿用 `host.js` 已有的键（减少半截实现），`ultra` 新增一档夹在 `high` 与 `extreme` 之间。

### 2.2 参数建议（第一版可落地值）

| 参数 | low | medium | **high（默认）** | ultra 超清 | extreme 极致 |
| --- | --- | --- | --- | --- | --- |
| `QUALITY_RES`（`host.js:86`） | 1 | 2 | **3** | 3.5 | 4.5 |
| `BOARD_RES`（`host.js:89`） | 1 | 2 | **2.75** | 3.0 | 3.5 |
| 设备 cap 乘子 `TIER_CAP_MUL` | 1 | 1 | **1** | 1.5 | 2 |
| 超采样系数 `TIER_SS` | 1 | 1 | **1** | 1.25 | 1.5 |
| PIXI 渲染分辨率公式（`app.js:255`） | 同今天 | 同今天 | 同今天 | 加 `SS ×1.25`、`cap ×1.5` | 加 `SS ×1.5`、`cap ×2` |
| PIXI MSAA（`:274`） | 关 | 关 | 现有规则 | 开（`dpr < 2.5` 时） | 开 |
| 3D MSAA / 阴影（`:517`） | 关/关 | 开/开 | 开/开 | 开/开（PCFSoft） | 开/开（PCFSoft，阴影图 2048→4096 需重建） |
| 粒子上限（`fx/limits.js:5`） | 360 | 800 | 1400 | 1800 | 2400 |
| 眼睑裁剪（`:2005`） | 关 | 关 | 开（≤1 个） | 开（≤1 个） | 开（≤2 个） |
| impostor 贴图上限（`impostor.js:44`） | 1 | 2 | 2 | 2.5 | 3 |

完整公式（`app.js:255-256` 两行同改，`GPU_LIMIT` 见上）：

```
res = min((devicePixelRatio || 1) * (TIER_SS[q] || 1), QUALITY_RES[q] || 2,
          tuning.maxPixelRatio * (TIER_CAP_MUL[q] || 1), GPU_LIMIT)
```

三个低档 `TIER_SS = TIER_CAP_MUL = 1`，且 `GPU_LIMIT` 今天恒大于设备 DPR，所以**现有三档逐位等价**（等于今天的 `min(devicePixelRatio, QUALITY_RES, tuning.maxPixelRatio)`），不会改变老用户看到的画面。

`GPU_LIMIT = floor(MAX_RENDERBUFFER_SIZE / max(画布宽, 画布高))`，取不到（无 gl / 假 PIXI）时按 3 处理。

### 2.3 改动清单（文件 : 函数 / 行）

1. `public/js/ui/gameLogic/settings.js:46` `QUALITIES` → `['high','medium','low','ultra','extreme']`；`:66` JSDoc 联合类型；`:45` 默认值**不动**。
2. `public/js/ui/settings.js:120` `QUALITY` 数组加 `['ultra', N_('超清')]`、`['extreme', N_('极致')]`（显示顺序 低/中/高/超清/极致）；`:520-526` 的渲染循环不用改。可选一行 `set-hint` 说明「超清/极致 更吃显存与电量」（会再加 1 条 msgid，需业主同意）。
3. `public/i18n/{en,ja,ko,zh-TW}.json`：新增 msgid `超清`、`极致`（四包都要；en 的历史 253 条缺口另算，这两条必须译）。
4. `public/js/render/app/host.js:86-93`：四张表补/改值，并新增导出 `TIER_CAP_MUL`、`TIER_SS`（或放 `app.js` 顶部常量，二选一）。
5. `public/js/render/app.js`
   - `:255-256` `dpr()` / `boardDpr()` 换公式（含 GPU 上限夹）；`resize()`（`:2125`）自动受益。
   - `:274`、`:517` antialias 条件加入新档（注意这是创建期参数）。
   - `:2005` `pickClipping` → `['high','ultra','extreme'].includes(settings.quality)`（并按档放宽 n）。
   - `:2307` `setSettings` 白名单 → 用一个 `QUALITY_IDS` 集合判断（**否则新档点了不生效**）。
   - `:222` 默认 settings 字面量**别动**（`test/ui/ammo-count.test.js:59` 逐字匹配这一行）。
6. `public/js/render/fx/limits.js:5` `MAX_PARTICLES` 加两档（`particles.js:18` 的 `|| high` 会自动兜底）。
7. `public/js/render/impostor.js:44`：`Math.min(2, …)` → 按档取上限（需要把 quality 传进 Impostor 或读一个模块级常量）。
8. `public/js/render/board3d/scene.js:233`（阴影图尺寸按档）+ `:728-736 setQuality`（新档的 PCFSoft）；`R.shadowMap.type` 运行时可改，但改完要 `needsUpdate`。
9. 文档（本仓规矩「文档跟代码」）：`docs/design/client.md:295` 那句 `settings (volume, quality, show damage numbers, …)` 扩成五档并写清「不改变贴图精度」；`docs/history/0.3.x.md` 记一条。
10. 不需要改：`ui/deviceTuning.js`（cap 乘子放在渲染层）、`ui/fallbackField.js`（2D 回退不看档位）、`diag.js`（只是字符串）。

### 2.4 测试点（现状先跑过一遍，见 2.6 的基线）

| 测试 | 现在的样子 | 加档后要做什么 |
| --- | --- | --- |
| `test/ui/gameLogic.test.js:745-746` | **现在就是红的**：期望对象里没有 `compatMode`（机型兼容加进来时没同步），且用 `quality: 'ultra'` 当"非法值"探针 → 我们加 `ultra` 正好把它变成合法值 | 把探针改成 `'nope'`，补上 `compatMode: 'auto'`，并加两档正面用例（照 `:774` 的写法） |
| `test/ui/settings-update.test.js` | **现在 3 条全红**（`el.style.removeProperty is not a function`，来自 `screenFit.js:75`；以及 `fetch('/api/app/version'` 正则已不匹配） | 先修这两处环境/滞后红，再让它守住「5 个按钮的模板能渲染」——否则新档写坏模板没人拦 |
| `test/ui/device-tuning.test.js` | 9/9 绿 | 不受影响（cap 乘子在 app.js） |
| `test/ui/ammo-count.test.js:59` | 4/4 绿，逐字匹配 `app.js:222` | **不要动 `app.js:222`** |
| `test/render/browser.test.js:389, 648-664` | 绿（需浏览器） | 可选加一条：切 ultra 后 `canvas.width` 应大于 high 的 |
| `test/render/fakepixi.js`（约 50 个 render 测试共用） | 假 PIXI **没有 `gl`、`Application` 也没有完整 `renderer.resolution`** | 新代码读 `renderer.gl` 必须可选链 + try/catch，否则一大批 render 测试会红 |
| i18n 门禁 | ja/ko/zh-TW 100%、en 缺 253 | `node tools/i18n.mjs check --all --strict` 跑一次，确认只多这 2 条 |

### 2.5 风险

- **显存/发热按 res² 增长**：超采样 1.5 在 DPR 2 桌面上就是 3× 填充、约 2.25× 显存；「极致」在 4K 屏上可能直接 OOM 或掉到 20 fps。
- **旧 GPU 黑屏**：不做 GPU 上限夹，7680 宽的 renderbuffer 会创建失败（F8）。
- **MSAA 在 DPR≥2 上基本是浪费**（像素已经很密），真正让人"觉得更锐"的是超采样——建议把预算放 SS，而不是把 MSAA 开到所有档。
- **优先级冲突**：机型兼容（`smooth` 强制 cap 1 / `hd` 强制 cap 2）与画面质量的乘子叠加后语义要写清，否则「荣耀旧内核用户选极致」会出现不可预期的表现。
- **阴影图 4096 在移动端很贵**（`board3d` 的 `autoUpdate=false` 只在几何变化时重烘，勉强可接受，但仍要留一档开关）。
- **动态切档的"半生效"**：MSAA、阴影图尺寸是创建期参数（F9），切档后只有分辨率立刻变——需要产品口径接受，或者切档时重建 view（代价是一次加载）。

### 2.6 验收（可跑的清单）

```bash
cd E:\Workbox\系统
node test/ui/gameLogic.test.js        # 目前 58 tests / 57 pass / 1 fail；修完后应 58/58
node test/ui/settings-update.test.js  # 目前 3 tests / 0 pass / 3 fail（既有环境红）；修完后应 3/3
node test/ui/device-tuning.test.js    # 9/9
node test/ui/ammo-count.test.js       # 4/4
node tools/i18n.mjs check --all --strict
```

浏览器侧（`SP_E2E=1`，本机沙箱 spawn 会被拒，需在有 Chrome 的环境跑）：
- DPR=2 桌面：`high → ultra` 后 `view.debug.app.renderer.resolution` 应从 2 变成 2.5（或 `canvas.width / clientWidth` 同比例），`extreme` 到 3，且不超过 GPU 上限；
- 模拟小米天玑 UA：`ultra` 应停在 `1.25 × 1.5 ≈ 1.87`，`extreme` 停在 2.5——证明 cap 乘子生效且仍受保护；
- 切到 `ultra` 后眼睑裁剪仍在（`pickClipping` 已验证），粒子数上升（`maxParticles` 可直接断言）。

> 另：`test/ui/gameLogic.test.js:745` 那条是**既有红**（期望对象缺 `compatMode`），不是本线引入的；加档前先修，否则它会掩盖我们改坏的形状。

---

## 三、首页感谢名单 / 版本号：现状

### 3.1 现在的结构（上一轮改动之后）

`public/js/screens/title.js:293-313`，底栏三行：

| 行 | 行号 | 内容 |
| --- | --- | --- |
| `--legal` | `294-300` | 恢复对局 / PWA 安装 / `本服务器安装了 {n} 个插件`（`data-testid="title-plugins"`）/ 版权 |
| `--meta` | `301-310` | `<span class="title-foot__meta">`：`项目仓库`（`:303`）→ `title-egg`（`:304-307`，内含 `${MicroLabel}>v${APP_VERSION} · WEB SIMULATION<//>`）→ 开发版标签（`:308`，可选） |
| `--thanks` | `311-313` | `<${ThanksMarquee} />` 独占最后一行 |

样式：

| 规则 | 行号 | 现状 |
| --- | --- | --- |
| 底栏盒 | `public/css/screens/title.css:292-303` | `position:absolute; left/right:.44rem; bottom:.3rem; flex-direction:column; gap:.12rem; font-size:calc(.13*var(--t))` |
| meta 右对齐 | `title.css:320` | `.title-foot__meta { display:flex; align-items:flex-end; flex-wrap:wrap; justify-content:flex-end }` |
| 感谢名单行（桌面） | `title.css:462-464` | `--thanks { justify-content: flex-start }`；`.title-thanks { flex:1 1 12rem; min-width:0; max-width:46% }` |
| 感谢名单行（手机） | `title.css:469-473` | `@media (max-width:520px), (max-height:520px)`：`.title-foot{gap:.08rem}`、`--thanks{justify-content:center}`、`.title-thanks{width:72vw; max-width:72vw; margin-top:0}` |
| 滚动 | `title.css:423` | `animation: thanks-scroll 48s linear infinite`；`@keyframes`（`:429-431`）是 `translateX(0) → translateX(-50%)` |
| 减动效 | `title.css:476-478` | `@media (prefers-reduced-motion: reduce)` → track / dot 的 `animation: none` |

### 3.2 与业主口径的三处偏差

1. **版本号不在右下**：它在第二行（`--meta`）的右侧，下面还压着一整行感谢名单。业主说的「放回右下」指的就是最底行的右端。
2. **感谢名单起点不在左下**：桌面上它是左对齐，但位于 meta 行**之上**；手机上是 `justify-content: center`（`title.css:471`）——**居中**，所以视觉起点不在左下角。
3. **长度**：桌面 46%、手机 72vw。实测基线（上一轮真机量到 612px @ 1388 宽 = 行内宽的 44%~46%）与按 `theme.css:140` 的 root 公式算的值吻合，可以作为「下调前」的对照。

---

## 四、首页底栏：建议布局

### 4.1 方案 A（推荐：底栏回到 2 行）

`public/js/screens/title.js:293-313` 改成：

```js
<footer class="title-foot">
  <div class="title-foot__row title-foot__row--legal">…（原 294-300 不动）…</div>
  <div class="title-foot__row title-foot__row--thanks">
    <${ThanksMarquee} />
    <span class="title-foot__meta">
      <a class="title-repo" href="https://github.com/sganggs/Stronghold-Protocol" target="_blank" rel="noopener noreferrer">${t('项目仓库')}</a>
      ${DEV_BUILD ? html`<span class="title-dev" role="note">${t('开发版 · 不稳定，请勿用于公开服务器')}</span>` : null}
      <span class="title-egg" role="button" tabIndex=0 title="" onClick=${eggClick} onKeyDown=${…}>
        <${MicroLabel}>v${APP_VERSION} · WEB SIMULATION<//>
      </span>
    </span>
  </div>
</footer>
```

要点：删掉 `--meta` 这一行，把 `.title-foot__meta` 整块搬进 `--thanks` 行；**版本放到 meta 的最后一项**（dev 标签挪到版本之前），这样版本号就贴在最右下角。

`public/css/screens/title.css`：

```css
/* 460-464 一带，替换原来的 --thanks 行规则 */
.title-foot__row--thanks { justify-content: space-between; align-items: flex-end; flex-wrap: nowrap; gap: .2rem; }
.title-foot__row--thanks .title-thanks { flex: 1 1 auto; min-width: 0; max-width: min(22rem, 32%); margin-top: 0; }
.title-foot__row--thanks .title-foot__meta { flex: none; }

/* 469-473，手机块：不再居中，长度从 72vw 降到 46vw */
@media (max-width: 520px), (max-height: 520px) {
  .title-foot { gap: .08rem; }
  .title-foot__row--thanks { justify-content: space-between; }
  .title-foot__row--thanks .title-thanks { width: auto; max-width: 46vw; }
}
```

`48s` 与 `prefers-reduced-motion` 两块（`:418-431`、`:476-478`）保持不动；`--meta` 行的注释（`title.css:311-313`）随行一起删掉。

### 4.2 具体数值（按 `theme.css:140` 的 root 公式算，底栏内宽 = vw − 2 × 0.44rem）

| 视口 | rem | 行内宽 | 现在（桌面 46% / 手机 72vw） | 建议（桌面 32% / 手机 46vw） |
| --- | --- | --- | --- | --- |
| 1280×900 | 66.7 | 1221 | 562px（46%） | **391px（32%）** |
| 1388×800 | 72.3 | 1324 | 609px（≈ 实测 612px） | **424px** |
| 1920×1080 | 100 | 1832 | 843px | **586px** |
| 1024×768 | 53.3 | 977 | 449px | **313px** |
| 844×390（横屏手机） | 40 | 809 | 608px（= 行内宽 75%） | **388px（48%）** |
| 780×360 | 40 | 745 | 562px（75%） | **359px（48%）** |
| 667×375 | 40 | 632 | 480px（76%） | **307px（49%）** |

即：桌面上感谢名单短约 30%，手机上短约 36%；两者都仍是「能看见 2–3 个名字在滚」的长度（名单 10 条 + 1 条 dedication，`data/thanks.json` 共 118 字）。

### 4.3 「起始点放左下」怎么算做到

- `@keyframes thanks-scroll` 从 `translateX(0)` 开始，**文字本来就贴 viewport 的左缘**；所以只要 (a) 整行改成 `space-between` 且感谢名单是行首元素、(b) 手机块去掉 `justify-content: center`，起点就落在左下角。
- 可选再进一步：`mask-image` 现在左右各 3% 渐隐（`title.css:415-416`），第一个名字会略淡；要「看起来从角上开始」，可把左端改成 `linear-gradient(90deg, #000 0, #000 97%, transparent)`。改遮罩要重新看滚动回环（`track` 的两个 `group` 拼接处会出现一次"硬接"），建议单独一次改动、单独验收。
- 若业主的意思是「整块贴在屏幕左下角」而不是「行首左对齐」，把 `.title-foot` 的左边界从 `.44rem`（`title.css:295`）在手机块里收到 `.24rem` 即可，但这会改变底栏与其它元素的横向对齐，需一起看。

### 4.4 方案 B（保守，保留 3 行）

只把 `title-egg`（版本）搬进 `--thanks` 行的右端，`--meta` 行只剩 `项目仓库` + 开发版标签。

- 优点：改动最小，`.title-foot__meta` 的既有样式全部不动。
- 缺点：中间行只剩一个链接，看起来像空行；底栏仍是 3 行，手机上比 2 行方案高约 1.5em（rem=40 时 ≈ 20px），正是上一轮"底栏长高顶向 `.title-conn`"的风险来源。**不推荐**。

---

## 五、底栏改动的选择器与断言影响

### 5.1 要改的选择器（title.css）

| 选择器 | 动作 |
| --- | --- |
| `.title-foot__row--meta`（`:311-313`） | 删除（行不存在了），注释一起删 |
| `.title-foot__row--thanks`（`:463, 471`） | 桌面 `flex-start` → `space-between`；手机删掉 `center` |
| `.title-foot__row--thanks .title-thanks`（`:464, 472`） | 桌面 `max-width: 46%` → `min(22rem, 32%)`；手机 `72vw` → `46vw`（并去掉 `width: 72vw`） |
| `.title-foot__meta`（`:320`） | 不动（仍然 `justify-content: flex-end`），但多了 `.title-foot__row--thanks .title-foot__meta { flex: none }` |
| 新增 | `.title-foot__row--thanks { flex-wrap: nowrap }`（防止版本被折到下一行） |

### 5.2 必须保持的既有断言（别碰这些行）

| 断言 | 位置 | 内容 |
| --- | --- | --- |
| 版本号字面量 | `test/version.test.js:47` | `/v\$\{APP_VERSION\}/` 在 `title.js` 里 |
| 开发版标签 | `test/version.test.js:92` | `/DEV_BUILD \? html`<span class="title-dev"/` |
| 无 PROTOCOL v1 | `test/version.test.js:48` | — |
| 项目仓库链接 | `test/ui/official-damage-numbers.test.js:54-60` | `class="title-repo"`、`href`、`target="_blank"`、`rel`、`t('项目仓库')` |
| 插件按钮 | `test/ui/plugins.e2e.test.js:66-67` | `[data-testid="title-plugins"]` 与文案 `本服务器安装了 2 个插件` |
| 标题页存在性/设置框 | `test/client-static.test.js:153, 1034-1038` | — |

**没有任何测试引用 `.title-foot__row--*` / `.title-thanks` / `.title-foot__meta`**（全仓 grep：0 命中；只有 `test/ui/lobby-hub.test.js:592` 与 `test/ui/seat-art.test.js:212` 两处注释提到「title.css 的高度」）。所以这次结构调整**不需要改任何断言**——这既是好消息，也正是上一轮「感谢名单压住插件按钮」能溜进去的根因：**底栏结构完全没有测试覆盖**。

### 5.3 建议新增的守卫（可选，不在这次改动内）

一个 `test/ui/title-footer.test.js`（纯静态，照 `test/ui/ban-picker.test.js` 的写法）断言：
1. `title.js` 的 footer 里 `--legal` 在 `--thanks` 之前，且不再有 `--meta` 行；
2. `--thanks` 行同时包含 `<${ThanksMarquee} />` 与 `class="title-egg"`（版本在最底行）；
3. `title.css` 里 `.title-thanks` 的 `max-width` 不含 `72vw`（防止"长回来"），且 `thanks-scroll` 的时长 ≥ 44s；
4. `prefers-reduced-motion` 块存在。

### 5.4 验证命令

```bash
cd E:\Workbox\系统
node test/ui/ui-size.test.js                 # 11/11；全局 CSS 地板守卫（新规则只用 %/vw/rem，不引入 px 地板 → 安全）
node test/ui/lobby-hub.test.js               # 28/28；与 title 无关，纯回归
node test/version.test.js                    # 版本号 / 开发版标签
node test/ui/official-damage-numbers.test.js # title-repo 链接
```

浏览器侧（`SP_E2E=1`）：`test/ui/asset-download.browser.test.js:102-108` 会读 `.title-foot` 每个子元素的 top 并和素材提示行比较——行数从 3 回到 2 只会更宽松，不会破坏；`test/ui/plugins.e2e.test.js` 的插件按钮不受影响。

### 5.5 风险

- **窄屏横向挤压**：`flex-wrap: nowrap` + 版本号 + `项目仓库` 在一行。按 4.2 的表算，667px 宽（行内 632）时 thanks 307 + meta ≈ 150~170 仍有余量；但「文字大小 = 特大」时 `.title-foot` 的 `font-size: calc(.13 * var(--t))` 会涨到 ~11.4px/字，meta 会明显变宽，**必须在特大档复测**；真挤的话让 `.title-foot__meta` 自己 wrap（恢复 `flex-wrap: wrap` + `justify-content: flex-end`），版本仍贴右。
- **版本号触摸目标**：`title-egg` 是可点彩蛋（5 次进 `/arg/`），高度只有 `0.13rem`，手机上偏小。这是既有行为，本次不动；要改善就给它 padding + 24px 地板（照 `devices.css` 的 `tapx` 惯例），属于另一个改动。
- **「感谢名单」标签占宽**：行首那个绿框标签（`title.css:377-395`）会吃掉约 0.3–0.4 的行宽；若业主还要"更短"，下一步可以把标签缩成只有圆点（保留 `aria-label`），但那会少一个可见入口，需要业主点头。
- **遮罩改动**（4.3 的可选项）会让滚动回环出现一次硬接，需单独验收。

---

## 六、需要业主拍板的点

1. 超清/极致的确切力度：我给的 `SS 1.25/1.5 + cap 乘子 1.5/2 + 粒子 1800/2400 + 阴影 2048/4096` 是"明显能看出来"的一版；若只想「肉眼更锐、别太贵」，可以先只上 `SS` 与手机 cap 乘子，阴影与粒子第二版再说。
2. 是否允许新增 msgid：`超清`、`极致` 两条是必需的（四包都要）；再加一行说明（「更吃显存与电量」）就是 3–4 条。
3. 「机型兼容」与「画面质量」的优先级：建议低/中档继续受机型 cap 限制，超清/极致按用户显式选择放大 cap（本报告按这个写）。
4. 感谢名单「长度下调」是否只指可视宽度（本方案按宽度做）；如果指的是"名单条目更少"，那要改 `ThanksMarquee` 的 `list`（`title.js:333-373`，名单来自远端 API / `data/thanks.json`），会隐藏贡献者，**不建议**。
5. 切换画质是否必须「立刻生效」：MSAA 与阴影图尺寸是创建期参数（F9），分辨率是实时的；若要求全量即时，需要在切档时重建渲染视图。

---

## 附：本次审计用到的基线（2026-10-29 实测，直跑，未用 `node --test`）

```
node test/ui/gameLogic.test.js        -> tests 58 | pass 57 | fail 1   （既有红：期望对象缺 compatMode）
node test/ui/settings-update.test.js  -> tests 3  | pass 0  | fail 3   （既有红：El 缺 style.removeProperty；/api/app/version 正则滞后）
node test/ui/device-tuning.test.js    -> tests 9  | pass 9  | fail 0
node test/ui/ammo-count.test.js       -> tests 4  | pass 4  | fail 0
node test/ui/ui-size.test.js          -> tests 11 | pass 11 | fail 0
node test/ui/lobby-hub.test.js        -> tests 28 | pass 28 | fail 0
```

（`test/client-static.test.js` 的 363 条 parse 红是沙箱 `spawnSync` 被拒的环境红，与本报告无关。）

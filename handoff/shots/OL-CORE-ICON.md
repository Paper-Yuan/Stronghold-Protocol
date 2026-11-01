# 万色悠滞之核 · 独立装备图标（research → build-data → 实机验证）

日期：2026-10-31 ｜ 仓库：`E:\Workbox\系统` ｜ **无任何 git 写操作**（未 commit / checkout / stash；`data/**`、`public/data/**` 全部是构建产物）

## 一句话结论

`chess_item_ol_01_e_a`「万色悠滞之核」不再复用变形同构体那张图：`docs/research/25-overlimit-items.json` 给它加了显式
`iconId: "trap_ol_core"`（`trapId` 仍是 `trap_1073_acarm073`），图标 `public/assets/item/trap_ol_core.png` 是
**从 `trap_1073_acarm073.png` 派生**的（色相 → 品红/紫 + 饱和 ×1.35 + mint 描边 + 右上 SP 圆牌，128×160），
`tools/build-data.mjs` 的 `trapId == iconId` 放宽成「允许显式 `iconId` 覆盖」，并在**真服务端 + puppeteer** 的超限模拟整备期
手牌里同框验证：两张图标同时出现、肉眼可区分。

## 1. 图标

| 项 | 值 |
| --- | --- |
| iconId | `trap_ol_core`（`data/items.json` 里该记录唯一，未与任何官方 item / icon 撞名：`trap_ol_core` 之前 0 命中） |
| 文件 | `public/assets/item/trap_ol_core.png`（`public/assets/` 已 gitignore） |
| 尺寸 | 128×160 RGBA，20,611 B —— 与既有 `public/assets/item/*.png` 同口径（**高 160、保比例**；74 张既有图标全是 160 高，宽 75–238） |
| sha256 | `ebe223db0772846ad939f0341dc84055d9a32f32f1387bff71325e5795d77dfe` |
| 基底文件 | `public/assets/item/trap_1073_acarm073.png`（96×160，mint 水晶 + 黑描边，17,176 B，sha256 `4b5179e3c57cb0ba2583588da3fc3828e4e036a491b8f2e889ecf2ac97bf83e2`） |
| 不凭空画美术 | 轮廓、明暗、alpha 全部来自基底；没有新画一笔 |

### 变换参数（Pillow 12.3.0 + numpy 2.3.5，精确到可复现）

1. **色相/饱和/明度**（在 HSV 上做，alpha 原样保留）：
   `h' = (0.855 + (h − 0.5) × 1.7) mod 1`、`s' = clip(s × 1.35)`、`v' = clip(v × 1.02)`
   （基底 hue ≈ 0.50 的 mint/teal → 亮部品红、暗部蓝紫，仍是「万色」的连续过渡，不是单色平涂）
2. **缩放到画布口径**：等比缩到高 142（= 160 − 上下各 9 px 余量），居中放进 128×160 透明画布（LANCZOS）
3. **mint 描边环**：alpha 掩膜 `α > 40` → `MaxFilter(9)`（膨胀 4 px）→ 与掩膜做差 → `GaussianBlur(0.6)`，用
   `#6EFFD2 (110,255,210)` 以 alpha 合成（不盖住原轮廓内侧，只贴外缘）
4. **右上 SP 圆牌**：圆心 (108,21)、半径 18；填充 `#240C36`（alpha 232）+ mint 3 px 外圈 + Arial Bold 17 px 的 `SP`（`#BEFFEB`）
   —— 对应发放它的词条族 **FGO-SP**（『快楽天・胎蔵曼荼羅』）
5. 输出 RGBA PNG（Pillow `Image.save`，无量化）

派生脚本（临时，任务结束已删；参数与上面一致，可照此复现）：

```python
import numpy as np
from PIL import Image, ImageFilter, ImageChops, ImageDraw, ImageFont
src = Image.open('public/assets/item/trap_1073_acarm073.png').convert('RGBA')
hsv = np.array(src.convert('HSV'), dtype=np.float32)
h, s, v = hsv[:, :, 0] / 255.0, hsv[:, :, 1], hsv[:, :, 2]
h2 = (0.855 + (h - 0.5) * 1.7) % 1.0
rgb = Image.fromarray(np.stack([h2 * 255, np.clip(s * 1.35, 0, 255), np.clip(v * 1.02, 0, 255)], 2)
                      .clip(0, 255).astype('uint8'), 'HSV').convert('RGB')
rgb.putalpha(src.getchannel('A'))
inner = rgb.resize((round(rgb.width * 142 / rgb.height), 142), Image.LANCZOS)
canvas = Image.new('RGBA', (128, 160), (0, 0, 0, 0))
canvas.alpha_composite(inner, ((128 - inner.width) // 2, 9))
a = canvas.getchannel('A')
solid = a.point(lambda x: 255 if x > 40 else 0)
ring = ImageChops.subtract(solid.filter(ImageFilter.MaxFilter(9)), solid).filter(ImageFilter.GaussianBlur(0.6))
layer = Image.new('RGBA', canvas.size, (110, 255, 210, 0)); layer.putalpha(ring)
canvas.alpha_composite(layer)
d = ImageDraw.Draw(canvas)
d.ellipse([90, 3, 126, 39], fill=(36, 12, 54, 232), outline=(110, 255, 210, 255), width=3)
d.text((108, 22), 'SP', font=ImageFont.truetype('C:/Windows/Fonts/arialbd.ttf', 17), fill=(190, 255, 235, 255), anchor='mm')
canvas.save('public/assets/item/trap_ol_core.png')
```

**为什么这样能「一眼区分」**：手牌里图标只有约 48 px 高（实机截图实测），细节会糊掉，能活下来的只有两个信号 ——
① 颜色反转（mint/teal → 品红/紫）；② 外缘 mint 环 + 右上深紫圆牌。轮廓本身不变，所以不会误认成另一件装备。

### `[ASSUMED] derived icon`

> `[ASSUMED] derived icon`：业主表（`docs/research/23-overlimit-relics.json` 的 FGO-SP 条目）只写了「装备贴图从变形同构体改」，
> 本仓没有那张官方改色图。因此本图标是 **以 `public/assets/item/trap_1073_acarm073.png`（变形同构体）为唯一基底** 的派生：
> 色相旋到品红/紫（`h' = 0.855 + (h − 0.5) × 1.7`）、饱和 ×1.35、明度 ×1.02、mint `#6EFFD2` 轮廓环（alpha 膨胀 4 px）、
> 右上 SP 圆牌；等比缩到 160 高放进 128×160 透明画布。**没有新画美术**，也不改任何官方素材。

这段说明同时写进了数据源文件（`docs/research/25-overlimit-items.json` 的 `note` 与 `implFormula` 字段），
不是只写在报告里。

## 2. 数据链（research → build-data，绝不手改 `data/*.json`）

`docs/research/25-overlimit-items.json` 改动（生成 `data/items.json` / `data/effects.json` 的唯一源头）：

```diff
-        "iconId": "trap_1073_acarm073",
+        "iconId": "trap_ol_core",
```

`note` 的「贴图」那一条整体重写（复用 → 派生，写明基底文件、变换方式、`[ASSUMED] derived icon`、
`trapId` 与 `iconId` 的关系、以及为什么放宽校验），`implFormula` 末尾的 `[ASSUMED] icon: reuses …` 改成
`[ASSUMED] derived icon: … trap_ol_core … derived from … trap_1073_acarm073.png …`（英文，供 review / 工具读）。

`trapId` **没有改**：仍是 `trap_1073_acarm073`。两者的语义是分开的 —— `trapId` 是这条记录与「变形同构体」那条
同源记录的键（`server/studio/targets.js`、`server/studio/authoring.js`、`server/plugins/forgeImport.js` 这类工具按它反查；
**运行时 `server/match/**` 与 `server/sim/**` 完全不读 trapId**，本件 `buffs` 为空，数值由词条 FGO-SP 给），
`iconId` 只决定客户端去 assets manifest 查哪张图（`public/js/assets.js:151 itemIconUrl`：`items[iconId] || items[trapId]`）。

manifest 登记（`data/assets.json` 由 fetch-assets 生成，派生图必须走 add-only 的工具补进去，否则客户端回退成文字）：

```
node tools/patch-assets-local.mjs --write --slots items
slots: items | 会新增: items+1
wrote E:\Workbox\系统\data\assets.json (2788408 B)
[sync-static-web] Sync complete: public/ is now fully self-contained!
```

结果：`data/assets.json` 与 `public/data/assets.json` 都是 `items.trap_ol_core = "/assets/item/trap_ol_core.png"`，
`stats.items` 74 → 75（工具自己重算，`test/data.test.js` 的清单自洽断言不受影响）。

生成后的记录（`data/items.json`）：

```json
{ "name": "万色悠滞之核", "trapId": "trap_1073_acarm073", "iconId": "trap_ol_core", "tier": 6, "shopExcluded": true }
```

## 3. 生成期校验：`trapId == iconId` 放宽为「允许显式 iconId 覆盖」

### 改前（`tools/build-data.mjs`，applyOverlimitItems 内）

```js
    if (typeof rec.trapId !== 'string' || !rec.trapId || rec.iconId !== rec.trapId) {
      throw new Error(`overlimit item ${itemId}: trapId / iconId must be the same non-empty string (the assets manifest is keyed by it)`);
    }
```

### 改后

```js
    // 贴图键：`iconId` 缺省 = `trapId`（既有的「同一张图」口径）；research 可以显式覆盖成另一张图。两条语义是分开的：
    // trapId 是这条记录与变形同构体那条「同源记录」的键（工具 / 工作台按它反查；运行时 match / sim 不读它），
    // iconId 只决定 assets manifest 查哪张图 —— 所以不要求同名，但覆盖值必须是
    // **文件名形状**的非空字符串（它是 manifest 的键，又直接拼进 /assets/item/<iconId>.png，带路径分隔符就会逃出图标目录）。
    // 这里**不校验文件是否存在**：public/assets/ 是 gitignore 的（AGENTS.md），干净 checkout / CI 上派生图本来就不在，
    // 构建不该因此红；落盘后由 tools/patch-assets-local.mjs --slots items 登记进 manifest。
    const iconId = rec.iconId == null ? rec.trapId : rec.iconId;
    if (typeof rec.trapId !== 'string' || !rec.trapId) {
      throw new Error(`overlimit item ${itemId}: trapId must be a non-empty string`);
    }
    if (!OVERLIMIT_ICON_ID_RE.test(iconId)) {
      throw new Error(`overlimit item ${itemId}: iconId ${JSON.stringify(iconId)} must be a plain file name (letters, digits, dot, underscore, dash)`);
    }
    rec.iconId = iconId;
```

新增一条常量（函数上方）：

```js
const OVERLIMIT_ICON_ID_RE = /^[A-Za-z0-9_.-]+$/;
```

JSDoc 里那一条也从「必须同名」改成「缺省同名、可显式覆盖」，说明为什么不做存在性校验（`public/assets/` 不进 git）。

**关键点**：这不是「靠改文件名对齐」——`trapId` 原样保留，`iconId` 是 research 里显式写出的另一个值，生成期校验放宽的正是
「允许两者不同」这件事，同时把覆盖值收回「只能是一个文件名」的形状（它既是 manifest 的键，也会拼进
`/assets/item/<iconId>.png`，带 `/`、`..` 就会被拒）。

### 连带更新的两条断言（旧契约就是 `iconId === trapId`，不改就红）

`test/data.test.js`（items 的逐条不变量）：

```diff
-    // 炸惊 items are not trap-based (a 惊变 reward item has no trap id): asserted for official items only
-    if (!isZjOnly(it)) assert.ok(typeof it.trapId === 'string' && it.iconId === it.trapId);
+    // 炸惊 items are not trap-based (a 惊变 reward item has no trap id): asserted for official items only.
+    // `iconId` normally equals `trapId`; the one deliberate exception is the overlimit reward above, whose research
+    // record overrides the **asset key** while `trapId` stays 变形同构体's (docs/research/25-overlimit-items.json).
+    // An override must be a plain file name (it is a manifest key) and must be registered in data/assets.json.
+    if (!isZjOnly(it)) {
+      assert.ok(typeof it.trapId === 'string' && it.trapId, `${it.id}: trapId`);
+      assert.ok(typeof it.iconId === 'string' && /^[A-Za-z0-9_.-]+$/.test(it.iconId), `${it.id}: iconId`);
+      if (it.iconId !== it.trapId) {
+        const manifest = iconManifest();
+        if (manifest) assert.ok(manifest.items?.[it.iconId], `${it.id}: iconId ${it.iconId} is not in data/assets.json`);
+      }
+    }
```

（配一个懒加载的 `iconManifest()`：`DATA_DIR` 指向 `--out` 构建产物时那份目录只有 data 文件、没有 `assets.json`，此时跳过清单断言。）

`test/content/overlimit_relics_effects.test.js`（FGO-SP ⑤ 数据断言）：

```diff
-  // [ASSUMED] 贴图复用变形同构体（词条表只写「从变形同构体改」，本仓没有那张改色图）
-  assert.equal(rec.iconId, 'trap_1073_acarm073');
+  // [ASSUMED] derived icon：以变形同构体那张为基底派生 trap_ol_core（research 25 的显式 iconId 覆盖）；
+  // trapId 仍指变形同构体那条同源记录（工具按它反查，运行时 match/sim 不读），两者故意不同名
+  assert.equal(rec.trapId, 'trap_1073_acarm073');
+  assert.equal(rec.iconId, 'trap_ol_core');
```

## 4. 交付图

| 文件 | 尺寸 | 内容 |
| --- | --- | --- |
| `handoff/shots/ol-core-icon-before-after.png` | 984×1086 | 并排对比：左 = 现在复用的变形同构体（96×160 原图 ×3 放大），右 = 新派生图（128×160 ×3，**同一缩放**）；Pillow 画的标签/说明，底部另有「手牌实际大小（48 px）」一行 |
| `handoff/shots/ol-core-icon-ingame-1920x1080.png` | 1920×1080 | 实机：超限模拟（`solo_infinite`）R1 整备期，手牌里 **变形同构体 + 万色悠滞之核 同框**（画面下方长凳上左 mint、右品红+SP） |
| `handoff/shots/ol-core-icon-ingame-792x360.png` | 792×360 | **同一局、同一帧的 DOM**，只把视口改成 792×360（没有重载、没有重开），两张仍在手牌上 |
| `handoff/shots/ol-core-icon-hand-zoom.png` | 1125×647 | 附加证据：把 1920 图里手牌那一段放大 5×（带标注），肉眼核对两张图标确实不同 |

SHA-256：

| 文件 | sha256 |
| --- | --- |
| `ol-core-icon-before-after.png` | `16dad0cb496b99f52cdb9986abfcce5f4261fc59399990f8e50c0738630cbc09` |
| `ol-core-icon-ingame-1920x1080.png` | `c84f3906de8e060e36a37cf7991424e7cc45278b675d967af2aedebba9c583d2` |
| `ol-core-icon-ingame-792x360.png` | `058110f90874ea2f73d60a8083171a62d8380e6911de3a8c3801df84df82830e` |
| `ol-core-icon-hand-zoom.png` | `fb5184b9e93c1ca11ae8a45c91a6f95361a93d8afa2a95ff04ef059c0c4a53e7` |
| `public/assets/item/trap_ol_core.png` | `ebe223db0772846ad939f0341dc84055d9a32f32f1387bff71325e5795d77dfe` |
| `public/assets/item/trap_1073_acarm073.png`（基底，未改） | `4b5179e3c57cb0ba2583588da3fc3828e4e036a491b8f2e889ecf2ac97bf83e2` |

### 实机是怎么拍的（真服务端，端口 3171）

- 服务端：`PORT=3171 HOST=127.0.0.1 SP_START_ROUND=1 SP_START_ITEMS=chess_item_6_09_e_a,chess_item_ol_01_e_a SP_START_KIT=2 node test/e2e/fastServer.mjs`
  —— 它就是 `server/index.js` 的 `startServer`（真服务端、真对局引擎、真 socket），只多了 `test/e2e/fastServer.mjs` 里既有的
  **测试专用 starter-kit 钩子**（`SP_START_ITEMS` 把指定 item 放进手牌；同一钩子被 `test/ui/leftovers.e2e.test.js` 用来测装备替换弹窗）。
  端口 3171 在 3160–3180 区间，没碰 3000。
- 浏览器：puppeteer-core + 本机 Chrome（headless），**真鼠标点击**：标题页输入代号 → 大厅「独立模拟」→ 协议卡
  `.diff-card[data-special="infinite"]`（超限模拟）→ 开始独立模拟 → 开始模拟 → 简报「准备就绪」→ 盟约草稿点一张 + 确认 → R1 整备期。
  房里实测 `mode = "solo_infinite"`（客户端 store 读的，不是脚本自报）。
- 帧上实测（同一次运行写出 `tmp/ol-core-shot-result.json`，读后已删）：
  `hand = ["chess_char_1_02_a","chess_char_1_01_a","chess_item_6_09_e_a","chess_item_ol_01_e_a"]`；
  客户端自己的解析：`chess_item_ol_01_e_a → iconId "trap_ol_core" → /assets/item/trap_ol_core.png`、
  `chess_item_6_09_e_a → iconId "trap_1073_acarm073" → /assets/item/trap_1073_acarm073.png`（两张不同）；
  两个贴图都真的被请求到（HTTP 200）；`console.error / pageerror / HTTP ≥ 400` **0 条**。
- 1920 与 792 是**同一局、同一帧、同一 DOM**：先 1920 拍，再只改视口宽高（`setViewport` 只传 width/height，不传
  `isMobile/hasTouch`，否则 puppeteer 会重载页面），再拍 792 —— 与既有 `OVERLIMIT-RELIC-DRAFT-SHOT.md` 同一做法。

### 说明：为什么用测试钩子拿这件装备（而不是「打出来」）

这件装备**没有商店/装备池入口**（`shopExcluded`，只能由 FGO-SP 词条 `ctx.grantItem` 发），而 FGO-SP 只在**无限段**的词条池里、
权重 0.01%，正常路径要打到 R21 之后还要抽中它 —— 30 分钟内不可能。所以「获得方式」用的是仓库既有的测试钩子，
**装备本身、服务端、客户端渲染、assets pipeline 全是真货，没有改任何源码、没有造假数据页**；
截图里的图标就是 `data/items.json → assets.json → /assets/item/trap_ol_core.png` 这条真实链路画出来的。

## 5. 验收（原文）

```
$ npm run build-data
wrote 20 files to E:\Workbox\系统\data (7.84 MB) in 1715 ms          # exit 0

$ node tools/sync-static-web.mjs
[sync-static-web] Syncing standalone web assets into public/...
[sync-static-web] Sync complete: public/ is now fully self-contained!  # exit 0

$ node --test test/content/overlimit_relics_effects.test.js
ℹ tests 37
ℹ suites 0
ℹ pass 37
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 858.5712

$ node --test test/data.test.js test/sync-static-web.test.js
ℹ tests 39
ℹ suites 0
ℹ pass 39
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 4795.626

$ npm run typecheck
> stronghold-protocol-alliance@0.3.3 typecheck
> tsc --noEmit --checkJs -p jsconfig.json                        # exit 0
```

附带（因为动过 `data/assets.json`）：`node --test test/assets.test.js` → 56/57，唯一红的是
`every atlas on disk has size: lines …`（`public/assets/spine/op/char_002_amiya/char_002_amiya_epoque_4/back/…atlas` 缺 `size:` 行），
**与本单无关**（是磁盘上既有素材的问题；`generated manifest data/assets.json` 那一组的清单自洽断言全绿）。

## 6. 清理与红线

- 临时脚本（派生图标、对比图、实机截图、DOM 探针）与日志、中间裁剪图全部删除（`tmp/ol-core-*`、`tmp/ol-*.log`、`tmp/ol-core-shot-result.json`）。
- **没有 git 写**：工作区其它会话的未提交改动保持原样，本单只留下
  `docs/research/25-overlimit-items.json`、`tools/build-data.mjs`、`test/data.test.js`、
  `test/content/overlimit_relics_effects.test.js` 的改动，`data/**` 与 `public/data/**` 的 diff 全部由
  `npm run build-data` / `node tools/sync-static-web.mjs` / `node tools/patch-assets-local.mjs --write --slots items` 生成。
- 未新增任何 `t('…')` / msgid；未改 `public/i18n/**`；未改 `public/**` 源码（唯一新增的 `public/assets/item/trap_ol_core.png`
  是 gitignore 的素材目录，脚本产物）。
- 已知取舍：`public/assets/` 不进 git，所以干净 checkout 上没有这张派生图 —— 复现方式就是本报告 §1 的变换参数/脚本；
  `build-data` 故意**不**做图标存在性校验（否则没有素材的机器/CI 会红），存在性由 `patch-assets-local` 在登记 manifest 时保证。

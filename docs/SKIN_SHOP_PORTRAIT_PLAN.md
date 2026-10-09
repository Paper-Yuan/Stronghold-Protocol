# 皮肤立绘同步到游戏内商店 — 实施计划

- **创建时间**：2026-10-09
- **目标分支**：`feature/skin-shop-portrait`（建议从 `feature/v0.2.1-fusion-master` 当前 HEAD 拉出）
- **改动性质**：纯客户端表现层 + 离线资源管线扩展，**无服务端、无协议改动**
- **关联文档**：`docs/SKINS.md`（皮肤系统总设计）、`docs/ASSETS.md`（资源管线）、`docs/OPTIMIZATION_AND_PR_PLAN.md`（并行进行中的优化分支）

---

## 1. 任务背景与目标

玩家在**干员调配**（`screens/loadout.js` → `ui/skinPicker.js`）里为某干员选择皮肤后，战场上的 Spine 模型已经会换成皮肤（`docs/SKINS.md` 已实现）。但**游戏内商店**里该干员的卡片立绘（`.scard__art`）仍然固定显示原装半身像，形成"场上穿皮肤、商店看原装"的割裂。

**目标**：选了皮肤后，商店卡片立绘同步显示该皮肤的半身像；未选皮肤、或该皮肤立绘缺失时，回退到现有的默认 / E2（精锐）立绘，行为与今天完全一致。

### 范围

| 项 | 是否本期 | 说明 |
|---|---|---|
| 商店卡片立绘 `.scard__art` | ✅ 必需 | 用户的核心诉求 |
| 局内详情卡 `.dhead__art`（`ui/detailPanel.js`） | ✅ 建议同做 | 从商店卡点开的就是它，不同步会立刻看出割裂；改动约 2 行 |
| 干员调配详情头图 `.lo-dhead__art`（`screens/loadout.js`） | ⭕ 可选 | 皮肤选择器就在该屏，换肤即见反馈，体验闭环最好 |
| DIY 自选 / 替补（stand-in）卡 | ❌ 不做 | 服务端 `freezeSkins` 已拒绝 DIY 皮肤；这两类卡不适用 |
| 皮肤头像、战场 Spine 模型 | ❌ 已支持 | 无需改动 |
| 皮肤选择器本身、皮肤目录 `data/skins.json` | ❌ 不变 | 目录按设计不带 URL |

---

## 2. 现状调研（已逐项实测验证）

### 2.1 取图链路

```
shopBar.js:95   <${Img} src=${chessPortraitUrl(m, c)} class="scard__art" />
        └── assetUrls.js:35  chessPortraitUrl(m, chess)
                └── manifest chars[charId].portrait   /  portraitE2（精锐）
                        └── 磁盘 public/assets/char/portrait/{charId}_{1|2}.png  (180×360, ~100–140KB)
```

同一函数还被 `ui/detailPanel.js:420`（局内详情卡）与 `screens/loadout.js:292`（干员调配头图）调用——三处同源，因此可以一个 helper 统一。

### 2.2 皮肤资源现状：**缺半身立绘**

遍历 `data/assets.json` 实测：**271 款皮肤，0 款带 `portrait` 字段**。皮肤条目目前只有：

```json
"char_1014_nearl2@epoque#17": {
  "name": "复现荣光", "group": "时代/XVII",
  "avatar": "/assets/char/skin_avatar/char_1014_nearl2_epoque_17.png",
  "spine": { "front": { ... }, "back": { ... } }
}
```

### 2.3 上游可行性：**皮肤半身像存在且全覆盖**

- 上游仓库 `yuanyan3060/ArknightsGameResource` 的 `portrait/` 目录（1403 个文件）**包含皮肤半身像**。
- 命名规则：**skinId 把 `@` 替换为 `_`，保留 `#`**；URL 中 `#` 需编码为 `%23`。
  - `char_1012_skadi2@boc#4` → `portrait/char_1012_skadi2_boc%234.png`（实测 137,381 字节）
  - `char_498_inside@kitchen#2` → `portrait/char_498_inside_kitchen%232.png`
- **覆盖率实测：项目 271 款皮肤 271/271 命中上游**（0 缺失）。
- 单张 ~137KB → 全量约 **+35MB**。

复现命令（GitHub API 走 `gh`，比 WebFetch 可靠）：

```bash
# 对照组：已知存在的原装立绘
gh api "repos/yuanyan3060/ArknightsGameResource/contents/portrait/char_498_inside_1.png" --jq '.name, .size'
# → char_498_inside_1.png / 93369

# 皮肤立绘（注意 %23）
gh api "repos/yuanyan3060/ArknightsGameResource/contents/portrait/char_1012_skadi2_boc%234.png" --jq '.size'
# → 137381

# 列出整个 portrait 目录做覆盖率比对
gh api "repos/yuanyan3060/ArknightsGameResource/git/trees/main:portrait" --jq '.tree[].path' > /tmp/portrait_list.txt
```

### 2.4 为什么不需要动服务端

- 商店是**每个玩家私有的**（`m.private.shop`），队友看不到你的商店，因此皮肤立绘只需在**本机客户端**按本机选择渲染。
- 皮肤选择已按 `{ [chessId]: skinId }` 存在客户端 `skinsStore`（`ui/skins.js`），并已通过 `room.skins` 上行、经 `Match.publicView().players[].skins` 公开（队友看得到你的**战场模型**）——商店立绘不在其中，无需扩展协议。
- 商店 slot 的 `slot.id` 与皮肤选择器的 `chess.chessId` **同一键空间**（如 `chess_char_1_01_a`），可直接互查。

### 2.5 管线接点

本项目的 fusion 构建走**离线内置**管线（271 款皮肤全部内置，`ui/skins.js` 的 `isInstalled()` 恒为 `true`）：

```
tools/fetch-skin-avatars.mjs   → public/assets/char/skin_avatar/{stem}.png
tools/inject-skins-assets.mjs  → data/assets.json 的 chars[charId].skins[skinId]
```

> ⚠️ `docs/SKINS.md` 里描述的**按需安装器**（`tools/install-skins.mjs` + `server/skinInstall.js`）**不是**本期接入点——本仓库是内置全量形态。本期扩展的是上面这条 fusion 管线。

另外，客户端预载 `ui/preloadModal.js` 的 `extractUrls()` 显式遍历 manifest 分档：皮肤**头像进 Core**、皮肤 **Spine 进 Full**；新增的皮肤立绘需要显式加一行进 Full。预载面板有两处硬编码的实测体积文案（`preloadModal.js:500` `~93 MB · 2050 文件`、`:515` `~430 MB · 4250 文件`）需要重测更新。

---

## 3. 技术方案（分步落地）

### Step 1 — 新增下载工具 `tools/fetch-skin-portraits.mjs`

克隆 `tools/fetch-skin-avatars.mjs` 的结构（同一份 `08-skins.json` 遍历、同一套 jsdelivr 优先策略、同样的跳过已存在与并发 10）。

```js
const TARGET_DIR = path.join(ROOT, 'public', 'assets', 'char', 'skin_portrait');

for (const [charId, skinList] of Object.entries(research.skins || {})) {
  for (const s of skinList) {
    const stem = s.stem;                                    // char_1012_skadi2_boc_4
    const upstream = encodeURIComponent(s.skinId.replace(/@/g, '_')) + '.png';  // char_1012_skadi2_boc%234.png
    tasks.push({
      stem,
      dest: path.join(TARGET_DIR, `${stem}.png`),
      urls: [
        `https://cdn.jsdelivr.net/gh/yuanyan3060/ArknightsGameResource@main/portrait/${upstream}`,
        `https://raw.githubusercontent.com/yuanyan3060/ArknightsGameResource/main/portrait/${upstream}`,
      ],
    });
  }
}
```

要点：
- 磁盘文件名用**已清洗的 `stem`**（`@`/`#` 都变 `_`），避免 `#` 在路径里的转义问题；URL 侧用 `encodeURIComponent(skinId.replace(/@/g,'_'))` 以匹配上游原名。
- 存在且 `size > 1000` 即跳过（可断点续跑）；单文件 `< 500` 字节视为失败。
- 落盘目录 `public/assets/char/skin_portrait/`（与 `skin_avatar/` 平级）。

### Step 2 — 注入 manifest `tools/inject-skins-assets.mjs`

在现有 avatar 逻辑旁，**按存在性注入**（镜像 spine 的 `fs.existsSync` 模式）：

```js
const localPortrait = path.join(ROOT, 'public', 'assets', 'char', 'skin_portrait', `${stem}.png`);
if (fs.existsSync(localPortrait)) skinEntry.portrait = `/assets/char/skin_portrait/${stem}.png`;
```

- 只有本地真有文件才写进 manifest → 缺图自动回退默认立绘，且**永不产生 404**（延续 `assetUrls.js` 顶部注释的"只返回 manifest 里有的 URL"不变量）。
- 顺手加统计：`assets.stats.skinPortraits = <注入数>`。

### Step 3 — 客户端取图 helper `public/js/ui/assetUrls.js`

```js
/** Half-body portrait of a skin (manifest chars[charId].skins[skinId].portrait), or null. */
export function skinPortraitUrl(m, charId, skinId) {
  const s = obj(obj(obj(m)?.chars)?.[charId]?.skins)?.[skinId];
  return str(s?.portrait);
}
```

建议再抽一个三处复用的优先级 helper（可选，但能消除重复逻辑）：

```js
/** Skin portrait when one is chosen and installed, else the operator's own (E2-aware) portrait. */
export function preferredPortraitUrl(m, chess, skinId) {
  return (skinId && skinPortraitUrl(m, chess?.charId, skinId)) || chessPortraitUrl(m, chess);
}
```

### Step 4 — 商店卡接线 `public/js/ui/shopBar.js`（核心）

在 `ChessCard` 组件内订阅皮肤选择，实现**换肤即时刷新**：

```js
import { useStore, shallowEqual } from '../store.js';
import { skinsStore } from './skins.js';
// ...
const skinEntries = useStore((v) => v.entries, shallowEqual, skinsStore);
const sk = (!dr && !si) ? skinEntries[slot.id] || null : null;   // DIY / 替补不套皮肤
const art = (sk && skinPortraitUrl(m, c?.charId, sk)) || chessPortraitUrl(m, c);
// ...
<${Img} src=${art} class="scard__art" />
```

要点：
- hook 签名与 `ui/skinPicker.js:28` 一致：`useStore((v) => v, shallowEqual, skinsStore)`。
- `slot.id` 即 chessId；`c` 是 `data.lookup('chess', slot.id)`，带 `charId`。
- `dr`（DIY）/ `si`（替补）卡跳过，避免误配到别人的干员。
- 精锐（golden）卡片：皮肤无精英变体，皮肤优先生效（与原版行为一致）。

### Step 5 — 一致性面

- **`ui/detailPanel.js:420`（建议本期做）**：把 `chessPortraitUrl(m, body)` 换成皮肤优先。注意此处的皮肤来源有**两个**：
  1. 棋子自带的 `body.skin`（服务端 `pieceView` / 快照会下发，见 `docs/SKINS.md`），**队友的棋子也适用**；
  2. 本机 `skinsStore` 按 chessId 查（用于商店/自己商店里尚未落子的卡）。
  优先级建议：`body.skin` → `skinsStore` → 默认。实现前先确认该组件的 `body` 是否已带 `skin` 字段。
- **`screens/loadout.js:292`（可选）**：`chessPortraitUrl(m, golden || chess)` 同样改为皮肤优先（该屏能拿到 `chess.chessId`，直接查 `skinsStore`），换肤当场可见。

### Step 6 — 预载与体积文案

- `ui/preloadModal.js` 的 `extractUrls()`，在 skins 循环内加一行（进 Full 层，与干员自身立绘同档）：

  ```js
  if (sk.portrait) fullSet.add(sk.portrait);
  ```

- 重新实测 Core/Full 体积与文件数，更新 `preloadModal.js:500` / `:515` 的文案（预计 Full 由 `~430 MB · 4250 文件` 变为约 `~465 MB · 4520 文件`，以实测为准）。

### Step 7 — 文档

- `docs/SKINS.md`「Edits to existing files」表补一行：`tools/inject-skins-assets.mjs` → 注入 `skins[skinId].portrait`；`public/js/ui/assetUrls.js` → `skinPortraitUrl`；`public/js/ui/shopBar.js` → 商店卡立绘皮肤优先。
- `docs/ASSETS.md` 的 manifest schema 若列了 `chars[charId].skins` 子结构，补 `portrait` 字段说明。
- **`data/skins.json` 不变**（目录不带 URL 的设计不变量）。

### Step 8 — 测试

- 扩展 `test/skins.test.js`：对 manifest 中每个**已注入 portrait 的**皮肤条目断言其文件落盘；并加 `skinPortraitUrl()` 的单测（命中 / 缺失返回 null / 未知 charId）。
- `test/assets.test.js` 的「every manifest path exists on disk」是**通用深遍历**，会自动覆盖 271 个新文件——即"资源完整性"闸门无需额外写，但要保证下载完成后再跑。
- 可选：`test/ui/skins.e2e.test.js`（真实浏览器皮肤选择器）后续加一条"选皮肤 → 商店卡换图"的断言。

### Step 9 — 执行顺序

```bash
node tools/fetch-skin-portraits.mjs      # 下载（可断点续跑）
node tools/inject-skins-assets.mjs       # 注入 manifest
node --test test/assets.test.js test/skins.test.js
# 浏览器肉眼验证：选皮肤 → 开商店 → 卡片/详情换图 → 换肤即时刷新 → 精锐卡
```

---

## 4. 资源与成本

| 项 | 数值 |
|---|---|
| 新增文件 | 271 张 PNG |
| 单张体积 | ~137KB（实测 skadi2 皮肤立绘） |
| 新增总体积 | **约 +35MB**（Full 预载 428MB → ~465MB） |
| manifest 文本增量 | ~271 行 × ~90 字节 ≈ 25KB（可忽略） |
| 下载耗时 | jsdelivr 通常 1–3 分钟（35MB，并发 10） |

相对 Full 包内已有的 Spine 模型总量（数百 MB），+35MB 属噪声级；**不建议**为省这点流量改成按需加载（会闪图）。

---

## 5. 协作与冲突避让（并行对话）

本计划在**主对话（优化分支 A–E + 测试修复）与另两个辅助对话并行**的情况下推进，故须明确避让边界。

### 5.1 主对话当前脏区（**完全不碰**）

- `server/sim/content/kits/ops/*.js`、`server/sim/content/tokens.js`（`??=` 改写 / 测试修复）
- `package.json`、`package-lock.json`（`acorn` 依赖）
- 近期已提交、可能继续演进的：`public/js/render/app.js`（热防护钩子 `83d6a233`）、`public/js/ui/chatBox.js`、`public/js/screens/game.js`、`public/css/screens/game-shop.css`（C3）

### 5.2 本计划触碰清单（供另两个辅助对话避让）

```
public/js/ui/shopBar.js                ← 核心（近期仅被旧 feedback 提交动过）
public/js/ui/detailPanel.js            ← 建议同做
public/js/ui/assetUrls.js              ← 新增 helper
public/js/screens/loadout.js           ← 可选
public/js/ui/preloadModal.js           ← 仅 1 行 + 2 行文案（唯一与主对话历史重叠点）
tools/fetch-skin-portraits.mjs         ← 新文件（零冲突）
tools/inject-skins-assets.mjs          ← 加 portrait 注入块
data/assets.json                       ← 注入（一次性、原子提交）
docs/SKINS.md                          ← 补表行
test/skins.test.js                     ← 扩展断言
```

### 5.3 协作规则

1. **唯一重叠点** `preloadModal.js`（主对话 B 阶段已提交、后续可能再调）：把它的 1 行 + 文案更新**放在最后单独提交**，或挪到主对话空闲窗口。
2. **分支隔离**：从当前 HEAD 拉 `feature/skin-shop-portrait`；若必须留在同一分支，至少保证 `data/assets.json` 的"注入 + 提交"是**原子一次**，把其他对话重新生成该文件的冲突窗口压到最小。
3. **无服务端/协议改动** → 不影响正在跑的 `test/match/*`（含 `merge.test.js`、loadGuard 熔断）与部署面；发布只是静态资源 + 客户端 JS 的常规发布，**无需 PM2 重启**。
4. `data/assets.json` 体量巨大，**不要与主对话的 assets 相关修复同批提交**，避免 diff 互相污染。

---

## 6. 验证清单

- [ ] `node tools/fetch-skin-portraits.mjs` 报告 `失败 0`，`public/assets/char/skin_portrait/` 有 271 个文件
- [ ] `data/assets.json` 中皮肤条目带 `portrait` 的数量 = 271，且路径均在磁盘存在
- [ ] `node --test test/assets.test.js` 的「every manifest path exists on disk」通过
- [ ] `node --test test/skins.test.js` 通过（含新增 portrait 断言）
- [ ] 浏览器：选皮肤 → 开商店 → 该干员卡片立绘为皮肤；**换肤后卡片即时刷新**（不重开商店）
- [ ] 未选皮肤 / 未安装立绘的皮肤 → 回退默认立绘，无 404、无空白
- [ ] 精锐（E2）卡：皮肤立绘生效（皮肤无精英变体）
- [ ] DIY / 替补卡：仍显示原干员立绘（不误套皮肤）
- [ ] 局内详情卡（`.dhead__art`）与商店卡一致；队友棋子（`body.skin`）也正确
- [ ] 预载面板体积/文件数文案已按实测更新

---

## 7. 风险与回退

| 风险 | 处置 |
|---|---|
| 上游个别皮肤立绘缺失 | 注入按存在性检查 → 自动回退默认立绘，existence 闸门不红（今天 271/271 全有，防未来） |
| 预载 Full 膨胀 +35MB | 可接受（相对 Spine 体量）；本期不建议按需加载（闪图） |
| 精锐 E2 无皮肤变体 | 皮肤优先生效，与原版一致，文档写明 |
| 商店卡布局 | 皮肤立绘与原立绘同规格 180×360，`.scard__art` 的 `object-fit`/尺寸不变；与主对话 C3 的卡片宽度调整无关 |
| 上游链接限速/失败 | 复用 avatars 脚本的 jsdelivr 优先 + raw 回退 + 跳过已存在（可续跑） |
| 回退 | 纯新增字段与新增文件；若需回退，删 `portrait` 注入块 + `skinPortraitUrl` 调用即恢复原行为（manifest 里多出的 URL 不影响渲染） |

---

## 8. 工作量与提交拆分

| 提交 | 内容 | 预估 |
|---|---|---|
| ① `feat(assets)`: 皮肤立绘离线内置 | Step 1 + Step 2 + `data/assets.json` 注入 + `docs/ASSETS.md`/`SKINS.md` | ~1h + 下载 |
| ② `feat(ui)`: 商店/详情立绘皮肤优先 | Step 3 + Step 4 + Step 5 | ~1h |
| ③ `feat(preload)+test`: 预载分档、文案与测试 | Step 6 + Step 8 | ~1h |
| 验证 | 资源闸门 + 浏览器双端肉眼 | ~1h |

**合计约半天**（不含上游下载等待）。三个提交彼此独立、可分别回退，且都不混入优化分支的既有提交。

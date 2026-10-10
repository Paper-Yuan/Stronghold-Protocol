# docs/mockups — 参考图与实景图

本目录下的 PNG 全部由脚本生成，脚本读的是**仓库里的真实源码与真实资源**，没有另画一套设计稿。
每一张图旁边都能找到生成它的 `.mjs`；重跑命令写在脚本头注释里。

## 两种图，别混用

| 类型 | 是什么 | 产物 |
|---|---|---|
| **实景图** | 真服务器 + 真前端 + 真浏览器视口，只把"还没实现的新 UI"注入 DOM | `mock-1..4-*.png` |
| **参考图** | 目标 UI 尚不存在于本分支（上游 v0.2.2 的版面），所以用**真实样式表 + 真实数据**重建版面再截图 | `merged-ui-reference.png`、`dual-platform-adaptation.png`、`fusion-*.png` |

参考图不是"设计概念稿"：它载入的是游戏自己的 CSS、自己的字体、自己的组件类名。所以图里的间距、配色、
边框、字重就是实现后的样子——**唯一不是真的东西是"这段代码还没写"**。

## 产物一览

| 文件 | 生成脚本 | 说明 |
|---|---|---|
| `mock-1-lobby-private-room.png` | `render-mockups.mjs` | 大厅创建框上方的 公开/私密 二段开关（提案 UI 注入） |
| `mock-2-lobby-private-room-phone.png` | `render-mockups.mjs` | 同上，844×390 横屏 |
| `mock-3-matchmaking-modal.png` | `render-mockups.mjs` | 匹配弹窗的「快速匹配」按钮 |
| `mock-4-admin-private-rooms.png` | `render-mockups.mjs` | 管理后台房间表的 🔒 私密 徽标 |
| `merged-ui-reference.png` | `render-merged-ui.mjs` | 上游 v0.2.2 合进来之后，干员调配长什么样 |
| `dual-platform-adaptation.png` | `render-dual-platform.mjs` | 双端差异的三层轴（能力类 / 原生桥 / 资源档） |
| `fusion-dual-platform.png` | `render-fusion-dual-platform.mjs` | **总览**：上面两张的融合 + 皮肤选择，4 个面板 |
| `fusion-1-loadout.png` | 同上 | ① 融合总览（1920×1080 整屏，带 ①②③ 圆标与图例） |
| `fusion-2-skin-dual.png` | 同上 | ② 皮肤选择 · 双端对应（含商店卡立绘同步） |
| `fusion-3-devices.png` | 同上 | ③ 同一屏两端（Web 整屏 vs 安卓 844×390 的列表态 / 详情态） |
| `fusion-4-matrix.png` | 同上 | ④ 双端对应表 + 应当 / 不要规则 |

`render-fusion-dual-platform.mjs` 跑一次同时产出总览 + 四张拆分图。

```bash
node docs/mockups/render-fusion-dual-platform.mjs      # 需要 Chrome（Windows 自动探测，或设 CHROME_PATH）
```

## 内置内容包 + 房主选择（mod 加载器的界面）

| 文件 | 生成脚本 | 说明 |
|---|---|---|
| `mod-1-lobby-packs.png` | `render-mod-loader.mjs` | 大厅：创建框的**公开/私密**开关（沿用既有提案）＋ 创建框正下方「内容包」**默认收起的二级菜单**（收起态） |
| `mod-7-lobby-packs-open.png` | 同上 | 同一个二级菜单的**展开态**（3 个包 + 「未勾选即原版」说明） |
| `mod-2-lobby-packs-phone.png` | 同上 | 同上，安卓横屏 844×390（收起态） |
| `mod-8-lobby-packs-phone-open.png` | 同上 | 同上，安卓横屏 844×390（展开态） |
| `mod-3-room-badge.png` | 同上 | 匹配弹窗房间卡上的 🧩 内容包徽标（**加入前可见**） |
| `mod-6-room-packs.png` | 同上 | **房间内**：房间条上的本局内容包清单 ＋ 房主的「内容包」选择器 |
| `mod-4-admin-pool.png` | 同上 | 管理后台新增「内容包池」区块：池子开关 + **校验拒绝原因** |
| `mod-5-settings-packs.png` | 同上 | 设置面板里的只读「本版本内置内容包」行 |
| `mod-overview.png` | `render-mod-overview.mjs` | **总览**：上面八张拼成一张（5 个面板 + 两级控制模型图例）。只拼合，不重渲染界面 |

```bash
node docs/mockups/render-mod-loader.mjs      # 需要 Chrome；出上面八张实景图
node docs/mockups/render-mod-overview.mjs    # 需要 Chrome；把八张拼成 mod-overview.png（依赖前一步）
```

**大厅与房间用同一种交互：默认收起的二级菜单。** 创建框只放 公开/私密（`render-mockups.mjs` 的既有提案），
「内容包」是它正下方一行可展开的二级菜单（桌面 `mod-1` 收起 / `mod-7` 展开，安卓横屏 `mod-2` 收起 / `mod-8` 展开）；
房间内是房间条上的「🧩 内容包」按钮 ＋ 展开的选择器（`mod-6`）。**不做常驻展开的独立面板**——那会把大厅左栏折行。

模型是**两级控制**：运营端在 `/admin` 决定池子（哪些内置包可被选用），房主在建房时决定本局启用哪些；
公开匹配锁原版。这几张图对应这两级的界面，外加玩家端的只读视图与「加入前可见」那一条。

**皮肤/立绘不是内容包。** 那是游戏内功能（`public/js/ui/skinPicker.js` + 皮肤商店），不进内容包列表；
只有当一个包**新增了干员**时，它才自带这些干员的立绘（图里 kind 列的「立绘」/`art`）。

## 融合参考图的做法（这是关键，换人接手请照做）

**风格基线 = 游戏自己的样式表**，而不是"参考一下配色再自己写 CSS"：

1. 上游 v0.2.2 的 `theme.css / components.css / devices.css / screens/loadout.css / screens/game-panels.css /
   screens/game-shop.css` 用 `git show upstream/master:public/css/...` 原样取出（取不到才退回本地同名文件）；
2. 追加**本地独有的「皮肤选择」块**（从本地 `loadout.css` 里整段切出 `.lo-skins / .lo-skin*`）——这一步就是"合并动作"本身；
3. 版面按真实源码重建：上游 `screens/loadout.js`（一干员一行 + `.lo-cult` 潜能·练度）、
   `screens/cultivation.js`（两个 select / 详情卡分段）、本地 `ui/skinPicker.js`（`.lo-skins` 单列列表）；
4. 干员、技能、立绘、盟约、练度文案全部来自 `public/data/{chess,assets,bonds,effects}.json`；
5. 字体用仓库自己的 `public/fonts/fonts.css`（Bender / Novecento Wide）+ Noto Sans SC。

**尺寸不要手写**：根字号是 `clamp(40px, min(100vw/19.2, 100svh/10.8), 240px)`，Web 1920×1080 下 1rem = 100px，
安卓横屏 844×390 下 1rem = 40px。所以参考图分两趟渲染（1920×1080 / 844×390，各 dsf 2），
让真实 CSS 的媒体查询自己决定版面。`<html>` 的端类也要照 `ui/device.js` 打：
Web = `sp-hover sp-fs`，安卓 = `sp-touch sp-coarse sp-no-hover`。

### 踩过的坑

- 整屏 `.lo` 是 `position: fixed`，同页放多个舞台会叠在一起 → 脚本里覆写为 `.stage .lo { position: absolute; inset: 0 }`，
  且 `.stage` 必须显式给 `width: 100vw; height: 100vh`（否则收缩为 0）。
- 用 `document.querySelector('.lo-xxx')` 会取到**第一个（被隐藏的）舞台**里的元素，量出来全是 0 —— 必须写成
  `.stage:not([hidden]) .lo-xxx`。
- 上游 v0.2.2 把窄屏断点从 **760px 提到 1000px**：844×390 横屏落在 `≤1000px` 里，
  于是列表占满整屏、详情卡走 `.lo-body.is-detail` **整屏滑出**。这与本地（760px）行为不同，是合并后要接受的变化。
- `fullPage: true` 会把短面板托底到视口高度，`documentElement.scrollHeight` 同样被托底 →
  按内容底边用 `clip` 裁切，别用 `scrollHeight` 当内容高。

## 自检（每次跑都会打印）

脚本末尾输出结构化自检，用来替代目视（本模型读不了图，且本环境的 `visual-judge` 子代理起不来：
`provider-not-found`）。当前基线：

```
样式来源: upstream/master（v0.2.2） | 皮肤块: 2505 字符
字体: Noto Sans SC / Bender / Novecento Wide 均 loaded，rem=100px
[web-top]  破图0 | 行 8(64px) | 皮肤行 4(48x48) | 技能3 数值格8 范围格12 模组3 阶标9 | 塌陷0 | 文字裁切 无
[and-top]  破图0 | 行 8(50px) | 皮肤行 4(0x0，详情列隐藏=预期) | 塌陷0 | 文字裁切 无
[and-detail] 破图0 | 皮肤行 4(36x36) | 塌陷0
面板 4 | 表行 10 | 图片 8（未加载 0）| 出界 none | 圆标 ①②③ 均落在目标元素上
```

- 48px / 36px 头像正好是 `max(.48rem, 36px)` 在 rem=100 / rem=40 下的取值 —— 这是"真实 CSS 生效了"的直接证据。
- 每个产物的 10 等分横向条带墨量都 > 0（约 1.2%–13.7%），没有空面板。
- 「塌陷」只统计**可见但尺寸为 0** 的元素（`checkVisibility`），隐藏列不算缺陷。

**仍然建议人工过目一眼**：以上是几何与像素证据，不能替代审美判断。

## 图里"是提案、还没实现"的部分

看到图不要以为已经做完了。参考图里这些是**计划**：

- **内置内容包 / 房主选择（`mod-1..7`）**：本仓库只有 manifest 层（`shared/packs.js`），
  `server/packs.js` / `tools/packs.mjs` / `public/js/ui/lang.js` 等运行时**不存在**，所以这七张图
  全是注入式提案。缺件清单与恢复代价见 `E:\Workbox\PACK_RUNTIME_GAP_REVIEW.md`。
- 上游 v0.2.2 合并本身（`feature/v0.2.1-fusion-master` 尚未合并 v0.2.2）。
- **皮肤选择段**：本地 `ui/skinPicker.js` + `.lo-skins` 已实现，但"落在上游 v0.2.2 详情卡末段"是合并后的位置。
- **商店卡立绘同步**（`docs/SKIN_SHOP_PORTRAIT_PLAN.md`）：`skinPortraitUrl` / `preferredPortraitUrl` 尚未接线。
- **私密房间 / 快速匹配**（`docs/HANDOFF_MATCHMAKING_PRIVATE_ROOMS.md`、`docs/MATCHMAKING_PRIVATE_ROOMS_PLAN.md`）：
  核对过 `public/js`、`public/css`、`server/` 里**没有**任何私密房间实现（`私密` 零命中，`Room.private` / `isPrivate`
  不存在；`m.private` 是无关的对局私有快照协议），它们只存在于计划文档与注入式 mock 脚本里。
- 双端适配表里的 `loadGuard` 权重（`android_full 1.0 / web_full 1.0 / web_core 1.5 / stream 8.0`）是已实现的，
  不是提案 —— 它在 `server/` 里。

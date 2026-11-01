# S.W.E.E.P. 报告 · 超限 → 词条（改动前实机现状）

拍摄时间：2026-10-31 23:14（本机）
仓库：`E:\Workbox\系统`（工作区有多会话未提交改动，本次未做任何 git 写操作，未改任何源码）
服务端：`node server/index.js`，`PORT=3170`，`HOST=127.0.0.1`（真服务端 + 真 `data/*.json`，非 mock；避开 3000）
浏览器：系统 Chrome（`C:/Users/J1825/AppData/Local/Google/Chrome/Application/chrome.exe`），puppeteer-core，headless new，`deviceScaleFactor: 1`

## 进到这一页的步骤

1. 起服务端：`PORT=3170 HOST=127.0.0.1 node server/index.js`（默认版本 act2autochess = 根 `data/`，`data/relicsOverlimit.json` 存在，36 条）。
2. `http://127.0.0.1:3170/` → 标题页填任意名字 → 点「开始」进大厅（大厅出现 `.lobby-sweep` / 顶部「S.W.E.E.P.报告 REPORT」底板）。
3. 点 `.lobby-sweep` 打开 S.W.E.E.P. 报告（`.sw` 全屏 Modal，默认落在「盟约报告」页、默认「原版」视图）。
4. 头部中段的胶囊切换器 `.sw-vars` 点「超限」（`.sw-var[data-variant="overlimit"]`，`aria-pressed="true"`）：
   标签页从 3 个（盟约报告 / 策略报告 / 敌方资料）变成 4 个，末尾多出「词条」；头部下方出现黄色横幅「超限视图 · 盟约强化尚未配置」。
5. 点第四个标签「词条」（`.sw-tab`，`role="tab"`，`aria-selected="true"`）。左栏默认选中第一条 LC-001，右栏是词条瓦片墙。

拍摄方式：先在 1920×1080 视口走完上面 5 步并截图，然后在**同一页、同一帧**只调 `page.setViewport()` 到 792×630 再截第二张——
**没有 reload、没有重新导航、没有传 `isMobile` / `hasTouch`**（全程只发生一次 `page.goto`，即第 2 步打开首页）。

## 两张图

| 文件 | 像素 | 字节 | SHA-256 |
| --- | --- | --- | --- |
| `handoff/shots/sweep-relics-current-1920x1080.png` | 1920 × 1080 | 1,456,157 | `06ad50edb18000a709187babaddce965cb36e7912131739deb9f54644a80d516` |
| `handoff/shots/sweep-relics-current-792x630.png` | 792 × 630 | 500,885 | `3dc09527db4c3eb225ce4e2c9cbd3cf9ad6979a52f87c67726ae541f1727e12c` |

两张都是**视口截图**（`fullPage: false`），即业主在真机上看到的这一屏。

## 页面事实（两个视口完全一致，只差布局）

- 页签：`词条`（`aria-selected=true`），头部切换器 `超限`（`aria-pressed=true`），横幅 `data-variant="overlimit"`、文案「超限视图 · 盟约强化尚未配置」，且**没有**「当前对局使用超限数值」（本页不是从超限房进的，符合预期）。
- 右侧分区标题：`[ 词条 36 ]`——`sectionCountNum = 36`。
- **瓦片数 36**（`.sw-sec__grid > *` 与 `> .sw-tile` 都 = 36），一条词条一个方形瓦片（图标 + 名字 + 编号）。
- 编号顺序（data 顺序，逐条渲染）：`LC-001…LC-007`、`LC-SP1…LC-SP7`、`LC-EX1…LC-EX4`、`FGO-01…FGO-09`、`FGO_X`、`FGO-11…FGO-17`、`FGO_SP`（首条 LC-001、末条 FGO_SP，与截图末行一致）。
- 分组（数据侧，`data/relicsOverlimit.json` 的 `group`）：lc 7、sp 7、ex 4、fgo 16、fgoX 1、fgoSP 1 = 36。
- 图标走 `data/*.json` 里的 `/assets/relics/overlimit/<编号>.png`，页面上 `.sw-disc--art img` 已出现；左栏大图仍是首字占位「竟」（Hero 的既有 fallback，与本次无关）。
- **现状要点（改动前）**：整页只有 36 条饰品词条，**一个不分段的长列表**（8 行 × 5 列），没有负面词条并入、没有分段标题；`data/relicsOverlimitNegative.json` 这张表虽然存在，但 `sweep.js` 的 `RelicsTab` 只读 `relicsOverlimit`（`relicsOverlimitOf()`），负面 17 条尚未出现在这一页。

## 控制台 / 报错计数

- `console` error：**0**
- `pageerror`：**0**
- 打开、切换、点页签全程无报错、无空白页；另一条线对 `public/js/screens/sweep.js` 的改动在本帧下未造成异常。

## 关于 792×630 的底部

`792×630` 下 36 个瓦片按 5 列排布，网格高 660 px，超出可视高，最后一行被 `.sw-right`（`overflow-y: auto` 的滚动区）裁在视口底边——
这是报告**自身滚动区**的边界，其上方的头部、横幅、左右两栏都在视口内完整（左栏 x≈0–340，右栏 x≈353–773，无横向溢出）。
若要一屏看全 36 条，需要滚动右栏或加高视口；这张图按业主要求的可视高度拍摄，未做任何临时样式改动。

## 临时资源

- 拍摄脚本 `.sp-tmp/sweep-relics-shot.mjs`：跑完即删。
- 服务端（3170）：跑完即关。
- 只新增 `handoff/shots/` 下的两张 PNG 与本文件，未触碰源码与数据。

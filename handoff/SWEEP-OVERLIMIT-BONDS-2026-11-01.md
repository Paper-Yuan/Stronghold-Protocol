# S.W.E.E.P. 报告 · 超限视图 → 盟约页回填（2026-11-01）

仓库：`E:\Workbox\系统`（工作区有多会话未提交改动；本单无任何 git 写操作）。
服务端：`PORT=3170 HOST=127.0.0.1 node server/index.js`（真服务端 + 真 `data/*.json`，非 mock）。
浏览器：系统 Chrome + `puppeteer-core`，headless new，`deviceScaleFactor: 1`，全程只 `page.goto` 一次，
两张图是**同一页同一帧**只调 `page.setViewport()`。

## 1. 壳的位置

| 内容 | 位置 |
| --- | --- |
| 超限视图固定文案（横幅 / 占位 / 后缀） | `public/js/screens/sweep.js:68`（`OVERLIMIT_COPY`） |
| 旧横幅「超限视图 · 盟约强化尚未配置」 | 原 `sweep.js:63`，本单改为 `sweep.js:70` 的 `超限视图 · 已配置 N 条盟约强化` |
| 五条占位名单 `OVERLIMIT_PENDING_BONDS` | `sweep.js:61` |
| 横幅组件 `OverlimitBanner` | `sweep.js:251` |
| 占位块组件 `PendingTile` / 「超限专属：待定」 | `sweep.js:267`（字面量 `sweep.js:72`） |
| 瓦片墙的占位判定 | `sweep.js:343`（`overlimitBondPending(b, overlimit)`） |
| 详情面板的强化块 | `sweep.js:305`（`.sw-inf`，位于描述之前、滚动区之外） |

## 2. 回填数据来源

`data/bonds.json` 每条盟约记录的 **`inf` 覆盖块**（`desc` / `descRaw` / `effectDesc` / `effectDescRaw`）：

- 八条与大盟约带 `inf`：`egirShip` / `lateranoShip` / `victoriaShip` / `sargonShip` / `siracusaShip` /
  `yanShip` / `kazimierzShip` / `kjeragShip`。
- `inf` 块 = **原版原文 + 末尾追加的 `【超限模拟】` 行**；本单把追加行单独抽出来显示（`overlimitBondView`，
  `sweep.js:110`），描述用 `inf.descRaw` 里 `【超限模拟】` 之前的部分（与基础记录的 `descRaw` 逐字相同）。
  两者拼起来逐字等于 `inf.descRaw`（`test/ui/sweep.test.js:216` 的断言逐条验证）。
- **`inf` 块只有文案，没有数值字段**（数值在 `server/sim/content/bonds/core.js` 的具名常量）。所以面板上的
  「幅度」= `inf` 里那句 `【超限模拟】` 原文，不另造「25→9999」这类数据里不存在的数字。
- 没有任何一条的 `inf` 文本缺失 —— 五条全部有文本，未触发「停下问业主」。

## 3. 横幅新文案

`超限视图 · 已配置 N 条盟约强化`，N = 当前报告里带 `inf` 覆盖块的盟约条数（`overlimitConfiguredCount`，
`sweep.js:142`；默认版本 = 8）。**未新增 msgid**：这是 `OVERLIMIT_COPY.banner` 的内联中文模板，
行尾 `// i18n-ignore`；标题复用已有 msgid `t('超限模拟')`。

本单新增/改动的字面量只有这一条（`超限视图 · 已配置 ${n} 条盟约强化`）；另外三条旧字面量（`超限` /
`当前对局使用超限数值` / `超限专属：待定`）仍在原处、仍带 `// i18n-ignore`。四语包文件本单**零改动**
（工作区里 `饰品` 那条是另一条线此前的改动）。

## 4. 五条的展示句（逐字来自 `inf`）

| 盟约 | 面板「超限模拟」一行 |
| --- | --- |
| 阿戈尔 超限 | 吞噬**仍继承被吞噬者的基础攻击力**；【阿戈尔】干员额外获得**0.25%×层数**的**基础攻击力**（最终加算，不受攻击力加成影响） |
| 拉特兰 超限 | 每消耗**1**发弹药提供的**攻击力+8% 不设上限**（弹药量加成仍在**600**层封顶） |
| 维多利亚 超限 | 【维多利亚】干员**生命值+(0.2×层数)%**（受层数影响） |
| 萨尔贡 超限 | 6 人档的**攻击力叠层取消上限**（原「至多**25**层、攻击力至多**+300%**」不再适用），每次开启技能继续叠加；**攻击速度仍至多叠 25 层** |
| 叙拉古 超限 | <在场**3**名不同【叙拉古】干员>起，【叙拉古】干员**攻击力+0.1%×层数**；6 人档的真伤触发概率提升至**10%**，真伤改为**(5000+50×层数)+目标当前生命值0.2%**，对精英与首领仍至多**250万** |

（上表是纯文本；页面里这些标记由 `RichText` 渲染成彩色片段。）

## 5. 已配置 / 未配置

- 默认版本（`data/bonds.json`）：五条都有 `inf` → 都是可点瓦片，右栏 `.sw-tile--pending` 数量 = 0，
  「XXX 超限」瓦片 8 个。
- 三个赛季版本（`data/versions/*/bonds.json`）没有 `inf` 块 → 同五条仍显示「超限专属：待定」虚线占位，
  横幅 N = 0。测试逐版本验证（`test/ui/sweep.test.js:250`）。

## 6. 验收

```
node --test "test/ui/**/*.test.js"
ℹ tests 1542
ℹ suites 286
ℹ pass 1503
ℹ fail 0
ℹ cancelled 0
ℹ skipped 39
ℹ todo 0
```

```
node --test test/data.test.js
ℹ tests 37
ℹ suites 0
ℹ pass 37
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
```

```
npm run typecheck
> tsc --noEmit --checkJs -p jsconfig.json
（无输出，退出码 0）
```

`npx eslint public/js/screens/sweep.js test/ui/sweep.test.js devtools/render-check-sweep-overlimit.mjs`：无输出。

`node tools/i18n.mjs check --all --strict`：`0 errors`，但 `public/i18n/en.json` 仍有 **248 条既有缺译**
（en 90.7%），退出码 1 —— 与本单无关；本单未新增 msgid，缺译清单里没有本单的新文案。
唯一与 sweep.js 相关的缺译是既有的 `public/js/screens/sweep.js:445 负面词条`（另一条线）。

## 7. 两张图

| 文件 | 像素 | 字节 | SHA-256 |
| --- | --- | --- | --- |
| `handoff/shots/sweep-overlimit-bonds-792x630.png` | 792 × 630 | 464,929 | `55c63882935d2dfe50ffd6872af5d6fa2b18250eaaf85c9f67005d8a1973ab7f` |
| `handoff/shots/sweep-overlimit-bonds-1920x1080.png` | 1920 × 1080 | 1,410,394 | `05ea4e78b7b26d03a4955a1d40aca19f71bc8275c441c7a86c0151c984c44bb4` |

拍摄路径：大厅登录 → 独立模拟 → 难度列表末项「超限模拟」→ 点 `.lobby-sweep` 打开报告（大厅传
`variant=overlimit`）→ 盟约报告 → 依次点开五条（逐条记录面板文本）→ 停在「拉特兰 超限」→ 1920×1080 →
同页 `setViewport(792×630)` 再截。

复现脚本：`devtools/render-check-sweep-overlimit.mjs`（`SP_BASE=http://127.0.0.1:3170 node …`）。

## 8. 控制台

`console` error：0（过滤浏览器自身的 `ResizeObserver loop completed with undelivered notifications.`）；
`pageerror`：0。

# 桌面端启动选择页 · 静态视觉稿（两卡）

> 范围：**只出图**。不接代码、不改 `public/**`，没有 git 写操作。
> 产物：`handoff/desktop-electron/mock-choice.html`（单文件）+
> `handoff/shots/desktop-choice-{1920x1080,1280x720,792x360}.png`。
> 口径按业主本次指定：**只有两张卡**（左「本机」/ 右「服务器」），不采用手机端三卡
> （`docs/START-MODES-PLAN.md:7-11` 的 ①自己玩 / ②开服给同伴 / ③去加朋友）。
>
> **二改（2026-10-31 第二轮反馈）请跳到最后「## 二改」**：卡高提到 54% 视口、右卡预填自建中转地址、
> 去掉「记住这个地址」、页脚只留 `v0.3.3`、新增「连接中」状态图。下面 §1–§5 是首版记录，涉及被改掉的
> 三处（勾选框 / 页脚「桌面端」/ 卡高 383.78）以二改为准。

---

## 1. 稿子里有什么

```
┌ RHODES ISLAND // SIMULATION SERVICE                                   [⚙ 设置] ┐
│ 卫戍协议：盟约  v0.3.3                                                          │
│                                                                                 │
│      ┌ 本机（mint 描边 + 外发光 + 顶部高光条）┐  ┌ 服务器（普通描边）─────────┐   │
│      │ LOCAL SERVER                            │  │ REMOTE SERVER              │  │
│      │ 本机                                    │  │ 服务器                      │  │
│      │ 在本机启动服务端并直接进入游戏。         │  │ 地址                        │  │
│      │ 本机地址 127.0.0.1 · 端口 3000           │  │ ┌ 例如: 192.168.1.100:3000 ┐│  │
│      │ ───────────────────────────             │  │ ☐ 记住这个地址              │  │
│      │ [        启动本机        ]（实心 mint）  │  │ ─────────────────────────  │  │
│      │ 无需联网，本机运行独立 Node 引擎 · …     │  │ [          连接          ] │  │
│      └─────────────────────────────────────────┘  │ 连不上会回到这一页，地址会留着…│  │
│                                                   └────────────────────────────┘  │
│                              v0.3.3 · 桌面端                                      │
└─────────────────────────────────────────────────────────────────────────────────┘
```

- 视觉件全部来自仓库：根尺度、token、`.micro` 小字、`.num`、`.btn/.btn--primary/.btn--ghost`、
  `.panel` 的面板底（扫描线纹理 + 1px 描边 + 投影）、`.field`、四条 L 形角标、`.cross` 准星、
  `.app-bg` 的网格/辉光/暗角。文件头注释逐条标了 `public/css/*` 的行号出处。
- **零 JS**：唯一交互是 `:hover`（按钮括号角标 + 描边变色）、`:focus-within`（地址框）、
  `:checked`（勾选框）。单文件、无外链字体/样式/图片。
- 主次：本机卡 = mint 描边 + 外发光 + 顶部高光条 + **实心主按钮**；服务器卡 = 普通描边、暗底描边按钮。

## 2. 文案清单

### 2.1 复用（原样搬，标出处）

| 稿子里的字 | 出处 |
| --- | --- |
| `卫戍协议` / `：` / `盟约` | `public/js/screens/title.js:261`（msgid，`public/i18n` 有包） |
| `设置` | `public/js/screens/title.js:278`（`aria-label` / `title`）；`public/i18n/en.json:157` |
| `RHODES ISLAND // SIMULATION SERVICE` | `public/js/screens/title.js:243`（装饰性英文 micro，原样） |
| `连接`（右卡主按钮） | `android/.../MainActivity.kt:1103`（`btnApply.text = "连接"`）。**注意**：`public/i18n` 里没有独立的 `连接` msgid，只有 `重新连接` / `立即重连` / `已连接服务器` |
| `例如: http://121.4.51.247/、100.127.8.41:3000 或 192.168.1.100:3000` | `android/.../res/values/strings.xml:8` `server_address_hint`。稿子只取其中第三例 → 占位 `例如: 192.168.1.100:3000`（示例格式原样，长度按卡片宽度截断） |
| `本机地址` | `android/.../MainActivity.kt:1070`（原文 `本机地址: 127.0.0.1 (未检测到可用网络，仅可单机)`） |
| `无需联网，本机运行独立 Node 引擎 · 进度完全保存在本地` | `android/.../MainActivity.kt:1076`（整句原样，用作左卡按钮下的灰字） |
| `这局怎么开始？` | `android/.../MainActivity.kt:1088`。**不显示**，只做 `<main>` 的 aria-label |
| `本机` / `服务器`（两个卡名） | 字面量仓库里处处都有（`title.js:158` `已连接服务器`、`lobby.js:832` `尚未连接到服务器`、`MainActivity.kt:1057` `本机可开服地址…`），但**当卡名用是新用法**，`handoff/desktop-electron/connect-ux.md §2.2/§2.3` 也是登记成新增的 |
| `LOCAL SERVER` / `REMOTE SERVER` | 新造的装饰性英文 micro（与 `title.js:243` 同款写法）。纯装饰、不进制、不进 i18n；若嫌多余可删，卡名中文已经够读 |

### 2.2 新造（**逐条列出，请先拍板再落 `t('…')`**）

| # | 确切字面量 | 用在哪 | 说明 |
| --- | --- | --- | --- |
| 1 | `启动本机` | 左卡主按钮 | 业主本次指定 |
| 2 | `在本机启动服务端并直接进入游戏。` | 左卡一句话 | 业主本次指定 |
| 3 | `端口` | 左卡小字行（`本机地址 127.0.0.1 · 端口 3000`） | 左卡这行 = 复用的 `本机地址` + 新的 `端口` 拼起来的 |
| 4 | `记住这个地址` | 右卡勾选框 | 业主本次指定 |
| 5 | `连不上会回到这一页，地址会留着，改完再点「连接」。` | 右卡灰字 | 新造。若嫌长可压成 `连不上会回到这一页，改完再点「连接」。` |
| 6 | `桌面端` | 页脚 `v0.3.3 · 桌面端` | 业主本次指定（**与 `connect-ux.md §5.1`「不打桌面端标识」冲突，见 §4.6**） |

> 只新造了 6 条，其中 4 条是业主指定的原话；真正算我拟的只有 #3 `端口`（词）与 #5 那句灰字。

## 3. 三档实测（puppeteer-core + 本机 Chrome，headless）

量法：`document.querySelector('.card')` 的 `getBoundingClientRect()`；溢出 = `documentElement.scrollWidth/Height`
超出 `clientWidth/Height`，以及每张卡自身 `scrollWidth/scrollHeight` 超出自身。

| 视口 | `1rem` | 左卡 rect (x, y, w×h) | 右卡 rect | 各占视口 | 两卡间距 | 文档溢出 | 卡内溢出 | 卡在视口内 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1920×1080 | 100 px | (170, 376.25) 768×383.78 | (982, 376.25) 768×383.78 | **40.00%** | 44 px | 无（1920×1080） | 无 | 是（右 1750 / 下 760.03） |
| 1280×720 | 66.67 px | (113.33, 249.88) 512×256.77 | (654.66, 249.88) 512×256.77 | **40.00%** | 29.33 px | 无（1280×720） | 无 | 是（右 1166.66 / 下 506.64） |
| 792×360 | 40 px（地板） | (73.2, 125.92) 316.8×124.88 | (402, 125.92) 316.8×124.88 | **40.00%** | 12 px | 无（792×360） | 无 | 是（右 718.8 / 下 250.8） |

- 三档**都是两卡并排、不换行**；792×360 是 `theme.css:141` 的 40px 地板，所以整页字很小（正文 ≈ 6.8 CSS px），
  溢出为 0 —— 这是仓库既有尺度，不是本稿特调。
- 两卡的**按钮在每个尺寸下都落在同一条水平线上**（1920: y=643.53 h=56；1280: y=428.67 h=37.33；792: y=210.83 h=22.39），
  因为按钮+灰字一起沉到卡底的 `.card__foot`（`margin-top:auto` + 一条 hairline 分界）。
- 卡高是 `min-height: 3.4rem` 与内容取大；`@media (max-height:400px)` 里把它取消，否则 792×360 下灰字会被压到描边上。

## 4. 需要业主拍板的设计点

1. **本机卡显示端口这件事本身**（业主已定要显示）：稿子把它写成只读的 `127.0.0.1 · 端口 3000`。
   但 `local-server.md §3.2` 的端口策略里，solo 是**可退避**的（3000 被占 → 3001…），
   真实现时这行要显示**实际端口**，写死 3000 会撒谎。要不要顺便把它做成可填？（手机端 ② 档是必须 3000）
2. **局域网可分享地址落在哪**（业主口径：局域网联机时才显示）。两卡结构里没有「开服」这一档了，
   所以要么左卡加一个 `允许同 Wi-Fi 加入` 开关（`connect-ux.md §2.2` 的做法，会多一行 UI + 新文案），
   要么等「启动本机」之后在游戏内进房间时再给地址。**本稿没画**，需要先定结构再补图。
3. **服务器卡要不要「最近使用」列表**（`connect-ux.md §2.3` 建议最多 5 条 + 清空）。
   本稿刻意留一屏干净：只有输入框 + 勾选框 + 按钮 + 一句灰字。加列表卡会高 ~0.6rem，
   1920 下仍放得下，但「空地址 + 列表」两件事同时出现会让右卡变成两个焦点。
4. **「记住这个地址」与既有方案的冲突**：`connect-ux.md §2.3` 的判断是「地址总是自动记住（手机也只存一份
   `KEY_REMOTE_URL`）→ 这一栏不需要『记住』复选框」。本次业主要复选框，稿子照画了；
   但实现时要先定语义：勾 = 写盘、不勾 = 只本次有效？否则会出现「存了但显示没勾」。
5. **主次要不要再加一个显式角标**：现在纯靠 mint 描边 + 发光 + 实心按钮区分默认档。若担心玩家看不出
   「点回车默认走本机」，可以在本机卡右上角加一个 micro 角标（如 `DEFAULT`）——那会多一条装饰文案。
6. **页脚 `v0.3.3 · 桌面端` 与 `connect-ux.md §5.1` 冲突**：那份方案明确写「不额外显示『桌面端』标识」
   （手机端也没有『手机端』角标，怕暗示两端功能不同）。本次业主指定要写，稿子按本次口径画。
   两条口径只能留一条，请裁决；裁决结果要回写 `connect-ux.md`，否则文档与稿子各说一套。
7. **左卡按钮下那句 `无需联网，本机运行独立 Node 引擎 · 进度完全保存在本地`**（复用手机端原句，不是新造）：
   加它是为了让两卡的「按钮 + 灰字」底部结构对称。若觉得超出口径，删掉即可，两卡按钮仍对齐。
8. **字体**：单文件不能引外链，标题的 `Novecento / Oxanium` 会 fallback 成系统中文字体（稿里已按
   `theme.css:105-109` 的栈写）。实现时走 `public/fonts/fonts.css` 的真字体，`本机` / `服务器` 两个字会更方更硬，
   比现在这张图更接近游戏内观感。

## 5. 复现方式

```bash
# 打开即看（无依赖、无 JS）
start handoff/desktop-electron/mock-choice.html
```

截图脚本是临时的（`tmp/mock-choice-shots.mjs`，已按要求删除）：`puppeteer-core` + headless Chrome
`C:/Users/J1825/AppData/Local/Google/Chrome/Application/chrome.exe`，对三种视口各 `page.setViewport()` →
`file://` 打开 → 截图 + `getBoundingClientRect()` 量两卡。写法参考 `devtools/render-check.mjs:12-27`。

---

## 二改

这一轮只动两样东西：`handoff/desktop-electron/mock-choice.html` 和 `handoff/shots/` 下的四张图。
仍然没碰 `public/**`、`data/**`、`server/**`、`test/**`，没有任何 git 写操作，临时脚本用完已删。

### 1. 四条反馈的落法

| # | 反馈 | 落法（CSS / 标记） |
| --- | --- | --- |
| 1 | 卡不够高（原 383.78 = 35.5%） | `.card { min-height: min(5.85rem, 54vh); padding: .5rem .38rem .42rem; gap: .24rem; justify-content: space-between; }`。四段（`__head` / `__desc`·`__meta` / `__field` / `__foot`）由 `space-between` 平分多出来的高度，段与段之间是**等距**的，不在末尾堆一块空白。`.card__foot` 的 `margin-top: auto` **必须删掉**——留着它会把全部余量吸到动作区那一条线上，`space-between` 就失效了。 |
| 2 | 服务器默认地址 | `<input id="remote-addr" value="https://wei.jiangjiangze.icu/" placeholder="例如: 192.168.1.100:3000">`。`value` 与 `placeholder` 并存：有 `value` 时浏览器不显示占位符，占位符仍留在源码里（实测输入框可见文本就是那个 URL）。输入框正下方新增 `.field__hint` 一行：`备用：http://121.4.51.247/`（12px @ rem 100，色 `--text-dim` `#5d6863`，与输入框内间距 `.1rem`，贴在框下面而不是被 `space-between` 拉开——它和输入框同属 `__field` 这一块）。 |
| 3 | 连接后不检测渲染 | 屏幕上**没有任何**「正在检查/渲染/校验」类文案（全文件 grep「检查」「正在」「渲染」只命中文件头注释里记录这条口径的那一句）。右卡灰字保持「连不上会回到这一页，地址会留着，改完再点「连接」。」——只讲失败回本页，不承诺任何加载后检查。 |
| 4 | 取舍已定 | 删掉「记住这个地址」勾选框，`.check*` 整套 CSS 一并删（实测 `querySelectorAll('.check, input[type=checkbox]').length === 0`）；页脚只留 `v0.3.3`；没有「最近使用」列表；没有「允许同 Wi-Fi 加入」开关（进房间后再给）。 |

### 2. 新增状态：右卡「连接中」

同一份 HTML、纯 CSS、零 JS（`document.querySelectorAll('script').length === 0` 仍然成立）。两条例路：

- **`data-state` 属性（业主说的那个变体）**：右卡 `<section class="card card--remote" id="remote-card" data-state="idle">`，
  把 `idle` 改成 `connecting` 就是连接中；
- **`#remote-card`（`:target` 兜底）**：直接打开 `mock-choice.html#remote-card`，截图脚本走的就是这条，人工对照也方便。

状态细节：按钮文案 `连接` → `连接中…`（两份 label 都在 DOM 里，只用 `display` 切换，所以不需要 JS）；
按钮转虚线描边、前景降到 `--text-lo`、去 hover 角标、`pointer-events: none`；左侧多一个 mint 圆环
`.spin`（900ms 匀速转）；输入框 `pointer-events: none`、文字降到 `--text-md`、`caret-color: transparent`、
所属 `.field__box` 描边回落到最弱一档且去掉聚焦光晕。**左卡一条规则都没加**，仍是实心主按钮、
`pointer-events: auto`。实测来回切：`border-style` solid→dashed→solid，`.btn__busy` none→flex→none，
左卡按钮 `pointer-events` 全程 `auto`。

> 需要实现方注意：静态稿只能用 `pointer-events` 表达「不可点/不可改」，真实实现要落到
> `button[disabled]` + `input[readonly]`（并给 `aria-busy="true"`）。截图里没有 aria 状态。

### 3. 三档新卡高（同一把尺：`getBoundingClientRect()`，deviceScaleFactor 1）

| 视口 | `1rem` | 左卡 rect (x, y, w×h) | 右卡 rect | **卡高 / 视口** | 两卡间距 | 文档溢出 | 卡内内容溢出 | 按钮 y（左/右） |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1920×1080 | 100 px | (170, 276.55) 768×**583.19** | (982, 276.55) 768×583.19 | **54.00 %** | 44 px | 无（1920×1080） | 无 | 727.23 / 727.23（h=56） |
| 1280×720 | 66.67 px | (113.33, 183.86) 512×**388.80** | (654.66, 183.86) 512×388.80 | **54.00 %** | 29.33 px | 无（1280×720） | 无 | 484.02 / 484.02（h=37.33） |
| 792×360 | 40 px（地板） | (73.2, 91.16) 316.8×**194.39** | (402, 91.16) 316.8×194.39 | **54.00 %** | 12 px | 无（792×360） | 无 | 240.17 / 240.17（h=22.39） |

- 目标区间核对：1920 要 560–600 → **583.19**；1280 要 375–400 → **388.80**；792 按比例 → **194.39**（54%）。三档都落在区间中段。
- 卡高的来源：16:9 下 `1rem` 恰好 = `vh/10.8`，所以 `min(5.85rem, 54vh)` 实际由 **`54vh`** 生效
  （583.2 / 388.8 / 194.4）；`5.85rem` 只是更宽或更窄比例时的护栏。792×360 触到 `theme.css:141` 的
  40px 地板后 `rem` 不再跟随 `vh`（`5.85rem` = 234 = 视口的 65%），必须靠 `54vh` 把比例兜回来——
  这就是上一版 `@media (max-height:400px)` 里 `min-height: 0` 那个补丁被删掉的原因。
- 段间距（等距，由 `space-between` 算出）：1920 左卡 3 个间隙 86.23 / 86.25 / 86.23，右卡 2 个 96.56 / 96.55；
  1280 左 57.30 ×3、右 63.92 ×2；792 左 28.63 ×3、右 29.33 ×2。左卡 4 段 3 间隙、右卡 3 段 2 间隙
  （右卡没有「说明」段：没文案可放，不为了对称新造一句），所以两卡的段间距不完全相同，但按钮仍在同一条 y 线上。

### 4. 两卡并排 / 不换行 / 无溢出

- 三档都是两卡并排、同一行（两卡 top 差 < 1px），各占视口宽 **40.00%**（768 / 512 / 316.8）。
- 文档无溢出（`scrollWidth/Height === clientWidth/Height`：1920×1080 / 1280×720 / 792×360）。
- 卡内无内容溢出（内容底边 = 卡片底边 − `padding-bottom` − 1px 描边；`.card--local::before` 那根顶部高光条
  按设计比卡片宽 2px，`overflow` 不裁剪，属装饰、不算内容溢出）。
- 792×360 横排宽度账：316.8 + 12 + 316.8 = 645.6 < 792，左右还各留 73.2 / 73.2。

### 5. 新造文案：**只有两处，都是业主本次指定的**

| # | 确切字面量 | 用在哪 | 备注 |
| --- | --- | --- | --- |
| 1 | `备用：http://121.4.51.247/` | 右卡输入框正下方极小灰字 | 业主本次指定。落 `t('…')` 时建议拆成 `备用：{url}`，URL 走数据不走文案；`备用：` 与 URL 在稿里分别是 `--font-cjk` 与 `.num` 两个字面（DOM 文本仍是这整串） |
| 2 | `连接中…` | 连接中状态的按钮 | 业主本次指定。省略号是单字符 `…`（U+2026），不是三个 `。` 或三个点；`public/i18n` 里没有这条 msgid，属新增 |

- **删掉的字面量**：`记住这个地址`（勾选框整块）、`桌面端`（页脚变 `v0.3.3`）。
- **没动的字面量**：`启动本机`、`在本机启动服务端并直接进入游戏。`、`本机地址` / `端口`、`连接`、
  `例如: 192.168.1.100:3000`（仍是 placeholder，有 `value` 时不显示）、左卡那句 `无需联网…`、
  `RHODES ISLAND // SIMULATION SERVICE`、卡名 `本机` / `服务器`、`LOCAL SERVER` / `REMOTE SERVER`。
- 除上表两条外，本轮没有新造任何句子；右卡那句灰字沿用首版的同一句，没有为了「不检测渲染」再改字。

### 6. 产出

```
handoff/desktop-electron/mock-choice.html          改（单文件、内联 CSS、零 JS、无外链）
handoff/desktop-electron/MOCK-CHOICE-2026-10-31.md 追加本节
handoff/shots/desktop-choice-1920x1080.png         重出
handoff/shots/desktop-choice-1280x720.png          重出
handoff/shots/desktop-choice-792x360.png           重出
handoff/shots/desktop-choice-connecting-1920x1080.png  新增（#remote-card）
```

复现：`start handoff/desktop-electron/mock-choice.html`；连接中状态用
`start "" "handoff/desktop-electron/mock-choice.html#remote-card"`，或把右卡的 `data-state` 改成
`connecting`。临时脚本 `tmp/mock-choice-shots.mjs`（截图 + 量卡）与 `tmp/mock-choice-gaps.mjs`
（量段间距 + 校验 `data-state` 切换）跑完即删。

### 7. 遗留（给实现/下一轮）

1. **792×360 的段间距偏大**（28.6px ≈ 0.72rem）：这是「卡高按视口比例」+「rem 触到 40px 地板」两条一起的
   必然结果——卡高 194px，正文只有 7.2px。嫌空只有两条路：允许小窗口不按比例（上一版 35%），或整体放大字号
   （会破坏 `theme.css:141` 的尺度唯一来源）。本稿选了按业主口径的比例。
2. 右卡比左卡少一段（没有「说明」），所以它是 2 个 96.56px 的间隙；要完全对称只能新造一句说明文案，本稿没加。
3. `连接中…` 之后的状态（成功/失败）没有画：失败按灰字回到本页，成功直接进游戏。要不要再补一张「连接失败」
   的提示条，等这个页面的错误提示口径定了再说。
4. 连接中状态的可访问性要靠真实现的 `disabled` / `readonly` / `aria-busy`，静态稿表达不了（已在上文标注）。

---

## 三改（克制版）

业主选 **A + C + D**（克制动效 + 编号角标 + 底图氛围），**不要插画、不要大图**。这一轮仍然只动两样：
`handoff/desktop-electron/mock-choice.html` 与 `handoff/shots/` 下的四张图。`public/**`、`data/**`、`server/**`、
`test/**` 一个字没碰；没有任何 git 写操作（`handoff/desktop-electron/` 仍是新增未跟踪）。临时脚本
`tmp/mock-choice-shots3.mjs` / `-probe3.mjs` / `-zoom3.mjs` 跑完已删，对照用的 `-alt` 图也删了。

### 1. 加了哪些层（6 处 CSS + 1 个媒体查询，没有插画、没有第二张图）

| # | 层 | 选择器 / 落点 | 参数 | 备注 |
| --- | --- | --- | --- | --- |
| A1 | 技术眉题 | `.card__top` > `.micro.micro--eyebrow` | `.11rem`、`letter-spacing .28em`、`--text-dim`（`#5d6863`）、`text-transform: uppercase` | 左 `LOCAL // SERVER`、右 `REMOTE // RELAY`；与 `RHODES ISLAND // SIMULATION SERVICE` 同一套 micro 写法（`title.js:243`）。左右都用 `--text-dim`（按口径），本机卡的 mint 识别靠描边/发光/实心按钮，不靠这行字 |
| A2 | 卡底极慢扫描线 | `.card__tex`（卡内最后一个元素） | `height: 42%`（实测 41.9%）、`opacity: .045`、`repeating-linear-gradient(0deg, #fff 0 1px, transparent 1px .12rem)`、`animation: card-scan 22s linear infinite`、`mask-image` 顶部淡入、`z-index: 0` | 位移量正好一个重复周期（`background-position: 0 0 → 0 .12rem`），所以无缝循环；实测 1.5 s 走 0.83 px（≈0.55 px/s @ rem=100）。垫在内容**下面**：`.card > :not(.card__tex) { position: relative; z-index: 1 }`，文字一个像素都没被压 |
| A3 | 本机卡 mint 呼吸光 | `.card--local` 的 `animation: card-breathe 4s ease-in-out infinite` | 只动那层 glow 的 alpha：`.18 ↔ .28`（`0 0 .42rem … .18` → `0 0 .52rem … .28`），1px 边框环与投影不动 | 关键帧里重复写了 `inset 0 1px 0 rgba(255,255,255,.06)`，否则动画会把 `.card` 的整条 `box-shadow` 覆盖掉（C 的顶光就没了）。实测采样 `.192 / .26 / .275 / .204`，确实在 `.18–.28` 之间往复 |
| C1 | 编号 | `.card__idx`（`.4rem`，792 档 `.34rem`） | `--text-dim` + `opacity: .55`，`font-family: var(--font-num)`、`line-height: .8` | `01` / `02` 压在眉题左侧（同一行的 flex，`align-items: center`），整行只有 `32 / 21.33 / 10.88` px 高，标题在其下方独立成行，不打架 |
| C2 | 内侧 1px 顶部高光 | `.card { box-shadow: inset 0 1px 0 rgba(255,255,255,.06), … }`（本机卡在 `card-breathe` 两帧里各写一次） | `inset 0 1px 0 rgba(255,255,255,.06)` | 四条 L 形角标（`.card::after`）保持原样，没动 |
| D1 | 整页氛围底图 | `.app-photo`（`.app-bg` 的子元素） | `opacity: .10`、`background: url(…) center / cover no-repeat` | 唯一一张位图，只引用现成资源，**没有复制文件** |
| D2 | 网格层（搬位置，不是新增装饰） | `.app-grid`（原 `.app-bg::before` 的网格，原样搬成一层真实元素） | 与二改逐字相同（`.045` 网格线 + 径向 mask） | 目的只有一个：让**网格叠在底图上面**。堆叠顺序变成 `.app-bg` 渐变 → 底图(10%) → 网格 → `::after`（扫描线 + 暗角） |
| — | 减动效 | `@media (prefers-reduced-motion: reduce)` | 关 3 处 `animation` + 3 处 `transition` | 见 §4 |

克制清单（这几件**没有**加）：没有插画、没有第二张图、没有刻度中线、没有新的分隔线/角标、没有第二处发光；
卡内四段结构、文案、位置与二改逐字一致；`792×360` 的媒体块只补了 `.card__idx` 字号与 `.card__top` 间距两行。

### 2. 底图用的哪张现有资源

**用的：`public/assets/local/map/autochess/TX_autochessi_BG.webp`**
（同一张的 PNG 版是 `…/TX_autochessi_BG.png`，1024×1024 混凝土/金属颗粒；webp 版 349 KB，故引 webp）。
CSS 里写的是相对路径 `../../public/assets/local/map/autochess/TX_autochessi_BG.webp`（稿子是 `file://` 打开的单文件，
相对路径最稳；接进 app 时换成 `/assets/local/map/autochess/TX_autochessi_BG.webp`）。**只引用路径，没有复制/转码任何文件。**

**口径偏差必须先说清：仓库里没有「大厅主图」位图。** 启动页/大厅底本来就是纯 CSS（`public/css/theme.css:285-316`
的 `.app-bg`：网格 + 辉光 + 暗角），`public/css/**` 里没有任何一条 `url(.../assets/...)` 的背景图。而 `ext-theme`
那两张都是**插画**，与本次「不要插画」直接冲突：

- `public/assets/annihilation-intro/art/crimson-knight.webp`（1920×1080 红黑角色插画，「不息恶火」主题主视觉）；
- `public/assets/zhajing-intro/art/zhajing-key.webp`（816×564 漫画黑白格）。

两张要么是角色插画、要么是高对比黑白网点，压到 10% 也仍是"一张图"，且红色主调与 mint 打架 —— 所以没选。
另外**试过并弃用** `public/assets/local/ui/battle/bg_type_01.png`（局内作战地图底：深色 + 经纬网格 + 十字准星）：
压到 10% 后页面**上半部会透出红色/青色斑块**，像屏幕脏点，有对照渲染为证（对照图已删）。

最后的取舍：选「卫戍协议自己的地图底材质」当纸底颗粒 —— 不是角色图、不是插画、本身是材质，10% 只加一层颗粒感，
不新增任何视觉重心。**如果业主要的其实是"主题感"而不是颗粒**，把 `.app-photo` 那一行 url 换成
`crimson-knight.webp` 即可（同一处、同一 opacity），但那就回到插画了，需要业者点头。

### 3. 三档实测（同一把尺：`getBoundingClientRect()`，deviceScaleFactor 1）

| 视口 | `1rem` | 左卡 rect (x, y, w×h) | 右卡 rect | 卡宽 | 卡高 / 视口 | 两卡间距 | 文档溢出 | 按钮 y（左 / 右） | 眉题行高 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1920×1080 | 100 px | (170, 276.55) 768×**583.19** | (982, 276.55) 768×583.19 | **40.00%** | **54.00 %** | 44 | 无（1920×1080） | 727.23 / 727.23（h 56） | 32 |
| 1280×720 | 66.67 px | (113.33, 183.86) 512×**388.80** | (654.66, 183.86) 512×388.80 | **40.00%** | **54.00 %** | 29.33 | 无（1280×720） | 484.02 / 484.02（h 37.33） | 21.33 |
| 792×360 | 40 px（地板） | (73.2, 91.16) 316.8×**194.39** | (402, 91.16) 316.8×194.39 | **40.00%** | **54.00 %** | 12 | 无（792×360） | 240.17 / 240.17（h 22.39） | 10.88 |

- **卡高与二改完全一致**（583.19 / 388.80 / 194.39 = 54.00%），因为 `min-height: min(5.85rem, 54vh)` 一个字符没动；
  新增的眉题行（32 / 21.33 / 10.88 px）被 `space-between` 的余量吸收，卡没有被撑高，也没被挤爆。
- **无溢出**：三档 `documentElement.scrollWidth/Height === clientWidth/Height`。
- 卡内那 **1 px** 的 `scrollWidth 767 vs clientWidth 766`（`scrollHeight 582 vs 581`）是**装饰伪元素**：
  `.card::after`（L 角标 `inset: -1px`）与本机卡 `.card--local::before`（顶部高光条 `left/right: -1px`）。
  探针验证：把 `.card__tex` 关掉数字不变（说明不是这次新加的层带来的），把 `.card::after` 关掉右卡就回到 766/581
  —— 二改也是这 1 px，没有变差，也没有任何内容被裁。
- 两卡按钮在每一档都落在同一条 y 线上（左右完全相等），地址/备用行、页脚位置均未变。

### 4. reduced-motion 是否生效：**生效**

`page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }])` 后的 computed 读数：

| 对象 | 默认 | reduce 下 |
| --- | --- | --- |
| `.card--local` | `card-breathe 4s` | `none` |
| `.card__tex` | `card-scan 22s` | `none` |
| `.spin`（连接中） | `spin 0.9s` | `none` |
| `.btn` transition-duration | `0.15s` | `0s` |

规则放在样式表最末尾（同优先级后者覆盖），关掉的是「呼吸 / 扫描线 / 转圈」三处动画与按钮、按钮角标、地址框三处过渡；
底图、网格、发光这些静态层保留（它们不动，不需要关）。

### 5. 新增字面量：**0 条**

- **中文：0 条新增、0 条改动**（正文可见文本与二改逐字一致：`启动本机` / `在本机启动服务端并直接进入游戏。` /
  `本机地址 127.0.0.1 · 端口 3000` / `地址` / `备用：http://121.4.51.247/` / `连接` / 两句灰字 / `v0.3.3`）。
- 新增的只有装饰性英文与序号：`LOCAL // SERVER`、`REMOTE // RELAY`、`01`、`02`。与
  `RHODES ISLAND // SIMULATION SERVICE`（`public/js/screens/title.js:243`）同款装饰 micro，不进 `t('…')`、
  不进 `public/i18n/**`，按口径**不算**。
- 净变化：旧的 `LOCAL SERVER` / `REMOTE SERVER` 被替换（改写，不是追加），所以字面量净增仍是 **0**。

### 6. 「不动的东西」逐条核对

| 约束 | 实测 |
| --- | --- |
| 卡高 `min-height: min(5.85rem, 54vh)` | 未改；三档实测 54.00% |
| 两卡各占宽 40% | 768 / 512 / 316.8 = 40.00% |
| 按钮同一水平线 | 727.23 = 727.23 / 484.02 = 484.02 / 240.17 = 240.17 |
| 默认地址 + 备用 | `input.value === "https://wei.jiangjiangze.icu/"`、`.field__hint === "备用：http://121.4.51.247/"` |
| 无「检查渲染」文案 | 全文只有文件头注释里记录这条口径的那一行，可见文本里 0 命中（`检查`/`渲染`/`正在`） |
| 页脚只 `v0.3.3` | `.start-foot` 文本 = `v0.3.3` |
| 无勾选框 / 无最近使用 / 无 Wi-Fi 开关 | `input[type=checkbox]` 与 `.check` 均 0；文本里 0 命中 `最近使用`/`Wi-Fi`/`WiFi`/`记住` |
| 零 JS | `<script>` 数量 0；连接中仍走 `#remote-card` 或 `data-state="connecting"`（实测 `busy:flex / idle:none / dashed / spin`，左卡按钮 `pointer-events: auto` 全程） |

### 7. 产出

```
handoff/desktop-electron/mock-choice.html                改（+ 本节）
handoff/desktop-electron/MOCK-CHOICE-2026-10-31.md       追加「## 三改（克制版）」
handoff/shots/desktop-choice-1920x1080.png               重出（含底图/眉题/编号/扫描线/呼吸）
handoff/shots/desktop-choice-1280x720.png                重出
handoff/shots/desktop-choice-792x360.png                 重出
handoff/shots/desktop-choice-connecting-1920x1080.png    重出（#remote-card）
```

复现：`start handoff/desktop-electron/mock-choice.html`；连接中状态 `start "" "…/mock-choice.html#remote-card"`
（或把右卡 `data-state` 改成 `connecting`）。截图 + 量卡用的是 `puppeteer-core` + 本机 headless Chrome
（`C:/Users/J1825/AppData/Local/Google/Chrome/Application/chrome.exe`），三档 `deviceScaleFactor: 1`，
写法沿用 `devtools/render-check.mjs:12-27`；临时脚本已删。

### 8. 遗留 / 需要业主看的

1. **底图不是「大厅主图」，仓库没有后者**（§2）。现在这张是地图材质；要真主题图只能是插画，需要业者明确破例。
2. **792×360 下眉题 4.4 px**，肉眼基本读不出（`.micro` 的尺度就是 4.4；二改那句 `LOCAL SERVER` 也是 4.4）。
   当纹理可以，当"信息"不行 —— 小窗要可读就得单独抬到 `max(8px, …)`，那会破坏 `theme.css:141` 的单一尺度，本稿没做。
3. **实装迁移提示**：呼吸只该作用在「纯 `box-shadow`」的那条规则上，别把 `.card--local::before` 的顶部高光条一起动
   （现在它不动）；扫描线层要留在内容下面（`z-index` 那一行不能省），否则会压字；`prefers-reduced-motion` 的块要
   原样搬进 `public/css/screens/title.css`（那里已有同类块，见 `lobby.css:1617-1621` 的写法）。
4. 底图体积：webp 349 KB / png 1.5 MB。静态稿是本地文件无所谓；接进 app 时它是 `/assets/...`，建议首屏文字先出、
   底图后挂（CSS `background-image` 本身不阻塞文字），别把它放进首屏关键路径。


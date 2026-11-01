# 炸惊局内三问审计（2026-10-29，只读）

范围：业主报的三个局内缺陷。本轮**只做静态定位与只读复跑**，没有改任何代码 / 数据 / 测试。
三个问题的结论都落在不同层，先给一张总表：

| # | 现象 | 一句话根因 | 严重度 | 建议动手处 |
|---|---|---|---|---|
| 1 | 买到的干员进整备区后位置不对 | 服务端 `hand` 按数据的 `benchSize=20` 建、从 idx 19 往左填；**客户端的整备区只有 10 个垫子、建造区只到 col 10**，idx 10..19 根本没有格子 | 高（前 10 个干员全画错位） | 客户端几何跟随 `benchSize`（`GEO.HAND_SIZE` 的 8 处硬编码），服务端不用改 |
| 2 | 我方惊变只能各刷新一次 | 服务端是「每卡一次」+ 一个 4 次的预算；`cards=3` 时预算**永远用不完**，`rerollsLeft` 停在 1 不下到 0，于是三张卡刷完后按钮仍全亮、点了被静默拒（BAD_TARGET），玩家感知成「只能各一次」 | 中 | 口径二选一（见 §2.4）：要么每卡一次 + 下发 per-card 标记，要么全局 4 次 |
| 3 | 两条炸惊专属策略溢出到湮灭 / 普通 | 服务端 `bandAllowed` **已经过滤**了 `zjOnly`；泄漏在客户端：`screens/bandDraft.js:274` 直接读原表 `gd.list('bands')`，只按 `modeTypeList` 过滤 | 中（可见但选中即被服务端拒） | 客户端一处（`bandDraft.js` 过 `officialBands()`），服务端零改 |

复跑用的都是仓库里既有的 harness，命令见每节的「验收」与 §4。

---

## 1. 干员购买后位置不正确（整备区 / 手牌落位错乱）

### 1.1 现状（文件:行）

服务端（这一层是对的，但决定了 idx 从 19 开始）：

- `server/match/PlayerState.js:229-238` —— 整备区的长度取**模式数据**：
  ```js
  this.hand = new Array(this.gd && this.gd.benchSize ? this.gd.benchSize : HAND_SIZE).fill(null);
  ```
  炸惊的 `mode_*.economy.benchSize` = 20（`data/config.json`），官方四档 / 湮灭没有 `economy` 覆盖块（`server/match/gamedata.js:101` 的 `DEFAULTS.benchSize: 10`），所以只有炸惊是 20 格。
- `server/match/board.js:247-251` —— 落位是**从右往左**（取最大的空下标）：
  ```js
  export function freeSlot(arr) {
    for (let i = arr.length - 1; i >= 0; i--) if (arr[i] == null) return i;
    return -1;
  }
  ```
- `server/match/player/acquire.js:43-67`（购买 → `acquireChess`）→ `server/match/player/pieces.js:76-91`（`stow`）→ 同一个 `freeSlot`。所以**第 N 个买到的干员落在 idx = 20 − N**。
- `server/match/player/placement.js:52-54` —— 服务端接受的手牌目标上界是 `this.hand.length`（炸惊 20），即 `g.move` 到 idx 0..19 都合法。

客户端（错的是这一层）：

- `public/shared/constants.js:79-88` —— 整备区宽度的**唯一来源**仍是一个常量：
  ```js
  HAND_ROW: 7, HAND_SIZE: 10,                      // hand slot idx = col 0..9
  ```
- `public/js/render/drag.js:32-38` —— 把 idx 直接当列号：`if (piece.area === 'hand' …) return { row: GEO.HAND_ROW, col: piece.idx };`，于是 idx 19 被画到 row 7 / col 19。
- 画面本身只建到 col 10：
  - `data/stages.json` 所有正常关卡的 `rows[7]` 都是 `"aaaaaaaaaa###########"` —— **10 个垫子（col 0..9）+ 11 个 `#` 墙块（col 10..20）**。
  - `public/js/render/board3d/layout.js:64-69` —— 建造区 `AREAS.normal` 是 `{ r0: 6, r1: 13, c0: 0, c1: 10 }`（联防 `unite` 才是 `c0: 0, c1: 20`）。**col 11..20 在单人的 prep 视图里根本不建**，`classifyStage` 里它们 `inArea === false`。
  - 结果：idx 11..19 的干员站在**场外（不存在的格子）**，idx 10 站在 row 7 的墙带上，都不是垫子。
- 客户端其它 8 处同样把「整备区 = 10 格」写死（补全一个不漏）：
  - `public/js/render/drag.js:53-61` `tileSlot`：`col < geo.HAND_SIZE` → col 10..19 **不是合法落点**（拖拽/高亮/悬停都拿不到）；
  - `public/js/render/app.js:1325-1327` `legalTiles`：手牌高亮只跑 `i < GEO.HAND_SIZE`；
  - `public/js/ui/gameLogic/placement.js:331`：`idx >= GEO.HAND_SIZE` → `no('BAD_TILE')`，所以**客户端自己就拒绝把手牌放到 idx 10..19**；
  - `public/js/ui/gameLogic/placement.js:346`：撤退找空位只数 `[...Array(GEO.HAND_SIZE).keys()]`，20 格时第 11 个空位看不见，可能误报「整备区已满」；
  - `public/js/ui/facing.js:237-246` `retreatSlot`：同上，只考虑 0..9；
  - `public/js/ui/fallbackField.js:380-387` 与 `:547`：2D 兜底视图只画 10 个 `ff-slot`；
  - `public/js/ui/gameLogic/shop.js:71-75` `handFull`：`hand.length >= GEO.HAND_SIZE && hand.every(p => p != null)` —— 因为 `hand.length` 是 20，`20 >= 10` 恒真，行为**恰好**对（满 20 才算满），属于「碰巧对」而不是读对；
  - `public/shared/protocol.js:527-532` `target()`：手牌目标校验 `isInt(v.idx, 0, GEO.HAND_SIZE - 1)` —— 目前**全仓无人引用**（grep `isTarget`/`target(` 只有这条定义与 announcement.js 里的同名局部变量），是潜在坑。
- 测试侧还有一处同源硬编码：`test/match/harness.js:191` 的 `legacyInvariants` 断言 `ps.hand.length === GEO.HAND_SIZE`，于是 `h.invariants()` 在任何炸惊局都会抛 `20 !== 10`（实测，见 1.2）。这也解释了为什么 `test/match/zhajing-e2e.test.js` 用 `collectViolations()` 而不是 `h.invariants()`。

### 1.2 期望 vs 现状（一张表说清「第 N 个应在哪格」）

实测（单人炸惊，真实 Match，真实 `g.buy`）：

```
gd.benchSize = 20 | hand.length = 20
buy chess_zj_01_a -> ok | hand idx: [19]
buy chess_zj_02_a -> ok | hand idx: [18,19]
buy chess_zj_03_a -> ok | hand idx: [17,18,19]
buy chess_zj_04_a -> ok | hand idx: [16,17,18,19]
g.move -> hand idx 15: ok        g.move -> hand idx 20: BAD_TARGET
```

| 第 N 个买到 | 服务端 idx（现状） | 客户端画在哪（现状） | 20 格整备区的期望落点 |
|---|---|---|---|
| 1 | 19 | row 7 / col 19 —— **场外**（单人 prep 只建到 col 10） | 最右一格（col 19 的垫子） |
| 2 | 18 | 场外 | col 18 |
| … | … | … | … |
| 10 | 10 | row 7 / col 10 —— row 7 的第 11 个字符是 `#`（墙带） | col 10 |
| 11 | 9 | 最右的**真垫子**（col 9） | col 9 ✓ |
| 20 | 0 | 最左的垫子（col 0） | col 0 ✓ |

也就是说：**服务端的 idx 与它自己的规则一致（右→左、20 格），错的是客户端只有 10 格几何**；前 10 次购买全落在没有垫子的地方，第 11 次开始才会「落回」垫子（而且顺序是反的，因为前 10 个占的是看不见的格子）。
官方四档 / 湮灭 `benchSize = 10`，N → idx = 10 − N，正好落在 col 9..0 的 10 个垫子上 —— 所以**只有炸惊会错位**，这也解释了为什么官方四档看起来一直正常。

### 1.3 根因

一句话：**`benchSize` 只在服务端起效，客户端的整备区宽度、建造区、落点判定、兜底视图全部还按 `GEO.HAND_SIZE = 10` 走**（`public/shared/constants.js:85` 是唯一的「真相源」，而它是个常量，不是模式数据）。

### 1.4 建议改法

按「谁拥有几何谁改」分四块，缺一块就还是错位：

1. **客户端宽度来源**（新增，最小）：在 `public/js/ui/gameLogic/shared.js`（或 `loadout` 之外的公共处）加
   `benchSizeOf(modeId)` = `data.get('config')?.modes?.[modeId]?.economy?.benchSize`，读法与 `public/js/ui/zhajingRules.js:47-53` 完全一致（`economy.benchSize` 优先、`mode.benchSize` 兜底），缺省 `GEO.HAND_SIZE`；由 `game.js` 在 `placeCtx` 里算一次，随 `ctx` / props 下发，**不要让渲染层直接读全局 config**（否则版本切换、数据未就绪时会闪）。
2. **落点与高亮**：`public/js/render/drag.js` 的 `pieceTile` / `tileSlot` / `dragStandTile` 加一个 `handSize` 参数（缺省 `GEO.HAND_SIZE`，官方路径逐字节不变）；`public/js/render/app.js:1325` 的循环上界换成 `ctx.handSize`。
3. **判定镜像**：`public/js/ui/gameLogic/placement.js:331/346` 与 `public/js/ui/facing.js:240` 用 `ctx.handSize`（`placeCtx` 里带上），并把 `public/js/ui/gameLogic/shop.js:74` 的 `hand.length >= GEO.HAND_SIZE` 改成 `hand.length`（`hand.length` 才是权威长度）。
4. **画面**：`public/js/render/board3d/layout.js:64-69` 的 `AREAS.normal.c1` 要放到 `max(10, benchSize - 1)`；`classifyStage`（`layout.js:163-237`，row 7 的 `a` 垫子来自 `data/stages.json` 的 `rows[7]`）需要按 `benchSize` 把 row 7 的 `#` 改画成 `a`。**注意 `data/stages.json` 是生成产物（`AGENTS.md`：不许手改 `data/*.json`）**，所以这一步要么在 `tools/build-data.mjs` 里按模式 `benchSize` 生成「加宽后的 row 7」，要么在 `layout.js` 的 `classifyStage` 里做一次客户端 override（不落数据）。后者改动面小、不动 golden，但把「垫子数」的真相又搬回客户端了；建议先做 override，等 `build-data` 有稳定的「模式级舞台覆盖」入口再收进数据。
   `public/js/ui/fallbackField.js:380/547` 同步换成 `handSize`（2D 兜底）。
5. **配套（不同文件也要一起改，否则又留一条腿）**：
   - `test/match/harness.js:191` 改成 `ps.hand.length === m.gd.benchSize`（顺手让 `h.invariants()` 能在炸惊局里用）；
   - `public/shared/protocol.js:530` 的 `target()` 目前是死代码，若将来启用，请改成读 `benchSize` 而不是 `GEO.HAND_SIZE`；
   - `public/studio/js/preview/field.js:142`（开发预览）可一并跟随。

### 1.5 风险 / 回归面

- **官方四档与湮灭必须逐字节不变**：所有改动都以「`handSize = 10`（缺省）时行为与今天完全一致」为前提；`benchSize` 只在炸惊的模式记录里有值。
- **golden 不受影响**：这是纯客户端几何 + `harness` 断言，不动 `server/sim/`、不动 `data/`，`test/golden/*.json` 不动。
- **动 `layout.js` 风险最高**：`classifyStage` 的产物被 `buildBoard`、`heightOf`、相机 `clearHud`、`projection` 一起读；垫子从 10 改 20 会改 prep 相机取景（`AREAS.normal.c1`），需要真机看一次手机横屏（`docs/EXTENSION_MODE.md` 里已有的取景口径）。
- `test/ui/*` 里以 `GEO.HAND_SIZE` 为断言的用例（`test/ui/bandDraft.test.js` 无；`public/js/ui/facing.js:240` 相关用例在 `test/ui/playtest6_*`/`facing` 系列）要跟着看一遍。
- 服务端**不需要**改任何一行；如果只在客户端修，服务端 idx 语义一点都不变，联机兼容。

### 1.6 可复跑的验收方式

```bash
# 现状（服务端 idx，任何一次改动都应该是这个值，不要变）
node --input-type=module -e "
import { makeMatch, DATA } from './test/match/harness.js';
const h = makeMatch({ mode: 'solo', difficulty: 'ZHAJING', humans: 1, bots: 0, seed: 7, fake: true }).start();
h.toPrep(1);
const m = h.m, ps = h.ps('p_0');
const ids = Object.values(DATA.chess).filter((c) => c.zhajing === true && !c.isGolden && c.tier === 1).slice(0, 4).map((c) => c.chessId);
ps.funds = 9999;
for (const id of ids) { ps.shop.slots[0] = { kind: 'chess', id, price: 0, basePrice: 0, sold: false }; m.handle('p_0', { t: 'g.buy', slot: 0 }); console.log(id, ps.hand.map((p, i) => (p ? i : null)).filter((x) => x !== null)); }
"
# 期望：gd.benchSize 20 / hand.length 20，idx 依次 19,18,17,16
```

修完的验收（新测试建议放 `test/ui/bench-size.test.js`，与 `test/ui/*` 的静态断言风格一致）：

1. 纯函数：`tileSlot({ row: 7, col: 19 }, { ...GEO, HAND_SIZE: 20 })` → `{ area: 'hand', idx: 19 }`；`pieceTile({ area: 'hand', idx: 19 })` 与 `benchSize=20` 时 → `{ row: 7, col: 19 }`。
2. 数据：`data/stages.json` 的每个正常关卡 `rows[7]` 里的 `a` 数量 === 该模式的 `benchSize`（或 layout override 输出同样的垫子数）。
3. 静态守卫：`public/js` 里 `GEO.HAND_SIZE` 只出现在「缺省值」位置（`grep -c` 从 8 处降到 ≤3 处，且都是 `?? GEO.HAND_SIZE`）。
4. `node test/match/zhajing-e2e.test.js`（BUG-1 那一组）仍绿；`node test/ui/ui-size.test.js` 全绿。

---

## 2. 我方惊变只能各刷新一次

### 2.1 现状（文件:行）

- `server/match/match/spDraft.js:137-161` `refreshSpCard(ps, idx)`：
  ```js
  const limit = Math.max(0, Math.trunc(Number(s.jibian.rerolls) || 0));
  const used = (s.rerolledBy[ps.playerId] ||= new Set());
  const closed = s.handTaken ? s.handTaken.has(idx) : s.taken[idx] != null;
  if (used.has(idx) || closed || !s.cards[idx]) return fail(ERR.BAD_TARGET);   // ← 每槽只能刷一次
  if (limit <= 0 || used.size >= limit) return fail(ERR.RATE);                  // ← 外加一个全局预算
  ```
  `used` 是**按 idx 记**的集合，所以同一张卡刷第二次必 `BAD_TARGET`（不是 `RATE`）。
- `server/match/player/basics.js:410-420` `jibianRerollsLeft()`：
  ```js
  const limit = … s.jibian.rerolls;
  const used = s.rerolledBy && s.rerolledBy[this.playerId];
  return Math.max(0, limit - (used ? used.size : 0));
  ```
  即 `4 − 已刷的槽数`，与 `refreshSpCard` 的 `limit` 同一口径。
- 数据：`data/config.json` 两个炸惊模式都是 `jibian: { cards: 3, rerolls: 4, … }`（**3 张卡、4 次预算**）。
- 客户端：`public/js/ui/jibian.js:91-99`（每张卡一颗键）：
  ```js
  disabled=${!(rerollLeft > 0) || rerollBusy != null}
  ```
  `rerollLeft` 来自 `public/js/screens/game.js:2046` 的 `jibianOwn.rerollsLeft`；`public/js/ui/jibian.js:204-210` 里三张卡拿的是**同一个** `rerollsLeft`，卡片自己「刷过没有」客户端完全不知道。
- 卡片的公开视图里没有标记：`m.public.sp.cards[i]` 的键是 `["idx","kind","id","name","desc","tier","rarity","flavor","soldOut"]`（实测），没有 `rerolled`。

实测（单人炸惊，干净草稿，逐步调用 `g.cardRefresh`）：

```
phase SP_DRAFT cards 3 rerolls(data) 4 left 4
refresh idx 0 -> ok            | left 3
refresh idx 0 -> BAD_TARGET    | left 3      ← 同一张第二次
refresh idx 1 -> ok            | left 2
refresh idx 2 -> ok            | left 1      ← 三张都刷过了
refresh idx 0 -> BAD_TARGET    | left 1
refresh idx 1 -> BAD_TARGET    | left 1      ← 预算还剩 1，但没有任何卡可刷
```

于是玩家看到的正是那句话：**每张卡只能刷一次**；而界面上的数字是 4/3/2/1（三张卡都刷完也下不到 0 → 三颗键仍然全亮），再点就静默被拒（`BAD_TARGET`，`ui/gameActions.js` 的 act 只弹一句通用提示）。

### 2.2 参考包的口径（modref v2.1）

`modref/v2.1/server/match/match/spDraft.js:416-470` `spReroll`，注释是这条线的决策史，逐条：

- `:417-422` 原始口径：一次刷新、花掉预算 `config.modes[*].jibian.rerolls`。
- `:443`（2026-10-13 用户口径）：**重投预算整局共用** `ps.spRerollsUsed`，不是每阶段各 4 次。
- `:444-449`（2026-10-19 owner）：**改成「每张卡各能刷新一次」**，`s.rerolled` 记刷过的槽，预算「仅作为每卡次数 = 1 的兜底」（`const perCard = Math.max(1, Number(budget) || 1); void perCard;` —— 这行是死代码）。
- `:463-466`：换上的新卡打上 `card.rerolled = true`（**给客户端用**），`ps.spRerollsUsed` 只做统计。
- 参考包的数据同样是 `cards: 3, rerolls: 4`（`modref/v2.1/data/config.json`），也就是说**参考包自己也有「预算 4 / 卡 3 张」这个矛盾**，只是它靠 `card.rerolled` 把「这张刷过了」画在客户端上。
- 参考包的客户端读的是**公开视图上的** `sp.rerollLeft`（`modref/v2.1/public/js/ui/gameLogic/draft.js:72`），而我们的 `m.public.sp` 没有这个字段（本项目改用 `m.private.jibian.rerollsLeft`，见 `handoff/ZHAJING-SPLIT-2026-10-28.md:361-363`）。

### 2.3 结论：现在混了两套口径

| 口径 | 现状 | 后果 |
|---|---|---|
| 每张卡各一次（参考包 2026-10-19 的最终规则） | 服务端做到了 | 是对的，但**没告诉客户端哪张刷过了** → 每张卡的键永远亮着 |
| 全局 `rerolls = 4` 次（参考包 2026-10-13，也是 `data` 里的数字） | 只剩 `used.size >= limit` 一道死闸（4 > 3 永远不触发） | 数字骗人：显示 4/3/2/1，实际最多刷 3 次，且第 4 次无处可花 |

### 2.4 正确口径与修复点（二选一，必须选一个）

**口径 A（沿用参考包 2026-10-19 / 官方「每张卡一次」，推荐）**：把「刷过没有」下沉到协议里。
- 服务端 `server/match/match/spDraft.js:156` 把新卡写成 `{ ...next[0], idx, family: 'jibian', rerolled: true }`（参考包 `:463` 原样），并在 `_dealJibianFor`（`:74-86`）里对每张卡补 `rerolled: false`，让 `m.public.sp.cards[*].rerolled` 恒在。
- 服务端 `server/match/player/basics.js:414-420` `jibianRerollsLeft()` 的语义改成「**还能刷的卡数**」= `s.cards.filter(c => !c.rerolled).length`（而不是 `4 − used.size`），这样数字 3→2→1→0 与真实可点次数一致；`data` 的 `rerolls` 就不再进 UI（仍可留作参考包的兼容字段）。
- 客户端 `public/js/ui/jibian.js:94-97` 的 `disabled` 加上 `card.rerolled === true`，并把该卡的计数位换成「已重抽」文案（或直接不画这颗键）；`jibian.js:204-210` 的 `mayReroll` 里也加 `&& !card.rerolled`。
- `refreshSpCard` 里 `used.size >= limit` 那行可以删（或保留成 `limit` 次的上限，`limit` 改成 ≥ 卡数），注释同步改掉「预算」的说法。

**口径 B（全局 4 次、任意卡可重复刷）**：把每槽一次的闸拿掉。
- `spDraft.js:150` 的 `used.has(idx)` 换成 `used` 改成计数器（例如 `s.rerollsBy[pid] = n`），只保留 `if (s.rerollsBy[pid] >= limit) RATE`；`basics.js:414-420` 相应改成 `limit − 次数`。
- 客户端不用改（现在的 `disabled = rerollsLeft <= 0` 正好对上），4 次能真的花完、按钮会正常变灰。
- 代价：与参考包 2026-10-19 的裁决相反；`data` 的 4 次也就名副其实了。

两个口径都改完必须同步 `test/match/zhajing-refresh.test.js:64-74` —— 它现在钉的正是「同一槽第二次 BAD_TARGET」+「把 `rerolls` 钉成 1 才触发 RATE」，文件里 `:69` 的注释已经写明「真实数据是 4，槽位只有 3，按槽位会先撞 BAD_TARGET」。选 A 改为断言 `cards[i].rerolled === true` 与 `rerollsLeft` 递减到 0；选 B 改为断言同一槽能连刷两次、第 5 次 RATE。

### 2.5 风险 / 回归面

- 协议面：口径 A 会往 `m.public.sp.cards` 加一个字段 `rerolled`，客户端 `normalizeSp`（`public/js/ui/jibian.js` 里的卡片归一）需要容忍缺字段（老服务端）。
- `test/match/zhajing-refresh.test.js`、`test/match/zhajing-mode.test.js:421`（`ps.jibianRerollsLeft() === 0`）会跟着口径变；`test/zhajing-flow.test.js:338` 的 `Object.keys(zpriv.jibian)` 字段集（`cards/owned/rerollsLeft`）不受影响。
- `test/ui/zhajing-panels.test.js:224-241` 用合成 `rerollsLeft` 画浮层，口径 A 下要补一条「刷过的卡键是灰的」。
- 不涉及战斗模拟，golden 不动。

### 2.6 可复跑的验收方式

```bash
node test/match/zhajing-refresh.test.js     # 现状 6 条全绿；改口径后必须一起改
node --input-type=module -e "
import { makeMatch } from './test/match/harness.js';
const h = makeMatch({ mode: 'solo', difficulty: 'ZHAJING', humans: 1, fake: true }).start();
h.toPrep(1);
const m = h.m, ps = h.ps('p_0');
ps.effects = ps.effects.filter((e) => !e || !e.jibian); m.round = 1; m.enterSpDraft();
for (const idx of [0, 0, 1, 2]) console.log(idx, JSON.stringify(m.handle('p_0', { t: 'g.cardRefresh', idx })), 'left', ps.jibianRerollsLeft());
console.log('card keys', Object.keys(m.publicView().sp.cards[0]).join(','));
"
# 现状：ok / BAD_TARGET / ok / ok，left 3,3,2,1；cards 无 rerolled
# 口径 A 的期望：left 2,2,1,0（数字=还能刷的卡数），cards 带 rerolled，刷过的卡在 UI 上变灰
# 口径 B 的期望：ok / ok / ok / ok → 第 5 次 RATE，left 3,2,1,0
```

---

## 3. 两个炸惊特有策略溢出到湮灭与普通模式

### 3.1 是哪两条（`data/bands.json`）

| bandId | 名字 | effectId | effectName | `modeTypeList` | `zjOnly` |
|---|---|---|---|---|---|
| `band_zj_fuuka` | 山岸风花 | `aceffect_band_zj_fuuka` | 神通法 | `["SINGLE","MULTI"]` | `true` |
| `band_zj_si` | 祀 | `aceffect_band_zj_si` | 长兄如父 | `["SINGLE","MULTI"]` | `true` |

全表 42 条，`zjOnly: true` 就这两条（`annOnly` 为 0 条）。注意它们的 `modeTypeList` **包含** SINGLE / MULTI —— 这就是客户端只按 `modeTypeList` 过滤时会漏的原因。

### 3.2 服务端：**已经过滤了**（逐行）

`server/match/gamedata.js:1334-1348`：

```js
  /** Band usable in this mode type. */
  bandAllowed(bandId) {
    const b = this.band(bandId);
    if (!b) return false;
    // 惊变专属策略（data/bands.json `zjOnly: true`，例如「祀」）：只在炸惊模拟里出现（其他难度完全看不到）
    if (b.zjOnly === true && !this.zhajing) return false;          // ← 1339：这一行就是闸
    const list = Array.isArray(b.modeTypeList) ? b.modeTypeList : null;
    if (!list) return true;
    return list.includes(this.isSolo ? 'SINGLE' : 'MULTI');
  }

  bandIds() {
    const bands = this.raw.bands && typeof this.raw.bands === 'object' ? this.raw.bands : {};
    return Object.keys(bands).filter((id) => this.bandAllowed(id))  // ← 1347：bandIds 全部过 bandAllowed
      .sort((a, b) => numOr(bands[a].sortId, 99) - numOr(bands[b].sortId, 99) || (a < b ? -1 : 1));
  }
```

下游也都走这条闸，所以**服务端不会真的让非炸惊局用上这两条**：

- `server/match/match/phases.js:221-229` `pickBand`：`if (typeof bandId !== 'string' || !this.gd.bandAllowed(bandId)) return fail(ERR.BAD_TARGET);`
- `server/match/match/phases.js:210-219` `bandFocus`、`:231-242` `_applyBand`、`:234` 同一条判据；
- `server/match/audit.js:316`：`if (!ps.bandId || !gd.bandAllowed(ps.bandId)) fail(...)`（每帧不变量）；
- 机器人 / AI 只从 `gd.bandIds()` 取（`server/match/bot.js:194`、`server/match/aiDigest.js:52`、`server/match/botIoleta.js:36`）。

服务端的唯一「缺口」不是过滤，而是**它从不把权威策略列表发给客户端**：`server/match/match/views.js:194-198` 的 `v.draft` 只有 `order / turn / picks / skipsLeft / turnDeadline`。客户端画哪 42 条，全靠它自己读数据表。

### 3.3 客户端泄漏点：`screens/bandDraft.js:274`

```js
const bands = useMemo(() => allowedBands(gd.list('bands'), mode?.type || (solo ? 'SINGLE' : 'MULTI')), [gd.ready, mode?.type, solo, data.locale(), data.contentId()]);
```

- `gd` 来自 `useGameData()`（`public/js/ui/gameComponents.js:28-33`），它只是 `data.js` 的查找表包装，**没有 GameData 的任何模式过滤**；
- `allowedBands`（`public/js/screens/bandDraft.js:79-84`）只按 `modeTypeList` 过滤：
  ```js
  .filter((b) => b && (!modeType || !Array.isArray(b.modeTypeList) || b.modeTypeList.includes(modeType)))
  ```
  → `zjOnly` 的两条在 SINGLE / MULTI 里全部通过。

实测（同一次进程里对比服务端 `bandIds()` 与客户端 `allowedBands(gd.list('bands'))`）：

```
mode_single_normal      | server 40 | client 42 | leak ["band_zj_fuuka","band_zj_si"]
mode_multi_normal       | server 40 | client 42 | leak ["band_zj_fuuka","band_zj_si"]
mode_single_annihilation| server 40 | client 42 | leak ["band_zj_fuuka","band_zj_si"]
mode_single_zhajing     | server 42 | client 42 | leak []
```

也就是说：**普通（单人/同盟）与湮灭的策略草稿里，会多出「山岸风花」「祀」两张卡**；选中它们服务端会 `BAD_TARGET`（`phases.js:225`），玩家体验成「点了没反应」。这同时也是 `test/match` 里 audit 不会报错的原因（服务端从头到尾没接受过它们），所以只有真机点一下才看得见。

### 3.4 全仓「绕过 GameData 直读 bands」的清单

| 文件:行 | 用途 | 是否泄漏 / 结论 |
|---|---|---|
| `public/js/screens/bandDraft.js:274` | **策略草稿的可选列表** | **泄漏点**：直接 `gd.list('bands')`，只过 `allowedBands` → 见 §3.3 |
| `public/js/screens/bandDraft.js:384` | 战绩徽章 `draftRecords(…, data.get('bands'))` | 无 UI 泄漏（只按已有战绩聚合） |
| `public/js/screens/stats.js:405` | 成就 `strategyBadgeIds(records, data.get('bands'))` | 同上，records 驱动 |
| `public/js/screens/stats.js:442-465` `Bands` | 统计页「盟约&策略」表 | 只列 `agg.bands` 里出现过的（炸惊玩家自己的战绩），可接受；如果想严格按模式分表再说 |
| `public/js/screens/sweep.js:204` | S.W.E.E.P. 策略报告（局内） | **已过 `officialBands(data.list('bands'), m?.modeId ?? m?.difficulty)`** ✓ |
| `public/js/screens/sweep.js:420` | S.W.E.E.P. 策略报告（无 room 上下文的那一处） | **反向 bug**：`officialBands(…, null)` → 永远按官方过滤，于是**炸惊房里这两条反而看不到**；应传 room 的 `modeId` |
| `public/js/battle/observe.js:184` | 效果图标反查 `data.list('bands').find(b => b.effectId === pe.id)` | 只做图标解析，且只有该效果在场时命中；不是列表，无泄漏 |
| `public/js/ui/zjView.js:69-76` | `officialBands(list, modeId)` 本体 | 这是**正确的出口**，应该被 `bandDraft.js` 复用 |

`public/js/ui/zjView.js:1-12` 的文件头已经把这条教训写给盟约了（「…`list('bands')`，那条路绕过了 GameData —— 于是官方房间的『本局信息 / 盟约列表 / 卡池总览 / 战绩报告』会多出…」），策略侧只是漏了一处。

现有守卫为什么没抓到：`test/ui/zj-bonds-view.test.js:107-125` 的 `bandSites` 只列了 `public/js/screens/sweep.js` 一个文件，而且匹配的是字面量 `officialBands(data.list('bands')` —— `bandDraft.js` 用的是 **`gd.list('bands')`**（没有 `officialBands`），两种写法都不在断言里。

### 3.5 修法（客户端一处 + 服务端零改）

1. **客户端（必须）** `public/js/screens/bandDraft.js:274`：
   ```js
   const bands = useMemo(() => allowedBands(
     officialBands(gd.list('bands'), pub?.modeId ?? pub?.difficulty),
     mode?.type || (solo ? 'SINGLE' : 'MULTI'),
   ), [gd.ready, mode?.type, solo, pub?.modeId, pub?.difficulty, data.locale(), data.contentId()]);
   ```
   `officialBands` 从 `../ui/zjView.js` 引入（该文件已按 `modeId`/`difficulty` 三态过滤：官方与湮灭只留无旗标的，炸惊额外放行 `zjOnly`）。注意依赖数组里补上 `pub?.modeId` / `difficulty`，否则换房不重算。
2. **客户端（顺手，反向 bug）** `public/js/screens/sweep.js:420`：把 `null` 换成当前 room 的 `modeId ?? difficulty`（与同一文件 `:204` 的写法对齐），让炸惊房里这两条专属策略在报告里正常出现。
3. **服务端**：不改。`bandAllowed` 与 `bandIds()` 已经是对的，而且 `g.band` 会在 `phases.js:225` 二次拦截。**建议不要**为了「防泄漏」在服务端加新过滤——那会让炸惊那两条也一起消失（`bandIds()` 是同一个闸）。
4. **顺手把死代码标清楚**：`public/shared/protocol.js:527-532` 与本次无关，但 `public/js/render/...` 那批 `GEO.HAND_SIZE`（§1）才是同类「共享常量当模式数据用」的坑，建议一起排进计划。

### 3.6 能钉死它的测试建议

在 `test/ui/zj-bonds-view.test.js:120-125` 那个守卫里补两件事（同一文件、同一风格，最小改动）：

```js
// 1) 接线：策略草稿的可选列表必须过 officialBands（不只是 sweep.js）
const bandSites = [
  ['public/js/screens/sweep.js', "officialBands(data.list('bands')"],
  ['public/js/screens/bandDraft.js', "officialBands(gd.list('bands')"], // ← 新增
];
// 2) 行为：客户端列表 == 服务端 bandIds()（真数据，四种模式）
for (const [modeId, want] of [['mode_single_normal', 40], ['mode_multi_normal', 40], ['mode_single_annihilation', 40], ['mode_single_zhajing', 42]]) {
  const gd = new GameData(DATA, modeId);
  assert.equal(gd.bandIds().length, want);
  const clientList = allowedBands(officialBands(Object.values(DATA.bands), gd.mode.type …), gd.isSolo ? 'SINGLE' : 'MULTI');
  assert.deepEqual(clientList.map((b) => b.bandId), gd.bandIds(), `${modeId}: 客户端草稿列表必须与服务端一致`);
}
```

更稳的一条（不依赖客户端实现细节）：在 `test/match/zhajing-mode.test.js` 加

```js
assert.equal(new GameData(DATA, 'mode_single_normal').bandIds().includes('band_zj_si'), false);
assert.equal(new GameData(DATA, 'mode_single_annihilation').bandIds().includes('band_zj_fuuka'), false);
assert.equal(new GameData(DATA, 'mode_single_zhajing').bandIds().includes('band_zj_si'), true);
```

并在 `test/ui/bandDraft.test.js` 里对纯函数 `allowedBands` 补一条「接的是 `officialBands` 的输出时，普通模式只剩 40 条」。

### 3.7 可复跑的验收方式

```bash
node test/ui/zj-bonds-view.test.js     # 现有 40/42 断言已绿（它测的是 zjView 本身，不是接线）
node test/ui/bandDraft.test.js         # allowedBands 的排序 / 模式过滤
node test/data.test.js                 # 数据侧 42 条 + zjOnly 两条的口径（:242）
# 复核泄漏（上面 3.3 的实测命令）
node --input-type=module -e "
import { DATA } from './test/match/harness.js';
import { GameData } from './server/match/gamedata.js';
const bands = Object.values(DATA.bands);
const allowedBands = (l, t) => l.filter((b) => b && (!t || !Array.isArray(b.modeTypeList) || b.modeTypeList.includes(t)));
for (const modeId of ['mode_single_normal','mode_single_annihilation','mode_single_zhajing']) {
  const gd = new GameData(DATA, modeId);
  const cli = allowedBands(bands, modeId.includes('multi') ? 'MULTI' : 'SINGLE').map((b) => b.bandId);
  console.log(modeId, 'server', gd.bandIds().length, 'client', cli.length, 'leak', JSON.stringify(cli.filter((id) => !gd.bandIds().includes(id))));
}"
# 现状：普通 40 / 42 / ["band_zj_fuuka","band_zj_si"]；湮灭 40 / 42 / 同上；炸惊 42 / 42 / []
```

---

## 4. 本轮复跑记录（只读）

| 命令 | 结果 |
|---|---|
| `node --input-type=module -e "…makeMatch({difficulty:'ZHAJING'})…g.buy…"` | `gd.benchSize = 20`、`hand.length = 20`，购买 4 次 → idx `[19] [18,19] [17,18,19] [16,17,18,19]`；`g.move→15 ok`、`g.move→20 BAD_TARGET`；`h.invariants()` 抛 `20 !== 10`（`test/match/harness.js:191`） |
| `node --input-type=module -e "…m.enterSpDraft()…g.cardRefresh"` | `left 4→3→2→1`，同槽第二次与「三张刷完后再点」都是 `BAD_TARGET`；`m.public.sp.cards[0]` 无 `rerolled` 字段 |
| `node --input-type=module -e "…GameData…bandIds() vs allowedBands"` | 普通单人/同盟 40 vs 42、湮灭 40 vs 42、炸惊 42 vs 42；泄漏恒为 `band_zj_fuuka` + `band_zj_si` |
| `node -e "…data/stages.json rows[7]"` | 13 个关卡里 11 个是 `"aaaaaaaaaa###########"`（10 垫 + 11 墙），`act1autochess_m04` 是 `"aaaaaaaaaa#XXXXXXXXXX"`，两个 escaped 关卡整行为 `#` |

没有跑需要 Chrome / 起服务端的 e2e（`devtools/render-check-*`），本节结论全部来自静态定位 + Node 直跑。

## 5. 归属边界（给下一轮排期用）

- §1 全部落在 `public/js`（渲染 + 交互 + 兜底）+ 一条测试助手断言（`test/match/harness.js:191`）；`server/` 不动、`data/` 不动（若要把 20 个垫子写进舞台数据，则必须走 `tools/build-data.mjs`，不许手改 `data/*.json`）。
- §2 落在 `server/match/match/spDraft.js` + `server/match/player/basics.js` + `public/js/ui/jibian.js` + `test/match/zhajing-refresh.test.js`；**要先由业主定口径 A / B**，两者对 `data` 的 `jibian.rerolls` 解释不同。
- §3 落在 `public/js/screens/bandDraft.js`（一行 + 依赖数组）+ 可选 `public/js/screens/sweep.js:420` + `test/ui/zj-bonds-view.test.js` 的守卫名单；服务端零改，别去动 `bandAllowed`。

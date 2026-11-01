# 多人房局内：删除左侧大名单 `.team`（几何实测 · 修前 / 修后）

- 日期：2026-10-31 22:41–22:47（本地时区）
- 证据：`handoff/shots/hud-noteam.json`（本轮修前 / 修后两遍的逐帧 rect、交叠面积、DOM 计数、行内文字）与本报告 §8 的 13 张图
- 方法：真服务端（`test/e2e/fastServer.mjs` 的钩子：`timerScale 1, combatSpeed 2, startRound 3, idleBots, autoPlace,
  SP_START_KITS=UNITE_HOST_KIT`）+ `test/e2e/client.mjs` 的 `Client`（puppeteer-core + 本机 headless Chrome，DPF=1）。
  每个房间 1 个真浏览器（房主）+ N−1 个服务端 AI（`room.addBot`）；同一局同一帧只 `page.setViewport()` 换视口，不 reload、
  不传 `isMobile`/`hasTouch`，每次换完等两帧 `requestAnimationFrame` + 520 ms。交叠面积一律
  `max(0, min(a.right,b.right) − max(a.left,b.left)) × max(0, min(a.bottom,b.bottom) − max(a.top,b.top))`。
  本轮房间：12 人 `EPXN`、8 人 `HAAC`、4 人 `LKZR`（修前基线：`QESU` / `BKTY` / `LPBE`，同一台机器同一套脚本）。
- 红线：无 git 写；不新增 msgid（本次没有新增任何 `t('…')`）；4 人房与既有模式的 DOM/CSS 未改。

## 0. 结论

| # | 判据 | 修前 | 修后 |
| --- | --- | --- | --- |
| 1 | 多人房（8 / 12）局内有没有 `.team` | 有（`.gm__hud` 第 3 个子元素 `team`，12 人房 792 下 rect `104 → 182.78 × 94.39 → 539.92`，一直排到视口外） | **没有**（`.team` 计数 **0**、`.gm__hud` 子元素里没有 `team`；`isMultiRoom(pub) ? null : <TeamPanel>`，不是 `display:none`） |
| 2 | 队伍框贴边 | `left = 8`（792）/ `20`（1920），但旁边是被右移的大名单 | `left = 8` / `20`，左栏只有这一列，**不再有任何让位规则** |
| 3 | 联防条左缘 | `232`（792）/ `580`（1920）= 5.8rem（给 `.team` 加徽标后的宽度让位） | **`144` / `360`** = **3.6rem**（队伍框右缘 96 / 240 之右，无需再让） |
| 4 | 交叠（队伍框列 + 每个可见框 × 6 个既有元素 + `gtop`） | 全部 0.00（靠右移 `.team` 换来的） | **全部 0.00**（`.team` 不存在，靠删掉那份面板换来的） |
| 5 | 4 人房 | `.team` 正常挂载，`8.80 → 85.78 × 94.39 → 239.17`（792）、`22 → 214.48 × 236 → 598`（1920） | 同上（DOM / class / 计数逐项相同；见 §6） |

## 1. 落点（文件:行）

| 落点 | 内容 |
| --- | --- |
| `public/js/ui/multiHud.js:27–36` | 新增 `isMultiRoom(pub)`：`(Number(pub?.maxSeats) \|\| 0) > 4`。**一个门**：`.gm` 根的 `has-multi` 与 TeamPanel 的挂载共用它 |
| `public/js/ui/multiHud.js:111` | `if (!pub \|\| !isMultiRoom(pub)) return null;`（原 `capacity > 4`，行为相同） |
| `public/js/ui/multiHud.js:12–16` | 文件头：删掉「让位」段，写明多人房左栏只有队伍框、`.team` 不挂载 |
| `public/js/screens/game.js:98` | `import { MultiHud, isMultiRoom } from '../ui/multiHud.js';` |
| `public/js/screens/game.js:1965` | `.gm` 根 class：`isMultiRoom(pub) && 'has-multi'`（4 人房该表达式仍为 `false`，class 串不变） |
| `public/js/screens/game.js:2010–2015` | **`.team` 的处置点**：`${isMultiRoom(pub) ? null : html\`<${TeamPanel} … />\`}` —— 多人房整棵 vnode 是 `null`，8/12 人房**不挂载** TeamPanel；4 人房走原分支，props 一个不少 |
| `public/css/screens/multi-hud.css:19–20` | 联防条注释：左缘 = 队伍框列右边（3.6rem）；规则体 `left: 3.6rem` 未动（上一单的 5.8rem 覆盖已删） |
| `public/css/screens/multi-hud.css`（原 37–40 行整段删除） | 删掉 `.gm.has-multi .team { left: 2.6rem; }` 与 `.gm.has-multi .gm-unite { left: 5.8rem; }` |
| `public/css/screens/multi-hud.css:37–38` | 左栏注释改成「多人房里左栏只有这一列：大名单 `.team` 不再挂载」 |
| `test/ui/multi-hud.test.js` | 13 例：新增 `isMultiRoom` 门、`.team` 不挂载（源码契约 + 4 人房 props 逐条保留）、交叠契约（x8 / 列右缘 < 联防条左缘 / 三号框展开不越 `.gm__corner` 的算术）；CSS 契约改成「不再让位」；`capacity > 4` 断言随实现改写 |

## 2. `.team` 的处置方式与原因

**处置：多人房不挂载（渲染处条件返回 `null`），不是 `display:none`，也没有 CSS 藏。**

- 判据就是容量本身：`m.public.maxSeats > 4`（8 / 12 人房；4 人房的服务端 `room.state` 根本不带宽容量键）。
- 放在渲染处（`game.js:2012`）而不是 CSS：`TeamPanel` 的 hooks（`openPid` 状态、`useEffect`、emote 气泡、双击计时
  `askedAt`）随之完全不运行；DOM 里也没有 `.team`（实测 `gmCounts['.team'] = 0`、`.gm__hud` 子元素没有 `team`）。
- 4 人房必须原样：三元的一支是 `null`、另一支仍是同一个 `<${TeamPanel} …>` 与同一串 props（单测逐条守着），
  `isMultiRoom` 在 4 人房返回 `false`，所以输出与从前一致。

**为什么可以先删（这块面板同时承担的职责，读代码后的清单）**：`ui/teamPanel.js` 一个组件承担了 6 件事 ——
① 12 行成员名单（头像 / P# / AI 徽标 / 自己标记）；② 席位状态字（就绪 / 决策中 / 作战中 / 已离开 / 已淘汰 / 断线图标）；
③ LP 塔 + 本回合待扣（含联防 ×N）；④ 点队友头像「前往查看 / 返回战场」（客户端战斗的观战入口，`observe`）；
⑤ 表情气泡（`EmoteBubble`）；⑥ Boss 回合的绿框（`teamFrameIds`）。多人房 12 人时这张单子高 445 px（792×360 视口只有
360 高），第 8 行以后本来就在屏外点不到，所以它作为「名单」已经不可用；队伍框按「一队一框」重排后，①②的
**信息**由队伍框承接（§3），④⑤⑥属于交互/装饰，归到业主已排的「把 `.team` 行美工移植进 `.gm-team__row`」那一单
（本单只做「不渲染 + 朴素行」，不擅自加行内交互与新 UI）。

## 3. 字段承接对照表（原 `.team` → 现在在哪）

| 原 `.team` 上能读到的 | 现在在哪 | 状态 |
| --- | --- | --- |
| 谁在场（12 行，名字） | 收起：每队框头的 `n/4`（满员 4/4）；展开：该队 4 行名字（`.gm-team__who`，实测 `T12 / AI·华法琳 / AI·阿米娅 / AI·惊蛰`） | ✅ 承接 |
| 哪一队 / 队色 | 框头队名（我方同盟 / 对方同盟（8 人）/ 蓝方同盟、红方同盟（12 人））+ 左侧 `.1rem` 队色条（我方薄荷、蓝方蓝、红方红） | ✅ 承接 |
| 谁掉线 / 谁倒下 | 展开行尾 `.gm-team__tag`（`连接中断` / `倒下`，既有 msgid）+ 该框描边转红（`is-off`）+ 框头 `n/4` 减员 | ✅ 承接 |
| 空位 | 展开行的 `空位 + 邀请`（`.is-empty` / `.gm-team__invite`）+ 框 `is-gap` | ✅ 承接 |
| 血量 | 我方那一队展开行的数字（`max(1, floor(hp))`，实测 `29 / 28 / 28 / 23`）；别队按上一单定稿不出数字（信息不对称，`multiHud.js:134` 的 `i === mine &&` 一行可放开） | ✅ 承接（沿用既有决定） |
| 自己那一行 | 展开行 `is-self`（名字薄荷色） | ✅ 承接 |
| 观战者（谁在观战） | 顶栏观战者列表（`TopBar spectators`）—— 它**从来不在** `.team` 里，本单没动 | ✅ 原处 |
| 席位号 P#、AI 徽标 | 不显示（队伍框的 4 行顺序 = 该队第 1–4 席；AI 座位的名字自带 `AI·` 前缀） | ⚠️ 未承接 |
| 就绪 / 决策中 / 作战中 / 已离开 状态字 | 不显示（框级只到「掉线/倒下」；就绪人数仍在顶栏 `准备就绪 n/m`） | ⚠️ 未承接 |
| LP 塔、本回合待扣、联防 ×N | 不显示（自己的 LP 仍在顶栏；队友的待扣数字随 `.team` 一起去掉） | ⚠️ 未承接 |
| 「前往查看 / 返回战场」（观战入口） | 不显示（战斗中的观战切换仍在战斗 HUD 的观战胶囊与 `‹ ›` 切换里；**备战场查看队友**的入口随 `.team` 一起去掉） | ⚠️ 未承接 |
| 「正在查看」眼睛、表情气泡、Boss 回合绿框 | 不显示 | ⚠️ 未承接 |

⚠️ 的五项是 `.team` 的行级/交互信息，业主已排的下一单（把 `.team` 行美工：头像 / 血量 / 方格 / 交互移植到
`.gm-team__row`）里补；本单不做，避免与那一单的排法冲突。若要求「本单就必须有」，最小改法是在 `multiHud.js` 的展开行
加席位/状态字（`STATUS_META` 的既有序号 msgid，不需要新文案），但 88 px 宽的行放不下「名字 + 状态 + 血量」三列，
需要先定行内排法。

## 4. 修前 / 修后 rect（`getBoundingClientRect`，同一帧；单位 px）

### 4.1 12 人（`QESU` → `EPXN`，第 3 回合休整期）

| 元素 | 792 修前 | 792 修后 | 1920 修前 | 1920 修后 |
| --- | --- | --- | --- | --- |
| `.gm-teams`（收起） | 8.00 → 96.00 × 94.39 → 202.39 | **同** | 20.00 → 240.00 × 236 → 506 | **同** |
| 框 1 / 2 / 3（收起） | 8 → 96 × 94.39 / 132.39 / 170.39（各 88×32） | **同** | 20 → 240 × 236 / 331 / 426（各 220×80） | **同** |
| `.gm-teams`（展开我方） | 8 → 96 × 94.39 → 262.39（88×168，行高 34/34/34/34） | **同** | 20 → 240 × 236 → 656（220×420，行高 85×4） | **同** |
| `.team` | 104.00 → 182.78 × 94.39 → **539.92**（右移让位） | **不存在（null）** | 260.00 → 456.97 × 236 → **1350** | **不存在（null）** |
| `.gm-unite`（UNITE 帧） | 232.00 → 744 × 98.39 → 146.39 | **144.00 → 744**（600 宽） | 580.00 → 1800 × 246 → 366 | **360.00 → 1800**（1440 宽） |
| `.gm__corner` | 9.59 → 157.59 × 316.41 → 350.41 | 同 | 24 → 278 × 1000 → 1056 | 同 |
| `.shopbar` | 379.52 → 781.61 × 194.66 → 352 | 同 | 893 → 1894 × 694 → 1060 | 同 |
| `.gm__effects` | 755.28 → 780 × 96 → 124.47 | 同 | 1828.20 → 1890 × 240 → 311.19 | 同 |
| `.gtop` | 0 → 792 × 0 → 58.19 | 同 | 0 → 1920 × 0 → 116.50 | 同 |

展开行实测：`T12 29 / AI·华法琳 28 / AI·阿米娅 28 / AI·惊蛰 23`（792 行高 34、1920 行高 85）。
UNITE 帧只剩 `.gm-unite` 的变化：左缘 232 → **144**（1920：580 → **360**），右缘不变（744 / 1800）。

### 4.2 8 人（`BKTY` → `HAAC`，第 3 回合休整期）

| 元素 | 792 修前 | 792 修后 | 1920 修前 | 1920 修后 |
| --- | --- | --- | --- | --- |
| `.gm-teams`（收起 / 两框） | 8 → 96 × 94.39 → 164.39 | **同** | 20 → 240 × 236 → 411 | **同** |
| `.gm-teams`（展开） | 8 → 96 × 94.39 → 262.39 | **同** | 20 → 240 × 236 → 656 | **同** |
| `.team` | 104 → 182.78 × 94.39 → 389.55 | **不存在（null）** | 260 → 456.97 × 236 → 974 | **不存在（null）** |

展开行实测：`T8 29 / AI·华法琳 26 / AI·阿米娅 29 / AI·惊蛰 27`；8 人房无联防帧（本单不触发 UNITE）。

## 5. 交叠面积（逐对实测，全部 0.00）

口径：`.gm-teams` 与每个**可见** `.gm-team` × `.team` / `.gm__bonds` / `.gm__corner` / `.shopbar` / `.gm__effects` /
`.gm-unite` / `.gtop`。12 人收起 28 对、展开 14 对、UNITE 收起 28 对、UNITE 展开 14 对；8 人收起 21 对、展开 14 对；
4 人 7 对（只有 `.gm-teams` 这一组）。两档视口各一遍。

| 配对（12 人） | 792 修前 → 修后 | 1920 修前 → 修后 |
| --- | --- | --- |
| `.gm-teams` + 每个可见框 × `.team` | 0.00 → **0.00**（修后 `.team` 不存在） | 0.00 → **0.00** |
| × `.gm__bonds` | 0.00 → **0.00** | 0.00 → **0.00** |
| × `.gm__corner` | 0.00 → **0.00** | 0.00 → **0.00** |
| × `.shopbar` | 0.00 → **0.00** | 0.00 → **0.00** |
| × `.gm__effects` | 0.00 → **0.00** | 0.00 → **0.00** |
| × `.gm-unite` | 0.00 → **0.00** | 0.00 → **0.00** |
| × `.gtop` | 0.00 → **0.00** | 0.00 → **0.00** |

| 配对（8 人） | 792 修前 → 修后 | 1920 修前 → 修后 |
| --- | --- | --- |
| `.gm-teams` + 每个可见框 × 上述 7 项 | 全部 0.00 → **0.00**（21 对） | 全部 0.00 → **0.00** |
| 展开帧（14 对） | 0.00 → **0.00** | 0.00 → **0.00** |

> 修前的 0.00 是靠「把 `.team` 右移到 104 / 260」换来的；修后 0.00 是因为那份面板根本不存在，**且联防条从
> 5.8rem 回到 3.6rem 后仍然 0.00**（144 > 96 / 360 > 240，余量 48 / 120）。

## 6. 4 人房零改动证据（`LPBE` → `LKZR`，1 真人 + 3 AI，第 3 回合 PREP）

1. **`.team` 照旧挂载**：`gmCounts['.team'] = 1`；rect `8.80 → 85.78 × 94.39 → 239.17`（792）与
   `22 → 214.48 × 236 → 598`（1920）—— 与上一单 `handoff/shots/hud-teams.json` 的 `scenes.room4` **四位小数逐项相同**
   （`85.78 / 214.48`）。本轮修前那一遍同一条未改分支量到 `85.70 / 214.30`（同一份代码两次相差 0.07 / 0.18 px，是 LP 数字
   的文字排版抖动），修后一遍回到 `85.78 / 214.48` —— 即与基线一致。
2. **`.gm__hud` 直接子元素**（两档视口都相同、且与上一单 §12.5 的清单逐项相同）：
   `["gtop","gm__bonds","team","gm__effects","shopbar","chat-panel  ","ui-slot gm__ui-slot","gm__corner"]`
   —— 没有 `gm-teams`（修前修后都一样）。
3. **`.gm` 根 class**：`screen gm gm--prep`（**没有 `has-multi`**）；`.gm-teams` / `.gm-team` / `.gm-unite` 计数 **0**。
4. **源码**：4 人房走的三元另一支是同一个 `<${TeamPanel}>`、同一串 props（单测按 props 原文守着：`watching` /
   `bubbles` / `onWatch` / `cap` / `uniteLocal` / `spMarks` / `self` / `observe`）；`isMultiRoom({maxSeats:4}) === false`，
   `has-multi` 一位都不变。CSS 只删了 `.gm.has-multi .team` / `.gm.has-multi .gm-unite` 两条（4 人房一条都不命中）。
5. 本轮额外拍了 `room4-match-792x360.png` / `room4-match-1920x1080.png`（新文件，不在交付清单里，作旁证）。

## 7. 测试（ℹ 原文）

```
$ node --test test/ui/**/*.test.js
ℹ tests 1531
ℹ suites 286
ℹ pass 1492
ℹ fail 0
ℹ cancelled 0
ℹ skipped 39
ℹ todo 0
ℹ duration_ms 17921.5662

$ node --test test/match/room-seats.test.js test/ui/room-seats.test.js
ℹ tests 23
ℹ suites 1
ℹ pass 23
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 1100.7282

$ npm run typecheck
> tsc --noEmit --checkJs -p jsconfig.json
（无诊断，退出码 0）

$ npx eslint public/js/ui/multiHud.js public/js/screens/game.js test/ui/multi-hud.test.js
✖ 2 problems (0 errors, 2 warnings)   ← game.js:985 / game.js:1903 的 no-useless-assignment，改动前就在，与本节无关
```

`test/ui/multi-hud.test.js` 13 例（+2）：`isMultiRoom` 只有 8/12 为真；`.team` 挂载是三元的 `isMultiRoom(pub) ? null :
<${TeamPanel}>` 且全仓只有这一处、`display:none` 一条都没有；4 人房 10 个 prop 原文逐条在；CSS 里没有 `.gm.has-multi .team`
/ `5.8rem`；`.gm-unite` 左缘 3.6rem；`x8` 贴边 + 列右缘 < 联防条左缘 + 三号框展开框底 ≤ `.gm__corner` 顶（792 与 1920
两套算术）；原有 11 例全部保留通过。

## 8. 重拍（覆盖旧图）与新 SHA-256

同一局同一帧、`captureBeyondViewport: false`、DPF=1；12 人 `EPXN`、8 人 `HAAC`。

| 文件 | 尺寸 | 字节 | SHA-256 |
| --- | --- | --- | --- |
| `room12-match-792x360.png` | 792×360 | 407351 | `6088e35e8ee851aad4ae899dd513a01a28abc053a42853f78f25a866d00a1e3f` |
| `room12-match-1920x1080.png` | 1920×1080 | 2334147 | `7a8ff5a7fbe13576bf50c748ff235e2ad9f92ee7610b944720a383d19a79b462` |
| `room12-match-roster-792x360.png` | 792×360 | 405791 | `119454c3803b44016b03df943552760b366ea2fc3f3ebcf5ed5b556ef18db4e5` |
| `room12-match-roster-1920x1080.png` | 1920×1080 | 2323362 | `4a8c8006b686e6b3284312b9dc51568785a6c5a19f9bcd8a3d3b3ccf59a1f0ce` |
| `room12-match-unite-792x360.png` | 792×360 | 448606 | `63d3dff138b7a10f743e6653be12086590540ab81515abd491780c5d7393baf1` |
| `room12-match-unite-1920x1080.png` | 1920×1080 | 2472514 | `4babe7b19c757048bc51437679a8eaa42c1d24aae732223e907bab8538fc9c27` |
| `room12-match-unite-roster-792x360.png` | 792×360 | 472416 | `c46654ff33f2c02639b5fcf0d1c69e240274f861886b291f3113d9ed18c87422` |
| `room8-match-792x360.png` | 792×360 | 413096 | `00751a511f404c4f4db13f226289f36dcdff304bdf4f8e4fbc15487b3c11de9c` |
| `room8-match-1920x1080.png` | 1920×1080 | 2347788 | `3848846c5458f0b9e3add9fe50b6c7e35bfed6dec9e04203286c30613ffca33a` |
| `room8-match-roster-792x360.png` | 792×360 | 410881 | `309187d3e659199eea1a1b51b6369e232485e93ff5bdf5c1242f7acc12ff6de2` |
| `room8-match-roster-1920x1080.png` | 1920×1080 | 2330806 | `7b42d8b7d52639b255e4c0e9c9ee0b01f722bf0382d74ee5fdcd411409fd84ec` |
| `room4-match-792x360.png`（旁证） | 792×360 | 410014 | `410c8cede97776e6de0bcefe8dec1f5a399f3f80cdbc3bc8258b7e059ed812a5` |
| `room4-match-1920x1080.png`（旁证） | 1920×1080 | 2360097 | `081a1d958a8a2d9578e28b7dbdcc345df01b4d554523ac0d7c9101b8606a9822` |

## 9. 清理与红线

- 临时脚本 `.sp-tmp/hud-noteam.mjs` 与三份中间 JSON（`hud-noteam-before-12-tmp.json` /
  `hud-noteam-before-8,4-tmp.json` / `hud-noteam-after-tmp.json`）已删除；`fastServer` 子进程随 `srv.stop()` 退出；
  3 个浏览器实例都 `close()`。
- 保留的证据：`handoff/shots/hud-noteam.json`（before / after 每帧）与本报告 §8 的图。
- 无 git 写：本单改动的 `public/js/ui/multiHud.js`、`public/css/screens/multi-hud.css`、`public/js/screens/game.js`、
  `test/ui/multi-hud.test.js` 与本报告、`hud-noteam.json` 都保持未提交/未跟踪状态，没有 commit / checkout / stash。
- docs 未改：`docs/TWELVE_PLAYER_MODE.md` 只写「局内 HUD 在 `multiHud.js` + `multi-hud.css`」，仍然成立；形态细节
  在本报告、`multi-hud.css` 文件头与 `multiHud.js` 文件头。

## 10. 补记（2026-10-31 23:08）：大名单行美工移植进 `.gm-team__row`

§3 里 ⚠️ 的两项自此由展开行承接：「席位号 P#、AI 徽标」→ **AI 角标已接**（P# 不显示，行序即席序）；
「就绪 / 决策中 / 作战中 / 已离开 状态字」→ **状态图标已接**（大名单那颗 `.team__status`）。展开的 4 行不再是
「名字 + 状态字」的朴素行，而是大名单那一行：**头像（含 AI 角标）+ 名字 + 状态图标 + 我方血量数字**。本单只做展示，
行本身不可点（大名单的「前往查看 / 返回战场」、表情气泡、Boss 绿框、LP 塔/待扣/联防 ×N 仍未搬）；4 人房与既有模式
一行都没动。证据：`handoff/shots/hud-rows.json`（本轮 12 / 8 / 4 人房逐帧 rect、行内元素 rect、交叠面积）与 §10.7 的 4 张重拍图。

### 10.1 落点（文件:行）

| 落点 | 内容 |
| --- | --- |
| `public/js/ui/multiHud.js:22–29` | 新 import：`Icon`、`GIcon`、`LocalSprite`、`STATUS_META`、`STATUS_SPRITE`（由 teamPanel 导出）、`localAsset` |
| `public/js/ui/multiHud.js:95–112` | `SeatStatus`：一行那颗状态图标 = 大名单的 `.team__status`（tone + 官方 sprite + 掉线 `icon_lost_connect`） |
| `public/js/ui/multiHud.js:165–183` | 展开行：`class="gm-team__row team__row [is-self] [is-dead] [is-off]"`、`role="group"`、`aria-label="队伍 玩家名"`；内部 `.gm-team__ava > PlayerAvatar + .team__ai`、`.team__info > .team__name + .team__line > 我方 hp + SeatStatus`；空位行不变 |
| `public/js/ui/multiHud.js:19–21`、`:6–9` | 文件头：行的形态与文案来源改写（状态文案改读 `STATUS_META`） |
| `public/js/ui/teamPanel.js:35` | `STATUS_SPRITE` 加 `export`（**teamPanel 的唯一改动**，渲染输出一字未动；multiHud 复用同一份映射） |
| `public/css/screens/multi-hud.css:72–89` | 只留容器与队列布局：行 grid（`auto minmax(0,1fr)`）、行高 `.85rem`、`.gm-team__ava` 定位盒、`.gm-team__row .pavatar { --pa: .6rem }`、第二行右对齐；`.gm-team__tag` 删除（状态字让位给图标），`.gm-team__hp` 保留（空位两行的 `.gm-team__who` / `.gm-team__invite` 在 `:90–99` 未动） |
| `test/ui/multi-hud.test.js` | 行的契约改成大名单那一套（`.team__name` / `pavatar` / `.team__status` / `aria-label` / `.team__ai`），新增一例「单一来源」：CSS 里没有第二份 `.team__*` / `.pavatar` 规则、头像缩放、行高框宽不变；`walk()` 会展开函数组件（`PlayerAvatar` / `SeatStatus`） |

### 10.2 复用了哪些 `.team__*`（单一来源：样式全在 `game.css:776–812`，本单一字未改）

| 复用的类 / 组件 | 用在哪 | 带来什么 |
| --- | --- | --- |
| `.team__row`（行自身） | 展开行 = 大名单的一行 | `is-self` 的薄荷头像描边环、`is-dead` 的名字删除线 |
| `PlayerAvatar`（`.pavatar`） | 头像 | 席位色、band 图 / 首字 / 机器人、淘汰 ✕、掉线灰化、已离开门 |
| `.team__ai` | AI 角标（头像右下） | 与 4 人房同一颗角标 |
| `.team__info` | 名字条 | 行内左右内边距与右侧渐隐底 |
| `.team__name` | 名字 | 字号 / 省略号 / 淘汰删除线 |
| `.team__line` | 名条第二行 | 行内 4px 间距（本单只加 `justify-content: flex-end` 的容器对齐） |
| `.team__status` + `is-lo` / `is-mint` / `is-gold` / `is-orange` / `is-red` / `is-offline` / `has-sprite` | 状态图标 | 行动中 / 已就绪 / 决策中 / 作战中 / 作战结束 / 已淘汰，掉线走官方 `icon_lost_connect`（无本地图时回退 `wifiOff`） |

没用到的（本单不搬）：`.team__btn`（行不可点；`.gm-team__ava` 只替它提供 `.team__ai` 的定位祖先）、`.team__seat`（P# 文字，88 宽里让位给名字）、`.team__you` / `.team__eye` / `.team__spmark` / `.team__frame` / `.team__bubble` / `.team__ob` / `.team__back`。

### 10.3 头像缩放后的实际像素

队伍的框宽是硬约束（88 / 220），行内可用宽 = 88 − `.18rem`(7.2) − `.1rem`(4) = **76.8**（1920：220 − 18 − 10 = 192）。
大名单头像 `.pavatar` 是 `.8rem`（32 / 80），塞进去只剩 31 px 给名字，所以**只在展开行内**缩到 `.6rem`：

| | 792×360（1rem = 40） | 1920×1080（1rem = 100） |
| --- | --- | --- |
| 头像 `.pavatar`（实测 rect） | **24.00 × 24.00**（x 15.19 → 39.19） | **60.00 × 60.00**（x 38 → 98） |
| 大名单自身（未改） | 32 × 32 | 80 × 80 |
| 名条 `.team__info` | 49.63 宽（42.38 → 92），文字可用 42.44 | 124 宽（106 → 230），文字可用 106 |
| 名字 `.team__name` | 42.44 宽；`clientW 42 / scrollW 42`（**没有截断**），`text-overflow: ellipsis` / `nowrap` / `hidden` 就位 | 106 宽，`clientW/scrollW 106` |
| 状态图标 `.team__status` | 10.39 × 10.39 | 26.00 × 26.00 |

理由是 6 个字的名字：`AI·华法琳` 在 `.15rem` 字号下约 36 px，42.4 放得下（实测 42.44 宽、没有省略号）；
用大名单的 32 px 头像则只剩约 31 px（≈5 个字）。**大名单自己的 `.8rem` 与 `game.css` 未改**（单测守着
`\.pavatar \{ --pa: \.8rem` 仍在），所以 4 人房名单的头像尺寸不变。

### 10.4 行高与尺寸取舍

行高**没有动**：34（792）/ 85（1920），第三个框展开时仍收成 27（792）—— `min(.85rem, (100vh − 6.3rem) / 4)`。
24 px 的头像放进 34 的行（内容 33）与 27 的行（内容 26）都还有余量，所以不需要为头像让行高；
取舍只有一条：**头像按 75% 缩，而不是把框加宽或把行加高**（框宽 88/220 与行高 34/85 都是业主定稿的硬约束）。

### 10.5 几何实测（`getBoundingClientRect`，同一局同一帧，只换视口不 reload）

12 人 `SRUB`、8 人 `XJDA`、4 人 `YREM`，均为第 3 回合 PREP，1 真人 + AI 座（`fastServer` `startRound 3`；
真实服务端 + `test/e2e/client.mjs` 的 `Client`，headless Chrome，DPF=1）。

| 元素 | 792×360 | 1920×1080 |
| --- | --- | --- |
| `.gm-teams`（展开我方） | 8.00 → 96.00 × 94.39 → 262.39（**88×168**） | 20.00 → 240.00 × 236.00 → 656.00（**220×420**） |
| `.gm-team.is-open` | 同（88×168） | 同（220×420） |
| 框头 `.gm-team__head` | 8 → 96 × 94.39 → 126.39（88×32） | 20 → 240 × 236 → 316（220×80） |
| `.gm-team__list` | 8 → 96 × 126.39 → 262.39（88×136） | 20 → 240 × 316 → 656（220×340） |
| 4 行 × 行高 | 34.00 / 34.00 / 34.00 / 34.00 | 85.00 × 4 |
| 我方血量数字（12 人） | 23 / 28 / 27 / 24 | 23 / 28 / 27 / 24（同一帧） |
| 行内 `.pavatar` / `.team__info` / `.team__status` 的 rect | 见 §10.3；三者都在行 rect 内（`withinRow = true`，逐行） | 同 |
| `.gm-team__row × .gm-team__row` 交叠 | 0 / 0 / 0 / 0 / 0 / 0 | 0 × 6 |
| 页面 | `scrollW/H = clientW/H = 792×360` / `1920×1080`（无溢出） | 同 |

8 人房同一组数字（88×168 / 220×420，行高 34 / 85，头像 24 / 60），交叠同样全 0。

第三个框展开（`is-tail`，792）：框 8 → 96 × **170.39 → 310.39（88×140 = 32 + 4×27）**，四行 27，头像 24 仍在行内
（`withinRow = true`），框底 310.39 < 左下角键 `.gm__corner` 顶 316.41；行 × 行交叠 0。

交叠（`max(0, min(r,b) − max(l,t))` 面积）：`.gm-teams` + 当前可见 `.gm-team` × `.gm__corner` / `.gm__bonds` /
`.gm__effects` / `.shopbar` / `.gtop` 共 10 对/帧，**全部 0.00**（8 人房同）。`.gm-unite` 只在 UNITE 阶段存在，
本帧（PREP）没有这个元素；队伍框列右缘 96 / 240 与它的左缘 144 / 360 之间还有 48 / 120 的余量（§5 的 UNITE 帧
实测也是 0.00），本单没有改列的任何外框尺寸。

### 10.6 4 人房零改动证据（`YREM`，1 真人 + 3 AI，第 3 回合 PREP）

1. **`.team` 照旧挂载**：计数 1、`.team .team__row` 4 行；rect `8.80 → 85.70 × 94.39 → 239.17`（792）与
   `22.00 → 214.30 × 236.00 → 598.00`（1920）—— 与 §6 的基线 `85.78 / 214.48` 差 0.08 / 0.18 px，正是 §6 第 1 条
   记过的 LP 数字排版抖动（同一份未改分支上一单也量到 `85.70 / 214.30`，修后一遍回到 `85.78 / 214.48`），
   左右/上下边界（8.80 / 22.00 / 94.39 / 236.00 / 239.17 / 598.00）逐项相同。
2. `.gm` 根 class `screen gm gm--prep`（**没有 `has-multi`**）；`.gm-teams` / `.gm-team` / `.gm-unite` 计数 0。
3. `.gm__hud` 直接子元素 `["gtop","gm__bonds","team","gm__effects","shopbar","chat-panel  ","ui-slot gm__ui-slot","gm__corner"]`
   —— 与 §6 第 2 条逐项相同。
4. 源码：4 人房走的三元另一支仍是同一个 `<${TeamPanel}>` 与同一串 props（单测逐条守着）；`isMultiRoom({maxSeats:4})` 仍 `false`；
   本单对 `teamPanel.js` 只加了 `export` 关键字，`game.css` 一字未改。多人房路径（`multiHudView`）在 4 人房返回 `null`。

### 10.7 测试（ℹ 原文）

```
$ node --test test/ui/multi-hud.test.js
ℹ tests 14
ℹ suites 0
ℹ pass 14
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 360.0527

$ node --test test/ui/**/*.test.js
ℹ tests 1532
ℹ suites 286
ℹ pass 1493
ℹ fail 0
ℹ cancelled 0
ℹ skipped 39
ℹ todo 0
ℹ duration_ms 22627.3426

$ npm run typecheck
> tsc --noEmit --checkJs -p jsconfig.json
（无诊断，退出码 0）

$ npx eslint public/js/ui/multiHud.js public/js/ui/teamPanel.js test/ui/multi-hud.test.js
（0 problems）
```

`test/ui/multi-hud.test.js` 14 例（+1）：旧的「名字 + 状态字」断言改成大名单那一套（`.team__name` 文本、`pavatar` 4 个、
`.team__status` 4 颗、`.team__ai` / `aria-label` / `is-dead` / `is-offline` / `is-red`），新增「展开行复用大名单
`.team__*` 的美工（单一来源）：AI 角标、头像缩放、行高与框宽不变」；其余 13 例（4 人房门、8/12 人房框、收起、≥32 热区、
CSS 契约、`.team` 不挂载、交叠契约、无新 msgid）原样保留通过。`hud-rows.json` 里页面没有问题日志以外的错误：`problems`
只有本地美术包缺图的 404（`/assets/char/…`，与上一单同类，不是本单引起）。

### 10.8 重拍（覆盖旧图）与新 SHA-256

同一局同一帧、`captureBeyondViewport: false`、DPF=1；12 人 `SRUB`、8 人 `XJDA`（展开我方同盟，4 行 = 头像 + 名字 + 血量 + 状态）。

| 文件 | 尺寸 | 字节 | SHA-256 |
| --- | --- | --- | --- |
| `room12-match-roster-792x360.png` | 792×360 | 402259 | `c57def1f284f51183a33b79a046254a0c2c0c27ef547e4993dce86c150ba95e9` |
| `room12-match-roster-1920x1080.png` | 1920×1080 | 2273017 | `2d0fcee47d930be317b4fbb185416913b1015bd36d5438e8439bb2de62ff9211` |
| `room8-match-roster-792x360.png` | 792×360 | 400764 | `8d4cf34568cc7ace235130fb48e65398f2721daefe1587c8026e9d35c5638946` |
| `room8-match-roster-1920x1080.png` | 1920×1080 | 2260261 | `e997a515a713583504f2293fc44ac13f1c557dc1013e63dd4acc582a50d432db` |

### 10.9 清理与红线

- 临时脚本 `.sp-tmp/hud-rows.mjs` / `.sp-tmp/digest.mjs` 已删除；`fastServer` 随 `srv.stop()` 退出，3 个浏览器实例都
  `close()`。保留的证据：`handoff/shots/hud-rows.json` 与 §10.8 的图。
- 无 git 写：`public/js/ui/multiHud.js`、`public/js/ui/teamPanel.js`、`public/css/screens/multi-hud.css`、
  `test/ui/multi-hud.test.js`、本报告与 `hud-rows.json` 都保持未提交/未跟踪状态（没有 commit / checkout / stash）。
- 文案：没有新增 msgid（状态图标的名字全来自 `STATUS_META` 既有条目；单测 `t(…)` 逐条比对 `en.json`）。

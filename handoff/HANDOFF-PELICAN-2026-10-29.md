# 交接：模型路由与当前批次状态（2026-10-29 17:2x）

写给下一个接手的人（或下一个会话）。**结论先行：从现在起，所有子代理一律 `provider: tihu` + `model: deepseek-v4.1-flash`（鹈鹕）。**

## 1. 路由事实（读自 `C:\Users\J1825\.dsh\profiles\desktop\cordis.patch.yml`）

| 通道 | baseURL | 模型 | key 环境变量 |
|---|---|---|---|
| `deepseek-account`（**官方**） | — | `deepseek-flash` | 官方账号凭据 |
| `tihu`（**鹈鹕**，本轮唯一指定） | `https://sub2api.meow.amiyawish.top/` | `deepseek-v4.1-flash` | `TIHU_API_KEY` |
| `tihu-inter`（鹈鹕内网） | `https://47.103.14.217:8444/v1` | `deepseek-v4.1-flash` | `TIHU_INTER_API_KEY` |
| `jinny` | `https://jinnyapi.com/` | 见配置 | `JINNY_API_KEY` |

主会话（Lead）本身在 `deepseek-account / deepseek-flash`，**这个不改**。

## 2. 已退役 / 不再使用

`panels-e2e`、`handoff-scribe`、`loadout-row` 三个是用 `spawn_teammate` 建的（该工具**不能指定模型**），实际跑在 `deepseek-account / deepseek-flash` 官方通道上。**已停用**，不再派活；它们的产物不重跑：

- `loadout-row` 的 32 KB 审计（`handoff/audit-ingame-bugs-2026-10-29.md`）三条结论均已独立复核证实：
  ① 整备区 20 格（`PlayerState.js:236` vs 客户端 `GEO.HAND_SIZE=10`）—— 我自己读过代码；
  ② 重抽口径 —— 已按方案 A 由鹈鹕批重写实现 + 测试（`zhajing-refresh` 8/8）；
  ③ `zjOnly` 策略泄漏 —— 我自己先独立定位到 `bandDraft.js:274` 并修复（`bandDraft.test.js` 23/0）。

**规矩**：以后派子代理一律用 `subagent` 工具并显式写 `provider: "tihu"`、`model: "deepseek-v4.1-flash"`；`spawn_teammate` 只在与模型无关的纯本地任务上使用（且要知道它默认走官方通道）。

## 3. 本轮批次状态（截至本文件写入）

| 批 | 模型 | 状态 |
|---|---|---|
| **A 引擎 5 项**（层上限 9999 / 重抽方案 A / `forgeTake` fail-closed / `hidden_pandora` / 预选 bans 扩三路） | tihu-inter | ✅ **已完成并复核**：我的树里 93 pass / 0 fail；golden **288 零位移**；域外 7 处已由该批自带、最后 1 行（`player/round.js:239` 传 `cap`）由我补 |
| **B 整备区 20 格** | tihu-inter | ⏳ 进行中 |
| **C 局内 UI**（左下按钮一行同尺寸/去规则键、发言框透明+触发、盟约条重写、去右上惊变角标与效果列、锻造器+已选+一览左上三页签） | tihu | ⏳ 进行中 |
| **D 设置/启动/首页**（画质 ultra/extreme、启动文案按包、底栏） | tihu | ✅ **已完成**：`gameLogic` 58/58、`settings-update` 5/5、新增 `title-footer` 5/5、`client-static` 801/801 |

## 4. 已落地、等 B/C 收工后我还要做的

1. `public/js/render/app.js` 的 6 段画质补丁（D 给了可搜索原文；B 正在改该文件，**必须等它结束**）：
   import 增 `QUALITY_IDS/tierPixelRatio/qualityAtLeast`；`dpr/boardDpr` 改 `ratioOf(table)`；`pixiGl = app.renderer?.gl`；`setSettings` 白名单改 `QUALITY_IDS.includes`；`pickClipping` 改 `qualityAtLeast(q,'high')`；MSAA 加 `DPR<1.5` 条件。
2. `public/css/screens/game.css`：`.set-seg.set-quality button { min-width: .62rem }`（5 档在手机上会换行；C 正在改该文件）。
3. `public/js/ui/jibian.js`：按 `card.rerolled` 关单卡按钮、`rerollsLeft` 读作「还能刷的卡数 0..3」（A 批改了服务端口径：同槽二次现在是 `ALREADY` 而不是 `BAD_TARGET`；C 正在改该文件）。
4. 文档：`docs/history/0.3.3.md` 本轮条目、`docs/META.md` 的 shop slot `remaining`、`docs/design/client.md` 五档 + 「不改变贴图精度」、`docs/ZHAJING.md` 的重抽口径与潘多拉 `[ASSUMED]`。
5. 收口验证：全量电池 + `GOLDEN_FULL`（288）+ `i18n --strict`（ja/ko/zh-TW 必须 100%）+ `client-static`；然后 `SP_BUNDLE_PARTS=1 SP_SKIP_VOICE_GATE=1 node tools/bundle-android.mjs` → `android\gradlew.bat assembleRelease` → 桌面 APK → `adb install -r`。

## 5. 已有、别误判为「本轮引入」的红

- `test/match/feedback1-tactic.test.js`（`choices.js` 的 `annOk` 已把「罗德岛的盟誓」限死湮灭局，测试仍期望官方档出现）
- `test/match/morph-bonds.test.js`（期望 36 件盟约装备，`data/items.json` 现 44）
- `test/match/catherine-cell.test.js`（`stock exhausted: chess_item_5_02_e_a`）
- `tools/check-imports.mjs` 3 条违规全在 `server/sim/nodeData.js`
- `test/ui/version-icon-lookups.test.js` 1 条（`chess_zj_12_a` 的 skillIcon 与 `data/versions/*` 不一致）
- `i18n --strict` 的 en 248 条缺失是**历史基线**，ja/ko/zh-TW 100%

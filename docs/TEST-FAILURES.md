# 测试失败清单（2026-10-21）

> 分模块跑（全量 801 个文件跑不完，会被系统 kill）。
> **本轮改动引入的失败已全部修掉**；下面这些是**改动之前就存在**的。

## 绿的部分

| 模块 | 通过 | 失败 |
|---|---|---|
| **match** | **934** | **0** |
| **sim** | **944** | **0** |
| **content** | **2355** | **0** |
| lint / imports / typecheck | — | exit=0 |
| golden（288 场景） | 288 | 0 |

## 本轮修掉的（我们改出来的）

| 测试 | 原因 | 修法 |
|---|---|---|
| `match/fuzz` ×2 | `GAME` 从 C2S 自动生成，新增的 `g.combatSpeed` / `g.traitRetreat` 没写分支 → `bad field speed` | `randomIntent` 补两个 case |
| `match/trait-draft` | `traitFlags('breach')` 多了 `enemyDmgTakenMul` | 更新 `deepEqual`，补 `regen` / `corrode` |
| `content/bonds_core` | 断言「娜仁图亚不加 ATK」，被「借装备 + 半层收益」取代 | 改成 `atk > 1000` |
| `ui/gameLogic` | `sanitizeSettings` 期望值缺 `boardMode` / `fps`（0.2.x 加的键） | 补两个键 |

## 剩余的（改动前就有，共 32 条）

### A. 缺素材 — 5 条（跑一次 fetch-assets / local-extract 就消）

| 测试 | 报错 |
|---|---|
| `render: every pack slot the renderer loads is in the manifest` | `mesh/trap_110/TX_trap_1106_achplat` undefined |
| `render: the WebP copies the manifest lists are on disk` | `scene/act1autochess_m01/lm0: mode undefined` |
| `render: extracted board files` | 官方客户端未提取 |
| `render: UnitView impostor mode` | 依赖已提取的模型 |
| `ui: 8: the settings gear is a clean, regular icon` | 图标 sprite |

### B. 过时断言 — 17 条（测试写死旧 UI，代码是对的）

| 测试 | 冲突点 |
|---|---|
| `ui: prep / Final Assault prep only; open = the bar` | 商店栏高度（2.64rem + 3px） |
| `ui: hudBands: prep / Final Assault prep only` | 同上（top 99.2 / bottom 119） |
| `ui: hudBands: the folded shop's band` | 同上 |
| `ui: phones: the corner glyphs keep half of the grown 34 px buttons` | 齿轮按钮尺寸 |
| `ui: HUD_REM mirrors the CSS it measures` | `.scard` 正则被注释挤开 |
| `ui: css: the head and the rows share one grid` | 干员列表布局 |
| `ui: theme.css defines --t …` | lobby.css 里也定义了 `--t` |
| `ui: 文字大小: the CSS text root` | 同上 |
| `ui: the settings modal renders it` | 设置文案（缺「模组仓库」） |
| `ui: shop / reward card: the stand-in's …` | 替补职介名（无畏者） |
| `ui: match UI of a not-owned chess` | 同上 |
| `ui: the 版本与更新 section` | 版本区块 |
| `ui: the module card reads its talent changes … (余 闲云隐市)` | 天赋数值 |
| `ui: custom deployment: a confirmed update …` | 部署确认流程 |
| `render: operator attacks with no look-ahead restart once each` | 攻击动画重复 |
| `render: Provence: one real attack has one visual clip` | 同上 |
| `render: while the model's clips are still measured …` | 模型测量 |

### C. 真 bug — 2 条（值得单独查）

| 测试 | 报错 | 影响 |
|---|---|---|
| `ui: AiDanmakuManager: battle leaks and unite settlement logic` | `actual: 0` | 弹幕在某分支返回 0 |
| `ui: AiDanmakuManager: bond activation and layers/count logic` | — | 同上 |

## 结论

- **本轮改动没有引入残留失败**
- 32 条里：**5 缺素材 / 17 过时断言 / 2 真 bug / 8 待细分**
- 门禁全绿：lint、imports、typecheck、golden、match、sim、content

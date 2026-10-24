# 皮肤内置计划（参考 PR #85，改成打包期内置）

范围：把 sganggs/Stronghold-Protocol#85 的干员皮肤子系统移植进本 fork，**去掉运行时服务端安装**，素材在打包期落地进 `app_bundle.zip`；皮肤跟着 干员调配 的 导出 / 导入 / 恢复默认 一起走。
上游关 PR 的理由（`room.skin.install` 不校验房主，任意客户端可让服务器下载并改写所有人共用的 `data/assets.json`）在内置方案里不存在——不移植 `server/skinInstall.js`，也不注册 `room.skin.install`。

## 1. 皮肤一节的位置与排版

位置照 PR：`public/js/screens/loadout.js` 模组 section（当前 `:331`）之后、锁定提示之前，插一行 `<${SkinSection} chess=${base} />`，加一个 import。本节自包含在 `public/js/ui/skinPicker.js`，上游重写 loadout.js 时只丢那一行。

排版按你的定案：**一行一套，纵向堆叠，不做 wrap 磁贴**。目录实测每人 1–3 套（1 套 65 人 / 2 套 41 人 / 3 套 9 人），含「默认」一节最多 4 行。

| 项 | PR 原值 | 改成 | 761×360（1rem=33.3px）实际 |
|---|---|---|---|
| `.lo-skins` | `flex-wrap` 磁贴 | `flex; flex-direction: column; gap: .06rem` | — |
| `.lo-skin` | `flex:1 1 1.9rem; min 1.7rem` | `width:100%; min-height: max(.56rem, 46px)` | 46px 高（原 ~27px，低于 `.sp-coarse` 30px 触达线） |
| `.lo-skin__art` | `.46rem` 无 px 下限 | `max(.56rem, 46px)` 方形 | 46px（**原值 15px，比 `.lo-mglyph` 的 30px 还小**） |
| `.lo-skin__name` | `max(.16rem, 11px)` | `max(.2rem, 13px)` | 13px |
| `.lo-skin__group` | 跟在名称下省略 | 移到行尾 `margin-left:auto`，名称那行不再挤 | 10px，最长 11 字系列名可完整显示 |

代价：这一节比磁贴版多约 100–190px 滚动量，接受。
180×180 头像只能算缩略预览，官方全身图（`skin/{portraitId}b.png`，~2.5 MB/张）不用，理由同 PR。

内置后删掉的状态：`未安装 · 点击安装`、`requestSkinInstall`、`installing` / `installingProgress` / `skin.progress` / `skins.changed`、`2/5 已安装` 计数、`loadSkinData` 的 500ms 轮询。**未内置的皮肤直接不列**（灰显会被当成点了没反应）；`SkinSection` 在该 `charId` 的 `assets.chars[].skins` 为空时整节 `return null`。

## 2. 导出 / 导入 / 恢复默认 带上皮肤

皮肤选择不进 `entries`（`sanitizeEntries` 只保留 `{skill, module}`，`room.loadout` 的校验也不认这个字段），所以走**并列可选字段**，不 bump `LOADOUT_VERSION`：

```
{ kind:'stronghold.loadout', v:1, exportedAt, count, entries:{…}, skins:{ [baseChessId]: skinId } }
```

- `skins` 字段缺失 = 老文件，皮肤保持不动；存在 = 整体替换（与 `applyLoadoutEntries` 对 `entries` 的覆盖语义一致）。
- 键用 **base chessId**（`chess_char_1_01_a`），金卡在服务端按 `baseId` 回查，所以 `resetOne` 清的也是 `base.chessId`。
- 客户端导入先按 `SKIN_LIMITS` 过滤（`isSkinId` 不能用 `isId`：皮肤 id 带 `@`/`#`），挡掉手工构造的超长 id 和几百条条目。
- 顶部按钮的启用条件：`nChanged` → `nChanged || nSkins`（只改了皮肤时也要能导出/重置）；roster 卡的 `已调整` 徽章仍只看 `entries`，穿了皮肤另给一个 6px 小点。
- 文案：确认框 `将 N 名干员的技能、模组与皮肤恢复为默认配置？`；导入成功 toast 追加 `（含 Y 套皮肤）`；`恢复默认` 按钮同时调 `setEntries(resetChoice(...))` + `clearSkin(chessId)`。

## 3. 改动清单

| # | P | 文件 | 改什么 |
|---|---|---|---|
| 1 | P0 | `docs/research/08-skins.json`、`tools/build-skins.mjs`、`data/skins.json` | 从 PR 取（115 干员 / 174 套，全部落在我们卡池 121 个 charId 内） |
| 2 | P0 | `tools/install-skins.mjs` | **只作 build 期 CLI**，服务器不 import；Dockerfile 那条限制随之消失 |
| 3 | P0 | `data/skins-installed.json` | 提交选定清单 = 唯一真源（默认空数组 → 见 §5 待定） |
| 4 | P0 | `shared/protocol.js`、`server/net.js`、`server/lobby.js`、`server/match/{Match,PlayerState}.js`、`server/sim/{Battle,units,snapshot}.js` | 选择链原样移植；`snapshot.unitInfo` 里 `skin` 用 `undefined` 不用 `null`（否则 §8.2 wire-format 测试红） |
| 5 | P0 | `public/js/{assets.js,render/units.js,render/app.js,data.js,ui/gameComponents.js,main.js}` | `spineEntry/hasBackSpine/avatarUrl` 收 `skinId`、`pieceInfo` 的 `sig` 带 skin、`DATA_FILES.skins`、`GAME_FILES` 加 `'skins'`（`playtest3.test.js` 要求比赛中读的文件都被 await） |
| 6 | P0 | `public/js/ui/skins.js`、`ui/skinPicker.js`、`css/screens/loadout.css` | 砍安装；picker 按 §1 排版 |
| 7 | P0 | `public/js/ui/loadoutModel.js` | `exportPayload(entries,{skins})` / `parseImport → {entries, skins}` / `sanitizeSkins` |
| 8 | P0 | `public/js/screens/loadout.js`、`ui/loadoutSync.js` | §2 的挂载点、`resetOne`/`resetAll`/`ioApply`/按钮 disabled/文案 |
| 9 | P0 | `tools/bundle-android.mjs` | 皮肤门禁（照现有语音门禁）：`skins-installed` == `assets.json` 的 `chars[].skins` == 磁盘文件；打印皮肤净字节 |
| 10 | P1 | roster 卡穿皮肤小点、`nameEn` | 目录是我们自己 build 的，可留英文字段（官方 `skin_table` 无 en 语料） |

不移植：`server/skinInstall.js`、`room.skin.install`（含 `HEAVY_TYPES` 那条）、`ui/preload.js` 与 `LONG_CACHE 30d` / `three.js 等待 30s`（预加载另议）。

## 4. 冲突与落地方式

fork 自 PR base（`9d40419`）以来动了 `server/lobby.js`(+170)、`server/match/Match.js`(+250)、`PlayerState.js`(+45)、`shared/protocol.js`(+10)、`tools/assets/plan.mjs`(+37)。**按 `docs/SKINS.md` 的锚点逐条手贴，不要 cherry-pick**。
`data/assets.json` / `data/skins.json` 是生成物，上游合并会冲掉（见记忆），所以每个生成步骤都写进 `docs/SKINS.md` 的重建命令块，并在 `tools/doctor.mjs` 里检查 `skins-installed` 与 manifest 是否一致。

## 5. 要你定

1. **内置范围**：全 174 套 ≈ 190 MB → APK 从 323 MB 涨到 ~490 MB；精选 20–30 套 ≈ +25 MB（我建议先精选，`data/skins-installed.json` 就是那个开关，后续想加只改一行 + `npm run assets`）。选哪些？按系列整组（珊瑚海岸 / 罗德厨房 / 时代…）还是按人气干员挑？
2. **锁定时序**：PR 给 `skins()` 明确开了无 phase gate，所以局内换皮肤立刻对队友可见，而这时技能/模组已经锁定（`loadout.js:398` 的 `locked`）。建议 client 端在 `locked` 时禁用这一节（不动协议），要不要？
3. **导入的皮肤语义**：文件里有 `skins` 就整体替换当前皮肤选择（可能把你没写进文件的皮肤清掉）。改成「只覆盖文件里出现的 chessId，其余保留」？

## 6. 验证

移植 PR 的 `test/skins.test.js`（去掉安装用例）、`skins-protocol.test.js`、`skins-lifecycle.test.js`；新增 1 条导出→导入往返用例（含 `skins` 字段与 v1 老文件）和 1 条 `resetAll` 同时清皮肤。UI 尺寸不靠猜：起服务后用 CDP 在 761×360 量 `.lo-skin` 实际行高与 `.lo-skin__art` 边长。

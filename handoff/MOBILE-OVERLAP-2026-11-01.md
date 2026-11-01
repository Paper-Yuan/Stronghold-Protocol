# 手机端「按钮看着叠在一起」两处修复（业主 2026-11-01，真机所见）

**结论：两处都不是几何相交，而是控件之间只隔 2–6px（阴影/描边贴着），视觉上像叠在一起。**
按业主补充「是太近导致的，两个上下空开一点」，四对控件在**移动端两档媒体查询**里各拉开一档，桌面零影响。

改动只有一个文件：`public/css/screens/lobby.css`（+28 −2 行）。

## 一、量出来的事实（headless Chrome，三档手机视口）

| 位置 | 元素 | 改前间隙 | 改后间隙 |
|---|---|---|---|
| ② 主题大厅左下（业主第 2 条原话） | `.ext-theme__slot` S.W.E.E.P.报告 / `.ext-theme__loadout` 干员调配 | **2px** | **6px** |
| ① 大厅三张模式卡（第三张 = 写着「N 个玩法」的拓展模式） | `.mode-card` 之间（横向） | **6px** | **10px** |
| ① 选择拓展玩法 的两行玩法包 | `.ext-row` 之间（竖向） | **6px** | **10px** |
| ① 大厅右侧两块板 | `.hub-plate--sweep` / `loadout-open`（竖向） | **5px** | **9px** |

改前 rect（792×360，[l,t,r,b]）：

- 主题大厅：报告 `[8,240,112,270]`、调配 `[8,272,112,304]`
- 大厅三卡：独立 `[382,282,510,346]` / 同盟 `[516,282,644,346]` / 拓展 `[650,282,778,346]`
- 选择拓展玩法：湮灭 `[324,55,777,111]` / 炸惊 `[324,117,777,173]`
- 大厅右板：报告 `[482,58,778,92]` / 调配 `[482,96,778,130]`

改后同三档：**交叠面积全部为 0**（脚本按 `max(0,min(r)-max(l))*max(0,min(b)-max(t))` 两两求交叠，三屏共 0 处），
**横向/纵向滚动 0**，未新增任何 ≤32px 的可点元素。

## 二、修法（`public/css/screens/lobby.css`）

1. **行选择器修错**（`lobby.css:446-449`）：2026-10-29 那次「模式选择列表行间距再松一点」写成了
   `.ext-body .ext-row + .ext-row`，而行是 `<li><button class="ext-row">`（`extensionModes.js:274-295` 的 `row()`），
   这条间距**一直没生效**——业主这次又报，就是它。改成 `.ext-body .ext-list > li + li`。
2. **文件末尾新增两条移动端媒体查询**（`lobby.css:1929-1957`，与既有约定一致：窄屏 = `max-width:900px and min-height:521px`、
   短屏 = `max-height:520px`，两者互斥）：

```
@media (max-width: 900px) and (min-height: 521px) {   /* +6px */
  .lobby-hub { --hub-gap: calc(.14rem + 6px); }        /* 三张模式卡：--hub-gap 同时喂 gap 与整列宽度算式 */
  .ext-theme__dock { gap: calc(.05rem + 6px); }        /* 主题大厅左下那一摞 */
  .hub-right { gap: calc(.12rem + 6px); }              /* 大厅右侧两块板 */
  .ext-body .ext-list > li + li { margin-top: calc(.06rem + 6px); }  /* 两行玩法包 */
}
@media (max-height: 520px) {                           /* +4px，同一套 */
  .lobby-hub { --hub-gap: calc(.14rem + 4px); }
  .ext-theme__dock { gap: calc(.04rem + 4px); }
  .hub-right { gap: calc(.12rem + 4px); }
  .ext-body .ext-list > li + li { margin-top: 4px; }
}
```

刻意**没有**动的地方：

- `.ext-list` 的 `gap: 8px / 6px` 与 `.ext-row` 的 `height: 64px / 56px` —— `test/ui/extension-modes.test.js:617-624`
  逐条断言这两个数（任务里也写明这是既有约定），间距改由 `li` 的 `margin-top` 让出。
- 任何按钮的 `width / min-height / padding` —— 可点区域一个没缩（业主口径：优先改布局）。
- 媒体块放在文件末尾是有意的：`lobby-hub` / `extension-modes` / `zhajing-loadout` 几个测试按「第一条同查询媒体块」
  取用，插到前面会让它们读到错的块。

## 三、桌面端不变（逐值证据）

`@media (max-width:900px)` 与 `@media (max-height:520px)` 在 1280×720 / 1920×1080 下都不命中——
用 CSSOM 把这两条块删掉（= 改动前的层叠）再量一遍，**两档 × 39 个选择器（大厅 10 / 选择拓展玩法 12 / 主题大厅 17）
的 rect 全部逐值相同**：

```
DESKTOP RECTS IDENTICAL (1280x720 + 1920x1080, 10+12+17 selectors each) x2
```

另外「选择拓展玩法」这一屏在 1280×720 与 1920×1080 下的截图 SHA 改前改后**完全一致**（逐像素相同）：
`f3f30498…` / `621c6a6b…`。

## 四、测试

```
node --test test/ui/**/*.test.js   →  tests 1542 / pass 1503 / fail 0 / skipped 39
npm run typecheck                  →  exit 0
```

（`extension-modes` / `lobby-hub` / `zhajing-loadout` / `annihilation-settings` / `ui-size` 等按媒体块取用的断言全绿。）

## 五、截图（`handoff/shots/`）

`mobile-overlap-{before,after}-{hub,hall,theme}-{792x360,667x375,844x390}.png`，桌面另有两档。
主题大厅那一对（业主第 2 条）三档：

| 视口 | before | after |
|---|---|---|
| 792×360 | `mobile-overlap-before-theme-792x360.png` `b4e77909…` | `mobile-overlap-after-theme-792x360.png` `bc2219b6…` |
| 667×375 | `…before-theme-667x375.png` `f8c46659…` | `…after-theme-667x375.png` `7f11be5d…` |
| 844×390 | `…before-theme-844x390.png` `b8202425…` | `…after-theme-844x390.png` `419773df…` |

## 六、复现脚本（临时，未入库）

- `handoff/mobile-overlap-measure.mjs` — 依次走 大厅 → 选择拓展玩法 → 主题大厅，对可见可点元素两两求交叠面积，
  并列出「同列/同排、间隙 ≤ N px」的近邻对、≤32px 的可点元素、滚动量；`SP_CSSOFF=1` 用 CSSOM 删掉本次新增的
  媒体块，得到「改动前」的 rect。`SP_MODE=zhajing` 测炸惊那一屏，`SP_VIEWPORTS` 换视口。
- `handoff/mobile-overlap-diff.mjs` — 桌面 rect 逐值比对。
- `handoff/mobile-overlap-report.mjs` — 四对控件改前/改后间隙对照。

## 七、没动的既有小目标（供业主决定，不是本次回归）

手机横屏下这些可点元素仍 <32px，都是**改动前就有**、且被测试当契约钉住的触摸地板：

- `.ext-party__chip`（单人/同盟）与 `.ext-tier`（蚀流 1–6）：24px（`extension-modes.test.js:629-631` 明确要求 24px 地板）
- `.ext-theme__guide`（攻略说明/规则/功能设置）与 `.ext-theme__slot`（S.W.E.E.P.报告）：30px
  （`zhajing-loadout.test.js:354` 断言短屏 `.ext-theme__slot` 就是 `max(.34rem, 30px)`）
- 大厅右侧两块板：28px（短屏 `max(.56rem, 32px, …)` 被实际内容压到 28px）

要一律抬到 32px 的话是另一件事（会动上述两处断言），本次没做。

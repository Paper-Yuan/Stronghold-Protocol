// public/js/ui/settingsPolish.js — 设置面板的观感补丁（纯 CSS，注入即生效，无挂载点）。
//
// 两处真实缺陷，都在 设置 里能看到：
//
//   1. `.set-row__note` 和 `.set-row__val.is-off` 在上游所有样式表里**一条规则都没有**。`同人内容包` 那一行把说明
//      放在 <small class="set-row__note"> 里，于是它按自动落位挤进网格第 3 列（`auto` 轨道，宽度=内容的 max-content），
//      整行被撑破、文字压到上下相邻的行上；同时「未启用」沿用 `.set-row__val` 的薄荷绿——那是**数值**的颜色，不是
//      关闭状态的颜色。这一行看起来像坏了。
//
//   2. 一组彼此独立的开关，不能借用单选组的观感。`.set-seg button.is-on` 是**整块薄荷填充**，这在一个组里只能选中
//      一项时是对的（语音语言 / 画面质量 / 文字大小），在 N 项可以同时打开时是错的：六个填满的按钮被
//      `flex: 1 1 auto` 拉满整行，糊成一大块绿色。
//
// 所以：说明文字拿到自己的列与字号，关闭状态拿到自己的颜色，开关组改成紧凑的「圆点」按钮——开=暗薄荷底+亮点，
// 关=灰底+空心点。一眼可读，而且不可能再糊成一片，因为按钮宽度只跟文字走。
//
// 所有规则都以 `.set-seg.set-seg--hubsections` 这类双类名抬高特异度，稳定压过上游的 `.set-seg button` /
// `.set-seg button.is-on` / `.set-seg button:last-child`，不依赖注入顺序；单选组（`.set-seg` 但没有
// `--hubsections`）的实心选中样式完全不受影响。

const STYLE_ID = 'sp-settings-polish-style';

/** The stylesheet, exported so the tests can assert on the rules without a DOM. */
export const SETTINGS_POLISH_CSS = [
  // ---- 1. 缺失的说明 / 关闭状态规则 ---------------------------------------------------------------
  // 说明文字：上游没有它的规则，所以它按自动落位挤进第 3 列并把整行撑破。让它单独占一行、横跨整行宽度。
  '.set-row--mod { row-gap: .05rem; }',
  '.set-row--mod .set-row__label { grid-area: 1 / 1 / 2 / 2; }',
  '.set-row--mod .set-row__val { grid-area: 1 / 2 / 2 / 4; justify-self: end; }',
  '.set-row--mod .set-row__note {',
  '  grid-area: 2 / 1 / 3 / 4; margin: 0; font-size: calc(.14 * var(--t)); line-height: 1.6; color: var(--text-dim); }',
  // `.set-row__val` 是薄荷绿，因为它显示的是**数值**；一个表示「关」的状态不该穿数值的颜色
  '.set-row__val.is-on { color: var(--mint-400); }',
  '.set-row__val.is-off { color: var(--amber); }',
  // a value still being read is neither on nor off: muted, not mint and not amber
  '.set-row__val.is-checking { color: var(--text-lo); }',
  // ---- 节奏：两个 mod 行是一组，像 快捷键 / 问题反馈 那样用一条发丝线起头 --------------------------
  '.set-row--hubsections { margin-top: .06rem; padding-top: .16rem; border-top: 1px solid var(--line); }',
  '.set-row--mod { padding-top: .16rem; border-top: 1px solid var(--line); }',
  // ---- 2. 开关组，不是单选组 ---------------------------------------------------------------------
  // 外框去掉：六个按钮各自带边框，再套一层框就是双层线
  '.set-seg.set-seg--hubsections { gap: .06rem; border: 0; max-width: 100%; }',
  '.set-seg.set-seg--hubsections button {',
  '  flex: 0 1 auto; min-width: 0; height: .42rem; padding: 0 .12rem; gap: .07rem;',
  '  display: inline-flex; align-items: center; justify-content: center;',
  '  background: #0a0d0c; border: 1px solid var(--line-2);',
  '  color: var(--text-lo); font-size: calc(.15 * var(--t)); font-weight: 400; white-space: nowrap;',
  '  transition: color var(--t-fast), border-color var(--t-fast), background var(--t-fast); }',
  // 状态用一个圆点表示。刻意用 background-image 而不是 ::before：devices.css 的触屏热区规则
  // `.sp-coarse :is(… .bslot .bond …, .set-seg button)::before` 特异度 (0,3,0)，比这里的 (0,2,1) 高，
  // 会把 ::before 抢去做一个 44px 透明热区——我的点于是被撑成整块薄荷、盖在文字上（触屏设备实测：
  // 六个实心绿块、文字看不见）。background-image 没有伪元素可撞，触屏 / 桌面表现一致。
  // 点画在左内边距里（padding-left .28rem，圆心 .14rem、半径 .05rem）。
  '.set-seg.set-seg--hubsections button { padding-left: .28rem;',
  '  background-image: radial-gradient(circle at .14rem 50%, transparent 0 .035rem, var(--line-3) .045rem .05rem, transparent .055rem); }',
  '.set-seg.set-seg--hubsections button.is-on {',
  '  background-color: var(--mint-900); border-color: var(--mint-700); color: var(--mint-400); font-weight: 400;',
  '  background-image: radial-gradient(circle at .14rem 50%, var(--mint-400) 0 .05rem, transparent .055rem); }',
  '.set-seg.set-seg--hubsections button:hover { border-color: var(--mint-700); color: var(--text-hi); }',
  '.set-seg.set-seg--hubsections button.is-on:hover { color: var(--mint-glow); }',
  // 上游 `.set-seg button:last-child { border-right: 0 }` 会把最后一个按钮的右边框吃掉（(0,2,1)），
  // 这里用 (0,3,1) 压住它——每个按钮都要四边完整
  '.set-seg.set-seg--hubsections button:last-child { border-right: 1px solid var(--line-2); }',
  // 六个片挤在第 3 列（约 1fr 宽）里会绕成 4 行：让这一行改成「标签独占一行、开关组用整行宽度」，
  // 实测从 4 行压到 2 行，整行反而更矮（113px → 87px）。只影响本 mod 自己的行，不动别的 .set-row。
  '.set-row.set-row--hubsections { grid-template-columns: minmax(0, 1fr); row-gap: .07rem; }',
  '.set-row--hubsections .set-row__label { grid-column: 1 / -1; }',
  '.set-seg.set-seg--hubsections { grid-column: 1 / -1; justify-self: stretch; }',
  // 最后一个圆角片是「收起 / 展开」而不是功能开关：多留一点间距，让它自己成一组（仍然是同一个开关样式，
  // 因为「展开」和「显示」在这里是同一个意思）
  '.set-seg.set-seg--hubsections .set-seg__fold { margin-left: .06rem; }',
  // ---- 触屏：44px 起的手感，沿用上游 `.sp-coarse` 的做法 ------------------------------------------
  ':is(.sp-touch, .sp-coarse) .set-seg.set-seg--hubsections button { height: max(.42rem, 34px); }',
].join('\n');

/** Inject the stylesheet once. Safe to call repeatedly (and on the server, where there is no document). */
export function applySettingsPolish() {
  const doc = globalThis.document;
  if (!doc || doc.getElementById(STYLE_ID)) return;
  const el = doc.createElement('style');
  el.id = STYLE_ID;
  el.textContent = SETTINGS_POLISH_CSS;
  doc.head?.appendChild(el);
}

applySettingsPolish();

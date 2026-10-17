// public/js/ui/idleDim.js — 闲置淡出：一段时间没有点击/按键，大厅里的操作类元素默认半透明，
// 一有输入立刻恢复（业主 2026-10-17：「一段时间不点击默认透明些」）。
//
// 只改 <html> 上的 is-idle 类，样式全在 css/screens/lobby.css（.is-idle .hub-...）。
// 这样不碰任何组件的渲染：指针一落下去就回到 100%，也不会和 hover/focus 打架。

/** 多久没有输入就变淡（毫秒）。 */
export const IDLE_MS = 8000;

let timer = 0;
let bound = false;

function armIdle() {
  const el = globalThis.document?.documentElement;
  if (!el) return;
  clearTimeout(timer);
  timer = setTimeout(() => el.classList.add('is-idle'), IDLE_MS);
}

function wake() {
  const el = globalThis.document?.documentElement;
  if (!el) return;
  el.classList.remove('is-idle');
  armIdle();
}

/** 挂上闲置监听（重复调用是安全的）。 */
export function startIdleDim() {
  if (bound || !globalThis.document) return;
  bound = true;
  for (const ev of ['pointerdown', 'pointermove', 'keydown', 'wheel', 'touchstart']) {
    globalThis.addEventListener(ev, wake, { passive: true });
  }
  armIdle();
}
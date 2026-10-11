import { fullscreen, detectFeatures } from './js/ui/device.js';

export function installFullscreenPrompt(win = globalThis) {
  const document = win.document;
  if (!document?.body) return () => {};
  const features = detectFeatures(win);
  if (fullscreen.active(win) || features.standalone ||
      document.getElementById('sp-fullscreen-prompt')) return () => {};

  const previousFocus = document.activeElement;
  const supported = fullscreen.supported(win);

  function make(tag, cls, text = '') {
    const el = document.createElement(tag);
    el.className = cls;
    el.textContent = text;
    return el;
  }

  const mask = make('div', 'spfs-mask');
  mask.hidden = true;
  const dialog = make('dialog', 'spfs-dialog');
  dialog.id = 'sp-fullscreen-prompt';
  dialog.hidden = true;
  dialog.setAttribute('aria-labelledby', 'spfs-title');
  dialog.setAttribute('aria-describedby', 'spfs-description');

  const nativeDialog = typeof dialog.showModal === 'function';
  if (!nativeDialog) {
    dialog.dataset.fallback = 'true';
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
  }

  const brand = make('div', 'spfs-brand', '卫戍协议 · 盟约');
  const icon = make('div', 'spfs-icon', '⛶');
  icon.setAttribute('aria-hidden', 'true');
  const title = make('h2', 'spfs-title', '建议开启全屏游玩');
  title.id = 'spfs-title';
  const description = make('p', 'spfs-description',
    supported
      ? '隐藏浏览器栏，让棋盘和操作界面完整显示。手机玩家建议横屏游玩。'
      : '当前浏览器未开放网页全屏功能。手机玩家建议横屏，也可以继续使用普通模式。');
  description.id = 'spfs-description';

  const notice = make('p', 'spfs-notice');
  notice.setAttribute('role', 'status');
  const actions = make('div', 'spfs-actions');
  const primary = make('button', 'spfs-primary',
    supported ? (win.innerHeight > win.innerWidth ? '横屏全屏游玩' : '进入全屏游玩') : '继续普通模式');
  primary.type = 'button';
  primary.autofocus = true;
  const skip = make('button', 'spfs-secondary', '继续普通模式');
  skip.type = 'button';
  skip.hidden = !supported;
  actions.append(primary, skip);

  dialog.append(brand, icon, title, description, notice, actions);
  document.body.append(mask, dialog);

  let finished = false, busy = false;
  const cleanup = [];
  const inertBackup = new Map();

  function listen(target, type, fn, options) {
    target.addEventListener(type, fn, options);
    cleanup.push(() => target.removeEventListener(type, fn, options));
  }

  function restoreInert() {
    for (const [el, value] of inertBackup) el.inert = value;
    inertBackup.clear();
  }

  function hide() {
    if (nativeDialog && dialog.open) dialog.close();
    else dialog.removeAttribute('open');
    dialog.hidden = true;
    mask.hidden = true;
    restoreInert();
  }

  function show() {
    if (finished) return;
    dialog.hidden = false;
    if (nativeDialog) {
      if (!dialog.open) dialog.showModal();
    } else {
      mask.hidden = false;
      dialog.setAttribute('open', '');
      for (const el of document.body.children) {
        if (el === dialog || el === mask || !('inert' in el)) continue;
        inertBackup.set(el, el.inert);
        el.inert = true;
      }
    }
    queueMicrotask(() => {
      if (!finished && !dialog.hidden) primary.focus({ preventScroll: true });
    });
  }

  function finish() {
    if (finished) return;
    finished = true;
    hide();
    for (const fn of cleanup) fn();
    dialog.remove();
    mask.remove();
    if (previousFocus?.isConnected)
      previousFocus.focus?.({ preventScroll: true });
  }

  async function enter(event) {
    event.stopPropagation();
    if (busy || finished) return;
    if (!supported) { finish(); return; }

    busy = true;
    primary.disabled = true;
    notice.textContent = '';

    // 在点击事件内直接调用，保留浏览器要求的用户激活。
    hide();
    try {
      const entered = await fullscreen.enter(win);
      if (finished) return;

      // 兼容异步切换全屏的浏览器。
      if (entered && !fullscreen.active(win))
        await new Promise(resolve => setTimeout(resolve, 600));

      if (finished) return;
      if (fullscreen.active(win)) {
        finish();
        return;
      }
      notice.textContent = '未能进入全屏，请再次点击，或继续普通模式。';
    } catch {
      notice.textContent = '浏览器未允许全屏，请再次点击，或继续普通模式。';
    } finally {
      busy = false;
      primary.disabled = false;
      if (!finished) show();
    }
  }

  listen(primary, 'click', enter);
  listen(skip, 'click', finish);
  listen(mask, 'click', finish);
  listen(dialog, 'click', event => {
    if (event.target !== dialog) return;
    const box = dialog.getBoundingClientRect();
    if (event.clientX < box.left || event.clientX > box.right ||
        event.clientY < box.top || event.clientY > box.bottom) finish();
  });
  listen(dialog, 'cancel', event => {
    event.preventDefault();
    finish();
  });

  listen(dialog, 'keydown', event => {
    if (event.key === 'Escape') {
      event.preventDefault();
      finish();
    } else if (event.key === 'Tab') {
      const buttons = [primary, skip].filter(button => !button.hidden && !button.disabled);
      const first = buttons[0], last = buttons[buttons.length - 1];
      if (first && event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (last && !event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
    event.stopPropagation();
  });

  // 提示窗内的交互不触发游戏快捷键或棋盘操作。
  for (const type of [
    'keyup', 'keypress', 'click', 'pointerdown', 'pointerup',
    'touchstart', 'touchend', 'wheel',
  ]) listen(dialog, type, event => event.stopPropagation());

  const onFullscreen = () => {
    if (fullscreen.active(win)) finish();
  };
  listen(document, 'fullscreenchange', onFullscreen);
  listen(document, 'webkitfullscreenchange', onFullscreen);
  listen(win, 'pagehide', finish, { once: true });

  show();
  return finish;
}

export function installPortraitFullscreen(win = globalThis) {
  const doc = win.document;
  if (!doc?.body || doc.getElementById('sp-portrait-fullscreen')) return () => {};
  const box = doc.createElement('div');box.id = 'sp-portrait-fullscreen';
  Object.assign(box.style, { position: 'fixed', bottom: 'max(16px, env(safe-area-inset-bottom))', left: '50%', transform: 'translateX(-50%)', zIndex: '10000', width: 'min(300px, 88vw)', textAlign: 'center', pointerEvents: 'auto' });
  const button = doc.createElement('button');button.type = 'button';button.textContent = '⛶ 横屏全屏游玩';
  Object.assign(button.style, { padding: '12px 20px', minHeight: '46px', width: '100%', color: '#071713', background: '#51d8b3', border: '1px solid #9dffe2', borderRadius: '6px', fontSize: '16px', fontWeight: '700', boxShadow: '0 3px 14px #0009', cursor: 'pointer' });
  const notice = doc.createElement('div');notice.setAttribute('role', 'status');
  Object.assign(notice.style, { fontSize: '13px', color: 'white', background: '#10231deb', lineHeight: '1.5', borderRadius: '4px', marginTop: '5px' });
  box.append(button, notice);doc.body.append(box);
  const sync = () => { box.hidden = !(win.innerHeight > win.innerWidth); };
  const enter = async event => {
    event.stopPropagation();if (button.disabled) return;button.disabled = true;notice.textContent = '';
    try {
      if (!fullscreen.supported(win)) { notice.textContent = '浏览器不支持网页全屏，请手动旋转手机横屏。';return; }
      const entered = await fullscreen.enter(win);
      if (!entered) { notice.textContent = '未能进入全屏，请重试或手动旋转手机。';return; }
      if (win.innerHeight > win.innerWidth) notice.textContent = '已请求全屏；若未自动横屏，请手动旋转手机。';
    } finally { button.disabled = false;sync(); }
  };
  button.addEventListener('click', enter);
  for (const name of ['resize', 'orientationchange']) win.addEventListener(name, sync);
  doc.addEventListener('fullscreenchange', sync);doc.addEventListener('webkitfullscreenchange', sync);
  sync();
  const dispose = () => { button.removeEventListener('click', enter);for (const name of ['resize', 'orientationchange']) win.removeEventListener(name, sync);doc.removeEventListener('fullscreenchange', sync);doc.removeEventListener('webkitfullscreenchange', sync);box.remove();win.removeEventListener('pagehide', dispose); };
  win.addEventListener('pagehide', dispose, { once: true });return dispose;
}

if (globalThis.document) {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => { installPortraitFullscreen();installFullscreenPrompt(); }, { once: true });
  } else {
    installPortraitFullscreen();installFullscreenPrompt();
  }
}

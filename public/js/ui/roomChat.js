import { createRoomDanmaku } from './roomDanmaku.js';
import { outlineIcon } from './voiceIcons.js';
import { net } from '../net.js';
import { store } from '../store.js';
import { t } from '../../../shared/i18n.js';

export function mountRoomChat() {
  const danmaku = createRoomDanmaku();
  const root = document.createElement('div');
  root.className = 'spchat';
  root.hidden = true;

  function make(tag, cls, text = '') {
    const el = document.createElement(tag);
    el.className = cls;
    el.textContent = text;
    return el;
  }

  const panel = make('section', 'spchat__panel');
  panel.setAttribute('aria-label', t('同盟聊天'));
  const header = make('header', 'spchat__header');
  const title = make('span', 'spchat__title', t('同盟通讯'));
  const fold = make('button', 'spchat__fold', '−');
  fold.type = 'button';
  fold.setAttribute('aria-label', t('折叠聊天'));
  const danmakuButton = make('button', 'spchat__danmaku');
  danmakuButton.type = 'button';
  Object.assign(danmakuButton.style, { color: 'inherit', background: 'transparent', border: '1px solid currentColor', fontSize: '11px', minHeight: '28px', cursor: 'pointer' });
  function updateDanmakuButton() { danmakuButton.textContent = danmaku.enabled ? t('弹幕开') : t('弹幕关');danmakuButton.setAttribute('aria-pressed', String(danmaku.enabled)); }
  updateDanmakuButton();
  header.append(title, danmakuButton, fold);

  const log = make('div', 'spchat__log');
  log.setAttribute('role', 'log');
  log.setAttribute('aria-live', 'polite');
  const hint = make('div', 'spchat__hint', t('同盟通讯已连接'));
  const form = make('form', 'spchat__form');
  // 发言框：多行起步（业主 2026-10-28「优化发言框高度」）—— textarea rows=1 + 随内容长高到 96px，超过就内部滚动。
  // 回车发送、Shift+Enter 换行；输入法合成中（isComposing）回车不发送。
  const input = make('textarea', 'spchat__input');
  input.rows = 1;
  input.maxLength = 200;
  input.placeholder = t('输入消息…');
  input.autocomplete = 'off';
  input.setAttribute('enterkeyhint', 'send');
  input.setAttribute('aria-label', t('聊天消息'));
  /** 让发言框跟着内容长高：先归零再取 scrollHeight，夹在 CSS 的 min/max 之间（CSS 负责 44–96px 的两端）。 */
  const autoGrow = () => {
    input.style.height = 'auto';
    input.style.height = `${Math.min(input.scrollHeight, 400)}px`;
  };
  const sendButton = make('button', 'spchat__send', t('发送'));
  sendButton.type = 'submit';
  form.append(input, sendButton);
  panel.append(header, log, hint, form);

  const toggle = make('button', 'spchat__toggle');
  const unreadBadge = make('span', 'spchat__badge');
  unreadBadge.hidden = true;
  toggle.append(outlineIcon('chat'), unreadBadge);
  toggle.type = 'button';
  toggle.setAttribute('aria-label', t('展开或折叠聊天'));
  root.append(panel, toggle);
  document.body.append(root);

  let identity = null, expanded = true, pending = false;
  let composing = false, unread = 0, desired = null, position = null;
  let dragging = null, alive = true;
  let historyRequest = null;
  const received = new Map();
  const cleanup = [];

  function listen(target, type, fn, options) {
    target.addEventListener(type, fn, options);
    cleanup.push(() => target.removeEventListener(type, fn, options));
  }

  function viewport() {
    const v = window.visualViewport;
    return {
      x: v?.offsetLeft || 0,
      y: v?.offsetTop || 0,
      w: v?.width || window.innerWidth,
      h: v?.height || window.innerHeight,
    };
  }

  function clamp(point, v, w, h) {
    return {
      x: Math.max(v.x + 8, Math.min(point.x, Math.max(v.x + 8, v.x + v.w - w - 8))),
      y: Math.max(v.y + 8, Math.min(point.y, Math.max(v.y + 8, v.y + v.h - h - 8))),
    };
  }

  // SPCHAT_DRAGGABLE_TOGGLE_V1
  let fabRatio = null, fabPosition = null, fabDrag = null, blockClickUntil = 0;
  try {
    const saved = JSON.parse(localStorage.getItem('sp.chat.toggle.position.v1'));
    if (saved && Number.isFinite(saved.x) && Number.isFinite(saved.y) &&
        saved.x >= 0 && saved.x <= 1 && saved.y >= 0 && saved.y <= 1)
      fabRatio = saved;
  } catch {}

  function layout() {
    if (!alive || !identity) return;
    const v = viewport();
    const compact = v.w < 760 || v.h < 520;
    const w = Math.max(1, Math.min(compact ? 360 : 320, v.w - 16));
    const h = Math.max(1, Math.min(compact ? 300 : 300, v.h - 16));
    const sx = Math.max(0, v.w - 52), sy = Math.max(0, v.h - 52);
    fabPosition = clamp(fabRatio
      ? { x: v.x + 8 + fabRatio.x * sx, y: v.y + 8 + fabRatio.y * sy }
      : { x: v.x + 16, y: v.y + v.h - 52 }, v, 36, 36);
    Object.assign(toggle.style, {
      left: fabPosition.x + 'px', top: fabPosition.y + 'px',
    });
    // 手机/矮屏：面板从底部居中出现（底部抽屉），不压住左侧座位卡；桌面仍是左下角。
    let initial = compact
      ? { x: v.x + Math.max(8, (v.w - w) / 2), y: v.y + Math.max(8, v.h - h - 8) }
      : { x: v.x + 16, y: v.y + v.h - h - 96 };
    if (fabRatio) {
      initial = { x: fabPosition.x + 44, y: fabPosition.y - h + 36 };
      if (initial.x + w > v.x + v.w - 8)
        initial.x = fabPosition.x - w - 8;
    }
    position = clamp(desired || initial, v, w, h);
    Object.assign(panel.style, {
      left: position.x + 'px', top: position.y + 'px',
      width: w + 'px', height: h + 'px',
    });
  }

  function controls() {
    input.disabled = !identity || net.status !== 'online';
    sendButton.disabled = pending || input.disabled;
    hint.textContent = net.status === 'online' ? t('同盟通讯已连接') : t('等待连接恢复…');
  }

  function requestHistory() {
    if (!identity || net.status !== 'online' || historyRequest) return;
    const key = { ...identity };
    const request = net.request('room.chat.history', { code: key.code });
    historyRequest = request;
    request.catch(() => {}).finally(() => {
      if (historyRequest === request) historyRequest = null;
    });
  }

  function open(value) {
    expanded = value;
    panel.hidden = !value;
    toggle.setAttribute('aria-expanded', String(value));
    if (value) {
      unread = 0;
      unreadBadge.hidden = true;
      log.scrollTop = log.scrollHeight;
    } else input.blur();
    layout();
  }

  function sync() {
    const state = store.get();
    const room = state.room;
    const playerId = state.me?.playerId;
    const seat = room?.seats?.find(s => s?.playerId === playerId);
    const spectator = room?.spectators?.find(s => s?.playerId === playerId);
    const member = (seat && !seat.isBot && !seat.left) || spectator;
    // 只在等待室显示；对局内用 ui/chatBox.js 的局内面板（否则两套聊天/弹幕会叠在一起）
    const next = state.session?.entered && room?.mode === 'coop' && !room?.inMatch && playerId && member
      ? { code: room.code, playerId } : null;

    if (next?.code === identity?.code && next?.playerId === identity?.playerId) return;
    identity = next;
    root.hidden = !next;
    received.clear();
    danmaku.clear();
    historyRequest = null;
    log.replaceChildren();
    input.value = ''; input.style.height = ''; // 清空后缩回两行高度（多行发言框）
    desired = null;
    dragging = null;
    title.textContent = next ? t('同盟通讯 · {code}', { code: next.code }) : t('同盟通讯');
    controls();
    // 手机/矮屏默认收起成右下角圆点（点开是底部抽屉），避免 230×220 的卡片压住座位与开始按钮；
    // 桌面保持展开。
    const v = viewport();
    open(!(v.w < 760 || v.h < 520));
    requestHistory();
  }

  function receive(msg, historical = false) {
    if (!identity || msg.code !== identity.code ||
        typeof msg.playerId !== 'string' || typeof msg.name !== 'string' ||
        typeof msg.text !== 'string' || msg.text.length > 200 ||
        !Number.isFinite(msg.time)) return;

    const key = Number.isSafeInteger(msg.id) ? msg.id : `${msg.playerId}:${msg.time}:${msg.text}`;
    if (received.has(key)) return;
    received.set(key, msg);
    while (received.size > 80) received.delete(received.keys().next().value);

    const mine = msg.playerId === identity.playerId;
    if (!historical) danmaku.show(msg, mine);
    const bottom = log.scrollHeight - log.scrollTop - log.clientHeight < 28;
    const row = make('div', `spchat__row${mine ? ' spchat__row--mine' : ''}`);
    const time = new Date(msg.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    row.append(
      make('div', 'spchat__name', `${msg.name} · ${time}`),
      make('div', 'spchat__bubble', msg.text),
    );
    log.append(row);
    while (log.childElementCount > 80) log.firstElementChild.remove();
    if (bottom || mine) log.scrollTop = log.scrollHeight;
    if (!historical && !expanded && !mine) {
      unread++;
      unreadBadge.textContent = unread > 9 ? '9+' : String(unread);
      unreadBadge.hidden = false;
    }
  }

  function receiveHistory(msg) {
    if (!identity || msg.code !== identity.code || !Array.isArray(msg.messages)) return;
    // A live message can arrive while the history request is in flight. Merge by server id.
    const all = [...msg.messages.slice(-80), ...received.values()].filter(m => m && typeof m === 'object')
      .sort((a, b) => (a.id || 0) - (b.id || 0) || a.time - b.time);
    received.clear();
    log.replaceChildren();
    for (const message of all) receive(message, true);
  }

  async function send(event) {
    event.preventDefault();
    if (!identity || pending || net.status !== 'online') return;
    composing = false; // A button submit is valid even if the IME omitted compositionend.
    const original = input.value;
    const text = original.trim();
    if (!text || text.length > 200) return;
    const key = { ...identity };
    pending = true;
    controls();
    try {
      await net.request('room.chat', { code: key.code, text });
      if (alive && identity?.code === key.code && identity?.playerId === key.playerId &&
          input.value === original) input.value = ''; input.style.height = ''; // 清空后缩回两行高度（多行发言框）
    } catch (error) {
      if (alive && identity?.code === key.code)
        hint.textContent = error.message || t('发送失败，请重试');
    } finally {
      pending = false;
      if (alive) {
        input.disabled = !identity || net.status !== 'online';
        sendButton.disabled = input.disabled;
      }
    }
  }

  listen(form, 'submit', send);
  listen(input, 'compositionstart', () => { composing = true; });
  listen(input, 'compositionend', () => { composing = false; });
  // Some mobile keyboards omit compositionend when closed or when the input loses focus.
  // Keep the battlefield backing canvas stable while the keyboard animates; only the chat
  // panel follows visualViewport, avoiding repeated WebGL buffer clears/reprojections.
  let frozenField = null, fieldStyles = null, restoreFieldTimer = 0;
  function restoreField() {
    clearTimeout(restoreFieldTimer);
    if (frozenField && fieldStyles) {
      for (const [name, value, priority] of fieldStyles) {
        if (value) frozenField.style.setProperty(name, value, priority);
        else frozenField.style.removeProperty(name);
      }
    }
    frozenField = fieldStyles = null;
  }
  listen(input, 'focus', () => {
    composing = false;
    clearTimeout(restoreFieldTimer);
    if (frozenField || !matchMedia('(any-pointer: coarse)').matches) return;
    const field = document.querySelector('.gm__field');
    if (!field || !field.clientWidth || !field.clientHeight) return;
    fieldStyles = ['width', 'height'].map(name => [name, field.style.getPropertyValue(name), field.style.getPropertyPriority(name)]);
    const { width, height } = field.getBoundingClientRect();
    frozenField = field;
    field.style.setProperty('width', width + 'px', 'important');
    field.style.setProperty('height', height + 'px', 'important');
  });
  listen(input, 'blur', () => {
    composing = false;
    clearTimeout(restoreFieldTimer);
    restoreFieldTimer = setTimeout(restoreField, 500);
  });
  listen(window, 'orientationchange', restoreField);
  cleanup.push(restoreField);

  listen(input, 'keydown', event => {
    if (event.key === 'Escape') {
      event.preventDefault();
      open(false);
      return;
    }
    // 多行发言框（业主 2026-10-28）：**回车发送、Shift+Enter 换行**。输入法合成中回车不发送（保持原逻辑）。
    if (event.key === 'Enter' && !event.isComposing && event.keyCode !== 229 && !composing) {
      if (event.shiftKey) return; // Shift+Enter：插一个换行，交给浏览器（textarea 的默认行为）
      event.preventDefault();
      if (typeof form.requestSubmit === 'function') form.requestSubmit();
      else form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    }
  });
  // 内容一变就重新量高度（粘贴、删字、换行都要跟上）
  listen(input, 'input', autoGrow);
  listen(toggle, 'click', event => {
    const pointerClick = event.detail > 0 || !!event.pointerType;
    if (pointerClick && performance.now() < blockClickUntil) {
      event.preventDefault();
      blockClickUntil = 0;
      return;
    }
    blockClickUntil = 0;
    open(!expanded);
  });

  listen(toggle, 'pointerdown', event => {
    if (!event.isPrimary || event.button !== 0 || !fabPosition) return;
    blockClickUntil = 0;
    fabDrag = {
      id: event.pointerId, x: event.clientX, y: event.clientY,
      start: { ...fabPosition }, moved: false,
    };
    toggle.setPointerCapture(event.pointerId);
  });

  listen(toggle, 'pointermove', event => {
    if (fabDrag?.id !== event.pointerId) return;
    const dx = event.clientX - fabDrag.x, dy = event.clientY - fabDrag.y;
    if (!fabDrag.moved && Math.hypot(dx, dy) < 6) return;
    fabDrag.moved = true;
    if (event.cancelable) event.preventDefault();
    const v = viewport();
    const p = clamp({
      x: fabDrag.start.x + dx, y: fabDrag.start.y + dy,
    }, v, 36, 36);
    fabRatio = {
      x: (p.x - v.x - 8) / Math.max(1, v.w - 52),
      y: (p.y - v.y - 8) / Math.max(1, v.h - 52),
    };
    desired = null;
    layout();
  });

  function finishFabDrag(event) {
    if (fabDrag?.id !== event.pointerId) return;
    const moved = fabDrag.moved;
    fabDrag = null;
    if (moved) {
      blockClickUntil = performance.now() + 400;
      try {
        localStorage.setItem('sp.chat.toggle.position.v1', JSON.stringify(fabRatio));
      } catch {}
    }
    if (toggle.hasPointerCapture(event.pointerId))
      toggle.releasePointerCapture(event.pointerId);
  }

  for (const type of ['pointerup', 'pointercancel', 'lostpointercapture'])
    listen(toggle, type, finishFabDrag);

  listen(danmakuButton, 'click', () => { danmaku.toggle();updateDanmakuButton(); });
  listen(fold, 'click', () => open(false));

  listen(header, 'pointerdown', event => {
    if ((event.target === fold || event.target === danmakuButton) || !event.isPrimary || event.button !== 0 || !position) return;
    event.preventDefault();
    dragging = {
      id: event.pointerId, x: event.clientX, y: event.clientY,
      start: { ...position },
    };
    header.setPointerCapture(event.pointerId);
  });
  listen(header, 'pointermove', event => {
    if (dragging?.id !== event.pointerId) return;
    desired = {
      x: dragging.start.x + event.clientX - dragging.x,
      y: dragging.start.y + event.clientY - dragging.y,
    };
    layout();
  });
  function finishDrag(event) {
    if (dragging?.id !== event.pointerId) return;
    dragging = null;
    desired = { ...position };
    if (header.hasPointerCapture(event.pointerId)) header.releasePointerCapture(event.pointerId);
  }
  for (const type of ['pointerup', 'pointercancel', 'lostpointercapture'])
    listen(header, type, finishDrag);

  for (const type of [
    'keydown', 'keyup', 'keypress', 'pointerdown', 'pointermove',
    'pointerup', 'touchstart', 'touchmove', 'touchend', 'click', 'wheel',
  ]) listen(root, type, event => event.stopPropagation());

  listen(window, 'resize', layout);
  if (window.visualViewport) {
    listen(window.visualViewport, 'resize', layout);
    listen(window.visualViewport, 'scroll', layout);
  }
  cleanup.push(net.on('room.chat', msg => receive(msg)), net.on('room.chat.history', receiveHistory),
    net.on('status', () => { controls(); requestHistory(); }), store.subscribe(sync));
  sync();

  return () => {
    alive = false;
    for (const fn of cleanup) fn();
    danmaku.dispose();
    root.remove();
  };
}

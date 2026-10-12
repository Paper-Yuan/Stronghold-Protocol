import { net } from '../net.js';
import { store } from '../store.js';
import { RoomVoiceClient } from '../roomVoiceClient.js';
import { outlineIcon } from './voiceIcons.js';

export function mountRoomVoice() {
  const voice = new RoomVoiceClient({ net, store });
  const el = (tag, cls, text = '') => {
    const node = document.createElement(tag);
    node.className = cls;
    node.textContent = text;
    return node;
  };

  const root = el('div', 'spvoice');
  const fab = el('button', 'spvoice__fab');
  fab.type = 'button';
  fab.setAttribute('aria-label', '展开或折叠同盟语音');

  const panel = el('section', 'spvoice__panel');
  panel.setAttribute('aria-label', '同盟语音');
  const header = el('header', 'spvoice__header');
  const title = el('strong', '', '同盟语音');
  const fold = el('button', 'spvoice__fold', '−');
  fold.type = 'button';
  fold.setAttribute('aria-label', '折叠语音');
  header.append(title, fold);

  const hint = el('div', 'spvoice__hint');
  const list = el('div', 'spvoice__list');
  hint.setAttribute('aria-live', 'polite');

  const listen = el('button', 'spvoice__action', '加入语音 · 只收听');
  const mic = el('button', 'spvoice__action', '开麦');
  const play = el('button', 'spvoice__action', '播放队友声音');
  const leave = el('button', 'spvoice__leave', '退出语音');
  for (const b of [listen, mic, play, leave]) b.type = 'button';

  panel.append(header, hint, list, listen, mic, play, leave);
  root.append(panel, fab);
  document.body.append(root);

  let expanded = false, ratio = null, position, dragging, block = 0;
  const off = [];
  try {
    const v = JSON.parse(
      localStorage.getItem('sp.voice.toggle.position.v1'),
    );
    if (v && [v.x, v.y].every(
      n => Number.isFinite(n) && n >= 0 && n <= 1,
    )) ratio = v;
  } catch {}

  function on(target, type, fn, options) {
    target.addEventListener(type, fn, options);
    off.push(() => target.removeEventListener(type, fn, options));
  }

  function viewport() {
    const v = window.visualViewport;
    return {
      x: v?.offsetLeft || 0, y: v?.offsetTop || 0,
      w: v?.width || innerWidth, h: v?.height || innerHeight,
    };
  }

  function layout() {
    const v = viewport();
    const sx = Math.max(0, v.w - 60);
    const sy = Math.max(0, v.h - 60);
    position = ratio
      ? { x: v.x + 8 + ratio.x * sx, y: v.y + 8 + ratio.y * sy }
      : { x: v.x + 16, y: v.y + v.h - 104 };

    position.x = Math.max(
      v.x + 8, Math.min(position.x, v.x + v.w - 52),
    );
    position.y = Math.max(
      v.y + 8, Math.min(position.y, v.y + v.h - 52),
    );
    Object.assign(fab.style, {
      left: position.x + 'px', top: position.y + 'px',
    });

    const width = Math.min(230, v.w - 16);
    panel.style.width = width + 'px';
    panel.style.maxHeight = Math.max(1, v.h - 16) + 'px';
    const height = Math.min(panel.offsetHeight || 230, v.h - 16);
    let x = position.x + 52;
    let y = position.y + 44 - height;
    if (x + width > v.x + v.w - 8)
      x = position.x - width - 8;

    // The default expanded panels should both be usable without dragging.
    // A saved or actively dragged voice position remains the player's choice.
    if (!ratio && expanded) {
      const chat = document.querySelector('.spchat:not([hidden]) .spchat__panel:not([hidden])');
      if (chat) {
        const box = chat.getBoundingClientRect();
        if (box.right + 8 + width <= v.x + v.w - 8) {
          x = box.right + 8;
          y = box.top;
        } else if (box.top - 8 - height >= v.y + 8) {
          x = box.left;
          y = box.top - 8 - height;
        }
      }
    }

    Object.assign(panel.style, {
      left: Math.max(
        v.x + 8, Math.min(x, v.x + v.w - width - 8),
      ) + 'px',
      top: Math.max(
        v.y + 8,
        Math.min(y, v.y + v.h - height - 8),
      ) + 'px',
    });
  }

  function open(value) {
    expanded = value;
    panel.hidden = !value;
    fab.setAttribute('aria-expanded', String(value));
    layout();
  }

  function render() {
    root.hidden = !voice.room;
    const onAir = !!voice.stream && voice.stream.getAudioTracks()
      .some(t => t.readyState === 'live');

    fab.replaceChildren(outlineIcon(onAir ? 'mic' : 'mute'));
    fab.classList.toggle('spvoice__fab--on', onAir);
    fab.title = onAir
      ? '正在开麦 · 点击控制'
      : '麦克风已关闭 · 点击控制';

    title.textContent = '同盟语音' +
      (voice.room ? ' · ' + voice.room.code : '');

    hint.textContent = voice.error ||
      (net.status !== 'online'
        ? '游戏已断线，麦克风已关闭'
        : voice.wantMic && !onAir
          ? '正在申请麦克风，可点击取消'
          : voice.joined
            ? onAir ? '正在开麦' : '只收听 · 已释放麦克风'
            : voice.joining
              ? '正在加入语音…'
              : '主动加入后才能听见队友');

    list.replaceChildren();
    for (const user of voice.users) {
      const p = voice.peers.get(user.playerId);
      const mine = user.playerId === voice.room?.playerId;
      const connected = mine || p?.pc.connectionState === 'connected';
      const row = el('div', 'spvoice__user');
      row.append(
        outlineIcon(user.muted ? 'mute' : 'mic'),
        el('span', '',
          user.name + (mine ? '（你）' : '') +
          (connected
            ? user.muted ? ' · 关麦' : ' · 开麦'
            : ' · 连接中')),
      );
      list.append(row);
    }

    listen.hidden = voice.joined;
    listen.disabled = !!voice.joining || net.status !== 'online';
    mic.disabled = net.status !== 'online' && !voice.wantMic;
    mic.textContent = voice.wantMic
      ? onAir ? '关麦 · 释放麦克风' : '取消开麦'
      : '开麦';
    play.hidden = !voice.blocked;
    leave.hidden = !voice.id;
    open(expanded);
  }

  async function run(fn) {
    try {
      await fn();
    } catch (e) {
      voice.error = e.message;
      voice.changed();
    }
  }

  on(fab, 'click', e => {
    if ((e.detail > 0 || e.pointerType) &&
        performance.now() < block) {
      e.preventDefault();
      block = 0;
      return;
    }
    block = 0;
    open(!expanded);
  });
  on(fold, 'click', () => open(false));
  on(listen, 'click', () => run(() => voice.join()));
  on(mic, 'click', () => {
    if (voice.wantMic) voice.mute();
    else run(() => voice.startMic());
  });
  on(play, 'click', () => voice.play());
  on(leave, 'click', () => voice.leave());

  on(fab, 'pointerdown', e => {
    if (!e.isPrimary || e.button !== 0) return;
    block = 0;
    dragging = {
      id: e.pointerId, x: e.clientX, y: e.clientY,
      start: { ...position }, moved: false,
    };
    fab.setPointerCapture(e.pointerId);
  });

  on(fab, 'pointermove', e => {
    if (dragging?.id !== e.pointerId) return;
    const dx = e.clientX - dragging.x;
    const dy = e.clientY - dragging.y;
    if (!dragging.moved && Math.hypot(dx, dy) < 6) return;
    dragging.moved = true;
    e.preventDefault();

    const v = viewport();
    const x = Math.max(
      v.x + 8, Math.min(dragging.start.x + dx, v.x + v.w - 52),
    );
    const y = Math.max(
      v.y + 8, Math.min(dragging.start.y + dy, v.y + v.h - 52),
    );
    ratio = {
      x: (x - v.x - 8) / Math.max(1, v.w - 60),
      y: (y - v.y - 8) / Math.max(1, v.h - 60),
    };
    layout();
  });

  function finish(e) {
    if (dragging?.id !== e.pointerId) return;
    const moved = dragging.moved;
    dragging = null;
    if (moved) {
      block = performance.now() + 400;
      try {
        localStorage.setItem(
          'sp.voice.toggle.position.v1', JSON.stringify(ratio),
        );
      } catch {}
    }
    if (fab.hasPointerCapture(e.pointerId))
      fab.releasePointerCapture(e.pointerId);
  }

  for (const type of [
    'pointerup', 'pointercancel', 'lostpointercapture',
  ]) on(fab, type, finish);

  for (const type of [
    'keydown', 'keyup', 'keypress', 'pointerdown', 'pointermove',
    'pointerup', 'touchstart', 'touchmove', 'touchend', 'click', 'wheel',
  ]) on(root, type, e => e.stopPropagation());

  on(window, 'resize', layout);
  if (window.visualViewport)
    for (const type of ['resize', 'scroll'])
      on(window.visualViewport, type, layout);
  on(document, 'fullscreenchange', layout);
  on(voice, 'change', render);
  render();

  return () => {
    off.forEach(fn => fn());
    voice.dispose();
    root.remove();
  };
}

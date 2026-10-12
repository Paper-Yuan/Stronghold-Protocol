// roomDanmaku.js — 局内与房间弹幕单例与渲染图层 (danmaku for chat messages in coop & solo modes).

let singleton = null;

export function createRoomDanmaku() {
  const layer = document.createElement('div');
  layer.className = 'spchat-danmaku';
  layer.setAttribute('aria-hidden', 'true');
  Object.assign(layer.style, {
    position: 'fixed',
    inset: '0',
    overflow: 'hidden',
    pointerEvents: 'none',
    zIndex: '120',
  });

  const mount = () => {
    if (document.body && !layer.parentNode) {
      document.body.append(layer);
    }
  };
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mount, { once: true });
  } else {
    mount();
  }

  let enabled = true;
  try {
    enabled = localStorage.getItem('sp.chat.danmaku.enabled') !== '0';
  } catch {}

  const active = new Map();

  function clear() {
    for (const [el, item] of active) {
      clearTimeout(item.timer);
      item.animation?.cancel();
      el.remove();
    }
    active.clear();
  }

  function show(message, mine = false) {
    if (!enabled || document.hidden || !message || typeof message.text !== 'string') return;
    mount();
    const lanes = innerHeight < 420 ? 3 : 4;
    const busy = new Set([...active.values()].map((item) => item.lane));
    let lane = 0;
    while (busy.has(lane)) lane++;
    if (lane >= lanes) return;

    const el = document.createElement('span');
    const sender = String(message.name || '博士').slice(0, 24);
    el.textContent = `${sender}：${message.text}`;
    Object.assign(el.style, {
      position: 'absolute',
      left: '100%',
      top: `${Math.max(78, innerHeight * 0.14) + lane * 30}px`,
      whiteSpace: 'nowrap',
      fontSize: innerHeight < 420 ? '14px' : '18px',
      fontWeight: '600',
      lineHeight: '28px',
      color: mine ? '#65f1ca' : '#ffffff',
      textShadow: '0 1px 3px #000, 1px 0 3px #000',
      maxWidth: 'min(680px, 85vw)',
      overflow: 'hidden',
      textOverflow: 'ellipsis',
      pointerEvents: 'none',
      userSelect: 'none',
    });
    layer.append(el);

    const duration = 8000;
    const distance = innerWidth + el.getBoundingClientRect().width + 20;
    const animation = el.animate(
      [{ transform: 'translateX(0)' }, { transform: `translateX(-${distance}px)` }],
      { duration, easing: 'linear' },
    );
    const remove = () => {
      clearTimeout(active.get(el)?.timer);
      active.delete(el);
      el.remove();
    };
    active.set(el, { lane, animation, timer: setTimeout(remove, duration + 500) });
    animation.onfinish = remove;
  }

  const visibility = () => { if (document.hidden) clear(); };
  document.addEventListener('visibilitychange', visibility);
  window.addEventListener('resize', clear);

  const instance = {
    show,
    clear,
    get enabled() { return enabled; },
    setEnabled(val) {
      enabled = Boolean(val);
      if (!enabled) clear();
      try {
        localStorage.setItem('sp.chat.danmaku.enabled', enabled ? '1' : '0');
      } catch {}
      return enabled;
    },
    toggle() {
      return this.setEnabled(!enabled);
    },
    dispose() {
      clear();
      layer.remove();
      document.removeEventListener('visibilitychange', visibility);
      window.removeEventListener('resize', clear);
      if (singleton === instance) singleton = null;
    },
  };
  return instance;
}

/** Get or initialize the global danmaku singleton. */
export function getRoomDanmaku() {
  if (!singleton) {
    singleton = createRoomDanmaku();
  }
  return singleton;
}

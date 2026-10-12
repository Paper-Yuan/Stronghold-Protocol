export function createRoomDanmaku() {
  const layer = document.createElement('div');
  layer.className = 'spchat-danmaku';layer.setAttribute('aria-hidden', 'true');
  Object.assign(layer.style, { position: 'fixed', inset: '0', overflow: 'hidden', pointerEvents: 'none', zIndex: '120' });
  document.body.append(layer);
  let enabled = true;
  try { enabled = localStorage.getItem('sp.chat.danmaku.enabled') !== '0'; } catch {}
  const active = new Map();
  function clear() { for (const [el, item] of active) { clearTimeout(item.timer);item.animation?.cancel();el.remove(); }active.clear(); }
  function show(message, mine) {
    if (!enabled || document.hidden) return;
    const lanes = innerHeight < 420 ? 3 : 4;
    const busy = new Set([...active.values()].map(item => item.lane));
    let lane = 0;while (busy.has(lane)) lane++;
    if (lane >= lanes) return;
    const el = document.createElement('span');el.textContent = `${message.name.slice(0, 24)}：${message.text}`;
    Object.assign(el.style, { position: 'absolute', left: '100%', top: `${Math.max(78, innerHeight * .14) + lane * 30}px`, whiteSpace: 'nowrap', fontSize: innerHeight < 420 ? '14px' : '18px', fontWeight: '600', lineHeight: '28px', color: mine ? '#65f1ca' : '#ffffff', textShadow: '0 1px 3px #000, 1px 0 3px #000', maxWidth: 'min(680px, 85vw)', overflow: 'hidden', textOverflow: 'ellipsis', pointerEvents: 'none' });
    layer.append(el);
    const duration = 8000, distance = innerWidth + el.getBoundingClientRect().width + 20;
    const animation = el.animate([{ transform: 'translateX(0)' }, { transform: `translateX(-${distance}px)` }], { duration, easing: 'linear' });
    const remove = () => { clearTimeout(active.get(el)?.timer);active.delete(el);el.remove(); };
    active.set(el, { lane, animation, timer: setTimeout(remove, duration + 500) });animation.onfinish = remove;
  }
  const visibility = () => { if (document.hidden) clear(); };
  document.addEventListener('visibilitychange', visibility);window.addEventListener('resize', clear);
  return { show, clear, get enabled() { return enabled; }, toggle() { enabled = !enabled;if (!enabled) clear();try { localStorage.setItem('sp.chat.danmaku.enabled', enabled ? '1' : '0'); } catch {}return enabled; }, dispose() { clear();layer.remove();document.removeEventListener('visibilitychange', visibility);window.removeEventListener('resize', clear); } };
}

// public/js/ui/extensions.js — 工坊包的**客户端面板宿主**（pack.json `client.panels`，DESIGN §28.8/§28.13）。
//
// 契约来自包自己（见 workshop/ave-mujica/ui/fever.js 与它的 README §6.2）：
//   * 槽位：`screen.game.overlay` → 对局屏根部的 `.mod-host`（全屏、不吃指针）；`root.overlays` → 全局浮层。
//   * 面板模块 `export function mount(ctx)`，ctx = { host, data, pack, panel }，返回 { unmount }。
//   * 组件改写 `export function wrap(ctx)`，ctx.props = 被包裹组件的 props，返回 (orig) => vnode。
//   * 模块与样式都由 `/mods/file/<pack>/<rel>` 提供；模块里可以 import '/js/...' 与 'preact'/'htm'（页面的 importmap 管）。
//
// 只挂**启用**的包（设置里的模组开关 → localStorage），关掉即 unmount 并撤掉它注入的样式表。

const ENABLED_KEY = 'sp.pref.enabledMods';
/** 槽位名 → 宿主元素的 CSS 选择器；没有就现建一个（对局屏由 screens/game.js 提供 .mod-host）。 */
const SLOT_HOSTS = Object.freeze({
  'screen.game.overlay': '.mod-host',
  'root.overlays': '#sp-mod-overlays',
});

/** 已挂载的面板：packId + panelId → { unmount, link } */
const mounted = new Map();
/** 组件改写链：component 名 → [{ packId, fn }] */
const wraps = new Map();
let packsCache = null;
let syncing = null;

/** 本机启用的模组 id（设置里那个开关；空 = 全开，与 modManagerModal 的语义一致）。 */
export function enabledPackIds() {
  try {
    const raw = localStorage.getItem(ENABLED_KEY);
    const list = raw ? JSON.parse(raw) : null;
    return Array.isArray(list) && list.length ? list : null;
  } catch { return null; }
}

/** 拉一次模组清单（带 client 面板声明的那个接口）。 */
async function loadPacks(force = false) {
  if (packsCache && !force) return packsCache;
  const res = await fetch('/api/mods', { cache: 'no-cache' });
  const j = await res.json();
  packsCache = Array.isArray(j?.packs) ? j.packs : [];
  return packsCache;
}

function hostFor(slot) {
  const sel = SLOT_HOSTS[slot] || null;
  if (!sel) return null;
  let el = document.querySelector(sel);
  if (!el && sel.startsWith('#')) {
    el = document.createElement('div');
    el.id = sel.slice(1);
    document.body.appendChild(el);
  }
  return el;
}

function styleLink(pack, rel) {
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.dataset.modPanel = pack;
  link.href = `/mods/file/${encodeURIComponent(pack)}/${rel}`;
  document.head.appendChild(link);
  return link;
}

/** 挂载一个包的一个面板。模块加载失败只记一条警告：一个坏包不该带走整个客户端。 */
async function mountPanel(pack, panel) {
  const key = `${pack.id}:${panel.id}`;
  if (mounted.has(key)) return;
  const host = hostFor(panel.slot);
  if (!host) return;
  const links = (Array.isArray(panel.styles) ? panel.styles : []).map((rel) => styleLink(pack.id, rel));
  const url = `/mods/file/${encodeURIComponent(pack.id)}/${panel.module}${pack.hash ? `?v=${pack.hash}` : ''}`;
  try {
    const mod = await import(/* @vite-ignore */ url);
    const handle = typeof mod.mount === 'function' ? mod.mount({ host, data: panel.data || [], pack, panel }) : null;
    mounted.set(key, { unmount: handle && handle.unmount, links });
    if (Array.isArray(panel.wraps)) {
      for (const w of panel.wraps) {
        if (!w || typeof w.component !== 'string' || typeof mod.wrap !== 'function') continue;
        if (!wraps.has(w.component)) wraps.set(w.component, []);
        wraps.get(w.component).push({ packId: pack.id, fn: mod.wrap });
      }
    }
  } catch (err) {
    console.warn('[extensions] panel failed to load', pack.id, panel.id, err);
    for (const l of links) l.remove();
  }
}

function unmountPanel(key) {
  const rec = mounted.get(key);
  if (!rec) return;
  try { rec.unmount?.(); } catch (err) { console.warn('[extensions] unmount failed', key, err); }
  for (const l of rec.links || []) l.remove();
  mounted.delete(key);
  for (const [component, list] of wraps) {
    const left = list.filter((w) => w.packId !== key.split(':')[0]);
    if (left.length) wraps.set(component, left); else wraps.delete(component);
  }
}

/** 把启用状态与已挂载面板对齐（设置里一开关就调）。 */
export async function syncModPanels() {
  if (syncing) return syncing;
  syncing = (async () => {
    const enabled = enabledPackIds();
    let packs = [];
    try { packs = await loadPacks(true); } catch (err) { console.warn('[extensions] /api/mods unavailable', err); }
    const wanted = new Set();
    for (const pack of packs) {
      if (enabled && !enabled.includes(pack.id)) continue;
      for (const panel of pack.client?.panels || []) {
        if (!panel || !panel.id || !panel.module || !panel.slot) continue;
        wanted.add(`${pack.id}:${panel.id}`);
        await mountPanel(pack, panel);
      }
    }
    for (const key of [...mounted.keys()]) if (!wanted.has(key)) unmountPanel(key);
  })().finally(() => { syncing = null; });
  return syncing;
}

/** 组件改写：把 registry 里该组件的每个 wrap 依次套上去，返回最终 vnode。 */
export function applyWraps(component, props, vnode) {
  const list = wraps.get(component);
  if (!list || !list.length) return vnode;
  let out = vnode;
  for (const w of list) {
    try {
      const fn = w.fn({ component, props });
      if (typeof fn === 'function') out = fn(out);
    } catch (err) { console.warn('[extensions] wrap failed', component, w.packId, err); }
  }
  return out;
}

/** 该组件的改写函数列表（game.js 用它把 Feed 之类的桥接组件渲染出来）。 */
export function packWraps(component, props) {
  const list = wraps.get(component) || [];
  return list.map((w) => (orig) => {
    try { const fn = w.fn({ component, props }); return typeof fn === 'function' ? fn(orig) : orig; }
    catch (err) { console.warn('[extensions] wrap failed', component, w.packId, err); return orig; }
  });
}

/** 启动：先对齐一次，之后跟着设置里的开关走；宿主元素晚出现（对局屏挂载）时再对齐一次。 */
export function installModExtensions() {
  syncModPanels();
  window.addEventListener('sp:mods-changed', () => { syncModPanels(); });
  // 对局屏是懒挂载的：.mod-host 出现前 mountPanel 会跳过，所以盯一下 DOM，出现就重试一次。
  try {
    const seen = new MutationObserver(() => {
      if (document.querySelector('.mod-host, #sp-mod-overlays')) syncModPanels();
    });
    seen.observe(document.documentElement, { childList: true, subtree: true });
  } catch { /* 没有 MutationObserver 就算了，设置里一开关仍会重试 */ }
}

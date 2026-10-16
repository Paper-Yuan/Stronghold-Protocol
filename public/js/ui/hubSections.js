// public/js/ui/hubSections.js — 大厅栏位开关: show or hide each feature of the lobby hub, plus a slide-away handle.
//
// The lobby hub is a 3-column grid (css/screens/lobby.css .hub-stage). Five parts of it are chrome a player may
// not want, and this module gives each its own switch in 设置 →「大厅栏位」:
//
//   center    .hub-center                     the emblem, "STRONGHOLD PROTOCOL ALLIANCE" and the title
//   right     .hub-right                      the whole right column (master switch)
//   recruit   .hub-right .hub-recruit         缺人同盟 card
//   sweep     .hub-right .hub-plate--sweep    S.W.E.E.P.报告 plate
//   loadout   .hub-right .hub-plate--loadout  干员调配 plate
//
// The last three are scoped under .hub-right on purpose: hub-plate--loadout also exists in room.js, and a lobby
// switch must never reach into the room screen.
//
// On top of the switches there is a small handle, mounted inside .hub-right__plates and sitting just left of the
// two plates, vertically centred on them (the spot the player pointed at). Clicking it slides the whole column
// off to the right; the handle cancels that slide with its own transform and parks on the screen edge. Clicking
// again slides the column back. The fold is separate from the switches: a switch removes a feature, the handle
// only tucks the column away for a moment.
//
// This module stays self-contained:
//
//   * the choice is a localStorage pref of its own (`hub.sections`), not a field of the upstream settings store;
//   * the hiding is CSS, injected at load, keyed off data-hub-* attributes on <html> — neither lobby.js (the
//     markup) nor lobby.css (the layout) is touched, and with no JavaScript the hub paints as designed;
//   * the handle is appended at runtime and re-attached through a MutationObserver, because the lobby mounts and
//     unmounts as routes change. Being absolutely positioned inside the plates block, it takes no layout space.
//
// Hiding .hub-center leaves row 1 to the left/right columns; hiding .hub-right leaves column 3 empty. Neither
// reflows the others, which is the point — a toggle that moved the remaining UI around would be worse than no
// toggle. The collapse is the one motion by design: the player asked for the column to slide right away.

import './settingsPolish.js';   // side-effect: the 设置 panel's own CSS fixes (see that file for why)
import { html, MicroLabel } from './components.js';
import { createStore, useStore, loadPref, savePref } from '../store.js';
import { t } from '../../../shared/i18n.js';

/** The five switches in 设置, in display order. `right` is the master for the column. */
export const HUB_SECTIONS = Object.freeze([
  { id: 'center', label: '大厅中央徽标', note: '徽标、STRONGHOLD PROTOCOL ALLIANCE 与「卫戍协议：盟约」标题' },
  { id: 'right', label: '右侧栏整体', note: '整个右侧栏（缺人同盟 + S.W.E.E.P.报告 + 干员调配）' },
  { id: 'recruit', label: '缺人同盟', note: '右侧栏的缺人同盟卡片' },
  { id: 'sweep', label: 'S.W.E.E.P.报告', note: '右侧栏的 S.W.E.E.P.报告 铭牌' },
  { id: 'loadout', label: '干员调配', note: '右侧栏的干员调配 铭牌（不影响房间里的同款按钮）' },
]);

const PREF_KEY = 'hub.sections';
const STYLE_ID = 'sp-hub-sections-style';
const HANDLE_ID = 'sp-hub-collapse-handle';
/** The handle mounts inside the plates block so it can hug the plates' left edge at their vertical centre. */
const MOUNT_SEL = '.hub-right__plates';

/** Default: everything on, nothing collapsed — the lobby as the UI hub drew it. */
export const HUB_SECTIONS_DEFAULT = Object.freeze({
  center: true, right: true, recruit: true, sweep: true, loadout: true, collapsed: false,
});

/** The saved choice, sanitised: unknown / missing / non-boolean fields fall back to the defaults. */
export function loadHubSections() {
  const raw = loadPref(PREF_KEY, null);
  const o = raw && typeof raw === 'object' ? raw : {};
  const out = {};
  for (const s of HUB_SECTIONS) out[s.id] = o[s.id] !== false;
  out.collapsed = o.collapsed === true;
  return out;
}

/** Persist a choice (the caller passes the whole object). */
export function saveHubSections(next) {
  const clean = {};
  for (const s of HUB_SECTIONS) clean[s.id] = next?.[s.id] !== false;
  clean.collapsed = next?.collapsed === true;
  savePref(PREF_KEY, clean);
  return clean;
}

/**
 * The stylesheet that does the hiding. Feature switches are display:none (no reflow of the rest of the grid).
 * The collapse slides .hub-right out to the right; the handle rides inside it but cancels the slide with its own
 * mirrored transform, so it ends up parked on the screen edge. The column width the maths uses is the same
 * calc() the grid uses for column 3, so the two always line up. Fade and pointer-events are applied to the
 * column's CONTENT rather than the column itself, because an opacity-0 ancestor would hide the handle too.
 */
function ensureStyle() {
  const doc = globalThis.document;
  if (!doc || doc.getElementById(STYLE_ID)) return;
  const el = doc.createElement('style');
  el.id = STYLE_ID;
  const colW = 'calc(var(--hub-entry-w) * 2 + var(--hub-gap))';
  el.textContent = [
    // feature switches — the three inner ones scoped under .hub-right so room.js is never touched
    'html[data-hub-center="off"] .hub-center { display: none !important; }',
    'html[data-hub-right="off"] .hub-right { display: none !important; }',
    'html[data-hub-recruit="off"] .hub-right .hub-recruit { display: none !important; }',
    'html[data-hub-sweep="off"] .hub-right .hub-plate--sweep { display: none !important; }',
    'html[data-hub-loadout="off"] .hub-right .hub-plate--loadout { display: none !important; }',
    // both plates off leaves the handle's anchor empty — nothing to fold back in, so no tab
    'html[data-hub-sweep="off"][data-hub-loadout="off"] .sp-hub-handle { display: none !important; }',
    // the plates block is the handle's containing block (it is otherwise static, so the column would be)
    '.hub-right__plates { position: relative; }',
    // the handle: a slim tab just left of the plates, centred on them (absolute — takes no layout space)
    '.sp-hub-handle { position: absolute; z-index: 3; top: 50%; right: calc(100% + .12rem);',
    '  transform: translateY(-50%);',
    '  width: .5rem; height: 1.05rem; padding: 0; display: grid; place-items: center;',
    '  font: 700 .3rem/1 ui-monospace, Consolas, monospace; color: rgba(223, 230, 226, .8);',
    '  background: rgba(9, 17, 16, .8); border: 1px solid rgba(223, 230, 226, .22); border-right: 0;',
    '  cursor: pointer; transition: transform .28s ease, color .12s ease;',
    '  border-radius: .05rem 0 0 .05rem; }',
    '.sp-hub-handle:hover { color: var(--mint-400); }',
    '.sp-hub-handle span { display: block; transition: transform .28s ease; }',
    // collapse: the column slides out right; its content fades (not the column — the handle lives inside it)
    '.hub-right { transition: transform .28s ease; }',
    // the fade is on the column's CONTENT, and excludes the handle: at equal specificity a later rule would
    // override the handle's own transition (losing its slide), and :not() also raises specificity here
    '.hub-recruit, .hub-right__plates > :not(.sp-hub-handle) { transition: opacity .28s ease; }',
    'html[data-hub-collapsed="on"] .hub-right { transform: translateX(calc(100% + 1rem)); pointer-events: none; }',
    'html[data-hub-collapsed="on"] .hub-recruit { opacity: 0; }',
    'html[data-hub-collapsed="on"] .hub-right__plates > :not(.sp-hub-handle) { opacity: 0; }',
    // the handle rides the slide and then eases back to the screen edge. Geometry: the column shifts right by
    // (W + 1rem), so the plates' left edge — and the handle .12rem before it — land (1rem - .36rem + .12rem) =
    // .76rem beyond the viewport edge... netting the stage padding out, the parked spot is .54rem left of the
    // slid spot. Same duration + easing as the column, so the two track exactly and it reads as one motion.
    'html[data-hub-collapsed="on"] .sp-hub-handle { pointer-events: auto;',
      '  transform: translateX(-.54rem) translateY(-50%); }',
    'html[data-hub-collapsed="on"] .sp-hub-handle span { transform: rotate(180deg); }',
    // the slid-out column must not grow a scrollbar on the mobile stage (overflow-y:auto computes overflow-x to auto)
    'html[data-hub-collapsed="on"] .hub-stage { overflow-x: hidden; }',
    // touch: a 44px-tall tap target on the same tab
    ':is(.sp-touch, .sp-coarse) .sp-hub-handle { width: max(.5rem, 22px); height: max(1.05rem, 48px); }',
    // phones (the stacked layout): the column already sits in the flow under the entries, so the fold is a
    // desktop convenience there — hide the handle and unfold anything left collapsed
    '@media (max-aspect-ratio: 4/3) { .sp-hub-handle { display: none !important; }',
    '  html[data-hub-collapsed="on"] .hub-right { transform: none; pointer-events: auto; }',
    '  html[data-hub-collapsed="on"] .hub-recruit, html[data-hub-collapsed="on"] .hub-right__plates > * { opacity: 1; } }',
  ].join('\n');
  doc.head?.appendChild(el);
}

/**
 * Put the choice on <html> as `data-hub-center` / … / `data-hub-collapsed` (`on` | `off`). The attributes — not
 * inline styles — keep the default in the stylesheet: without JavaScript, or with a profile a future version
 * dropped, the hub paints as the design drew it.
 * @param {Record<string, boolean>} [pref]
 */
export function applyHubSections(pref = store.get()) {
  ensureStyle();
  const el = globalThis.document?.documentElement;
  if (!el) return;
  for (const s of HUB_SECTIONS) el.dataset[`hub${s.id[0].toUpperCase()}${s.id.slice(1)}`] = pref[s.id] !== false ? 'on' : 'off';
  el.dataset.hubCollapsed = pref.collapsed === true ? 'on' : 'off';
  ensureHandle();
}

// ---- the collapse handle ---------------------------------------------------------------------------

/**
 * Keep the handle inside the live plates block. The lobby mounts and unmounts as routes change (and Preact owns
 * that subtree), so the handle is re-attached whenever the plates appear — see watchStage().
 */
function ensureHandle() {
  const doc = globalThis.document;
  if (!doc) return;
  const plates = doc.querySelector?.(MOUNT_SEL);
  let el = doc.getElementById?.(HANDLE_ID);
  if (!plates) { if (el?.remove) el.remove(); return; }
  if (!el) {
    el = doc.createElement('button');
    el.id = HANDLE_ID;
    el.className = 'sp-hub-handle';
    el.type = 'button';
    el.title = t('收起 / 展开右侧栏');
    el.setAttribute('aria-label', t('收起 / 展开右侧栏'));
    el.innerHTML = '<span>\u203A</span>';
    el.addEventListener('click', () => setHubCollapsed(store.get().collapsed !== true));
  }
  if (el.parentNode !== plates) plates.appendChild(el);
}

let stageWatcher = null;
/**
 * Re-attach the handle when it goes missing. Two ways that happens: the lobby unmounts and mounts again on a
 * route change, and Preact dropping our appended child while diffing the plates on a re-render (the rooms list
 * updates on every join/leave, so this is not hypothetical). Checking presence rather than only the mount edge
 * covers both; the check is one querySelector + one getElementById per mutation batch.
 */
function watchStage() {
  const doc = globalThis.document;
  // MutationObserver lives on window/globalThis, NOT on document — reading doc.MutationObserver is undefined
  // and the guard silently bailed, so the handle never re-attached after the lobby mounted.
  const MO = globalThis.MutationObserver;
  if (!doc || stageWatcher || typeof MO !== 'function' || !doc.body) return;
  stageWatcher = new MO(() => {
    const plates = doc.querySelector?.(MOUNT_SEL);
    if (!plates) { const h = doc.getElementById?.(HANDLE_ID); if (h?.remove) h.remove(); return; }
    if (doc.getElementById?.(HANDLE_ID)?.parentNode !== plates) ensureHandle();
  });
  stageWatcher.observe(doc.body, { childList: true, subtree: true });
}
/** The live store; a change is saved and applied at once. */
export const store = createStore(loadHubSections());
store.subscribe((s) => { saveHubSections(s); applyHubSections(s); });
// before the first render of the lobby (main.js renders after its imports ran) — no flash of the hidden regions
applyHubSections(store.get());
watchStage();

/** Preact hook: the current choice. */
export const useHubSections = () => useStore((s) => s, Object.is, store);

/** Flip one feature switch. @param {"center"|"right"|"recruit"|"sweep"|"loadout"} id */
export function setHubSection(id, on) {
  if (!HUB_SECTIONS.some((s) => s.id === id)) return;
  store.set({ ...store.get(), [id]: !!on });
}

/** Fold or unfold the whole right column (the handle). */
export function setHubCollapsed(v) {
  store.set({ ...store.get(), collapsed: !!v });
}

/**
 * 设置 →「大厅栏位」: one switch per feature, plus the fold state. Kept in this module so the mod owns its own
 * row; settings.js only mounts <HubSectionsRow/>.
 * @returns {any}
 */
export function HubSectionsRow() {
  const s = useHubSections();
  return html`<div class="set-row set-row--hubsections" data-testid="hub-sections">
    <span class="set-row__label">${t('大厅栏位')}<${MicroLabel}>HUB SECTIONS<//></span>
    <div class="set-seg set-seg--hubsections" role="group" aria-label=${t('大厅栏位')}>
      ${HUB_SECTIONS.map((x) => html`<button key=${x.id} type="button" role="switch"
        aria-checked=${s[x.id] ? 'true' : 'false'} data-testid=${`hub-section-${x.id}`}
        class=${s[x.id] ? 'is-on' : ''} title=${t(x.note)}
        onClick=${() => setHubSection(x.id, !s[x.id])}>${t(x.label)}</button>`)}
      <button key="collapse" type="button" role="switch"
        aria-checked=${s.collapsed ? 'false' : 'true'} data-testid="hub-section-collapse"
        class=${'set-seg__fold' + (s.collapsed ? '' : ' is-on')} title=${t('右侧栏是否展开（铭牌左侧的小把手同样可以）')}
        onClick=${() => setHubCollapsed(!s.collapsed)}>${t('右侧栏展开')}</button>
    </div>
  </div>`;
}

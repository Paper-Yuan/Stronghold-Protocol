// test/ui/extension-modes.test.js — 拓展模式: the hub's third card and 选择拓展玩法, its hall
// (screens/extensionModes.js). The hall is a catalogue of 玩法包 (play sets) beside the official four difficulties — not a
// difficulty and not a room mode — so nothing here creates a room: every entry states its own `status`, 开始 is lit only for
// a `ready` one, and the dossier says why a listed one cannot start yet. The layout is the reference page's second pass
// (public/dev/extension-hall-preview.html, 2026-10-26): dossier left (40 %), evenly spaced option list right (60 %), a fixed
// 88 / 64 / 56 px row height so a longer description never pushes the next row down, and the features in the dossier
// rather than in the row. Hook-free views drawn as vnode trees; the CSS is read as text. (The browser side:
// test/ui/lobby-hub.e2e.test.js, whose hub now expects three entries.) The 蚀流 tier and the 单人 / 同盟 form are the
// lobby's state, drawn as chips in the foot for a play set that declares `erosionTiers` and handed to `onPick`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
globalThis.fetch = async (url) => {
  const name = String(url).split('/').pop();
  try { const body = readFileSync(path.join(ROOT, 'data', name), 'utf8'); return { ok: true, status: 200, json: async () => JSON.parse(body) }; } catch { return { ok: false, status: 404, json: async () => ({}) }; }
};
const mem = new Map();
globalThis.localStorage = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) };

const { EXTENSION_MODES, ExtensionHall, extensionModeById, extensionModePlayable, extensionModeCount, defaultExtensionPick } =
  await import('../../public/js/screens/extensionModes.js');
const { Modal } = await import('../../public/js/ui/components.js');
const { ExtensionThemeHall, ExtThemeCodexView } = await import('../../public/js/screens/extensionThemeHall.js');
// 惊变一览（task-16）：二级页复用的就是这两个导出，本测试只读不碰它的内部。
const { JibianCodex, JibianCodexView } = await import('../../public/js/ui/jibian.js');
const { DIFFICULTIES } = await import('../../shared/constants.js');

const SRC = readFileSync(path.join(ROOT, 'public/js/screens/extensionModes.js'), 'utf8');
const THEME_SRC = readFileSync(path.join(ROOT, 'public/js/screens/extensionThemeHall.js'), 'utf8');
const LOBBY = readFileSync(path.join(ROOT, 'public/js/screens/lobby.js'), 'utf8');
const CSS = readFileSync(path.join(ROOT, 'public/css/screens/lobby.css'), 'utf8');
const THEME = readFileSync(path.join(ROOT, 'public/css/theme.css'), 'utf8');
const CONFIG = JSON.parse(readFileSync(path.join(ROOT, 'data/config.json'), 'utf8'));
const LANGS = ['en', 'ja', 'ko', 'zh-TW'];
const PACKS = LANGS.map((l) => [l, JSON.parse(readFileSync(path.join(ROOT, `public/i18n/${l}.json`), 'utf8'))]);

// ---- vnode helpers (the same shape as test/ui/lobby-hub.test.js) ------------------------------------
function* walk(v) {
  if (Array.isArray(v)) { for (const x of v) yield* walk(x); return; }
  if (!v || typeof v !== 'object') return;
  yield v;
  // the hall's back plate is a plain function component (no hooks): draw it so its button is visible
  if (typeof v.type === 'function' && v.type.name === 'ExtBack') { yield* walk(v.type(v.props)); return; }
  yield* walk(v.props?.children);
}
const hasClass = (v, c) => typeof v?.props?.class === 'string' && v.props.class.split(/\s+/).includes(c);
const find = (tree, pred) => [...walk(tree)].filter(pred);
const byClass = (tree, c) => find(tree, (v) => hasClass(v, c));
const textOf = (v) => (v == null || typeof v === 'boolean' ? '' : typeof v !== 'object' ? String(v) : Array.isArray(v) ? v.map(textOf).join('') : textOf(v.props?.children));
const byTestId = (tree, id) => find(tree, (v) => v.props?.['data-testid'] === id)[0];
const hall = (props = {}) => ExtensionHall({ onClose: () => {}, ...props });
/** The theme hall rendered on its own (a nested function component stays a vnode inside the hall's tree, like Modal). */
const themeHall = (props = {}) => ExtensionThemeHall({ mode: EXTENSION_MODES[0], onBack: () => {}, ...props });
/** The shipped table with its first entry back in the 待接入 state: no shipped play set is `pending` since 2026-10-27
 *  (湮灭模拟 turned `ready`), so the state that a half-ported pack shows is reached through the `modes` prop. */
const pendingTable = () => [
  { ...EXTENSION_MODES[0], status: 'pending', reason: 'PENDING // test' },
  // 业主 2026-10-28：产品表里不再有「筹备中」占位条目（无尽火力 / 深潜协议已删），这一支用一张合成表继续守
  { ...EXTENSION_MODES[1], id: 'placeholder-test', status: 'missing', reason: 'MISSING // test' },
  ...EXTENSION_MODES.slice(1),
];

// ---- CSS helpers ------------------------------------------------------------------------------------
/** Every plain rule of a style sheet as [selector, body], comments stripped; @-rule preludes are not selectors. */
function* cssRules(src) {
  for (const m of src.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/(?<=^|[{}])\s*([^{}@]+)\{([^{}]*)\}/g)) yield [m[1].trim(), m[2]];
}
/** The rules whose selector list names `sel` (a whole class token). */
const rulesFor = (src, sel) => [...cssRules(src)].filter(([s]) => s.split(',').some((x) => x.trim() === sel));
/** The one rule of `sel` (its body), failing loudly when it is missing or split. */
function ruleOf(src, sel) {
  const hits = rulesFor(src, sel);
  assert.equal(hits.length, 1, `${sel} is declared once (found ${hits.length})`);
  return hits[0][1];
}
/**
 * The balanced body of the first @media block whose prelude contains `query` — and, with `contains`, the first one whose
 * body also holds that string. A sheet may hold several blocks for one query (the hall's ladder and the theme hall's own
 * short-screen layout both answer to `max-height: 520px`), so the ladder test asks for the block that names the rows.
 */
function mediaBlock(src, query, contains = null) {
  for (let at = src.indexOf(`@media ${query}`); at > 0; at = src.indexOf(`@media ${query}`, at + 1)) {
    const open = src.indexOf('{', at);
    let depth = 0;
    for (let i = open; i < src.length; i += 1) {
      if (src[i] === '{') depth += 1;
      else if (src[i] === '}') { depth -= 1; if (depth === 0) {
        const body = src.slice(open + 1, i);
        if (!contains || body.includes(contains)) return body;
        break;
      } }
    }
    if (depth !== 0) throw new Error(`unbalanced @media ${query}`);
  }
  throw new Error(`@media ${query}${contains ? ` with ${contains}` : ''} exists`);
}
/** Whether any rule of `src` has a selector list that names all of `sels`. */
const groupNames = (src, ...sels) => [...cssRules(src)].some(([s]) => {
  const parts = s.split(',').map((x) => x.trim());
  return sels.every((sel) => parts.includes(sel));
});

// ---- the table ---------------------------------------------------------------------------------------
test('EXTENSION_MODES: frozen, unique ids, 湮灭模拟 first, its own code and colour (never an official difficulty)', () => {
  assert.ok(Object.isFrozen(EXTENSION_MODES));
  const ids = EXTENSION_MODES.map((m) => m.id);
  assert.equal(new Set(ids).size, ids.length, 'ids are unique');
  for (const m of EXTENSION_MODES) {
    assert.ok(['ready', 'pending', 'missing'].includes(m.status), `${m.id}: a known status`);
    for (const f of ['name', 'en', 'code', 'color', 'icon', 'desc', 'pack']) assert.equal(typeof m[f], 'string', `${m.id}: ${f}`);
    assert.ok(Array.isArray(m.features) && m.features.length > 0, `${m.id}: features`);
    assert.ok(Array.isArray(m.stats), `${m.id}: stats`);
    // a listed play set that cannot start must say why — the dossier shows this line. (A 筹备中 placeholder needs no
    // reason: its row is dashed and disabled, and the dossier falls back to the status word.)
    if (m.status === 'pending') assert.ok(m.reason, `${m.id}: a reason for ${m.status}`);
  }
  const first = EXTENSION_MODES[0];
  assert.equal(first.id, 'annihilation');
  assert.equal(first.code, 'AC-5', 'the play set\'s own mode code, not 1-1…1-4');
  assert.equal(first.color, '#5b0a14', 'the play set\'s own colour, not an official difficulty colour');
  assert.equal(first.en, 'ANNIHILATION');
  assert.equal(first.status, 'ready', 'the play set is in this build: the hall starts it (真机验收, 2026-10-27)');
  assert.equal(first.reason, undefined, 'a ready play set has no reason line — the dossier says it can start instead');
  assert.deepEqual(first.stats.map((s) => s.value), ['1–6', '87', '×5.7'], '蚀流 1–6, 87 藏品, 首领血点 ×5.7');
});

test('the helpers: lookup, playability, the hub card\'s count, the default dossier', () => {
  assert.equal(extensionModeById('annihilation').id, 'annihilation');
  assert.equal(extensionModeById('nope'), null);
  assert.equal(extensionModePlayable('annihilation'), true, 'a ready play set is playable');
  assert.equal(extensionModePlayable('placeholder-test'), false, 'a 筹备中 placeholder is not');
  assert.equal(extensionModePlayable('nope'), false);
  // the hub card counts what the hall lists, so the sign is never 「0 个玩法」 beside a hall that has an entry
  assert.equal(extensionModeCount(), EXTENSION_MODES.filter((m) => m.status !== 'missing').length);
  assert.ok(extensionModeCount() >= 1, 'the listed play sets');
  // the dossier opens on the first listed play set, not on a 筹备中 placeholder
  assert.equal(defaultExtensionPick(), 'annihilation');
  const fake = [{ id: 'a', status: 'missing' }, { id: 'b', status: 'pending' }];
  assert.equal(defaultExtensionPick(fake), 'b');
  assert.equal(defaultExtensionPick([{ id: 'only', status: 'missing' }]), 'only', 'falls back to the first entry');
});

// ---- the hall ----------------------------------------------------------------------------------------
test('选择拓展玩法: one row per play set, its code, a one-line description and its status chip', () => {
  const tree = hall();
  const rows = find(tree, (v) => hasClass(v, 'ext-row'));
  assert.equal(rows.length, EXTENSION_MODES.length, '1 → N: the table is what the list shows');
  assert.deepEqual(rows.map((r) => r.props['data-ext']), EXTENSION_MODES.map((m) => m.id));
  assert.deepEqual(rows.map((r) => r.props['data-status']), EXTENSION_MODES.map((m) => m.status));
  for (const [i, row] of rows.entries()) {
    const m = EXTENSION_MODES[i];
    assert.equal(row.type, 'button');
    assert.equal(row.props['data-testid'], `extension-row-${m.id}`);
    assert.ok(textOf(byClass(row, 'ext-row__name')[0]).includes(m.name), `${m.id}: its name`);
    assert.ok(textOf(byClass(row, 'ext-row__code')[0]).includes(m.code), `${m.id}: its own code`);
    assert.ok(textOf(byClass(row, 'ext-row__desc')[0]).includes(m.desc), `${m.id}: one-line description`);
    assert.equal(byClass(row, 'ext-row__desc').length, 1, 'exactly one description line (never a second one that grows the row)');
    // the features live in the dossier, not in the row — that was the fix for the uneven list
    for (const f of m.features) assert.ok(!textOf(row).includes(f), `${m.id}: ${f} is not in the row`);
    const chip = byClass(row, 'chip')[0];
    assert.ok(chip, `${m.id}: a status chip`);
  }
});

test('选择拓展玩法: 待接入 rows stay selectable, 筹备中 placeholders are dashed and disabled', () => {
  // 业主 2026-10-28：产品表只剩两条 ready（湮灭 + 炸惊），「筹备中」占位条目已删 —— 先钉「表里没有 missing」…
  assert.deepEqual(EXTENSION_MODES.map((m) => m.status), ['ready', 'ready'], 'the shipped catalogue is two ready play sets');
  assert.equal(EXTENSION_MODES.some((m) => m.status === 'missing'), false, 'no 筹备中 placeholder ships any more');
  // …再用一张合成表守「待接入 / 筹备中」这两支的样式与交互（将来再加占位时行为不变）
  const tree = hall({ modes: pendingTable() });
  const pending = find(tree, (v) => hasClass(v, 'ext-row') && v.props['data-status'] === 'pending')[0];
  assert.notEqual(pending.props.disabled, true, 'a pending play set can be inspected');
  const missing = find(tree, (v) => hasClass(v, 'ext-row') && v.props['data-status'] === 'missing');
  assert.ok(missing.length >= 1, 'a synthetic 筹备中 entry is still listed (the list must show 1 → N)');
  for (const row of missing) {
    assert.equal(row.props.disabled, true, 'not selectable');
    assert.ok(hasClass(row, 'is-placeholder'), 'drawn dashed');
    assert.ok(textOf(byClass(row, 'chip')[0]).includes('筹备中'));
  }
  // the status word of each row is its own
  const chips = find(tree, (v) => hasClass(v, 'chip'));
  assert.ok(chips.some((c) => textOf(c).includes('待接入')));
  assert.ok(chips.some((c) => textOf(c).includes('筹备中')));
});

test('选择拓展玩法: the dossier follows the selection (code, colour, numbers, features, the reason it cannot start)', () => {
  for (const m of EXTENSION_MODES.filter((x) => x.status !== 'missing')) {
    const tree = hall({ selected: m.id });
    const body = byClass(tree, 'ext__body')[0];
    assert.equal(body.props['data-extension'], m.id, 'the data-extension hook');
    assert.equal(body.props['data-status'], m.status);
    const stage = byTestId(tree, 'extension-stage');
    assert.ok(String(stage.props.style).includes(`--x-color:${m.color}`), 'the play set\'s own colour drives the stage');
    assert.ok(textOf(byClass(tree, 'ext-hero__code')[0]).includes(m.code));
    assert.ok(textOf(byClass(tree, 'ext-hero__name')[0]).includes(m.name));
    assert.ok(textOf(byClass(tree, 'ext-hero__en')[0]).includes(m.en), 'the latin name, like the hub card\'s');
    for (const f of m.features) assert.ok(textOf(byClass(tree, 'ext-feats')[0]).includes(f), `${m.id}: ${f} is in the dossier`);
    for (const s of m.stats) {
      const stat = byClass(tree, 'ext-stat').find((x) => textOf(x).includes(s.value));
      assert.ok(stat, `${m.id}: the ${s.value} tile`);
      assert.ok(textOf(stat).includes(s.label), `${m.id}: its label`);
    }
    const note = byTestId(tree, 'extension-note');
    if (m.status === 'ready') {
      assert.ok(textOf(note).includes('玩法包已就位'), `${m.id}: the dossier says it can start`);
      assert.ok(hasClass(byClass(tree, 'ext-note')[0], 'is-ready'), `${m.id}: the note is the ready one`);
    } else {
      assert.ok(textOf(note).includes(m.reason), `${m.id}: the dossier says why 开始 is dark`);
    }
  }
  // a half-ported pack: the same dossier, but the note is its own reason line (reached through `modes`)
  const pending = hall({ modes: pendingTable() });
  const note = byTestId(pending, 'extension-note');
  assert.ok(textOf(note).includes('PENDING // test'), 'a pending play set shows its reason');
  assert.ok(!hasClass(byClass(pending, 'ext-note')[0], 'is-ready'));
});

test('选择拓展玩法: 进入 is lit only for a ready play set, and says why when it is not', () => {
  // the shipped table: 湮灭模拟 is ready, so 进入 is lit — the theme hall comes next, not the room
  const live = byTestId(hall(), 'extension-enter');
  assert.notEqual(live.props.disabled, true, 'a ready play set can be entered');
  assert.equal(textOf(live), '进入', 'the button names the step: into the play set\'s own hall');
  let entered = 0;
  const pickedEarly = [];
  const t2 = hall({ onEnter: () => { entered += 1; }, onPick: (id) => pickedEarly.push(id) });
  byTestId(t2, 'extension-enter').props.onClick();
  assert.equal(entered, 1, '进入 asks the lobby for the theme hall');
  assert.deepEqual(pickedEarly, [], '进入 does not create the room itself');

  // a 待接入 entry: the button says the state, and its tooltip is the reason
  const dark = byTestId(hall({ modes: pendingTable() }), 'extension-enter');
  assert.equal(dark.props.disabled, true, 'a pending play set cannot be entered');
  assert.equal(textOf(dark), '待接入', 'the button says the state, not 进入');
  assert.ok(String(dark.props.title).includes('PENDING // test'), 'its tooltip is the reason');

  // a play set without a theme keeps the one-step path: 开始 hands onPick the id straight away
  const ready = [{ ...EXTENSION_MODES[0], status: 'ready' }];
  const plainReady = [{ ...ready[0], theme: undefined }];
  const picked = [];
  const tree = hall({ modes: plainReady, onPick: (id) => picked.push(id) });
  const start = byTestId(tree, 'extension-start');
  assert.notEqual(start.props.disabled, true);
  assert.equal(textOf(start), `开始 ${plainReady[0].name}`, 'a themeless play set still starts directly');
  assert.ok(textOf(byTestId(tree, 'extension-note')).includes('玩法包已就位'), 'the dossier says it can start');
  assert.ok(hasClass(byClass(tree, 'ext-note')[0], 'is-ready'));
  start.props.onClick();
  assert.deepEqual(picked, ['annihilation'], 'onPick gets the play set\'s id');

  // …but not while the lobby is busy creating or offline
  for (const props of [{ busy: 'create' }, { online: false }]) {
    const held = byTestId(hall({ modes: ready, ...props }), 'extension-enter');
    assert.equal(held.props.disabled, true, `${Object.keys(props)[0]} holds the button`);
  }
});

test('主题大厅: 选中玩法包之后的那一级 —— 原包美术、返回列表、开始建房', () => {
  // the list itself: no theme hall, and the chips are one level down now
  const list = hall();
  assert.equal(byTestId(list, 'extension-theme'), undefined, 'the list is not the theme hall');
  assert.equal(byTestId(list, 'extension-tiers'), undefined, 'the 蚀流 chips moved into the theme hall');

  // entered: the hall puts the theme hall inside the same Modal (a nested component stays a vnode, like Modal itself)
  const entered = hall({ entered: true });
  const themeVnode = find(entered, (v) => v.type === ExtensionThemeHall)[0];
  assert.ok(themeVnode, 'the theme hall');
  assert.equal(themeVnode.props.mode.id, 'annihilation', 'the play set under the cursor');
  assert.equal(themeVnode.props.party, 'solo', 'the lobby state is passed down');
  assert.equal(themeVnode.props.erosion, 1);

  // the theme hall itself: the original pack's art and the cover's typography
  const theme = themeHall({ erosion: 6, party: 'coop' });
  assert.equal(byTestId(theme, 'extension-theme').props['data-theme'], 'annihilation');
  const art = byClass(theme, 'ext-theme__art-img')[0];
  assert.ok(art, 'the key art of the original play set');
  assert.equal(art.props.src, EXTENSION_MODES[0].theme.art, 'crimson-knight.webp (不息恶火)');
  assert.equal(art.props.alt, '', 'decorative: the name and the code carry the meaning');
  assert.ok(byClass(theme, 'ext-theme__veil')[0], 'the veil that keeps the text readable');
  assert.ok(byClass(theme, 'ext-theme__ring')[0], 'the cover\'s glowing ring, drawn in CSS');
  assert.equal(textOf(byClass(theme, 'ext-theme__kicker')[0]), EXTENSION_MODES[0].theme.kicker, 'the cover\'s eyebrow');
  assert.equal(textOf(byClass(theme, 'ext-theme__name')[0]), EXTENSION_MODES[0].name);
  assert.equal(textOf(byClass(theme, 'ext-theme__meta')[0]), 'AC-5ANNIHILATION');
  // a play set without art still renders: the <img> is simply absent, the gradient and the layout stay
  assert.equal(byClass(themeHall({ mode: { ...EXTENSION_MODES[0], theme: undefined } }), 'ext-theme__art-img').length, 0);

  // Esc / 返回 goes back to the list — it does not close the whole screen
  let back = 0;
  let closed = 0;
  const t2 = hall({ entered: true, onBack: () => { back += 1; }, onClose: () => { closed += 1; } });
  find(t2, (v) => v.type === Modal)[0].props.onClose();
  assert.equal(back, 1, 'Esc steps back to the list');
  assert.equal(closed, 0, 'the screen stays open');
  const backPlate = find(t2, (v) => v.type === ExtensionThemeHall)[0].props.onBack;
  backPlate();
  assert.equal(back, 2, 'the ‹ plate does the same');

  // 开始 (in the theme hall) is what creates the room, with the tier and the form
  const picked = [];
  byTestId(themeHall({ erosion: 6, party: 'coop', onPick: (id, e, p) => picked.push([id, e, p]) }), 'extension-start').props.onClick();
  assert.deepEqual(picked, [['annihilation', 6, 'coop']], 'onPick gets (id, erosion, party)');
  // and it is held while the lobby is busy / offline
  for (const props of [{ busy: 'create' }, { online: false }]) {
    assert.equal(byTestId(themeHall(props), 'extension-start').props.disabled, true, Object.keys(props)[0]);
  }
});

test('选择拓展玩法: an all-筹备中 catalogue shows the empty state instead of a list', () => {
  const allMissing = EXTENSION_MODES.map((m) => ({ ...m, status: 'missing' }));
  const tree = hall({ modes: allMissing });
  assert.equal(find(tree, (v) => hasClass(v, 'ext-row')).length, 0, 'no rows');
  const empty = byTestId(tree, 'extension-empty');
  assert.ok(empty, 'the empty state');
  assert.equal(empty.props.role, 'status');
  assert.ok(textOf(empty).includes('还没有可玩的拓展玩法'));
});

test('选择拓展玩法: the project\'s Modal (Esc, focus trap, focus restored) and its own 返回', () => {
  let closed = 0;
  const tree = hall({ onClose: () => { closed += 1; } });
  const modal = find(tree, (v) => v.type === Modal)[0];
  assert.ok(modal, 'the project Modal, not a hand-rolled dialog');
  assert.equal(modal.props.open, true);
  assert.equal(modal.props.class, 'ext', 'the .ext full-screen box (lobby.css)');
  assert.equal(modal.props.veilClass, 'proto-veil', 'the same veil as 选择模拟协议 / 选择同盟方式');
  const back = byClass(tree, 'ext__back')[0];
  assert.ok(hasClass(back, 'proto-back'), 'the ‹ plate is the lobby\'s own');
  assert.equal(back.props.title, '返回');
  back.props.onClick();
  assert.equal(closed, 1);
  assert.equal(textOf(byClass(tree, 'modal__title')[0]), '选择拓展玩法');
});

test('选择拓展玩法: 蚀流 1–6 chips are the theme hall\'s state, and 开始 hands the tier to onPick', () => {
  const ready = [{ ...EXTENSION_MODES[0], status: 'ready' }];
  const tree = themeHall({ mode: ready[0] });
  const group = byTestId(tree, 'extension-tiers');
  assert.ok(group, 'the play set declares erosionTiers, so the theme hall carries the selector');
  const chips = find(tree, (v) => hasClass(v, 'ext-tier'));
  assert.deepEqual(chips.map((c) => c.props['data-tier']), [1, 2, 3, 4, 5, 6]);
  assert.equal(chips[0].props['aria-pressed'], 'true', 'tier 1 is the default');
  assert.equal(chips[5].props.title, '无尽湮灭', 'tier 6 says what it is');
  assert.equal(chips[3].props['aria-label'], '蚀流 4', 'the tier is named for screen readers, no new msgid');

  const picked = [];
  const pickedErosion = [];
  const sel = [];
  const t2 = themeHall({ mode: ready[0], erosion: 4, onErosion: (n) => sel.push(n), onPick: (id, e) => { picked.push(id); pickedErosion.push(e); } });
  assert.equal(find(t2, (v) => hasClass(v, 'ext-tier'))[3].props['aria-pressed'], 'true', 'the chosen tier is the lit one');
  byTestId(t2, 'extension-start').props.onClick();
  assert.deepEqual(picked, ['annihilation']);
  assert.deepEqual(pickedErosion, [4], 'onPick carries the 蚀流 tier the player chose');
  find(t2, (v) => hasClass(v, 'ext-tier'))[5].props.onClick();
  assert.deepEqual(sel, [6], 'a chip click reports the tier');

  // a play set without tiers draws no selector at all
  const plain = themeHall({ mode: { ...ready[0], erosionTiers: undefined } });
  assert.equal(byTestId(plain, 'extension-tiers'), undefined);
});

test('选择拓展玩法: 单人 / 同盟 is the theme hall\'s state, and 开始 hands the form to onPick', () => {
  const ready = [{ ...EXTENSION_MODES[0], status: 'ready' }];
  const tree = themeHall({ mode: ready[0] });
  const group = byTestId(tree, 'extension-party');
  assert.ok(group, 'the play set declares a lobby form, so the theme hall carries the switch beside the 蚀流 chips');
  assert.equal(group.props.role, 'group');
  assert.equal(group.props['aria-label'], '单人 / 同盟', 'the two existing msgids, no new one');
  const chips = find(group, (v) => hasClass(v, 'ext-party__chip'));
  assert.deepEqual(chips.map((c) => c.props['data-party']), ['solo', 'coop'], '单人 then 同盟, solo first');
  assert.deepEqual(chips.map((c) => textOf(c)), ['单人', '同盟'], 'the existing msgids t(\'单人\') / t(\'同盟\')');
  assert.equal(chips[0].props['aria-pressed'], 'true', '单人 is the default form');
  assert.equal(chips[1].props['aria-pressed'], 'false');
  assert.ok(hasClass(chips[0], 'is-on'), 'the chosen chip is the lit one, like the 蚀流 chips');

  // the chips are a toggle group: a click reports the form, the lobby owns the state
  const asked = [];
  const t2 = themeHall({ mode: ready[0], erosion: 4, party: 'coop', onParty: (p) => asked.push(p) });
  const chips2 = find(t2, (v) => hasClass(v, 'ext-party__chip'));
  assert.equal(chips2[1].props['aria-pressed'], 'true', '同盟 is the lit one when the lobby says so');
  assert.ok(hasClass(chips2[1], 'is-on'));
  chips2[0].props.onClick();
  assert.deepEqual(asked, ['solo'], 'a chip click reports its form');
  chips2[1].props.onClick();
  assert.deepEqual(asked, ['solo', 'coop']);

  // 开始 carries the dossier's id, the tier and the form — the create path turns the pair into room.create.mode
  const picked = [];
  const start = byTestId(themeHall({ mode: ready[0], erosion: 6, party: 'coop', onPick: (id, e, p) => picked.push([id, e, p]) }), 'extension-start');
  start.props.onClick();
  assert.deepEqual(picked, [['annihilation', 6, 'coop']], 'onPick gets (id, erosion, party)');
  picked.length = 0;
  byTestId(themeHall({ mode: ready[0], onPick: (id, e, p) => picked.push([id, e, p]) }), 'extension-start').props.onClick();
  assert.deepEqual(picked, [['annihilation', 1, 'solo']], 'a theme hall without a party prop opens a solo room');

  // an entry that declares no play set gets no switch either — the same rule as the 蚀流 chips
  const plain = themeHall({ mode: { ...ready[0], erosionTiers: undefined } });
  assert.equal(byTestId(plain, 'extension-party'), undefined, 'no form switch without a play set');
  assert.equal(find(plain, (v) => hasClass(v, 'ext-party__chip')).length, 0);
  // …and it follows the entry: a play set without tiers/code carries no switch whatever it is called
  const bare = { id: 'bare', name: '单', en: 'BARE', code: 'AC-9', color: '#123456', icon: 'eye', desc: '没有蚀流档位',
    features: ['一'], stats: [], pack: '筹备中', status: 'pending', reason: '待接入' };
  assert.equal(byTestId(themeHall({ mode: bare }), 'extension-party'), undefined);
  assert.ok(byTestId(themeHall({ mode: ready[0] }), 'extension-party'), 'back on the play set: the switch is there');
});

// ---- the hub's third card ---------------------------------------------------------------------------
test('the hub: 拓展模式 is the third card, it opens the hall and never a 同盟 dialog', () => {
  // the card table itself (lobby.js keeps MODE_CARDS module-private: read it as text)
  const ids = [...LOBBY.matchAll(/^\s{4}id: '(\w+)', name: N_\('/gm)].map((m) => m[1]);
  assert.deepEqual(ids, ['solo', 'coop', 'ext'], 'three cards, 拓展模式 last');
  assert.match(LOBBY, /id: 'ext', name: N_\('拓展模式'\), en: 'EXTENSION MODE', icon: 'expand',/);
  assert.match(LOBBY, /pointParams: \{ n: extensionModeCount\(\) \}/, 'its line counts the play sets');
  // openMode: an explicit branch — the else would open 选择同盟方式 (b/report.md §9.1)
  assert.match(LOBBY, /if \(m === 'solo'\) setSoloOpen\(true\);\s*\n\s*else if \(m === 'ext'\) setExtOpen\(true\);\s*\n\s*else setAllyOpen\(true\);/);
  // and the hall is mounted, fed by the lobby's own selection
  assert.match(LOBBY, /const \[extOpen, setExtOpen\] = useState\(false\);/);
  assert.match(LOBBY, /const \[extPick, setExtPick\] = useState\(defaultExtensionPick\);/);
  assert.match(LOBBY, /extOpen \? html`<\$\{ExtensionHall\} selected=\$\{extPick\} onSelect=\$\{setExtPick\}/);
  // 2026-10-28 更新：第二个玩法包（炸惊模拟）要按 id 查它自己的 difficulty，所以这条成了多导出的 import 行
  assert.match(LOBBY, /import \{ ExtensionHall, extensionModeById, extensionModeCount, defaultExtensionPick, ZHAJING_DIFFICULTY \} from '\.\/extensionModes\.js';/);
});

test('lobby.js: the hall\'s 单人 / 同盟 switch reaches room.create — solo by default, coop on 同盟', () => {
  // the form is the lobby's state, like the 蚀流 tier and the dossier
  assert.match(LOBBY, /const \[extParty, setExtParty\] = useState\('solo'\);/);
  assert.match(LOBBY, /party=\$\{extParty\} onParty=\$\{setExtParty\}/);
  // 2026-10-28: createAnnihilation 变成了 createExtension —— 两个玩法包共用一个通道，难度取条目自己的 `difficulty`
  // （湮灭 ANNIHILATION + 蚀流档位；炸惊 ZHAJING 且**不带** erosion，服务端按缺省 1）。形态仍是第三参。
  const at = LOBBY.indexOf('const createExtension =');
  assert.ok(at > 0, 'the create path is there');
  const create = LOBBY.slice(at, LOBBY.indexOf('const join =', at));
  assert.match(create, /\(id, erosion, party\)/, 'onPick\'s three arguments');
  assert.match(create, /const entry = extensionModeById\(id\);/, 'the play set decides the difficulty');
  assert.match(create, /const difficulty = entry\?\.difficulty \|\| ANNIHILATION_DIFFICULTY;/);
  assert.match(create, /const kind = party === 'coop' \? 'coop' : 'solo';/);
  assert.match(create, /mode: kind, difficulty,/, 'the room is created at the entry\'s own difficulty');
  // 蚀流 only rides on a play set that declares tiers (炸惊 has none)
  assert.match(create, /const tiers = Number\.isInteger\(entry\?\.erosionTiers\) && entry\.erosionTiers > 1;/);
  assert.match(create, /\.\.\.\(tiers \? \{ erosion: Number\.isInteger\(erosion\) \? erosion : 1 \} : \{\}\)/);
  // 不限时 rides along on solo rooms only (Lobby.create takes it when `mode === 'solo'`)
  assert.match(create, /kind === 'solo' && soloFree && soloTimed === true \? \{ soloUnlimited: true \}/);
  assert.doesNotMatch(create, /mode: 'solo'/, 'no fixed solo mode left on that path');
});

test('炸惊模拟: the second play set — ready, its own difficulty, no 蚀流 ladder but both 单人 / 同盟 forms', () => {
  const z = extensionModeById('zhajing');
  assert.ok(z, 'the second entry is in the table');
  assert.equal(z.name, '炸惊模拟');
  assert.equal(z.en, 'BLAST SIMULATION');
  assert.equal(z.code, 'AC-8', 'its own code — the pack\'s AC-5 collides with 湮灭模拟');
  assert.equal(z.color, '#17d9a0', 'the play set\'s colour');
  assert.equal(z.status, 'ready', 'the client half is in this build');
  assert.equal(z.reason, undefined);
  assert.equal(z.pack, '炸惊模拟 v2.1');
  // 99 = `data/chess.json` 里 `zhajing: true` 的非精锐记录（= 99 个不同 charId；其中 2 位 grantOnly 由「祀」发放，
  // 可抽取 97）。包内清单的 104 算的是包内 205 条记录的全部 base（含 6 条 `zhajing:false` 副本），本仓不放进名册。
  assert.deepEqual(z.stats.map((s) => s.value), ['99', '99+21', '×2.5'], '99 干员位, 99+21 惊变, ×2.5 攻');
  assert.equal(z.features.length, 3);
  // the room's difficulty is the play set's own value, and it is NOT a DIFFICULTIES member
  assert.equal(z.difficulty, 'ZHAJING');
  assert.equal(extensionModeById('annihilation').difficulty, 'ANNIHILATION', 'the first play set declares its own too');
  assert.ok(!DIFFICULTIES.includes(z.difficulty), 'never in the official four-card selector');
  // 形态有、档位没有：no erosionTiers, both forms declared — and (2026-10-28) a THEME of its own, with the owner's art
  assert.equal(z.erosionTiers, undefined, '炸惊 has no 蚀流 ladder');
  assert.deepEqual(z.forms, ['solo', 'coop']);
  assert.ok(z.theme, '炸惊 has its own 二级界面, like 湮灭模拟');
  assert.equal(z.theme.art, '/assets/zhajing-intro/art/zhajing-key.webp', '业主 2026-10-28 给的背景原图（webp）');
  assert.equal(z.theme.kicker, 'BLAST SIMULATION // FIELD MANUAL');
  // the hub card counts what the hall lists
  assert.equal(extensionModeCount(), 2, '湮灭模拟 + 炸惊模拟 (the two 筹备中 placeholders are not listed)');
  assert.equal(defaultExtensionPick(), 'annihilation', 'the dossier still opens on the first listed play set');

  // the row is there, ready and selectable
  const tree = hall({ selected: 'zhajing' });
  const row = byTestId(tree, 'extension-row-zhajing');
  assert.ok(row, 'the row');
  assert.equal(row.props['data-status'], 'ready');
  assert.notEqual(row.props.disabled, true);
  assert.ok(textOf(row).includes('AC-8'));
  assert.ok(textOf(byTestId(tree, 'extension-note')).includes('玩法包已就位'));

  // 单人 / 同盟 chips WITHOUT erosionTiers — the point of the `forms` declaration (§2.3). Since 2026-10-28 晚 炸惊 declares a
  // `theme`, so the chips and 开始 live one level down (the list has 进入), exactly like 湮灭模拟.
  assert.equal(byTestId(tree, 'extension-party'), undefined, 'the list carries no chips for a themed play set');
  assert.equal(byTestId(tree, 'extension-tiers'), undefined, 'and no 蚀流 chips');
  const zjTheme = themeHall({ mode: extensionModeById('zhajing') });
  const party = byTestId(zjTheme, 'extension-party');
  assert.ok(party, 'a play set with two forms draws the switch even without a 蚀流 ladder');
  const chips = find(party, (v) => hasClass(v, 'ext-party__chip'));
  assert.deepEqual(chips.map((c) => c.props['data-party']), ['solo', 'coop']);
  assert.equal(chips[0].props['aria-pressed'], 'true', '单人 is the default form');
  assert.equal(byTestId(zjTheme, 'extension-tiers'), undefined, 'and no 蚀流 chips');

  // 开始 hands onPick the id, the neutral tier 1 and the form
  const picked = [];
  byTestId(themeHall({ mode: extensionModeById('zhajing'), onPick: (id, e, p) => picked.push([id, e, p]) }), 'extension-start').props.onClick();
  assert.deepEqual(picked, [['zhajing', 1, 'solo']]);
  picked.length = 0;
  byTestId(themeHall({ mode: extensionModeById('zhajing'), party: 'coop', onPick: (id, e, p) => picked.push([id, e, p]) }), 'extension-start').props.onClick();
  assert.deepEqual(picked, [['zhajing', 1, 'coop']], '同盟 is the same room, difficulty and tier');

  // a play set that declares a theme is entered first (the list's 进入), and Esc / 返回 comes back to the list
  const zjEntered = find(hall({ selected: 'zhajing', entered: true }), (v) => v.type === ExtensionThemeHall);
  assert.equal(zjEntered.length, 1, 'entered → the theme hall');
  assert.equal(zjEntered[0].props.mode.id, 'zhajing', 'it is the play set\'s own screen');
  assert.equal(byTestId(hall({ selected: 'zhajing' }), 'extension-theme'), undefined, 'the list alone is not the theme hall');
  assert.equal(byTestId(hall({ selected: 'zhajing' }), 'extension-stage') != null, true, 'the list is what is drawn before 进入');

  // a themeless entry never enters the theme hall, even when the lobby says `entered` (a fabricated catalogue entry)
  const bare = { ...EXTENSION_MODES[1], theme: undefined };
  assert.equal(find(hall({ selected: 'zhajing', entered: true, modes: [EXTENSION_MODES[0], bare] }), (v) => v.type === ExtensionThemeHall).length, 0);
  assert.ok(byTestId(hall({ selected: 'zhajing', entered: true, modes: [EXTENSION_MODES[0], bare] }), 'extension-stage'), 'the list is still what is drawn');

  // 湮灭模拟 keeps its ladder, and it is unchanged: it declares erosionTiers, so its chips live in its THEME hall (the list
  // has only 进入 for it) — the `forms` rule must not move or double them
  const ann = hall({ selected: 'annihilation' });
  assert.equal(byTestId(ann, 'extension-party'), undefined, 'the list carries no chips for a themed play set');
  assert.equal(byTestId(ann, 'extension-tiers'), undefined);
  const annTheme = themeHall({ mode: extensionModeById('annihilation') });
  assert.equal(byTestId(annTheme, 'extension-party').props.role, 'group');
  assert.deepEqual(find(byTestId(annTheme, 'extension-tiers'), (v) => hasClass(v, 'ext-tier')).map((c) => c.props['data-tier']), [1, 2, 3, 4, 5, 6]);
});

// ---- 惊变一览：大堂二级页上的独立只读入口（业主 task-16）--------------------------------------------------
test('炸惊模拟: 惊变一览 lives in the theme hall — the reused codex, 99 cards, read-only, Esc closes only it', () => {
  const z = extensionModeById('zhajing');
  assert.equal(z.codex, 'mode_single_zhajing', 'the entry names the config mode whose 惊变 pool the hall shows');
  // only a play set that declares `codex` gets the entry; 湮灭模拟 has no 惊变 pool of its own
  const zj = themeHall({ mode: z });
  const leaf = find(zj, (v) => typeof v.type === 'function' && v.type.name === 'ExtThemeCodex')[0];
  assert.ok(leaf, 'the themed hall draws the codex entry');
  assert.equal(leaf.props.modeId, 'mode_single_zhajing', 'the id comes from the entry, not a second constant');
  assert.equal(find(themeHall({ mode: EXTENSION_MODES[0] }), (v) => typeof v.type === 'function' && v.type.name === 'ExtThemeCodex').length, 0,
    '湮灭模拟 declares no codex → no button');

  // closed: one button of the page's own family (规则 / 攻略说明), carrying the existing msgid
  const shut = ExtThemeCodexView({ modeId: 'mode_single_zhajing' });
  const btn = byTestId(shut, 'extension-codex');
  assert.ok(btn, 'the button');
  assert.equal(btn.type, 'button');
  assert.ok(hasClass(btn, 'ext-theme__guide'), 'the same .ext-theme__guide family as 规则 / 攻略说明');
  assert.ok(hasClass(btn, 'ext-theme__codex'));
  assert.equal(textOf(btn), '惊变一览', 'the existing t(\'惊变一览\') msgid, no new one');
  assert.equal(btn.props.title, '惊变一览');
  assert.equal(btn.props['aria-label'], '惊变一览');
  assert.equal(find(shut, (v) => v.type === JibianCodex).length, 0, 'closed: no panel mounted');

  // open: ui/jibian.js JibianCodex itself — not a copy — with owned = [] (no match outside a room)
  const open = ExtThemeCodexView({ modeId: 'mode_single_zhajing', open: true });
  const panel = find(open, (v) => v.type === JibianCodex)[0];
  assert.ok(panel, 'open → the in-match JibianCodex');
  assert.equal(panel.props.modeId, 'mode_single_zhajing');
  assert.deepEqual(panel.props.owned, [], 'the lobby has no m.private.jibian.owned');

  // the panel's content is the mode\'s own pool: 99 cards in the five rarity groups, none ticked
  const pool = CONFIG.modes.mode_single_zhajing.jibian.pool;
  assert.equal(pool.length, 99, 'the config pool the outside entry reads');
  const view = JibianCodexView({ pool, owned: [], onClose: () => {} });
  assert.equal(byTestId(view, 'jibian-codex').props['aria-label'], '惊变一览');
  assert.equal(find(view, (v) => /^jibian-codex-(normal|rare|epic|legend|hidden)$/.test(v.props?.['data-testid'] || '')).length, 5, 'five rarity groups');
  assert.equal(find(view, (v) => /^jibian-codex-card-/.test(v.props?.['data-testid'] || '')).length, 99, 'all 99 cards');
  assert.equal(find(view, (v) => hasClass(v, 'zjcodex__row') && hasClass(v, 'is-owned')).length, 0, 'outside a match nothing is ticked');
  // 点遮罩 / 关闭键 都只是关面板（第三个关闭途径 Esc 见下一条）
  let closes = 0;
  const closable = JibianCodexView({ pool, owned: [], onClose: () => { closes += 1; } });
  byClass(closable, 'zjpanel__scrim')[0].props.onClick();
  byClass(closable, 'zjpanel__x')[0].props.onClick();
  assert.equal(closes, 2, 'mask + close key both just close the panel');

  // Esc belongs to the panel: the theme hall sits in the project Modal, whose window keydown means 「返回列表」.
  // The leaf listens in the CAPTURE phase and stops the event there, so the page behind the panel never moves.
  assert.match(THEME_SRC, /addEventListener\('keydown', onKey, true\)/, 'capture-phase Escape');
  assert.match(THEME_SRC, /e\.stopPropagation\(\);\s*\n\s*setOpen\(false\);/, 'the Escape closes the panel itself');
  // the button keeps a ≥ 32px touch target on a phone (≤ 520 tall) — the page's other buttons keep theirs
  assert.match(mediaBlock(CSS, '(max-height: 520px)', '.ext-theme__codex'),
    /\.ext-theme__codex \{[^}]*min-height: max\(\.44rem, 32px\)/);
});


test('theme.css: the frost-blue --ext-* ramp beside --inf-*, which it does not touch', () => {
  for (const name of ['--ext-100', '--ext-300', '--ext-400', '--ext-500', '--ext-700', '--ext-900', '--ext-a35', '--ext-glow']) {
    assert.match(THEME, new RegExp(`${name}:\\s*(#[0-9a-fA-F]{3,8}|rgba?\\()`), `${name} is declared`);
  }
  // the extension hall must not borrow 超限模拟's purple
  assert.match(THEME, /--inf-500: #a855f7;/);
  assert.match(THEME, /--inf-glow: rgba\(150, 90, 255, \.55\);/);
});

test('lobby.css: the hub keeps three entries on one row (the entries column is three cards wide)', () => {
  const hits = [...CSS.matchAll(/calc\(var\(--hub-entry-w\) \* (\d+) \+ (\d+) \* var\(--hub-gap\)\)/g)];
  assert.equal(hits.length, 2, 'both the stage grid and its short-screen form');
  for (const h of hits) assert.deepEqual([h[1], h[2]], ['3', '2'], 'three cards and two gaps');
  assert.doesNotMatch(CSS, /calc\(var\(--hub-entry-w\) \* 2 \+ var\(--hub-gap\)\)/, 'no two-card column left behind');
  // the third card's own face: frost blue, never the purple of 超限模拟
  const ext = ruleOf(CSS, '.hub-entry--ext');
  assert.match(ext, /--ext-|#7cc6f2|#a9dcf8/);
  assert.doesNotMatch(ext, /--inf-/);
  assert.match(ruleOf(CSS, '.hub-entry--ext:focus-visible'), /outline: 2px solid var\(--ext-300\)/);
});

test('lobby.css: the hall is a full-screen Modal box of the same family as .proto / .ally', () => {
  assert.ok(groupNames(CSS, '.modal__box.proto', '.modal__box.ally', '.modal__box.ext'), 'the box');
  assert.ok(groupNames(CSS, '.proto__body', '.ally__body', '.ext__body'), 'the body');
  assert.match(ruleOf(CSS, '.proto-body.ext-body'), /grid-template-columns: minmax\(0, 2fr\) minmax\(0, 3fr\)/, 'dossier 40 % / list 60 % at every width');
});

test('lobby.css: an even ladder — fixed row heights and fixed gaps at all three sizes', () => {
  const row = ruleOf(CSS, '.ext-row');
  assert.match(row, /height: 88px/, 'desktop row');
  assert.match(row, /grid-template-columns: [^;]*minmax\(0, 1fr\)/, 'the middle column takes the slack');
  assert.match(ruleOf(CSS, '.ext-row__desc'), /white-space: nowrap;/, 'the description is one line');
  assert.match(ruleOf(CSS, '.ext-row__desc'), /text-overflow: ellipsis;/);
  assert.match(ruleOf(CSS, '.ext-list'), /gap: 10px/);
  // ≤ 900 px wide: the same two columns, smaller
  const narrow = mediaBlock(CSS, '(max-width: 900px)', '.ext-row');
  assert.match(narrow, /\.ext-row \{[^}]*height: 64px/);
  assert.match(narrow, /\.ext-list \{[^}]*gap: 8px/);
  assert.match(narrow, /\.ext-hero__code[^{]*\{[^}]*display: none/);
  // ≤ 520 px tall: the tightest ladder
  const short = mediaBlock(CSS, '(max-height: 520px)', '.ext-row');
  assert.match(short, /\.ext-row \{[^}]*height: 56px/);
  assert.match(short, /\.ext-list \{[^}]*gap: 6px/);
  assert.match(short, /\.ext-note[^{]*\{[^}]*display: none/, 'the reason line gives way on a phone');
  // the touch target of 开始 stays 44 px at every size
  assert.match(ruleOf(CSS, '.ext-foot__start'), /min-height: 44px/);
  for (const block of [narrow, short]) assert.match(block, /\.ext-foot__start \{[^}]*min-height: 44px/);
  // 单人 / 同盟 chips: the tier chips' 24 px touch floor, and their own step in both small layouts
  assert.match(ruleOf(CSS, '.ext-party__chip'), /min-height: max\(\.3rem, 24px\)/);
  for (const block of [narrow, short]) assert.match(block, /\.ext-party__chip \{[^}]*min-height: max\(\.26rem, 24px\)/);
});

test('lobby.css: the status chips, the placeholder, and the dossier frame', () => {
  for (const c of ['.chip--ready', '.chip--pending', '.chip--missing']) assert.ok(ruleOf(CSS, c));
  assert.match(ruleOf(CSS, '.ext-row.is-placeholder'), /border-style: dashed/);
  assert.match(ruleOf(CSS, '.ext-stage'), /--ext-|#7cc6f2/);
  assert.ok(ruleOf(CSS, '.ext-stage__frame'), 'the corner brackets of the official event-page language');
  assert.match(ruleOf(CSS, '.ext-row.is-selected'), /border-color:/);
  assert.match(ruleOf(CSS, '.ext-note'), /border: 1px solid/);
  assert.match(ruleOf(CSS, '.ext-note.is-ready'), /rgba\(93, 240, 198|--mint/);
  // the chosen form is the frost blue of a chosen 蚀流 tier, not a second accent colour
  assert.match(ruleOf(CSS, '.ext-party__chip.is-on'), /background: var\(--ext-400\)/);
});

test('lobby.css: 减动效 wins — every .ext-* animation is declared ahead of the last reduce block', () => {
  const reset = CSS.lastIndexOf('@media (prefers-reduced-motion: reduce)');
  assert.ok(reset > 0);
  for (const sel of ['.ext-row', '.ext-stage']) {
    const declared = CSS.indexOf(`${sel} {`);
    assert.ok(declared > 0 && declared < reset, `${sel} is declared before the reset, or the reset never wins`);
  }
  assert.match(CSS.slice(reset), /\.ext-row/, 'the reset names the rows');
  assert.match(CSS.slice(reset), /\.ext-stage/, 'the reset names the stage');
  // CSS order is behaviour: no animation may be re-declared after the reset
  assert.doesNotMatch(CSS.slice(reset + 40), /animation: [^;]*tr-right/, 'no animation after the reset block');
});

// ---- i18n --------------------------------------------------------------------------------------------
test('every string of the hall and the hub card is in all four packs', () => {
  // the msgids the module asks for (t('…') / N_('…') with a literal), plus the table's own fields
  const ids = new Set();
  for (const m of SRC.matchAll(/\b(?:t|N_)\(\s*'((?:[^'\\]|\\.)*)'/g)) ids.add(m[1].replace(/\\'/g, "'"));
  for (const m of EXTENSION_MODES) {
    for (const s of [m.name, m.desc, ...m.features, m.pack, m.reason, ...m.stats.map((x) => x.label)]) if (s) ids.add(s);
  }
  assert.ok(ids.size >= 20, `${ids.size} strings found`);
  for (const [lang, pack] of PACKS) {
    const missing = [...ids].filter((id) => !Object.hasOwn(pack, id));
    assert.deepEqual(missing, [], `${lang}: ${missing.length} missing`);
  }
  // the hub card's own line
  for (const [lang, pack] of PACKS) {
    for (const id of ['拓展模式', '{n} 个玩法 · 不计入官方战绩', '{n} 个玩法']) assert.ok(Object.hasOwn(pack, id), `${lang}: ${id}`);
  }
  // EXTENSION MODE is the card's latin name (drawn as .hub-entry__en), not a translatable string
  for (const [lang, pack] of PACKS) assert.ok(!Object.hasOwn(pack, 'EXTENSION MODE'), `${lang}: not a msgid`);
  // 主题大厅（含 task-16 的惊变一览）只复用既有 msgid：任何新字面量都会在这里变红
  const themeIds = new Set();
  for (const m of THEME_SRC.matchAll(/\bt\(\s*'((?:[^'\\]|\\.)*)'/g)) themeIds.add(m[1].replace(/\\'/g, "'"));
  assert.ok(themeIds.has('惊变一览'), 'the codex entry asks for the existing msgid');
  for (const [lang, pack] of PACKS) {
    const missing = [...themeIds].filter((id) => !Object.hasOwn(pack, id));
    assert.deepEqual(missing, [], `${lang}: ${missing.length} missing in the theme hall`);
    assert.ok(Object.hasOwn(pack, '惊变一览'), `${lang}: 惊变一览 is in every pack`);
  }
});

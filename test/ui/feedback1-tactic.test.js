// The 战术决策 overlay with the same card twice (the user: "战术决策也按官方改成可以重复吧"; official match 7 R11: 补给 ×2).
// A real server draft (server/match/choices.js generateDraft → cardView; co-op 绝境 R11, seed 30: 补给 twice), through
// m.public's normalisation (ui/gameLogic.js normalizeSp), rendered by the overlay's pure view (ui/choiceOverlay.js
// ChoiceView): two identical cards are two buttons keyed by their index, with the same face (name, icon, 全队获得, text) —
// selecting one does not select the other, a teammate taking one leaves the other pickable, and the pick sends that
// card's own index. The header is the official one. The browser render is test/ui/feedback1-tactic.e2e.test.js (SP_E2E=1).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

// the browser data store reads the real data files from disk
globalThis.fetch = async (url) => {
  const name = String(url).split('/').pop();
  try {
    const body = readFileSync(path.join(ROOT, 'data', name), 'utf8');
    return { ok: true, status: 200, json: async () => JSON.parse(body) };
  } catch {
    return { ok: false, status: 404, json: async () => ({}) };
  }
};

const { ChoiceView, cardPickable, spTap, armedCard, resolveSpCard } = await import('../../public/js/ui/choiceOverlay.js');
const { normalizeSp } = await import('../../public/js/ui/gameLogic.js');
const { DATA } = await import('../match/harness.js');
const { GameData } = await import('../../server/match/gamedata.js');
const { generateDraft, cardView } = await import('../../server/match/choices.js');
const { createRng } = await import('../../server/sim/rng.js');
const { data } = await import('../../public/js/data.js');

/** Every vnode of a preact tree (htm output), depth first. */
function* walk(v) {
  if (Array.isArray(v)) { for (const x of v) yield* walk(x); return; }
  if (!v || typeof v !== 'object') return;
  yield v;
  yield* walk(v.props?.children);
}
const hasClass = (v, c) => typeof v?.props?.class === 'string' && v.props.class.split(/\s+/).includes(c);
const text = (v) => [...walk(v)].flatMap((n) => (typeof n.props?.children === 'string' ? [n.props.children] : Array.isArray(n.props?.children) ? n.props.children.filter((x) => typeof x === 'string') : [])).join('');

await data.loadAll('items', 'effects', 'choices', 'assets', 'chess', 'bonds');

test('战术决策 overlay: the same card twice is two cards — own keys, same face, own selection, one taken leaves the other pickable', () => {
  const d = generateDraft(new GameData(DATA, 'mode_multi_hard'), createRng(30), 11, { stageId: 'act1autochess_m02' });
  assert.equal(d.family, 'tactic');
  const at = d.cards.flatMap((c, i) => (c.name === '补给' ? [i] : []));
  assert.equal(at.length, 2, 'seed 30: 补给 twice');
  const [a, b] = at;
  const players = [{ playerId: 'me', seat: 0, name: 'Me' }, { playerId: 'p2', seat: 1, name: 'P2' }];
  const pub = (picks) => normalizeSp({ family: 'tactic', name: d.name, desc: d.desc, cards: d.cards.map(cardView), order: ['p2', 'me'], turn: Object.keys(picks).length ? 'me' : 'p2', picks, taken: {} }, players);
  const view = (sp, armed = null) => [...walk(ChoiceView({ pub: { players, deadline: 0 }, sp, myId: 'me', solo: false, armed }))];
  const cardsOf = (nodes) => nodes.filter((n) => hasClass(n, 'spcard'));

  // the official header
  let sp = pub({});
  const all = view(sp);
  assert.ok(text(all.find((n) => hasClass(n, 'spov__title'))).includes('战术决策'));
  assert.equal(all.find((n) => hasClass(n, 'spov__desc')).props.children.props.text, '进行协同调整，做好迎战准备。');

  // six buttons keyed by index; the twins have the same name, icon, team tag and text
  let cards = cardsOf(all);
  assert.equal(cards.length, 6);
  assert.deepEqual(cards.map((c) => c.key), [0, 1, 2, 3, 4, 5], 'keyed by index, never by card id');
  const face = (c) => ({ name: [...walk(c)].find((n) => hasClass(n, 'spcard__name')).props.children, team: [...walk(c)].some((n) => hasClass(n, 'spcard__tag--team')), title: c.props.title });
  assert.deepEqual(face(cards[a]), face(cards[b]));
  assert.equal(face(cards[a]).name, '补给');
  assert.equal(face(cards[a]).team, true, '全队获得');
  assert.deepEqual(resolveSpCard(sp.cards[a], 'tactic'), resolveSpCard(sp.cards[b], 'tactic'));
  assert.equal(sp.cards[a].id, sp.cards[b].id);
  assert.notEqual(sp.cards[a].idx, sp.cards[b].idx);

  // the teammate takes the first twin: only that card shows the taker; the second twin is still mine to pick
  sp = pub({ p2: a });
  assert.equal(sp.cards[a].takenBy, 'p2');
  assert.equal(sp.cards[b].takenBy, null);
  assert.equal(cardPickable(sp, sp.cards[a], { myId: 'me', solo: false }), false);
  assert.equal(cardPickable(sp, sp.cards[b], { myId: 'me', solo: false }), true);
  cards = cardsOf(view(sp));
  assert.ok(hasClass(cards[a], 'is-taken') && !hasClass(cards[b], 'is-taken'));
  assert.ok([...walk(cards[a])].some((n) => hasClass(n, 'spcard__taker')) && ![...walk(cards[b])].some((n) => hasClass(n, 'spcard__taker')));
  assert.equal(cards[a].props.disabled, true);
  assert.equal(cards[b].props.disabled, false);

  // two taps on the second twin: it alone is armed, then its own index is sent
  let r = spTap(null, b, cardPickable(sp, sp.cards[b], { myId: 'me', solo: false }));
  assert.deepEqual(r, { armed: b, pick: null });
  assert.equal(armedCard(r.armed, sp, { myId: 'me', solo: false }), b);
  cards = cardsOf(view(sp, r.armed));
  assert.deepEqual(cards.map((c) => hasClass(c, 'is-armed')), cards.map((_, i) => i === b), 'only the tapped twin is armed');
  r = spTap(r.armed, b, true);
  assert.deepEqual(r, { armed: null, pick: b });
  // after my pick: the first twin the teammate's, the second mine
  sp = pub({ p2: a, me: b });
  cards = cardsOf(view(sp));
  assert.ok(hasClass(cards[b], 'is-mine') && !hasClass(cards[a], 'is-mine'));
  assert.ok(cards.every((c) => c.props.disabled), 'nothing left to pick for me');
});

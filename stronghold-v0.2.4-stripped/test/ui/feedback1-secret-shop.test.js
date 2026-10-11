// The 机密商店 overlay with the same item twice (the user: "机密商店按官方改成可以重复吧"; official match 8 R11: 变形同构体 ×2,
// matches 4 / 5: 盟约之币 ×2). A real server draft (server/match/choices.js generateDraft → cardView), through m.public's
// normalisation (ui/gameLogic.js normalizeSp), rendered by the overlay's pure view (ui/choiceOverlay.js ChoiceView): two
// identical cards are two buttons keyed by their index — selecting one does not select the other, a teammate taking one
// leaves the other pickable, and the pick sends that card's own index. The browser render is
// test/ui/feedback1-secret-shop.e2e.test.js (SP_E2E=1).
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

const { ChoiceView, cardPickable, spTap, armedCard } = await import('../../public/js/ui/choiceOverlay.js');
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

await data.loadAll('items', 'effects', 'choices', 'assets', 'chess', 'bonds');

/** A generated co-op 绝境 R11 机密商店 with the same non-coin item twice. */
function shopWithTwin() {
  const gd = new GameData(DATA, 'mode_multi_hard');
  const coin = DATA.choices.shopDraft.coin;
  for (let seed = 1; seed < 50000; seed++) {
    const d = generateDraft(gd, createRng(seed * 104729 + 7), 11, {});
    if (d.family !== 'shop') continue;
    const ids = d.cards.map((c) => c.id);
    const twin = ids.find((id, i) => id !== coin && ids.indexOf(id) !== i);
    if (twin) return { d, twin, at: ids.flatMap((id, i) => (id === twin ? [i] : [])) };
  }
  throw new Error('no generated shop with a repeated item');
}

test('机密商店 overlay: the same item twice is two cards — own keys, own selection, one taken leaves the other pickable', () => {
  const { d, twin, at } = shopWithTwin();
  const [a, b] = at;
  const players = [{ playerId: 'me', seat: 0, name: 'Me' }, { playerId: 'p2', seat: 1, name: 'P2' }];
  const pub = (picks) => normalizeSp({ family: 'shop', name: d.name, desc: d.desc, cards: d.cards.map(cardView), order: ['p2', 'me'], turn: Object.keys(picks).length ? 'me' : 'p2', picks, taken: {} }, players);
  const view = (sp, armed = null) => [...walk(ChoiceView({ pub: { players, deadline: 0 }, sp, myId: 'me', solo: false, armed }))].filter((n) => hasClass(n, 'spcard'));

  // before any pick: six buttons, keyed by index; the twins have the same name, icon and text
  let sp = pub({});
  let cards = view(sp);
  assert.equal(cards.length, 6);
  assert.deepEqual(cards.map((c) => c.key), [0, 1, 2, 3, 4, 5], 'keyed by index, never by item id');
  const name = (c) => [...walk(c)].find((n) => hasClass(n, 'spcard__name')).props.children;
  assert.equal(name(cards[a]), DATA.items[twin].name);
  assert.equal(name(cards[b]), DATA.items[twin].name);
  assert.equal(sp.cards[a].id, sp.cards[b].id);

  // the teammate takes the first twin: only that card shows the taker; the second twin is still mine to pick
  sp = pub({ p2: a });
  assert.equal(sp.cards[a].takenBy, 'p2');
  assert.equal(sp.cards[b].takenBy, null);
  assert.equal(cardPickable(sp, sp.cards[a], { myId: 'me', solo: false }), false);
  assert.equal(cardPickable(sp, sp.cards[b], { myId: 'me', solo: false }), true);
  cards = view(sp);
  assert.ok(hasClass(cards[a], 'is-taken') && !hasClass(cards[b], 'is-taken'));
  assert.ok([...walk(cards[a])].some((n) => hasClass(n, 'spcard__taker')) && ![...walk(cards[b])].some((n) => hasClass(n, 'spcard__taker')));
  assert.equal(cards[a].props.disabled, true);
  assert.equal(cards[b].props.disabled, false);

  // two taps on the second twin: it alone is armed, then its own index is sent
  let r = spTap(null, b, cardPickable(sp, sp.cards[b], { myId: 'me', solo: false }));
  assert.deepEqual(r, { armed: b, pick: null });
  assert.equal(armedCard(r.armed, sp, { myId: 'me', solo: false }), b);
  cards = view(sp, r.armed);
  assert.deepEqual(cards.map((c) => hasClass(c, 'is-armed')), cards.map((_, i) => i === b), 'only the tapped twin is armed');
  r = spTap(r.armed, b, true);
  assert.deepEqual(r, { armed: null, pick: b });
});

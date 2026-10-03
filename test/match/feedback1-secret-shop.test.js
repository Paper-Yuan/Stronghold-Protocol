// The 机密商店 after the official screenshots (the user, after the R3 / R9 / R11 screenshots of 22 official matches:
// "机密商店按官方改成可以重复吧"). The 4 official 机密商店 (R11 of matches 2, 4, 5 and 8 in
// test/fixtures/official-bounty-drafts.json) offer the same item twice (盟约之币 ×2 in 4 and 5, 变形同构体 ×2 in 8) and
// share one composition: exactly two tier-VI items, at least one tier V, at least one 盟约之币, no other tier-I / II item.
// choices.json `shopDraft` (tools/build-data.mjs SHOP_DRAFT) draws six slots on their own, with replacement, at R11 (the
// round of the screenshots; 绝境 / 终极 only); the earlier 机密商店 of 标准 / 险境 (no screenshot) keep the previous draw,
// any tier I–VI with replacement. Picking one of two identical cards is in test/content/choices.test.js (E2E), the
// overlay with two identical cards in test/ui/feedback1-secret-shop.test.js.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DATA } from './harness.js';
import { GameData } from '../../server/match/gamedata.js';
import { generateDraft, cardView } from '../../server/match/choices.js';
import { createRng } from '../../server/sim/rng.js';

const OFFICIAL = JSON.parse(readFileSync(new URL('../fixtures/official-bounty-drafts.json', import.meta.url), 'utf8'));
const SHOP = DATA.choices.shopDraft;
const COIN = SHOP.coin;
const itemByName = (name) => Object.values(DATA.items).find((i) => i.name === name && !i.isGolden && i.itemType === 'EQUIP');
/** The official 机密商店: [{ match, cards: [[name, tier]] }]. */
const SHOPS = Object.entries(OFFICIAL.matches).flatMap(([m, rs]) => Object.values(rs).filter((d) => d.family === 'shop').map((d) => ({ match: Number(m), cards: d.cards })));
const count = (list, pred) => list.filter(pred).length;

test('机密商店 (4 official shops): six free items, two of them tier VI, a tier V and a 盟约之币 in each, the same item twice in three', () => {
  assert.deepEqual(SHOPS.map((s) => s.match), [2, 4, 5, 8]);
  assert.deepEqual(SHOP.seen, [2, 4, 5, 8]);
  let dupShops = 0;
  for (const { match, cards } of SHOPS) {
    assert.equal(cards.length, 6, `match ${match}`);
    for (const [name, tier] of cards) assert.equal(itemByName(name)?.tier, tier, `match ${match}: ${name} is tier ${tier} in the data`);
    assert.equal(count(cards, ([, t]) => t === 6), 2, `match ${match}: exactly two tier-VI items`);
    assert.ok(count(cards, ([, t]) => t === 5) >= 1, `match ${match}: a tier-V item`);
    assert.ok(count(cards, ([n]) => n === '盟约之币') >= 1, `match ${match}: a 盟约之币`);
    assert.ok(cards.every(([n, t]) => t >= 3 || n === '盟约之币'), `match ${match}: no other tier-I / II item`);
    if (new Set(cards.map(([n]) => n)).size < cards.length) dupShops++;
  }
  assert.equal(dupShops, 3, '盟约之币 ×2 (matches 4, 5), 变形同构体 ×2 (match 8)');
  // the data: four fixed slots (VI, VI, V, 盟约之币) + two drawn by what the other two cards of each shop were
  assert.equal(DATA.items[COIN].name, '盟约之币');
  assert.deepEqual(SHOP.slots.slice(0, 4), [{ 6: 1 }, { 6: 1 }, { 5: 1 }, { coin: 1 }]);
  const rest = { 3: 0, 4: 0, 5: 0, coin: 0 };
  for (const { cards } of SHOPS) {
    const left = cards.map(([n, t]) => (n === '盟约之币' ? 'coin' : String(t)));
    for (const k of ['6', '6', '5', 'coin']) left.splice(left.indexOf(k), 1);
    for (const k of left) rest[k]++;
  }
  assert.deepEqual(rest, { 3: 1, 4: 2, 5: 3, coin: 2 });
  for (const s of SHOP.slots.slice(4)) assert.deepEqual(s, rest);
  assert.equal(SHOP.slots.length, 6);
  assert.deepEqual(SHOP.rounds, [11], 'the composition where the screenshots are: R11 (绝境 / 终极)');
  // an item's weight within its tier: 1 + the official cards it showed on
  const seen = {};
  for (const { cards } of SHOPS) for (const [n] of cards) if (n !== '盟约之币') seen[itemByName(n).id] = (seen[itemByName(n).id] || 0) + 1;
  assert.deepEqual(SHOP.itemWeights, Object.fromEntries(Object.entries(seen).map(([id, k]) => [id, 1 + k]).sort()));
  assert.equal(SHOP.itemWeights[itemByName('变形同构体').id], 5, '变形同构体 on 4 of the 8 tier-VI cards');
});

test('机密商店 generated (co-op 绝境 R11): the official composition, drawn with replacement — the same item can come twice', () => {
  const gd = new GameData(DATA, 'mode_multi_hard');
  let shops = 0;
  let dup = 0;
  let dupItem = 0;
  let coins2 = 0;
  const offered = new Set();
  for (let seed = 1; shops < 2000 && seed < 20000; seed++) {
    const d = generateDraft(gd, createRng(seed * 104729 + 7), 11, { stageId: 'act2autochess_m01' });
    if (d.family !== 'shop') continue;
    shops++;
    assert.equal(d.name, '机密商店');
    assert.equal(d.cards.length, 6);
    const tiers = d.cards.map((c) => DATA.items[c.id].tier);
    assert.equal(count(tiers, (t) => t === 6), 2, 'two tier-VI items');
    assert.ok(count(tiers, (t) => t === 5) >= 1, 'a tier-V item');
    assert.ok(count(d.cards, (c) => c.id === COIN) >= 1, 'a 盟约之币');
    assert.ok(d.cards.every((c) => c.id === COIN || DATA.items[c.id].tier >= 3), 'no other tier-I / II item');
    assert.deepEqual(d.cards.map((c) => c.idx), [0, 1, 2, 3, 4, 5], 'each card its own index');
    for (const c of d.cards) {
      assert.equal(c.kind, 'item');
      assert.equal(cardView(c).price, 0, '无需消耗资金');
      assert.ok(!DATA.items[c.id].isGolden && !DATA.items[c.id].shopExcluded);
      offered.add(c.id);
    }
    const ids = d.cards.map((c) => c.id);
    if (new Set(ids).size < ids.length) dup++;
    if (new Set(ids.filter((id) => id !== COIN)).size < count(ids, (id) => id !== COIN)) dupItem++;
    if (count(ids, (id) => id === COIN) >= 2) coins2++;
  }
  assert.equal(shops, 2000);
  assert.ok(dup / shops > 0.45 && dup / shops < 0.75, `a repeated item in ${(100 * dup / shops).toFixed(0)} % (official 3 of 4)`);
  assert.ok(coins2 / shops > 0.35 && coins2 / shops < 0.55, `盟约之币 ×2 in ${(100 * coins2 / shops).toFixed(0)} % (official 2 of 4)`);
  assert.ok(dupItem / shops > 0.08, `another item twice in ${(100 * dupItem / shops).toFixed(0)} % (official: 变形同构体 ×2)`);
  // every shop item of tiers III–VI can come
  for (const t of [3, 4, 5, 6]) for (const id of gd.shopItemsByTier[t]) assert.ok(offered.has(id), `${DATA.items[id].name} (tier ${t}) offered`);
  // solo: 3 of the slots
  const solo = new GameData(DATA, 'mode_single_hard');
  for (let seed = 1, n = 0; n < 30 && seed < 5000; seed++) {
    const d = generateDraft(solo, createRng(seed * 31 + 5), 11, {});
    if (d.family !== 'shop') continue;
    n++;
    assert.equal(d.cards.length, 3);
    assert.ok(d.cards.every((c) => c.id === COIN || DATA.items[c.id].tier >= 3));
  }
});

test('机密商店 outside R11 (标准 R3 / R9, 险境 R3 / R6 / R9 — no screenshot): the previous draw, any tier I–VI per card, with replacement', () => {
  // the data's shop events sit in three blocks (artifact_paid_1 by the R3 events, _2 / _3 by the R9 ones, _4 / _5 by
  // hardbuff_select), so an early 机密商店 need not look like the R11 one [ASSUMED: keep the previous draw]
  const all = new Set([1, 2, 3, 4, 5, 6].flatMap((t) => new GameData(DATA, 'mode_multi_funny').shopItemsByTier[t] || []));
  for (const [modeId, rounds] of [['mode_multi_funny', [3, 9]], ['mode_multi_normal', [3, 6, 9]]]) {
    assert.deepEqual(DATA.choices.schedule[modeId].spRounds, rounds);
    const gd = new GameData(DATA, modeId);
    for (const round of rounds) {
      let shops = 0;
      let dup = 0;
      let twoVI = 0;
      let lowTier = 0;
      const tiers = new Set();
      for (let seed = 1; shops < 300 && seed < 40000; seed++) {
        const d = generateDraft(gd, createRng(seed * 7717 + round), round, { stageId: 'act2autochess_m01' });
        if (d.family !== 'shop') continue;
        shops++;
        assert.equal(d.cards.length, 6);
        assert.deepEqual(d.cards.map((c) => c.idx), [0, 1, 2, 3, 4, 5]);
        for (const c of d.cards) {
          assert.ok(all.has(c.id), `${modeId} R${round}: ${c.name} is a normal shop item`);
          assert.equal(cardView(c).price, 0);
          tiers.add(DATA.items[c.id].tier);
        }
        const ids = d.cards.map((c) => c.id);
        if (new Set(ids).size < ids.length) dup++;
        if (count(ids, (id) => DATA.items[id].tier === 6) === 2) twoVI++;
        if (ids.some((id) => id !== COIN && DATA.items[id].tier <= 2)) lowTier++;
      }
      assert.equal(shops, 300, `${modeId} R${round}`);
      assert.deepEqual([...tiers].sort(), [1, 2, 3, 4, 5, 6], `${modeId} R${round}: every tier`);
      assert.ok(twoVI / shops < 0.4, `${modeId} R${round}: two tier-VI items in ${(100 * twoVI / shops).toFixed(0)} % (R11: always)`);
      assert.ok(lowTier / shops > 0.5, `${modeId} R${round}: a tier-I / II item besides 盟约之币 in ${(100 * lowTier / shops).toFixed(0)} %`);
      assert.ok(dup / shops > 0.12 && dup / shops < 0.42, `${modeId} R${round}: a repeat in ${(100 * dup / shops).toFixed(0)} % (6 of 51, with replacement: about 26 %)`);
    }
  }
});

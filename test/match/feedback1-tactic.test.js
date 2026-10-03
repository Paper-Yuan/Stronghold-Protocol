// The 战术决策 after the official screenshots (the user, after the R3 / R9 / R11 screenshots of 22 official matches:
// "战术决策也按官方改成可以重复吧"). The 4 official 战术决策 (R11 of matches 7, 9, 18 and 20 in
// test/fixtures/official-bounty-drafts.json) show six cards each; match 7 offers 补给 twice, the other three six different
// cards. All 24 cards are ally cards (no 排斥 / 责罚 / 裁决 debuff, no 模拟战场演变 terrain card), and 列装 / 财富 / 补给 /
// 整备 / 升华 make half of them. choices.json `tacticDraft` (tools/build-data.mjs TACTIC_DRAFT) draws each card on its own,
// with replacement, at R11 (绝境 / 终极 only, the round of the screenshots) from the ally cards weighted 1 + the official
// cards each showed on; other rounds (标准 / 险境, no screenshot) keep every card, uniform, now with replacement too.
// Picking one of two identical cards through the match: test/content/choices.test.js (E2E); the overlay:
// test/ui/feedback1-tactic.test.js; headless Chrome: test/ui/feedback1-tactic.e2e.test.js (SP_E2E=1).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DATA, makeMatch } from './harness.js';
import { GameData } from '../../server/match/gamedata.js';
import { generateDraft, cardView, tacticDraftCards } from '../../server/match/choices.js';
import { botPickCard } from '../../server/match/bot.js';
import { createRng } from '../../server/sim/rng.js';

const OFFICIAL = JSON.parse(readFileSync(new URL('../fixtures/official-bounty-drafts.json', import.meta.url), 'utf8'));
const SPEC = DATA.choices.tacticDraft;
const TACTIC = DATA.choices.cards.tactic;
const ALLY = TACTIC.filter((c) => c.kind === 'ally');
const byName = (name) => TACTIC.filter((c) => c.name === name);
/** The official 战术决策: [{ match, names }]. */
const DRAFTS = Object.entries(OFFICIAL.matches).flatMap(([m, rs]) => Object.entries(rs).filter(([, d]) => d.family === 'tactic').map(([r, d]) => ({ match: Number(m), round: Number(r), names: d.cards.map(([n]) => n) })));
const BASIC = ['列装', '财富', '补给', '整备', '升华'];
const repeats = (ids) => ids.length - new Set(ids).size;
const count = (list, pred) => list.filter(pred).length;

test('战术决策 (4 official drafts, R11): six ally cards each, 补给 twice in match 7, half of the cards 列装 / 财富 / 补给 / 整备 / 升华', () => {
  assert.deepEqual(DRAFTS.map((d) => [d.match, d.round]), [[7, 11], [9, 11], [18, 11], [20, 11]]);
  for (const { match, names } of DRAFTS) {
    assert.equal(names.length, 6, `match ${match}`);
    for (const n of names) {
      assert.equal(byName(n).length, 1, `match ${match}: ${n} is one cards.tactic entry`);
      assert.equal(byName(n)[0].kind, 'ally', `match ${match}: ${n} is an ally card`);
    }
  }
  assert.deepEqual(DRAFTS.map((d) => repeats(d.names)), [1, 0, 0, 0], 'one repeat in four drafts');
  assert.equal(count(DRAFTS[0].names, (n) => n === '补给'), 2, 'match 7: 补给 ×2');
  const all = DRAFTS.flatMap((d) => d.names);
  assert.equal(all.length, 24);
  assert.equal(new Set(all).size, 14, '14 different cards');
  assert.equal(count(all, (n) => BASIC.includes(n)), 12, 'the five basic cards: 12 of 24 (a uniform draw of the 26 ally cards: about 4.6)');
  // the data: R11, ally cards, weight 1 + the official cards a card showed on
  assert.deepEqual(SPEC.seen, [7, 9, 18, 20]);
  assert.deepEqual(SPEC.rounds, [11], 'where the screenshots are: R11 (绝境 / 终极)');
  assert.deepEqual(SPEC.kinds, ['ally']);
  assert.equal(SPEC.count, 6);
  const seen = {};
  for (const n of all) seen[byName(n)[0].effectId] = (seen[byName(n)[0].effectId] || 0) + 1;
  assert.deepEqual(SPEC.weights, Object.fromEntries(Object.entries(seen).map(([id, k]) => [id, 1 + k])));
  assert.equal(SPEC.weights[byName('补给')[0].effectId], 4, '补给 on 3 of the 24 cards');
  // open: every official draft holds a 驰援, a 盟誓 and two basic cards (a slot structure?) — the draws stay independent, marked
  for (const { match, names } of DRAFTS) {
    assert.ok(names.some((n) => n.endsWith('驰援')) && names.some((n) => n.endsWith('的盟誓')), `match ${match}: a 驰援 and a 盟誓`);
    assert.ok(count(names, (n) => BASIC.includes(n)) >= 2, `match ${match}: two basic cards`);
  }
  assert.ok(SPEC.assumed.includes('independent draws (no slot structure)'), 'the independent draws are marked assumed');
  // the official header of the event
  for (const id of ['buff_select_1', 'hardbuff_select_1']) assert.equal(DATA.choices.events[id].desc, '进行协同调整，做好迎战准备。');
  assert.equal(DATA.choices.families.tactic.desc, '进行协同调整，做好迎战准备。');
});

test('战术决策 generated (co-op 绝境 / 终极 R11): six ally cards, each drawn on its own — the same card can come twice', () => {
  for (const modeId of ['mode_multi_hard', 'mode_multi_abyss']) {
    const gd = new GameData(DATA, modeId);
    let drafts = 0;
    let dup = 0;
    let basic = 0;
    const freq = {};
    for (let seed = 1; drafts < 2000 && seed < 40000; seed++) {
      // act1 m02 is a 绝境 / 终极 stage with two terrain cards (map_m02_1 / 2): none comes at R11
      const d = generateDraft(gd, createRng(seed * 7919 + 3), 11, { stageId: 'act1autochess_m02', bondAvailable: () => true });
      if (d.family !== 'tactic') continue;
      drafts++;
      assert.equal(d.name, '战术决策');
      assert.equal(d.desc, '进行协同调整，做好迎战准备。');
      assert.equal(d.cards.length, 6);
      assert.deepEqual(d.cards.map((c) => c.idx), [0, 1, 2, 3, 4, 5], 'each card its own index');
      assert.equal(new Set(d.cards).size, 6, 'each card its own object');
      for (const c of d.cards) {
        assert.equal(c.kind, 'tactic');
        assert.equal(c.tacticKind, 'ally', `${modeId}: ${c.name} is an ally card`);
        freq[c.id] = (freq[c.id] || 0) + 1;
        if (BASIC.includes(c.name)) basic++;
      }
      if (repeats(d.cards.map((c) => c.id))) dup++;
    }
    assert.equal(drafts, 2000, modeId);
    assert.ok(dup / drafts > 0.4 && dup / drafts < 0.7, `${modeId}: a repeated card in ${(100 * dup / drafts).toFixed(0)} % (official 1 of 4)`);
    assert.ok(basic / drafts > 1.6 && basic / drafts < 2.5, `${modeId}: ${(basic / drafts).toFixed(2)} basic cards a draft (official 3; uniform 1.2)`);
    for (const c of ALLY) assert.ok(freq[c.effectId] > 0, `${modeId}: ${c.name} can come`);
    const of = (name) => freq[byName(name)[0].effectId];
    assert.ok(of('补给') > 2.5 * of('自愈'), `${modeId}: 补给 (weight 4) ${of('补给')} vs 自愈 (weight 1) ${of('自愈')}`);
  }
});

test('战术决策 seeded (co-op 绝境 R11, seed 30): 补给 twice — two cards with their own index and the same face', () => {
  const gd = new GameData(DATA, 'mode_multi_hard');
  const d = generateDraft(gd, createRng(30), 11, { stageId: 'act1autochess_m02' });
  assert.equal(d.family, 'tactic');
  const names = d.cards.map((c) => c.name);
  const at = names.flatMap((n, i) => (n === '补给' ? [i] : []));
  assert.equal(at.length, 2, `补给 twice: ${names.join(' ')}`);
  const [a, b] = at.map((i) => d.cards[i]);
  assert.notEqual(a, b);
  assert.notEqual(a.idx, b.idx);
  const { idx: ia, ...va } = cardView(a);
  const { idx: ib, ...vb } = cardView(b);
  assert.deepEqual([ia, ib], at);
  assert.deepEqual(va, vb, 'the same card face');
  assert.deepEqual(va, { kind: 'tactic', id: 'allybuff_select_4', name: '补给', desc: byName('补给')[0].desc, tier: null, team: true, tacticKind: 'ally' });
});

test('战术决策 solo 绝境 R11: three ally cards, a repeat sometimes [ASSUMED: solo extrapolated from co-op]', () => {
  const gd = new GameData(DATA, 'mode_single_hard');
  let drafts = 0;
  let dup = 0;
  for (let seed = 1; drafts < 1000 && seed < 40000; seed++) {
    const d = generateDraft(gd, createRng(seed * 31 + 5), 11, {});
    if (d.family !== 'tactic') continue;
    drafts++;
    assert.equal(d.cards.length, 3);
    assert.ok(d.cards.every((c) => c.tacticKind === 'ally'));
    if (repeats(d.cards.map((c) => c.id))) dup++;
  }
  assert.equal(drafts, 1000);
  assert.ok(dup / drafts > 0.05 && dup / drafts < 0.3, `a repeated card in ${(100 * dup / drafts).toFixed(0)} %`);
});

test('战术决策 outside R11 (标准 R3 / R9, 险境 R3 / R6 / R9, 险境 solo R9 — no screenshot): every card uniform, with replacement', () => {
  for (const [modeId, rounds, stageId, cards] of [
    ['mode_multi_funny', [3, 9], 'act1autochess_m01', 6],
    ['mode_multi_normal', [3, 6, 9], 'act1autochess_m02', 6],
    ['mode_single_normal', [9], 'act1autochess_m02', 3],
  ]) {
    const gd = new GameData(DATA, modeId);
    const stageTerrain = TACTIC.filter((c) => c.kind === 'terrain' && c.stageId === stageId).map((c) => c.effectId);
    for (const round of rounds) {
      let drafts = 0;
      let dup = 0;
      const kinds = new Set();
      const ids = new Set();
      for (let seed = 1; drafts < 600 && seed < 60000; seed++) {
        const d = generateDraft(gd, createRng(seed * 104729 + round), round, { stageId });
        if (d.family !== 'tactic') continue;
        drafts++;
        assert.equal(d.cards.length, cards);
        assert.deepEqual(d.cards.map((c) => c.idx), [...Array(cards).keys()]);
        for (const c of d.cards) {
          kinds.add(c.tacticKind);
          ids.add(c.id);
          if (c.tacticKind === 'terrain') assert.ok(stageTerrain.includes(c.id), `${modeId} R${round}: ${c.name} belongs to ${stageId}`);
        }
        if (repeats(d.cards.map((c) => c.id))) dup++;
      }
      assert.equal(drafts, 600, `${modeId} R${round}`);
      assert.deepEqual([...kinds].sort(), ['ally', 'enemyDebuff', 'terrain'], `${modeId} R${round}: ally, debuff and the stage's terrain cards`);
      for (const id of stageTerrain) assert.ok(ids.has(id), `${modeId} R${round}: ${id}`);
      const [lo, hi] = cards === 6 ? [0.2, 0.5] : [0.02, 0.2];
      assert.ok(dup / drafts > lo && dup / drafts < hi, `${modeId} R${round}: a repeated card in ${(100 * dup / drafts).toFixed(0)} %`);
    }
  }
});

test('tacticDraftCards: a draw over one card fills every place; dead-bond cards never come; without tacticDraft every card is uniform', () => {
  const gd = new GameData(DATA, 'mode_multi_hard');
  // a 驰援 whose bond is dead: never offered, even at R11
  const yan = byName('炎盟约驰援')[0].effectId;
  for (let s = 1; s <= 300; s++) assert.ok(!tacticDraftCards(gd, createRng(s), 6, { round: 11, bondAvailable: (b) => b !== 'yanShip' }).some((c) => c.id === yan));
  // only one card left: six copies of it, six separate objects
  const only = { ...DATA, choices: { ...DATA.choices, cards: { ...DATA.choices.cards, tactic: TACTIC.filter((c) => c.name === '升华') } } };
  const six = tacticDraftCards(new GameData(only, 'mode_multi_hard'), createRng(1), 6, { round: 11 });
  assert.deepEqual(six.map((c) => c.name), Array(6).fill('升华'));
  assert.equal(new Set(six).size, 6);
  // R11 kinds that leave nothing (a debuff-only pool): every card instead
  const debuffs = { ...DATA, choices: { ...DATA.choices, cards: { ...DATA.choices.cards, tactic: TACTIC.filter((c) => c.kind === 'enemyDebuff') } } };
  assert.equal(tacticDraftCards(new GameData(debuffs, 'mode_multi_hard'), createRng(2), 6, { round: 11 }).length, 6);
  // no tacticDraft (older data): every card, uniform, with replacement, at R11 too
  const { tacticDraft, ...rest } = DATA.choices; // eslint-disable-line no-unused-vars
  const plain = new GameData({ ...DATA, choices: rest }, 'mode_multi_hard');
  const kinds = new Set();
  for (let s = 1; s <= 200; s++) for (const c of tacticDraftCards(plain, createRng(s), 6, { round: 11 })) kinds.add(c.tacticKind);
  assert.deepEqual([...kinds].sort(), ['ally', 'enemyDebuff']);
});

test('bot: two identical tactic cards are two choices — it takes one index, and the other once the first is gone', () => {
  // the merged bot (DESIGN §21.6) scores a tactic card on the player's own bonds, so a real seat; no jitter
  const m = makeMatch({ mode: 'solo', difficulty: 'HARD', seed: 7, seats: [{ seat: 0, playerId: 'ai_0', name: 'AI', isBot: true, connected: true }] }).start().m;
  const ps = m.order[0];
  m.rngBots = () => 0;
  const card = (idx, team) => ({ idx, kind: 'tactic', id: 'allybuff_select_4', name: '补给', team, tacticKind: 'ally' });
  const cards = [card(0, true), card(1, false), card(2, true)];
  assert.equal(botPickCard(m, ps, cards, [0, 1, 2]), 0, 'the first of the two team cards');
  assert.equal(botPickCard(m, ps, cards, [1, 2]), 2, 'the twin, once the first is taken');
  assert.equal(botPickCard(m, ps, cards, [1]), 1);
  m.dispose();
});

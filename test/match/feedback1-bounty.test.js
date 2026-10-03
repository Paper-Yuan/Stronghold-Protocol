// Player feedback after 0.1.0, report #2 (workstream WB): "本来应该后期出的悬赏的怪物在前期的悬赏就出现了，导致选了打不过".
// The user then collected the official 机变 of rounds 3, 9 and 11 in 22 official co-op matches (66 screenshots, 绝境 /
// 终极, one season — videos of the end of March 2026; the readings are test/fixtures/official-bounty-drafts.json, player
// names left out). They settle the draft rules (tools/build-data.mjs BOUNTY_INITIAL_SETS, server/match/choices.js
// bountyDraftCards): a 悬赏决策 event is a fixed card list and the draft shows 6 different cards of it —
//   R3  a set of six "接下来两场作战" cards (all six), 3 × I + 2 × II + 1 × III: 9 of the 10 events seen;
//   R9  a group of up to 9 boss bounties / 源石虫·特训: 6 groups (9, 9, 9, 9, 8, 6 cards) for the 6 events, the 鼠王
//       group in 14 of 22 matches;
//   R11 悬赏决策 14 / 机密商店 4 / 战术决策 4 / 道具补给 0; its bounty: a list of 7 "下场战斗" cards (one 特异III giant),
//       one per faction series — 7 lists seen, three of them whole (each draft leaves out one card), picked uniformly
//       (no list built from nothing; which of the 15 bounty_hunter events R11 fires is open);
//   no draft shows a multi-round card, a pre-series card (enemyeffect_3_*), 战术特训 or the 鸭爵 set; no card twice.
// Each card's enemy is fixed by its effect; the title only names category and tier (悬赏·损伤I = 底海滑动者 in
// enemyeffect_12_4, 临时收音师 in enemyeffect_18_1). Real data, real draft code, the real match path for the players' case.
// The 机密商店 is in test/match/feedback1-secret-shop.test.js.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { PHASE } from '../../shared/constants.js';
import { DATA, makeMatch } from './harness.js';
import { FakeBattle } from './fakeBattle.js';
import { GameData } from '../../server/match/gamedata.js';
import { generateDraft, bountyDraftKind } from '../../server/match/choices.js';
import { createRng } from '../../server/sim/rng.js';

const OFFICIAL = JSON.parse(readFileSync(new URL('../fixtures/official-bounty-drafts.json', import.meta.url), 'utf8'));
const CARDS = DATA.choices.cards.bounty;
const CARD = new Map(CARDS.map((c) => [c.effectId, c]));
const SPEC = DATA.choices.bountyDrafts;
const COOP_BOUNTY_MODES = ['mode_multi_normal', 'mode_multi_hard', 'mode_multi_abyss'];
const isBoss = (key) => DATA.enemies[key] && DATA.enemies[key].rank === 'BOSS';
const sameSet = (a, b) => a.length === b.length && [...a].sort().join() === [...b].sort().join();
const subset = (a, b) => a.every((x) => b.includes(x));
const EE = (s) => `enemyeffect_${s}`;

/** The data card of a screenshot reading [title, enemy, coins, battles] (by title, the enemy in the text, coins, battles). */
function resolve([title, enemy, coin, battles]) {
  const name = OFFICIAL.aliases[enemy] || enemy;
  // "1只萨卡兹枯朽战士，" — the enemy's whole name (萨卡兹枯朽战士 is not 萨卡兹枯朽战士组长)
  const hits = CARDS.filter((c) => c.name === title && c.coin === coin && (c.desc.includes(`1只${name}，`) || c.desc.includes(`1个${name}，`))
    && (battles === 2 ? c.rounds === 2 : c.rounds === 1));
  assert.equal(hits.length, 1, `${title} ${enemy} ${coin}: ${hits.map((c) => c.effectId).join(', ') || 'no card'}`);
  return hits[0].effectId;
}
/** Every official draft of the fixture: [{ where, match, round, family, ids? }] (ids for 悬赏决策). */
function officialDrafts() {
  const out = [];
  for (const [match, rounds] of Object.entries(OFFICIAL.matches)) {
    for (const [round, d] of Object.entries(rounds)) out.push({ where: `match ${match} R${round}`, match: Number(match), round: Number(round), family: d.family, ids: d.family === 'bounty' ? d.cards.map(resolve) : null });
  }
  for (const [key, d] of Object.entries(OFFICIAL.extra)) out.push({ where: key, match: key, round: 9, family: d.family, ids: d.cards.map(resolve) });
  return out;
}
const tiersOf = (ids) => ids.map((id) => CARD.get(id).tier).sort().join('');
/** The group of `spec` whose `seen` lists the draft's match. */
const groupOf = (spec, d) => spec.groups.filter((g) => g.seen.includes(d.match));
/** At most one card per faction series 10–15 (every official R11 draft). */
function onePerSeries(ids) {
  const series = ids.map((id) => CARD.get(id).series).filter((s) => SPEC.hunter.rule.onePerSeries.includes(s));
  return new Set(series).size === series.length;
}
const giantsIn = (ids) => ids.filter((id) => SPEC.hunter.rule.giants.includes(id)).length;
/** The weights the data gives a group's cards: 1 + the official drafts of that group the card appeared in. */
function expectedWeights(g, drafts) {
  return g.cards.map((id) => 1 + drafts.filter((d) => d.ids.includes(id)).length);
}

/** Bounty drafts generated for `modeId` at `round` over `seeds` seeds. */
function drafts(modeId, round, seeds, data = DATA) {
  const gd = new GameData(data, modeId);
  const out = [];
  for (let seed = 1; seed <= seeds; seed++) {
    const d = generateDraft(gd, createRng(seed * 7919 + round * 31), round, { stageId: 'act2autochess_m01' });
    if (d && d.family === 'bounty') out.push(d);
  }
  return out;
}

/** An unseen-slot R3 set (`rule`): two-battle cards of its series, I I I II II III, ≤ perSeries a series, the III preferred. */
function initialRule(ids) {
  const r = SPEC.initial.rule;
  const series = ids.map((id) => CARD.get(id).series);
  return ids.length === 6 && ids.every((id) => CARD.get(id).draftPool === 'initial' && r.series.includes(CARD.get(id).series))
    && series.every((s) => series.filter((x) => x === s).length <= r.perSeries) && tiersOf(ids) === r.tiers.slice().sort().join('')
    && ids.some((id) => r.prefer.includes(id));
}

test('#2 screenshots → data: every card read is one act2autochess (下半) effect, whose enemy_id is the enemy the card brings', (t) => {
  const seen = new Set();
  for (const d of officialDrafts()) for (const id of d.ids || []) seen.add(id);
  assert.equal(seen.size, 81, 'distinct cards in the 59 bounty drafts: 40 at R3, 20 at R9, 21 at R11');
  // the R3(1) question: the title names category and tier only — two different 悬赏·损伤I cards, each with its own enemy
  assert.equal(resolve(['悬赏·损伤I', '临时收音师', 1, 2]), 'enemyeffect_18_1');
  assert.equal(resolve(['悬赏·损伤I', '底海滑动者', 1, 2]), 'enemyeffect_12_4');
  assert.equal(resolve(['悬赏·持续I', '萨卡兹枯朽战士', 1, 2]), 'enemyeffect_20_1', 'not 萨卡兹枯朽战士组长 (13_4)');
  assert.equal(CARD.get('enemyeffect_18_1').enemyKey, 'enemy_10094_crstf');
  assert.equal(CARD.get('enemyeffect_12_4').enemyKey, 'enemy_1148_dssbr');
  const p = new URL('../../.cache/gamedata/excel/activity_table.json', import.meta.url);
  if (!existsSync(p)) { t.diagnostic('no .cache/gamedata: the season cross-check is skipped'); return; }
  const act = JSON.parse(readFileSync(p, 'utf8')).activity.AUTOCHESS_SEASON;
  for (const id of seen) {
    const bb = act.act2autochess.effectBuffInfoDataDict[id][0].blackboard.find((x) => x.key === 'enemy_id').valueStr;
    assert.equal(CARD.get(id).enemyKey, bb, `${id}: the card's enemy is the effect's enemy_id`);
  }
  // 上半 (act1autochess) lacks the series 17–20 and 澪 / 纠缠藤蔓 … and has 沉沙 where 下半 has 清明: the screenshots are 下半
  for (const id of ['enemyeffect_17_1', 'enemyeffect_18_1', 'enemyeffect_19_1', 'enemyeffect_20_2', 'enemyeffect_b_19', 'enemyeffect_b_24']) {
    assert.ok(seen.has(id) && !act.act1autochess.effectInfoDataDict[id], `${id} is 下半-only`);
  }
  assert.match(act.act1autochess.effectInfoDataDict.enemyeffect_11_6.effectDesc, /沉沙/);
  // all 22 matches are one season: 终极 (mode_multi_abyss) opened on 2026-03-27 16:00 (UTC+8), before the end-of-March videos
  assert.equal(act.act2autochess.modeDataDict.mode_multi_abyss.startTime, Date.UTC(2026, 2, 27, 8) / 1000);
});

test('#2 R3 (22 of 22 official drafts): one of the official sets of six "接下来两场作战" cards, 3 × I + 2 × II + 1 × III — 9 of the 10 seen', () => {
  const r3 = officialDrafts().filter((d) => d.round === 3);
  assert.equal(r3.length, 22);
  const hits = SPEC.initial.groups.map(() => []);
  for (const d of r3) {
    assert.equal(d.family, 'bounty', `${d.where}: R3 is a 悬赏决策`);
    assert.ok(d.ids.every((id) => CARD.get(id).rounds === 2 && CARD.get(id).draftPool === 'initial'), `${d.where}: two-battle cards`);
    assert.equal(tiersOf(d.ids), '111223', `${d.where}: tiers`);
    assert.ok(d.ids.every((id) => !isBoss(CARD.get(id).enemyKey)), `${d.where}: no boss`);
    const i = SPEC.initial.groups.findIndex((s) => sameSet(s.cards, d.ids));
    assert.ok(i >= 0, `${d.where}: a seen set`);
    hits[i].push(d.match);
  }
  assert.deepEqual(hits, SPEC.initial.groups.map((s) => s.seen), 'each set\'s `seen` lists the matches it came in');
  assert.deepEqual(hits.map((x) => x.length), [5, 3, 2, 3, 2, 1, 2, 1, 3]);
  // hand-made sets, not one card per series: two series-20 cards (match 12), a series-17 card among faction cards (13 / 19 / 21)
  assert.deepEqual(SPEC.initial.groups[7].cards.filter((id) => CARD.get(id).series === 20), [EE('20_1'), EE('20_5')]);
  assert.ok(SPEC.initial.groups[8].cards.includes(EE('17_6')));
  for (const s of SPEC.initial.groups) assert.equal(tiersOf(s.cards), '111223', s.cards.join());
  assert.equal(SPEC.initial.slots, 10, 'enemy_initial_1..10: one unseen');
  assert.equal(SPEC.initial.pick, 'slot');
  // the only two-battle cards no draft showed are the unseen set's preferred tier-III cards
  const shown = new Set(r3.flatMap((d) => d.ids));
  assert.deepEqual(CARDS.filter((c) => c.draftPool === 'initial' && !shown.has(c.effectId)).map((c) => c.effectId), SPEC.initial.rule.prefer);
  assert.ok(SPEC.initial.rule.prefer.every((id) => CARD.get(id).tier === 3));
});

test('#2 R3 generated: a seen set (all six cards) or the unseen 10th set — every seen set comes up, the unseen one about 1 in 10', () => {
  const counts = new Map();
  let n = 0;
  for (const modeId of COOP_BOUNTY_MODES) {
    for (const round of DATA.choices.schedule[modeId].spRounds.filter((r) => bountyDraftKind(r) === 'initial')) {
      for (const d of drafts(modeId, round, modeId === 'mode_multi_hard' ? 600 : 60)) {
        const ids = d.cards.map((c) => c.id);
        assert.equal(new Set(ids).size, 6, 'six different cards');
        const i = SPEC.initial.groups.findIndex((s) => sameSet(s.cards, ids));
        const fit = i >= 0 ? `set:${i}` : initialRule(ids) ? 'rule' : null;
        assert.ok(fit, `${modeId} R${round}: ${d.cards.map((c) => c.name).join(', ')}`);
        assert.ok(d.cards.every((c) => c.rounds === 2 && !isBoss(c.enemyKey)), 'two-battle cards, no boss');
        assert.match(d.eventId, /^enemy_initial_\d+$/);
        if (modeId === 'mode_multi_hard') { counts.set(fit, (counts.get(fit) || 0) + 1); n++; }
      }
    }
  }
  for (let i = 0; i < SPEC.initial.groups.length; i++) assert.ok(counts.get(`set:${i}`) > 0, `set ${i} offered`);
  const rule = (counts.get('rule') || 0) / n;
  assert.ok(rule > 0.05 && rule < 0.16, `unseen-set drafts ${(rule * 100).toFixed(0)} %`);
  // solo: 3 cards of such a set
  for (const d of drafts('mode_single_hard', 3, 40)) {
    assert.equal(d.cards.length, 3);
    assert.ok(d.cards.every((c) => CARD.get(c.id).draftPool === 'initial'));
  }
});

test('#2 R9 (23 official drafts): six groups (9, 9, 9, 9, 8, 6 cards) of boss bounties / 源石虫·特训, 6 cards a draft — 庞贝 and 鼠王 never together, the 鼠王 group in 14 of 22 matches', () => {
  const r9 = officialDrafts().filter((d) => d.round === 9);
  assert.equal(r9.length, 23, '22 matches + the Bahamut co-op screenshot');
  const B = SPEC.boss;
  assert.equal(B.groups.length, B.events.length, 'one group per bossInitial event');
  // the groups as they are: 9 cards where three named bosses came; the single-draft groups completed only with the
  // base cards they lack — 腐败骑士 9, 泥岩 + 澪 8, match 4 (the base alone) 6 [ASSUMED]
  assert.deepEqual(B.groups.map((g) => g.cards.length), [9, 9, 9, 9, 8, 6]);
  const base = B.groups.find((g) => g.seen.includes(4));
  assert.deepEqual(base.seen, [4]);
  assert.ok(sameSet(base.cards, ['b_10', 'b_1', 'b_3', 'b_13', 'b_12', '5_1'].map(EE)), 'match 4: W 碎骨 弑君者 大鲍勃 庞贝 源石虫');
  // …which is also six cards of the 喷气人 and 泥岩 groups: match 4 may be a draft of one of them (open question)
  for (const boss of ['b_8', 'b_4']) assert.ok(subset(base.cards, B.groups.find((g) => g.cards.includes(EE(boss))).cards));
  for (const d of r9) {
    assert.equal(d.family, 'bounty', `${d.where}: R9 is a 悬赏决策`);
    assert.ok(d.ids.every((id) => CARD.get(id).draftPool === 'boss' && CARD.get(id).rounds === 1), `${d.where}: boss bounties / 源石虫·特训, 下场作战`);
    const g = groupOf(B, d);
    assert.equal(g.length, 1, `${d.where}: listed by one group`);
    assert.ok(subset(d.ids, g[0].cards), `${d.where}: six cards of its group`);
    assert.ok(!(d.ids.includes(EE('b_12')) && d.ids.includes(EE('b_11'))), `${d.where}: 庞贝 and 鼠王 never together`);
  }
  for (const g of B.groups) {
    const ds = r9.filter((d) => g.seen.includes(d.match));
    assert.equal(ds.length, g.seen.length, `${g.cards.join(' ')}: every match it lists`);
    assert.deepEqual(g.weights, expectedWeights(g, ds), `${g.cards.join(' ')}: weights = 1 + the drafts each card showed in`);
    // every group seen in 3 or more drafts shows exactly 9 different cards — the list
    if (ds.length >= 3) assert.ok(sameSet([...new Set(ds.flatMap((d) => d.ids))], g.cards) && g.cards.length === 9, `${g.cards.join(' ')}: the 9 cards its drafts show`);
  }
  // a named boss does not always come with its partners: 杰斯顿 alone (12, 15, 21); 复仇者 + 百夫长 without 邪魔的利刃 (20)
  const named = (d) => d.ids.filter((id) => ['b_9', 'b_14', 'b_23'].map(EE).includes(id));
  for (const m of [12, 15, 21]) assert.deepEqual(named(r9.find((d) => d.match === m)), [EE('b_9')], `match ${m}`);
  const m20 = r9.find((d) => d.match === 20).ids;
  assert.ok(m20.includes(EE('b_21')) && m20.includes(EE('b_2')) && !m20.includes(EE('b_22')));
  // the 鼠王 group: 14 of 22 matches, every match on the dark grey board (7 of 7) — something of the match picks the group
  const rat = B.groups.find((g) => g.cards.includes(EE('b_11')));
  assert.equal(rat.seen.length, 14);
  for (const m of OFFICIAL.boards.grey) assert.ok(rat.seen.includes(m), `match ${m} (grey board): the 鼠王 group`);
  assert.equal(B.pick, 'seen');
  // generated: six different cards of one group; the 鼠王 group about 14 / 22; every card of every group offered
  const offered = new Set();
  let ratN = 0;
  const gen = drafts('mode_multi_abyss', 9, 1500);
  for (const d of gen) {
    const ids = d.cards.map((c) => c.id);
    assert.equal(new Set(ids).size, 6);
    assert.ok(B.groups.some((g) => subset(ids, g.cards)), ids.join(', '));
    assert.ok(!(ids.includes(EE('b_12')) && ids.includes(EE('b_11'))), '庞贝 and 鼠王 never together');
    assert.match(d.eventId, /^bossInitial_\d+$/);
    if (ids.some((id) => ['b_11', 'b_9', 'b_14', 'b_23'].map(EE).includes(id)) && subset(ids, rat.cards)) ratN++;
    ids.forEach((id) => offered.add(id));
  }
  assert.ok(ratN / gen.length > 0.55 && ratN / gen.length < 0.73, `the 鼠王 group ${(100 * ratN / gen.length).toFixed(0)} %`);
  for (const g of B.groups) for (const id of g.cards) assert.ok(offered.has(id), `${CARD.get(id).name} offered`);
  for (const id of ['enemyeffect_b_6', 'enemyeffect_b_7', 'enemyeffect_b_15', 'enemyeffect_b_16', 'enemyeffect_b_18']) {
    assert.equal(CARD.get(id).draftExcluded, 'unseen', `${CARD.get(id).name}: in no official R9 draft`);
    assert.ok(!offered.has(id));
  }
});

test('#2 R11 (22 matches: 悬赏决策 14, 机密商店 4, 战术决策 4, 道具补给 0): the families, and the bounty — 6 of a list of 7 "下场战斗" cards, one per faction series', () => {
  const r11 = officialDrafts().filter((d) => d.round === 11);
  const fam = {};
  for (const d of r11) fam[d.family] = (fam[d.family] || 0) + 1;
  assert.deepEqual(fam, { bounty: 14, shop: 4, tactic: 4 });
  const H = SPEC.hunter;
  const bounty = r11.filter((x) => x.family === 'bounty');
  for (const d of bounty) {
    assert.ok(d.ids.every((id) => CARD.get(id).draftPool === 'hunter' && CARD.get(id).rounds === 1), `${d.where}: R11 cards, 下场战斗`);
    assert.ok(onePerSeries(d.ids), `${d.where}: one card per faction series`);
    assert.ok(giantsIn(d.ids) <= 1, `${d.where}: at most one giant`);
    const g = groupOf(H, d);
    assert.equal(g.length, 1, `${d.where}: listed by one group`);
    assert.ok(subset(d.ids, g[0].cards), `${d.where}: six cards of its group`);
  }
  assert.equal(bounty.filter((d) => giantsIn(d.ids) === 1).length, 13, 'a giant in 13 of 14 (not match 15)');
  for (const g of H.groups) {
    const ds = bounty.filter((d) => g.seen.includes(d.match));
    assert.equal(ds.length, g.seen.length);
    assert.equal(g.cards.length + (g.open || 0), H.rule.size, `${g.cards.join(' ')}: a list of 7`);
    assert.deepEqual(g.weights, expectedWeights(g, ds), `${g.cards.join(' ')}: weights = 1 + hits`);
    assert.ok(sameSet([...new Set(ds.flatMap((d) => d.ids))], g.cards), `${g.cards.join(' ')}: the cards its drafts show`);
    assert.ok(onePerSeries(g.cards) && giantsIn(g.cards) <= 1);
    if (!giantsIn(g.cards)) assert.equal(g.open, 1, 'a list showing no giant gets one by the rule');
  }
  // the evidence for lists of 7: the 16_4 group's four drafts each leave out a different one of the same 7 cards
  const big = H.groups.find((g) => g.cards.includes(EE('16_4')));
  const left = bounty.filter((d) => big.seen.includes(d.match)).map((d) => big.cards.find((id) => !d.ids.includes(id)));
  assert.equal(new Set(left).size, 4, left.join(' '));
  assert.equal(H.groups.filter((g) => !g.open).length, 3, 'three groups seen whole');
  assert.deepEqual(CARDS.filter((c) => c.draftPool === 'hunter' && !bounty.some((d) => d.ids.includes(c.effectId))).map((c) => c.effectId),
    ['12_8', '16_2', '16_6'].map(EE), 'R11 cards no draft showed');
  for (const modeId of ['mode_multi_hard', 'mode_multi_abyss', 'mode_single_hard', 'mode_single_abyss']) {
    const sch = DATA.choices.schedule[modeId].rounds['11'];
    assert.deepEqual(sch.families, [{ family: 'bounty', weight: 14 }, { family: 'shop', weight: 4 }, { family: 'tactic', weight: 4 }], `${modeId} R11 (solo: extrapolated from co-op, [ASSUMED])`);
    assert.equal(sch.bountyDraft, 'hunter');
    assert.equal(sch.assumed, true);
  }
  // the list is one of the 7 seen, uniform — no list built from nothing [ASSUMED]: 15 equally likely events would show 7
  // lists or fewer in 14 drafts about 6 % of the time; 7, 8 or 9 events show exactly 7 about equally often (37 / 45 / 39 %)
  assert.equal(H.events.length, 15, 'bounty_hunter_1..15 in the data');
  assert.equal(H.slots, H.groups.length);
  assert.equal(H.slots, 7);
  assert.equal(H.pick, 'slot');
  // the data's block order, which does NOT settle which events R11 fires: bounty_hunter_1..7 after bossInitial_1..6;
  // 8..15 after artifact_paid_4 / 5 and right before the 绝境 / 终极-only hardbuff_select (read by blocks, R11 = 8..15)
  const p = new URL('../../.cache/gamedata/excel/activity_table.json', import.meta.url);
  if (existsSync(p)) {
    const keys = Object.keys(JSON.parse(readFileSync(p, 'utf8')).activity.AUTOCHESS_SEASON.act2autochess.effectChoiceInfoDict);
    const at = (k) => keys.indexOf(k);
    assert.equal(at('bounty_hunter_1'), at('bossInitial_6') + 1, 'bounty_hunter_1..7 right after the R9 events');
    for (let i = 2; i <= 7; i++) assert.equal(at(`bounty_hunter_${i}`), at('bounty_hunter_1') + i - 1);
    assert.ok(at('artifact_paid_5') > at('bounty_hunter_7') + 1, 'bounty_hunter_8..15 not with 1..7');
    for (let i = 8; i <= 15; i++) assert.equal(at(`bounty_hunter_${i}`), at('artifact_paid_5') + i - 7, 'bounty_hunter_8..15 right after artifact_paid_4 / 5');
    assert.equal(at('hardbuff_select_1'), at('bounty_hunter_15') + 1);
  }
  // generated: six different cards, one per faction series, at most one giant, at most the `open` card outside one seen
  // list; a whole seen list about 3 in 7; every R11 card comes up (12_8 / 16_2 / 16_6 only as an `open` card, rarely)
  const gd = new GameData(DATA, 'mode_multi_hard');
  const seen = {};
  const offered = new Set();
  const never = ['12_8', '16_2', '16_6'].map(EE);
  let n = 0;
  let fitSeen = 0;
  let giants = 0;
  let unseenCard = 0;
  for (let seed = 1; seed <= 2000; seed++) {
    const d = generateDraft(gd, createRng(seed * 13 + 11), 11, { stageId: 'act2autochess_m01' });
    seen[d.family] = (seen[d.family] || 0) + 1;
    if (d.family !== 'bounty') continue;
    const ids = d.cards.map((c) => c.id);
    assert.equal(new Set(ids).size, 6);
    assert.ok(ids.every((id) => CARD.get(id).draftPool === 'hunter') && onePerSeries(ids) && giantsIn(ids) <= 1, d.cards.map((c) => c.name).join(', '));
    assert.match(d.eventId, /^bounty_hunter_\d+$/);
    assert.ok(H.groups.some((g) => ids.filter((id) => !g.cards.includes(id)).length <= (g.open || 0)), `six cards of a seen list (+ its open card): ${d.cards.map((c) => c.name).join(', ')}`);
    if (H.groups.some((g) => !g.open && subset(ids, g.cards))) fitSeen++;
    if (ids.some((id) => never.includes(id))) unseenCard++;
    giants += giantsIn(ids);
    n++;
    ids.forEach((id) => offered.add(id));
  }
  assert.deepEqual(Object.keys(seen).sort(), ['bounty', 'shop', 'tactic'], 'no 道具补给 at R11');
  assert.ok(seen.bounty / 2000 > 0.56 && seen.bounty / 2000 < 0.71, JSON.stringify(seen));
  assert.ok(fitSeen / n > 0.36 && fitSeen / n < 0.5, `drafts of the three whole seen groups ${(100 * fitSeen / n).toFixed(0)} % (3 / 7)`);
  // a card no official draft showed: rare enough that 14 drafts without one (the official sample) stays likely
  const q = unseenCard / n;
  assert.ok(q > 0.02 && q < 0.1, `12_8 / 16_2 / 16_6 in ${(100 * q).toFixed(1)} % of R11 bounty drafts`);
  assert.ok((1 - q) ** 14 > 0.25, `14 drafts without one: ${(100 * (1 - q) ** 14).toFixed(0)} %`);
  assert.ok(giants / n > 0.78 && giants / n < 0.93, `a giant in ${(100 * giants / n).toFixed(0)} % (official 13 / 14)`);
  for (const c of CARDS.filter((x) => x.draftPool === 'hunter')) assert.ok(offered.has(c.effectId), `${c.effectId} ${c.name} offered at R11`);
});

test('#2 never offered by a draft (in none of the 59 official bounty drafts): multi-round cards, enemyeffect_3_*, 战术特训, the 鸭爵 set', () => {
  const reasons = {};
  for (const c of CARDS) {
    if (!c.draft) reasons[c.draftExcluded] = (reasons[c.draftExcluded] || 0) + 1;
    assert.equal(c.draft, c.draftPool != null, `${c.effectId}: drafted iff it has a draft kind`);
    if (c.multiRound) assert.equal(c.draftExcluded, c.payout === 'kill' ? 'unseen' : 'perfect', `${c.effectId} ${c.name}`);
    if (/^enemyeffect_3_/.test(c.effectId)) assert.equal(c.draftExcluded, 'unseen', `${c.effectId} ${c.name}`);
  }
  assert.deepEqual(reasons, { perfect: 20, hidden: 4, unseen: 19 });
  const pools = {};
  for (const c of CARDS) if (c.draft) pools[c.draftPool] = (pools[c.draftPool] || 0) + 1;
  assert.deepEqual(pools, { initial: 42, boss: 20, hunter: 24 });
  for (const modeId of [...COOP_BOUNTY_MODES, 'mode_single_hard', 'mode_single_abyss']) {
    for (const r of DATA.choices.schedule[modeId].spRounds) {
      for (const d of drafts(modeId, r, 40)) {
        for (const c of d.cards) {
          const card = CARD.get(c.id);
          assert.ok(card.draft && card.draftPool === bountyDraftKind(r), `${modeId} R${r}: ${c.id} ${c.name}`);
          assert.ok(!card.multiRound && card.payout === 'kill');
        }
      }
    }
  }
});

test('#2 the mode\'s inactive enemy list does not thin the bounty draft (PRTS 卫戍协议：盟约 11/18 note "不影响悬赏决策出场")', () => {
  // 险境 turns off 尖端萨卡兹枯朽战车 and 灼藤 in its waves; their R11 cards (13_8, 12_7) stay in an R11-kind draft there
  const sch = DATA.choices.schedule.mode_multi_normal;
  const data = { ...DATA, choices: { ...DATA.choices, schedule: { ...DATA.choices.schedule, mode_multi_normal: { ...sch, rounds: { ...sch.rounds, 9: { ...sch.rounds['9'], families: [{ family: 'bounty', weight: 1 }], bountyDraft: 'hunter' } } } } } };
  const gd = new GameData(data, 'mode_multi_normal');
  const dropped = ['enemy_1272_nhtank_2', 'enemy_10067_ftsjc'];
  for (const k of dropped) assert.ok(gd.inactiveEnemies.has(k), `${k} is inactive in 险境 waves`);
  const seen = new Set();
  for (const d of drafts('mode_multi_normal', 9, 200, data)) for (const c of d.cards) if (dropped.includes(c.enemyKey)) seen.add(c.enemyKey);
  assert.deepEqual([...seen].sort(), dropped.slice().sort());
});

test('#2 E2E (co-op 绝境, the players\' case): the real R3 draft is an official R3 set, and the picked enemy comes for R3 and R4 at their round scale', () => {
  for (let seed = 1; seed <= 6; seed++) {
    const h = makeMatch({ mode: 'coop', difficulty: 'HARD', humans: 1, bots: 1, seed: 910 + seed, fake: true }).start();
    const m = h.m;
    assert.ok(h.drive(() => m.phase === PHASE.SP_DRAFT && m.round === 3, { ready: true }), 'the R3 draft');
    assert.equal(m.sp.family, 'bounty', 'R3 of 绝境 is always a bounty draft');
    const names = m.sp.cards.map((c) => c.name).join(', ');
    const ids = m.sp.cards.map((c) => c.id);
    assert.ok(SPEC.initial.groups.some((g) => sameSet(g.cards, ids)) || initialRule(ids), `seed ${seed}: ${names}`);
    for (const c of m.sp.cards) assert.ok(!isBoss(c.enemyKey), `seed ${seed}: ${c.name} is a boss bounty`);
    assert.equal(m.publicView().sp.cards.length, m.sp.cards.length);
    // the human takes a card when its turn comes; the bot picks by itself
    let picked = null;
    for (let guard = 0; guard < 200 && m.phase === PHASE.SP_DRAFT; guard++) {
      if (m.spTurn() === 'p_0') {
        picked = m.sp.cards.find((c) => m.sp.taken[c.idx] == null);
        assert.deepEqual(m.handle('p_0', { t: 'g.choice', idx: picked.idx }), { ok: true });
      } else h.sched.runNext();
    }
    assert.ok(picked, 'the human picked');
    const b = h.ps('p_0').bounties.find((x) => x.card.effectId === picked.id);
    assert.ok(b, 'the picker holds the bounty');
    h.drive(() => m.phase === PHASE.ROUND_START && m.round === 6, { ready: true });
    const rounds = [];
    for (const f of FakeBattle.instances) {
      if (f.kind !== 'normal' || !f.players.includes('p_0')) continue;
      const spec = f.spawns.find((s) => s.tag === 'bounty' && s.mods && s.mods.bountyId === b.id);
      if (!spec) continue;
      rounds.push(f.round);
      const scale = m.gd.enemyScale(f.round);
      assert.equal(spec.mods.hpMul, scale.hpMul, `R${f.round}: the bounty enemy takes the round's HP scale`);
      assert.equal(spec.mods.atkMul, scale.atkMul, `R${f.round}: the bounty enemy takes the round's ATK scale`);
    }
    assert.deepEqual(rounds, [3, 4], `seed ${seed}: ${picked.name} (两场作战) spawned in R${rounds.join(', R')}`);
    m.dispose();
  }
});

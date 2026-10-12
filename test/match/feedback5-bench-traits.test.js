// Community report relayed by the owner (2026-10-07): 「有的时候在备战区的干员不能100%叠层…小拉和赫默有概率在备战区叠不上叙拉古
// 和远见」 — 拉普兰德 (小拉, Ⅱ) in the 整备区 sometimes adds no 【叙拉古】 layers, 赫默 (Ⅱ) no 【远见】 layers. Reproduced over
// whole matches (scratchpad notes, R19F): every non-firing case is a rule of the official data, nothing random —
//   * 拉普兰德 garrison_123 「<刷新时>若为本回合首次主动刷新，使已激活的【叙拉古】层数+4，此干员在整备区时也有效」: she works in
//     the 整备区, but 【叙拉古】 must be active (activeCondition BOARD: 3 different 叙拉古 deployed — her bench copy is not one
//     of them), and her trait fires on the first manual refresh she sees this round: a refresh made while 叙拉古 is
//     inactive spends it. The 临时整备区 is not the 整备区 (as for every 整备区 rule): she fires once she is in it.
//   * 赫默 garrison_80 「<进入休整期时>使自身已激活的盟约层数+2」 has no 「此干员在整备区时也有效」 and carries the official
//     blackboard conditionkey character_target_inboard: deployed only. 【远见】's 「整备区的【远见】干员也可用于激活盟约」 counts
//     bench members for the bond, it does not move traits to the bench.
// Through the real match paths (g.refresh / g.buy / g.move, the round loop's ROUND_START dispatch). Pins; no change.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeMatch, give, legalTileFor, checkInvariants, chessOfTier, DATA } from './harness.js';
import { createRegistry } from '../../server/match/effectsMeta.js';

const QUIET = { warn() {}, error() {}, info() {} };
const REG = createRegistry({ log: QUIET });
const OK = { ok: true };
const LAP = 'chess_char_2_16_a'; // 拉普兰德 (Ⅱ, 叙拉古) — garrison_123_a
const LAP_B = 'chess_char_2_16_b';
const PROVENCE = 'chess_char_1_07_a'; // 普罗旺斯 (Ⅰ, 叙拉古; <获得时>获得1次免费刷新)
const TEXAS = 'chess_char_1_08_a'; // 德克萨斯 (Ⅰ, 叙拉古)
const SIYE = 'chess_char_3_18_a'; // 伺夜 (Ⅲ, 叙拉古)
const SILENCE = 'chess_char_2_02_a'; // 赫默 (Ⅱ, 远见) — garrison_80_a
const SILENCE_B = 'chess_char_2_02_b';
const SWIRE = 'chess_char_3_03_a'; // 诗怀雅 (Ⅲ, 远见)
const FILLER = 'chess_char_1_01_a';
/** distinct fillers for a full 整备区: no 叙拉古 / 远见, no prep-side 特质 (one copy each, so nothing merges) */
const FILLERS = [1, 2].flatMap((t) => chessOfTier(t, (c) => !c.bonds.includes('siracusaShip') && !c.bonds.includes('visiShip')
  && (c.garrisonIds || []).every((g) => DATA.garrisons[g].eventType === 'IN_BATTLE')));
const LAP_KEY = 'garrison:SERVER_GAIN_BOND_LAYER_BY_REFRESH_CNT';
const SIL_KEY = 'garrison:SERVER_ADD_BOND_CHESS_ALL';

function setup({ mode = 'solo', bots = 0, round = 1, pid = 'p_0', seed = 70 } = {}) {
  const h = makeMatch({ mode, bots, seed, registry: REG, fake: true }).start();
  h.toPrep(round);
  const m = h.m;
  const ps = h.ps(pid);
  for (const p of [...ps.board.values(), ...ps.hand.filter(Boolean), ...ps.temp.filter(Boolean)]) if (p.kind === 'chess') ps.returnCopies(p);
  ps.board.clear();
  ps.hand.fill(null);
  ps.temp.fill(null);
  ps.offers.length = 0;
  ps.funds = 50;
  ps.layers = {};
  ps.pendingFunds = 0;
  ps.shop.freeRefreshes = 0;
  ps.bandId = null; // isolate from the band's own prep effects
  ps.ready = false;
  ps.recompute();
  /** layers each trait added (the dispatcher's reason = the registry key) */
  const got = { lap: 0, sil: 0 };
  const addLayers = ps.addLayers.bind(ps);
  ps.addLayers = (b, n, o = {}) => {
    const a = addLayers(b, n, o);
    if (o.reason === LAP_KEY && b === 'siracusaShip') got.lap += a;
    if (o.reason === SIL_KEY && b === 'visiShip') got.sil += a;
    return a;
  };
  const refresh = () => assert.deepEqual(m.handle(pid, { t: 'g.refresh' }), OK);
  const deploy = (id) => give(m, ps, id, 'board', legalTileFor(m, ps, id));
  const place = (piece) => {
    const [row, col] = legalTileFor(m, ps, piece.id);
    assert.deepEqual(m.handle(pid, { t: 'g.move', uid: piece.uid, to: { area: 'board', row, col }, dir: 'RIGHT' }), OK);
  };
  const buy = (id) => {
    ps.shop.slots[0] = { kind: 'chess', id, basePrice: m.gd.chessPrice(id), frozen: false, sold: false };
    const before = new Set(ps.allChess().map((p) => p.uid));
    assert.deepEqual(m.handle(pid, { t: 'g.buy', slot: 0 }), OK, `buy ${id}`);
    return ps.allChess().find((p) => !before.has(p.uid));
  };
  const fillHand = () => { let i = 0; while (ps.hand.some((x) => x == null)) give(m, ps, FILLERS[i++], 'hand'); };
  const nextRound = () => { ps.ready = false; h.toPrep(m.round + 1); ps.funds = 50; };
  const siracusa = () => ({ active: !!ps.bonds.siracusaShip?.active, count: ps.bonds.siracusaShip?.count ?? 0 });
  return { h, m, ps, got, refresh, deploy, place, buy, fillHand, nextRound, siracusa };
}

test('official data: a 进入休整期时 / 休整期结束时 / 刷新时 特质 works in the 整备区 exactly when its text says so', () => {
  const PREP = new Set(['SERVER_PREP_START', 'SERVER_PREP_FIN', 'SERVER_REFRESH_SHOP']);
  const bench = [];
  for (const g of Object.values(DATA.garrisons)) {
    if (!PREP.has(g.eventType)) continue;
    const key = g.bbStr && g.bbStr.conditionkey;
    if (/整备区时也有效|整备区也有效/.test(g.desc)) {
      assert.equal(key, undefined, `${g.garrisonId}: a bench trait carries no condition key`);
      bench.push(g.garrisonId);
    } else if (!/^身前一格干员若为/.test(g.desc)) {
      // the rest: deployed only (character_target_inboard), or a row condition that only a deployed operator can meet;
      // the two copy traits (白面鸮 / 塞雷娅 "身前一格…") read the tile in front and are positional by nature
      assert.ok(key === 'character_target_inboard' || key === 'character_same_row', `${g.garrisonId}: ${key} — ${g.desc}`);
    }
  }
  // 拉普兰德 123, 调香师 81, 波登可 102, 琳琅诗怀雅 98 (若已激活【炎】/【投资人】) — normal and elite records
  assert.deepEqual(bench.sort(), ['garrison_102_a', 'garrison_102_b', 'garrison_123_a', 'garrison_123_b', 'garrison_81_a', 'garrison_81_b', 'garrison_98_a', 'garrison_98_b']);
  for (const id of ['garrison_80_a', 'garrison_80_b']) {
    const g = DATA.garrisons[id];
    assert.equal(g.bbStr.conditionkey, 'character_target_inboard', `${id} (赫默): deployed only`);
    assert.doesNotMatch(g.desc, /整备区/);
  }
  assert.equal(DATA.bonds.siracusaShip.countMode, 'BOARD', '叙拉古 counts deployed operators only');
  assert.equal(DATA.bonds.visiShip.countMode, 'BOARD_AND_DECK', '远见 also counts the 整备区');
});

test('拉普兰德 in the 整备区 with 3 different 叙拉古 deployed: +4 on her first manual refresh (+8 elite), whatever else holds', () => {
  const cases = {
    plain: () => {},
    'hand full (10/10)': (s) => s.fillHand(),
    'shop frozen': (s) => assert.deepEqual(s.m.handle('p_0', { t: 'g.freeze' }), OK),
    'a free refresh': (s) => { s.ps.shop.freeRefreshes = 1; },
    'a reward offer pending': (s) => { s.ps.offers.push({ source: 'merge', kind: 'chess', ids: [FILLER], tier: 2 }); },
    'a reconnect': (s) => { s.m.onDisconnect('p_0'); s.m.onReconnect('p_0'); },
  };
  for (const [name, before] of Object.entries(cases)) {
    for (const [id, n] of [[LAP, 4], [LAP_B, 8]]) {
      const s = setup();
      for (const x of [PROVENCE, TEXAS, SIYE]) s.deploy(x);
      give(s.m, s.ps, id, 'hand');
      before(s);
      assert.deepEqual(s.siracusa(), { active: true, count: 3 }, name);
      s.refresh();
      assert.equal(s.got.lap, n, `${name} ${id}`);
      s.refresh();
      assert.equal(s.got.lap, n, `${name}: once per round`);
      s.m.dispose();
    }
  }
  // a 机变 round (solo R6) and a bot seat (its own ps.refresh, bot.js) work the same
  const r6 = setup({ round: 6 });
  for (const x of [PROVENCE, TEXAS, SIYE]) r6.deploy(x);
  give(r6.m, r6.ps, LAP, 'hand');
  r6.refresh();
  assert.equal(r6.got.lap, 4, 'a 机变 round');
  r6.m.dispose();
  const bot = setup({ mode: 'coop', bots: 1, pid: 'ai_0' });
  for (const x of [PROVENCE, TEXAS, SIYE]) bot.deploy(x);
  give(bot.m, bot.ps, LAP, 'hand');
  assert.deepEqual(bot.ps.refresh(), OK);
  assert.equal(bot.got.lap, 4, 'a bot');
  bot.m.dispose();
});

test('拉普兰德 in the 整备区 is not one of the 3 叙拉古: inactive bond, nothing — and that refresh was her first of the round', () => {
  const s = setup();
  s.deploy(PROVENCE);
  s.deploy(TEXAS);
  const lap = give(s.m, s.ps, LAP, 'hand');
  assert.deepEqual(s.siracusa(), { active: false, count: 2 }, 'two 叙拉古 deployed: 2/3 (she sits in the 整备区)');
  s.refresh();
  assert.equal(s.got.lap, 0, '已激活的【叙拉古】: not active, no layers');
  s.place(lap);
  assert.deepEqual(s.siracusa(), { active: true, count: 3 }, 'deployed she is the third');
  s.refresh();
  assert.equal(s.got.lap, 0, '若为本回合首次主动刷新: her first refresh of the round was the inactive one');
  s.nextRound();
  s.refresh();
  assert.equal(s.got.lap, 4, 'the next round: her first refresh with 叙拉古 active');
  checkInvariants(s.m);
  s.m.dispose();
});

test('拉普兰德 in the 临时整备区: no layers there; once she is in the 整备区 her next refresh adds +4', () => {
  const s = setup();
  for (const x of [PROVENCE, TEXAS, SIYE]) s.deploy(x);
  s.fillHand();
  const lap = give(s.m, s.ps, LAP, 'temp');
  assert.equal(s.ps.find(lap.uid).area, 'temp');
  s.refresh();
  assert.equal(s.got.lap, 0, 'the 临时整备区 is not the 整备区');
  assert.deepEqual(s.m.handle('p_0', { t: 'g.sell', uid: s.ps.hand[0].uid }), OK); // a free slot pulls her in
  assert.equal(s.ps.find(lap.uid).area, 'hand');
  s.refresh();
  assert.equal(s.got.lap, 4, 'her first refresh in the 整备区');
  s.refresh();
  assert.equal(s.got.lap, 4, 'once');
  checkInvariants(s.m);
  s.m.dispose();
});

test('拉普兰德 bought after the round\'s first refresh, and a free refresh from 普罗旺斯: both stack (each copy counts its own refreshes)', () => {
  const s = setup();
  s.deploy(TEXAS);
  s.deploy(SIYE);
  give(s.m, s.ps, LAP, 'hand');
  const prov = s.buy(PROVENCE); // <获得时>获得1次免费刷新
  assert.equal(s.ps.shop.freeRefreshes, 1);
  s.place(prov);
  s.refresh(); // the free one is a manual refresh too
  assert.equal(s.ps.shop.freeRefreshes, 0);
  assert.equal(s.got.lap, 4);
  s.buy(LAP); // a second copy, bought after the round's first refresh, stays in the 整备区
  s.refresh();
  assert.equal(s.got.lap, 8, 'her own first refresh');
  s.m.dispose();
});

test('赫默: +2 / +4 at the round start only when deployed; in the 整备区 nothing even with 远见 active (character_target_inboard)', () => {
  for (const [id, where, partner, n] of [
    [SILENCE, 'board', 'hand', 2], [SILENCE, 'board', 'board', 2], [SILENCE_B, 'board', 'hand', 4],
    [SILENCE, 'hand', 'board', 0], [SILENCE, 'hand', 'hand', 0], [SILENCE_B, 'hand', 'board', 0],
  ]) {
    const s = setup();
    if (where === 'board') s.deploy(id); else give(s.m, s.ps, id, 'hand');
    if (partner === 'board') s.deploy(SWIRE); else give(s.m, s.ps, SWIRE, 'hand');
    assert.ok(s.ps.bonds.visiShip.active, '远见 counts the 整备区: active');
    s.nextRound();
    assert.equal(s.got.sil, n, `${id} ${where}, partner ${partner}`);
    assert.equal(s.ps.layers.visiShip || 0, n);
    s.m.dispose();
  }
});

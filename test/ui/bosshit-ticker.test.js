// Player report after 0.1.0, client part: "隐藏boss还没打就出了造成50%伤害播报". Besides the server's share (fixed in
// server/match/match/bossRounds.js, test/match/bosshit-ticker.test.js) the ticker strip plays its queue in order, TICKER_MS (5.2 s)
// per line and up to QUEUE_MAX (4) lines behind: in a headless-Chrome run the Final Assault's "超过20%" / "超过80%"
// lines played 2–8 s into the Hidden Core with its leader at 96 % / 53 %. A leader-damage line (BOSS_HIT) now plays
// only during the round it came in, and a player's newer BOSS_HIT line of the round supersedes their older one, queued
// or on screen (ui/ticker.js: tickerLineLive, tickerSupersedes, enqueueTickerLines, pruneTickerLines, nextTickerLine;
// main.js stamps each line with its type, player and round). The strip component is a thin shell over these helpers.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const { tickerLineLive, tickerSupersedes, enqueueTickerLines, pruneTickerLines, nextTickerLine } = await import('../../public/js/ui/ticker.js');

let ids = 0;
/** A BOSS_HIT line of `playerId` for threshold `pct` that came in during `round`. */
const hit = (playerId, pct, round) => ({ id: ++ids, type: 'BOSS_HIT', playerId, round, text: `${playerId}博士对敌方领袖造成的伤害超过${pct}%!` });
const line = (type, round, text = type) => ({ id: ++ids, type, playerId: null, round, text });
const texts = (q) => q.map((t) => t.text);

test('tickerLineLive: a BOSS_HIT line plays only in the round it came in; every other line always plays', () => {
  const fa = hit('P', 50, 14);
  assert.equal(tickerLineLive(fa, 14), true, 'during the Final Assault');
  assert.equal(tickerLineLive(fa, 15), false, 'the Hidden Core\'s round: the Final Assault\'s line is stale');
  assert.equal(tickerLineLive({ ...fa, round: 15 }, 15), true, 'the Hidden Core\'s own line');
  // solo FUNNY's boss round 9
  assert.equal(tickerLineLive({ ...fa, round: 9 }, 9), true);
  // other lines are not about the leader in play
  for (const type of ['SHOP_LEVEL', 'GOLDEN_CHAR', 'CHAR_DAMAGE', 'CHAR_GIFT', 'CUSTOM', null, undefined]) {
    assert.equal(tickerLineLive({ type, round: 14, text: 'x' }, 15), true, String(type));
  }
  // no round known (an old line, a reconnect before m.public): plays
  assert.equal(tickerLineLive({ type: 'BOSS_HIT', round: null }, 15), true);
  assert.equal(tickerLineLive(fa, null), true);
  assert.equal(tickerLineLive(null, 15), true);
});

test('round 14 → 15: the Final Assault\'s leader-damage lines leave the queue and the strip; other lines stay, in order', () => {
  const queue = [hit('A', 50, 14), line('GOLDEN_CHAR', 14, 'A博士的X干员晋升为精锐'), hit('B', 20, 14), hit('A', 80, 14), line('CUSTOM', 15, '隐秘核心已解锁')];
  // a Final Assault line on screen when the Hidden Core's round starts
  const r = pruneTickerLines(queue, hit('B', 50, 14), 15);
  assert.equal(r.dropCur, true, 'the Final Assault line on screen leaves');
  assert.deepEqual(texts(r.queue), ['A博士的X干员晋升为精锐', '隐秘核心已解锁']);
  const n = nextTickerLine(r.queue, 15);
  assert.equal(n.line.text, 'A博士的X干员晋升为精锐');
  assert.deepEqual(texts(n.queue), ['隐秘核心已解锁']);
  // a CUSTOM / CHAR_DAMAGE line on screen stays
  assert.equal(pruneTickerLines(queue, line('CUSTOM', 14), 15).dropCur, false);
  assert.equal(pruneTickerLines(queue, line('CHAR_DAMAGE', 14), 15).dropCur, false);
  assert.equal(pruneTickerLines(queue, null, 15).dropCur, false);
  // the same round (a field's prep → battle, a reconnect re-sending m.public): nothing leaves
  assert.equal(pruneTickerLines(queue, hit('B', 50, 14), 14).dropCur, false);
  assert.equal(pruneTickerLines(queue, null, 14).queue.length, queue.length);
  // the Hidden Core's own lines live in its round
  const hidden = pruneTickerLines([hit('A', 20, 15)], null, 15);
  assert.equal(hidden.queue.length, 1);
});

test('nextTickerLine skips stale leader-damage lines (the line timer firing after a round change)', () => {
  const queue = [hit('A', 20, 14), hit('B', 50, 14), line('SHOP_LEVEL', 14, 'B博士将调度中心等级提升为6级'), hit('A', 20, 15)];
  const a = nextTickerLine(queue, 15);
  assert.equal(a.line.text, 'B博士将调度中心等级提升为6级');
  const b = nextTickerLine(a.queue, 15);
  assert.equal(b.line.text, 'A博士对敌方领袖造成的伤害超过20%!');
  assert.equal(b.line.round, 15);
  assert.deepEqual(nextTickerLine(b.queue, 15), { line: null, queue: [] });
  assert.deepEqual(nextTickerLine([hit('A', 20, 14)], 15), { line: null, queue: [] }, 'only stale lines: nothing to show');
  // the queue passed in is not changed
  assert.equal(queue.length, 4);
});

test('a player\'s newer leader-damage line of the round supersedes their older one, on screen or queued', () => {
  assert.equal(tickerSupersedes(hit('A', 50, 14), hit('A', 20, 14)), true);
  assert.equal(tickerSupersedes(hit('A', 50, 14), hit('B', 20, 14)), false, 'another player');
  assert.equal(tickerSupersedes(hit('A', 20, 15), hit('A', 80, 14)), false, 'another round (the Hidden Core after the Final Assault)');
  assert.equal(tickerSupersedes(hit(null, 50, 14), hit(null, 20, 14)), false, 'player unknown');
  assert.equal(tickerSupersedes(line('CHAR_DAMAGE', 14), line('CHAR_DAMAGE', 14)), false, 'other line types queue as before');
  assert.equal(tickerSupersedes(hit('A', 50, 14), line('CUSTOM', 14)), false);

  // on screen: A's 20 % is replaced at once by A's 50 %, then 80 % (one batch)
  const a20 = hit('A', 20, 14);
  const onScreen = enqueueTickerLines([], a20, [hit('A', 50, 14), hit('A', 80, 14)]);
  assert.equal(onScreen.cur.text, 'A博士对敌方领袖造成的伤害超过80%!');
  assert.deepEqual(onScreen.queue, []);
  // queued: B's 20 % gives way to B's 50 %, which takes its turn at the back; other lines keep their order
  const shop = line('SHOP_LEVEL', 14, 'A博士将调度中心等级提升为6级');
  const queued = enqueueTickerLines([hit('B', 20, 14), shop], a20, [hit('B', 50, 14)]);
  assert.equal(queued.cur, a20, 'the line on screen is another player\'s: it stays');
  assert.deepEqual(texts(queued.queue), ['A博士将调度中心等级提升为6级', 'B博士对敌方领袖造成的伤害超过50%!']);
  // nothing on screen: lines queue (the strip then shows the first)
  const idle = enqueueTickerLines([], null, [hit('A', 20, 14), line('CUSTOM', 14, 'x')]);
  assert.equal(idle.cur, null);
  assert.equal(idle.queue.length, 2);
  // only the newest QUEUE_MAX (4) stay queued
  const many = enqueueTickerLines([], a20, [1, 2, 3, 4, 5, 6].map((i) => line('CUSTOM', 14, `c${i}`)));
  assert.deepEqual(texts(many.queue), ['c3', 'c4', 'c5', 'c6']);
});

/**
 * The strip's timeline, composed from the helpers the way ui/ticker.js composes them: each event is
 * { at (s), round } with `lines` arriving (stamped with that round) or a round change. Returns what is on screen when.
 */
function playStrip(events, until) {
  const TICKER_S = 5.2;
  let queue = [], cur = null, curUntil = Infinity, round = null;
  const shown = [];
  const show = (it, at) => { cur = it; curUntil = it ? at + TICKER_S : Infinity; if (it) shown.push({ at, round, text: it.text }); };
  const advance = (to) => {
    while (cur && curUntil <= to) { const at = curUntil; const n = nextTickerLine(queue, round); queue = n.queue; show(n.line, at); }
  };
  for (const ev of [...events, { at: until }]) {
    advance(ev.at);
    if (ev.round != null && ev.round !== round) {
      round = ev.round;
      const r = pruneTickerLines(queue, cur, round);
      queue = r.queue;
      if (r.dropCur) { const n = nextTickerLine(queue, round); queue = n.queue; show(n.line, ev.at); }
    }
    if (ev.lines) {
      const fresh = ev.lines.map((l) => ({ ...l, round }));
      const r = enqueueTickerLines(queue, cur, fresh);
      queue = r.queue;
      if (r.cur !== cur) show(r.cur, ev.at);
      else if (!cur) { const n = nextTickerLine(queue, round); queue = n.queue; show(n.line, ev.at); }
    }
  }
  return shown;
}

test('timeline: a Final Assault burst shows its top milestone before the round ends, and none of it plays over the Hidden Core', () => {
  // the reviewer's headless run: the Final Assault ends in a burst (20 → 50 → 80 % within 1.5 s), a shop-level line is
  // still queued, the Hidden Core's round starts 3 s later (SETTLE) with "隐秘核心已解锁"
  const shown = playStrip([
    { at: 0, round: 14, lines: [line('SHOP_LEVEL', null, 'B博士将调度中心等级提升为6级')] },
    { at: 1, round: 14, lines: [hit('A', 20)] },
    { at: 2, round: 14, lines: [hit('A', 50)] },
    { at: 2.5, round: 14, lines: [hit('A', 80)] },
    { at: 5.5, round: 15, lines: [line('CUSTOM', null, '隐秘核心已解锁')] },
    { at: 30, round: 15, lines: [hit('A', 20)] },
  ], 60);
  const r14 = shown.filter((s) => s.round === 14).map((s) => s.text);
  const r15 = shown.filter((s) => s.round === 15).map((s) => s.text);
  // the shop line plays first (0 – 5.2 s); A's lines collapse into the 80 % line, which plays at 5.2 s until the round change
  assert.deepEqual(r14, ['B博士将调度中心等级提升为6级', 'A博士对敌方领袖造成的伤害超过80%!']);
  assert.ok(!r15.some((t) => t.includes('超过80%') || t.includes('超过50%')), `no Final Assault line in the Hidden Core: ${r15.join(' | ')}`);
  assert.deepEqual(r15, ['隐秘核心已解锁', 'A博士对敌方领袖造成的伤害超过20%!']);
  assert.equal(shown.find((s) => s.text === '隐秘核心已解锁').at, 5.5, 'the Hidden Core\'s unlock line shows as its round starts');
});

test('lines queue by broadcast priority (research 06 §9.2 "The highest priority wins"), first in first out among equals; the lowest priority\'s oldest goes past QUEUE_MAX', () => {
  const P = { BOSS_HIT: 30, CHAR_DAMAGE: 20, SHOP_LEVEL: 11, GOLDEN_CHAR: 2, CHAR_GIFT: 1, CUSTOM: 0 };
  const pl = (type, text, priority = P[type]) => ({ type, round: 14, text, priority });
  const shop1 = pl('SHOP_LEVEL', 's1'), gold = pl('GOLDEN_CHAR', 'g'), shop2 = pl('SHOP_LEVEL', 's2');
  const boss = { ...hit('A', 20, 14), priority: 30 }, dmg = pl('CHAR_DAMAGE', 'd'), flow = pl('CUSTOM', '隐秘核心已解锁', 25);
  let r = enqueueTickerLines([], pl('CUSTOM', 'on screen'), [shop1, gold, shop2]);
  assert.deepEqual(texts(r.queue), ['s1', 's2', 'g']);
  r = enqueueTickerLines(r.queue, r.cur, [boss]);
  assert.equal(r.cur.text, 'on screen', 'the line on screen is never cut short');
  assert.deepEqual(texts(r.queue), [boss.text, 's1', 's2', 'g'], 'the leader-damage line jumps the queue');
  r = enqueueTickerLines(r.queue, r.cur, [dmg, flow]);
  assert.deepEqual(texts(r.queue), [boss.text, '隐秘核心已解锁', 'd', 's2'], 'flow notice under the leader line, then operator damage; past QUEUE_MAX the promotion line, then the older shop line go');
  // the superseding rule still holds under priorities
  r = enqueueTickerLines(r.queue, r.cur, [{ ...hit('A', 50, 14), priority: 30 }]);
  assert.deepEqual(texts(r.queue).slice(0, 2), ['A博士对敌方领袖造成的伤害超过50%!', '隐秘核心已解锁']);
  assert.equal(r.queue.filter((t) => t.type === 'BOSS_HIT').length, 1);
});

test('timeline with priorities: shop-level and promotion lines of the boss prep no longer hold the Final Assault\'s milestones until the round ends', () => {
  const pr = (o, priority) => ({ ...o, priority });
  const shown = playStrip([
    { at: 0, round: 14, lines: [pr(line('SHOP_LEVEL', null, 'B6'), 11), pr(line('SHOP_LEVEL', null, 'C6'), 11), pr(line('GOLDEN_CHAR', null, 'Bgold'), 2), pr(line('SHOP_LEVEL', null, 'D6'), 11)] },
    { at: 1, round: 14, lines: [pr(hit('A', 20), 30)] },
    { at: 4, round: 14, lines: [pr(hit('A', 50), 30)] },
    { at: 12, round: 15, lines: [pr(line('CUSTOM', null, '隐秘核心已解锁'), 25)] },
  ], 40);
  const r14 = shown.filter((s) => s.round === 14).map((s) => s.text);
  assert.deepEqual(r14, ['B6', 'A博士对敌方领袖造成的伤害超过50%!', 'C6'], `the milestone plays second (${r14.join(' | ')})`);
  assert.equal(shown.find((s) => s.text === '隐秘核心已解锁').round, 15);
});

test('main.js stamps every ticker line with its type, player and round; the strip is built on the helpers', () => {
  const main = readFileSync(new URL('../../public/js/main.js', import.meta.url), 'utf8');
  const handler = main.slice(main.indexOf("net.on('m.ticker'"), main.indexOf("net.on('m.emote'"));
  assert.match(handler, /type, playerId, round:\s*s\.match\?\.public\?\.round \?\? null, priority/, 'the m.ticker handler keeps type, player, round and priority');
  const strip = readFileSync(new URL('../../public/js/ui/ticker.js', import.meta.url), 'utf8');
  const comp = strip.slice(strip.indexOf('export function Ticker('));
  assert.match(comp, /useStore\(\(s\) => s\.match\?\.public\?\.round/, 'the strip follows m.public.round');
  for (const fn of ['enqueueTickerLines(', 'pruneTickerLines(', 'nextTickerLine(']) assert.ok(comp.includes(fn), `the strip uses ${fn})`);
  assert.match(comp, /\}, \[round\]\);/, 'a round change re-filters the queue and the line on screen');
});

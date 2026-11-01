// server/match/relics.js — 湮灭模拟 · 藏品 (collectibles): the draft schedule, the per-player relic state, the grants and
// their immediate effects, and the battle modifier object the sim reads (PlayerRound.battleInput -> relicMods).
//
// Rules (the owner's spec, 2026-10):
//   * opening: a random 1-of-3 NEGATIVE relic draft (any rarity), then one at the start of rounds 5, 9, 13, 17;
//   * rounds 5 and 9 draw only 青蓝 (blue) negatives, rounds 13 and 17 only 红色 (red) ones;
//   * one random POSITIVE relic at the start, then rounds 10 and 15.
// The draft is opened in the PREP (a modal overlay); Ready is refused while it is open, and the prep deadline picks one at
// random. Positives are granted outright (a reveal, no choice).
//
// Data: data/relics.json (merged by patch-data.mjs): { draft, relics: { id: {id,kind,tier,no,set,name,desc,icon,fx} }, order }.
// fx is the declarative modifier: enemy / enemyRank / ally / allyElite fractions, enemyAspd / enemyMove, price deltas,
// income, choiceIncome / bountyIncome, roundLp, deployCap, hand, lpCap, immediate {funds, lp, items}, and
// rule { id, ... } for the effects code handles.

import { ENDLESS_ESCALATION_STEP } from './gamedata.js';
// 确定性：AI 队友的投票必须由对局种子派生（server/sim/rng.js），否则同一个 seed 重放会投出不同的票 —— 而票决定
// 全队拿哪件藏品，直接改变整局结果。原 mod 用的是 Math.random。
import { createRng, deriveSeed } from '../sim/rng.js';

const STATE = new WeakMap();

export function relicState(ps) {
  let st = STATE.get(ps);
  if (!st) {
    st = { owned: [], draft: null, counters: {}, flags: {}, reveal: null, seq: 0 };
    STATE.set(ps, st);
    // the prep-side meta handler reads the same object through ctx.relics() (server/match/effectsMeta.js)
    try { ps.relics = st; } catch { /* a detached preview player */ }
  }
  return st;
}

/* ── 同盟湮灭：一件藏品全队共享（2026-10-20）─────────────────────────────────────────────────────────
 * In a co-op annihilation room the relics are the TEAM's: the room's creator opens the draft and rolls the
 * positives, every player sees the same animation, and the 3-of-1 negative is decided by a vote (a tie goes to
 * the creator). Each player still keeps the relic in its own `st.owned` so every existing effect (relicModsFor,
 * hasRelic, the codex …) works untouched — a grant just loops over the team.
 */
const isTeamMatch = (m) => !!(m && m.gd && m.gd.mode && m.gd.mode.type === 'MULTI');
const teamVoters = (m) => [...(m && m.players ? m.players.values() : [])].filter((p) => p && p.alive && !p.botControlled);
/**
 * 记下一票并检查是否投完（真人点卡 + AI 队友自动投都走这里）。
 * @param {any} m
 * @param {any} p
 * @param {number} idx
 */
export function castTeamVote(m, p, idx) {
  if (!isTeamMatch(m) || !p || !p.alive) return false;
  const team = teamRelicState(m);
  const draft = team.draft;
  if (!draft || !Number.isInteger(idx) || idx < 0 || idx >= draft.cards.length) return false;
  team.votes[p.playerId] = idx;
  const ballots = teamBallots(m);
  for (const q of ballots) { try { q.dirty(); } catch { /* best effort */ } }
  if (ballots.every((q) => Number.isInteger(team.votes[q.playerId]))) resolveTeamRelicDraft(m);
  return true;
}

/**
 * AI 队友也会投票（它们不领藏品，但票算数）：每个 bot 在 0.6~1.8 秒内随机选一张，
 * 这样「已投 x/y」会像真人一样陆续往上跳。
 */
export function scheduleBotVotes(m, draft) {
  if (!isTeamMatch(m) || !draft) return;
  const bots = teamBallots(m).filter((p) => p.botControlled);
  bots.forEach((bot, i) => {
    // A bot's pick is part of the run's outcome, so it must come from the match seed, not from the clock or Math.random
    // (the repo's determinism rule: the same seed replays the same draft). One rng per (seed, draft, bot): the delay and the
    // card index are drawn from it in a fixed order.
    const rng = createRng(deriveSeed(m.seed ?? m.roomCode ?? '', `relic:vote:${draft.cards.length}:${bot.seat ?? i}:${bot.playerId}`));
    const delay = 600 + i * 260 + Math.floor(rng() * 700);
    const timer = setTimeout(() => {
      try {
        const team = teamRelicState(m);
        if (team.draft !== draft || !bot.alive || Number.isInteger(team.votes[bot.playerId])) return;
        const idx = Math.floor(rng() * draft.cards.length);
        castTeamVote(m, bot, idx);
      } catch { /* the match may be over */ }
    }, delay);
    if (timer && typeof timer.unref === 'function') timer.unref();
  });
}
/** 投票人：真人 + AI 队友（AI 也会投一票，只是不领藏品）。 */
const teamBallots = (m) => {
  const all = [...(m && m.players ? m.players.values() : [])].filter((p) => p && p.alive);
  const humans = all.filter((p) => !p.botControlled);
  // 房间里只有创建者一个真人时，人机的票不参与 —— 创建者选哪张就是哪张，不会被 3 个人机盖过
  return humans.length <= 1 ? humans : all;
};
/** The team relic bookkeeping of one match (created lazily). */
export function teamRelicState(m) {
  if (!m.relicTeam) m.relicTeam = { draft: null, votes: {}, seq: 0, queue: [] };
  if (!Array.isArray(m.relicTeam.queue)) m.relicTeam.queue = [];
  return m.relicTeam;
}

/** Open the next queued grant (a round can hand out two: R1 positive + negative, R8 decision + positive …). */
function pumpTeamDrafts(m) {
  const team = teamRelicState(m);
  if (team.draft || !team.queue.length) return team.draft;
  const next = team.queue.shift();
  const ps = relicDrawerOf(m);
  if (!ps) return null;
  if (next.kind === 'positive') openTeamPositiveDraft(m, ps);
  else openNegativeDraft(m, ps, next.rarities || ['blue', 'red']);
  return team.draft;
}
/** Who draws: the room's creator while alive, else the first alive human. */
export function relicDrawerOf(m) {
  const alive = teamVoters(m);
  if (!alive.length) return null;
  return (m.hostId && alive.find((p) => p.playerId === m.hostId)) || alive[0];
}
/** Hand one relic to every player (co-op annihilation). The RECIPIENTS are every living seat, AI included — 长生者之证这类
 *  全队增益在 AI 身上也该生效（v3.2.0 的 relicRecipients）。抽卡权与投票权仍只归真人（teamVoters / teamBallots）。*/
const relicRecipients = (m) => [...(m && m.players ? m.players.values() : [])].filter((p) => p && p.alive);
function grantToTeam(m, id) {
  let first = null;
  for (const p of relicRecipients(m)) first = grantRelic(m, p, id) || first;
  return first;
}
/** 同盟湮灭: draw 3 positive relics and let the team vote for one (same flow as a negative draft). */
export function openTeamPositiveDraft(m, ps) {
  const d = relicData(m.gd);
  if (!d || !ps || !ps.alive) return null;
  const team = teamRelicState(m);
  if (team.draft) { team.queue.push({ kind: 'positive' }); return team.draft; }
  const seen = new Set();
  for (const p of teamVoters(m)) for (const id of relicState(p).owned) seen.add(id);
  const pool = (d.order && d.order.positive ? d.order.positive : Object.keys(d.relics))
    .map((id) => d.relics[id])
    .filter((r) => r && r.kind === 'positive' && !seen.has(r.id));
  if (!pool.length) return null;
  const cards = m.rngMeta.shuffle(pool).slice(0, Math.min(3, pool.length)).map((r) => r.id);
  const draft = { id: 'relic:' + m.nextUid(), round: m.round, kind: 'positive', rarities: [], cards, team: true, hostId: m.hostId || null };
  team.draft = draft;
  team.votes = {};
  for (const p of teamBallots(m)) { relicState(p).draft = draft; try { p.dirty(); } catch { /* best effort */ } }
  scheduleBotVotes(m, draft);
  return draft;
}

/**
 * Tally the votes and close the shared draft.
 *
 * Most votes wins. A TIE does not resolve by itself: the draft stays open with `tie` = the tied card indexes and only
 * the room's creator may settle it (`forcedIdx`, client dialog). `forcedIdx` also lets the creator break a tie on the
 * prep deadline. The result is announced to everyone as 同盟创建者「名字」选择了「藏品」.
 * @param {any} m
 * @param {number} [forcedIdx] the creator's tie-break pick
 */
export function resolveTeamRelicDraft(m, forcedIdx, auto = false) {
  const team = teamRelicState(m);
  const draft = team.draft;
  if (!draft) return null;
  const alive = teamBallots(m);
  const counts = draft.cards.map(() => 0);
  for (const p of alive) {
    const v = team.votes[p.playerId];
    if (Number.isInteger(v) && v >= 0 && v < counts.length) counts[v]++;
  }
  let best = 0;
  for (let i = 1; i < counts.length; i++) if (counts[i] > counts[best]) best = i;
  const tied = counts.map((c, i) => (c === counts[best] ? i : -1)).filter((i) => i >= 0);
  let byCreator = false;
  if (Number.isInteger(forcedIdx) && forcedIdx >= 0 && forcedIdx < draft.cards.length) {
    best = forcedIdx;
    byCreator = tied.length > 1;
  } else if (tied.length > 1) {
    // A tie waits for the drawer (平票). A TIMEOUT (auto) resolves it at random instead — otherwise the draft hangs
    // forever once nobody clicks and every later draw queues behind it (v3.2.0).
    if (auto) {
      best = tied[Math.min(tied.length - 1, Math.floor(m.rngMeta() * tied.length))];
    } else {
      draft.tie = tied.slice();
      for (const p of alive) { try { p.dirty(); } catch { /* best effort */ } }
      return null;
    }
  }
  const id = draft.cards[best];
  const positive = draft.kind === 'positive';
  team.draft = null;
  team.votes = {};
  for (const p of alive) {
    const st = relicState(p);
    if (st.draft === draft) st.draft = null;
  }
  grantToTeam(m, id);
  const def = relicDef(m.gd, id);
  const drawer = relicDrawerOf(m);
  const who = (drawer && drawer.name) || '创建者';
  const what = (def && def.name) || id;
  for (const p of alive) {
    // a positive picked by a vote needs no second slot machine: drop the 收下 wait so .rlpos never pops up again
    if (positive) p.pendingRelicToast = null;
    try { m.toast(p, 'info', '同盟创建者「' + who + '」选择了「' + what + '」'); } catch { /* best effort */ }
    try { p.dirty(); } catch { /* best effort */ }
  }
  pumpTeamDrafts(m);
  return { id, idx: best, counts, byCreator, positive };
}

export function relicData(gd) {
  const d = gd && gd.raw && gd.raw.relics;
  return d && d.relics && typeof d.relics === 'object' ? d : null;
}

export function relicDef(gd, id) {
  const d = relicData(gd);
  return d && typeof id === 'string' && Object.hasOwn(d.relics, id) ? d.relics[id] : null;
}

export function ownedRelics(ps) {
  const d = relicData(ps.gd);
  if (!d) return [];
  return relicState(ps).owned.map((id) => d.relics[id]).filter(Boolean);
}

export function hasRelic(ps, id) {
  return relicState(ps).owned.includes(id);
}

export function relicDraft(ps) {
  return relicState(ps).draft;
}

export function openNegativeDraft(m, ps, rarities = ['blue', 'red']) {
  const d = relicData(m.gd);
  if (!d || !ps || !ps.alive) return null;
  // co-op annihilation: the whole team drafts together — the creator opens it, everyone votes
  if (isTeamMatch(m)) {
    const team = teamRelicState(m);
    if (team.draft) { team.queue.push({ kind: 'negative', rarities: rarities ? rarities.slice() : null }); return team.draft; }
    const seen = new Set();
    for (const p of teamVoters(m)) for (const id of relicState(p).owned) seen.add(id);
    const pool = (d.order && d.order.negative ? d.order.negative : Object.keys(d.relics))
      .map((id) => d.relics[id])
      .filter((r) => r && r.kind === 'negative' && (!rarities || rarities.includes(r.tier)) && !seen.has(r.id));
    if (!pool.length) return null;
    const cards = m.rngMeta.shuffle(pool).slice(0, Math.min(3, pool.length)).map((r) => r.id);
    const draft = { id: 'relic:' + m.nextUid(), round: m.round, kind: 'negative', rarities: rarities.slice(), cards, team: true, hostId: m.hostId || null };
    team.draft = draft;
    team.votes = {};
    for (const p of teamBallots(m)) { relicState(p).draft = draft; try { p.dirty(); } catch { /* best effort */ } }
    scheduleBotVotes(m, draft);
    return draft;
  }
  const st = relicState(ps);
  if (st.draft) return st.draft;
  const pool = (d.order && d.order.negative ? d.order.negative : Object.keys(d.relics))
    .map((id) => d.relics[id])
    .filter((r) => r && r.kind === 'negative' && (!rarities || rarities.includes(r.tier)) && !st.owned.includes(r.id));
  if (!pool.length) return null;
  const cards = m.rngMeta.shuffle(pool).slice(0, Math.min(3, pool.length)).map((r) => r.id);
  st.draft = { id: 'relic:' + m.nextUid(), round: m.round, kind: 'negative', rarities: rarities.slice(), cards };
  ps.dirty();
  return st.draft;
}

export function grantRelic(m, ps, id, { announce = true } = {}) {
  const d = relicData(m.gd);
  const def = relicDef(m.gd, id);
  if (!d || !def || !ps || !ps.alive) return null;
  const st = relicState(ps);
  if (st.owned.includes(id)) return null;
  st.owned.push(id);
  st.acquired = st.acquired || {};
  st.acquired[id] = m.round;
  st.seq++;
  st.reveal = { id, seq: st.seq };
  applyImmediate(m, ps, def);
  const e = { id: 'relic:' + id, key: 'relic:' + id, name: def.name, desc: def.desc, iconKind: 'choice', iconId: id, battle: false, hidden: true, params: { relic: id } };
  const existing = ps.effects.find((x) => x.id === e.id);
  if (existing) Object.assign(existing, e); else ps.effects.push(e);
  if (announce !== false) {
    try {
      // 增益藏品先弹抽取界面；提示延迟到玩家在抽取结果里点“收下”（g.relicSeen）之后
    if (def.kind === 'positive') ps.pendingRelicToast = def.name;
    else m.toast(ps, 'info', '获得负面藏品：' + def.name);
    } catch { /* toast is best-effort */ }
  }
  ps.dirty();
  return def;
}

function applyImmediate(m, ps, def) {
  const fx = def.fx && typeof def.fx === 'object' ? def.fx : {};
  const st = relicState(ps);
  const im = fx.immediate && typeof fx.immediate === 'object' ? fx.immediate : null;
  if (im) {
    if (Number.isFinite(im.funds) && im.funds) ps.addFunds(Math.trunc(im.funds), { reason: 'relic' });
    if (Number.isFinite(im.lp) && im.lp) ps.lp = Math.max(1, ps.lp + Math.trunc(im.lp));
    if (Array.isArray(im.items)) for (const itemId of im.items) { try { ps.acquireItem(itemId, { source: 'relic' }); } catch { /* pool/data guard */ } }
  }
  if (Number.isFinite(fx.deployCap) && fx.deployCap) ps.deployCapBonus += Math.trunc(fx.deployCap);
  if (Number.isFinite(fx.hand) && fx.hand) resizeHand(ps, Math.trunc(fx.hand));
  if (Number.isFinite(fx.lpCap) && fx.lpCap) ps.lp = Math.max(1, ps.lp + Math.trunc(fx.lpCap));
  const rule = fx.rule && typeof fx.rule === 'object' ? fx.rule : null;
  if (rule) {
    if (rule.id === 'loseAllFunds') { ps.funds = 0; st.flags.bountyMul = Number(rule.bountyMul) || 0.5; }
    if (rule.id === 'probe') st.flags.probeDebt = (st.flags.probeDebt || 0) + 1;
    if (rule.id === 'removeTemp') { st.flags.tempDisabled = true; ps.temp.length = 0; if (ps._tempDue) ps._tempDue.clear(); }
    if (rule.id === 'fundsDrain') st.flags.fundsDrainLeft = Number(rule.max) || 5;
  }
  if (fx.price && Number.isFinite(fx.price.upgrade)) ps.shop.upgradePrice += Math.trunc(fx.price.upgrade);
}

export function resizeHand(ps, delta) {
  const next = Math.max(1, ps.hand.length + delta);
  if (next === ps.hand.length) return;
  if (next < ps.hand.length) {
    for (let i = next; i < ps.hand.length; i++) {
      const p = ps.hand[i];
      if (!p) continue;
      ps.hand[i] = null;
      if (!ps.stow(p, { allowTemp: true })) {
        if (p.kind === 'chess') ps.returnCopies(p);
        else if (p.kind === 'item') ps.releaseItemStock(p);
      }
    }
    ps.hand.length = next;
  } else {
    while (ps.hand.length < next) ps.hand.push(null);
  }
  ps.dirty();
}

export function grantRandomPositive(m, ps) {
  const d = relicData(m.gd);
  if (!d) return null;
  // 同盟湮灭: a positive is a 3-card vote exactly like a negative (creator draws, everyone votes) — solo keeps the
  // single random relic
  if (isTeamMatch(m)) return openTeamPositiveDraft(m, ps);
  const st = relicState(ps);
  const pool = (d.order && d.order.positive ? d.order.positive : Object.keys(d.relics))
    .map((id) => d.relics[id])
    .filter((r) => r && r.kind === 'positive' && !st.owned.includes(r.id));
  if (!pool.length) return null;
  const pick = m.rngMeta.pick(pool);
  return pick ? grantRelic(m, ps, pick.id) : null;
}

export function flushRelicToast(ps) {
  const name = ps && ps.pendingRelicToast;
  if (!name) return;
  ps.pendingRelicToast = null;
  try { ps.m.toast(ps, 'info', '获得增益藏品：' + name); } catch { /* best effort */ }
  // co-op annihilation: everyone watched the same draw, so one 收下 closes it for the team
  if (ps.m && isTeamMatch(ps.m)) {
    for (const p of teamVoters(ps.m)) {
      if (p.pendingRelicToast) { p.pendingRelicToast = null; try { p.dirty(); } catch { /* best effort */ } }
    }
  }
}

export function raritiesForRound(cfg, round) {
  const blueUntil = Number(cfg.blueUntilRound) || 10;
  // 前 10 回合只出青蓝级；后 20 回合（11~30）只出红色级；无尽 30 回合之后各档随机
  if (round <= blueUntil) return ['blue'];
  if (round <= 30) return ['red'];
  return ['blue', 'red'];
}


/**
 * 蚀流 6 · 无尽湮灭 — the relic schedule of the endless run:
 *   * a 3-choose-1 negative draft every 2 rounds (R3, R5, R7 … forever, 蚀流 4's cadence without an end);
 *   * a random positive relic at the opening (R1) and at R10 / R15 / R20 / R25 (蚀流 5's table);
 *   * one more random positive relic at every even decision round R8 … R28 the owner named, then every 4th round
 *     (R32, R36, R40 …) — "此后每4个回合给一次决策和增益藏品";
 *   * once the catalogue is exhausted (nothing left to grant) every decision instead escalates the run: +20 % ally ATK
 *     and HP, +20 % enemy HP / ATK / DEF, compounding — see applyEndlessEscalation / relicModsFor.
 */
const ENDLESS_POSITIVE_DECISIONS = Object.freeze([8, 12, 14, 16, 18, 20, 22, 24, 26, 28]);
const ENDLESS_POSITIVE_LATER_EVERY = 4;

/** The relics the catalogue holds (every relic id in data/relics.json). */
export function relicCatalogSize(d) {
  return d && d.relics && typeof d.relics === 'object' ? Object.keys(d.relics).length : 0;
}

/**
 * True when nothing can be handed out any more — the endless escalation takes over from then on.
 *
 * "Nothing" is judged by what is still REACHABLE, not by the raw count: a negative draft only offers 青蓝级 up to
 * `draft.blueUntilRound` (10) and only 红色级 after it, so the 14 青蓝 negatives a player did not draw inside that window
 * can never be obtained. With the raw count (`owned.length >= total`) the escalation would never fire in 无尽湮灭,
 * where the 3-choose-1 runs every 2 rounds and 红色级 is the only tier past the window.
 * @param {object} d data/relics.json
 * @param {object} st the player's relic state
 * @param {number} [round] the round the decision is at
 */
export function relicCatalogExhausted(d, st, round) {
  const total = relicCatalogSize(d);
  if (!total) return false;
  if (st.owned.length >= total) return true;                 // the whole catalogue, blue tiers included
  const left = (kind, tier) => Object.values(d.relics).some((x) => x
    && x.kind === kind && (!tier || x.tier === tier) && !st.owned.includes(x.id));
  const cfg = d.draft && typeof d.draft === 'object' ? d.draft : {};
  const blueUntil = Number.isFinite(cfg.blueUntilRound) && cfg.blueUntilRound > 0 ? cfg.blueUntilRound : 10;
  const bluesClosed = Number(round) > blueUntil;              // past the window only 红色级 negatives can still be drafted
  return !left('positive') && !left('negative', bluesClosed ? 'red' : null);
}

/** 无尽湮灭: the escalation stacks a player carries (0 for every other ladder level). */
export function endlessEscalationOf(ps) {
  const gd = ps && ps.gd;
  if (!gd || !gd.endless) return 0;
  const n = Number(relicState(ps).counters.endlessEscalation) || 0;
  return n > 0 ? Math.floor(n) : 0;
}

/** 无尽湮灭: +1 escalation stack — ally ATK/HP and enemy HP/ATK/DEF, applied by relicModsFor. */
export function applyEndlessEscalation(m, ps) {
  const st = relicState(ps);
  st.counters.endlessEscalation = Math.max(0, Math.floor(Number(st.counters.endlessEscalation) || 0)) + 1;
  st.seq++;
  ps.dirty();
  try { m.toast(ps, 'warn', '藏品已尽：无尽湮灭加深（第 ' + st.counters.endlessEscalation + ' 层）'); } catch { /* best effort */ }
  return st.counters.endlessEscalation;
}

export function relicPrepStart(m, ps) {
  const d = relicData(m.gd);
  if (!d || !ps || !ps.alive) return;
  const cfg = d.draft && typeof d.draft === 'object' ? d.draft : {};
  const ero = Math.max(1, Number(m.gd && m.gd.erosion) || 1);
  // 湮灭蚀流 1: no collectibles at all (they arrive with 蚀流 2)
  if (ero <= 1) return;
  const r = m.round;
  const st = relicState(ps);
  st.counters.paidRefreshes = 0;
  // n06 莱塔尼亚权杖（重铸）: 进入休整期时目标生命 -n（最低 1）。relicModsFor 里那条 case 一直是空的，
  // 这条负面从未生效；它按玩家算，所以必须在「同盟房只让创建者抽」的早退之前（v3.2.0 同口径）。
  for (const id of st.owned) {
    const def = d.relics ? d.relics[id] : null;
    const rule = def && def.fx && def.fx.rule;
    if (rule && rule.id === 'lpDrainRest') {
      const n = Math.max(1, Math.trunc(Number(rule.n) || 1));
      ps.lp = Math.max(1, (Number(ps.lp) || 0) - n);
    }
  }
  if (st.flags.probeDebt > 0) {
    st.flags.probeDebt--;
    ps.addFunds(-1, { reason: 'relic' });
  }
  // co-op annihilation: one roll for the whole team, made by the creator
  if (isTeamMatch(m)) {
    const drawer = relicDrawerOf(m);
    if (!drawer || drawer.playerId !== ps.playerId) return;
  }
  const endless = m.gd && m.gd.endless === true;
  // 蚀流 4/5: a negative draft every 2 rounds; 蚀流 5 runs to R30 and adds the later positive grants.
  // 无尽湮灭: the same 2-round cadence, with no end at all.
  const negRounds = endless
    ? null
    : ero >= 4
      ? Array.from({ length: ((ero >= 5 ? 29 : 17) - 3) / 2 + 1 }, (_, i) => 3 + i * 2)
      : (Array.isArray(cfg.negativeRounds) ? cfg.negativeRounds : []);
  const posRounds = ero >= 5 ? [1, 10, 15, 20, 25] : (Array.isArray(cfg.positiveRounds) ? cfg.positiveRounds : []);
  // 蚀流4/5: the decisions at rounds 8, 12, 16, 20, 24, 28 each also hand out a random positive relic (无尽湮灭 has its
  // own, wider list below — never both, or R8/12/16/20/24/28 would hand out two at once)
  const decisionBonus = !endless && ero >= 4 && [8, 12, 16, 20, 24, 28].includes(r);
  // 无尽湮灭: the owner's list R8 … R28, then one every ENDLESS_POSITIVE_LATER_EVERY rounds (R32, R36, R40 …)
  const endlessBonus = endless && r > 28 && r % ENDLESS_POSITIVE_LATER_EVERY === 0;
  const negativeRound = endless ? r >= 3 && r % 2 === 1 : negRounds.includes(r);
  // The colour window is the SAME in 无尽湮灭 as in 蚀流 2~5 (the owner's rule, 2026-10-20): 青蓝级 only while
  // round <= draft.blueUntilRound (10), 红色级 after it. relicCatalogExhausted accounts for the 青蓝 ones that window
  // leaves behind, so the fallback still starts once the 红色级 run is out.
  const draftRarities = raritiesForRound(cfg, r);
  if (r === 1) {
    grantRandomPositive(m, ps);
    openNegativeDraft(m, ps, draftRarities);
  } else {
    if (negativeRound) openNegativeDraft(m, ps, draftRarities);
    if (posRounds.includes(r)) grantRandomPositive(m, ps);
  }
  if (decisionBonus) grantRandomPositive(m, ps);
  if (endless && ENDLESS_POSITIVE_DECISIONS.includes(r)) grantRandomPositive(m, ps);
  if (endlessBonus) grantRandomPositive(m, ps);
  // 无尽湮灭: nothing left to hand out ⇒ every decision escalates instead (the catalogue's end, not 蚀流 4's)
  if (endless && m.gd.isSpRound && m.gd.isSpRound(r) && relicCatalogExhausted(d, st, r)) applyEndlessEscalation(m, ps);
  if (st.draft && ps.botControlled) autoPickRelic(m, ps);
}

/**
 * 同盟湮灭：抽卡必须由创建者点「开始抽取」才启动 —— 点之前所有人只看到待机的转轮。
 * 只认创建者；对非同盟房 / 没有草稿 / 已经转过的情况一律返回 false。
 * @param {any} m
 * @param {any} ps
 */
export function startRelicSpin(m, ps) {
  if (!isTeamMatch(m) || !ps || !ps.alive) return false;
  const team = teamRelicState(m);
  const draft = team.draft;
  if (!draft) return false;
  // 房主被淘汰后抽卡不能永久卡死：能点「开始抽取」的是 relicDrawerOf（房主不在时交给第一个仍在的真人）
  const drawer = relicDrawerOf(m);
  if (!drawer || ps.playerId !== drawer.playerId) return false;
  if (draft.spinning) return true;
  draft.spinning = true;
  for (const p of teamBallots(m)) { try { p.dirty(); } catch { /* best effort */ } }
  return true;
}
export function pickRelic(m, ps, idx) {
  const st = relicState(ps);
  const draft = st.draft;
  if (!draft) return { error: 'NO_DRAFT' };
  if (!Number.isInteger(idx) || idx < 0 || idx >= draft.cards.length) return { error: 'BAD_TARGET' };
  // co-op annihilation: the pick is a vote; once everyone alive has voted the draft closes
  if (isTeamMatch(m) && draft.team) {
    const team = teamRelicState(m);
    if (team.draft !== draft) return { error: 'NO_DRAFT' };
    // a tie is settled by the drawer alone: their click IS the decision, not a vote
    if (Array.isArray(draft.tie) && draft.tie.length) {
      const drawer = relicDrawerOf(m);
      if (!drawer || drawer.playerId !== ps.playerId) return { error: 'BAD_TARGET', detail: 'only the creator settles a tie' };
      if (!draft.tie.includes(idx)) return { error: 'BAD_TARGET', detail: 'pick one of the tied cards' };
      resolveTeamRelicDraft(m, idx);
      return { ok: true, tieBreak: idx };
    }
    castTeamVote(m, ps, idx);
    return { ok: true, vote: idx };
  }
  // 单人（以及任何非队伍草稿）：点了就直接入账
  const id = draft.cards[idx];
  st.draft = null;
  grantRelic(m, ps, id);
  return { ok: true, id };
}

export function autoPickRelic(m, ps) {
  if (isTeamMatch(m) && teamRelicState(m).draft) return resolveTeamRelicDraft(m, undefined, true);
  const st = relicState(ps);
  const draft = st.draft;
  if (!draft || !draft.cards.length) return null;
  const idx = Math.floor(m.rngMeta() * draft.cards.length);
  st.draft = null;
  const id = draft.cards[Math.min(draft.cards.length - 1, idx)];
  grantRelic(m, ps, id);
  return id;
}

export function relicRoundStart(m, ps) {
  const d = relicData(m.gd);
  if (!d || !ps || !ps.alive) return;
  const st = relicState(ps);
  st.reveal = null;
  st.counters.refundRound = 0;
  if (st.flags.fundsDrainLeft > 0) {
    st.flags.fundsDrainLeft--;
    ps.addFunds(-1, { reason: 'relic' });
  }
  // 长生者之证: +N 临时生命 at every round start (p05, roundLp 5)
  for (const id of st.owned) {
    const def = d.relics[id];
    const lp = def && def.fx && Number(def.fx.roundLp);
    if (Number.isFinite(lp) && lp) ps.lp = Math.max(1, ps.lp + Math.trunc(lp));
  }
  st.counters.ussuriRounds = (st.counters.ussuriRounds || 0) + 1;
  if (st.owned.includes('n38')) st.counters.probeStacks = Math.floor(m.round / 2);
  if (st.owned.includes('p27')) {
    if (ps.stats.lpLost === st.counters.lpLostSeen) st.counters.noLossStreak = (st.counters.noLossStreak || 0) + 1;
    else st.counters.noLossStreak = 0;
    st.counters.lpLostSeen = ps.stats.lpLost;
  }
  if (st.owned.includes('p34')) st.counters.atkRoundStacks = Math.min(10, (st.counters.atkRoundStacks || 0) + 1);
  // 似曾相识棋盒 (p41): 「进入下一回合时」— one recruitment on the first round after acquisition, not every round.
  if (st.owned.includes('p41') && !st.flags.p41Recruited && m.round > (st.acquired.p41 || 1)) {
    try {
      const active = Object.entries(ps.bonds || {}).filter(([, b]) => b && b.active);
      const maxLayers = active.reduce((n, [, b]) => Math.max(n, Number(b.layers) || 0), 0);
      const topBonds = active.filter(([, b]) => (Number(b.layers) || 0) === maxLayers).map(([id]) => id);
      const members = (m.gd.visibleChess || []).filter((id) => {
        const c = m.gd.chess(id);
        return !!(c && Array.isArray(c.bonds) && c.bonds.some((b) => topBonds.includes(b)));
      });
      if (maxLayers > 0 && members.length) {
        st.flags.p41Recruited = true;
        ps.acquireChess(members[Math.floor(m.rngMeta() * members.length)], { source: 'relic' });
      }
    } catch { /* a missing member pool must not break the round */ }
  }
}


export function relicModsFor(ps) {
  const d = relicData(ps.gd);
  if (!d) return null;
  const st = relicState(ps);
  // 无尽湮灭: the decision escalation keeps biting with no relic left (and with none owned at all)
  const escalation = endlessEscalationOf(ps);
  if (!st.owned.length && !escalation) return null;
  const mods = {
    ally: { atk: 0, def: 0, hp: 0, aspd: 0, resFlat: 0, dmgDealt: 0, spRegen: 0 },
    allyElite: { atk: 0, def: 0, hp: 0, aspd: 0 },
    enemy: { atk: 0, def: 0, hp: 0, aspd: 0, res: 0, move: 0 },
    enemyElite: { atk: 0, def: 0, hp: 0, aspd: 0, res: 0, move: 0 },
    enemyBoss: { atk: 0, def: 0, hp: 0, aspd: 0, res: 0, move: 0 },
    rules: {},
    counts: {},
  };
  // 负面藏品对敌方的生命/攻击/防御/移动速度：独立乘区（逐条相乘）
  const emul = { hp: 1, atk: 1, def: 1, move: 1 };
  const round = ps.m.round;
  const bondsActive = Object.values(ps.bonds || {}).filter((b) => b && b.active).length;
  const gold = ps.stats.gold || 0;
  const eliteCount = countElite(ps);
  const equipCount = countEquipped(ps);
  const benchItems = (ps.hand || []).filter((p) => p && p.kind === 'item').length;
  const negativeCount = st.owned.filter((id) => d.relics[id] && d.relics[id].kind === 'negative').length;
  const perfects = ps.stats.perfectRounds || 0;
  const counts = mods.counts;
  counts.negative = negativeCount; counts.bonds = bondsActive; counts.elite = eliteCount; counts.equipment = equipCount;
  counts.benchItems = benchItems; counts.perfects = perfects; counts.round = round; counts.spent = gold;
  counts.tier4Buys = st.counters.tier4Buys || 0; counts.eliteMerges = st.counters.eliteMerges || 0;
  counts.noLossStreak = st.counters.noLossStreak || 0; counts.bountyKills = st.counters.bountyKills || 0;

  const addEnemy = (tgt, fx) => {
    for (const k of ['atk', 'def', 'hp', 'res', 'move']) if (Number.isFinite(fx[k])) tgt[k] += fx[k];
    if (Number.isFinite(fx.aspd)) tgt.aspd += fx.aspd;
  };
  for (const id of st.owned) {
    const def = d.relics[id];
    if (!def || !def.fx) continue;
    const fx = def.fx;
    if (fx.ally) for (const k of ['atk', 'def', 'hp', 'aspd', 'resFlat', 'dmgDealt']) if (Number.isFinite(fx.ally[k])) mods.ally[k] += fx.ally[k];
    // 待部署区每有一名干员 → 全体生命/攻击 +x%（琥珀伤痕）
    if (fx.allyPerBench) {
      const n = ps.hand.filter((p) => p && p.kind === 'chess').length;
      const cap = Number.isFinite(fx.allyPerBench.max) ? fx.allyPerBench.max : 99;
      const hp = Math.min(cap, (Number(fx.allyPerBench.hp) || 0) * n);
      const atk = Math.min(cap, (Number(fx.allyPerBench.atk) || 0) * n);
      mods.ally.hp += hp;
      mods.ally.atk += atk;
    }
    if (fx.allyElite) for (const k of ['atk', 'def', 'hp', 'aspd']) if (Number.isFinite(fx.allyElite[k])) mods.allyElite[k] += fx.allyElite[k];
    if (fx.enemy) {
      const rest = { ...fx.enemy };
      for (const k of ['hp', 'atk', 'def', 'move']) if (Number.isFinite(rest[k])) { emul[k] *= 1 + rest[k]; delete rest[k]; }
      addEnemy(mods.enemy, rest);
    }
    if (fx.enemyRank) {
      if (fx.enemyRank.ELITE) addEnemy(mods.enemyElite, fx.enemyRank.ELITE);
      if (fx.enemyRank.BOSS) addEnemy(mods.enemyBoss, fx.enemyRank.BOSS);
    }
    if (Number.isFinite(fx.enemyAspd)) mods.enemy.aspd += fx.enemyAspd;
    if (Number.isFinite(fx.enemyMove)) emul.move *= 1 + (fx.enemyMove);
    const rule = fx.rule;
    if (!rule || typeof rule !== 'object') continue;
    switch (rule.id) {
      case 'ussuri': {
        const base = fx.enemy && Number.isFinite(fx.enemy.atk) ? fx.enemy.atk : 0.35;
        const eff = Math.max(rule.min || 0.35, base + (rule.step || 0.1) * Math.max(0, st.counters.ussuriRounds || 0) - (rule.drop || 0.05) * ((st.counters.bountyDone || 0) + perfects));
        emul.atk *= 1 + (eff - base); emul.def *= 1 + (eff - base); emul.hp *= 1 + (eff - base);
        break;
      }
      case 'leaderHalve':
        if (bondsActive >= (rule.bonds || 4)) { mods.enemyBoss.atk -= 0.1; mods.enemyBoss.def -= 0.1; mods.enemyBoss.hp -= 0.25; }
        break;
      case 'lpDrainRest':
        break;
      case 'spLowLp':
        if (ps.lp < 10) mods.ally.spRegen += rule.spLowLp && Number.isFinite(rule.spLowLp.pct) ? rule.spLowLp.pct : -0.2;
        break;
      case 'probe':
        emul.atk *= 1 + ((rule.atk || 0.1) * (st.counters.probeStacks || 0));
        emul.hp *= 1 + ((rule.hp || 0.1) * Math.floor(Math.max(0, round - (st.acquired && st.acquired[id] ? st.acquired[id] : 1)) / 2));
        break;
      case 'spOnDeploy': mods.rules.spOnDeploy = rule.n || -15; break;
      case 'spInit': mods.rules.spInit = rule.n || -10; break;
      case 'openingDebuff': mods.rules.openingDebuff = { count: rule.count || 5 }; break;
      case 'neuralDps': mods.rules.neuralDps = rule.n || 10; break;
      case 'startDebuff': mods.rules.startDebuff = { atkPct: rule.atkPct || 0, aspd: rule.aspd || 0, spRegen: rule.spRegen || 0, dur: rule.dur || 10 }; break;
      case 'stunOnDeploy': mods.rules.stunOnDeploy = { count: rule.count || 1, perRound: rule.perRound || 0, max: rule.max || 4, dur: rule.dur || 10, redeployDur: Number.isFinite(rule.redeployDur) ? rule.redeployDur : 5, fromRound: st.acquired && Number.isInteger(st.acquired[id]) ? st.acquired[id] : round }; break;
      case 'fogOnDeploy': mods.rules.fogOnDeploy = { dur: rule.dur || 60, ratio: rule.ratio || 0.02 }; break;
      case 'enemyRamp': mods.rules.enemyRamp = { every: rule.every || 10, step: rule.step || 0.1, max: rule.max || 0.5 }; break;
      case 'enemyDefShred': mods.rules.enemyDefShred = { flat: rule.flat || 3000, perHit: rule.perHit || -100, max: rule.max || 30 }; break;
      case 'spawnHpChance': mods.rules.spawnHpChance = { p: rule.p || 0.03, extra: rule.extra || 0.99 }; break;
      case 'eliteDmgReduce': mods.rules.eliteDmgReduce = { mul: rule.mul || 0.5, dur: rule.dur || 30 }; break;
      case 'shelter': mods.rules.shelter = { base: rule.base || 0, low: rule.low || 0, threshold: rule.threshold || 0.5 }; break;
      case 'shelterOnDebuff': mods.rules.shelterOnDebuff = { mul: rule.mul || 0.35, ignore: rule.ignore || 0.35 }; break;
      case 'camoRanged': mods.rules.camoRanged = true; break;
      // 犬植浆 p40: "干员攻击范围内的其他干员获得迷彩，攻击力+10%（可叠加）" — the battle half (sim/content/relics.js) counts the
      // covering operators per ally; without this case the rule never reached the sim and the whole relic did nothing
      case 'camoAura': mods.rules.camoAura = { atk: Number.isFinite(rule.atk) ? rule.atk : 0.1 }; break;
      case 'atkPerBond': mods.ally.atk += (rule.per || 0.1) * bondsActive; break;
      case 'aspdPerNeighbor': mods.rules.aspdPerNeighbor = rule.per || 30; break;
      case 'atkPerNeighbor': mods.rules.atkPerNeighbor = rule.per || 0.2; break;
      case 'atkAfterSkill': mods.rules.atkAfterSkill = { window: rule.window || 1, mul: rule.mul || 1.04 }; break;
      case 'hpIfDp': mods.rules.hpIfDp = { dp: rule.dp || 50, hp: rule.hp || 1.5 }; break;
      case 'dmgDealt': mods.ally.dmgDealt += Number.isFinite(rule.phys) ? rule.phys : 0.5; break;
      case 'enemyDmgTaken': mods.rules.enemyDmgTaken = { phys: rule.phys || 0.2, arts: rule.arts || 0.2 }; break;
      case 'aspdPerSpend': mods.ally.aspd += (rule.per || 7) * Math.floor(gold / (rule.each || 3)); break;
      case 'atkPerSpend': mods.ally.atk += (rule.per || 0.05) * Math.floor(gold / (rule.each || 5)); break;
      case 'hpdefPerSpend': {
        const n = Math.floor(gold / (rule.each || 3));
        mods.ally.hp += (rule.per || 0.03) * n;
        mods.ally.def += (rule.per || 0.03) * n;
        break;
      }
      case 'hpPerTier4Buy': mods.ally.hp += (rule.per || 0.05) * Math.min(rule.max || 10, st.counters.tier4Buys || 0); break;
      case 'survivor': mods.rules.survivor = { per: rule.per || 0.2, stacks: st.counters.survivorStacks || 0 }; break;
      case 'homeCooked': mods.ally.atk += (rule.per || 0.1) * perfects; mods.ally.hp += (rule.per || 0.1) * perfects; break;
      case 'atkPerRound': mods.ally.atk += (rule.per || 0.15) * Math.min(rule.max || 10, st.counters.atkRoundStacks || 0); break;
      case 'atkPerBounty': mods.ally.atk += (rule.base || 0.2) + (rule.per || 0.2) * Math.min(rule.max || 10, st.counters.bountyKills || 0); break;
      case 'eliteStatsPerElite': {
        const n = rule.onField ? countBoardElite(ps) : eliteCount;
        mods.allyElite.atk += (rule.per || 0.1) * n;
        mods.allyElite.def += (rule.per || 0.1) * n;
        mods.allyElite.hp += (rule.per || 0.1) * n;
        break;
      }
      case 'eliteAtkPerMerge': mods.allyElite.atk += (rule.per || 0.4) * Math.min(rule.max || 4, st.counters.eliteMerges || 0); break;
      case 'eliteAtkPerRound': mods.allyElite.atk += Math.max(rule.max || -0.5, (rule.per || -0.1) * Math.max(0, round - (st.acquired && st.acquired[id] ? st.acquired[id] : 1))); break;
      case 'eliteHpPerRound': mods.allyElite.hp += Math.max(rule.max || -0.5, (rule.per || -0.1) * Math.max(0, round - (st.acquired && st.acquired[id] ? st.acquired[id] : 1))); break;
      case 'eliteAspdPerElite': mods.allyElite.aspd += (rule.per || 10) * Math.min(rule.max || 10, eliteCount); break;
      case 'atkPerEquip': mods.ally.atk += (rule.atk || 0.1) * equipCount; mods.ally.hp += (rule.hp || 0.2) * equipCount; break;
      case 'atkPerBenchItem': mods.ally.atk += Math.min(rule.max || 1.5, (rule.per || 0.1) * benchItems); break;
      case 'kingVessel': {
        const n = st.counters.noLossStreak || 0;
        mods.ally.hp += n >= 3 ? 2.0 : n >= 1 ? 0.8 : 0;
        break;
      }
      case 'kingCrystal': break;
      case 'aspdPerNegative': mods.ally.aspd += (rule.per || 35) * negativeCount; break;
      case 'spRegenStack': mods.rules.spRegenStack = { per: rule.per || 0.4, max: rule.max || 5 }; break;
      case 'statusDuration': mods.rules.statusDuration = rule.pct || 1.5; break;
      case 'choiceFunds': break;
      case 'enemyCount': mods.rules.enemyCount = rule.mul || 0.5; break;
      default: break;
    }
  }
  // 无尽湮灭: 藏品给完之后的每次决策 — ally ATK/HP and enemy HP/ATK/DEF ×1.2 per stack (compounding)
  if (escalation > 0) {
    const mul = Math.pow(1 + ENDLESS_ESCALATION_STEP, escalation);
    mods.ally.atk += mul - 1;
    mods.ally.hp += mul - 1;
    emul.hp *= mul;
    emul.atk *= mul;
    emul.def *= mul;
    counts.escalation = escalation;
  }
  mods.enemy.hp = emul.hp - 1;
  mods.enemy.atk = emul.atk - 1;
  mods.enemy.def = emul.def - 1;
  mods.enemy.move = emul.move - 1;
  return mods;
}


function countBoardElite(ps) {
  let n = 0;
  for (const p of ps.board.values()) if (p && p.kind === 'chess' && isElitePiece(ps, p)) n++;
  return n;
}
function countElite(ps) {
  let n = 0;
  for (const p of ps.board.values()) if (p && p.kind === 'chess' && isElitePiece(ps, p)) n++;
  for (const p of ps.hand) if (p && p.kind === 'chess' && isElitePiece(ps, p)) n++;
  for (const p of ps.temp) if (p && p.kind === 'chess' && isElitePiece(ps, p)) n++;
  return n;
}
function isElitePiece(ps, p) {
  const rec = ps.gd.chess(p.id);
  return !!(rec && (rec.isGolden || /_b$/.test(p.id)));
}
function countEquipped(ps) {
  let n = 0;
  for (const p of ps.board.values()) if (p && p.kind === 'chess') n += (p.items || []).length;
  for (const p of ps.hand) if (p && p.kind === 'chess') n += (p.items || []).length;
  return n;
}

/**
 * 藏品图鉴的「效果计数」: the number of stacks the relic's own effect rule has actually accumulated.
 * p25 生命熔炉之薪 is the owner's example: 500 资金 spent → 500/5 = 100 stacks.
 * Returns null for a relic without a countable, persistent stack (a flat stat relic shows no counter).
 * @returns {{ stacks: number, hint: string } | null}
 */
export function relicStackInfo(ps, def, st, d) {
  const fx = def && def.fx && typeof def.fx === 'object' ? def.fx : {};
  const rule = fx.rule && typeof fx.rule === 'object' ? fx.rule : null;
  const num = (v) => Math.max(0, Math.trunc(Number(v) || 0));
  const gold = num(ps.stats && ps.stats.gold);
  const round = Math.max(1, num(ps.m && ps.m.round) || 1);   // ps.round 是「每回合计数器」对象，回合号在 ps.m.round
  const acq = st.acquired && Number.isInteger(st.acquired[def.id]) ? st.acquired[def.id] : round;
  const rounds = Math.max(0, round - acq);
  const perfects = num(ps.stats && ps.stats.perfectRounds);
  const handChess = ps.hand.filter((p) => p && p.kind === 'chess').length;
  const handItems = ps.hand.filter((p) => p && p.kind === 'item').length;
  const boardChess = [...ps.board.values()].filter((p) => p && p.kind === 'chess').length;
  const boardElite = [...ps.board.values()].filter((p) => p && p.kind === 'chess' && isElitePiece(ps, p)).length;
  const bondsActive = Object.values(ps.bonds || {}).filter((b) => b && b.active).length;
  const negative = st.owned.filter((id) => {
    const r = d && d.relics ? d.relics[id] : null;
    return !!(r && r.kind === 'negative');
  }).length;
  // p19/p42/p45: 待部署区 / 部署位 + 待部署区的干员数, each capped at 10 by the effect's max
  if (fx.allyPerBench) {
    const count = def.id === 'p45' ? boardChess + handChess : handChess;
    return { stacks: Math.min(10, count), hint: def.id === 'p45' ? `部署位+待部署区 ${count} 名干员` : `待部署区 ${handChess} 名干员` };
  }
  if (!rule) return null;
  switch (rule.id) {
    case 'atkPerSpend': {
      const each = rule.each || 5;
      return { stacks: Math.floor(gold / each), hint: `已花费 ${gold} 资金` };
    }
    case 'aspdPerSpend': {
      const each = rule.each || 3;
      return { stacks: Math.floor(gold / each), hint: `已花费 ${gold} 资金` };
    }
    case 'hpdefPerSpend': {
      const each = rule.each || 3;
      return { stacks: Math.floor(gold / each), hint: `已花费 ${gold} 资金` };
    }
    case 'hpPerTier4Buy': {
      const n = num(st.counters.tier4Buys);
      return { stacks: Math.min(rule.max || 10, n), hint: `已购买4阶以上 ${n} 次` };
    }
    case 'eliteAtkPerMerge': {
      const n = num(st.counters.eliteMerges);
      return { stacks: Math.min(rule.max || 4, n), hint: `已精锐合并 ${n} 次` };
    }
    case 'atkPerRound': {
      const n = num(st.counters.atkRoundStacks);
      return { stacks: Math.min(rule.max || 10, n), hint: `已叠加 ${n} 次` };
    }
    case 'atkPerBounty': {
      const n = num(st.counters.bountyKills);
      return { stacks: Math.min(rule.max || 10, n), hint: `已完成悬赏 ${n} 次` };
    }
    case 'survivor': {
      const n = num(st.counters.survivorStacks);
      return { stacks: n, hint: `已通过 ${n} 场战斗` };
    }
    case 'homeCooked': return { stacks: perfects, hint: `完美作战 ${perfects} 场` };
    case 'atkPerBond': return { stacks: bondsActive, hint: `激活盟约 ${bondsActive} 个` };
    case 'atkPerBenchItem': {
      const max = Math.max(1, Math.round((rule.max || 1.5) / Math.max(0.01, rule.per || 0.1)));
      return { stacks: Math.min(max, handItems), hint: `待部署区装备 ${handItems} 件` };
    }
    case 'atkPerEquip': {
      const n = countEquipped(ps);
      return { stacks: n, hint: `已装备 ${n} 件` };
    }
    case 'eliteAspdPerElite': {
      const n = Math.min(rule.max || 10, countElite(ps));
      return { stacks: n, hint: `精锐干员 ${n} 名` };
    }
    case 'eliteStatsPerElite':
      return { stacks: boardElite, hint: `场上精锐 ${boardElite} 名` };
    case 'aspdPerNegative':
      return { stacks: negative, hint: `负面藏品 ${negative} 件` };
    case 'probe': {
      const n = num(st.counters.probeStacks);
      return { stacks: n, hint: `已过 ${n} 个回合` };
    }
    case 'bountyKillDeploy': {
      const kills = num(st.counters.bountyKillsTotal);
      const every = rule.n || 2;
      return { stacks: Math.min(rule.max || 3, Math.floor(kills / every)), hint: `悬赏击杀 ${kills} 次` };
    }
    case 'eliteAtkPerRound':
    case 'eliteHpPerRound': {
      const n = Math.min(5, rounds);
      return { stacks: n, hint: `已持续 ${n} 回合` };
    }
    case 'fundsDrain': {
      const n = Math.min(5, rounds);
      return { stacks: n, hint: `已失去 ${n} 资金` };
    }
    case 'stunOnDeploy': {
      // 1 at acquisition, +perRound for every round after it (the old display started at 0 and capped at 3). The
      // redeploy stun (redeployDur) is a flat seconds value, not a stack, so it is named separately.
      const n = Math.min(rule.max || 4, (rule.count || 1) + Math.max(0, rounds) * (rule.perRound || 0));
      const redeploy = Number.isFinite(rule.redeployDur) ? rule.redeployDur : 5;
      return { stacks: n, hint: `开局晕眩 ${n} 人 · 再部署晕眩 ${redeploy}s` };
    }
    default: return null;
  }
}

export function relicPrivateView(ps) {
  const d = relicData(ps.gd);
  if (!d) return null;
  const st = relicState(ps);
  const card = (id) => {
    const r = d.relics[id];
    return r ? { id: r.id, name: r.name, desc: r.desc, tier: r.tier, kind: r.kind, set: r.set, no: r.no, icon: r.icon } : null;
  };
  return {
    owned: st.owned.map((id) => {
      const c = card(id);
      if (!c) return null;
      // 藏品效果计数: the relic's own effect stacks (p25: 每花费5资金 → 层数), null for a flat effect
      const stack = relicStackInfo(ps, d.relics[id], st, d);
      return { ...c, ...(stack ? { stacks: stack.stacks, stackHint: stack.hint } : null) };
    }).filter(Boolean),
    draft: st.draft ? {
      id: st.draft.id,
      round: st.draft.round,
      cards: st.draft.cards.map(card).filter(Boolean),
      // co-op annihilation: everyone votes, a tie goes to the creator
      team: st.draft.team === true,
      kind: st.draft.kind || 'negative',
      // 同盟房：创建者点过「开始抽取」才为 true，客户端据此启动转轮
      spinning: st.draft.spinning === true,
      // 平票：只有创建者能点一件来定案（客户端据此显示「请创建者选择」）
      tie: Array.isArray(st.draft.tie) && st.draft.tie.length ? st.draft.tie.slice() : null,
      hostId: st.draft.hostId || null,
      myVote: (() => { const v = ps.m && isTeamMatch(ps.m) ? teamRelicState(ps.m).votes[ps.playerId] : undefined; return Number.isInteger(v) ? v : null; })(),
      votes: (() => {
        if (!isTeamMatch(ps.m)) return null;
        const team = teamRelicState(ps.m);
        const out = st.draft.cards.map(() => 0);
        for (const v of Object.values(team.votes)) if (Number.isInteger(v) && v >= 0 && v < out.length) out[v]++;
        return out;
      })(),
      votedCount: (() => { if (!isTeamMatch(ps.m)) return null; const team = teamRelicState(ps.m); return teamBallots(ps.m).filter((p) => Number.isInteger(team.votes[p.playerId])).length; })(),
      voterCount: isTeamMatch(ps.m) ? teamBallots(ps.m).length : null,
      // the slot-machine reel pool: a short, round-rotated slice of the negative catalogue (icons only, no effects)
      spinner: (() => {
        const neg = d.order && Array.isArray(d.order.negative) ? d.order.negative : [];
        const out = [];
        const n = neg.length;
        for (let i = 0; i < Math.min(15, n); i++) {
          const r = d.relics[neg[(i * 3 + (st.draft.round || 1)) % n]];
          if (r && r.icon) out.push({ id: r.id, icon: r.icon, name: r.name, tier: r.tier });
        }
        return out;
      })(),
    } : null,
    // `pending`: the server still owes this player the 收下 acknowledgement (pendingRelicToast, set for positives and
    // cleared by g.relicSeen). The client shows the 命中老虎机 while it is true — the opening positive used to be
    // swallowed by the client's "first view counts as seen" rule, so its draw animation never appeared.
    reveal: st.reveal ? Object.assign({ seq: st.reveal.seq }, card(st.reveal.id), { pending: !!ps.pendingRelicToast }, isTeamMatch(ps.m) ? { team: true, ownerId: ps.m.hostId || null, byOwner: !ps.m.hostId || ps.m.hostId === ps.playerId } : null) : null,
    flags: { tempDisabled: !!st.flags.tempDisabled },
    // 蚀流 6 无尽湮灭: the decision escalation (0 for every other ladder level; the client shows 「藏品已尽」)
    endless: ps.gd && ps.gd.endless
      ? { escalation: endlessEscalationOf(ps), exhausted: relicCatalogExhausted(d, st, ps.m && ps.m.round), total: relicCatalogSize(d) }
      : null,
  };
}

export function relicOnBuy(ps, opts) {
  const o = opts || {};
  const st = relicState(ps);
  if (o.kind === 'chess' && Number.isInteger(o.tier) && o.tier >= 4) st.counters.tier4Buys = (st.counters.tier4Buys || 0) + 1;
}

export function relicOnMerge(ps, opts) {
  const o = opts || {};
  const st = relicState(ps);
  if (Number.isInteger(o.tier) && o.tier >= 4) st.counters.eliteMerges = Math.min(4, (st.counters.eliteMerges || 0) + 1);
}

export function relicOnSpend(ps, amount) {
  const st = relicState(ps);
  st.counters.spent = (st.counters.spent || 0) + Math.max(0, Math.trunc(amount) || 0);
}

/** 主教的研究 (n15): at most 5 paid shop refreshes per prep. */
export function relicRefreshBlocked(ps) {
  const d = relicData(ps.gd);
  if (!d) return false;
  const st = relicState(ps);
  if (!st.owned.includes('n15')) return false;
  return (st.counters.paidRefreshes || 0) >= 5;
}

/** Settle-time relic effects (半洗孤钻/至宝指环 bounty multiplier is applied by Match.settle; these fire after LP). */
/**
 * 酒神的印记（重铸）: 每击杀 n 个悬赏目标 +1 部署位，累计不超过 max（把每次战斗的 bountyKills 累加后重算）。
 * 单次发放是增量式的：只把「本次应该有的 +floor(kills/n)」和「已经发过的」的差额补上，所以不会重复加。
 * 鸭爵 / 杜宾 这类策略机制的敌人带 kind 'duke'，在 sim 里就没被计数。
 * @param {any} ps
 * @param {number} bountyKills this battle's 悬赏 kills
 */
export function relicBountyDeploy(ps, bountyKills) {
  const d = relicData(ps && ps.gd);
  if (!d || !ps) return 0;
  const st = relicState(ps);
  const kills = Math.max(0, Math.trunc(Number(bountyKills) || 0));
  if (kills > 0) st.counters.bountyKillsTotal = (st.counters.bountyKillsTotal || 0) + kills;
  const total = st.counters.bountyKillsTotal || 0;
  let granted = 0;
  for (const id of st.owned) {
    const def = relicDef(ps.gd, id);
    const rule = def && def.fx && def.fx.rule;
    if (!rule || rule.id !== 'bountyKillDeploy') continue;
    const n = Math.max(1, Math.trunc(Number(rule.n) || 1));
    const max = Math.max(0, Math.trunc(Number(rule.max) || 0));
    const want = Math.min(max, Math.floor(total / n));
    const key = 'bountyDeploy:' + id;
    const have = st.counters[key] || 0;
    if (want > have) {
      st.counters[key] = want;
      ps.deployCapBonus += want - have;
      granted += want - have;
      try { ps.dirty(); } catch { /* best effort */ }
    }
  }
  return granted;
}
/**
 * 无限续杯瓶 / 迷幻的藏宝图: +1 / +2 资金 whenever a bounty paid out this battle (the caller passes the bounty coin
 * total; 0 means no bounty completed). Credited to the next prep like the bounty coins themselves.
 * @param {any} ps
 * @param {number} [coins] bounty coins actually paid (0/undefined = no bounty completed)
 * @returns {number} the extra funds granted
 */
export function relicBountyIncome(ps, coins = 0) {
  if (!ps || !(Number(coins) > 0)) return 0;
  const d = relicData(ps.gd);
  if (!d) return 0;
  const st = relicState(ps);
  let add = 0;
  for (const id of st.owned) {
    const def = d.relics[id];
    if (def && def.fx && Number.isFinite(def.fx.bountyIncome)) add += def.fx.bountyIncome;
  }
  if (add > 0) {
    ps.pendingFunds = (Number(ps.pendingFunds) || 0) + add;
    ps.stats.fundsGained = (Number(ps.stats.fundsGained) || 0) + add;
    try { ps.dirty(); } catch { /* best effort */ }
  }
  return add;
}

/**
 * 复得之轮 (p43): 一次性装备道具（`kind` 以 `consume_on_equip` 开头）真的被消耗掉之后，补一件同类道具，每回合最多 3 次
 * （`st.counters.refundRound`，在 relicRoundStart 里清零）。触发点必须在「确实消耗掉」之后 —— 寻呼模块 / 信标 这类会先开
 * 个人选择、随后销毁装备的道具同样会补。抽到的道具由对局种子的 rngMeta 决定，同一 seed 重放同一件。
 * @param {any} m the match
 * @param {any} ps the player whose item was consumed
 * @param {any} itemRec the consumed item's data record
 * @returns {string|null} the granted item id
 */
export function relicConsumableRefund(m, ps, itemRec) {
  if (!m || !ps || !ps.alive || !itemRec) return null;
  const d = relicData(ps.gd);
  if (!d) return null;
  const st = relicState(ps);
  if (!st.owned.includes('p43')) return null;
  if (typeof itemRec.kind !== 'string' || !itemRec.kind.startsWith('consume_on_equip')) return null;
  if ((st.counters.refundRound || 0) >= 3) return null;
  const items = m.gd && m.gd.raw && m.gd.raw.items;
  const pool = [];
  for (const [id, rec] of Object.entries(items && typeof items === 'object' ? items : {})) {
    if (!rec || rec.isGolden || rec.itemType !== 'EQUIP') continue;
    if (typeof rec.kind !== 'string' || !rec.kind.startsWith('consume_on_equip')) continue;
    if (rec.hideInShop === true || rec.shopExcluded === true) continue;
    pool.push(id);
  }
  if (!pool.length) return null;
  const picked = m.rngMeta && typeof m.rngMeta.pick === 'function' ? m.rngMeta.pick(pool) : pool[0];
  const id = typeof picked === 'string' ? picked : picked && picked.id;
  if (!id) return null;
  const got = ps.acquireItem(id, { source: 'relic' });
  if (!got) return null; // the item pool is empty — no refund to hand out
  st.counters.refundRound = (st.counters.refundRound || 0) + 1;
  const name = (ps.gd.item(id) && ps.gd.item(id).name) || id;
  try { m.toast(ps, 'info', '复得之轮：获得一次性装备「' + name + '」'); } catch { /* best effort */ }
  try { ps.dirty(); } catch { /* best effort */ }
  return id;
}

/** 果腹 (p44): 一次性装备被消耗时返还它的商店价（净免费，文案即此意）。@returns {number} 返还的资金 */
export function relicConsumableFree(ps, itemRec) {
  if (!ps || !itemRec || !ps.gd) return 0;
  const st = relicState(ps);
  if (!st.owned.includes('p44')) return 0;
  const price = Math.max(0, Math.trunc(Number(ps.gd.itemPrice(itemRec.id)) || 0));
  if (!(price > 0)) return 0;
  ps.addFunds(price, { reason: 'relic' });
  try { ps.m.toast(ps, 'info', '果腹：返还一次性装备「' + (itemRec.name || itemRec.id) + '」的购买价 +' + price); } catch { /* best effort */ }
  return price;
}

export function relicOnSettle(ps) {
  const d = relicData(ps.gd);
  if (!d || !ps || !ps.alive || ps.lp <= 0) return;
  const st = relicState(ps);
  // “国王的水晶”: after the battle target life -2 (never below 1)
  if (st.owned.includes('p21')) ps.lp = Math.max(1, ps.lp - 2);
  // 至宝指环: +1 fund after every battle, 联防 included
  if (st.owned.includes('p07')) ps.pendingFunds += 1;
}

export function relicBountyMul(ps) {
  const st = relicState(ps);
  let mul = 1;
  const d = relicData(ps.gd);
  if (!d) return 1;
  for (const id of st.owned) {
    const fx = d.relics[id] && d.relics[id].fx;
    if (!fx) continue;
    if (fx.rule && fx.rule.id === 'bountyMul' && Number.isFinite(fx.rule.mul)) mul *= fx.rule.mul;
    if (Number.isFinite(fx.postBountyMul)) mul *= fx.postBountyMul;
    if (fx.rule && fx.rule.id === 'loseAllFunds' && Number.isFinite(fx.rule.bountyMul)) mul *= fx.rule.bountyMul;
  }
  return mul;
}

/** 不赦 (n35): +50 % enemy count in a normal wave — extra copies spread over the same spawn window. */
export function scaleWaveCounts(m, wave) {
  const d = relicData(m.gd);
  if (!d || !wave || !Array.isArray(wave.spawns)) return wave;
  let mul = 1;
  // 蚀流3起：第 14/15、24/25 回合是高压精英关（波次 +25%，不触发隐藏核心结算）
  const elite = m.gd && m.gd.erosion >= 3 && [14, 15, 24, 25].includes(Number(m.round));
  if (elite) mul *= 1.25;
  for (const ps of m.alivePlayers ? m.alivePlayers() : []) {
    const st = relicState(ps);
    for (const id of st.owned) {
      const fx = d.relics[id] && d.relics[id].fx;
      if (fx && fx.rule && fx.rule.id === 'enemyCount' && Number.isFinite(fx.rule.mul)) mul *= 1 + fx.rule.mul;
    }
  }
  if (elite && typeof m.tickerText === 'function') m.tickerText('精英关：敌方波次强化');
  if (mul <= 1) return wave;
  for (const s of wave.spawns) {
    if (!s || s.tag === 'boss' || s.tag === 'part') continue;
    const n = Number(s.count) || 0;
    if (n < 1) continue;
    const next = Math.max(n, Math.ceil(n * mul));
    if (next === n) continue;
    const window = (Number(s.interval) || 0) * Math.max(0, n - 1);
    s.count = next;
    s.interval = next > 1 ? window / (next - 1) : 0;
  }
  for (const a of wave.actions || []) {
    if (!a || a.tag === 'boss' || a.tag === 'part' || !Number.isFinite(a.count) || a.count < 1) continue;
    const next = Math.max(a.count, Math.ceil(a.count * mul));
    if (next > a.count) { a.count = next; a.tplCount = a.tplCount || next; }
  }
  return wave;
}

/**
 * The relic-side DISCOUNT of one shop slot, applied by PlayerState.priceOf after every surcharge / bond / garrison
 * handler. Only negative entries (无限续杯瓶 chessAll -1, 迷幻的藏宝图 item -1); a price can never go below 0.
 * @param {any} ps
 * @param {{ kind: string, id: string }} slot
 */
export function relicPriceDiscount(ps, slot) {
  const d = relicData(ps && ps.gd);
  if (!d || !slot) return 0;
  const st = relicState(ps);
  let delta = 0;
  for (const id of st.owned) {
    const px = d.relics[id] && d.relics[id].fx && d.relics[id].fx.price;
    if (!px) continue;
    if (slot.kind === 'chess' && Number.isFinite(px.chessAll)) delta += px.chessAll;
    if (slot.kind === 'item' && Number.isFinite(px.item)) delta += px.item;
  }
  return Math.min(0, delta);
}

/** 半洗孤钻 (n08): the dispatch centre costs 1 more at every level. */
export function relicUpgradeDelta(ps) {
  const d = relicData(ps.gd);
  if (!d) return 0;
  const st = relicState(ps);
  let n = 0;
  for (const id of st.owned) {
    const fx = d.relics[id] && d.relics[id].fx;
    if (fx && fx.price && Number.isFinite(fx.price.upgrade)) n += fx.price.upgrade;
  }
  return n;
}

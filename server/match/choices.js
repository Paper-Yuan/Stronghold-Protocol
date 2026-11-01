// server/match/choices.js — 机变 (SP draft) card generation and application (DESIGN §6.1, research 01 A4,
// data/choices.json).
//
// Generation (generateDraft): the family is a weighted pick from choices.schedule[modeId].rounds[r].families; the card
// count is `cards` (co-op 6, solo 3):
//   bounty  悬赏决策  six distinct cards.bounty entries (solo: 3 of them) built like the official draft of the round
//                     (`bountyDraftCards`; player feedback after 0.1.0, report #2 — late bounty enemies in the early
//                     drafts; 66 official screenshots of 22 matches, tools/build-data.mjs BOUNTY_INITIAL_SETS): schedule
//                     `bountyDraft` names the kind and choices.json `bountyDrafts[kind]` its card lists — the event is a
//                     fixed list and the draft shows 6 different cards of it, each drawn with its weight (1 + the
//                     official drafts of the group it showed in):
//                       initial (R3, 险境 R6 [ASSUMED]): one of the 10 official sets of six "接下来两场作战" cards (all
//                               six) — 9 seen, the 10th built by `rule` (I I I II II III) [ASSUMED];
//                       boss (R9): one of the 6 groups (9, 9, 9, 9, 8 and 6 cards) of boss bounties / 源石虫·特训,
//                               picked by the matches it came in [ASSUMED];
//                       hunter (R11): one of the 7 seen lists of 7 "下场战斗" cards, uniform, so no list is invented
//                               [ASSUMED: which of the 15 bounty_hunter events R11 fires is open — by the data's blocks
//                               8..15]; a list seen with 6 cards gets its 7th (`open`) by `rule`
//                               (one 特异III giant, else a tier I / II card of a free faction series) [ASSUMED];
//                     only `draft` cards of that `draftPool` (never 战术特训 — 法术教鞭 only —, the 鸭爵 set, the 7
//                     multi-round cards or the pre-series cards: no official draft shows them); positions shuffled; the
//                     mode's inactive enemy list does not apply (PRTS 卫戍协议：盟约 11/18 note "以上调整仅针对战术特训敌人，
//                     不影响悬赏决策出场"); each card carries its official rich text `descRaw` (the battles in blue
//                     "下场作战" / "两场作战"); a multi-round card (教鞭's 法术大师A2·多轮战术特训) lasts
//                     MULTI_ROUND_BOUNTY_BATTLES battles and says so (`bountyBattles` / `bountyText`: the user's call
//                     after playtest #6 — "我不记得有过多轮悬赏")
//   supply  道具补给  random normal EQUIP shop items with tier in supplyTiers [lo, hi] (duplicates allowed)
//   shop    机密商店  at the rounds of choices.json `shopDraft` (R11: the 4 official 机密商店; the user: "机密商店按官方改
//                     成可以重复吧"): six slots, each drawn on its own — with replacement, so the same item can be
//                     offered twice (official: 盟约之币 ×2, 变形同构体 ×2): VI, VI, V, 盟约之币 and twice V / IV / III /
//                     盟约之币, an item within its tier by `itemWeights` (solo: 3 of the 6 slots [ASSUMED]); other rounds
//                     (标准 / 险境, no screenshot) and without `shopDraft`: random normal EQUIP shop items of any tier I–VI,
//                     each card on its own (duplicates allowed) [ASSUMED]. FREE — the official card text is "无需消耗资金，获得装备
//                     补给" (research 01 A4/04 addendum), so the price is 0. Two identical cards are two cards: picks,
//                     `taken` and the client go by the card's `idx`
//   tactic  战术决策  cards.tactic entries, each card drawn on its own — with replacement, so the same card can be
//                     offered twice (the 4 official 战术决策, R11 of matches 7 / 9 / 18 / 20: 补给 ×2 in match 7; the
//                     user: "战术决策也按官方改成可以重复吧"; `tacticDraftCards`): at the rounds of choices.json
//                     `tacticDraft` (R11) only its `kinds` (the ally cards — the official 24 cards hold no debuff and
//                     no terrain card), a card by `weights` (1 + the official cards it showed on) [ASSUMED: the
//                     weights]; other rounds (标准 / 险境, no screenshot) every card uniform, terrain cards only for
//                     the match stage [ASSUMED]; a 驰援 card (single_special_choice_gain_bond_chess) or a 盟誓 card
//                     (global_special_choice_bond_addlayer) only while at least one of its bonds is live in this match
//                     (opts.bondAvailable = Match.bondLive: not in the mode's static inactive list — 标准 turns off
//                     拉特兰 / 阿戈尔 / 卡西米尔 / 奥术 … — and still with chess in the pool); a card acting only on dead
//                     bonds would do nothing. Two identical cards are two cards: picks, `taken` and the client go by
//                     the card's `idx`, and each pick applies its own card once (two picks of one team card stack)
// Application (applyCard): a registered `choice:<effectId>` handler (content) wins; otherwise the family default:
//   bounty → the picker's bounty list (waves.js adds the enemies to the next `rounds` battles; kill payout to the
//            killer via the Battle, perfect payout at settlement when the picker's own battle was perfect)
//   supply / shop → the item goes to the picker's hand (overflow temp)
//   tactic → by effect buff key (data/effects.json):
//     global_special_choice_gain_equip {count,pool}     `count` items from the server pool
//     global_special_choice_bond_addlayer {count,bond_list} layers +count to each bond (无需激活)
//     global_special_choice_gain_coin {count}           funds
//     global_special_choice_refresh_free {count}        free refreshes (stack)
//     single_special_choice_gloden_equip_chess {count}  next `count` bought items become golden   (EffectRef)
//     single_special_choice_gloden_char_chess {count}   next `count` bought operators become elite (EffectRef)
//     single_special_choice_gain_bond_chess {count,bond} `count` random chess of the bond (≤ shop level)
//     auto_chess_change_map {alias: 0|1}                device toggles on the picker's board (deploy legality) + battle
//     anything else (env_gbuff…, enemy_attribute_mul…)  a battle EffectRef for the sim content (playerEffects)
//   cards with `team: true` apply to the picker AND every alive teammate ("若存在其他队友则他们也获得").

import { weightedPick } from './waves.js';
import { PLUGIN_GAIN_COUNT_MAX } from '../../shared/plugins/limits.js';

export const FAMILY_NAMES = { bounty: '悬赏决策', supply: '道具补给', shop: '机密商店', tactic: '战术决策', express: '企鹅物流的快递', jibian: '惊变阶段' }; // i18n-ignore: = choices.json families (the client shows the localized record)

/**
 * 炸惊模拟: the 惊变 card ids a player already owns (`ps.effects` refs whose key is `jibian:<effectId>`, written by
 * applyDefault below). Used to keep an offered 惊变 out of the next draft ("已拥有不重复") and to feed the 惊变羁绊
 * progress. Total: a player without 惊变 has none.
 * @param {any} ps
 * @returns {Set<string>}
 */
export function ownedJibianIds(ps) {
  const out = new Set();
  for (const ref of (ps && (ps.playerEffects || ps.effects)) || []) {
    const k = ref && ref.key;
    if (typeof k === 'string' && k.startsWith('jibian:')) out.add(k.slice('jibian:'.length));
  }
  return out;
}

/**
 * Battles a multi-round bounty card lasts (data `rounds` 99, official text "之后 / 后续的<@ba.vdown>每场</>作战":
 * 山海众头目·多轮悬赏, 多轮悬赏·假想敌 ×6, 法术大师A2·多轮战术特训). The user does not remember any multi-round bounty
 * (playtest #6 answer, "我不记得有过多轮悬赏"): until that is confirmed otherwise every such card lasts two battles,
 * exactly like the "接下来两场作战" cards, and its text says so in the same blue (`bountyText`). `null` restores the
 * official "每场" (every later battle, red text) everywhere: the draft, 教鞭 / 神秘顾客, the bounty list and the effects
 * column (DESIGN §20).
 */
export const MULTI_ROUND_BOUNTY_BATTLES = 2;
/** A multi-round bounty card ("之后 / 后续的每场作战"; choices.json `multiRound`, or data `rounds` ≥ 90). */
export const isMultiRoundBounty = (c) => !!c && (c.multiRound === true || Number(c.rounds) >= 90);
/** The battles a bounty card's enemies come for (MULTI_ROUND_BOUNTY_BATTLES for a multi-round card), 1–99. */
export function bountyBattles(c) {
  if (isMultiRoundBounty(c) && Number.isInteger(MULTI_ROUND_BOUNTY_BATTLES)) return MULTI_ROUND_BOUNTY_BATTLES;
  const r = Number(c && c.rounds);
  return Math.max(1, Math.min(99, Number.isInteger(r) ? r : 1));
}
const N_ZH = ['', '一', '两', '三', '四', '五']; // i18n-ignore: rewrites the official Chinese bounty text
/**
 * A bounty text as the card lasts: a multi-round card's "之后的 / 后续每场作战" (rich `<@ba.vdown>每场</>` or plain) reads
 * "接下来<@ba.vup>两场作战</>" like the official two-battle cards while MULTI_ROUND_BOUNTY_BATTLES is set; any other
 * text is returned as is.
 */
export function bountyText(text, c) {
  if (typeof text !== 'string' || !text || !isMultiRoundBounty(c) || !Number.isInteger(MULTI_ROUND_BOUNTY_BATTLES)) return text;
  const n = MULTI_ROUND_BOUNTY_BATTLES;
  const battles = `${N_ZH[n] || n}场作战`; // i18n-ignore
  return text
    .replace(/(?:之后的|后续的?)<@ba\.vdown>每场<\/>作战/g, `接下来<@ba.vup>${battles}</>`)
    .replace(/(?:之后的|后续的?)每场作战/g, `接下来${battles}`);
}

function scheduleFor(gd, round) {
  const sch = gd.choices.schedule && gd.choices.schedule[gd.modeId];
  const r = sch && sch.rounds && sch.rounds[String(round)];
  if (r && typeof r === 'object') return r;
  // fallback: a supply draft
  return { families: [{ family: 'supply', weight: 1 }], cards: gd.isSolo ? 3 : 6, supplyTiers: [1, Math.min(6, 1 + Math.floor(round / 3))] };
}

/**
 * The kind of official 悬赏决策 a round has when its schedule does not say (`bountyDraft`): R3 'initial', R9 'boss',
 * R11 'hunter' (choices.json bountyDrafts; player feedback after 0.1.0, report #2).
 */
export function bountyDraftKind(round) {
  const r = Number(round);
  return r < 8 ? 'initial' : r < 11 ? 'boss' : 'hunter';
}

function formatCount(gd) {
  const f = gd.choices.format || {};
  const multi = f.multi && Number.isInteger(f.multi.cards) ? f.multi.cards : 6;
  const solo = f.solo && Number.isInteger(f.solo.cards) ? f.solo.cards : 3;
  return gd.isSolo ? solo : multi;
}

function eligibleItems(gd, lo, hi) {
  const out = [];
  for (let t = lo; t <= hi; t++) for (const id of gd.shopItemsByTier[t] || []) out.push(id);
  return out;
}

function itemCard(gd, id) {
  const it = gd.item(id);
  return { kind: 'item', id, name: it ? it.name : id, desc: it ? it.desc || '' : '', tier: it && Number.isInteger(it.tier) ? it.tier : 1, price: 0 };
}

/**
 * Build the draft cards for an SP round.
 * @returns {{ family: string, name: string, desc: string, eventId: string|null, cards: object[] } | null}
 */
export function generateDraft(gd, rng, round, { stageId = null, bondAvailable = null, itemAvailable = null, forceFamily = null, exclude = null, onlyHighRarity = false, minCards = 0 } = {}) {
  const sch = scheduleFor(gd, round);
  const schedCount = () => (Number.isInteger(sch.cards) && sch.cards > 0 ? Math.min(sch.cards, 6) : formatCount(gd));
  // 炸惊模拟 规则5/6: a round with a phase kind of its own (GameData.spPhaseKind, mode.spPhaseKinds) ignores the weighted
  // family draw AND the schedule's card count — 惊变阶段 offers `jibian.cards` 惊变 cards, 企鹅物流的快递 `expressCards`
  // equips in place of 悬赏决策, 悬赏高阶段 is the bounty family. Every other mode gets null and the old path below.
  const forced = typeof gd.spPhaseKind === 'function' ? gd.spPhaseKind(round) : null;
  const jb = forced === 'jibian' && typeof gd.jibian === 'function' ? gd.jibian() : null;
  let family;
  let n;
  // 随机模式 (无限火力) 悬赏每回合选：forceFamily 强制该类卡片（不再跟其它类别加权竞争）
  if (forceFamily && FAMILY_NAMES[forceFamily]) { family = forceFamily; n = schedCount(); }
  else if (forced === 'bountyHigh') { family = 'bounty'; n = schedCount(); }
  else if (forced === 'express') { family = 'express'; n = typeof gd.expressCards === 'function' ? gd.expressCards() : 6; }
  else if (forced === 'jibian') { family = 'jibian'; n = jb ? jb.cards : 3; }
  else {
    const fams = Array.isArray(sch.families) && sch.families.length ? sch.families.map((f) => [f.family, f.weight]) : [['supply', 1]];
    family = weightedPick(rng, fams) || 'supply';
    n = schedCount();
  }
  // A draft pool must hold at least one card per participant (惊变阶段 offers `jibian.cards` = 3 while a 同盟 room may
  // have more players). 0 — the default — leaves every mode's own count untouched.
  if (Number.isInteger(minCards) && minCards > n) n = Math.min(6, minCards);
  const opts = { stageId, bondAvailable, round, itemAvailable, exclude, onlyHighRarity };
  let cards = buildCards(gd, rng, family, n, sch, opts);
  if (!cards.length && family !== 'supply' && family !== 'jibian') { family = 'supply'; cards = buildCards(gd, rng, family, n, sch, opts); }
  if (!cards.length) return null;
  cards.forEach((c, i) => { c.idx = i; c.family = family; });
  const famInfo = gd.choices.families && gd.choices.families[family];
  const events = sch.events && Array.isArray(sch.events[family]) ? sch.events[family] : [];
  const eventId = events.length ? events[Math.floor(rng() * events.length)] : null;
  return { family, name: famInfo && famInfo.name ? famInfo.name : FAMILY_NAMES[family] || family, desc: famInfo && famInfo.desc ? famInfo.desc : '', eventId, cards };
}

/** Bond granted by a 驰援 tactic card (effect buff single_special_choice_gain_bond_chess), else null. */
export function reinforcementBond(gd, effectId) {
  const eff = gd.effect(effectId);
  const buffs = eff && Array.isArray(eff.buffs) ? eff.buffs : [];
  const b = buffs.find((x) => x && x.key === 'single_special_choice_gain_bond_chess');
  return b && b.bbStr && typeof b.bbStr.bond === 'string' ? b.bbStr.bond : null;
}

/**
 * Bonds a tactic card only acts on: the 驰援 bond (single_special_choice_gain_bond_chess) and the bonds of a 盟誓 card
 * (global_special_choice_bond_addlayer bond_list). null when the card does anything else (it is always useful).
 */
export function cardTargetBonds(gd, effectId) {
  const eff = gd.effect(effectId);
  const buffs = eff && Array.isArray(eff.buffs) ? eff.buffs.filter(Boolean) : [];
  if (!buffs.length) return null;
  const out = [];
  for (const b of buffs) {
    const bs = b.bbStr || {};
    if (b.key === 'single_special_choice_gain_bond_chess' && typeof bs.bond === 'string') out.push(bs.bond);
    else if (b.key === 'global_special_choice_bond_addlayer') out.push(...String(bs.bond_list || '').split(',').map((x) => x.trim()).filter(Boolean));
    else return null;
  }
  return out.length ? out : null;
}

/**
 * A bounty card the 悬赏决策 draft may offer (choices.json cards.bounty `draft`, tools/build-data.mjs
 * bountyDraftExclusion: no 战术特训, no 鸭爵 set — user playtest #6 item 4 —, nothing no official draft showed — player
 * feedback #2). Data without the flag (older builds, test fixtures) falls back to the kill bounties. With `kind`
 * ('initial' | 'boss' | 'hunter') the card must also belong to that kind of draft (choices.json `draftPool`; a card
 * without one — test fixtures — fits every kind).
 */
export function draftBounty(c, kind = null) {
  if (!c) return false;
  if (kind != null && typeof c.draftPool === 'string' && c.draftPool !== kind) return false;
  if (typeof c.draft === 'boolean') return c.draft;
  return c.payout !== 'perfect';
}

/** The draft card of a cards.bounty entry (the official rich text, a multi-round card's battles and text rewritten). */
export function bountyCard(gd, c) {
  const eff = typeof gd.effect === 'function' ? gd.effect(c.effectId) : null;
  return {
    kind: 'bounty', id: c.effectId, name: c.name, desc: bountyText(c.desc || '', c), descRaw: bountyText((eff && eff.descRaw) || null, c), tier: c.tier, coin: c.coin,
    payout: c.payout, rounds: bountyBattles(c), enemyKey: c.enemyKey, count: c.count,
  };
}

/** Up to `k` cards of `list` not in `taken`, in a shuffled order. */
function drawDistinct(rng, list, k, taken) {
  const out = [];
  for (const c of rng.shuffle(list.slice())) {
    if (out.length >= k) break;
    if (taken.has(c)) continue;
    out.push(c);
    taken.add(c);
  }
  return out;
}

/** `k` different entries of `list` drawn one by one with weights `weights` (missing / bad weights count 1). */
function drawWeighted(rng, list, weights, k) {
  const pool = list.map((c, i) => [c, Math.max(0, Number(weights && weights[i]) || 1)]);
  const out = [];
  while (out.length < k && pool.length) { // loop-cap: pool length and k
    const c = weightedPick(rng, pool);
    out.push(c);
    pool.splice(pool.findIndex(([x]) => x === c), 1);
  }
  return out;
}

/**
 * The cards of an unseen R3 set (`spec.rule`, [ASSUMED]): one card per tier of `tiers` from the two-battle cards of
 * `series`, at most `perSeries` of one series; a tier the `prefer` cards have is filled first, by one of them.
 */
function initialRuleSet(rng, rule, all) {
  const out = [];
  const perSeries = Number.isInteger(rule.perSeries) ? rule.perSeries : 1;
  const ofSeries = (s) => out.filter((c) => c.series === s).length;
  const prefer = new Set(Array.isArray(rule.prefer) ? rule.prefer : []);
  const series = new Set(Array.isArray(rule.series) ? rule.series : []);
  // the tiers a preferred card has go first, so that it still fits its series
  const prefTiers = new Set(all.filter((c) => prefer.has(c.effectId)).map((c) => c.tier));
  const tiers = rng.shuffle((Array.isArray(rule.tiers) ? rule.tiers : []).slice());
  for (const tier of [...tiers.filter((t) => prefTiers.has(t)), ...tiers.filter((t) => !prefTiers.has(t))]) {
    const ok = (c) => !out.includes(c) && c.tier === tier && series.has(c.series) && ofSeries(c.series) < perSeries;
    const pref = all.filter((c) => prefer.has(c.effectId) && ok(c));
    const c = rng.pick(pref.length ? pref : all.filter(ok));
    if (c) out.push(c);
  }
  return out;
}

/**
 * Fill an R11 list up to `rule.size` (an unseen event: from nothing; a seen group: its `open` cards) [ASSUMED]: a list
 * without a 特异III giant gets one, the rest are tier I / II cards, at most one per `onePerSeries` series and
 * `maxSeries16` of series 16.
 */
function hunterFill(rng, rule, list, byId) {
  const out = list.slice();
  const size = Number.isInteger(rule.size) ? rule.size : 7;
  const giants = (Array.isArray(rule.giants) ? rule.giants : []).map((id) => byId.get(id)).filter(Boolean);
  const onePer = new Set(Array.isArray(rule.onePerSeries) ? rule.onePerSeries : []);
  const max16 = Number.isInteger(rule.maxSeries16) ? rule.maxSeries16 : 2;
  if (out.length < size && !out.some((c) => giants.includes(c))) { const g = rng.pick(giants.filter((c) => !out.includes(c))); if (g) out.push(g); }
  const fits = (c) => !out.includes(c) && (onePer.has(c.series) ? !out.some((x) => x.series === c.series) : c.series !== 16 || out.filter((x) => x.series === 16 && !giants.includes(x)).length < max16);
  for (const c of rng.shuffle((Array.isArray(rule.cards) ? rule.cards : []).map((id) => byId.get(id)).filter(Boolean))) {
    if (out.length >= size) break;
    if (fits(c)) out.push(c);
  }
  return out;
}

/**
 * The cards of a 悬赏决策 of kind `kind` after its official card lists (choices.json `bountyDrafts[kind]`, see the module
 * header), over the eligible cards `byId` (effectId → cards.bounty entry). Ids the eligible list lacks are skipped.
 *   pick 'slot': one of `slots` events, uniform — a seen group, or for an unseen event a list built by `rule` (R3's
 *               10th set; R11 has `slots` = its 7 seen lists, so none is built);
 *   pick 'seen': a group by the number of official matches it came in.
 * The draft is `count` different cards of the list drawn by the group's `weights` (a rule-built card weighs 1).
 */
function structuredBounty(rng, kind, spec, byId) {
  const count = Number.isInteger(spec.count) ? spec.count : 6;
  const groups = Array.isArray(spec.groups) ? spec.groups : [];
  let group = null;
  if (spec.pick === 'seen') {
    group = weightedPick(rng, groups.map((g) => [g, (Array.isArray(g.seen) ? g.seen.filter((x) => Number.isInteger(x)).length : 0) || 1]));
  } else {
    const slots = Math.max(groups.length, Number.isInteger(spec.slots) ? spec.slots : 0);
    const slot = slots > 0 ? rng.int(slots) : 0;
    group = slot < groups.length ? groups[slot] : null;
  }
  const rule = spec.rule || {};
  let list;
  let weights;
  if (group) {
    const ids = Array.isArray(group.cards) ? group.cards : [];
    list = [];
    weights = [];
    ids.forEach((id, i) => { const c = byId.get(id); if (c) { list.push(c); weights.push(Array.isArray(group.weights) ? group.weights[i] : 1); } });
    if (kind === 'hunter' && Number(group.open) > 0) list = hunterFill(rng, { ...rule, size: list.length + Number(group.open) }, list, byId);
  } else if (kind === 'initial') {
    list = initialRuleSet(rng, rule, [...byId.values()]);
  } else if (kind === 'hunter') {
    list = hunterFill(rng, rule, [], byId);
  } else {
    list = [];
  }
  return drawWeighted(rng, list, weights, count);
}

/**
 * Build `n` 悬赏决策 cards for `round` (module header): the official structure of the round's kind, topped up with other
 * eligible cards of that kind when it falls short (test fixtures with a restricted card list), shuffled into place —
 * the official card positions vary — and cut to `n` (solo 3 [ASSUMED]).
 */
function bountyDraftCards(gd, rng, n, sch, round) {
  const kind = typeof sch.bountyDraft === 'string' ? sch.bountyDraft : bountyDraftKind(round);
  const all = Array.isArray(gd.choices.cards && gd.choices.cards.bounty) ? gd.choices.cards.bounty : [];
  const eligible = all.filter((c) => c && draftBounty(c, kind) && gd.enemy(c.enemyKey));
  const byId = new Map(eligible.map((c) => [c.effectId, c]));
  const spec = gd.choices.bountyDrafts && gd.choices.bountyDrafts[kind];
  const out = spec ? structuredBounty(rng, kind, spec, byId) : [];
  const taken = new Set(out);
  if (out.length < n) out.push(...drawDistinct(rng, eligible, n - out.length, taken));
  return rng.shuffle(out).slice(0, n).map((c) => bountyCard(gd, c));
}

/**
 * The 机密商店 cards (choices.json `shopDraft`, module header): every slot drawn on its own — a tier (or `coin`, the
 * 盟约之币) by the slot's weights, then an item of that tier by `itemWeights` (1 when unlisted; an empty tier falls back to
 * the nearest lower one, then any) — so one item can fill two slots. Positions shuffled; `n` < the slots (solo) keeps
 * `n` of them. Null without a usable `shopDraft` or at a round its `rounds` (when given) does not list.
 */
export function shopDraftCards(gd, rng, n, round = null, itemAvailable = null) {
  const spec = gd.choices.shopDraft;
  const slots = spec && Array.isArray(spec.slots) ? spec.slots.filter((x) => x && typeof x === 'object') : [];
  if (!slots.length) return null;
  if (Array.isArray(spec.rounds) && !spec.rounds.includes(round)) return null;
  const w = spec.itemWeights && typeof spec.itemWeights === 'object' ? spec.itemWeights : {};
  const coin = typeof spec.coin === 'string' && gd.item(spec.coin) ? spec.coin : null;
  const free = list => itemAvailable ? list.filter(itemAvailable) : list;
  const ofTier = (t) => {
    for (let k = t; k >= 1; k--) { const list = free(gd.shopItemsByTier[k] || []); if (list.length) return list; }
    return free(eligibleItems(gd, 1, 6));
  };
  const out = [];
  for (const slot of slots) {
    const kinds = Object.entries(slot).filter(([k]) => k === 'coin' ? !!coin : Number.isInteger(Number(k)));
    const kind = weightedPick(rng, kinds);
    if (kind == null) continue;
    const list = kind === 'coin' ? [coin] : ofTier(Number(kind));
    const id = weightedPick(rng, list.map((x) => [x, Object.hasOwn(w, x) ? w[x] : 1]));
    if (id) out.push(itemCard(gd, id));
  }
  return rng.shuffle(out).slice(0, Math.max(0, n));
}

/** The draft card of a cards.tactic entry. */
export function tacticCard(c) {
  return { kind: 'tactic', id: c.effectId, name: c.name, desc: c.desc || '', tier: null, team: !!c.team, tacticKind: c.kind };
}

/**
 * The 战术决策 cards (module header): `n` cards, each drawn on its own — with replacement, so one card can fill two places
 * (official R11 of match 7: 补给 ×2). At the rounds of choices.json `tacticDraft` (`rounds`; R11) only the cards of its
 * `kinds` (ally), each by `weights` (1 when unlisted); elsewhere — or when those kinds leave nothing — every card, uniform.
 * Terrain cards only for the match stage; a card whose every target bond is dead in this match (mode-inactive, or no
 * chess left in the pool: `bondAvailable`) is never offered.
 */
export function tacticDraftCards(gd, rng, n, { stageId = null, bondAvailable = null, round = null } = {}) {
  const bondOk = (c) => {
    if (typeof bondAvailable !== 'function') return true;
    const bonds = cardTargetBonds(gd, c.effectId);
    return !bonds || bonds.some((b) => !!bondAvailable(b));
  };
  // 湮灭模拟: a card marked `annOnly` (the two 盟誓 cards 罗德岛 / 卡兹戴尔) only ever exists in an annihilation match. The
  // gate is explicit rather than relying on 「its bond has no members ⇒ bondLive false」, so a later change to the pool
  // rule (Match.bondInPool now counts `chess[].annBonds`) can never leak these cards into an official or 炸惊 match. The
  // EFFECT record carries the same flag, and either one is enough to keep the card out.
  const annOk = (c) => {
    if (gd.annihilation) return true;
    const e = c && c.effectId ? gd.effect(c.effectId) : null;
    return !(c && c.annOnly === true) && !(e && e.annOnly === true);
  };
  const list = Array.isArray(gd.choices.cards && gd.choices.cards.tactic) ? gd.choices.cards.tactic : [];
  const pool = list.filter((c) => c && annOk(c) && (c.kind !== 'terrain' || (stageId && c.stageId === stageId)) && gd.effect(c.effectId) && bondOk(c));
  const spec = gd.choices.tacticDraft && typeof gd.choices.tacticDraft === 'object' ? gd.choices.tacticDraft : null;
  const official = !!spec && (!Array.isArray(spec.rounds) || spec.rounds.includes(round));
  const kinds = official && Array.isArray(spec.kinds) && spec.kinds.length ? spec.kinds : null;
  const w = official && spec.weights && typeof spec.weights === 'object' ? spec.weights : {};
  const ofKinds = kinds ? pool.filter((c) => kinds.includes(c.kind)) : pool;
  const pairs = (ofKinds.length ? ofKinds : pool).map((c) => [c, Object.hasOwn(w, c.effectId) ? w[c.effectId] : 1]);
  const out = [];
  for (let i = 0; i < n && pairs.length; i++) out.push(tacticCard(weightedPick(rng, pairs)));
  return out;
}

/**
 * 炸惊模拟 规则6 — 企鹅物流的快递 (in place of 悬赏决策 on its rounds): `n` equips drawn WITH replacement from the
 * mode's `expressPool` — the items carrying a `giveBondId`, i.e. the ones that turn a 变形同构体 wearer into a member of
 * their bond (转职). Repeatable on purpose (one item may fill two of the six places); choices.json `shopDraft.itemWeights`
 * gives the weights when it lists one, 1 otherwise. Null without a pool, so the round falls through to the prep.
 */
export function expressDraftCards(gd, rng, n) {
  // 用户 2026-10-11：每格 5% 概率直接放【变形同构体】chess_item_6_09_e_a —— 它给被变形的干员授予一条随机盟约，
  // 按纯权重抽太罕见。
  const GUISE_ITEM = 'chess_item_6_09_e_a';
  const pool = typeof gd.expressPool === 'function' ? gd.expressPool() : [];
  if (!pool.length) return null;
  const spec = gd.choices.shopDraft;
  const w = spec && spec.itemWeights && typeof spec.itemWeights === 'object' ? spec.itemWeights : {};
  const pairs = pool.map((id) => [id, Object.hasOwn(w, id) ? w[id] : 1]);
  const groups = typeof gd.expressGroups === 'function' ? gd.expressGroups() : {};
  const out = [];
  for (let i = 0; i < n && pairs.length; i++) {
    const picked = weightedPick(rng, pairs);
    if (rng() < 0.05 && pool.includes(GUISE_ITEM)) {
      out.push(GUISE_ITEM);
      continue;
    }
    // 用户 2026-10-11：维多利亚战锤合并成一格 —— 抽中这一格之后再在几种战锤里随机一种投放到前台，于是「抽到战锤」的
    // 总概率和其它单件装备完全一致。
    const g = Array.isArray(groups[picked]) ? groups[picked] : null;
    const id = g && g.length ? g[Math.min(g.length - 1, Math.floor(rng() * g.length))] : picked;
    out.push(itemCard(gd, id));
  }
  return out;
}

/**
 * The draft card of one 惊变 entry of `config.modes[*].jibian.pool`. The entry may carry its own `kind`; otherwise the
 * id decides — an effectId (an effect the pick applies) or an item id (granted to the picker).
 * The card's OWN `rarity` wins over the rolled one: the roll falls back to the whole pool when a rarity is exhausted, so
 * a rolled rarity would otherwise label an epic/legend card "rare" (player report 2026-10-16).
 * @param {any} gd
 * @param {{ id?: string, effectId?: string, key?: string, name?: string, desc?: string, rarity?: string, tier?: number, kind?: string }} c
 * @param {string|null} rarity the rarity rolled for this place
 * @param {string[]|null} bonds 惊变羁绊 hints (「羁绊名 已有/阈值」 lines)
 */
export function jibianCard(gd, c, rarity = null, bonds = null) {
  const id = c.id || c.effectId || c.key || null;
  const eff = id ? gd.effect(id) : null;
  const it = id ? gd.item(id) : null;
  return {
    kind: c.kind || (eff ? 'tactic' : it ? 'item' : 'jibian'),
    id,
    name: c.name || (eff && eff.name) || (it && it.name) || String(id || '惊变'),
    desc: c.desc || (eff && eff.desc) || (it && it.desc) || '',
    tier: Number.isInteger(c.tier) ? c.tier : (it && Number.isInteger(it.tier) ? it.tier : null),
    rarity: (typeof c.rarity === 'string' && c.rarity) ? c.rarity : (rarity || null),
    // the grey flavour line printed at the card's bottom (config pool `flavor`)
    flavor: c.flavor || (eff && eff.flavor) || null,
    // 盟约惊变: the card's icon uses that bond's portrait
    bond: c.bond || null,
    iconBond: c.iconBond || null,
    bonds: Array.isArray(bonds) && bonds.length ? bonds : null,
  };
}

/**
 * 炸惊模拟 规则5 — 惊变阶段: `n` 惊变 cards. The rarity is rolled FIRST (mode.jibian.rarityWeights) and a card of that
 * rarity is then drawn from the mode's own pool; a rarity the pool has nothing left of falls back to the pool as a
 * whole (never an empty card). Every card the player already owns (`exclude`) is kept out, and the cards of one offer do
 * not repeat. An empty pool returns null: the phase then falls through to the prep.
 * @param {any} gd @param {any} rng @param {number} n
 * @param {Iterable<string>|null} exclude 惊变 ids the player already owns
 */
export function jibianDraftCards(gd, rng, n, exclude = null, { onlyHighRarity = false, noCoreBond = false } = {}) {
  const j = typeof gd.jibian === 'function' ? gd.jibian() : null;
  if (!j || !j.pool.length) return null;
  // 隐藏规则: a player with NO active core bond draws a 「带核心盟约的传说惊变」 at noCoreBondLegendWeight %; the legend
  // share of the ordinary draw is narrowed by exactly those cards so the total stays at the target.
  const boost = noCoreBond ? Math.max(0, Math.min(100, Number(j.noCoreBondLegendWeight) || 0)) : 0;
  const isCoreLegend = (c) => {
    if (!c || c.rarity !== 'legend' || typeof c.bond !== 'string') return false;
    const rec = gd.bond(c.bond);
    return !!(rec && rec.isCore === true);
  };
  const banned = exclude instanceof Set ? exclude : new Set(Array.isArray(exclude) ? exclude : []);
  const keyOf = (c) => (c && (c.effectId || c.id || c.key)) || null;
  let pool = j.pool.filter((c) => c && !banned.has(keyOf(c)));
  // 「投资未来」: only epic / legend / hidden may be offered this phase — filter the POOL (a 0 weight still falls back
  // to the whole pool) and narrow the weights with it so the label and the card agree.
  if (onlyHighRarity) pool = pool.filter((c) => c && (c.rarity === 'epic' || c.rarity === 'legend' || c.rarity === 'hidden'));
  const weights = onlyHighRarity ? j.rarityWeights.filter(([r]) => r === 'epic' || r === 'legend' || r === 'hidden') : j.rarityWeights;
  const useWeights = weights.length ? weights : j.rarityWeights;
  const out = [];
  for (let i = 0; i < n && pool.length; i++) {
    // ① the hidden rule's class first
    if (boost > 0 && rng() * 100 < boost) {
      const list = pool.filter(isCoreLegend);
      if (list.length) {
        const card = list[Math.min(list.length - 1, Math.floor(rng() * list.length))];
        pool = pool.filter((c) => c !== card);
        out.push(jibianCard(gd, card, 'legend'));
        continue;
      }
    }
    // ② the ordinary draw: rarity first, then a card of it
    const rarity = weightedPick(rng, useWeights);
    let ofRarity = pool.filter((c) => c && c.rarity === rarity);
    if (boost > 0 && rarity === 'legend') {
      const rest = ofRarity.filter((c) => !isCoreLegend(c));
      if (rest.length) ofRarity = rest;
    }
    const list = ofRarity.length ? ofRarity : pool;
    const card = list[Math.min(list.length - 1, Math.floor(rng() * list.length))];
    pool = pool.filter((c) => c !== card);
    out.push(jibianCard(gd, card, rarity));
  }
  return out.length ? out : null;
}

function buildCards(gd, rng, family, n, sch, { stageId = null, bondAvailable = null, round = 1, itemAvailable = null, exclude = null, onlyHighRarity = false, noCoreBond = false } = {}) {
  if (family === 'bounty') return bountyDraftCards(gd, rng, n, sch, round);
  if (family === 'express') return expressDraftCards(gd, rng, n) || [];
  if (family === 'jibian') return jibianDraftCards(gd, rng, n, exclude, { onlyHighRarity, noCoreBond }) || [];
  if (family === 'shop') {
    const cards = shopDraftCards(gd, rng, n, round, itemAvailable);
    if (cards) return cards;
  }
  if (family === 'supply' || family === 'shop') {
    let lo = 1;
    let hi = 6;
    if (family === 'supply' && Array.isArray(sch.supplyTiers) && sch.supplyTiers.length === 2) [lo, hi] = sch.supplyTiers;
    let list = eligibleItems(gd, lo, hi);
    if (itemAvailable) list = list.filter(itemAvailable);
    if (!list.length) list = eligibleItems(gd, 1, 6);
    if (itemAvailable) list = list.filter(itemAvailable);
    const out = [];
    for (let i = 0; i < n && list.length; i++) out.push(itemCard(gd, list[Math.floor(rng() * list.length)]));
    return out;
  }
  if (family === 'tactic') return tacticDraftCards(gd, rng, n, { stageId, bondAvailable, round });
  return [];
}

/** Public card view. */
export function cardView(c) {
  const v = { idx: c.idx, kind: c.kind, id: c.id, name: c.name, desc: c.desc, tier: c.tier ?? null };
  if (c.kind === 'bounty') Object.assign(v, { descRaw: c.descRaw ?? null, coin: c.coin, payout: c.payout, rounds: c.rounds, enemyKey: c.enemyKey, count: c.count });
  if (c.kind === 'item') v.price = 0;
  if (c.kind === 'tactic') Object.assign(v, { team: c.team, tacticKind: c.tacticKind });
  // 炸惊模拟 惊变阶段: the rarity rolled for this place (or the card's own), the grey flavour line, the bond portrait
  if (c.rarity) v.rarity = c.rarity;
  if (c.flavor) v.flavor = c.flavor;
  if (c.bond) v.bond = c.bond;
  if (c.iconBond) v.iconBond = c.iconBond;
  if (Array.isArray(c.bonds) && c.bonds.length) v.bonds = c.bonds;
  // 超限模拟「词条」（server/match/relicsOverlimit.js relicCardView）: 分组、实装状态与特殊颜色随卡下发
  // —— 客户端据此画分组色条与「未实装」角标；其它 family 的卡没有这三个键，m.public.sp 逐字节不变。
  if (c.group) v.group = c.group;
  if (c.impl) v.impl = c.impl;
  if (c.effectColor) v.effectColor = c.effectColor;
  // 超限模拟「负面词条」（server/match/relicsOverlimit.js negativeCardView）：与上面那三个键同一处分发。
  // `negative` 让客户端换警示色 / 眉题；`tierLabel`/`tierIndex`/`tierValues` 是这张抽到的 Ⅰ/Ⅱ/Ⅲ 档位。
  // 只有负面卡带这四个键，其它 family 的 m.public.sp 逐字节不变。
  if (c.negative === true) {
    v.negative = true;
    v.tierLabel = c.tierLabel ?? null;
    v.tierIndex = c.tierIndex ?? null;
    v.tierValues = c.tierValues ?? null;
  }
  // 炸惊模拟 惊变 重抽 (owner 2026-10-19, 每张卡各能刷新一次): a card that is itself the product of a redraw carries the flag,
  // so the client can close that card's 重抽 key instead of counting a per-draft budget. Absent on every other card.
  if (c.rerolled === true) v.rerolled = true;
  return v;
}

/**
 * Apply a picked card to a player (registry override → family default). Team tactic cards are applied to every
 * alive teammate as well.
 * @param {import('./Match.js').Match} m
 * @param {import('./PlayerState.js').PlayerState} ps
 */
export function applyCard(m, ps, card) {
  const targets = card.kind === 'tactic' && card.team ? [ps, ...m.alivePlayers().filter((p) => p !== ps)] : [ps];
  for (const p of targets) {
    const ev = { card: { ...card }, family: card.family, picker: ps.playerId, forTeammate: p !== ps };
    const handled = m.dispatcher.runKey(p, `choice:${card.id}`, 'onChoicePick', { kind: 'choice', card }, ev);
    if (!handled) applyDefault(m, p, card);
    // every other source observes the pick (the card's own key already ran above)
    m.dispatch(p, 'onChoicePick', ev, { skipKey: `choice:${card.id}` });
    p.recompute();
  }
}

function applyDefault(m, ps, card) {
  const gd = m.gd;
  // 炸惊模拟 惊变阶段: a 惊变 card carries no effects.json record — it is its own mechanic. It lands in the player's
  // effects column (so 已选惊变 and the battle side can both read it) under the `jibian:` key prefix, which
  // server/sim/content/jibian.js resolves through the `jibian:<effectId>` prepare/settle handlers. Picking the same card
  // twice stacks (each ref has its own uid).
  if (card.kind === 'jibian') {
    addRef(ps, card, null, `jibian:${card.id}`, {
      battle: true,
      extra: {
        jibian: true,
        rarity: card.rarity ?? null,
        flavor: card.flavor ?? null,
        ...(card.bond ? { bond: card.bond } : null),
        ...(card.iconBond ? { iconBond: card.iconBond } : null),
      },
    });
    return;
  }
  if (card.kind === 'bounty') {
    const src = (gd.choices.cards && Array.isArray(gd.choices.cards.bounty) ? gd.choices.cards.bounty : []).find((c) => c.effectId === card.id) || card;
    m.addBounty(ps, src);
    return;
  }
  if (card.kind === 'item') {
    ps.acquireItem(card.id, { source: 'choice' });
    return;
  }
  if (card.kind !== 'tactic') return;
  const eff = gd.effect(card.id);
  const buffs = eff && Array.isArray(eff.buffs) ? eff.buffs : [];
  let handled = false;
  let battle = false;
  for (const b of buffs) {
    const bb = b.bb || {};
    const bs = b.bbStr || {};
    const count = Number.isInteger(bb.count) ? bb.count : 1;
    switch (b.key) {
      case 'global_special_choice_gain_equip': {
        const gain = Math.min(PLUGIN_GAIN_COUNT_MAX, count);
        for (let i = 0; i < gain; i++) {
          const id = m.rollItemId({ pool: bs.pool });
          if (id) ps.acquireItem(id, { source: 'choice' });
        }
        handled = true;
        break;
      }
      case 'global_special_choice_bond_addlayer': {
        const bonds = String(bs.bond_list || '').split(',').map((s) => s.trim()).filter(Boolean);
        for (const bid of bonds) ps.addLayers(bid, count, { requireActive: false, reason: 'choice' });
        handled = true;
        break;
      }
      case 'global_special_choice_gain_coin':
        ps.addFunds(count, { reason: 'choice' });
        handled = true;
        break;
      case 'global_special_choice_refresh_free':
        ps.shop.freeRefreshes += count;
        ps.dirty();
        handled = true;
        break;
      case 'single_special_choice_gloden_equip_chess':
        addRef(ps, card, eff, 'effect:builtin_next_buy_golden_item', { counter: count, battle: false });
        handled = true;
        break;
      case 'single_special_choice_gloden_char_chess':
        addRef(ps, card, eff, 'effect:builtin_next_buy_elite', { counter: count, battle: false });
        handled = true;
        break;
      case 'single_special_choice_gain_bond_chess': {
        // the player's 自选 stock joins the draw, its bonds read through the player's view (player/diy.js diyStockEntries)
        const pgd = ps.gd || gd;
        const hasBond = (cid) => { const c = pgd.chess(cid); return !!(c && Array.isArray(c.bonds) && c.bonds.includes(bs.bond)); };
        // 炸惊模拟 · 卡池预选: this player's bans remove a chess whose bonds are all banned from the 按盟约 special refresh too
        // (the shop's chess slots were the only filtered draw, audit rules §1). null when nothing is banned.
        const ban = typeof ps.chessBanFilter === 'function' ? ps.chessBanFilter() : null;
        const pickable = ban ? (cid) => hasBond(cid) && ban(cid) : hasBond;
        const gain = Math.min(PLUGIN_GAIN_COUNT_MAX, count);
        for (let i = 0; i < gain; i++) {
          const extra = typeof ps.diyStockEntries === 'function' ? ps.diyStockEntries() : null;
          // 队内共用 / 队间独立 (TWELVE_PLAYER_MODE §2): the grant draws the player's TEAM pool above MAX_SEATS
          const id = m.poolFor(ps).roll(m.rngMeta, { maxTier: Math.max(1, ps.shop.level), filter: pickable, extra })
            || m.poolFor(ps).roll(m.rngMeta, { maxTier: 6, filter: pickable, extra });
          if (id) ps.acquireChess(id, { source: 'choice' });
        }
        handled = true;
        break;
      }
      case 'auto_chess_change_map': {
        for (const [alias, v] of Object.entries(bb)) if (alias.includes('#')) ps.deviceOverrides[alias] = Number(v) !== 0;
        ps.invalidateDeployMap();
        battle = true;
        break;
      }
      case 'global_special_choice_all_activated':
        break;
      default:
        battle = true;
    }
  }
  if (battle || !handled) addRef(ps, card, eff, `choice:${card.id}`, { battle: true });
}

function addRef(ps, card, eff, key, { counter = null, battle = true, extra = null } = {}) {
  const id = `${card.id}#${ps.m.nextUid()}`;
  ps.effects.push({
    id, key, name: card.name, desc: card.desc, iconKind: card.team ? 'team' : 'choice', iconId: eff && eff.decoIconId ? eff.decoIconId : card.id,
    counter, battle, params: eff && eff.params ? { ...eff.params } : {}, data: { effectId: card.id, tacticKind: card.tacticKind ?? null },
    ...(extra && typeof extra === 'object' ? extra : null),
  });
  ps.dirty();
}

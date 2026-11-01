// server/sim/content/relics.js — 湮灭模拟 · 藏品, battle half.
//
// The match computes each player's relicMods (PlayerRound.battleInput: ally / allyElite / enemy / enemyElite / enemyBoss
// fractions, the counts, and the "rules" code below handles) from data/relics.json + the player's counters. This module
// only applies them through the public Battle API, so the client's re-simulation (the same file is served at /sim/) agrees.
//
// Ally atk/def/hp are percentages (atkPct / defPct / hpPct); enemy stats are *Mul buffs added at spawn; ASPD is additive;
// damage dealt / taken are *Mul.

import { passiveBuff, isElite, playerOps } from './support/index.js';
import { tileKeyOf } from '../targeting.js';
import { DEPLOY_PROTECT } from '../constants.js';

const rankOf = (e) => String((e && e.def && e.def.rank) || 'NORMAL').toUpperCase();
const isRanged = (u) => !!(u && u.def && u.def.position === 'RANGED');

function baseBuffMods(m) {
  const out = {};
  if (m.atk) out.atkPct = m.atk;
  if (m.def) out.defPct = m.def;
  if (m.hp) out.hpPct = m.hp;
  if (m.aspd) out.aspd = m.aspd;
  if (m.resFlat) out.resFlat = m.resFlat;
  if (m.dmgDealt) out.dmgDealtMul = 1 + m.dmgDealt;
  if (m.spRegen) out.spRecoveryMul = Math.max(0, 1 + m.spRegen);
  return out;
}

function enemyBuffMods(e) {
  const out = {};
  if (e.atk) out.atkMul = 1 + e.atk;
  if (e.def) out.defMul = 1 + e.def;
  if (e.hp) out.hpMul = 1 + e.hp;
  if (e.aspd) out.aspd = e.aspd;
  if (e.res) out.resMul = 1 + e.res;
  if (e.move) out.moveMul = 1 + e.move;
  return out;
}

export function install(battle) {
  const entries = [];
  for (const ps of battle.players || []) {
    const mods = ps && ps.input && ps.input.relicMods;
    if (mods) entries.push({ ps, pid: ps.playerId, mods });
  }
  if (!entries.length) return;
  for (const e of entries) setupPlayer(battle, e.ps, e.pid, e.mods);
}

function setupPlayer(battle, ps, pid, mods) {
  const ally = mods.ally || {};
  const elite = mods.allyElite || {};
  const rules = mods.rules || {};
  const key = (suffix) => 'relic:' + pid + ':' + suffix;
  const base = baseBuffMods(ally);
  const eliteMods = baseBuffMods(elite);
  const hasBase = Object.keys(base).length > 0;
  const hasElite = Object.keys(eliteMods).length > 0;
  const st = { fog: new Map(), ramp: 0, dpHp: false, spStacks: new Map(), stunArmed: false };

  const ops = () => playerOps(battle, pid);

  const addBase = (u) => {
    if (!u || u.kind !== 'op' || u.ownerId !== pid) return;
    if (hasBase) passiveBuff(battle, u, key('base'), base);
    if (hasElite && isElite(u)) passiveBuff(battle, u, key('elite'), eliteMods);
    // 迷彩 is a buff FLAG (buffs.js FLAG_KEYS), not a numeric mod: aggregateMods drops a boolean out of `mods`, so it has
    // to go through addBuff's `flags` — otherwise ranged enemies keep selecting the operator regardless (targeting.js
    // canTargetAlly reads s.flags.camou).
    if (rules.camoRanged && isRanged(u)) passiveBuff(battle, u, key('camo'), null, { flags: { camou: true } });
  };

  // 犬植浆: allies inside an operator's attack range get camo + 10% atk, stacking per covering operator
  if (rules.camoAura) {
    const per = Number.isFinite(rules.camoAura.atk) ? rules.camoAura.atk : 0.1;
    const apply = () => {
      const list = (playerOps(battle, pid) || []).filter((x) => x && x.alive && x.deployed);
      for (const x of list) {
        let n = 0;
        for (const v of list) if (v !== x && v.rangeKeySet && v.rangeKeySet.has(tileKeyOf(x))) n++;
        // the stacks are per covering operator: a withdrawn / killed one drops its share (deploy and death re-run this)
        if (n > 0) passiveBuff(battle, x, key('camo-aura'), { atkPct: per * n }, { flags: { camou: true } });
        else battle.removeBuff(x, key('camo-aura'));
      }
    };
    battle.on('deploy', apply);
    battle.on('death', (ctx) => { if (!ctx || !ctx.unit || ctx.unit.side !== 'enemy') apply(); });
    apply();
  }

  const neighborhood = (u) => {
    let n = 0;
    for (const off of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const r = u.tileR + off[0], c = u.tileC + off[1];
      for (const a of battle.allyUnits) if (a && a.alive && a.deployed && a.kind !== 'device' && a.tileR === r && a.tileC === c && a.ownerId === pid) { n++; break; }
    }
    return n;
  };

  const applyAuras = (u) => {
    if (!u || u.kind !== 'op' || u.ownerId !== pid) return;
    const n = neighborhood(u);
    if (Number.isFinite(rules.atkPerNeighbor)) passiveBuff(battle, u, key('neighbor-atk'), { atkPct: rules.atkPerNeighbor * n });
    if (Number.isFinite(rules.aspdPerNeighbor)) passiveBuff(battle, u, key('neighbor-aspd'), { aspd: rules.aspdPerNeighbor * n });
  };

  const syncShelter = (u) => {
    if (!u || u.kind !== 'op' || u.ownerId !== pid || !rules.shelter) return;
    const s = rules.shelter;
    const low = s.low > 0 && u.hp < (u.s.maxHp || 0) * (s.threshold || 0.5);
    passiveBuff(battle, u, key('shelter'), { dmgTakenMul: 1 - (low ? s.low : s.base) });
  };

  battle.on('battleStart', () => {
    for (const u of ops()) {
      addBase(u);
      applyAuras(u);
      syncShelter(u);
    }
    if (rules.survivor) {
      const list = ops().filter((u) => u.alive && u.deployed);
      let best = null;
      for (const u of list) if (!best || (u.s.atk || 0) > (best.s.atk || 0)) best = u;
      if (best) {
        const n = 1 + Math.max(0, rules.survivor.stacks || 0);
        passiveBuff(battle, best, key('survivor'), { atkPct: (rules.survivor.per || 0.2) * n, defPct: (rules.survivor.per || 0.2) * n });
      }
    }
    if (rules.spInit) {
      // the skill's 技力, not the Unit's read-only sp getter (units.js get sp())
      for (const u of ops()) if (u.alive && u.skill) u.skill.sp = Math.max(0, (u.skill.sp || 0) + rules.spInit);
    }
    if (rules.startDebuff) {
      const sb = rules.startDebuff;
      for (const u of ops()) {
        if (!u.alive || !u.deployed) continue;
        const m = {};
        if (sb.atkPct) m.atkMul = 1 + sb.atkPct;
        if (sb.aspd) m.aspd = sb.aspd;
        if (sb.spRegen) m.spRecoveryMul = Math.max(0, 1 + sb.spRegen);
        battle.addBuff(u, { key: key('startdebuff'), mods: m, duration: sb.dur || 10 });
      }
    }
    if (rules.openingDebuff && rules.openingDebuff.count > 0) {
      const list = ops().filter((u) => u.alive && u.deployed);
      const n = Math.min(list.length, rules.openingDebuff.count);
      const picks = battle.rng ? list.slice().sort(() => battle.rng() - 0.5).slice(0, n) : list.slice(0, n);
      const kinds = ['stun', 'freeze', 'neural', 'erosion'];
      picks.forEach((u, i) => {
        const k = kinds[i % kinds.length];
        if (k === 'stun') battle.applyStatus(u, 'stun', { duration: 10 });
        else if (k === 'freeze') battle.applyStatus(u, 'freeze', { duration: 10 });
        else battle.dealDamage(null, u, { amount: 1000, type: 'element', element: k, canDodge: false, sourceless: true, tags: ['dot', 'relic'] });
      });
    }
    if (rules.neuralDps > 0) {
      battle.every(1, () => {
        if (battle.finished) return;
        for (const u of ops()) {
          if (!u.alive || !u.deployed) continue;
          battle.dealDamage(null, u, { amount: rules.neuralDps, type: 'element', element: 'neural', canDodge: false, sourceless: true, tags: ['dot', 'periodic', 'relic'] });
        }
      }, { immediate: false });
    }
  }, { priority: -20 });

  battle.on('deploy', (ctx) => {
    const u = ctx && ctx.unit;
    if (!u || u.kind !== 'op' || u.ownerId !== pid) return;
    addBase(u);
    applyAuras(u);
    syncShelter(u);
    if (rules.spOnDeploy && u.skill) u.skill.sp = Math.max(0, (u.skill.sp || 0) + rules.spOnDeploy);
    if (rules.spInit && u.skill) u.skill.sp = Math.max(0, (u.skill.sp || 0) + rules.spInit);
    if (rules.stunOnDeploy) {
      const r = rules.stunOnDeploy;
      // n19 「未尽的生命」: the opening batch fires ONE draw for the whole batch, and a later redeploy stuns only the unit
      // that just came in. Drawing per deploy event made a 7-unit opening stun 7 units (every deployment re-picked
      // `count` at random) and made one operator's redeploy stun bystanders — the Annihilation mod's v3.2.0 fix, kept
      // here. `ctx.initial` is the opening batch; `ctx.move` is 【移动】(tiles.js moveRedeploy), which is not a redeploy.
      if (ctx.initial) {
        if (!st.stunArmed) {
          st.stunArmed = true;
          battle.after(DEPLOY_PROTECT + 0.05, () => {
            st.stunArmed = false;
            if (battle.finished) return;
            const count = Math.max(1, Math.min(r.max || 4, (r.count || 1) + Math.max(0, (battle.round || 1) - (r.fromRound || 1)) * (r.perRound || 0)));
            const all = ops().filter((x) => x.alive && x.deployed);
            // cap by the units ALREADY stunned, so the batch never pushes past `count` in total; a stunned unit is not
            // picked again. Counted by buff `key` — `s.flags.stun` also covers freeze / sleep / levitate.
            const isStunned = (x) => !!(x.buffs && x.buffs.some((b) => b.key === 'stun'));
            const active = all.filter(isStunned).length;
            const room = Math.max(0, count - active);
            const free = all.filter((x) => !isStunned(x));
            if (!room || !free.length) return;
            const picks = battle.rng ? battle.rng.shuffle(free).slice(0, room) : free.slice(0, room);
            for (const x of picks) battle.applyStatus(x, 'stun', { duration: r.dur || 10 });
          });
        }
      } else if (!ctx.move) {
        // a redeploy (突袭 retreat and return, a knocked-out operator coming back) stuns only the unit itself
        const unit = u;
        const seq = unit.deploySeq;
        battle.after(DEPLOY_PROTECT + 0.05, () => {
          if (battle.finished || !unit.alive || !unit.deployed || unit.deploySeq !== seq) return;
          battle.applyStatus(unit, 'stun', { duration: Number.isFinite(r.redeployDur) ? r.redeployDur : 5 });
        });
      }
    }
    if (rules.fogOnDeploy) st.fog.set(u.uid, battle.time + (rules.fogOnDeploy.dur || 60));
  }, { priority: 40 });

  battle.every(1, () => {
    if (battle.finished) return;
    if (rules.fogOnDeploy) {
      const ratio = rules.fogOnDeploy.ratio || 0.02;
      for (const u of ops()) {
        const until = st.fog.get(u.uid);
        if (!until || battle.time > until) { if (until) st.fog.delete(u.uid); continue; }
        if (!u.alive || !u.deployed) continue;
        const amount = (u.s.maxHp || 0) * ratio;
        if (amount > 0) battle.dealDamage(null, u, { amount, type: 'true', canDodge: false, sourceless: true, noSp: true, tags: ['dot', 'periodic', 'relic'] });
      }
    }
    if (rules.hpIfDp && !st.dpHp) {
      const pp = battle.getPlayer(pid);
      if (pp && Number(pp.dp) >= (rules.hpIfDp.dp || 50)) {
        st.dpHp = true;
        for (const u of ops()) if (u.alive) passiveBuff(battle, u, key('dp-hp'), { hpPct: rules.hpIfDp.hp || 1.5 });
      }
    }
  }, { immediate: false });

  battle.on('enemySpawn', (ctx) => {
    const e = ctx && ctx.enemy;
    if (!e || !e.alive) return;
    const all = mods.enemy || {};
    const rank = rankOf(e);
    const add = (m) => { const b = enemyBuffMods(m); if (Object.keys(b).length) battle.addBuff(e, { key: key('enemy'), mods: b, persist: true, refresh: 'replace' }); };
    add(all);
    if (rank === 'ELITE') add(mods.enemyElite || {});
    if (rank === 'BOSS') add(mods.enemyBoss || {});
    if (rules.enemyDmgTaken) passiveBuff(battle, e, key('dmg-taken'), { physTakenMul: 1 - rules.enemyDmgTaken.phys, artsTakenMul: 1 - rules.enemyDmgTaken.arts });
    if (rules.spawnHpChance && battle.rng && battle.rng() < rules.spawnHpChance.p) passiveBuff(battle, e, key('spawn-hp'), { hpMul: 1 + rules.spawnHpChance.extra });
    if (rules.eliteDmgReduce && (rank === 'ELITE' || rank === 'BOSS')) {
      battle.addBuff(e, { key: key('elite-reduce'), mods: { physTakenMul: rules.eliteDmgReduce.mul, artsTakenMul: rules.eliteDmgReduce.mul }, duration: rules.eliteDmgReduce.dur || 30 });
    }
    if (rules.enemyDefShred) passiveBuff(battle, e, key('godu'), { defFlat: rules.enemyDefShred.flat });
    for (let i = 0; i < st.ramp; i++) battle.addBuff(e, { key: key('ramp' + i), mods: { atkMul: 1 + rules.enemyRamp.step, hpMul: 1 + rules.enemyRamp.step, defMul: 1 + rules.enemyRamp.step, resMul: 1 + rules.enemyRamp.step }, persist: true });
  }, { priority: 50 });

  battle.on('damaged', (ctx) => {
    const t = ctx && ctx.target;
    if (!t) return;
    if (t.side === 'ally' && t.kind === 'op' && t.ownerId === pid && rules.shelter) syncShelter(t);
    if (t.side === 'enemy' && ctx.amount > 0 && rules.enemyDefShred) {
      const mem = t.mem || (t.mem = {});
      const n = Math.min(rules.enemyDefShred.max, (mem.relicGoduHits || 0) + 1);
      if (n !== mem.relicGoduHits) {
        mem.relicGoduHits = n;
        const left = Math.max(0, rules.enemyDefShred.flat + rules.enemyDefShred.perHit * n);
        passiveBuff(battle, t, key('godu'), { defFlat: left });
      }
    }
  }, { priority: 60 });

  if (rules.enemyRamp) {
    battle.every(rules.enemyRamp.every || 10, () => {
      if (battle.finished) return;
      if (st.ramp >= (rules.enemyRamp.max || 0.5) / (rules.enemyRamp.step || 0.1)) return;
      st.ramp++;
      for (const e of battle.enemies) {
        if (!e || !e.alive) continue;
        battle.addBuff(e, { key: key('ramp' + (st.ramp - 1)), mods: { atkMul: 1 + rules.enemyRamp.step, hpMul: 1 + rules.enemyRamp.step, defMul: 1 + rules.enemyRamp.step, resMul: 1 + rules.enemyRamp.step }, persist: true });
      }
    }, { immediate: false });
  }

  if (rules.atkAfterSkill) {
    battle.on('skillStart', (ctx) => {
      const u = ctx && ctx.unit;
      if (!u || u.kind !== 'op' || u.ownerId !== pid) return;
      battle.addBuff(u, { key: key('skill-atk'), mods: { atkPct: (rules.atkAfterSkill.mul || 1.04) - 1 }, duration: rules.atkAfterSkill.window || 1, refresh: 'replace' });
    });
  }

  if (rules.spRegenStack) {
    battle.on('skillStart', (ctx) => {
      const u = ctx && ctx.unit;
      if (!u || u.kind !== 'op' || u.ownerId !== pid) return;
      const n = Math.min(rules.spRegenStack.max || 5, (st.spStacks.get(u.uid) || 0) + 1);
      st.spStacks.set(u.uid, n);
      passiveBuff(battle, u, key('sp-stack'), { spRecoveryFlat: (rules.spRegenStack.per || 0.4) * n });
    });
  }

  if (rules.statusDuration) {
    battle.on('beforeStatus', (ctx) => {
      if (!ctx || !ctx.target || ctx.target.side !== 'enemy') return;
      const src = ctx.source;
      if (!src || src.ownerId !== pid) return;
      if (['stun', 'cold', 'freeze', 'sleep', 'fear', 'levitate'].indexOf(ctx.status) < 0) return;
      if (Number.isFinite(ctx.duration)) ctx.duration *= 1 + rules.statusDuration;
    });
  }

  if (rules.shelterOnDebuff) {
    let fired = false;
    battle.on('statusApplied', (ctx) => {
      if (fired || !ctx || ctx.target.side !== 'ally' || ctx.target.ownerId !== pid) return;
      if (['stun', 'freeze', 'cold', 'sleep', 'fear', 'silence', 'disarm'].indexOf(ctx.status) < 0) return;
      fired = true;
      const m = { dmgTakenMul: 1 - rules.shelterOnDebuff.mul, resIgnorePct: rules.shelterOnDebuff.ignore, defIgnorePct: rules.shelterOnDebuff.ignore };
      for (const u of ops()) passiveBuff(battle, u, key('gene-shelter'), m);
    });
  }
}

// ---- prep side: income / prices / counters (registered as global:annihilation_relics; the match sets ps.relics) ----

/** Sum of a numeric key over the owned relics' fx.price. */
function priceDelta(ctx, slot) {
  const state = ctx.relics ? ctx.relics() : null;
  const d = ctx.data && ctx.data.relics;
  if (!state || !d || !slot) return 0;
  const kind = slot.kind;
  const rec = kind === 'chess' ? ctx.gd.chess(slot.id) : ctx.gd.item(slot.id);
  const tier = rec && Number.isInteger(rec.tier) ? rec.tier : 0;
  const buys = (ctx.roundStats() && ctx.roundStats().buys) || 0;
  const round = ctx.round;
  let delta = 0;
  for (const id of state.owned || []) {
    const def = d.relics[id];
    const px = def && def.fx && def.fx.price;
    // 国王的水晶 (p21): 干员价格 -1 也写在 fx.rule 里（和 income 同一个 rule 块）
    const rule = def && def.fx && def.fx.rule;
    if (rule && rule.id === 'kingCrystal' && Number.isFinite(rule.priceChess) && kind === 'chess') delta += rule.priceChess;
    if (!px) continue;
    // chessAll / item are DISCOUNTS: PlayerState.priceOf applies them after every surcharge / bond / garrison
    // handler, so a negative-price relic cannot be overwritten by a later price rule.
    if (Number.isFinite(px.chessTier4) && kind === 'chess' && tier >= 4) delta += px.chessTier4;
    if (Number.isFinite(px.chessTier5) && kind === 'chess' && tier >= 5) delta += px.chessTier5;
    if (Number.isFinite(px.firstChessBuy) && kind === 'chess' && buys === 0) delta += px.firstChessBuy;
    if (Number.isFinite(px.firstChessBuys) && kind === 'chess' && buys < px.firstChessBuys) delta += px.n || 1;
    if (Number.isFinite(px.oddRoundTier4) && kind === 'chess' && tier >= 4 && round % 2 === 1) delta += px.oddRoundTier4;
    if (Number.isFinite(px.evenRoundItem) && kind === 'item' && round % 2 === 0) delta += px.evenRoundItem;
  }
  return delta;
}

export function registerMeta(registry) {
  registry.global('annihilation_relics', {
    onIncome(ctx, ev) {
      const state = ctx.relics ? ctx.relics() : null;
      const d = ctx.data && ctx.data.relics;
      if (!state || !d || !ev) return;
      let add = 0;
      for (const id of state.owned || []) {
        const def = d.relics[id];
        if (def && def.fx && Number.isFinite(def.fx.income)) add += def.fx.income;
        // 国王的水晶 (p21): 「休整期资金 +5」写在 fx.rule 里，不在 fx.income —— 以前这条从来没加到收入上
        const rule = def && def.fx && def.fx.rule;
        if (rule && rule.id === 'kingCrystal' && Number.isFinite(rule.income)) add += rule.income;
      }
      if (add) ev.income = Math.max(0, (Number(ev.income) || 0) + add);
    },
    // 无限续杯瓶 / 迷幻的藏宝图: 完成一次决策（选择一张卡）时资金额外 +1 / +2
    onChoicePick(ctx) {
      const state = ctx.relics ? ctx.relics() : null;
      const d = ctx.data && ctx.data.relics;
      if (!state || !d) return;
      let add = 0;
      for (const id of state.owned || []) {
        const def = d.relics[id];
        if (def && def.fx && Number.isFinite(def.fx.choiceIncome)) add += def.fx.choiceIncome;
      }
      if (add) ctx.addFunds(add, 'relic-choice');
    },
    onPrice(ctx, ev) {
      if (!ev || typeof ev.price !== 'number') return;
      const delta = priceDelta(ctx, ev.slot || { kind: ev.kind, id: ev.id });
      if (delta) ev.price = Math.max(0, ev.price + delta);
    },
    onRefresh(ctx, ev) {
      const state = ctx.relics ? ctx.relics() : null;
      if (state && ev && ev.free !== true) state.counters.paidRefreshes = (state.counters.paidRefreshes || 0) + 1;
    },
    onBuy(ctx, ev) {
      const state = ctx.relics ? ctx.relics() : null;
      if (!state || !ev || !ev.slot) return;
      const rec = ev.slot.kind === 'chess' ? ctx.gd.chess(ev.slot.id) : null;
      if (rec && Number.isInteger(rec.tier) && rec.tier >= 4) {
        state.counters.tier4Buys = (state.counters.tier4Buys || 0) + 1;
      }
    },
    onBattleResult(ctx, ev) {
      const state = ctx.relics ? ctx.relics() : null;
      if (!state) return;
      if (ev && ev.perfect) state.counters.perfects = (state.counters.perfects || 0) + 1;
      // 完成悬赏（v3.2.0 口径）：一场战斗最多 1 次，由 settle.js 的 onBattleResult 载荷带过来（bountyDone 0/1）。
      // 两个计数器同值：bountyDone 给乌萨斯那条 rule 用，bountyKills 是旧名（p39 仇名录、图鉴「已完成悬赏 N 次」读它）。
      const done = Math.max(0, Math.trunc(Number(ev && ev.bountyDone) || 0));
      if (done) {
        state.counters.bountyDone = (state.counters.bountyDone || 0) + done;
        state.counters.bountyKills = (state.counters.bountyKills || 0) + done;
        // 铿金征鼓 (p34): 「若完成悬赏，则额外获得 1 次叠加次数」—— 以前挂在 perfect 上，而完美作战不等于完成悬赏
        if (state.owned.includes('p34')) state.counters.atkRoundStacks = Math.min(10, (state.counters.atkRoundStacks || 0) + done);
      }
      // 生还者合约 (p12): 「每次战斗结束后（**不包括联防**）」—— 联防那一场不该再叠一层
      if (state.owned.includes('p12') && !(ev && ev.unite)) state.counters.survivorStacks = (state.counters.survivorStacks || 0) + 1;
    },
    onMerge(ctx, ev) {
      const state = ctx.relics ? ctx.relics() : null;
      if (!state || !ev || !ev.piece) return;
      const rec = ctx.gd.chess(ev.piece.id);
      if (rec && Number.isInteger(rec.tier) && rec.tier >= 4) state.counters.eliteMerges = Math.min(4, (state.counters.eliteMerges || 0) + 1);
    },
  });
}

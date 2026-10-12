// server/sim/content/kits/ops/chess_char_6_07-siege2.js — 维娜·维多利亚 (char_1019_siege2) kit, tier 6.
// Conventions of the tier-6 kits: ../shared/tier6.js; kit contract and rules: ../README.md.

import {
  num, tbb, moduleBb, live, isElite, keyOf, onDefaultSkill, selectedSkill, batOf, skillGridOf, N4, freeTiles, aura,
} from '../shared/tier6.js';

// ------------------------------------------------------------------------------------------------------------------
// 维娜·维多利亚 chess_char_6_07 (术战者) — S3 俱以我之名; 诸王的叹息; 无拘的锋芒; module 城主的冒险

function siege2(bb, chess, def) {
  const t0 = tbb(def, 0), t1 = tbb(def, 1), tb = def?.traitBb || {}, mod = moduleBb(chess);
  const isDef = onDefaultSkill(chess), sid = selectedSkill(chess, def);
  const tGrid = def?.talents?.[0]?.rangeGrid?.length ? def.talents[0].rangeGrid : [[1, -1], [1, 0], [1, 1], [0, -1], [0, 0], [0, 1], [-1, -1], [-1, 0], [-1, 1]];
  const tokId = (chess?.tokens || []).find((t) => /vlion/.test(String(t))) || 'token_10040_siege2_vlion';
  const mine = (u, unit) => u === unit || (!!u && u.kind === 'token' && u.ownerUnit === unit);
  const skills = {
    // S1 重铸晖光: the next attack also deals atk_scale × ATK true damage to every ground enemy on the skill's 4
    // surrounding tiles (+ her own)
    skchr_siege2_1: {
      kind: 'instant',
      attack: {
        onHit({ battle, unit }) {
          for (const e of battle.unitsInGrid(unit, skillGridOf(def) || N4, { side: 'enemy' })) {
            if (!e.isFlying && e.alive) battle.dealDamage(unit, e, { amount: unit.s.atk * num(bb.atk_scale), type: 'true', isSkill: true, tags: ['skill'] });
          }
          battle.fx('aoe', { x: unit.x, y: unit.y, id: unit.id });
        },
      },
    },
    // S2 进赴故土 (toggle): range +1 (skill grid), ATK +atk, one extra target; passive: ≥buff_stack_cnt other allies in
    // the talent-1 area ⇒ SP +sp_recovery_per_sec (install)
    skchr_siege2_2: {
      kind: 'toggle',
      mods: { atkPct: num(bb.atk) },
      targeting: { maxTargets: Math.max(1, Math.floor(num(bb['attack@max_target'], 2))), ...(skillGridOf(def) ? { rangeGrid: skillGridOf(def) } : {}) },
    },
  };
  return {
    skills,
    install(battle, unit) {
      if (sid === 'skchr_siege2_2') {
        const need = Math.max(1, Math.floor(num(bb.buff_stack_cnt, 2))), spr = num(bb.sp_recovery_per_sec);
        if (spr > 0) aura(battle, unit, 0.25, () => {
          const n = battle.unitsInGrid(unit, tGrid, { side: 'ally' }).filter((a) => a !== unit && a.kind !== 'device' && battle.allySelectable(a, unit)).length;
          if (n >= need) battle.addBuff(unit, { key: 'siege2:homeland', mods: { spRecoveryFlat: spr }, duration: 0.4, refresh: 'replace' });
        });
      }
      // module 秩序圣“球”: enemies blocked by her or her summons take 10 % 脆弱 (trait); she and her summons deal ×1.15 to
      // 战栗 targets (talent)
      const frag = num(tb.damage_scale, 1) - 1, tremMul = num(mod.damage_scale, 1);
      if (frag > 0) aura(battle, unit, 0.25, () => {
        for (const e of battle.enemies) if (e.alive && e.blockedBy && mine(e.blockedBy, unit)) battle.applyStatus(e, 'fragile', { duration: 0.4, value: frag, source: unit });
      });
      if (tremMul > 1) battle.on('hit', (ctx) => {
        const t = ctx.target;
        if (!mine(ctx.source, unit) || !t || t.side !== 'enemy' || !(t.findBuff('tremble') || t.s.flags.tremble)) return;
        ctx.dmg.mul *= tremMul;
      }, { owner: unit });
    },
    skill: {
      kind: 'duration',
      mods: { atkPct: num(bb.atk), batPct: batOf(bb.base_attack_time, def) },
      targeting: { maxTargets: Math.max(1, Math.floor(num(bb['attack@max_target'], 1))) },
      attack: { dmgType: 'true' },
      // "立即在天赋一生效范围内可部署地面召唤“黄金盟誓”" (EN client "Summons Golden Vows on deployable tiles within
      // Talent 1's range"): one on EVERY free tile of the talent-1 area a melee piece could be deployed on — fences
      // (low, deployable, not walkable) included [ASSUMED: the EN wiki's "open low ground tiles"]; player report B3
      onStart({ battle, unit, skill }) {
        const lions = [];
        for (const tile of freeTiles(battle, unit, tGrid, { ground: false })) {
          const lion = battle.spawnToken(unit, tokId, tile[0], tile[1], { duration: skill.timeLeft });
          if (!lion) continue;
          lions.push(lion);
          if (!lion.kit?.fromTokens && lion.profile) lion.profile.dmgType = 'true'; // "攻击造成真实伤害" without a token kit
          battle.fx('summon', { x: lion.x, y: lion.y, id: lion.id, src: unit.id });
        }
        unit.mem.vlions = lions;
      },
      onEnd({ battle, unit }) {
        const lions = unit.mem.vlions || [];
        unit.mem.vlions = null;
        for (const lion of lions) if (lion.alive) battle.retreat(lion, { reason: 'expired', permanent: true });
        battle.setExtraRange(unit, null);
      },
    },
    talents: [
      { install(battle, unit) { // S3: enemies blocked by allies inside the talent area become targetable
        let sig = '';
        if (!isDef) return;
        battle.on('tick', () => { // (engine extra range keys: kept across range rebuilds, cleared at the skill end)
          if (!live(unit) || !unit.skill?.active) { sig = ''; return; }
          const keys = [];
          for (const a of battle.unitsInGrid(unit, tGrid, { side: 'ally' })) for (const e of a.blocking) if (e.alive) keys.push(keyOf(e));
          const s = keys.join(',');
          if (s === sig) return;
          sig = s;
          battle.setExtraRange(unit, keys);
        }, { owner: unit });
      } },
      { install(battle, unit) { // 诸王的叹息
        const dr = num(t0.damage_resistance), atk = num(t0.atk);
        aura(battle, unit, 0.25, () => {
          const allies = battle.unitsInGrid(unit, tGrid, { side: 'ally' }).filter((a) => a.kind !== 'device' && battle.allySelectable(a, unit));
          if (!allies.includes(unit)) allies.push(unit);
          if (dr > 0) for (const a of allies) battle.addBuff(a, { key: 'siege2:sigh', mods: { physTakenMul: 1 - dr }, duration: 0.4, refresh: 'replace' });
          const n = allies.filter((a) => a !== unit).length;
          if (n > 0 && atk) battle.addBuff(unit, { key: 'siege2:kings', mods: { atkPct: atk * n }, duration: 0.4, refresh: 'replace' });
        });
      } },
      { install(battle, unit) { // 无拘的锋芒: first damage on each enemy ⇒ 战栗 (module 秩序圣“球”: 6 s, elite / leader 12 s)
        const durN = num(t1.not_combat_normal, num(t1.not_combat)), durE = num(t1.not_combat_elite, durN);
        const seen = new WeakSet();
        battle.on('damaged', (ctx) => {
          const t = ctx.target;
          if (ctx.source !== unit || !t || t.side !== 'enemy' || seen.has(t)) return;
          const dur = isElite(t) ? durE : durN;
          if (!(dur > 0)) return;
          seen.add(t);
          if (t.alive) battle.applyStatus(t, 'tremble', { duration: dur, source: unit });
        }, { owner: unit });
      } },
      { install(battle, unit) { // elite module: ASPD +8 while not blocking
        const as = num(tb.attack_speed);
        if (as) aura(battle, unit, 0.25, () => { if (!unit.blocking.length) battle.addBuff(unit, { key: 'siege2:free', mods: { aspd: as }, duration: 0.4, refresh: 'replace' }); });
      } },
    ],
  };
}

export default {
  chess_char_6_07_a: siege2,
};

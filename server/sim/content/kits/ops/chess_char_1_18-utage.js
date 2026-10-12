// server/sim/content/kits/ops/chess_char_1_18-utage.js — 宴 (char_337_utage) kit, tier 1.
// Conventions of the tier-1 kits: ../shared/tier1.js; kit contract and rules: ../README.md.

import { num, talentBb, up, onHitBy, onHitOn, skillBbOf, holdProtect, PROTECT_TICK_HOLD } from '../shared/tier1.js';

export default {
  // ---------------------------------------------------------------------------------------------------------------
  // 1_18 宴 落地斩·破门 (passive): at each deployment lose hp_ratio of current HP, then for `duration` s ATK +atk and
  // attacks deal arts damage. 认真模式: 坚忍 ASPD up to +min_attack_speed, reached at min_hp_ratio HP (linear).
  // Elite (module talent): below hp_ratio HP, 庇护 −damage_resistance physical/arts damage taken.
  // Alternate S1 分神: stops attacking, block count 0 (her blocked enemies walk on), DEF +def, recovers
  // hp_recovery_per_sec_by_max_hp_ratio × max HP per second (the 生命回复速度 attribute: works under her 武者 no-heal).
  chess_char_1_18_a: (bb, chess) => {
    const t = talentBb(chess, 0);
    const s1 = skillBbOf(chess, 'skchr_utage_1');
    return {
      skills: {
        skchr_utage_1: {
          kind: 'duration',
          mods: { defPct: num(s1.def), hpRegenRatio: num(s1.hp_recovery_per_sec_by_max_hp_ratio), blockCnt: -99 },
          attack: { noAttack: true },
          onStart({ battle, unit }) { battle.releaseBlocked(unit); },
        },
      },
      skill: {
        kind: 'duration', activateOnDeploy: true, duration: num(bb.duration), spCost: 0, spType: 'none', trigger: 'NEVER',
        mods: { atkPct: num(bb.atk) },
        onStart({ battle, unit }) {
          const loss = unit.hp * num(bb.hp_ratio);
          if (loss > 0 && unit.hp - loss >= 1) battle.loseHp(unit, loss, { source: unit });
          battle.fx('aoe', { x: unit.x, y: unit.y, radius: 1, id: unit.id, skill: 'breach' });
        },
      },
      talents: [{ install(battle, unit) {
        onHitBy(battle, unit, ({ dmg }) => { if (dmg.isAttack && dmg.type === 'phys' && unit.skill?.id === 'skchr_utage_2' && unit.skill.active) dmg.type = 'arts'; });
        const maxAs = num(t.min_attack_speed), minHp = num(t.min_hp_ratio);
        if (maxAs > 0 && minHp < 1) {
          battle.on('tick', () => {
            if (!up(unit)) return;
            const v = maxAs * Math.max(0, Math.min(1, (1 - unit.hpRatio) / (1 - minHp)));
            const cur = unit.findBuff('utage:serious');
            if (cur && Math.abs((cur.data?.v ?? 0) - v) < 0.5) return;
            if (v < 0.5) { if (cur) battle.removeBuff(unit, 'utage:serious'); return; }
            battle.addBuff(unit, { key: 'utage:serious', mods: { aspd: v }, data: { v }, tags: ['talent'] });
          }, { owner: unit });
        }
        // 庇护 (ba.protect "受到的物理和法术伤害降低相应比例（同名效果取最高）") while below hp_ratio HP: the shared 庇护 — the
        // strongest of every source holds (holdProtect) —, refreshed every tick and at each hit on her (a hit that takes
        // her below it: the next ones already have it)
        if (t.damage_resistance != null && t.hp_ratio != null) {
          const dr = num(t.damage_resistance), below = num(t.hp_ratio);
          const keep = () => { if (up(unit) && unit.hpRatio < below) holdProtect(battle, unit, dr, PROTECT_TICK_HOLD, unit); };
          battle.on('tick', keep, { owner: unit });
          onHitOn(battle, unit, keep);
        }
      } }],
    };
  },
};

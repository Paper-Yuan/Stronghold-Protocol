// server/sim/content/kits/ops/chess_char_2_05-harold.js — 哈洛德 (char_4114_harold) kit, tier 2.
// Conventions of the tier-2 kits: ../shared/tier2.js; kit contract and rules: ../README.md.

import { COLS, ELEMENT_GAUGE_MAX } from '../../../constants.js';
import { num, talentBb, up } from '../shared/tier1.js';
import { onDefaultSkill } from '../shared/tier2.js';

/** Largest element gauge of a unit (every element — 侵蚀 included: the bosses' attacks fill it on operators). */
const elemLoad = (a) => Math.max(a.elem.burn, a.elem.neural, a.elem.necrosis, a.elem.apoptosis, a.elem.erosion ?? 0);

export default {
  // ---------------------------------------------------------------------------------------------------------------
  // 2_05 哈洛德 重症优先: ASPD +attack_speed, heals the ally with the heaviest element damage first; on targets whose
  // gauge is over half, the element recovery is trait_scale × (the wandermedic trait: ep_heal_ratio × ATK).
  // 我即军营: allies in range whose gauge is over half take −ep_damage_resistance 元素损伤 — checked on the element hit
  // itself (`elementHit`, a 元素损伤 multiplier: PRTS 元素 "…后续可应用元素损伤倍率提升/降低等效果"; not `elemTakenMul`,
  // which is 元素伤害 / 元素脆弱); several 哈洛德 do not stack — the strongest cut applies.
  // S1 治疗强化·γ型 (alt): ATK +atk; the 重症优先 target order belongs to S2 only.
  chess_char_2_05_a: (bb, chess) => {
    const t = talentBb(chess, 0);
    const s2 = onDefaultSkill(chess);
    const half = ELEMENT_GAUGE_MAX / 2;
    const ts = num(bb.trait_scale, 1);
    return {
      skill: {
        kind: 'duration', heal: true, mods: { aspd: num(bb.attack_speed) },
        onHit({ battle, unit, target }) {
          if (!target || !unit.mem.haroldHalf?.has(target.id) || !(ts > 1)) return;
          battle.reduceElement(target, unit.s.atk * (unit.profile.heal?.elementHealRatio ?? 0) * (ts - 1));
        },
      },
      skills: { 'skcom_heal_up[3]': { kind: 'duration', heal: true, mods: { atkPct: num(bb.atk) } } },
      talents: [{ install(battle, unit) {
        if (s2) battle.on('beforeAttack', (ctx) => {
          if (ctx.attacker !== unit || !unit.skill?.active) return;
          const cands = battle.injuredAlliesInKeys(unit.rangeKeys, unit, true);
          cands.sort((a, b) => elemLoad(b) - elemLoad(a) || a.hpRatio - b.hpRatio || a.deploySeq - b.deploySeq);
          if (cands.length) ctx.targets = cands.slice(0, Math.max(1, ctx.targets.length));
          unit.mem.haroldHalf = new Set(ctx.targets.filter((a) => elemLoad(a) > half).map((a) => a.id));
        }, { owner: unit });
        const r = Math.max(0, Math.min(1, num(t.ep_damage_resistance)));
        if (r > 0) {
          battle.on('elementHit', (ctx) => {
            const a = ctx.target, d = ctx.dmg;
            if (!up(unit) || !a || a.side !== 'ally' || !d || d.type !== 'element' || !(elemLoad(a) > half)) return;
            if (!(unit.rangeKeySet || new Set(unit.rangeKeys || [])).has(a.tileR * COLS + a.tileC)) return;
            const prev = d.haroldCut || 0;               // the strongest 我即军营 of the hit only
            if (r <= prev) return;
            d.mul *= (1 - r) / (1 - prev);
            d.haroldCut = r;
          }, { owner: unit, priority: 20 });
        }
      } }],
    };
  },
};

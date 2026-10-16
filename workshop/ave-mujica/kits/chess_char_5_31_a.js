// workshop/ave-mujica/kits/chess_char_5_31_a.js — 祐天寺若麦/Amoris（颂乐人偶 mod）
// 处决者 (SPECIALIST executor): 近战, 再部署快, 物伤。
// S1 如焰般热烈 (duration): 攻击变为三连击（首击溅射），每击 atk×atk_scale 物伤。[ASSUMED]
// S2 如麦般生长 (duration): 攻击范围扩大，攻击变为八连击，每击 atk×atk_scale 物伤。[ASSUMED]
// T1 双利手: 攻击时 prob 概率使敌人获得 fragile 脆弱，持续 fragile_dur 秒（「进行持续攻击」引擎无该开关，未实现）。
// T2 毋畏爱意 / 模组成员增伤: Fever 系统与成员判定由本包盟约安装器（battle/main.mjs 的 installAveMujica）负责，本 kit 不重复。
// 模组 HAM-X「年轻的麦子」: 溅射范围内有 ≥3 个敌人时，使当次攻击力提升至 atk_scale（近似：主目标伤害 ×atk_scale）。
import { num, skillBbOf, talentBb, traitBb, isMainHit, cheb } from '@kit/tier1.js';

const S1 = 'skchr_am_amoris_1';
const S2 = 'skchr_am_amoris_2';

export default (bb, chess) => {
  const b1 = skillBbOf(chess, S1);
  const b2 = skillBbOf(chess, S2);
  const s1 = {
    kind: 'duration',
    duration: num(b1.duration, 15),
    attack: {
      hits: Math.max(1, Math.floor(num(b1.hits, 3))),
      atkScale: num(b1.atk_scale, 1.0),
      dmgType: 'phys',
      splashRadius: num(b1.splash_radius, 1.1),
    },
  };
  const s2 = {
    kind: 'duration',
    duration: num(b2.duration, 24),
    targeting: { rangeExtend: Math.max(1, Math.floor(num(b2.rangeExtend, 1))) },
    attack: {
      hits: Math.max(1, Math.floor(num(b2.hits, 8))),
      atkScale: num(b2.atk_scale, 1.0),
      dmgType: 'phys',
    },
  };
  const t1 = talentBb(chess, 0);
  const talents = [
    { install(battle, unit) { // T1 双利手: 攻击时概率使敌人获得 8% 脆弱，持续 2 秒
      const p = num(t1.prob, 0.1), v = num(t1.fragile, 0.08), d = num(t1.fragile_dur, 2);
      if (!(p > 0 && v > 0 && d > 0)) return;
      battle.on('hit', (ctx) => {
        const tg = ctx.target;
        if (ctx.source !== unit || !tg || tg.side !== 'enemy' || !tg.alive) return;
        if (!(p >= 1 || battle.rng() < p)) return;
        battle.applyStatus(tg, 'fragile', { duration: d, value: v, source: unit });
      }, { owner: unit });
    } },
    { install(battle, unit) { // 模组 HAM-X: 溅射范围内 ≥3 个敌人时，当次攻击力提升至 115%
      const r = num(traitBb(chess).atk_scale, 1);
      if (!(r > 1)) return;
      battle.on('hit', (ctx) => {
        if (ctx.source !== unit || !isMainHit(ctx.dmg)) return;
        const tg = ctx.target;
        if (!tg || tg.side !== 'enemy' || !ctx.dmg) return;
        let n = 0;
        for (const e of battle.enemies) if (e.alive && cheb(tg, e) <= 1) n++;
        if (n >= 3) ctx.dmg.amount *= r;
      }, { owner: unit });
    } },
  ];
  return {
    skill: s1,
    skills: { [S1]: s1, [S2]: s2 },
    talents,
  };
};
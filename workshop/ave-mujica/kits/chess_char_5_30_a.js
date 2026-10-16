// workshop/ave-mujica/kits/chess_char_5_30_a.js — 三角初华/Doloris（颂乐人偶 mod）
// 速射手 (SNIPER fastshot): 物伤, 可对空, 攻速快。
// 吟游者特性「不攻击，持续恢复范围内友军生命，自身不受鼓舞影响」: 初华给自己上不了鼓舞（mem.noInspire）。
// S1 我思念的 (duration): 攻击范围扩大，范围内友方获得相当于自身攻击力 share 与防御力 def_share 的鼓舞（flat 加值），友方受伤时为其治疗 heal 点。
// S2 我悲悯的 (duration): 每 interval 秒对随机敌人造成 atk×dps_scale 法伤并治疗最伤友方 atk×heal_scale；范围内其他友方获得 atk×inspire 的鼓舞。[ASSUMED]
// T1 谎言的假面: 技能未开启时每 interval 秒治疗攻击范围内生命最低的友方以 atk×heal_scale 生命（「优先选择丰川祥子」需乐队成员判定，未实现）。
// T2 毋畏悲伤: Fever（治疗成员 +5）与「攻击范围内成员攻击时附带 初华攻击力×bonus_scale 的法术伤害」都由本包盟约安装器
//   （battle/main.mjs 的 installAveMujica）负责，本 kit 不重复。
// 模组 BAR-X「占卜的意义」: 攻击范围内存在 2 名及以上其他干员时，攻击力+8%（不受技能影响 — 近似为 atkPct）。
import { num, skillBbOf, talentBb, traitBb, toggleBuff } from '@kit/tier1.js';

const S1 = 'skchr_am_doloris_1';
const S2 = 'skchr_am_doloris_2';
const INSPIRE = 'am:doloris:inspire';

export default (bb, chess) => {
  const b1 = skillBbOf(chess, S1);
  const b2 = skillBbOf(chess, S2);

  const giveInspire = (battle, unit, atkShare, defShare, dur) => {
    const m = {};
    if (atkShare > 0) m.atkFlat = unit.s.atk * atkShare;
    if (defShare > 0) m.defFlat = unit.s.def * defShare;
    if (!Object.keys(m).length) return;
    for (const a of battle.alliesInGrid(unit)) {
      // 吟游者特性「自身不受鼓舞影响」: 不能给自己上鼓舞（否则 atkFlat 取自自身当前攻击力、每次刷新自我放大），也不给其他受鼓舞免疫的单位上
      if (a === unit || a.mem?.noInspire) continue;
      battle.addBuff(a, { key: INSPIRE, duration: dur, refresh: 'replace', source: unit, mods: m, tags: ['aura'] });
    }
  };

  const s1 = {
    kind: 'duration',
    duration: num(b1.duration, 30),
    targeting: { rangeExtend: Math.max(1, Math.floor(num(b1.rangeExtend, 1))) },
  };
  const s2 = {
    kind: 'duration',
    duration: num(b2.duration, 12),
    onTick({ battle, unit, dt }) {
      const tick = (unit._d2 = (unit._d2 || 0) + dt);
      const iv = Math.max(0.05, num(b2.interval, 0.3));
      if (tick < iv) return;
      unit._d2 = 0;
      const dps = num(b2.dps_scale, 0.7);
      if (dps > 0) {
        const foes = battle.enemiesInKeys(unit.rangeKeys, unit, { canHitFly: true });
        if (foes.length) {
          const e = foes[Math.floor(battle.rng() * foes.length)];
          if (e && e.alive) battle.dealDamage(unit, e, { amount: unit.s.atk * dps, type: 'arts', isSkill: true, canDodge: false, tags: ['skill', 'am:doloris'] });
        }
      }
      const hs = num(b2.heal_scale, 0.15);
      if (hs > 0) {
        let best = null;
        for (const a of battle.alliesInGrid(unit)) if (a.hp < a.s.maxHp && (!best || a.hpRatio < best.hpRatio)) best = a;
        if (best) battle.heal(unit, best, unit.s.atk * hs);
      }
      const insp = num(b2.inspire, 0.8);
      if (insp > 0) {
        for (const a of battle.alliesInGrid(unit)) {
          if (a === unit || a.mem?.noInspire) continue;   // 自身不受鼓舞影响
          battle.addBuff(a, { key: INSPIRE, duration: iv + 0.1, refresh: 'replace', source: unit, mods: { atkFlat: unit.s.atk * insp }, tags: ['aura'] });
        }
      }
    },
  };

  const t1 = talentBb(chess, 0);
  const talents = [
    { install(battle, unit) { // T1 谎言的假面: 技能未开启时定时治疗范围内生命最低的友方
      const iv = Math.max(0.5, num(t1.interval, 4));
      const sc = num(t1.heal_scale, 0.3);
      if (!(sc > 0)) return;
      battle.every(iv, () => {
        if (!unit.alive || !unit.deployed) return;
        if (unit.skill && unit.skill.active) return;   // 技能未开启时
        let best = null;
        for (const a of battle.alliesInGrid(unit)) if (a.hp < a.s.maxHp && (!best || a.hpRatio < best.hpRatio)) best = a;
        if (best) battle.heal(unit, best, unit.s.atk * sc);
      }, { owner: unit });
    } },
    { install(battle, unit) { // 模组 BAR-X: 攻击范围内存在 2 名及以上其他干员时，攻击力+8%
      const a = num(traitBb(chess).atk, 0);
      if (!(a > 0)) return;
      toggleBuff(battle, unit, 'am:doloris:modAtk',
        () => battle.alliesInGrid(unit).filter((x) => x !== unit).length >= 2,
        { atkPct: a });
    } },
  ];

  return {
    skill: s1,
    skills: { [S1]: s1, [S2]: s2 },
    talents,
    install(battle, unit) {
      unit.mem.noInspire = true; // 吟游者特性「自身不受鼓舞影响」（本 kit 与其他来源的鼓舞都跳过她）
      battle.every(0.5, () => {
        if (!unit.alive || !unit.deployed || !unit.skill || !unit.skill.active || unit.skill.id !== S1) return;
        giveInspire(battle, unit, num(b1.share, 0.3), num(b1.def_share, 0.3), 0.7);
      }, { owner: unit });
      battle.on('damaged', (ctx) => {
        if (!unit.skill || !unit.skill.active || unit.skill.id !== S1) return;
        const t = ctx.target;
        if (!t || t.side !== 'ally' || t.kind === 'device' || !t.alive) return;
        const inRange = battle.alliesInGrid(unit).some((a) => a.id === t.id);
        if (!inRange) return;
        const h = num(b1.heal, 50);
        if (h > 0) battle.heal(unit, t, h);
      }, { owner: unit });
    },
  };
};
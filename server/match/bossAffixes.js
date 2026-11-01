// server/match/bossAffixes.js — 超限 Boss 词缀（业主 2026-10-26）
//
// 第一版只有两个词缀，全部通过波次 spawn 已有的 mods / 额外随从实现，不改 sim 核心：
//   berserk 狂暴：Boss 及其随从攻击力 +20%、生命 +10%
//   summon  召唤：Boss 额外携带 2 只随从，tag:'part' / countInTotal:false（不计漏怪）
// 护盾 / 反伤需要 Boss 受击钩子，列为二阶段（见 handoff/OVERLIMIT-FUN-2026-10-26.md）。
//
// 抽取用匹配层的 rngMeta（createRng 派生），同种子同结果。

export const BOSS_AFFIXES = Object.freeze([
  Object.freeze({
    id: 'berserk', name: '狂暴',
    text: 'Boss 及其随从攻击力 +20%、生命 +10%。',
  }),
  Object.freeze({
    id: 'summon', name: '召唤',
    text: 'Boss 额外携带 2 只随从（不计入漏怪）。',
  }),
]);

/**
 * 抽一个 Boss 词缀。rng 是匹配层的 rngMeta（有 pick(arr)）。
 * @param {{ pick: (arr:any[])=>any }|null|undefined} rng
 */
export function drawBossAffix(rng) {
  if (!rng || typeof rng.pick !== 'function') return BOSS_AFFIXES[0];
  return rng.pick(BOSS_AFFIXES.slice());
}

/**
 * 把词缀应用到一张 Boss 波（原地修改 spawns，并写入 wave.affix）。
 * 只对 tag:'boss' / preview.boss 的条目加狂暴；召唤只加 2 条 tag:'part' 的随从。
 * @param {any} wave buildInfiniteBossWave 的返回对象
 * @param {{ id:string, name:string, text:string }|null|undefined} affix
 */
export function applyBossAffix(wave, affix) {
  if (!wave || !Array.isArray(wave.spawns) || !affix) return wave;
  wave.affix = { id: affix.id, name: affix.name, text: affix.text };
  if (affix.id === 'berserk') {
    for (const s of wave.spawns) {
      const boss = s && (s.tag === 'boss' || (s.preview && s.preview.boss === true));
      if (!boss) continue;
      s.mods = {
        ...(s.mods || {}),
        atkMul: (Number(s.mods && s.mods.atkMul) || 1) * 1.2,
        hpMul: (Number(s.mods && s.mods.hpMul) || 1) * 1.1,
      };
    }
  } else if (affix.id === 'summon') {
    const base = wave.spawns.find((s) => s && s.tag !== 'boss' && !(s.preview && s.preview.boss))
      || { enemyKey: 'enemy_1007_slime', routeIndex: 0, mods: { hpMul: 1, atkMul: 1, speedMul: 1 } };
    for (let i = 0; i < 2; i++) {
      wave.spawns.push({
        time: 6 + i * 1.5,
        enemyKey: base.enemyKey,
        routeIndex: Number.isInteger(base.routeIndex) ? base.routeIndex : (i + 1) % 3,
        count: 1,
        interval: 0,
        mods: { ...(base.mods || {}) },
        // 随从：tag:'part' + countInTotal:false —— 客户端与服务端都不把它算进漏怪/重模拟
        tag: 'part',
        countInTotal: false,
        preview: { fly: false, elite: false, boss: false },
      });
    }
  }
  return wave;
}

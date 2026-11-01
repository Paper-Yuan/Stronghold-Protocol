// server/sim/content/hazard.js — 湮灭模拟's collapsing battlefield: the toxic fog (Battle flags.fog, from
// config.modes[m].annihilation.fog through GameData.annihilationFlags).
//
// The fog rises `at` GAME seconds into the battle. Its damage starts at 0 and climbs linearly for `ramp` seconds to
// `ratio` of a unit's MAX HP per second, then stays there: with the mode's 60 s / 20 s / 20 % numbers, a unit that is
// never healed loses all of its HP ~17 s after the fog rose (the field clock runs at the forced battle speed, so both
// numbers are given in game seconds and the client's own re-simulation agrees to the tick).
//
// Every deployed ally (operators and summons; devices are structures) is hit once a second with source-less true
// damage tagged 'dot' / 'periodic' / 'fog' — the same pipeline as 深水区 (devices.js deepWaterDamage) — and carries a
// visible status (the necrosis glyph) so the HUD shows what is draining it. `targets: 'all'` also poisons enemies;
// the mode itself uses the default (allies only): the fog is the pressure on the player's half, not a free clear.

const FOG_KEY = 'annihilation:fog';

/**
 * @param {import('../Battle.js').Battle} battle
 */
export function install(battle) {
  const f = battle.flags && battle.flags.fog;
  if (!f || !(Number(f.ratio) > 0)) return;
  const at = Math.max(0, Number(f.at) || 0);
  const ramp = Math.max(0, Number(f.ramp) || 0);
  const ratio = Math.min(1, Math.max(0, Number(f.ratio) || 0));
  const targetsEnemies = f.targets === 'all';
  /** battle.time at which the fog rose (Infinity until then) */
  let startAt = Infinity;
  let last = 0;

  const active = () => battle.time >= startAt - 1e-9;
  /** damage per second as a share of a unit's max HP at the current battle time */
  const dps = () => {
    if (!(battle.time >= startAt)) return 0;
    const k = ramp > 0 ? Math.min(1, (battle.time - startAt) / ramp) : 1;
    return ratio * Math.max(0, k);
  };

  const mark = (unit) => {
    if (!unit || !unit.alive || !unit.deployed || unit.side !== 'ally' || unit.kind === 'device' || !active()) return;
    if (typeof unit.findBuff === 'function' && unit.findBuff(FOG_KEY)) return;
    battle.addBuff(unit, { key: FOG_KEY, status: 'necrosis', visible: true, duration: Infinity, tags: ['fog', 'dot'] });
  };

  const hit = (unit, share, dt) => {
    if (!unit || !unit.alive || !unit.deployed) return 0;
    const max = Number(unit.s && unit.s.maxHp) || 0;
    const amount = max * share * dt;
    if (!(amount > 0)) return 0;
    // 无来源真实持续伤害: no unit deals it, no 受击回复 (the 深水区 flags), tagged so 锡人-style 'dot' bonuses apply
    battle.dealDamage(null, unit, { amount, type: 'true', canDodge: false, sourceless: true, noSp: true, tags: ['dot', 'periodic', 'fog'] });
    return amount;
  };

  const tick = () => {
    if (battle.finished) return;
    const now = battle.time;
    const dt = Math.max(0, Math.min(8, now - last));
    last = now;
    const share = dps();
    if (!(share > 0) || !(dt > 0)) return;
    for (const u of battle.allyUnits) {
      if (!u || !u.alive || !u.deployed || u.kind === 'device') continue;
      mark(u);
      hit(u, share, dt);
    }
    if (targetsEnemies) for (const e of battle.enemies) if (e && e.alive) hit(e, share, dt);
  };

  // a unit deployed after the fog rose starts burning at once (and gets its status glyph)
  battle.on('deploy', (ctx) => { if (ctx && ctx.unit) mark(ctx.unit); }, { priority: 60 });

  battle.after(at, (b) => {
    startAt = b.time;
    last = b.time;
    for (const u of b.allyUnits) mark(u);
    b.every(1, tick, { immediate: true });
  });
}

/** Actual credited damage; DPS is averaged over simulation time, never wall-clock time. */
export function unitDamageStats(unit, elapsed) {
  const damage = Number.isFinite(unit?.stats?.dmg) ? Math.max(0, unit.stats.dmg) : 0;
  const seconds = Number.isFinite(elapsed) ? Math.max(0, elapsed) : 0;
  return { damage, dps: seconds > 0 ? damage / seconds : 0, seconds };
}

export function battleDamageReport(battle, fieldId) {
  const seconds = Number.isFinite(battle?.time) ? Math.max(0, battle.time) : 0;
  const units = (battle?.allyUnits || []).filter(u => u && u.kind === 'op').map(u => ({
    id: u.id, uid: u.uid, ownerId: u.ownerId, name: u.name || u.defId || '干员', ...unitDamageStats(u, seconds),
  })).sort((a, b) => b.damage - a.damage || a.id - b.id);
  return { fieldId, seconds, finished: !!battle?.finished, units };
}

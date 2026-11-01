// §35.15. [ASSUMED] System-prompt view of an sp-knowledge/1 pack. The pack itself is unchanged:
// strategyCandidates still reads the full local playbook. Third-party agents still receive the full hello pack.
const capsOf = (op, byId) => {
  const row = byId.get(op.id) || byId.get(op.baseId);
  const c = row?.capabilities;
  return { air: !!c?.air, block: !!c?.block, sustain: !!c?.sustain, elementRecovery: !!c?.elementRecovery };
};

export function slimKnowledge(pack, { maxChars = Infinity } = {}) {
  const view = slimView(pack);
  if (JSON.stringify(view).length <= maxChars) return view;
  // [ASSUMED] Compact enemies stay while the example system text fits in 200000 characters; a translated catalogue
  // (English funny) can still be over the cap once they are gone, so every stage is checked against the budget and
  // the next one starts from the previous stage's result (2026-10-28: the unconditional drop used to return an
  // over-long view and trip advisor-input).
  let cur = view.enemies.length ? { ...view, enemies: [] } : view;
  if (JSON.stringify(cur).length <= maxChars) return cur;
  // The prose fields go next — boss notes and band insights are the longest text in the view, and the model keeps the
  // ids, names, stats, bonds, items and the rules summary.
  cur = { ...cur, bosses: (cur.bosses || []).map(({ notes, ...b }) => b),
    bands: (cur.bands || []).map(({ insights, ...b }) => b) };
  if (JSON.stringify(cur).length <= maxChars) return cur;
  // Last resort: the per-operator skill list goes too (the default skill keeps its name and effect in
  // `operators[].skill`), so the view stays a "slim view" instead of silently breaking the cap.
  cur = { ...cur, operators: cur.operators.map(({ skills, ...o }) => o) };
  return cur;
}

function slimView(pack) {
  const pb = pack.playbook || {};
  const byId = new Map((pb.operators || []).map(o => [o.id, o]));
  const fly = new Map((pb.enemies || []).map(e => [e.id, !!e.fly]));
  const insights = new Map((pb.bands || []).map(b => [b.id, b.insights || []]));
  const trait = op => String(Array.isArray(op.traits) ? op.traits[0] || '' : '').slice(0, 120);
  return {
    schema: pack.schema, version: pack.version, language: pack.language, modeId: pack.modeId,
    rulesSummary: pack.rulesSummary, economy: pack.economy,
    bonds: (pack.bonds || []).map(b => ({ id: b.id, name: b.name, kind: b.core ? 'core' : 'class', thresholds: b.thresholds, countMode: b.countMode,
      countsGoldenOnly: b.countsGoldenOnly, effect: b.effect })),
    operators: (pack.operators || []).map(o => ({ id: o.id, name: o.name, tier: o.tier, cost: o.cost, class: o.class,
      bonds: o.bonds || [], caps: capsOf(o, byId), trait: trait(o), skill: o.skill?.name || '' })),
    items: (pack.items || []).map(i => ({ id: i.id, name: i.name, cost: i.cost, effect: i.effect })),
    bands: (pack.bands || []).map(b => ({ id: b.id, name: b.name, lp: b.lp, effect: b.effect, carriesFunds: b.carriesFunds,
      insights: insights.get(b.id) || [] })),
    bosses: (pack.bosses || []).map(b => ({ id: b.id, name: b.name, enemyKey: b.enemyKey, hpByDifficulty: b.hpByDifficulty,
      // Pack notes stay ability objects (sp-knowledge/1). The prompt view keeps their readable text only.
      notes: Array.isArray(b.notes) ? b.notes.map(n => typeof n === 'string' ? n : (n && (n.text || n.desc)) || '').filter(Boolean).join(' ').slice(0, 240) : '' })),
    enemies: (pack.enemies || []).map(e => ({ id: e.id, name: e.name, hp: e.stats?.maxHp || 0, def: e.stats?.def || 0,
      res: e.stats?.res || 0, motion: e.stats?.motion || '', fly: fly.get(e.id) || e.stats?.motion === 'FLY' })),
    playbook: {
      schema: pb.schema, policy: pb.policy, inactiveBonds: pb.inactiveBonds, maxShopLevel: pb.maxShopLevel,
      community: pb.community, cycles: pb.cycles, graph: pb.graph,
      pairings: (pb.bonds || []).map(b => ({ id: b.id, pairings: b.pairings || [] })),
      schedule: pb.schedule, recommendedSchedule: pb.recommendedSchedule, legacyReference: pb.legacyReference,
      bandInsights: (pb.bands || []).map(b => ({ id: b.id, insights: b.insights || [] })),
      warnings: pb.warnings, lateRule: pb.lateRule, leaderHitLimit: pb.leaderHitLimit,
    },
  };
}

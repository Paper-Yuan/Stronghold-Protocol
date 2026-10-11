// server/sim/content/items.js — equipment & Arts content (research 04, docs/DATA.md §5).
// Battle side: install(battle) is called once per Battle by content/index.js (inside try/catch).
// Prep side: registerMeta(registry) is called once at server boot by match/effectsMeta.js.
// lendItemEffects(battle, fromUnit, toUnit, { maxTier, duration }) is used by 萨尔贡 × 娜仁图亚 (bands); deploymentOf(u)
// (the deployment a unit is in — a redeploy or an in-place 复活 opens a new one) by 阿戈尔's devour (bonds/core.js).
export { install, lendItemEffects, deploymentOf } from './items/battle.js';
export { registerMeta } from './items/meta.js';

// server/sim/content/bands.js — the 40 strategies (bands, 策略/分队), battle side + prep side (DESIGN §7, research 01 §11).
//
// Entry point imported by content/index.js:
//   install(battle)          IN_BATTLE band buffs of every player of the battle — bands/battle.js
//   registerMeta(registry)   prep-side band effects (band:<bandId>) + the 鸭爵 global — bands/meta.js
// Starting LP (totalHp), the draft and 坎诺特's kept leftover funds are the match's own rules (Match / PlayerState).
// Parts are loaded with guarded dynamic imports and run in isolation: one failing part never disables the other
// (the first error is re-thrown afterwards so content/index.js records it in battle.errors / the server log).

async function load(path) {
  try {
    return await import(path);
  } catch (e) {
    console.error(`[content] failed to load ${path}: ${e && e.stack ? e.stack.split('\n').slice(0, 3).join(' | ') : e}`);
    return {};
  }
}

const [battlePart, metaPart] = await Promise.all([load('./bands/battle.js'), load('./bands/meta.js')]);

export function install(battle) {
  if (typeof battlePart.install === 'function') battlePart.install(battle);
}

export function registerMeta(registry) {
  if (typeof metaPart.registerMeta === 'function') metaPart.registerMeta(registry);
}

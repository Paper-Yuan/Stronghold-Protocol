// server/sim/content/bonds.js — the 23 bonds (盟约), battle side + prep side (DESIGN §7, research 02).
//
// Entry point imported by content/index.js. The work is split into two submodules that each export
// install(battle) / registerMeta(registry):
//   bonds/core.js    8 core bonds  炎 萨尔贡 维多利亚 谢拉格 拉特兰 阿戈尔 叙拉古 卡西米尔
//   bonds/addon.js   15 add-on bonds 精准 迅捷 灵巧 奥术 坚守 助力 远见 奇迹 投资人 突袭 不屈 调和 协防干员 独行 绝技
// plus support/meta.js (shared prep→battle `contentInfo`). Parts are loaded with guarded dynamic imports and run in
// isolation: one failing part never disables the others (the first error is re-thrown afterwards so
// content/index.js records it in battle.errors / the server log).
// Membership (own bonds, 变形同构体 grants, 调和 enjoying active core bonds) lives in support/index.js.

async function load(path) {
  try {
    return await import(path);
  } catch (e) {
    console.error(`[content] failed to load ${path}: ${e && e.stack ? e.stack.split('\n').slice(0, 3).join(' | ') : e}`);
    return {};
  }
}

// 炸惊模拟 (ZHAJING): `mujicaBond.js` is a bond part, NOT a DOMAIN_NAMES entry — the reference build loads it here, after
// bonds/core and bonds/addon, because it reads the player's owned 惊变 cards through jibianBonds' `ownedJibianIdsOf`
// (server/sim/content/jibianBonds.js, itself registered as a domain). Load order: core → addon → mujicaBond. The file
// belongs to the engine-cards worker; a missing file loads as {} and the two official parts still install.
const [core, addon, mujica, supportMeta] = await Promise.all([load('./bonds/core.js'), load('./bonds/addon.js'), load('./mujicaBond.js'), load('./support/meta.js')]);
const PARTS = Object.freeze([['bonds/core', core], ['bonds/addon', addon], ['mujicaBond', mujica]]);

function runAll(fnName, arg, pre = null) {
  let first = null;
  if (pre) { try { pre(arg); } catch (e) { first = first ?? e; } }
  for (const [name, mod] of PARTS) {
    if (typeof mod[fnName] !== 'function') continue;
    try { mod[fnName](arg); } catch (e) {
      if (!first) { first = e; try { e.message = `${name}.${fnName}: ${e.message}`; } catch { /* frozen */ } }
    }
  }
  if (first) throw first;
}

export function install(battle) { runAll('install', battle); }

export function registerMeta(registry) {
  runAll('registerMeta', registry, typeof supportMeta.registerSupportMeta === 'function' ? supportMeta.registerSupportMeta : null);
}

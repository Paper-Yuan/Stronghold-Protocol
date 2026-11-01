// server/sim/content/bonds/addon.js — the 15 add-on bonds (research 02 §3.9–§3.23), loaded by content/bonds.js.
//
//   addon/battle.js    精准 迅捷 灵巧 奥术 坚守 助力 突袭 不屈 协防干员 独行 绝技 (battle effects)
//   addon/meta.js      助力 (prep-end layers) 远见 (layer funds, price discounts) 奇迹 (free refresh, layer funds)
//   addon/zjbonds.js   岁 / 企鹅物流 / 医师 — the 炸惊模拟 zjOnly bonds (the base records are empty shells whose numbers
//                      only exist in the `zj` block, so the module installs nothing outside 炸惊 — see its header)
//
// INSTALL ORDER: addon/battle.js first, then addon/zjbonds.js — the reference build's addon.js calls
// installBattle() → installZjBonds(). content/bonds.js loads this part between bonds/core.js and mujicaBond.js, so the
// 炸惊 盟约 hooks are registered before mujicaBond's (which overrides a `bond:mujicaShip` meta key by design).
// 投资人's ×2/×3 "获得时" repeat lives in the match dispatcher, 调和's +1 core count in server/match/bondsMeta.js and its
// "enjoys active core bonds" in support/index.js isMember().

import { install as installBattle } from './addon/battle.js';
import { install as installZjBonds } from './addon/zjbonds.js';
import { registerMeta as registerAddonMeta } from './addon/meta.js';

export function install(battle) { installBattle(battle); installZjBonds(battle); }
export function registerMeta(registry) { registerAddonMeta(registry); }

// server/sim/content/bonds/addon.js — the 15 add-on bonds (research 02 §3.9–§3.23), loaded by content/bonds.js.
//
//   addon/battle.js  精准 迅捷 灵巧 奥术 坚守 助力 突袭 不屈 协防干员 独行 绝技 (battle effects)
//   addon/meta.js    助力 (prep-end layers) 远见 (layer funds, price discounts) 奇迹 (free refresh, layer funds)
// 投资人's ×2/×3 "获得时" repeat lives in the match dispatcher, 调和's +1 core count in server/match/bondsMeta.js and its
// "enjoys active core bonds" in support/index.js isMember().

import { install as installBattle } from './addon/battle.js';
import { registerMeta as registerAddonMeta } from './addon/meta.js';

export function install(battle) { installBattle(battle); }
export function registerMeta(registry) { registerAddonMeta(registry); }

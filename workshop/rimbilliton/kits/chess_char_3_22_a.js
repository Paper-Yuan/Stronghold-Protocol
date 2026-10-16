// workshop/rimbilliton/kits/chess_char_3_22_a.js — 雷姆必拓工坊包 kit（import 白名单：@kit/ @sim/ @ops/）。
// （同一干员同一实现）：S1 强弩 / S2 暮眼锐瞳 / S3 战术的终结、破甲箭头、交叉火力、模块 ARC-X/ARC-Y。细节见
// server/sim/content/kits/ops/op-shwaz.js。
// 约定（kits_alt_t3 skills-map 测试）：`skills` 只装非默认技能（S1/S2），默认 S3 放顶层 `skill`。
import opShwaz from '@ops/op-shwaz.js';

export default (bb, chess, def) => {
    const k = opShwaz.char_340_shwaz(bb, chess);
    // 默认技能（数据 isDefault）：从 `skills` 移到顶层 `skill`（op kit 把全部技能都写在 skills 下）
    const sid = (def?.raw?.skills ?? []).find((s) => s.isDefault)?.skillId ?? null;
    if (sid && k.skills?.[sid]) { k.skill = k.skills[sid]; delete k.skills[sid]; }
    return k;
  }

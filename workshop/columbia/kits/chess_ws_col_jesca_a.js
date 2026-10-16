// workshop/columbia/kits/chess_ws_col_jesca_a.js — 哥伦比亚工坊包 kit（import 白名单：@kit/ @sim/ @ops/）。
// 涤火杰西卡（哨戒铁卫，6★）：整体复用引擎自带的官方 op kit server/sim/content/kits/ops/op-jesca2.js
// （技能 S1 / S2 / S3、天赋 灵活应变 / 蓄能释放、特性 哨戒铁卫 与召唤物「机动盾牌」）。
// 约定（kits_alt_t5 skills-map）：默认技能放顶层 `skill`，`skills` 只装非默认技能。
import opJesca2 from '@ops/op-jesca2.js';

export default (bb, chess, def) => {
  const k = opJesca2.char_1034_jesca2(bb, chess);
  const sid = (def?.raw?.skills ?? []).find((s) => s.isDefault)?.skillId ?? null;
  if (sid && k.skills?.[sid]) { k.skill = k.skills[sid]; delete k.skills[sid]; }
  return k;
};
// workshop/columbia/kits/chess_ws_col_heyak_a.js — 哥伦比亚工坊包 kit（import 白名单：@kit/ @sim/ @ops/）。
// 霍尔海雅（术师-中坚，6★，无召唤物）：整体复用引擎自带的官方 op kit
// server/sim/content/kits/ops/op-heyak.js（技能 S1 / S2 / S3、天赋 传承终焉 / 曾有羽翼、特性 中坚术师）。
// 约定（kits_alt_t5 skills-map）：默认技能放顶层 `skill`，`skills` 只装非默认技能。
import opHeyak from '@ops/op-heyak.js';

export default (bb, chess, def) => {
  const k = opHeyak.char_4027_heyak(bb, chess);
  const sid = (def?.raw?.skills ?? []).find((s) => s.isDefault)?.skillId ?? null;
  if (sid && k.skills?.[sid]) { k.skill = k.skills[sid]; delete k.skills[sid]; }
  return k;
};
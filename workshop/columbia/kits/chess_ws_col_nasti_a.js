// workshop/columbia/kits/chess_ws_col_nasti_a.js — 哥伦比亚工坊包 kit（import 白名单：@kit/ @sim/ @ops/）。
// 娜斯提（工匠，6★）：整体复用引擎自带的官方 op kit server/sim/content/kits/ops/op-nasti.js
// （技能 S1 “拱卫” / S2 / S3、天赋 前方施工 / 注意安全、特性 工匠 与三种 <支援装置>：
// “质检专员” / “监工专员” / “应急承重小组”）。
// 约定（kits_alt_t5 skills-map）：默认技能放顶层 `skill`，`skills` 只装非默认技能。
import opNasti from '@ops/op-nasti.js';

export default (bb, chess, def) => {
  const k = opNasti.char_4212_nasti(bb, chess);
  const sid = (def?.raw?.skills ?? []).find((s) => s.isDefault)?.skillId ?? null;
  if (sid && k.skills?.[sid]) { k.skill = k.skills[sid]; delete k.skills[sid]; }
  return k;
};
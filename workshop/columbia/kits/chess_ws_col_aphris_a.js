// workshop/columbia/kits/chess_ws_col_aphris_a.js — 哥伦比亚工坊包 kit（import 白名单：@kit/ @sim/ @ops/）。
// 谬因（轰击术师，6★）：整体复用引擎自带的官方 op kit server/sim/content/kits/ops/op-aphris.js
// （技能 S1 连续映射 / S2 临界瞬爆 / S3 混沌的本质、天赋 链路协议 / 取样优化、特性 轰击术师 与召唤物「中继器」）。
// 约定（kits_alt_t5 skills-map）：默认技能放顶层 `skill`，`skills` 只装非默认技能。
import opAphris from '@ops/op-aphris.js';

export default (bb, chess, def) => {
  const k = opAphris.char_4229_aphris(bb, chess);
  const sid = (def?.raw?.skills ?? []).find((s) => s.isDefault)?.skillId ?? null;
  if (sid && k.skills?.[sid]) { k.skill = k.skills[sid]; delete k.skills[sid]; }
  return k;
};
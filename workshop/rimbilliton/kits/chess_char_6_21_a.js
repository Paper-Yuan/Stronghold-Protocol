// workshop/rimbilliton/kits/chess_char_6_21_a.js — 雷姆必拓工坊包 kit（import 白名单：@kit/ @sim/ @ops/）。
// 自选 op kit：巡空者起飞 / 飘浮大地之上 / 天穹间的舞步 / S1 极速送达 / S2 重力自定义 / S3 酸橙的心事（无模块）。细节见
// server/sim/content/kits/ops/op-aglna2.js。差异：S2/S3 触发按官方（owner 0.2.0 规则）应为 ACTIVE_RANGE（技能范围大
// 于自身范围）——卡池数据给出 DEFAULT，这里补上（op kit 依赖数据 ACTIVE_RANGE 而未写覆盖）。
// 约定（kits_alt_t6 skills-map 测试）：`skills` 只装非默认技能（S1/S2），默认 S3 放顶层 `skill`。
import opAglna2 from '@ops/op-aglna2.js';

const S2 = 'skchr_aglna2_2';
const S3 = 'skchr_aglna2_3';

export default (bb, chess, def) => {
    const k = opAglna2.char_1015_aglna2(bb, chess);
    const gridOf = (id) => {
      const s = (chess?.skills ?? []).find((x) => x.skillId === id);
      return s?.rangeGrid ? s.rangeGrid.map((p) => [p[0], p[1]]) : null;
    };
    const g2 = gridOf(S2), g3 = gridOf(S3);
    if (k.skills?.[S2] && g2) k.skills[S2].trigger = { rule: 'ACTIVE_RANGE', grid: g2 };
    if (k.skills?.[S3] && g3) k.skills[S3].trigger = { rule: 'ACTIVE_RANGE', grid: g3 };
    // 默认技能（数据 isDefault）：从 `skills` 移到顶层 `skill`
    const sid = (def?.raw?.skills ?? []).find((s) => s.isDefault)?.skillId ?? null;
    if (sid && k.skills?.[sid]) { k.skill = k.skills[sid]; delete k.skills[sid]; }
    return k;
  }

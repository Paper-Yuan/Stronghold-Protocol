// workshop/rimbilliton/kits/chess_char_5_24_a.js — 雷姆必拓工坊包 kit（import 白名单：@kit/ @sim/ @ops/）。
// 猎手子弹 / 巡哨伙伴(沙地兽) / 入神 / S1 脱身矢 / S2 广域警觉 / S3 “得见光芒”，模块 HUN-X。细节见
// server/sim/content/kits/ops/op-ray.js。
// 差异：S3 触发按官方（owner 0.2.0 规则）应为 ACTIVE_RANGE（技能范围 3-8 大于自身范围）——卡池数据给出 DEFAULT，
// 这里补上（op kit 依赖数据 ACTIVE_RANGE 而未写覆盖）。
// 约定（kits_alt_t5 skills-map 测试）：`skills` 只装非默认技能（S1/S2），默认 S3 放顶层 `skill`。
import opRay from '@ops/op-ray.js';

const S3 = 'skchr_ray_3';

export default (bb, chess, def) => {
    const k = opRay.char_4117_ray(bb, chess);
    // S3 ACTIVE_RANGE 修正（作用于 S3 spec 对象，随后移到顶层 `skill`）
    const s3 = (chess?.skills ?? []).find((s) => s.skillId === S3);
    if (k.skills?.[S3] && s3?.rangeGrid) {
      k.skills[S3].trigger = { rule: 'ACTIVE_RANGE', grid: s3.rangeGrid.map((p) => [p[0], p[1]]) };
    }
    // 默认技能（数据 isDefault）：从 `skills` 移到顶层 `skill`
    const sid = (def?.raw?.skills ?? []).find((s) => s.isDefault)?.skillId ?? null;
    if (sid && k.skills?.[sid]) { k.skill = k.skills[sid]; delete k.skills[sid]; }
    return k;
  }

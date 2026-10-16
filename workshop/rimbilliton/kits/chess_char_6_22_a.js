// workshop/rimbilliton/kits/chess_char_6_22_a.js — 雷姆必拓工坊包 kit（import 白名单：@kit/ @sim/ @ops/）。
// kit：本源铁卫 / 探险理论 / 坚硬脚板 / S1 “还不走？” / S2 “慢慢走~” / S3 “不准走！”，模块 PRP-X。细节见
// server/sim/content/kits/ops/op-thumpy.js。
// 差异：卡池珊比 S2/S3 触发遵循数据（重装 TRIGGER_DEVIATIONS：TAKE_DAMAGE，受击释放）——op kit 为自选模式覆盖了
// ACTIVE_RANGE，这里移除让数据生效。
// 约定（kits_alt_t6 skills-map 测试）：`skills` 只装非默认技能（S1/S2），默认 S3 放顶层 `skill`。
import opThumpy from '@ops/op-thumpy.js';

const S2 = 'skchr_thumpy_2';
const S3 = 'skchr_thumpy_3';

export default (bb, chess, def) => {
    const k = opThumpy.char_4235_thumpy(bb, chess);
    if (k.skills?.[S2]) delete k.skills[S2].trigger;
    if (k.skills?.[S3]) delete k.skills[S3].trigger;
    // 默认技能（数据 isDefault）：从 `skills` 移到顶层 `skill`
    const sid = (def?.raw?.skills ?? []).find((s) => s.isDefault)?.skillId ?? null;
    if (sid && k.skills?.[sid]) { k.skill = k.skills[sid]; delete k.skills[sid]; }
    return k;
  }

// server/sim/content/jibianBonds.js — 惊变羁绊（凑齐固定惊变卡 → 特殊效果）。
//
// Ported from the 炸惊模拟 reference pack (0.3.1-mod.4, modref/v2.1/server/sim/content/jibianBonds.js) to this
// repository (0.3.3) as a ZHAJING-mode-only content module. Pure JS, no imports, no Node APIs: the browser's local
// battle simulator loads this same file, so the bond table is inlined here and `data/jibianBonds.json` is only a
// human-readable mirror (the data side owns that file).
//
//   activeBonds(ownedIds) → [{ def, tier, have }]
//   bondHintsFor(cardId, ownedIds) → [{ name, have, need, tiers, tier, effect }]
//   ownedJibianIdsOf(playerStateOrSnapshot) → Set<effectId>
//
// 语义要点（照参考实现，勿改）：
//   * 「已拥有」= EffectRef key 以 `jibian:` 开头的那些；**同一张卡抽到多次只算一个人头**（Set）。
//   * 匹配赛阶段的玩家状态把惊变放在 `effects`，战斗快照里的玩家用 `playerEffects` —— 两种都要认，
//     只读其一会让「包邮 / 真·投资人 / 出老千」这类羁绊静默失效（参考包踩过）。
//   * 档位是阈值（tiers [2,3] → 2 或 3），不是档位序号。
//   * 「羁绊之力」是万能卡：任何羁绊的人数 +1，自己没有效果。

const BONDS = Object.freeze([
  { id: 'ave_mujica', name: '开始吧，今夜的假面舞会', tiers: [2, 3], members: ['jibian_yinhezhanjian', 'jibian_yiwangnvshen', 'jibian_duoshouyeshou'], effect: '一档（2）：【颂乐人偶】干员开启技能进入Fever状态所需的Fever上限减半（450→225）；Fever期间所有干员获得所有【颂乐人偶】成员攻击力总和30%的鼓舞效果。二档（3）：所需的Fever上限减少至50；鼓舞效果提升至50%。' },
  { id: 'dmg2dmg', name: '伤害转伤害', tiers: [2], members: ['jibian_wulizhuanmofa', 'jibian_mofazhuanwuli'], effect: '你的干员造成的所有伤害变为真实伤害，攻击力+50%。' },
  { id: 'steady', name: '脚踏实地', tiers: [2, 3], members: ['jibian_jingzhun', 'jibian_xunjie', 'jibian_lingqiao', 'jibian_touziren', 'jibian_jianshou'], effect: '你的附属盟约层数叠加时获得的层数增加100%。（二档200%）' },
  { id: 'glory', name: '重振荣光', tiers: [2, 3], members: ['jibian_hongsongqishituan', 'jibian_qishijingji', 'jibian_laobadao'], effect: '你的【卡西米尔】干员攻击距离+1，攻击力+100%。（二档翻倍）' },
  { id: 'empathy', name: '共感', tiers: [2], members: ['jibian_huolibuzu', 'jibian_meiguozidan', 'jibian_chunyinzidan', 'jibian_wocongshanzhonglai'], effect: '把场上所有干员的攻击力变成整备阶段结束时场上攻击力最高干员的攻击力。' },
  { id: 'siracusa_wrath', name: '叙拉古人的愤怒', tiers: [2], members: ['jibian_lala', 'jibian_geigei'], effect: '你立刻获得精锐的荒芜拉普兰德和缄默德克萨斯。' },
  { id: 'freeship', name: '包邮', tiers: [2, 3], members: ['jibian_jisusongda_normal', 'jibian_jisusongda_rare', 'jibian_jisusongda_epic'], effect: '你在购买5阶干员时不再需要消耗资金。（二档增加6阶）' },
  { id: 'roguelike_fan', name: '集成战略爱好者', tiers: [3, 6], members: ['jibian_gaoluzhipiao', 'jibian_banteng', 'jibian_zhuiji', 'jibian_wenmingdecunxu', 'jibian_shiguangzhimo', 'jibian_jinjiuzhibei', 'jibian_chouminglu'], effect: '你随机获得一个未获得过的藏品类惊变。' },
  { id: 'cheat', name: '出老千', tiers: [2], members: ['jibian_daluandou', 'jibian_xuedingedemao', 'jibian_shenmishangdian', 'jibian_gaoluzhipiao', 'jibian_erjiguan'], effect: '你的部分惊变效果改变。' },
  { id: 'modern_strongest', name: '现代最强', tiers: [3], members: ['jibian_liuyan', 'jibian_wuxiaxian', 'jibian_qingpaibeibu'], effect: '你的所有干员释放技能不再需要技力，攻击力+1000%，攻击速度+360，攻击距离+2。' },
  { id: 'army_alert', name: '惊动军方', tiers: [2], members: ['jibian_yanrenhuifei', 'jibian_yanguoyouji', 'jibian_chixiaojianfa'], effect: '你立刻获得一个精锐望。' },
  { id: 'great_seal', name: '伟大封印', tiers: [2], members: ['jibian_sanyuewuri', 'jibian_zonggongji'], effect: '当你的结城理死亡时，立刻处死场上血量最高的敌人，且你的结城理本回合无法再部署（仅限一次）。' },
  { id: 'true_investor', name: '真·投资人', tiers: [4], members: ['jibian_touziren', 'jibian_touziweilai', 'jibian_shenmishangdian', 'jibian_gaoluzhipiao', 'jibian_banteng', 'jibian_juanzeng', 'jibian_panduolamohe', 'jibian_malubian', 'jibian_jinjiuzhibei', 'jibian_rencaishichang'], effect: '返还触发前消耗的所有资金，并使每个【获得时】效果翻倍。' },
  { id: 'toopainful', name: '因为太怕痛就全点防御力了', tiers: [2, 3], members: ['jibian_zheshe', 'jibian_jianshou', 'jibian_daoqiangburu', 'jibian_fushi'], effect: '一档：防御力和法术抗性增加70%；二档：被你干员阻挡的敌人每秒受到最大生命值10%的真实伤害。' },
  { id: 'glorious_evo', name: '光荣进化', tiers: [2], members: ['jibian_jiarudaqun', 'jibian_chuncuideqiangda', 'jibian_moguiyu'], effect: '你的【阿戈尔】干员基础数值提升300%。' },
  { id: 'steel_heart', name: '钢化你心', tiers: [2], members: ['jibian_xinzhigang', 'jibian_xingjieshenti', 'jibian_tankeyinqing', 'jibian_bawangxuekai'], effect: '你的所有干员生命值+100%。（最终乘算）' },
  { id: 'craftsman', name: '工匠精神', tiers: [2], members: ['jibian_weiduoliyademimi', 'jibian_shuihaiyoumengxiang'], effect: '你的干员每装备1个维式战锤系列武器，会额外获得5%的攻击力加成（最终乘算）。' },
  { id: 'layers_fan', name: '层数厨', tiers: [3], members: ['jibian_cengshudaluan', 'jibian_daozhuanqu', 'jibian_325799', 'jibian_diecengshou', 'jibian_jizhongyidian'], effect: '你的所有盟约层数叠加时获得的层数翻倍。' },
].map((b) => Object.freeze({
  id: b.id,
  name: b.name,
  tiers: Object.freeze(b.tiers.slice().sort((a, z) => a - z)),
  members: Object.freeze(b.members.slice()),
  effect: b.effect,
})));

/** 全部羁绊（只读）。 */
export function jibianBonds() {
  return BONDS;
}

/** 「羁绊之力」属于所有羁绊（没有自己的效果，只提供一个人头）。 */
export const WILD_CARD = 'jibian_jibangzhili';

/** 这张卡属于哪些羁绊。 */
export function bondsOfCard(cardId) {
  const id = String(cardId || '');
  if (id === WILD_CARD) return BONDS.slice();
  return BONDS.filter((b) => b.members.includes(id));
}

/**
 * 玩家状态 → 已拥有的惊变 effectId 集合。
 *
 * 匹配赛阶段的效果在 **`effects`**（choices.js applyDefault 写的 EffectRef），战斗快照里的玩家才用
 * **`playerEffects`**（round.js 生成）。两种都要认 —— 只读 playerEffects 会让对应的羁绊静默失效。
 * @param {any} ps
 * @returns {Set<string>}
 */
export function ownedJibianIdsOf(ps) {
  const out = new Set();
  const refs = Array.isArray(ps && ps.effects) && ps.effects.length
    ? ps.effects
    : (Array.isArray(ps && ps.playerEffects) ? ps.playerEffects : []);
  for (const ref of refs) {
    const k = ref && ref.key;
    if (typeof k === 'string' && k.startsWith('jibian:')) out.add(k.slice('jibian:'.length));
  }
  return out;
}

/** 已拥有的卡 → 已激活的羁绊（只返回达到最低阈值的）。`have` 含「羁绊之力」的 +1。 */
export function activeBonds(ownedIds) {
  const owned = ownedIds instanceof Set ? ownedIds : new Set(ownedIds || []);
  const wild = owned.has(WILD_CARD);
  const out = [];
  for (const def of BONDS) {
    let have = 0;
    for (const m of def.members) if (owned.has(m)) have++;
    if (wild) have += 1;
    if (!have) continue;
    let tier = 0;
    for (const t of def.tiers) if (have >= t) tier = Math.max(tier, t);
    if (tier > 0) out.push({ def, tier, have });
  }
  return out;
}

/** 卡面要显示的羁绊进度（这张卡本身不算）。 */
export function bondHintsFor(cardId, ownedIds) {
  const defs = bondsOfCard(cardId);
  if (!defs.length) return [];
  const owned = ownedIds instanceof Set ? ownedIds : new Set(ownedIds || []);
  const wild = owned.has(WILD_CARD) && String(cardId || '') !== WILD_CARD;
  return defs.map((def) => {
    let have = 0;
    for (const m of def.members) if (owned.has(m)) have++;
    if (wild) have += 1;
    return {
      name: def.name,
      have,
      need: def.tiers[0] || 2,
      tiers: def.tiers.slice(),
      tier: def.tiers.filter((n) => have >= n).length,
      effect: def.effect || '',
    };
  });
}

// server/match/traits.js — 超限模拟的「词条抉择」(业主 2026-10-18)
//
// 只在超限模式（Match.isInfinite）里出现：通过一个 Boss 的下一回合开始前，玩家从三张卡里选一张，
// 卡上附带一只「悬赏 coin ≥ 3」的怪（下一轮出场、不结算悬赏金），以及一条贯穿本局剩余战斗的词条。
//
// 数据分三层：
//   TRAITS      词条池（正面 13 / 负面 14，正负一一对位）
//   MONSTERS    怪物池（悬赏 ≥ 3 的全部 46 只，按 NORMAL / ELITE / BOSS 分组）
//   SPECIAL     特化（复仇者 / 泥岩 / 自在），20% 概率替换第一张，且这些怪不进普通随机池
//
// 词条本身分两类实现：
//   · 静态修正：直接写进 battle.flags（下一场战斗注入），例如攻击力 / 防御力 / 闪避 / 屏障
//   · 匹配层行为：每回合结算时执行（资金、完美作战回血、盟约层数、集群给装备）

/** 等级权重（业主：普通 5% / 精英 25% / BOSS 70%） */
export const RANK_WEIGHT = Object.freeze({ NORMAL: 5, ELITE: 25, BOSS: 70 });

/** 特化：这些怪只以特化卡出现，不进普通随机池 */
export const SPECIAL_MOBS = Object.freeze(['enemy_1539_reid', 'enemy_1511_mdrock', 'enemy_1517_xi']);

/** 词条池：每条带 id（用于结算派发）、名字、正文 */
export const TRAITS = Object.freeze({
  pos: Object.freeze([
    { id: 'regen', name: '再生', text: '全体干员每 2 秒额外回复 3% 的生命值' },
    { id: 'bloodlust', name: '浴血', text: '干员生命值越低攻击力越高，30% 生命值时达到最大 +50%' },
    { id: 'guard', name: '坚守', text: '全体干员防御力 +20%，法抗 +8' },
    { id: 'assault', name: '强攻', text: '全体干员攻击力 +25%' },
    { id: 'will', name: '意志', text: '所有我方近战单位部署时获得最大生命 50% 的屏障' },
    { id: 'adept', name: '熟稔', text: '所有自然回复技能的技力恢复 +0.2/秒' },
    { id: 'agile', name: '灵巧', text: '所有我方单位获得 15% 物理与法术闪避' },
    { id: 'bloom', name: '盛发', text: '所有我方单位受到的治疗和生命回复效果 +20%' },
    { id: 'wealth', name: '富足', text: '每回合开始时，额外获得 1 资金' },
    { id: 'breach', name: '破局', text: '敌方全体单位防御力 -15%，法抗 -6' },
    { id: 'revive', name: '再起', text: '本局每回合完成完美作战后回复一点生命' },
    { id: 'symbiosis', name: '共栖', text: '本局所有方式提升的盟约层数额外 +1' },
    { id: 'cluster', name: '集群', text: '下回合获得一个【变形同构体】' },
  ]),
  neg: Object.freeze([
    { id: 'corrode', name: '腐蚀', text: '全体干员每 2 秒额外损失 1% 的生命值' },
    { id: 'decay', name: '颓势', text: '干员生命值越低攻击力越低，30% 生命值时最多 -30%' },
    { id: 'sunder', name: '破防', text: '全体干员防御力 -20%，法抗 -8' },
    { id: 'weak', name: '虚弱', text: '全体干员攻击力 -20%' },
    { id: 'brittle', name: '脆壳', text: '所有我方近战单位部署时受到最大生命 20% 的伤害' },
    { id: 'slow', name: '迟滞', text: '所有自然回复技能的技力恢复 -0.2/秒' },
    { id: 'exposed', name: '暴露', text: '所有我方单位受到物理与法术伤害 +15%' },
    { id: 'wilt', name: '萎靡', text: '所有我方单位受到的治疗和生命回复效果 -20%' },
    { id: 'poor', name: '贫乏', text: '每回合开始时，资金 -1（最低 0）' },
    { id: 'bulwark', name: '壁垒', text: '敌方全体单位防御力 +15%，法抗 +6' },
    { id: 'harsh', name: '苛责', text: '每回合未达成完美作战时，目标生命值 -1' },
    { id: 'scatter', name: '离散', text: '本局所有方式提升的盟约层数额外 -1' },
    { id: 'swarm', name: '蜂拥', text: '下回合额外出现 1 只随机精英敌人' },
    { id: 'discord', name: '不和', text: '每回合开始时，随机减少 3 个盟约的 10 层层数' },
  ]),
});

/**
 * 怪物池：悬赏 coin ≥ 3 的全部怪（data/choices.json cards.bounty + data/enemies.json 的名字）。
 * 由 tools 生成后写死在这里，避免匹配层依赖 choices 的运行时结构。
 */
export const MONSTERS = Object.freeze({
  NORMAL: Object.freeze([
    { key: 'enemy_1041_lazerd', name: '法术大师A1' },
  ]),
  ELITE: Object.freeze([
    { key: 'enemy_1302_ymtro_2', name: '“越长尘”' },
    { key: 'enemy_1112_emppnt_2', name: '帝国炮火中枢先兆者' },
    { key: 'enemy_10054_cjhot', name: '鼎沸' },
    { key: 'enemy_10099_crvln', name: '反派阵营角色' },
    { key: 'enemy_2002_bearmi', name: '高普尼克' },
    { key: 'enemy_1273_stmgun_2', name: '高准度伦蒂尼姆城防自行炮' },
    { key: 'enemy_1283_sgkill', name: '家族灭迹人' },
    { key: 'enemy_1272_nhtank_2', name: '尖端萨卡兹枯朽战车' },
    { key: 'enemy_1062_rager_2', name: '狂暴宿主组长' },
    { key: 'enemy_10118_ymgprc', name: '澪' },
    { key: 'enemy_2034_sythef', name: '流泪小子' },
    { key: 'enemy_1092_mdgint', name: '泥岩巨像' },
    { key: 'enemy_1209_sfden', name: '清明' },
    { key: 'enemy_1364_spnaxe_2', name: '萨卡兹骸骨拷打者' },
    { key: 'enemy_1272_nhtank', name: '萨卡兹枯朽战车' },
    { key: 'enemy_1299_ymkilr', name: '山海众头目' },
    { key: 'enemy_1174_duholy', name: '深池伙友卫队' },
    { key: 'enemy_1174_duholy_2', name: '深池伙友卫队精英' },
    { key: 'enemy_1162_magmot', name: '术师快艇' },
    { key: 'enemy_1415_mmkabi_2', name: '温顺的武装大驮兽' },
    { key: 'enemy_10144_xdelk_2', name: '乌顶巨角卢鲁' },
    { key: 'enemy_1207_sfji_2', name: '新硎' },
    { key: 'enemy_10159_mntrjn', name: '伊利昂的木驮兽' },
    { key: 'enemy_1439_dslntf', name: '元核孽生者' },
    { key: 'enemy_2085_skzjxd', name: '圆仔' },
    { key: 'enemy_10098_crhro', name: '主角阵营角色' },
    { key: 'enemy_10067_ftsjc', name: '灼藤' },
    { key: 'enemy_10162_mnctpt', name: '自制投石机' },
  ]),
  BOSS: Object.freeze([
    { key: 'enemy_1512_mcmstr', name: '“巨大的丑东西”' },
    { key: 'enemy_1525_blkswb', name: '锏' },
    { key: 'enemy_2003_rockman', name: '迷路的巨像' },
    { key: 'enemy_1535_wlfmster', name: '扎罗，“狼之主”' },
    { key: 'enemy_2008_flking', name: '“墓碑”' },
    { key: 'enemy_2005_axetro', name: '“遗弃者”' },
    { key: 'enemy_1516_jakill', name: '杰斯顿·威廉姆斯' },
    { key: 'enemy_2048_smgrd', name: '“邪魔的利刃”' },
    { key: 'enemy_1513_dekght_2', name: '凋零骑士' },
    { key: 'enemy_1513_dekght', name: '腐败骑士' },
    { key: 'enemy_2052_smgia', name: '纠缠藤蔓' },
    { key: 'enemy_2004_balloon', name: '喷气人' },
    { key: 'enemy_2050_smsha', name: '陷落雪祀' },
  ]),
});

/** 特化：id → 徽记图、标题、描述、卡面数值（enemyOverrides 用） */
export const SPECIALS = Object.freeze({
  reid: Object.freeze({
    mob: 'enemy_1539_reid', title: '复仇-火与钢', chance: 0.2,
    desc: '“复仇者”的生命值提升 150%，获得抵抗，攻击速度提升 100，生命值低于一半时攻击力额外提升 100% 且受到的伤害减少 60%',
  }),
  mdrock: Object.freeze({
    mob: 'enemy_1511_mdrock', title: '坚甲随身Ⅲ', chance: 0.2,
    desc: '泥岩的攻击力提升 90%，生命值提升 100%，法术抗性提升 45，泥岩的护盾值额外提升 100% 且护盾刷新冷却时间减少至 70%',
  }),
  xi: Object.freeze({
    mob: 'enemy_1517_xi', title: '气定神闲Ⅲ', chance: 0.2,
    desc: '“自在”的生命值提升 50%，防御力提升 250%，法术抗性提升 30，【破桎而出】的释放间隔缩短 50%，爆炸范围扩大 100%',
  }),
});

/** 特化的实际数值（乘到 enemyOverrides 的 stats 上；只对选中的那只怪生效） */
export const SPECIAL_STATS = Object.freeze({
  reid: Object.freeze({ hpMul: 2.5, aspdAdd: 100, resist: true, lowHpAtk: 1.0, lowHpDmgTaken: 0.4 }),
  mdrock: Object.freeze({ atkMul: 1.9, hpMul: 2.0, resAdd: 45, shieldMul: 2.0, shieldCdMul: 0.7 }),
  xi: Object.freeze({ hpMul: 1.5, defMul: 3.5, resAdd: 30, burstIntervalMul: 0.5, burstRadiusMul: 2.0 }),
});

/** 特化怪不在普通随机池里（避免同一次抽卡重复） */
const specialOf = new Map(Object.entries(SPECIALS).map(([id, s]) => [s.mob, id]));

/**
 * 抽三张卡（超限词条抉择）。
 * @param {{ pick: (arr:any[])=>any, shuffle:(arr:any[])=>any[] }} rng 匹配层的 rngMeta
 * @param {'pos'|'neg'} polarity
 * @returns {Array<{ mob:string, name:string, special:string|null, boss:boolean, traitId:string, traitName:string, traitText:string }>}
 */
export function drawTraitCards(rng, polarity) {
  const pool = TRAITS[polarity] || TRAITS.pos;

  // ① 特化：按概率掷一次，命中则占第一张
  let special = null;
  for (const [id, sp] of Object.entries(SPECIALS)) {
    if (rng.pick([1, 2, 3, 4, 5]) <= Math.round((sp.chance || 0.2) * 5)) { special = { id, sp }; break; }
  }

  // 特化怪永远不进普通随机（业主：特化和普通不要在随机中重复）
  const used = new Set(SPECIAL_MOBS);
  const cards = [];
  const traits = rng.shuffle(pool.slice()).slice(0, 3);

  if (special) {
    const host = [...MONSTERS.BOSS, ...MONSTERS.ELITE].find((m) => m.key === special.sp.mob);
    cards.push({
      mob: special.sp.mob, name: host ? host.name : special.sp.title, special: special.id, boss: true,
      traitId: traits[0].id, traitName: traits[0].name, traitText: traits[0].text,
    });
  }

  while (cards.length < 3) {
    // ② 先按权重定等级，再在该等级里等概率取一只
    const ranks = Object.entries(RANK_WEIGHT)
      .filter(([rank]) => (MONSTERS[rank] || []).some((m) => !used.has(m.key)));
    if (!ranks.length) break;
    const rank = rng.pick(ranks.flatMap(([r, w]) => Array.from({ length: w }, () => r)));
    const avail = (MONSTERS[rank] || []).filter((m) => !used.has(m.key));
    const m = rng.pick(avail);
    used.add(m.key);
    const t = traits[cards.length];
    cards.push({ mob: m.key, name: m.name, special: null, boss: rank === 'BOSS', traitId: t.id, traitName: t.name, traitText: t.text });
  }
  return cards;
}

/** 词条 id → 战斗 flags 的静态修正（不含匹配层行为） */
export function traitFlags(traitId) {
  switch (traitId) {
    case 'guard': return { allyDefMul: 1.2, allyResAdd: 8 };
    case 'assault': return { allyAtkMul: 1.25 };
    case 'sunder': return { allyDefMul: 0.8, allyResAdd: -8 };
    case 'weak': return { allyAtkMul: 0.8 };
    case 'agile': return { allyDodgePhys: 0.15, allyDodgeArts: 0.15 };
    case 'exposed': return { allyTakenMul: 1.15 };
    case 'bloom': return { allyHealMul: 1.2 };
    case 'wilt': return { allyHealMul: 0.8 };
    case 'adept': return { allySpRegen: 0.2 };
    case 'slow': return { allySpRegen: -0.2 };
    case 'will': return { allyBarrierPct: 0.5 };
    case 'brittle': return { allyBarrierPct: -0.2 };
    case 'breach': return { enemyDefMul: 0.85, enemyResAdd: -6 };
    case 'bulwark': return { enemyDefMul: 1.15, enemyResAdd: 6 };
    case 'bloodlust': return { allyAtkByMissingHp: 0.5, allyAtkByMissingHpFloor: 0.3 };
    case 'decay': return { allyAtkByMissingHp: -0.3, allyAtkByMissingHpFloor: 0.3 };
    default: return {};
  }
}

/** 词条 id → 匹配层每回合行为（在回合结算处调用） */
export const TRAIT_SETTLE = Object.freeze({
  wealth: { funds: 1 },
  poor: { funds: -1 },
  revive: { lpOnPerfect: 1 },
  harsh: { lpOnNotPerfect: -1 },
  symbiosis: { layerBonus: 1 },
  scatter: { layerBonus: -1 },
  cluster: { giveItem: 'chess_item_6_09_e_a' },
  discord: { stripLayers: { bonds: 3, layers: 10 } },
  swarm: { addElite: 1 },
});

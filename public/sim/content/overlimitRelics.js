// server/sim/content/overlimitRelics.js — 超限模拟「词条」（饰品）的战斗侧 + 整备侧（业主 2026-10-31 第二批）。
//
// 数据来路：docs/research/23-overlimit-relics.json → data/relicsOverlimit.json（生成物）→ 一局里选走的 id 记在
// `m.relicsOverlimit.picked`（match/match/relicDraft.js）→ match/player/round.js 的 battleInput 把**本局生效**的
// `relicsOverlimit: [{ id, at }]` 交给每名玩家（`at` = 选走它的回合）→ 本文件只读 `ps.input.relicsOverlimit`。
//
// 开关：`battle.flags.overlimit` 不为真、或一条词条都没有 ⇒ **一个监听器都不挂**（普通 / 湮灭 / 炸惊一帧不变）。
// 词条是**全队共享**的：每名玩家的 input 里是同一份列表，本文件按 `unit.ownerId === playerId` 分派到各自的干员，
// 敌方身上那些「全体敌方」状态（破裂 / 人类的威胁）按 buff 键去重，两名玩家不会叠两份。
//
// 复用引擎既有钩子（不造平行系统，落点写在每段注释里）：
//   · 属性：support `directMods` + `passiveBuff`（直接乘算，与盟约 / 装备 / 机变同一口径）；flat 值用 hpFlat / resFlat；
//   · 伤害：`hit` / `damageCalculate` 改 `dmg.mul`（与锻造器暴击、双模机械臂、陈 以己之长同一处）；
//   · 暴击：沿用**锻造器口径**（content/forge.js）—— 暴击率 = 身上 buff 的 `critRate` 之和，命中时 `dmg.mul *= 暴伤`
//     并置 `dmg.crit`。超限局不装 forge（forge 只在 `flags.forge` / 炸惊视图下装），所以掷骰由本文件负责，priority 0；
//     其它「触发暴击时」的修正排在负 priority 上（先掷骰、后加成）；
//   · 次数盾：items/battle.js `addShieldLayer`（shieldHits，一层吃掉一整次伤害）；
//   · 技力：`spRecoveryFlat` / `skill.gainSp` / `skill.spCostMul`（锻造器的技力折扣同一条路）；
//   · 无视防御 / 法抗：`defIgnorePct` / `resIgnorePct`；无视闪避：`dmg.dodgeMode = 'ignore'`（helpers.damageDodgeMode）；
//   · 弱点伤害：items/battle.js `weaknessRetype`（双模机械臂、陈 以己之长、真言）；
//   · 恐惧：`applyStatus(target, 'fear')`；无来源真伤：`dealDamage({ type: 'true', sourceless: true })`；
//   · 立即重新部署：items/battle.js `reviveNow`（复活口径，「因移动之外的原因退场时下次部署的再部署时间和费用归零」）。
//
// [ASSUMED] 的读数（表里没写死的）：
//   · 暴击基础倍率 = ×2（沿用锻造器 200%）；FGO-05 的「180% 的暴击伤害」按**替换**成 1.8 读，其余「暴击伤害 +N%」按加算；
//   · 我方「单位」= 干员（op）；召唤物不单独挂 buff（与 content/forge.js、content/relics.js 的 ally 加成同一口径）；
//   · LC-002 的「防御力 −20%」按**每层**叠加（最多 5 层）；
//   · LC-004 的「免疫负面效果」= 该敌人的免疫表里有任何一项负面状态（data/enemies.json stats.immunities 的 true 项）；
//   · FGO-11 的恐惧时长 5 秒（表里没给）；
//   · 「每次释放技能后」按 skillStart（技能真正开始的那一刻）计一次。
//
// B 类（业主 2026-10-31 第三批：7 条里实装 6 条）+ FGO-SP（同日第四批，见下）。
//   · LC-001 的累积池按**目标**记：第一次命中把它挂成一条与[灼燃爆发]同寿的记分 buff，爆发结束（buff 到期）一次性结算；
//     结算 = 无来源[烧伤]**法术**伤害（arts），封顶 9999 万（99,990,000）；「防御力 −15%」[ASSUMED] 一局内不叠加、整场。
//   · LC-003 的[震颤]是新做的最小实现（引擎里的 `tremble` 是「战栗：被阻挡后不能普攻」，与层数无关）：20 层一爆、爆完
//     清空层数；[震颤爆发]每层 防御 −30% / 法抗 −20 / 受伤 +10%，最多 5 层。一次施加连带产生多条状态（寒冷→冻结、
//     麻痹叠层）时按**每条 statusApplied** 各计 1 层。
//   · FGO-06 的「直接斩杀」走 battle.kill（与 attack/health.js 同一落点：kill 事件 → death），普通敌 5% / 精英 2.5%，
//     **Boss 不触发**；每次命中（hit）判一次，排在暴击掷骰之前。
//   · FGO-13 的眩晕按 force + resistApplied 施加（「强制，不可无视」：免疫与抵抗都不减免）；第 10 / 20 / 30… 次触发时把
//     那一次的 5 秒眩晕换成 20 秒睡眠，计数不重置。
//   · FGO-01 的「返还 20% 技力」按 技能消耗 × 20%，在 skillStart（技力已经扣掉之后）返还。
//   · FGO-03 的「清除该回合的此状态」= 这一场（一场就是一回）里不再有[死之渊]：攻击加成 buff 摘掉且不再补挂；下一场
//     战斗（下一回合）重新赋予。
//
// FGO-SP『快楽天・胎蔵曼荼羅』（业主 2026-10-31 第四批：本版把它做实，表里 impl 从 pending → fgoSP）：
//   「获得一个[万色悠滞之核]，携带该装备的我方干员视作拥有 [调和] 盟约且攻击力 + 50%」。两半都在本文件：
//   · **发放**在整备侧（registerMeta 的 onPrepStart）：进入整备期时对每名存活玩家 `ctx.grantItem`
//     （A 类里装备类先例 = 湮灭盟约里程碑的奖励装，同一条 ctx 通道）；每名玩家一局一份，计数器去重。
//     这件装备是本批新造的（data/items.json 的 chess_item_ol_01_e_a，源头 docs/research/25-overlimit-items.json），
//     `shopExcluded` ⇒ 商店与装备池都不卖，**只能由这条词条发**；发给谁、谁带，玩家自己在整备期决定。
//   · **效果**在战斗侧：「携带它」= `unit.items` 里有那个 id ⇒ 攻击力 +50%（directMods，与盟约 / 装备同一口径的
//     直接乘算），并把这个干员声明成[调和]成员（`u.mem.extraBonds`，support/index.js unitBonds 认这份名单，
//     所以 `isMember` / `bondMembers` 这两条既有判定直接为真）。
//     [ASSUMED] 为什么不用装备记录的 `giveBondId` 写「视作拥有[调和]」：那条路要求同时挂着变形同构体
//     （shared/plugins/rules.js grantedBondsByMorph），词条原文是无条件的。也正因为成员资格是战斗期声明的，
//     整备期的**调和层数**（bondsMeta.pieceBonds）不会因这件装备 +1 —— 词条只在战斗里生效，这是本版的口径。
//     装备记录本身 `buffs` 留空（形状与变形同构体一致），数值只在这里，避免两处各加一遍变成 +100%。
//
// Hook priorities（同一条流水线上谁先谁后，改的时候别踩）：
//   hit   45 斩杀(FGO-06) → 40 无视闪避(FGO-08/16) → 30 真伤改写(FGO-X) → 20 弱点(LC-EX2) → 5 常规增伤 → 0 暴击掷骰
//        → −15 暴击后加成
//   damaged 70 呼吸 → 62 灼燃累积(LC-001) → 60 流血 → 55 破裂 → 50 恐惧 → 45 易伤
//   death 11.6 死之渊(FGO-03) → 11.5 立即重部署(LC-SP6) → 10 不屈：同时装 FGO-03 + LC-SP6 时 FGO-03 先复活，
//        LC-SP6 这一次不消耗（reviveNow 认 c.revivedBy）
import * as S from './support/index.js';
import { addShieldLayer, reviveNow, weaknessRetype } from './items/battle.js';
import { isHpLoss } from '../attack.js';

const num = S.num;

/** 本文件所有自己造成的伤害都带这个 tag；`hit` / `damaged` 里见到直接跳过（不自我循环）。 */
const TAG = 'overlimit';
/** buff key 前缀（每名玩家一份，便于阅读日志）。 */
const P = 'overlimit:';
/**
 * FGO-SP 发放的装备：`chess_item_ol_01_e_a`「万色悠滞之核」（源头 docs/research/25-overlimit-items.json，
 * 由 tools/build-data.mjs 的 applyOverlimitItems 并进 data/items.json）。`shopExcluded` ⇒ 商店 / 装备池都不卖，
 * 只能由这条词条发；它没有精锐形（`goldenId: null`、`upgradeNum: 100` 永不合体），所以只要认这一个 id。
 */
export const FGO_SP_ITEM = 'chess_item_ol_01_e_a';
/** FGO-SP 给携带者的盟约成员资格（[调和] = maniShip；见文件头的 [ASSUMED] 说明）。 */
export const FGO_SP_BOND = 'maniShip';

/** 提高暴击率的饰品（FGO-08 / 17 / Ⅹ 的「存在其他提高暴击率的饰品」按这张表数「其他」）。 */
export const CRIT_RELIC_IDS = Object.freeze(['LC-005', 'LC-SP3', 'FGO-05', 'FGO-12']);

/** 负面状态（LC-004「带有负面效果的目标」）：catalogue 的 debuff + 本文件自己的流血 / 破防。 */
const DEBUFF_STATUS = new Set([
  'stun', 'freeze', 'sleep', 'cold', 'slow', 'sluggish', 'bind', 'fear', 'silence', 'disarm', 'levitate',
  'groundbind', 'tremble', 'palsy', 'weaken', 'aspdDown', 'defDown', 'resDown', 'fragile', 'artsFragile',
  'physFragile', 'elemFragile', 'attract',
]);

/** 每名玩家的战斗状态：一份 id 集合 + 暴击配置 + 是否「全体敌方」状态已经给过。 */
function setup(battle, ids, at) {
  const has = (id) => ids.has(id);
  const relics = [...ids];
  const atOf = (id) => {
    const v = at.get(id);
    return Number.isInteger(v) && v > 0 ? v : 1;
  };
  const otherCrit = (self) => relics.filter((id) => id !== self && CRIT_RELIC_IDS.includes(id)).length;
  // 暴击倍率：基础 ×2（锻造器口径）；FGO-05「造成 180% 的暴击伤害」= 替换成 1.8
  let critMul = has('FGO-05') ? 1.8 : 2;
  if (has('FGO-08') && otherCrit('FGO-08') > 0) critMul += 1;
  if (has('FGO-17') && otherCrit('FGO-17') > 0) critMul += 0.5;
  if (has('FGO-06') && otherCrit('FGO-06') > 0) critMul += 0.5;   // FGO-06「若存在其他提高暴击率的饰品，暴击伤害 +50%」
  if (has('FGO_X')) critMul += 0.4 * otherCrit('FGO_X');
  return { has, relics, atOf, critMul, otherCrit };
}

/**
 * 一个单位的暴击率：`s.critRate`（数据白值，当前数据没有）**加上**身上所有 buff 的 `critRate`。
 * 口径与 content/forge.js `critRateOf` 完全一致 —— 将来引擎真聚合了白值，两边一起生效。
 */
function critRateOf(u) {
  let c = num(u && u.s && u.s.critRate, 0);
  for (const b of (u && u.buffs) || []) {
    const v = b && b.mods ? b.mods.critRate : null;
    if (Number.isFinite(v)) c += v;
  }
  return c;
}

/** 这个单位身上有没有负面效果（LC-004）。 */
function hasDebuff(u) {
  for (const b of (u && u.buffs) || []) {
    if (!b) continue;
    if (b.status && DEBUFF_STATUS.has(b.status)) return true;
    if (String(b.key || '').startsWith(P) && (b.key.endsWith(':bleed') || b.key.endsWith(':rupture') || b.key.endsWith(':fragile'))) return true;
    const m = b.mods;
    if (!m) continue;
    if ((Number.isFinite(m.defMul) && m.defMul < 1) || (Number.isFinite(m.atkMul) && m.atkMul < 1)
      || (Number.isFinite(m.moveMul) && m.moveMul < 1) || (Number.isFinite(m.resFlat) && m.resFlat < 0)
      || (Number.isFinite(m.aspd) && m.aspd < 0) || (Number.isFinite(m.dmgTakenMul) && m.dmgTakenMul > 1)) return true;
  }
  return false;
}

/** 这个敌人是否「免疫负面效果」（LC-004）：免疫表里至少有一项负面状态。 */
function immuneToDebuffs(u) {
  const imm = u && u.def && u.def.immune;
  if (!imm || typeof imm.has !== 'function') return false;
  for (const k of imm) if (DEBUFF_STATUS.has(k) || k === 'feared' || k === 'frozen') return true;
  return false;
}

/** 敌方是否是「精英敌人」（FGO-12 / FGO-06）：rank ELITE（与 content/relics.js 的 rankOf 同口径）。 */
const isEliteEnemy = (e) => String((e && e.def && e.def.rank) || 'NORMAL').toUpperCase() === 'ELITE';
/** Boss（FGO-06 的斩杀不触发；与 attack/health.js 的 leader 口径同源：`isBoss` 或 rank BOSS）。 */
const isBossEnemy = (e) => !!(e && (e.isBoss || String((e.def && e.def.rank) || '').toUpperCase() === 'BOSS'));

/**
 * 装一局（每名玩家一次）。`list` = `PlayerBattleInput.relicsOverlimit`（`[{ id, at }]`）。
 * @param {any} battle
 */
export function install(battle) {
  if (!battle || !battle.flags || battle.flags.overlimit !== true) return;
  for (const ps of battle.players || []) {
    const list = Array.isArray(ps && ps.input && ps.input.relicsOverlimit) ? ps.input.relicsOverlimit : [];
    const ids = new Set();
    const at = new Map();
    for (const it of list) {
      if (!it || typeof it.id !== 'string' || !it.id) continue;
      ids.add(it.id);
      at.set(it.id, Number.isInteger(it.at) ? it.at : 1);
    }
    if (!ids.size) continue;
    installPlayer(battle, ps.playerId, ids, at);
  }
}

function installPlayer(battle, pid, ids, atMap) {
  const cfg = setup(battle, ids, atMap);
  const { has, atOf } = cfg;
  const key = (k) => `${P}${pid}:${k}`;
  const ops = () => S.playerOps(battle, pid);
  const aliveOps = () => S.playerOps(battle, pid, { fieldOnly: true });
  const isMine = (u) => !!u && u.kind === 'op' && u.ownerId === pid;
  const enemyOf = (t) => !!t && t.side === 'enemy';
  /** 这张伤害单是不是「我方干员打敌人」的那一下（不是本文件自己的 proc、不是流失）。 */
  const mineHit = (c) => {
    const s = c && c.source;
    const t = c && c.target;
    const d = c && c.dmg;
    if (!s || !t || !d) return false;
    if (!isMine(s) || !enemyOf(t)) return false;
    if (isHpLoss(d) || (Array.isArray(d.tags) && d.tags.includes(TAG))) return false;
    return true;
  };

  // ---- 每个单位身上的常驻 buff（battleStart / deploy 都刷一遍；refresh:'replace' 所以是幂等的） --------------
  const syncUnit = (u) => {
    if (!isMine(u)) return;
    const stat = {};
    const put = (mods) => { for (const k of Object.keys(mods)) stat[k] = (stat[k] || 0) + mods[k]; };
    if (has('LC-SP1')) { put(S.directMods({ atk: 0.3, def: 0.3, hp: 0.4 })); stat.resFlat = (stat.resFlat || 0) + 20; }
    if (has('FGO-02')) put(S.directMods({ atk: 0.8, def: 0.3 }));
    if (has('FGO-04')) put(S.directMods({ atk: 0.3 }));
    if (has('FGO-07')) { put(S.directMods({ atk: 1 })); stat.defIgnorePct = (stat.defIgnorePct || 0) + 0.2; stat.resIgnorePct = (stat.resIgnorePct || 0) + 0.2; stat.hpRegenRatio = (stat.hpRegenRatio || 0) + 0.01; }
    if (has('FGO-08')) { put(S.directMods({ def: 1 })); stat.defIgnorePct = (stat.defIgnorePct || 0) + 0.5; stat.resIgnorePct = (stat.resIgnorePct || 0) + 0.5; }
    if (has('FGO-11')) put(S.directMods({ atk: 0.3 }));
    if (has('FGO-14')) { put(S.directMods({ atk: 0.2 })); stat.hpFlat = (stat.hpFlat || 0) + 8000; }
    if (has('FGO-17')) put(S.directMods({ atk: 0.4 }));
    if (has('FGO_X')) put(S.directMods({ atk: 0.4 }));
    if (has('FGO-01')) put(S.directMods({ atk: 0.3 }));   // [篡改过去] 的敌方状态在 enemySpawn 挂，攻击力常驻
    if (has('FGO-13')) put(S.directMods({ atk: 0.5 }));   // 自我控制链的代价在 attack 里掷骰
    if (has('LC-SP5')) { put(S.directMods({ hp: 0.05 * Math.max(1, battle.round || 1), atk: 0.15 })); }
    // FGO-SP『快楽天・胎蔵曼荼羅』：带着[万色悠滞之核]的干员 = 视作拥有[调和]盟约 + 攻击力 +50%（见文件头）。
    // 装备能发到谁身上由整备期决定，这里只认「这个单位带着它」。
    if (has('FGO_SP') && S.itemsOf(u).includes(FGO_SP_ITEM)) {
      put(S.directMods({ atk: 0.5 }));
      // 成员资格：support/index.js unitBonds 会把这份名单并进这个单位的盟约（isMember / bondMembers 直接为真）。
      u.mem.extraBonds = [FGO_SP_BOND];
    }
    // LC-SP4 火力 / 易损：获得时各 2 层，之后每回合各 +1（最多 10 层）
    if (has('LC-SP4')) {
      const grown = Math.max(0, (battle.round || atOf('LC-SP4')) - atOf('LC-SP4'));
      const fire = Math.min(10, 2 + grown);
      const vuln = Math.min(10, 2 + grown);
      stat.dmgDealtMul = (stat.dmgDealtMul || 1) * (1 + 0.15 * fire);
      stat.dmgTakenMul = (stat.dmgTakenMul || 1) * (1 + 0.2 * vuln);
    }
    // 常驻「造成的伤害 +X%」：各自一个乘区（LC-SP3 50% / LC-EX1 每件 15% / FGO-16 50%）
    if (has('LC-SP3')) stat.dmgDealtMul = (stat.dmgDealtMul || 1) * 1.5;
    if (has('LC-EX1')) stat.dmgDealtMul = (stat.dmgDealtMul || 1) * (1 + 0.15 * Math.max(1, ids.size));
    if (has('FGO-16')) stat.dmgDealtMul = (stat.dmgDealtMul || 1) * 1.5;
    // FGO-04 技力回复 +0.3
    if (has('FGO-04')) stat.spRecoveryFlat = (stat.spRecoveryFlat || 0) + 0.3;
    if (Object.keys(stat).length) S.passiveBuff(battle, u, key('stats'), stat);
    // 暴击率（常驻部分；LC-005 的呼吸按层数另算）
    const critRate = (has('LC-SP3') ? 0.2 : 0) + (has('FGO-05') ? 0.2 : 0) + (has('FGO-12') ? 0.4 : 0);
    if (critRate > 0) S.passiveBuff(battle, u, key('crit'), { critRate });
    // 减伤 20%（LC-SP3 / FGO-05 各一个乘区）
    if (has('LC-SP3')) S.passiveBuff(battle, u, key('dr-sp3'), { dmgTakenMul: 0.8 });
    if (has('FGO-05')) S.passiveBuff(battle, u, key('dr-fgo05'), { dmgTakenMul: 0.8 });
    // FGO-16 技力消耗 −20%：倍率只乘一次（deploy 会重复触发）
    if (has('FGO-16') && u.skill && !u.skill.noSkill && !u.mem.olSpCost) {
      u.mem.olSpCost = true;
      u.skill.spCostMul = u.skill.spCostMul * 0.8;
    }
    // FGO-03 [死之渊]：状态标记 + 攻击力 +70%。单独两条 buff（不进上面那条合计）—— 被击倒后「清除该回合的此状态」
    // 要能整条摘掉；`mem.olAbyssOff` 之后 syncUnit 也不再补挂（复活会重放一次 deploy → 这里）。
    if (has('FGO-03') && !u.mem.olAbyssOff) {
      S.passiveBuff(battle, u, key('abyss'), {});
      S.passiveBuff(battle, u, key('abyss-atk'), { atkPct: 0.7 });
    }
  };

  // ---- 部署：次数盾 / 初始技力 / 技力满 / 状态刷新 ------------------------------------------------------------
  const onDeploy = (u) => {
    if (!isMine(u)) return;
    syncUnit(u);
    if (has('FGO-04')) { addShieldLayer(battle, u, key('shield-fgo04'), 2); addShieldLayer(battle, u, key('shield-fgo04'), 2); }
    if (has('FGO-14')) { addShieldLayer(battle, u, key('shield-fgo14'), 2); addShieldLayer(battle, u, key('shield-fgo14'), 2); }
    if (u.skill && !u.skill.noSkill) {
      if (has('FGO-02')) u.skill.gainSp(20, 'init');
      if (has('FGO-17')) {
        const need = num(u.skill.spCost, 0) - num(u.skill.sp, 0);
        if (need > 0) u.skill.gainSp(need, 'init');
      }
    }
  };

  // 开局：只补常驻 buff（部署时的「获得 / 回复」类效果由 deploy 事件给一次，避免开局拿两份）
  battle.on('battleStart', () => { for (const u of ops()) syncUnit(u); }, { priority: -20 });
  battle.on('deploy', (c) => onDeploy(c && c.unit), { priority: 40 });

  // ---- 技能：充能(LC-006) / 禅那(LC-SP7) / FGO-15 的技力回复堆叠 ----------------------------------------------
  const onSkillStart = (u) => {
    if (!isMine(u)) return;
    if (has('LC-006')) {
      u.mem.olCharge = Math.min(100, num(u.mem.olCharge, 0) + 1);
      const step = Math.floor(u.mem.olCharge / 10); // 每满 10 层（不到 10 层什么都不给）
      if (step > 0) S.passiveBuff(battle, u, key('charge'), { dmgDealtMul: 1 + 0.1 * step, spRecoveryFlat: 0.1 * step });
    }
    if (has('LC-SP7')) {
      u.mem.olDhyana = Math.min(108, num(u.mem.olDhyana, 0) + 2);
      S.passiveBuff(battle, u, key('dhyana'), { dmgDealtMul: 1 + 0.01 * u.mem.olDhyana });
    }
    if (has('FGO-15')) {
      u.mem.olSp15 = num(u.mem.olSp15, 0) + 1;
      S.passiveBuff(battle, u, key('sp15'), { spRecoveryFlat: 0.1 * u.mem.olSp15 });
      // 「若技力回复速度大于原速度两倍」：拿当前的 s.spRecovery 与 base.spRecovery 比（buff 刚挂上，s 已重算）
      const base = num(u.base && u.base.spRecovery, 0);
      const now = num(u.s && u.s.spRecovery, 0);
      if (base > 0 && now > 2 * base) {
        u.mem.olSp15Boost = true;
        S.passiveBuff(battle, u, key('sp15-boost'), { atkPct: 0.5 });
      } else if (u.mem.olSp15Boost) {
        S.passiveBuff(battle, u, key('sp15-boost'), { atkPct: 0.5 }); // 已经开过就一直开着（不会掉回去）
      }
    }
    // FGO-01「每次使用技能后返还 20% 的技力」：skillStart 在技力扣掉之后发（skills.js activate：先 this.sp = 0）
    if (has('FGO-01') && u.skill && !u.skill.noSkill) {
      const refund = num(u.skill.spCost, 0) * 0.2;
      if (refund > 0) u.skill.gainSp(refund, 'overlimit');
    }
  };
  if (has('LC-006') || has('LC-SP7') || has('FGO-15') || has('FGO-01')) {
    battle.on('skillStart', (c) => onSkillStart(c && c.unit), { priority: 10 });
  }

  // ---- 攻击：FGO-11 恐惧 / FGO-12 回技力 / FGO-16 易伤 / FGO-06 回技力 / FGO-13 自我控制链 --------------------
  if (has('FGO-11') || has('FGO-12') || has('FGO-16') || has('FGO-06') || has('FGO-13')) {
    battle.on('attack', (c) => {
      const u = c && c.attacker;
      if (!isMine(u) || !Array.isArray(c.targets)) return;
      for (const t of c.targets) {
        if (!enemyOf(t) || !t.alive) continue;
        if (has('FGO-11') && battle.rng() < 0.1) battle.applyStatus(t, 'fear', { duration: 5, source: u });
        // 客户端没有这些自定义键的图标：不置 visible（否则会下发一条没有美术的 status 事件）
        if (has('FGO-16')) battle.addBuff(t, { key: FRAGILE_KEY, duration: 10, refresh: 'replace', mods: { dmgTakenMul: 1.5 } });
      }
      // FGO-12 / FGO-06「每次普通攻击时有 50% 概率回复 1 点技力」：两条都选时各掷一次（两条词条各给 50%）
      if (!c.isSkill && u.skill && !u.skill.noSkill) {
        if (has('FGO-12') && battle.rng() < 0.5) u.skill.gainSp(1, 'attack');
        if (has('FGO-06') && battle.rng() < 0.5) u.skill.gainSp(1, 'attack');
      }
      // FGO-13「每次攻击有 5% 的概率陷入 5 秒眩晕（强制，不可无视），触发 10 次后其陷入 20 秒睡眠」
      if (has('FGO-13') && u.alive) {
        if (battle.rng() < 0.05) {
          u.mem.olFgo13 = num(u.mem.olFgo13, 0) + 1;
          if (u.mem.olFgo13 % 10 === 0) {
            // 第 10 / 20 / 30… 次：这一下改睡 20 秒（睡眠比眩晕强，直接替掉）
            battle.applyStatus(u, 'sleep', { duration: 20, force: true, resistApplied: true, source: null });
            battle.removeBuff(u, 'stun');
          } else {
            battle.applyStatus(u, 'stun', { duration: 5, force: true, resistApplied: true, source: null });
          }
        }
      }
    }, { priority: 40 });
  }

  // ---- hit 流水线 ---------------------------------------------------------------------------------------------
  // 45：FGO-06「攻击普通/精英敌方时，有 5%/2.5% 概率直接斩杀」（Boss 不触发）
  if (has('FGO-06')) {
    battle.on('hit', (c) => {
      const d = c && c.dmg;
      const t = c && c.target;
      if (!d || !t || !t.alive || !isMine(c.source) || !enemyOf(t)) return;
      if (d.type === 'element' || isHpLoss(d) || (Array.isArray(d.tags) && d.tags.includes(TAG))) return;
      if (isBossEnemy(t)) return;                                   // 表里只写普通 / 精英
      if (!(battle.rng() < (isEliteEnemy(t) ? 0.025 : 0.05))) return;
      // 直接置死：与 attack/health.js 同一个落点（kill 事件 → death）；hit 流水线随后看到 !target.alive，返回 0
      battle.kill(t, c.source);
    }, { priority: 45 });
  }
  // 40：无视闪避（FGO-08 / FGO-16）
  if (has('FGO-08') || has('FGO-16')) {
    battle.on('hit', (c) => { if (c && c.dmg && isMine(c.source) && enemyOf(c.target)) c.dmg.dodgeMode = 'ignore'; }, { priority: 40 });
  }
  // 30：FGO-Ⅹ「对持有[人类的威胁]的敌方造成的伤害变为真实伤害」
  if (has('FGO_X')) {
    battle.on('hit', (c) => {
      const d = c && c.dmg;
      if (!d || !isMine(c.source) || !enemyOf(c.target)) return;
      if (d.type !== 'phys' && d.type !== 'arts') return;
      if (!c.target.findBuff(THREAT_KEY)) return;
      d.type = 'true';
    }, { priority: 30 });
  }
  // 20：LC-EX2「物理和法术伤害变为弱点伤害 且造成的伤害 + 225%」
  if (has('LC-EX2')) {
    battle.on('hit', (c) => {
      const d = c && c.dmg;
      if (!d || !isMine(c.source) || !enemyOf(c.target)) return;
      weaknessRetype(d, c.source, c.target);
      d.mul *= 3.25;
    }, { priority: 20 });
  }
  // 5：常规增伤（打出来的那一刻）
  const HIT_ADD = ['LC-004', 'FGO-11', 'FGO-12', 'FGO-04', 'FGO-17', 'FGO-15', 'LC-SP2', 'FGO-01', 'FGO-13'];
  if (HIT_ADD.some((id) => has(id))) {
  battle.on('hit', (c) => {
    const d = c && c.dmg;
    if (!d || !isMine(c.source) || !enemyOf(c.target)) return;
    const t = c.target;
    if (has('LC-004') && !(Array.isArray(d.tags) && d.tags.includes(TAG))) {
      if (immuneToDebuffs(t)) d.mul *= 1.3;                       // 免疫负面：改 30% 独立乘区
      else if (hasDebuff(t)) {
        d.mul *= 1.5;                                             // 带负面 +50%
        if (d.isSkill && debuffFromTarget(t, c.source)) d.mul *= 1.1; // 施加负面技能的额外 +10%
      }
    }
    if (has('FGO-11') && t.s && t.s.flags.fear) d.mul *= 2;       // 对恐惧目标 +100%
    if (has('FGO-12') && isEliteEnemy(t)) d.mul *= 1.4;           // 对精英 +40% 最终增伤
    if (has('FGO-04') && d.isSkill) d.mul *= 1.3;                 // 技能伤害 +30%
    if (has('FGO-17') && d.isSkill) d.mul *= 1.3;                 // 技能伤害 +30%
    if (has('FGO-15') && d.isSkill && c.source.mem && c.source.mem.olSp15Boost) d.mul *= 1.5; // 技能伤害 +50%
    if (has('FGO-01') && t.findBuff(PAST_KEY)) d.mul *= 1.5;      // 对[篡改过去]目标 +50%
    if (has('FGO-13') && d.isSkill) d.mul *= 2;                   // 技能伤害 +100%
    if (has('LC-SP2') && d.isAttack) d.mul *= battle.rng() < 0.5 ? 0.5 : 2.5; // 每次攻击 −50% 或 +150%
  }, { priority: 5 });
  }
  // 0：暴击掷骰（锻造器口径）
  battle.on('hit', (c) => {
    const d = c && c.dmg;
    if (!d || d.type === 'element' || !isMine(c.source) || !enemyOf(c.target)) return;
    if (Array.isArray(d.tags) && d.tags.includes(TAG)) return;
    const rate = critRateOf(c.source);
    if (!(rate > 0)) return;
    if (battle.rng() < Math.min(1, rate)) { d.mul *= cfg.critMul; d.crit = true; }
  }, { priority: 0 });
  // −15：触发暴击时的那次伤害加成（LC-SP3 +50% / LC-005 +70% 并清空呼吸）
  if (has('LC-SP3') || has('LC-005')) {
    battle.on('hit', (c) => {
      const d = c && c.dmg;
      const u = c && c.source;
      if (!d || !d.crit || !isMine(u) || !enemyOf(c.target)) return;
      if (has('LC-SP3')) d.mul *= 1.5;
      if (has('LC-005')) {
        d.mul *= 1.7;
        // [ASSUMED] 清空层数的这一下**不再**掷「每次造成伤害后 20% 获得 1 层」：否则「清空」立刻又长回 1 层，等于没清。
        d.olBreathSpent = true;
        if (num(u.mem.olBreath, 0) > 0) {
          u.mem.olBreath = 0;                                     // 清空全部呼吸层数
          S.passiveBuff(battle, u, key('breath'), { critRate: 0 });
        }
      }
    }, { priority: -15 });
  }

  // ---- LC-001 灼燃累积：目标处于[灼燃爆发]期间，我方对其造成的伤害按 50% 记进池子；爆发结束一次性结算 ------------
  if (has('LC-001')) {
    battle.on('damaged', (c) => {
      if (!mineHit(c) || !(c.amount > 0)) return;
      const t = c.target;
      const burst = t.findBuff('burnBurst');
      if (!burst) return;
      let pool = t.findBuff(BURN_POOL_KEY);
      if (!pool) {
        // 记分 buff 与这次爆发同寿：时长取爆发 buff 的剩余时间（第一次命中时对齐）
        const left = num(burst.timeLeft, num(burst.duration, 10));
        pool = battle.addBuff(t, {
          key: BURN_POOL_KEY, duration: Math.max(0.01, left), refresh: 'replace', data: { pool: 0 },
          onExpire: ({ battle: b, unit, buff }) => {
            const total = Math.min(LC001_CAP, num(buff.data && buff.data.pool, 0));
            if (!(total > 0) || !unit.alive) return;
            // 无来源[烧伤]：法术伤害（arts）；`sourceless` ⇒ 不吃来源属性、不触发本文件的其它「我方造成伤害」
            b.dealDamage(null, unit, {
              amount: total, type: 'arts', canDodge: false, sourceless: true, tags: ['dot', TAG, 'burn'],
            });
            // 防御力 −15%：[ASSUMED] 整场、同名不叠加（表里没给时长）
            if (unit.alive) b.addBuff(unit, { key: BURN_DEF_KEY, persist: true, refresh: 'replace', mods: { defPct: -0.15 } });
          },
        });
      }
      if (!pool) return;
      pool.data.pool = num(pool.data.pool, 0) + c.amount * 0.5;
    }, { priority: 62 });
  }

  // ---- LC-003 震颤：我方每对目标施加 1 个负面效果 → [震颤] +1 层；满 20 层 → [震颤爆发]（最多 5 层） -------------
  if (has('LC-003')) {
    battle.on('statusApplied', (c) => {
      const t = c && c.target;
      const s = c && c.source;
      if (!t || !enemyOf(t) || !t.alive) return;
      if (!isMine(s)) return;                                     // 只认「我方单位施加」
      if (!c.status || !DEBUFF_STATUS.has(c.status)) return;
      let b = t.findBuff(TREMOR_KEY);
      if (!b) {
        b = battle.addBuff(t, { key: TREMOR_KEY, stacks: 1, maxStacks: 20, refresh: 'replace', mods: null });
      } else {
        b.stacks = Math.min(20, num(b.stacks, 0) + 1);
        t.markDirty();
      }
      if (!b || b.stacks < 20) return;
      // 满 20 层：清空层数，[震颤爆发] +1 层（最多 5 层；每层 防御 −30% / 法抗 −20 / 受伤 +10%）
      b.stacks = 0;
      battle.addBuff(t, {
        key: TREMOR_BURST_KEY, refresh: 'stack', stacks: 1, maxStacks: 5, persist: true,
        mods: { defPct: -0.3, resFlat: -20, dmgTakenMul: 1.1 },
      });
      t.markDirty();
    }, { priority: 50 });
  }

  // ---- damaged：呼吸 / 流血 / 破裂 ----------------------------------------------------------------------------
  battle.on('damaged', (c) => {
    const d = c && c.dmg;
    if (!d || !mineHit(c) || !(c.amount > 0)) return;
    const u = c.source;
    const t = c.target;
    // LC-005 明！镜！止！水！：每次造成伤害后 20% 概率 +1 层呼吸（最多 5 层），每层暴击率 +15%
    if (has('LC-005') && !d.olBreathSpent) {
      const n = num(u.mem.olBreath, 0);
      if (n < 5 && battle.rng() < 0.2) {
        u.mem.olBreath = n + 1;
        S.passiveBuff(battle, u, key('breath'), { critRate: 0.15 * u.mem.olBreath });
      }
    }
    // LC-002 红绵花不是白棉花：为目标附加 1 层持续 20 秒的[流血]，防御力 −20%，每层 20 秒内造成该次伤害 15%
    if (has('LC-002')) {
      const payout = c.amount * 0.15;
      battle.addBuff(t, {
        key: BLEED_KEY, duration: 20, refresh: 'independent', maxStacks: 5,
        mods: { defPct: -0.2 }, interval: 1, data: { payout },
        onTick: ({ battle: b, unit, buff }) => {
          if (!unit.alive || !(buff.data.payout > 0)) return;
          b.dealDamage(null, unit, {
            amount: buff.data.payout / 20, type: 'true', canDodge: false, sourceless: true,
            tags: ['dot', 'periodic', TAG, 'bleed'],
          });
        },
      });
    }
    // LC-007 可还记得曾经的他：消耗 1 层[破裂]，按消耗前层数追加 本次实际伤害 × 2% × 层数 的无来源真伤
    if (has('LC-007')) {
      const b = t.findBuff(RUPTURE_KEY);
      if (b && b.stacks > 0) {
        const n = b.stacks;
        b.stacks = n - 1;
        if (b.stacks <= 0) battle.removeBuff(t, RUPTURE_KEY);
        else t.markDirty();
        const extra = c.amount * 0.02 * n;
        if (extra > 0) {
          battle.dealDamage(null, t, { amount: extra, type: 'true', canDodge: false, sourceless: true, tags: ['dot', TAG, 'rupture'] });
        }
      }
    }
  }, { priority: 60 });

  // ---- 敌方入场：破裂 15 层 / [人类的威胁] / [篡改过去] ----------------------------------------------------------
  if (has('LC-007') || has('FGO_X') || has('FGO-01')) {
    const onSpawn = (c) => {
      const e = c && c.enemy;
      if (!e || !e.alive) return;
      if (has('LC-007') && !e.findBuff(RUPTURE_KEY)) {
        battle.addBuff(e, { key: RUPTURE_KEY, stacks: 15, maxStacks: 15, persist: true });
      }
      if (has('FGO_X') && !e.findBuff(THREAT_KEY)) {
        // 全体敌方[人类的威胁]：两名玩家共享同一个 buff 键（去重，不叠两份）
        battle.addBuff(e, { key: THREAT_KEY, persist: true });
      }
      if (has('FGO-01') && !e.findBuff(PAST_KEY)) {
        // FGO-01「赋予全体敌方[篡改过去]状态」：共享键、persist（换场/入场都还在），只做伤害判据、不置 visible
        battle.addBuff(e, { key: PAST_KEY, persist: true });
      }
    };
    battle.on('enemySpawn', onSpawn, { priority: 50 });
    for (const e of battle.enemies || []) onSpawn({ enemy: e });
  }

  // ---- FGO-05：每回合免疫首次受到的负面效果 ---------------------------------------------------------------
  if (has('FGO-05')) {
    battle.on('beforeStatus', (c) => {
      const t = c && c.target;
      if (!isMine(t) || !c.status) return;
      if (!(DEBUFF_STATUS.has(c.status) || c.status === 'fear')) return;
      const round = battle.round || 0;
      if (t.mem.olFgo05Round === round) return;                  // 这一回合已经用过
      t.mem.olFgo05Round = round;
      c.cancel = true;
    }, { priority: 60 });
  }

  // ---- FGO-03 [死之渊]：首次被击倒立即重新部署，并清除这一场（= 这一回合）的此状态（排在 LC-SP6 的 11.5 之前） ----
  if (has('FGO-03')) {
    battle.on('death', (c) => {
      const u = c && c.unit;
      if (!isMine(u) || c.reason !== 'killed') return;
      if (u.mem.olAbyssUsed) return;                             // 一场只触发一次（下一场战斗重新赋予）
      // 先落「这一场没有死之渊」的标记：复活会重放 deploy → syncUnit，不能又把 +70% 补回来
      u.mem.olAbyssOff = true;
      if (!reviveNow(battle, c, 'overlimit:FGO-03')) {            // 归位格被占：不消耗这一次，状态也不清
        u.mem.olAbyssOff = false;
        return;
      }
      u.mem.olAbyssUsed = true;
      battle.removeBuff(u, key('abyss'));
      battle.removeBuff(u, key('abyss-atk'));
      S.fxOn(battle, 'revive', u, 'overlimit:FGO-03', 'redeploy');
    }, { priority: 11.6 });
  }

  // ---- LC-SP6：首次被击倒立即重新部署 + 10 秒 50% 攻击（优先于不屈的 death 10） -----------------------------
  if (has('LC-SP6')) {
    battle.on('death', (c) => {
      const u = c && c.unit;
      if (!isMine(u) || c.reason !== 'killed') return;
      if (u.mem.olSp6Used) return;                               // 「重新部署后效果只触发一次」
      if (!reviveNow(battle, c, 'overlimit:LC-SP6')) return;      // 归位格被占：不消耗这一次
      u.mem.olSp6Used = true;
      battle.addBuff(u, { key: key('sp6-atk'), duration: 10, refresh: 'replace', mods: { atkPct: 0.5 } });
      S.fxOn(battle, 'revive', u, 'overlimit:LC-SP6', 'redeploy');
    }, { priority: 11.5 });
  }

  // 首次进战斗时把常驻 buff 补齐（battleStart 会因为 deploy 再刷一遍，幂等）
  for (const u of aliveOps()) syncUnit(u);
}

/** FGO-Ⅹ 的全体敌方状态键（两名玩家的 handler 共享同一条 buff）。 */
const THREAT_KEY = 'overlimit:humanThreat';
/** FGO-01 的[篡改过去]：同样是全体敌方共享的一条（换场 / 新入场都补，去重）。 */
const PAST_KEY = `${P}pastTamper`;
/** LC-001：记分池 / 结算后的防御减益（都挂**目标**身上，跨玩家共享）。 */
const BURN_POOL_KEY = `${P}lc001-pool`;
const BURN_DEF_KEY = `${P}lc001-def`;
/** LC-001 的结算上限：9999 万。 */
const LC001_CAP = 99_990_000;
/** LC-003：[震颤] 层数与[震颤爆发]层数（共享键，一局一份）。 */
const TREMOR_KEY = `${P}tremor`;
const TREMOR_BURST_KEY = `${P}tremorBurst`;
// 敌方身上的三个状态用**共享键**（不带 playerId）：词条是一局全队共享的，coop 里两名玩家的 handler 认同一条
// buff —— 破裂不会各叠 15 层、流血不会出现 10 层、FGO-16 的易伤也真的「不可叠加」。
const BLEED_KEY = `${P}bleed`;
const RUPTURE_KEY = `${P}rupture`;
const FRAGILE_KEY = `${P}fgo16-fragile`;

/**
 * 目标身上有没有**这名攻击者**施加的负面效果（LC-004「若该伤害来自施加负面效果的技能额外 +10%」）。
 * [ASSUMED] 引擎没有「这条技能施加过负面」的登记，所以按 buff 的 `source` 认：同一个人挂上去的负面效果即算。
 */
function debuffFromTarget(t, source) {
  for (const b of (t && t.buffs) || []) {
    if (!b || b.source !== source) continue;
    if (b.status && DEBUFF_STATUS.has(b.status)) return true;
    if (String(b.key || '').startsWith(P) && (b.key.endsWith(':bleed') || b.key.endsWith(':rupture'))) return true;
  }
  return false;
}

// =====================================================================================================================
// 整备侧（prep side）：每回合资金 / 免费刷新 / 价格。注册名 `overlimit_relics`（content/index.js 的 registerAllMeta）。

/**
 * 整备期的词条规则（业主 2026-10-31 第二批）。全部先看 `ctx.overlimitRelics()`（本局生效的 id，非超限局是空数组），
 * 一条都没选就什么都不做 —— 普通 / 湮灭 / 炸惊一帧不变。
 */
export function registerMeta(registry) {
  registry.global('overlimit_relics', {
    // FGO-09 永久に閉ざされた理想郷「每回合获取资金 + 2」/ FGO-14 彼方に手まねく理想郷「每回合获取资金 + 1」
    onIncome(ctx, ev) {
      const ids = relicIdsOf(ctx);
      if (!ids.length || !ev) return;
      let add = 0;
      if (ids.includes('FGO-09')) add += 2;
      if (ids.includes('FGO-14')) add += 1;
      if (add) ev.income = Math.max(0, num(ev.income, 0) + add);
    },
    // FGO-17 すでに過ぎし人理の終「每回合获得 2 次免费刷新」
    onRoundStart(ctx) {
      if (relicIdsOf(ctx).includes('FGO-17')) ctx.grantFreeRefresh(2);
    },
    // LC-EX3 ？！富富？！「调度中心内所有干员的购买价格改为 1」（可与远见叠加，最低 0）
    // 全局 handler 排在盟约之前（effectsMeta dispatch 的顺序：globals → band → bonds …），所以远见的减免照旧在
    // 「1」之后再减，价格最多降到 0。
    onPrice(ctx, ev) {
      if (!ev) return;
      const kind = ev.kind ?? (ev.slot && ev.slot.kind);
      if (kind !== 'chess') return;
      if (!relicIdsOf(ctx).includes('LC-EX3')) return;
      ctx.setPrice(1);
    },
    // FGO-SP『快楽天・胎蔵曼荼羅』「获得一个[万色悠滞之核]」：进入整备期时发一件（A 类里装备类先例 = 湮灭盟约
    // 里程碑的奖励装，同一条 ctx.grantItem 通道）。词条一局全队共享，所以每名存活玩家各得一份；一局只发一次
    // （玩家计数器去重：词条是「获得该饰品后」的一次性效果，不是每回合补给）。发不出去（手牌已满且溢出位也满）
    // 时不记计数器，下一次整备期再试。
    onPrepStart(ctx) {
      if (!relicIdsOf(ctx).includes('FGO_SP')) return;
      if (ctx.counter('olFgoSpItem') > 0) return;
      if (ctx.grantItem(FGO_SP_ITEM, { source: 'relic:FGO_SP' })) ctx.setCounter('olFgoSpItem', 1);
    },
  });
}

/** `ctx.overlimitRelics()` → 本局生效的词条 id（旧 ctx / 非超限局：空数组）。 */
function relicIdsOf(ctx) {
  return ctx && typeof ctx.overlimitRelics === 'function' ? ctx.overlimitRelics() : [];
}

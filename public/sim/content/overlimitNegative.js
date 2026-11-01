// server/sim/content/overlimitNegative.js — 超限模拟「负面词条」的战斗侧 + 整备侧（业主 2026-10-31 第二批）。
//
// 数据来路：docs/research/24-overlimit-negative-relics.json → data/relicsOverlimitNegative.json（生成物）→ 一局里选走的
// `{ id, tier }` 记在 `m.relicsOverlimit.negPicked`（match/match/relicDraft.js）→ match/player/round.js 的 battleInput 把
// `relicsOverlimitNegative: [{ id, at, tier }]` 交给每名玩家 → 本文件只读 `ps.input.relicsOverlimitNegative`。
//
// **与饰品词条（content/overlimitRelics.js）完全分开**：两套表、两个键、两个池子。负面词条一局全队共享（与饰品同一
// 口径），所以这里把各玩家 input 里的负面 id 取并集**只装一次**监听器（不会因为 coop 两名玩家叠两份）。
//
// 开关：`battle.flags.overlimit` 不为真、或一条负面词条都没有 ⇒ **一个监听器都不挂**（普通 / 湮灭 / 炸惊一帧不变）。
//
// 复用引擎既有钩子（不造平行系统，落点写在每段注释里）：
//   · 敌方属性：`addBuff(..., { mods })` + `units.js _recalc`（与盟约 / 装备 / 机变同一套属性聚合；hpPct/atkPct/defPct 是
//     加算百分比，resMul / moveMul / dmgDealtMul / dmgTakenMul 是乘区）；
//   · 入场：`enemySpawn`（spawns.js：`e.hp = e.s.maxHp` 之后才发事件，所以抬高 maxHp 后要自己把血量补满）；
//   · 闪避：`hit` 流水线最前（attack/hit.js：`dmg.cancel` ⇒ 整次伤害取消），用 attack.js 的 `cancelDamage`；
//   · 伤害 / 治疗定值：`damageOutput`（计算完、伤判前，改 amount 即最终值）与 `heal`（attack/heal.js 的 hook）；
//   · 死不了：`fatal`（attack/health.js：`prevented = true` ⇒ 本次不退场、血量回到 1）；
//   · 抵消负面：`beforeStatus`（battle/status.js：`cancel = true` ⇒ 这次施加被吃掉）；
//   · 每回合过账：`registerMeta` 的 `onIncome`（整备侧，同 content/overlimitRelics.js 的 FGO-09 那条路）。
//
// 档位（Ⅰ/Ⅱ/Ⅲ 写在同一行的 8 条，业主表原文）：数字集中在本文件顶部的 TIERS 表里，逐条对
// docs/research/24-overlimit-negative-relics.json 的 tiers[].v；没写档位的 9 条只有一组数。`tier` 缺省按 Ⅰ 读。
// [ASSUMED]（表里没写死的读数，逐条列）：
//   · 「生命值 +X%」同时把**当前血量**补到新的上限（敌人入场是满血；只抬 maxHp 会凭空掉一截血，读起来不像「变厚」）；
//   · 「法抗 ±X%」按 `resMul` 乘算（法抗是百分比属性，加绝对值会溢出）；「防御力 +X%」按 `defPct` 加算（与既有词条一致）；
//   · D10「受到 12 次攻击后才被彻底击败」按**受到 12 次伤害**计，前 12 次致命伤害一律被 `fatal` 挡下（每次都是「血量归零
//     但不退场」），第 13 次起正常死亡；Boss 的血池（bossPool）不走这条（池子有自己的结算）；
//   · D12「[掌]」：入场 1 层、每 3 次技能 +1 层，**层数到 3 时触发一次**（眩晕自身 3 秒 + 全体敌方回复 2.5% 当前生命），
//     触发后层数清零重新累计；「其」按「该干员自己」读；
//   · D13「前三次技能」按**每次部署**重置；「技能造成的伤害」= `dmg.isSkill`，治疗 = 施法者技能处于激活状态时的治疗；
//     定值 1 是**最终值**（在 damageOutput / heal 之后不再被增减伤改写）；
//   · D16B「抵消一次受到的负面效果」按 `beforeStatus` 里状态属于负面集合时吃一层（`force` 施加也算 —— 表里没区分）。
//
// Hook priorities（同一条流水线上谁先谁后，改的时候别踩）：
//   hit      60 加速的未来闪避（排在最前，闪掉就整次取消）
//   damageOutput 50 噪音恐慌定值
//   fatal    30 自体发电
//   beforeStatus 40 防御害虫

import * as S from './support/index.js';
import { cancelDamage } from '../attack.js';

const num = S.num;

/** 本文件的 buff 键前缀（不带 playerId：负面词条一局全队共享，一条 buff 一份）。 */
const P = 'overlimitNeg:';

/** D10 的免死次数（表：12 次攻击后彻底击败）。 */
const UNDYING_HITS = 12;
/** D12 的[掌]层数上限（表：达到 3 层时触发）。 */
const PALM_STACKS = 3;
/** D16A/D16B 的基础层数与「两者同时拥有」的翻倍（表：5 层，各 +7.5% / 各抵消 1 次）。 */
const PEST_STACKS = 5;
const PEST_ATK_PER_STACK = 0.075;
/** D15 的闪避衰减（表：每受到 1 次伤害 −5%）。 */
const FUTURE_DODGE_STEP = 0.05;

/**
 * 负面状态的清单（D16B「负面效果」的口径）：与 content/overlimitRelics.js 的 DEBUFF_STATUS 同一份（那里是
 * LC-004「带有负面效果的目标」的判据），另加本文件自己不用额外登记的几项。
 */
const DEBUFF_STATUS = new Set([
  'stun', 'freeze', 'sleep', 'cold', 'slow', 'sluggish', 'bind', 'fear', 'silence', 'disarm', 'levitate',
  'groundbind', 'tremble', 'palsy', 'weaken', 'aspdDown', 'defDown', 'resDown', 'fragile', 'artsFragile',
  'physFragile', 'elemFragile', 'attract',
]);

/**
 * 档位数值（业主表 负面词条列表_16项.xlsx 的「Ⅰ/Ⅱ/Ⅲ」三档；逐条对 docs/research/24-overlimit-negative-relics.json
 * 的 `tiers[].v`，键名与那里一致、符号也照抄表里的写法）。没列在这里的条目没有档位。
 */
const TIERS = Object.freeze({
  // 我方每回合发放的经费 -2 / -4 / -6（负号就是表里的减号，registerMeta 直接加）
  'LC-D01': Object.freeze([{ funds: -2 }, { funds: -4 }, { funds: -6 }]),
  // 敌方的基础生命值、攻击力、防御力，法抗 + 10% / 20% / 35%
  'LC-D02': Object.freeze([
    { hp: 0.1, atk: 0.1, def: 0.1, res: 0.1 }, { hp: 0.2, atk: 0.2, def: 0.2, res: 0.2 }, { hp: 0.35, atk: 0.35, def: 0.35, res: 0.35 },
  ]),
  // 敌方获得 20% / 30% / 45% 造成的伤害提升
  'LC-D03': Object.freeze([{ dealt: 0.2 }, { dealt: 0.3 }, { dealt: 0.45 }]),
  // 敌方攻击力和生命 + 10% / 20% / 35%
  'LC-D04': Object.freeze([{ hp: 0.1, atk: 0.1 }, { hp: 0.2, atk: 0.2 }, { hp: 0.35, atk: 0.35 }]),
  // 敌方生命值 + 25% / 40% / 60%
  'LC-D05': Object.freeze([{ hp: 0.25 }, { hp: 0.4 }, { hp: 0.6 }]),
  // 敌方生命值 + 10% / 15% / 25%，受到的伤害 - 15% / 20% / 25%，造成的伤害 + 10%
  'LC-D06': Object.freeze([
    { hp: 0.1, taken: 0.15, dealt: 0.1 }, { hp: 0.15, taken: 0.2, dealt: 0.1 }, { hp: 0.25, taken: 0.25, dealt: 0.1 },
  ]),
  // 敌方入场后攻击力在 30 秒内不断提高至原来的 130% / 170% / 210%
  'LC-D07': Object.freeze([{ to: 1.3 }, { to: 1.7 }, { to: 2.1 }]),
  // 敌方入场后防御力和法抗在 30 秒内不断提高至原来的 130% / 170% / 210%
  'LC-D08': Object.freeze([{ to: 1.3 }, { to: 1.7 }, { to: 2.1 }]),
});

/**
 * 一条负面词条在本局某个档位下的数值。`tier` 缺失 / 越界时按 Ⅰ（表里最轻的一档）读，绝不抛错。
 * @param {string} id @param {number|null} tier @param {string} key
 * @returns {number}
 */
function tv(id, tier, key) {
  const tiers = TIERS[id];
  if (!Array.isArray(tiers) || !tiers.length) return 0;
  const at = Number.isInteger(tier) ? Math.min(tiers.length - 1, Math.max(0, tier)) : 0;
  return num(tiers[at] && tiers[at][key], 0);
}

/**
 * 本局全部负面词条 → `Map<id, tier>`（各玩家 input 取并集；一局全队共享，所以只装一次）。
 * @param {any} battle
 * @returns {Map<string, number|null>}
 */
function negativeOf(battle) {
  const out = new Map();
  for (const ps of battle.players || []) {
    const list = Array.isArray(ps && ps.input && ps.input.relicsOverlimitNegative) ? ps.input.relicsOverlimitNegative : [];
    for (const it of list) {
      if (!it || typeof it.id !== 'string' || !it.id || out.has(it.id)) continue;
      out.set(it.id, Number.isInteger(it.tier) ? it.tier : null);
    }
  }
  return out;
}

/**
 * 装一局（全队一份）。`battle.flags.overlimit` 为假 / 一条都没有 ⇒ 什么都不挂。
 * @param {any} battle
 */
export function install(battle) {
  if (!battle || !battle.flags || battle.flags.overlimit !== true) return;
  const picks = negativeOf(battle);
  if (!picks.size) return;
  const has = (id) => picks.has(id);
  const tierOf = (id) => (picks.has(id) ? picks.get(id) : null);
  const v = (id, key) => tv(id, tierOf(id), key);

  const allyOps = () => (battle.allyUnits || []).filter((u) => u && u.kind === 'op' && u.alive);
  const enemies = () => (battle.enemies || []).filter((e) => e && e.alive);
  const isAlly = (u) => !!u && u.side === 'ally' && u.kind === 'op';
  const isEnemy = (e) => !!e && e.side === 'enemy';

  // ---- 敌方入场：D02 / D03 / D04 / D05 / D06 / D09 / D11 / D16A 的常驻属性 + D07 / D08 的成长 + D10 / D15 / D16B 的载体 ----
  const ENEMY_STATIC = has('LC-D02') || has('LC-D03') || has('LC-D04') || has('LC-D05') || has('LC-D06')
    || has('LC-D09') || has('LC-D11') || has('LC-D16A');
  const onSpawn = (c) => {
    const e = c && c.enemy;
    if (!isEnemy(e) || !e.alive) return;
    if (ENEMY_STATIC) {
      const mods = {};
      const add = (k, d) => { if (Number.isFinite(d) && d) mods[k] = num(mods[k], 0) + d; };
      const mul = (k, d) => { if (Number.isFinite(d) && d && d !== 1) mods[k] = num(mods[k], 1) * d; };
      // D02 基础威力增强：基础生命/攻击/防御 +X%，法抗 ×(1+X)
      if (has('LC-D02')) {
        add('hpPct', v('LC-D02', 'hp')); add('atkPct', v('LC-D02', 'atk')); add('defPct', v('LC-D02', 'def'));
        mul('resMul', 1 + v('LC-D02', 'res'));
      }
      // D03 最终威力增强：造成的伤害 +X%
      if (has('LC-D03')) mul('dmgDealtMul', 1 + v('LC-D03', 'dealt'));
      // D04 拼点威力增强：攻击力与生命 +X%
      if (has('LC-D04')) { add('hpPct', v('LC-D04', 'hp')); add('atkPct', v('LC-D04', 'atk')); }
      // D05 生长：生命 +X%
      if (has('LC-D05')) add('hpPct', v('LC-D05', 'hp'));
      // D06 肉体强化：生命 +X%、受到的伤害 −X%、造成的伤害 +10%
      if (has('LC-D06')) {
        add('hpPct', v('LC-D06', 'hp'));
        mul('dmgTakenMul', 1 - v('LC-D06', 'taken'));
        mul('dmgDealtMul', 1 + v('LC-D06', 'dealt'));
      }
      // D09 底力：移动速度、攻击速度、防御力 +25%
      if (has('LC-D09')) { mul('moveMul', 1.25); add('aspd', 25); add('defPct', 0.25); }
      // D11 灼烧着的伤口：防御/法抗 −50%，攻击力 +75%、造成的伤害 +30%
      if (has('LC-D11')) { add('defPct', -0.5); mul('resMul', 0.5); add('atkPct', 0.75); mul('dmgDealtMul', 1.3); }
      // D16A 攻击害虫：5 层，每层 +7.5% 造成的伤害（同时拥有防御害虫 → 层数翻倍）
      if (has('LC-D16A')) {
        const stacks = PEST_STACKS * (has('LC-D16B') ? 2 : 1);
        mul('dmgDealtMul', 1 + PEST_ATK_PER_STACK * stacks);
        // 层数单独挂一条（只做显示 / 快照，不重复加数值）
        battle.addBuff(e, { key: `${P}pestAtk`, stacks, maxStacks: stacks, persist: true, refresh: 'replace', data: { stacks } });
      }
      if (Object.keys(mods).length) {
        battle.addBuff(e, { key: `${P}enemyStats`, persist: true, refresh: 'replace', mods });
        // 生命上限变了：敌人入场是满血（spawns.js `e.hp = e.s.maxHp` 在 enemySpawn 之前），这里把当前血量补到新上限
        if (Number.isFinite(mods.hpPct) && mods.hpPct > 0 && !e.bossPool) { e.markDirty(); e.hp = e.s.maxHp; }
      }
    }
    // D07 锐利 / D08 坚韧：入场后 30 秒内线性爬升到目标值（到期换成一条等效的常驻 buff，数值不再回落）
    for (const [id, kind] of [['LC-D07', 'atk'], ['LC-D08', 'def']]) {
      if (!has(id)) continue;
      const to = v(id, 'to');
      if (!(to > 1)) continue;
      battle.addBuff(e, {
        key: `${P}${kind}Ramp`, duration: 30, interval: 1, refresh: 'replace', data: { t: 0 },
        mods: kind === 'atk' ? { atkPct: 0 } : { defPct: 0, resMul: 1 },
        onTick: ({ unit, buff, dt }) => {
          buff.data.t = Math.min(30, num(buff.data.t, 0) + num(dt, 1));
          const p = buff.data.t / 30;
          if (kind === 'atk') buff.mods.atkPct = (to - 1) * p;
          else { buff.mods.defPct = (to - 1) * p; buff.mods.resMul = 1 + (to - 1) * p; }
          unit.markDirty();
        },
        onExpire: ({ battle: b, unit }) => {
          if (!unit.alive) return;
          b.addBuff(unit, {
            key: `${P}${kind}RampEnd`, persist: true, refresh: 'replace',
            mods: kind === 'atk' ? { atkPct: to - 1 } : { defPct: to - 1, resMul: to },
          });
        },
      });
    }
    // D10 自体发电：血量归零不退场（受击计数在下面的 damaged 里）
    if (has('LC-D10')) e.mem.olNegHits = 0;
    // D15 加速的未来：100% 闪避，每受到 1 次伤害 −5%
    if (has('LC-D15')) e.mem.olNegDodge = 1;
    // D16B 防御害虫：5 层（同时拥有攻击害虫 → 翻倍），每层抵消一次受到的负面效果
    if (has('LC-D16B')) {
      const stacks = PEST_STACKS * (has('LC-D16A') ? 2 : 1);
      e.mem.olNegPest = stacks;
      battle.addBuff(e, { key: `${P}pestDef`, stacks, maxStacks: stacks, persist: true, refresh: 'replace', data: { stacks } });
    }
  };
  if (ENEMY_STATIC || has('LC-D07') || has('LC-D08') || has('LC-D10') || has('LC-D15') || has('LC-D16B')) {
    battle.on('enemySpawn', onSpawn, { priority: 55 });
    for (const e of battle.enemies || []) onSpawn({ enemy: e });
  }

  // ---- D15 加速的未来：闪避（hit 流水线最前；闪掉就整次取消） ------------------------------------------------
  if (has('LC-D15')) {
    battle.on('hit', (c) => {
      const d = c && c.dmg;
      const t = c && c.target;
      if (!d || !isEnemy(t) || !isAlly(c.source)) return;
      if (Array.isArray(d.tags) && d.tags.includes('hpLoss')) return;
      const p = num(t.mem && t.mem.olNegDodge, 0);
      if (!(p > 0)) return;
      if (!(battle.rng() < p)) return;
      if (cancelDamage(d, 'dodge')) battle.fx('dodge', { x: t.x, y: t.y, id: t.id });
    }, { priority: 60 });
  }

  // ---- D10 自体发电：致命伤害被挡下，直到受到 12 次伤害 ------------------------------------------------
  if (has('LC-D10')) {
    battle.on('fatal', (c) => {
      const u = c && c.unit;
      if (!isEnemy(u) || u.bossPool) return;
      if (num(u.mem && u.mem.olNegHits, 0) >= UNDYING_HITS) return;
      c.prevented = true;
    }, { priority: 30 });
  }

  // ---- damaged：D10 受击计数、D15 闪避衰减（两条都只数真正落下来的伤害） --------------------------------
  if (has('LC-D10') || has('LC-D15')) {
    battle.on('damaged', (c) => {
      const t = c && c.target;
      if (!isEnemy(t) || !(c.amount > 0)) return;
      if (has('LC-D10')) t.mem.olNegHits = num(t.mem.olNegHits, 0) + 1;
      if (has('LC-D15')) t.mem.olNegDodge = Math.max(0, num(t.mem.olNegDodge, 0) - FUTURE_DODGE_STEP);
    }, { priority: 40 });
  }

  // ---- D16B 防御害虫：每层吃掉一次负面效果（beforeStatus 取消） ------------------------------------------
  if (has('LC-D16B')) {
    battle.on('beforeStatus', (c) => {
      const t = c && c.target;
      if (!isEnemy(t) || !c.status || !DEBUFF_STATUS.has(c.status)) return;
      const left = num(t.mem && t.mem.olNegPest, 0);
      if (!(left > 0)) return;
      t.mem.olNegPest = left - 1;
      c.cancel = true;
      const b = t.findBuff(`${P}pestDef`);
      if (b) {
        b.stacks = Math.max(0, left - 1);
        b.data.stacks = b.stacks;
        if (b.stacks <= 0) battle.removeBuff(t, `${P}pestDef`);
        else t.markDirty();
      }
    }, { priority: 40 });
  }

  // ---- D14 葬花针：我方单位每秒受到最大生命值 2.5% 的无来源伤害 --------------------------------------------
  if (has('LC-D14')) {
    const needle = (u) => {
      if (!isAlly(u) || u.findBuff(`${P}needle`)) return;
      battle.addBuff(u, {
        key: `${P}needle`, persist: true, refresh: 'replace', interval: 1,
        onTick: ({ battle: b, unit }) => {
          if (!unit.alive) return;
          const amount = unit.s.maxHp * 0.025;
          if (!(amount > 0)) return;
          // 无来源（sourceless）+ 真实伤害：不计谁的输出，不吃防御法抗（「受到…无来源伤害」的读法）
          b.dealDamage({ source: null, target: unit, amount, type: 'true', canDodge: false, sourceless: true, tags: ['dot', P, 'needle'] });
        },
      });
    };
    battle.on('deploy', (c) => { if (c && c.unit && isAlly(c.unit)) needle(c.unit); }, { priority: 42 });
    for (const u of allyOps()) needle(u);
  }

  // ---- D13 噪音恐慌：每次部署后前三次技能造成的伤害 / 治疗固定为 1 ----------------------------------------
  if (has('LC-D13')) {
    const reset = (u) => { if (u && u.mem) { u.mem.olNegSkills = 0; u.mem.olNegDeployTag = (u.mem.olNegDeployTag | 0) + 1; } };
    const usedUp = (u) => num(u && u.mem && u.mem.olNegSkills, 0) <= 3;   // 第 1/2/3 次技能：still capped
    battle.on('deploy', (c) => { if (c && isAlly(c.unit)) reset(c.unit); }, { priority: 41 });
    battle.on('skillStart', (c) => {
      const u = c && c.unit;
      if (!isAlly(u)) return;
      u.mem.olNegSkills = num(u.mem.olNegSkills, 0) + 1;
    }, { priority: 41 });
    battle.on('damageOutput', (c) => {
      const s = c && c.source;
      const d = c && c.dmg;
      if (!isAlly(s) || !d || !d.isSkill || !usedUp(s)) return;
      if (Array.isArray(d.tags) && d.tags.includes(P)) return;
      c.amount = 1;
    }, { priority: 50 });
    battle.on('heal', (c) => {
      const s = c && c.source;
      if (!isAlly(s) || !usedUp(s)) return;
      if (!s.skill || !s.skill.active) return;   // 只算「技能造成的治疗」
      c.amount = 1;
    }, { priority: 50 });
    for (const u of allyOps()) reset(u);
  }

  // ---- D12 掌：入场 1 层，每 3 次技能 +1 层；到 3 层 → 自身眩晕 3 秒 + 全体敌方回复 2.5% 当前生命 --------
  if (has('LC-D12')) {
    const enter = (u) => { if (u && u.mem) { u.mem.olPalm = 1; u.mem.olPalmSkills = 0; } };
    battle.on('deploy', (c) => { if (c && isAlly(c.unit)) enter(c.unit); }, { priority: 40 });
    battle.on('skillStart', (c) => {
      const u = c && c.unit;
      if (!isAlly(u)) return;
      u.mem.olPalmSkills = num(u.mem.olPalmSkills, 0) + 1;
      if (u.mem.olPalmSkills % 3 !== 0) return;                       // 每使用 3 次技能 +1 层
      u.mem.olPalm = num(u.mem.olPalm, 1) + 1;
      if (u.mem.olPalm < PALM_STACKS) return;
      // 达到 3 层：其眩晕 3 秒，且使所有敌方回复 2.5% 当前生命值（层数清零、重新累计）
      u.mem.olPalm = 0;
      u.mem.olPalmSkills = 0;
      battle.applyStatus(u, 'stun', { duration: 3, force: true, source: null });
      for (const e of enemies()) {
        const heal = e.hp * 0.025;
        if (heal > 0) battle.heal(null, e, heal, { mode: 'restore', silent: true });
      }
    }, { priority: 40 });
    for (const u of allyOps()) enter(u);
  }
}

// =====================================================================================================================
// 整备侧（prep side）：D01 破坏力 —— 每回合经费 −2 / −4 / −6。
// 注册名 `overlimit_negatives`（content/index.js 的 registerAllMeta）。

/**
 * 负面词条的整备期规则。全部先看 `ctx.overlimitNegatives()`（本局选走的负面词条 `[{ id, at, tier }]`；非超限局是
 * 空数组），一条都没有就什么都不做 —— 普通 / 湮灭 / 炸惊一帧不变。
 * @param {any} registry
 */
export function registerMeta(registry) {
  registry.global('overlimit_negatives', {
    // D01 破坏力Ⅰ/Ⅱ/Ⅲ「我方每回合发放的经费 -2 / -4 / -6」：最低到 0（经费不会变成负数）
    onIncome(ctx, ev) {
      if (!ev) return;
      const list = negativesOf(ctx);
      if (!list.length) return;
      let cut = 0;
      for (const it of list) if (it && it.id === 'LC-D01') cut += tv('LC-D01', it.tier, 'funds');
      if (cut < 0) ev.income = Math.max(0, num(ev.income, 0) + cut);
    },
  });
}

/**
 * `ctx.overlimitNegatives()` → 本局选走的负面词条 `[{ id, at, tier }]`（旧 ctx / 非超限局：空数组）。
 * @param {any} ctx
 * @returns {{ id: string, at: number, tier: number|null }[]}
 */
function negativesOf(ctx) {
  if (!ctx || typeof ctx.overlimitNegatives !== 'function') return [];
  const list = ctx.overlimitNegatives();
  return Array.isArray(list) ? list : [];
}

// tools/bond-matrix.mjs — 大盟约 × 小盟约 的 DPS / HPS 交叉表（业主 2026-10-19）
//
// 每个组合 = 1 个大盟约 + 4 个影响数值的小盟约，套在同一支固定阵容上，
// 打同一场固定战斗（同种子、同敌人、同时限），读回 DPS / HPS。
//
// 校准（见 tools/bond-matrix.mjs --calibrate）：大盟约要求干员的 bonds 里含该盟约，
// 且 battle 的 bonds 里 tier 正确 —— 否则测出来的是「没生效」而不是「弱」。

import { makeBattle, chessRec, enemyRec } from '../test/helpers/battleHarness.js';

const CORE = ['yanShip', 'sargonShip', 'victoriaShip', 'kjeragShip', 'lateranoShip', 'egirShip', 'siracusaShip', 'kazimierzShip'];
// 只保留实测有数值贡献的 6 个（visi/sunt/mani/sundi 两轮实测恒为 0，见 --marginal）
const SMALL = ['preciShip', 'swiftShip', 'skillfulShip', 'arcaneShip', 'steadShip', 'deputShip'];
const DEAD = ['visiShip', 'suntShip', 'maniShip', 'sundiShip'];

const RANGE = (() => { const g = []; for (let dy = -3; dy <= 3; dy++) for (let dx = -10; dx <= 10; dx++) g.push([dy, dx]); return g; })();

// 干员带真实技能（弹药类，满足拉特兰）+ 装备（满足维多利亚）+ 每回合启动（满足萨尔贡）
const mk = (id, prof, atk, hp, bonds, { items = [], ammo = false } = {}) => chessRec({
  id, profession: prof, bonds,
  stats: { atk, maxHp: hp, def: 300, res: 20, bat: 1.2, aspd: 100, blockCnt: prof === 'DEFENDER' ? 3 : 1 },
  skill: ammo
    ? { spCost: 8, initSp: 8, duration: 3, bb: {}, trigger: { rule: 'SP_FULL' }, skillType: 'MANUAL', durationType: 'NONE' }
    : { spCost: 10, initSp: 10, duration: 2, bb: {}, trigger: { rule: 'SP_FULL' }, skillType: 'MANUAL', durationType: 'NONE' },
  rangeGrid: RANGE,
  // items 由 sim 读 units[].items（装备 id 数组），这里只是让记录带上默认值
  ...(items.length ? { items } : {}),
});

// 靶子：血厚、会还手（治疗有量）、不移动（所有干员都能覆盖）
const TARGET = enemyRec({ key: 'enemy_target', hp: 2e6, atk: 1500, speed: 0, def: 200, res: 20, bat: 0.8, range: 8 });

/** 跑一场固定战斗。tier / layers 由调用方给，干员的 bonds 含 core + 全部 small。 */
function runOnce(core, smalls, tier = 2, layers = 30, scaleAtk = 1) {
  const tags = [core, ...smalls];
  // 3 件装备（维多利亚要求「带装备的成员」；拉特兰要求弹药技能）
  const ITEMS = ['chess_item_4_01_e_a', 'chess_item_4_02_e_a', 'chess_item_4_03_e_a'];
  const defs = {
    chess: {
      d1: mk('d1', 'SNIPER', 900 * scaleAtk, 2200, tags, { items: ITEMS, ammo: true }),
      d2: mk('d2', 'CASTER', 850 * scaleAtk, 2000, tags, { items: ITEMS, ammo: true }),
      d3: mk('d3', 'WARRIOR', 1000 * scaleAtk, 3000, tags, { items: ITEMS, ammo: true }),
      h1: mk('h1', 'MEDIC', 100 * scaleAtk, 1800, tags, { items: ITEMS }),
      t1: mk('t1', 'DEFENDER', 300 * scaleAtk, 6000, tags, { items: ITEMS }),
    },
    enemies: { enemy_target: TARGET },
  };
  const bonds = {};
  for (const id of tags) bonds[id] = { count: 6, active: true, tier, layers };
  const h = makeBattle({
    defs,
    units: [
      { chessId: 'd1', row: 10, col: 4, items: ITEMS }, { chessId: 'd2', row: 11, col: 4, items: ITEMS },
      { chessId: 'd3', row: 9, col: 6, items: ITEMS }, { chessId: 'h1', row: 10, col: 7, items: ITEMS },
      { chessId: 't1', row: 11, col: 7, items: ITEMS },
    ],
    enemies: [{ key: 'enemy_target', pos: [9, 8] }],
    bonds, timeLimit: 60, content: 'full', autoFinish: false, flags: { layerGainsEnabled: true, overlimit: true },
  });
  h.run(45);
  // 只统计玩家干员（kind === 'op'）：炎佑 / 召唤物 / 协防干员不算进阵容 DPS
  let dmg = 0, heal = 0;
  for (const x of h.b.allyUnits || []) {
    if (x.kind !== 'op') continue;
    dmg += Number(x.stats && x.stats.dmg) || 0;
    heal += Number(x.stats && x.stats.heal) || 0;
  }
  const t = Math.max(1, h.b.time || 1);
  const e = (h.b.enemies || [])[0];
  return { dps: dmg / t, hps: heal / t, dmg, heal, t, left: e ? Math.round(e.hp) : -1 };
}


// --marginal：每个小盟约单独叠加在某一大盟约上的边际贡献（其余 3 个固定）
if (process.argv.includes('--marginal')) {
  const BASE3 = ['swiftShip', 'arcaneShip', 'steadShip'];
  const pad = (x, n) => String(x).padEnd(n);
  console.log('小盟约边际贡献（基准 = 大盟约 + swiftShip+arcaneShip+steadShip）');
  console.log(pad('大盟约', 16) + pad('基准 DPS', 10) + pad('+preci', 10) + pad('+skillful', 11) + pad('+deput', 10) + pad('+visi', 10) + pad('+sunt', 10) + pad('+mani', 10) + '+sundi');
  for (const core of CORE) {
    const base = runOnce(core, BASE3).dps;
    const cells = [];
    for (const extraBond of ['preciShip', 'skillfulShip', 'deputShip', 'visiShip', 'suntShip', 'maniShip', 'sundiShip']) {
      const d = runOnce(core, [...BASE3, extraBond]).dps;
      cells.push((d - base >= 0 ? '+' : '') + (d - base).toFixed(0));
    }
    console.log(pad(core, 16) + pad(base.toFixed(1), 10) + cells.map((c) => pad(c, 10)).join(''));
  }
  process.exit(0);
}


// --real：用真实 Match 造阵容（真实技能 + 真实装备），再从 battleInput 拿 units
if (process.argv.includes('--real')) {
  const { makeMatch, give } = await import('../test/match/harness.js');
  const { createBattleFromSpec } = await import('../server/sim/spec.js');
  const runReal = (core, smalls) => {
    const h = makeMatch({ modeId: 'mode_single_hard', difficulty: 'HARD', seed: 5, fake: true,
      script: () => ({ duration: 1, leaks: {}, bossDps: 1e9 }) }).start();
    h.autoHumans();
    const m = h.m;
    h.drive(() => h.ended != null || (m.round === 1 && m.phase === 'PREP'));
    const ps = m.players.get('p_0');
    ps.funds = 9999;
    // 5 个 tier5 干员（3 输出 + 1 医疗 + 1 重装），每人 3 件 tier4 装备
    const tier5 = Object.entries(m.gd.raw.chess).filter(([, c]) => c.tier === 5);
    const pickBy = (prof) => tier5.filter(([, c]) => (c.profession || '').toUpperCase().includes(prof)).slice(0, 1);
    const chosen = [...pickBy('SNIPER'), ...pickBy('CASTER'), ...pickBy('WARRIOR'), ...pickBy('MEDIC'), ...pickBy('DEFENDER')];
    const t4 = Object.entries(m.gd.raw.items).filter(([, i]) => i.tier === 4).map(([id]) => id);
    const placed = [];
    for (const [i, [cid]] of chosen.entries()) {
      placed.push(give(m, ps, cid, 'board', [9 + (i % 3), 3 + i]));
    }
    for (const [i, piece] of placed.entries()) {
      for (let k = 0; k < 3; k++) {
        const itemId = t4[(i * 3 + k) % t4.length];
        try { ps.acquireItem(itemId, { source: 'dev' }); } catch { /* pool */ }
        const it = (ps.hand || []).find((x) => x && x.kind === 'item');
        if (it) { try { ps.equipItem(it.uid, piece.uid); } catch { /* ignore */ } }
      }
    }
    ps.recompute();
    const input = ps.battleInput({ side: 'L', colOffset: 0 });
    const bonds = {};
    for (const id of [core, ...smalls]) bonds[id] = { count: 6, active: true, tier: 2, layers: 30 };
    for (const u of input.units || []) u.bonds = bonds;
    const spawns = [{ time: 0, enemyKey: 'enemy_target', pos: [9, 8], count: 1, interval: 0 }];
    const spec = {
      seed: 5, kind: 'normal', modeId: 'mode_single_hard', round: 20, stageId: 'act1autochess_m01',
      rect: { r0: 9, r1: 12, c0: 0, c1: 10 }, timeLimit: 60,
      players: [input], spawns, routes: [{ motion: 'WALK', start: [9, 10], end: [9, 2], checkpoints: [] }],
      sharedBoss: null, flags: { layerGainsEnabled: true, ...m.gd.dp }, fieldId: 't', enemyOverrides: {}, waveId: null,
    };
    const b = createBattleFromSpec(spec, m.ds, {});
    // 替换成固定靶子（用真实数据里的高血量敌人）
    let ticks = 0;
    while (!b.finished && ticks < 20000) { b.step(); ticks++; }
    const res = b.result ? b.result() : null;
    const pp = res && res.perPlayer ? res.perPlayer[ps.playerId] : null;
    const dmg = Number(pp && pp.damageDealt) || 0;
    const heal = Number(pp && pp.healingDone) || 0;
    const t = Math.max(1, b.time || 1);
    m.dispose();
    return { dps: dmg / t, hps: heal / t, dmg, heal, n: (input.units || []).length, items: (input.units || []).reduce((a, u) => a + (u.items || []).length, 0) };
  };
  const pad = (x, n) => String(x).padEnd(n);
  console.log('真实阵容（tier5 干员 + tier4 装备 + 真实技能）');
  console.log(pad('大盟约', 16) + pad('干员', 6) + pad('装备', 6) + pad('DPS', 10) + pad('HPS', 9) + '总伤害');
  for (const core of CORE) {
    const r = runReal(core, ['preciShip', 'swiftShip', 'arcaneShip', 'steadShip']);
    console.log(pad(core, 16) + pad(r.n, 6) + pad(r.items, 6) + pad(r.dps.toFixed(1), 10) + pad(r.hps.toFixed(1), 9) + Math.round(r.dmg));
  }
  process.exit(0);
}


// --headroom：每个大盟约需要多少「攻击力补正」才能追平全体中位数 DPS
if (process.argv.includes('--headroom')) {
  const medianOf = (arr) => { const a = [...arr].sort((x, y) => x - y); return a[Math.floor(a.length / 2)]; };
  // 用「4 组小盟约的均值」作为每个大盟约的代表值（与全表口径一致）
  const BASE3 = ['swiftShip', 'arcaneShip', 'steadShip'];
  const avgOf = (core) => {
    let n = 0, sum = 0;
    for (let k = 0; k < 4; k++) {
      const smalls = [0, 1, 2, 3].map((j) => SMALL[(CORE.indexOf(core) * 3 + k + j) % SMALL.length]);
      sum += runOnce(core, smalls).dps; n++;
    }
    return sum / n;
  };
  const dpsOf = {};
  for (const core of CORE) dpsOf[core] = avgOf(core);
  const median = medianOf(Object.values(dpsOf));
  const pad = (x, n) => String(x).padEnd(n);
  console.log('补正需求（目标 = 全体中位数 DPS ' + median.toFixed(0) + '）');
  console.log(pad('大盟约', 16) + pad('当前 DPS', 11) + pad('差额', 10) + pad('需要的攻击补正', 16) + '判定');
  for (const core of CORE) {
    const cur = dpsOf[core];
    if (cur >= median) { console.log(pad(core, 16) + pad(cur.toFixed(0), 11) + pad('—', 10) + pad('—', 16) + '已达标'); continue; }
    // 二分：scaleAtk 让 DPS 达到 median
    let lo = 1, hi = 4;
    for (let i = 0; i < 12; i++) {
      const mid = (lo + hi) / 2;
      if (runOnce(core, BASE3, 2, 30, mid).dps < median) lo = mid; else hi = mid;
    }
    const need = (hi - 1) * 100;
    console.log(pad(core, 16) + pad(cur.toFixed(0), 11) + pad((median - cur).toFixed(0), 10) + pad('+' + need.toFixed(0) + '%', 16) + (need > 60 ? '需大改' : need > 25 ? '需中等补正' : '小幅补正即可'));
  }
  process.exit(0);
}

// --survive：生存向指标（阿戈尔这类不靠 DPS 的盟约）
if (process.argv.includes('--survive')) {
  const BASE3 = ['swiftShip', 'arcaneSkill', 'steadShip'].filter((x) => x !== 'arcaneSkill').concat(['arcaneShip']);
  const pad = (x, n) => String(x).padEnd(n);
  console.log('生存指标（靶子攻 3000，测 60s 内的掉血 / 死亡 / 治疗）');
  console.log(pad('大盟约', 16) + pad('总承伤', 10) + pad('总治疗', 10) + pad('阵亡数', 9) + pad('存活时长', 10));
  for (const core of CORE) {
    const tags = [core, ...BASE3];
    const ITEMS = ['chess_item_4_01_e_a', 'chess_item_4_02_e_a', 'chess_item_4_03_e_a'];
    const defs = { chess: {
      d1: mk('d1', 'SNIPER', 900, 2200, tags, { items: ITEMS, ammo: true }),
      d2: mk('d2', 'CASTER', 850, 2000, tags, { items: ITEMS, ammo: true }),
      d3: mk('d3', 'WARRIOR', 1000, 3000, tags, { items: ITEMS, ammo: true }),
      h1: mk('h1', 'MEDIC', 100, 1800, tags, { items: ITEMS }),
      t1: mk('t1', 'DEFENDER', 300, 6000, tags, { items: ITEMS }),
    }, enemies: { enemy_target: enemyRec({ key: 'enemy_target', hp: 2e6, atk: 900, speed: 0, def: 200, res: 20, bat: 1.0, range: 8 }) } };
    const bonds = {};
    for (const id of tags) bonds[id] = { count: 6, active: true, tier: 2, layers: 30 };
    const h = makeBattle({ defs, units: [
      { chessId: 'd1', row: 10, col: 4, items: ITEMS }, { chessId: 'd2', row: 11, col: 4, items: ITEMS },
      { chessId: 'd3', row: 9, col: 6, items: ITEMS }, { chessId: 'h1', row: 10, col: 7, items: ITEMS },
      { chessId: 't1', row: 11, col: 7, items: ITEMS }],
      enemies: [{ key: 'enemy_target', pos: [9, 8] }], bonds, timeLimit: 60, content: 'full', autoFinish: false, flags: { layerGainsEnabled: true, overlimit: true } });
    h.run(60);
    let taken = 0, heal = 0, dead = 0, aliveT = 0;
    for (const x of h.b.allyUnits || []) {
      if (x.kind !== 'op') continue;
      taken += Number(x.stats.taken) || 0;
      heal += Number(x.stats.heal) || 0;
      if (!x.alive) dead++;
      else aliveT += h.b.time;
    }
    console.log(pad(core, 16) + pad(Math.round(taken), 10) + pad(Math.round(heal), 10) + pad(dead, 9) + pad(aliveT.toFixed(0), 10));
  }
  process.exit(0);
}


// --simulate：按候选补正表模拟「改后」的强弱比（不改真实数据）
if (process.argv.includes('--simulate')) {
  // 候选补正：让每个大盟约的 4 组均值接近中位数 7520
  const BUFF = {
    yanShip: 1.64,          // +64%
    egirShip: 1.35,         // +35%
    kjeragShip: 2.02,       // +102%
    lateranoShip: 2.67,     // +167%
    victoriaShip: 0.85,     // 超标，削 15%
  };
  const pad = (x, n) => String(x).padEnd(n);
  console.log('模拟：按候选补正后的大盟约均值');
  console.log(pad('大盟约', 16) + pad('改前', 10) + pad('补正', 9) + pad('改后', 10) + pad('vs中位数', 11) + '判定');
  const out = [];
  for (const core of CORE) {
    let n = 0, sum = 0;
    for (let k = 0; k < 4; k++) {
      const smalls = [0, 1, 2, 3].map((j) => SMALL[(CORE.indexOf(core) * 3 + k + j) % SMALL.length]);
      sum += runOnce(core, smalls).dps; n++;
    }
    const before = sum / n;
    const mul = BUFF[core] ?? 1;
    const after = before * mul;
    out.push({ core, before, mul, after });
  }
  const medianBefore = [...out.map((x) => x.before)].sort((a, b) => a - b);
  const medB = (medianBefore[3] + medianBefore[4]) / 2;
  const medianAfter = [...out.map((x) => x.after)].sort((a, b) => a - b);
  const medA = (medianAfter[3] + medianAfter[4]) / 2;
  for (const x of out.sort((a, b) => b.after - a.after)) {
    console.log(pad(x.core, 16) + pad(x.before.toFixed(0), 10) + pad((x.mul === 1 ? '—' : '×' + x.mul.toFixed(2)), 9)
      + pad(x.after.toFixed(0), 10) + pad((x.after / medA).toFixed(2) + '×', 11)
      + (x.after / medA > 1.5 ? '偏强' : x.after / medA < 0.67 ? '偏弱' : 'OK'));
  }
  console.log('\n  改前 最强/最弱 = ' + (Math.max(...out.map((x) => x.before)) / Math.min(...out.map((x) => x.before))).toFixed(2) + ' 倍，中位数 ' + medB.toFixed(0));
  console.log('  改后 最强/最弱 = ' + (Math.max(...out.map((x) => x.after)) / Math.min(...out.map((x) => x.after))).toFixed(2) + ' 倍，中位数 ' + medA.toFixed(0));
  process.exit(0);
}


// --solve：解出「每个大盟约刚好达到目标中位数」需要的倍率（不动已达标者）
if (process.argv.includes('--solve')) {
  const TARGET = Number(process.argv[process.argv.indexOf('--solve') + 1]) || 8000;
  const pad = (x, n) => String(x).padEnd(n);
  console.log('求解：目标 DPS = ' + TARGET);
  console.log(pad('大盟约', 16) + pad('当前', 10) + pad('需要倍率', 11) + pad('对应攻击补正', 14) + '说明');
  const out = [];
  for (const core of CORE) {
    let n = 0, sum = 0;
    for (let k = 0; k < 4; k++) {
      const smalls = [0, 1, 2, 3].map((j) => SMALL[(CORE.indexOf(core) * 3 + k + j) % SMALL.length]);
      sum += runOnce(core, smalls).dps; n++;
    }
    const cur = sum / n;
    if (cur >= TARGET) { out.push({ core, cur, mul: 1, note: '已达标，不动' }); continue; }
    let lo = 1, hi = 5;
    for (let i = 0; i < 10; i++) {
      const mid = (lo + hi) / 2;
      let s2 = 0, n2 = 0;
      for (let k = 0; k < 4; k++) {
        const smalls = [0, 1, 2, 3].map((j) => SMALL[(CORE.indexOf(core) * 3 + k + j) % SMALL.length]);
        s2 += runOnce(core, smalls, 2, 30, mid).dps; n2++;
      }
      if (s2 / n2 < TARGET) lo = mid; else hi = mid;
    }
    out.push({ core, cur, mul: hi, note: '需补正' });
  }
  for (const x of out.sort((a, b) => a.cur - b.cur)) {
    console.log(pad(x.core, 16) + pad(x.cur.toFixed(0), 10) + pad('×' + x.mul.toFixed(2), 11) + pad('+' + ((x.mul - 1) * 100).toFixed(0) + '%', 14) + x.note);
  }
  process.exit(0);
}


// --final：按求解结果 + 削维多利亚，模拟最终强弱比
if (process.argv.includes('--final')) {
  const BUFF = {
    lateranoShip: 1.80, kjeragShip: 1.46, egirShip: 1.26, yanShip: 1.19,
    kazimierzShip: 1.07, siracusaShip: 1.07, sargonShip: 1.03,
    victoriaShip: 0.58,   // 13856 → 8000
  };
  const pad = (x, n) => String(x).padEnd(n);
  const out = [];
  for (const core of CORE) {
    let n = 0, sum = 0;
    for (let k = 0; k < 4; k++) {
      const smalls = [0, 1, 2, 3].map((j) => SMALL[(CORE.indexOf(core) * 3 + k + j) % SMALL.length]);
      sum += runOnce(core, smalls).dps; n++;
    }
    const before = sum / n;
    out.push({ core, before, after: before * (BUFF[core] ?? 1), mul: BUFF[core] ?? 1 });
  }
  console.log('最终方案：全部拉平到 ~8000');
  console.log(pad('大盟约', 16) + pad('改前', 10) + pad('倍率', 8) + pad('改后', 10) + '偏差');
  for (const x of out.sort((a, b) => b.after - a.after)) {
    console.log(pad(x.core, 16) + pad(x.before.toFixed(0), 10) + pad('×' + x.mul.toFixed(2), 8) + pad(x.after.toFixed(0), 10) + ((x.after / 8000 - 1) * 100).toFixed(0) + '%');
  }
  const b = out.map((x) => x.before), a = out.map((x) => x.after);
  console.log('\n  改前 最强/最弱 = ' + (Math.max(...b) / Math.min(...b)).toFixed(2) + ' 倍');
  console.log('  改后 最强/最弱 = ' + (Math.max(...a) / Math.min(...a)).toFixed(2) + ' 倍');
  process.exit(0);
}


// --fair：每个大盟约用「最适合它的配置」测（机制型盟约不再被前置条件拖累）
if (process.argv.includes('--fair')) {
  // 每个大盟约的「最优配置」
  const PROFILE = {
    yanShip:        { ammo: false, items: true },
    sargonShip:     { ammo: false, items: true, fastSkill: true },   // 技能频繁启动 → 叠层
    victoriaShip:   { ammo: false, items: true },                    // 装备（全部干员都带）
    kjeragShip:     { ammo: false, items: true },
    lateranoShip:   { ammo: true,  items: true },                    // 弹药技能
    egirShip:       { ammo: false, items: true },
    siracusaShip:   { ammo: false, items: true },
    kazimierzShip:  { ammo: false, items: true },
  };
  const ITEMS = ['chess_item_4_01_e_a', 'chess_item_4_02_e_a', 'chess_item_4_03_e_a'];
  const TARGET = enemyRec({ key: 'enemy_target', hp: 2e6, atk: 1500, speed: 0, def: 200, res: 20, bat: 0.8, range: 8 });
  const runProfile = (core, smalls, prof) => {
    const tags = [core, ...smalls];
    const skillOf = () => {
      const base = { spCost: prof.fastSkill ? 3 : 8, initSp: prof.fastSkill ? 3 : 8, duration: 2, bb: {}, trigger: { rule: 'SP_FULL' }, skillType: 'MANUAL', durationType: 'NONE' };
      return prof.ammo ? { ...base, kind: 'ammo', ammoLeft: 10, ammoMax: 10 } : base;
    };
    const mk = (id, prof2, atk, hp) => chessRec({ id, profession: prof2, bonds: tags,
      stats: { atk, maxHp: hp, def: 300, res: 20, bat: 1.2, aspd: 100, blockCnt: prof2 === 'DEFENDER' ? 3 : 1 },
      skill: skillOf(), rangeGrid: RANGE });
    const defs = { chess: {
      d1: mk('d1', 'SNIPER', 900, 2200), d2: mk('d2', 'CASTER', 850, 2000), d3: mk('d3', 'WARRIOR', 1000, 3000),
      h1: mk('h1', 'MEDIC', 100, 1800), t1: mk('t1', 'DEFENDER', 300, 6000),
    }, enemies: { enemy_target: TARGET } };
    const bonds = {};
    for (const id of tags) bonds[id] = { count: 6, active: true, tier: 2, layers: 30 };
    const h = makeBattle({ defs, units: [
      { chessId: 'd1', row: 10, col: 4, items: ITEMS }, { chessId: 'd2', row: 11, col: 4, items: ITEMS },
      { chessId: 'd3', row: 9, col: 6, items: ITEMS }, { chessId: 'h1', row: 10, col: 7, items: ITEMS },
      { chessId: 't1', row: 11, col: 7, items: ITEMS }],
      enemies: [{ key: 'enemy_target', pos: [9, 8] }], bonds, timeLimit: 60, content: 'full', autoFinish: false, flags: { layerGainsEnabled: true, overlimit: true } });
    h.run(45);
    let dmg = 0, heal = 0;
    for (const x of h.b.allyUnits || []) { if (x.kind !== 'op') continue; dmg += Number(x.stats.dmg) || 0; heal += Number(x.stats.heal) || 0; }
    const t = Math.max(1, h.b.time);
    return { dps: dmg / t, hps: heal / t };
  };
  const pad = (x, n) => String(x).padEnd(n);
  console.log('公平对比（每个大盟约用最适合它的配置）');
  console.log(pad('大盟约', 16) + pad('配置', 22) + pad('平均 DPS', 11) + pad('区间', 18) + '平均 HPS');
  const out = [];
  for (const core of CORE) {
    const prof = PROFILE[core];
    const list = [];
    for (let k = 0; k < 4; k++) {
      const smalls = [0, 1, 2, 3].map((j) => SMALL[(CORE.indexOf(core) * 3 + k + j) % SMALL.length]);
      list.push(runProfile(core, smalls, prof));
    }
    const avg = list.reduce((a, b) => a + b.dps, 0) / list.length;
    const hps = list.reduce((a, b) => a + b.hps, 0) / list.length;
    const cfg = [prof.ammo ? '弹药技能' : '普通技能', prof.fastSkill ? '高频启动' : '', prof.items ? '3件装备' : ''].filter(Boolean).join('+');
    out.push({ core, avg, min: Math.min(...list.map((x) => x.dps)), max: Math.max(...list.map((x) => x.dps)), hps, cfg });
  }
  for (const x of out.sort((a, b) => b.avg - a.avg)) {
    console.log(pad(x.core, 16) + pad(x.cfg, 22) + pad(x.avg.toFixed(0), 11) + pad(x.min.toFixed(0) + '–' + x.max.toFixed(0), 18) + x.hps.toFixed(1));
  }
  const a = out.map((x) => x.avg);
  console.log('\n  最强/最弱 = ' + (Math.max(...a) / Math.min(...a)).toFixed(2) + ' 倍');
  // 同时给出「补到中位数需要多少」的求解
  const med = [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];
  console.log('  中位数 = ' + med.toFixed(0));
  console.log('\n  补正需求（目标 = 中位数 ' + med.toFixed(0) + '）:');
  console.log('  ' + pad('大盟约', 16) + pad('当前', 10) + pad('差额', 10) + '判定');
  for (const x of out.sort((y, z) => y.avg - z.avg)) {
    const gap = med - x.avg;
    console.log('  ' + pad(x.core, 16) + pad(x.avg.toFixed(0), 10) + pad(gap > 0 ? '+' + gap.toFixed(0) : '—', 10) + (gap > 0 ? '需补 ' + ((gap / x.avg) * 100).toFixed(0) + '%' : '已达标'));
  }
  process.exit(0);
}

// --calibrate：先证明「大盟约真的生效」，否则后面的表没意义
if (process.argv.includes('--calibrate')) {
  const yan = (tier, layers) => runOnce('yanShip', [], tier, layers);
  // 基线：干员 bonds 完全不含 yanShip（runOnce 的 tags 由 core 决定，这里单独造一场）
  const baseline = (() => {
    const defs = { chess: {
      d1: mk('d1', 'SNIPER', 900, 2200, []), d2: mk('d2', 'CASTER', 850, 2000, []),
      d3: mk('d3', 'WARRIOR', 1000, 3000, []), h1: mk('h1', 'MEDIC', 100, 1800, []), t1: mk('t1', 'DEFENDER', 300, 6000, []),
    }, enemies: { enemy_target: TARGET } };
    const h = makeBattle({ defs, units: [
      { chessId: 'd1', row: 10, col: 4 }, { chessId: 'd2', row: 11, col: 4 }, { chessId: 'd3', row: 9, col: 6 },
      { chessId: 'h1', row: 10, col: 7 }, { chessId: 't1', row: 11, col: 7 }],
      enemies: [{ key: 'enemy_target', pos: [9, 8] }], bonds: {}, timeLimit: 60, content: 'full', autoFinish: false });
    h.run(45);
    let dmg = 0; for (const x of h.b.allyUnits || []) if (x.kind === 'op') dmg += Number(x.stats.dmg) || 0;
    return { dps: dmg / Math.max(1, h.b.time) };
  })();
  console.log('校准：yanShip 分级（基线 = 干员 bonds 不含 yanShip）');
  console.log('  基线（无盟约）  DPS=' + baseline.dps.toFixed(1));
  for (const [t, l] of [[1, 0], [2, 30], [3, 30]]) {
    const r = yan(t, l);
    console.log('  tier' + t + ' L' + l + '  DPS=' + r.dps.toFixed(1) + '   HPS=' + r.hps.toFixed(1));
  }
  process.exit(0);
}

const rows = [];
for (const core of CORE) {
  const ci = CORE.indexOf(core);
  for (let k = 0; k < 4; k++) {
    const smalls = [0, 1, 2, 3].map((j) => SMALL[(ci * 3 + k + j) % SMALL.length]);
    const r = runOnce(core, smalls);
    rows.push({ core, smalls: smalls.join('+'), ...r });
  }
}

rows.sort((a, b) => b.dps - a.dps);
const pad = (s, n) => String(s).padEnd(n);
console.log(pad('大盟约', 16) + pad('小盟约', 46) + pad('DPS', 9) + pad('HPS', 9) + pad('总伤害', 10) + pad('总治疗', 10) + '剩余血');
for (const r of rows) {
  console.log(pad(r.core, 16) + pad(r.smalls, 46) + pad(r.dps.toFixed(1), 9) + pad(r.hps.toFixed(1), 9) + pad(Math.round(r.dmg), 10) + pad(Math.round(r.heal), 10) + r.left);
}

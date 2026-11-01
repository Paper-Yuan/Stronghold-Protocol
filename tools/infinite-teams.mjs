#!/usr/bin/env node
// tools/infinite-teams.mjs — 超限模拟：大盟约 × 小盟约组合的整队 DPS / HPS / 一击线。
//
// 规则（业主 2026-10-17）：
//   * 队伍 = **大盟约的真实成员**（每个大盟约自己的干员，满配精英），小盟约只加层数
//   * 绝技（suntShip）默认生效；调和（maniShip）/ 远见（visiShip）/ 奇迹（miraShip）不管
//   * 层数：R15 大盟约 400 / 小盟约 150，之后每回合各 +50
//   * 采样 R15 / 25 / 35 / 45 / 60
//
// 指标：
//   DPS  = damageDealt / 战斗秒数      （打一个 1e12 血的木桩，不还手）
//   HPS  = healingDone / 战斗秒数      （同一批干员顶一个高攻木桩）
//   一击线 = 队伍里**最脆的那个**能挨下的最大单发（物理 maxHp+def / 法术 maxHp×100/(100−res)）
//
// ---- 业主 2026-10-31 的三条新口径（默认全关 = 上面的旧口径逐字节不变）----
//   `--mvc <diyChessId>` 外援主 C：每套队伍 8 人 = 7 名常驻 + 1 名「自选干员」，并把它**按主盟约（锚）重新归类**。
//       引擎真实路径：自选干员是 data/chess.json 里 isDiy 的槽位（如 chess_char_6_diy1_b，由 backups.json
//       `diy.slots` 的 goldenId 认出来），它自己的盟约来自 `diy.operators[charId].bonds`（shared/diy.js diyRecordOf）；
//       「转职」走**变形同构体** chess_item_6_09_e_b（`canGiveBond: true`）——官方档要求一行 ≥ 2 件且其中一件
//       canGiveBond，携带者因此额外获得**另一件的 giveBondId**（shared/plugins/rules.js grantedBondsByMorph）。
//       所以外援主 C 带 [锚的族装备, 变形同构体] 两件，support.unitBonds 里就真的出现锚，bonds/core.js 的 members
//       才把它算成成员——**不是**给 bonds 池 +1 编出来的数。
//   `--gold-hammer` 维多利亚全员金锤：data bonds 含 victoriaShip 的干员，普锤 chess_item_1_01_e_a 换成进阶
//       chess_item_1_01_e_b（+15% → +25% 攻击力，维多利亚 6 人档的 atk_golden_equip 也按金件多给）。
//   拉特兰锁精准是**搭档口径**（哪两条副盟约搭配），本工具按 major × C(11,2)/C(11,3) 全交叉，没有搭档可锁；
//       那份口径落在 tools/infinite-anchor-pairs.mjs（`handoff/OVERLIMIT-ANCHOR-MVC.md`）。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeBattle, enemyRec } from '../test/helpers/battleHarness.js';
// tier 口径必须与真机同源（业主 2026-10-31 批准的三处口径之一）：见 tools/infinite-anchor-pairs.mjs 的注释。
import { tierFor } from '../server/match/bondsMeta.js';
// 官方池边界（同一口径）：官方难度可见的干员才算池子成员。
import { isOfficialVisibleChess } from '../server/match/gamedata.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => JSON.parse(fs.readFileSync(path.join(ROOT, 'data', f + '.json'), 'utf8'));
const chess = read('chess');
const backups = read('backups');
const bonds = read('bonds');

const MAJOR = ['yanShip', 'sargonShip', 'victoriaShip', 'kjeragShip', 'lateranoShip', 'egirShip', 'siracusaShip', 'kazimierzShip'];
const MINOR = ['preciShip', 'swiftShip', 'skillfulShip', 'arcaneShip', 'steadShip', 'deputShip', 'investShip', 'raidShip', 'indomShip', 'emptyShip', 'soloShip'];
const ALWAYS = ['suntShip'];
const SLOT6 = 'chess_char_6_diy1_a';

// ---- 装备口径（业主 2026-10-31）：每名干员 1 件维式重锤 chess_item_1_01_e_a
// 维多利亚的主倍率 `installVictoria` 只作用于 `S.itemsOf(u).length >= 1` 的干员，裸装等于整条空转
// （实测 R40 6 人档：0 件 9.5k → 1 件 187.9k，×19.9）。为了不给维多利亚开小灶，**所有大盟约的每名干员统一 1 件**；
// 不带 2/3 件是因为 1 件就已经让主倍率生效，多带只会把维多利亚再抬高（2 件 226.1k / 3 件 264.3k），
// 破坏跨盟约可比性。该 id 来自 data/items.json（维式重锤，tier 1）。
const ITEM = 'chess_item_1_01_e_a';

// ---- 外援主 C 与金锤（业主 2026-10-31）：两个可配置项，缺省关闭 ----
// 转职所需的第二件：变形同构体（canGiveBond）；每件族装备的 giveBondId 就是它授予的盟约（data/items.json 现读）。
const MORPH_ITEM = 'chess_item_6_09_e_b';
const GOLD_HAMMER_ITEM = 'chess_item_1_01_e_b';
const ANCHOR_ITEM = {
  victoriaShip: ITEM,
  sargonShip: 'chess_item_2_04_e_a',
  siracusaShip: 'chess_item_3_01_e_a',
  yanShip: 'chess_item_3_04_e_a',
  egirShip: 'chess_item_3_07_e_a',
  kazimierzShip: 'chess_item_4_07_e_a',
  lateranoShip: 'chess_item_4_08_e_a',
  kjeragShip: 'chess_item_5_02_e_a',
};

// ---- 命令行：位置参数仍是旧的「只跑这些大盟约」（逗号分隔）
const ARGV = process.argv.slice(2);
const NO_VALUE = new Set(['--gold-hammer']);
const opt = (name, def = null) => {
  const i = ARGV.indexOf('--' + name);
  return i >= 0 && ARGV[i + 1] != null && !ARGV[i + 1].startsWith('--') ? ARGV[i + 1] : (i >= 0 ? '' : def);
};
const has = (name) => ARGV.includes('--' + name);
const ONLY_ARG = (() => {
  const out = [];
  for (let i = 0; i < ARGV.length; i++) {
    const a = ARGV[i];
    if (a.startsWith('--')) { if (!NO_VALUE.has(a)) i++; continue; }
    out.push(a);
  }
  return out.length ? out.join(',') : null;
})();
/** 金锤口径：维多利亚成员（data bonds 含 victoriaShip）换进阶锤。 */
const goldHammer = has('gold-hammer');
const itemsFor = (id) => [goldHammer && Array.isArray(chess[id]?.bonds) && chess[id].bonds.includes('victoriaShip') ? GOLD_HAMMER_ITEM : ITEM];
/** `--mvc <diyChessId>` → { base, elite, pick, skill }；缺省 null（关闭）。 */
const MVC = (() => {
  const slot = opt('mvc', null);
  if (!slot) return null;
  const slots = backups.diy?.slots ?? {};
  const base = Object.keys(slots).find((id) => id === slot || slots[id]?.goldenId === slot);
  if (!base) throw new Error('--mvc: 不是自选槽位 id: ' + slot);
  const pick = opt('mvc-pick', 'char_1035_wisdel');
  if (!Array.isArray(backups.diy?.operators?.[pick]?.bonds)) throw new Error('--mvc-pick: 不是自选可选干员: ' + pick);
  return { slot, base, elite: base !== slot, pick, skill: Number(opt('mvc-skill', '2')) };
})();
/**
 * 外援主 C 的 units[] 条目：`{ diy }` 是 harness 的生产路径（simdata getChess(slotId, { diy })），
 * 两件装备 = 锚族装备 + 变形同构体（缺一不可，缺 morph 则 getBondId 不授予盟约）。
 * @param {{ base: string, elite: boolean, pick: string, skill: number }} carry `MVC` 或同形状的对象
 */
function extraCarryUnit(carry, anchor, pos) {
  return {
    diy: { slot: carry.base, charId: carry.pick, skillIndex: carry.skill },
    elite: carry.elite,
    row: pos[0], col: pos[1],
    items: [goldHammer && anchor === 'victoriaShip' ? GOLD_HAMMER_ITEM : (ANCHOR_ITEM[anchor] ?? ITEM), MORPH_ITEM],
  };
}

// ---- 口径开关（业主 2026-10-31 批准的重做；缺省 = 官方池 + 合法摆位，旧口径用 --pool legacy --layout row）
const POOL_MODE = opt('pool', 'official');
const LAYOUT_MODE = opt('layout', 'block');
/**
 * 官方池（与 tools/infinite-anchor-pairs.mjs 同一口径）：`server/match/gamedata.js` 的
 * `isOfficialVisibleChess` 边界，按「干员」判定（表里一直用同一名干员的精锐形态 `_b` 上场），
 * 记录这一侧再要求 `visible === true` 且非 zhajing / annihilation —— 炸惊副本（同一名干员的第二条记录）
 * 的 bonds 一样但 baseId 不同，按 baseId 去重去不掉，会白拿人数与伤害。
 */
const OFFICIAL_CHARS = new Set(
  Object.keys(chess).filter((k) => isOfficialVisibleChess(chess[k])).map((k) => chess[k].charId),
);
const officialOk = (c) => POOL_MODE === 'legacy' || (
  c.visible === true && c.zhajing !== true && c.annihilation !== true && OFFICIAL_CHARS.has(c.charId)
);

// ---- 队伍名单：每个大盟约的真实成员（同 baseId 只留精锐）
// 队伍 = 该大盟约的**真实干员**（data/chess.json 自带 stats/skills/talents，是满配精锐形态）。
// 不要走 data/backups.json 的 standsIn：那是「预备干员替身」表，会把斯卡蒂换成一个叫「预备干员-近卫」的
// 通用替身（实测 egir 全员变成替身、DPS 掉到 1/10）。
const rosterOf = {};
for (const m of MAJOR) {
  const byBase = new Map();
  for (const k of Object.keys(chess)) {
    const c = chess[k];
    if (!Array.isArray(c.bonds) || !c.bonds.includes(m)) continue;
    if (c.isDiy || c.isHidden) continue;
    if (!officialOk(c)) continue;
    const base = c.baseId || k;
    const cur = byBase.get(base);
    // 同 baseId 只留精锐（_b）
    if (!cur || (k.endsWith('_b') && !cur.endsWith('_b'))) byBase.set(base, k);
  }
  rosterOf[m] = [...byBase.values()].slice(0, 8);
}

// ---- 层数
const layersOf = (round) => ({ major: 400 + Math.max(0, round - 15) * 50, minor: 150 + Math.max(0, round - 15) * 50 });

/**
 * 一条盟约的战斗输入状态。`tier` 用真机 `tierFor`（达到几个 thresholds），不按人数硬算：
 * 旧版 `count>=6 → 3` 会让 6 人档白拿 3 档，`count>=4 → 2` 让 4–5 人白拿 6 人档。
 */
const bondState = (id, count, layers) => ({ count, active: true, tier: tierFor(bonds[id], count), layers });

// ---- 口径 ③：合法摆位（木桩墙 row 9–11 × col 8–10；旧摆位 row10 col3–10 的第 6–8 人压在木桩上）
const WALL_KEY = new Set();
for (let r = 9; r <= 11; r++) for (let c = 8; c <= 10; c++) WALL_KEY.add(r + ',' + c);
const BLOCK_TILES = [[9, 7], [10, 7], [11, 7], [12, 7], [9, 6], [10, 6], [11, 6], [12, 6]];
function placementOf(melee) {
  if (LAYOUT_MODE === 'row') return melee.map((_, i) => [10, 3 + i]);
  const order = melee.map((m, i) => ({ i, m: m ? 0 : 1 })).sort((a, b) => a.m - b.m || a.i - b.i);
  const out = new Array(melee.length);
  order.forEach((o, k) => { out[o.i] = BLOCK_TILES[k] ?? [10, 3 + k]; });
  return out;
}
/** 启动自检：tier 与池子/摆位。任何人把这三条口径改回去都会在这里炸掉。 */
(function assertCaliber() {
  for (const [id, n, want] of [['lateranoShip', 4, 1], ['lateranoShip', 6, 2], ['egirShip', 5, 2], ['kjeragShip', 4, 1]]) {
    const got = bondState(id, n, 0).tier;
    if (got !== want) throw new Error(`tier 口径断言失败：${id} ${n} 人 → tier ${got}，应为 ${want}`);
  }
  let dupBase = 0, dupChar = 0;
  for (const m of MAJOR) {
    const bases = rosterOf[m].map((k) => chess[k].baseId || k);
    const chars = rosterOf[m].map((k) => chess[k].charId || k);
    dupBase += bases.length - new Set(bases).size;
    dupChar += chars.length - new Set(chars).size;
  }
  console.log('== 三处口径自检 ==');
  console.log('  ① tier：tierFor 断言通过');
  console.log('  ② 池子 pool=' + POOL_MODE + '：' + MAJOR.map((m) => m + '=' + rosterOf[m].length).join(' ')
    + ' ｜ 重复 baseId = ' + dupBase + ' ｜ 重复干员(charId) = ' + dupChar);
  if (POOL_MODE === 'official' && (dupBase || dupChar)) throw new Error('池子口径断言失败：重复干员 ' + dupChar);
  const bad = [];
  for (let n = 1; n <= 8; n++) {
    const pos = placementOf(Array.from({ length: n }, (_, i) => i % 2 === 0));
    if (new Set(pos.map((p) => p.join(','))).size !== n) bad.push('n=' + n + ' 重合格');
    for (const p of pos) if (WALL_KEY.has(p.join(','))) bad.push('n=' + n + ' 木桩格' + p);
  }
  console.log('  ③ 摆位 layout=' + LAYOUT_MODE + '：与木桩格重合的单位数 = ' + bad.length);
  if (LAYOUT_MODE === 'block' && bad.length) throw new Error('摆位断言失败：' + bad.join('；'));
})();

function field(roster, majorId, minors, round, { punching = true, extraCarry = null } = {}) {
  const { major, minor } = layersOf(round);
  // 外援主 C：8 人 = 7 名常驻 + 1 名自选干员（`extraCarry` 传入即开启；缺省 8 名常驻，与旧口径一致）。
  // `extraCarry === true` 用命令行配好的 `MVC`；传同形状对象可临时指定另一套外援。
  const carry = extraCarry === true ? MVC : (extraCarry && typeof extraCarry === 'object' ? extraCarry : null);
  const cap = carry ? 7 : 8;
  // standIn: true —— 真实干员的正规入场方式（吃盟约加成、上满 8 人）。
  // 用 diy 槽位只会进 4 人且完全不吃盟约层数（实测 Σatk 不随 layers 变化）。
  const ids = roster.slice(0, cap);
  const melee = ids.map((id) => chess[id]?.position === 'MELEE');
  if (carry) melee.push(false);
  const pos = placementOf(melee);
  const units = ids.map((id, i) => ({ chessId: id, row: pos[i][0], col: pos[i][1], items: itemsFor(id) }));
  // 外援主 C 占最后一个合法格（block 摆位下是 col 6 那一列的最后一格，绝不落在木桩上）。
  if (carry) units.push(extraCarryUnit(carry, majorId, pos[units.length]));
  const st = {};
  // 锚的 count 仍按 v2 口径封顶 6（tier 只看 3 / 6 两档）；外援主 C 转职后也是锚的成员，所以成员数 +1。
  st[majorId] = bondState(majorId, Math.min(6, roster.slice(0, cap).length + (carry ? 1 : 0)), major);
  for (const m of minors) st[m] = bondState(m, 3, minor);
  for (const m of ALWAYS) st[m] = bondState(m, 3, minor);
  // 木桩：血极厚、不还手（DPS）；或高攻会还手（HPS）
  // rank: 'ELITE'（业主 2026-10-31）：叙拉古的超限真伤含「+0.5% 目标最大生命」，而业主文本给精英/首领封了 250 万。
  // 1e12 血的木桩若按 NORMAL 算，单次就是 1e12×0.005 = 50 亿；本机旧口径实测 R60 均值 1.17e10、单组最高 1.33e10
  // （任务书提到的 8.8e18 未在本机复现，但同为「把表格撑爆」的量级）。
  // 所以在木桩上打 ELITE 标记，让引擎里 `installSiracusa` 的 `Math.min(amount, 2_500_000)` 生效——这不是改数值，
  // 只是把木桩摆到「精英/首领」这一档（同组合分析口径）。真实目标几十万~几百万血时 0.5% 只有几千到两万多，比封顶更低。
  const dummy = punching
    ? enemyRec({ key: 'e_dps', hp: 1e12, speed: 0, mass: 0, atk: 0, rank: 'ELITE' })
    : enemyRec({ key: 'e_hps', hp: 1e12, speed: 0, mass: 0, atk: 3000, bat: 1, range: 3, rank: 'ELITE' });
  // 木桩铺成一整排（row 9..11 × col 8..10）：近战够得到、远程也够得到，
  // 否则只有最靠前的那一个干员在输出，DPS 会被严重低估（kjerag 一开始测出 0 就是这个原因）。
  const wall = [];
  for (let r = 9; r <= 11; r++) for (let c = 8; c <= 10; c++) wall.push({ key: dummy.key, pos: [r, c] });
  const h = makeBattle({
    defs: { enemies: { [dummy.key]: dummy } },
    units,
    enemies: wall,
    timeLimit: 60, autoFinish: false, seed: 7,
    bonds: st,
    // 业主 2026-10-31：真实对局在 isInfinite 时会给 `battle.flags.overlimit = true`（combat.js / bossRounds.js /
    // unitePhase.js），五条超限专属加强（阿戈尔/拉特兰/维多利亚/萨尔贡/叙拉古，commit 8f2a3ffa）只在那个 flag 下生效。
    // 这个工具以前从没设过，所以它跑出的任何「超限 DPS」都是未加强口径（实测差 1.3–54 倍）。
    flags: { dpInit: 999, dpPerSec: 0, dpMax: 999, overlimit: true },
  });
  h.step();
  const allies = h.allies();
  // 口径 ③ 的实战自检：只数玩家部署的干员（召唤物/装置本来就会落在敌人格上），格子求交必须 0。
  for (const u of allies) {
    if (u.kind === 'op' && WALL_KEY.has(u.tileR + ',' + u.tileC)) throw new Error('摆位实战断言失败：' + u.defId + ' 站在木桩格 ' + u.tileR + ',' + u.tileC);
  }
  // 一击线：队伍里最脆的那个
  let physLine = Infinity, artsLine = Infinity;
  for (const u of allies) {
    // 只算真正的干员：装置 / 召唤物（香槟炸弹 hp=1000）不该决定队伍的一击线
    if (u.kind !== 'op') continue;
    const hp = Number(u.s.maxHp) || 0;
    if (!(hp > 0)) continue;                       // 没上场的单位不参与一击线
    const def = Number(u.s.def) || 0;
    const res = Math.min(95, Number(u.s.res) || 0);
    physLine = Math.min(physLine, hp + def);
    artsLine = Math.min(artsLine, hp * 100 / Math.max(5, 100 - res));
  }
  h.run(60);
  const r = h.b.result().perPlayer.p1 || {};
  return { dps: (r.damageDealt || 0) / 60, hps: (r.healingDone || 0) / 60, physLine: physLine === Infinity ? 0 : physLine, artsLine: artsLine === Infinity ? 0 : artsLine, n: allies.length };
}

// ---- 组合
function combos(arr, k) {
  const out = [];
  const go = (start, cur) => {
    if (cur.length === k) { out.push(cur.slice()); return; }
    for (let i = start; i < arr.length; i++) { cur.push(arr[i]); go(i + 1, cur); cur.pop(); }
  };
  go(0, []);
  return out;
}
const COMBOS = [...combos(MINOR, 2), ...combos(MINOR, 3)];   // 2 小 + 3 小 全交叉（55 + 165 = 220 组）
const ROUNDS = [15, 20, 30, 45, 60];

const t0 = Date.now();
const rows = [];
const ONLY = ONLY_ARG ? ONLY_ARG.split(',') : MAJOR;
for (const m of ONLY) {
  const roster = rosterOf[m];
  if (!roster.length) { console.log('  [跳过] ' + m + ' 没有可用干员'); continue; }
  for (const c of COMBOS) {
    const per = { major: m, minors: c, rounds: {} };
    for (const r of ROUNDS) {
      const d = field(roster, m, c, r, { punching: true, extraCarry: MVC });
      per.rounds[r] = { dps: d.dps, hps: d.hps, physLine: d.physLine, artsLine: d.artsLine, n: d.n };
    }
    rows.push(per);
  }
  console.log('  ' + m + ' 完成（' + COMBOS.length + ' 组）  ' + Math.round((Date.now() - t0) / 1000) + 's');
}
const out = ONLY_ARG
  ? '.cache/infinite-teams-' + ONLY_ARG.replace(/,/g, '-') + (MVC ? '-mvc' : '') + '.json'
  : '.cache/infinite-teams' + (MVC ? '-mvc' : '') + '.json';
fs.writeFileSync(path.join(ROOT, out), JSON.stringify(rows, null, 0), 'utf8');

// ---- 结论：哪个大盟约最菜（按 R60 的平均 DPS / 一击线归一化）
const byMajor = {};
for (const row of rows) {
  const b = (byMajor[row.major] ||= { n: 0, dps: {}, hps: {}, phys: {}, arts: {} });
  b.n++;
  for (const r of ROUNDS) {
    b.dps[r] = (b.dps[r] || 0) + row.rounds[r].dps;
    b.hps[r] = (b.hps[r] || 0) + row.rounds[r].hps;
    b.phys[r] = (b.phys[r] || 0) + row.rounds[r].physLine;
    b.arts[r] = (b.arts[r] || 0) + row.rounds[r].artsLine;
  }
}
console.log('');
console.log('  大盟约均值（' + COMBOS.length + ' 种小盟约组合）');
console.log('  盟约            人数  R15 DPS  R60 DPS   R60 HPS   一击线(物理)  一击线(法术)');
const summary = [];
for (const m of MAJOR) {
  const b = byMajor[m];
  if (!b) continue;
  const avg = (o, r) => Math.round(o[r] / b.n);
  summary.push({ m, n: rosterOf[m].length, d15: avg(b.dps, 15), d60: avg(b.dps, 60), h60: avg(b.hps, 60), p60: avg(b.phys, 60), a60: avg(b.arts, 60) });
}
summary.sort((a, b) => a.d60 - b.d60);
for (const s of summary) {
  console.log('  ' + s.m.padEnd(15) + String(s.n).padStart(3) + String(s.d15).padStart(9) + String(s.d60).padStart(9) + String(s.h60).padStart(10) + String(s.p60).padStart(13) + String(s.a60).padStart(14));
}
console.log('');
console.log('  口径：' + (MVC ? '外援主 C ' + MVC.slot + '@' + MVC.pick + '（skill ' + MVC.skill + '）→ 7 常驻 + 1 外援' : '无外援（8 名常驻）')
  + '；装备 ' + (goldHammer ? '维多利亚金锤 chess_item_1_01_e_b + 其余普锤 chess_item_1_01_e_a' : '全员普锤 chess_item_1_01_e_a'));
console.log('  → 最菜的大盟约：' + summary[0].m + '（R60 平均 DPS ' + summary[0].d60 + '，一击线 ' + summary[0].p60 + '）');
console.log('  总耗时 ' + Math.round((Date.now() - t0) / 1000) + 's');

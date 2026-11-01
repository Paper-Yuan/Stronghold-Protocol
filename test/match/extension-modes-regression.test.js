// test/match/extension-modes-regression.test.js — 本体（官方四档）与湮灭模拟的**回归锁**：炸惊（ZHAJING）的记录进了同一份
// data/*.json 之后，它们读到的每一个字节都必须与「没有炸惊这回事」时相同。
//
// 为什么需要这把锁：炸惊分成三层落在同一份数据与同一套引擎上（handoff/ZHAJING-SPLIT-2026-10-28.md §1）——
//   * 数据：`chess.zhajing` / `items|bands|bonds.zjOnly` / 21 条盟约的 `zj` 覆盖块；
//   * 引擎：`gd.zhajing` 门 + `shared/zjBonds.js` 的合并/剥键；
//   * 战斗：`withZjView` 包住装配与每一步 `step()`。
// 这三层里**任何一处漏判都不报错**：普通房会悄悄多出 5 条盟约、多出炸惊专属装备、或者一场炸惊战把进程级的视图留给
// 下一场普通战（golden 也不会红，因为 golden 只跑官方模式自己的场景）。所以这里的断言分三类：
//   ① 官方四档 / 湮灭的 `m.public` 与 `m.private` **深扫**不含 jibian / enemyJibian / zj 任何键（不是只看顶层）；
//   ② 湮灭的 erosion / endless 阶梯与藏品三选一（g.relic）、毒雾（hazard）域行为不变；
//   ③ 同一进程里交替跑（炸惊 → 普通 → 湮灭，再反序），后者与「单独跑」**逐字节相同**（withZjView 的泄漏锁）。
//
// 只读：不启动 ws 服务、不写文件、不依赖 Math.random 与真实时钟（VirtualScheduler）。
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { getData } from '../../server/data.js';
import { Match } from '../../server/match/Match.js';
import { VirtualScheduler } from '../../server/match/scheduler.js';
import { collectViolations } from '../../server/match/invariants.js';
import { relicDraft } from '../../server/match/relics.js';
import { MODULES } from '../../server/sim/content/index.js';
import { makeBattle } from '../helpers/battleHarness.js';
import { ANNIHILATION_DIFFICULTY, EROSION_MAX } from '../../shared/annihilation-constants.js';

const QUIET = { info() {}, warn() {}, debug() {}, error() {} };
/** 真实 data/*.json（与生产 server/data.js 的 getData() 同一份）。 */
const DATA = getData({ log: QUIET });

/** 固定种子：所有逐字节比较与回合号都建立在这一条轨迹上。 */
const SEED = 7;

/** 炸惊专属盟约（data/bonds.json 里 `zjOnly: true` 的 5 条）：官方四档一条都不许进册。 */
const ZJ_ONLY_BONDS = ['mujicaShip', 'penguinShip', 'physicianShip', 'seesShip', 'suiShip'];

/**
 * 一个真实 Match。harness 的 makeMatch 不转发 `erosion`（湮灭的档位只能这样进 Match），所以这里自己建；
 * 其余与 harness 的默认值一致：真实 data、虚拟时间、服务端跑战斗（clientCombat: false）。
 * @param {{ mode?: 'solo'|'coop', difficulty?: string, erosion?: number|null, seed?: number|string, humans?: number }} [o]
 */
function mk({ mode = 'solo', difficulty = 'NORMAL', erosion = null, seed = SEED, humans = 1 } = {}) {
  const seats = [];
  for (let i = 0; i < humans; i++) seats.push({ seat: i, playerId: `p_${i}`, name: `P${i}`, isBot: false, connected: true });
  const sched = new VirtualScheduler({ instantCombat: true });
  const logs = { warn: [], error: [] };
  const h = { sent: [], bc: [], ended: null, endedCount: 0, sched, logs };
  h.m = new Match({
    roomCode: 'REG', mode, difficulty, ...(erosion != null ? { erosion } : {}), seed, seats,
    data: DATA,
    log: { info() {}, debug() {}, warn: (...a) => logs.warn.push(a.map(String).join(' ')), error: (...a) => logs.error.push(a.map(String).join(' ')) },
    scheduler: sched,
    send: (id, msg) => { h.sent.push([id, msg]); return true; },
    broadcast: (msg) => { h.bc.push(msg); },
    onEnd: (s) => { h.ended = s; h.endedCount++; },
    clientCombat: false,
    verify: 'off',
  });
  h.start = () => { h.m.start(); return h; };
  h.ps = (id) => h.m.players.get(id);
  return h;
}

/**
 * 走一局：人类座位的决策（infoReady / band / SP 抽卡 / PREP 准备）由这里代发，每次 handle 的返回值都收进 `results`。
 * `ready` 可以是布尔或 (m, ps) => boolean —— 湮灭局的 PREP 在藏品三选一未完成时不允许准备，用它挡住。
 * @param {ReturnType<typeof mk>} h
 * @param {{ until?: () => boolean, ready?: boolean | ((m: any, ps: any) => boolean), onPrep?: ((m: any, ps: any) => void) | null, results?: any[] | null, maxSteps?: number }} [o]
 */
function drive(h, { until = () => h.ended != null, ready = true, onPrep = null, results = null, maxSteps = 200000 } = {}) {
  const m = h.m;
  const wantReady = typeof ready === 'function' ? ready : () => ready;
  const send = (fn) => {
    const r = fn();
    if (r && r.error && results) results.push(r);
    return r;
  };
  for (let i = 0; i < maxSteps; i++) {
    if (until()) return true;
    if (h.ended) return !!until();
    for (const ps of m.players.values()) {
      if (ps.isBot || ps.left) continue;
      if (m.phase === 'INFO_CHECK' && !ps.infoReady) send(() => m.handle(ps.playerId, { t: 'g.infoReady' }));
      if (m.phase === 'BAND_DRAFT' && m.draftTurn() === ps.playerId) send(() => m.handle(ps.playerId, { t: 'g.band', bandId: 'band_bldsk' }));
      if (m.phase === 'SP_DRAFT' && m.spTurn() === ps.playerId) {
        const idx = m.sp.cards.map((c) => c.idx).find((k) => m.sp.taken[k] == null);
        if (idx != null) send(() => m.handle(ps.playerId, { t: 'g.choice', idx }));
      }
      if (m.phase === 'PREP' && ps.alive && !ps.ready) {
        if (ps.personalChoice) send(() => m.handle(ps.playerId, { t: 'g.choice', idx: 0, choiceId: ps.personalChoice.id }));
        if (onPrep) onPrep(m, ps);
        if (!ps.tempEmpty) ps.resolveTemp();
        if (wantReady(m, ps)) send(() => m.handle(ps.playerId, { t: 'g.ready', ready: true }));
      }
    }
    if (until()) return true;
    if (!h.sched.runNext()) return !!until();
  }
  return !!until();
}

/**
 * 深扫：`value` 里所有「炸惊的键」的路径（顶层与任意层级的对象键，数组逐项下钻）。
 * 判据是键名里出现 `jibian`（惊变 / 敌方惊变）或 `zj`（zj 覆盖块、zjOnly、zjCombos…）。
 * @param {any} value @param {string} [root]
 * @returns {string[]}
 */
function zhajingKeyPaths(value, root = 'm.public') {
  const out = [];
  const walk = (v, path) => {
    if (Array.isArray(v)) { for (let i = 0; i < v.length; i++) walk(v[i], `${path}[${i}]`); return; }
    if (!v || typeof v !== 'object') return;
    for (const [k, x] of Object.entries(v)) {
      if (/jibian|zj/i.test(k)) out.push(`${path}.${k}`);
      walk(x, `${path}.${k}`);
    }
  };
  walk(value, root);
  return out;
}

/** 所有「炸惊专属」的字符串标记：zj 棋 id / zjOnly 盟约 / zjOnly 道具 id（后者从真实数据里现取）。 */
function zjMarks(gd) {
  const items = Object.keys(gd.raw.items || {}).filter((id) => gd.raw.items[id] && gd.raw.items[id].zjOnly === true);
  return { items, bonds: ZJ_ONLY_BONDS, chessPrefix: /^chess_zj_/ };
}

/**
 * 一把「这一局读到的东西」的字节快照：m.public 全文 + gd 的关键表（盟约记录整份、卡池、道具池、策略池、bans）。
 * 同一 seed、同一驱动序列下它是确定的（虚拟时钟 serverNow 也从 0 起），所以两次快照可以逐字节比较。
 */
function signature({ difficulty = 'NORMAL', mode = 'solo', erosion = null, humans = 1 } = {}) {
  const h = mk({ mode, difficulty, erosion, humans }).start();
  const m = h.m;
  const ok = drive(h, { until: () => m.phase === 'PREP' && m.round === 1 });
  assert.ok(ok, `${difficulty}/${mode}: 没走到 R1 PREP（停在 ${m.phase} R${m.round}）`);
  const bytes = JSON.stringify({
    public: m.publicView(),
    bondIds: m.gd.bondIds,
    bonds: m.gd.bondIds.map((id) => m.gd.bond(id)),
    visibleChess: m.gd.visibleChess,
    shopItemsByTier: m.gd.shopItemsByTier,
    bandIds: m.gd.bandIds(),
    bans: m.gd.bans(m.gd.difficulty),
    private: m.players.get('p_0').privateView(),
  });
  m.dispose();
  return bytes;
}

/** 跑一场炸惊局到 R2 结算（够把 zj 视图装上又卸下，再抽两张卡）。 */
function runZhajing(round = 2) {
  const h = mk({ difficulty: 'ZHAJING' }).start();
  const m = h.m;
  assert.ok(drive(h, { until: () => h.ended != null || (m.phase === 'SETTLE' && m.round === round) }),
    `炸惊局没走到 R${round} 结算（停在 ${m.phase} R${m.round}）`);
  assert.equal(m.errorCount, 0, `炸惊局有 reportError: ${JSON.stringify(m.errors)}`);
  assert.ok(m.gd.zhajing, '确实是炸惊局');
  m.dispose();
  return h;
}

// ── 0. 基线：在本进程还没有跑过任何一局之前先取一次 ──────────────────────────────────────────────────────────
// 「单独跑」的参照点必须在**任何**对局（尤其是炸惊局）之前取，之后每次比较都对着它。
const PRISTINE_NORMAL = signature({ difficulty: 'NORMAL' });
const PRISTINE_NORMAL_MULTI = signature({ difficulty: 'NORMAL', mode: 'coop', humans: 2 });
const PRISTINE_ANN4 = signature({ difficulty: ANNIHILATION_DIFFICULTY, erosion: 4 });

// ── 1. 本体（mode_single_normal / mode_multi_normal）：字段与「没有炸惊」逐字节相同 ────────────────────────
describe('本体回归锁 · 普通局的 m.public 不带任何炸惊痕迹', () => {
  test('关键字段就是官方标准的取值（写死的期望，不是现算的）', () => {
    const h = mk({ difficulty: 'NORMAL' }).start();
    const m = h.m;
    const atStart = m.publicView();
    assert.equal(atStart.phase, 'INFO_CHECK');
    assert.equal(atStart.round, 0, '还没开始第 1 回合');
    assert.equal(atStart.modeId, 'mode_single_normal');
    assert.equal(atStart.difficulty, 'NORMAL');
    assert.equal(atStart.lastRound, 14, '官方标准 14 回合（炸惊也是 14，湮灭不是）');
    assert.equal(atStart.bossRound, 14);
    assert.equal(atStart.hiddenRound, 15);
    assert.equal(atStart.spRound, false);
    assert.equal(atStart.isInfinite, false);
    // 玩法包的字段一个都不许长出来
    assert.equal(Object.hasOwn(atStart, 'erosion'), false, '普通局没有 erosion');
    assert.equal(Object.hasOwn(atStart, 'endless'), false, '普通局没有 endless');
    assert.equal(Object.hasOwn(atStart, 'enemyJibian'), false, '普通局没有 enemyJibian');

    assert.ok(drive(h, { until: () => m.phase === 'PREP' && m.round === 1 }));
    const prep = m.publicView();
    assert.equal(prep.round, 1);
    assert.equal(prep.phase, 'PREP');
    assert.equal(prep.lastRound, 14);
    assert.equal(prep.modeId, 'mode_single_normal');
    assert.equal(prep.difficulty, 'NORMAL');
    assert.deepEqual(zhajingKeyPaths(prep), [], '深扫 R1 PREP 的 m.public');
    m.dispose();
  });

  test('m.public / m.private 深扫：没有 jibian / enemyJibian / zj 任何键（R0 与 R1 都扫）', () => {
    const h = mk({ difficulty: 'NORMAL' }).start();
    const m = h.m;
    const ps = m.players.get('p_0');
    assert.deepEqual(zhajingKeyPaths(m.publicView(), 'm.public@R0'), []);
    // Lead 要的那条永久断言：普通局的 m.private 里根本没有 jibian 这个键
    assert.equal(Object.hasOwn(ps.privateView(), 'jibian'), false, 'm.private 没有 jibian 键');
    assert.equal(ps.privateView().jibian, undefined);
    assert.deepEqual(zhajingKeyPaths(ps.privateView(), 'm.private@R0'), []);
    assert.ok(drive(h, { until: () => m.phase === 'PREP' && m.round === 1 }));
    assert.deepEqual(zhajingKeyPaths(m.publicView(), 'm.public@R1'), []);
    assert.deepEqual(zhajingKeyPaths(ps.privateView(), 'm.private@R1'), []);
    assert.equal(ps.privateView().jibian, undefined, 'R1 也没有');
    // 同盟局同样干净
    const coop = mk({ difficulty: 'NORMAL', mode: 'coop', humans: 2 }).start();
    assert.deepEqual(zhajingKeyPaths(coop.m.publicView(), 'coop.m.public@R0'), []);
    for (const p of coop.m.players.values()) assert.equal(Object.hasOwn(p.privateView(), 'jibian'), false, `${p.playerId}: m.private 没有 jibian`);
    m.dispose();
    coop.m.dispose();
  });

  test('数据面：卡池 / 道具池 / 盟约册 / 策略池里一条炸惊记录都没有（数字）', () => {
    const gd = mk({ difficulty: 'NORMAL' }).start().m.gd;
    const marks = zjMarks(gd);
    assert.equal(gd.zhajing, false, '普通局不是炸惊');
    assert.equal(gd.jibian(), null, '没有惊变池');
    assert.equal(gd.enemyJibian(), null, '没有敌方惊变池');
    assert.equal(gd.zjCombos, null, '没有装备组合盟约表');
    assert.equal(gd.allyScale, null);
    assert.equal(gd.bondLayerCap, null, '盟约层上限不抬到 9999');
    // 官方四档自己的特殊回合表是 6 / 9，且没有任何「阶段种类」（炸惊的 spPhaseKinds 一条都不许漏过来）
    assert.deepEqual(gd.spRounds(), [6, 9], '官方标准的特殊回合');
    for (let r = 1; r <= 14; r++) assert.equal(gd.spPhaseKind(r), null, `R${r}: 官方模式没有炸惊的阶段种类`);

    // ① 卡池：官方 112 条，一条 chess_zj_* 都没有
    assert.equal(gd.visibleChess.length, 112, '官方四档的卡池规模（改动只能是有意的数据变更）');
    assert.equal(gd.visibleChess.filter((id) => marks.chessPrefix.test(id)).length, 0, '卡池里没有炸惊棋');
    // ② 盟约册：23 条官方盟约，5 条 zjOnly 一条不在；21 条带 zj 覆盖块的记录把 zj 键剥掉了
    assert.equal(gd.bondIds.length, 23, '28 条盟约 − 5 条 zjOnly');
    assert.deepEqual(gd.bondIds.filter((id) => marks.bonds.includes(id)), [], '没有 zjOnly 盟约');
    const withZj = Object.keys(DATA.bonds).filter((id) => DATA.bonds[id] && DATA.bonds[id].zj);
    assert.equal(withZj.length, 21, 'data/bonds.json 里有 21 条带 zj 覆盖块');
    // 其中 16 条是官方盟约（覆盖块必须被剥掉），另 5 条是 zjOnly（整条不进册，上面已断言）
    const officialZj = withZj.filter((id) => gd.bondIds.includes(id));
    assert.equal(officialZj.length, 16, '21 条里的 16 条是官方盟约');
    for (const id of officialZj) assert.equal(Object.hasOwn(gd.bond(id), 'zj'), false, `bond(${id}) 不带 zj 键`);
    // ③ 道具池：11 条 zjOnly 道具一件都不在商店池里
    assert.equal(marks.items.length, 11, 'data/items.json 里的 zjOnly 道具');
    const sold = Object.values(gd.shopItemsByTier).flat();
    assert.deepEqual(sold.filter((id) => marks.items.includes(id)), [], '商店池里没有炸惊专属道具');
    // ④ 策略池：zjOnly 策略不在册
    const zjBands = Object.keys(DATA.bands).filter((id) => DATA.bands[id] && DATA.bands[id].zjOnly === true);
    assert.ok(zjBands.length >= 1, 'data/bands.json 里有 zjOnly 策略');
    assert.deepEqual(gd.bandIds().filter((id) => zjBands.includes(id)), [], '策略池里没有 zjOnly 策略');
    // ⑤ m.public 里能被客户端直接看到的两个池子也不含炸惊标记
    const pub = mk({ difficulty: 'NORMAL' }).start().m.publicView();
    assert.equal(pub.bannedChess.filter((id) => marks.chessPrefix.test(id)).length, 0, 'bannedChess 里没有炸惊棋');
    assert.deepEqual(pub.disabledBonds.filter((id) => marks.bonds.includes(id)), [], 'disabledBonds 里没有 zjOnly 盟约');
    assert.ok(pub.bannedChess.length > 0 && pub.disabledBonds.length > 0, 'bans 本身是有的（不是空集混过去）');
  });
});

// ── 2. 湮灭模拟：erosion / endless 阶梯、藏品三选一、毒雾域 ────────────────────────────────────────────────
describe('湮灭回归锁 · erosion / endless 阶梯与本体一致', () => {
  test('六个蚀流档位的 erosion / endless / lastRound 与 annihilation-mode.test.js 的阶梯一致', () => {
    // [erosion, endless, lastRound, bossRound, hiddenRound]
    const LADDER = [
      [1, false, 19, 19, 20],
      [2, false, 19, 19, 20],
      [3, false, 19, 19, 20],
      [4, false, 19, 19, 20],
      [5, false, 30, 29, 30],
      [EROSION_MAX, true, null, 14, 15],
    ];
    for (const [erosion, endless, lastRound, bossRound, hiddenRound] of LADDER) {
      const h = mk({ difficulty: ANNIHILATION_DIFFICULTY, erosion }).start();
      const m = h.m;
      const pub = m.publicView();
      assert.equal(m.erosion, erosion, `Match.erosion ${erosion}`);
      assert.equal(m.gd.erosion, erosion, `gd.erosion ${erosion}`);
      assert.equal(pub.erosion, erosion, `m.public.erosion ${erosion}`);
      assert.equal(m.gd.endless, endless, `蚀流 ${erosion}: gd.endless`);
      assert.equal(pub.endless, endless, `蚀流 ${erosion}: m.public.endless`);
      assert.equal(pub.lastRound, lastRound, `蚀流 ${erosion}: lastRound`);
      assert.equal(pub.bossRound, bossRound, `蚀流 ${erosion}: bossRound（无尽局按当前章的那一对）`);
      assert.equal(pub.hiddenRound, hiddenRound, `蚀流 ${erosion}: hiddenRound`);
      assert.equal(pub.modeId, 'mode_single_annihilation');
      assert.equal(pub.difficulty, ANNIHILATION_DIFFICULTY);
      assert.deepEqual(zhajingKeyPaths(pub, `ann${erosion}.m.public`), [], `蚀流 ${erosion}: 没有炸惊的键`);
      assert.equal(Object.hasOwn(m.players.get('p_0').privateView(), 'jibian'), false, `蚀流 ${erosion}: m.private 没有 jibian`);
      m.dispose();
    }
  });

  test('无尽局（蚀流 6）：没有最后一回合，回合由每章一对 Boss 关口组成', () => {
    const h = mk({ difficulty: ANNIHILATION_DIFFICULTY, erosion: EROSION_MAX }).start();
    const m = h.m;
    assert.equal(m.gd.lastRound, null);
    assert.deepEqual(m.gd.bossHiddenPairs().slice(0, 4), [[14, 15], [19, 20], [24, 25], [29, 30]], '前四章各一对');
    assert.ok(m.gd.bossHiddenPairs().length > 4, '之后按章继续追加');
    m.dispose();
  });

  test('同盟湮灭（mode_multi_annihilation）：档位照样到场，且同样没有炸惊的键', () => {
    const h = mk({ difficulty: ANNIHILATION_DIFFICULTY, mode: 'coop', erosion: 3, humans: 2 }).start();
    const m = h.m;
    const pub = m.publicView();
    assert.equal(pub.modeId, 'mode_multi_annihilation');
    assert.equal(pub.erosion, 3);
    assert.equal(pub.endless, false);
    assert.equal(pub.lastRound, 19);
    assert.equal(pub.players.length, 2);
    assert.deepEqual(zhajingKeyPaths(pub, 'annCoop.m.public'), []);
    for (const p of m.players.values()) assert.equal(Object.hasOwn(p.privateView(), 'jibian'), false, `${p.playerId}: m.private 没有 jibian`);
    m.dispose();
  });
});

describe('湮灭回归锁 · 藏品三选一（g.relic）与毒雾（hazard）域仍然可用', () => {
  test('R1 休整期开 3 张负面藏品，g.relic { idx } 落地、准备键在选完前后正确开关', () => {
    const h = mk({ difficulty: ANNIHILATION_DIFFICULTY, erosion: 4 }).start();
    const m = h.m;
    const ps = m.players.get('p_0');
    const results = [];
    // 藏品没选完不许准备（PlayerPrep.setReady 的拒绝），所以这一步先挡住 ready
    assert.ok(drive(h, { until: () => m.phase === 'PREP' && m.round === 1, ready: (_m, p) => !relicDraft(p), results }), '到不了 R1 PREP');
    assert.deepEqual(results, [], '被挡住的那次 g.ready 不该发生（这里应该一次都没发）');

    const draft = relicDraft(ps);
    assert.ok(draft, 'R1 休整期真的开了藏品草稿');
    assert.equal(draft.cards.length, 3, '三选一');
    assert.equal(draft.kind, 'negative');
    assert.equal(new Set(draft.cards).size, 3, '三张不同');
    const priv = ps.privateView();
    assert.equal(priv.canReady, false, '草稿没结清时不能准备');
    assert.equal(priv.relics.draft.cards.length, 3, 'm.private.relics 里下发了这三张');
    assert.ok(priv.relics.owned.length >= 1, 'R1 先发一件正面的（relicPrepStart）');
    const res = m.handle('p_0', { t: 'g.relic', idx: 1 });
    assert.equal(res.error, undefined, `g.relic: ${JSON.stringify(res)}`);
    assert.equal(relicDraft(ps), null, '选完之后草稿关掉');
    assert.equal(ps.privateView().relics.owned.length, priv.relics.owned.length + 1, '藏品 +1');
    assert.ok(ps.privateView().relics.owned.some((r) => r.id === draft.cards[1]), '选中的那张在册');
    assert.equal(ps.privateView().canReady, true, '选完之后可以准备');

    assert.ok(drive(h, { until: () => m.phase === 'COMBAT' && m.round === 1 }), `没进战斗（${m.phase}）`);
    assert.equal(m.errorCount, 0, `reportError: ${JSON.stringify(m.errors)}`);
    m.dispose();
  });

  test('毒雾：模式旗子照旧、hazard 域挂上并真的在掉血；无尽局按设计没有毒雾', () => {
    // ① 域模块在册（少一行 = 毒雾整片静默失效）
    const names = MODULES.map(([n]) => n);
    assert.ok(names.includes('hazard'), `DOMAIN_NAMES 缺 hazard: ${names.join(',')}`);
    // ② 模式旗子：蚀流 1..5 的普通关带 fog（60 游戏秒 × 战斗倍速 = 120 / 渐强 40 / 上限 0.2 最大生命每秒）
    for (const erosion of [1, 2, 3, 4, 5]) {
      const gd = mk({ difficulty: ANNIHILATION_DIFFICULTY, erosion }).start().m.gd;
      const flags = gd.annihilationFlags('normal', 1);
      assert.deepEqual(flags.fog, { at: 120, ramp: 40, ratio: 0.2 }, `蚀流 ${erosion}: 普通关有毒雾`);
      assert.equal(flags.terrainLethal, 5, '致命级');
      assert.equal(flags.chaosTargeting, true);
      assert.equal(gd.annihilationFlags('boss', 1).fog, undefined, 'Boss 关没有毒雾');
    }
    // ③ 无尽湮灭：哪儿都没有毒雾（无尽本身就是压力）
    const endless = mk({ difficulty: ANNIHILATION_DIFFICULTY, erosion: EROSION_MAX }).start().m.gd;
    assert.equal(endless.annihilationFlags('normal', 1).fog, undefined, '无尽局没有毒雾');    // ④ 真的装上：用**模式自己的旗子**打一场普通关（时限拉长到 400 秒，因为毒雾按设计在第 120 游戏秒才起，
    //    长于一场普通关的 60~90 秒时限），验证 hazard 域确实挂了状态并持续掉血、最后把人毒死
    const modeFlags = mk({ difficulty: ANNIHILATION_DIFFICULTY, erosion: 4 }).start().m.gd.annihilationFlags('normal', 1);
    const b = makeBattle({
      modeId: 'mode_single_annihilation',
      units: [{ chessId: 'chess_char_1_01_a', row: 10, col: 5 }],
      flags: modeFlags,
      timeLimit: 400,
      autoFinish: false,
      content: 'full',
    });
    const unit = b.unit('chess_char_1_01_a');
    assert.ok(unit, '干员上场');
    const maxHp = unit.s.maxHp;
    b.run(119);
    assert.equal(unit.findBuff('annihilation:fog'), null, '第 119 秒还没起（at = 120）');
    assert.equal(unit.hp, maxHp, '毒雾起来之前一滴血都没掉');
    b.run(2);
    assert.ok(unit.findBuff('annihilation:fog'), '第 121 秒毒雾起来了，干员挂着可见状态（necrosis 字形）');
    assert.ok(unit.hp < maxHp, `毒雾开始掉血：${unit.hp} / ${maxHp}`);
    const atRise = unit.hp;
    b.run(9);
    assert.ok(unit.hp < atRise, `ramp 期持续掉血：${unit.hp} < ${atRise}`);
    assert.ok(unit.hp < maxHp * 0.85, `第 130 秒已经掉掉一截：${unit.hp} / ${maxHp}`);
    b.run(60);
    assert.ok(!unit.alive || unit.hp <= 0, `毒雾最终会毒死：hp ${unit.hp} / ${maxHp}（ratio 0.2 → 涨满后约 5 秒清空满血）`);
  });
});

// ── 3. 互不串味：同一进程里交替跑，后者与「单独跑」逐字节相同（withZjView 的泄漏锁）────────────────────
describe('互不串味 · 炸惊与本体 / 湮灭在同一个进程里交替推进', () => {
  test('先炸惊（R1→R2 结算）后普通 / 湮灭：m.public / gd.bondIds / gd.visibleChess 逐字节不变', () => {
    const h = runZhajing(2);
    assert.equal(h.m.enemyJibianCards.length >= 1, true, '炸惊局真的抽了敌方惊变');
    assert.equal(signature({ difficulty: 'NORMAL' }), PRISTINE_NORMAL, '普通局（单人）被炸惊污染了');
    assert.equal(signature({ difficulty: 'NORMAL', mode: 'coop', humans: 2 }), PRISTINE_NORMAL_MULTI, '普通局（同盟）被炸惊污染了');
    assert.equal(signature({ difficulty: ANNIHILATION_DIFFICULTY, erosion: 4 }), PRISTINE_ANN4, '湮灭局被炸惊污染了');
  });

  test('顺序调换：普通 / 湮灭 → 炸惊 → 普通 / 湮灭，两边都逐字节不变', () => {
    // 前一段：先普通/湮灭（此时进程里已经跑过别的局的也要一样）
    assert.equal(signature({ difficulty: 'NORMAL' }), PRISTINE_NORMAL, '炸惊之前的普通局');
    assert.equal(signature({ difficulty: ANNIHILATION_DIFFICULTY, erosion: 4 }), PRISTINE_ANN4, '炸惊之前的湮灭局');
    // 中间插一场炸惊（轮换顺序的另一半）
    const h = runZhajing(3);
    assert.equal(h.m.gd.zhajing, true);
    assert.ok(h.m.enemyJibianCards.length >= 1);
    // 后一段：再来一次，仍然逐字节相同
    assert.equal(signature({ difficulty: 'NORMAL' }), PRISTINE_NORMAL, '炸惊之后的普通局');
    assert.equal(signature({ difficulty: 'NORMAL', mode: 'coop', humans: 2 }), PRISTINE_NORMAL_MULTI, '炸惊之后的同盟普通局');
    assert.equal(signature({ difficulty: ANNIHILATION_DIFFICULTY, erosion: 4 }), PRISTINE_ANN4, '炸惊之后的湮灭局');
  });

  test('炸惊局不变量：R1→R3 每个阶段点 collectViolations 全量为空（炸惊局唯一跑引擎不变量的地方）', () => {
    // 这条是炸惊局目前**唯一**跑引擎不变量的地方，也是 BUG-1 的回归锁：BUG-1 是
    // `server/match/PlayerState.js` 的 `this.hand` 固定 `new Array(HAND_SIZE)`（10），不读 `gd.benchSize`（炸惊 20），
    // 于是每一帧都违反 `server/match/invariants.js:65`（"p_0: hand has 10 slots"）。修好之后这里要求**全量为空**——
    // 别再给这条加任何过滤器，否则下一个「只差一格」的漏判就再也看不见了。
    const h = mk({ difficulty: 'ZHAJING' }).start();
    const m = h.m;
    const points = [];
    let lastKey = null;
    const check = () => {
      const key = `${m.phase}:${m.round}`;
      if (key === lastKey) return;
      lastKey = key;
      points.push({ key, violations: collectViolations(m) });
    };
    assert.ok(drive(h, {
      until: () => { check(); return h.ended != null || (m.phase === 'PREP' && m.round === 3); },
      onPrep: () => check(),
    }), `炸惊局没走到 R3 PREP（停在 ${m.phase} R${m.round}）`);
    assert.equal(m.round, 3, '跑到了第 3 回合');
    for (const p of points) assert.deepEqual(p.violations, [], `${p.key}: 不变量`);
    assert.ok(points.length >= 10, `检查过的阶段点：${points.length}（${points.map((p) => p.key).join(' ')}）`);
    assert.equal(h.m.players.get('p_0').hand.length, 20, 'BUG-1 回归：整备区 20 格');
    assert.equal(m.errorCount, 0, `reportError: ${JSON.stringify(m.errors)}`);
    m.dispose();
  });
});

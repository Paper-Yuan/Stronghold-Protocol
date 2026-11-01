// test/match/bench-size.test.js — 整备区格数：服务端权威（gd.benchSize）→ 客户端几何 / 拖放 / 协议 / DOM 兜底全部跟随
// （handoff/audit-ingame-bugs-2026-10-29.md §1、handoff/audit-pool-copies-2026-10-29.md §3.3 的 P0）。
//
// 服务端从 0.2.x 起就是对的：`server/match/PlayerState.js` 用 `new Array(gd.benchSize)`（炸惊 `data/config.json`
// `modes.*.economy.benchSize` = 20，官方四档 / 湮灭没有 economy 覆盖块 → `gamedata.js` DEFAULTS.benchSize = 10），
// `server/match/board.js freeSlot` 从最大下标往左填，`server/match/invariants.js:65` 每帧断言 `hand.length === gd.benchSize`。
// 错的一直是客户端：几何（垫子、建造区、prep 相机）、落点判定、高亮、兜底视图、协议上限全按 `GEO.HAND_SIZE = 10` 写死，
// 于是炸惊的第 11～20 个干员站在没有垫子的格子上、拖不动、也提交不了。
//
// 本文件钉住四件事：
//   1. 服务端 20：买 20 张全部落在 idx 0..19，`h.invariants()`（含 harness 的 legacy 断言）在炸惊局里不再抛；
//   2. 客户端几何 20：layout.js / tiles.js 把长椅的第二行（row 8，`benchTileOf(10..19)`）画成真垫子，官方 10 时逐字节
//      不变；长椅不再改写建造区（旧的 row 5 侧裙已删），临时整备区的行归 `tempRowOf`（row 6，act2autochess_m01 退 row 9）；
//   3. 可拖放 / 可提交：render/drag.js 的落点、ui/gameLogic/placement.js 的判定、ui/facing.js 的撤退空位、协议 idx 0..19；
//   4. 官方局仍然只有 0..9：协议放宽不改变每局的有效范围，兜底视图的格数仍是 10。

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { makeMatch, checkInvariants } from './harness.js';
import { collectViolations } from '../../server/match/invariants.js';
import { validateC2S } from '../../shared/protocol.js';
import { GEO, benchSizeOf, benchTileOf } from '../../shared/constants.js';
import { AREAS, buildBoard, classifyStage } from '../../public/js/render/board3d/layout.js';
import { TILE_H } from '../../public/js/render/style.js';
import { createDragController, pieceTile, tileSlot } from '../../public/js/render/drag.js';
import { placementContext, canPlace, handFull } from '../../public/js/ui/gameLogic.js';
import { retreatSlot } from '../../public/js/ui/facing.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const load = (f) => JSON.parse(readFileSync(path.join(ROOT, 'data', f), 'utf8'));
const read = (f) => readFileSync(path.join(ROOT, f), 'utf8');
const STAGES = load('stages.json');
const CHESS = load('chess.json');
const ITEMS = load('items.json');
const TOKENS = load('tokens.json');
const getChess = (id) => CHESS[id] || null;
const getItem = (id) => ITEMS[id] || null;
const getToken = (id) => TOKENS[id] || null;
const STAGE = STAGES.act2autochess_m01;

const SEED = 7;
/** 一局走到 R1 PREP（真人座位的 g.* 由 harness 代发）。 */
function prepMatch(difficulty) {
  const h = makeMatch({ mode: 'solo', difficulty, humans: 1, bots: 0, seed: SEED, fake: true }).start();
  h.toPrep(1);
  const m = h.m;
  const ps = h.ps('p_0');
  ps.funds = 9999;
  return { h, m, ps };
}

/** 买一张指定的棋（把 slot 0 改成它，价格 0），返回 m.handle 的结果。 */
function buy(m, ps, id) {
  ps.shop.slots[0] = { kind: 'chess', id, price: 0, basePrice: 0, sold: false };
  return m.handle(ps.playerId, { t: 'g.buy', slot: 0 });
}

/** 本局池子里可见、非精锐、还有余量的一批棋（互不相同才不会合并，合并会腾空格位）。 */
function buyableIds(m, n) {
  return [...m.pool.entries.keys()]
    .filter((id) => !m.gd.isGolden(id) && m.pool.left(id) > 0)
    .slice(0, n);
}

/** 一直买到整备区满：有的干员会带自己的召唤物一起进手牌，所以「买 N 张」不等于「占 N 格」。 */
function fillBench(m, ps) {
  for (const id of buyableIds(m, 60)) {
    if (ps.hand.filter(Boolean).length >= ps.hand.length) break;
    const r = buy(m, ps, id);
    assert.ok(!r?.error, `买 ${id} 被拒：${JSON.stringify(r)}`);
  }
  return ps.hand.map((p, i) => (p ? i : -1)).filter((i) => i >= 0);
}

/** 客户端用的 placement ctx：真的走 placementContext（bench 宽度由 priv.hand.length 决定）。 */
function ctxOf(priv) {
  return placementContext({ priv, stage: STAGE, editable: true, getChess, getItem, getToken });
}

describe('服务端：整备区格数 = gd.benchSize（炸惊 20 / 官方 10）', () => {
  test('炸惊 benchSize 20、hand.length 20；买满 20 格全部落在 idx 0..19（从右往左填）', () => {
    const { m, ps } = prepMatch('ZHAJING');
    assert.equal(m.gd.benchSize, 20, 'mode_*_zhajing.economy.benchSize = 20');
    assert.equal(ps.hand.length, 20, 'PlayerState.hand 跟随 benchSize');
    assert.deepEqual(collectViolations(m), [], '开局不变量：hand.length === gd.benchSize');

    const taken = fillBench(m, ps);
    assert.equal(taken.length, 20, '整备区真的塞满了 20 格');
    assert.deepEqual(taken, [...Array(20).keys()], '20 格占满 0..19（freeSlot 从 19 往左，没有空洞）');
    assert.equal(checkInvariants(m), true, 'h.invariants() 在炸惊局里不再抛（harness 的 legacy 断言跟随 benchSize）');
    m.dispose();
  });

  test('官方四档 benchSize 10、hand.length 10（默认值没被炸惊的 20 污染）', () => {
    for (const difficulty of ['FUNNY', 'NORMAL', 'HARD', 'ABYSS']) {
      const { m, ps } = prepMatch(difficulty);
      assert.equal(m.gd.benchSize, 10, `${difficulty}: DEFAULTS.benchSize = 10`);
      assert.equal(ps.hand.length, 10, `${difficulty}: hand.length 10`);
      assert.deepEqual(collectViolations(m), []);
      assert.equal(checkInvariants(m), true);
      m.dispose();
    }
  });

  test('炸惊的第 11～20 张都能 g.move 回整备区（协议 + 服务端都接受 idx 10..19）', () => {
    const { m, ps } = prepMatch('ZHAJING');
    for (const id of buyableIds(m, 12)) buy(m, ps, id);
    // 12 张 → idx 8..19 有棋子。取最左的一张（idx 8）拖到最右格（idx 19）：两格都在 10..19 之外 / 之内各一
    const src = ps.hand[8];
    assert.ok(src, 'idx 8 有棋子');
    const r = m.handle(ps.playerId, { t: 'g.move', uid: src.uid, to: { area: 'hand', idx: 19 } });
    assert.ok(!r?.error, `g.move → hand idx 19 被拒：${JSON.stringify(r)}`);
    assert.equal(ps.hand[19]?.uid, src.uid, '棋子真的落到了 idx 19');
    assert.deepEqual(collectViolations(m), []);
    m.dispose();
  });
});

describe('协议：hand.idx 上限是最大整备区（HAND_MAX = 20），每局有效范围仍由服务端 hand.length 决定', () => {
  test('idx 0..19 合法，20 不合法；官方局的 idx 10 报文合法但服务端拒绝', () => {
    const uid = 1;
    for (let i = 0; i <= 19; i++) {
      assert.equal(validateC2S({ t: 'g.move', uid, to: { area: 'hand', idx: i } }), null, `hand.idx ${i} 必须被接受`);
    }
    assert.notEqual(validateC2S({ t: 'g.move', uid, to: { area: 'hand', idx: 20 } }), null, 'HAND_MAX 之外拒绝');
    assert.notEqual(validateC2S({ t: 'g.move', uid, to: { area: 'hand', idx: -1 } }), null);

    const { m, ps } = prepMatch('NORMAL');
    for (const id of buyableIds(m, 10)) buy(m, ps, id);
    const src = ps.hand[0];
    // 放宽的是报文，不是规则：官方 10 格时 idx 10 仍然被服务端拒（BAD_TARGET），idx 9 仍然可以
    assert.equal(validateC2S({ t: 'g.move', uid: src.uid, to: { area: 'hand', idx: 10 } }), null, '报文层放行');
    assert.ok(m.handle(ps.playerId, { t: 'g.move', uid: src.uid, to: { area: 'hand', idx: 10 } })?.error, '服务端拒绝 idx 10');
    assert.ok(!m.handle(ps.playerId, { t: 'g.move', uid: src.uid, to: { area: 'hand', idx: 9 } })?.error, '服务端接受 idx 9');
    m.dispose();
  });
});

describe('客户端几何：20 格是两行（row 7 + row 8），官方 10 仍是一行（layout.js）', () => {
  test('benchSize 20 → 数据给的 row 7 那 10 格 + 映射推出来的 row 8 那 10 格；建造区不动、没有侧裙', () => {
    const stage = STAGE;
    const line = stage.rows[GEO.HAND_ROW];
    assert.equal(line.slice(0, GEO.HAND_SIZE), 'a'.repeat(GEO.HAND_SIZE), '数据里 row 7 的 10 个垫子');
    const pads = (grid, r) => grid[r].filter((t) => t.glyph === 'a' && t.content).map((t) => t.c);

    const g20 = classifyStage(stage, AREAS.normal, 20);
    assert.deepEqual(pads(g20, GEO.HAND_ROW), [...Array(10).keys()], '第一行：row 7 col 0..9（idx 0..9）');
    // 第二行的位置从唯一映射推出来（idx 10..19 → (row, col)），不写死是哪一行
    for (const idx of [10, 13, 19]) {
      const t = benchTileOf(idx, 20);
      assert.equal(t.row, GEO.HAND_ROW + 1, `idx ${idx} 在长椅后面那一行（row 8）`);
      assert.equal(g20[t.row][t.col].glyph, 'a', `idx ${idx} 的 (${t.row},${t.col}) 是垫子`);
      assert.equal(g20[t.row][t.col].content, true, '第二行的垫子是实打实的格子');
      assert.equal(g20[t.row][t.col].h, TILE_H.bench, '垫子高度');
    }
    assert.deepEqual(pads(g20, GEO.HAND_ROW + 1), [...Array(10).keys()], '第二行：row 8 col 0..9（idx 10..19）');
    assert.equal(g20[GEO.HAND_ROW + 1][10].benchPad, false, 'col 10 起不是垫子（没有向右拉长的垫子）');
    assert.equal(g20[GEO.HAND_ROW][10].glyph, '#', 'row 7 的 col 10 仍是墙块');
    // 长椅不再往下（row 6 仍是数据给的隔断墙），也不再往上贴侧裙（row 5 是关卡地形）
    assert.equal(g20[GEO.HAND_ROW - 1][0].glyph, 'X', 'row 6 仍是隔断墙');
    assert.deepEqual(pads(g20, GEO.HAND_ROW - 1), [], 'row 6 没有长椅垫子');
    assert.deepEqual(pads(g20, GEO.HAND_ROW - 2), [], 'row 5 没有长椅垫子（侧裙已删）');

    // 官方 10：垫子数、glyph、content 全部与不带 benchSize 的调用一致（同一条代码路径），row 8 仍是关卡地形
    const plain = classifyStage(stage, AREAS.normal);
    const ten = classifyStage(stage, AREAS.normal, 10);
    assert.equal(pads(ten, GEO.HAND_ROW).length, 10);
    assert.equal(ten[GEO.HAND_ROW + 1][0].benchPad, false, '官方局 row 8 不是长椅');
    assert.deepEqual(ten.map((row) => row.map((t) => [t.glyph, t.content, t.drawn, t.surf, t.rot, t.h])),
      plain.map((row) => row.map((t) => [t.glyph, t.content, t.drawn, t.surf, t.rot, t.h])), '官方 10 与今天逐字节一致');

    // 建造区：长椅两条行都在官方取景框里（camera rect rows 7–12、cols 0..10），20 格一个矩形都不改
    assert.deepEqual(AREAS.normal.map((a) => [a.r0, a.r1, a.c0, a.c1]), [[6, 13, 0, 10], [13, 18, 6, 14]],
      '建造区仍是官方那两块（不再把 r0 6 往前拉到 5）');
    const src = read('public/js/render/board3d/layout.js');
    assert.doesNotMatch(src, /benchSkirtRow/, 'row 5 侧裙已删');
    assert.doesNotMatch(src, /export function benchAreas/, '不再有改写建造区的 benchAreas');
    // 每个正常关卡的 row 7 都是 10 个垫子；20 格时第二行按映射长出 10 个
    for (const [id, st] of Object.entries(STAGES)) {
      const row7 = st.rows?.[GEO.HAND_ROW] || '';
      if (!/^a/.test(row7)) continue;
      const g = classifyStage(st, AREAS.normal, 20);
      assert.equal(pads(g, GEO.HAND_ROW).length, 10, `${id}: row 7 恰好 10 个垫子`);
      for (let idx = 10; idx < 20; idx++) {
        const t = benchTileOf(idx, 20);
        assert.equal(g[t.row][t.col].glyph, 'a', `${id}: idx ${idx} 的 (${t.row},${t.col}) 是垫子`);
      }
    }
  });

  test('buildBoard 接受 benchSize：20 格把 row 8 的地形画成长椅垫子（scene.setBenchSize 传下来）', () => {
    const b10 = buildBoard(STAGE, { area: AREAS.normal, benchSize: 10 });
    const b20 = buildBoard(STAGE, { area: AREAS.normal, benchSize: 20 });
    const t10 = benchTileOf(10, 20);
    assert.ok(b10.buckets.board.vertexCount > 0);
    assert.equal(b20.grid[GEO.HAND_ROW][0].surf, 'padReinf', '第一行是长椅垫子');
    assert.equal(b20.grid[t10.row][t10.col].surf, 'padReinf', '第二行也是长椅垫子');
    assert.equal(b20.grid[t10.row][t10.col].h, TILE_H.bench, '第二行是垫子高度');
    assert.equal(b20.grid[t10.row][t10.col].benchPad, true);
    assert.equal(b10.grid[t10.row][t10.col].benchPad, false, '官方局 row 8 不是垫子');
    assert.notEqual(b10.grid[t10.row][t10.col].glyph, 'a', '官方局 row 8 仍是关卡地形');
    // row 6 的隔断墙和踩在墙上的装置（act2 m01 的 (6,5)/(6,9) 吹风机）原样保留：长椅不再碰那一行
    for (const b of [b10, b20]) {
      assert.equal(b.grid[GEO.HAND_ROW - 1][5].glyph, 'X', 'row 6 仍是隔断墙');
      assert.equal(b.devices.filter((d) => d.r === GEO.HAND_ROW - 1).length, 2, 'row 6 的吹风机还在');
    }
  });
});

describe('客户端落点 / 判定：idx 10..19 是可拖放、可提交的格位', () => {
  test('tileSlot / pieceTile 走同一条两行映射：row 7 col 0..9 = idx 0..9，row 8 col 0..9 = idx 10..19', () => {
    const geo20 = { ...GEO, HAND_SIZE: 20 };
    assert.deepEqual(tileSlot({ row: GEO.HAND_ROW, col: 3 }, geo20), { area: 'hand', idx: 3 });
    assert.deepEqual(tileSlot({ row: GEO.HAND_ROW + 1, col: 3 }, geo20), { area: 'hand', idx: 13 }, '第二行的第 4 格是 idx 13');
    assert.deepEqual(tileSlot({ row: GEO.HAND_ROW + 1, col: 0 }, geo20), { area: 'hand', idx: 10 });
    assert.deepEqual(tileSlot({ row: GEO.HAND_ROW + 1, col: 9 }, geo20), { area: 'hand', idx: 19 });
    assert.deepEqual(tileSlot({ row: GEO.HAND_ROW, col: 3 }), { area: 'hand', idx: 3 }, '官方几何 row 7 照旧');
    assert.deepEqual(tileSlot({ row: GEO.HAND_ROW + 1, col: 0 }), null, '官方几何：row 8 不是格位（那里是关卡地形）');
    // temp 的格位在 tempRowOf 那一行（row 6 cols 0..4），不再占长椅的第二行
    assert.deepEqual(tileSlot({ row: GEO.TEMP_ROW, col: GEO.TEMP_C0 }, geo20), { area: 'temp', idx: 0 });
    assert.deepEqual(tileSlot({ row: GEO.HAND_ROW + 1, col: GEO.TEMP_C0 }, geo20), { area: 'hand', idx: 10 }, 'row 8 那几格归长椅');
    assert.deepEqual(tileSlot({ row: GEO.HAND_ROW, col: 10 }, geo20), null, 'col 10 不是格位');
    assert.deepEqual(pieceTile({ area: 'hand', idx: 13 }, 20), { row: GEO.HAND_ROW + 1, col: 3 }, 'idx 13 落在第二行');
    assert.deepEqual(pieceTile({ area: 'hand', idx: 13 }), { row: GEO.HAND_ROW, col: 3 }, '默认 10 格：idx 13 落到 col 3（官方不会出现）');
  });

  test('拖放：handSize 20 时 row 8 的格子是落点，默认 10 时同一位置不是落点', () => {
    const events = [];
    const pieces = [{ uid: 1, kind: 'chess', id: 'chess_char_1_02_a', area: 'hand', idx: 5, draggable: true }];
    const make = (handSize) => {
      events.length = 0;
      const c = createDragController({
        hitPiece: (x) => pieces.find(() => Math.abs(x - 550) < 60) || null,
        // 第二行（row 8）的 col 在 x = col × 100（x = 300 → col 3）
        pickTile: (x) => ({ row: GEO.HAND_ROW + 1, col: Math.round(x / 100) }),
        handSize,
        emit: (n, p) => events.push([n, p]),
        setTimeout: () => 0, clearTimeout: () => {},
      });
      c.setEditable(true);
      const ev = (t, x) => c[t]({ pointerId: 1, pointerType: 'mouse', button: 0, x, y: 0, clientX: x, clientY: 0 });
      ev('pointerDown', 550);      // 自己的格子（row 7 col 5）
      ev('pointerMove', 570);      // 过阈值 → 开始拖
      ev('pointerMove', 300);      // row 8 col 3
      const mv = events.filter((e) => e[0] === 'pieceDragMove').pop()[1];
      ev('pointerUp', 300);
      return { mv, drop: events.find((e) => e[0] === 'pieceDrop') };
    };

    const wide = make(20);
    assert.deepEqual(wide.mv.target, { area: 'hand', idx: 13 }, '第二行 col 3 是 idx 13 的落点');
    assert.equal(wide.mv.legal, true);
    assert.deepEqual(wide.drop?.[1].target, { area: 'hand', idx: 13 }, '放手提交的是 idx 13');

    const official = make(GEO.HAND_SIZE);
    assert.equal(official.mv.target, null, '官方几何：row 8 不是格位');
    assert.equal(official.mv.legal, false);
    assert.equal(official.drop, undefined, '不会提交一个不存在的格位');
  });

  test('放置判定 / 撤退空位都跟随 priv.hand.length（20 格时 idx 19 既能当目标也能当来源）', () => {
    const { m, ps } = prepMatch('ZHAJING');
    const taken = fillBench(m, ps);
    assert.equal(taken.length, 20);
    const priv = ps.privateView();
    assert.equal(priv.hand.length, 20);
    assert.equal(benchSizeOf(priv), 20, 'benchSizeOf 读的就是 hand.length');
    const ctx = ctxOf(priv);
    assert.equal(ctx.handSize, 20);

    // 每一个真实占用的 idx 都落在一块真垫子上，并且是合法的拖放格位（这是 P0 的病灶：idx 10..19 没有格子）
    const geo20 = { ...GEO, HAND_SIZE: 20 };
    const grid = classifyStage(m.stage, AREAS.normal, 20);
    for (const idx of taken) {
      const t = benchTileOf(idx, 20);
      assert.deepEqual(pieceTile({ area: 'hand', idx }, 20), t);
      assert.deepEqual(tileSlot(t, geo20), { area: 'hand', idx }, `idx ${idx} 必须是落点`);
      assert.equal(grid[t.row][t.col]?.glyph, 'a', `idx ${idx} 必须站在垫子上（${t.row},${t.col}）`);
      assert.equal(grid[t.row][t.col]?.content, true);
    }

    const at0 = priv.hand[0];
    const at19 = priv.hand[19];
    assert.ok(at0 && at19);
    // 20 格全满：互换合法（目标 idx 19 在旧代码里是 BAD_TILE）
    const swap = canPlace(ctx, at0.uid, { area: 'hand', idx: 19 });
    assert.equal(swap.ok, true, `canPlace → idx 19：${JSON.stringify(swap)}`);
    assert.equal(swap.action, 'swap');

    // 撤退：只留 idx 19 空着时，客户端必须找到它（旧代码只数 0..9 → 误报「整备区已满」）
    const almost = { ...priv, hand: priv.hand.map((p, i) => (i === 19 ? null : p)) };
    const ctx2 = ctxOf(almost);
    const board = { uid: 9001, kind: 'chess', id: 'chess_char_1_02_a', items: [], dir: 'RIGHT', row: 9, col: 3 };
    const priv2 = { ...almost, board: [...(almost.board || []), board] };
    const ctx3 = ctxOf(priv2);
    assert.deepEqual(retreatSlot(ctx3, board.uid), { area: 'hand', idx: 19 }, '撤退找到第 20 格');
    assert.equal(canPlace(ctx2, priv.hand[0].uid, { area: 'hand', idx: 19 }).action, 'move', 'idx 19 是合法落点');
    m.dispose();
  });

  test('官方 10 格：客户端仍然只认 0..9（同一份判定代码，没有放宽）', () => {
    const { m, ps } = prepMatch('NORMAL');
    for (const id of buyableIds(m, 10)) buy(m, ps, id);
    const priv = ps.privateView();
    assert.equal(benchSizeOf(priv), 10);
    const ctx = ctxOf(priv);
    assert.equal(ctx.handSize, 10);
    const bad = canPlace(ctx, priv.hand[0].uid, { area: 'hand', idx: 10 });
    assert.equal(bad.ok, false);
    assert.equal(bad.code, 'BAD_TILE', '官方局的 idx 10 客户端仍然拒绝');
    assert.equal(canPlace(ctx, priv.hand[0].uid, { area: 'hand', idx: 9 }).ok, true);
    assert.equal(handFull(priv), true, '10 格满 = 满');
    // 撤退：0..9 全满且没有自己的召唤物 → null
    const board = { uid: 9002, kind: 'chess', id: 'chess_char_1_02_a', items: [], dir: 'RIGHT', row: 9, col: 3 };
    assert.equal(retreatSlot(ctxOf({ ...priv, board: [board] }), board.uid), null);
    m.dispose();
  });

  test('handFull 用 hand.length 而不是常量：20 格要满 20 张才算满', () => {
    // 20 格：19 张不是满（旧代码 `20 >= 10` 恒真，只是碰巧对），20 张才是满
    assert.equal(handFull({ hand: new Array(20).fill({}) }), true);
    assert.equal(handFull({ hand: new Array(20).fill(null).map((_, i) => (i === 19 ? null : {})) }), false);
    assert.equal(handFull({ hand: new Array(10).fill({}) }), true);
    assert.equal(handFull({ hand: [] }), false);

    const { m, ps } = prepMatch('ZHAJING');
    const taken = fillBench(m, ps);
    assert.equal(taken.length, 20);
    const priv = ps.privateView();
    assert.equal(handFull(priv), true, '真局：20/20 = 满');
    assert.equal(handFull({ ...priv, hand: priv.hand.map((p, i) => (i === 19 ? null : p)) }), false, '19/20 不是满');
    m.dispose();
  });
});

describe('兜底视图（DOM 2D）：格数跟随 priv.hand，官方局仍是 10 格', () => {
  test('benchSizeOf 决定 ff-slot 数量：官方 10 / 炸惊 20；源码里不再写死 GEO.HAND_SIZE 的循环', () => {
    const { m, ps } = prepMatch('ZHAJING');
    assert.equal(benchSizeOf(ps.privateView()), 20, '炸惊兜底视图画 20 个 ff-slot');
    m.dispose();
    const official = prepMatch('NORMAL');
    assert.equal(benchSizeOf(official.ps.privateView()), 10, '官方兜底视图仍画 10 个 ff-slot');
    official.m.dispose();

    const ff = read('public/js/ui/fallbackField.js');
    assert.match(ff, /benchSizeOf\(st\.priv\)/, 'slot 循环 / tileScreen 的格数来自 priv');
    assert.doesNotMatch(ff, /i < GEO\.HAND_SIZE/, '不再按默认宽度画格子');
    assert.doesNotMatch(ff, /col < GEO\.HAND_SIZE/, 'tileScreen 不再按默认宽度命中');
  });

  test('静态守卫：客户端整备区格数不再由 GEO.HAND_SIZE 决定（只剩「缺省值」用法）', () => {
    for (const f of ['public/js/render/app.js', 'public/js/ui/gameLogic/placement.js',
      'public/js/ui/facing.js', 'public/js/ui/fallbackField.js', 'public/js/ui/gameLogic/shop.js']) {
      const src = read(f);
      assert.doesNotMatch(src, /i < GEO\.HAND_SIZE/, `${f} 仍在按默认宽度循环`);
      assert.doesNotMatch(src, />= GEO\.HAND_SIZE/, `${f} 仍在按默认宽度判定`);
      assert.doesNotMatch(src, /Array\(GEO\.HAND_SIZE\)/, `${f} 仍在按默认宽度建数组`);
    }
    assert.match(read('public/js/ui/gameLogic/shop.js'), /hand\.length > 0 && hand\.every/, 'handFull 用 hand.length');
    assert.match(read('public/js/ui/gameLogic/placement.js'), /benchSizeOf\(priv\)/, 'placementContext 带上 handSize');
    assert.match(read('public/js/render/app.js'), /setHandSize\(benchSizeOf\(src\)\)/, 'setPrep 把宽度交给渲染层');
  });
});

// test/render/bench-rows.test.js — 整备区两行（炸惊 20 格）：一条映射真源 + 两个渲染层的格子 + prep 取景 + 美术台面高度
//
// 业主 2026-10-30（第一条）：「炸惊底下的部署位做成两条才对，把原版的溢出位那一行做格子才对，不是一直向右，这样没法做了，
// 你参考原版炸惊看看啊」。业主 2026-10-30（第二条，真机核验后拍板）：溢出行从 row 6 **改到 row 8**（往上补）——
// public/assets/local/scene 的五个炸惊关卡包里，美术长椅 = row 7（台面 z 0.37–0.46）、第二条垫子带 = row 8
// （z 0.38–0.50），row 6 是前沿岩边（cols 6–7 是水，act2_m01 那行还有隔断墙 + 吹风机），row 5 全是水。
// 所以在下方贴格子必然浮空；row 8 正好落在美术的装备带上，一行美术都不用改。
//
// 本文件钉住五件事：
//   1. shared/constants.js 的 benchTileOf / benchIndexAt 是唯一映射：10 格只有 row 7，20 格是 row 7 + row 8；
//   2. 3D 板（board3d/layout.js classifyStage）与 2D 板（render/tiles.js parseStage）都把 row 8 画成真垫子，
//      官方 10 格两张网格逐字节不变（row 6 仍是隔断墙，长椅带不再往前扩，也没有 row 5 侧裙）；
//   3. 拖放的落点 / 手牌格位 / 拖拽站立都走同一条映射（render/drag.js），temp 行走 tempRowOf；
//   4. prep 取景：官方相机 rows 7–12 原样（两行都在框里），不再为 row 6 让位（少了让位带，792×360 上棋盘更大）；
//   5. 棋子站在美术台面上：board3d/benchDeck.js 的实测高度（row 7 台面 0.46 / act2 m01 0.37，row 8 装备带 0.38）。

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { GEO, benchRows, benchTileOf, benchIndexAt, BENCH_PER_ROW, tempRowOf, TEMP_ROW_FALLBACK } from '../../shared/constants.js';
import { AREAS, classifyStage, heightOf } from '../../public/js/render/board3d/layout.js';
import { benchDeckZ } from '../../public/js/render/board3d/benchDeck.js';
import { parseStage } from '../../public/js/render/tiles.js';
import { presetCamera, CAMERA_PRESETS } from '../../public/js/render/projection.js';
import { pieceTile, tileSlot, dragStandTile } from '../../public/js/render/drag.js';
import { TILE_H } from '../../public/js/render/style.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const load = (f) => JSON.parse(readFileSync(path.join(ROOT, 'data', f), 'utf8'));
const STAGE = load('stages.json').act2autochess_m01;
const ROW = GEO.HAND_ROW;

describe('唯一映射：benchTileOf / benchIndexAt', () => {
  test('10 格 = 一行 row 7（官方每一档）；20 格 = row 7 前 10 + row 8 后 10', () => {
    assert.equal(BENCH_PER_ROW, 10);
    assert.equal(benchRows(10), 1);
    assert.equal(benchRows(20), 2);
    for (let i = 0; i < 10; i++) assert.deepEqual(benchTileOf(i, 10), { row: ROW, col: i }, `官方 idx ${i}`);
    for (let i = 0; i < 10; i++) assert.deepEqual(benchTileOf(i, 20), { row: ROW, col: i }, `20 格 idx ${i} 仍在第一行`);
    for (let i = 10; i < 20; i++) assert.deepEqual(benchTileOf(i, 20), { row: ROW + 1, col: i - 10 }, `20 格 idx ${i} 在第二行（row 8）`);
    // 缺省 = 官方 10 格
    assert.deepEqual(benchTileOf(3), { row: ROW, col: 3 });
    assert.deepEqual(benchTileOf(13), { row: ROW, col: 3 }, '缺省宽度下 idx 13 折回 col 3（官方不会出现 13）');
  });

  test('反查：row/col → idx，越界与另一行都拒绝；两者互为逆映射', () => {
    assert.equal(benchIndexAt(ROW, 0, 10), 0);
    assert.equal(benchIndexAt(ROW, 9, 10), 9);
    assert.equal(benchIndexAt(ROW + 1, 0, 10), null, '官方 10 格：row 8 不是格位');
    assert.equal(benchIndexAt(ROW, 10, 20), null, 'col 10 起不是格位');
    assert.equal(benchIndexAt(ROW, -1, 20), null);
    assert.equal(benchIndexAt(ROW + 2, 0, 20), null, '两行以外不是格位');
    assert.equal(benchIndexAt(ROW, 0, 20), 0);
    assert.equal(benchIndexAt(ROW + 1, 0, 20), 10);
    assert.equal(benchIndexAt(ROW + 1, 9, 20), 19);
    for (const n of [10, 20]) for (let i = 0; i < n; i++) {
      const t = benchTileOf(i, n);
      assert.equal(benchIndexAt(t.row, t.col, n), i, `${n} 格 idx ${i} 往返一致`);
    }
  });
});

describe('两个渲染层都把第二行画成真格子；官方 10 格不变', () => {
  test('3D（classifyStage）：20 格 row 8 的 10 格变成垫子，官方 10 格逐字节一致', () => {
    const pads = (grid, r) => grid[r].filter((t) => t.glyph === 'a' && t.content).map((t) => t.c);
    const g20 = classifyStage(STAGE, AREAS.normal, 20);
    assert.deepEqual(pads(g20, ROW), [...Array(10).keys()]);
    assert.deepEqual(pads(g20, ROW + 1), [...Array(10).keys()], '第二行 = row 8 cols 0..9（idx 10..19）');
    assert.equal(g20[ROW + 1][0].h, TILE_H.bench, '第二行是垫子高度（render/style.js TILE_H.bench）');
    assert.equal(g20[ROW + 1][10].benchPad, false, 'col 10 起不是垫子');
    assert.equal(g20[ROW + 1][11].glyph, 'I', '升降台还在数据给它的那一格');
    // 长椅带不再改动下方的 row 6 / row 5
    assert.equal(g20[ROW - 1][0].glyph, 'X', 'row 6 仍是隔断墙（不再是第二行垫子）');
    assert.equal(g20[ROW - 2][4].glyph, 'h', 'row 5 是关卡自己的地形，长椅不再往上贴');
    const plain = classifyStage(STAGE, AREAS.normal);
    const ten = classifyStage(STAGE, AREAS.normal, 10);
    assert.deepEqual(ten.map((r) => r.map((t) => [t.glyph, t.content, t.drawn, t.surf, t.rot, t.h])),
      plain.map((r) => r.map((t) => [t.glyph, t.content, t.drawn, t.surf, t.rot, t.h])));
  });

  test('2D（parseStage）：同一张格子图，heightAt 取的就是垫子高度；官方 10 格逐字节一致', () => {
    const flat = (g) => g.map((r) => r.map((t) => [t.glyph, t.mat, t.h, t.drawn, t.playable]));
    // prep 的真实 band / field（render/app/view.js bandFor / fieldRows：rows 6–18）
    const g20 = parseStage(STAGE, [6, 18], [6, 18], 20);
    assert.equal(g20[ROW + 1][0].glyph, 'a');
    assert.equal(g20[ROW + 1][0].h, TILE_H.bench, '2D 网格的 row 8 也是垫子高度（picking / tileScreen 用得到）');
    assert.equal(g20[ROW + 1][10].benchPad, false, 'col 10 起不是垫子');
    assert.equal(g20[ROW - 1][0].glyph, 'X', 'row 6 仍是隔断墙');
    assert.deepEqual(flat(parseStage(STAGE, [6, 18], [6, 18], 10)), flat(parseStage(STAGE, [6, 18], [6, 18])));
    // 不画长椅带的视图（例如最终攻势 prep 的 boss 那半场：field 只到 row 6）不长垫子
    const boss = parseStage(STAGE, [0, 13], [0, 6], 20);
    assert.equal(boss[ROW + 1][0].glyph, '#', 'boss 视图的 row 8 仍是关卡地形');
  });

  test('建造区不再因 20 格而改写：官方 AREAS 原样，长椅带走 row 7–8 而已', () => {
    // （旧行为 row 5 侧裙：把起点在 row 6 的矩形扩到 row 5 —— 已删除，layout.js 不再有 benchAreas / benchSkirtRow）
    assert.deepEqual(AREAS.normal.map((a) => [a.r0, a.r1, a.c0, a.c1]), [[6, 13, 0, 10], [13, 18, 6, 14]]);
    assert.equal(heightOf(classifyStage(STAGE, AREAS.normal, 20), ROW + 1, 3), TILE_H.bench);
  });
});

describe('拖放 / 手牌格位走同一条映射', () => {
  test('pieceTile / tileSlot / dragStandTile 在 20 格下认出第二行', () => {
    assert.deepEqual(pieceTile({ area: 'hand', idx: 10 }, 20), { row: ROW + 1, col: 0 });
    assert.deepEqual(tileSlot({ row: ROW + 1, col: 0 }, { ...GEO, HAND_SIZE: 20 }), { area: 'hand', idx: 10 });
    assert.deepEqual(dragStandTile({ target: { area: 'hand', idx: 19 }, legal: true }, { ...GEO, HAND_SIZE: 20 }), { row: ROW + 1, col: 9, bench: true });
    // 官方几何：同一批坐标不是格位，手牌仍只有 row 7
    assert.equal(tileSlot({ row: ROW + 1, col: 0 }), null);
    assert.deepEqual(pieceTile({ area: 'hand', idx: 9 }), { row: ROW, col: 9 });
    assert.deepEqual(dragStandTile({ target: { area: 'hand', idx: 9 }, legal: true }), { row: ROW, col: 9, bench: true });
  });

  test('temp 行走 tempRowOf：row 6 cols 0..4；act2autochess_m01 退 row 9', () => {
    assert.equal(tempRowOf('act1autochess_m02'), GEO.TEMP_ROW);
    assert.deepEqual([GEO.TEMP_ROW, GEO.TEMP_C0, GEO.TEMP_SIZE], [6, 0, 5]);
    assert.equal(tempRowOf('act2autochess_m01'), TEMP_ROW_FALLBACK);
    assert.equal(TEMP_ROW_FALLBACK, 9);
    // 默认几何下 temp 格位就是 row 6 cols 0..4（不再落在长椅第二行的 row 8 上）
    assert.deepEqual(tileSlot({ row: GEO.TEMP_ROW, col: GEO.TEMP_C0 }, { ...GEO, HAND_SIZE: 20 }), { area: 'temp', idx: 0 });
    assert.equal(tileSlot({ row: ROW + 1, col: GEO.TEMP_C0 }, { ...GEO, HAND_SIZE: 20 }).area, 'hand', 'row 8 那几格归长椅');
    // 只有这一关的 temp 行换到 row 9（drag 控制器 setTempRow 用的就是它）
    const g = { ...GEO, HAND_SIZE: 20, TEMP_ROW: tempRowOf('act2autochess_m01') };
    assert.deepEqual(tileSlot({ row: 9, col: 0 }, g), { area: 'temp', idx: 0 });
    assert.equal(tileSlot({ row: 6, col: 0 }, g), null, 'act2_m01 的 row 6 不再是 temp 格位');
    assert.deepEqual(pieceTile({ area: 'temp', idx: 4 }, 20, ROW, tempRowOf('act2autochess_m01')), { row: 9, col: GEO.TEMP_C0 + 4 });
  });
});

describe('prep 取景：官方相机 rows 7–12 原样，两行都在框里，不再为 row 6 让位', () => {
  const VP = { width: 792, height: 360 };
  const PAD = { top: 36, right: 40, bottom: 86, left: 71 };
  const HUD = { top: 60, bottom: 56 };

  test('20 格的取景矩形就是官方 rect（rows 7–12, cols 0..10）：不再往下要 row 6', () => {
    const framed = presetCamera('prep', VP, { padding: PAD, rect: { r0: ROW, r1: 12, c0: 0, c1: 10 } });
    const official = presetCamera('prep', VP, { padding: PAD });
    assert.deepEqual([framed.tx, framed.ty, framed.dist, framed.scale], [official.tx, official.ty, official.dist, official.scale],
      '第二行在框里，镜头不用为它改动（官方 left_prepare_camera_param 原样）');
    assert.ok(Math.abs(framed.tx - 5) < 0.6, `镜头中心 ${framed.tx} 仍在左半场`);
    // 官方预置本身没动
    assert.deepEqual([CAMERA_PRESETS.prep.rect.r0, CAMERA_PRESETS.prep.rect.r1], [ROW, 12]);
    assert.equal(CAMERA_PRESETS.prep.keep.near, 6.5, '官方让位带 = 长椅近边 6.5（不再下移到 5.5）');
  });

  test('792×360：row 8 的第二行落在官方取景内，且棋盘比「为 row 6 让位」的旧取景更大', () => {
    const withHud = presetCamera('prep', VP, { padding: PAD, hud: HUD });
    const oldKeep = presetCamera('prep', VP, { padding: PAD, hud: HUD, keep: { near: 5.5, zNear: TILE_H.bench, far: 12.5, zFar: 0.42 } });
    // 旧行为：clearHud 把 near 5.5（row 6 第二行的近边）抬到店铺栏之上 → 缩小/上移；新行为用官方 6.5
    assert.ok(withHud.scale >= oldKeep.scale - 1e-9, `新取景不比旧的窄（${withHud.scale} ≥ ${oldKeep.scale}）`);
    const yFar = withHud.project(withHud.tx, ROW + 1.5, 0.38).y;      // row 8 的远边
    const yNear = withHud.project(withHud.tx, ROW - 0.5, 0.46).y;     // row 7 的近边
    assert.ok(yFar > HUD.top - 0.5, `第二行远边 y=${yFar.toFixed(1)} 不能顶出上沿（${HUD.top}）`);
    assert.ok(yNear <= VP.height - HUD.bottom + 0.5, `长椅近边 y=${yNear.toFixed(1)} 留在店铺栏之上`);
    // 行距（一格的屏幕高度）在 792×360 上够看清：两行之间至少 8 px
    assert.ok(yNear - yFar > 8, `两行之间 ${(yNear - yFar).toFixed(1)} px`);
  });
});

describe('棋子站在美术台面上（board3d/benchDeck.js 的实测高度）', () => {
  test('row 7 台面 / row 8 装备带：沙漠包 0.46 / 0.38，act2 m01 0.37，未知关卡 null', () => {
    const stages = load('stages.json');
    for (const [id, st] of Object.entries(stages)) {
      const row7 = st.rows?.[ROW] || '';
      if (!/^a/.test(row7)) continue; // 没有长椅带的关卡（boss 那半场之类）
      assert.equal(typeof benchDeckZ(id, ROW), 'number', `${id}: row 7 的台面高度`);
    }
    assert.equal(benchDeckZ('act1autochess_m02', ROW), 0.46);
    assert.equal(benchDeckZ('act1autochess_m02', ROW + 1), 0.38);
    assert.equal(benchDeckZ('act2autochess_m01', ROW), 0.37);
    assert.equal(benchDeckZ('act2autochess_m01', ROW + 1), 0.37);
    assert.equal(benchDeckZ('act2autochess_m04', ROW + 1), 0.38);
    assert.equal(benchDeckZ('no_such_stage', ROW), null, '没有实测的包 → 程序化垫子高度（TILE_H.bench）');
    assert.equal(benchDeckZ('act1autochess_m02', ROW - 1), null, 'row 6（temp 行）没有台面数据');
    assert.ok(benchDeckZ('act1autochess_m02', ROW) > TILE_H.bench + 0.2, '美术台面明显高于程序化垫子（写死 0.16 会陷进去）');
  });

  test('普通 10 格房间也只跟美术台面走长椅那一行（row 8 不属于它们）', () => {
    assert.equal(benchTileOf(9, 10).row, ROW);
    assert.equal(benchDeckZ('act1autochess_m02', benchTileOf(9, 10).row), 0.46);
    assert.equal(benchTileOf(13, 20).row, ROW + 1);
  });
});

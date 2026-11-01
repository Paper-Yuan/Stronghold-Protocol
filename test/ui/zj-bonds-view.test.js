// test/ui/zj-bonds-view.test.js — 玩法包专属内容不得外溢到界面（业主 2026-10-28 P0-1 真机验收）。
//
// 两个方向的泄漏都要挡住：
//   · 炸惊的 5 条 `zjOnly` 盟约（岁 / 企鹅物流 / 医师 / S.E.E.S / 颂乐人偶）与 2 条 `zjOnly` 策略
//     （`band_zj_fuuka` / `band_zj_si`）→ 不许出现在官方房**和湮灭房**；
//   · 湮灭的 2 条 `annOnly` 盟约（罗德岛 / 卡兹戴尔）→ 不许出现在官方房**和炸惊房**。
//
// 为什么需要它：引擎侧 `GameData` 会按模式剔除，但界面有几处直接读 `data.list('bonds')` / `list('bands')` —— 那条路
// 绕过 GameData。这个文件同时钉住**判据**（三态：官方 / 炸惊 / 湮灭）和**接线**（各处调用点真的用了它）。
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { isZhajingRoom, isAnnihilationRoom, extensionRoomOf, officialBonds, extensionBondsOf, officialBands } from '../../public/js/ui/zjView.js';
import { morphPairings } from '../../public/js/ui/gameLogic/bonds.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const json = (rel) => JSON.parse(read(rel));

const BONDS = [
  { bondId: 'lateralanoShip', name: '拉特兰' },
  { bondId: 'suiShip', name: '岁', zjOnly: true },
  { bondId: 'mujicaShip', name: '颂乐人偶', zjOnly: true },
  { bondId: 'rhodesShip', name: '罗德岛', annOnly: true },
  { bondId: 'kazdelShip', name: '卡兹戴尔', annOnly: true },
];
const BANDS = [
  { bandId: 'band_normal', name: '正规军' },
  { bandId: 'band_zj_fuuka', name: '山岸风花', zjOnly: true },
  { bandId: 'band_zj_si', name: '祀', zjOnly: true },
];

describe('玩法包专属内容的官方视图（三态）', () => {
  test('isZhajingRoom / isAnnihilationRoom / extensionRoomOf', () => {
    for (const v of ['mode_single_zhajing', 'mode_multi_zhajing', 'ZHAJING', 'zhajing']) assert.equal(isZhajingRoom(v), true, `${v} 是炸惊`);
    for (const v of [null, undefined, '', 'mode_single_normal', 'ANNIHILATION', 'HARD']) assert.equal(isZhajingRoom(v), false);
    for (const v of ['mode_single_annihilation', 'mode_multi_annihilation', 'ANNIHILATION', 'annihilation']) assert.equal(isAnnihilationRoom(v), true, `${v} 是湮灭`);
    for (const v of [null, undefined, '', 'ZHAJING', 'mode_single_normal']) assert.equal(isAnnihilationRoom(v), false);
    assert.equal(extensionRoomOf('ZHAJING'), 'zhajing');
    assert.equal(extensionRoomOf('ANNIHILATION'), 'annihilation');
    assert.equal(extensionRoomOf('mode_single_normal'), 'official');
    assert.equal(extensionRoomOf(null), 'official');
  });

  test('officialBonds: 官方只留官方，炸惊不拿湮灭的，湮灭不拿炸惊的', () => {
    assert.deepEqual(officialBonds(BONDS, 'mode_single_normal').map((b) => b.bondId), ['lateralanoShip'], '官方房间：两条专属都不要');
    assert.deepEqual(officialBonds(BONDS, null).map((b) => b.bondId), ['lateralanoShip'], '没有房间（报告页）也是官方视图');
    assert.deepEqual(officialBonds(BONDS, 'ZHAJING').map((b) => b.bondId), ['lateralanoShip', 'suiShip', 'mujicaShip'], '炸惊：要 zjOnly，不要 annOnly');
    assert.deepEqual(officialBonds(BONDS, 'mode_multi_zhajing').map((b) => b.bondId), ['lateralanoShip', 'suiShip', 'mujicaShip']);
    assert.deepEqual(officialBonds(BONDS, 'ANNIHILATION').map((b) => b.bondId), ['lateralanoShip', 'rhodesShip', 'kazdelShip'], '湮灭：要 annOnly，不要 zjOnly');
    assert.deepEqual(officialBonds(BONDS, 'mode_single_annihilation').map((b) => b.bondId), ['lateralanoShip', 'rhodesShip', 'kazdelShip']);
  });

  test('extensionBondsOf: 只给当前这一档的专属盟约（页面分组用）', () => {
    assert.deepEqual(extensionBondsOf(BONDS, 'ZHAJING').map((b) => b.bondId), ['suiShip', 'mujicaShip']);
    assert.deepEqual(extensionBondsOf(BONDS, 'ANNIHILATION').map((b) => b.bondId), ['rhodesShip', 'kazdelShip']);
    assert.deepEqual(extensionBondsOf(BONDS, null), []);
    assert.deepEqual(extensionBondsOf(BONDS, 'mode_single_normal'), []);
  });

  test('officialBands: zjOnly 的两种策略只在炸惊房里出现（官方与湮灭都不给）', () => {
    assert.deepEqual(officialBands(BANDS, null).map((b) => b.bandId), ['band_normal']);
    assert.deepEqual(officialBands(BANDS, 'ANNIHILATION').map((b) => b.bandId), ['band_normal'], '湮灭没有专属策略，照官方规则');
    assert.deepEqual(officialBands(BANDS, 'ZHAJING').map((b) => b.bandId), ['band_normal', 'band_zj_fuuka', 'band_zj_si']);
  });

  test('不是数组时返回空数组（数据还没到时界面不炸）', () => {
    assert.deepEqual(officialBonds(undefined, 'mode_single_normal'), []);
    assert.deepEqual(officialBonds(null, 'ZHAJING'), []);
    assert.deepEqual(officialBonds({ bondId: 'x' }, 'mode_single_normal'), []);
    assert.deepEqual(officialBands(undefined, 'ZHAJING'), []);
    assert.deepEqual(officialBands({ bandId: 'x' }, null), []);
  });

  test('真数据：官方 23 条 / 炸惊 28 条 / 湮灭 25 条；官方策略 40 条 / 炸惊 42 条', () => {
    const bonds = json('data/bonds.json');
    const bondList = Array.isArray(bonds) ? bonds : Object.values(bonds);
    assert.equal(officialBonds(bondList, null).length, 23, '官方盟约 23 条（test/data.test.js 同一口径）');
    assert.equal(officialBonds(bondList, 'ZHAJING').length, 28, '炸惊 = 23 + 5 条 zjOnly');
    assert.equal(officialBonds(bondList, 'ANNIHILATION').length, 25, '湮灭 = 23 + 2 条 annOnly');
    assert.ok(officialBonds(bondList, 'ZHAJING').every((b) => b.annOnly !== true), '炸惊房里不得有 annOnly');
    assert.ok(officialBonds(bondList, 'ANNIHILATION').every((b) => b.zjOnly !== true), '湮灭房里不得有 zjOnly');
    const bands = json('data/bands.json');
    const bandList = Array.isArray(bands) ? bands : Object.values(bands);
    assert.equal(officialBands(bandList, null).length, 40, '官方策略 40 条');
    assert.equal(officialBands(bandList, 'ZHAJING').length, 42, '炸惊 = 40 + 2 条 zjOnly');
    assert.ok(officialBands(bandList, 'ANNIHILATION').every((b) => b.zjOnly !== true));
  });

  test('变形同构体的配对列表跟着房间走（官方 / 湮灭里没有炸惊专属装备的配对）', () => {
    const items = [
      { id: 'item_morph', canGiveBond: true, giveBondId: 'suiShip' },
      { id: 'item_zj_only', giveBondId: 'suiShip', zjOnly: true },
      { id: 'item_normal', giveBondId: 'lateralanoShip' },
    ];
    const bondRecs = BONDS.map((b) => ({ ...b }));
    const rows = (room) => morphPairings(items, officialBonds(bondRecs, room === 'zhajing' ? 'ZHAJING' : room === 'annihilation' ? 'ANNIHILATION' : null), { room });
    const ids = (room) => rows(room).map((r) => r.bondId).sort();
    assert.deepEqual(ids('official'), ['lateralanoShip'], 'official: neither the zjOnly item nor a zjOnly bond row is listed');
    assert.deepEqual(ids('annihilation'), ['lateralanoShip'], 'annihilation: same (suiShip is 炸惊-exclusive)');
    assert.deepEqual(ids('zhajing'), ['lateralanoShip', 'suiShip'], 'zhajing keeps it — that bond belongs to this play set');
  });

  test('接线守卫：每一处按全量渲染的界面都过了这道过滤', () => {
    const bondSites = [
      ['public/js/screens/briefing.js', "officialBonds(gd.list('bonds')"],
      ['public/js/screens/bandDraft.js', "officialBonds(gd.list('bonds')"],
      ['public/js/ui/enemyDrawer.js', "officialBonds(data.list('bonds')"],
      ['public/js/screens/sweep.js', "officialBonds(data.list('bonds')"],
      ['public/js/ui/detailPanel.js', "officialBonds(data.list('bonds')"],
    ];
    for (const [file, pattern] of bondSites) {
      const src = read(file);
      assert.ok(src.includes(pattern), `${file} 应当通过 officialBonds() 取盟约列表`);
      assert.ok(!/bonds:\s*(?:gd|data)\.list\('bonds'\)/.test(src), `${file} 不应再直接传全量盟约给 matchInfo 模型`);
    }
    const bandSites = ['public/js/screens/sweep.js'];
    for (const file of bandSites) {
      const src = read(file);
      assert.ok(src.includes("officialBands(data.list('bands')"), `${file} 的策略列表应当过 officialBands()`);
      assert.ok(!/\(\s*data\.list\('bands'\)\s*\|\|\s*\[\]\s*\)\.filter/.test(src), `${file} 不应再直接过滤全量策略`);
    }
    // 变形同构体那一处：两个参数都走了过滤
    const detail = read('public/js/ui/detailPanel.js');
    assert.ok(detail.includes('morphPairings(data.list(\'items\'), officialBonds(data.list(\'bonds\')'), 'the pairing list filters both sides');
    assert.ok(detail.includes("room: extensionRoomOf(diff)"));
  });
});

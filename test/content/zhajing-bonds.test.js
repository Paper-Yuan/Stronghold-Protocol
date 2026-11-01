// test/content/zhajing-bonds.test.js — 炸惊模拟的 3 条 zjOnly 盟约（岁 / 企鹅物流 / 医师）的战斗侧。
//
// 这三个盟约原版数据里是**空壳**（bb={}、buffs=[]），数值与文案只写在 data/bonds.json 的 `zj` 块里、只在 ZHAJING 下
// 合并（shared/zjBonds.js）。战斗侧（server/sim/content/bonds/addon/zjbonds.js）用黑板上有没有 `zj_` 前缀的键当门：
// 拿不到覆盖块 = 整个盟约不装。这套用例钉的就是这道门 —— 同一份数据、同一批棋子，
// **ZHAJING 下有效果、普通模式下一模一样地没有**（否则主玩法会被专属盟约污染，且不报错）。
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { makeBattle } from '../helpers/battleHarness.js';

const ZJ = 'mode_single_zhajing';
const NORMAL = 'mode_single_normal';

/** 一个棋子 + 它身上的盟约等级（bonds 输入的形状见 test/content/bands.test.js）。 */
function fight({ modeId, bonds, chessId, enemies = [] }) {
  return makeBattle({
    modeId,
    stageId: 'flat',
    players: [{
      playerId: 'p1', seat: 0, side: 'L', colOffset: 0, bonds, playerEffects: [], bandId: null,
      units: [{ uid: 1, kind: 'chess', chessId, row: 10, col: 5 }],
    }],
    enemies,
    autoFinish: false,
  });
}

const hasBuff = (u, key) => !!u && Array.isArray(u.buffs) && u.buffs.some((b) => b && b.key === key);
const SUI = 'chess_zj_09_a';
const PENGUIN = 'chess_zj_01_a';
const PHYSICIAN = 'chess_zj_05_a';

describe('炸惊模拟 · zjOnly 盟约（岁 / 企鹅物流 / 医师）只在 ZHAJING 生效', () => {
  test('岁：2 名 → 成员攻防 +30%（ZHAJING）；普通模式同一批棋子没有这条 buff', () => {
    const bonds = { suiShip: { count: 2, active: true, tier: 1, layers: 0 } };
    const zj = fight({ modeId: ZJ, bonds, chessId: SUI });
    const u = zj.unit(SUI);
    assert.ok(u, '棋子在场上');
    assert.ok(hasBuff(u, 'bond:suiShip:atkdef'), 'ZHAJING：岁 2 名档的攻击/防御白值 buff');
    const plain = fight({ modeId: NORMAL, bonds, chessId: SUI });
    assert.equal(hasBuff(plain.unit(SUI), 'bond:suiShip:atkdef'), false, '普通模式：同一个盟约一条 buff 都没有');
  });

  test('岁 4 名（天有四时）：成员再加攻，全场加生命 / 攻速 / 技力恢复', () => {
    const bonds = { suiShip: { count: 4, active: true, tier: 3, layers: 0 } };
    const h = fight({ modeId: ZJ, bonds, chessId: SUI });
    const u = h.unit(SUI);
    assert.ok(hasBuff(u, 'bond:suiShip:tian:atk'), '成员攻击力额外加成');
    assert.ok(hasBuff(u, 'bond:suiShip:tian:all'), '场上所有干员的通用加成');
    const plain = fight({ modeId: NORMAL, bonds, chessId: SUI });
    assert.equal(hasBuff(plain.unit(SUI), 'bond:suiShip:tian:all'), false, '普通模式不装');
  });

  test('企鹅物流：2 名再部署 -50%，3 名 -75% 且部署费用为 0', () => {
    const two = fight({ modeId: ZJ, bonds: { penguinShip: { count: 2, active: true, tier: 1, layers: 0 } }, chessId: PENGUIN });
    const u2 = two.unit(PENGUIN);
    assert.ok(hasBuff(u2, 'bond:penguinShip:redeploy'), '再部署 buff 在');
    const cost2 = u2.base.cost;
    const three = fight({ modeId: ZJ, bonds: { penguinShip: { count: 3, active: true, tier: 2, layers: 0 } }, chessId: PENGUIN });
    assert.equal(three.unit(PENGUIN).base.cost, 0, '3 名档：部署费用 0');
    assert.ok(cost2 > 0, '2 名档：费用不动（原值 ' + cost2 + '）');
    const plain = fight({ modeId: NORMAL, bonds: { penguinShip: { count: 3, active: true, tier: 2, layers: 0 } }, chessId: PENGUIN });
    assert.ok(plain.unit(PENGUIN).base.cost > 0, '普通模式：费用照常');
    assert.equal(hasBuff(plain.unit(PENGUIN), 'bond:penguinShip:redeploy'), false);
  });

  test('医师：1 名 → 成员攻击力 +60%', () => {
    const bonds = { physicianShip: { count: 1, active: true, tier: 1, layers: 0 } };
    const zj = fight({ modeId: ZJ, bonds, chessId: PHYSICIAN });
    assert.ok(hasBuff(zj.unit(PHYSICIAN), 'bond:physicianShip'), 'ZHAJING：医师盟约的攻击力 buff');
    const plain = fight({ modeId: NORMAL, bonds, chessId: PHYSICIAN });
    assert.equal(hasBuff(plain.unit(PHYSICIAN), 'bond:physicianShip'), false, '普通模式不装');
  });

  test('没有该盟约的等级 → 什么都不装（空转，不抛）', () => {
    const h = fight({ modeId: ZJ, bonds: { suiShip: { count: 1, active: false, tier: 0, layers: 0 } }, chessId: SUI });
    assert.equal(hasBuff(h.unit(SUI), 'bond:suiShip:atkdef'), false);
  });
});

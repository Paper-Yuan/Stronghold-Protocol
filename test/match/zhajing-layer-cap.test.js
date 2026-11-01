// test/match/zhajing-layer-cap.test.js — 炸惊模拟 规则1「盟约层数上限 9999」真的生效。
//
// 背景（handoff/audit-startup-and-gameplay-2026-10-29.md §2.4.2 B2）：`data/config.json` 的两个炸惊模式都写了
// `bondLayerCap: 9999`，`gamedata.js` 也把它放进了战斗 flags，但**三处真正写层的地方**（sim `addLayers`、结算 settle、
// 整备期 `PlayerState.addLayers`）都还以进程级 `BOND_LAYER_CAP = 999` 为闸，而且闸在 cap 判断之前 —— 层数到 999 时
// `layerGainRoom(live, Infinity) > 0` 直接 return 0，`flags.bondLayerCap` 分支永远到不了；invariants 又用 999 判，
// 于是「违反规则」这件事一直静默。
//
// 这里钉四条：
//   1. sim（战斗内实时层数）：炸惊能过 999，其它模式照旧停在 999；
//   2. 结算 settle 与整备期 PlayerState.addLayers 同样按 flags/`gd.bondLayerCap` 取上限；
//   3. invariants：炸惊局 1000 层不报错、10000 层报错；普通局 1000 层照旧报错（别放松其它模式）；
//   4. 不污染进程：跑过炸惊局之后，同进程的普通局仍然只到 999（**不**用 setBondLayerCap 全局开关）。
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { makeBattle } from '../helpers/battleHarness.js';
import { makeMatch } from './harness.js';
import { collectViolations } from '../../server/match/invariants.js';
import { BOND_LAYER_CAP, currentBondLayerCap } from '../../shared/constants.js';

const BOND = 'yanShip';           // data/bonds.json 里的普通盟约，两种模式都有

/** 一个只有一名玩家、没有敌人的战斗：只为调 Battle.addLayers。 */
function battleWith(layers, flags) {
  return makeBattle({
    units: [], enemies: [], seed: 7, autoFinish: false, timeLimit: 600,
    bonds: { [BOND]: { count: 0, active: true, tier: 1, layers } },
    flags: { layerGainsEnabled: true, ...flags },
  });
}

describe('炸惊模拟 · 盟约层上限 9999（规则1）', () => {
  test('sim：炸惊的 flags.bondLayerCap 让 999 层还能继续叠（旧实现在这里恒 0）', () => {
    const zj = battleWith(BOND_LAYER_CAP, { bondLayerCap: 9999 });
    assert.equal(zj.b.addLayers('p1', BOND, 5), 5, '999 + 5 = 1004（不是 0）');
    assert.equal(zj.b.getPlayer('p1').bonds[BOND].layers, BOND_LAYER_CAP + 5);
    assert.equal(zj.b.errorCount, 0);

    const plain = battleWith(BOND_LAYER_CAP, {});
    assert.equal(plain.b.addLayers('p1', BOND, 5), 0, '没有 bondLayerCap 的模式照旧停在 999');
    assert.equal(plain.b.getPlayer('p1').bonds[BOND].layers, BOND_LAYER_CAP);
  });

  test('sim：炸惊自己的上限同样封顶（9999 之上不再涨）', () => {
    const zj = battleWith(9999, { bondLayerCap: 9999 });
    assert.equal(zj.b.addLayers('p1', BOND, 50), 0, '已经 9999：0');
    const near = battleWith(9990, { bondLayerCap: 9999 });
    assert.equal(near.b.addLayers('p1', BOND, 50), 9, '只补到 9999');
    assert.equal(near.b.getPlayer('p1').bonds[BOND].layers, 9999);
  });

  test('整备期 PlayerState.addLayers：炸惊按 gd.bondLayerCap，普通模式按 999', () => {
    const zj = makeMatch({ mode: 'solo', difficulty: 'ZHAJING', seed: 7, fake: true }).start();
    zj.toPrep(1);
    const zp = zj.ps('p_0');
    assert.equal(zj.m.gd.bondLayerCap, 9999, '数据里就是 9999');
    zp.layers[BOND] = BOND_LAYER_CAP;
    assert.equal(zp.addLayers(BOND, 5), 5, '炸惊：999 + 5 = 1004');
    assert.equal(zp.layers[BOND], BOND_LAYER_CAP + 5);

    const plain = makeMatch({ mode: 'solo', difficulty: 'NORMAL', seed: 7, fake: true }).start();
    plain.toPrep(1);
    const pp = plain.ps('p_0');
    assert.equal(plain.m.gd.bondLayerCap, null, '普通模式没有模式上限');
    pp.layers[BOND] = BOND_LAYER_CAP;
    assert.equal(pp.addLayers(BOND, 5), 0, '普通模式：停在 999');
    assert.equal(pp.layers[BOND], BOND_LAYER_CAP);
    zj.dispose?.();
    plain.dispose?.();
  });

  test('结算 settle：战斗里报上来的层增益按模式上限落库（炸惊 1004、普通 999）', () => {
    const run = (difficulty) => {
      // FakeBattle 的战报里带 50 层增益；整备期先把这名玩家的盟约顶到 999
      const h = makeMatch({
        mode: 'solo', difficulty, seed: 7, fake: true,
        script: () => ({ layerGains: { p_0: { [BOND]: 50 } } }),
      }).start();
      h.toPrep(1);
      const ps = h.ps('p_0');
      ps.layers[BOND] = BOND_LAYER_CAP;
      ps.recompute();
      // 跑完这一轮（结算发生在 SETTLE，之后 startRound 开下一轮），到 R2 就断言
      assert.ok(h.drive(() => h.m.round > 1 || h.ended != null), '跑完 R1');
      return { layers: ps.layers[BOND], h };
    };
    const zj = run('ZHAJING');
    assert.equal(zj.layers, BOND_LAYER_CAP + 50, `炸惊：999 + 50 = 1049（实际 ${zj.layers}）`);
    zj.h.dispose?.();
    const plain = run('NORMAL');
    assert.equal(plain.layers, BOND_LAYER_CAP, `普通模式：仍停在 999（实际 ${plain.layers}）`);
    plain.h.dispose?.();
  });

  test('invariants：炸惊 1000 层不报错、10000 层报错；普通模式 1000 层照旧报错', () => {
    const violationsAt = (difficulty, layers) => {
      const h = makeMatch({ mode: 'solo', difficulty, seed: 7, fake: true }).start();
      h.toPrep(1);
      const ps = h.ps('p_0');
      ps.layers[BOND] = layers;
      ps.recompute();
      const out = collectViolations(h.m).filter((v) => v.includes('layers'));
      h.dispose?.();
      return out;
    };
    assert.deepEqual(violationsAt('ZHAJING', 1000), [], '炸惊 1000 层是合法的（旧实现会误报）');
    assert.equal(violationsAt('ZHAJING', 10000).length, 1, '炸惊 10000 层超上限 → 报错');
    assert.equal(violationsAt('NORMAL', 1000).length, 1, '普通模式仍然是 999（没有放松）');
  });

  test('不污染进程：跑过炸惊局之后同进程的普通局仍只到 999（没动 setBondLayerCap）', () => {
    const before = currentBondLayerCap();
    const zj = makeMatch({ mode: 'solo', difficulty: 'ZHAJING', seed: 7, fake: true }).start();
    zj.toPrep(1);
    assert.equal(zj.ps('p_0').addLayers(BOND, 1) >= 0, true);
    assert.equal(currentBondLayerCap(), before, '炸惊局不抬进程级上限（那是超限局的路子）');
    const plain = battleWith(BOND_LAYER_CAP, {});
    assert.equal(plain.b.addLayers('p1', BOND, 5), 0, '同进程的普通战斗照旧 999');
    zj.dispose?.();
  });
});

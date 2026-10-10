import test from 'node:test';
import assert from 'node:assert/strict';
import { stripPackOperators, mergeCustomContent } from '../shared/customContent.js';

test('stripPackOperators cleans candidate pool and clears equipped slots', () => {
  const diy = {
    ownedPool: ['char_002_amiya', 'char_003_kalts', 'char_102_texas'],
    slots: [
      { charId: 'char_002_amiya', name: '阿米娅' },
      { charId: 'char_102_texas', name: '德克萨斯' },
      null,
      null
    ]
  };

  const packOps = [{ charId: 'char_002_amiya' }];
  const cleaned = stripPackOperators(diy, packOps);

  assert.deepEqual(cleaned.ownedPool, ['char_003_kalts', 'char_102_texas']);
  assert.equal(cleaned.slots[0], null); // 阿米娅被强制卸下
  assert.equal(cleaned.slots[1].charId, 'char_102_texas');
  assert.equal(cleaned.wasAdjusted, true);
});

test('mergeCustomContent merges overlays without mutating base data', () => {
  const base = { bonds: { guard: { name: '近卫' } }, list: [1, 2] };
  const overlay = { bonds: { kazdelShip: { name: '卡兹戴尔' } }, list: [3] };

  const merged = mergeCustomContent(base, overlay);
  assert.deepEqual(merged.bonds, { guard: { name: '近卫' }, kazdelShip: { name: '卡兹戴尔' } });
  assert.deepEqual(merged.list, [1, 2, 3]);
  assert.equal(base.list.length, 2); // base untouched
});

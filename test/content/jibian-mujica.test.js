// test/content/jibian-mujica.test.js — 颂乐人偶 Fever（server/sim/content/mujica.js）的纯函数契约。
//
// 移植来源：参考包 test/mujica-jibian-rewards.test.mjs（羁绊档位 → Fever 上限）与 test/mujica-fever-synergy.test.mjs。
// 完整的 Fever 协同（开技 → 鼓舞 / 自动施法）要 5 名颂乐人偶干员的 kit 与 mujicaShip 盟约数据，属 content / data 的
// 写域；本文件只钉住**不依赖那些数据**的那一层：常量、成员判定、上限随羁绊档位变化、非本模式恒 450。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  FEVER_DURATION, FEVER_MAX, MUJICA_CHARS, getFeverMax, isMujica,
} from '../../server/sim/content/mujica.js';

const GALAXY = 'jibian_yinhezhanjian';
const GODDESS = 'jibian_yiwangnvshen';

test('常量：上限 450、时长 20s、五名干员 charId', () => {
  assert.equal(FEVER_MAX, 450);
  assert.equal(FEVER_DURATION, 20);
  assert.deepEqual([...MUJICA_CHARS], ['char_4182_oblvns', 'char_4183_mortis', 'char_4184_dolris', 'char_4185_amoris', 'char_4186_tmoris']);
});

test('isMujica 按 def.charId 认人（也认裸 charId）', () => {
  assert.equal(isMujica({ def: { charId: 'char_4186_tmoris' } }), true);
  assert.equal(isMujica({ charId: 'char_4182_oblvns' }), true);
  assert.equal(isMujica({ def: { charId: 'char_112_siege' } }), false);
  assert.equal(isMujica(null), false);
});

test('getFeverMax：非本模式恒 450（主玩法零影响）', () => {
  const battle = { modeId: 'mode_multi_normal', players: [{ playerId: 'p1', playerEffects: [{ key: `jibian:${GALAXY}` }] }] };
  assert.equal(getFeverMax(battle, 'p1'), FEVER_MAX);
  assert.equal(getFeverMax({ players: [] }, 'p1'), FEVER_MAX);
});

test('getFeverMax：本模式按 ave_mujica 档位 450 → 225 → 50', () => {
  const mk = (ids) => ({
    modeId: 'mode_single_zhajing',
    players: [{ playerId: 'p1', playerEffects: ids.map((id) => ({ key: `jibian:${id}` })) }],
  });
  assert.equal(getFeverMax(mk([]), 'p1'), FEVER_MAX);
  assert.equal(getFeverMax(mk([GALAXY]), 'p1'), FEVER_MAX, '只有 1 张不到一档');
  assert.equal(getFeverMax(mk([GALAXY, GODDESS]), 'p1'), FEVER_MAX / 2);
  assert.equal(getFeverMax(mk([GALAXY, GODDESS, 'jibian_duoshouyeshou']), 'p1'), 50);
});

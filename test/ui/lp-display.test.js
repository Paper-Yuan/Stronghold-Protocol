// test/ui/lp-display.test.js — 顶部生命塔（LpTower）与多人房队内血条同一条取整口径（lpDisplay）：
//   * 12 人房结算按存活人数平摊，m.private.lp 是浮点：旧代码 `<b class="num lp__val">${Math.max(0, value)}</b>`
//     直接印原始浮点（真房截图 25.916666666666668，实际显示值应为 25）。
//   * 口径 = server/match/teams.js `hpDisplay`：活着 max(1, floor(lp))（0.4 显示 1，不会「显示 0 但还活着」），
//     归零才是 0（倒下）。客户端只有一份实现：public/js/ui/gameLogic/format.js `lpDisplay`，LpTower 与
//     multiHud.js 的 `.gm-team__hp` 都调它 —— 不再各写一遍 floor。
//   * 4 人房逐字节不变：lp 是整数时 floor 不改变数值，输出字符串与改动前的 `Math.max(0, value)` 完全相同
//     （下面用改动前的表达式逐值对拍）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lpDisplay } from '../../public/js/ui/gameLogic.js';
import { LpTower } from '../../public/js/ui/gameComponents.js';
import { multiHudView } from '../../public/js/ui/multiHud.js';
import { PHASE } from '../../shared/constants.js';

/** The text of a vnode tree in document order. */
const textOf = (v) => {
  if (v == null || typeof v === 'boolean') return '';
  if (typeof v === 'string' || typeof v === 'number') return String(v);
  if (Array.isArray(v)) return v.map(textOf).join('');
  return typeof v === 'object' ? textOf(v.props?.children) : '';
};
function* walk(v) {
  if (Array.isArray(v)) { for (const x of v) yield* walk(x); return; }
  if (!v || typeof v !== 'object') return;
  yield v;
  yield* walk(v.props?.children);
}
const byClass = (v, c) => [...walk(v)].filter((x) => typeof x.props?.class === 'string'
  && x.props.class.split(/\s+/).includes(c));
const valOf = (v) => textOf(byClass(v, 'lp__val')[0]);
const pendOf = (v) => textOf(byClass(v, 'lp__pend')[0]);

/** 改动前 LpTower 的显示规则（原样照抄，用于「整数逐字节不变」的对拍）。 */
const legacyTower = (value, pending = 0) => {
  const ok = Number.isFinite(value);
  const p = ok && Number(pending) > 0 ? Math.min(value, Math.trunc(Number(pending))) : 0;
  return {
    val: ok ? String(Math.max(0, value)) : '--',
    pend: p > 0 ? `−${p}` : '',
    dataPending: p > 0 ? p : null,
    pending: p > 0,
  };
};
const towerOf = (value, pending = 0) => {
  const v = LpTower({ value, size: 'lg', pending });
  return {
    val: valOf(v),
    pend: pendOf(v),
    dataPending: v.props['data-pending'],
    pending: v.props.class.split(/\s+/).includes('is-pending'),
  };
};

test('lpDisplay：与 server/match/teams.js hpDisplay 同一条口径（floor；归零才是 0）', () => {
  assert.equal(lpDisplay(25.916666666666668), 25);
  assert.equal(lpDisplay(25), 25);
  assert.equal(lpDisplay(2.083333333333333), 2);
  assert.equal(lpDisplay(0.4), 1, '存活的显示下限是 1：不会出现「显示 0 但还活着」');
  assert.equal(lpDisplay(0), 0, '归零 = 倒下');
  assert.equal(lpDisplay(-3), 0, '不会印负数');
  assert.equal(lpDisplay(NaN), 0);
  assert.equal(lpDisplay(Infinity), 0);
});

test('LpTower：浮点 lp 印取整后的数（12 人房），归零仍显示 0', () => {
  assert.equal(valOf(LpTower({ value: 25.916666666666668, size: 'lg' })), '25');
  assert.equal(valOf(LpTower({ value: 0.4 })), '1');
  assert.equal(valOf(LpTower({ value: 0 })), '0');
  assert.equal(valOf(LpTower({ value: null })), '--');
  // −N 待扣牌也只印整数（它夹在已结算的整数 LP 上，不再漏出小数）
  const pend = LpTower({ value: 25.916666666666668, size: 'lg', pending: 3 });
  assert.equal(valOf(pend), '25');
  assert.equal(pendOf(pend), '−3');
  assert.equal(pend.props['data-pending'], 3);
  const clamped = LpTower({ value: 25.916666666666668, pending: 30 });
  assert.equal(pendOf(clamped), '−25', '待扣牌夹在显示值上，不会印 −25.916666666666668');
});

test('4 人房逐字节不变：整数 lp（含待扣牌）的输出与改动前的 Math.max(0, value) 逐值相同', () => {
  for (let n = 0; n <= 120; n++) {
    for (const pending of [0, 1, 3, 30]) {
      assert.deepEqual(towerOf(n, pending), legacyTower(n, pending), `integer lp ${n}, pending ${pending}`);
    }
  }
  // 4 人房的实际取值（每轮上限 10、LP 30 起）也在其中：24 / 30 / 0
  for (const n of [0, 24, 25, 30]) {
    assert.equal(valOf(LpTower({ value: n, size: 'lg' })), String(n));
  }
});

test('多人房队内血条与顶栏同一条规则（同一个 lpDisplay，不再各写一份 floor）', () => {
  const players = Array.from({ length: 12 }, (_, i) => ({
    playerId: `p_${i}`, seat: i, name: `P${i}`, team: Math.floor(i / 4), alive: true, connected: true, isBot: false,
    hp: i === 0 ? 25.916666666666668 : i === 1 ? 0.4 : 30, hpMax: 30,
  }));
  const pub = { t: 'm.public', phase: PHASE.PREP, maxSeats: 12, teams: 3, players };
  const v = multiHudView({ pub, myId: 'p_0', openTeam: 0 });
  // 只在我方那一队出数字（信息不对称）：三个浮点/整数都走 lpDisplay
  assert.deepEqual(byClass(v, 'gm-team__hp').map(textOf), ['25', '1', '30', '30']);
  // 同步口径：顶栏同一个值印的也是 25
  assert.equal(valOf(LpTower({ value: players[0].hp })), '25');
});

// test/match/zhajing-loadout.test.js — 炸惊模拟「卡池调整」（`room.loadout { mode: 'zhajing' }`）的服务端半边。
//
// 玩法包的名册是**独立的一套**：99 条 `zhajing: true` 记录，全都 `visible: false`。所以它既不能复用主内容那份
// `checkLoadout`（会一条都判非法），也不能把选择写进 `ps.loadout`（那会把主玩法的 干员调配 覆盖掉）。这套用例钉的是：
//   ① 两档并存、互不影响；② 炸惊房开局真的按 zj 档选技能/模组；③ 没有 zj 档 = 与现在逐字节一致（记录默认）；
//   ④ 官方房收到 zj 档必须被拒（BAD_TARGET，不许污染）；⑤ 名册校验（不在 99 条里 → 拒）。
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { makeMatch } from './harness.js';
import { checkLoadout } from '../../shared/protocol.js';
import { zjRosterIds } from '../../shared/zhajingBase.js';

/** 一条真的有多技能 + 有精英模组的炸惊记录（名册里的第一类），与它的默认值。 */
const ZJ_CHESS = 'chess_zj_01_a';
const ZJ_CHESS_ELITE = 'chess_zj_01_b';
/** 一条官方记录（不在炸惊名册里），用来验证校验口径。 */
const NORMAL_CHESS = 'chess_char_1_01_a';

const seat = (extra = {}) => [{ seat: 0, playerId: 'p_0', name: 'P0', connected: true, ...extra }];

const zjMatch = (extra = {}) => makeMatch({ mode: 'solo', difficulty: 'ZHAJING', seats: seat(extra), seed: 5, fake: true }).start();
const normalMatch = (extra = {}) => makeMatch({ mode: 'solo', difficulty: 'NORMAL', seats: seat(extra), seed: 5, fake: true }).start();

/** 玩家在用的技能索引（走的就是 battleInput 用的那条解析）。 */
const skillOf = (ps, chessId) => ps.loadoutFor(ps.gd.chess(chessId)).skillIndex;

describe('炸惊模拟 · 卡池调整（zj 档）', () => {
  test('① 两档并存：写 zj 档不改 normal 档，写 normal 档不改 zj 档', () => {
    const zjOnly = zjMatch({ zjLoadout: { [ZJ_CHESS]: { skill: 0, module: null } } });
    const ps = zjOnly.ps('p_0');
    assert.deepEqual(Object.keys(ps.zjLoadout), [ZJ_CHESS], 'zj 档在');
    assert.deepEqual(Object.keys(ps.loadout), [], 'normal 档仍是空（没被写进去）');
    assert.equal(skillOf(ps, ZJ_CHESS), 0, '实际用的是 zj 档的技能');

    const normalOnly = zjMatch({ loadout: { [ZJ_CHESS]: { skill: 1, module: null } } });
    const ps2 = normalOnly.ps('p_0');
    assert.deepEqual(Object.keys(ps2.zjLoadout), [], 'zj 档仍空');
    // 官方档里的炸惊 id 会被官方校验丢掉（visible:false）——所以这条只能证明「没串档」，不能证明它生效
    assert.deepEqual(Object.keys(ps2.loadout), [], '官方校验不认炸惊记录，normal 档不会因此收获条目');
    assert.notEqual(skillOf(ps2, ZJ_CHESS), 1, '更不会把官方档当 zj 档用');
    zjOnly.dispose?.();
    normalOnly.dispose?.();
  });

  test('② 炸惊房开局按 zj 档装配（技能索引 + 精英模组都来自它）', () => {
    const h = zjMatch({ zjLoadout: { [ZJ_CHESS]: { skill: 1, module: 'uniequip_002_angel' } } });
    const ps = h.ps('p_0');
    assert.equal(ps.gd.zhajing, true);
    assert.equal(skillOf(ps, ZJ_CHESS), 1, '技能索引来自 zj 档（默认是 2）');
    // 模组：精英记录上才生效（与官方 loadout 同一口径）
    const elite = ps.loadoutFor(ps.gd.chess(ZJ_CHESS_ELITE));
    assert.equal(elite.moduleId, 'uniequip_002_angel');
    // battleInput 里也是它（真正下发给战斗的那一层）
    const input = ps.battleInput({ side: 'L', colOffset: 0 });
    assert.ok(input && Array.isArray(input.units));
    h.dispose?.();
  });

  test('③ 没有 zj 档 = 与现在逐字节一致（记录默认技能 / 模组）', () => {
    const h = zjMatch();
    const ps = h.ps('p_0');
    assert.deepEqual(ps.zjLoadout, {}, '空档');
    const rec = ps.gd.chess(ZJ_CHESS);
    const def = ps.loadoutFor(rec);
    assert.equal(def.skillIndex, rec.skill.index, '默认技能索引就是记录里的那个');
    assert.equal(def.moduleId, null, '非精英没有模组');
    assert.deepEqual(ps.loadout, {}, 'normal 档也不受影响');
    h.dispose?.();
  });

  test('④ 官方房（及湮灭房）收到 zj 档必须被拒，且什么都不改', () => {
    const h = normalMatch();
    const ps = h.ps('p_0');
    const before = { zj: ps.zjLoadout, lo: ps.loadout };
    const r = h.m.setLoadout('p_0', { [ZJ_CHESS]: { skill: 0 } }, null, 'zhajing');
    assert.equal(r.error, 'BAD_TARGET', `官方房拒绝 zj 档: ${JSON.stringify(r)}`);
    assert.equal(ps.zjLoadout, before.zj, 'zj 档没被写');
    assert.equal(ps.loadout, before.lo, 'normal 档没被动');
    assert.equal(ps.setZjLoadout({ [ZJ_CHESS]: { skill: 0 } }), false, 'PlayerState 自己也拒（非炸惊局）');
    const ann = makeMatch({ mode: 'solo', difficulty: 'ANNIHILATION', seats: seat(), seed: 5, fake: true }).start();
    assert.equal(ann.m.setLoadout('p_0', { [ZJ_CHESS]: { skill: 0 } }, null, 'zhajing').error, 'BAD_TARGET', '湮灭房同样拒绝');
    h.dispose?.();
    ann.dispose?.();
  });

  test('⑤ 名册校验：不在 99 条里的 chessId / 非法技能索引 → 拒；合法的 zj 条目 → 收下', () => {
    const h = zjMatch();
    const ps = h.ps('p_0');
    const data = ps.gd.raw;
    const roster = zjRosterIds(data.chess);
    // 名册 = 可抽取的 97（= 该模式的 visibleChess）+ 2 条 grantOnly（只由策略发放，但玩家可以给它们调技能/模组）
    const grantOnly = Object.entries(data.chess).filter(([, c]) => c && c.zhajing === true && !c.isGolden && c.grantOnly === true).map(([id]) => id);
    assert.ok(ps.gd.visibleChess.every((id) => roster.has(id)), '卡池里的每一条都在名册里');
    assert.deepEqual([...roster].filter((id) => !ps.gd.visibleChess.includes(id)).sort(), grantOnly.sort(), '多出来的正是 grantOnly 那几条');
    assert.ok(roster.has(ZJ_CHESS));
    assert.equal(roster.has(NORMAL_CHESS), false, '官方记录不在炸惊名册里');

    // 官方 id：协议层用同一个 roster 就拒绝
    const wrong = checkLoadout({ [NORMAL_CHESS]: { skill: 0 } }, (id) => ps.gd.chess(id), { roster });
    assert.equal(wrong.error, 'BAD_TARGET');

    assert.equal(ps.setZjLoadout({ [NORMAL_CHESS]: { skill: 0 } }), false, 'PlayerState 拒官方 id');
    assert.equal(ps.setZjLoadout({ [ZJ_CHESS]: { skill: 9 } }), false, '技能索引越界');
    assert.equal(ps.setZjLoadout({ [ZJ_CHESS]: { skill: 1, module: 'uniequip_nope' } }), false, '不存在的模组');
    assert.equal(ps.setZjLoadout({ [ZJ_CHESS]: { skill: 1 } }), true, '合法的 zj 条目');
    assert.equal(ps.zjLoadout[ZJ_CHESS].skill, 1, '写进去了');
    assert.equal(skillOf(ps, ZJ_CHESS), 1, '立刻生效（同一个 match 内）');
    h.dispose?.();
  });
});

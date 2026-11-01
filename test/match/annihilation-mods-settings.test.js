// test/match/annihilation-mods-settings.test.js — 湮灭专属 mod 的「谁打开它」（房间级设置，docs/ANNIHILATION-MODS.md §2.2/§2.3.3）。
//
// 这层的失效方式全是**静默**的：读错口（`rulesOf` 读四项内容开关永远返回官方值）、
// 漏一个 switch case（协议校验通过、服务端丢弃）、把 `annMods` 塞进内容集（`cs` 一变，所有版本房存档/回放失效）。
// 所以断言分四类：① 默认值 = 官方；② 打开后 `rulesOf`/`annMod` 与**对局行为**都跟着变；③ 非湮灭房被拒且不长键；
// ④ 插件内容集仍然最强；⑤ `annMods` 不进 `cs`。
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';

import { getData } from '../../server/data.js';
import { GameData } from '../../server/match/gamedata.js';
import { Match } from '../../server/match/Match.js';
import { VirtualScheduler } from '../../server/match/scheduler.js';
import { startServer } from '../../server/index.js';
import { StubMatch } from '../../server/match/StubMatch.js';
import { TestClient } from '../helpers/wsClient.js';
import { ANNIHILATION_DIFFICULTY } from '../../shared/annihilation-constants.js';
import { RULE_SWITCHES } from '../../shared/plugins/rules.js';

const QUIET = { info() {}, warn() {}, debug() {}, error() {} };
const DATA = getData({ log: QUIET });
const ANN = 'mode_single_annihilation';

const gdWith = (opts = {}, modeId = ANN) => new GameData(DATA, modeId, opts);

/** A real annihilation match carrying the room's switches (the opts path server/lobby.js startMatch uses). */
function annMatch(annMods) {
  return new Match({
    roomCode: 'ANM', mode: 'solo', difficulty: ANNIHILATION_DIFFICULTY, erosion: 1, seed: 'ann-mods', annMods,
    seats: [{ seat: 0, playerId: 'p0', name: 'P0', connected: true }],
    data: DATA, log: QUIET, scheduler: new VirtualScheduler(), send: () => true, broadcast: () => {}, onEnd: () => {},
    clientCombat: false, verify: 'off',
  });
}

describe('湮灭专属 mod · 房间级开关（规则四项 + 内容四项）', () => {
  test('① 缺省 = 官方行为：四项 rule 取 options[0]，四项内容关闭（官方房/炸惊房也一样）', () => {
    const gd = gdWith();
    for (const [name, spec] of Object.entries(RULE_SWITCHES)) {
      assert.equal(gd.rulesOf(name), spec.options[0], `${name} 默认官方`);
    }
    assert.deepEqual({ ...gd.annMods }, {}, '没有开关被显式打开');
    // 业主 2026-10-29：罗德岛 / 卡兹戴尔两条盟约的战斗效果已接，且**默认开启**（缺省 = 开，显式 false 才关）。
    for (const name of ['egirBuff', 'commsPriority']) {
      assert.equal(gd.annMod(name), false, `${name} 默认关`);
    }
    for (const name of ['rhodesShip', 'kazdelShip']) {
      assert.equal(gd.annMod(name), true, `${name} 默认开（业主 2026-10-29）`);
    }
    for (const name of ['egirBuff', 'commsPriority', 'rhodesShip', 'kazdelShip']) {
      assert.equal(gd.rulesOf(name), null, `${name} 不是 RULE_SWITCHES 成员（用 rulesOf 读是空的 —— 这正是 annMod 存在的原因）`);
    }
    // 官方四档 / 炸惊：即便有人塞了 annMods 也不读
    for (const modeId of ['mode_single_normal', 'mode_single_abyss', 'mode_single_zhajing']) {
      const other = gdWith({ annMods: { shopBias: true, egirBuff: true, rhodesShip: true } }, modeId);
      assert.equal(other.rulesOf('shopBias'), 'official', `${modeId}: 房间开关被忽略`);
      assert.equal(other.annMod('egirBuff'), false);
      assert.equal(other.annMod('rhodesShip'), false);
      assert.deepEqual({ ...other.annMods }, {});
    }
  });

  test('② 打开后 rulesOf / annMod 生效，content 开关用 annMod 读、rule 开关走 options[1]', () => {
    const gd = gdWith({ annMods: { shopBias: true, prepLoadout: true, morphPairing: true, unequip: true, egirBuff: true, commsPriority: true, rhodesShip: true, kazdelShip: true } });
    for (const [name, spec] of Object.entries(RULE_SWITCHES)) {
      assert.equal(gd.rulesOf(name), spec.options[1], `${name} = 非官方档`);
    }
    for (const name of ['egirBuff', 'commsPriority', 'rhodesShip', 'kazdelShip']) assert.equal(gd.annMod(name), true, `${name} 开`);
    assert.equal(gd.annMod('comms'), true, 'comms 是 commsPriority 的别名');
    // 只开一个时其余仍是官方
    const one = gdWith({ annMods: { unequip: true } });
    assert.equal(one.rulesOf('unequip'), 'allow');
    assert.equal(one.rulesOf('morphPairing'), 'official');
    assert.equal(one.annMod('egirBuff'), false);
  });

  test('② 端到端：真实湮灭局里 prepLoadout 真的放开了「休整期改技能/模组」，而默认局仍锁着', () => {
    const withMod = annMatch({ prepLoadout: true });
    withMod.start();
    assert.equal(withMod.gd.rulesOf('prepLoadout'), 'prep', 'Match 把房间开关带到了 GameData');
    // 走到 R1 的 PREP（真实调度器 + 假战斗不需要：这里只验规则门，用 test 命令推进）
    const ps = [...withMod.players.values()][0];
    while (withMod.round < 1 || withMod.phase !== 'PREP') {
      if (withMod.ended) break;
      if (!withMod.sched.runNext()) break;
    }
    if (withMod.phase === 'PREP') {
      const r = withMod.setLoadout('p0', {}, undefined, undefined);
      // prepLoadout=prep 时，PREP 阶段（未点准备）允许改——不是 WRONG_PHASE
      assert.notEqual(r.error, 'WRONG_PHASE', `prepLoadout 生效: ${JSON.stringify(r)}`);
    }
    withMod.dispose();
    const plain = annMatch(undefined);
    plain.start();
    assert.equal(plain.gd.rulesOf('prepLoadout'), 'locked', '默认局仍锁');
    plain.dispose();
  });

  test('② 内容开关送进战场 flags（sim 拿不到房间，只能从 flags 读）', () => {
    const off = gdWith({ erosion: 1 });
    assert.equal(Object.hasOwn(off.annihilationFlags('normal', 1), 'annMods'), false, '没有开关时 flags 不长这个键');
    const on = gdWith({ erosion: 1, annMods: { egirBuff: true, kazdelShip: true } });
    assert.deepEqual({ ...on.annihilationFlags('normal', 1).annMods }, { egirBuff: true, kazdelShip: true }, 'flags.annMods 带着内容开关');
    // 非湮灭模式没有 annihilationFlags（null），也就没有这条通道
    assert.equal(gdWith({ annMods: { egirBuff: true } }, 'mode_single_normal').annihilationFlags('normal', 1), null);
  });

  test('③ 普通房与炸惊房：setAnnMods 被拒、room.state 不长 annMods；rulesOf 仍是官方值', async () => {
    const srv = await startServer({ port: 0, host: '127.0.0.1', log: QUIET, MatchClass: StubMatch });
    const join = async (name) => {
      const c = await TestClient.connect(`ws://127.0.0.1:${srv.port}/ws`);
      const w = await c.hello(name);
      c.id = w.playerId;
      return c;
    };
    try {
      for (const difficulty of ['NORMAL', 'ZHAJING']) {
        const c = await join(`NoAnn${difficulty}`);
        try {
          await c.request({ t: 'room.create', mode: 'solo', difficulty });
          const st = await c.waitFor('room.state', (s) => !!s.code, 4000);
          assert.equal(st.annMods, undefined, `${difficulty}: room.state 没有 annMods 键`);
          const r = await c.request({ t: 'room.setAnnMods', annMods: { shopBias: true } });
          assert.equal(r.t, 'error', `${difficulty}: setAnnMods 被拒`);
          assert.equal(r.code, 'BAD_TARGET', JSON.stringify(r));
        } finally { await c.terminate().catch(() => {}); }
      }
      // 湮灭房：同一份消息被接受，状态回显（只含 true 键）
      const c = await join('AnnRoom');
      try {
        await c.request({ t: 'room.create', mode: 'solo', difficulty: ANNIHILATION_DIFFICULTY });
        await c.waitFor('room.state', (s) => !!s.code, 4000);
        const ok = await c.request({ t: 'room.setAnnMods', annMods: { shopBias: true, egirBuff: true, kazdelShip: false } });
        assert.equal(ok.t, 'ok', JSON.stringify(ok));
        const st = await c.waitFor('room.state', (s) => !!s.annMods && s.annMods.shopBias === true, 2000);
        // 回显带**显式**键（true 与 false）：否则「把默认开启的那条关掉」在客户端看不见（业主 2026-10-29）
        assert.deepEqual(st.annMods, { shopBias: true, egirBuff: true, kazdelShip: false }, '显式 true / false 都回显');
        const clear = await c.request({ t: 'room.setAnnMods', annMods: {} });
        assert.equal(clear.t, 'ok');
        const cleared = await c.waitFor('room.state', (s) => !!s.annMods && Object.keys(s.annMods).length === 0, 2000);
        assert.deepEqual(cleared.annMods, {}, '清空 = 全部官方');
      } finally { await c.terminate().catch(() => {}); }
    } finally { await srv.close(); }
  });

  test('④ 插件内容集声明同名开关时插件赢（旧优先级不变）', () => {
    const plugin = gdWith({ annMods: { shopBias: true, unequip: true }, contentRules: { shopBias: 'official' } });
    assert.equal(plugin.rulesOf('shopBias'), 'official', '内容集写 official → 压过房间开关');
    assert.equal(plugin.rulesOf('unequip'), 'allow', '内容集没写的开关，房间开关照常生效');
    const pluginOther = gdWith({ contentRules: { morphPairing: 'plus' } });
    assert.equal(pluginOther.rulesOf('morphPairing'), 'plus', '内容集写 plus → 生效');
    // 非法选项：内容集写错时回落到房间/官方值（fail-safe，不是 undefined）
    const bogus = gdWith({ annMods: { morphPairing: true }, contentRules: { morphPairing: 'nope' } });
    assert.equal(bogus.rulesOf('morphPairing'), 'plus', '无效的内容集选项被忽略，回落到房间开关');
  });

  test('⑤ annMods 不进 cs：同一份内容集，带/不带开关的 cs 相同', async () => {
    const srv = await startServer({ port: 0, host: '127.0.0.1', log: QUIET, MatchClass: StubMatch });
    const join = async (name) => {
      const c = await TestClient.connect(`ws://127.0.0.1:${srv.port}/ws`);
      const w = await c.hello(name);
      c.id = w.playerId;
      return c;
    };
    try {
      const a = await join('CsPlain');
      const b = await join('CsMods');
      try {
        await a.request({ t: 'room.create', mode: 'solo', difficulty: ANNIHILATION_DIFFICULTY });
        const sa = await a.waitFor('room.state', (s) => !!s.code, 4000);
        await b.request({ t: 'room.create', mode: 'solo', difficulty: ANNIHILATION_DIFFICULTY, annMods: { shopBias: true, egirBuff: true, rhodesShip: true } });
        const sb = await b.waitFor('room.state', (s) => !!s.code, 4000);
        assert.deepEqual(sb.annMods, { shopBias: true, egirBuff: true, rhodesShip: true }, '建房时收下了开关');
        assert.equal(sb.content?.cs ?? null, sa.content?.cs ?? null, 'cs 不受 annMods 影响（房间级设置，不是内容集）');
        assert.equal(sb.contentCs ?? null, sa.contentCs ?? null, '内容戳同样不变');
      } finally {
        await a.terminate().catch(() => {});
        await b.terminate().catch(() => {});
      }
    } finally { await srv.close(); }
  });
});

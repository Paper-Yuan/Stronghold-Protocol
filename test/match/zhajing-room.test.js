// test/match/zhajing-room.test.js — 炸惊模拟 (the second play set, 拓展模式) at the platform layer: a room is created
// with `difficulty: 'ZHAJING'`, the lobby keeps it as asked (never lowers it to an official tier), its match runs
// `mode_{single,multi}_zhajing`, and the official four difficulties do not grow a fifth card.
//
// Why a test of its own: every link in this chain fails SILENTLY — a refused difficulty looks like a client bug, a
// lowered difficulty drops the room out of the play set while everything else looks right, and a wrong modeId plays the
// official mode with the 炸惊 data loaded (handoff/ZHAJING-SPLIT-PLAN-2026-10-28.md §2, docs/ZHAJING.md §7).
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';

import { startServer } from '../../server/index.js';
import { StubMatch } from '../../server/match/StubMatch.js';
import { DIFFICULTIES, modeIdFor } from '../../shared/constants.js';
import { ZHAJING_DIFFICULTY, ZHAJING_MODE_IDS } from '../../shared/zhajing-constants.js';
import { TestClient } from '../helpers/wsClient.js';

const log = { info() {}, warn() {}, debug() {}, error() {} };

/** StubMatch that records the options the lobby handed it, so the modeId/difficulty contract is observable. */
class RecordingMatch extends StubMatch {
  constructor(opts) {
    super(opts);
    (RecordingMatch.seen ||= []).push({ mode: opts.mode, difficulty: opts.difficulty, modeId: opts.modeId });
  }
}

describe('炸惊模拟 · 房间到对局（服务端链路）', () => {
  let srv;
  before(async () => { srv = await startServer({ port: 0, host: '127.0.0.1', log, MatchClass: RecordingMatch }); });
  after(async () => { await srv?.close(); });

  const ok = async (c, msg) => { const r = await c.request(msg); assert.equal(r.t, 'ok', JSON.stringify(r)); return r; };
  const err = async (c, msg, code) => {
    const r = await c.request(msg);
    assert.equal(r.t, 'error', JSON.stringify(r));
    assert.equal(r.code, code, JSON.stringify(r));
    return r;
  };
  const join = async (name) => {
    const c = await TestClient.connect(`ws://127.0.0.1:${srv.port}/ws`);
    const w = await c.hello(name);
    c.id = w.playerId;
    return c;
  };

  test('单人房：room.create 收 difficulty ZHAJING，房间保留它、不降档、不带 erosion', async () => {
    const host = await join('ZjHost');
    try {
      await ok(host, { t: 'room.create', mode: 'solo', difficulty: ZHAJING_DIFFICULTY });
      const st = await host.waitFor('room.state', (s) => !!s.code, 4000);
      assert.equal(st.difficulty, ZHAJING_DIFFICULTY, '难度原样保留（降档会静默退出玩法包）');
      assert.equal(st.mode, 'solo');
      assert.equal(Object.hasOwn(st, 'erosion'), false, '炸惊没有蚀流：房间状态不长出 erosion 键');
    } finally { await host.terminate().catch(() => {}); }
  });

  test('同盟房：同样的 difficulty，4 个座位槽保留', async () => {
    const host = await join('ZjCoopHost');
    try {
      await ok(host, { t: 'room.create', mode: 'coop', difficulty: ZHAJING_DIFFICULTY });
      const st = await host.waitFor('room.state', (s) => !!s.code, 4000);
      assert.equal(st.difficulty, ZHAJING_DIFFICULTY);
      assert.equal(st.mode, 'coop');
      assert.ok(st.seats.length >= 4, '同盟房仍是 4 个座位');
    } finally { await host.terminate().catch(() => {}); }
  });

  test('开局用 modeId mode_{single,multi}_zhajing（lobby 的 modeIdFor 推出来，不是官方难度）', async () => {
    // The whole chain from the room to the match is `modeIdFor(room.mode, room.difficulty)` (server/lobby.js), and the
    // mode records behind those two ids are what `GameData` reads for every 炸惊 rule. Assert the mapping here and that
    // the records exist, so a create that reaches the match cannot quietly land on an official mode.
    assert.equal(modeIdFor('solo', ZHAJING_DIFFICULTY), 'mode_single_zhajing');
    assert.equal(modeIdFor('coop', ZHAJING_DIFFICULTY), 'mode_multi_zhajing');
    const { getData } = await import('../../server/data.js');
    const data = getData({ log });
    for (const modeId of ZHAJING_MODE_IDS) {
      const mode = data.config?.modes?.[modeId];
      assert.ok(mode, `${modeId} 必须在 data/config.json 里（玩法包的模式记录）`);
      assert.equal(mode.difficulty, ZHAJING_DIFFICULTY);
      assert.equal(mode.type, modeId.startsWith('mode_single_') ? 'SINGLE' : 'MULTI');
    }
  });

  test('官方四档不受影响：ZHAJING 不在 DIFFICULTIES 里，房间也不能在房内切进切出', async () => {
    assert.equal(DIFFICULTIES.includes(ZHAJING_DIFFICULTY), false, 'DIFFICULTIES 画的是官方四张卡');
    const host = await join('ZjSwitch');
    try {
      await ok(host, { t: 'room.create', mode: 'solo', difficulty: ZHAJING_DIFFICULTY });
      await host.waitFor('room.state', (s) => !!s.code, 4000);
      // room.setDifficulty 只收官方四档：玩法包房不能被房主「调出」玩法包
      await err(host, { t: 'room.setDifficulty', difficulty: ZHAJING_DIFFICULTY }, 'BAD_MSG');
      // 蚀流是湮灭的选项，炸惊房拒绝它（房状态里也没有这个键）
      await err(host, { t: 'room.setErosion', level: 3 }, 'BAD_MSG');
    } finally { await host.terminate().catch(() => {}); }
  });

  test('普通房不会因为协议新增了 ZHAJING 就长出第五张难度卡', async () => {
    const host = await join('ZjNormal');
    try {
      await ok(host, { t: 'room.create', mode: 'solo', difficulty: 'NORMAL' });
      const st = await host.waitFor('room.state', (s) => !!s.code, 4000);
      assert.equal(st.difficulty, 'NORMAL');
      await err(host, { t: 'room.setDifficulty', difficulty: ZHAJING_DIFFICULTY }, 'BAD_MSG');
    } finally { await host.terminate().catch(() => {}); }
  });
});

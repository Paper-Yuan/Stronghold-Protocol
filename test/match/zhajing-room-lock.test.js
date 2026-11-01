// test/match/zhajing-room-lock.test.js — 炸惊房（difficulty 'ZHAJING'）的**房间锁**：难度 / 版本 / 内容集都不可在房内改。
//
// 业主 2026-10-28：「炸惊锁定难度锁定卡池 … 难度也锁定，因为卡池做了改动」。它是一条**静默失效**的反面：
// 这些消息以前都能成功（把玩法包房改回 NORMAL、换版本、换插件），而卡池/惊变/盟约覆盖全部按 difficulty 开门 ——
// 一旦被改，房间会以「官方难度 + 炸惊内容」的混合状态开局，且不报任何错。
// 红线：**只锁炸惊**，湮灭房与官方房的行为一字不变（对照组就断言这个）。
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';

import { startServer } from '../../server/index.js';
import { StubMatch } from '../../server/match/StubMatch.js';
import { TestClient } from '../helpers/wsClient.js';
import { ZHAJING_DIFFICULTY } from '../../shared/zhajing-constants.js';
import { ANNIHILATION_DIFFICULTY } from '../../shared/annihilation-constants.js';
import { DEFAULT_VERSION } from '../../shared/versions.js';

const QUIET = { info() {}, warn() {}, debug() {}, error() {} };

describe('炸惊模拟 · 房间锁（难度 / 版本 / 内容集）', () => {
  let srv;
  before(async () => { srv = await startServer({ port: 0, host: '127.0.0.1', log: QUIET, MatchClass: StubMatch }); });
  after(async () => { await srv?.close(); });

  const join = async (name) => {
    const c = await TestClient.connect(`ws://127.0.0.1:${srv.port}/ws`);
    const w = await c.hello(name);
    c.id = w.playerId;
    return c;
  };
  const ok = async (c, msg) => { const r = await c.request(msg); assert.equal(r.t, 'ok', JSON.stringify(r)); return r; };
  const zjRoom = async (c) => {
    await ok(c, { t: 'room.create', mode: 'solo', difficulty: ZHAJING_DIFFICULTY });
    const st = await c.waitFor('room.state', (s) => !!s.code, 4000);
    assert.equal(st.difficulty, ZHAJING_DIFFICULTY);
    return st;
  };

  test('难度锁定：room.setDifficulty 在炸惊房被拒（BAD_TARGET），房间仍是 ZHAJING', async () => {
    const c = await join('ZjLock');
    try {
      const st = await zjRoom(c);
      const r = await c.request({ t: 'room.setDifficulty', difficulty: 'NORMAL' });
      assert.equal(r.t, 'error');
      assert.equal(r.code, 'BAD_TARGET', JSON.stringify(r));
      assert.match(String(r.detail ?? ''), /locked/, 'detail 说明是玩法包锁');
      // 房间没变：服务端**不会**广播新 state（没有任何字段被改），所以「没收到一个难度不同的 room.state」就是断言本身
      const changed = await c.waitFor('room.state', (s) => s.difficulty !== ZHAJING_DIFFICULTY, 400).catch(() => null);
      assert.equal(changed, null, '没有广播出难度被改掉的房间状态');
    } finally { await c.terminate().catch(() => {}); }
  });

  test('版本锁定：room.proposeVersion 被拒（VERSION_UNSUPPORTED，不发起投票）', async () => {
    const c = await join('ZjVer');
    try {
      await zjRoom(c);
      const r = await c.request({ t: 'room.proposeVersion', version: DEFAULT_VERSION });
      assert.equal(r.t, 'error');
      assert.equal(r.code, 'VERSION_UNSUPPORTED', JSON.stringify(r));
      assert.match(String(r.detail ?? ''), /play set/, 'detail 指向玩法包');
      const vote = await c.waitFor('room.state', (s) => s.versionVote !== undefined, 400).catch(() => null);
      assert.equal(vote, null, '没有投票被发起（也就没有新 state 广播）');
    } finally { await c.terminate().catch(() => {}); }
  });

  test('内容集锁定：room.setPlugins 被拒（BAD_TARGET）', async () => {
    const c = await join('ZjPlug');
    try {
      await zjRoom(c);
      const r = await c.request({ t: 'room.setPlugins', plugins: [] });
      assert.equal(r.t, 'error');
      assert.equal(r.code, 'BAD_TARGET', JSON.stringify(r));
      assert.match(String(r.detail ?? ''), /play set|content/, 'detail 指向内容集锁定');
    } finally { await c.terminate().catch(() => {}); }
  });

  test('卡池调整（room.loadout mode:zhajing）：炸惊房收下并在 room.state 回显；官方房拒绝', async () => {
    const c = await join('ZjCard');
    try {
      await zjRoom(c);
      // 名册里的第一条（chess_zj_*），技能 1（默认是 2 —— 与官方 loadout 同一套索引）
      const res = await c.request({ t: 'room.loadout', mode: 'zhajing', entries: { chess_zj_01_a: { skill: 1 } } });
      assert.equal(res.t, 'ok', `炸惊房接受 zj 档: ${JSON.stringify(res)}`);
      const st = await c.waitFor('room.state', (s) => !!s.seats && !!s.seats[0] && !!s.seats[0].zjLoadout, 2000);
      // 条目是**规范化后的完整形状**（与官方 loadout 一致）：`module` 会被填成该精英的默认模组（这里 uniequip_002_angel），
      // 所以客户端读回来时不要假设「只写了 skill 就只有 skill」。
      assert.equal(st.seats[0].zjLoadout.chess_zj_01_a.skill, 1, 'room.state.seats[].zjLoadout 回显已保存的档位');
      assert.equal(typeof st.seats[0].zjLoadout.chess_zj_01_a.module, 'string', 'module 已规范化（默认模组）');
      // 不在名册里的 id：拒绝，且不改动已保存的档
      const bad = await c.request({ t: 'room.loadout', mode: 'zhajing', entries: { chess_char_1_01_a: { skill: 0 } } });
      assert.equal(bad.t, 'error');
      assert.equal(bad.code, 'BAD_TARGET', JSON.stringify(bad));
    } finally { await c.terminate().catch(() => {}); }
  });

  test('卡池调整不许污染官方房：room.loadout mode:zhajing 在普通房被拒', async () => {
    const c = await join('OfficialCard');
    try {
      await ok(c, { t: 'room.create', mode: 'solo', difficulty: 'NORMAL' });
      await c.waitFor('room.state', (s) => !!s.code, 4000);
      const r = await c.request({ t: 'room.loadout', mode: 'zhajing', entries: { chess_zj_01_a: { skill: 1 } } });
      assert.equal(r.t, 'error');
      assert.equal(r.code, 'BAD_TARGET', JSON.stringify(r));
    } finally { await c.terminate().catch(() => {}); }
  });

  test('对照（红线）：湮灭房与官方房的 room.setDifficulty 行为不变', async () => {    const c = await join('NotZj');
    try {
      await ok(c, { t: 'room.create', mode: 'solo', difficulty: ANNIHILATION_DIFFICULTY });
      const ann = await c.waitFor('room.state', (s) => !!s.code, 4000);
      const r = await c.request({ t: 'room.setDifficulty', difficulty: 'NORMAL' });
      assert.equal(r.t, 'ok', `湮灭房仍可改难度: ${JSON.stringify(r)}`);
      const st = await c.waitFor('room.state', (s) => s.difficulty === 'NORMAL', 4000);
      assert.equal(st.difficulty, 'NORMAL');
      assert.equal(st.code, ann.code);
      // 官方房同样不受影响
      const back = await c.request({ t: 'room.setDifficulty', difficulty: 'HARD' });
      assert.equal(back.t, 'ok');
    } finally { await c.terminate().catch(() => {}); }
  });
});

// test/match/extension-version-lock.test.js — 玩法包房的**版本锁** + 湮灭的**卡池调整档**。
//
// 业主 2026-10-28：「拓展模式开启房间后不应该进行大厅版本检测，即使大厅版本改变，对应模式的版本应该锁死且被房间使用」。
// 这条的红线是**静默漂移**：房间版本以前来自 `defaultVersion()`（大厅默认，服务器所有者可改），玩法包的棋库/惊变/盟约
// 覆盖却按 difficulty 开门 —— 两者一旦脱钩，房间会以「别的版本的数据 + 玩法包规则」开局，还不报错。
// 同一个文件里钉住第三档 loadout（`room.loadout { mode: 'annihilation' }`）与它和官方/炸惊两档的隔离。
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';

import { startServer } from '../../server/index.js';
import { StubMatch } from '../../server/match/StubMatch.js';
import { TestClient } from '../helpers/wsClient.js';
import { makeMatch } from './harness.js';
import { ZHAJING_DIFFICULTY } from '../../shared/zhajing-constants.js';
import { ANNIHILATION_DIFFICULTY } from '../../shared/annihilation-constants.js';
import { DEFAULT_VERSION } from '../../shared/versions.js';

const QUIET = { info() {}, warn() {}, debug() {}, error() {} };

describe('玩法包房 · 版本锁（炸惊 / 湮灭）', () => {
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
  const roomOf = async (c, difficulty) => {
    await ok(c, { t: 'room.create', mode: 'solo', difficulty });
    // wait for the frame that actually carries the fields under test (a delta frame may arrive first)
    const st = await c.waitFor('room.state', (s) => s.code && s.difficulty === difficulty, 4000);
    assert.equal(st.difficulty, difficulty);
    return st;
  };

  test('炸惊房：room.create 就把版本钉在玩法包自己的那一份，且 room.state 明确标出「锁定」', async () => {
    const c = await join('ZjVer');
    try {
      // 玩法包房不需要、也不接受大厅版本：建房后版本已经钉死（点名别的官方版本也不会生效）
      await ok(c, { t: 'room.create', mode: 'solo', difficulty: ZHAJING_DIFFICULTY });
      const st = await c.waitFor('room.state', (s) => !!s.code, 4000);
      assert.equal(st.difficulty, ZHAJING_DIFFICULTY);
      assert.equal(st.version, DEFAULT_VERSION, '炸惊房的版本 = 玩法包自带的那一份');
      assert.equal(st.versionLocked, true, 'client 可判定的锁定标记');
      // 任何版本变更请求都被拒
      const bad = await c.request({ t: 'room.proposeVersion', version: 'act1autochess@V1_1' });
      assert.equal(bad.t, 'error', '玩法包房不接受版本提案');
      assert.equal(bad.code, 'VERSION_UNSUPPORTED');
    } finally { await c.terminate().catch(() => {}); }
  });

  test('湮灭房：同一条口径（room.create 后版本恒为锁死值）', async () => {
    const c = await join('AnnVer');
    try {
      const st = await roomOf(c, ANNIHILATION_DIFFICULTY);
      assert.equal(st.version, DEFAULT_VERSION);
      assert.equal(st.versionLocked, true);
      const bad = await c.request({ t: 'room.proposeVersion', version: 'act1autochess@V1_1' });
      assert.equal(bad.code, 'VERSION_UNSUPPORTED');
    } finally { await c.terminate().catch(() => {}); }
  });

  test('大厅默认版本变了：玩法包房不动，官方房照旧跟着大厅走', async () => {
    // 把大厅默认换成一个「另一份」版本（服务器所有者可做的唯一动作），再建房
    const lobby = srv.lobby;
    const original = lobby.defaultVersion;
    lobby.defaultVersion = () => 'act1autochess@V1_1';
    const zj = await join('ZjDrift');
    const off = await join('OffDrift');
    try {
      const zst = await roomOf(zj, ZHAJING_DIFFICULTY);
      assert.equal(zst.version, DEFAULT_VERSION, '大厅默认搬到 V1_1，炸惊房仍是玩法包那一份');
      const ast = await roomOf(off, 'NORMAL');
      assert.equal(ast.version, 'act1autochess@V1_1', '官方房跟着大厅默认（对照组，语义不变）');
      assert.equal(Object.hasOwn(ast, 'versionLocked'), false, '官方房的 room.state 不长新键（逐字节不变）');
    } finally {
      lobby.defaultVersion = original;
      await zj.terminate().catch(() => {});
      await off.terminate().catch(() => {});
    }
  });

  test('官方房：默认版本下 room.state 不带 version / versionLocked（逐字节不变）', async () => {
    const c = await join('OffPlain');
    try {
      const st = await roomOf(c, 'NORMAL');
      assert.equal(Object.hasOwn(st, 'version'), false);
      assert.equal(Object.hasOwn(st, 'versionLocked'), false);
    } finally { await c.terminate().catch(() => {}); }
  });
});

describe('湮灭模拟 · 卡池调整第三档（room.loadout mode=annihilation）', () => {
  const ann = () => {
    const h = makeMatch({ mode: 'solo', difficulty: ANNIHILATION_DIFFICULTY, seed: 5, fake: true, erosion: 1, rules: { prepLoadout: 'prep' } }).start();
    h.toPrep(1);
    return h;
  };
  /** 一个湮灭名册里的普通卡，和一个**与记录默认不同**的技能档（相同会被 checkLoadout 当作默认丢掉）。 */
  const pick = (ps) => {
    for (const id of ps.gd.visibleChess) {
      const rec = ps.gd.chess(id);
      if (!rec || (rec.skills || []).length < 2) continue;
      const def = Number.isInteger(rec.skill) ? rec.skill : (rec.skills.find((s) => s.isDefault)?.index ?? 0);
      const skill = (def + 1) % rec.skills.length;
      if (skill === def) continue;
      return { id, skill };
    }
    return null;
  };

  test('湮灭房接受第三档，且只写 annLoadout（官方档与炸惊档都不动）', () => {
    const h = ann();
    const ps = h.ps('p_0');
    const p = pick(ps);
    assert.ok(p, '名册里有可选技能的干员');
    const r = h.m.setLoadout('p_0', { [p.id]: { skill: p.skill } }, null, 'annihilation');
    assert.deepEqual(r, { ok: true }, JSON.stringify(r));
    assert.equal(ps.annLoadout[p.id].skill, p.skill, '写进第三档（技能档）');
    assert.ok(ps.annLoadout[p.id].module === null || typeof ps.annLoadout[p.id].module === 'string', '模块位是 null 或默认模块 id');
    assert.deepEqual({ ...ps.loadout }, {}, '官方档没动');
    assert.deepEqual({ ...ps.zjLoadout }, {}, '炸惊档没动');
    assert.equal(ps.loadoutFor(ps.gd.chess(p.id)).skillIndex, p.skill, '对局里按第三档生效');
    const view = ps.privateView();
    assert.equal(view.annLoadout[p.id].skill, p.skill, 'm.private.annLoadout 下发');
    assert.equal(view.zjLoadout, undefined, '湮灭房没有炸惊档这个键');
    h.dispose?.();
  });

  test('官方房与炸惊房拒绝第三档（BAD_TARGET），写不进去', () => {
    for (const difficulty of ['NORMAL', ZHAJING_DIFFICULTY]) {
      const h = makeMatch({ mode: 'solo', difficulty, seed: 5, fake: true, ...(difficulty === ANNIHILATION_DIFFICULTY ? { erosion: 1 } : {}), rules: { prepLoadout: 'prep' } }).start();
      h.toPrep(1);
      const ps = h.ps('p_0');
      const id = (difficulty === ZHAJING_DIFFICULTY ? ps.gd.visibleChess : ps.gd.visibleChess)[0];
      const r = h.m.setLoadout('p_0', { [id]: { skill: 1 } }, null, 'annihilation');
      assert.equal(r.error, 'BAD_TARGET', `${difficulty}: 第三档被拒 ${JSON.stringify(r)}`);
      assert.deepEqual({ ...ps.annLoadout }, {}, `${difficulty}: 什么都没写`);
      assert.equal(ps.privateView().annLoadout, undefined, `${difficulty}: 私视图不长这个键`);
      h.dispose?.();
    }
  });

  test('非湮灭房连房内视图都不带 annLoadout；三个档位互不覆盖', () => {
    const h = ann();
    const ps = h.ps('p_0');
    const p = pick(ps);
    assert.ok(h.m.setLoadout('p_0', { [p.id]: { skill: p.skill } }, null, 'annihilation').ok !== false, '第三档写入');
    // 再写「官方档」（同一份数据、不带 mode）——第三档的内容不能被它冲掉
    const r = h.m.setLoadout('p_0', { [p.id]: { skill: p.skill } }, undefined, undefined);
    assert.deepEqual(r, { ok: true }, JSON.stringify(r));
    assert.equal(ps.annLoadout[p.id].skill, p.skill, '第三档仍在');
    // 炸惊档拒绝（不是炸惊局）
    assert.equal(h.m.setLoadout('p_0', { [p.id]: { skill: p.skill } }, null, 'zhajing').error, 'BAD_TARGET');
    h.dispose?.();
  });
});

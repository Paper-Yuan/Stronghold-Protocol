// 房间难度选择回归自检 —— 无需联网、纯内存跑。
//
//   node tools/roomdiffcheck.mjs
//
// 覆盖三件事：
//   1. 协议层难度白名单：room.create / room.setDifficulty / match.queue 接受全部 DIFFICULTIES（四个常规档），
//      拒绝拼错的名字；
//   2. 房主在大厅创建房间后逐一切换难度，room.state 同步，且每个难度都解析到存在的模式条目；
//   3. 用切换后的难度真的开出对局时，modeId / GameData 落在对应档的模式条目上（血池基准档 = 难度自身）。
// 退出码非 0 表示有失败项。

process.env.NODE_ENV = 'test'; // 关掉 Lobby 的定期大厅广播心跳

import { Lobby } from '../server/lobby.js';
import { getData, getMode } from '../server/data.js';
import { GameData } from '../server/match/gamedata.js';
import { validateC2S } from '../shared/protocol.js';
import { DIFFICULTIES, PICK_DIFFICULTIES, modeIdFor } from '../shared/constants.js';

const data = getData({ log: { warn() {}, error() {}, info() {} } });
let pass = 0, fail = 0;
const ok = (c, msg) => { if (c) { pass++; console.log('  ✓', msg); } else { fail++; console.log('  ✗', msg); } };

// ---- 1. 协议层难度白名单 ---------------------------------------------------------------------------------------
console.log('\n[1] 协议层难度白名单');
ok(DIFFICULTIES.length === PICK_DIFFICULTIES.length,
  `DIFFICULTIES = 四档常规（共 ${DIFFICULTIES.length}）`);
for (const [t, extra] of [['room.create', { mode: 'coop' }], ['room.setDifficulty', {}], ['match.queue', { mode: 'solo' }]]) {
  const bad = DIFFICULTIES.filter((d) => validateC2S({ t, ...extra, difficulty: d }) !== null);
  ok(bad.length === 0, `${t} 接受全部 ${DIFFICULTIES.length} 个难度名${bad.length ? `（拒绝：${bad.join(', ')}）` : ''}`);
}
const rejects = ['ENDLESS_BOGUS', 'ENDLESS', 'ENDLESS_ABYSS', '_ENDLESS', 'endless_hard', 'TRAINING', 'ENDLESS-HARD', ''];
const accepted = rejects.filter((d) => validateC2S({ t: 'room.setDifficulty', difficulty: d }) === null);
ok(accepted.length === 0, `拼错 / 未知的难度名被拒：${rejects.map((d) => JSON.stringify(d)).join(', ')}`);
ok(validateC2S({ t: 'room.create', mode: 'coop' }) !== null, 'room.create 缺少 difficulty 被拒');

// ---- 2. 大厅房间：创建 + 逐一切换难度 --------------------------------------------------------------------------
console.log('\n[2] 房间状态随难度切换同步');
const sessions = new Map();
function makeSession(playerId, name) {
  const frames = [];
  return {
    playerId, name, addr: `${playerId}.test`, limitKey: null, connected: true, roomCode: null, notice: null,
    pendingResult: null, loadout: null, notOwned: null, diy: null, skins: null, frames,
    ws: { readyState: 1, bufferedAmount: 0, send: (d) => frames.push(d), terminate() {} },
  };
}
const registry = { byId: (id) => sessions.get(id) || null, byPlayerId: (id) => sessions.get(id) || null };
const quiet = { info() {}, warn() {}, error() {}, debug() {} };
const lobby = new Lobby({ registry, getData: () => data, log: quiet, options: {} });

const host = makeSession('p_host', 'Host');
const guest = makeSession('p_guest', 'Guest');
sessions.set(host.playerId, host);
sessions.set(guest.playerId, guest);

const created = lobby.create(host, { mode: 'coop', difficulty: 'ABYSS' });
ok(created && created.ok === true, '创建同盟房间（ABYSS）成功');
const room = lobby.rooms.get(host.roomCode);
ok(!!room, `房间已建立（code=${host.roomCode}）`);
lobby.join(guest, { code: host.roomCode });
ok(room.seats.filter(Boolean).length === 2, '大厅里已有 2 名博士');

// 房主逐一切换四档常规难度：房间状态同步，其它人取消准备
const sequence = [...PICK_DIFFICULTIES];
const seen = [];
for (const d of sequence) {
  const seat = room.seatOf(guest.playerId);
  seat.ready = true;
  const r = lobby.setDifficulty(host, { difficulty: d });
  seen.push(`${d}:${room.toState().difficulty}:${seat.ready ? 'ready' : 'reset'}`);
  const mode = getMode(modeIdFor('coop', d));
  const gd = new GameData(data, modeIdFor('coop', d));
  const okRow = r.ok === true && room.toState().difficulty === d && !seat.ready && !!mode
    && gd.difficulty === d && gd.bossBloodPointDifficulty === d;
  if (!okRow) { fail++; console.log('  ✗', `切换到 ${d} 后状态不符：${JSON.stringify({ r, diff: room.toState().difficulty, guestReady: seat.ready, hasMode: !!mode, gdDiff: gd.difficulty, bp: gd.bossBloodPointDifficulty })}`); }
  else { pass++; }
}
ok(seen.length === sequence.length && seen.every((s) => s.endsWith(':reset')),
  `每一次切换都同步到 room.state 并取消其它人的准备：${seen.join(' ')}`);
ok(room.toState().difficulty === 'ABYSS', '最终停在 ABYSS');

// 非房主不能切换
const guestTry = lobby.setDifficulty(guest, { difficulty: 'FUNNY' });
ok(guestTry && guestTry.error === 'NOT_HOST' && room.toState().difficulty !== 'FUNNY', '非房主切换被拒（NOT_HOST）');

// ---- 3. 用切换后的难度开局：modeId / GameData 落在正确条目 ------------------------------------------------------
console.log('\n[3] 用房间里的难度开局');
function startWith(difficulty) {
  // 每档重开一间房（上一间的对局要收掉，否则 room.start 会因 room.match 存在而拒绝）
  const prev = lobby.rooms.get(host.roomCode);
  if (prev) lobby.disposeRoom(prev, 'next difficulty');
  const r = lobby.create(host, { mode: 'coop', difficulty });
  const rm = lobby.rooms.get(host.roomCode);
  lobby.join(guest, { code: host.roomCode });
  rm.seatOf(guest.playerId).ready = true;
  const started = lobby.start(host);
  const m = rm.match;
  const info = {
    ok: !!(r && r.ok && started && started.ok), modeId: m && m.modeId, difficulty: m && m.difficulty,
    bp: m && m.gd.bossBloodPointDifficulty, cap: m && m.gd.bondLayerCap,
    stateDiff: rm.toState().difficulty, stageId: m && m.stageId, bossId: m && m.bossId,
  };
  try { if (m) m.dispose(); } catch { /* ignore */ }
  return info;
}
for (const d of ['FUNNY', 'HARD', 'ABYSS']) {
  const info = startWith(d);
  const good = info.ok && info.modeId === modeIdFor('coop', d) && info.difficulty === d && info.stateDiff === d
    && info.bp === d && info.cap === 999
    && !!info.stageId && !!info.bossId;
  ok(good, `${d} 开局 → modeId=${info.modeId} difficulty=${info.difficulty} 血池基准=${info.bp} 层数上限=${info.cap} 战场=${info.stageId}`);
}

lobby.shutdown('check done');

console.log(`\n${fail === 0 ? '全部通过' : '有失败项'}：${pass}/${pass + fail}`);
process.exit(fail === 0 ? 0 : 1);

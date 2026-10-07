// server/matchmaking.js — 排队撮合与自动补位引擎 (Matchmaking Queue Engine)
//
// 职责：
//   1. 维护大厅散人快速匹配队列 (queue = Map<playerId, QueueEntry>)
//   2. 维护同盟房间补人撮合队列 (roomQueue = Map<roomCode, RoomQueueEntry>)
//   3. 按 (mode, difficulty) 分桶进行撮合
//   4. 优先补齐房间：若有房间正处于 matching 状态，优先将匹配池中的散人博士填入房间空位
//   5. 散人组队：凑齐 4 人立即创建新同盟房间
//   6. 超时补位：排队超时（默认 10 秒）且允许 fillBots，自动按已有玩家建房或将房间剩余空位填充 AI 队友并自动开启对局
//   7. 状态同步：下发 match.status / match.found，更新 room.state.matching

import { randomBytes } from 'node:crypto';
import { MAX_SEATS } from '../shared/constants.js';
import { sendSession } from './net.js';

const MATCHMAKING_DEFAULTS = Object.freeze({
  tickIntervalMs: 1000,
  timeoutMs: 10_000, // 10 秒超时自动补 AI 或发车
  targetPlayers: MAX_SEATS, // 4 人同盟
});

export class Matchmaker {
  /**
   * @param {import('./lobby.js').Lobby} lobby
   * @param {object} [opts]
   */
  constructor(lobby, opts = {}) {
    this.lobby = lobby;
    this.opts = { ...MATCHMAKING_DEFAULTS, ...opts };
    /** @type {Map<string, { session: any, mode: string, difficulty: string, fillBots: boolean, joinedAt: number }>} */
    this.queue = new Map();
    /** @type {Map<string, { room: any, queueId: string, startedAt: number, deadlineAt: number, fillBots: boolean }>} */
    this.roomQueue = new Map();
    this.timer = null;
    this.running = false;
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.timer = setInterval(() => this.tick(), this.opts.tickIntervalMs);
    this.timer.unref?.();
  }

  stop() {
    this.running = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.queue.clear();
    this.roomQueue.clear();
  }

  /**
   * 散人排队（大厅快速匹配）或房主代全队排队
   * @param {any} session
   * @param {{ mode?: string, difficulty?: string, fillBots?: boolean }} msg
   */
  enqueue(session, { mode = 'coop', difficulty = 'FUNNY', fillBots = true } = {}) {
    const curRoom = this.lobby.roomOf(session);
    if (curRoom && curRoom.match) {
      return { error: 'ROOM_STARTED', detail: 'leave your running match first' };
    }

    // 场景 A：房主在房间内点击「匹配队友」
    if (curRoom) {
      if (curRoom.hostId !== session.playerId) {
        return { error: 'NOT_HOST', detail: 'only host can queue for party' };
      }
      if (curRoom.mode === 'solo') {
        return { error: 'ROOM_FULL', detail: 'solo room cannot queue party' };
      }
      const now = this.lobby.now();
      const queueId = 'q_' + randomBytes(4).toString('hex');
      const entry = {
        room: curRoom,
        queueId,
        startedAt: now,
        deadlineAt: now + this.opts.timeoutMs,
        fillBots: fillBots !== false,
      };
      this.roomQueue.set(curRoom.code, entry);
      curRoom.matching = {
        queueId,
        startedAt: now,
        deadlineAt: entry.deadlineAt,
        fillBots: entry.fillBots,
      };
      this.start();
      this.lobby.broadcastState(curRoom);
      this.tick();
      return { ok: true };
    }

    // 场景 B：大厅无房散人快速匹配
    const entry = {
      session,
      mode: mode === 'solo' ? 'solo' : 'coop',
      difficulty: String(difficulty),
      fillBots: fillBots !== false,
      joinedAt: this.lobby.now(),
    };

    this.queue.set(session.playerId, entry);
    this.start();

    // 立即下发一次状态
    this.sendStatus(entry);

    // 立即就地撮合
    this.tick();

    return { ok: true };
  }

  /**
   * 玩家退出排队（散人退队或房主取消房间匹配）
   * @param {any} session
   */
  dequeue(session) {
    const curRoom = this.lobby.roomOf(session);
    if (curRoom && this.roomQueue.has(curRoom.code)) {
      if (curRoom.hostId !== session.playerId) {
        return { error: 'NOT_HOST' };
      }
      this.cancelRoomQueue(curRoom);
      return { ok: true };
    }

    if (!this.queue.has(session.playerId)) {
      return { error: 'NOT_IN_QUEUE' };
    }
    this.queue.delete(session.playerId);
    sendSession(session, {
      t: 'match.status',
      status: 'idle',
      mode: null,
      difficulty: null,
      elapsed: 0,
      matched: 0,
      target: this.opts.targetPlayers,
    });
    return { ok: true };
  }

  /**
   * 取消房间的匹配状态
   * @param {any} room
   */
  cancelRoomQueue(room) {
    if (!room) return;
    this.roomQueue.delete(room.code);
    room.matching = null;
    this.lobby.broadcastState(room);
  }

  /**
   * 清理玩家
   * @param {string} playerId
   */
  removePlayer(playerId) {
    this.queue.delete(playerId);
  }

  /**
   * 清空所有排队队列（用于停机维护等场景）
   * @param {string} [reason]
   */
  clearQueue(reason = 'maintenance') {
    for (const entry of this.queue.values()) {
      if (entry.session && entry.session.connected) {
        sendSession(entry.session, { t: 'match.status', status: 'idle', reason });
      }
    }
    this.queue.clear();
    for (const code of [...this.roomQueue.keys()]) {
      const room = this.lobby.getRoom(code);
      this.cancelRoomQueue(room);
    }
  }

  /**
   * 发送当前排队状态给指定玩家
   */
  sendStatus(entry, matchedCount = 1) {
    if (!entry.session || !entry.session.connected) return;
    const now = this.lobby.now();
    const elapsed = Math.max(0, Math.floor((now - entry.joinedAt) / 1000));
    sendSession(entry.session, {
      t: 'match.status',
      status: 'searching',
      mode: entry.mode,
      difficulty: entry.difficulty,
      elapsed,
      matched: matchedCount,
      target: entry.mode === 'solo' ? 1 : this.opts.targetPlayers,
    });
  }

  /**
   * 撮合核心调度循环
   */
  tick() {
    const now = this.lobby.now();

    // 1. 清理散人队列中无效的 session
    for (const [pid, entry] of [...this.queue.entries()]) {
      if (!entry.session || !entry.session.connected || this.lobby.registry.byId(pid) !== entry.session) {
        this.queue.delete(pid);
      }
    }

    // 2. 清理房间队列中已销毁或对局已开的 room
    for (const [code, rEntry] of [...this.roomQueue.entries()]) {
      const room = rEntry.room;
      if (!room || room.disposed || room.match || room.code !== code) {
        this.roomQueue.delete(code);
        continue;
      }
      // 如果房间已经满了（4 人都齐了），自动退出排队
      if (room.freeSeat() < 0) {
        this.cancelRoomQueue(room);
      }
    }

    // 3. 优先匹配：将散人填入正在匹配的同盟房间
    for (const [code, rEntry] of [...this.roomQueue.entries()]) {
      const room = rEntry.room;
      const targetDiff = room.difficulty;
      const targetMode = room.mode;

      // 寻找相符难度的散人
      for (const [pid, entry] of [...this.queue.entries()]) {
        if (room.freeSeat() < 0) break;
        if (entry.mode === targetMode && entry.difficulty === targetDiff) {
          this.queue.delete(pid);
          // 加入房间
          this.lobby.join(entry.session, { code: room.code });
          sendSession(entry.session, {
            t: 'match.found',
            roomCode: room.code,
            mode: room.mode,
            difficulty: room.difficulty,
            humans: room.activeHumans().length,
          });
        }
      }

      // 检查房间是否满员
      if (room.freeSeat() < 0) {
        this.cancelRoomQueue(room);
        continue;
      }

      // 检查房间匹配超时自动补 AI 发车
      if (now >= rEntry.deadlineAt) {
        if (rEntry.fillBots) {
          const hostSession = this.lobby.registry.byId(room.hostId);
          if (hostSession) {
            while (room.freeSeat() >= 0) {
              const botRes = this.lobby.addBot(hostSession);
              if (!botRes || botRes.error) break;
            }
          }
        }
        this.cancelRoomQueue(room);
      }
    }

    // 4. 散人撮合分桶: key = `${mode}:${difficulty}`
    if (this.queue.size === 0) return;

    const buckets = new Map();
    for (const [pid, entry] of this.queue.entries()) {
      const key = `${entry.mode}:${entry.difficulty}`;
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key).push(entry);
    }

    for (const [key, entries] of buckets.entries()) {
      // 4.1 独立模拟 (solo): 1 人直接发车
      if (key.startsWith('solo:')) {
        for (const soloEntry of entries) {
          this.queue.delete(soloEntry.session.playerId);
          this.formRoom([soloEntry], soloEntry.mode, soloEntry.difficulty, false);
        }
        continue;
      }

      // 4.2 满员发车 (4 人)
      while (entries.length >= this.opts.targetPlayers) {
        const matched = entries.splice(0, this.opts.targetPlayers);
        for (const m of matched) this.queue.delete(m.session.playerId);
        this.formRoom(matched, matched[0].mode, matched[0].difficulty, false);
      }

      if (entries.length === 0) continue;

      // 4.3 散人超时补 AI 发车
      const oldest = entries.reduce((prev, curr) => (curr.joinedAt < prev.joinedAt ? curr : prev), entries[0]);
      const waitTime = now - oldest.joinedAt;

      if (waitTime >= this.opts.timeoutMs && entries.some(e => e.fillBots)) {
        const matched = entries.splice(0, this.opts.targetPlayers);
        for (const m of matched) this.queue.delete(m.session.playerId);
        this.formRoom(matched, matched[0].mode, matched[0].difficulty, true);
        continue;
      }

      // 4.4 广播散人排队进度
      for (const entry of entries) {
        this.sendStatus(entry, entries.length);
      }
    }
  }

  /**
   * 将散人玩家打包成房间发车
   * @param {Array<{ session: any }>} matched
   * @param {string} mode
   * @param {string} difficulty
   * @param {boolean} fillBotsWithAi
   */
  formRoom(matched, mode, difficulty, fillBotsWithAi) {
    if (!matched || matched.length === 0) return;

    const hostEntry = matched[0];
    const hostSession = hostEntry.session;

    const createRes = this.lobby.create(hostSession, { mode, difficulty });
    if (!createRes || createRes.error) {
      this.lobby.log.error('[matchmaker] failed to create room for match', createRes);
      return;
    }

    const room = this.lobby.roomOf(hostSession);
    if (!room) return;

    for (let i = 1; i < matched.length; i++) {
      const guestSession = matched[i].session;
      this.lobby.join(guestSession, { code: room.code });
    }

    if (fillBotsWithAi && room.mode === 'coop') {
      while (room.freeSeat() >= 0) {
        const botRes = this.lobby.addBot(hostSession);
        if (!botRes || botRes.error) break;
      }
    }

    for (const m of matched) {
      sendSession(m.session, {
        t: 'match.found',
        roomCode: room.code,
        mode: room.mode,
        difficulty: room.difficulty,
        humans: matched.length,
      });
    }

    this.lobby.broadcastState(room);
  }
}

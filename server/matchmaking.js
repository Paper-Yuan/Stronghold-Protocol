// server/matchmaking.js — 排队撮合与自动补位引擎 (Matchmaking Queue Engine)
//
// 职责：
//   1. 维护在线玩家快速匹配队列 (queue = Map<playerId, QueueEntry>)
//   2. 按 (mode, difficulty) 分桶进行撮合
//   3. 满员发车：累计达到 4 人立即创建同盟房间并拉入
//   4. 超时补位：排队超时（默认 10 秒）且允许 fillBots，自动按已有玩家建房并填充 AI 队友至 4 人发车
//   5. 状态同步：定期向排队玩家推送 match.status，匹配成功推送 match.found 并无缝转入 room.state

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
  }

  /**
   * 玩家入队排队
   * @param {any} session
   * @param {{ mode?: string, difficulty?: string, fillBots?: boolean }} msg
   */
  enqueue(session, { mode = 'coop', difficulty = 'FUNNY', fillBots = true } = {}) {
    // 若已在对局房间中，不可排队
    const curRoom = this.lobby.roomOf(session);
    if (curRoom && curRoom.match) {
      return { error: 'ROOM_STARTED', detail: 'leave your running match first' };
    }
    // 若在普通大厅房间中，先退出当前房间
    if (curRoom) {
      this.lobby.removeMember(curRoom, session.playerId);
    }

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

    // 立即做一次就地检查（如果是 solo 或者立刻满员）
    this.tick();

    return { ok: true };
  }

  /**
   * 玩家退出排队
   * @param {any} session
   */
  dequeue(session) {
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
   * 清理断线玩家
   * @param {string} playerId
   */
  removePlayer(playerId) {
    this.queue.delete(playerId);
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
    if (this.queue.size === 0) return;

    const now = this.lobby.now();

    // 1. 清理无效/断开的 session
    for (const [pid, entry] of [...this.queue.entries()]) {
      if (!entry.session || !entry.session.connected || this.lobby.registry.byId(pid) !== entry.session) {
        this.queue.delete(pid);
      }
    }

    // 2. 按桶聚类: key = `${mode}:${difficulty}`
    const buckets = new Map();
    for (const [pid, entry] of this.queue.entries()) {
      const key = `${entry.mode}:${entry.difficulty}`;
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key).push(entry);
    }

    // 3. 对每个桶执行撮合逻辑
    for (const [key, entries] of buckets.entries()) {
      // 3.1 独立模拟 (solo): 1 人直接发车
      if (key.startsWith('solo:')) {
        for (const soloEntry of entries) {
          this.queue.delete(soloEntry.session.playerId);
          this.formRoom([soloEntry], soloEntry.mode, soloEntry.difficulty, false);
        }
        continue;
      }

      // 3.2 满员发车 (4 人)
      while (entries.length >= this.opts.targetPlayers) {
        const matched = entries.splice(0, this.opts.targetPlayers);
        for (const m of matched) this.queue.delete(m.session.playerId);
        this.formRoom(matched, matched[0].mode, matched[0].difficulty, false);
      }

      if (entries.length === 0) continue;

      // 3.3 检查超时与补位
      // 查找该桶内最早入队的玩家
      const oldest = entries.reduce((prev, curr) => (curr.joinedAt < prev.joinedAt ? curr : prev), entries[0]);
      const waitTime = now - oldest.joinedAt;

      // 若超时且允许补 AI (或者同桶有允许补 AI 的玩家等待超时)
      if (waitTime >= this.opts.timeoutMs && entries.some(e => e.fillBots)) {
        // 取出当前桶内所有玩家（最多 4 人）
        const matched = entries.splice(0, this.opts.targetPlayers);
        for (const m of matched) this.queue.delete(m.session.playerId);
        this.formRoom(matched, matched[0].mode, matched[0].difficulty, true);
        continue;
      }

      // 3.4 广播同步当前排队状态
      for (const entry of entries) {
        this.sendStatus(entry, entries.length);
      }
    }
  }

  /**
   * 将玩家打包成房间发车
   * @param {Array<{ session: any }>} matched
   * @param {string} mode
   * @param {string} difficulty
   * @param {boolean} fillBotsWithAi
   */
  formRoom(matched, mode, difficulty, fillBotsWithAi) {
    if (!matched || matched.length === 0) return;

    // 房主选等待最久的（第一位）
    const hostEntry = matched[0];
    const hostSession = hostEntry.session;

    // 1. 房主创建房间
    const createRes = this.lobby.create(hostSession, { mode, difficulty });
    if (!createRes || createRes.error) {
      this.lobby.log.error('[matchmaker] failed to create room for match', createRes);
      return;
    }

    const room = this.lobby.roomOf(hostSession);
    if (!room) return;

    // 2. 其余玩家依次加入房间
    for (let i = 1; i < matched.length; i++) {
      const guestSession = matched[i].session;
      this.lobby.join(guestSession, { code: room.code });
    }

    // 3. 如果需要且有空位，填补 AI 队友
    if (fillBotsWithAi && room.mode === 'coop') {
      while (room.freeSeat() >= 0) {
        const botRes = this.lobby.addBot(hostSession);
        if (!botRes || botRes.error) break;
      }
    }

    // 4. 通知各成员 match.found
    for (const m of matched) {
      sendSession(m.session, {
        t: 'match.found',
        roomCode: room.code,
        mode: room.mode,
        difficulty: room.difficulty,
        humans: matched.length,
      });
    }

    // 5. 广播最新的 room.state
    this.lobby.broadcastState(room);
  }
}

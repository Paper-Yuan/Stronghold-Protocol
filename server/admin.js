// server/admin.js — Web Admin & Live Monitoring Module for Stronghold Protocol
import os from 'node:os';
import crypto from 'node:crypto';
import { PROTOCOL_VERSION, APP_VERSION } from '../shared/constants.js';

// Circular log buffer for live console streaming
const MAX_LOG_ENTRIES = 300;
const logRing = [];

/**
 * Record a log entry into the circular buffer.
 * @param {'info'|'warn'|'error'} level
 * @param {string} message
 * @param {any} [meta]
 */
export function recordAdminLog(level, message, meta = null) {
  const entry = {
    id: Date.now() + '-' + Math.random().toString(36).slice(2, 7),
    at: Date.now(),
    level,
    message: typeof message === 'string' ? message : String(message),
    meta: meta ? (typeof meta === 'object' ? meta : { data: String(meta) }) : null,
  };
  if (logRing.length >= MAX_LOG_ENTRIES) {
    logRing.shift();
  }
  logRing.push(entry);
}

/**
 * Calculate CPU usage percentage across intervals.
 */
let lastCpuMeasure = { time: Date.now(), cpus: os.cpus() };

export function getCpuUsagePercent() {
  const now = Date.now();
  const cpus = os.cpus();
  const prev = lastCpuMeasure;
  lastCpuMeasure = { time: now, cpus };

  let totalDiff = 0;
  let idleDiff = 0;

  for (let i = 0; i < cpus.length; i++) {
    const c1 = cpus[i].times;
    const c0 = prev.cpus[i]?.times || c1;
    const total1 = c1.user + c1.nice + c1.sys + c1.idle + c1.irq;
    const total0 = c0.user + c0.nice + c0.sys + c0.idle + c0.irq;
    totalDiff += (total1 - total0);
    idleDiff += (c1.idle - c0.idle);
  }

  if (totalDiff <= 0) return 0;
  const usage = 100 - (idleDiff / totalDiff) * 100;
  return Math.min(100, Math.max(0, Math.round(usage * 10) / 10));
}

/**
 * Admin Service Class
 */
export class AdminService {
  constructor({ lobby, network, registry, startedAt, buildTag, secret = process.env.ADMIN_SECRET }) {
    this.lobby = lobby;
    this.network = network;
    this.registry = registry;
    this.startedAt = startedAt;
    this.buildTag = buildTag;
    // Default to environment ADMIN_SECRET or fallback to persistent/session token
    this.secret = secret || 'stronghold-admin-2026';
    this.isDraining = false;
    this.drainStartedAt = null;

    recordAdminLog('info', `[AdminService] 初始化成功，当前版本: v${APP_VERSION} (tag: ${buildTag})`);
  }

  /** Validate token or basic header */
  authenticate(req) {
    const authHeader = req.headers['authorization'] || '';
    if (authHeader.startsWith('Bearer ')) {
      return authHeader.slice(7).trim() === this.secret;
    }
    const tokenCookie = (req.headers['cookie'] || '')
      .split(';')
      .map((c) => c.trim().split('='))
      .find(([k]) => k === 'admin_token');
    if (tokenCookie && tokenCookie[1] === this.secret) {
      return true;
    }
    return false;
  }

  _roomList() {
    if (!this.lobby || !this.lobby.rooms) return [];
    if (Array.isArray(this.lobby.rooms)) return this.lobby.rooms;
    if (typeof this.lobby.rooms.values === 'function') return Array.from(this.lobby.rooms.values());
    return [];
  }

  /**
   * System overview metrics.
   */
  getOverview() {
    const mem = process.memoryUsage();
    const totalMem = os.totalmem();
    const freeMem = os.freemem();

    const rooms = this._roomList();
    const activeMatches = rooms.filter((r) => !!r.match).length;

    let androidFull = 0;
    let webFull = 0;
    let webCore = 0;
    let webStream = 0;
    if (this.registry?.byPlayerId) {
      for (const s of this.registry.byPlayerId.values()) {
        if (!s.connected) continue;
        const b = s.client?.bundle;
        if (b === 'full' || b === 'android_full') androidFull++;
        else if (b === 'web_full') webFull++;
        else if (b === 'web_core' || b === 'core' || b === 'preloaded') webCore++;
        else webStream++;
      }
    }

    return {
      version: {
        app: APP_VERSION,
        protocol: PROTOCOL_VERSION,
        build: typeof this.buildTag === 'function' ? this.buildTag() : this.buildTag,
        node: process.version,
      },
      uptime: Math.round((Date.now() - this.startedAt) / 1000),
      isDraining: this.isDraining,
      drainElapsedSec: this.drainStartedAt ? Math.round((Date.now() - this.drainStartedAt) / 1000) : 0,
      system: {
        cpuPercent: getCpuUsagePercent(),
        loadAvg: os.loadavg().map((v) => Math.round(v * 100) / 100),
        processRssMb: Math.round((mem.rss / 1024 / 1024) * 10) / 10,
        heapUsedMb: Math.round((mem.heapUsed / 1024 / 1024) * 10) / 10,
        heapTotalMb: Math.round((mem.heapTotal / 1024 / 1024) * 10) / 10,
        systemFreeMb: Math.round((freeMem / 1024 / 1024) * 10) / 10,
        systemTotalMb: Math.round((totalMem / 1024 / 1024) * 10) / 10,
      },
      network: {
        sockets: this.network.connectionCount,
        sessions: this.registry.size,
        roomsCount: rooms.length,
        matchesCount: activeMatches,
        clients: {
          androidFull,
          webFull,
          webCore,
          webStream,
          // backwards compatibility:
          webPreloaded: webFull + webCore,
        },
      },
    };
  }

  /**
   * Detailed room and match states.
   */
  getRooms() {
    const rooms = this._roomList();
    return rooms.map((r) => {
      const seats = (r.seats || []).filter(Boolean).map((s) => {
        const session = this.registry?.byPlayerId?.get(s?.playerId);
        return {
          seat: s?.seat,
          playerId: s?.playerId,
          name: s?.name,
          isBot: !!s?.isBot,
          ready: !!s?.ready,
          client: s?.isBot ? { platform: 'bot', bundle: 'bot' } : (session?.client || { platform: 'unknown', bundle: 'stream' }),
        };
      });

      const spectators = (r.spectators || []).map((sp) => ({
        playerId: sp?.playerId,
        name: sp?.name,
      }));

      let matchInfo = null;
      if (r.match) {
        const pub = r.match.public || {};
        matchInfo = {
          phase: pub.phase,
          round: pub.round,
          paused: !!pub.paused,
          alivePlayers: Array.isArray(pub.players)
            ? pub.players.map((p) => ({
                playerId: p?.playerId,
                name: p?.name,
                isBot: !!p?.isBot || (typeof p?.playerId === 'string' && p.playerId.startsWith('ai_')),
                alive: p?.alive !== false,
                lp: p?.lp,
              }))
            : [],
        };
      }

      return {
        code: r.code,
        hostId: r.hostId,
        mode: r.mode,
        difficulty: r.difficulty,
        inMatch: !!r.match,
        seats,
        spectators,
        match: matchInfo,
        createdAt: r.createdAt || null,
      };
    });
  }

  /**
   * Recent system log ring.
   */
  getLogs(since = 0) {
    return logRing.filter((e) => e.at > since);
  }

  /**
   * Broadcast a system message to all rooms.
   */
  broadcast(message) {
    const text = String(message || '').trim();
    if (!text) return false;

    const rooms = this._roomList();
    let count = 0;
    for (const r of rooms) {
      try {
        this.lobby.broadcastRoom(r, {
          t: 'room.chat',
          playerId: 'system',
          name: '📢 系统公告',
          seat: -1,
          isSpectator: false,
          text,
          at: Date.now(),
        });
        count++;
      } catch (err) {
        // ignore single room broadcast error
      }
    }
    recordAdminLog('info', `[Admin] 发送系统公告给 ${count} 个房间: "${text}"`);
    return true;
  }

  /**
   * Enter graceful draining mode (prepare for hot reload).
   */
  startDrain() {
    if (this.isDraining) return true;
    this.isDraining = true;
    this.drainStartedAt = Date.now();
    if (this.lobby) {
      this.lobby.isDraining = true;
    }
    recordAdminLog('warn', '[Admin] 启动热重载平滑排空模式 (Graceful Drain)：新房间将拒绝创建，等待存量对局结束');
    return true;
  }
}

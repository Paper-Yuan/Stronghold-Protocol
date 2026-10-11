// Private player management. No session tokens, browser IDs or credential hashes leave this module.
import { readFile, mkdir, open, rename, unlink } from 'node:fs/promises';
import path from 'node:path';
import { randomBytes, createHash, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { setTimeout as wait } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { isIP } from 'node:net';
import { clientAddress, isLocalIp, TokenBucket } from './net.js';
import { parseAnnouncements, activeAnnouncement } from '../shared/announcements.js';
import { ANNOUNCEMENT_MAX_BYTES } from './announcements.js';

const derive = promisify(scrypt);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SESSION_MS = 8 * 60 * 60 * 1000;
const FILE_MAX_BYTES = 2 * 1024 * 1024;
const hash = value => createHash('sha256').update(String(value)).digest('hex');
const id = () => randomBytes(16).toString('hex');
const fail = (status, message) => Object.assign(new Error(message), { status });
const same = (a, b) => typeof a === 'string' && typeof b === 'string' && Buffer.byteLength(a) === Buffer.byteLength(b)
  && timingSafeEqual(Buffer.from(a), Buffer.from(b));
const cleanText = (value, max, label) => {
  if (typeof value !== 'string' || !value.trim() || [...value].length > max || /[\x00-\x1f\x7f]/.test(value)) throw fail(400, `${label}格式无效`);
  return value.trim();
};

export async function credentials(password) {
  if (typeof password !== 'string' || password.length < 12 || Buffer.byteLength(password) > 128) throw fail(400, '管理密码需要 12–128 字节');
  const salt = randomBytes(16).toString('hex');
  return { salt, passwordHash: (await derive(password, salt, 32)).toString('hex') };
}

export async function atomicJson(file, doc, expected) {
  const data = JSON.stringify(doc, null, 2) + '\n';
  if (Buffer.byteLength(data) > FILE_MAX_BYTES) throw fail(409, '管理记录容量已达上限，请先整理过期记录');
  await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  const tmp = `${file}.${id()}.tmp`;
  let handle;
  try {
    handle = await open(tmp, 'wx', 0o600);
    await handle.writeFile(data);
    await handle.sync();
    await handle.close(); handle = null;
    if (expected !== undefined && await readFile(file, 'utf8') !== expected) throw fail(409, '配置已被其他操作修改，请刷新后再试');
    for (let attempt = 0; ; attempt++) {
      try { await rename(tmp, file); break; }
      catch (e) {
        // Windows may briefly deny replacing a file while the announcement poller reads it.
        if (process.platform !== 'win32' || !['EPERM', 'EACCES', 'EBUSY'].includes(e.code) || attempt >= 4) throw e;
        await wait(20 * (attempt + 1));
        if (expected !== undefined && await readFile(file, 'utf8') !== expected) throw fail(409, '配置已被其他操作修改，请刷新后再试');
      }
    }
  } finally {
    await handle?.close().catch(() => {});
    await unlink(tmp).catch(() => {});
  }
}

async function jsonFile(file, missing) {
  try {
    const handle = await open(file, 'r');
    try {
      if ((await handle.stat()).size > FILE_MAX_BYTES) throw new Error('management file too large');
      const raw = await handle.readFile('utf8');
      return { doc: JSON.parse(raw), raw };
    } finally { await handle.close(); }
  } catch (e) { if (e.code === 'ENOENT' && missing !== undefined) return { doc: missing, raw: undefined }; throw e; }
}

function validateConfig(config) {
  if (!config || config.version !== 1 || !/^[A-Za-z0-9_-]{1,32}$/.test(config.username)
      || !/^[a-f0-9]{32}$/.test(config.salt) || !/^[a-f0-9]{64}$/.test(config.passwordHash)) throw new Error('invalid admin credentials');
  const url = new URL(config.publicOrigin);
  if (!['https:', 'http:'].includes(url.protocol) || url.origin !== config.publicOrigin) throw new Error('invalid admin origin');
  if (url.protocol !== 'https:' && !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) throw new Error('admin origin requires HTTPS');
  return { ...config, secureCookie: url.protocol === 'https:' };
}

/** Snapshot reads published match state; it never asks the simulation to compute a new view. */
export function playerSnapshot({ network, lobby, registry, now = Date.now() }) {
  const matches = new Map();
  const players = [];
  for (const session of registry.all()) {
    const room = lobby.roomOf(session);
    const ctx = lobby.activeMatchOf(session);
    if (!session.connected && !room && !ctx && !session.matchQueue) continue;
    let pub = null;
    if (ctx) {
      if (!matches.has(ctx)) {
        try { matches.set(ctx, ctx.lastPublic ? JSON.parse(ctx.lastPublic) : null); } catch { matches.set(ctx, null); }
      }
      pub = matches.get(ctx);
    }
    const ps = ctx?.match?.players?.get(session.playerId);
    const published = pub?.players?.find(p => p.playerId === session.playerId);
    const spectator = !!room?.spectatorOf(session.playerId) || !!ctx?.match?.spectators?.has(session.playerId);
    const active = !!ctx && !ctx.ended && !ctx.disposed && !['LOBBY', 'RESULT'].includes(pub?.phase || ctx.match?.phase);
    const conn = session.ws && network.conns.get(session.ws);
    const connected = !!session.connected && !!conn && !conn.closing && conn.ws.readyState === 1 && conn.session === session;
    const queue = lobby.queueByPlayer.get(session.playerId) || (room && lobby.matchmaker.roomQueue.get(room.code));
    const status = !connected ? 'disconnected' : spectator ? 'spectating' : active ? 'playing' : queue ? 'matching' : room ? 'waiting' : 'lobby';
    players.push({ playerId: session.playerId, name: session.name, connected, status, spectator,
      playing: active && !spectator && !ps?.left, roomCode: room?.code || null, matchId: ctx?.match?.roomCode || null,
      mode: room?.mode || ctx?.match?.mode || queue?.mode || null,
      difficulty: room?.difficulty || ctx?.match?.difficulty || queue?.difficulty || null,
      phase: pub?.phase || ctx?.match?.phase || null, round: pub?.round ?? ctx?.match?.round ?? null,
      lastRound: pub?.lastRound ?? null, lp: published?.lp ?? ps?.lp ?? null, alive: published?.alive ?? ps?.alive ?? null,
      autoplay: !!ps?.autoplay, isHost: room?.hostId === session.playerId,
      ip: session.addr || null, canBanIp: !!isIP(session.addr) && !isLocalIp(session.addr),
      lastSeen: session.lastSeen, disconnectedAt: session.disconnectedAt,
      browserGroup: session.adminBrowserHash?.slice(0, 10) || null,
    });
  }
  players.sort((a, b) => Number(b.playing) - Number(a.playing) || Number(b.connected) - Number(a.connected) || a.playerId.localeCompare(b.playerId));
  return { serverNow: typeof now === 'function' ? now() : now, stats: { onlineBrowsers: network.onlineCount, connectedPlayers: players.filter(p => p.connected).length,
    playingPlayers: players.filter(p => p.playing).length, disconnectedPlayers: players.filter(p => !p.connected).length,
    ...lobby.stats(), matchmaking: network.matchmakingCounts }, players };
}

export class PlayerAdmin {
  constructor({ network, lobby, registry, config, configFile, announcementFile, publicDir, now = Date.now, log = console }) {
    Object.assign(this, { network, lobby, registry, config: validateConfig(config), configFile, announcementFile, publicDir, now, log });
    this.directory = path.dirname(configFile);
    this.stateFile = path.join(this.directory, 'state.json');
    this.state = { version: 1, bans: [], audit: [] };
    this.sessions = new Map();
    this.loginBuckets = new Map();
    this.authBusy = 0;
    this.writes = Promise.resolve();
    this.closed = false;
  }

  async start() {
    const { doc } = await jsonFile(this.stateFile, this.state);
    if (doc?.version !== 1 || !Array.isArray(doc.bans) || !Array.isArray(doc.audit) || doc.bans.length > 2000 || doc.audit.length > 1000
        || doc.bans.some(b => !b || typeof b.id !== 'string' || !Array.isArray(b.keys) || !b.keys.every(k => /^[btp]:[a-f0-9]{64}$/.test(k))
          || !Array.isArray(b.scopes) || !Number.isFinite(b.createdAt) || !Number.isFinite(b.expiresAt))) throw new Error('invalid admin state');
    this.state = doc;
    this.reindex();
    for (const conn of this.network.conns.values()) if (conn.session) this.remember(conn.session, conn);
    if (this.network.moderation) throw new Error('moderation is already configured');
    this.network.moderation = this;
  }

  remember(session, conn) {
    if (conn.browserId && /^[a-f0-9]{32}$/.test(conn.browserId)) session.adminBrowserHash = hash(conn.browserId);
  }

  reindex() {
    this.banIndex = new Map();
    for (const ban of this.state.bans) {
      if (ban.revokedAt || (ban.expiresAt && ban.expiresAt <= this.now())) continue;
      for (const key of ban.keys) {
        const prev = this.banIndex.get(key);
        if (!prev || !ban.expiresAt || (prev.expiresAt && ban.expiresAt > prev.expiresAt)) this.banIndex.set(key, ban);
      }
    }
  }

  blocked(conn, msg) {
    const session = conn.session || (msg.token && this.registry.byToken(msg.token));
    const browserHash = msg.browserId ? hash(msg.browserId) : session?.adminBrowserHash;
    const keys = [browserHash && 'b:' + browserHash, (msg.token || session?.token) && 't:' + hash(msg.token || session.token), conn.ip && 'p:' + hash(conn.ip)];
    for (const key of keys) {
      const ban = key && this.banIndex.get(key);
      if (ban && !ban.revokedAt && (!ban.expiresAt || ban.expiresAt > this.now())) return true;
    }
    return false;
  }

  cookieName() { return this.config.secureCookie ? '__Secure-sp_player_admin' : 'sp_player_admin'; }
  cookie(req) {
    const entries = String(req.headers.cookie || '').split(';').map(s => s.trim().split('='));
    const matches = entries.filter(([key]) => key === this.cookieName());
    return matches.length === 1 && /^[A-Za-z0-9_-]{43}$/.test(matches[0][1] || '') ? matches[0][1] : null;
  }
  session(req) {
    const token = this.cookie(req);
    const row = token && this.sessions.get(hash(token));
    if (!row || row.expiresAt <= this.now()) { if (token) this.sessions.delete(hash(token)); return null; }
    return row;
  }
  setCookie(res, value, seconds) {
    res.setHeader('Set-Cookie', `${this.cookieName()}=${value}; Path=/admin/; HttpOnly; SameSite=Strict; Max-Age=${seconds}${this.config.secureCookie ? '; Secure' : ''}`);
  }
  headers(res) {
    res.setHeader('Cache-Control', 'no-store'); res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY'); res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Robots-Tag', 'noindex, nofollow');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
  }
  json(req, res, status, body) {
    const bytes = Buffer.from(JSON.stringify(body));
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': bytes.length });
    res.end(req.method === 'HEAD' ? undefined : bytes);
  }
  async body(req) {
    if (!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type'] || '')) throw fail(415, '请使用 JSON 请求');
    const chunks = []; let size = 0;
    for await (const chunk of req) { size += chunk.length; if (size > 8192) throw fail(413, '请求内容过大'); chunks.push(chunk); }
    try { const doc = JSON.parse(Buffer.concat(chunks).toString('utf8')); if (!doc || typeof doc !== 'object' || Array.isArray(doc)) throw new Error(); return doc; }
    catch { throw fail(400, 'JSON 格式无效'); }
  }
  verifyOrigin(req) { if (req.headers.origin !== this.config.publicOrigin) throw fail(403, '请求来源无效'); }
  async verifyPassword(password) {
    if (typeof password !== 'string' || Buffer.byteLength(password) > 128) return false;
    const key = await derive(password, this.config.salt, 32);
    return timingSafeEqual(key, Buffer.from(this.config.passwordHash, 'hex'));
  }
  async login(req, res) {
    const at = this.now();
    for (const [key, row] of this.loginBuckets) if (at - row.at > 600000) this.loginBuckets.delete(key);
    for (const [key, row] of this.sessions) if (row.expiresAt <= at) this.sessions.delete(key);
    const ip = clientAddress(req, this.network.opts.trustProxy).ip;
    if (!this.loginBuckets.has(ip)) {
      if (this.loginBuckets.size >= 1000) throw fail(429, '登录请求过多，请稍后重试');
      this.loginBuckets.set(ip, { at, budget: new TokenBucket(1 / 60, 5, at) });
    }
    const row = this.loginBuckets.get(ip); row.at = at;
    if (!row.budget.take(at) || this.authBusy >= 2) { res.setHeader('Retry-After', '60'); throw fail(429, '登录尝试过多，请稍后重试'); }
    const body = await this.body(req);
    this.authBusy++;
    let verified;
    try { verified = await this.verifyPassword(body.password); } finally { this.authBusy--; }
    if (!verified || body.username !== this.config.username) throw fail(401, '账号或密码错误');
    const previous = this.cookie(req); if (previous) this.sessions.delete(hash(previous));
    if (this.sessions.size >= 16) throw fail(429, '管理会话过多，请退出其他窗口');
    const token = randomBytes(32).toString('base64url');
    const csrf = randomBytes(32).toString('base64url');
    this.sessions.set(hash(token), { csrf, username: this.config.username, expiresAt: at + SESSION_MS, budget: new TokenBucket(1, 8, at) });
    this.setCookie(res, token, SESSION_MS / 1000);
    this.json(req, res, 200, { ok: true, username: this.config.username, csrf });
  }
  serialize(work) {
    const result = this.writes.then(work);
    this.writes = result.catch(() => {});
    return result;
  }
  async commit(state, event) {
    const next = { ...state, audit: [{ id: id(), at: this.now(), actor: this.config.username, ...event }, ...state.audit].slice(0, 1000) };
    await atomicJson(this.stateFile, next);
    this.state = next; this.reindex();
  }
  kickSession(session, reason) {
    const conn = session.ws && this.network.conns.get(session.ws);
    this.registry.remove(session);
    this.lobby.onExpire(session); // real leave: frees the seat, eliminates only this player and returns their pool pieces.
    conn?.close(4003, reason);
  }
  async kick(body) {
    const session = this.registry.byId(cleanText(body.playerId, 64, '玩家 ID'));
    if (!session) throw fail(404, '玩家已经离线或会话已结束，请刷新列表');
    const reason = cleanText(body.reason || '管理员移出', 200, '原因');
    await this.commit(this.state, { action: 'kick', playerId: session.playerId, name: session.name, reason });
    this.kickSession(session, 'admin:kicked');
    return { ok: true };
  }
  async ban(body) {
    const session = this.registry.byId(cleanText(body.playerId, 64, '玩家 ID'));
    if (!session) throw fail(404, '玩家会话已结束，请刷新后选择玩家');
    const reason = cleanText(body.reason || '管理员封禁', 200, '原因');
    const seconds = body.durationSeconds;
    if (!Number.isInteger(seconds) || seconds < 0 || seconds > 365 * 86400 || (body.includeIp != null && typeof body.includeIp !== 'boolean')) throw fail(400, '封禁参数无效');
    if (body.includeIp && (!isIP(session.addr) || isLocalIp(session.addr))) throw fail(400, '此地址不是可封禁的公网 IP');
    const keys = ['t:' + hash(session.token)], scopes = ['session'];
    if (session.adminBrowserHash) { keys.push('b:' + session.adminBrowserHash); scopes.push('browser'); }
    if (body.includeIp) { keys.push('p:' + hash(session.addr)); scopes.push('ip'); }
    const now = this.now();
    const record = { id: id(), playerId: session.playerId, name: session.name, reason, keys, scopes,
      createdAt: now, expiresAt: seconds ? now + seconds * 1000 : 0, revokedAt: null };
    const bans = this.state.bans.filter(b => !b.revokedAt && (!b.expiresAt || b.expiresAt > now));
    if (bans.length >= 2000) throw fail(409, '封禁记录数量已达上限');
    await this.commit({ ...this.state, bans: [...bans, record] }, { action: 'ban', playerId: session.playerId, name: session.name, reason, scopes, expiresAt: record.expiresAt });
    let affected = 0;
    for (const target of [...this.registry.all()]) {
      const targetKeys = ['t:' + hash(target.token), target.adminBrowserHash && 'b:' + target.adminBrowserHash, target.addr && 'p:' + hash(target.addr)];
      if (targetKeys.some(key => keys.includes(key))) { this.kickSession(target, 'admin:banned'); affected++; }
    }
    return { ok: true, affected, banId: record.id };
  }
  async unban(body) {
    const banId = cleanText(body.banId, 64, '封禁 ID');
    const ban = this.state.bans.find(b => b.id === banId && !b.revokedAt);
    if (!ban) throw fail(404, '封禁记录不存在或已经解除');
    const bans = this.state.bans.map(b => b.id === banId ? { ...b, revokedAt: this.now() } : b);
    await this.commit({ ...this.state, bans }, { action: 'unban', playerId: ban.playerId, name: ban.name, banId });
    return { ok: true };
  }
  async announcementData() {
    const result = await jsonFile(this.announcementFile, { announcements: [] });
    const rows = parseAnnouncements(result.doc);
    return { ...result, rows, current: activeAnnouncement(rows, this.now()) };
  }
  async publish(body) {
    const old = await this.announcementData();
    const notice = { id: 'admin_' + id(), text: cleanText(typeof body.text === 'string' ? body.text.replace(/\s+/g, ' ') : body.text, 500, '公告正文'),
      startAt: new Date(this.now()).toISOString(), durationSeconds: body.durationSeconds, level: body.level || 'warning', enabled: true };
    try { parseAnnouncements({ announcements: [notice] }); } catch { throw fail(400, '公告等级或时长无效，时长需为 1–86400 秒'); }
    const list = old.doc.announcements.filter(n => !n.id.startsWith('admin_') || Date.parse(n.startAt) + n.durationSeconds * 1000 > this.now());
    const doc = { ...old.doc, announcements: [...list, notice] };
    if (doc.announcements.length > 100) throw fail(409, '有效公告数量已达上限');
    parseAnnouncements(doc);
    if (Buffer.byteLength(JSON.stringify(doc, null, 2) + '\n') > ANNOUNCEMENT_MAX_BYTES) throw fail(409, '公告排期容量已达上限，请先清理旧排期');
    await atomicJson(this.announcementFile, doc, old.raw);
    await this.commit(this.state, { action: 'announcement', announcementId: notice.id, text: notice.text, durationSeconds: notice.durationSeconds, level: notice.level });
    return { ok: true, announcementId: notice.id };
  }
  async stopNotice(body) {
    const old = await this.announcementData();
    const noticeId = cleanText(body.announcementId, 64, '公告 ID');
    if (!noticeId.startsWith('admin_') || !old.doc.announcements.some(n => n.id === noticeId)) throw fail(404, '管理页发布的公告不存在');
    await atomicJson(this.announcementFile, { ...old.doc, announcements: old.doc.announcements.map(n => n.id === noticeId ? { ...n, enabled: false } : n) }, old.raw);
    await this.commit(this.state, { action: 'stopAnnouncement', announcementId: noticeId });
    return { ok: true };
  }
  async password(body, req, res) {
    if (!await this.verifyPassword(body.currentPassword)) throw fail(403, '当前管理密码不正确');
    const secret = await credentials(body.newPassword);
    const config = { ...this.config, ...secret };
    await atomicJson(this.configFile, config);
    this.config = config; this.sessions.clear();
    this.setCookie(res, '', 0);
    await this.commit(this.state, { action: 'passwordChanged' });
    return { ok: true };
  }
  async handle(req, res, pathname) {
    this.headers(res);
    if (this.closed) { this.json(req, res, 503, { error: '管理服务暂不可用' }); return; }
    if (pathname === '/admin' && ['GET', 'HEAD'].includes(req.method)) { res.writeHead(302, { Location: '/admin/' }); res.end(); return; }
    const assets = { '/admin/': ['index.html', 'text/html; charset=utf-8'], '/admin/admin.css': ['admin.css', 'text/css; charset=utf-8'], '/admin/admin.js': ['admin.js', 'text/javascript; charset=utf-8'] };
    if (Object.hasOwn(assets, pathname)) {
      if (!['GET', 'HEAD'].includes(req.method)) throw fail(405, '请求方法不支持');
      const [file, contentType] = assets[pathname];
      const bytes = await readFile(path.join(this.publicDir, 'admin', file));
      res.writeHead(200, { 'Content-Type': contentType, 'Content-Length': bytes.length }); res.end(req.method === 'HEAD' ? undefined : bytes); return;
    }
    if (!pathname.startsWith('/admin/api/')) throw fail(404, '管理接口不存在');
    if (!['GET', 'HEAD', 'POST'].includes(req.method)) throw fail(405, '请求方法不支持');
    if (req.method === 'POST') this.verifyOrigin(req);
    if (pathname === '/admin/api/login' && req.method === 'POST') { await this.login(req, res); return; }
    const session = this.session(req);
    if (!session) throw fail(401, '请先登录管理页');
    if (['GET', 'HEAD'].includes(req.method)) {
      if (pathname === '/admin/api/session') this.json(req, res, 200, { username: session.username, csrf: session.csrf });
      else if (pathname === '/admin/api/snapshot') {
        const data = playerSnapshot(this);
        const query = new URL(req.url, this.config.publicOrigin).searchParams;
        const search = (query.get('search') || '').trim().slice(0, 80).toLowerCase();
        const scope = query.get('scope') || 'all';
        const filtered = data.players.filter(p => (!search || [p.name, p.playerId, p.roomCode, p.matchId, p.ip].some(v => String(v || '').toLowerCase().includes(search)))
          && (scope === 'all' || scope === 'playing' && p.playing || scope === 'online' && p.connected || scope === 'disconnected' && !p.connected || scope === 'matching' && p.status === 'matching'));
        const offset = Math.min(20000, Math.max(0, Number.parseInt(query.get('offset'), 10) || 0));
        this.json(req, res, 200, { ...data, players: filtered.slice(offset, offset + 200), filteredCount: filtered.length, offset,
          bans: this.state.bans.filter(b => !b.revokedAt).map(({ keys, ...b }) => ({ ...b, expired: !!b.expiresAt && b.expiresAt <= this.now() })),
          audit: this.state.audit.slice(0, 50), announcement: (await this.announcementData()).current });
      } else if (pathname === '/admin/api/announcements') {
        const data = await this.announcementData(); this.json(req, res, 200, { announcements: data.rows.map(({ ...n }) => n), current: data.current });
      } else throw fail(404, '管理接口不存在');
      return;
    }
    if (!same(req.headers['x-csrf-token'], session.csrf)) throw fail(403, '操作校验失败，请重新登录');
    if (!session.budget.take(this.now())) throw fail(429, '管理操作过于频繁，请稍后重试');
    const body = await this.body(req);
    const handlers = { '/admin/api/kick': () => this.kick(body), '/admin/api/ban': () => this.ban(body), '/admin/api/unban': () => this.unban(body),
      '/admin/api/announcement': () => this.publish(body), '/admin/api/announcement/stop': () => this.stopNotice(body),
      '/admin/api/password': () => this.password(body, req, res),
      '/admin/api/logout': async () => { this.sessions.delete(hash(this.cookie(req))); this.setCookie(res, '', 0); return { ok: true }; } };
    if (!Object.hasOwn(handlers, pathname)) throw fail(404, '管理接口不存在');
    this.json(req, res, 200, await this.serialize(handlers[pathname]));
  }
  async close() {
    this.closed = true;
    this.sessions.clear();
    if (this.network.moderation === this) this.network.moderation = null;
    await this.writes;
  }
}

/** Mounted separately so a tested live install can keep the existing game server and sockets. */
export async function mountPlayerAdmin({ server, network, lobby, registry, configFile = path.join(ROOT, 'config/player-admin/config.json'),
  announcementFile = path.join(ROOT, 'config/announcements.json'), publicDir = path.join(ROOT, 'public'), log = console, now = Date.now }) {
  let admin = null;
  try {
    const { doc } = await jsonFile(configFile, null);
    if (doc) { admin = new PlayerAdmin({ network, lobby, registry, config: doc, configFile, announcementFile, publicDir, log, now }); await admin.start(); }
  } catch (e) { log.error?.('[player-admin] disabled: ' + e.message); admin = null; }
  const prior = server.listeners('request');
  for (const listener of prior) server.off('request', listener);
  const listener = (req, res) => {
    const pathname = (req.url || '/').split('?')[0];
    if (pathname === '/admin' || pathname.startsWith('/admin/')) {
      if (!admin) { res.writeHead(404, { 'Cache-Control': 'no-store' }); res.end(); return; }
      admin.handle(req, res, pathname).catch(e => {
        if (res.headersSent) { res.destroy(); return; }
        const status = e.status || 500;
        if (status >= 500) log.error?.('[player-admin] request failed: ' + e.message);
        admin.json(req, res, status, { error: status >= 500 ? '管理服务暂不可用，请稍后重试' : e.message });
      });
    } else for (const fn of prior) fn.call(server, req, res);
  };
  server.on('request', listener);
  return { admin, async close() { await admin?.close(); }, async unmount() {
    await admin?.close(); server.off('request', listener); for (const fn of prior) server.on('request', fn);
  } };
}

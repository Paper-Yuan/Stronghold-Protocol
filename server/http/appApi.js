// server/http/appApi.js — 启动器 / Android 宿主用的三个只读端点（都不碰对局逻辑）。
//
//   1. `GET /api/app/version`（别名 `/api/version`）—— 「服务端是什么版本、有没有热更补丁」。Android 宿主就是从
//      这里拿 `patchUrl` 的（android/.../MainActivity.kt `downloadAndApplyPatch`），再由 /api/app/patch.zip 取补丁；
//      `tools/bundle-patch.mjs` 负责产出那个 zip。
//   2. `GET /api/app/patch.zip` —— `dist/patch.zip` 优先，退回 `public/patch.zip`；两个都没有就 404（「补丁未就绪」
//      是**正常状态**：客户端继续玩当前包，不该当成错误）。
//   3. `GET /lan/room?code=XXXX` —— 局域网房间探针（android/.../NetworkUtils.kt `probeRoom` 打的就是它）：同 Wi-Fi /
//      虚拟专网里「4 位同盟密钥进不进得去」的预检。**只在请求方来自私网或虚拟专网时作答** —— 公网请求一律 404，
//      连「这台机器上有没有这个房间」都不透露。
//
// 三条都只读、都走 GET/HEAD；非 GET/HEAD 一律交回下面那道方法门统一答 405（不在这里重复一遍 Allow 逻辑）。

import fs from 'node:fs';
import path from 'node:path';

import { sendError, sendJson } from './common.js';

/**
 * 请求方是不是来自私网 / 虚拟专网：RFC1918、回环、CGNAT（100.64/10 —— Tailscale / ZeroTier / UU 这类虚拟专网分配的
 * 正是这一段，与 android/.../NetworkUtils.kt 的 isCgnat 同口径）、link-local 与 IPv6 ULA（fc00::/7）。
 * @param {string|undefined} addr `req.socket.remoteAddress`
 * @returns {boolean}
 */
export function isPrivateAddress(addr) {
  if (!addr) return false;
  const a = String(addr).toLowerCase().replace(/^::ffff:/, '');
  if (a === '::1') return true;
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(a);
  if (v4) {
    const o1 = +v4[1];
    const o2 = +v4[2];
    return o1 === 10 || o1 === 127 || (o1 === 192 && o2 === 168) || (o1 === 172 && o2 >= 16 && o2 <= 31)
      || (o1 === 100 && o2 >= 64 && o2 <= 127)
      || (o1 === 169 && o2 === 254);
  }
  return /^f[cd][0-9a-f]{1,2}:/.test(a);
}

/** 房间码（server/lobby.js CODE_ALPHABET：4 个大写字母，没有数字）。 */
const ROOM_CODE_RE = /^[A-Z]{4}$/;

/**
 * @param {{ lobby?: any, buildTag?: () => string, appVersion?: string, rootDir?: string, now?: () => number, log?: any }} [o]
 * @returns {(req: any, res: any, pathname: string) => boolean} true = 已经在这里回答
 */
export function createAppApi({ lobby = null, buildTag = () => '', appVersion = '0.0.0', rootDir = process.cwd(), now = Date.now, log = null } = {}) {
  const PATCH_PATHS = [path.join(rootDir, 'dist', 'patch.zip'), path.join(rootDir, 'public', 'patch.zip')];

  /** 补丁文件（问到才算 stat）；两个位置都没有则 null。 */
  const patchFile = () => {
    for (const p of PATCH_PATHS) {
      try { if (fs.statSync(p).isFile()) return p; } catch { /* 试下一个 */ }
    }
    return null;
  };
  return (req, res, pathname) => {
    const isVersion = pathname === '/api/app/version' || pathname === '/api/version';
    const isPatch = pathname === '/api/app/patch.zip';
    const isLan = pathname === '/lan/room';
    if (!isVersion && !isPatch && !isLan) return false;
    if (req.method !== 'GET' && req.method !== 'HEAD') return false;

    if (isVersion) {
      const build = String(buildTag() || '');
      sendJson(req, res, 200, {
        ok: true,
        app: appVersion,
        build,
        serverNow: now(),
        hotUpdate: {
          // 只有**真的存在补丁文件**时才宣称支持热更新，否则 App 会按 patchUrl 去下载、拿到 404 并在
          // 界面报「补丁包下载失败，服务器返回 HTTP 404」（owner：手机端热更新会显示 404）。
          supported: !!patchFile(),
          bundleVersion: build,
          ...(patchFile() ? { patchUrl: '/api/app/patch.zip' } : {}),
          changelog: `Stronghold Protocol v${appVersion} (build ${build}) ready`,
        },
      });
      return true;
    }

    if (isPatch) {
      const file = patchFile();
      if (!file) { sendError(req, res, 404, '补丁文件未就绪 · Patch not found'); return true; }
      let stat;
      try { stat = fs.statSync(file); } catch (e) { log?.error?.('[app] patch stat failed', e); sendError(req, res, 404, '补丁文件未就绪 · Patch not found'); return true; }
      res.writeHead(200, {
        'Content-Type': 'application/zip',
        'Content-Length': stat.size,
        'Cache-Control': 'no-cache',
        'Access-Control-Allow-Origin': '*',
      });
      if (req.method === 'HEAD') { res.end(); return true; }
      const stream = fs.createReadStream(file);
      stream.on('error', (e) => { log?.error?.('[app] patch stream failed', e); res.destroy(); });
      stream.pipe(res);
      return true;
    }

    // /lan/room：先看是不是局域网/虚拟专网来的，再谈房间存不存在（两个 404 长得一样）。
    if (!isPrivateAddress(req.socket?.remoteAddress)) { sendError(req, res, 404, '页面不存在 · Not found'); return true; }
    const url = new URL(req.url || '/', 'http://lan.invalid');
    const code = String(url.searchParams.get('code') || '').toUpperCase();
    const room = ROOM_CODE_RE.test(code) && lobby ? lobby.getRoom(code) : null;
    if (!room || room.mode !== 'coop') { sendError(req, res, 404, '页面不存在 · Not found'); return true; }
    sendJson(req, res, 200, {
      ok: true,
      code: room.code,
      mode: room.mode,
      difficulty: room.difficulty,
      seats: room.seats.length,
      humans: room.seats.filter((s) => s && !s.isBot).length,
      inMatch: !!room.match,
    });
    return true;
  };
}

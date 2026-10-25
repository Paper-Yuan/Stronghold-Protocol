// server/http/boot.js — running the server as a process (`node server/index.js`, npm start, scripts/launch.mjs, the
// Windows service's scripts/run-server.cmd, NSSM, systemd):
//
//   * first, an update package extracted over the install (UPDATE.json) is finished — old files deleted, the install
//     verified (server/update.js); one that does not match its MANIFEST.json keeps the server from starting (exit 1);
//   * the boot banner: release version, the Local URL, the LAN URLs when listening on every interface, the plugin
//     studio's address with its key (server/studio/key.js: this machine and the local network only), the cloudflared
//     command for internet play;
//   * a server that cannot start exits 1 (with a hint when the port is in use); unhandled rejections and uncaught
//     exceptions are logged, not fatal;
//   * graceful shutdown on SIGINT/SIGTERM (rooms get room.closed{reason:'shutdown'}, sockets close 1001); a second
//     signal exits at once, and a shutdown that has not finished within SP_SHUTDOWN_TIMEOUT_MS (default 5 s) exits 1.

import fs from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { APP_VERSION, DEV_BUILD } from '../../shared/constants.js';
import { limitKeyOf } from '../net.js';
import { applyPendingUpdate } from '../update.js';
import { ROOT } from './config.js';

/**
 * Non-internal addresses as http URLs — IPv4 first, then IPv6 (an IPv6 literal needs brackets: `http://[240e:…]:3000`).
 * Link-local (`fe80::`) is left out: a URL cannot carry the zone id. Several privacy addresses in one /64 collapse
 * to one URL (`limitKeyOf`).
 * @param {number} port
 */
// 2026-10-22: 加速器 / 虚拟机 / 隧道会装上自己的网卡，它们的地址既连不到别的设备，
// 还会排到真局域网前面（UU 加速器一启动，横幅就从 192.168.x.x 变成 26.26.26.26，
// 群里的人照着输就连不上）。下面把这类网卡和无效地址挑掉，并让常见家用网段排在前面。
// 网卡名里**含**这些词就算虚拟（VMware 的是 "VMware Network Adapter VMnet8"，不是以 vmware 结尾）
const VIRTUAL_IFACE = /(tap|tun|wintun|wireguard|openvpn|vethernet|vmware|vmnet|virtualbox|vbox|hyper-?v|hamachi|zerotier|tailscale|uu加速|uu加速器|netease|clash|v2ray|xray)/i;
const VIRTUAL_NET = [
  /^26\./,                       // 网易 UU 加速器的虚拟网段
  /^169\.254\./,                // APIPA：拿不到 DHCP 时的自分配地址，连不通
  /^198\.1[89]\./,              // 基准测试段，虚拟机/隧道常借来用
];
const isVirtualAddress = (name, address) => VIRTUAL_IFACE.test(name || '') || VIRTUAL_NET.some((re) => re.test(address));

/** 家用局域网优先级：192.168 → 10 → 172.16–31 → 其它。 */
const lanRank = (address) => {
  if (/^192\.168\./.test(address)) return 0;
  if (/^10\./.test(address)) return 1;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(address)) return 2;
  return 3;
};

/**
 * @param {number} port
 */
export function lanUrls(port) {
  const v4 = [];
  const v6 = [];
  const v6Seen = new Set();
  for (const [name, addrs] of Object.entries(os.networkInterfaces())) {
    for (const a of addrs || []) {
      if (a.internal) continue;
      if (isVirtualAddress(name, a.address)) continue;
      if (a.family === 'IPv4' || a.family === 4) { v4.push(a.address); continue; }
      if (a.family !== 'IPv6' && a.family !== 6) continue;
      if (/^fe80:/i.test(a.address)) continue;
      const prefix = limitKeyOf(a.address);
      if (v6Seen.has(prefix)) continue;
      v6Seen.add(prefix);
      v6.push(`http://[${a.address}]:${port}`);
    }
  }
  // 真局域网排在前面（同一档里保持系统给的顺序），再拼回 URL
  v4.sort((x, y) => lanRank(x) - lanRank(y));
  return [...v4.map((ip) => `http://${ip}:${port}`), ...v6];
}

/**
 * The host as it appears in the local URL. A wildcard bind (`0.0.0.0` or `::`) reads `localhost`. An IPv6 literal
 * is bracketed (`http://[2001:db8::1]:3000`); an IPv4 address or a name is kept.
 * @param {string} host
 */
export function displayHost(host) {
  if (host === '0.0.0.0' || host === '::') return 'localhost';
  return host.includes(':') ? `[${host}]` : host;
}

/** Is the module whose `import.meta.url` is `metaUrl` the file node was started with? */
export function isProcessEntry(metaUrl) {
  if (!process.argv[1]) return false;
  if (process.env.pm_id !== undefined || process.env.PM2_USAGE || process.env.PM2_HOME) return true;
  try {
    const p1 = fs.realpathSync(process.argv[1]);
    const target = fs.realpathSync(fileURLToPath(metaUrl));
    return p1 === target || process.argv.some((a) => typeof a === 'string' && a.includes('server/index.js'));
  } catch {
    return process.argv.some((a) => typeof a === 'string' && a.includes('server/index.js'));
  }
}

/**
 * Print the boot banner of a started server.
 * @param {{ url: string, host: string, port: number, studio?: { pageUrl: (base: string) => string | null } | null }} srv
 */
export function printBanner(srv) {
  console.log(`\n  卫戍协议：盟约 · Stronghold Protocol: Alliance v${APP_VERSION}`);
  if (DEV_BUILD) console.log('  ! 开发版（dev 分支）：不稳定，请勿用于公开服务器 · development build — unstable, not for public servers');
  console.log(`  Local:   ${srv.url}`);
  if (srv.host === '0.0.0.0' || srv.host === '::') {
    for (const u of lanUrls(srv.port)) console.log(`  LAN:     ${u}`);
  }
  // the plugin studio with its key: what a change in it needs (a raw TCP tunnel looks like this machine; the key does not)
  const studio = srv.studio?.pageUrl?.(srv.url);
  if (studio) console.log(`  Studio:  ${studio}  (插件工作台 · plugin studio — this machine and the LAN; the link carries its key)`);
  console.log('  Internet: cloudflared tunnel --url ' + `http://localhost:${srv.port}` + '\n');
}

/**
 * How long a graceful shutdown may take before the process exits 1 anyway: SP_SHUTDOWN_TIMEOUT_MS, default 5 s — the
 * value the old hard-coded timer used. Only an explicit 1000–300000 ms is taken, so a typo keeps the default instead
 * of removing the guard.
 * @param {string | number | undefined} [value]
 * @returns {number} milliseconds
 */
export function shutdownTimeoutMs(value = process.env.SP_SHUTDOWN_TIMEOUT_MS) {
  const n = Number(value);
  return Number.isSafeInteger(n) && n >= 1_000 && n <= 300_000 ? n : 5_000;
}

/**
 * The SIGINT / SIGTERM handler: close the server, exit 0 when that finishes and 1 when the shutdown times out first.
 * A second signal exits at once. Returned as a handler so the caller and the tests drive the same code.
 * @param {{ close: () => Promise<void> }} srv
 * @param {object} [opts]
 * @param {(code: number) => void} [opts.exit] process.exit by default
 * @param {(ms: number, fn: () => void) => any} [opts.setTimer] setTimeout by default
 * @param {{ log?: (m: string) => void, error?: (m: string) => void }} [opts.out] console by default
 * @param {number} [opts.timeoutMs] shutdownTimeoutMs() by default
 * @returns {(signal: string) => void}
 */
export function shutdownHandler(srv, opts = {}) {
  const exit = opts.exit || ((code) => process.exit(code));
  const setTimer = opts.setTimer || ((ms, fn) => setTimeout(fn, ms).unref?.());
  const log = opts.out?.log || ((m) => console.log(m));
  const error = opts.out?.error || ((m) => console.error(m));
  const timeoutMs = opts.timeoutMs ?? shutdownTimeoutMs();
  let stopping = false;
  let finished = false;
  /** Exit once: whichever of the close, the timeout or the second signal gets there first. */
  const finish = (code) => { if (finished) return; finished = true; exit(code); };
  return (signal) => {
    if (stopping) { log('forced exit'); finish(1); return; }
    stopping = true;
    log(`\n[${signal}] shutting down…`);
    setTimer(timeoutMs, () => {
      if (finished) return;
      error(`[shutdown] timeout after ${timeoutMs} ms; exiting`);
      finish(1);
    });
    srv.close().then(() => finish(0), () => finish(1));
  };
}

/**
 * The process main: finish a pending update package, start the server, print the banner, stop gracefully on SIGINT /
 * SIGTERM.
 * @param {() => Promise<{ url: string, host: string, port: number, close: () => Promise<void> }>} start index.js startServer
 */
export async function runMain(start) {
  process.on('unhandledRejection', (e) => console.error('[process] unhandled rejection', e));
  process.on('uncaughtException', (e) => console.error('[process] uncaught exception', e));
  // before the data, the packs or the browser runtime are read: the files must be the new version's (server/update.js).
  // Nothing is listening yet, so returning ends the process with exit code 1 once the message is written.
  if (applyPendingUpdate(ROOT).state === 'failed') { process.exitCode = 1; return; }
  let srv;
  try {
    srv = await start();
  } catch (e) {
    if (e && e.code === 'EADDRINUSE') console.error(`端口已被占用 / port in use: ${e.port ?? process.env.PORT ?? 3000}. Try PORT=3001 npm start`);
    else console.error('[boot] failed to start', e);
    process.exit(1);
  }
  printBanner(srv);

  const stop = shutdownHandler(srv);
  process.on('SIGINT', () => stop('SIGINT'));
  process.on('SIGTERM', () => stop('SIGTERM'));
}

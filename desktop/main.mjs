// Desktop entry (handoff/desktop-electron/packaging.md). Electron's main process, and the only entry the packaged app
// runs: it **imports** `startServer()` from ../server/index.js.
//
// It must never fork / spawn server/index.js: that file's `isProcessEntry` guard sends a process entry through
// `runMain()` → `applyPendingUpdate(ROOT)`, which rewrites files inside the installation directory (§2.2) — an
// unacceptable self-destruct path for a desktop app. Importing it is safe: the guard keeps it from listening by itself.
import { app, BrowserWindow, Menu, ipcMain, shell } from 'electron';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { APP_VERSION } from '../shared/constants.js';
import { startServer } from '../server/index.js';
import { pickPort } from './port.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const LAUNCHER = path.join(HERE, 'launcher.html');

// The two cards of the startup page. The wording mirrors the Android APK's own server dialog
// (android/app/src/main/res/values/strings.xml: 单人单机模式 / 远程联机模式 / 网络与服务器设置), so the desktop build
// does not invent a second vocabulary for the same choice.
const LINKS = Object.freeze({
  local: 'http://127.0.0.1:3000/',
  remote: 'https://wei.jiangjiangze.icu/',
  backup: 'http://121.4.51.247/',
});

/** @type {BrowserWindow | null} */
let win = null;
/** @type {Awaited<ReturnType<typeof startServer>> | null} */
let srv = null;
/** @type {Promise<{ ok: boolean, url?: string, port?: number, error?: string }> | null} */
let starting = null;

// A room's match host defaults to `child_process.fork(process.execPath)`, and in Electron that is electron.exe (which
// cannot take the child host's `--permission` flags). A worker thread keeps the desktop app self-contained; the cost is
// that an out-of-memory abort in a worker ends the whole app (server/match/host/index.js header). Set by the host
// environment to override.
if (!process.env.SP_MATCH_HOST) process.env.SP_MATCH_HOST = 'worker';

/**
 * Start the local server in this process, on the first free port of 3000…3010 (then any port).
 * @returns {Promise<{ ok: boolean, url?: string, port?: number, error?: string }>}
 */
async function startLocal() {
  if (srv) return { ok: true, url: `http://127.0.0.1:${srv.port}/`, port: srv.port };
  if (starting) return starting;
  starting = (async () => {
    const first = await pickPort();
    const candidates = first === 0 ? [0] : [...new Set([first, ...Array.from({ length: 11 }, (_, i) => 3000 + i), 0])];
    let lastError = null;
    for (const port of candidates) {
      try {
        // Loopback only: the local card is a single-machine server, and binding `::` makes Windows pop a firewall
        // prompt on first run (§2.2). A LAN host sets HOST=0.0.0.0 itself.
        srv = await startServer({ port, host: '127.0.0.1', quiet: true });
        console.log(`[desktop] local server ${srv.url}`);
        return { ok: true, url: `http://127.0.0.1:${srv.port}/`, port: srv.port };
      } catch (cause) {
        lastError = cause;
        console.warn(`[desktop] port ${port} refused: ${cause && cause.message}`);
      }
    }
    return { ok: false, error: String((lastError && lastError.message) || lastError || 'no port') };
  })();
  try {
    return await starting;
  } finally {
    starting = null;
  }
}

/** Close the in-process server (the remote card does this before it connects). */
async function stopLocal() {
  if (!srv) return;
  const running = srv;
  srv = null;
  try {
    await running.close();
    console.log('[desktop] local server closed');
  } catch (cause) {
    console.warn(`[desktop] close failed: ${cause && cause.message}`);
  }
}

/**
 * Show a remote server, stopping the local one first (§"连远程时停本地").
 * @param {string} raw the address typed on the second card
 */
async function connectRemote(raw) {
  const text = String(raw || '').trim() || LINKS.remote;
  let url;
  try {
    url = new URL(text);
  } catch {
    return { ok: false, error: `invalid url: ${text}` };
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return { ok: false, error: `unsupported: ${url.protocol}` };
  await stopLocal();
  await win?.loadURL(url.href);
  return { ok: true, url: url.href };
}

function showLauncher() {
  return win?.loadFile(LAUNCHER);
}

function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 620,
    backgroundColor: '#0b0d12',
    title: `卫戍协议：盟约 v${APP_VERSION}`,
    show: false,
    webPreferences: {
      preload: path.join(HERE, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  win.once('ready-to-show', () => win?.show());
  // Links inside the game open in the player's own browser, never in a second Electron window.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.on('closed', () => {
    win = null;
  });
  return win;
}

function buildMenu() {
  // The only new chrome: a way back to the startup page after a server is loaded (the loaded page has no desktop
  // bridge on purpose — preload.mjs only exposes it to file:// pages). The label reuses the APK's own string.
  const menu = Menu.buildFromTemplate([
    {
      label: '网络与服务器设置',
      submenu: [{ label: '网络与服务器设置', accelerator: 'CmdOrCtrl+Shift+L', click: () => showLauncher() }, { role: 'quit' }],
    },
  ]);
  Menu.setApplicationMenu(menu);
}

// The bridge belongs to the launcher only. A remote server's own page is loaded in this same window, and a page from
// the Internet must never be able to start a server or navigate the shell, so every handler checks the sender's origin
// (the preload's sandbox cannot be trusted to describe itself).
const fromLauncher = (event) => String(event.senderFrame?.url || '').startsWith('file://');
const launcherOnly = (handler) => (event, ...args) => (fromLauncher(event) ? handler(...args) : { ok: false, error: 'not the launcher' });

ipcMain.handle('desktop:info', () => ({
  version: APP_VERSION,
  local: LINKS.local,
  remote: LINKS.remote,
  backup: LINKS.backup,
}));
ipcMain.handle('desktop:start-local', launcherOnly(() => startLocal()));
ipcMain.handle('desktop:connect-remote', launcherOnly((url) => connectRemote(url)));
ipcMain.handle('desktop:launcher', launcherOnly(() => showLauncher()));
ipcMain.handle('desktop:open-external', launcherOnly((url) => {
  if (/^https?:/.test(String(url))) shell.openExternal(String(url));
  return { ok: true };
}));

if (!app.requestSingleInstanceLock()) {
  // A second launch focuses the first window instead of racing it for port 3000.
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.focus();
  });

  app.whenReady().then(async () => {
    buildMenu();
    const w = createWindow();
    // `--sp-screenshot=` first: bare `--screenshot` is Chromium's own headless switch and a launcher that inherits
    // ELECTRON_RUN_AS_NODE (the DSH host exports it) hands the whole argv to Node, which rejects it as "bad option".
    const shotArg = process.argv.find((arg) => arg.startsWith('--sp-screenshot=') || arg.startsWith('--screenshot='));
    const shotPath = shotArg ? shotArg.slice(shotArg.indexOf('=') + 1) : null;
    const delayArg = process.argv.find((arg) => arg.startsWith('--sp-shot-delay='));
    const shotDelay = delayArg ? Number(delayArg.slice('--sp-shot-delay='.length)) || 5000 : 5000;
    const localFirst = process.argv.includes('--local');

    if (localFirst) {
      const result = await startLocal();
      if (result.ok) await w.loadURL(result.url);
      else await w.loadFile(LAUNCHER);
    } else {
      await w.loadFile(LAUNCHER);
    }
    if (shotPath) console.log(`[desktop] window url ${w.webContents.getURL()}`);

    if (shotPath) {
      // Smoke-test hook (packaging.md §7: the native window is not otherwise capturable): the page has already
      // finished loading above, so give its art and fonts a moment, capture the real Electron window, then exit.
      // `--local` is what a player does with the highlighted first card.
      setTimeout(async () => {
        try {
          const image = await w.webContents.capturePage();
          await writeFile(shotPath, image.toPNG());
          console.log(`[desktop] screenshot ${shotPath}`);
        } catch (cause) {
          console.error(`[desktop] screenshot failed: ${cause && cause.message}`);
        } finally {
          await stopLocal();
          app.quit();
        }
      }, shotDelay);
    }
  });

  app.on('window-all-closed', async () => {
    await stopLocal();
    app.quit();
  });
}

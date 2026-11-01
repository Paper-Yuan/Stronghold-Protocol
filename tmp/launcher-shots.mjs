// Throwaway smoke driver for the packaged desktop launcher (handoff/desktop-electron/packaging.md §7).
// Attaches over CDP to the real packaged app, emulates the two acceptance viewports, captures them at native size and
// measures the two-card geometry. Not part of the product.
//
//   node tmp/launcher-shots.mjs <path-to-exe>
import { spawn, spawnSync } from 'node:child_process';
import path from 'node:path';
import { mkdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import puppeteer from 'puppeteer-core';

const ROOT = path.resolve(import.meta.dirname, '..');
const EXE = process.argv[2] || 'E:\\Workbox\\release-desktop\\win-unpacked\\Stronghold Protocol.exe';
const SHOTS = path.join(ROOT, 'handoff', 'shots');
const PORT = Number(process.env.SP_CDP_PORT || 9445);
const SIZES = [
  { w: 792, h: 360, file: 'desktop-launcher-design-792x360.png' },
  { w: 1280, h: 720, file: 'desktop-launcher-design-1280x720.png' },
];

if (!existsSync(EXE)) {
  console.error(`missing exe: ${EXE}`);
  process.exit(2);
}
mkdirSync(SHOTS, { recursive: true });

// NOT %TEMP%: this shell's subprocess sandbox refuses the app's single-instance lock / cache writes there (Chromium
// then fails requestSingleInstanceLock and the app quits before the window shows). A directory under E:\Workbox is
// writable, which is how the earlier desktop smokes ran too.
const ud = process.env.SP_UD || path.join('E:\\Workbox', `sp-ud-launcher-${Date.now()}`);
mkdirSync(ud, { recursive: true });

// Detached and with no inherited handles. `--no-sandbox` is this shell's restriction, not something a player needs.
// (A `cmd /c start` wrapper was tried first and never launched the app: node double-quotes the already-quoted exe path.)
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(EXE, ['--no-sandbox', `--user-data-dir=${ud}`, `--remote-debugging-port=${PORT}`], {
  env,
  stdio: 'ignore',
  detached: true,
});
child.unref();
const killApp = () => {
  try {
    spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
  } catch {
    /* ignore */
  }
  spawnSync('taskkill', ['/IM', 'Stronghold Protocol.exe', '/T', '/F'], { stdio: 'ignore' });
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let browser = null;
for (let i = 0; i < 90; i++) {
  try {
    browser = await puppeteer.connect({ browserURL: `http://127.0.0.1:${PORT}`, defaultViewport: null });
    break;
  } catch {
    await sleep(1000);
  }
}
if (!browser) {
  console.error('could not attach over CDP');
  killApp();
  process.exit(3);
}

const pages = await browser.pages();
const page = pages.find((p) => p.url().startsWith('file://')) || pages[0];
await page.waitForFunction(() => document.readyState === 'complete' && document.getElementById('ver')?.textContent, { timeout: 90000 });

const report = { exe: EXE, userDataDir: ud, url: page.url(), title: await page.title(), sizes: [] };
for (const { w, h, file } of SIZES) {
  await page.setViewport({ width: w, height: h, deviceScaleFactor: 1 });
  await sleep(1200); // the local card's 4s glow loop; let the first paint settle
  await page.screenshot({ path: path.join(SHOTS, file) });
  const geo = await page.evaluate(() => {
    const box = (el) => {
      const r = el.getBoundingClientRect();
      return { x: +r.x.toFixed(1), y: +r.y.toFixed(1), w: +r.width.toFixed(1), h: +r.height.toFixed(1) };
    };
    const cards = [...document.querySelectorAll('.card')].map((el) => ({ cls: el.className, ...box(el) }));
    const targets = ['btn-local', 'btn-remote', 'btn-backup'].map((id) => ({ id, ...box(document.getElementById(id)) }));
    const de = document.documentElement;
    return {
      viewport: { w: innerWidth, h: innerHeight },
      rem: getComputedStyle(de).fontSize,
      scroll: { sw: de.scrollWidth, sh: de.scrollHeight, cw: de.clientWidth, ch: de.clientHeight, bodySh: document.body.scrollHeight },
      cards,
      sideBySide: Math.abs(cards[0].y - cards[1].y) < 1 && cards[0].x + cards[0].w <= cards[1].x,
      noWrap: cards[0].y === cards[1].y && cards[0].h === cards[1].h,
      noHorizontalScroll: de.scrollWidth <= de.clientWidth && document.body.scrollWidth <= innerWidth,
      cardOverflow: [...document.querySelectorAll('.card')].map((c) => c.scrollHeight - c.clientHeight),
      targets,
      targetsMin: Math.min(...targets.map((t) => Math.min(t.w, t.h))),
      activeElement: document.activeElement?.id || document.activeElement?.tagName,
      activeInLocalCard: !!document.activeElement?.closest?.('.card--local'),
      version: document.getElementById('ver').textContent,
      localAddr: document.getElementById('local-addr').textContent,
      remotePrefill: document.getElementById('remote-url').value,
      backup: document.getElementById('btn-backup').textContent,
      cardDefault: document.querySelector('.card--default') === document.querySelector('.card--local'),
      titles: [document.getElementById('local-title').textContent, document.getElementById('remote-title').textContent],
    };
  });
  report.sizes.push({ size: `${w}x${h}`, file, ...geo });
}

await browser.disconnect();
killApp();
await sleep(1200);
console.log(JSON.stringify(report, null, 2));

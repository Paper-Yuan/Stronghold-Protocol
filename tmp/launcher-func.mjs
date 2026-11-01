// Throwaway: functional smoke of the packaged launcher — the 本机 card must still start the in-process server over IPC
// and navigate the same window. Also eyeballs the default window size (1280×800). Not part of the product.
//
//   node tmp/launcher-func.mjs <path-to-exe>
import { spawn, spawnSync } from 'node:child_process';
import path from 'node:path';
import { mkdirSync, existsSync } from 'node:fs';
import puppeteer from 'puppeteer-core';

const ROOT = path.resolve(import.meta.dirname, '..');
const EXE = process.argv[2] || 'E:\\Workbox\\release-desktop\\win-unpacked\\Stronghold Protocol.exe';
const PORT = Number(process.env.SP_CDP_PORT || 9447);
const ud = path.join('E:\\Workbox', `sp-ud-func-${Date.now()}`);

if (!existsSync(EXE)) {
  console.error(`missing exe: ${EXE}`);
  process.exit(2);
}
mkdirSync(ud, { recursive: true });

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(EXE, ['--no-sandbox', `--user-data-dir=${ud}`, `--remote-debugging-port=${PORT}`], {
  env,
  stdio: 'ignore',
  detached: true,
});
child.unref();
const killApp = () => {
  spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
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
await page.waitForFunction(() => document.getElementById('ver')?.textContent, { timeout: 90000 });

const report = { before: page.url() };
// default window size (main.mjs: 1280×800) — what a player actually sees first
await sleep(600);
await page.screenshot({ path: path.join(ROOT, 'tmp', 'default-window.png') });

await page.click('#btn-local');
for (let i = 0; i < 240; i++) {
  if (/^http:\/\/127\.0\.0\.1:/.test(page.url())) break;
  await sleep(500);
}
report.after = page.url();
report.status = await page.evaluate(() => document.getElementById('status')?.textContent ?? null).catch(() => null);
report.busyLabel = report.status;

await browser.disconnect();
killApp();
await sleep(1500);
console.log(JSON.stringify(report, null, 2));

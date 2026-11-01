// Throwaway: launches the packaged app with --local (main.mjs's own "start the server and show it" path) and reports the
// URL the window ends up on, i.e. that the packaged server really boots. Not part of the product.
import { spawn, spawnSync } from 'node:child_process';
import path from 'node:path';
import { mkdirSync } from 'node:fs';
import puppeteer from 'puppeteer-core';

const EXE = 'E:\\Workbox\\release-desktop\\win-unpacked\\Stronghold Protocol.exe';
const PORT = 9448;
const ud = path.join('E:\\Workbox', `sp-ud-local-${Date.now()}`);
mkdirSync(ud, { recursive: true });
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(EXE, ['--no-sandbox', '--local', `--user-data-dir=${ud}`, `--remote-debugging-port=${PORT}`], {
  env,
  stdio: 'ignore',
  detached: true,
});
child.unref();
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
const pages = await browser.pages();
const page = pages.find((p) => p.url().startsWith('http')) || pages[0];
for (let i = 0; i < 60; i++) {
  if (/^http:\/\/127\.0\.0\.1:/.test(page.url())) break;
  await sleep(1000);
}
await page.waitForFunction(() => document.readyState === 'complete', { timeout: 120000 }).catch(() => null);
await sleep(4000);
console.log(JSON.stringify({ url: page.url(), title: await page.title(), hasApp: await page.evaluate(() => !!document.querySelector('canvas, #app, .hall, main')) }, null, 2));
await browser.disconnect();
spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
spawnSync('taskkill', ['/IM', 'Stronghold Protocol.exe', '/T', '/F'], { stdio: 'ignore' });

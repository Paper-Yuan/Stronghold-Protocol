// Throwaway probe #2: zoomed crops for focus/hover/connecting states. Not part of the product.
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import puppeteer from 'puppeteer-core';

const ROOT = path.resolve(import.meta.dirname, '..');
const PAGE = pathToFileURL(path.join(ROOT, 'desktop', 'launcher.html')).href;
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';

const browser = await puppeteer.launch({
  executablePath: EDGE,
  headless: true,
  args: ['--no-sandbox', '--allow-file-access-from-files', '--hide-scrollbars', '--force-device-scale-factor=2'],
  defaultViewport: null,
});
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 720, deviceScaleFactor: 2 });
await page.evaluateOnNewDocument(() => {
  window.desktop = {
    info: async () => ({ version: '0.3.3-Yuan', local: 'http://127.0.0.1:3000/', remote: 'https://wei.jiangjiangze.icu/', backup: 'http://121.4.51.247/' }),
    startLocal: async () => ({ ok: true }),
    connectRemote: async () => ({ ok: true }),
  };
});
await page.goto(PAGE, { waitUntil: 'load' });
await page.waitForFunction(() => document.getElementById('ver')?.textContent);
await new Promise((r) => setTimeout(r, 400));

// 1. focus ring on the default-focused local button
await page.screenshot({ path: path.join(ROOT, 'tmp', 'zoom-focus.png'), clip: { x: 110, y: 460, width: 520, height: 100 } });

// 2. hover the local button
await page.hover('#btn-local');
await new Promise((r) => setTimeout(r, 260));
await page.screenshot({ path: path.join(ROOT, 'tmp', 'zoom-hover.png'), clip: { x: 110, y: 460, width: 520, height: 100 } });

// 3. connecting state on the remote card
await page.evaluate(() => document.getElementById('remote-card').setAttribute('data-state', 'connecting'));
await new Promise((r) => setTimeout(r, 300));
await page.screenshot({ path: path.join(ROOT, 'tmp', 'zoom-connecting.png'), clip: { x: 650, y: 260, width: 520, height: 320 } });

// 4. keyboard focus on the remote card
await page.evaluate(() => { document.getElementById('remote-card').removeAttribute('data-state'); document.getElementById('btn-remote').focus(); });
await new Promise((r) => setTimeout(r, 300));
await page.screenshot({ path: path.join(ROOT, 'tmp', 'zoom-focus-remote.png'), clip: { x: 650, y: 460, width: 520, height: 100 } });

await browser.close();
console.log('ok');

// Throwaway: confirms the ambient bitmap really loads under the page's CSP (img-src) and that no CSP violation is
// reported. Not part of the product.
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import puppeteer from 'puppeteer-core';

const ROOT = path.resolve(import.meta.dirname, '..');
const PAGE = pathToFileURL(path.join(ROOT, 'desktop', 'launcher.html')).href;
const browser = await puppeteer.launch({
  executablePath: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  headless: true,
  args: ['--no-sandbox', '--allow-file-access-from-files', '--hide-scrollbars'],
  defaultViewport: null,
});
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 720, deviceScaleFactor: 1 });
const logs = [];
page.on('console', (m) => logs.push(`${m.type()}: ${m.text()}`));
page.on('pageerror', (e) => logs.push(`pageerror: ${e.message}`));
await page.evaluateOnNewDocument(() => {
  window.desktop = {
    info: async () => ({ version: '0.3.3-Yuan', local: 'http://127.0.0.1:3000/', remote: 'https://wei.jiangjiangze.icu/', backup: 'http://121.4.51.247/' }),
    startLocal: async () => ({ ok: true }),
    connectRemote: async () => ({ ok: true }),
  };
});
await page.goto(PAGE, { waitUntil: 'load' });
await new Promise((r) => setTimeout(r, 1500));
const res = await page.evaluate(async () => {
  const url = new URL('../public/assets/local/map/autochess/TX_autochessi_BG.webp', location.href).href;
  const probe = await new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve({ ok: true, w: img.naturalWidth, h: img.naturalHeight });
    img.onerror = () => resolve({ ok: false });
    img.src = url;
  });
  return {
    probe,
    resources: performance.getEntriesByType('resource').map((e) => e.name.split('/').pop()),
    photoBg: getComputedStyle(document.querySelector('.app-photo')).backgroundImage.slice(0, 80),
    font: getComputedStyle(document.body).fontFamily.slice(0, 40),
  };
});
await browser.close();
console.log(JSON.stringify({ ...res, logs }, null, 2));

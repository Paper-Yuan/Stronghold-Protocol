// Throwaway probe: renders desktop/launcher.html in Edge (headless) with a stubbed window.desktop so the visual layer and
// the two-card geometry can be measured without packaging. Not part of the product.
//   node tmp/launcher-probe.mjs
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import puppeteer from 'puppeteer-core';

const ROOT = path.resolve(import.meta.dirname, '..');
const PAGE = pathToFileURL(path.join(ROOT, 'desktop', 'launcher.html')).href;
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const SIZES = [
  { w: 1280, h: 720 },
  { w: 792, h: 360 },
];

const browser = await puppeteer.launch({
  executablePath: EDGE,
  headless: true,
  args: ['--no-sandbox', '--allow-file-access-from-files', '--hide-scrollbars', '--force-device-scale-factor=1'],
  defaultViewport: null,
});

const stub = () => {
  window.desktop = {
    info: async () => ({
      version: '0.3.3-Yuan',
      local: 'http://127.0.0.1:3000/',
      remote: 'https://wei.jiangjiangze.icu/',
      backup: 'http://121.4.51.247/',
    }),
    startLocal: async () => ({ ok: true, url: 'http://127.0.0.1:3000/' }),
    connectRemote: async () => ({ ok: true }),
  };
};

const out = [];
for (const { w, h } of SIZES) {
  const page = await browser.newPage();
  await page.setViewport({ width: w, height: h, deviceScaleFactor: 1 });
  await page.evaluateOnNewDocument(stub);
  await page.goto(PAGE, { waitUntil: 'load' });
  await page.waitForFunction(() => document.getElementById('ver')?.textContent, { timeout: 10000 });
  await new Promise((r) => setTimeout(r, 600));
  await page.screenshot({ path: path.join(ROOT, 'tmp', `probe-${w}x${h}.png`) });
  const geo = await page.evaluate(() => {
    const box = (el) => {
      const r = el.getBoundingClientRect();
      return { x: +r.x.toFixed(1), y: +r.y.toFixed(1), w: +r.width.toFixed(1), h: +r.height.toFixed(1) };
    };
    const cards = [...document.querySelectorAll('.card')].map(box);
    const btns = ['btn-local', 'btn-remote', 'btn-backup'].map((id) => ({ id, ...box(document.getElementById(id)) }));
    const de = document.documentElement;
    return {
      viewport: { w: innerWidth, h: innerHeight },
      scroll: { sw: de.scrollWidth, sh: de.scrollHeight, cw: de.clientWidth, ch: de.clientHeight },
      rem: getComputedStyle(de).fontSize,
      cards,
      sameRow: Math.abs(cards[0].y - cards[1].y) < 1 && cards[0].x + cards[0].w <= cards[1].x,
      btns,
      activeElement: document.activeElement?.id || document.activeElement?.tagName,
      status: document.getElementById('status').textContent,
      overflowY: document.body.scrollHeight > innerHeight,
      inCardOverflow: [...document.querySelectorAll('.card')].map((c) => c.scrollHeight > c.clientHeight + 1),
    };
  });
  out.push({ size: `${w}x${h}`, ...geo });
  await page.close();
}
await browser.close();
console.log(JSON.stringify(out, null, 2));

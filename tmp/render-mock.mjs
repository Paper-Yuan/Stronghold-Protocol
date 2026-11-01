// Throwaway: renders the approved design mock (handoff/desktop-electron/mock-choice.html) at the two acceptance
// viewports so the comparison image uses the same engine/fonts as the production shots. Not part of the product.
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import puppeteer from 'puppeteer-core';

const ROOT = path.resolve(import.meta.dirname, '..');
const PAGE = pathToFileURL(path.join(ROOT, 'handoff', 'desktop-electron', 'mock-choice.html')).href;
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';

const browser = await puppeteer.launch({
  executablePath: EDGE,
  headless: true,
  args: ['--no-sandbox', '--allow-file-access-from-files', '--hide-scrollbars', '--force-device-scale-factor=1'],
  defaultViewport: null,
});
for (const [w, h] of [[1280, 720], [792, 360]]) {
  const page = await browser.newPage();
  await page.setViewport({ width: w, height: h, deviceScaleFactor: 1 });
  await page.goto(PAGE, { waitUntil: 'load' });
  await new Promise((r) => setTimeout(r, 1200));
  await page.screenshot({ path: path.join(ROOT, 'tmp', `mock-${w}x${h}.png`) });
  await page.close();
}
await browser.close();
console.log('ok');

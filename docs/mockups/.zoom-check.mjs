// 临时：把已产出的 PNG 局部放大，确认圆标/卡片/图例条的实际关系。用完即删。
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
if (!process.env.CHROME_PATH) {
  const hit = [path.join(process.env.LOCALAPPDATA || '', 'Google/Chrome/Application/chrome.exe')]
    .find((p) => p && existsSync(p));
  if (hit) process.env.CHROME_PATH = hit;
}
const puppeteer = (await import('puppeteer-core')).default;

const jobs = [
  ['mod-ui-alliances-phone.png', 844, { x: 0, y: 130, w: 270, h: 190 }, 3.2, 'zoom-phone-bottomleft.png'],
  ['mod-ui-alliances-phone.png', 844, { x: 262, y: 84, w: 300, h: 100 }, 5, 'zoom-phone-members.png'],
  ['mod-ui-alliances-web.png', 1920, { x: 890, y: 505, w: 300, h: 130 }, 4, 'zoom-web-members.png'],
];
const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH, headless: true, args: ['--no-sandbox', '--hide-scrollbars'] });
try {
  for (const [file, srcW, c, z, outName] of jobs) {
    const png = path.join(HERE, file);
    const b64 = readFileSync(png).toString('base64');
    const page = await browser.newPage();
    const W = Math.round(c.w * z), H = Math.round(c.h * z);
    await page.setViewport({ width: W, height: H, deviceScaleFactor: 1 });
    await page.setContent(`<style>html,body{margin:0;padding:0;overflow:hidden}</style><img src="data:image/png;base64,${b64}" style="position:absolute;left:${-c.x * z}px;top:${-c.y * z}px;width:${srcW * z}px;image-rendering:pixelated">`);
    await new Promise((r) => setTimeout(r, 300));
    await page.screenshot({ path: path.join(HERE, outName), clip: { x: 0, y: 0, width: W, height: H } });
    console.log('wrote', outName, `${W}x${H}`);
    await page.close();
  }
} finally { await browser.close(); }

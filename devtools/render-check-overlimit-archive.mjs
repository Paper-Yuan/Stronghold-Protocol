// devtools/render-check-overlimit-archive.mjs — 结算页「超限档案」浮层的真浏览器检查
//
//   SP_BASE=http://127.0.0.1:3019 SP_VIEWPORT=1280x720 node devtools/render-check-overlimit-archive.mjs
import fs from 'node:fs';
import puppeteer from 'puppeteer-core';

const CHROME = process.env.SP_CHROME || 'C:/Users/J1825/AppData/Local/Google/Chrome/Application/chrome.exe';
const BASE = process.env.SP_BASE || 'http://127.0.0.1:3019';
const OUT = 'E:/Workbox/.session-dump/shots';
const [vw, vh] = (process.env.SP_VIEWPORT || '1280x720').split('x').map((n) => Math.max(1, Math.round(Number(n) || 0)));
fs.mkdirSync(OUT, { recursive: true });

const browser = await puppeteer.launch({
  executablePath: CHROME, headless: 'new',
  args: ['--no-sandbox', '--disable-gpu', `--window-size=${vw},${vh}`],
});
const page = await browser.newPage();
await page.setViewport({ width: vw, height: vh });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
const EXTERNAL = /(ganxiemingdan\.jiangjiangze\.icu|fonts\.googleapis\.com|fonts\.gstatic\.com)/;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

await page.goto(BASE + '/', { waitUntil: 'domcontentloaded', timeout: 60000 });
await wait(1600);

const res = await page.evaluate(async () => {
  try { localStorage.setItem('sp.overlimit.best', '30'); } catch {}
  const { render } = await import('/vendor/preact.module.js');
  const { html } = await import('/js/ui/components.js');
  const { OverlimitArchive } = await import('/js/screens/settle.js');
  const host = document.createElement('div');
  host.className = 'screen result settle';
  Object.assign(host.style, { position: 'fixed', inset: '0', zIndex: '9999' });
  document.body.append(host);
  let closed = false;
  const data = {
    maxRound: 45,
    bossKills: [
      { round: 20, phase: 1, id: 'boss_9', name: '猩红血钻' },
      { round: 25, phase: 1, id: 'boss_8', name: '昆图斯' },
      { round: 30, phase: 1, id: 'boss_7', name: '“巨大的丑东西”' },
      { round: 40, phase: 1, id: 'boss_6', name: '凋零骑士' },
      { round: 45, phase: 1, id: 'boss_5', name: '杰斯顿 · “狼之主”' },
      { round: 45, phase: 2, id: 'boss_4', name: '腐败骑士' },
    ],
    traitMods: [
      { round: 20, id: 'assault', name: '强攻', polarity: 'pos' },
      { round: 25, id: 'agile', name: '灵巧', polarity: 'pos' },
      { round: 30, id: 'weak', name: '虚弱', polarity: 'neg' },
      { round: 35, id: 'regen', name: '再生', polarity: 'pos' },
      { round: 40, id: 'slow', name: '迟滞', polarity: 'neg' },
      { round: 45, id: 'symbiosis', name: '共栖', polarity: 'pos' },
    ],
    maxLayers: [{ id: 'yanShip', name: '炎', layers: 1200 }, { id: 'victoriaShip', name: '维多利亚', layers: 750 }],
    bestBond: { id: 'yanShip', name: '炎', layers: 1200 },
  };
  render(html`<${OverlimitArchive} data=${data} onClose=${() => { closed = true; }} />`, host);
  await new Promise((r) => setTimeout(r, 350));
  const card = host.querySelector('.olarch__card');
  const r = card ? card.getBoundingClientRect() : null;
  const out = {
    card: !!card,
    rect: r ? { w: Math.round(r.width), h: Math.round(r.height), top: Math.round(r.top), bottom: Math.round(r.bottom) } : null,
    inside: r ? r.left >= 0 && r.top >= 0 && r.right <= innerWidth + 1 && r.bottom <= innerHeight + 1 : false,
    newRecord: !!host.querySelector('.olarch__new'),
    kills: host.querySelectorAll('.olarch__kills li').length,
    chips: host.querySelectorAll('.olarch__chip').length,
    best: host.querySelector('#nope') ? null : null,
  };
  host.querySelector('.olarch__x')?.click();
  out.closed = closed;
  await new Promise((r) => setTimeout(r, 50));
  host.remove();
  return out;
});
console.log('archive:', JSON.stringify(res));
await page.screenshot({ path: `${OUT}/olarch-${vw}x${vh}.png` });

const own = errors.filter((e) => !EXTERNAL.test(e));
console.log('errors:', own.length);
for (const e of [...new Set(own)].slice(0, 8)) console.log('  ' + e);
await browser.close();

const ok = res.card && res.inside && res.newRecord && res.kills === 6 && res.chips === 6 && res.closed && own.length === 0;
console.log('\nRESULT:', ok ? `OK — 超限档案浮层在 ${vw}×${vh} 渲染/关闭正常` : 'CHECK ABOVE');
process.exit(ok ? 0 : 1);

// devtools/render-check-sweep-overlimit.mjs — S.W.E.E.P. 报告「超限视图 → 盟约报告」的真实浏览器检查
// （业主 2026-11-01 回填：五条改写盟约不再显示「超限专属：待定」，面板给出 data/bonds.json `inf` 块里的超限行）。
//
//   SP_BASE=http://127.0.0.1:3170 node devtools/render-check-sweep-overlimit.mjs
//
// 流程与真机一致：大厅登录 → 独立模拟 → 难度列表末项「超限模拟」→ 打开 S.W.E.E.P. 报告（大厅把 variant=overlimit
// 交给报告）→ 盟约页 → 点「拉特兰」。同一页同一状态改视口，各截一张 792×630 / 1920×1080。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const CHROME = process.env.SP_CHROME || 'C:/Users/J1825/AppData/Local/Google/Chrome/Application/chrome.exe';
const BASE = process.env.SP_BASE || 'http://127.0.0.1:3170';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'handoff', 'shots');
// SP_SHOT_PREFIX re-shoots the same page under another name (2026-11-01: 「改成什么效果，文案就写什么」那一轮拍 v2)
const PREFIX = process.env.SP_SHOT_PREFIX || 'sweep-overlimit-bonds';
const SHOTS = [
  { name: `${PREFIX}-792x630.png`, width: 792, height: 630 },
  { name: `${PREFIX}-1920x1080.png`, width: 1920, height: 1080 },
];
fs.mkdirSync(OUT, { recursive: true });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: CHROME, headless: 'new',
  args: ['--no-sandbox', '--disable-gpu', '--window-size=1920,1080'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 1 });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
const EXTERNAL = /(ganxiemingdan\.jiangjiangze\.icu|fonts\.googleapis\.com|fonts\.gstatic\.com)/;

await page.goto(BASE + '/', { waitUntil: 'domcontentloaded', timeout: 60000 });
await wait(1600);
await page.evaluate(async () => {
  const i = document.querySelector('.title-login input, input[type="text"]');
  i.value = `sweep-ol-${Math.floor(Math.random() * 900 + 100)}`;
  i.dispatchEvent(new Event('input', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 120));
  [...document.querySelectorAll('button')].find((b) => /开始/.test(b.textContent || ''))?.click();
});
await wait(2400);
await page.evaluate(() => document.querySelector('.mode-card[data-mode="solo"]')?.click());
await wait(700);
await page.evaluate(() => document.querySelector('.proto-list__special .diff-card')?.click());
await wait(700);
await page.evaluate(() => document.querySelector('.lobby-sweep')?.click());
await wait(1400);

const opened = await page.evaluate(() => {
  const report = document.querySelector('.sw');
  const view = [...document.querySelectorAll('.sw-var')].find((b) => b.dataset.variant === 'overlimit');
  const tab = [...document.querySelectorAll('.sw-tab')].find((b) => /盟约报告/.test(b.textContent || ''));
  return {
    report: !!report,
    overlimitOn: view ? view.getAttribute('aria-pressed') : null,
    tab: tab ? tab.getAttribute('aria-selected') : null,
    banner: (document.querySelector('.sw-banner__txt') || {}).textContent || '',
  };
});
console.log('opened:', JSON.stringify(opened));

// 五条回填项逐条点开：每条都应读到自己的 `inf` 行（不是同一条、也不是空块）
const FIVE = ['阿戈尔', '拉特兰', '维多利亚', '萨尔贡', '叙拉古'];
const perBond = [];
for (const n of FIVE) {
  await page.evaluate((name) => {
    const tile = [...document.querySelectorAll('.sw-tile')].find((t) => (t.textContent || '').includes(name));
    tile?.click();
  }, n);
  await wait(500);
  perBond.push(await page.evaluate(() => ({
    name: (document.querySelector('.sw-hero__name') || {}).textContent || '',
    lines: [...document.querySelectorAll('.sw-inf__line')].map((p) => (p.textContent || '').trim()),
    nums: [...document.querySelectorAll('.sw-inf__line .olb-num')].map((n) => (n.textContent || '').trim()),
  })));
}
console.log('five:', JSON.stringify(perBond, null, 1));

// 截图停在「拉特兰 超限」（五条之一，面板给出 +8% 不设上限那句）
const picked = await page.evaluate(() => {
  const tile = [...document.querySelectorAll('.sw-tile')].find((t) => /拉特兰/.test(t.textContent || ''));
  tile?.click();
  return { clicked: !!tile };
});
console.log('picked:', JSON.stringify(picked));
await wait(800);

const panel = await page.evaluate(() => {
  const q = (s) => document.querySelector(s);
  const lines = [...document.querySelectorAll('.sw-inf__line')].map((p) => (p.textContent || '').trim());
  // 业主 2026-11-01：强化行只染数值片段 —— 真实 DOM 里数一遍强调节点、量一遍颜色（不是读源码猜）
  const line = q('.sw-inf__line');
  const numNodes = [...document.querySelectorAll('.sw-inf__line .olb-num')];
  const direct = line ? [...line.childNodes].filter((n) => n.nodeType === 3 && (n.nodeValue || '').trim()) : [];
  return {
    name: (q('.sw-hero__name') || {}).textContent || '',
    banner: (q('.sw-banner__txt') || {}).textContent || '',
    live: (q('.sw-banner__live') || {}).textContent || '',
    infBlock: !!q('.sw-inf'),
    heading: (q('.sw-inf__h') || {}).textContent || '',
    lines,
    numNodes: numNodes.length,
    numTexts: numNodes.map((n) => (n.textContent || '').trim()),
    numColor: numNodes[0] ? getComputedStyle(numNodes[0]).color : null,
    lineColor: line ? getComputedStyle(line).color : null,
    plainTextNodes: direct.length,
    plainText: direct.map((n) => (n.nodeValue || '').trim()).join('|'),
    pendingTiles: document.querySelectorAll('.sw-tile--pending').length,
    overlimitTiles: [...document.querySelectorAll('.sw-tile')].filter((t) => /超限/.test(t.textContent || '')).length,
    descHasMark: /【超限模拟】/.test((q('.sw-text .rt') || {}).textContent || ''),
  };
});
console.log('panel:', JSON.stringify(panel, null, 2));

const shots = [];
for (const s of SHOTS) {
  await page.setViewport({ width: s.width, height: s.height, deviceScaleFactor: 1 });
  await wait(900);
  const metrics = await page.evaluate(() => {
    const line = document.querySelector('.sw-inf__line');
    const box = document.querySelector('.sw-inf');
    const r = line ? line.getBoundingClientRect() : null;
    const b = box ? box.getBoundingClientRect() : null;
    const cs = line ? getComputedStyle(line) : null;
    return {
      lineFont: cs ? cs.fontSize : null, lineHeight: cs ? cs.lineHeight : null,
      lineRect: r ? { w: Math.round(r.width), h: Math.round(r.height), bottom: Math.round(r.bottom) } : null,
      boxRect: b ? { h: Math.round(b.height), bottom: Math.round(b.bottom) } : null,
      viewport: { w: innerWidth, h: innerHeight },
    };
  });
  console.log('metrics:', `${s.width}x${s.height}`, JSON.stringify(metrics));
  const file = path.join(OUT, s.name);
  await page.screenshot({ path: file, captureBeyondViewport: false });
  shots.push(file);
  console.log('shot:', file, `${s.width}x${s.height}`);
}

const own = [...new Set(errors.filter((e) => !EXTERNAL.test(e) && !/ResizeObserver loop/.test(e)))];
console.log('errors:', own.length);
for (const e of own.slice(0, 8)) console.log('  ' + e);
await browser.close();

const ok = opened.report && opened.overlimitOn === 'true' && opened.tab === 'true'
  && perBond.length === FIVE.length
  && perBond.every((p, i) => p.name.includes(FIVE[i]) && p.name.includes('超限') && p.lines.length === 1 && /\d/.test(p.lines[0]))
  && perBond.every((p) => p.nums.length > 0 && p.nums.every((t) => /\d/.test(t)))
  && new Set(perBond.map((p) => p.lines[0])).size === FIVE.length
  && !/尚未配置/.test(panel.banner) && /已配置 \d+ 条盟约强化/.test(panel.banner)
  && /拉特兰/.test(panel.name) && /超限/.test(panel.name)
  && panel.infBlock && panel.heading.includes('超限模拟')
  && panel.lines.length === 1 && /弹药/.test(panel.lines[0]) && /8%/.test(panel.lines[0])
  // 数值分色（业主 2026-11-01）：强调节点 > 0、颜色与正文不同、且行内仍有**直接文本节点**（= 纯描述没被染色）
  && panel.numNodes > 0 && panel.numTexts.every((t) => /\d/.test(t))
  && panel.numColor && panel.lineColor && panel.numColor !== panel.lineColor
  && panel.plainTextNodes > 0 && panel.plainText.length > 0
  && panel.numNodes + panel.plainTextNodes <= panel.lines[0].length
  && panel.pendingTiles === 0 && panel.overlimitTiles >= 8
  && shots.every((f) => fs.existsSync(f) && fs.statSync(f).size > 0)
  && own.length === 0;
console.log('\nRESULT:', ok ? `OK — 超限视图盟约页回填（横幅「${panel.banner.trim()}」，拉特兰面板给出 inf 块强化行），两张图已写 ${OUT}` : 'CHECK ABOVE');
process.exit(ok ? 0 : 1);

#!/usr/bin/env node
// devtools/overlimit-anchor-mvc-figure.mjs — `handoff/shots/overlimit-anchor-with-mvc.png` 的出图脚本。
//
// 数据来自 tools/infinite-anchor-pairs.mjs 的缓存（`--mvc` 那一轮）：
//   node tools/infinite-anchor-pairs.mjs --mvc chess_char_6_diy1_b --gold-hammer
//   node devtools/overlimit-anchor-mvc-figure.mjs [cache.json] [out.png]
// 2×4 网格：每格一个锚 —— 该锚 Top5 曲线（R1–R40）+ 单锚基线（虚线），纵轴是 log10(DPS)。
// 只读：读缓存 JSON，写一张 PNG。需要本机 Chrome（devtools 其余脚本同一约定：SP_CHROME 可覆盖）。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CHROME = process.env.SP_CHROME || 'C:/Users/J1825/AppData/Local/Google/Chrome/Application/chrome.exe';
const CACHE = process.argv[2] ? path.resolve(process.argv[2]) : path.join(ROOT, '.cache', 'o3', 'anchor-with-mvc.json');
const OUT = process.argv[3] ? path.resolve(process.argv[3]) : path.join(ROOT, 'handoff', 'shots', 'overlimit-anchor-with-mvc.png');

const data = JSON.parse(fs.readFileSync(CACHE, 'utf8'));
const NAME = (id) => data.names?.[id] || id;
// 面板顺序按业主口径（谢拉格 / 阿戈尔 / 萨尔贡 / 维多利亚 / 炎 / 拉特兰 / 叙拉古 / 卡西米尔），缺数据的锚自动跳过
const OWNER_ORDER = ['kjeragShip', 'egirShip', 'sargonShip', 'victoriaShip', 'yanShip', 'lateranoShip', 'siracusaShip', 'kazimierzShip'];
const ORDER = OWNER_ORDER.filter((a) => data.rows.some((r) => r.anchor === a) && data.baseline?.[a])
  .concat(data.major.filter((a) => !OWNER_ORDER.includes(a) && data.rows.some((r) => r.anchor === a) && data.baseline?.[a]));

const W = 1980, H = 1210;
const PAD = { l: 58, r: 16, t: 34, b: 22 };
const CELL = { w: 480, h: 524 };
const GRID = data.grid.filter((r) => r <= 40);
const COLORS = ['#2563eb', '#dc2626', '#059669', '#d97706', '#7c3aed'];

const fmt = (n) => (n >= 1e9 ? (n / 1e9).toFixed(2) + 'B'
  : n >= 1e6 ? (n / 1e6).toFixed(2) + 'M'
    : n >= 1e3 ? (n / 1e3).toFixed(1) + 'k'
      : String(Math.round(n)));
/** 纵轴刻度：整十次幂，读数优先（1k / 100k / 1M / 10M …），不堆小数。 */
const tickFmt = (n) => (n >= 1e9 ? String(n / 1e9) + 'B' : n >= 1e6 ? String(n / 1e6) + 'M' : n >= 1e3 ? String(n / 1e3) + 'k' : String(n));
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** 该锚的 Top5 + 基线，全部落在 R1–R40 上。 */
function panelOf(anchor) {
  const rows = data.rows.filter((r) => r.anchor === anchor).sort((a, b) => a.rank - b.rank);
  const top = rows.slice(0, 5).map((r) => ({
    rank: r.rank,
    label: NAME(r.partners[0]) + ' + ' + NAME(r.partners[1]),
    partners: r.partners,
    pts: GRID.map((rd) => [rd, r.rounds[rd].dps]),
    r40: r.rounds[40].dps,
    alloc: r.alloc,
  }));
  const bas = GRID.map((rd) => [rd, data.baseline[anchor][rd].dps]);
  // 拉特兰「锁精准」：含 preciShip 的最好一组（本轮扫描的真实名次），在格子里单独标出来
  const lock = anchor === 'lateranoShip'
    ? (() => {
      const l = rows.filter((r) => r.partners.includes('preciShip')).sort((a, b) => a.rank - b.rank)[0];
      return l ? { rank: l.rank, label: NAME(l.partners[0]) + ' + ' + NAME(l.partners[1]), r40: l.rounds[40].dps } : null;
    })()
    : null;
  return { anchor, top, bas, lock, r40: top[0]?.r40 ?? 0 };
}

function svgPanel(p, x0, y0) {
  const { w, h } = CELL;
  const innerW = w - PAD.l - PAD.r;
  const chartH = 300;
  const innerH = chartH - PAD.t - PAD.b;
  const all = [...p.top.flatMap((t) => t.pts.map((q) => q[1])), ...p.bas.map((q) => q[1])].filter((v) => v > 0);
  let lo = Math.log10(Math.min(...all));
  let hi = Math.log10(Math.max(...all));
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) { lo = 3; hi = 6; }
  lo = Math.floor(lo); hi = Math.ceil(hi);
  if (hi - lo < 1) hi = lo + 1;
  const xOf = (r) => PAD.l + (r - 1) / 39 * innerW;
  const yOf = (v) => PAD.t + innerH - (Math.log10(Math.max(v, 1e-9)) - lo) / (hi - lo) * innerH;
  const pathOf = (pts) => pts.map(([r, v], i) => (i ? 'L' : 'M') + xOf(r).toFixed(1) + ' ' + yOf(v).toFixed(1)).join(' ');

  const parts = [];
  for (let e = lo; e <= hi; e++) {
    const y = yOf(Math.pow(10, e));
    parts.push(`<line x1="${PAD.l}" y1="${y.toFixed(1)}" x2="${PAD.l + innerW}" y2="${y.toFixed(1)}" stroke="#e2e8f0" stroke-width="1"/>`);
    parts.push(`<text x="${PAD.l - 6}" y="${(y + 4).toFixed(1)}" text-anchor="end" font-size="11" fill="#64748b">${tickFmt(Math.pow(10, e))}</text>`);
  }
  // R15 = 层数口径的拐点（R15 之后每回合 +50 层），画一条竖线便于读“高层”段
  const x15 = xOf(15);
  parts.push(`<line x1="${x15.toFixed(1)}" y1="${PAD.t}" x2="${x15.toFixed(1)}" y2="${PAD.t + innerH}" stroke="#f1f5f9" stroke-width="6"/>`);
  parts.push(`<text x="${(x15 + 3).toFixed(1)}" y="${PAD.t + 9}" font-size="9.5" fill="#94a3b8">R15</text>`);
  for (const t of [1, 10, 20, 30, 40]) {
    parts.push(`<text x="${xOf(t).toFixed(1)}" y="${PAD.t + innerH + 16}" text-anchor="middle" font-size="11" fill="#64748b">R${t}</text>`);
  }
  parts.push(`<path d="${pathOf(p.bas)}" fill="none" stroke="#94a3b8" stroke-width="2" stroke-dasharray="5 4"/>`);
  p.top.forEach((t, i) => {
    parts.push(`<path d="${pathOf(t.pts)}" fill="none" stroke="${COLORS[i]}" stroke-width="2.4" stroke-linejoin="round" stroke-linecap="round"/>`);
    const [lr, lv] = t.pts[t.pts.length - 1];
    parts.push(`<circle cx="${xOf(lr).toFixed(1)}" cy="${yOf(lv).toFixed(1)}" r="2.6" fill="${COLORS[i]}"/>`);
  });
  // 图例：Top5 + 基线
  const ly = chartH + 24;
  parts.push(`<text x="6" y="${ly + 4}" font-size="11.5" fill="#334155">曲线</text>`);
  p.top.forEach((t, i) => {
    const y = ly + 12 + i * 17;
    parts.push(`<rect x="6" y="${y - 7}" width="16" height="3" fill="${COLORS[i]}"/>`);
    parts.push(`<text x="28" y="${y + 1}" font-size="11.5" fill="#1e293b">#${t.rank} ${esc(t.label)}</text>`);
    parts.push(`<text x="${w - 10}" y="${y + 1}" text-anchor="end" font-size="11.5" fill="#334155">R40 ${fmt(t.r40)}</text>`);
  });
  const yb = ly + 12 + p.top.length * 17 + 6;
  parts.push(`<rect x="6" y="${yb - 7}" width="16" height="3" fill="#94a3b8"/>`);
  parts.push(`<text x="28" y="${yb + 1}" font-size="11.5" fill="#475569">基线（单锚 ${data.mvc ? '7 常驻 + 外援' : '8 人'}）</text>`);
  parts.push(`<text x="${w - 10}" y="${yb + 1}" text-anchor="end" font-size="11.5" fill="#475569">R40 ${fmt(p.bas[p.bas.length - 1][1])}</text>`);
  if (p.lock) {
    const yl = yb + 19;
    parts.push(`<rect x="6" y="${yl - 7}" width="16" height="8" fill="none" stroke="#0f766e" stroke-width="1.6"/>`);
    parts.push(`<text x="28" y="${yl + 1}" font-size="11.5" fill="#0f766e">锁精准 #${p.lock.rank} ${esc(p.lock.label)}</text>`);
    parts.push(`<text x="${w - 10}" y="${yl + 1}" text-anchor="end" font-size="11.5" fill="#0f766e">R40 ${fmt(p.lock.r40)}</text>`);
  }

  // 标题：锚名 + Top1 分格 + 锁精准 / 金锤标记
  const tags = [];
  if (p.anchor === 'lateranoShip') tags.push('锁精准');
  if (p.anchor === 'victoriaShip') tags.push('金锤×8');
  const head = esc(NAME(p.anchor)) + ` (${p.anchor})` + (tags.length ? ' · ' + tags.join(' · ') : '');
  parts.push(`<text x="6" y="16" font-size="14" font-weight="600" fill="#0f172a">${head}</text>`);
  parts.push(`<text x="${w - 10}" y="16" text-anchor="end" font-size="12" fill="#334155">分格 ${p.top[0] ? p.top[0].alloc.join('/') : '-'}</text>`);
  parts.push(`<rect x="0.5" y="0.5" width="${w - 1}" height="${h - 1}" fill="none" stroke="#cbd5e1"/>`);
  return `<g transform="translate(${x0} ${y0})">${parts.join('')}</g>`;
}

const panels = ORDER.map((a) => panelOf(a));
const cells = [];
panels.forEach((p, i) => {
  const col = i % 4, row = Math.floor(i / 4);
  cells.push(svgPanel(p, 12 + col * CELL.w, 96 + row * CELL.h));
});

const mvcNote = data.mvc
  ? `外援主 C ${data.mvc.slot}@${data.mvc.pick}（skill ${data.mvc.skill}，自选槽转职为锚：族装备 + 变形同构体 ${data.morph}）`
  : '无外援主 C';
const goldNote = data.goldHammer ? '维多利亚全员金锤 chess_item_1_01_e_b' : '全员普锤 chess_item_1_01_e_a';
const html = `<!doctype html><html><head><meta charset="utf-8"><style>
  html,body{margin:0;background:#fff;font-family:"Microsoft YaHei","Noto Sans SC",system-ui,sans-serif;}
  svg{display:block}
</style></head><body>
<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">
  <rect width="${W}" height="${H}" fill="#fff"/>
  <text x="24" y="40" font-size="24" font-weight="700" fill="#0f172a">超限模拟 · 8 大盟约锚定扫描（含外援主 C + 维多利亚金锤 + 拉特兰锁精准）</text>
  <text x="24" y="66" font-size="13" fill="#475569">528 组全量真 sim（8 锚 × C(12,2)=66）× 21 回合点 · 纵轴 log10(DPS) · 曲线 = 该锚 R1–R40 的 Top5，虚线 = 单锚基线</text>
  <text x="24" y="86" font-size="12.5" fill="#64748b">${esc(mvcNote)} · ${esc(goldNote)} · 木桩 1e12 血 rank ELITE · flags.overlimit = true · 层数 R15 大 400 / 小 150，之后每回合 +50</text>
  <g>${cells.join('')}</g>
  <text x="24" y="${H - 14}" font-size="12" fill="#64748b">数据：.cache/o3/anchor-with-mvc.json（tools/infinite-anchor-pairs.mjs --mvc ... --gold-hammer）· 出图：devtools/overlimit-anchor-mvc-figure.mjs</text>
</svg></body></html>`;

fs.mkdirSync(path.dirname(OUT), { recursive: true });
const tmp = path.join(ROOT, '.cache', 'anchor-mvc-figure.html');
fs.writeFileSync(tmp, html, 'utf8');

const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--disable-gpu'] });
const page = await browser.newPage();
await page.setViewport({ width: W, height: H, deviceScaleFactor: 2 });
await page.goto('file:///' + tmp.replace(/\\/g, '/'), { waitUntil: 'load' });
await new Promise((r) => setTimeout(r, 250));
await page.screenshot({ path: OUT, clip: { x: 0, y: 0, width: W, height: H } });
await browser.close();
console.log('写出 ' + path.relative(ROOT, OUT) + '（' + Math.round(fs.statSync(OUT).size / 1024) + ' KB）');

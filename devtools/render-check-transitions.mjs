// devtools/render-check-transitions.mjs — 过场动画定位自检（真浏览器）
//
// 把对局里的过场/弹层组件直接挂到 DOM，量它们的实际矩形：
//   回合开始板（RoundPopup）· 阶段板（PhasePopup）· 阶段横幅（PhaseBanner overlay）· 回合结果框（ResultDialog）
//   · 轮到你选（TurnPopup）· 双 Boss 预警（BossPhaseWarn）· 词条抉择（TraitOverlay）
// 判定：组件中心在视口中心附近（x ≤ 6% / y ≤ 8%），且整块在视口内（含安全区余量）。
//
//   SP_BASE=http://127.0.0.1:3012 SP_VIEWPORT=667x375 node devtools/render-check-transitions.mjs
import fs from 'node:fs';
import puppeteer from 'puppeteer-core';

const CHROME = process.env.SP_CHROME || 'C:/Users/J1825/AppData/Local/Google/Chrome/Application/chrome.exe';
const BASE = process.env.SP_BASE || 'http://127.0.0.1:3000';
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
await wait(1800);

const result = await page.evaluate(async () => {
  const { render } = await import('/vendor/preact.module.js');
  const { html } = await import('/js/ui/components.js');
  const { RoundPopup, PhasePopup } = await import('/js/ui/matchPopups.js');
  const { PhaseBanner, ResultDialog } = await import('/js/ui/components.js');
  const { TurnPopup } = await import('/js/ui/turnPopup.js');
  const { BossPhaseWarn } = await import('/js/ui/bossPhaseWarn.js');
  const { TraitOverlay } = await import('/js/ui/traitOverlay.js');
  const host = document.createElement('div');
  host.id = 'transition-check';
  Object.assign(host.style, { position: 'fixed', inset: '0', pointerEvents: 'none', zIndex: '99999' });
  document.body.append(host);
  const vw = window.innerWidth, vh = window.innerHeight;
  const rect = (sel) => {
    const el = host.querySelector(sel);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { sel, left: r.left, top: r.top, right: r.right, bottom: r.bottom, cx: r.left + r.width / 2, cy: r.top + r.height / 2, w: r.width, h: r.height };
  };
  const report = (name, sel) => {
    const r = rect(sel);
    if (!r) return { name, sel, missing: true };
    const dx = Math.abs(r.cx - vw / 2), dy = Math.abs(r.cy - vh / 2);
    return {
      name, sel, w: Math.round(r.w), h: Math.round(r.h),
      dx: Math.round(dx), dy: Math.round(dy),
      inside: r.left >= -1 && r.top >= -1 && r.right <= vw + 1 && r.bottom <= vh + 1,
      centered: dx <= vw * 0.06 && dy <= vh * 0.08,
    };
  };
  const out = {};

  render(html`<${RoundPopup} round=${7} gain=${5} left=${null} onDone=${() => {}} />`, host);
  await new Promise((r) => setTimeout(r, 450));
  out.round = report('round', '.mpop__panel');
  host.replaceChildren();

  render(html`<${PhasePopup} tone="orange" faces=${true} chev=${true} title=${'联防阶段'} sub=${'共同防守'} duration=${0} />`, host);
  await new Promise((r) => setTimeout(r, 450));
  out.phase = report('phase', '.mpop__panel');
  host.replaceChildren();

  render(html`<${PhaseBanner} mode="overlay" tone="mint" title=${'休整期'} sub=${'准备下一轮'} duration=${0} />`, host);
  await new Promise((r) => setTimeout(r, 350));
  out.banner = report('banner', '.pbanner__band');
  host.replaceChildren();

  render(html`<${ResultDialog} title=${'作战结束'} sub=${'全员无伤！'} tone="mint" duration=${0} />`, host);
  await new Promise((r) => setTimeout(r, 350));
  out.result = report('result', '.rdialog__box');
  host.replaceChildren();

  render(html`<${TurnPopup} onDone=${() => {}} />`, host);
  await new Promise((r) => setTimeout(r, 350));
  out.turn = report('turn', '.sptp');
  out.turnDisc = report('turn-disc', '.sptp__disc');
  host.replaceChildren();

  render(html`<${BossPhaseWarn} on=${true} />`, host);
  await new Promise((r) => setTimeout(r, 900));
  out.boss = report('boss', '.warn__body');
  host.replaceChildren();

  const cards = [
    { mob: 'enemy_1007_slime', name: '源石虫', boss: false, traitId: 'guard', traitName: '守御', traitText: '防御力提升' },
    { mob: 'enemy_1007_slime', name: '源石虫', boss: false, traitId: 'assault', traitName: '突击', traitText: '攻击力提升' },
    { mob: 'enemy_1007_slime', name: '源石虫', boss: false, traitId: 'weak', traitName: '虚弱', traitText: '攻击力下降' },
  ];
  render(html`<${TraitOverlay} trait=${{ polarity: 'pos', cards, turn: 'me', picks: {} }} myId="me" onPick=${() => {}} />`, host);
  await new Promise((r) => setTimeout(r, 1300));
  out.trait = report('trait', '.traitov__cards');
  host.remove();
  return { vw, vh, out };
});
console.log(JSON.stringify(result, null, 1));
await page.screenshot({ path: `${OUT}/9-transitions-${vw}x${vh}.png` });

const own = errors.filter((e) => !EXTERNAL.test(e));
console.log('\nerrors:', own.length);
for (const e of [...new Set(own)].slice(0, 10)) console.log('  ' + e);
await browser.close();

const list = Object.entries(result.out).filter(([, v]) => !v.missing);
const bad = list.filter(([, v]) => !v.centered || !v.inside);
const ok = bad.length === 0 && own.length === 0;
console.log('\nRESULT:', ok
  ? `OK — ${list.length} 个过场/弹层在 ${vw}×${vh} 内居中且未越界`
  : `CHECK — ${bad.map(([k]) => k).join(', ')}`);
process.exit(ok ? 0 : 1);

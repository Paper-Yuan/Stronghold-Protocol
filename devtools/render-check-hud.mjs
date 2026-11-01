// devtools/render-check-hud.mjs — 真浏览器渲染局内聊天与超限 HUD 组件（不进入真实对局）
//
// 在大厅页里动态 import 组件，用 preact 直接挂到 DOM，验证：
//   · ui/chatBox.js 的面板、日志行、触发按钮
//   · ui/infiniteHud.js 的 1×/2× 开关（2× 的 is-fast 状态）与「本局词条」弹层
// 这样不必真的开一局超限，也能证明组件在真实 CSS/浏览器里画得出来。
//
//   SP_BASE=http://127.0.0.1:3011 SP_VIEWPORT=667x375 node devtools/render-check-hud.mjs
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
page.on('requestfailed', (r) => errors.push('requestfailed: ' + r.url() + ' ' + (r.failure()?.errorText || '')));
const EXTERNAL = /(ganxiemingdan\.jiangjiangze\.icu|fonts\.googleapis\.com|fonts\.gstatic\.com)/;
const appErrors = () => {
  const external = errors.filter((e) => EXTERNAL.test(e));
  return { own: errors.filter((e) => !EXTERNAL.test(e) && !(external.length && /Failed to load resource/.test(e))), external };
};

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
await page.goto(BASE + '/', { waitUntil: 'domcontentloaded', timeout: 60000 });
await wait(1800);

const result = await page.evaluate(async () => {
  const { render } = await import('/vendor/preact.module.js');
  const { html } = await import('/js/ui/components.js');
  const { ChatBox } = await import('/js/ui/chatBox.js');
  const { InfiniteSpeedToggle, TraitBadge } = await import('/js/ui/infiniteHud.js');
  const sp = globalThis.__SP__;
  sp.store.set({ chatMessages: [
    { playerId: 'p1', name: '博士甲', seat: 0, isSpectator: false, text: '攻打右路！', at: Date.now() },
    { playerId: 'p2', name: '博士乙', seat: 1, isSpectator: false, text: '收到', at: Date.now() },
  ] });
  const host = document.createElement('div');
  host.id = 'hud-check';
  Object.assign(host.style, { position: 'fixed', inset: '0', pointerEvents: 'none', zIndex: '99999' });
  document.body.append(host);
  const speeds = [];
  render(html`<div class="gm">
    <div style="position:absolute;right:0;top:0;display:flex;gap:6px">
      <${InfiniteSpeedToggle} speed=${2} onSpeed=${(s) => speeds.push(s)} />
      <${TraitBadge} mods=${[
        { round: 17, id: 'guard', name: '守御', polarity: 'pos', text: '防御力提升' },
        { round: 18, id: 'weak', name: '虚弱', polarity: 'neg', text: '攻击力下降' },
      ]} />
    </div>
    <${ChatBox} active=${false} onToggle=${() => {}} showTrigger=${true} />
  </div>`, host);
  await new Promise((r) => setTimeout(r, 300));
  const speed = host.querySelector('.gspeed');
  speed?.click();
  const badge = host.querySelector('.gtrait__btn');
  badge?.click();
  await new Promise((r) => setTimeout(r, 300));
  const panel = host.querySelector('.chat-panel');
  const pop = host.querySelector('.gtrait__pop');
  return {
    chat: !!panel,
    chatTrigger: !!host.querySelector('.chat-trigger-btn'),
    chatLines: host.querySelectorAll('.chat-item').length,
    chatFixed: panel ? getComputedStyle(panel).position : null,
    speed: !!speed,
    speedFast: !!host.querySelector('.gspeed.is-fast'),
    speedClicked: speeds,
    badge: !!badge,
    popup: !!pop,
    popupRows: pop ? pop.querySelectorAll('.gtrait__row').length : 0,
  };
});
console.log('hud:', JSON.stringify(result));
await page.screenshot({ path: `${OUT}/8-hud-${vw}x${vh}.png` });

// the chat panel / trait popup are fixed overlays: make sure they stay inside this viewport
const bounds = await page.evaluate(() => {
  const rects = ['.chat-panel', '.gtrait__pop'].map((s) => {
    const el = document.querySelector(s);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { s, left: r.left, top: r.top, right: r.right, bottom: r.bottom, inside: r.left >= 0 && r.top >= 0 && r.right <= innerWidth + 1 && r.bottom <= innerHeight + 1 };
  });
  return rects;
});
console.log('bounds:', JSON.stringify(bounds));
const { own, external } = appErrors();
if (external.length) console.log(`(external thanks API unavailable: ${external.length} request(s) — not a UI error)`);
console.log('\nerrors:', own.length);
for (const e of [...new Set(own)].slice(0, 10)) console.log('  ' + e);
await browser.close();

const ok = result.chat && result.chatTrigger && result.chatLines === 2 && result.chatFixed === 'fixed'
  && result.speed && result.speedFast && result.speedClicked[0] === 1
  && result.badge && result.popup && result.popupRows === 2
  && bounds.every((b) => b && b.inside) && own.length === 0;
console.log('\nRESULT:', ok ? `OK — 聊天与超限 HUD 组件在 ${vw}×${vh} 内渲染/交互正常` : 'CHECK ABOVE');
process.exit(ok ? 0 : 1);

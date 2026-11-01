// devtools/render-check-game-overlimit-bonds.mjs — 局内盟约弹窗的数值分色（业主 2026-11-01）
//
// 业主：「超限局内显示盟约时也要按同一规则只强调数值片段」，且分色逻辑只有一份
// （ui/overlimitBondText.js 的 OverlimitValueLine + 共享类 .olb-num），局内不许再写一套。
//
// 这个脚本走**真服务端**：标题登录 → 超限单人房（`solo_infinite`，测试房）→ 开局 → 用测试命令
// `g.test { cmd: 'bond' }` 摆出一条盟约（拉特兰，`count` = 额外的成员数，服务端会重算所以盟约条会出现）
// → 点盟约条打开弹窗 → 量颜色（数值 = mint / 正文 = 版式色）→ 截 792×360。
// 同一个脚本再开一间**普通**房做对照：同样的盟约、同样的弹窗，里面应当 0 个 `.olb-num`，描述文本一模一样。
//
//   PORT=3170 SP_TEST_MODE=1 node server/index.js
//   SP_BASE=http://127.0.0.1:3170 node devtools/render-check-game-overlimit-bonds.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const CHROME = process.env.SP_CHROME || 'C:/Users/J1825/AppData/Local/Google/Chrome/Application/chrome.exe';
const BASE = process.env.SP_BASE || 'http://127.0.0.1:3170';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'handoff', 'shots');
const SHOT = path.join(OUT, 'game-overlimit-bonds-792x360.png');
const BOND = process.env.SP_BOND || 'lateranoShip';
const [vw, vh] = [792, 360];
fs.mkdirSync(OUT, { recursive: true });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: CHROME, headless: 'new',
  args: ['--no-sandbox', '--disable-gpu', `--window-size=${vw},${vh}`],
});
const errors = [];
const page = await browser.newPage();
await page.setViewport({ width: vw, height: vh, deviceScaleFactor: 1 });
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
const EXTERNAL = /(ganxiemingdan\.jiangjiangze\.icu|fonts\.googleapis\.com|fonts\.gstatic\.com)/;

await page.goto(BASE + '/', { waitUntil: 'domcontentloaded', timeout: 60000 });
await wait(1600);
await page.evaluate(async () => {
  const i = document.querySelector('.title-login input, input[type="text"]');
  i.value = `olb-${Math.floor(Math.random() * 900 + 100)}`;
  i.dispatchEvent(new Event('input', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 120));
  [...document.querySelectorAll('button')].find((b) => /开始/.test(b.textContent || ''))?.click();
});
await wait(2400);

/** 一间测试房 → 开局 → 停在 PREP；返回 { mode, isInfinite }。 */
async function enterMatch(mode, difficulty) {
  await page.evaluate(async (m, d) => {
    const app = globalThis.__SP__;
    await app.net.request('room.create', { mode: m, difficulty: d, test: true });
    await new Promise((r) => setTimeout(r, 500));
    await app.net.request('room.start', {});
  }, mode, difficulty);
  await wait(1500);
  // 简报 → 策略草案 → 对局；每一步都按 m.public.phase 走（与客户端同一个状态机）
  for (let i = 0; i < 24; i++) {
    const st = await page.evaluate(async () => {
      const app = globalThis.__SP__;
      const pub = app.store.get().match?.public;
      if (!pub) return { phase: null };
      const phases = { phase: pub.phase };
      try {
        if (pub.phase === 'INFO_CHECK') await app.net.request('g.infoReady', { setupRevision: pub.setupRevision ?? 0 });
        else if (pub.phase === 'BAND_DRAFT') {
          const ids = Object.keys(app.data.get('bands') || {});
          for (const id of ids) {
            try { await app.net.request('g.band', { bandId: id }); break; } catch { /* 这一档不给这条策略 */ }
          }
        } else if (pub.phase === 'TRAIT_DRAFT') {
          try { await app.net.request('g.traitChoice', { idx: 0 }); } catch { /* 不是每一步都有 */ }
        } else if (pub.phase === 'SP_DRAFT') {
          try { await app.net.request('g.choice', { idx: 0 }); } catch { /* 同上 */ }
        }
      } catch (e) { phases.err = String(e && e.message ? e.message : e); }
      return phases;
    });
    if (st.phase === 'PREP') return st;
    await wait(900);
  }
  return { phase: null };
}

/** 摆一条盟约（服务端 _testBond：count = 额外成员数）→ 打开它的弹窗。 */
async function openBondPopup(bondId) {
  const res = await page.evaluate(async (id) => {
    const app = globalThis.__SP__;
    try { await app.net.request('g.test', { cmd: 'bond', args: { id, layers: 0, count: 6 } }); } catch (e) { return { ok: false, err: String(e && e.message || e) }; }
    await new Promise((r) => setTimeout(r, 600));
    const slot = document.querySelector(`.bslot[data-bond="${id}"]`);
    const btn = slot?.querySelector('button') || slot;
    btn?.click();
    await new Promise((r) => setTimeout(r, 700));
    return { ok: !!document.querySelector('.bpop'), strip: !!slot };
  }, bondId);
  await wait(600);
  return res;
}

/** 弹窗里「盟约效果」那一段的量测（真实 DOM、真实 computed style）。 */
const describePanel = () => page.evaluate(() => {
  const pop = document.querySelector('.bpop');
  if (!pop) return null;
  const descs = [...pop.querySelectorAll('.bpop__desc')];
  const desc = descs[descs.length - 1] || null;
  const nums = desc ? [...desc.querySelectorAll('.olb-num')] : [];
  const direct = desc ? [...desc.childNodes].filter((n) => n.nodeType === 3 && (n.nodeValue || '').trim()) : [];
  return {
    isInfinite: !!globalThis.__SP__?.store.get().match?.public?.isInfinite,
    name: (pop.querySelector('.bpop__name') || {}).textContent || '',
    descColor: desc ? getComputedStyle(desc).color : null,
    numColor: nums[0] ? getComputedStyle(nums[0]).color : null,
    nums: nums.map((n) => (n.textContent || '').trim()),
    plainTextNodes: direct.length,
    plainText: direct.map((n) => (n.nodeValue || '').trim()).join('|'),
    text: desc ? (desc.textContent || '').trim() : '',
    mark: !!pop.querySelector('.olb-num'),
    brs: desc ? desc.querySelectorAll('br').length : 0,
  };
});

// ---- ① 超限局：数值 mint、正文正文色 --------------------------------------------------------------
const inf = await enterMatch('solo_infinite', 'ABYSS');
const infOpen = await openBondPopup(BOND);
const infPanel = await describePanel();
console.log('overlimit phase:', JSON.stringify(inf), 'open:', JSON.stringify(infOpen));
console.log('overlimit panel:', JSON.stringify(infPanel, null, 2));
await page.screenshot({ path: SHOT, captureBeyondViewport: false });
console.log('shot:', SHOT, `${vw}x${vh}`);

// ---- ② 普通房对照：同一个弹窗、同一段描述，0 个数值高亮 ------------------------------------------
await page.evaluate(async () => {
  const app = globalThis.__SP__;
  try { await app.net.request('room.leave', {}); } catch { /* 已离开 */ }
});
await wait(1200);
const norm = await enterMatch('solo', 'NORMAL');
const normOpen = await openBondPopup(BOND);
const normPanel = await describePanel();
console.log('normal phase:', JSON.stringify(norm), 'open:', JSON.stringify(normOpen));
console.log('normal panel:', JSON.stringify(normPanel, null, 2));

const own = [...new Set(errors.filter((e) => !EXTERNAL.test(e) && !/ResizeObserver loop/.test(e)))];
console.log('errors:', own.length);
for (const e of own.slice(0, 8)) console.log('  ' + e);
await browser.close();

const MINT = 'rgb(89, 244, 202)'; // theme.css --mint-400: #59f4ca
const ok = inf.phase === 'PREP' && infOpen.ok
  && infPanel && infPanel.isInfinite === true
  && /拉特兰/.test(infPanel.name)
  // 数值片段：有、都含数字、都是 mint，且与正文色不同
  && infPanel.nums.length > 0 && infPanel.nums.every((t) => /\d/.test(t))
  && infPanel.numColor === MINT && infPanel.descColor && infPanel.descColor !== infPanel.numColor
  // 正文：有直接的文本节点（= 纯描述没被染色）、多行描述仍是 <br>
  && infPanel.plainTextNodes > 0 && infPanel.plainText.length > 0 && infPanel.brs > 0
  // 非超限对照：同一句文案、0 个 olb-num、颜色回到正文色
  && norm.phase === 'PREP' && normOpen.ok
  && normPanel && normPanel.isInfinite === false && normPanel.mark === false && normPanel.nums.length === 0
  && normPanel.text === infPanel.text
  && fs.existsSync(SHOT) && fs.statSync(SHOT).size > 0
  && own.length === 0;
console.log('\nRESULT:', ok
  ? `OK — 超限局盟约弹窗：${infPanel.nums.length} 个数值片段取 mint（${infPanel.numColor}），正文 ${infPanel.plainTextNodes} 个纯文本节点；普通房 0 个高亮、描述逐字相同。图 ${SHOT}`
  : 'CHECK ABOVE');
process.exit(ok ? 0 : 1);

// devtools/render-check-coop-infinite.mjs — 超限 · 同盟房间（业主 2026-10-26）
//
// 检查：大厅出现「超限模拟 · 同盟」入口；room.create(coop_infinite) 成功、房间模式/座位/难度正确。
//   SP_BASE=http://127.0.0.1:3020 node devtools/render-check-coop-infinite.mjs
import puppeteer from 'puppeteer-core';

const CHROME = process.env.SP_CHROME || 'C:/Users/J1825/AppData/Local/Google/Chrome/Application/chrome.exe';
const BASE = process.env.SP_BASE || 'http://127.0.0.1:3020';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: CHROME, headless: 'new',
  args: ['--no-sandbox', '--disable-gpu', '--window-size=1280,720'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 720 });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));

await page.goto(BASE + '/', { waitUntil: 'domcontentloaded', timeout: 60000 });
await wait(1600);
await page.evaluate(async () => {
  const input = document.querySelector('.title-login input, input[type="text"]');
  input.value = `ci-${Math.floor(Math.random() * 900 + 100)}`;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 120));
  [...document.querySelectorAll('button')].find((b) => /开始/.test(b.textContent || ''))?.click();
});
await wait(2600);

const lobby = await page.evaluate(() => ({
  hasEntry: document.body.innerText.includes('超限模拟 · 同盟'),
}));
console.log('lobby:', JSON.stringify(lobby));

const created = await page.evaluate(async () => {
  try {
    await globalThis.__SP__.net.request('room.create', { mode: 'coop_infinite', difficulty: 'ABYSS' });
    await new Promise((r) => setTimeout(r, 800));
    const room = globalThis.__SP__.store.get().room;
    return { ok: true, mode: room?.mode, difficulty: room?.difficulty, seats: room?.seats?.length, code: room?.code };
  } catch (e) { return { ok: false, error: String(e?.message || e) }; }
});
console.log('create:', JSON.stringify(created));

const ai = await page.evaluate(async () => {
  try {
    await globalThis.__SP__.net.request('room.addBot', {});
    await new Promise((r) => setTimeout(r, 700));
    const room = globalThis.__SP__.store.get().room;
    return { ok: true, bots: (room?.seats || []).filter((s) => s && s.isBot).length };
  } catch (e) { return { ok: false, error: String(e?.message || e) }; }
});
console.log('addBot:', JSON.stringify(ai));

const started = await page.evaluate(async () => {
  try {
    await globalThis.__SP__.net.request('room.start', {});
    await new Promise((r) => setTimeout(r, 1500));
    return { ok: true };
  } catch (e) { return { ok: false, error: String(e?.message || e) }; }
});
await wait(2500);
const match = await page.evaluate(() => {
  const s = globalThis.__SP__.store.get();
  return { inMatch: !!s.room?.inMatch, isInfinite: s.match?.public?.isInfinite ?? null, modeId: s.match?.public?.modeId ?? null };
});
console.log('start:', JSON.stringify(started), 'match:', JSON.stringify(match));

const own = errors.filter((e) => !/ganxiemingdan|fonts\.(googleapis|gstatic)/.test(e));
console.log('errors:', own.length);
await browser.close();

const ok = lobby.hasEntry && created.ok && created.mode === 'coop_infinite'
  && created.seats === 4 && created.difficulty === 'ABYSS'
  && ai.ok && ai.bots >= 1
  && started.ok && match.isInfinite === true
  && own.length === 0;
console.log('\nRESULT:', ok ? 'OK — 超限 · 同盟入口与建房可用（4 座、终极难度）' : 'CHECK ABOVE');
process.exit(ok ? 0 : 1);

// devtools/render-check-infinite-versions.mjs — 四个官方版本下的超限模拟（业主 2026-10-26）
//
// 对每个版本：room.create(solo_infinite, ABYSS, version) → 校验房间版本/模式/难度 →
// room.start → 校验 match.public.isInfinite 与 modeId 前缀。
// 第一期没有终极难度时允许被 fallback 到该版本最高的难度，但房间必须建得起来、超限标记必须为真。
//
//   SP_BASE=http://127.0.0.1:3020 node devtools/render-check-infinite-versions.mjs
import puppeteer from 'puppeteer-core';

const CHROME = process.env.SP_CHROME || 'C:/Users/J1825/AppData/Local/Google/Chrome/Application/chrome.exe';
const BASE = process.env.SP_BASE || 'http://127.0.0.1:3020';
const VERSIONS = ['act2autochess', 'act2autochess@V2_1', 'act1autochess', 'act1autochess@V1_1'];
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const results = [];
for (const version of VERSIONS) {
  const browser = await puppeteer.launch({
    executablePath: CHROME, headless: 'new',
    args: ['--no-sandbox', '--disable-gpu', '--window-size=1280,720'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 720 });
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  try {
    await page.goto(BASE + '/', { waitUntil: 'domcontentloaded', timeout: 60000 });
    await wait(1500);
    await page.evaluate(async () => {
      const input = document.querySelector('.title-login input, input[type="text"]');
      input.value = `ver-${Math.floor(Math.random() * 900 + 100)}`;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      await new Promise((r) => setTimeout(r, 120));
      [...document.querySelectorAll('button')].find((b) => /开始/.test(b.textContent || ''))?.click();
    });
    await wait(2400);
    const created = await page.evaluate(async (v) => {
      try {
        await globalThis.__SP__.net.request('room.create', { mode: 'solo_infinite', difficulty: 'ABYSS', version: v });
        await new Promise((r) => setTimeout(r, 700));
        const room = globalThis.__SP__.store.get().room;
        return { ok: true, mode: room?.mode, version: room?.version, difficulty: room?.difficulty, seats: room?.seats?.length };
      } catch (e) { return { ok: false, error: String(e?.message || e) }; }
    }, version);
    const started = await page.evaluate(async () => {
      try {
        await globalThis.__SP__.net.request('room.start', {});
        return { ok: true };
      } catch (e) { return { ok: false, error: String(e?.message || e) }; }
    });
    await wait(1600);
    const match = await page.evaluate(() => {
      const s = globalThis.__SP__.store.get();
      return {
        isInfinite: s.match?.public?.isInfinite ?? null,
        modeId: s.match?.public?.modeId ?? null,
        round: s.match?.public?.round ?? null,
        speed: s.match?.public?.speedPref ?? null,
      };
    });
    const own = errors.filter((e) => !/ganxiemingdan|fonts\.(googleapis|gstatic)/.test(e));
    // 默认版本（act2autochess）的房间不带 version 字段（服务端约定），其它版本必须回显
    const versionOk = version === 'act2autochess'
      ? (created.version == null || created.version === version)
      : created.version === version;
    const ok = created.ok && versionOk && started.ok
      && match.isInfinite === true && String(match.modeId || '').startsWith('mode_single_')
      && own.length === 0;
    results.push({ version, ok, created, started, match, errors: own.length });
    console.log(version, ok ? 'OK' : 'FAIL', JSON.stringify({ created, match, errors: own.length }));
    if (own.length) for (const e of [...new Set(own)].slice(0, 4)) console.log('   ' + e);
  } catch (e) {
    results.push({ version, ok: false, fatal: String(e?.message || e) });
    console.log(version, 'FATAL', e?.message || e);
  }
  await browser.close();
}
const bad = results.filter((r) => !r.ok);
console.log(`\nRESULT: ${bad.length ? 'CHECK ABOVE — ' + bad.map((b) => b.version).join(', ') : 'OK — 四个版本下超限均可建房并开局'}`);
process.exit(bad.length ? 1 : 0);

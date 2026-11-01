// devtools/render-check-device-tuning.mjs — 机型兼容：UA 覆盖下的策略解析与页面无错
//
//   SP_BASE=http://127.0.0.1:3020 node devtools/render-check-device-tuning.mjs
import puppeteer from 'puppeteer-core';

const CHROME = process.env.SP_CHROME || 'C:/Users/J1825/AppData/Local/Google/Chrome/Application/chrome.exe';
const BASE = process.env.SP_BASE || 'http://127.0.0.1:3020';
const CASES = [
  { name: 'honor-old', ua: 'Mozilla/5.0 (Linux; Android 10; HONOR V30) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/96.0.4664.104 Mobile Safari/537.36', gpu: 'mali-g76', expect: 'honor', quality: 'low', cap: 30 },
  { name: 'honor-new', ua: 'Mozilla/5.0 (Linux; Android 14; HONOR MAA-AN10) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36', gpu: 'adreno (tm) 740', expect: 'honor', quality: 'high', cap: 60 },
  { name: 'xiaomi-dimensity', ua: 'Mozilla/5.0 (Linux; Android 13; 2211133C) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36', gpu: 'mali-g77', expect: 'xiaomi', quality: 'medium', cap: 45 },
  { name: 'redmi-unknown-gpu', ua: 'Mozilla/5.0 (Linux; Android 12; Redmi K50) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/110.0.0.0 Mobile Safari/537.36', gpu: '', expect: 'xiaomi', quality: 'medium', cap: 45 },
  { name: 'xiaomi-snapdragon', ua: 'Mozilla/5.0 (Linux; Android 13; Xiaomi 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36', gpu: 'adreno (tm) 740', expect: 'xiaomi', quality: 'high', cap: 60 },
  { name: 'desktop', ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36', gpu: 'nvidia', expect: 'other', quality: 'high', cap: 60 },
];

const browser = await puppeteer.launch({
  executablePath: CHROME, headless: 'new',
  args: ['--no-sandbox', '--disable-gpu', '--window-size=800,360'],
});
const results = [];
for (const c of CASES) {
  const page = await browser.newPage();
  await page.setUserAgent(c.ua);
  await page.setViewport({ width: 800, height: 360 });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e.message)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await new Promise((r) => setTimeout(r, 1800));
  const tuning = await page.evaluate(async (gpu) => {
    const m = await import('/js/ui/deviceTuning.js');
    const t = m.detectDeviceTuning({ ua: navigator.userAgent, gpu, webgl2: 'unknown' });
    return { family: t.family, quality: t.quality, dpr: t.maxPixelRatio, cap: t.frameCap, force2d: t.force2d };
  }, c.gpu);
  const ok = tuning.family === c.expect && tuning.quality === c.quality && tuning.cap === c.cap && errors.length === 0;
  results.push({ ...c, tuning, errors, ok });
  console.log(c.name, ok ? 'OK' : 'FAIL', JSON.stringify(tuning), errors.length ? 'errors=' + errors.length : '');
  if (errors.length) console.log('   ' + errors.slice(0, 3).join(' | '));
  await page.close();
}

// 设置页里的「机型兼容」行：进入大厅 → 打开设置 → 点「流畅」→ 读 sp.pref.settings
{
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 720 });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e.message)));
  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await new Promise((r) => setTimeout(r, 1800));
  const out = await page.evaluate(async () => {
    const click = (el) => el && el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    const name = document.querySelector('.title-login input, input[type="text"]');
    if (name) {
      name.value = `compat-${Math.floor(Math.random() * 900 + 100)}`;
      name.dispatchEvent(new Event('input', { bubbles: true }));
      await new Promise((r) => setTimeout(r, 120));
      click([...document.querySelectorAll('button')].find((b) => /开始/.test(b.textContent || '')));
    }
    await new Promise((r) => setTimeout(r, 2400));
    click(document.querySelector('.lobby-settings'));
    await new Promise((r) => setTimeout(r, 600));
    const row = document.querySelector('[data-testid="device-compat"]');
    const buttons = row ? [...row.querySelectorAll('button')] : [];
    const labels = buttons.map((b) => b.textContent.trim());
    const smooth = buttons.find((b) => /流畅/.test(b.textContent || ''));
    click(smooth);
    await new Promise((r) => setTimeout(r, 300));
    let saved = null;
    try { saved = JSON.parse(localStorage.getItem('sp.pref.settings') || 'null'); } catch { /* ignore */ }
    return { row: !!row, labels, compatMode: saved?.compatMode ?? null };
  });
  const ok = out.row && out.labels.length === 3 && out.compatMode === 'smooth' && errors.length === 0;
  console.log('settings-row', ok ? 'OK' : 'FAIL', JSON.stringify(out), errors.length ? 'errors=' + errors.length : '');
  if (!ok) results.push({ name: 'settings-row', ok: false, tuning: out, errors });
  await page.close();
}

await browser.close();
const bad = results.filter((r) => !r.ok);
console.log(`\nRESULT: ${bad.length ? 'CHECK ABOVE — ' + bad.map((b) => b.name).join(', ') : 'OK — 6 组 UA + 设置行均正常'}`);
process.exit(bad.length ? 1 : 0);

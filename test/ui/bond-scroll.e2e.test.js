import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CHROME, hasChrome } from '../e2e/client.mjs';
// 盟约条（业主 2026-10-29：0.3.1 的居中 / 原生横向滚动；两侧 ‹ › 调整键删除；后续要求补上向上收起 / 两端淡出 / 鼠标拖）：
// 条体自己是原生横向滚动盒（触屏 / 滚轮 / 方向键都能滚），右侧一颗裸箭头收起，过长时 data-edge 让两端淡出。
test('every bond is reachable: the strip pans natively, folds from its chevron, and has no ‹ › keys', { skip: process.env.SP_E2E !== '1' || !hasChrome(), timeout: 90000 }, async () => {
  const { startServer } = await import('../../server/index.js');
  const puppeteer = (await import('puppeteer-core')).default;
  const srv = await startServer({ port: 0, host: '127.0.0.1', quiet: true });
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox', '--no-proxy-server'] });
  try {
    for (const [width, height, touch] of [[1920, 1080, false], [844, 390, true]]) {
      const page = await browser.newPage();
      const errors = []; page.on('pageerror', e => errors.push(e.message));
      await page.setViewport({ width, height, isMobile: touch, hasTouch: touch });
      await page.goto(srv.url + '/dev/game-mock.html?shot=1&render=fallback&phase=PREP');
      await page.waitForSelector('.bstrip .bond');
      const count = await page.evaluate(async () => {
        const { data } = await import('/js/data.js');
        const mock = globalThis.__MOCK__, state = mock.store.get();
        const bonds = data.list('bonds').map((b, i) => ({ bondId: b.bondId, count: 1, tier: 0, active: false, layers: i }));
        mock.store.set({ match: { ...state.match, private: { ...state.match.private, bonds } } });
        return bonds.length;
      });
      await page.waitForFunction(n => document.querySelectorAll('.bslot').length === n, {}, count);
      const bounds = await page.$eval('.bstrip', el => ({ width: el.clientWidth, all: el.scrollWidth }));
      assert.ok(bounds.all > bounds.width, 'the mock bond list overflows the strip');
      assert.equal(await page.$('.bstrip-scroll__arrow'), null, 'the ‹ › adjustment keys are deleted');
      // the strip is a native scroll box: focused, the keyboard pans it
      await page.focus('.bstrip');
      await page.keyboard.press('ArrowRight');
      await page.waitForFunction(() => document.querySelector('.bstrip').scrollLeft > 0);
      // the last bond is reachable by setting the native scroll position
      await page.$eval('.bstrip', el => { el.scrollLeft = el.scrollWidth; });
      await page.waitForFunction(() => {
        const el = document.querySelector('.bstrip');
        return el.scrollLeft + el.clientWidth >= el.scrollWidth - 1;
      });
      const last = '.bslot:last-child .bond';
      await page.click(last); await page.waitForSelector('.bpop');
      await page.click('.bpop__close');
      // 向上收起：条体右侧那颗裸箭头把列表 hidden 掉，再点展开（列表始终在 DOM 里）
      assert.ok(await page.$('.gm__bonds .bonds-toggle'), 'the fold key is there');
      assert.equal(await page.$eval('#match-bond-strip', el => el.hidden), false, 'open by default');
      await page.click('.gm__bonds .bonds-toggle');
      assert.equal(await page.$eval('#match-bond-strip', el => el.hidden), true, 'one press folds it up');
      assert.equal(await page.$eval('.gm__bonds .bonds-toggle', el => el.getAttribute('aria-expanded')), 'false');
      await page.click('.gm__bonds .bonds-toggle');
      assert.equal(await page.$eval('#match-bond-strip', el => el.hidden), false, 'a second press opens it');
      // the shared component in a 300 px host: all slots, native overflow, no arrows, a clean unmount
      const small = await page.evaluate(async () => {
        const { data } = await import('/js/data.js');
        const { render } = await import('/vendor/preact.module.js');
        const { html } = await import('/js/ui/components.js');
        const { BondStrip } = await import('/js/ui/bondStrip.js');
        const host = document.createElement('div'); host.id = 'small-bonds';
        host.className = 'gm__bonds'; host.style.width = '300px'; document.body.appendChild(host);
        const bonds = data.list('bonds').map(b => ({ bondId: b.bondId, count: 1, tier: 0, layers: 0 }));
        render(html`<div class="gm__bond-list"><${BondStrip} bonds=${bonds} layersDisabled=${true} onOpen=${() => {}} /></div>`, host);
        await new Promise(r => setTimeout(r, 100));
        const strip = host.querySelector('.bstrip');
        const result = { all: strip.querySelectorAll('.bslot').length, width: strip.clientWidth, scroll: strip.scrollWidth, arrows: host.querySelectorAll('.bstrip-scroll__arrow').length };
        render(null, host); host.remove();
        return result;
      });
      assert.equal(small.all, count);
      assert.ok(small.width <= 300 && small.scroll > small.width, 'the short host overflows natively');
      assert.equal(small.arrows, 0);
      assert.deepEqual(errors, []);
      await page.close();
    }
  } finally { await browser.close(); await srv.close(); }
});

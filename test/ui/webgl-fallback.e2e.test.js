// The renderer fallback chain, on a real browser, with WebGL taken away.
//
//   SP_E2E=1 node --test test/ui/webgl-fallback.e2e.test.js
//   SP_E2E=1 CHROME_PATH="C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe" node --test test/ui/webgl-fallback.e2e.test.js
//
// Why this exists: the "black screen after the loading bar" reports were first blamed on WebGL. Measured, the client
// already degrades — no webgl2 → the 2D board; no WebGL at all → the DOM simplified view (ui/fallbackField.js);
// context lost → 2D board again. That fallback chain is the only defence a player on an old GPU has, and every part of
// it is invisible to the unit tests, so it is pinned here. OFF by default: it needs a browser.

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const CHROME = process.env.CHROME_PATH || (process.platform === 'win32'
  ? ['C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', 'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe']
    .find((p) => existsSync(p))
  : '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome');
const ENABLED = process.env.SP_E2E === '1' && !!CHROME && existsSync(CHROME);

const { startServer } = await import(pathToFileHref('server/index.js'));
const { TestClient } = await import(pathToFileHref('test/helpers/wsClient.js'));

function pathToFileHref(rel) {
  return new URL(`file:///${path.join(ROOT, rel).replace(/\\/g, '/')}`).href;
}

// Strip getContext support before any page script runs, the way an old WebView or a GPU blacklist would.
const STRIP = (mode) => `(() => {
  const orig = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (type, ...rest) {
    if (${JSON.stringify(mode)} === 'no-webgl2' && type === 'webgl2') return null;
    if (${JSON.stringify(mode)} === 'no-webgl' && /^(webgl2|webgl|experimental-webgl)$/.test(type)) return null;
    return orig.call(this, type, ...rest);
  };
})()`;

describe('WebGL fallback chain (real browser)', { skip: !ENABLED && 'browser-only: set SP_E2E=1 (and CHROME_PATH)' }, () => {
  let srv, browser, base;

  before(async () => {
    srv = await startServer({ port: 0, host: '127.0.0.1', quiet: true });
    base = `http://127.0.0.1:${srv.port}`;
    const puppeteer = (await import('puppeteer-core')).default;
    browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] });
  });
  after(async () => { await browser?.close(); await srv?.close?.(); });

  const openPrep = async (mode) => {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 720, deviceScaleFactor: 2 });
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e.message).slice(0, 160)));
    await page.evaluateOnNewDocument(STRIP(mode));
    await page.goto(`${base}/dev/game-mock.html?shot=1&phase=PREP&board=3d&render=engine`, { waitUntil: 'networkidle0' });
    await new Promise((r) => setTimeout(r, 8000));
    const state = await page.evaluate(() => {
      const vis = (e) => { if (!e) return false; const s = getComputedStyle(e); const r = e.getBoundingClientRect();
        return s.opacity !== '0' && s.display !== 'none' && r.width > 0 && r.height > 0; };
      return {
        webgl2: (() => { try { return !!document.createElement('canvas').getContext('webgl2'); } catch { return false; } })(),
        canvases: [...document.querySelectorAll('canvas')].filter((c) => c.clientWidth > 100).length,
        fieldVisible: vis(document.querySelector('.gm__field')),
        simplified: [...document.querySelectorAll('[class*="ff-"]')].filter(vis).length,
        pieces: document.querySelectorAll('.ff-unit, .ff-piece').length,
        bootError: document.getElementById('boot-err')?.textContent?.trim() || '',
      };
    });
    await page.close();
    return { state, errors };
  };

  test('without WebGL2 the field still draws on a WebGL canvas (2D board)', async () => {
    const { state, errors } = await openPrep('no-webgl2');
    assert.equal(state.webgl2, false, 'the probe must really have no webgl2');
    assert.ok(state.fieldVisible, 'the field is on screen');
    assert.ok(state.canvases >= 1, `expected a canvas board, got ${state.canvases}`);
    assert.equal(state.bootError, '', 'no boot error should be shown');
    assert.deepEqual(errors, [], 'no uncaught page errors');
  });

  test('without any WebGL the field falls back to the DOM simplified board', async () => {
    const { state } = await openPrep('no-webgl');
    assert.equal(state.canvases, 0, 'nothing should be left drawing into a dead canvas');
    assert.ok(state.fieldVisible, 'the field is on screen');
    assert.ok(state.pieces > 0, `simplified view should place units, found ${state.pieces} .ff-unit/.ff-piece`);
    assert.ok(state.simplified > 0, 'the simplified view must be visible, not merely present');
  });
});

void TestClient;

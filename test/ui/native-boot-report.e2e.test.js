// The two halves of the blank-screen escape hatch that a device is not needed to prove:
//
//   1. the page really does report itself over the bridge (MainActivity's watchdog only stays silent while this lands);
//   2. `?render=fallback` — what 「兼容模式重启」 reloads with — really forces the DOM board on a browser that *does*
//      have WebGL, i.e. the escape hatch does not depend on the GPU being broken.
//
//   SP_E2E=1 node --test test/ui/native-boot-report.e2e.test.js
//   SP_E2E=1 CHROME_PATH="C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe" node --test test/ui/native-boot-report.e2e.test.js

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

const href = (rel) => new URL(`file:///${path.join(ROOT, rel).replace(/\\/g, '/')}`).href;
const { startServer } = await import(href('server/index.js'));

// Everything AndroidBridge exposes, so the app takes its native-shell branches for real.
const FAKE_BRIDGE = () => {
  window.__reports = [];
  window.AndroidNative = {
    isNativeApp: () => true,
    getAppVersion: () => '0.0.0-test',
    getLocalIp: () => '192.0.2.10',
    findRoom: () => {},
    connectToHost: () => {},
    openServerSettings: () => {},
    restartLocalServer: () => {},
    getLogs: () => '',
    showLogs: () => {},
    reloadClient: () => {},
    enableCompatMode: () => { window.__compatCalls = (window.__compatCalls || 0) + 1; },
    reportClientState: (json) => { window.__reports.push(json); return json; },
    getClientState: () => (window.__reports.length ? window.__reports[window.__reports.length - 1] : 'null'),
  };
};

describe('blank-screen escape hatch (real browser, faked Android bridge)', { skip: !ENABLED && 'browser-only: set SP_E2E=1' }, () => {
  let srv, browser, base;

  before(async () => {
    srv = await startServer({ port: 0, host: '127.0.0.1', quiet: true });
    base = `http://127.0.0.1:${srv.port}`;
    const puppeteer = (await import('puppeteer-core')).default;
    browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] });
  });
  after(async () => { await browser?.close(); await srv?.close?.(); });

  const open = async (url, waitMs = 9000) => {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 720, deviceScaleFactor: 2 });
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e.message).slice(0, 160)));
    await page.evaluateOnNewDocument(FAKE_BRIDGE);
    await page.goto(url, { waitUntil: 'networkidle0' });
    await new Promise((r) => setTimeout(r, waitMs));
    return { page, errors };
  };

  test('the page reports itself to the shell once it has rendered', async () => {
    const { page, errors } = await open(`${base}/`);
    const reports = await page.evaluate(() => (window.__reports || []).map((r) => { try { return JSON.parse(r); } catch { return { raw: r }; } }));
    await page.close();
    assert.ok(reports.length >= 1, `expected at least one reportClientState call, got ${reports.length}`);
    const last = reports[reports.length - 1];
    assert.equal(last.booted, true, 'the report must say the app object exists');
    assert.ok(last.rootChildren > 0, `#app should have content, got ${last.rootChildren}`);
    assert.ok(typeof last.webgl2 === 'boolean' && typeof last.webgl === 'boolean', 'GL capability must be reported');
    assert.ok(last.dpr >= 1 && last.vw > 0, `viewport should be measured, got dpr=${last.dpr} vw=${last.vw}`);
    assert.ok(/Chrome\//.test(last.ua || ''), 'UA is the one number the player cannot read off a black screen');
    assert.deepEqual(errors, [], 'no uncaught page errors while booting');
  });

  test('?render=fallback forces the DOM board even when WebGL works', async () => {
    const probe = await (await fetch(`${base}/healthz`)).json();
    assert.ok(probe.ok, 'server up');
    const { page } = await open(`${base}/dev/game-mock.html?shot=1&phase=PREP&board=3d&render=fallback`);
    const state = await page.evaluate(() => {
      const vis = (e) => { if (!e) return false; const s = getComputedStyle(e); const r = e.getBoundingClientRect();
        return s.opacity !== '0' && s.display !== 'none' && r.width > 0 && r.height > 0; };
      return {
        canvases: [...document.querySelectorAll('canvas')].filter((c) => c.clientWidth > 100).length,
        webglAvailable: (() => { try { return !!document.createElement('canvas').getContext('webgl2'); } catch { return false; } })(),
        pieces: document.querySelectorAll('.ff-unit, .ff-piece').length,
        simplifiedVisible: vis(document.querySelector('[class*="ff-"]')),
      };
    });
    await page.close();
    assert.ok(state.webglAvailable, 'this browser does have WebGL — the param, not the GPU, must be doing the work');
    assert.equal(state.canvases, 0, `expected no canvas board under render=fallback, got ${state.canvases}`);
    assert.ok(state.pieces > 0, `the DOM board should place units, got ${state.pieces}`);
    assert.ok(state.simplifiedVisible, 'the DOM board must be visible');
  });
});

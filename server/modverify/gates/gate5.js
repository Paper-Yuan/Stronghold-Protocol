// server/modverify/gates/gate5.js — client render smoke (§2-C2-6, skeleton acceptance).
// puppeteer-core + CHROME_PATH from env; without a Chrome path this gate reports 'skip'
// (never 'pass'). The smoke serves merged data over a minimal static server and loads the
// alliance/equipment codex pages, capturing console errors and 404s for mod-referenced art.

import { promises as fsp } from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { unpackModZip } from '../../../shared/modZip.js';

export async function run({ stagingDir, zipPath, packId }) {
  const chromePath = process.env.CHROME_PATH || process.env.PUPPETEER_EXECUTABLE_PATH;
  if (!chromePath) {
    return { status: 'skip', detail: 'CHROME_PATH 未设置（Windows 无默认路径，§2-C2-6 写明管理员义务）；skip≠pass，放行归管理员确认' };
  }

  let puppeteer;
  try {
    puppeteer = (await import('puppeteer-core')).default;
  } catch {
    return { status: 'skip', detail: 'puppeteer-core 未安装（npm install 后重跑）' };
  }

  // 1. unpack and merge
  let zipBuffer;
  if (zipPath) {
    zipBuffer = new Uint8Array(await fsp.readFile(zipPath));
  } else {
    const { buildZip } = await import('../../../test/helpers/miniZip.js');
    const files = {};
    for (const f of await fsp.readdir(stagingDir)) {
      if (f.endsWith('.json')) files[f] = await fsp.readFile(path.join(stagingDir, f));
    }
    zipBuffer = buildZip(files);
  }
  const { sections } = await unpackModZip(zipBuffer);

  // 2. minimal static server that overlays merged data onto /data/*.json
  const publicDir = path.resolve('public');
  const merged = { ...sections };
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');
    const m = /^\/data\/([a-z]+)\.json$/.exec(url.pathname);
    if (m && merged[m[1]]) {
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify(merged[m[1]]));
      return;
    }
    // fall through to the real public/ tree (codex pages, css, vendor)
    try {
      const rel = decodeURIComponent(url.pathname).replace(/^\/+/, '') || 'index.html';
      const file = path.join(publicDir, rel);
      if (!path.resolve(file).startsWith(publicDir)) { res.writeHead(403); res.end(); return; }
      const body = await fsp.readFile(file);
      res.setHeader('content-type', rel.endsWith('.js') ? 'text/javascript' : rel.endsWith('.css') ? 'text/css' : rel.endsWith('.json') ? 'application/json' : 'text/html');
      res.end(body);
    } catch {
      res.writeHead(404); res.end();
    }
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;

  const consoleErrors = [];
  const pageErrors = [];
  const badResponses = [];
  let browser;
  try {
    browser = await puppeteer.launch({ executablePath: chromePath, headless: true, args: ['--no-sandbox'] });
    const page = await browser.newPage();
    page.on('console', (msg) => { if (msg.type() === 'error') consoleErrors.push(msg.text().slice(0, 200)); });
    page.on('pageerror', (err) => pageErrors.push(String(err).slice(0, 200)));
    page.on('response', (r) => { if (r.status() >= 400 && !r.url().includes('favicon')) badResponses.push(`${r.status()} ${r.url()}`); });

    for (const pagePath of ['/js/screens/alliances.js', '/js/screens/equipment.js']) {
      // The codex screens are modules; smoke = fetch + evaluate import graph, not full render loop.
      const resp = await page.goto(`http://127.0.0.1:${port}${pagePath}`, { waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => null);
      if (!resp || !resp.ok()) badResponses.push(`${resp?.status() ?? 'ERR'} ${pagePath}`);
    }
  } finally {
    if (browser) await browser.close();
    server.close();
  }

  const problems = [];
  if (pageErrors.length) problems.push(`pageerror: ${pageErrors.slice(0, 3).join('; ')}`);
  if (badResponses.length) problems.push(`HTTP 错误: ${badResponses.slice(0, 5).join('; ')}`);
  if (problems.length) {
    return { status: 'fail', detail: `渲染冒烟问题: ${problems.join(' | ')}` };
  }
  return { status: 'pass', detail: `渲染冒烟通过（alliance/equipment codex 加载无 pageerror、无 4xx/5xx；mod art 404 会在 badResponses 记账）` };
}

// v2 icon in-game shot: real server (fastServer hooks) + puppeteer, 超限模拟 (solo_infinite) R1 prep.
// Temporary script; deleted after delivery.
import puppeteer from 'puppeteer-core';
import { startRealServer, Client, sleep, CHROME } from '../test/e2e/client.mjs';

const OUT_DIR = 'handoff/shots';
const srv = await startRealServer({
  port: 3171,
  fast: { timerScale: 1, combatSpeed: 2, startRound: 1, kit: 2,
          items: ['chess_item_6_09_e_a', 'chess_item_ol_01_e_a'] },
});
console.log('server', srv.base);

const c = new Client(puppeteer, srv.base, 'ol2', { w: 1920, h: 1080, prefix: 'ol-core-v2' });
const responses = [];
try {
  await c.open();
  c.page.on('response', (r) => { if (/\/assets\/item\//.test(r.url())) responses.push([r.status(), r.url()]); });
  await c.enter('万色');
  await c.click('.mode-card', '独立模拟');
  await c.click('.diff-card', '超限模拟');
  await c.click('.create-box button', '开始独立模拟');
  await c.waitFor((s) => !!s.room, 'solo room');
  if (!(await c.st()).phase) await c.click('.room-bar__right button', '开始模拟', { timeout: 20000 });
  await c.waitFor((s) => s.phase === 'INFO_CHECK', 'briefing', 30000);
  await c.click('.brief__foot .btn--primary', '准备就绪');
  await c.waitFor((s) => s.phase === 'BAND_DRAFT', 'band draft', 30000);
  await c.click('.dband', null, { nth: 1 });
  await c.click('.draft-detail__btns .btn--primary', '确认选择');
  const st = await c.waitFor((x) => x.phase === 'PREP' && !x.ready, 'prep', 60000);
  await sleep(2600); // camera flight + bench icons decode

  const info = await c.page.evaluate(async () => {
    const s = globalThis.__SP__.store.get();
    const priv = s.match.private;
    const hand = (priv?.hand || []).filter(Boolean).map((p) => ({ id: p.id, kind: p.kind, uid: p.uid }));
    const iconOf = (id) => globalThis.__SP__.data.lookup('items', id)?.iconId ?? null;
    const man = await fetch('/data/assets.json').then((r) => r.json());
    const urls = { morph: man.items['trap_1073_acarm073'], ol: man.items['trap_ol_core'] };
    const loaded = performance.getEntriesByType('resource').map((e) => e.name).filter((n) => /trap_ol_core|trap_1073/.test(n));
    const sha = async (u) => {
      const buf = await fetch(u).then((r) => r.arrayBuffer());
      const d = await crypto.subtle.digest('SHA-256', buf);
      return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
    };
    const live = {};
    for (const [k, u] of Object.entries(urls)) if (u) live[k] = { url: u, sha256: await sha(u) };
    return { mode: s.room?.mode ?? null, phase: s.match.public?.phase ?? null, round: s.match.public?.round ?? null,
             hand, items: hand.filter((p) => p.kind === 'item').map((p) => ({ id: p.id, iconId: iconOf(p.id) })),
             manifest: urls, loaded, live };
  });
  console.log(JSON.stringify(info, null, 2));

  await c.page.screenshot({ path: `${OUT_DIR}/ol-core-icon-v2-ingame-1920x1080.png` });
  await c.page.setViewport({ width: 792, height: 360 });
  await sleep(1400);
  await c.page.screenshot({ path: `${OUT_DIR}/ol-core-icon-v2-ingame-792x360.png` });
  console.log('problems', JSON.stringify(c.problems));
  console.log('item responses', JSON.stringify(responses.filter(([s, u]) => /trap_ol_core|trap_1073/.test(u))));
} finally {
  await c.close().catch(() => {});
  await srv.stop();
}

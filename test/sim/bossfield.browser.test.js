// test/sim/bossfield.browser.test.js — the Final Assault / Hidden Core fields in the BROWSER sim (DESIGN §14: the
// clients simulate the boss fields; the server re-simulates them for SP_VERIFY and takeovers). A real bot co-op match
// (终极, seed 22 since 0.1.1 — the bots and the rules of 0.1.1 play seed 12 to boards without a 麻痹 or a 剑 / 锤
// transfer on every field, and seed 14 since the 22-match R11 drafts to boards without a 麻痹; seed 22's pair fields
// carry 奥术, 催泪瓦斯 and 限伤-sized hits) is played to the Hidden Core
// with every active bond at the official 999 layers (DESIGN §20.12); its four captured boss specs (R14 假想敌：胄 boss_1, R15 隐秘核心 boss_8) run to
// the end in Node and in headless Chrome through the client's own loader (public/js/battle/runner.js loadBrowserSim)
// with the field's LocalBossPool, and must give the same result digest, the same pool and the same fx per kind.
// The fields exercise the playtest-6b sim paths: 直接乘算 bonus sums (§20.10), one 奥术 instance per target
// (applyStrongest), the drone 2 % links and the 剑 / 锤 / shell kit (§20.13), and 限伤 cancels (fx 'hitCap', §20.12).
//
// Opt-in (starts Chrome): SIM_E2E=1 node --test test/sim/bossfield.browser.test.js   (or RENDER_E2E=1)
// Run browser test files one at a time. Chrome path: $CHROME_PATH or the macOS default.

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PHASE, BOND_LAYER_CAP } from '../../shared/constants.js';
import { createBattleFromSpec, resultDigest } from '../../server/sim/spec.js';
import { DataSource } from '../../server/sim/simdata.js';
import { makeMatch, DATA } from '../match/harness.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const enabled = (process.env.RENDER_E2E === '1' || process.env.SIM_E2E === '1') && existsSync(CHROME);
const skip = enabled ? false : 'set SIM_E2E=1 or RENDER_E2E=1 (needs Chrome)';
const MAX_SECONDS = 600; // game seconds (Battle.runToEnd): every captured field clears long before

/** The boss / hidden specs of a 4-bot co-op match (终极, seed 22, boss_1 then boss_8), every active bond at 999. */
function captureBossSpecs() {
  const seats = [0, 1, 2, 3].map((i) => ({ seat: i, playerId: `ai_${i}`, name: `AI${i}`, isBot: true, connected: true }));
  const h = makeMatch({ mode: 'coop', difficulty: 'ABYSS', seats, seed: 22, captureFrames: false, instant: false, clientCombat: true });
  const m = h.m;
  m.bossId = 'boss_1';
  m.hiddenBossId = 'boss_8';
  const specs = [];
  const orig = m._ccField.bind(m);
  m._ccField = (o) => { const f = orig(o); if (f.kind === 'boss' || f.kind === 'hidden') specs.push(f.spec); return f; };
  m.start();
  let last = '';
  h.run(() => {
    const k = `${m.phase}:${m.round}`;
    if (k !== last) {
      last = k;
      if (m.phase === PHASE.PREP && m.round === 1) for (const ps of m.players.values()) ps.lp = 400;
      if (m.phase === PHASE.PREP && m.round === m.gd.bossRound) {
        for (const ps of m.alivePlayers()) {
          for (const id of m.gd.bondIds) if (ps.bonds[id] && ps.bonds[id].active) ps.layers[id] = BOND_LAYER_CAP;
          ps.recompute();
        }
      }
    }
    return h.ended != null || m.phase === PHASE.HIDDEN_CORE;
  }, { maxSteps: 8e6 });
  assert.equal(m.phase, PHASE.HIDDEN_CORE, 'the bots reached the Hidden Core');
  m.dispose();
  return specs;
}

/**
 * Runs a spec to the end (the same code in Node and in the page: `S` = spec module, `ds` = data source) and returns
 * its digest, the local pool, the fx count per kind and the leader-side checks (奥术 instances, 无来源 HP losses).
 * Serialised into the page with Function#toString, so it uses nothing from this module's scope.
 */
function runField(S, ds, spec, maxSeconds) {
  const b = S.createBattleFromSpec(spec, ds, { quiet: true, recordEvents: false });
  const fx = {};
  const fx0 = b.fx.bind(b);
  b.fx = (k, p) => { fx[k] = (fx[k] || 0) + 1; return fx0(k, p); };
  let hpLoss = 0;
  b.on('damaged', (c) => { if (c.target && c.target.isBoss && c.dmg && c.dmg.tags && c.dmg.tags.includes('hpLoss')) hpLoss++; }, { priority: -1e9 });
  let maxArcane = 0;
  b.on('tick', () => {
    for (const e of b.enemies) {
      if (!e.alive || !e.isBoss) continue;
      const n = e.buffs.filter((x) => String(x.key).startsWith('bond:arcaneShip')).length;
      if (n > maxArcane) maxArcane = n;
    }
  });
  const r = b.runToEnd(maxSeconds);
  const d = S.resultDigest(r);
  return { hash: d.hash, json: d.json, reason: r ? r.reason : null, poolHp: b.sharedBoss ? b.sharedBoss.hp : null, fx, hpLoss, maxArcane };
}

describe('Final Assault / Hidden Core fields in the browser sim', { skip }, () => {
  let srv, browser;
  before(async () => {
    const puppeteer = (await import('puppeteer-core')).default;
    const { startServer } = await import('../../server/index.js');
    srv = await startServer({ port: 0, host: '127.0.0.1', quiet: true });
    browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-first-run'] });
  });
  after(async () => {
    await browser?.close();
    await srv?.close();
  });

  test('real boss specs at 999 layers: Chrome and Node give the same digest, pool and fx; 限伤, drones, 瘫痪 and 奥术 all occur', { timeout: 180000 }, async () => {
    const specs = captureBossSpecs();
    assert.deepEqual(specs.map((s) => `${s.kind}:${s.bossId}`).sort(), ['boss:boss_1', 'boss:boss_1', 'hidden:boss_8', 'hidden:boss_8']);
    const ds = new DataSource(DATA, null);
    const node = specs.map((spec) => runField({ createBattleFromSpec, resultDigest }, ds, spec, MAX_SECONDS));

    const page = await browser.newPage();
    const problems = [];
    page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
    // (a failed request is reported by the response handler with its URL; the favicon 404 is not a problem)
    page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) problems.push(`console: ${m.text()}`); });
    page.on('response', (r) => { if (r.status() >= 400 && !/favicon/.test(r.url())) problems.push(`HTTP ${r.status()} ${r.url()}`); });
    await page.goto(`http://127.0.0.1:${srv.port}/sim/spec.js`);
    const chrome = await page.evaluate(async (all, src, maxSeconds) => {
      const { loadBrowserSim } = await import('/js/battle/runner.js');
      const { spec: S, ds } = await loadBrowserSim();
      const run = new Function(`return (${src})`)();
      return all.map((spec) => run(S, ds, spec, maxSeconds));
    }, specs, runField.toString(), MAX_SECONDS);
    await page.close();
    assert.deepEqual(problems, []);

    specs.forEach((spec, i) => {
      const at = `${spec.kind} ${spec.fieldId} ${spec.bossId}`;
      assert.equal(node[i].reason, 'cleared', `${at}: the 999-layer pair clears the field`);
      assert.equal(chrome[i].json, node[i].json, `${at}: browser and Node results are identical`);
      assert.equal(chrome[i].hash, node[i].hash, at);
      assert.equal(chrome[i].poolHp, node[i].poolHp, `${at}: same local pool`);
      assert.deepEqual(chrome[i].fx, node[i].fx, `${at}: same fx per kind`);
      assert.equal(chrome[i].hpLoss, node[i].hpLoss, `${at}: same 无来源 HP losses on the leader`);
      assert.ok(node[i].maxArcane <= 1, `${at}: one 奥术 instance on the leader at a time (${node[i].maxArcane})`);
    });
    const sum = (k) => node.reduce((a, r) => a + (r.fx[k] || 0), 0);
    assert.ok(sum('hitCap') >= 1, `a 999-layer hit reached 300000 and was cancelled (限伤: ${sum('hitCap')})`);
    assert.ok(sum('palsy') >= 1, `瘫痪 occurred (${sum('palsy')})`);
    assert.ok(node.every((r) => r.hpLoss >= 1), `every field cost the leader 无来源 HP (drone links / 剑 · 锤 transfers: ${node.map((r) => r.hpLoss)})`);
    assert.ok(node.some((r) => r.maxArcane === 1), 'the leader carried 奥术');
  });
});

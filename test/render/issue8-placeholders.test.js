// Public issue #8 item 5 (v0.1.1): "游览器切换页面后所有干员会变成方块+水滴的图标" — after the tab came back every operator was
// the image-less placeholder (diamond + droplet glyph). A plain tab switch did not do it; a reload did (phone browsers
// and Chrome's Memory Saver discard background tabs and reload them on return; the game resumes into the match): the
// asset store fetched /data/assets.json a second time, createFieldView waited ≤ 4 s for it, every view looked its model
// and avatar up once, and a failed fetch kept an empty manifest for the page. Without a reload, a battle that began
// in a hidden tab referenced no skeleton, so the quiet budget emptied the Spine cache ≈ 18 s later.
//   public/js/assets.js: seed / ready retries + backoff / onChange / spine acquire { retry } / spine hold;
//   public/js/render/units.js: UnitView.retryAssets, bounded Spine retries (SPINE_RETRY_MS), ItemView.setIcon;
//   public/js/ui/fieldHost.js seedAssets; public/js/render/app.js (wiring: onChange, visibilitychange, battle hold).

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { installFakePixi, fakeViewCtx } from './fakepixi.js';
import { presetCamera } from '../../public/js/render/projection.js';
import {
  createAssets, RefLru, MANIFEST_RETRY_MS, MANIFEST_BACKOFF_MS, SPINE_IDLE_GRACE_MS, SPINE_QUIET_DELAY_MS, SPINE_EVICT_DELAY_MS,
} from '../../public/js/assets.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (p) => readFileSync(path.join(ROOT, p), 'utf8');
const tick = () => new Promise((r) => setImmediate(r));
const quiet = async (fn) => { const w = console.warn; console.warn = () => {}; try { return await fn(); } finally { console.warn = w; } };

/** Fake clock + timers (RefLru `now` / `timers`, the store's backoff `timers`). */
const clock = () => {
  const c = { t: 0, pending: [] };
  c.now = () => c.t;
  c.timers = { set: (fn, ms) => { const h = { fn, at: c.t + ms, ms }; c.pending.push(h); return h; }, clear: (h) => { c.pending = c.pending.filter((x) => x !== h); } };
  c.advance = (ms) => { c.t += ms; for (const h of c.pending.filter((x) => x.at <= c.t)) { c.pending = c.pending.filter((x) => x !== h); h.fn(); } };
  return c;
};

const SP = (id) => ({ skel: `/assets/spine/${id}.skel`, atlas: `/assets/spine/${id}.atlas`, textures: [`/assets/spine/${id}.png`], anims: { idle: 'Idle' }, animations: { Idle: 1 } });
const M = {
  chars: { char_002_amiya: { avatar: '/a/amiya.png', spine: { front: SP('amiya_f') } }, char_010_chen: { avatar: '/a/chen.png', spine: { front: SP('chen_f') } } },
  enemies: { enemy_1305_mhslim: { icon: '/e/mh.png', spineLocal: { group: 'spine/enemy/mh', skel: 'mh.skel', atlas: 'mh.atlas', textures: ['mh.png'], anims: { idle: 'Idle' } } } },
  items: { trap_1: '/i/1.png' },
  ui: {},
};
const LOCAL = { groups: { 'spine/enemy/mh': { 'mh.skel': { path: '/l/mh.skel' }, 'mh.atlas': { path: '/l/mh.atlas' }, 'mh.png': { path: '/l/mh.png' } } } };
const ok = (json) => ({ ok: true, status: 200, json: async () => json });

describe('the manifest: seeded, retried, never kept empty (assets.js)', () => {
  test('seed: the game data\'s copy is adopted — no download, ready() resolves it, listeners hear it', async () => {
    let fetches = 0;
    const a = createAssets({ fetch: async () => { fetches++; return ok(M); } });
    const heard = [];
    a.onChange((w) => heard.push(w));
    assert.equal(a.seed(M), true);
    assert.equal(await a.ready(), M);
    assert.equal(fetches, 0, 'nothing downloaded');
    assert.equal(a.avatar('char_002_amiya'), '/a/amiya.png');
    assert.deepEqual(heard, ['manifest']);
    assert.equal(a.seed({ chars: {} }), false, 'a loaded manifest is kept');
    assert.equal(a.seed(null), false);
  });

  test('a transient failure is fetched again within the same ready() (MANIFEST_RETRY_MS, like data.js)', async () => {
    assert.deepEqual([...MANIFEST_RETRY_MS], [600, 2000]);
    const waits = [];
    let n = 0;
    const a = createAssets({ wait: async (ms) => { waits.push(ms); }, fetch: async () => { n++; if (n < 3) throw new TypeError('Failed to fetch'); return ok(M); } });
    assert.equal(await a.ready(), M);
    assert.equal(n, 3);
    assert.deepEqual(waits, [600, 2000]);
  });

  test('every try failing: ready() resolves {} (fallbacks), the failure is not kept — the next ready() fetches again', async () => {
    let n = 0, up = false;
    const c = clock();
    const a = createAssets({ wait: async () => {}, timers: c.timers, fetch: async () => { n++; if (!up) return { ok: false, status: 503 }; return ok(M); } });
    const heard = [];
    a.onChange((w) => heard.push(w));
    assert.deepEqual(await quiet(() => a.ready()), {});
    assert.equal(n, 3, 'the first try + 2 retries');
    assert.equal(a.manifest, null);
    assert.equal(a.loaded, false);
    assert.equal(a.avatar('char_002_amiya'), null, 'helpers fall back meanwhile');
    up = true;
    assert.equal(await a.ready(), M, 'asked again: fetched again (no empty manifest kept for the page)');
    assert.equal(n, 4);
    assert.deepEqual(heard, ['manifest']);
    assert.equal(c.pending.length, 0, 'the background try was cancelled by the success');
  });

  test('after a failed ready() the store tries again by itself, with a bounded backoff', async () => {
    assert.ok(MANIFEST_BACKOFF_MS.length >= 3 && MANIFEST_BACKOFF_MS.every((ms, i) => i === 0 || ms >= MANIFEST_BACKOFF_MS[i - 1]));
    const c = clock();
    let n = 0, up = false;
    const a = createAssets({ wait: async () => {}, timers: c.timers, backoff: [100, 200], retryDelays: [], fetch: async () => { n++; if (!up) throw new TypeError('offline'); return ok(M); } });
    const heard = [];
    a.onChange((w) => heard.push(w));
    await quiet(() => a.ready());
    assert.equal(n, 1);
    assert.deepEqual(c.pending.map((h) => h.ms), [100]);
    await quiet(async () => { c.advance(100); await tick(); await tick(); });
    assert.equal(n, 2, 'tried again after 100 ms');
    assert.deepEqual(c.pending.map((h) => h.ms), [200]);
    up = true;
    c.advance(200); await tick(); await tick();
    assert.equal(n, 3);
    assert.equal(a.manifest, M, 'arrived late');
    assert.deepEqual(heard, ['manifest'], 'listeners (render/app.js) re-resolve their views now');
    // bounded: a store that never gets it stops after the backoff list
    const d = clock();
    let m = 0;
    const b = createAssets({ wait: async () => {}, timers: d.timers, backoff: [10, 20], retryDelays: [], fetch: async () => { m++; throw new TypeError('offline'); } });
    await quiet(async () => {
      await b.ready();
      for (let i = 0; i < 6; i++) { d.advance(50); await tick(); await tick(); }
    });
    assert.equal(m, 3, 'the first try + 2 background tries');
    assert.equal(d.pending.length, 0);
  });

  test('a 404 or a body that is no JSON: no retry loop, but still not kept (the next ready() asks again)', async () => {
    const c = clock();
    let n = 0;
    const a = createAssets({ wait: async () => {}, timers: c.timers, fetch: async () => { n++; return n === 1 ? { ok: false, status: 404 } : { ok: true, status: 200, json: async () => { throw new SyntaxError('x'); } }; } });
    await quiet(() => a.ready());
    assert.equal(n, 1);
    assert.equal(c.pending.length, 0, 'no background tries for a definite failure');
    await quiet(() => a.ready());
    assert.equal(n, 2, 'asked again');
    assert.equal(a.manifest, null);
  });

  test('a seed while a fetch is still retrying wins; the late fetch changes nothing', async () => {
    let release;
    const gate = new Promise((r) => { release = r; });
    const a = createAssets({ wait: () => gate, fetch: async () => { throw new TypeError('slow network'); } });
    const p = a.ready();
    a.seed(M);
    release();
    assert.equal(await p, M);
    assert.equal(await a.ready(), M);
  });

  test('seedLocal: the local-client manifest from the game data (an enemy\'s local model resolves with it)', async () => {
    let fetches = 0;
    const a = createAssets({ manifest: M, fetch: async () => { fetches++; return ok(LOCAL); } });
    const heard = [];
    a.onChange((w) => heard.push(w));
    assert.equal(a.spineEntry('enemy_1305_mhslim'), null, 'no web model, no local manifest yet');
    assert.equal(a.seedLocal(LOCAL), true);
    assert.equal(await a.local(), LOCAL);
    assert.equal(fetches, 0);
    assert.equal(a.spineEntry('enemy_1305_mhslim').skel, '/l/mh.skel');
    assert.deepEqual(heard, ['local']);
    assert.equal(a.seedLocal({ groups: {} }), false, 'a known one is kept');
    assert.equal(createAssets({ manifest: M }).seedLocal({ nope: 1 }), false, 'not a local manifest');
  });
});

describe('Spine cache: retries and the scene hold (RefLru)', () => {
  test('a remembered failure is shared until failTtl — acquire { retry } loads again once nobody references it', async () => {
    let calls = 0, fail = true;
    const lru = new RefLru({ failTtl: 60000, now: () => 0, load: async (k) => { calls++; if (fail) throw new Error('timeout'); return k; } });
    await assert.rejects(lru.acquire('a'));
    lru.release('a');
    await assert.rejects(lru.acquire('a'), 'remembered: no second download for every new view');
    lru.release('a');
    assert.equal(calls, 1);
    fail = false;
    assert.equal(await lru.acquire('a', null, { retry: true }), 'a', 'a retry loads again');
    assert.equal(calls, 2);
    lru.release('a');
    // a failure some caller still references is shared (dropping it would make that caller's release hit the new entry)
    const b = new RefLru({ load: async () => { throw new Error('x'); } });
    const p1 = b.acquire('k');
    await assert.rejects(p1);
    await assert.rejects(b.acquire('k', null, { retry: true }));
    assert.equal(b.map.get('k').refs, 2);
  });

  test('hold(): no quiet budget while a scene holds the cache; the idle budget still applies; released → quiet again', async () => {
    const c = clock(), unloads = [];
    const lru = new RefLru({ load: async (k) => k, unload: (k) => unloads.push(k), weigh: (k) => (k === 'big' ? 900 : 100),
      maxIdleWeight: 1000, quietWeight: 0, idleGrace: SPINE_IDLE_GRACE_MS, quietDelay: SPINE_QUIET_DELAY_MS, evictDelay: SPINE_EVICT_DELAY_MS,
      now: c.now, timers: c.timers });
    for (const k of ['op1', 'op2', 'big']) await lru.acquire(k);
    // battle mode: the prep views go before the battle's views are built — in a hidden tab, not for a long while
    const release = lru.hold();
    for (const k of ['op1', 'op2', 'big']) lru.release(k);
    c.advance(SPINE_IDLE_GRACE_MS + SPINE_QUIET_DELAY_MS + 10000);
    assert.deepEqual(unloads, ['op1'], 'held: only the idle budget (1100 > 1000: the least recently used goes), not the quiet one');
    assert.equal(lru.stats().holds, 1);
    // the battle's views come back (the tab is shown): their models are still cached
    assert.equal(lru.peek('op2'), 'op2');
    release();
    release(); // twice: no effect
    assert.equal(lru.stats().holds, 0);
    c.advance(SPINE_QUIET_DELAY_MS - 100);
    assert.deepEqual(unloads, ['op1'], 'the quiet delay counts from the release');
    c.advance(200 + SPINE_EVICT_DELAY_MS);
    assert.deepEqual(unloads.sort(), ['big', 'op1', 'op2'], 'no scene: every idle skeleton goes (the phone gets its memory back)');
  });

  test('without a hold the old behaviour stays: nothing referenced for the quiet delay → the cache empties', async () => {
    const c = clock(), unloads = [];
    const lru = new RefLru({ load: async (k) => k, unload: (k) => unloads.push(k), weigh: () => 100, maxIdleWeight: 1e9, quietWeight: 0,
      idleGrace: SPINE_IDLE_GRACE_MS, quietDelay: SPINE_QUIET_DELAY_MS, evictDelay: SPINE_EVICT_DELAY_MS, now: c.now, timers: c.timers });
    await lru.acquire('op');
    lru.release('op');
    c.advance(SPINE_IDLE_GRACE_MS + SPINE_QUIET_DELAY_MS + 10);
    assert.deepEqual(unloads, ['op']);
  });

  test('the store exposes them: spine.acquire(entry, { retry }) and spine.hold()', async () => {
    let calls = 0, fail = true;
    const a = createAssets({ manifest: M, loadSpine: async (e) => { calls++; if (fail) throw new Error('x'); return { animations: [], from: e.skel }; }, unloadSpine: () => {} });
    const e = a.spineEntry('char_002_amiya');
    await assert.rejects(a.spine.acquire(e)); a.spine.release(e);
    fail = false;
    await assert.rejects(a.spine.acquire(e)); a.spine.release(e);
    assert.equal((await a.spine.acquire(e, { retry: true })).from, e.skel);
    assert.equal(calls, 2);
    const r = a.spine.hold();
    assert.equal(a.spine.stats().holds, 1);
    r();
    assert.equal(a.spine.stats().holds, 0);
  });
});

describe('views re-resolve and retry (render/units.js)', () => {
  let fake, UnitView, ItemView, SPINE_RETRY_MS;
  before(async () => {
    fake = installFakePixi();
    ({ UnitView, ItemView, SPINE_RETRY_MS } = await import('../../public/js/render/units.js'));
  });
  after(() => fake.restore());
  const cam = () => presetCamera('prep', { width: 1280, height: 720 });
  const IMG = { width: 180, height: 180 };
  const unit = (assets, info = {}) => new UnitView(fakeViewCtx(fake.P, { assets, cam }), { id: 1, side: 'ally', kind: 'chess', defId: 'char_002_amiya', spine: 'char_002_amiya', avatar: 'char_002_amiya', tier: 3, x: 5, y: 12, maxHp: 1000, ...info }, { prep: true });

  test('a view built before the manifest (a slow reload) is a placeholder; when it arrives retryAssets loads the model and avatar', async () => {
    const a = createAssets({ fetch: async () => ({ ok: false, status: 503 }), wait: async () => {}, retryDelays: [], backoff: [], loadImage: async () => IMG,
      loadSpine: async () => ({ animations: [{ name: 'Idle' }] }), unloadSpine: () => {} });
    await quiet(() => a.ready());
    const v = unit(a);
    await tick(); await tick();
    for (let i = 0; i < 3; i++) v.update(1 / 60, cam(), i / 60);
    assert.equal(v.actor, null);
    assert.equal(v._pic.state, 'none', 'no avatar URL without the manifest');
    assert.equal(v._pic.shown, 'placeholder', 'the image-less diamond of the report');
    // the manifest arrives (render/app.js calls retryAssets on onChange)
    let heard = 0;
    a.onChange(() => { heard++; v.retryAssets(); });
    a.seed(M);
    await tick(); await tick(); await tick();
    assert.equal(heard, 1);
    assert.ok(v.actor && v.spineReady, 'the Spine model is shown');
    assert.equal(v._pic.state, 'img', 'and its avatar is known for the diamond');
  });

  test('a failed / timed-out model is loaded again after SPINE_RETRY_MS (bounded); a success ends the retries', async () => {
    assert.deepEqual([...SPINE_RETRY_MS], [2000, 6000, 15000, 30000]);
    let calls = 0, fail = true;
    const a = createAssets({ manifest: M, loadImage: async () => IMG, unloadSpine: () => {},
      loadSpine: async () => { calls++; if (fail) throw new Error('load timeout'); return { animations: [{ name: 'Idle' }] }; } });
    const v = unit(a);
    await tick(); await tick();
    assert.equal(calls, 1);
    assert.equal(v.actor, null);
    assert.ok(v._retryAt > 0, 'a retry is due later');
    v.update(1 / 60, cam(), 0);
    await tick();
    assert.equal(calls, 1, 'not before its wait');
    // every retry fails until the list runs out
    for (let i = 0; i < SPINE_RETRY_MS.length; i++) {
      v._retryAt = 1; // due
      v.update(1 / 60, cam(), 0);
      await tick(); await tick();
    }
    assert.equal(calls, 1 + SPINE_RETRY_MS.length, 'bypassing the remembered failure (acquire { retry })');
    assert.equal(v._retryAt, 0, 'bounded: no more retries');
    for (let i = 0; i < 5; i++) v.update(1 / 60, cam(), 0);
    await tick();
    assert.equal(calls, 1 + SPINE_RETRY_MS.length);
    // the tab shown again (render/app.js visibilitychange → retryAssets): loads at once
    fail = false;
    v.retryAssets();
    await tick(); await tick();
    assert.ok(v.actor && v.spineReady);
    assert.equal(v._spineTries, 0);
    assert.equal(a.spine.stats().refs, 1, 'every acquire paired with one release');
    // nothing to do for a view that shows its model
    v.retryAssets();
    await tick();
    assert.equal(calls, 2 + SPINE_RETRY_MS.length);
    v.destroy();
    assert.equal(a.spine.stats().refs, 0);
  });

  test('retryAssets never doubles a load in flight; a destroyed view retries nothing', async () => {
    let resolve, calls = 0;
    const a = createAssets({ manifest: M, loadImage: async () => IMG, unloadSpine: () => {}, loadSpine: () => { calls++; return new Promise((r) => { resolve = r; }); } });
    const v = unit(a);
    v.retryAssets();
    v.retryAssets();
    assert.equal(calls, 1);
    resolve({ animations: [{ name: 'Idle' }] });
    await tick(); await tick();
    assert.ok(v.actor);
    const w = unit(createAssets({ manifest: {}, loadImage: async () => IMG }));
    w.destroy();
    assert.doesNotThrow(() => w.retryAssets());
  });

  test('ItemView.setIcon: an icon the manifest named late replaces the plain plate', async () => {
    const a = createAssets({ manifest: M, loadImage: async () => IMG });
    const it = new ItemView(fakeViewCtx(fake.P, { assets: a, cam }), { id: 'p:9', uid: 9, kind: 'item', defId: 'trap_1', icon: null, color: 0xffffff });
    const plain = it.plate.texture;
    it.setIcon('/i/1.png');
    await tick(); await tick();
    assert.notEqual(it.plate.texture, plain);
    assert.equal(it.info.icon, '/i/1.png');
  });
});

describe('wiring (render/app.js, ui/fieldHost.js)', () => {
  test('the field view re-resolves its views on a late manifest and on a shown tab, and holds the cache in battle mode', () => {
    const app = read('public/js/render/app.js');
    assert.match(app, /const offAssets = typeof assets\.onChange === 'function' \? assets\.onChange\(onAssets\) : null;/);
    assert.match(app, /for \(const v of views\.values\(\)\) v\.retryAssets\?\.\(\);/);
    assert.match(app, /globalThis\.document\?\.addEventListener\?\.\('visibilitychange', onVisible\);/);
    assert.match(app, /globalThis\.document\?\.removeEventListener\?\.\('visibilitychange', onVisible\);/);
    assert.match(app, /function enterBattle\(meta\) \{\n {4}if \(destroyed \|\| !meta \|\| typeof meta !== 'object'\) return false;\n {4}holdScene\(true\);/);
    assert.match(app, /holdScene\(false\); \/\/ the prep pieces reference their models now/);
    assert.match(app, /holdScene\(false\); \/\/ no scene any more/);
  });

  test('the field host seeds the asset store with the game data\'s copies', () => {
    const fh = read('public/js/ui/fieldHost.js');
    assert.match(fh, /opts\.assets = am\.assets;\n {8}seedAssets\(am\.assets\);/);
    assert.match(fh, /give\('assets', store\.seed\?\.bind\(store\)\);\n {2}give\('local', store\.seedLocal\?\.bind\(store\)\);/);
  });
});

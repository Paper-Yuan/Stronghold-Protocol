#!/usr/bin/env node
// tools/assert/modSyncWiring.mjs — D1-7 gate: static wiring assertions for the mod sync path.
// Reads source text (no imports): syncModCatalog must be wired inside boot() before
// render, store must carry the two new state keys, and no dual-platform branch may
// creep into main.js. Exit 0 = wired correctly; nonzero = miswired.
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const fail = (msg) => { console.error('FAIL:', msg); process.exit(1); };

const main = readFileSync(join(ROOT, 'public/js/main.js'), 'utf8');
const store = readFileSync(join(ROOT, 'public/js/store.js'), 'utf8');

// 1. import present
if (!/import\s*\{[^}]*syncModCatalog[^}]*\}\s*from\s*'\.\/net\/modSync\.js'/.test(main)) {
  fail('main.js does not import syncModCatalog from ./net/modSync.js');
}

// 2. called inside boot() before render — find boot body then check ordering
const bootIdx = main.indexOf('async function boot()');
const renderIdx = main.indexOf('render(html`', bootIdx);
const callIdx = main.indexOf('syncModCatalog({ store })', bootIdx);
if (bootIdx < 0) fail('boot() not found in main.js');
if (callIdx < 0) fail('syncModCatalog({ store }) call not found inside boot()');
if (renderIdx > 0 && callIdx > renderIdx) fail('syncModCatalog called after render() — must precede first paint');
if (!/syncModCatalog\(\{ store \}\)\.catch/.test(main)) fail('syncModCatalog call is not fire-and-forget (.catch missing)');

// 3. store carries the two new state keys
if (!/modCatalog:\s*\{\s*version:\s*null,\s*packs:\s*\[\],\s*fetchedAt:\s*0\s*\}/.test(store)) {
  fail('store.js initialState missing modCatalog: { version: null, packs: [], fetchedAt: 0 }');
}
if (!/modSync:\s*\{\s*phase:\s*'idle',\s*done:\s*0,\s*total:\s*0,\s*error:\s*null\s*\}/.test(store)) {
  fail("store.js initialState missing ui.modSync: { phase: 'idle', done: 0, total: 0, error: null }");
}

// 4. no dual-platform branch in the sync path (blueprint: syncMods has no isAndroid fork)
if (/isAndroid/.test(main)) fail('main.js references isAndroid — sync path must be platform-agnostic');

// 5. browser storage no longer exposes the v1 broken-consumption API
const storage = readFileSync(join(ROOT, 'public/js/ui/modStorage.js'), 'utf8');
if (/getActiveOverlays|_getPackJsonFiles|saveMod\(|toggleMod\(|listMods\(/.test(storage)) {
  fail('modStorage.js still exposes a v1 API (getActiveOverlays/saveMod/toggleMod/listMods)');
}

// 6. modZipParser is a thin shell (no hand-rolled EOCD walk, no fanpack hardcodes)
const parser = readFileSync(join(ROOT, 'public/js/ui/modZipParser.js'), 'utf8');
if (/0x06054b50/.test(parser)) fail('modZipParser.js still hand-rolls EOCD magic — must go through shared/modZip.js');
if (/fanpack/.test(parser)) fail('modZipParser.js still hardcodes fanpack paths');

// 7. shared mirror is synced (public/shared must contain the new modules)
for (const f of ['modCatalog.js', 'modZip.js']) {
  const a = readFileSync(join(ROOT, 'shared', f), 'utf8');
  let b;
  try { b = readFileSync(join(ROOT, 'public/shared', f), 'utf8'); } catch { fail(`public/shared/${f} missing — run tools/sync-static-web.mjs`); }
  if (a.replace(/\r\n/g, '\n') !== b.replace(/\r\n/g, '\n')) fail(`shared/${f} and public/shared/${f} differ — run tools/sync-static-web.mjs`);
}

console.log('OK: mod sync wiring verified (import, boot-order, store keys, platform-agnostic, v1 APIs gone, mirrors synced)');

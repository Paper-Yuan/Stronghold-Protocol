#!/usr/bin/env node
// tools/assert/no-mod-bundling.mjs — B3 gate: packages never bundle mod bytes, and the
// server package hides the endless entry through the BUILD-TIME capability switch rather
// than post-hoc regex tag-stripping (CF_MOD_TRI_PLAN.md §2-B3 / GLOBAL_VOICE D6).
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const fail = (msg) => { console.error('FAIL:', msg); process.exit(1); };

// 1. no packaging script copies the mod pack tree
const packDir = join(ROOT, 'scripts', 'pack');
const scripts = readdirSync(packDir).filter((f) => f.endsWith('.mjs')).map((f) => join(packDir, f));
scripts.push(join(ROOT, 'scripts', 'make-server-bundle.mjs'), join(ROOT, 'scripts', 'make-headless-server.mjs'), join(ROOT, 'tools', 'bundle-android.mjs'));
for (const f of scripts) {
  let src;
  try { src = readFileSync(f, 'utf8'); } catch { continue; }
  const code = src.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
  // a copy of the mod tree would have to name it; `packs/` also appears in comments only
  if (/(copyDir|cp|copyFile)[^\n]*['"`][^'"`]*\bpacks\b/.test(code)) {
    fail(`${f.replace(ROOT, '.')}: packaging copies the mod pack tree`);
  }
}

// 2. capabilities module exists, is mirrored, and defaults to both features on
const caps = readFileSync(join(ROOT, 'shared/capabilities.js'), 'utf8');
const capsMirror = readFileSync(join(ROOT, 'public/shared/capabilities.js'), 'utf8');
if (!/LOCAL_FEATURES/.test(caps) || !/endless:\s*true/.test(caps) || !/mods:\s*true/.test(caps)) {
  fail('shared/capabilities.js must export LOCAL_FEATURES with endless/mods defaulting to true');
}
if (caps.replace(/\r\n/g, '\n') !== capsMirror.replace(/\r\n/g, '\n')) {
  fail('shared/capabilities.js and public/shared/capabilities.js differ — run tools/sync-static-web.mjs');
}

// 3. the endless entries are guarded by the capability, not by platform probes
const title = readFileSync(join(ROOT, 'public/js/screens/title.js'), 'utf8');
const lobby = readFileSync(join(ROOT, 'public/js/screens/lobby.js'), 'utf8');
for (const [name, src] of [['title.js', title], ['lobby.js', lobby]]) {
  if (!/LOCAL_FEATURES/.test(src)) fail(`${name}: does not consult LOCAL_FEATURES`);
}
if (!/LOCAL_FEATURES\.endless\s*\?/.test(title)) fail('title.js: the endless button is not gated on LOCAL_FEATURES.endless');
if (!/LOCAL_FEATURES\.endless\s*\?/.test(lobby)) fail('lobby.js: the endless card/leaderboard are not gated on LOCAL_FEATURES.endless');
if (/isAndroid|navigator\.userAgent/.test(title + lobby)) {
  fail('title.js/lobby.js: platform probes are forbidden — capability bits decide, never UA (dual-platform red line)');
}

// 4. the server packaging no longer strips UI tags with cross-line regex
const serverPack = readFileSync(join(packDir, 'server.mjs'), 'utf8');
if (/replace\(\/<\$\\?\{?[^/]*LeaderboardButton/.test(serverPack) || /EndlessCard[^)]*\/>\/g/.test(serverPack)) {
  fail('scripts/pack/server.mjs still strips UI tags with regex — D6 requires the build-time capability switch');
}
if (!/capabilities\.js/.test(serverPack) || !/endless:\s*false/.test(serverPack)) {
  fail('scripts/pack/server.mjs must rewrite capabilities.js to endless: false');
}

console.log('OK: no mod bytes bundled; endless entry hidden by build-time capability switch (not regex); entries capability-gated, no UA probes');

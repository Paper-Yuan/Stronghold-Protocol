#!/usr/bin/env node
// tools/assert/no-mod-bundling.mjs — B3 gate: packages never bundle mod bytes, the
// capability bits stay a build-time property of the shipped bytes (CF_MOD_TRI_PLAN.md §2-B3),
// and the endless mode stays deleted (no source may re-introduce it).
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

// 2. capabilities module exists, is mirrored, declares mods but no endless key (the mode is deleted)
const caps = readFileSync(join(ROOT, 'shared/capabilities.js'), 'utf8');
const capsMirror = readFileSync(join(ROOT, 'public/shared/capabilities.js'), 'utf8');
if (!/LOCAL_FEATURES/.test(caps) || !/mods:\s*true/.test(caps)) {
  fail('shared/capabilities.js must export LOCAL_FEATURES with mods defaulting to true');
}
if (/endless/i.test(caps)) {
  fail('shared/capabilities.js must not declare an endless capability (the mode is deleted)');
}
if (caps.replace(/\r\n/g, '\n') !== capsMirror.replace(/\r\n/g, '\n')) {
  fail('shared/capabilities.js and public/shared/capabilities.js differ — run tools/sync-static-web.mjs');
}

// 3. the client screens consult the capability bits (never platform probes), and no endless
//    references survive anywhere in them
const title = readFileSync(join(ROOT, 'public/js/screens/title.js'), 'utf8');
const lobby = readFileSync(join(ROOT, 'public/js/screens/lobby.js'), 'utf8');
for (const [name, src] of [['title.js', title], ['lobby.js', lobby]]) {
  if (!/LOCAL_FEATURES/.test(src)) fail(`${name}: does not consult LOCAL_FEATURES`);
  if (/LOCAL_FEATURES\.endless/.test(src)) fail(`${name}: LOCAL_FEATURES.endless is gone (the mode is deleted)`);
}
if (/isAndroid|navigator\.userAgent/.test(title + lobby)) {
  fail('title.js/lobby.js: platform probes are forbidden — capability bits decide, never UA (dual-platform red line)');
}

// 4. the server packaging asserts the artifact has no endless features (it no longer rewrites
//    capabilities or strips endpoints — the mode is gone at the source)
const serverPack = readFileSync(join(packDir, 'server.mjs'), 'utf8');
if (/replace\(\/<\$\\?\{?[^/]*LeaderboardButton/.test(serverPack) || /EndlessCard[^)]*\/>\/g/.test(serverPack)) {
  fail('scripts/pack/server.mjs still strips UI tags with regex');
}
if (!/endless/i.test(serverPack) || !/process\.exit\(1\)/.test(serverPack)) {
  fail('scripts/pack/server.mjs must fail the build on any endless feature in the staged artifact');
}

console.log('OK: no mod bytes bundled; capabilities build-time only, no endless capability (mode deleted); no UA probes; server pack asserts no endless features');

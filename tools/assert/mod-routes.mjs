#!/usr/bin/env node
// tools/assert/mod-routes.mjs — B1-0 gate: the three mod routing boundaries stay frozen.
//   /packs/**  = language packs (PACKS_URL unchanged, shared/packs.js)
//   /mods/**   = mod packs (MOD_CATALOG_URL, shared/modCatalog.js; shared code carries no node:* imports)
//   /api/packs = GlobalModManager probe endpoint (server/index.js)
// Exit 0 = boundaries intact; nonzero = a boundary moved or leaked.
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const fail = (msg) => { console.error('FAIL:', msg); process.exit(1); };

const packs = readFileSync(join(ROOT, 'shared/packs.js'), 'utf8');
const catalog = readFileSync(join(ROOT, 'shared/modCatalog.js'), 'utf8');
const serverIndex = readFileSync(join(ROOT, 'server/index.js'), 'utf8');

// 1. language-pack URL contract unchanged
if (!/PACKS_URL\s*=\s*'\/packs\/'/.test(packs)) fail("shared/packs.js: PACKS_URL !== '/packs/' (language-pack boundary moved)");

// 2. mod catalog endpoint frozen
if (!/MOD_CATALOG_URL\s*=\s*'\/mods\/index\.json'/.test(catalog)) fail("shared/modCatalog.js: MOD_CATALOG_URL !== '/mods/index.json'");

// 3. shared code stays browser-loadable (no node: imports anywhere in shared/)
for (const f of ['modCatalog.js', 'modZip.js', 'packs.js', 'customContent.js']) {
  const src = readFileSync(join(ROOT, 'shared', f), 'utf8');
  if (/from\s*'node:/.test(src) || /require\(['"]node:/.test(src)) fail(`shared/${f} imports node: builtins — shared/ must stay browser-loadable (lazy dynamic import only)`);
}

// 4. /api/packs probe exists and mod upload routes exist
if (!serverIndex.includes("'/api/packs'")) fail("server/index.js: '/api/packs' probe endpoint missing");
if (!serverIndex.includes("'/api/admin/mods/upload'")) fail("server/index.js: '/api/admin/mods/upload' route missing");

// 5. data type is supported with the eight roles (B1-2 piece 1)
for (const role of ['records', 'chess', 'tokens', 'variants', 'bands', 'items', 'skins', 'art']) {
  if (!new RegExp(`${role}:\\s*Object\\.freeze`).test(packs)) fail(`shared/packs.js: data.files missing role '${role}'`);
}
if (!/data:\s*Object\.freeze\(\{[\s\S]*?status:\s*'supported'/.test(packs)) fail("shared/packs.js: PACK_TYPES.data is not status 'supported'");

console.log('OK: mod routing boundaries verified (/packs lang, /mods mod, /api/packs probe, shared/ node-free, data type supported with 8 roles)');

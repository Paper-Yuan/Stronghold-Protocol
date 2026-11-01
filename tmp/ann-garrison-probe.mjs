import fs from 'node:fs';
import path from 'node:path';

const root = 'E:/Workbox/系统';
const dirs = {
  'rhodes-ship': path.join(root, 'modref/mods/rhodes-ship/rhodes-ship-mod/payload/packs/rhodes-ship'),
  'kazdel-ship': path.join(root, 'modref/mods/kazdel-ship/kazdel-ship-mod/payload/packs/kazdel-ship'),
};
const oursGar = JSON.parse(fs.readFileSync(path.join(root, 'data/garrisons.json'), 'utf8'));
const oursChess = JSON.parse(fs.readFileSync(path.join(root, 'data/chess.json'), 'utf8'));
const oursTokens = JSON.parse(fs.readFileSync(path.join(root, 'data/tokens.json'), 'utf8'));
const oursBackups = JSON.parse(fs.readFileSync(path.join(root, 'data/backups.json'), 'utf8'));
const out = [];

for (const g of ['garrison_04_a', 'garrison_04_b', 'garrison_10_a', 'garrison_10_b', 'garrison_35_a']) {
  out.push(`ours garrisons[${g}] exists=${!!oursGar[g]}${oursGar[g] ? ' keys=' + Object.keys(oursGar[g]).join(',') : ''}`);
  if (oursGar[g]) out.push('  ' + JSON.stringify(oursGar[g]).slice(0, 400));
}

const ourGarKeys = new Set();
for (const r of Object.values(oursGar)) for (const k of Object.keys(r)) ourGarKeys.add(k);
out.push(`our garrisons key union (${ourGarKeys.size}): ${[...ourGarKeys].sort().join(',')}`);

const packGarKeys = new Set();
const packGar = {};
for (const [name, dir] of Object.entries(dirs)) {
  const records = JSON.parse(fs.readFileSync(path.join(dir, 'records.json'), 'utf8'));
  for (const [id, r] of Object.entries(records.garrisons)) { packGar[id] = { ...r, _pack: name }; for (const k of Object.keys(r)) packGarKeys.add(k); }
}
out.push(`pack garrisons key union (${packGarKeys.size}): ${[...packGarKeys].sort().join(',')}`);
out.push(`pack-only gar keys: ${[...packGarKeys].filter((k) => !ourGarKeys.has(k)).sort().join(',')}`);
out.push(`ours-only gar keys: ${[...ourGarKeys].filter((k) => !packGarKeys.has(k)).sort().join(',')}`);

// tokens / module / assets references in the 26 new chess records
for (const [name, dir] of Object.entries(dirs)) {
  const chess = JSON.parse(fs.readFileSync(path.join(dir, 'chess.json'), 'utf8')).chess;
  for (const [id, c] of Object.entries(chess)) {
    if (!/chess_char_9_/.test(id)) continue;
    const tokenRefs = new Set([...(c.tokens || []), ...((c.skills || []).map((s) => s?.overrideTokenKey).filter(Boolean)), ...((c.talents || []).map((t) => t?.tokenKey).filter(Boolean)), ...(c.displayTokens || [])]);
    const known = [...tokenRefs].map((t) => `${t}:${t in oursTokens ? 'tokens' : oursBackups.tokens?.[t] ? 'backups' : 'MISSING'}`);
    const moduleIds = (c.modules || []).map((m) => m.uniEquipId ?? m.id);
    out.push(`${name} ${id}: tokens=${JSON.stringify([...tokenRefs])} (${known.join(' ')}) module=${JSON.stringify(c.module)} modules=${JSON.stringify(moduleIds)} assets=${JSON.stringify(c.assets)}`);
    out.push(`   eventType/effectType of garrisons: ${JSON.stringify((c.garrisonIds || []).map((g) => packGar[g] ? { g, eventType: packGar[g].eventType, effectType: packGar[g].effectType, key: packGar[g].effectKey, icon: packGar[g].eventTypeIcon } : { g, MISSING: true }))}`);
  }
}

// validate.js rules
out.push('done');
fs.writeFileSync(path.join(root, 'tmp/ann-garrison-probe.txt'), out.join('\n'), 'utf8');
console.log(out.join('\n'));

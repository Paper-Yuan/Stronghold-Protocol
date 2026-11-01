import fs from 'node:fs';
import path from 'node:path';

const root = 'E:/Workbox/系统';
const packs = {
  'rhodes-ship': path.join(root, 'modref/mods/rhodes-ship/rhodes-ship-mod/payload/packs/rhodes-ship'),
  'kazdel-ship': path.join(root, 'modref/mods/kazdel-ship/kazdel-ship-mod/payload/packs/kazdel-ship'),
};
const ids = ['9_09', '9_11', '9_13', '9_14', '9_16', '9_18', '9_21', '9_22'];
const kaz = ['9_01', '9_02', '9_04', '9_06', '9_10'];

const oursChess = JSON.parse(fs.readFileSync(path.join(root, 'data/chess.json'), 'utf8'));
const oursBonds = JSON.parse(fs.readFileSync(path.join(root, 'data/bonds.json'), 'utf8'));
const oursGar = JSON.parse(fs.readFileSync(path.join(root, 'data/garrisons.json'), 'utf8'));

const out = [];
for (const [name, dir] of Object.entries(packs)) {
  const chess = JSON.parse(fs.readFileSync(path.join(dir, 'chess.json'), 'utf8')).chess;
  const records = JSON.parse(fs.readFileSync(path.join(dir, 'records.json'), 'utf8'));
  const bond = records.bonds.rhodesShip || records.bonds.kazdelShip;
  out.push(`=== ${name}`);
  out.push(`bond ${bond.bondId ?? ''} members(${bond.members.length}): ${bond.members.join(', ')}`);
  out.push(`  thresholds ${JSON.stringify(bond.thresholds)}`);
  out.push(`  visibleMembers(${bond.visibleMembers.length}): ${bond.visibleMembers.join(', ')}`);
  const list = name === 'rhodes-ship' ? ids : kaz;
  const usedGar = new Set();
  for (const suffix of list) {
    for (const half of ['a', 'b']) {
      const id = `chess_char_${suffix}_${half}`;
      const rec = chess[id];
      if (!rec) { out.push(`MISSING ${id}`); continue; }
      const gar = rec.garrisonIds;
      for (const g of gar || []) usedGar.add(g);
      out.push(`  ${id} keys(${Object.keys(rec).length}): ${Object.keys(rec).join(',')}`);
      out.push(`     charId=${rec.charId} name=${rec.name} tier=${rec.tier} isGolden=${rec.isGolden} upgradeNum=${rec.upgradeNum} upgradeChessId=${rec.upgradeChessId} goldenId=${rec.goldenId} baseId=${rec.baseId} status=${JSON.stringify(rec.status)} bonds=${JSON.stringify(rec.bonds)} garrisonIds=${JSON.stringify(gar)}`);
    }
  }
  out.push(`  used garrisons: ${[...usedGar].join(' ')}`);
  for (const g of [...usedGar].sort()) {
    out.push(`    ${g}: exists=${!!records.garrisons[g]} keys=${records.garrisons[g] ? Object.keys(records.garrisons[g]).join(',') : '-'}`);
  }
  out.push(`  all pack garrisons: ${Object.keys(records.garrisons).join(' ')}`);
  out.push(`  chess 4_27 present: ${Object.keys(chess).filter((k) => k.includes('4_27')).join(' ') || '(none)'}`);
}

// ours: members of the two bonds, chess presence
for (const b of ['rhodesShip', 'kazdelShip']) {
  const rec = oursBonds[b];
  out.push(`=== ours ${b}: members(${rec.members.length}) ${rec.members.join(', ')}`);
  out.push(`  thresholds ${JSON.stringify(rec.thresholds)} visibleMembers(${(rec.visibleMembers || []).length}) ${(rec.visibleMembers || []).join(', ')}`);
  out.push(`  missing from data/chess.json: ${rec.members.filter((m) => !oursChess[m]).join(', ') || '(none)'}`);
  out.push(`  member record keys: ${JSON.stringify(rec, null, 1).slice(0, 1200)}`);
}

// union of field keys: our chess vs pack records
const ourKeys = new Set();
for (const c of Object.values(oursChess)) for (const k of Object.keys(c)) ourKeys.add(k);
const packKeys = new Set();
for (const [name, dir] of Object.entries(packs)) {
  const chess = JSON.parse(fs.readFileSync(path.join(dir, 'chess.json'), 'utf8')).chess;
  for (const id of Object.keys(chess)) if (/chess_char_9_/.test(id)) for (const k of Object.keys(chess[id])) packKeys.add(k);
}
out.push(`=== our chess key union (${ourKeys.size}): ${[...ourKeys].sort().join(',')}`);
out.push(`=== pack 9_ key union (${packKeys.size}): ${[...packKeys].sort().join(',')}`);
out.push(`=== pack-only keys: ${[...packKeys].filter((k) => !ourKeys.has(k)).sort().join(',')}`);
out.push(`=== ours-only keys: ${[...ourKeys].filter((k) => !packKeys.has(k)).sort().join(',')}`);
fs.writeFileSync(path.join(root, 'tmp/ann-inventory-probe.txt'), out.join('\n'), 'utf8');
console.log(out.join('\n'));

import fs from 'node:fs';

const root = 'E:/Workbox/系统';
const data = JSON.parse(fs.readFileSync(`${root}/data/chess.json`, 'utf8'));
const research = JSON.parse(fs.readFileSync(`${root}/docs/research/20-annihilation-mods.json`, 'utf8'));
let same = 0, diff = 0;
const diffs = [];
for (const [id, rec] of Object.entries(research.chess)) {
  const d = data[id];
  const a = JSON.stringify(rec.potDown ?? null);
  const b = JSON.stringify(d?.potDown ?? null);
  if (a === b) same++;
  else { diff++; diffs.push(`${id}\n  pack: ${a}\n  data: ${b}`); }
}
console.log('potDown same', same, 'diff', diff);
console.log(diffs.slice(0, 6).join('\n'));
// also check a lower potential record differs as the pack says
const { atPotential } = await import('file:///E:/Workbox/系统/shared/potential.js');
const before = atPotential(data.chess_char_9_09_b, 1);
console.log('rank1 stats atk', before.stats.atk, 'full', data.chess_char_9_09_b.stats.atk, 'pack rank1', atPotential(research.chess.chess_char_9_09_b, 1).stats.atk);

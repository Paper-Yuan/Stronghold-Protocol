// tools/build-skins.mjs — docs/research/08-skins.json → data/skins.json (docs/SKINS.md).
//
// The client cannot read docs/research/ (the static server only mounts /data/, /shared/, /sim/ and public/), so
// the skin picker needs its own catalogue: which skins exist, on which operator, and what they are called. The
// URLs are deliberately NOT here — an installed skin's model and avatar come from data/assets.json, and one that
// is not installed has no files to point at. That split is also what makes 「按需安装」 possible.
//
//   node tools/build-skins.mjs

import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const IN = path.join(ROOT, 'docs', 'research', '08-skins.json');
const OUT = path.join(ROOT, 'data', 'skins.json');

const VERSION = 1;

async function main() {
  const research = JSON.parse(await readFile(IN, 'utf8'));
  /** @type {Record<string, {id: string, name: string, group: string}[]>} */
  const chars = {};
  let total = 0;
  for (const [charId, list] of Object.entries(research.skins || {})) {
    chars[charId] = (list || []).map((s) => ({ id: s.skinId, name: s.name, group: s.group || '' }));
    total += chars[charId].length;
  }
  const out = {
    version: VERSION,
    counts: { chars: Object.keys(chars).length, skins: total },
    chars,
  };
  await writeFile(OUT, JSON.stringify(out, null, 1));
  console.log(`[skins] ${Object.keys(chars).length} 个干员 / ${total} 套皮肤 → ${path.relative(ROOT, OUT)}`);
}

main().then(() => { process.exitCode = 0; }, (e) => { console.error(e?.stack || e); process.exitCode = 1; });

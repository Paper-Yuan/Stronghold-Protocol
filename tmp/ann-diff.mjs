import fs from 'node:fs';
import crypto from 'node:crypto';

const root = 'E:/Workbox/系统';
const baseline = JSON.parse(fs.readFileSync(`${root}/tmp/ann-baseline-hashes.json`, 'utf8'));
const h = (v) => crypto.createHash('sha256').update(JSON.stringify(v)).digest('hex');
const out = {};
for (const name of Object.keys(baseline)) {
  const now = JSON.parse(fs.readFileSync(`${root}/data/${name}.json`, 'utf8'));
  const base = baseline[name];
  const added = Object.keys(now).filter((k) => !(k in base));
  const removed = Object.keys(base).filter((k) => !(k in now));
  const changed = Object.keys(base).filter((k) => k in now && h(now[k]) !== base[k]);
  out[name] = { before: Object.keys(base).length, after: Object.keys(now).length, added: added.length, removed, changed };
  console.log(name, JSON.stringify(out[name]));
  if (changed.length) console.log('  changed ids:', changed.slice(0, 10).join(', '));
  if (added.length) console.log('  added ids:', added.join(', '));
}
fs.writeFileSync(`${root}/tmp/ann-diff-summary.json`, JSON.stringify(out, null, 2), 'utf8');

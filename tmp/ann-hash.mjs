import fs from 'node:fs';
import crypto from 'node:crypto';

const root = 'E:/Workbox/系统';
const dir = process.argv[2] || root;
const h = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, crypto.createHash('sha256').update(JSON.stringify(v)).digest('hex')]));
const out = {};
for (const name of ['chess', 'garrisons', 'bonds', 'items', 'effects']) {
  out[name] = h(JSON.parse(fs.readFileSync(`${dir}/data/${name}.json`, 'utf8')));
}
fs.writeFileSync(`${root}/tmp/ann-baseline-hashes.json`, JSON.stringify(out), 'utf8');
for (const [k, v] of Object.entries(out)) console.log(k, Object.keys(v).length);

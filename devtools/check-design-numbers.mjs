import fs from 'node:fs';
import path from 'node:path';

const root = 'docs';
const found = new Map(); // number -> [files]
function walk(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p);
    else if (p.endsWith('.md')) {
      const src = fs.readFileSync(p, 'utf8');
      for (const m of src.matchAll(/^## (\d+)\.\s*(.+)$/gm)) {
        const n = Number(m[1]);
        if (!found.has(n)) found.set(n, []);
        found.get(n).push({ file: p.replace(/\\/g, '/'), title: m[2].trim().slice(0, 70) });
      }
    }
  }
}
walk(root);
const nums = [...found.keys()].sort((a, b) => a - b);
console.log('sections:', nums.join(', '));
console.log('max:', Math.max(...nums));
const dup = [...found.entries()].filter(([, v]) => v.length > 1);
console.log('\nduplicates:');
for (const [n, v] of dup) console.log(`  §${n}: ${v.map((x) => x.file + ' — ' + x.title).join('  |  ')}`);
console.log('\n§34 entries:');
for (const x of found.get(34) || []) console.log('  ' + x.file + ' — ' + x.title);
console.log('\n§35/§36/§37/§38:');
for (const n of [35, 36, 37, 38]) for (const x of found.get(n) || []) console.log(`  §${n} ${x.file} — ${x.title}`);

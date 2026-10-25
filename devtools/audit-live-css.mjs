// For every module reachable from public/js/main.js, report its `class="..."` usage against all CSS.
// Only live modules matter: a dead module cannot show a broken screen.
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const allCss = [];
(function walkCss(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walkCss(p);
    else if (p.endsWith('.css')) allCss.push(fs.readFileSync(p, 'utf8'));
  }
})(path.join(ROOT, 'public/css'));
const cssText = allCss.join('\n');
const cssClasses = new Set();
for (const m of cssText.matchAll(/\.(-?[A-Za-z_][\w-]*)/g)) cssClasses.add(m[1]);

const seen = new Set();
function resolve(fromFile, spec) {
  if (!spec.startsWith('.')) return null;
  const p = path.resolve(path.dirname(fromFile), spec);
  return p;
}
function walk(file) {
  if (seen.has(file)) return;
  if (!fs.existsSync(file)) return;
  seen.add(file);
  let src = '';
  try { src = fs.readFileSync(file, 'utf8'); } catch { return; }
  for (const m of src.matchAll(/(?:from|import)\s*\(?\s*['"]([^'"]+)['"]/g)) {
    const t = resolve(file, m[1]);
    if (t) walk(t);
  }
}
walk(path.join(ROOT, 'public/js/main.js'));

const rows = [];
for (const file of seen) {
  if (!/\/public\/js\//.test(file.replace(/\\/g, '/'))) continue;
  const src = fs.readFileSync(file, 'utf8');
  const used = new Set();
  for (const m of src.matchAll(/class="([^"]+)"/g)) {
    for (const c of m[1].split(/\s+/)) if (c && !/[\$\{\}<>]/.test(c)) used.add(c);
  }
  if (used.size < 4) continue;
  let miss = 0;
  for (const c of used) if (!cssClasses.has(c)) miss++;
  const pct = Math.round((100 * (used.size - miss)) / used.size);
  rows.push({ file: path.relative(ROOT, file).replace(/\\/g, '/'), pct, hit: used.size - miss, total: used.size });
}
rows.sort((a, b) => a.pct - b.pct);
console.log('live modules with class usage:', rows.length);
console.log('--- below 80% (a warning) ---');
for (const r of rows.filter((x) => x.pct < 80)) console.log(`  ${String(r.pct).padStart(3)}%  ${r.file}  (${r.hit}/${r.total})`);
console.log('--- 80-89% ---');
for (const r of rows.filter((x) => x.pct >= 80 && x.pct < 90)) console.log(`  ${String(r.pct).padStart(3)}%  ${r.file}  (${r.hit}/${r.total})`);
const healthy = rows.filter((x) => x.pct >= 90).length;
console.log(`--- >=90%: ${healthy} modules ---`);

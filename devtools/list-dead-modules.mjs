// Compute every module unreachable from public/js/main.js, and check that no reachable file builds an
// import specifier at runtime (which would make "unreachable" a lie).
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const seen = new Set();
const dynamic = [];

function walk(f) {
  if (seen.has(f) || !fs.existsSync(f)) return;
  seen.add(f);
  const s = fs.readFileSync(f, 'utf8');
  for (const m of s.matchAll(/(?:from|import)\s*\(?\s*['"]([^'"]+)['"]/g)) {
    if (!m[1].startsWith('.')) continue;
    walk(path.resolve(path.dirname(f), m[1]));
  }
  // dynamic import with a computed specifier
  for (const m of s.matchAll(/import\s*\(\s*([^'")][^)]*)\)/g)) {
    dynamic.push(`${path.relative(ROOT, f).replace(/\\/g, '/')}: import(${m[1].slice(0, 60)})`);
  }
  // new Worker(new URL(...)) and similar
  for (const m of s.matchAll(/new\s+Worker\s*\(/g)) dynamic.push(`${path.relative(ROOT, f).replace(/\\/g, '/')}: new Worker(...)`);
}

walk(path.join(ROOT, 'public/js/main.js'));
console.log('reachable modules:', seen.size);
console.log('\ncomputed import specifiers / workers (must be none, or "dead" is unsafe):');
for (const d of [...new Set(dynamic)]) console.log('  ' + d);

// every js file under public/js that is not reachable
const all = [];
(function w(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) w(p);
    else if (p.endsWith('.js')) all.push(p);
  }
})(path.join(ROOT, 'public/js'));

const dead = all.filter((p) => !seen.has(p)).map((p) => path.relative(ROOT, p).replace(/\\/g, '/'));
console.log(`\nunreachable modules: ${dead.length}`);
for (const d of dead.sort()) console.log('  ' + d);

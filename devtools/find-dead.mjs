// A conservative dead-code candidate list: a module under public/js is a candidate only when
//   1. it is unreachable from public/js/main.js, AND
//   2. its basename appears in NO other file of the repo (so no HTML <script>, no `new Worker(new URL(...))`,
//      no worker entry table, no test fixture can load it), AND
//   3. no test file mentions it.
// Prints the list; deletes nothing.
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const seen = new Set();
function walkImports(f) {
  if (seen.has(f) || !fs.existsSync(f)) return;
  seen.add(f);
  const s = fs.readFileSync(f, 'utf8');
  for (const m of s.matchAll(/(?:from|import)\s*\(?\s*['"]([^'"]+)['"]/g)) {
    if (!m[1].startsWith('.')) continue;
    walkImports(path.resolve(path.dirname(f), m[1]));
  }
}
walkImports(path.join(ROOT, 'public/js/main.js'));

const jsFiles = [];
(function w(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) w(p);
    else if (p.endsWith('.js')) jsFiles.push(p);
  }
})(path.join(ROOT, 'public/js'));

const unreachable = jsFiles.filter((p) => !seen.has(p));

// every text file we might find a reference in
const textFiles = [];
const SKIP = new Set(['node_modules', '.git', '.cache', 'assets', 'artifacts', 'devtools']);
(function w(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    if (SKIP.has(e.name)) continue;
    const p = path.join(d, e.name);
    if (e.isDirectory()) w(p);
    else if (/\.(js|mjs|json|html|md|yml)$/.test(e.name)) textFiles.push(p);
  }
})(ROOT);
const corpus = new Map(textFiles.map((f) => [f, fs.readFileSync(f, 'utf8')]));

const candidates = [];
const kept = [];
for (const file of unreachable) {
  const base = path.basename(file);
  const stem = base.replace(/\.js$/, '');
  const rel = path.relative(ROOT, file).replace(/\\/g, '/');
  let mentionedBy = null;
  for (const [f, text] of corpus) {
    if (path.resolve(f) === path.resolve(file)) continue;
    if (rel.endsWith(path.relative(ROOT, f).replace(/\\/g, '/'))) continue;
    // a mention of the file name, or of the bare stem as an import specifier
    if (text.includes(base) || new RegExp(`(?:/|'|\\.)${stem}['"]`).test(text)) { mentionedBy = path.relative(ROOT, f).replace(/\\/g, '/'); break; }
  }
  if (mentionedBy) kept.push(`${rel}   ← mentioned by ${mentionedBy}`);
  else candidates.push(rel);
}

console.log('unreachable from main.js:', unreachable.length);
console.log('\nKEPT (something still names them):');
for (const k of kept.sort()) console.log('  ' + k);
console.log(`\nDEAD CANDIDATES (${candidates.length}):`);
for (const c of candidates.sort()) console.log('  ' + c);

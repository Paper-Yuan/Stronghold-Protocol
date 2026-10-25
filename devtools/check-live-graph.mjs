// Resolve the live client import graph from public/js/main.js and check every named import
// against what its target actually exports (the browser errors came from exactly this).
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const entry = path.join(ROOT, 'public/js/main.js');

const exportCache = new Map();
function exportsOf(file) {
  if (exportCache.has(file)) return exportCache.get(file);
  let src = '';
  try { src = fs.readFileSync(file, 'utf8'); } catch { exportCache.set(file, null); return null; }
  const names = new Set();
  // import ... from 'x'  /  export ... from 'x'  (re-export)
  const reexports = [];
  for (const m of src.matchAll(/export\s+(?:\*|\{[^}]*\})\s*from\s*['"]([^'"]+)['"]/g)) reexports.push(m[1]);
  for (const m of src.matchAll(/export\s*\{([^}]*)\}/g)) {
    for (const part of m[1].split(',')) {
      const p = part.trim();
      if (!p) continue;
      const as = p.split(/\s+as\s+/);
      names.add((as[1] || as[0]).trim());
    }
  }
  for (const m of src.matchAll(/export\s+(?:async\s+)?(?:function|const|let|var|class)\s+([\w$]+)/g)) names.add(m[1]);
  if (/export\s+default\b/.test(src)) names.add('default');
  if (/export\s*\*/.test(src)) names.add('*');
  exportCache.set(file, { names, reexports, src });
  return exportCache.get(file);
}

const seen = new Set();
const problems = [];

function resolveSpec(fromFile, spec) {
  if (!spec.startsWith('.')) return null; // bare specifier (import map) — skip
  const p = path.resolve(path.dirname(fromFile), spec);
  return p;
}

function walk(file) {
  if (seen.has(file)) return;
  seen.add(file);
  const info = exportsOf(file);
  if (!info) return;
  const src = info.src;
  // every `import { a, b as c } from 'x'`
  for (const m of src.matchAll(/import\s*\{([^}]*)\}\s*from\s*['"]([^'"]+)['"]/g)) {
    const clause = m[1];
    const spec = m[2];
    const target = resolveSpec(file, spec);
    if (!target || !fs.existsSync(target)) {
      problems.push(`MISSING FILE  ${path.relative(ROOT, file)} -> ${spec}`);
      continue;
    }
    const t = exportsOf(target);
    if (!t || t.names.has('*')) { walk(target); continue; }
    for (const part of clause.split(',')) {
      const p = part.trim();
      if (!p) continue;
      const name = p.split(/\s+as\s+/)[0].trim();
      if (!name) continue;
      if (!t.names.has(name)) {
        problems.push(`MISSING EXPORT ${path.relative(ROOT, target)} has no '${name}'  (imported by ${path.relative(ROOT, file)})`);
      }
    }
    walk(target);
  }
  for (const m of src.matchAll(/import\s*['"]([^'"]+)['"]/g)) {
    const target = resolveSpec(file, m[1]);
    if (target && fs.existsSync(target)) walk(target);
  }
}

walk(entry);
console.log(`files walked: ${seen.size}`);
console.log(`problems: ${problems.length}`);
for (const p of problems.slice(0, 40)) console.log('  ' + p);

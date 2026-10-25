// Find `this.<name>(` calls in the server's Mixin modules whose <name> is defined nowhere.
// The `beforePrepOffers` bug (upstream spDraft calling a method only upstream phases defines,
// while we kept the local phases) is exactly this shape 鈥?catch the rest the same way.
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const files = [];
function walk(dir) {
  if (!fs.existsSync(dir)) return;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else if (p.endsWith('.js')) files.push(p);
  }
}
walk(path.join(ROOT, 'server/match'));

const defined = new Set();
const protoMethods = new Map(); // file -> names
for (const f of files) {
  const src = fs.readFileSync(f, 'utf8');
  const names = new Set();
  // class methods at 2-space indent: `  name(args) {`
  for (const m of src.matchAll(/^ {2,}(?:async\s+)?(?:get\s+|set\s+)?([A-Za-z_$][\w$]*)\s*\(/gm)) names.add(m[1]);
  // also 2-space arrow class fields: `  name = (`
  for (const m of src.matchAll(/^ {2,}([A-Za-z_$][\w$]*)\s*=/gm)) names.add(m[1]);
  // instance properties assigned anywhere (`this.sendFn = opts.send`) are callable members too
  for (const m of src.matchAll(/this\.([A-Za-z_$][\w$]*)\s*=[^=]/g)) names.add(m[1]);
  protoMethods.set(f, names);
  for (const n of names) defined.add(n);
}

// Methods inherited from these globals / engine objects are not "missing".
const IGNORE = new Set([
  'constructor', 'then', 'catch', 'finally', 'toString', 'valueOf', 'hasOwnProperty',
  'bind', 'call', 'apply', 'forEach', 'map', 'filter', 'find', 'some', 'every', 'reduce',
  'push', 'pop', 'shift', 'unshift', 'slice', 'splice', 'join', 'concat', 'includes', 'indexOf',
  'keys', 'values', 'entries', 'get', 'set', 'delete', 'has', 'add', 'clear', 'size',
]);

const problems = [];
for (const f of files) {
  const src = fs.readFileSync(f, 'utf8');
  const rel = path.relative(ROOT, f).replace(/\\/g, '/');
  for (const m of src.matchAll(/this\.([A-Za-z_$][\w$]*)\s*\(/g)) {
    const name = m[1];
    if (IGNORE.has(name)) continue;
    if (defined.has(name)) continue;
    const line = src.slice(0, m.index).split('\n').length;
    problems.push(`${rel}:${line}  this.${name}()`);
  }
}

const uniq = [...new Set(problems)];
console.log(`files scanned: ${files.length}`);
console.log(`defined method names: ${defined.size}`);
console.log(`unresolved this.<name>() calls: ${uniq.length}`);
for (const p of uniq.slice(0, 40)) console.log('  ' + p);

// Strip UTF-8 BOMs (PowerShell's Set-Content adds one). Harmless to JS/CSS/MD but breaks exact-content tests.
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const exts = /\.(js|mjs|css|json|md|yml|yaml|html)$/;
const skip = new Set(['node_modules', '.git', '.cache', 'assets', 'public/assets', 'dist', 'artifacts']);

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (skip.has(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (exts.test(e.name)) out.push(p);
  }
  return out;
}

let n = 0;
for (const f of walk(ROOT)) {
  const buf = fs.readFileSync(f);
  if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) {
    fs.writeFileSync(f, buf.subarray(3));
    n++;
    console.log('  stripped BOM: ' + path.relative(ROOT, f));
  }
}
console.log(`stripped ${n} file(s)`);

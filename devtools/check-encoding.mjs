// Scan tracked text sources for a UTF-8 BOM or stray CRLF that PowerShell's Set-Content may have added.
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

const bom = [];
const crlf = [];
for (const f of walk(ROOT)) {
  const buf = fs.readFileSync(f);
  if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) bom.push(path.relative(ROOT, f));
  if (buf.includes('\r\n')) crlf.push(path.relative(ROOT, f));
}
console.log('files with BOM:', bom.length);
for (const f of bom.slice(0, 20)) console.log('  ' + f);
console.log('files with CRLF (may be fine — git normalises on commit):', crlf.length);
for (const f of crlf.slice(0, 15)) console.log('  ' + f);

import { execSync } from 'node:child_process';
import { parse } from 'acorn';

const ref = process.argv[2] || 'v0.2.3';
const files = execSync(`git ls-tree -r --name-only ${ref} -- public/js shared server/sim/content`, { encoding: 'utf8' })
  .split('\n').filter((f) => f.endsWith('.js'));
const bad = [];
for (const f of files) {
  let code;
  try { code = execSync(`git show ${ref}:"${f}"`, { encoding: 'utf8', maxBuffer: 1 << 28 }); } catch { continue; }
  try { parse(code, { ecmaVersion: 2020, sourceType: 'module' }); }
  catch (e) { bad.push(`${f}:${e.loc?.line ?? '?'} ${e.message.split(' (')[0]}`); }
}
console.log(`${ref}: ${files.length} files scanned, ${bad.length} ES2020 violations`);
for (const b of bad.slice(0, 25)) console.log('  ' + b);

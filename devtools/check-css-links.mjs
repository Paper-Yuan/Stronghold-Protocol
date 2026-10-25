// Compare the stylesheets index.html links today with what the local tree linked before the merge,
// and flag any CSS file that exists on disk but is linked by nobody.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const nowHtml = fs.readFileSync(path.join(ROOT, 'public/index.html'), 'utf8');
const oldHtml = execFileSync('git', ['show', '564a01ce:public/index.html'], { encoding: 'utf8' });

const links = (html) => [...html.matchAll(/href="(\/css\/[^"]+\.css)"/g)].map((m) => m[1]);
const now = links(nowHtml);
const old = links(oldHtml);
console.log('stylesheets linked now:', now.length);
console.log('stylesheets linked before the merge:', old.length);
const dropped = old.filter((s) => !now.includes(s));
const added = now.filter((s) => !old.includes(s));
console.log('\ndropped by the merge:');
for (const s of dropped) {
  const exists = fs.existsSync(path.join(ROOT, 'public', s.replace(/^\//, '')));
  console.log(`  ${exists ? 'file EXISTS' : 'file gone   '}  ${s}`);
}
console.log('\nnewly linked:');
for (const s of added) console.log('  ' + s);

// any CSS on disk that nothing links and nothing imports
const all = [];
(function walk(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p);
    else if (p.endsWith('.css')) all.push(p);
  }
})(path.join(ROOT, 'public/css'));
const unlinked = all
  .map((p) => '/' + path.relative(path.join(ROOT, 'public'), p).replace(/\\/g, '/'))
  .filter((u) => !now.includes(u));
console.log('\nCSS on disk that index.html does not link:', unlinked.length);
for (const u of unlinked) console.log('  ' + u);

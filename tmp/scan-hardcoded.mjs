import fs from 'node:fs';
import path from 'node:path';

const root = 'E:/Workbox/系统';
const dirs = ['test', 'devtools', 'docs'];
const out = [];
const walk = (dir) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === 'golden' || e.name === 'fixtures' || e.name === 'node_modules') continue;
      walk(p);
    } else if (/\.(js|mjs|md|json)$/.test(e.name)) {
      const rel = path.relative(root, p).replace(/\\/g, '/');
      const lines = fs.readFileSync(p, 'utf8').split('\n');
      lines.forEach((line, i) => {
        if (/\b112\b/.test(line)) out.push(`${rel}:${i + 1}: ${line.trim().slice(0, 220)}`);
      });
    }
  }
};
for (const d of dirs) walk(path.join(root, d));
fs.writeFileSync(path.join(root, 'tmp/hardcoded-112.txt'), out.join('\n'), 'utf8');
console.log(out.length, 'lines');

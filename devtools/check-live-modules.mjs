// Report which local-only susbystems are actually reachable from public/js/main.js.
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const seen = new Set();
function walk(f) {
  if (seen.has(f) || !fs.existsSync(f)) return;
  seen.add(f);
  const s = fs.readFileSync(f, 'utf8');
  for (const m of s.matchAll(/(?:from|import)\s*\(?\s*['"]([^'"]+)['"]/g)) {
    if (!m[1].startsWith('.')) continue;
    walk(path.resolve(path.dirname(f), m[1]));
  }
}
walk(path.join(ROOT, 'public/js/main.js'));
const rel = [...seen].map((f) => path.relative(ROOT, f).replace(/\\/g, '/'));
console.log('live modules:', rel.length);
const pats = ['resources/', 'preloadModal', 'damageStats', 'roomChat', 'modManagerModal', 'bondStrip',
  'hubCarousel', 'lobbyMusic', 'matchFlow', 'achievements', 'namecards', 'accounts', 'traitOverlay',
  'bossPhaseWarn', 'matchPlates', 'dpsPanel', 'pickAnyOverlay', 'serverRedirectModal', 'facingWheel', 'effectsList'];
for (const p of pats) {
  const hit = rel.filter((r) => r.includes(p));
  console.log('  ' + p.padEnd(20) + (hit.length ? 'LIVE: ' + hit.join(', ') : 'dead'));
}

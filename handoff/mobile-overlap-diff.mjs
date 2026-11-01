import fs from 'node:fs';
const a = JSON.parse(fs.readFileSync('handoff/mobile-overlap-after.json', 'utf8'));
const b = JSON.parse(fs.readFileSync('handoff/mobile-overlap-before-desktop.json', 'utf8'));
let diffs = 0;
for (const vp of ['1280x720', '1920x1080']) {
  for (const k of ['hubRects', 'hallRects', 'themeRects']) {
    const x = a[vp]?.[k] ?? {}, y = b[vp]?.[k] ?? {};
    for (const sel of new Set([...Object.keys(x), ...Object.keys(y)])) {
      const vx = JSON.stringify(x[sel] ?? null), vy = JSON.stringify(y[sel] ?? null);
      if (vx !== vy) { diffs += 1; console.log(`DIFF ${vp} ${k} ${sel}: after=${vx} before=${vy}`); }
    }
  }
  // overlaps / near / scroll too
  for (const k of ['hub', 'hall', 'theme']) {
    const s = (o) => JSON.stringify({ o: o?.overlaps?.length ?? -1, s: o?.scroll });
    if (s(a[vp]?.[k]) !== s(b[vp]?.[k])) { diffs += 1; console.log(`DIFF ${vp} ${k} summary`, s(a[vp]?.[k]), s(b[vp]?.[k])); }
  }
}
console.log(diffs === 0 ? 'DESKTOP RECTS IDENTICAL (1280x720 + 1920x1080, ' +
  Object.keys(a['1280x720'].hubRects).length + '+' + Object.keys(a['1280x720'].hallRects).length + '+' +
  Object.keys(a['1280x720'].themeRects).length + ' selectors each) x2' : `${diffs} DIFFERENCES`);

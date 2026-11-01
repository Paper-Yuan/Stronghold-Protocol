import fs from 'node:fs';

const root = 'E:/Workbox/系统';
const files = [
  'data/chess.json',
  'data/garrisons.json',
  'modref/mods/rhodes-ship/rhodes-ship-mod/payload/packs/rhodes-ship/chess.json',
  'modref/mods/kazdel-ship/kazdel-ship-mod/payload/packs/kazdel-ship/chess.json',
];
const needle = '<' + '$' + 'ba.';
for (const f of files) {
  const s = fs.readFileSync(`${root}/${f}`, 'utf8');
  console.log(f, (s.split(needle).length - 1));
}
const d = JSON.parse(fs.readFileSync(`${root}/data/chess.json`, 'utf8'));
const hits = Object.entries(d).filter(([, c]) => JSON.stringify(c).includes(needle));
console.log('our chess records with it:', hits.length, hits.slice(0, 5).map(([id]) => id));
console.log('sample:', JSON.stringify(d[hits[0][0]]).slice(0, 500));

// how does richTextPlain treat the official '<$ba.' and pack '<$ba.' forms?
const { richTextPlain } = await import('file:///E:/Workbox/系统/public/js/ui/richText.js');
const official = '使自身与身后一格的友军获得18%的<\u0024ba.protect>庇护</>';
const at = '使自身与身后一格的友军获得18%的<@ba.vup>庇护</>';
console.log('plain($ba):', JSON.stringify(richTextPlain(official)));
console.log('plain(@ba):', JSON.stringify(richTextPlain(at)));

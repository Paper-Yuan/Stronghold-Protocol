import fs from 'node:fs';
const a = JSON.parse(fs.readFileSync('data/assets.json', 'utf8'));
console.log('keys:', Object.keys(a));
if (a.audio) console.log('audio keys:', Object.keys(a.audio));
if (a.audio?.voice) console.log('voice keys:', Object.keys(a.audio.voice));
console.log('skin_avatar count:', a.skin_avatar ? Object.keys(a.skin_avatar).length : 0);
console.log('skin_spine count:', a.skin_spine ? Object.keys(a.skin_spine).length : 0);
console.log('skinsInstalled count:', a.skinsInstalled ? a.skinsInstalled.length : 0);
if (a.skin_spine) console.log('skin_spine sample keys:', Object.keys(a.skin_spine).slice(0, 5));

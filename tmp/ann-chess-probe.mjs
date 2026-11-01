import fs from 'node:fs';
import path from 'node:path';

const root = 'E:/Workbox/系统';
const dirs = {
  'rhodes-ship': path.join(root, 'modref/mods/rhodes-ship/rhodes-ship-mod/payload/packs/rhodes-ship'),
  'kazdel-ship': path.join(root, 'modref/mods/kazdel-ship/kazdel-ship-mod/payload/packs/kazdel-ship'),
};
const oursBonds = JSON.parse(fs.readFileSync(path.join(root, 'data/bonds.json'), 'utf8'));
const { richTextPlain } = await import('file:///E:/Workbox/系统/public/js/ui/richText.js');
const out = [];
for (const [name, dir] of Object.entries(dirs)) {
  const chess = JSON.parse(fs.readFileSync(path.join(dir, 'chess.json'), 'utf8')).chess;
  for (const [id, c] of Object.entries(chess)) {
    if (!/chess_char_9_/.test(id)) continue;
    const badBonds = (c.bonds || []).filter((b) => !oursBonds[b]);
    const skillsDefault = (c.skills || []).filter((s) => s.isDefault === true).length;
    const skillIsDefault = !!(c.skill && 'isDefault' in c.skill);
    const modsDefault = (c.modules || []).filter((m) => m.isDefault === true).length;
    const hasBase = !!c.statsBase && !!c.traitBase && !!c.talentsBase;
    const descBad = typeof c.desc === 'string' && typeof c.descRaw === 'string' && richTextPlain(c.descRaw) !== c.desc;
    out.push(`${name} ${id}: chessType=${c.chessType} backup=${JSON.stringify(c.backup)} visible=${c.visible} isHidden=${c.isHidden} isDiy=${c.isDiy} tier=${c.tier} price=${c.price} sellPrice=${c.sellPrice} shopSortId=${c.shopSortId} identifier=${c.identifier} rarity=${c.rarity} potDown=${c.potDown ? Object.keys(c.potDown).join('|') : 'none'} modulesKey=${'modules' in c} modsDefault=${modsDefault} hasBase=${hasBase} skillsDefault=${skillsDefault} skillIsDefault=${skillIsDefault} skills=${(c.skills || []).length} badBonds=${badBonds.join(',')} descBad=${descBad} rangeGrid=${Array.isArray(c.rangeGrid)} placeOnRanged=${c.placeOnRanged} tokens=${JSON.stringify(c.tokens)} skillTrigger=${c.skill && c.skill.trigger ? c.skill.trigger.rule : 'none'}`);
    if (descBad) out.push(`   desc=${JSON.stringify(c.desc).slice(0, 200)}\n   raw=${JSON.stringify(c.descRaw).slice(0, 200)}`);
    if (skillsDefault !== 1 || skillIsDefault) {
      out.push(`   skills: ${JSON.stringify((c.skills || []).map((s) => ({ id: s.skillId, idx: s.index, def: s.isDefault })))} skill=${JSON.stringify({ id: c.skill?.skillId, idx: c.skill?.index, def: c.skill?.isDefault })}`);
    }
  }
}
fs.writeFileSync(path.join(root, 'tmp/ann-chess-probe.txt'), out.join('\n'), 'utf8');
console.log(out.join('\n'));

import fs from 'node:fs';
import path from 'node:path';

const root = 'E:/Workbox/系统';
const dirs = {
  'rhodes-ship': path.join(root, 'modref/mods/rhodes-ship/rhodes-ship-mod/payload/packs/rhodes-ship'),
  'kazdel-ship': path.join(root, 'modref/mods/kazdel-ship/kazdel-ship-mod/payload/packs/kazdel-ship'),
};
const oursChess = JSON.parse(fs.readFileSync(path.join(root, 'data/chess.json'), 'utf8'));
const out = [];
const ids = new Set();
for (const [name, dir] of Object.entries(dirs)) {
  const chess = JSON.parse(fs.readFileSync(path.join(dir, 'chess.json'), 'utf8')).chess;
  for (const [id, c] of Object.entries(chess)) {
    if (!/chess_char_9_/.test(id)) continue;
    ids.add(id);
    const def = (c.skills || []).find((s) => s.isDefault === true);
    const talentTokens = (c.talents || []).filter((t) => t.tokenKey).map((t) => t.tokenKey);
    const tokensOk = talentTokens.every((t) => (c.tokens || []).includes(t));
    const badTri = [c.dmgType, c.attackKind, c.projectile].filter((v) => v !== null && v !== undefined);
    const identClash = Object.entries(oursChess).filter(([oid, o]) => o.identifier === c.identifier && oid !== id).map(([oid]) => oid);
    out.push(`${id}: skillLevel=${c.skill?.level} status.skillLevel=${c.status?.skillLevel} defaultSkillId=${def?.skillId} skillSkillId=${c.skill?.skillId} same=${def?.skillId === c.skill?.skillId} talentTokens=${JSON.stringify(talentTokens)} tokensOk=${tokensOk} tri=${JSON.stringify([c.dmgType, c.attackKind, c.projectile])} ident=${c.identifier} identClash=${identClash.join(',') || '-'} sortId=${c.shopSortId} name=${c.name}`);
  }
}
out.push(`total ${ids.size}`);
fs.writeFileSync(path.join(root, 'tmp/ann-chess-probe2.txt'), out.join('\n'), 'utf8');
console.log(out.join('\n'));

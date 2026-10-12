// test/ui/feedback5-we2-diybanned.test.js — 0.2.0 WE2 #11: the player's own 自选 pieces left out of the shop because every
// bond of the operator is switched off this match (m.private.diyBanned) are named under 本局禁用干员 — the briefing, the
// strategy draft's 本局信息 dialog (ui/matchInfo.js) and the in-game 本局信息 tab (ui/enemyDrawer.js).
// Run: node --test test/ui/feedback5-we2-diybanned.test.js

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
globalThis.fetch = async (url) => {
  const name = String(url).split('/').pop();
  try {
    const body = readFileSync(path.join(ROOT, 'data', name), 'utf8');
    return { ok: true, status: 200, json: async () => JSON.parse(body) };
  } catch {
    return { ok: false, status: 404, json: async () => ({}) };
  }
};

const G = await import('../../public/js/ui/gameLogic.js');
const { matchInfoModel, DiyBannedLine } = await import('../../public/js/ui/matchInfo.js');
const { data } = await import('../../public/js/data.js');
const { setLang, addMessages } = await import('../../shared/i18n.js');
const { DATA } = await import('../match/harness.js');
await data.loadAll('chess', 'bonds', 'assets', 'backups');

const T5A = 'chess_char_5_diy1_a';
const T6A = 'chess_char_6_diy1_a';
const SIEGE = 'char_112_siege';
const LING = 'char_2023_ling';
const D = { chess: DATA.chess, backups: DATA.backups };
const getChess = (id) => (Object.hasOwn(DATA.chess, id) ? DATA.chess[id] : null);
const priv = {
  diy: { [T5A]: { charId: SIEGE, skillIndex: 2, uniEquipId: 'uniequip_002_siege' }, [T6A]: { charId: LING, skillIndex: 0, uniEquipId: null } },
  diyBanned: [T6A],
};
const textOf = (v) => (Array.isArray(v) ? v.map(textOf).join('') : v == null || typeof v === 'boolean' ? '' : typeof v === 'object' ? textOf(v.props?.children) : String(v));

test('#11 diyBannedPieces: the banned slots with their operator\'s name, slot order; none without picks', () => {
  assert.deepEqual(G.diyBannedPieces(priv, getChess, D), [{ slotId: T6A, charId: LING, name: DATA.backups.units[LING].name }]);
  assert.deepEqual(G.diyBannedPieces({ diy: priv.diy, diyBanned: [] }, getChess, D), []);
  assert.deepEqual(G.diyBannedPieces({ diyBanned: [T6A] }, getChess, D), [], 'no pick for the slot: nothing');
  assert.deepEqual(G.diyBannedPieces(null, getChess, D), []);
});

test('#11 the match-info model and its line: the own banned 自选 piece is named; nothing without priv / diyBanned', () => {
  const pub = { bannedChess: [], drawnDisabledBonds: [], modeId: 'mode_multi_hard' };
  const model = matchInfoModel(pub, { bonds: [], chess: getChess, priv, diyData: D });
  assert.deepEqual(model.diyBanned.map((x) => x.slotId), [T6A]);
  setLang('zh');
  const line = DiyBannedLine({ model });
  assert.ok(line, 'a line');
  const txt = textOf(line);
  assert.ok(txt.includes('自选') && txt.includes(DATA.backups.units[LING].name) && txt.includes('不会出现在你的商店'), txt);
  assert.equal(DiyBannedLine({ model: matchInfoModel(pub, { bonds: [], chess: getChess }) }), null, 'no priv: no line');
  assert.equal(DiyBannedLine({ model: matchInfoModel(pub, { bonds: [], chess: getChess, priv: { ...priv, diyBanned: [] }, diyData: D }) }), null);
  // English: the msgid is in public/i18n/en.json
  const en = JSON.parse(readFileSync(path.join(ROOT, 'public/i18n/en.json'), 'utf8'));
  const id = '{names}的盟约本局全部禁用，不会出现在你的商店';
  assert.ok(en[id] && en[id].includes('{names}'), 'translated with its placeholder');
  addMessages('en', { [id]: en[id], 自选: en['自选'] });
  setLang('en');
  try {
    const t2 = textOf(DiyBannedLine({ model }));
    assert.ok(t2.includes('Custom') && t2.includes('not in your shop'), t2);
  } finally { setLang('zh'); }
});

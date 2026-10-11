// Asset URL helpers (public/js/ui/assetUrls.js) against the real manifest: every visible chess resolves its
// avatar and portrait (normal + golden), bonds / bands / items / enemies / factions / titles resolve, and
// nothing outside the manifest is ever returned.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  uiUrl, chessAvatarUrl, chessPortraitUrl, skillIconUrl, profIconUrl, subProfIconUrl, bondIconUrl, bandIconUrl, itemIconUrl,
  enemyIconUrl, tokenAvatarUrl, factionIconUrl, titleIconUrl, effectIconUrl,
} from '../../public/js/ui/assetUrls.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const load = (f) => JSON.parse(readFileSync(path.join(ROOT, 'data', f), 'utf8'));
const m = load('assets.json');
const chess = load('chess.json');

function manifestUrls(obj, out = new Set()) {
  if (typeof obj === 'string' && obj.startsWith('/assets/')) out.add(obj);
  else if (obj && typeof obj === 'object') for (const v of Object.values(obj)) manifestUrls(v, out);
  return out;
}
const ALL = manifestUrls(m);
const inManifest = (u) => u == null || ALL.has(u);

describe('assetUrls', () => {
  test('every visible chess (normal + golden) has avatar, portrait and skill icon', () => {
    let n = 0;
    for (const c of Object.values(chess)) {
      if (!c.charId || c.isDiy) continue;
      const a = chessAvatarUrl(m, c);
      const p = chessPortraitUrl(m, c);
      assert.ok(a && inManifest(a), `avatar ${c.chessId}`);
      assert.ok(p && inManifest(p), `portrait ${c.chessId}`);
      assert.ok(inManifest(skillIconUrl(m, c)), `skill ${c.chessId}`);
      assert.ok(inManifest(profIconUrl(m, c.profession)));
      assert.ok(inManifest(subProfIconUrl(m, c)));
      n++;
    }
    assert.ok(n >= 200);
    const golden = Object.values(chess).find((c) => c.isGolden && m.chars[c.charId]?.avatarE2);
    assert.equal(chessAvatarUrl(m, golden), m.chars[golden.charId].avatarE2, 'golden uses E2 art');
  });
  test('bonds, bands, items, enemies, tokens, factions, titles, effects', () => {
    for (const id of Object.keys(load('bonds.json'))) assert.ok(bondIconUrl(m, id), id);
    for (const id of Object.keys(load('bands.json'))) assert.ok(bandIconUrl(m, id), id);
    for (const it of Object.values(load('items.json'))) assert.ok(inManifest(itemIconUrl(m, it)), it.id);
    assert.ok(itemIconUrl(m, Object.values(load('items.json'))[0]));
    const enemies = load('enemies.json');
    let found = 0;
    for (const k of Object.keys(enemies)) { const u = enemyIconUrl(m, k); assert.ok(inManifest(u), k); if (u) found++; }
    assert.ok(found > Object.keys(enemies).length * 0.9);
    for (const t of Object.values(load('factions.json').types)) assert.ok(factionIconUrl(m, t.icon), t.type);
    for (const t of load('config.json').titles) assert.ok(titleIconUrl(m, t.picId), t.id);
    assert.ok(tokenAvatarUrl(m, 'token_10028_vigil_wolf'));
    assert.ok(effectIconUrl(m, { iconKind: 'team' }));
    assert.ok(effectIconUrl(m, { iconKind: 'choice' }));
    assert.ok(effectIconUrl(m, { iconKind: 'band', iconId: 'band_bldsk' }));
    assert.ok(effectIconUrl(m, { iconKind: 'garrison' }));
    assert.equal(effectIconUrl(m, { iconKind: 'x' }), null);
    assert.ok(uiUrl(m, 'hudPanel/icon_hp'));
  });
  test('missing manifest / ids ⇒ null, never throws', () => {
    for (const fn of [chessAvatarUrl, chessPortraitUrl, skillIconUrl, subProfIconUrl, itemIconUrl]) {
      assert.equal(fn(null, null), null);
      assert.equal(fn(m, { assets: {} }) ?? null, fn === skillIconUrl ? uiUrl(m, 'skillIcon/empty') : null);
    }
    assert.equal(bondIconUrl(m, 'nope'), null);
    assert.equal(bandIconUrl(null, 'band_bldsk'), null);
    assert.equal(enemyIconUrl(m, 'enemy_nope'), null);
    assert.equal(profIconUrl(m, 'NOPE'), null);
    assert.equal(uiUrl(undefined, 'x'), null);
    assert.equal(tokenAvatarUrl(m, null), null);
  });
});

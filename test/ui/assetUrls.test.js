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
  // 业主 2026-10-31：湮灭内容 mod 的 13 名干员此刻**都有**本地素材——最后 4 位（陨星 char_219_meteo / 霜叶
  // char_193_frostl / 坚雷 char_260_durnar / 阿米娅 char_002_amiya）已按干员补齐（`tools/fetch-assets.mjs --ids=…`，
  // docs/ASSETS.md），所以这里写死它们此刻解析出的**具体路径**——素材再变，这些字符串就得跟着改，而不是退化成
  // 「非 null 即可」。`_a`（普通形）取 chars[id] 的 avatar / portrait，`_b`（精二 golden）取 avatarE2 / portraitE2；
  // illust 是新补的全幅立绘。缺失时的兜底（解析不出图必须是 null，绝不给一条既不在清单里、也不是 null 的 URL）
  // 仍由下面一个**没有**素材条目的合成记录守着。
  const ANNIL_LOCAL_ART = {
    char_219_meteo: {
      avatar: '/assets/char/avatar/char_219_meteo.png', avatarE2: '/assets/char/avatar/char_219_meteo_2.png',
      portrait: '/assets/char/portrait/char_219_meteo_1.webp', portraitE2: '/assets/char/portrait/char_219_meteo_2.webp',
      illust: '/assets/char/illust/char_219_meteo.webp',
    },
    char_193_frostl: {
      avatar: '/assets/char/avatar/char_193_frostl.png', avatarE2: '/assets/char/avatar/char_193_frostl_2.png',
      portrait: '/assets/char/portrait/char_193_frostl_1.webp', portraitE2: '/assets/char/portrait/char_193_frostl_2.webp',
      illust: '/assets/char/illust/char_193_frostl.webp',
    },
    char_260_durnar: {
      avatar: '/assets/char/avatar/char_260_durnar.png', avatarE2: '/assets/char/avatar/char_260_durnar_2.png',
      portrait: '/assets/char/portrait/char_260_durnar_1.webp', portraitE2: '/assets/char/portrait/char_260_durnar_2.webp',
      illust: '/assets/char/illust/char_260_durnar.webp',
    },
    char_002_amiya: {
      avatar: '/assets/char/avatar/char_002_amiya.png', avatarE2: '/assets/char/avatar/char_002_amiya_2.png',
      portrait: '/assets/char/portrait/char_002_amiya_1.webp', portraitE2: '/assets/char/portrait/char_002_amiya_2.webp',
      illust: '/assets/char/illust/char_002_amiya.webp',
    },
  };
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
    // 湮灭 mod 的 4 位干员：manifest 字段与解析结果都写死成当下事实（见文件头的 ANNIL_LOCAL_ART）。
    for (const [charId, art] of Object.entries(ANNIL_LOCAL_ART)) {
      for (const [field, url] of Object.entries(art)) assert.equal(m.chars[charId]?.[field], url, `${charId}.${field}`);
    }
    for (const c of Object.values(chess)) {
      const art = c.annihilation === true ? ANNIL_LOCAL_ART[c.charId] : null;
      if (!art) continue;
      assert.equal(chessAvatarUrl(m, c), c.isGolden ? art.avatarE2 : art.avatar, `${c.chessId}: local avatar`);
      assert.equal(chessPortraitUrl(m, c), c.isGolden ? art.portraitE2 : art.portrait, `${c.chessId}: local portrait`);
      assert.equal(m.chars[c.assets.portrait], undefined, `${c.chessId}: portrait id is a form id (charId_1 / _2)`);
    }
    const golden = Object.values(chess).find((c) => c.isGolden && m.chars[c.charId]?.avatarE2);
    assert.equal(chessAvatarUrl(m, golden), m.chars[golden.charId].avatarE2, 'golden uses E2 art');
  });
  test('a chess whose character has no manifest entry still resolves to null', () => {
    // 素材按干员补齐之后，真实名册里已经没有「有棋子、没图」的干员了；兜底分支仍要有人守，所以用一个确实没有
    // 素材条目的合成 id：解析不出图必须是 null（UI 画兜底块），绝不给一条既不在清单里、也不是 null 的 URL。
    const missing = { chessId: 'chess_char_9_99_a', charId: 'char_9999_missing', isGolden: false, annihilation: true,
      assets: { avatar: 'char_9999_missing', portrait: 'char_9999_missing_1', skillIcon: 'skchr_missing_1' } };
    const golden = { ...missing, chessId: 'chess_char_9_99_b', isGolden: true,
      assets: { avatar: 'char_9999_missing_2', portrait: 'char_9999_missing_2', skillIcon: 'skchr_missing_1' } };
    assert.equal(m.chars[missing.charId], undefined, 'the synthetic operator has no local art entry');
    for (const c of [missing, golden]) {
      assert.equal(chessAvatarUrl(m, c), null, `${c.chessId}: no art ⇒ null`);
      assert.equal(chessPortraitUrl(m, c), null, `${c.chessId}: no art ⇒ null`);
      assert.equal(skillIconUrl(m, c), uiUrl(m, 'skillIcon/empty'), `${c.chessId}: an unknown skill falls back to the empty sprite`);
    }
  });
  test('a golden character key uses portraitE2 and avatarE2; a portrait-only entry keeps its URL', () => {
    const whitw2 = m.chars.char_1038_whitw2;
    const inside = m.chars.char_498_inside;
    const manifest = { chars: {
      plugin_1: { portrait: '/assets/char/portrait/plugin_1.png', portraitE2: '/assets/char/portrait/plugin_2.png', avatar: '/assets/char/avatar/plugin_1.png', avatarE2: '/assets/char/avatar/plugin_2.png' },
      custom_portrait: { portrait: '/custom.png' },
      gold_art: { portrait: '/gold.png', avatar: '/gold-a.png' },
      char_1038_whitw2: whitw2,
      char_498_inside: inside,
    } };
    const piece = (id, isGolden) => ({ isGolden, charId: id, assets: { portrait: id, avatar: id } });
    assert.equal(chessPortraitUrl(manifest, piece('plugin_1', true)), '/assets/char/portrait/plugin_2.png');
    assert.equal(chessPortraitUrl(manifest, piece('plugin_1', false)), '/assets/char/portrait/plugin_1.png');
    assert.equal(chessAvatarUrl(manifest, piece('plugin_1', true)), '/assets/char/avatar/plugin_2.png');
    assert.equal(chessAvatarUrl(manifest, piece('plugin_1', false)), '/assets/char/avatar/plugin_1.png');
    assert.equal(chessPortraitUrl(manifest, piece('custom_portrait', true)), '/custom.png', 'golden without portraitE2');
    assert.equal(chessPortraitUrl(manifest, { isGolden: true, assets: { portrait: 'gold_art' } }), '/gold.png', 'custom golden portrait URL');
    assert.equal(chessAvatarUrl(manifest, { isGolden: true, assets: { avatar: 'gold_art' } }), '/gold-a.png');
    assert.equal(chessPortraitUrl(manifest, piece('char_1038_whitw2', true)), whitw2.portraitE2);
    assert.equal(chessPortraitUrl(manifest, piece('char_498_inside', true)), inside.portraitE2);
    assert.equal(chessPortraitUrl(manifest, piece('char_498_inside', false)), inside.portrait);
    assert.equal(chessAvatarUrl(manifest, piece('char_498_inside', true)), inside.avatarE2);
    // 炸惊's anniversary stand-ins (chess_zj_60_*) put the source character key — not the usual `charId_1` / `charId_2`
    // portrait id — into assets.portrait. chessPortraitUrl supports exactly that (a golden piece takes the entry's
    // portraitE2, a normal one its portrait), so these eight are explicit exceptions; any other record doing it must
    // still fail the strict check below.
    const ZJ_CHAR_KEY_PORTRAIT = new Map([
      ['chess_zj_60_2_a', 'char_4220_kormr'],
      ['chess_zj_60_2_b', 'char_4220_kormr'],
      ['chess_zj_60_3_a', 'char_4218_aigis'],
      ['chess_zj_60_3_b', 'char_4218_aigis'],
      ['chess_zj_60_4_a', 'char_4219_yukari'],
      ['chess_zj_60_4_b', 'char_4219_yukari'],
      ['chess_zj_60_5_a', 'char_4217_makoto'],
      ['chess_zj_60_5_b', 'char_4217_makoto'],
    ]);
    for (const [id, key] of ZJ_CHAR_KEY_PORTRAIT) assert.equal(chess[id]?.assets?.portrait, key, `${id}: portrait is ${key}`);
    // 「追加进同一份 chess.json、但不属于官方名册」的两类：炸惊（`zhajing`）与湮灭内容 mod 的干员（`annihilation`）
    const isZj = (c) => Object.hasOwn(c, 'zhajing') || /^chess_zj_/.test(c.chessId) || c.annihilation === true;
    let official = 0;
    for (const c of Object.values(chess)) {
      if (!c.charId || c.isDiy) continue;
      const portraitId = c.assets?.portrait;
      const exception = ZJ_CHAR_KEY_PORTRAIT.get(c.chessId);
      if (exception) {
        assert.equal(isZj(c), true, `${c.chessId}: a 炸惊 record`);
        assert.ok(m.chars[exception]?.portrait, `${c.chessId}: the character entry has a portrait`);
        const want = c.isGolden ? m.chars[exception].portraitE2 || m.chars[exception].portrait : m.chars[exception].portrait;
        assert.equal(chessPortraitUrl(m, c), want, `${c.chessId}: the character-key portrait resolves`);
        assert.ok(inManifest(want), `${c.chessId}: its portrait is in the manifest`);
        continue;
      }
      // 湮灭内容 mod 的 4 位干员素材已按干员补齐（见文件头的 ANNIL_LOCAL_ART）：写死它们此刻解析出的半身像路径，
      // 并确认 portrait id 仍是形（charId_1 / charId_2）、不是干员键本身。缺素材的兜底由上一个测试的合成记录守着。
      if (c.annihilation === true && ANNIL_LOCAL_ART[c.charId]) {
        const art = ANNIL_LOCAL_ART[c.charId];
        assert.equal(chessPortraitUrl(m, c), c.isGolden ? art.portraitE2 : art.portrait, `${c.chessId}: local portrait`);
        assert.equal(m.chars[portraitId], undefined, `${c.chessId}: portrait id is not a character key`);
        continue;
      }
      if (!isZj(c)) official++;
      assert.equal(m.chars[portraitId], undefined, `${c.chessId}: portrait id is not a character key`);
      if (String(portraitId).endsWith('_2')) {
        const base = m.chars[portraitId.slice(0, -2)];
        assert.equal(chessPortraitUrl(m, c), base.portraitE2 || base.portrait, c.chessId);
      } else if (String(portraitId).endsWith('_1')) {
        assert.equal(chessPortraitUrl(m, c), m.chars[portraitId.slice(0, -2)].portrait, c.chessId);
      }
    }
    // The official subset only: 206 炸惊 records (chess_zj_* / the `zhajing` flag) are appended to the same file.
    assert.equal(official, 258);
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

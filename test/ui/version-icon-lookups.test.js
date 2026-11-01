// Audit the ID → record → art path against all installed official versions, in one warm store.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createDataStore } from '../../public/js/data.js';
import { makeData } from '../../public/js/render/app/host.js';
import { VERSIONS } from '../../shared/versions.js';
import { diyRecordOf } from '../../shared/diy.js';
import { standInRecord } from '../../shared/standIn.js';
import { garrisonTypeIconKey } from '../../public/js/ui/detailPanel.js';
import { chessAvatarUrl, chessPortraitUrl, skillIconUrl, itemIconUrl, bondIconUrl, bandIconUrl,
  enemyIconUrl, tokenAvatarUrl, effectIconUrl } from '../../public/js/ui/assetUrls.js';

const read = (dir, file) => JSON.parse(readFileSync(new URL(`../../${dir}/${file}.json`, import.meta.url)));
const files = ['config', 'chess', 'items', 'enemies', 'tokens', 'bonds', 'bands', 'garrisons', 'effects', 'backups'];
const manifest = read('data', 'assets');
// 湮灭内容 mod 的 4 位干员（陨星 / 霜叶 / 坚雷 / 阿米娅）在 2026-10-31 按干员补齐了本地素材，解析结果写死成当下的
// 具体路径：`_a`（普通形）取 chars[id] 的 avatar / portrait，`_b`（精二 golden）取 avatarE2 / portraitE2。素材或
// chess 记录任何一边变了都要让 reviewer 看见，而不是退化成「非 null 即可」。
const ANNIL_LOCAL_ART = {
  char_219_meteo: {
    avatar: '/assets/char/avatar/char_219_meteo.png', avatarE2: '/assets/char/avatar/char_219_meteo_2.png',
    portrait: '/assets/char/portrait/char_219_meteo_1.webp', portraitE2: '/assets/char/portrait/char_219_meteo_2.webp',
  },
  char_193_frostl: {
    avatar: '/assets/char/avatar/char_193_frostl.png', avatarE2: '/assets/char/avatar/char_193_frostl_2.png',
    portrait: '/assets/char/portrait/char_193_frostl_1.webp', portraitE2: '/assets/char/portrait/char_193_frostl_2.webp',
  },
  char_260_durnar: {
    avatar: '/assets/char/avatar/char_260_durnar.png', avatarE2: '/assets/char/avatar/char_260_durnar_2.png',
    portrait: '/assets/char/portrait/char_260_durnar_1.webp', portraitE2: '/assets/char/portrait/char_260_durnar_2.webp',
  },
  char_002_amiya: {
    avatar: '/assets/char/avatar/char_002_amiya.png', avatarE2: '/assets/char/avatar/char_002_amiya_2.png',
    portrait: '/assets/char/portrait/char_002_amiya_1.webp', portraitE2: '/assets/char/portrait/char_002_amiya_2.webp',
  },
};

test('warm record indexes and art helpers follow every version, then restore the default without refetching', async () => {
  const originals = Object.fromEntries(files.map(name => [name, read('data', name)]));
  let fetched = 0;
  const store = createDataStore({ fetch: async url => {
    fetched++;
    return { ok: true, json: async () => originals[url.split('/').at(-1).replace('.json', '')] };
  } });
  await store.loadAll(...files);
  const view = makeData(store);
  const sets = VERSIONS.filter(v => v.dir).map(v => ({ id: v.id,
    values: Object.fromEntries(files.map(name => [name, read(`data/${v.dir}`, name)])) }));
  for (const set of [null, ...sets, null, ...sets.toReversed(), null]) {
    store.setContent(set);
    const records = set?.values || originals;
    for (const file of files.filter(n => !['config', 'backups'].includes(n))) {
      for (const [id, record] of Object.entries(records[file])) {
        assert.equal(store.lookup(file, id), record, `${set?.id || 'default'} ${file}/${id}: active names, descriptions and rules`);
      }
    }
    // 湮灭内容 mod 自带的干员仍在名册里（盟约计数需要）；其中 4 位（陨星 / 霜叶 / 坚雷 / 阿米娅）素材已按干员补齐，
    // 图解析写死成 ANNIL_LOCAL_ART 里的具体路径，其余记录照旧断言解析得到图。
    for (const c of Object.values(records.chess).filter(c => c.charId && !c.isDiy)) {
      assert.equal(view.chess(c.chessId), c);
      const art = c.annihilation === true ? ANNIL_LOCAL_ART[c.charId] : null;
      if (art) {
        assert.equal(chessAvatarUrl(manifest, c), c.isGolden ? art.avatarE2 : art.avatar, `${c.chessId}: local avatar`);
        assert.equal(chessPortraitUrl(manifest, c), c.isGolden ? art.portraitE2 : art.portrait, `${c.chessId}: local portrait`);
      } else {
        assert.ok(chessAvatarUrl(manifest, c), c.chessId);
        assert.ok(chessPortraitUrl(manifest, c), c.chessId);
      }
      // the documented chain of ui/assetUrls.js `skillIconUrl` (docs/ASSETS.md, test/render/assets.test.js): the record's
      // iconId, else the skill's iconId / skillId, else `skillsById` — 10 炸惊 chess records (e.g. chess_zj_12_a) carry no
      // `assets.skillIcon` and still resolve through `skill.iconId`
      const icon = manifest.skills[c.assets.skillIcon || c.skill?.iconId || c.skill?.skillId]
        || manifest.skills[manifest.skillsById?.[c.skill?.skillId]] || manifest.ui['skillIcon/empty'];
      assert.ok(icon, `${c.chessId}: a skill icon URL`);
      assert.equal(skillIconUrl(manifest, c), icon, c.chessId);
      assert.deepEqual(view.standIn(c.chessId), standInRecord(c, records.backups), `${c.chessId}: active stand-in`);
    }
    for (const c of Object.values(records.chess).filter(c => c.isDiy)) {
      for (const charId of records.backups.diy.prototypes[c.tier]) {
        const pick = { charId };
        assert.deepEqual(view.diy(c.chessId, pick), diyRecordOf(c, pick, records), `${set?.id || 'default'} ${c.chessId}/${charId}: active DIY`);
      }
    }
    for (const it of Object.values(records.items)) {
      assert.equal(view.item(it.id), it);
      assert.equal(itemIconUrl(manifest, view.item(it.id)), manifest.items[it.iconId], it.name);
    }
    for (const id of Object.keys(records.bonds)) assert.equal(bondIconUrl(manifest, id), manifest.bonds[id]);
    for (const id of Object.keys(records.bands)) assert.equal(bandIconUrl(manifest, id), manifest.bands[id]);
    for (const id of Object.keys(records.enemies)) assert.equal(enemyIconUrl(manifest, id), manifest.enemies[id]?.icon || null);
    for (const id of Object.keys(records.tokens)) {
      assert.equal(view.token(id), records.tokens[id]);
      const t = manifest.tokens[id];
      assert.equal(tokenAvatarUrl(manifest, id), t?.avatar || manifest.chars[t?.owner]?.avatar || null);
    }
    for (const g of Object.values(records.garrisons)) {
      // The chip's icon is the record's own official `eventTypeIcon`; 8 炸惊 特质s ship without one and draw the trigger's
      // icon instead (detailPanel.js EVENT_ICON — the gap test/ui/playtest3.test.js pins), so the audit asks the resolved
      // key to have a sprite rather than the raw field to be non-empty.
      const iconId = garrisonTypeIconKey(g);
      if (/^icon_[a-z]+$/.test(String(g.eventTypeIcon || ''))) assert.equal(iconId, `s_${g.eventTypeIcon}`, g.garrisonId);
      assert.ok(manifest.ui[`garrisonTypeIcon/${iconId}`], `${g.garrisonId}: ${iconId} has no sprite in data/assets.json`);
      assert.equal(effectIconUrl(manifest, { iconKind: 'garrison', iconId }), manifest.ui[`garrisonTypeIcon/${iconId}`]);
    }
    const item = store.lookup('items', 'chess_item_2_07_e_a');
    assert.equal(item.name, set?.id.startsWith('act1') ? '迅捷作战粮' : '见钱眼开玩偶');
  }
  assert.equal(fetched, files.length, 'returning to the default reuses its own original files');

  // A content overlay can replace backups while retaining the same chess objects.
  const changedBackups = structuredClone(originals.backups);
  const source = Object.values(originals.chess).find(c => standInRecord(c, originals.backups));
  const old = view.standIn(source.chessId);
  changedBackups.units[old.charId].name = 'Replacement stand-in';
  store.setContent({ id: 'backups-only', values: { backups: changedBackups } });
  assert.equal(view.standIn(source.chessId).name, 'Replacement stand-in');
  assert.equal(view.standIn(source.chessId), view.standIn(source.chessId), 'unchanged inputs still reuse the composition');
});

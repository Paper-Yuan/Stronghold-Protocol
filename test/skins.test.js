// 皮肤系统专项自动化测试 (docs/SKINS.md & SKINS-BUILTIN-PLAN.md)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { isSkinId, isSkinSelection } from '../shared/protocol.js';
import { mergeSkins, sanitizeSkins, exportPayload, parseImport } from '../public/js/ui/loadoutModel.js';
import { avatarUrl, spineEntry, hasBackSpine } from '../public/js/assets.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const skinsData = JSON.parse(readFileSync(join(ROOT, 'data/skins.json'), 'utf8'));
const assetsData = JSON.parse(readFileSync(join(ROOT, 'data/assets.json'), 'utf8'));

test('全量 174 套皮肤内置元数据覆盖与映射正确', () => {
  const chars = skinsData.chars || {};
  const charKeys = Object.keys(chars);
  assert.equal(charKeys.length, 115, '拥有皮肤的干员数为 115 名');

  let totalSkins = 0;
  for (const [charId, list] of Object.entries(chars)) {
    assert.ok(Array.isArray(list) && list.length > 0, `${charId} 拥有皮肤列表`);
    for (const s of list) {
      totalSkins++;
      assert.ok(isSkinId(s.id), `皮肤 id ${s.id} 满足命名协议规范`);
      assert.ok(typeof s.name === 'string' && s.name.length > 0, `皮肤 ${s.id} 具有名称`);
    }
  }
  assert.equal(totalSkins, 174, '总皮肤数应精准为 174 款');

  // 验证普查出的 6 名无皮肤干员
  const noSkinChars = [
    'char_512_aprot', // 盟约·辅助干员
    'char_1037_sora2', // 雪猎
    'char_4139_cathy', // 凯瑟琳
    'char_1039_titi',  // 缇缇
    'char_1041_silar2', // 凛御银灰
    'char_1042_astgn2', // 溯光星源
  ];
  for (const id of noSkinChars) {
    assert.equal(chars[id], undefined, `未实装皮肤干员 ${id} 不应存在于 skins.json`);
  }
});

test('导入语义增量覆盖 (mergeSkins) 行为正确', () => {
  const current = {
    chess_silverash: 'skin_silverash_1',
    chess_thorns: 'skin_thorns_1',
    chess_eyja: 'skin_eyja_1',
  };

  // 导入仅包含棘刺新皮与塞雷娅皮肤，银灰未提及
  const imported = {
    chess_thorns: 'skin_thorns_summer',
    chess_saria: 'skin_saria_prison',
  };

  const result = mergeSkins(current, imported);

  // 1. 银灰未提及，保留原选择
  assert.equal(result.chess_silverash, 'skin_silverash_1');
  // 2. 棘刺已提及，增量打补丁
  assert.equal(result.chess_thorns, 'skin_thorns_summer');
  // 3. 塞雷娅新增
  assert.equal(result.chess_saria, 'skin_saria_prison');
  // 4. 艾雅法拉未提及，保留原选择
  assert.equal(result.chess_eyja, 'skin_eyja_1');
});

test('导出与导入链路支持 skins 字段且安全隔离', () => {
  const loadout = { chess_char_1_01_a: { skill: 1 } };
  const skins = { chess_char_1_01_a: 'char_002_amiye@epoque#4' };

  const payload = exportPayload(loadout, { skins });
  assert.ok(payload.skins);
  assert.equal(payload.skins.chess_char_1_01_a, 'char_002_amiye@epoque#4');

  const parsed = parseImport(JSON.stringify(payload));
  assert.ok(parsed.ok);
  assert.deepEqual(parsed.entries, loadout);
  assert.deepEqual(parsed.skins, skins);
});

test('Spine 与 Avatar 资源回退：皮肤缺损优雅 fallback 至原皮', () => {
  const manifest = {
    chars: {
      char_demo: {
        avatar: 'art/demo.png',
        spine: { front: { skel: '/art/demo.skel', atlas: '/art/demo.atlas', anims: {} } },
        skins: {
          skin_has_art: {
            avatar: 'art/skin_demo.png',
            spine: { front: { skel: '/art/skin.skel', atlas: '/art/skin.atlas', anims: {} } },
          },
          skin_no_spine: {
            avatar: 'art/skin_no_spine.png',
          },
          skin_broken_spine: {
            avatar: 'art/skin_broken.png',
            spine: { front: { skel: 'https://remote.url/broken.skel' } },
          },
        },
      },
    },
  };

  // 1. 有独立皮肤模型与头像
  assert.equal(avatarUrl(manifest, 'char_demo', { skin: 'skin_has_art' }), 'art/skin_demo.png');
  assert.equal(spineEntry(manifest, 'char_demo', { skin: 'skin_has_art' })?.skel, '/art/skin.skel');

  // 2. 皮肤无独立 spine，回退至原皮 spine
  assert.equal(avatarUrl(manifest, 'char_demo', { skin: 'skin_no_spine' }), 'art/skin_no_spine.png');
  assert.equal(spineEntry(manifest, 'char_demo', { skin: 'skin_no_spine' })?.skel, '/art/demo.skel');

  // 3. 皮肤 spine 格式非法或损坏，优雅 fallback 回退至原皮 spine
  assert.equal(avatarUrl(manifest, 'char_demo', { skin: 'skin_broken_spine' }), 'art/skin_broken.png');
  assert.equal(spineEntry(manifest, 'char_demo', { skin: 'skin_broken_spine' })?.skel, '/art/demo.skel');

  // 4. 皮肤 id 完全不存在，回退至原皮头像与 spine
  assert.equal(avatarUrl(manifest, 'char_demo', { skin: 'skin_not_exist' }), 'art/demo.png');
  assert.equal(spineEntry(manifest, 'char_demo', { skin: 'skin_not_exist' })?.skel, '/art/demo.skel');
});

test('协议层 isSkinId 与 isSkinSelection 防御校验', () => {
  assert.equal(isSkinId('char_002_amiye@epoque#4'), true);
  assert.equal(isSkinId('char_102_texas@summer#1'), true);
  assert.equal(isSkinId('invalid space id'), false);
  assert.equal(isSkinId(''), false);
  assert.equal(isSkinId(null), false);

  assert.equal(isSkinSelection({ chess_amiye: 'char_002_amiye@epoque#4' }), true);
  assert.equal(isSkinSelection({ 'invalid space chess': 'char_002_amiye@epoque#4' }), false);
  assert.equal(isSkinSelection({ chess_amiye: 'invalid space skin' }), false);
  assert.equal(isSkinSelection([]), false);
  assert.equal(isSkinSelection('not obj'), false);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeSettings } from '../../public/js/ui/gameLogic/settings.js';
import { sanitizeVoiceOverrides, voiceLangFor } from '../../public/js/voicePrefs.js';
import { AudioManager, voiceLine } from '../../public/js/audio.js';
const a = 'char_263_skadi', b = 'char_103_angel';
test('old settings migrate to inherit, malformed or prototype entries are discarded', () => {
  assert.deepEqual(sanitizeSettings({ voiceLang: 'jp' }).voiceOverrides, {});
  assert.deepEqual(sanitizeVoiceOverrides(Object.assign(Object.create({ [b]: 'jp' }), { [a]: 'jp', bad: 'cn', char_1_no: 'xx' })), { [a]: 'jp' });
  for (const raw of [null, [], 1, 'jp']) assert.deepEqual(sanitizeVoiceOverrides(raw), {});
});
test('per-character override survives persistence; deletion restores the current global setting', () => {
  const settings = sanitizeSettings(JSON.parse(JSON.stringify({ voiceLang: 'cn', voiceOverrides: { [a]: 'jp', [b]: 'cn' } })));
  const manager = new AudioManager();
  manager.setVoiceLang(settings.voiceLang, settings.voiceOverrides);
  assert.equal(voiceLangFor(a, manager.voiceLang, manager.voiceOverrides), 'jp');
  manager.setVoiceLang('jp');
  assert.equal(voiceLangFor(b, manager.voiceLang, manager.voiceOverrides), 'cn');
  delete settings.voiceOverrides[b];
  manager.setVoiceLang('jp', settings.voiceOverrides);
  assert.equal(voiceLangFor(b, manager.voiceLang, manager.voiceOverrides), 'jp');
  assert.equal(voiceLangFor('unknown', 'cn', manager.voiceOverrides), 'cn');
});
test('the per-operator JP/EN/KR/custom preference retains the existing per-slot Chinese fallback', () => {
  const tree = {
    voice: { [a]: { select: '/cn.mp3' } },
    voiceJp: { [a]: { skill1: '/jp.mp3' } },
    voiceEn: { [a]: { skill2: '/en.mp3' } },
    voiceKr: { [a]: { skill3: '/kr.mp3' } },
    voiceCustom: { [a]: { cn_topolect: { skill4: '/custom.mp3' } } }
  };
  assert.equal(voiceLine(tree, a, 'select', voiceLangFor(a, 'cn', { [a]: 'jp' })).url, '/cn.mp3');
  assert.equal(voiceLine(tree, a, 'skill1', voiceLangFor(a, 'cn', { [a]: 'jp' })).url, '/jp.mp3');
  assert.equal(voiceLine(tree, a, 'skill2', voiceLangFor(a, 'cn', { [a]: 'en' })).url, '/en.mp3');
  assert.equal(voiceLine(tree, a, 'skill3', voiceLangFor(a, 'cn', { [a]: 'kr' })).url, '/kr.mp3');
  assert.equal(voiceLine(tree, a, 'skill4', voiceLangFor(a, 'cn', { [a]: 'custom' })).url, '/custom.mp3');
  // fallback to jp if slot absent in custom (特殊语音没有就用默认日语)
  const treeWithJpSelect = {
    voice: { [a]: { select: '/cn.mp3' } },
    voiceJp: { [a]: { select: '/jp_select.mp3' } },
    voiceCustom: { [a]: { cn_topolect: { skill4: '/custom.mp3' } } }
  };
  assert.equal(voiceLine(treeWithJpSelect, a, 'select', voiceLangFor(a, 'cn', { [a]: 'custom' })).url, '/jp_select.mp3');
});

test('operator skin voice lookup and multilingual matching', () => {
  const tree = {
    voice: { [a]: { select: '/base_cn.mp3' } },
    voiceJp: { [a]: { select: '/base_jp.mp3' } },
    skinVoice: { 'char_263_skadi_epoque#1': { select: '/skin_cn.mp3' } },
    skinVoiceJp: { 'char_263_skadi_epoque#1': { select: '/skin_jp.mp3' } },
  };

  // Without skin -> base voice
  assert.equal(voiceLine(tree, a, 'select', 'cn', Math.random, null).url, '/base_cn.mp3');
  assert.equal(voiceLine(tree, a, 'select', 'jp', Math.random, null).url, '/base_jp.mp3');

  // With skin -> skin voice
  assert.equal(voiceLine(tree, a, 'select', 'cn', Math.random, 'char_263_skadi@epoque#1').url, '/skin_cn.mp3');
  assert.equal(voiceLine(tree, a, 'select', 'jp', Math.random, 'char_263_skadi@epoque#1').url, '/skin_jp.mp3');

  // Special language with skin without custom line -> fallback to skin's jp
  assert.equal(voiceLine(tree, a, 'select', 'custom', Math.random, 'char_263_skadi@epoque#1').url, '/skin_jp.mp3');

  // Unrelated skin -> fallback to base voice
  assert.equal(voiceLine(tree, a, 'select', 'cn', Math.random, 'char_263_skadi@other#1').url, '/base_cn.mp3');
});

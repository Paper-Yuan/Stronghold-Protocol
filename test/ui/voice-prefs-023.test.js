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
  // fallback to cn if slot absent in custom
  assert.equal(voiceLine(tree, a, 'select', voiceLangFor(a, 'cn', { [a]: 'custom' })).url, '/cn.mp3');
});

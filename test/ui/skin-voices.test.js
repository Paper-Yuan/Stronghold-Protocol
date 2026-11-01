// test/ui/skin-voices.test.js — 皮肤专属语音（data/skin-voices.json）在 voiceLine 里的优先级
//
// 一套皮肤带的战斗语音只在该外观穿在身上时播放（audio.js _skinVoice → voiceLine 第 6 个参数）；皮肤没有的槽位
// 仍然说干员自己的台词，绝不变成静音。这里只测纯函数，AudioManager 的接线由 main.js/installAudio 负责。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { voiceLine, AudioManager } from '../../public/js/audio.js';

const audio = {
  voice: {
    char_x: { start: '/a/cn_start.mp3', skill1: '/a/cn_skill1.mp3' },
  },
  voiceJp: {
    char_x: { start: '/a/jp_start.mp3', skill1: '/a/jp_skill1.mp3' },
  },
};
const skin = {
  key: 'char_x_epoque#7',
  voices: {
    cn: { 'char_x_epoque#7': { start: '/s/cn_start.mp3' } },
    jp: { 'char_x_epoque#7': { start: '/s/jp_start.mp3' } },
  },
};

test('the worn outfit’s own line wins over the operator’s', () => {
  assert.deepEqual(voiceLine(audio, 'char_x', 'start', 'cn', () => 0, skin), {
    url: '/s/cn_start.mp3', fallback: '/a/cn_start.mp3',
  });
  // a JP skin line falls back to the operator's Chinese line of the same slot (the manifest's normal voice fallback)
  assert.deepEqual(voiceLine(audio, 'char_x', 'start', 'jp', () => 0, skin), {
    url: '/s/jp_start.mp3', fallback: '/a/cn_start.mp3',
  });
});

test('a slot the outfit has no line for falls back to the operator’s (never silence)', () => {
  assert.deepEqual(voiceLine(audio, 'char_x', 'skill1', 'cn', () => 0, skin), {
    url: '/a/cn_skill1.mp3', fallback: null,
  });
});

test('without a skin, or a skin whose key the data does not list, the operator speaks as before', () => {
  assert.deepEqual(voiceLine(audio, 'char_x', 'start', 'cn', () => 0, null), {
    url: '/a/cn_start.mp3', fallback: null,
  });
  assert.deepEqual(voiceLine(audio, 'char_x', 'start', 'cn', () => 0, { key: 'char_x_other#1', voices: skin.voices }), {
    url: '/a/cn_start.mp3', fallback: null,
  });
});

test('the skin tree only exists for the four base dubs (native falls back)', () => {
  assert.deepEqual(voiceLine(audio, 'char_x', 'start', 'native', () => 0, skin), {
    url: '/a/cn_start.mp3', fallback: null,
  });
});

test('AudioManager._skinVoice maps the worn skinId to the voice word key', () => {
  const am = new AudioManager({
    getSkinVoices: () => skin.voices,
    getSkin: (id) => (id === 'char_x' ? 'char_x@epoque#7' : null),
  });
  assert.deepEqual(am._skinVoice('char_x'), { key: 'char_x_epoque#7', voices: skin.voices });
  assert.equal(am._skinVoice('char_y'), null, 'no worn skin: the operator speaks as before');
  assert.equal(new AudioManager({})._skinVoice('char_x'), null, 'no data installed');
});

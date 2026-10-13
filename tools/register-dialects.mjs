import fs from 'node:fs';
import path from 'node:path';

const ASSETS_PATH = 'data/assets.json';
const assets = JSON.parse(fs.readFileSync(ASSETS_PATH, 'utf8'));
if (!assets.audio) assets.audio = {};
if (!assets.audio.voiceCustom) assets.audio.voiceCustom = {};

const dialects = {
  rus: ['char_196_sunbr', 'char_115_headbr', 'char_405_absin', 'char_195_glassb', 'char_197_poca', 'char_188_helage', 'char_194_leto', 'char_1502_crosly', 'char_4195_radian', 'char_4207_branch', 'char_4208_wintim', 'char_4224_turdus', 'char_4223_botany', 'char_1051_headb2'],
  ger: ['char_4046_ebnhlz', 'char_4047_pianst', 'char_4098_vvana', 'char_4011_lessng'],
  fre: ['char_250_phatom', 'char_1042_phatm2'],
  spa: ['char_401_elysm', 'char_400_weedy', 'char_293_thorns', 'char_4009_irene', 'char_4042_lumen', 'char_1039_thorn2', 'char_4163_rosesa'],
};

const makeSlotMap = (lang, op) => ({
  start: `/assets/audio/voice/${lang}/${op}/cn_001.mp3`,
  faceEnemy: `/assets/audio/voice/${lang}/${op}/cn_002.mp3`,
  select: [
    `/assets/audio/voice/${lang}/${op}/cn_003.mp3`,
    `/assets/audio/voice/${lang}/${op}/cn_004.mp3`
  ],
  place: [
    `/assets/audio/voice/${lang}/${op}/cn_005.mp3`,
    `/assets/audio/voice/${lang}/${op}/cn_006.mp3`
  ],
  skill1: `/assets/audio/voice/${lang}/${op}/cn_007.mp3`,
  skill2: `/assets/audio/voice/${lang}/${op}/cn_008.mp3`,
  skill3: `/assets/audio/voice/${lang}/${op}/cn_009.mp3`,
  skill4: `/assets/audio/voice/${lang}/${op}/cn_010.mp3`,
  resultFour: `/assets/audio/voice/${lang}/${op}/cn_011.mp3`,
  resultThree: `/assets/audio/voice/${lang}/${op}/cn_012.mp3`,
  resultTwo: `/assets/audio/voice/${lang}/${op}/cn_013.mp3`,
  resultLose: `/assets/audio/voice/${lang}/${op}/cn_014.mp3`
});

let updatedCount = 0;
for (const [lang, ops] of Object.entries(dialects)) {
  for (const op of ops) {
    if (!assets.audio.voiceCustom[op]) assets.audio.voiceCustom[op] = {};
    assets.audio.voiceCustom[op][lang] = makeSlotMap(lang, op);
    if (!assets.audio.voiceCustom[op].special) {
      assets.audio.voiceCustom[op].special = makeSlotMap(lang, op);
    }
    updatedCount++;
  }
}

fs.writeFileSync(ASSETS_PATH, JSON.stringify(assets, null, 2), 'utf8');
console.log(`Registered ${updatedCount} operator dialect trees in ${ASSETS_PATH}`);

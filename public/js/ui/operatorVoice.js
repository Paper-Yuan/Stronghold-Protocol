// Local listening preference, shared by roster and DIY details; deliberately absent from room.loadout.
import { html } from './components.js';
import { useSettings, updateSettings } from './settings.js';
import { t } from '../../../shared/i18n.js';

const VOICE_LANG_NAMES = { cn: '中文', jp: '日本語', en: 'English', kr: '한국어' }; // i18n-ignore

export const CUSTOM_DIALECT_NAMES = {
  cn_topolect: '方言（汉语方言）',
  ita: '意大利语（叙拉古语）',
  rus: '俄语（乌萨斯语）',
  ger: '德语（莱塔尼亚语）',
  fre: '法语（高卢语）',
  spa: '西班牙语（伊比利亚语）',
};

export const OPERATOR_CUSTOM_DIALECTS = {
  // 汉语方言 (CN_TOPOLECT)
  char_010_chen: 'cn_topolect',
  char_1013_chen2: 'cn_topolect',
  char_1050_chen3: 'cn_topolect',
  char_1033_swire2: 'cn_topolect',
  char_308_swire: 'cn_topolect',
  char_1044_hsgma2: 'cn_topolect',
  char_136_hsguma: 'cn_topolect',
  char_2014_nian: 'cn_topolect',
  char_2015_dusk: 'cn_topolect',
  char_2023_ling: 'cn_topolect',
  char_2024_chyue: 'cn_topolect',
  char_2025_shu: 'cn_topolect',
  char_2026_yu: 'cn_topolect',
  char_2027_wang: 'cn_topolect',
  char_225_haak: 'cn_topolect',
  char_322_lmlee: 'cn_topolect',
  char_4080_lin: 'cn_topolect',
  char_4121_zuole: 'cn_topolect',
  char_473_mberry: 'cn_topolect',
  char_226_hmau: 'cn_topolect',
  char_243_waaifu: 'cn_topolect',
  char_455_nothin: 'cn_topolect',
  char_383_snsant: 'cn_topolect',
  char_241_panda: 'cn_topolect',

  // 叙拉古语 / 意大利语 (ITA)
  char_102_texas: 'ita',
  char_1028_texas2: 'ita',
  char_140_whitew: 'ita',
  char_1038_whitw2: 'ita',
  char_427_vigil: 'ita',
  char_4065_judge: 'ita',
  char_4026_vulpis: 'ita',
  char_4037_demetr: 'ita',
  char_4155_talr: 'ita',

  // 乌萨斯语 / 俄语 (RUS)
  char_115_headbr: 'rus',
  char_1051_headb2: 'rus',
  char_188_helage: 'rus',
  char_194_leto: 'rus',
  char_195_glassb: 'rus',
  char_196_sunbr: 'rus',
  char_197_poca: 'rus',
  char_405_absin: 'rus',
  char_1502_crosly: 'rus',
  char_4195_radian: 'rus',
  char_4207_branch: 'rus',
  char_4208_wintim: 'rus',
  char_4223_botany: 'rus',
  char_4224_turdus: 'rus',

  // 莱塔尼亚语 / 德语 (GER)
  char_4011_lessng: 'ger',
  char_4046_ebnhlz: 'ger',
  char_4047_pianst: 'ger',
  char_4098_vvana: 'ger',

  // 高卢语 / 法语 (FRE)
  char_250_phatom: 'fre',
  char_1042_phatm2: 'fre',

  // 伊比利亚语 / 西班牙语 (SPA)
  char_293_thorns: 'spa',
  char_1039_thorn2: 'spa',
  char_400_weedy: 'spa',
  char_401_elysm: 'spa',
  char_4009_irene: 'spa',
  char_4042_lumen: 'spa',
  char_4163_rosesa: 'spa',
};

export function OperatorVoice({ charId }) {
  const settings = useSettings();
  if (!charId) return null;
  const value = settings.voiceOverrides[charId] || '';
  const change = (lang) => {
    const voiceOverrides = { ...settings.voiceOverrides };
    if (lang) voiceOverrides[charId] = lang;
    else delete voiceOverrides[charId];
    updateSettings({ voiceOverrides });
  };

  const customKey = OPERATOR_CUSTOM_DIALECTS[charId] || null;
  const customLabel = customKey ? (CUSTOM_DIALECT_NAMES[customKey] || customKey) : null;

  return html`<label class="lo-voice" data-voice-char=${charId}>
    <span>${t('此干员语音')}</span>
    <span class="lo-select"><select aria-label=${t('此干员语音')} value=${value} onChange=${(e) => change(e.currentTarget.value)}>
      <option value="">${t('跟随全局')}</option>
      <option value="cn">${VOICE_LANG_NAMES.cn}</option>
      <option value="jp">${VOICE_LANG_NAMES.jp}</option>
      <option value="en">${VOICE_LANG_NAMES.en}</option>
      <option value="kr">${VOICE_LANG_NAMES.kr}</option>
      ${customLabel ? html`<option value="custom">${customLabel}</option>` : null}
    </select></span>
    <small>${t('仅保存在此浏览器，缺失的语音会回退到中文。')}</small>
  </label>`;
}

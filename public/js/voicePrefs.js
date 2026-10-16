/** The four dubs every release ships a folder for (audio.voiceCn / voiceJp / voiceEn / voiceKr). Not 自定义: that is a
 *  mode, not a dub — it plays whatever the operator's character record carries (ui/operatorVoice.js OPERATOR_CUSTOM_DIALECTS). */
export const VOICE_LANGS = Object.freeze(['cn', 'jp', 'en', 'kr']);
/** The 自定义 global mode. */
export const VOICE_CUSTOM = 'custom';
/** What the global 语音语言 setting may be: the four dubs plus 自定义 (ui/settings.js shows exactly these five buttons). */
export const VOICE_GLOBAL_LANGS = Object.freeze([...VOICE_LANGS, VOICE_CUSTOM]);
/** Per-operator 特色语音 (the character's own dialect): chosen per operator, never a global. */
export const DIALECT_LANGS = Object.freeze(['cn_topolect', 'ita', 'rus', 'ger', 'fre', 'spa']);
/** Every value a per-operator override may carry (the globals, 自定义, and the dialects). */
const OVERRIDE_LANGS = Object.freeze([...VOICE_GLOBAL_LANGS, ...DIALECT_LANGS]);
/** The dubs named in their own language (ui/settings.js and ui/operatorVoice.js render these). */
export const VOICE_LANG_NAMES = Object.freeze({ cn: '中文', jp: '日本語', en: 'English', kr: '한국어', custom: '自定义' }); // i18n-ignore
/** The global a fresh install starts on (the owner's 2026-10-13 decision; upstream defaults to 中文). */
export const DEFAULT_VOICE_LANG = 'jp';

export function sanitizeVoiceOverrides(raw) {
  const out = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  const allAllowed = OVERRIDE_LANGS;
  for (const [id, lang] of Object.entries(raw).slice(0, 512)) {
    if (/^char_[0-9]+_[a-z0-9]+$/.test(id) && id.length <= 80 && allAllowed.includes(lang)) out[id] = lang;
  }
  return out;
}

export function voiceLangFor(charId, globalLang, overrides) {
  const own = Object.hasOwn(overrides || {}, charId) ? overrides[charId] : null;
  if (own && OVERRIDE_LANGS.includes(own)) return own;
  return VOICE_GLOBAL_LANGS.includes(globalLang) ? globalLang : DEFAULT_VOICE_LANG;
}


export const VOICE_LANGS = Object.freeze(['cn', 'jp', 'en', 'kr', 'custom']);
export const DIALECT_LANGS = Object.freeze(['cn_topolect', 'ita', 'rus', 'ger', 'fre', 'spa']);

export function sanitizeVoiceOverrides(raw) {
  const out = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  const allAllowed = [...VOICE_LANGS, ...DIALECT_LANGS];
  for (const [id, lang] of Object.entries(raw).slice(0, 512)) {
    if (/^char_[0-9]+_[a-z0-9]+$/.test(id) && id.length <= 80 && allAllowed.includes(lang)) out[id] = lang;
  }
  return out;
}

export function voiceLangFor(charId, globalLang, overrides) {
  const own = Object.hasOwn(overrides || {}, charId) ? overrides[charId] : null;
  const allAllowed = [...VOICE_LANGS, ...DIALECT_LANGS];
  if (own && allAllowed.includes(own) && own !== 'custom') {
    return own;
  }
  if (globalLang === 'custom') {
    return 'jp'; // custom mode defaults to jp for non-overridden operators
  }
  return (VOICE_LANGS.includes(globalLang) && globalLang !== 'custom') ? globalLang : 'jp';
}


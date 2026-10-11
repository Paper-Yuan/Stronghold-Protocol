// public/js/voicePrefs.js — 每干员语音语言（browser-local dub preferences）。
//
// 上游 v0.2.3 的做法：一条全局语音语言（settings.voiceLang）+ 一张按干员覆盖的表（settings.voiceOverrides）。
// 覆盖以 **charId** 为键（一个干员的每个变体/精英形态共用同一个 charId，见 shared/standIn.js 与 data/chess.json 的
// charId），缺省条目跟随全局。本分支的默认全局语言是 **日语**（docs/GLOBAL_VOICE_TRI_UI_ENDLESS_PLAN.md 的决策 D1，
// 与上游默认 cn 的唯一有意分歧）；日语缺失的台词回退到中文（audio.js 的解析链）。
//
// 存储：随 settings 一起落在 localStorage `sp.pref.settings`（ui/gameLogic/settings.js 的 sanitizeSettings），
// 刻意**不进 wire 协议**（不随 room.loadout 上行，见 docs/GLOBAL_VOICE_TRI_UI_ENDLESS_PLAN.md）——这是本机偏好。

/** 语音语言白名单。顺序即设置页与干员调配里选择器的展示顺序。 */
export const VOICE_LANGS = Object.freeze(['cn', 'jp', 'en', 'kr']);

/**
 * 默认语音语言 = **日语**（维护者 2026-10-11 的要求，也是本分支与上游的唯一有意分歧：上游默认 cn）。
 * 全局设置缺失或非法时回退到它；`DEFAULT_SETTINGS.voiceLang` 与它保持一致。
 */
export const DEFAULT_VOICE_LANG = 'jp';

/**
 * 特色语音（dump 的 voice_custom）：不占全局语言位，按干员挂——只有该干员有这条树时才出现在它的选择器里。
 * 类型名来自 dump 目录后缀：_cn_topolect = 中文方言、_ita = 意大利语、无后缀 = 其它特殊语音。
 */
export const VOICE_CUSTOM_KINDS = Object.freeze({ cn_topolect: '中文方言', ita: 'Italiano', special: '特殊语音' });

/** 语言显示名（设置页与语音选择器共用；i18n-ignore —— 语言名按原文显示）。 */
export const VOICE_LANG_NAMES = Object.freeze({ cn: '中文', jp: '日本語', en: 'English', kr: '한국어' });

/** 覆盖表的上限与 charId 形状（与 shared/standIn.js / data/chess.json 的 charId 一致）。 */
const VOICE_OVERRIDE_MAX = 512;
const CHAR_ID_RE = /^char_[0-9]+_[a-z0-9]+$/;

/**
 * 清洗持久化的每干员覆盖表：只留 charId 形状合法且语言在白名单里的条目，最多 512 条。
 * @param {any} raw
 * @returns {Record<string, 'cn'|'jp'|'en'|'kr'>}
 */
export function sanitizeVoiceOverrides(raw) {
  const out = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  for (const [id, lang] of Object.entries(raw).slice(0, VOICE_OVERRIDE_MAX)) {
    if (id.length <= 80 && CHAR_ID_RE.test(id) && (VOICE_LANGS.includes(lang) || lang in VOICE_CUSTOM_KINDS)) out[id] = lang;
  }
  return out;
}

/**
 * 某干员实际使用的语音语言：有覆盖用覆盖，否则跟随全局（全局非 jp 时归一为 cn）。
 * @param {string} charId
 * @param {'cn'|'jp'|'en'|'kr'} globalLang
 * @param {Record<string, 'cn'|'jp'|'en'|'kr'>} [overrides]
 * @returns {'cn'|'jp'|'en'|'kr'}
 */
export function voiceLangFor(charId, globalLang, overrides) {
  const ov = overrides && typeof overrides === 'object' ? overrides : null;
  const own = ov && Object.prototype.hasOwnProperty.call(ov, charId) ? ov[charId] : null;
  if (VOICE_LANGS.includes(own) || own in VOICE_CUSTOM_KINDS) return own;
  return VOICE_LANGS.includes(globalLang) ? globalLang : DEFAULT_VOICE_LANG;
}

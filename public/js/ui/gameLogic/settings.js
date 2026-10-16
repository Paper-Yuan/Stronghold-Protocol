// ui/gameLogic/settings.js — settings defaults and sanitising. Re-exported from ../gameLogic.js.

import { VOICE_GLOBAL_LANGS, DEFAULT_VOICE_LANG, sanitizeVoiceOverrides } from '../../voicePrefs.js';
export { VOICE_LANGS } from '../../voicePrefs.js';


import { clamp, isObj } from './shared.js';
import { DEFAULT_HOTKEYS, sanitizeHotkeys } from './shortcuts.js';


// ---- settings ------------------------------------------------------------------------------------------------------

/**
 * The operator voice dubs (settings 语音语言): 'cn' 中文 (`audio.voice`, the default) and 'jp' 日本語 (`audio.voiceJp`,
 * falling back to the Chinese line it lacks — public/js/audio.js voiceLine). Not tied to the interface language.
 */


/**
 * The steps of 设置 →「文字大小」 (textSize): the interface text root `--t` of css/theme.css — 'sm' is the design's own
 * sizes (`--t: 1rem`), the others lift the phone's 40 px root by a floor and grow the desktop gently. Text only: the
 * layout root `1rem` (and with it the field camera, the detail card's side and the DOM fallback board) never moves.
 */
export const TEXT_SIZES = Object.freeze(['sm', 'md', 'lg', 'xl']);
export const TARGET_FPS_OPTIONS = Object.freeze(['30', '60', '120', 'screen']);

/** keys: the in-match shortcuts' key map (ui/gameLogic/shortcuts.js; settings → 快捷键). voiceLang: VOICE_LANGS.
 *  textSize: TEXT_SIZES (css/theme.css `--t`, applied by ui/settings.js applyTextSize). ammoCount: 设置「弹药数量」 — the
 *  rounds left / the magazine under an ammo skill's bar (render/units.js; PR #552), off by default: the official HUD has no
 *  such number (the maintainer's decision of 2026-10-13). targetFps: 30 / 60 / 120 / screen (Pacer). */
const isMobileClient = typeof navigator !== 'undefined' && (/Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && !globalThis.matchMedia?.('(pointer: fine)').matches));
export const DEFAULT_SETTINGS = Object.freeze({ bgm: 0.6, sfx: 0.8, voice: 0.8, voiceLang: DEFAULT_VOICE_LANG, voiceOverrides: Object.freeze({}), muted: false, damageNumbers: true, officialDamageNumbers: false, ammoCount: false, mapBrightness: 1.1, colorWarmth: 1.0, quality: 'high', antialias: !isMobileClient, perfLite: false, unequip: false, textSize: 'sm', targetFps: '60', board: '3d', keys: DEFAULT_HOTKEYS });
const QUALITIES = ['extreme', 'high', 'medium', 'low'];

/**
 * Sanitize persisted settings.
 * @param {any} raw
 * @returns {{ bgm: number, sfx: number, voice: number, voiceLang: 'cn'|'jp', voiceOverrides: Record<string, string>, muted: boolean, damageNumbers: boolean, officialDamageNumbers: boolean, ammoCount: boolean, mapBrightness: number, colorWarmth: number, quality: 'extreme'|'high'|'medium'|'low', antialias: boolean,
 *   perfLite: boolean, unequip: boolean, textSize: 'sm'|'md'|'lg'|'xl', targetFps: '30'|'60'|'120'|'screen', keys: Record<'refresh'|'freeze'|'levelUp'|'retreat'|'sell'|'ready', string> }}
 */
export function sanitizeSettings(raw) {
  const r = isObj(raw) ? raw : {};
  const vol = (v, d) => (Number.isFinite(v) ? clamp(Math.round(v * 100) / 100, 0, 1) : d);
  return {
    bgm: vol(r.bgm, DEFAULT_SETTINGS.bgm),
    sfx: vol(r.sfx, DEFAULT_SETTINGS.sfx),
    voice: vol(r.voice, DEFAULT_SETTINGS.voice),
    voiceLang: VOICE_GLOBAL_LANGS.includes(r.voiceLang) ? r.voiceLang : DEFAULT_SETTINGS.voiceLang,
    voiceOverrides: sanitizeVoiceOverrides(r.voiceOverrides),
    muted: typeof r.muted === 'boolean' ? r.muted : DEFAULT_SETTINGS.muted,
    damageNumbers: typeof r.damageNumbers === 'boolean' ? r.damageNumbers : DEFAULT_SETTINGS.damageNumbers,
    officialDamageNumbers: typeof r.officialDamageNumbers === 'boolean' ? r.officialDamageNumbers : false,
    ammoCount: typeof r.ammoCount === 'boolean' ? r.ammoCount : DEFAULT_SETTINGS.ammoCount,
    mapBrightness: Number.isFinite(r.mapBrightness) ? clamp(Math.round(r.mapBrightness * 100) / 100, 0.5, 2.0) : DEFAULT_SETTINGS.mapBrightness,
    colorWarmth: Number.isFinite(r.colorWarmth) ? clamp(Math.round(r.colorWarmth * 100) / 100, 0.6, 1.4) : DEFAULT_SETTINGS.colorWarmth,
    quality: QUALITIES.includes(r.quality) ? r.quality : DEFAULT_SETTINGS.quality,
    antialias: typeof r.antialias === 'boolean' ? r.antialias : DEFAULT_SETTINGS.antialias,
    perfLite: typeof r.perfLite === 'boolean' ? r.perfLite : DEFAULT_SETTINGS.perfLite,
    unequip: typeof r.unequip === 'boolean' ? r.unequip : DEFAULT_SETTINGS.unequip,
    textSize: TEXT_SIZES.includes(r.textSize) ? r.textSize : DEFAULT_SETTINGS.textSize,
    targetFps: TARGET_FPS_OPTIONS.includes(String(r.targetFps)) ? String(r.targetFps) : DEFAULT_SETTINGS.targetFps,
    board: ['3d_pro', '3d_std', '3d', '2d', 'auto'].includes(r.board) ? r.board : DEFAULT_SETTINGS.board,
    keys: sanitizeHotkeys(r.keys),
  };
}

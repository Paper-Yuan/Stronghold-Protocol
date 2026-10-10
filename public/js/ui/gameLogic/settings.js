// ui/gameLogic/settings.js — settings defaults and sanitising. Re-exported from ../gameLogic.js.

import { clamp, isObj } from './shared.js';
import { DEFAULT_HOTKEYS, sanitizeHotkeys } from './shortcuts.js';
import { VOICE_LANGS, sanitizeVoiceOverrides } from '../../voicePrefs.js';

export { VOICE_LANGS, VOICE_LANG_NAMES } from '../../voicePrefs.js';


// ---- settings ------------------------------------------------------------------------------------------------------

/** keys: the in-match shortcuts' key map (ui/gameLogic/shortcuts.js; settings → 快捷键).
 *  voiceLang: the global dub language (default 日语, our one deliberate divergence from upstream's cn);
 *  voiceOverrides: the per-operator language map (voicePrefs.js), kept out of the wire protocol. */
// TEXT_SIZES: the four text sizes (upstream 0.2.3 #435); css/theme.css --t, applied by ui/settings.js applyTextSize.
export const TEXT_SIZES = Object.freeze(['sm', 'md', 'lg', 'xl']);

export const DEFAULT_SETTINGS = Object.freeze({ bgm: 0.6, sfx: 0.8, voice: 0.8, voiceLang: 'jp', voiceOverrides: Object.freeze({}), muted: false, damageNumbers: true, quality: 'high', highRefresh: true, board: 'auto', keys: DEFAULT_HOTKEYS });
const QUALITIES = ['high', 'medium', 'low'];
const BOARDS = ['auto', '3d', '2d'];

/**
 * Sanitize persisted settings.
 * @param {any} raw
 * @returns {{ bgm: number, sfx: number, voice: number, voiceLang: 'jp'|'cn', voiceOverrides: Record<string, 'jp'|'cn'>, muted: boolean, damageNumbers: boolean, quality: 'high'|'medium'|'low', board: 'auto'|'3d'|'2d',
 *   keys: Record<'refresh'|'freeze'|'levelUp'|'retreat'|'sell'|'ready', string> }}
 */
export function sanitizeSettings(raw) {
  const r = isObj(raw) ? raw : {};
  const vol = (v, d) => (Number.isFinite(v) ? clamp(Math.round(v * 100) / 100, 0, 1) : d);
  const voiceLang = VOICE_LANGS.includes(r.voiceLang) ? r.voiceLang : DEFAULT_SETTINGS.voiceLang;
  return {
    bgm: vol(r.bgm, DEFAULT_SETTINGS.bgm),
    sfx: vol(r.sfx, DEFAULT_SETTINGS.sfx),
    voice: vol(r.voice, DEFAULT_SETTINGS.voice),
    voiceLang,
    voiceOverrides: sanitizeVoiceOverrides(r.voiceOverrides),
    muted: typeof r.muted === 'boolean' ? r.muted : DEFAULT_SETTINGS.muted,
    damageNumbers: typeof r.damageNumbers === 'boolean' ? r.damageNumbers : DEFAULT_SETTINGS.damageNumbers,
    quality: QUALITIES.includes(r.quality) ? r.quality : DEFAULT_SETTINGS.quality,
    highRefresh: typeof r.highRefresh === 'boolean' ? r.highRefresh : DEFAULT_SETTINGS.highRefresh,
    board: BOARDS.includes(r.board) ? r.board : DEFAULT_SETTINGS.board,
    keys: sanitizeHotkeys(r.keys),
  };
}

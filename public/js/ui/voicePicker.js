// Per-operator voice picker (roster / DIY details → 此干员语音): the mobile-capable successor of
// ui/operatorVoice.js. A fine pointer gets a native select; a coarse one gets a whole-row button that opens a
// bottom sheet of --tap-min rows (a native select inside a scrolling panel is unusable on a phone, and the
// 44 px row is the tap target devices.css guarantees). The view is pure: the caller owns the settings store
// (ui/operatorVoice.js wires updateSettings), so a test can call it directly and walk the vnode tree.
import { html } from './components.js';
import { t } from '../../../shared/i18n.js';
import { VOICE_LANGS, VOICE_LANG_NAMES, DEFAULT_VOICE_LANG } from '../voicePrefs.js';

/** The name a dub is shown under (its own language, like the interface switch in ui/lang.js). */
const langName = (id) => VOICE_LANG_NAMES[id] || id;

/**
 * The picker's rows: 跟随全局 first (its subtitle names the global), then every dub in VOICE_LANGS order.
 * The first row's value is '' — the same empty value the select and the sheet send for "no override".
 * @param {string} [globalLang] the settings' 语音语言
 * @returns {{ value: string, label: string, sub?: string }[]}
 */
export function voiceOptions(globalLang) {
  const g = VOICE_LANGS.includes(globalLang) ? globalLang : DEFAULT_VOICE_LANG;
  return [
    { value: '', label: t('跟随全局'), sub: t('当前全局：{lang}', { lang: langName(g) }) },
    ...VOICE_LANGS.map((id) => ({ value: id, label: langName(id) })),
  ];
}

/**
 * @param {{ charId: string, globalLang?: string, own?: string, effective?: string, coarse?: boolean,
 *   desktop?: boolean, open?: boolean, onPick?: (lang: string) => void, onOpen?: () => void,
 *   onClose?: () => void }} props
 *   `own`: this operator's stored override ('' = follow the global); `effective`: the language actually played
 *   (voicePrefs.voiceLangFor, so a missing dub is visible instead of silent); `desktop` wins over `coarse`
 *   (a touchscreen laptop keeps the select); `open` only means anything on a coarse pointer.
 * @returns {any} the vnode, or null for a record without a charId (a 自选 / PRESET slot).
 */
export function VoiceView({ charId, globalLang = DEFAULT_VOICE_LANG, own = '', effective = '', coarse = false, desktop = false, open = false, onPick, onOpen, onClose } = {}) {
  if (!charId) return null;
  const opts = voiceOptions(globalLang);
  // The fallback is shown, not silent: a missing dub still plays the global / 中文, and the row says which.
  const hint = own
    ? `${t('此干员单独设置')} · ${t('实际使用：{lang}', { lang: langName(effective || own) })}`
    : t('跟随全局（{lang}）', { lang: langName(globalLang) });

  if (desktop || !coarse) {
    return html`<div class="lo-voice-section" data-testid="voice-section" data-voice-char=${charId}>
      <label class="lo-voice">
        <span>${t('此干员语音')}</span>
        <span class="lo-select"><select aria-label=${t('此干员语音')} data-voice-select=${''} value=${own}
            onChange=${(e) => onPick?.(e.currentTarget.value)}>
          ${opts.map((o) => html`<option key=${o.value || 'global'} value=${o.value}>${o.label}</option>`)}
        </select></span>
        <small>${hint}</small>
      </label>
    </div>`;
  }

  return html`<div class="lo-voice-section" data-testid="voice-section" data-voice-char=${charId}>
    <button type="button" class="lo-voice__pick" data-voice-open=${''} aria-expanded=${open ? 'true' : 'false'}
        onClick=${() => (open ? onClose?.() : onOpen?.())}>
      <span>${t('此干员语音')}</span>
      <span class="lo-voice__value">${own ? langName(own) : t('跟随全局')}</span>
    </button>
    <small>${hint}</small>
    ${open ? html`<div class="lo-sheet" data-voice-sheet=${''} role="dialog" aria-modal="true" aria-label=${t('此干员语音')}>
      <div class="lo-sheet__list">
        ${opts.map((o) => html`<button key=${o.value || 'global'} type="button" class="lo-sheet__opt"
            data-voice-opt=${o.value || 'global'} aria-selected=${String((own || '') === o.value)}
            onClick=${() => onPick?.(o.value)}>
          <span class="lo-sheet__name">${o.label}</span>
          ${o.sub ? html`<span class="lo-sheet__sub">${o.sub}</span>` : null}
        </button>`)}
      </div>
    </div>` : null}
  </div>`;
}

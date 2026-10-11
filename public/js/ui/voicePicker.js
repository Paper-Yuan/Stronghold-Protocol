// public/js/ui/voicePicker.js — 干员调配详情面板里的「此干员语音」语言切换（数据模型见 public/js/voicePrefs.js）。
//
// 一条全局语言（设置 → 语音语言，默认**日语**）加一张按干员的覆盖表；这里只改覆盖表，
// 存储随 settings 落在 localStorage `sp.pref.settings`，刻意不进 wire 协议（本机偏好）。
//
// 双端适配（硬规则：device.js 特性类，绝不用 UA 或宽度）：
//   * 桌面（sp-hover 且非 sp-coarse）：原生 <select>，沿用本屏既有的 .lo-select 样式，一行放下；
//     桌面绝不渲染 .lo-sheet 底部弹层（desktop.css 的 D 分段再压一道 display:none 作双保险）
//   * 手机（sp-coarse）：整行按钮 → 底部弹出的大按钮列表，每行 ≥44px 命中区（--tap-min）
// 这是本屏第一个「底部弹出」控件（计划 GLOBAL_VOICE_TRI_UI_ENDLESS_PLAN §P3 要求逐步替换所有下拉）；
// 结构上做成 .lo-sheet* 以便日后抽成通用组件（同屏的盟约筛选 select 是下一个候选）。
//
// 拆分同本仓惯例：VoiceSection 只做接线（读 settings / 平台特性 / 开关状态），VoiceView 是纯视图，测试直接调它。

import { useEffect, useState } from '../../vendor/hooks.module.js';
import { html, Icon, MicroLabel } from './components.js';
import { useSettings, updateSettings } from './settings.js';
import { detectFeatures } from './device.js';
import { VOICE_LANGS, VOICE_LANG_NAMES, VOICE_CUSTOM_KINDS, voiceLangFor } from '../voicePrefs.js';
import { data } from '../data.js';

const cx = (...p) => p.flat().filter(Boolean).join(' ');
const nameOf = (lang) => VOICE_LANG_NAMES[lang] || VOICE_CUSTOM_KINDS[lang] || lang;

/**
 * 选择器的选项：跟随全局 + 每个语言 + 该干员自己的特色语音（dump 的 voice_custom：方言 / 意大利语 / 其它）。
 * `value` 空串 = 跟随全局（覆盖表里不留条目）。`custom` = 该干员有的特色语音类型（如 ['cn_topolect']）。
 */
export const voiceOptions = (globalLang, custom = []) => [
  { value: '', label: '跟随全局', sub: `当前全局：${nameOf(globalLang)}` },
  ...VOICE_LANGS.map((id) => ({ value: id, label: nameOf(id), sub: id === 'jp' ? '日语配音（默认）' : `${nameOf(id)}配音` })),
  ...custom.map((kind) => ({ value: kind, label: nameOf(kind), sub: '特色语音' })),
];

/**
 * 纯视图（无 hooks）——干员调配详情面板的「语音」子页。
 * `desktop`（hover 且非 coarse，与 html.sp-hover:not(.sp-coarse) 同义）时强制原生 <select>；
 * 仅 `coarse` 才允许底部弹层。两个标记都由接线层 VoiceSection 从 detectFeatures() 算出。
 * @param {{ charId: string, globalLang: 'cn'|'jp', own: ''|'cn'|'jp', effective: 'cn'|'jp',
 *   coarse: boolean, desktop?: boolean,
 *   open: boolean, onPick: (lang: string) => void, onOpen: () => void, onClose: () => void }} p
 */
export function VoiceView({ charId, globalLang, own, effective, coarse, desktop, open, onPick, onOpen, onClose, custom = [] }) {
  if (!charId) return null;
  const opts = voiceOptions(globalLang, custom);
  const current = own ? nameOf(own) : '跟随全局';
  // 底部弹层只在手机（coarse）出现；desktop 显式为 true 时无论 coarse 如何都锁死原生 select，
  // 防止触屏笔记本（hover+coarse 并存）之类环境漏出 iOS 底部弹层。
  const sheetMode = !!coarse && desktop !== true;
  return html`<section class="lo-sec lo-sec--voice" data-testid="voice-section" data-voice-char=${charId}>
    <header class="lo-sec__head">
      <h3><${Icon} name="mic" size="sm" class="lo-sec__icon" />语音<${MicroLabel}>VOICE<//></h3>
      <span class="lo-sec__note">${own ? '此干员单独设置' : '跟随全局'}</span>
    </header>
    <div class="lo-voice">
      <span class="lo-voice__label">此干员语音</span>
      ${sheetMode ? html`
        <button type="button" class="lo-voice__pick" data-voice-open aria-haspopup="listbox" aria-expanded=${open ? 'true' : 'false'}
          onClick=${onOpen}>
          <span class="lo-voice__val">
            <b>${current}</b>
            <span class="lo-voice__eff">${`实际使用：${nameOf(effective)}`}</span>
          </span>
          <${Icon} name="chevronRight" size="sm" />
        </button>
      ` : html`
        <span class="lo-select lo-voice__select">
          <select value=${own} aria-label="此干员语音" data-voice-select onChange=${(e) => onPick(e.currentTarget.value)}>
            ${opts.map((o) => html`<option key=${o.value || 'global'} value=${o.value}>${o.value ? o.label : `${o.label}（${nameOf(globalLang)}）`}</option>`)}
          </select>
        </span>
      `}
      <small class="lo-voice__note">仅保存在此浏览器；缺失的日语语音会回退到中文。</small>
    </div>
    ${open && sheetMode ? html`
      <div class="lo-sheet" role="dialog" aria-modal="true" aria-label="此干员语音" data-voice-sheet>
        <div class="lo-sheet__backdrop" onClick=${onClose}></div>
        <div class="lo-sheet__panel">
          <header class="lo-sheet__head">
            <b>此干员语音</b>
            <button type="button" class="lo-sheet__close" aria-label="关闭" onClick=${onClose}><${Icon} name="close" size="sm" /></button>
          </header>
          <div class="lo-sheet__list" role="listbox" aria-label="此干员语音">
            ${opts.map((o) => html`
              <button key=${o.value || 'global'} type="button" role="option" data-voice-opt=${o.value || 'global'}
                aria-selected=${o.value === own ? 'true' : 'false'}
                class=${cx('lo-sheet__opt', o.value === own && 'is-on')}
                onClick=${() => onPick(o.value)}>
                <span class="lo-sheet__opt-name">${o.label}</span>
                <span class="lo-sheet__opt-sub">${o.sub}</span>
                ${o.value === own ? html`<${Icon} name="check" size="sm" class="lo-sheet__opt-mark" />` : null}
              </button>`)}
          </div>
        </div>
      </div>
    ` : null}
  </section>`;
}

/**
 * 「此干员语音」区块（接线）——挂在干员调配详情面板的 body 里（`loadout.js` 的 Detail，语音子页）。
 * @param {{ chess: any }} props `chess` = 详情面板当前的棋子记录（用它的 charId 作覆盖键）
 */
export function VoiceSection({ chess }) {
  const s = useSettings();
  const [open, setOpen] = useState(false);
  const feats = detectFeatures();
  const coarse = feats.coarse;
  // 桌面 = 可 hover 且非粗指针，与 desktop.css 的 html.sp-hover:not(.sp-coarse) 前缀同义；
  // 触屏笔记本这类 hover+coarse 并存的环境也算桌面，避免漏出 iOS 底部弹层。
  const desktop = !!feats.hover && !feats.coarse;
  const charId = chess && typeof chess.charId === 'string' ? chess.charId : '';

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    globalThis.addEventListener?.('keydown', onKey);
    return () => globalThis.removeEventListener?.('keydown', onKey);
  }, [open]);

  const overrides = s.voiceOverrides && typeof s.voiceOverrides === 'object' ? s.voiceOverrides : {};
  // 特色语音也允许作为覆盖值（只有该干员有这条树时才会出现在选项里）
  const own = VOICE_LANGS.includes(overrides[charId]) || overrides[charId] in VOICE_CUSTOM_KINDS ? overrides[charId] : '';
  const pick = (lang) => {
    const next = { ...overrides };
    if (lang) next[charId] = lang;
    else delete next[charId];
    updateSettings({ voiceOverrides: next });
    setOpen(false);
  };

  return VoiceView({
    charId,
    globalLang: s.voiceLang,
    own,
    effective: voiceLangFor(charId, s.voiceLang, overrides),
    custom: Object.keys(data.get('assets')?.audio?.voiceCustom?.[charId] || {}),
    coarse,
    desktop,
    open,
    onPick: pick,
    onOpen: () => setOpen(true),
    onClose: () => setOpen(false),
  });
}

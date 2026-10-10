// Player settings (BGM/SFX/voice volume, mute, damage numbers, render quality): a tiny observable store
// persisted in localStorage (`sp.pref.settings`), applied to the audio manager on every change, plus
// the settings modal.

import { useState } from '../../vendor/hooks.module.js';
import { html, Modal, Button, Icon, MicroLabel } from './components.js';
import { createStore, useStore, loadPref, savePref } from '../store.js';
import { sanitizeSettings, hotkeyLabel, VOICE_LANGS, VOICE_LANG_NAMES } from './gameLogic.js';
import { audio } from '../audio.js';
import { openGuide } from './guide.js';
import { detectFeatures } from './device.js';

const initialPref = sanitizeSettings(loadPref('settings', null));
if (typeof globalThis.AndroidNative?.isHighRefresh === 'function') {
  initialPref.highRefresh = globalThis.AndroidNative.isHighRefresh();
}

/** Settings store: { bgm, sfx, voice, muted, damageNumbers, quality, highRefresh, board }. */
export const settingsStore = createStore(initialPref);

settingsStore.subscribe((s) => {
  savePref('settings', sanitizeSettings(s));
  audio.setVolumes(s);
  audio.setVoiceLang?.(s.voiceLang, s.voiceOverrides); // 全局语言 + 每干员覆盖（voicePrefs.js）
});
audio.setVolumes(settingsStore.get());
audio.setVoiceLang?.(initialPref.voiceLang, initialPref.voiceOverrides);

/**
 * The key assigned to an in-match action (ui/gameLogic/shortcuts.js; default if not set).
 * @param {'refresh'|'freeze'|'levelUp'|'retreat'|'sell'|'ready'} action
 */
export const hotkeyLabelOf = (action) => hotkeyLabel(settingsStore.get().keys?.[action]);

/** @param {Partial<ReturnType<typeof sanitizeSettings>>} patch */
export function updateSettings(patch) {
  const next = sanitizeSettings({ ...settingsStore.get(), ...patch });
  settingsStore.set(next);
  if (typeof patch?.highRefresh === 'boolean' && typeof globalThis.AndroidNative?.setHighRefresh === 'function') {
    if (globalThis.AndroidNative.isHighRefresh?.() !== patch.highRefresh) {
      globalThis.AndroidNative.setHighRefresh(patch.highRefresh);
    }
  }
}

/** Preact hook: current settings. */
export const useSettings = () => useStore((s) => s, Object.is, settingsStore);

function Slider({ label, micro, value, onInput, icon }) {
  const pct = Math.round(value * 100);
  return html`<label class="set-row">
    <span class="set-row__label"><${Icon} name=${icon} />${label}<${MicroLabel}>${micro}<//></span>
    <input class="set-range" type="range" min="0" max="100" step="5" value=${pct} style=${`--pct:${pct}%`}
      onInput=${(e) => onInput(Number(e.currentTarget.value) / 100)} />
    <span class="set-row__val num">${pct}</span>
  </label>`;
}

function Toggle({ label, micro, value, onChange }) {
  return html`<div class="set-row">
    <span class="set-row__label">${label}<${MicroLabel}>${micro}<//></span>
    <button type="button" class=${`set-toggle${value ? ' is-on' : ''}`} role="switch" aria-checked=${value ? 'true' : 'false'}
      onClick=${() => onChange(!value)}><i></i><span>${value ? '开启' : '关闭'}</span></button>
  </div>`;
}

const QUALITY = [['high', '高'], ['medium', '中'], ['low', '低']];
// 全局语音语言（VOICE_LANGS 是唯一词汇表，voicePrefs.js）；默认日语 —— 每干员可在干员调配里单独覆盖。
const VOICE_LANG = VOICE_LANGS.map((id) => [id, id === 'jp' ? '日语 (默认)' : VOICE_LANG_NAMES[id]]);
const BOARDS = [['auto', '自动'], ['3d', '3D 全景'], ['2d', '2D 俯视']];

/**
 * Settings modal.
 * @param {{ open: boolean, onClose: Function }} props
 */
export function SettingsModal({ open, onClose }) {
  const s = useSettings();
  const [tested, setTested] = useState(false);
  const [testedVoice, setTestedVoice] = useState(false);
  const [serverUrl, setServerUrl] = useState(() => globalThis.localStorage?.getItem('sp_ws_url') || '');
  const [touchUi] = useState(() => detectFeatures().coarse && !detectFeatures().fine);
  // The Android shell exposes itself as AndroidNative; the same page in a browser has none of it.
  const nativeShell = globalThis.AndroidNative?.isNativeApp?.() ? globalThis.AndroidNative : null;

  const applyServerUrl = () => {
    const raw = (serverUrl || '').trim();
    if (!raw) {
      globalThis.localStorage?.removeItem('sp_ws_url');
      globalThis.location?.reload();
      return;
    }
    let target = raw;
    if (!target.includes('://')) {
      target = (globalThis.location?.protocol === 'https:' ? 'wss://' : 'ws://') + target;
    } else if (target.startsWith('http://')) {
      target = 'ws://' + target.slice('http://'.length);
    } else if (target.startsWith('https://')) {
      target = 'wss://' + target.slice('https://'.length);
    }
    try {
      const u = new URL(target);
      if (!u.pathname || u.pathname === '/') u.pathname = '/ws';
      target = u.toString();
    } catch {}
    globalThis.localStorage?.setItem('sp_ws_url', target);
    globalThis.location?.reload();
  };
  return html`<${Modal} open=${open} onClose=${onClose} title="设置" micro="SETTINGS" width="min(8.8rem, 92vw)"
    actions=${html`<${Button} variant="secondary" icon="book" class="set-guide" onClick=${() => openGuide(0)}>玩法说明<//>
      <${Button} variant="primary" icon="check" onClick=${onClose}>完成<//>`}>
    <div class="set-list">
      <${Slider} label="背景音乐" micro="BGM" icon="play" value=${s.bgm} onInput=${(v) => updateSettings({ bgm: v })} />
      <${Slider} label="音效" micro="SFX" icon="signal" value=${s.sfx}
        onInput=${(v) => { updateSettings({ sfx: v }); if (!tested) { setTested(true); setTimeout(() => setTested(false), 400); audio.sfx('click'); } }} />
      <${Slider} label="干员语音" micro="VOICE" icon="signal" value=${s.voice}
        onInput=${(v) => { updateSettings({ voice: v }); if (!testedVoice) { setTestedVoice(true); setTimeout(() => setTestedVoice(false), 400); audio.sfx('tab'); } }} />
      <div class="set-row">
        <span class="set-row__label">语音语言<${MicroLabel}>VOICE DUB<//></span>
        <div class="set-seg" role="radiogroup">
          ${VOICE_LANG.map(([id, label]) => {
            const on = (s.voiceLang || 'jp') === id;
            return html`<button key=${id} type="button" role="radio" aria-checked=${on ? 'true' : 'false'}
              class=${on ? 'is-on' : ''} onClick=${() => { updateSettings({ voiceLang: id }); audio.setVoiceLang?.(id, s.voiceOverrides); audio.sfx?.('click'); }}>${label}</button>`;
          })}
        </div>
      </div>
      <${Toggle} label="静音" micro="MUTE" value=${s.muted} onChange=${(v) => updateSettings({ muted: v })} />
      <${Toggle} label="显示伤害数字" micro="DAMAGE NUMBERS" value=${s.damageNumbers} onChange=${(v) => updateSettings({ damageNumbers: v })} />
      <div class="set-row">
        <span class="set-row__label">画面质量<${MicroLabel}>QUALITY<//></span>
        <div class="set-seg" role="radiogroup">
          ${QUALITY.map(([id, label]) => html`<button key=${id} type="button" role="radio" aria-checked=${s.quality === id ? 'true' : 'false'}
            class=${s.quality === id ? 'is-on' : ''} onClick=${() => updateSettings({ quality: id })}>${label}</button>`)}
        </div>
      </div>
      <${Toggle} label="动态高刷新率" micro="PREP 120 / BATTLE 60" value=${s.highRefresh !== false}
        onChange=${(v) => updateSettings({ highRefresh: v })} />
      <div class="set-row">
        <span class="set-row__label">棋盘视角<${MicroLabel}>BOARD VIEW<//></span>
        <div class="set-seg" role="radiogroup">
          ${BOARDS.map(([id, label]) => html`<button key=${id} type="button" role="radio" aria-checked=${(s.board || 'auto') === id ? 'true' : 'false'}
            class=${(s.board || 'auto') === id ? 'is-on' : ''} onClick=${() => updateSettings({ board: id })}>${label}</button>`)}
        </div>
      </div>
      <div class="set-row">
        <span class="set-row__label">联机服务器<${MicroLabel}>SERVER URL<//></span>
        <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;justify-content:flex-end;">
          <input type="text" placeholder="默认本机" value=${serverUrl}
            onInput=${(e) => setServerUrl(e.target.value)}
            style="width:145px;padding:3px 6px;font-size:11px;background:#14171a;color:#eee;border:1px solid #444;border-radius:3px;" />
          <button type="button" class="btn" style="padding:3px 8px;font-size:11px;" onClick=${applyServerUrl}>切换并重连</button>
          ${serverUrl ? html`<button type="button" class="btn" style="padding:3px 6px;font-size:11px;opacity:0.75;" onClick=${() => { setServerUrl(''); globalThis.localStorage?.removeItem('sp_ws_url'); globalThis.location?.reload(); }}>恢复默认</button>` : null}
        </div>
      </div>
      ${nativeShell ? html`<div class="set-row">
            <span class="set-row__label">本机服务<${MicroLabel}>LOCAL ENGINE<//></span>
            <div class="set-engine-grid">
              <button type="button" onClick=${() => nativeShell.openServerSettings()}>服务器设置</button>
              <button type="button" onClick=${() => nativeShell.restartLocalServer()}>重启引擎</button>
              <button type="button" onClick=${() => nativeShell.showLogs()}>运行日志</button>
              <button type="button" onClick=${() => nativeShell.reloadClient()}>重载页面</button>
            </div>
          </div>` : null}
      ${nativeShell || touchUi
        ? null
        : html`<p class="set-hint">快捷键：<kbd>R</kbd> 刷新 · <kbd>F</kbd> 冻结 · <kbd>D</kbd> 升级 · <kbd>Q</kbd> 撤退选中干员 · <kbd>X</kbd> 出售选中干员 · <kbd>Space</kbd> 准备就绪 · <kbd>Esc</kbd> 关闭弹窗 · 右键查看详情</p>`}
    </div>
  <//>`;
}

export const settingsUiStore = createStore({ open: false });
export const openSettings = () => settingsUiStore.set({ open: true });
export const closeSettings = () => settingsUiStore.set({ open: false });

/** 全局设置宿主：由 main.js 挂载在 .app-root，彻底杜绝 transform 引起的遮罩错位与事件穿透 */
export function SettingsHost() {
  const open = useStore((s) => s.open, Object.is, settingsUiStore);
  return html`<${SettingsModal} open=${open} onClose=${closeSettings} />`;
}


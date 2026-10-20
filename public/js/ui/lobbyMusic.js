import { PHASE } from '../../../shared/constants.js';
import { html, Button, Modal } from './components.js';
import { useEffect, useRef, useState } from '../../vendor/hooks.module.js';
import { store, selectRoute } from '../store.js';
import { data } from '../data.js';
import { audio, bgmKeyFor } from '../audio.js';

export const MAX_MUSIC_BYTES = 20 * 1024 * 1024;
const listeners = new Set();
let record = null, url = null, media = null, source = null, revision = 0, installed = false, dbPromise;
let status = '默认大厅音乐', busy = false, lastRoute;
const notify = () => listeners.forEach(fn => fn(music.snapshot()));
let videoAudible=false;
const inMusicArea = () => { const s=store.get(),route=selectRoute(s);return ['lobby','room'].includes(route)||(route==='game'&&[PHASE.INFO_CHECK,PHASE.BAND_DRAFT,PHASE.BATTLE_CHECK].includes(s.match?.public?.phase)); };
let customGain=null,fadeTarget=0,fadeTimer,handoff=false,handoffTimer;
const areaKey = () => selectRoute(store.get()) + ':' + inMusicArea();
function db() {
  return dbPromise ||= new Promise((resolve, reject) => {
    const req = indexedDB.open('sp-lobby-music', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('tracks');
    req.onsuccess = () => { const result = req.result; result.onversionchange = () => result.close(); resolve(result); };
    req.onerror = () => { dbPromise = null; reject(Error('浏览器无法保存音乐，请检查可用空间')); };
  });
}
async function saved(write, value) {
  const database = await db();
  return new Promise((resolve, reject) => {
    const tx = database.transaction('tracks', write ? 'readwrite' : 'readonly'), table = tx.objectStore('tracks');
    const req = write ? value ? table.put(value, 'lobby') : table.delete('lobby') : table.get('lobby');
    tx.oncomplete = () => resolve(req.result);
    tx.onerror = tx.onabort = () => reject(Error('音乐保存失败，可能是浏览器存储空间不足'));
  });
}
async function validate(file) {
  if (!file || file.size <= 0) throw Error('请选择有效的音频文件');
  if (file.size > MAX_MUSIC_BYTES) throw Error('音乐不能超过 20MB，请选择较小的文件');
  if (!/\.(mp3|wav|ogg|m4a|aac|flac|webm)$/i.test(file.name || '') || (file.type && !file.type.startsWith('audio/') && file.type !== 'video/webm' && file.type !== 'application/ogg')) throw Error('请选择 MP3、M4A、OGG、WAV 等音频文件');
  const objectUrl = URL.createObjectURL(file), probe = new Audio(); probe.preload = 'metadata';
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(Error('音频读取超时，请尝试其他文件')), 10000);
      probe.onloadedmetadata = () => { clearTimeout(timer); Number.isFinite(probe.duration) && probe.duration > 0 ? resolve() : reject(Error('音频文件无效')); };
      probe.onerror = () => { clearTimeout(timer); reject(Error('浏览器无法播放该音频，请尝试 MP3 或 M4A')); };
      probe.src = objectUrl;
    });
  } finally { probe.onloadedmetadata = probe.onerror = null; probe.removeAttribute('src'); probe.load(); URL.revokeObjectURL(objectUrl); }
}
function replace(next) {
  if (media) { media.pause(); media.removeAttribute('src'); media.load(); }
  if (url) URL.revokeObjectURL(url);
  record = next;
  // 预设曲目：直接用站内 URL（没有 blob）
  url = next?.preset ? next.preset : next?.blob ? URL.createObjectURL(next.blob) : null;
  if (media && url) media.src = url;
}
function fadeCustom(on, immediate = false) {
  const target = on ? 1 : 0;
  if (target === fadeTarget && !immediate) return;
  clearTimeout(fadeTimer);fadeTarget = target;
  if (!customGain || !audio.ctx || immediate) { if (!on) media?.pause();if(customGain)customGain.gain.value=target;return; }
  const t=audio.ctx.currentTime,g=customGain.gain;
  if (g.cancelAndHoldAtTime) g.cancelAndHoldAtTime(t);
  else {g.cancelScheduledValues(t);g.setValueAtTime(g.value,t);}
  g.linearRampToValueAtTime(target,t+0.9);
  if (!on) fadeTimer=setTimeout(()=>{if(fadeTarget===0){media.pause();notify();}},1000);
}
function clearHandoff() { clearTimeout(handoffTimer);handoff=false; }
function sync() {
  if (!media || !record) return;
  if ((videoAudible&&selectRoute(store.get())==='lobby') || !record.enabled || record.paused || document.hidden || audio.bgmSilent) {clearHandoff();fadeCustom(false,true);return;}
  if (!inMusicArea()) {
    // Keep the old music while the next game's BGM buffer is loading.
    if (selectRoute(store.get())==='game' && !media.paused && fadeTarget>0) {
      if (!handoff) {handoff=true;handoffTimer=setTimeout(()=>{clearHandoff();fadeCustom(false);},10000);}
    } else fadeCustom(false);
    return;
  }
  clearHandoff();
  if (!audio.ctx) return;
  if (!source) {source=audio.ctx.createMediaElementSource(media);customGain=audio.ctx.createGain();customGain.gain.value=0;source.connect(customGain);customGain.connect(audio.bgmGain);}
  fadeCustom(true);
  if (!media.paused) return;
  media.play().then(()=>{status='正在播放 · 单曲循环';notify();},()=>{status='点击“播放”开始音乐';notify();});
}

function refresh() {
  const s = store.get(); audio.playBgm(bgmKeyFor(selectRoute(s), s.match?.public)); sync(); notify();
}
function install() {
  if (installed) return; installed = true;
  media = new Audio(); media.loop = true; media.preload = 'none';
  media.onerror = () => { record && (record.enabled = false); status = '音乐播放失败，已恢复默认音乐'; refresh(); };
  audio.lobbyMusicOverride = key => {
    const override = key === 'lobby' && ((videoAudible&&selectRoute(store.get())==='lobby') || (record?.enabled&&inMusicArea()));
    sync();
    return !!override;
  };
  audio.lobbyMusicBgmStarted = () => { if (!inMusicArea()) {clearHandoff();fadeCustom(false);} };
  window.addEventListener('sp:lobby-video-audio', e => {videoAudible=!!e.detail?.active;refresh();});
  lastRoute = areaKey();
  store.subscribe(s => { const route = areaKey(); if (route !== lastRoute) { lastRoute = route; refresh(); } else sync(); });
  document.addEventListener('visibilitychange', sync);
  window.addEventListener('pointerdown', () => { if (record?.enabled) { audio._unlock(); sync(); } }, { passive: true });
  const initialRevision = revision;
  saved(false).then(value => {
    if (revision !== initialRevision) return;
    if (value?.preset) { replace(value); status = value.paused ? '已暂停' : '点击“播放”开始音乐'; refresh(); return; }
    if (!value?.blob || value.blob.size > MAX_MUSIC_BYTES) return;
    replace(value); status = value.paused ? '已暂停' : '点击“播放”开始音乐'; refresh();
  }).catch(() => { status = '浏览器暂不能保存音乐，可稍后重试'; notify(); });
}
export const music = {
  snapshot: () => ({ name: record?.name || '', size: record?.blob?.size || 0, preset: record?.preset || null, enabled: !!record?.enabled, paused: !!record?.paused, playing: !!media && !media.paused, status, busy }),
  async upload(file) {
    if (busy) return; install(); ++revision; busy = true; notify();
    try { await validate(file); const next = { blob: file, name: file.name.slice(0,180), enabled: true, paused: false }; await saved(true, next); replace(next); status = '已保存音乐'; audio._unlock(); refresh(); }
    catch(e) { status = e.message || '音乐导入失败'; throw e; }
    finally { busy = false; notify(); }
  },
  async toggle() {
    if (!record || busy) return; ++revision;
    const next = { ...record, enabled: true, paused: !!record.enabled && !media.paused };
    await saved(true,next); record=next; status=next.paused?'已暂停':'正在播放 · 单曲循环'; audio._unlock(); refresh();
  },
  /** 选用一首内置预设曲目（业主 2026-10-20）：存 URL，不占 IndexedDB。 */
  async selectPreset(name, url) {
    if (busy) return; install(); ++revision; busy = true; notify();
    try {
      const next = { preset: url, name: (name || '').slice(0, 180), enabled: true, paused: false };
      await saved(true, next); replace(next); status = '正在播放 · 单曲循环'; audio._unlock(); refresh();
    } catch (e) { status = e.message || '切换预设失败'; throw e; }
    finally { busy = false; notify(); }
  },
  async reset() { if (busy) return; ++revision; await saved(true,null); replace(null); status='默认大厅音乐'; refresh(); },
};


export function LobbyMusicButton() {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState(music.snapshot);
  const [error, setError] = useState('');
  const input = useRef(null);
  useEffect(() => {
    install();
    const fn = (s) => setState(s);
    listeners.add(fn);
    fn(music.snapshot());
    return () => listeners.delete(fn);
  }, []);
  // 预设曲目来自 data/assets.json 的 audio.lobbyPresets（用 data store，不是全局 store）
  const [presets, setPresets] = useState(() => data.get('assets')?.audio?.lobbyPresets || []);
  useEffect(() => {
    let dead = false;
    const read = () => { if (!dead) setPresets(data.get('assets')?.audio?.lobbyPresets || []); };
    data.load('assets').then?.(read, read) ?? read();
    const off = data.subscribe?.(read);
    return () => { dead = true; off?.(); };
  }, []);
  const action = async (fn) => { setError(''); try { await fn(); } catch (e) { setError(e.message || '操作失败'); } };
  const pick = async (e) => {
    const file = e.currentTarget.files?.[0];
    e.currentTarget.value = '';
    if (file) await action(() => music.upload(file));
  };
  return html`<${Button} variant="secondary" size="sm" square=${true} class="hub-music-btn" title="大厅音乐" aria-label="大厅音乐" onClick=${() => setOpen(true)}><span class="hub-music-btn__ico">♪</span><//>
    <${Modal} class="lobby-music-panel" open=${open} title="大厅音乐" micro="LOBBY MUSIC"
      width="min(420px, calc(100vw - 24px))" onClose=${() => setOpen(false)}
      actions=${html`<${Button} variant="secondary" onClick=${() => setOpen(false)}>关闭<//>`}>
      <div class="lmp">
        <p class="lmp__hint">选择你喜欢的大厅音乐，每首最大 20MB。保存在当前浏览器，无需上传服务器。</p>

        <div class=${'lmp__now' + (state.name ? ' is-custom' : '')}>
          <span class="lmp__cap">当前音乐</span>
          <b class="lmp__name">${state.name || '默认大厅音乐'}</b>
          <span class="lmp__sub">${state.status}${state.size ? ` · ${(state.size / 1024 / 1024).toFixed(1)} MB` : ''}</span>
        </div>

        <div class="lmp__presets" role="listbox" aria-label="预设曲目">
          <div class="lmp__presets-cap">预设曲目 <b class="num">${presets.length}</b></div>
          <div class="lmp__presets-list">
            ${presets.map((x) => html`<button key=${x.url} type="button" role="option"
                aria-selected=${state.name === x.name && state.preset === x.url ? 'true' : 'false'}
                class=${'lmp__preset' + (state.preset === x.url ? ' is-on' : '')}
                disabled=${state.busy} onClick=${() => action(() => music.selectPreset(x.name, x.url))}>
                <span class="lmp__preset-n">${x.name}</span>
                ${state.preset === x.url ? html`<i class="lmp__preset-on">播放中</i>` : null}
              </button>`)}
          </div>
        </div>

        <input ref=${input} type="file" accept="audio/*,.mp3,.m4a,.ogg,.wav,.aac,.flac,.webm" hidden onChange=${pick} />

        <div class="lmp__acts">
          <button type="button" class="lmp__btn lmp__btn--main" disabled=${state.busy} onClick=${() => input.current?.click()}>
            <i class="lmp__ico">+</i><span>${state.busy ? '正在导入…' : '上传音乐'}</span>
          </button>
          <button type="button" class="lmp__btn" disabled=${!state.name || state.busy} onClick=${() => action(() => music.toggle())}>
            <i class="lmp__ico">${state.playing ? 'II' : '>'}</i><span>${state.playing ? '暂停' : '播放'}</span>
          </button>
          <button type="button" class="lmp__btn lmp__btn--quiet" disabled=${!state.name || state.busy} onClick=${() => action(() => music.reset())}>
            <i class="lmp__ico">R</i><span>恢复默认</span>
          </button>
        </div>

        <small class="lmp__foot">音量和静音沿用游戏设置。刷新后保留；清理浏览器数据会删除音乐。</small>
        ${error ? html`<p class="lmp__err" role="alert">${error}</p>` : null}
      </div>
    <//>`;
}

// public/js/ui/annihilationBackdrop.js — the annihilation stage background: one default key art (不息恶火) plus any
// local images the player adds, switched with the left/right buttons. Uploaded images are cropped to 1920×1080 and
// stored as data URLs in localStorage, so they survive a reload without needing a server upload.
import { useEffect, useState } from '../../vendor/hooks.module.js';
import { html, Icon } from './components.js';
import { toast, toastError } from './toasts.js';
import { t } from '../../../shared/i18n.js';

export const ANNIHILATION_BACKGROUNDS = [
  { src: '/assets/annihilation-intro/art/crimson-knight.webp', label: '不息恶火' },
];

const STORAGE_KEY = 'sp.annihilation.backgrounds';
const ONLY_KEY = 'sp.annihilation.presetsOnly';
const MAX_CUSTOM = 5;

function loadOnly() {
  try {
    const raw = localStorage.getItem(ONLY_KEY);
    return raw === 'none' || (raw && raw.startsWith('/assets/')) ? raw : null;
  } catch {
    return null;
  }
}

function saveOnly(value) {
  try {
    if (value) localStorage.setItem(ONLY_KEY, value);
    else localStorage.removeItem(ONLY_KEY);
  } catch { /* quota / private mode: the session still works */ }
}

function loadCustom() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr.filter((x) => typeof x === 'string' && x.startsWith('data:image/')) : [];
  } catch {
    return [];
  }
}

function saveCustom(list) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
    return true;
  } catch {
    return false;
  }
}

/** Crop any image to 16:9 and re-encode it small enough for localStorage. */
function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      try {
        const width = 1920, height = 1080;
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        const scale = Math.max(width / img.width, height / img.height);
        const sw = width / scale, sh = height / scale;
        ctx.drawImage(img, (img.width - sw) / 2, (img.height - sh) / 2, sw, sh, 0, 0, width, height);
        const data = canvas.toDataURL('image/webp', 0.86);
        URL.revokeObjectURL(objectUrl);
        resolve(data.startsWith('data:image/') ? data : canvas.toDataURL('image/jpeg', 0.9));
      } catch (err) {
        URL.revokeObjectURL(objectUrl);
        reject(err);
      }
    };
    img.onerror = () => { URL.revokeObjectURL(objectUrl); reject(new Error('image load failed')); };
    img.src = objectUrl;
  });
}

export function AnnihilationBackdrop() {
  const [custom, setCustom] = useState(loadCustom);
  const [only, setOnly] = useState(loadOnly);
  const [index, setIndex] = useState(0);
  const [busy, setBusy] = useState(false);
  const [managerOpen, setManagerOpen] = useState(false);
  const onlyPreset = only && only !== 'none' ? ANNIHILATION_BACKGROUNDS.find((b) => b.src === only) : null;
  const presets = only === 'none' ? [] : onlyPreset ? [onlyPreset] : ANNIHILATION_BACKGROUNDS;
  const images = [...presets, ...custom.map((src, i) => ({ src, label: t('本地背景 {n}', { n: i + 1 }) }))];
  const total = images.length;

  useEffect(() => {
    // preload so a switch never shows an empty frame
    for (const b of images) {
      const im = new Image();
      im.src = b.src;
    }
  }, [images.length]);

  useEffect(() => {
    if (index >= total) setIndex(Math.max(0, total - 1));
  }, [index, total]);

  // auto-advance every 10s; a manual switch resets the clock because index is a dependency
  useEffect(() => {
    if (total < 2) return undefined;
    const reduce = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce) return undefined;
    const timer = setInterval(() => setIndex((i) => (i + 1) % total), 10000);
    return () => clearInterval(timer);
  }, [total, index]);

  const go = (delta) => {
    if (total < 2) return;
    setIndex((i) => (i + delta + total) % total);
  };

  const addFiles = async (e) => {
    const files = [...(e.currentTarget.files || [])].filter((f) => f.type.startsWith('image/'));
    e.currentTarget.value = '';
    if (!files.length) return;
    if (custom.length >= MAX_CUSTOM) {
      toast(t('本地背景最多添加 {n} 张', { n: MAX_CUSTOM }), 'warn');
      return;
    }
    setBusy(true);
    const added = [];
    for (const file of files.slice(0, MAX_CUSTOM - custom.length)) {
      try {
        added.push(await fileToDataUrl(file));
      } catch (err) {
        toastError(err);
      }
    }
    if (added.length) {
      const next = [...custom, ...added];
      setCustom(next);
      setIndex(ANNIHILATION_BACKGROUNDS.length + custom.length);
      if (!saveCustom(next)) toast(t('背景已添加，但浏览器存储空间不足，刷新后会丢失'), 'warn');
      else toast(t('本地背景已添加'), 'success');
    }
    setBusy(false);
  };

  const removeCustom = (ci) => {
    const next = custom.filter((_, i) => i !== ci);
    const base = ANNIHILATION_BACKGROUNDS.length;
    const removedAt = base + ci;
    setCustom(next);
    let nextIndex = index;
    if (index === removedAt) nextIndex = base + Math.min(ci, next.length - 1);
    else if (index > removedAt) nextIndex = index - 1;
    setIndex(Math.max(0, Math.min(nextIndex, base + next.length - 1)));
    if (!saveCustom(next)) toast(t('本地背景已删除，但浏览器存储空间写入失败'), 'warn');
    else toast(t('本地背景已删除'), 'success');
  };

  const keepCurrentOnly = () => {
    const current = images[index];
    if (!current) return;
    const preset = ANNIHILATION_BACKGROUNDS.some((b) => b.src === current.src);
    const nextCustom = preset ? [] : [current.src];
    const nextOnly = preset ? current.src : 'none';
    setCustom(nextCustom);
    setOnly(nextOnly);
    saveCustom(nextCustom);
    saveOnly(nextOnly);
    setIndex(0);
    setManagerOpen(false);
    toast(t('已只保留当前背景'), 'success');
  };

  const restoreAllPresets = () => {
    setOnly(null);
    saveOnly(null);
    setIndex(0);
    toast(t('已恢复全部预设背景'), 'success');
  };

  return html`<div class="proto-stage__art">
    <div class="proto-stage__art-imgs" aria-hidden="true">
      ${images.map((b, i) => html`<div key=${i} class=${'proto-stage__art-slide' + (i === index ? ' is-on' : '')}>
        <img class="proto-stage__art-img" src=${b.src} alt="" draggable="false" />
      </div>`)}
    </div>
    ${total > 1 ? html`<button type="button" class="proto-stage__nav proto-stage__nav--prev" onClick=${() => go(-1)}
      aria-label=${t('上一张背景')} title=${t('上一张背景')}><${Icon} name="chevronLeft" /></button>
    <button type="button" class="proto-stage__nav proto-stage__nav--next" onClick=${() => go(1)}
      aria-label=${t('下一张背景')} title=${t('下一张背景')}><${Icon} name="chevronRight" /></button>` : null}
    ${managerOpen ? html`<div class="proto-stage__art-manager" role="dialog" aria-label=${t('管理本地背景')}>
      <div class="proto-stage__art-manager-head">
        <b>${t('本地背景')}</b><span class="num">${custom.length} / ${MAX_CUSTOM}</span>
        <button type="button" class="proto-stage__art-manager-close" onClick=${() => setManagerOpen(false)} aria-label=${t('关闭')}>
          <${Icon} name="close" />
        </button>
      </div>
      <div class="proto-stage__art-manager-grid">
        ${custom.length ? custom.map((src, ci) => html`<div key=${ci} class=${'proto-stage__art-manager-item' + (index === ANNIHILATION_BACKGROUNDS.length + ci ? ' is-on' : '')}>
          <button type="button" class="proto-stage__art-manager-thumb" onClick=${() => setIndex(ANNIHILATION_BACKGROUNDS.length + ci)}
            title=${t('设为当前背景')} aria-label=${t('设为当前背景')}>
            <img src=${src} alt="" draggable="false" />
          </button>
          <button type="button" class="proto-stage__art-manager-del" onClick=${() => removeCustom(ci)}
            title=${t('删除这张本地背景')} aria-label=${t('删除这张本地背景')}><${Icon} name="close" /></button>
        </div>`) : html`<p class="proto-stage__art-manager-empty">${t('还没有添加本地背景')}</p>`}
      </div>
      <p class="proto-stage__art-manager-hint">${t('最多保存 {n} 张；点缩略图切换，点 × 删除', { n: MAX_CUSTOM })}</p>
      <div class="proto-stage__art-manager-actions">
        <button type="button" class="proto-stage__art-manager-keep" onClick=${keepCurrentOnly}>${t('只保留当前')}</button>
        ${only ? html`<button type="button" class="proto-stage__art-manager-restore" onClick=${restoreAllPresets}>${t('恢复全部预设')}</button>` : null}
      </div>
    </div>` : null}
    <div class="proto-stage__art-tools">
      <div class="proto-stage__art-dots" aria-hidden="true">
        ${images.map((b, i) => html`<span key=${i} class=${'proto-stage__art-dot' + (i === index ? ' is-on' : '')}></span>`)}
      </div>
      <button type="button" class="proto-stage__art-add" onClick=${() => setManagerOpen((v) => !v)}
        title=${t('管理本地背景')} aria-expanded=${managerOpen ? 'true' : 'false'}>
        <${Icon} name="dots" /><span>${t('管理')}</span>
      </button>
      <label class=${'proto-stage__art-add' + (busy ? ' is-busy' : '')} title=${t('添加本地图片作为背景')}>
        <${Icon} name="plus" /><span>${busy ? t('处理中…') : t('本地图片')}</span>
        <input type="file" accept="image/*" multiple disabled=${busy} onChange=${addFiles} />
      </label>
    </div>
  </div>`;
}

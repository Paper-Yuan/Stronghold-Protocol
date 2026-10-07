// public/js/ui/preloadModal.js — 客户端资源预载与离线缓存管理器 (Preload & Cache Center)
import { useState, useEffect, useRef } from '../../vendor/hooks.module.js';
import { html, Modal, Button, Icon, MicroLabel, ProgressBar } from './components.js';
import { data, loadData } from '../data.js';

const CACHE_NAME = 'stronghold-assets-v0.2.1';
const PRELOAD_STORAGE_KEY = 'sp_preloaded_profiles';

/**
 * Extract URLs for Core and Full profiles from assets data.
 * @param {any} assets
 * @param {any} skinsData
 */
function extractUrls(assets, skinsData) {
  const coreSet = new Set();
  const fullSet = new Set();

  if (!assets || typeof assets !== 'object') return { core: [], full: [] };

  // 1. UI Assets
  if (assets.ui && typeof assets.ui === 'object') {
    for (const val of Object.values(assets.ui)) {
      const u = typeof val === 'string' ? val : val?.url || val?.path;
      if (u && typeof u === 'string') {
        coreSet.add(u);
        fullSet.add(u);
      }
    }
  }

  // 2. Chars & Skins
  if (assets.chars && typeof assets.chars === 'object') {
    for (const [charId, c] of Object.entries(assets.chars)) {
      if (c.avatar) { coreSet.add(c.avatar); fullSet.add(c.avatar); }
      if (c.avatarE2) { coreSet.add(c.avatarE2); fullSet.add(c.avatarE2); }
      if (c.portrait) fullSet.add(c.portrait);
      if (c.portraitE2) fullSet.add(c.portraitE2);

      // Spine Models (Full)
      if (c.spine) {
        for (const part of ['front', 'back']) {
          const sp = c.spine[part];
          if (sp) {
            if (sp.skel) fullSet.add(sp.skel);
            if (sp.atlas) fullSet.add(sp.atlas);
            if (Array.isArray(sp.textures)) sp.textures.forEach((t) => fullSet.add(t));
          }
        }
      }

      // Skins
      if (c.skins && typeof c.skins === 'object') {
        for (const sk of Object.values(c.skins)) {
          if (sk.avatar) { coreSet.add(sk.avatar); fullSet.add(sk.avatar); }
          if (sk.spine?.front) {
            const sp = sk.spine.front;
            if (sp.skel) fullSet.add(sp.skel);
            if (sp.atlas) fullSet.add(sp.atlas);
            if (Array.isArray(sp.textures)) sp.textures.forEach((t) => fullSet.add(t));
          }
        }
      }
    }
  }

  // 3. Skins data avatar icons
  if (skinsData && typeof skinsData === 'object') {
    for (const skin of Object.values(skinsData)) {
      if (skin.avatar) { coreSet.add(skin.avatar); fullSet.add(skin.avatar); }
    }
  }

  // 4. Audio & SFX
  if (assets.audio && typeof assets.audio === 'object') {
    if (assets.audio.bgm) {
      for (const [k, u] of Object.entries(assets.audio.bgm)) {
        if (typeof u === 'string') {
          if (k === 'title' || k === 'lobby') coreSet.add(u);
          fullSet.add(u);
        }
      }
    }
    if (assets.audio.sfx && typeof assets.audio.sfx === 'object') {
      for (const u of Object.values(assets.audio.sfx)) {
        if (typeof u === 'string') {
          coreSet.add(u);
          fullSet.add(u);
        }
      }
    }
  }

  return {
    core: Array.from(coreSet).filter((u) => typeof u === 'string' && u.startsWith('/')),
    full: Array.from(fullSet).filter((u) => typeof u === 'string' && u.startsWith('/')),
  };
}

/** Preload State & Worker Engine */
class PreloadEngine {
  constructor() {
    this.status = 'idle'; // idle | scanning | downloading | paused | completed | error
    this.profile = 'core';
    this.queue = [];
    this.totalCount = 0;
    this.doneCount = 0;
    this.doneBytes = 0;
    this.currentFile = '';
    this.speedBps = 0;
    this.lastError = null;
    this.isPaused = false;
    this.listeners = new Set();
    this.cachedProfiles = this._loadSavedProfiles();

    this._initCache();
  }

  _loadSavedProfiles() {
    try {
      const raw = localStorage.getItem(PRELOAD_STORAGE_KEY);
      return raw ? JSON.parse(raw) : { core: false, full: false };
    } catch {
      return { core: false, full: false };
    }
  }

  _saveProfileDone(profile) {
    this.cachedProfiles[profile] = true;
    try {
      localStorage.setItem(PRELOAD_STORAGE_KEY, JSON.stringify(this.cachedProfiles));
    } catch {}
    this.notify();
  }

  async _initCache() {
    if (typeof window !== 'undefined' && 'caches' in window) {
      try {
        const cache = await window.caches.open(CACHE_NAME);
        const keys = await cache.keys();
        if (keys.length > 50) {
          this.cachedProfiles.core = true;
          this.notify();
        }
      } catch {}
    }
  }

  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  notify() {
    for (const fn of this.listeners) fn(this);
  }

  async start(profile = 'core') {
    if (this.status === 'downloading') return;
    this.profile = profile;
    this.status = 'scanning';
    this.isPaused = false;
    this.lastError = null;
    this.doneCount = 0;
    this.doneBytes = 0;
    this.notify();

    try {
      const [assets, skins] = await loadData('assets', 'skins');
      const safeAssets = Array.isArray(assets) ? assets[0] : assets;
      const safeSkins = Array.isArray(skins) ? skins[0] : skins;

      const urls = extractUrls(safeAssets, safeSkins)[profile] || [];
      if (urls.length === 0) {
        this.status = 'error';
        this.lastError = '未能解析到资源清单，请检查网络连接';
        this.notify();
        return;
      }

      this.totalCount = urls.length;
      this.queue = [...urls];
      this.status = 'downloading';
      this.notify();

      let cacheObj = null;
      if (typeof window !== 'undefined' && 'caches' in window) {
        try {
          cacheObj = await window.caches.open(CACHE_NAME);
        } catch {
          cacheObj = null;
        }
      }

      // Parallel download worker pool (concurrency: 6)
      const CONCURRENCY = 6;
      let activeIndex = 0;
      let lastSpeedMeasure = Date.now();
      let bytesSinceMeasure = 0;

      const worker = async () => {
        while (activeIndex < urls.length && !this.isPaused) {
          const index = activeIndex++;
          const url = urls[index];
          this.currentFile = url.split('/').pop() || url;
          this.notify();

          try {
            // Check if already in CacheStorage
            if (cacheObj) {
              const matched = await cacheObj.match(url);
              if (matched) {
                this.doneCount++;
                this.notify();
                continue;
              }
            }

            const res = await fetch(url, { cache: 'force-cache' });
            if (res.ok) {
              const blob = await res.blob();
              const size = blob.size;
              this.doneBytes += size;
              bytesSinceMeasure += size;

              if (cacheObj) {
                try {
                  await cacheObj.put(url, new Response(blob, {
                    status: res.status,
                    statusText: res.statusText,
                    headers: res.headers,
                  }));
                } catch {}
              }
            }
          } catch (e) {
            // Non-fatal, continue with other files
          }

          this.doneCount++;

          // Speed measure
          const now = Date.now();
          if (now - lastSpeedMeasure >= 800) {
            const sec = (now - lastSpeedMeasure) / 1000;
            this.speedBps = Math.round(bytesSinceMeasure / sec);
            bytesSinceMeasure = 0;
            lastSpeedMeasure = now;
          }

          this.notify();
        }
      };

      const workers = Array.from({ length: Math.min(CONCURRENCY, urls.length) }, () => worker());
      await Promise.all(workers);

      if (this.isPaused) {
        this.status = 'paused';
        this.notify();
      } else {
        this.status = 'completed';
        this.speedBps = 0;
        this._saveProfileDone(profile);
        this.notify();
      }
    } catch (err) {
      this.status = 'error';
      this.lastError = err.message || '预载过程发生异常';
      this.notify();
    }
  }

  pause() {
    if (this.status === 'downloading') {
      this.isPaused = true;
      this.status = 'paused';
      this.notify();
    }
  }

  resume() {
    if (this.status === 'paused') {
      this.start(this.profile);
    }
  }

  async clearCache() {
    this.status = 'idle';
    this.doneCount = 0;
    this.totalCount = 0;
    this.doneBytes = 0;
    this.cachedProfiles = { core: false, full: false };
    try {
      localStorage.removeItem(PRELOAD_STORAGE_KEY);
      if (typeof window !== 'undefined' && 'caches' in window) {
        await window.caches.delete(CACHE_NAME);
      }
    } catch {}
    this.notify();
  }
}

export const preloadEngine = new PreloadEngine();

/**
 * Preact hook to observe preload state.
 */
export function usePreloadState() {
  const [, setTick] = useState(0);
  useEffect(() => {
    return preloadEngine.subscribe(() => setTick((t) => t + 1));
  }, []);
  return preloadEngine;
}

/**
 * Preload Trigger Pill (mounted in the bottom-right corner of the title screen).
 */
export function PreloadPill({ onClick }) {
  const p = usePreloadState();

  let text = '⚡ 资源预载';
  let pillClass = 'preload-pill';

  if (p.status === 'downloading') {
    const pct = p.totalCount > 0 ? Math.round((p.doneCount / p.totalCount) * 100) : 0;
    text = `⚡ 预载中 ${pct}%`;
    pillClass += ' is-loading';
  } else if (p.status === 'completed' || p.cachedProfiles.full || p.cachedProfiles.core) {
    text = p.cachedProfiles.full ? '⚡ 资源已全量就绪' : '⚡ 基础资源已就绪';
    pillClass += ' is-ready';
  }

  return html`<button type="button" class=${pillClass} onClick=${onClick} title="管理网页端离线资源缓存">
    <span class="preload-pill__dot"></span>
    <span class="preload-pill__text">${text}</span>
  </button>`;
}

/**
 * Preload Control Center Modal.
 */
export function PreloadModal({ open, onClose }) {
  const p = usePreloadState();
  const [selectedProfile, setSelectedProfile] = useState('core');

  const pct = p.totalCount > 0 ? Math.round((p.doneCount / p.totalCount) * 100) : 0;
  const mbDownloaded = (p.doneBytes / 1024 / 1024).toFixed(1);
  const speedMb = (p.speedBps / 1024 / 1024).toFixed(2);

  const isBusy = p.status === 'downloading' || p.status === 'scanning';

  return html`<${Modal} open=${open} onClose=${onClose} title="资源预载与离线缓存中心" micro="ASSET PRELOAD CENTER"
    width="min(7.2rem, 94vw)"
    actions=${html`
      <div style="display:flex;width:100%;justify-content:space-between;align-items:center;">
        <${Button} variant="secondary" size="md" tone="red" disabled=${isBusy}
          onClick=${() => preloadEngine.clearCache()}>清除本地缓存<//>
        <div style="display:flex;gap:8px;">
          ${p.status === 'downloading'
            ? html`<${Button} variant="secondary" size="md" onClick=${() => preloadEngine.pause()}>暂停<//>`
            : p.status === 'paused'
            ? html`<${Button} variant="primary" size="md" onClick=${() => preloadEngine.resume()}>继续<//>`
            : html`<${Button} variant="primary" size="md" iconRight="download" onClick=${() => preloadEngine.start(selectedProfile)}>
                ${p.status === 'completed' ? '重新校验/下载' : '开始预载'}
              <//>`}
          <${Button} variant="secondary" size="md" onClick=${onClose}>完成<//>
        </div>
      </div>
    `}>
    <div class="preload-content">
      <p class="preload-desc">
        手机原生客户端已内置全量素材包；网页端可通过此功能将常用素材<b>预载至浏览器磁盘缓存</b>。预载后局内战斗、干员调配 DIY 与时装切换将直接本地秒开，免除弱网与延迟卡顿。
      </p>

      <div class="preload-profiles" role="radiogroup">
        <label class=${`preload-card ${selectedProfile === 'core' ? 'is-selected' : ''}`}>
          <input type="radio" name="profile" value="core" checked=${selectedProfile === 'core'}
            disabled=${isBusy} onChange=${() => setSelectedProfile('core')} />
          <div class="preload-card__body">
            <div class="preload-card__head">
              <span class="preload-card__title">⚡ 基础核心包</span>
              <span class="preload-card__size">~35 MB (推荐)</span>
            </div>
            <div class="preload-card__detail">
              包含：全部界面 UI、干员基础/精二头像、全量 271 款时装皮肤缩略图、表情包、大厅背景音乐与常用音效。
            </div>
            ${p.cachedProfiles.core ? html`<div class="preload-card__badge is-ready">✓ 已缓存</div>` : null}
          </div>
        </label>

        <label class=${`preload-card ${selectedProfile === 'full' ? 'is-selected' : ''}`}>
          <input type="radio" name="profile" value="full" checked=${selectedProfile === 'full'}
            disabled=${isBusy} onChange=${() => setSelectedProfile('full')} />
          <div class="preload-card__body">
            <div class="preload-card__head">
              <span class="preload-card__title">🌟 完整离线包</span>
              <span class="preload-card__size">~280 MB (全量)</span>
            </div>
            <div class="preload-card__detail">
              包含：在核心包基础上，追加全部干员与敌方战斗 Spine 骨骼模型、高精度立绘、全阶段战斗 BGM 与干员语音。
            </div>
            ${p.cachedProfiles.full ? html`<div class="preload-card__badge is-ready">✓ 已缓存</div>` : null}
          </div>
        </label>
      </div>

      ${isBusy || p.status === 'paused' || p.status === 'completed' ? html`
        <div class="preload-monitor">
          <div class="preload-monitor__header">
            <span class="preload-monitor__status">
              ${p.status === 'scanning' ? '🔍 正在解析资源依赖清单...' :
                p.status === 'downloading' ? `⚡ 正在高速预载中 · ${speedMb} MB/s` :
                p.status === 'paused' ? '⏸ 预载已暂停' : '🎉 资源预载校验完成！'}
            </span>
            <span class="preload-monitor__counts">${p.doneCount} / ${p.totalCount} 文件 (${pct}%)</span>
          </div>
          
          <${ProgressBar} value=${pct} max=${100} tone="mint" size="md" />

          <div class="preload-monitor__footer">
            <span class="preload-monitor__current t-lo">正在处理: ${p.currentFile || '准备中...'}</span>
            <span class="preload-monitor__bytes num">已下载: ${mbDownloaded} MB</span>
          </div>
        </div>
      ` : null}

      ${p.lastError ? html`<div class="preload-error">❌ ${p.lastError}</div>` : null}
    </div>
  <//>`;
}

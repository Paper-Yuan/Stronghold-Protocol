// public/js/ui/preloadModal.js — 客户端资源预载与离线缓存管理器 (Preload & Cache Center)
import { useState, useEffect, useRef } from '../../vendor/hooks.module.js';
import { html, Modal, Button, Icon, MicroLabel, ProgressBar } from './components.js';
import { data, loadData } from '../data.js';
import { net } from '../net.js';
import { store } from '../store.js';

const CACHE_NAME = 'stronghold-assets-v0.2.1';
const PRELOAD_STORAGE_KEY = 'sp_preloaded_profiles';

/**
 * Extract URLs for Core and Full profiles from assets data.
 * Exported for the bundle-size audit script (tools/preload-sizes.mjs) and tests.
 * @param {any} assets
 * @param {any} skinsData
 */
export function extractUrls(assets, skinsData, currentDiyPicks = null) {
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

  // 4. Skills (524 款全量干员技能图标，包含全部自选 6★ 干员 S1~S3 专属技能)
  if (assets.skills && typeof assets.skills === 'object') {
    for (const u of Object.values(assets.skills)) {
      if (typeof u === 'string') {
        coreSet.add(u);
        fullSet.add(u);
      }
    }
  }

  // 5. Tokens (召唤物，如 Mon3tr、流形、无人机、咪波等)
  if (assets.tokens && typeof assets.tokens === 'object') {
    for (const t of Object.values(assets.tokens)) {
      if (t.avatar) { coreSet.add(t.avatar); fullSet.add(t.avatar); }
      if (t.spine) {
        if (t.spine.skel) fullSet.add(t.spine.skel);
        if (t.spine.atlas) fullSet.add(t.spine.atlas);
        if (Array.isArray(t.spine.textures)) t.spine.textures.forEach((u) => fullSet.add(u));
      }
    }
  }

  // 6. Items (模组/装备), Bonds (盟约), Bands (战术策略), Professions (职业分支图标)
  for (const group of ['items', 'bonds', 'bands']) {
    if (assets[group] && typeof assets[group] === 'object') {
      for (const u of Object.values(assets[group])) {
        if (typeof u === 'string') {
          coreSet.add(u);
          fullSet.add(u);
        }
      }
    }
  }
  if (assets.prof && typeof assets.prof === 'object') {
    for (const sub of Object.values(assets.prof)) {
      if (sub && typeof sub === 'object') {
        for (const u of Object.values(sub)) {
          if (typeof u === 'string') {
            coreSet.add(u);
            fullSet.add(u);
          }
        }
      }
    }
  }

  // 7. 当前自选编队特惠优先预载 (玩家已选 4 名自选干员的 Spine/立绘即使在基础包也完全纳入)
  if (currentDiyPicks && typeof currentDiyPicks === 'object') {
    for (const pick of Object.values(currentDiyPicks)) {
      const charId = typeof pick === 'string' ? pick : pick?.charId;
      const c = charId && assets.chars ? assets.chars[charId] : null;
      if (c) {
        if (c.portrait) coreSet.add(c.portrait);
        if (c.portraitE2) coreSet.add(c.portraitE2);
        if (c.spine) {
          for (const part of ['front', 'back']) {
            const sp = c.spine[part];
            if (sp) {
              if (sp.skel) coreSet.add(sp.skel);
              if (sp.atlas) coreSet.add(sp.atlas);
              if (Array.isArray(sp.textures)) sp.textures.forEach((t) => coreSet.add(t));
            }
          }
        }
        if (c.skins && typeof c.skins === 'object') {
          for (const sk of Object.values(c.skins)) {
            if (sk.spine?.front) {
              const sp = sk.spine.front;
              if (sp.skel) coreSet.add(sp.skel);
              if (sp.atlas) coreSet.add(sp.atlas);
              if (Array.isArray(sp.textures)) sp.textures.forEach((t) => coreSet.add(t));
            }
          }
        }
      }
    }
  }

  // 8. Audio & SFX
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

  async start(profile = 'core', opts = {}) {
    if (this.status === 'downloading') return;
    const isBg = !!opts.background;
    /** 后台模式下的两阶段流水线衔接（checkAutoPreload）：core 完成后自动链式启动 full。 */
    this.autoChain = !!opts.autoChain;
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

      let currentDiy = null;
      try {
        const rawDiy = localStorage.getItem('sp.pref.diy');
        if (rawDiy) {
          const parsed = JSON.parse(rawDiy);
          currentDiy = parsed?.picks || parsed;
        }
      } catch {}

      const urls = extractUrls(safeAssets, safeSkins, currentDiy)[profile] || [];
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

      // Parallel download worker pool. Background mode adapts to the match: COMBAT 阶段降为 1 个并发，不与
      // WebSocket 的战斗快照/指令流量抢带宽（OPTIMIZATION_AND_PR_PLAN §2.2.2-1）；其余阶段 3~4 个。
      const BASE_CONCURRENCY = isBg ? 4 : 6;
      let activeIndex = 0;
      let lastSpeedMeasure = Date.now();
      let bytesSinceMeasure = 0;

      const bgConcurrency = () => {
        if (!isBg) return 6;
        try {
          const phase = store?.get?.().match?.public?.phase;
          if (phase === 'COMBAT') return 1;
        } catch {}
        return 4;
      };

      const worker = async (workerId) => {
        while (activeIndex < urls.length && !this.isPaused) {
          // 战斗期自适应降并发：超出当前限额的 worker 在此让出，每 500ms 复查（平滑升降，不打断在途文件）
          if (isBg && workerId >= bgConcurrency()) {
            await new Promise((r) => setTimeout(r, 500));
            continue;
          }
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

      const workers = Array.from({ length: Math.min(BASE_CONCURRENCY, urls.length) }, (_, i) => worker(i));
      await Promise.all(workers);

      if (this.isPaused) {
        this.status = 'paused';
        this.notify();
      } else {
        this.status = 'completed';
        this.speedBps = 0;
        this._saveProfileDone(profile);
        try {
          const bundleVal = profile === 'full' ? 'web_full' : 'web_core';
          net.sendClientBundle(bundleVal);
        } catch {}
        this.notify();
        // 两阶段流水线：core 完成 → 自动无缝衔接 full（均为后台静默模式，全程无需点击）
        if (this.autoChain && profile === 'core' && !this.cachedProfiles.full) {
          console.log('[preload] Core done — chaining into the full bundle automatically');
          this.start('full', { background: true, autoChain: false });
        }
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
              <span class="preload-card__size">~93 MB · 2050 文件</span>
            </div>
            <div class="preload-card__detail">
              包含：全部界面 UI、干员基础/精二头像、524款全干员技能图标（含自选干员专属技能）、召唤物、时装缩略图、当前自选编队干员Spine与音效。
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
              <span class="preload-card__size">~430 MB · 4250 文件</span>
            </div>
            <div class="preload-card__detail">
              包含：在核心包基础上，追加全部干员（含71名6★自选干员池）与敌方战斗 Spine 骨骼模型、高精度立绘、全阶段战斗 BGM 与干员语音。
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

const AUTO_NOTICE_DISMISSED_KEY = 'sp_preload_notice_dismissed';

/**
 * Check and start auto preloading for web players in the background (OPTIMIZATION_AND_PR_PLAN §2.2).
 * 两阶段流水线：进入网页端后自动启动 core（后台静默）→ core 完成后自动衔接 full（同样后台静默），
 * 全程无感、无需点击；战斗阶段引擎自动降并发（见 start() 的 bgConcurrency）。
 */
let autoPreloadTriggered = false;
export function checkAutoPreload() {
  if (autoPreloadTriggered) return;
  autoPreloadTriggered = true;

  const isAndroid = typeof globalThis.AndroidNative?.isNativeApp === 'function'
    ? globalThis.AndroidNative.isNativeApp()
    : false;
  if (isAndroid) return;

  // full 已缓存：直接就绪（hello 时会自动上报 web_full，无需再动）
  if (preloadEngine.cachedProfiles.full) return;

  // core 已缓存但 full 未缓存：继续补全 full
  if (preloadEngine.cachedProfiles.core) {
    setTimeout(() => {
      if (preloadEngine.status === 'idle') {
        console.log('[preload] Core already cached — auto preloading the full bundle...');
        preloadEngine.start('full', { background: true, autoChain: false });
      }
    }, 1200);
    return;
  }

  // 全新玩家：延时 1.2s 后启动 core → full 两阶段流水线
  setTimeout(() => {
    if (preloadEngine.status === 'idle') {
      console.log('[preload] Starting automatic background preload (core → full pipeline)...');
      preloadEngine.start('core', { background: true, autoChain: true });
    }
  }, 1200);
}

/**
 * Non-blocking interactive notification banner on title screen.
 */
export function PreloadAutoNotice({ onOpenManage }) {
  const p = usePreloadState();
  const [dismissed, setDismissed] = useState(() => {
    try {
      return localStorage.getItem(AUTO_NOTICE_DISMISSED_KEY) === '1';
    } catch {
      return false;
    }
  });

  const isAndroid = typeof globalThis.AndroidNative?.isNativeApp === 'function'
    ? globalThis.AndroidNative.isNativeApp()
    : false;

  // Don't show on Android (which has full local assets) or if already dismissed or if full is cached
  if (isAndroid || dismissed || p.cachedProfiles.full) {
    return null;
  }

  const handleDismiss = () => {
    setDismissed(true);
    try {
      localStorage.setItem(AUTO_NOTICE_DISMISSED_KEY, '1');
    } catch {}
  };

  const pct = p.totalCount > 0 ? Math.round((p.doneCount / p.totalCount) * 100) : 0;
  const isDownloading = p.status === 'downloading';
  const isCompleted = p.status === 'completed' || p.cachedProfiles.core;

  return html`<div class="preload-auto-notice" role="status" aria-live="polite">
    <div class="preload-auto-notice__glow"></div>
    <div class="preload-auto-notice__body">
      <div class="preload-auto-notice__head">
        <span class="preload-auto-notice__badge">
          ${isCompleted ? '✓ 基础包就绪' : isDownloading ? '⚡ 自动预载中' : '💡 离线加速建议'}
        </span>
        <button type="button" class="preload-auto-notice__close" onClick=${handleDismiss} title="关闭提示">✕</button>
      </div>
      <div class="preload-auto-notice__content">
        ${isCompleted
          ? '基础素材（UI/技能/召唤物/自选干员）已就绪！全量包正在后台继续静默补全。'
          : isDownloading
          ? html`<div>正在后台静默下载资源包（不影响当前游玩）<b class="num ml-1">${pct}%</b></div>`
          : '已自动为您启动后台资源预载（核心包 → 全量包），对局零卡顿。您可直接开始游戏！'}
      </div>
      ${isDownloading ? html`
        <div class="preload-auto-notice__bar">
          <div class="preload-auto-notice__bar-fill" style=${`width: ${pct}%`}></div>
        </div>
      ` : null}
      <div class="preload-auto-notice__actions">
        <button type="button" class="preload-auto-notice__btn preload-auto-notice__btn--primary"
          onClick=${onOpenManage}>
          全量预载 / 管理
        </button>
        <button type="button" class="preload-auto-notice__btn preload-auto-notice__btn--ghost"
          onClick=${handleDismiss}>
          知道了
        </button>
      </div>
    </div>
  </div>`;
}


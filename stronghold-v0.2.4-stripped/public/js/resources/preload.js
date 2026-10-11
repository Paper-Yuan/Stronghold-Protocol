import { loadCdnConfig, cdnResource, waitCdnWorker } from './cdn.js';
import { resourceContext, resetResourceContext, DOWNLOAD_LOCK } from './index.js';
import { activateResourceWorker } from './worker.js';
import { importedReceipt, importResourcePack, sha256 } from './bundle.js';
import { CACHE_NAME, absoluteUrl, indexUrl, isQuotaError, checkAbort } from './common.js';

export class PreloadEngine {
  constructor({ context = resourceContext, worker = activateResourceWorker } = {}) {
    Object.assign(this, { context, worker });
    this.selectedProfile = this.profile = 'full';this.status = 'idle';this.stage = '';
    this.totalCount = this.doneCount = this.checkedCount = this.doneBytes = this.totalBytes = 0;
    this.speedBps = 0;this.currentFile = '';this.lastError = null;
    this.cachedProfiles = { core: false, full: false };this.workerReady = false;
    this.required = true;this.bundled = false;this.listeners = new Set();this.finished = Promise.resolve();
    this.controller = null;this.net = null;this.manifest = null;this.admitted = false;this.onlineMode = false;
  }
  get fullReady() { return (this.onlineMode || this.cachedProfiles.full) && this.workerReady && this.admitted; }
  get entryReady() { return this.fullReady; }
  subscribe(fn) { this.listeners.add(fn);return () => this.listeners.delete(fn); }
  notify() { for (const fn of [...this.listeners]) fn(this); }
  require() { this.required = true; }
  useBundledAssets() { this.lastError = '必须导入 QQ 群提供的完整资源包';this.notify(); }
  bindNetwork(net) {
    if (this.net) return;
    this.net = net;
    net.on('resource.challenge', msg => { this.challenge = msg;this.admitted = false;this.prove();this.notify(); });
    net.on('resource.accepted', msg => { this.admitted = msg.version === this.manifest?.version;this.notify(); });
    net.on('resource.rejected', () => { this.admitted = false;this.lastError = '资源验证未通过，请重新导入完整资源包';this.notify(); });
    net.on('status', s => {
      if (!['connected','online'].includes(s.status)) { this.admitted = false;this.challenge = null;this.notify(); }
      else if (!this.admitted && (this.onlineMode || this.cachedProfiles.full)) this.prove();
    });
  }
  async prove() {
    if (this.proving || !(this.onlineMode || this.cachedProfiles.full) || !this.workerReady || this.admitted || !this.net) return;
    if (!this.challenge || this.challenge.expiresAt < Date.now() + 1000) {
      this.net.sendResourceMessage({ t: 'resource.challenge.request' });return;
    }
    const challenge = this.challenge;
    if (challenge.version !== this.manifest?.version || !Array.isArray(challenge.files) || challenge.files.length !== 3) return;
    this.proving = true;
    try {
      const cache = await caches.open(CACHE_NAME), proofs = [];
      for (const path of challenge.files) {
        const file = this.manifest.files.find(f => f.url === path);
        if (!file) throw new Error('资源验证清单不匹配');
        let response = await cache.match(absoluteUrl(path));
        if (response?.headers.get('X-SP-Resource-Hash') !== file.hash) response = null;
        if (!response) {
          await loadCdnConfig();await waitCdnWorker();this.onlineMode = true;
          response = await cdnResource(path);
          try { await cache.put(absoluteUrl(path), response.clone()); } catch {}
        }
        const digest = await sha256(await response.arrayBuffer());
        proofs.push(await sha256(new TextEncoder().encode(`${challenge.nonce}\n${path}\n${digest}`)));
      }
      if (this.challenge === challenge) this.net.sendResourceMessage({ t: 'resource.proof', nonce: challenge.nonce, version: challenge.version, proofs });
    } catch (err) { this.admitted = false;this.cachedProfiles.full = false;this.onlineMode = false;this.lastError = err.message; }
    finally { this.proving = false;this.notify();if (this.challenge !== challenge) this.prove(); }
  }
  selectProfile() { return this.finished; }
  start() { return this.checkEntry(); }
  resume() { return this.checkEntry(); }
  checkFull() { return this.checkEntry({ full: true }); }
  async checkEntry({ full = false } = {}) {
    await this.finished;
    if (this.controller) return this.finished;
    return this.task(async signal => {
      const ctx = await this.context();if (!ctx.store) throw new Error(ctx.error || ctx.unsupported || '资源清单不可用');
      this.manifest = ctx.manifest;this.totalCount = ctx.manifest.files.length;this.totalBytes = ctx.manifest.totalBytes;
      this.cachedProfiles = { core: false, full: false };this.admitted = false;
      this.onlineMode = false;
      if (!await importedReceipt(ctx.manifest)) {
        this.stage = '正在连接在线资源 CDN…';this.notify();
        await loadCdnConfig();checkAbort(signal);
        await this.worker(signal);await waitCdnWorker(signal);checkAbort(signal);
        this.workerReady = true;this.onlineMode = true;this.status = 'online';
        this.stage = '在线资源已连接，进入游戏后按需加载';this.prove();return true;
      }
      // The receipt is written only after every imported file passed hashing and saving.
      // Reuse its matching index without reading thousands of resource bodies again.
      const cache = await caches.open(CACHE_NAME);
      let index;try { index = await (await cache.match(indexUrl()))?.json(); } catch {}
      const indexReady = index?.version === 1 && index.manifest === ctx.manifest.version &&
        ctx.manifest.files.every(f => index.files?.[absoluteUrl(f.url)] === f.hash);
      if (!full && indexReady) {
        checkAbort(signal);this.stage = '正在复用已校验资源记录…';
        await this.worker(signal);checkAbort(signal);this.workerReady = true;
        this.doneCount = this.totalCount;this.doneBytes = this.totalBytes;
        this.cachedProfiles = { core: true, full: true };this.status = 'completed';this.prove();return true;
      }
      const state = await ctx.store.status({ signal, onProgress: p => {
        this.checkedCount = p.checked;this.doneCount = p.count;this.doneBytes = p.bytes;
        this.stage = `正在检查已导入资源 ${p.checked}/${this.totalCount}…`;this.notify();
      }});
      this.cachedProfiles.full = state.complete && state.count === this.totalCount;
      this.cachedProfiles.core = this.cachedProfiles.full;
      if (!this.cachedProfiles.full) { await loadCdnConfig();await this.worker(signal);await waitCdnWorker(signal);this.workerReady = true;this.onlineMode = true;this.status = 'online';this.prove();return true; }
      await this.worker(signal);this.workerReady = true;this.status = 'completed';this.prove();return true;
    });
  }
  importFile(file) {
    this.pause();const previous = this.finished;
    this.finished = previous.then(() => this.task(async signal => {
      const ctx = await this.context();if (!ctx.store) throw new Error(ctx.error || ctx.unsupported || '资源清单不可用');
      this.manifest = ctx.manifest;this.totalCount = ctx.manifest.files.length;this.totalBytes = ctx.manifest.totalBytes;
      this.cachedProfiles = { core: false, full: false };this.admitted = false;
      this.doneCount = this.doneBytes = this.checkedCount = this.speedBps = 0;
      this.net?.sendResourceMessage({ t: 'resource.reset' });
      const job = () => importResourcePack(file, ctx.manifest, { signal, onProgress: p => {
        this.status = 'importing';this.doneCount = p.count;this.doneBytes = p.bytes;this.speedBps = p.speedBps || 0;this.currentFile = p.current.split('/').pop();this.notify();
      }});
      try { navigator.storage?.persist?.().catch(() => {}); } catch {}
      const result = navigator.locks?.request ? await navigator.locks.request(DOWNLOAD_LOCK, { signal }, job) : await job();
      checkAbort(signal);await this.worker(signal);this.workerReady = true;
      this.doneCount = result.count;this.doneBytes = result.bytes;
      this.cachedProfiles = { core: true, full: true };this.status = 'completed';this.prove();return true;
    }));
    return this.finished;
  }
  task(job) {
    const controller = new AbortController();this.controller = controller;
    this.status = 'scanning';this.stage = '正在读取资源清单…';this.lastError = null;this.notify();
    const running = Promise.resolve().then(() => job(controller.signal)).catch(err => {
      this.cachedProfiles = { core: false, full: false };this.admitted = false;
      this.status = err.name === 'AbortError' ? 'paused' : 'error';
      this.lastError = err.name === 'AbortError' ? '导入已暂停，重新选择同一资源包可继续' : isQuotaError(err)
        ? '浏览器存储空间不足，请腾出至少 2 GB 空间后重新导入' : err.message;
      if (err.name !== 'AbortError') resetResourceContext();return false;
    }).finally(() => { if (this.controller === controller) this.controller = null;this.notify(); });
    this.finished = running;return running;
  }
  pause() { this.controller?.abort(); }
  async clearCache() {
    this.pause();await this.finished;
    this.cachedProfiles = { core: false, full: false };this.admitted = false;
    this.net?.sendResourceMessage({ t: 'resource.reset' });
    await caches.delete(CACHE_NAME);this.onlineMode = false;this.status = 'missing';this.doneCount = this.doneBytes = 0;this.notify();
  }
}
export const preloadEngine = new PreloadEngine();

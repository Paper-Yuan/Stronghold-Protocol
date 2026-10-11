import { useState, useEffect } from '../../vendor/hooks.module.js';

import { html, Modal, Button, ProgressBar } from './components.js';

import { preloadEngine } from '../resources/preload.js';

export { preloadEngine } from '../resources/preload.js';

export function usePreloadState() {

  const [, setTick] = useState(0);

  useEffect(() => { const off = preloadEngine.subscribe(() => setTick(n => n + 1));setTick(n => n + 1);return off; }, []);

  return preloadEngine;

}

export function PreloadPill({ onClick }) {

  const p = usePreloadState(), busy = ['scanning','importing'].includes(p.status);

  return html`<button type="button" class=${`preload-pill ${p.entryReady ? 'is-ready' : busy ? 'is-loading' : ''}`} onClick=${onClick}>

    <span class="preload-pill__dot"></span><span class="preload-pill__text">${p.entryReady ? (p.onlineMode ? '在线资源已就绪' : '资源包已导入') : busy ? '正在准备资源' : p.onlineMode ? '正在验证在线资源' : '连接在线资源'}</span>

  </button>`;

}

export function PreloadModal({ open, onClose, required = false, onContinue }) {

  const p = usePreloadState(), busy = ['scanning','importing','clearing'].includes(p.status);

  const pct = p.totalCount ? Math.round(p.doneCount / p.totalCount * 100) : 0;

  const close = () => { p.pause();onClose?.(); };

  return html`<${Modal} open=${open} onClose=${close} closeOnBackdrop=${true}

    title="资源加载与本地资源包" micro="ONLINE / LOCAL RESOURCES" class="resource-import-modal" width="min(720px, 94vw)"

    actions=${html`<div style="display:flex;gap:8px;flex-wrap:wrap;width:100%;justify-content:space-between;">

      <${Button} variant="secondary" disabled=${busy} onClick=${() => p.clearCache()}>清除本机资源<//>

      <div style="display:flex;gap:8px;flex-wrap:wrap;">

        <${Button} variant="secondary" disabled=${busy} onClick=${() => p.checkFull()}>重新检查资源<//>

        ${required ? html`<${Button} variant="primary" disabled=${!p.entryReady} onClick=${() => onContinue?.()}>资源就绪，进入游戏<//>` : null}

        <${Button} variant="secondary" onClick=${close}>关闭<//>

      </div></div>`}>

    <div class="preload-content">
      <div style="display:flex;justify-content:center;margin:12px 0 20px;">
        <${Button} variant="primary" disabled=${busy} onClick=${() => p.start()}
          style="width:min(100%,420px);min-height:64px;padding:16px 28px;font-size:22px;font-weight:800;">连接在线资源<//>
      </div>

      <style>${`

        .resource-import-modal .modal__title { font-size:18px; }

        .resource-import-modal .micro { font-size:10px; }

        .resource-import-modal .modal__head { padding:12px 16px 4px; }

        .resource-import-modal .modal__body { min-height:0;padding:8px 16px 16px; }

        .resource-import-modal .modal__actions { padding:12px 16px; }

        .resource-import-modal .preload-content,.resource-import-modal .preload-desc { font-size:14px;line-height:1.55; }

        .resource-import-modal .btn { font-size:14px;min-height:40px;padding:0 12px; }

        .resource-import-modal .preload-monitor__header,.resource-import-modal .preload-monitor__footer { font-size:12px; }

      `}</style>

      <p class="preload-desc"><b>推荐点击中间的“连接在线资源”按钮，无需导入资源包即可游玩。</b> 在线资源首次使用会自动下载并缓存；网络较差时，可从 <b>QQ群 1074985123</b> 下载完整资源包，选择 <b>.spresources</b> 文件导入，<b>无需解压</b>。

        无需手动导入即可游玩；默认使用 CDN 在线加载。导入完成后，同一浏览器会自动复用已校验记录，无需每次扫描全部资源；连接时仅进行少量抽查。</p>

      <label for="sp-resource-file" style="display:block;margin:12px 0 4px;font-weight:bold;">备用：选择资源包并导入（打开系统文件）</label>

      <input id="sp-resource-file" type="file" disabled=${busy} aria-label="选择资源包并导入"

        style="display:block;width:100%;max-width:100%;padding:10px 0;font-size:14px;color:inherit;" onChange=${ev => {

        const file = ev.currentTarget.files?.[0];ev.currentTarget.value = '';if (file) p.importFile(file);

      }} />

      <p class="preload-desc">这是本机导入，<b>不会把资源包上传到服务器</b>。支持断点续导：关闭或中断后，重新选择同一个资源包，已保存的文件会校验后复用。手机切到后台可能暂停，网页关闭后不会继续导入。

        文件选择没有反应时，请在独立浏览器中打开网页；先把 QQ 下载的资源包保存到系统“下载”文件夹，再从“文件 / 浏览”中选择。</p>

      <div class="preload-card is-selected" style="padding:16px;display:block;">

        <b>完整资源包 · 全模型 / 图片 / 音乐 / 语音 / 字体</b>

        <p style="margin:8px 0;">约 808 MB，建议预留至少 2 GB 可用空间。更换浏览器或清理站点数据后，可继续在线加载，也可重新导入本地包。</p>

        <p style="margin:8px 0;font-weight:bold;color:var(--mint, #51d8b3);">QQ群：1074985123 · 进群获取完整资源包</p>

      </div>

      ${!p.onlineMode && (busy || p.totalCount) ? html`<div class="preload-monitor" aria-live="polite">

        <div class="preload-monitor__header"><span>${p.status === 'importing' ? '正在逐个校验并保存资源…' : p.status === 'scanning' ? p.stage : p.entryReady ? '完整资源包校验通过' : p.cachedProfiles.full ? '本机资源就绪，正在验证连接…' : '请选择完整资源包导入'}</span>

          <span class="num">${p.doneCount} / ${p.totalCount} · ${pct}%</span></div>

        <${ProgressBar} value=${pct} max=${100} tone="mint" size="md" />

        <div class="preload-monitor__footer"><span>${p.currentFile}</span><span>${(p.doneBytes / 1024 / 1024).toFixed(1)} MB${p.status === 'importing' && p.speedBps > 0 ? ` · 本机 ${(p.speedBps / 1024 / 1024).toFixed(1)} MB/s` : ''}</span></div>

      </div>` : null}

      ${p.lastError ? html`<div class="preload-error">${p.lastError}</div>` : null}

    </div>

  <//>`;

}

export function RequiredPreload() { return null; }


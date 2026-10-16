// Design-system server redirect modal on overcapacity (>60 humans in rooms).
// Matches Stronghold Protocol's terminal aesthetic (Modal, brackets, MicroLabel, techno buttons).

import { html, Modal, Button, Icon, MicroLabel } from './components.js';
import { GAME_NODES, serverEntryUrl } from '../../shared/serverSelection.js';
import { t } from '../../shared/i18n.js';
import { store } from '../store.js';

/**
 * Server redirect modal shown when the server is crowded (>60 humans in active rooms).
 * @param {{
 *   open: boolean,
 *   onClose: () => void,
 *   activeHumans?: number,
 *   maxPlayingHumans?: number,
 * }} props
 */
export function ServerRedirectModal({ open, onClose, activeHumans = 60, maxPlayingHumans = 60 }) {
  if (!open) return null;

  const currentHost = typeof window !== 'undefined' ? window.location.hostname : '';
  const myName = store.get()?.me?.name || '';

  const handleRedirect = (url) => {
    let target = url;
    if (myName) {
      target += (target.includes('#') ? '&' : '#') + 'sp-enter=' + encodeURIComponent(myName.slice(0, 64));
    }
    window.location.href = target;
  };

  const navUrl = 'https://wei.isomer319.xyz/';

  return html`<${Modal}
    open=${open}
    tone="gold"
    micro="OVERCAPACITY REDIRECT // 节点分流引导"
    title=${t('同盟超载 · 建议前往其他服务器')}
    onClose=${onClose}
    width="min(6.2rem, 92vw)"
    actions=${html`
      <${Button} variant="secondary" onClick=${onClose}>
        ${t('暂留本服观望')}
      <//>
      <${Button} variant="primary" icon="chevronRight" onClick=${() => window.open(navUrl, '_blank')}>
        ${t('查看全服状态站')}
      <//>
    `}>
    <div class="srm-content" style="display:flex; flex-direction:column; gap:.16rem; font-size:max(.14rem, 13px); line-height:1.6; color:var(--text-md, #c5cac5);">
      <div class="srm-notice" style="background:rgba(235,160,32,0.08); border-left:3px solid var(--gold, #e8a838); padding:.1rem .14rem; border-radius:2px;">
        <div style="font-weight:700; color:var(--gold, #e8a838); margin-bottom:.04rem;">
          ${t('当前服务器房间内真人玩家已达上限（{count} / {max} 人）', { count: activeHumans, max: maxPlayingHumans })}
        </div>
        <div>
          ${t('为保障同盟对局稳定、防止网络丢包及延迟波动，建议新进入大厅的博士前往其他空闲服务器节点游玩。')}
        </div>
      </div>

      <div style="font-size:max(.12rem, 11px); color:var(--text-sub, #7e8781); letter-spacing:.05em; text-transform:uppercase;">
        <${MicroLabel}>RECOMMENDED NODES // 推荐可用节点<//>
      </div>

      <div class="srm-nodes" style="display:flex; flex-direction:column; gap:.1rem;">
        ${GAME_NODES.map((node) => {
          let isCurrent = false;
          try {
            const u = new URL(node.url);
            isCurrent = u.hostname === currentHost;
          } catch {
            isCurrent = false;
          }

          return html`<div key=${node.id} class="srm-node-card brackets" style="display:flex; align-items:center; justify-content:space-between; padding:.12rem .16rem; background:rgba(20,25,23,0.85); border:1px solid ${isCurrent ? 'var(--text-sub, #555)' : 'rgba(100,220,160,0.25)'}; border-radius:3px;">
            <div style="display:flex; flex-direction:column; gap:.02rem;">
              <div style="display:flex; align-items:center; gap:.08rem;">
                <span style="font-weight:700; color:var(--text-hi, #fff); font-size:max(.16rem, 14px);">${node.name}</span>
                ${node.voice ? html`<span class="srm-badge" style="font-size:10px; padding:1px 5px; background:rgba(78,212,160,0.15); color:var(--mint, #4ed4a0); border:1px solid rgba(78,212,160,0.3); border-radius:2px;">语音支持</span>` : null}
                ${isCurrent ? html`<span style="font-size:10px; padding:1px 5px; background:rgba(255,255,255,0.08); color:var(--text-sub, #888); border-radius:2px;">当前所在</span>` : null}
              </div>
              <div style="font-size:max(.12rem, 11px); color:var(--text-sub, #7e8781); font-family:var(--font-mono, monospace);">
                ${node.url}
              </div>
            </div>

            <div>
              ${isCurrent ? html`
                <${Button} variant="secondary" size="sm" disabled=${true}>
                  ${t('当前节点')}
                <//>
              ` : html`
                <${Button} variant="primary" size="sm" icon="chevronRight" onClick=${() => handleRedirect(node.url)}>
                  ${t('一键前往')}
                <//>
              `}
            </div>
          </div>`;
        })}
      </div>
    </div>
  <//>`;
}

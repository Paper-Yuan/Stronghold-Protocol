import { useEffect, useState } from '../../vendor/hooks.module.js';
import { html } from './components.js';
import { GAME_NODES, STATUS_ORIGIN, nodeForHost, normalizeNodeStatus, recommendNode } from '../../../shared/serverSelection.js';

export const currentGameNode = () => nodeForHost(globalThis.location?.hostname);
const PRESSURE = { low: '流畅', moderate: '中等', busy: '繁忙', unknown: '检查中' };

export async function probeNode(node, fetchFn = globalThis.fetch) {
  const ctrl = new AbortController(), timer = setTimeout(() => ctrl.abort(), 3500);
  try {
    const r = await fetchFn(STATUS_ORIGIN + '/server-status/' + node.id, { cache: 'no-store', signal: ctrl.signal });
    if (!r.ok) throw new Error('unavailable');
    return normalizeNodeStatus(await r.json());
  } catch { return { available: false, receivedAt: Date.now() }; }
  finally { clearTimeout(timer); }
}

export function ServerPicker({ selected = currentGameNode(), onSelect, locked = false, compact = false }) {
  const [statuses, setStatuses] = useState({});
  useEffect(() => {
    let cancelled = false, timer;
    const poll = async () => {
      if (document.visibilityState !== 'hidden') {
        const rows = await Promise.all(GAME_NODES.map(node => probeNode(node)));
        if (!cancelled) setStatuses(Object.fromEntries(GAME_NODES.map((n,i) => [n.id,rows[i]])));
      }
      if (!cancelled) timer = setTimeout(poll, 10000);
    };
    poll();return () => { cancelled = true; clearTimeout(timer); };
  }, []);
  if (!currentGameNode()) return null;
  const recommended = recommendNode(statuses);
  return html`<section class=${'server-picker' + (compact ? ' server-picker--compact' : '')} aria-label="选择游戏服务器">
    <div class="server-picker__heading"><strong>${compact ? '双服统一大厅' : '统一大厅 · 选择接入节点'}</strong><span>${compact ? '10 秒更新' : '人数与压力 · 每 10 秒更新'}</span></div>
    <div class="server-picker__cards">
      ${GAME_NODES.map(node => {
        const s = statuses[node.id], known = !!s, available = s?.available;
        const active = selected === node.id;
        return html`<button key=${node.id} type="button" class=${`server-card${active ? ' is-selected' : ''}`}
          data-node=${node.id} aria-pressed=${active} disabled=${locked && !active || known && !available && !active}
          onClick=${() => onSelect?.(node.id)}
          title=${`${node.voice ? '支持队友语音' : '文字交流'}；${available && s.matches != null ? s.matches + ' 场对局' : '状态检测中'}`}>
          <span class="server-card__top"><strong>${node.name}</strong>
            ${recommended === node.id ? html`<span class="server-card__recommend">推荐</span>` : null}
            ${compact ? html`<span class="server-card__count"><b>${available && s.online != null ? s.online : '—'}</b> 人</span>` : null}</span>
          ${compact ? null : html`<span class="server-card__count"><b>${available && s.online != null ? s.online : '—'}</b> 人在线
            <span class=${'server-card__pressure is-' + (s?.pressure || 'unknown')}>${available ? PRESSURE[s.pressure] : known ? '暂不可用' : '检测中'}</span></span>
          `}
          <span class="server-card__metrics">CPU ${available && s.cpuPercent != null ? s.cpuPercent + '%' : '—'} · 内存 ${available && s.memoryPercent != null ? s.memoryPercent + '%' : '—'}</span>
          ${compact ? html`<span class=${'server-card__pressure is-' + (s?.pressure || 'unknown')}>${available ? PRESSURE[s.pressure] : known ? '暂不可用' : '检测中'}</span>` : html`<span class="server-card__meta">${available && s.matches != null ? s.matches + ' 场对局 · ' : ''}${node.voice ? '支持队友语音' : '文字交流'}</span>`}
        </button>`;
      })}
    </div>
    ${compact ? null : html`<p class="server-picker__note">${locked ? '邀请会自动进入对应节点；对局期间请勿切换节点。' : '双服共用公开房间列表，加入同盟自动连接对应节点；创建同盟按压力分配，自动匹配按玩法分配。'}</p>`}
  </section>`;
}

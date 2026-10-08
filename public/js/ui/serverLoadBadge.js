// public/js/ui/serverLoadBadge.js — 右上角服务器负载微型状态胶囊（docs/OPTIMIZATION_AND_PR_PLAN.md §2.1.2-4）。
//
// 取代旧的阻塞式「⚠ 服务器高载荷预警」alertDialog：welcome / lobby.stats 推送 serverLoad 时，仅在大厅/标题屏
// 右上角显示一枚微型胶囊（⚠ 拥挤 / 红 高载），点击展开一行详情；正常状态不占任何空间。warning 级首次到达
// 仍有一条 8s toast 提醒（main.js），critical 不再弹窗打断游玩。

import { h } from '../../vendor/preact.module.js';
import { useEffect, useState } from '../../vendor/hooks.module.js';
import htm from '../../vendor/htm.module.js';
import { useStore, selectRoute } from '../store.js';

const html = htm.bind(h);

const TONE = {
  warning: { cls: 'srvload--warn', icon: '⚠', label: '服务器拥挤' },
  critical: { cls: 'srvload--crit', icon: '⛔', label: '服务器高载' },
};

/**
 * Server load pill: reads `store.serverLoad` (welcome frame / lobby.stats), renders nothing while normal.
 * Click toggles a one-line detail (online / ELS / CPU).
 */
export function ServerLoadBadge() {
  const load = useStore((s) => s.serverLoad);
  const route = useStore(selectRoute);
  const [open, setOpen] = useState(false);

  // Only on the non-game screens: never cover the battlefield HUD.
  const visible = !!load && load.status !== 'normal' && !['game'].includes(route);
  useEffect(() => { if (!visible) setOpen(false); }, [visible]);

  if (!visible) return null;
  const tone = TONE[load.status] || TONE.warning;
  return html`<div class="srvload">
    <button type="button" class=${`srvload__pill ${tone.cls}`} onClick=${() => setOpen(!open)} aria-expanded=${open}>
      <span class="srvload__icon" aria-hidden="true">${tone.icon}</span>
      <span class="srvload__label">${tone.label}</span>
      <span class="srvload__num num">${load.onlineCount ?? '—'}</span>
    </button>
    ${open ? html`<div class="srvload__detail" role="dialog" aria-label="服务器负载详情">
      <div>在线 <b class="num">${load.onlineCount ?? '—'}</b> 人 · 折算负载 <b class="num">${load.score ?? '—'}</b> / ${load.maxScore || 200}</div>
      <div>CPU <b class="num">${load.cpuPercent ?? '—'}%</b>${load.lagMs != null ? html` · 同步延迟 <b class="num">${load.lagMs}ms</b>` : null}</div>
      ${load.message ? html`<div class="srvload__msg">${load.message}</div>` : null}
    </div>` : null}
  </div>`;
}

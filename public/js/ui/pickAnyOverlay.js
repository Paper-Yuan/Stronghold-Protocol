// ui/pickAnyOverlay.js — 随机模式 R5 核心干员自选（无限火力 1.0）：全池浏览式选择任意 1 名干员。
// 服务端状态：m.private.pickAny（true = 机会待使用）；提交 g.pickAny { chessId }（ui/gameActions.js）。
// 列表来自 data('chess') 的可见普通干员（visible && !isGolden && !isDiy && !isHidden），按阶分组 + 阶筛选。

import { useMemo, useState } from '../../vendor/hooks.module.js';
import { html, Icon, Button, TierChip, MicroLabel } from './components.js';
import { Img } from './gameComponents.js';
import { chessAvatarUrl } from './assetUrls.js';
import { data } from '../data.js';

const cx = (...p) => p.flat().filter(Boolean).join(' ');

/** 可选干员列表（按 tier 升序，tier 内按名排序）。 */
function pickableChess() {
  const chess = data.get('chess');
  if (!chess || typeof chess !== 'object') return [];
  return Object.values(chess)
    .filter((c) => c && c.visible && !c.isGolden && !c.isDiy && !c.isHidden && Number.isInteger(c.tier))
    .sort((a, b) => (a.tier - b.tier) || String(a.name || '').localeCompare(String(b.name || ''), 'zh'));
}

/**
 * 全池干员选择弹窗。
 * @param {{ m?: any, onPick:(chessId:string)=>void, onClose:()=>void, busy?:boolean|string|null, disabled?:boolean }} props
 */
export function PickAnyOverlay({ m, onPick, onClose, busy = null, disabled = false }) {
  const list = useMemo(pickableChess, []);
  const tiers = useMemo(() => [...new Set(list.map((c) => c.tier))].sort((a, b) => b - a), [list]);
  const [tier, setTier] = useState(null);
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(null);
  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return list.filter((c) => (tier == null || c.tier === tier) && (!needle || String(c.name || '').toLowerCase().includes(needle) || String(c.appellation || '').toLowerCase().includes(needle)));
  }, [list, tier, q]);
  const pickBusy = busy === `pickany:${sel}`;
  return html`<div class="modal pkany-modal" role="presentation"
      onMouseDown=${(e) => { if (e.target === e.currentTarget && !disabled) onClose(); }}>
    <div class="modal__box pkany-modal__box brackets" role="dialog" aria-modal="true" aria-label="核心干员自选">
      <div class="modal__stripe" aria-hidden="true"></div>
      <header class="modal__head">
        <${MicroLabel} tone="gold">CORE OPERATOR PICK<//>
        <div class="pkany-modal__title-row">
          <h2 class="modal__title">核心干员自选</h2>
          <button type="button" class="pkany-modal__close" onClick=${onClose} disabled=${disabled} aria-label="关闭"><${Icon} name="close" /></button>
        </div>
        <p class="pkany-modal__hint">从全池指定获取任意 1 名干员（进入整备区；整备区满时无法获取）。</p>
      </header>
      <div class="pkany-modal__filters">
        <button type="button" class=${cx('pkany-tier', tier == null && 'is-on')} onClick=${() => setTier(null)}>全部</button>
        ${tiers.map((t) => html`<button key=${t} type="button" class=${cx('pkany-tier', tier === t && 'is-on')} onClick=${() => setTier(t)}>${t} 阶</button>`)}
        <input class="pkany-search" type="search" placeholder="搜索干员名" value=${q} onInput=${(e) => setQ(e.target.value)} />
      </div>
      <div class="pkany-modal__grid" role="listbox" aria-label="干员列表">
        ${shown.map((c) => html`<button key=${c.chessId || c.baseId} type="button" role="option" aria-selected=${sel === (c.chessId || c.baseId) ? 'true' : 'false'}
            class=${cx('pkany-card', sel === (c.chessId || c.baseId) && 'is-sel')} onClick=${() => setSel(c.chessId || c.baseId)}>
          <span class="pkany-card__ava"><${Img} src=${chessAvatarUrl(m, c)} fallback=${html`<b>${[...(c.name || '?')][0]}</b>`} /></span>
          <span class="pkany-card__name">${c.name}</span>
          <${TierChip} tier=${c.tier} size="sm" />
        </button>`)}
        ${shown.length === 0 ? html`<p class="pkany-modal__empty">没有匹配的干员</p>` : null}
      </div>
      <footer class="pkany-modal__foot">
        <${Button} variant="ghost" size="lg" onClick=${onClose} disabled=${disabled}>稍后再选<//>
        <${Button} variant="primary" size="lg" icon="check" loading=${!!pickBusy} disabled=${disabled || !sel}
          onClick=${() => sel && onPick(sel)}>获取该干员<//>
      </footer>
    </div>
  </div>`;
}

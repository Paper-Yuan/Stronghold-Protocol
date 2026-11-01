// public/js/ui/contractOverlay.js — 超限风险契约（业主 2026-10-26）
//
// Boss 轮 PREP 的三选一：加一只精英 / 限时 90 秒 / 敌方攻速 +20%，或「不签」按常规开战。
// 服务端 m.public.contractOffer = { round, cards:[{ id, name, text, reward }] }，选择后清空。
// 只影响本轮 Boss 波；不碰普通模式。

import { html } from './components.js';
import { t } from '../../../shared/i18n.js';

/**
 * @param {{ offer?: { round?: number, cards?: Array<{ id: string, name: string, text?: string, reward?: string }> }|null,
 *   busy?: boolean, onPick?: (id: string) => any }} props
 */
export function ContractOverlay({ offer = null, busy = false, onPick = null }) {
  const cards = Array.isArray(offer?.cards) ? offer.cards : [];
  if (!offer || !cards.length) return null;
  const pick = (id) => { if (!busy) onPick?.(id); };
  return html`<div class="ctrov" role="dialog" aria-modal="true" aria-label=${t('风险契约')} data-testid="contract-overlay">
    <div class="ctrov__veil"></div>
    <header class="ctrov__head">
      <div class="ctrov__micro">INFINITE PROTOCOL · CONTRACT</div>
      <div class="ctrov__title-row"><span class="ctrov__dia"></span><h2>${t('风险契约')}</h2><span class="ctrov__dia"></span></div>
      <div class="ctrov__rule"></div>
      <p class="ctrov__sub">${t('Boss 轮前加码换资源；契约只影响本轮。')}</p>
    </header>
    <div class="ctrov__cards">
      ${cards.map((c) => html`<button type="button" key=${c.id} class="ctrov__card" disabled=${busy}
          onClick=${() => pick(c.id)} data-contract=${c.id}>
        <span class="ctrov__kind">CONTRACT · ${String(c.id || '').toUpperCase()}</span>
        <span class="ctrov__name">${c.name}</span>
        <span class="ctrov__text">${c.text || ''}</span>
        <span class="ctrov__reward">${t('奖励')} · <b>${c.reward || ''}</b></span>
      </button>`)}
    </div>
    <div class="ctrov__foot">
      <button type="button" class="ctrov__skip" disabled=${busy} onClick=${() => pick('none')} data-contract="none">
        ${t('不签契约 · 常规开战')}
      </button>
    </div>
  </div>`;
}

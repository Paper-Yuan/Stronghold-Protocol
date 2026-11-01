// public/js/ui/infiniteHud.js — 超限模拟（solo_infinite）的两个 HUD 控件
//
// 业主 2026-10-20/21 定稿：顶栏右侧一枚 1×/2× 战斗倍速开关（只改战斗推进，倒计时仍按真实秒数），以及一枚
// 「本局词条」按钮 —— 点开是已选词条的完整列表。样式在 public/css/screens/game.css 的 `.gspeed*` / `.gtrait*`
// 段（含短屏与竖屏手机覆盖），这里只负责结构与开关状态。
//
// 服务端数据：m.public.speedPref（1 = 基准速，2 = 双倍；非超限局恒为 1）、m.public.traitMods
// （{ id, name, polarity, round, text? }[]，非超限局或还没有词条时不发送）。

import { useEffect, useRef, useState } from '../../vendor/hooks.module.js';
import { html } from './components.js';
import { t } from '../../../shared/i18n.js';

const cx = (...p) => p.flat().filter(Boolean).join(' ');

/**
 * 超限战斗倍速开关（1× / 2×）。`speed` 是 m.public.speedPref；点击发送 g.combatSpeed，服务端立即在作战阶段生效，
 * 休整期只记偏好。非超限局由调用方不渲染本组件。
 * @param {{ speed?: number, onSpeed?: (speed: number) => any }} props
 */
export function InfiniteSpeedToggle({ speed = 1, onSpeed = null }) {
  const fast = Number(speed) === 2;
  return html`<button type="button" class=${cx('gspeed', fast && 'is-fast')} aria-pressed=${fast ? 'true' : 'false'}
      title=${t('战斗倍速（只影响战斗推进，倒计时不变）')} data-testid="combat-speed"
      onClick=${() => onSpeed?.(fast ? 1 : 2)}>
    <span class="gspeed__cap">SPEED</span>
    <span class="gspeed__rail">
      <span class=${cx('gspeed__opt', !fast && 'is-on')}>1×</span>
      <span class=${cx('gspeed__opt', fast && 'is-on')}>2×</span>
      <span class="gspeed__thumb" aria-hidden="true"></span>
    </span>
  </button>`;
}

/**
 * Boss 词缀 pill（业主 2026-10-26）：超限 Boss 轮在顶栏右侧显示当前轮次的词缀。
 * `affix` = m.public.bossAffix；非 Boss 轮 / 普通模式没有该字段，调用方不渲染。
 * @param {{ affix?: { id?: string, name?: string, text?: string }|null }} props
 */
export function BossAffixPill({ affix = null }) {
  if (!affix || !affix.name) return null;
  return html`<span class="gaffix" title=${affix.text || affix.name} data-testid="boss-affix">
    <i>BOSS</i><b>${affix.name}</b>
  </span>`;
}

/**
 * 「本局词条」按钮 + 弹层：按回合列出本局已选的超限词条（正/负极性着色）。点击按钮开合，Esc 或点外部关闭。
 * `mods` 为空时不渲染（调用方也应避免渲染）。
 * @param {{ mods: Array<{ id?: string, name?: string, polarity?: string, round?: number, text?: string }> }} props
 */
export function TraitBadge({ mods = [] }) {
  const list = Array.isArray(mods) ? mods.filter((m) => m && typeof m === 'object') : [];
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => { if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('pointerdown', onDown, true);
    window.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);
  if (!list.length) return null;
  const rows = [...list].sort((a, b) => (Number(a.round) || 0) - (Number(b.round) || 0));
  const pos = rows.filter((m) => m.polarity !== 'neg').length;
  const neg = rows.filter((m) => m.polarity === 'neg').length;
  return html`<div class="gtrait" ref=${rootRef} data-testid="trait-badge">
    <button type="button" class=${cx('gtrait__btn', open && 'is-open')} aria-expanded=${open ? 'true' : 'false'}
        aria-label=${t('本局词条')} title=${t('本局词条')} onClick=${() => setOpen((v) => !v)}>
      <span class="gtrait__ico" aria-hidden="true">∞</span><span>${t('词条')}</span><b>${rows.length}</b>
    </button>
    ${open ? html`<div class="gtrait__pop" role="dialog" aria-label=${t('本局词条')}>
      <div class="gtrait__head">
        <div class="gtrait__title">
          <span class="gtrait__micro">INFINITE PROTOCOL</span>
          <b>${t('本局词条')}</b>
        </div>
        <button type="button" class="gtrait__x" aria-label=${t('关闭')} title=${t('关闭')} onClick=${() => setOpen(false)}>✕</button>
      </div>
      <div class="gtrait__tally">
        <div class="gtrait__tal is-pos"><b>${pos}</b><i>${t('正面')}</i></div>
        <div class="gtrait__tal is-neg"><b>${neg}</b><i>${t('负面')}</i></div>
        <div class="gtrait__tal is-total"><b>${rows.length}</b><i>${t('合计')}</i></div>
      </div>
      <ul class="gtrait__list">
        ${rows.map((m, i) => html`<li key=${`${m.round}:${m.id || i}`} class=${cx('gtrait__row', m.polarity === 'neg' && 'is-neg')}>
          <span class="gtrait__r">R${Number.isFinite(Number(m.round)) ? m.round : '--'}</span>
          <span class="gtrait__n">${m.name || m.id || ''}</span>
          <span class="gtrait__t">${m.text || ''}</span>
        </li>`)}
      </ul>
      <div class="gtrait__note">${t('每通过一次 Boss 轮，下一回合开启一次词条抉择；词条在本局剩余的全部战斗中永久生效。')}</div>
      <div class="gtrait__foot"><span class="gtrait__seal">${t('已生效')}</span></div>
    <//>` : null}
  </div>`;
}

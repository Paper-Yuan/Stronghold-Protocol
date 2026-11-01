// public/js/ui/annihilationIntro.js — 湮灭模拟's in-game presentation (the owner's request, 2026-10-22:
// a dedicated 模式介绍 button + the actual 8-slide PPT shown page by page, like an event presentation).
//
// The slide images live in public/assets/annihilation-intro/slide-01…08.webp (rendered from 湮灭模拟-模式介绍.pptx);
// the PPTX itself is served next to them so the viewer can offer a download. The name stays 湮灭模拟 throughout.

import { useEffect, useState } from '../../vendor/hooks.module.js';
import { html, Modal, Button, Icon } from './components.js';
import { t } from '../../../shared/i18n.js';

const SLIDES = [
  { title: '封面', en: 'COVER' },
  { title: '模式概览', en: 'MODE OVERVIEW' },
  { title: '核心规则', en: 'CORE RULES' },
  { title: '蚀流 1–6', en: 'EROSION LEVELS' },
  { title: '禁选盟约', en: 'BANNED COVENANTS' },
  { title: '藏品与决策', en: 'RELICS & DECISIONS' },
  { title: '战场记录', en: 'BATTLEFIELD ARCHIVE' },
  { title: '终局', en: 'ENDGAME' },
];

const SLIDE_COUNT = SLIDES.length;
const slideSrc = (i) => `/assets/annihilation-intro/slide-${String(i + 1).padStart(2, '0')}.webp`;

/**
 * The full-screen slideshow. A paginated presentation, not a scrolling document: arrows, dots and ←/→ all move one
 * slide at a time; Esc / 关闭 closes it (handled by Modal).
 * @param {{ open: boolean, onClose: () => void }} props
 */
export function AnnihilationIntro({ open, onClose }) {
  const [page, setPage] = useState(0);

  // always reopen on the cover
  useEffect(() => { if (open) setPage(0); }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      if (e.key === 'ArrowLeft' || e.key === 'PageUp') {
        e.preventDefault();
        setPage((p) => Math.max(0, p - 1));
      } else if (e.key === 'ArrowRight' || e.key === 'PageDown') {
        e.preventDefault();
        setPage((p) => Math.min(SLIDE_COUNT - 1, p + 1));
      } else if (e.key === 'Home') {
        e.preventDefault();
        setPage(0);
      } else if (e.key === 'End') {
        e.preventDefault();
        setPage(SLIDE_COUNT - 1);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  const go = (delta) => setPage((p) => Math.max(0, Math.min(SLIDE_COUNT - 1, p + delta)));
  const slide = SLIDES[page];

  return html`<${Modal} open=${open} onClose=${onClose} title=${t('湮灭模拟')} micro="ANNIHILATION // MODE MANUAL"
    width="min(1220px, 96vw)" class="annihilation-intro annihilation-slides"
    actions=${html`<${Button} variant="secondary" onClick=${onClose}>${t('关闭')}<//>`}>
    <div class="asv">
      <div class="asv__frame">
        <img class="asv__img" src=${slideSrc(page)} alt=${`${t('湮灭模拟')} · ${t(slide.title)}`} draggable="false" />
        <button type="button" class="asv__arrow asv__arrow--prev" onClick=${() => go(-1)} disabled=${page === 0}
          title=${t('上一页（←）')} aria-label=${t('上一页')}><${Icon} name="chevronLeft" /></button>
        <button type="button" class="asv__arrow asv__arrow--next" onClick=${() => go(1)} disabled=${page === SLIDE_COUNT - 1}
          title=${t('下一页（→）')} aria-label=${t('下一页')}><${Icon} name="chevronRight" /></button>
      </div>
      <div class="asv__bar">
        <div class="asv__title">
          <b>${t(slide.title)}</b>
          <span>${slide.en}</span>
        </div>
        <span class="asv__pageno num">${String(page + 1).padStart(2, '0')} / ${String(SLIDE_COUNT).padStart(2, '0')}</span>
        <div class="asv__dots" role="tablist" aria-label=${t('介绍页')}>
          ${SLIDES.map((s, i) => html`<button key=${s.en} type="button" role="tab" aria-selected=${i === page}
            class=${`asv__dot${i === page ? ' is-on' : ''}`} title=${`${i + 1}. ${t(s.title)}`}
            onClick=${() => setPage(i)}></button>`)}
        </div>
        <a class="asv__download" href="/assets/annihilation-intro/annihilation-mode-intro.pptx" download>
          <${Icon} name="book" /><span>${t('下载 PPT')}</span>
        </a>
      </div>
    </div>
  <//>`;
}

/**
 * The prominent 「模式介绍」 entry used by the annihilation start sheet (and the test room's erosion box).
 * @param {{ onClick: () => void, compact?: boolean }} props
 */
export function AnnihilationIntroButton({ onClick, compact = false }) {
  return html`<button type="button" class=${'annihilation-manual' + (compact ? ' is-compact' : '')} onClick=${onClick}
    aria-label=${t('打开湮灭模拟模式介绍')}>
    <span class="annihilation-manual__mark" aria-hidden="true"><${Icon} name="annihilation" /></span>
    <span class="annihilation-manual__body">
      <small class="annihilation-manual__micro">ANNIHILATION // MODE INTRO</small>
      <b>${t('模式介绍')}</b>
      <small>${t('蚀流规则 / 禁选盟约 / 藏品与终局')}</small>
    </span>
    <${Icon} name="chevronRight" />
  </button>`;
}

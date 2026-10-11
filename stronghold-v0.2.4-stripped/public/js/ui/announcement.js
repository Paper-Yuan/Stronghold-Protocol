import { useEffect, useRef, useState } from '../../vendor/hooks.module.js';
import { html, Icon, useTicker } from './components.js';
import { useStore } from '../store.js';
import { loadPref, savePref } from '../store.js';
import { net } from '../net.js';
import { announcementLive } from '../../../shared/announcements.js';

/** Constant pixel speed for long and short notices; the animation travels across the measured viewport. */
export function announcementScroll(viewport, textWidth) {
  const distance = Math.max(0, viewport) + Math.max(0, textWidth);
  return { from: Math.max(0, viewport), to: -Math.max(0, textWidth), duration: Math.max(8, distance / 70) };
}

export function announcementDismissKey(notice) {
  return notice ? `${notice.id}:${notice.startAt}:${notice.endAt}:${notice.text}` : '';
}

export function AnnouncementBanner() {
  const notice = useStore((s) => s.announcement);
  useStore((s) => s.clock.offset);
  const now = net.serverNow();
  useTicker(notice && now < notice.endAt ? 250 : 0);
  const key = announcementDismissKey(notice);
  const [dismissed, setDismissed] = useState(() => loadPref('announcementDismissed', ''));
  useEffect(() => {
    setDismissed(loadPref('announcementDismissed', '') === key ? key : '');
  }, [key]);
  const live = announcementLive(notice, now) && dismissed !== key;
  const viewport = useRef(null);
  const line = useRef(null);
  const [scroll, setScroll] = useState({ from: 0, to: 0, duration: 8 });
  useEffect(() => {
    if (!live) return undefined;
    const measure = () => {
      if (viewport.current && line.current) setScroll(announcementScroll(viewport.current.clientWidth, line.current.scrollWidth));
    };
    measure();
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null;
    if (viewport.current) observer?.observe(viewport.current);
    if (line.current) observer?.observe(line.current);
    window.addEventListener('resize', measure);
    return () => { observer?.disconnect(); window.removeEventListener('resize', measure); };
  }, [live, notice]);
  if (!live) return null;
  const label = notice.level === 'urgent' ? '紧急通知' : notice.level === 'warning' ? '提醒' : '通知';
  const dismiss = () => { savePref('announcementDismissed', key); setDismissed(key); };
  return html`<aside class=${`site-notice site-notice--${notice.level}`} role="status" aria-live="polite" aria-atomic="true">
    <span class="site-notice__label">${label}</span>
    <span class="site-notice__accessible">${notice.text}</span>
    <div ref=${viewport} class="site-notice__viewport" aria-hidden="true">
      <span ref=${line} key=${`${notice.id}:${notice.text}`} class="site-notice__text"
        style=${{ '--notice-from': `${scroll.from}px`, '--notice-to': `${scroll.to}px`, '--notice-duration': `${scroll.duration}s` }}>${notice.text}</span>
    </div>
    <button type="button" class="site-notice__close" aria-label="关闭通知" title="关闭通知" onClick=${dismiss}><${Icon} name="close" /><//>
  </aside>`;
}

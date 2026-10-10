// public/js/ui/announcement.js — 滚动公告组件
import { useEffect, useState } from '../../vendor/hooks.module.js';
import { html, Icon } from './components.js';
import { useStore } from '../store.js';

export function AnnouncementBar({ class: className = '' }) {
  const announcements = useStore((s) => s.announcements || []);
  const [idx, setIdx] = useState(0);

  useEffect(() => {
    if (!announcements.length) return;
    const timer = setInterval(() => {
      setIdx((i) => (i + 1) % announcements.length);
    }, 6000);
    return () => clearInterval(timer);
  }, [announcements.length]);

  if (!announcements || announcements.length === 0) return null;
  const current = announcements[idx % announcements.length];

  return html`<div class=${`announcement-bar ${className}`.trim()} role="status" aria-live="polite">
    <span class="announcement-bar__icon"><${Icon} name="info" /></span>
    <span class="announcement-bar__text">${current}</span>
    ${announcements.length > 1 ? html`<span class="announcement-bar__count num">${(idx % announcements.length) + 1}/${announcements.length}</span>` : null}
  </div>`;
}

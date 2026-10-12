import { useState, useEffect } from '../../vendor/hooks.module.js';
import { html, Icon } from './components.js';
import { useStore, selectRoute } from '../store.js';

export function AnnouncementBanner() {
  const route = useStore(selectRoute);
  const [closed, setClosed] = useState(false);

  useEffect(() => {
    if (route === 'lobby' || route === 'room' || route === 'game') {
      setClosed(true);
    }
  }, [route]);

  if (closed || route !== 'title') return null;

  const text = '纸鸢安好和他的好朋友们所制作，希望你们能玩的开心';

  return html`<aside class="site-notice site-notice--normal" role="status" aria-live="polite" aria-atomic="true">
    <span class="site-notice__label">公告</span>
    <span class="site-notice__accessible">${text}</span>
    <div class="site-notice__viewport" aria-hidden="true">
      <span class="site-notice__text" style="animation: none; transform: none; color: #51d8b3;">${text}</span>
    </div>
    <button type="button" class="site-notice__close" aria-label="关闭通知" title="关闭通知" onClick=${() => setClosed(true)}>
      <${Icon} name="close" />
    <//>
  </aside>`;
}

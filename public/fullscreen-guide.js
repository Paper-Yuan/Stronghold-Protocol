import { fullscreen } from './js/ui/device.js';

export function installFullscreenPrompt(win = globalThis) {
  return () => {};
}

export function installPortraitFullscreen(win = globalThis) {
  const doc = win.document;
  if (!doc?.body || doc.getElementById('sp-portrait-fullscreen')) return () => {};
  const box = doc.createElement('div');
  box.id = 'sp-portrait-fullscreen';
  Object.assign(box.style, {
    position: 'fixed',
    bottom: 'max(16px, env(safe-area-inset-bottom))',
    left: '50%',
    transform: 'translateX(-50%)',
    zIndex: '10000',
    width: 'min(300px, 88vw)',
    textAlign: 'center',
    pointerEvents: 'auto',
  });
  const button = doc.createElement('button');
  button.type = 'button';
  button.textContent = '⛶ 横屏全屏游玩';
  Object.assign(button.style, {
    padding: '12px 20px',
    minHeight: '46px',
    width: '100%',
    color: '#071713',
    background: '#51d8b3',
    border: '1px solid #9dffe2',
    borderRadius: '6px',
    fontSize: '16px',
    fontWeight: '700',
    boxShadow: '0 3px 14px #0009',
    cursor: 'pointer',
  });
  const notice = doc.createElement('div');
  notice.setAttribute('role', 'status');
  Object.assign(notice.style, {
    fontSize: '13px',
    color: 'white',
    background: '#10231deb',
    lineHeight: '1.5',
    borderRadius: '4px',
    marginTop: '5px',
  });
  box.append(button, notice);
  doc.body.append(box);

  const sync = () => {
    box.hidden = !(win.innerHeight > win.innerWidth);
  };
  const enter = async (event) => {
    event.stopPropagation();
    if (button.disabled) return;
    button.disabled = true;
    notice.textContent = '';
    try {
      if (!fullscreen.supported(win)) {
        notice.textContent = '浏览器不支持网页全屏，请手动旋转手机横屏。';
        return;
      }
      const entered = await fullscreen.enter(win);
      if (!entered) {
        notice.textContent = '未能进入全屏，请重试或手动旋转手机。';
        return;
      }
      if (win.innerHeight > win.innerWidth) notice.textContent = '已请求全屏；若未自动横屏，请手动旋转手机。';
    } finally {
      button.disabled = false;
      sync();
    }
  };

  button.addEventListener('click', enter);
  for (const name of ['resize', 'orientationchange']) win.addEventListener(name, sync);
  doc.addEventListener('fullscreenchange', sync);
  doc.addEventListener('webkitfullscreenchange', sync);
  sync();

  const dispose = () => {
    button.removeEventListener('click', enter);
    for (const name of ['resize', 'orientationchange']) win.removeEventListener(name, sync);
    doc.removeEventListener('fullscreenchange', sync);
    doc.removeEventListener('webkitfullscreenchange', sync);
    box.remove();
    win.removeEventListener('pagehide', dispose);
  };
  win.addEventListener('pagehide', dispose, { once: true });
  return dispose;
}

if (globalThis.document) {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      installPortraitFullscreen();
    }, { once: true });
  } else {
    installPortraitFullscreen();
  }
}

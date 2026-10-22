/* REC 系列统一的页面转场：扫描线擦除 + 密钥文字流动消失 */
export function installTransition() {
  const veil = document.createElement('div');
  veil.className = 'rec-veil';
  veil.innerHTML = '<span class="rec-veil__bar"></span>';
  document.body.appendChild(veil);
  requestAnimationFrame(() => {
    requestAnimationFrame(() => veil.classList.add('is-open'));
  });
  setTimeout(() => veil.remove(), 1100);
}

/**
 * 出场：把上一轮的密钥文字铺到屏幕上，逐条向上流走，然后跳转。
 * @param {string} url   目标页
 * @param {string[]} keys 上一轮解出的密钥
 */
export function leaveTo(url, keys = []) {
  const veil = document.createElement('div');
  veil.className = 'rec-veil is-leaving';

  // 密钥洪流层
  const stream = document.createElement('div');
  stream.className = 'rec-stream';
  const pool = keys.length ? keys : ['ACCESS'];
  const rows = 26;
  for (let i = 0; i < rows; i++) {
    const row = document.createElement('div');
    row.className = 'rec-stream__row';
    const k = pool[i % pool.length];
    // 每行重复几遍，形成横向洪流
    row.textContent = (k + '  ').repeat(Math.max(2, Math.ceil(40 / k.length)));
    row.style.setProperty('--d', (i * 26) + 'ms');
    row.style.setProperty('--dir', i % 2 ? '-1' : '1');
    stream.appendChild(row);
  }
  veil.appendChild(stream);
  veil.insertAdjacentHTML('beforeend', '<span class="rec-veil__bar"></span>');
  document.body.appendChild(veil);

  requestAnimationFrame(() => {
    requestAnimationFrame(() => veil.classList.add('is-closing'));
  });

  setTimeout(() => { location.href = url; }, 1180);
}

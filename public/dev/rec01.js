import { installTransition, leaveTo } from './rec-nav.js';
import { REC01 } from './puzzle-data.js';

const $ = (id) => document.getElementById(id);
const wall = $('fragwall');
const slotsEl = $('slots');
const stateEl = $('lockState');
const msgEl = $('msg');

/* 五种解码器 */
const DECODERS = {
  BASE64(c) {
    try { return decodeURIComponent(escape(atob(c.trim()))); }
    catch { try { return Buffer ? '' : ''; } catch { return null; } }
  },
  HEX(c) {
    try {
      const h = c.replace(/\s+/g, '');
      const bytes = h.match(/.{2}/g) || [];
      return new TextDecoder().decode(new Uint8Array(bytes.map((b) => parseInt(b, 16))));
    } catch { return null; }
  },
  BINARY(c) {
    try {
      const bits = c.trim().split(/\s+/).filter(Boolean);
      return new TextDecoder().decode(new Uint8Array(bits.map((b) => parseInt(b, 2))));
    } catch { return null; }
  },
  REVERSE(c) { return [...c.trim()].reverse().join(''); },
  BASE32(c) {
    const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
    let bits = 0, value = 0; const out = [];
    for (const ch of c.toUpperCase().replace(/=+$/, '')) {
      const i = B32.indexOf(ch);
      if (i < 0) continue;
      value = (value << 5) | i; bits += 5;
      if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; }
    }
    try { return new TextDecoder().decode(new Uint8Array(out)); } catch { return null; }
  },
  URL(c) {
    try { return decodeURIComponent(c.trim()); } catch { return null; }
  },
  UNICODE(c) {
    try { return c.trim().split(/\s+/).filter(Boolean).map((n) => String.fromCodePoint(Number(n))).join(''); }
    catch { return null; }
  },
  'UTF-16'(c) {
    try {
      return c.trim().split(/\s+/).filter(Boolean)
        .map((h) => String.fromCharCode(parseInt(h, 16))).join('');
    } catch { return null; }
  },
};

/* 归一化：去空白、统一大小写用于比对西文，中文原样 */
const norm = (s) => String(s || '').trim().replace(/\s+/g, ' ').toLowerCase();

/* 按 view 生成不同视觉 */
function renderCipher(f) {
  const c = f.cipher;
  if (f.view === 'pixels') {
    const bits = c.replace(/\s/g, '');
    let html = '<div class="pxgrid">';
    for (let i = 0; i < bits.length; i += 8) {
      for (const b of bits.slice(i, i + 8)) {
        html += '<i class="px' + (b === '1' ? ' on' : '') + '"></i>';
      }
    }
    return html + '</div>';
  }
  if (f.view === 'mirror') {
    return '<div class="mirrored"><span>' + c + '</span></div>';
  }
  if (f.view === 'hexgrid') {
    const pairs = c.replace(/\s/g, '').match(/.{2}/g) || [];
    return '<div class="hexgrid">' + pairs.map((x) => '<b>' + x + '</b>').join('') + '</div>';
  }
  if (f.view === 'matrix') {
    return '<div class="matrix">' + c.trim().split(/\s+/).map((x) => '<b>' + x + '</b>').join('') + '</div>';
  }
  if (f.view === 'codebar') {
    // Base32：把字符画成细长竖条（条码感），上窄下宽
    return '<div class="codebar">' + [...c].map((x) => '<i>' + x + '</i>').join('') + '</div>';
  }
  if (f.view === 'urlcode') {
    // URL 编码：每个 %XX 做成一个标签条
    const parts = c.match(/%[0-9A-Fa-f]{2}/g) || [];
    return '<div class="urlcode">' + parts.map((x) =>
      '<b><u>%</u>' + x.slice(1) + '</b>').join('') + '</div>';
  }
  if (f.view === 'scale') {
    // Unicode 十进制：像刻度尺上的数字
    return '<div class="cale">' + c.trim().split(/\s+/).map((x) => '<b>' + x + '</b>').join('') + '</div>';
  }
  return '<div class="mono">' + c + '</div>';
}

/* 五张方格卡片 */
REC01.frags.forEach((f, i) => {
  const card = document.createElement('article');
  card.className = 'fragcard';
  card.dataset.i = i;
  card.innerHTML = `
    <div class="fragcard__top">
      <span class="fragcard__label">${f.label}</span>
    </div>
    <div class="fragcard__cipher">${renderCipher(f)}</div>
    <input class="fragcard__in" spellcheck="false" autocomplete="off" aria-label="${f.label}">
    <span class="fragcard__mark" aria-hidden="true"></span>
  `;
  wall.appendChild(card);
});

const cards = [...document.querySelectorAll('.fragcard')];
const ins = cards.map((c) => c.querySelector('.fragcard__in'));
const solved = REC01.frags.map(() => false);

function check(i) {
  const v = norm(ins[i].value);
  const ok = v === norm(REC01.frags[i].answer);
  solved[i] = ok;
  cards[i].classList.toggle('is-ok', ok);
  cards[i].classList.toggle('is-bad', !!v && !ok);
  if (ok) { ins[i].blur(); refreshLocks(); }
  return ok;
}

ins.forEach((el, i) => {
  el.addEventListener('input', () => {
    cards[i].classList.remove('is-bad');
    if (norm(el.value).length >= norm(REC01.frags[i].answer).length) check(i);
  });
  el.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); if (check(i) && ins[i + 1]) ins[i + 1].focus(); }
  });
});

/* 底部锁位：解对一个点亮一格，显示该词首字 */
const slotEls = REC01.frags.map((f, i) => {
  const s = document.createElement('span');
  s.className = 'slot';
  s.textContent = '·';
  s.title = f.label;
  slotsEl.appendChild(s);
  return s;
});
const goBtn = $('go');
function refreshLocks() {
  slotEls.forEach((s, i) => {
    s.classList.toggle('is-on', solved[i]);
    s.textContent = solved[i] ? REC01.frags[i].answer : '·';
  });
  const n = solved.filter(Boolean).length;
  stateEl.textContent = n === 5 ? 'UNLOCKED' : `${n} / 5`;
  stateEl.classList.toggle('is-open', n === 5);
  if (goBtn) {
    goBtn.disabled = n !== 5;
    goBtn.classList.toggle('is-ready', n === 5);
  }
}

/* 五段都解对 → 按 ACCESS 进 REC 02 */
goBtn && goBtn.addEventListener('click', () => {
  if (!solved.every(Boolean)) return;
  msgEl.className = 'msg ok';
  msgEl.textContent = 'SIGNAL LOCKED';
  document.documentElement.style.transition = 'opacity .9s ease';
  leaveTo('/dev/rec02.html', REC01.frags.map((f) => f.answer));
});
refreshLocks();

installTransition();

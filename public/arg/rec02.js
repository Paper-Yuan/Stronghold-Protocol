import { installTransition, leaveTo } from './rec-nav.js';
import { REC02 } from './puzzle-data.js';

const $ = (id) => document.getElementById(id);
const wall = $('fragwall');
const slotsEl = $('slots');
const stateEl = $('lockState');
const msgEl = $('msg');
const goBtn = $('go');

const norm = (s) => String(s || '').trim().replace(/\s+/g, '').toLowerCase();

/* 摩斯 → 字母 */
const MORSE = { '.-':'A','-...':'B','-.-.':'C','-..':'D','.':'E','..-.':'F','--.':'G','....':'H','..':'I','.---':'J','-.-':'K','.-..':'L','--':'M','-.':'N','---':'O','.--.':'P','--.-':'Q','.-.':'R','...':'S','-':'T','..-':'U','...-':'V','.--':'W','-..-':'X','-.--':'Y','--..':'Z' };
const morseToText = (s) => s.trim().split(/\s+/).map((x) => MORSE[x] || '').join('');

/* 卡片：摩斯分行显示 */
REC02.frags.forEach((f, i) => {
  const card = document.createElement('article');
  card.className = 'fragcard';
  card.dataset.i = i;
  const groups = f.cipher.split(' ');
  card.innerHTML = `
    <div class="fragcard__top">
      <span class="fragcard__label">${f.label}</span>
      <span class="fragcard__letters">${groups.length} 组</span>
    </div>
    <div class="fragcard__cipher"><div class="morse">${groups.map((g) => '<b>' + g.replace(/\./g, '·').replace(/-/g, '—') + '</b>').join('')}</div></div>
    <input class="fragcard__in" spellcheck="false" autocomplete="off" aria-label="${f.label}">
    <span class="fragcard__mark" aria-hidden="true"></span>
  `;
  wall.appendChild(card);
});

const cards = [...document.querySelectorAll('.fragcard')];
const ins = cards.map((c) => c.querySelector('.fragcard__in'));
const solved = REC02.frags.map(() => false);

function check(i) {
  const f = REC02.frags[i];
  const v = ins[i].value.trim();
  const ok = norm(v) === norm(f.answer);
  solved[i] = ok;
  cards[i].classList.toggle('is-ok', ok);
  cards[i].classList.toggle('is-bad', !!v && !ok);
  if (ok) { ins[i].blur(); refresh(); }
  return ok;
}
ins.forEach((el, i) => {
  el.addEventListener('input', () => { cards[i].classList.remove('is-bad'); check(i); });
  el.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); if (check(i) && ins[i + 1]) ins[i + 1].focus(); }
  });
});

const slotEls = REC02.frags.map(() => {
  const s = document.createElement('span');
  s.className = 'slot';
  s.textContent = '·';
  slotsEl.appendChild(s);
  return s;
});
function refresh() {
  slotEls.forEach((s, i) => {
    s.classList.toggle('is-on', solved[i]);
    s.textContent = solved[i] ? REC02.frags[i].answer : '·';
  });
  const n = solved.filter(Boolean).length;
  stateEl.textContent = n === REC02.frags.length ? 'UNLOCKED' : `${n} / ${REC02.frags.length}`;
  stateEl.classList.toggle('is-open', n === REC02.frags.length);
  goBtn.disabled = n !== REC02.frags.length;
  goBtn.classList.toggle('is-ready', n === REC02.frags.length);
}
goBtn.addEventListener('click', () => {
  if (!solved.every(Boolean)) return;
  msgEl.className = 'msg ok';
  msgEl.textContent = 'SIGNAL LOCKED';
  document.documentElement.style.transition = 'opacity .9s ease';
  leaveTo('/arg/rec03.html', REC02.frags.map((f) => f.answer));
});
refresh();

installTransition();

import { installTransition, leaveTo } from './rec-nav.js';
import { PUZZLE } from './puzzle-data.js';

const ACCOUNT = 'all doctor';
const PASS = 'paperyuan';

const $ = (id) => document.getElementById(id);
const pad = (n) => String(n).padStart(2, '0');

const { grid, layout, words } = PUZZLE;
const rows = grid.length, cols = grid[0].length;
const byN = new Map(words.map((w) => [w.n, w]));

/* 每格归属：词列表 + 该格上所有词的显示编号（一格可能同时是横/竖两个词的起点） */
const cellWords = Array.from({ length: rows }, () => Array.from({ length: cols }, () => []));
const cellNums = Array.from({ length: rows }, () => Array.from({ length: cols }, () => []));
const startCells = new Set();
/* 密码位：每个词的交叉位格（该词贡献密码里的第 num 个字母） */
const keyCells = new Set();
const HOLES = { 1:1, 2:5, 3:0, 4:0, 5:4, 6:1, 7:1, 8:3, 9:3 };
for (const p of layout) {
  p.cells.forEach(([r, c], i) => {
    cellWords[r][c].push(p.n);
    if (i === 0) { cellNums[r][c].push(p.num); startCells.add(r + ',' + c); }
  });
  const h = HOLES[p.num];
  if (h != null && p.cells[h]) keyCells.add(p.cells[h][0] + ',' + p.cells[h][1]);
}

/* 棋盘 */
const board = $('board');
board.style.gridTemplateColumns = `repeat(${cols}, 49px)`;
const cellEls = Array.from({ length: rows }, () => Array(cols).fill(null));

for (let r = 0; r < rows; r++) {
  for (let c = 0; c < cols; c++) {
    const el = document.createElement('div');
    const edge = (r === rows - 1 ? ' is-last-row' : '') + (c === cols - 1 ? ' is-last-col' : '');
    if (!grid[r][c]) { el.className = 'cell back' + edge; board.appendChild(el); cellEls[r][c] = el; continue; }
    const ws = cellWords[r][c];
    const isStart = startCells.has(r + ',' + c);
    const isKey = keyCells.has(r + ',' + c);
    el.className = 'cell word' + (isStart ? ' is-start' : '') + (isKey ? ' is-key' : '') + edge;
    el.dataset.row = r; el.dataset.col = c;
    if (cellNums[r][c].length) {
      const n = document.createElement('span');
      n.className = 'num';
      n.textContent = cellNums[r][c].map((v) => pad(v)).join(' ') + '.';
      el.appendChild(n);
    }
    if (ws.length) el.addEventListener('click', (ev) => { ev.stopPropagation(); openHint(ev.currentTarget, ws[0]); });
    board.appendChild(el);
    cellEls[r][c] = el;
  }
}

/* 底部 ACROSS / DOWN 列表 */
const acrossEl = $('across'), downEl = $('down');
for (const p of layout.slice().sort((a, b) => a.num - b.num)) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'legend__n';
  btn.dataset.n = p.n;
  btn.dataset.num = p.num;
  btn.textContent = pad(p.num) + '.';
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    const [r, c] = p.cells[0];
    openHint(cellEls[r][c], p.n);
    cellEls[r][c].scrollIntoView({ block: 'nearest', inline: 'nearest' });
  });
  (p.dir === 'H' ? acrossEl : downEl).appendChild(btn);
}

/* 弹层 */
let pop = null;
function closePop() {
  if (pop) { pop.remove(); pop = null; }
  document.querySelectorAll('.cell.is-on').forEach((e) => e.classList.remove('is-on'));
  document.querySelectorAll('.legend__n.is-on').forEach((e) => e.classList.remove('is-on'));
}
function openHint(el, n) {
  const same = pop && pop.dataset.n === String(n);
  closePop();
  if (same) return;
  const w = byN.get(n);
  const p = layout.find((x) => x.n === n);
  for (const [r, c] of p.cells) cellEls[r][c]?.classList.add('is-on');
  document.querySelectorAll('.legend__n').forEach((b) => { if (Number(b.dataset.n) === n) b.classList.add('is-on'); });

  const box = document.createElement('div');
  box.className = 'hintpop';
  box.dataset.n = String(n);
  let body;
  if (w.tone === 'pink') body = `<p class="pink">${w.hint}</p>`;
  else if (w.tone === 'orb') body = `<span class="orb">${w.hint}</span>`;
  else body = `<p>${w.hint}</p>`;
  box.innerHTML = `<span class="hp__n">${pad(p.num)} · ${p.dir === 'H' ? 'ACROSS' : 'DOWN'} · ${p.cells.length} · 口令第 ${p.num} 位</span>
    <span class="hp__w">${'·'.repeat(w.word.length)}</span>${body}`;
  document.body.appendChild(box);

  const r0 = el.getBoundingClientRect();
  const bw = box.offsetWidth, bh = box.offsetHeight;
  let left = r0.left + r0.width / 2 - bw / 2;
  let top = r0.bottom + 8;
  left = Math.max(10, Math.min(left, innerWidth - bw - 10));
  if (top + bh > innerHeight - 10) top = r0.top - bh - 8;
  box.style.left = left + 'px';
  box.style.top = Math.max(10, top) + 'px';
  pop = box;
}
document.addEventListener('click', (e) => {
  if (pop && !pop.contains(e.target) && !e.target.closest('.cell.word') && !e.target.closest('.legend__n')) closePop();
});
window.addEventListener('keydown', (e) => { if (e.key === 'Escape') closePop(); });
window.addEventListener('resize', closePop);

/* 登录 */
$('login').addEventListener('submit', (e) => {
  e.preventDefault();
  const msg = $('msg');
  // 账号容忍空格差异（all doctor / alldoctor / all  doctor 都算对）
  const user = $('user').value.trim().toLowerCase().replace(/\s+/g, '');
  const pass = $('pass').value.trim().toLowerCase();
  if (user !== ACCOUNT.replace(/\s+/g, '')) {
    msg.className = 'msg err';
    msg.textContent = user ? '编号对不上。' : '先填编号。';
    return;
  }
  if (pass !== PASS) {
    msg.className = 'msg err';
    msg.textContent = pass ? '口令不对。' : '编号正确，还差口令。';
    return;
  }
  msg.className = 'msg ok';
  msg.textContent = 'ACCESS GRANTED';
  $('code').textContent = 'PAPERYUAN';
  $('code').classList.add('on');
  closePop();
  document.documentElement.style.transition = 'opacity .9s ease';
  leaveTo('/dev/rec01.html', ['ALL DOCTOR', 'PAPERYUAN', '▽▷▷▷✕▢▽✕◤']);
});

installTransition();

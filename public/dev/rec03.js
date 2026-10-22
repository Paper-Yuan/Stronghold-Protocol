import { REC03 } from './puzzle-data.js';
import { installTransition, leaveTo } from './rec-nav.js';

const $ = (id) => document.getElementById(id);
const wall = $('wall');
const goBtn = $('go');
const msgEl = $('msg');
const total = REC03.ids.length;

/* 顶部进度 */
const head = document.querySelector('.rec-head');
const prog = document.createElement('div');
prog.className = 'callprog';
prog.innerHTML = '<span class="callprog__bar"><i></i></span><span class="callprog__txt">0 / ' + total + '</span>';
head.appendChild(prog);
const barEl = prog.querySelector('.callprog__bar i');
const txtEl = prog.querySelector('.callprog__txt');

/* 乱码字符池 */
const NOISE = 'ｦｧｨｩｪｫｬｭｮｯｱｲｳｴｵｶｷｸｹｺｻｼｽｾｿﾀﾁﾂﾃﾄﾅﾆﾇﾈﾉﾊﾋﾌﾍﾎﾏﾐﾑﾒﾓﾔﾕﾖﾗﾘﾙﾚﾛﾜﾝ0123456789ABCDEF#$%&@*+=<>/\\|█▓▒░■□◆◇';
const rndChar = () => NOISE[(Math.random() * NOISE.length) | 0];
/* 乱码字的三种色：蓝 / 白 / 紫，随机闪 */
const rndTone = () => ['n1', 'n2', 'n3'][(Math.random() * 3) | 0];

/**
 * 逐字显现（激烈版）：
 *   ① 整行全乱码 620ms，每 25ms 刷新一批，颜色随机闪（蓝/白/紫）
 *   ② 再逐字「咔」地定格，缩放 1.8 倍 + 白色闪光
 */
function typeName(el, text, speed, done) {
  const chars = [...text];
  el.textContent = '';
  el.classList.add('is-typing');

  const spans = chars.map(() => {
    const s = document.createElement('span');
    s.className = 'ch is-noise ' + rndTone();
    s.textContent = rndChar();
    el.appendChild(s);
    return s;
  });

  const startAt = performance.now();
  const PREFILL = 620;
  const NOISE_FRAME = 25;
  let noiseAt = 0;
  let setCount = 0;

  function frame(now) {
    const paint = now - noiseAt >= NOISE_FRAME;
    if (paint) noiseAt = now;
    for (let i = 0; i < chars.length; i++) {
      const s = spans[i];
      if (s.dataset.set === '1') continue;
      const settleAt = startAt + PREFILL + i * speed;
      if (now >= settleAt) {
        s.textContent = chars[i];
        s.className = 'ch is-set';
        s.dataset.set = '1';
        setCount++;
      } else if (paint) {
        s.textContent = rndChar();
        s.className = 'ch is-noise ' + rndTone();
      }
    }
    if (setCount >= chars.length) {
      el.classList.remove('is-typing');
      el.classList.add('is-done');
      done && done();
      return;
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

/* 只在底部追加新行；最多 9 行 */
const MAX_ROWS = 9;
let idx = 0;
let finished = false;

function addRow(g) {
  const row = document.createElement('div');
  row.className = 'callrow';
  row.innerHTML =
    '<span class="callrow__n">' + String(g.n).padStart(2, '0') + '</span>' +
    '<span class="callrow__name"></span>';
  wall.appendChild(row);
  requestAnimationFrame(() => row.classList.add('is-on'));

  const kids = [...wall.children];
  if (kids.length > MAX_ROWS) {
    const old = kids[0];
    old.classList.add('is-leave');
    setTimeout(() => old.remove(), 380);
  }
  return row.querySelector('.callrow__name');
}

function updateProgress(n) {
  barEl.style.width = (n / total * 100) + '%';
  txtEl.textContent = n + ' / ' + total;
}

function next() {
  if (finished) return;
  if (idx >= total) return finish();
  const g = REC03.ids[idx];
  const nameEl = addRow(g);
  const speed = Math.max(95, Math.min(145, 1000 / Math.max(1, [...g.answer].length)));
  typeName(nameEl, g.answer, speed, () => {
    idx++;
    updateProgress(idx);
    setTimeout(next, 300);
  });
}

function finish() {
  if (finished) return;
  finished = true;
  document.body.classList.add('is-complete');
  msgEl.className = 'msg ok';
  msgEl.textContent = 'SIGNAL ACQUIRED — ' + total + ' / ' + total;
  updateProgress(total);
}

/* 点击跳过 */
function skipAll() {
  if (finished) return;
  wall.innerHTML = '';
  REC03.ids.forEach((g) => {
    const row = document.createElement('div');
    row.className = 'callrow is-on';
    row.innerHTML =
      '<span class="callrow__n">' + String(g.n).padStart(2, '0') + '</span>' +
      '<span class="callrow__name is-done">' + g.answer + '</span>';
    wall.appendChild(row);
  });
  idx = total;
  finish();
}
document.addEventListener('click', (e) => {
  if (e.target.closest('#go')) return;
  skipAll();
});

goBtn.addEventListener('click', () => {
  leaveTo('/dev/rec04.html', REC03.ids.map((g) => g.answer));
});

installTransition();
setTimeout(next, 420);

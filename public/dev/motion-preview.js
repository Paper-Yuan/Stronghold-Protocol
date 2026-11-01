// public/dev/motion-preview.js — motion-preview.html 的行为（演示页，不是线上功能）。
// 五个模块各自「现状 / 优化」：数字与写法都照抄生产（relics.js / relics.css / lobby.css / game.css），
// 只为让你点得出来差别；真正的改动不在这里。
'use strict';

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const live = $('#live');
/** announce a state change for screen readers (the page is a demo, but it is keyboard-usable) */
const say = (text) => { live.textContent = text; };

/** every timer this page owns; a replay / viewport change clears them all */
let timers = [];
const later = (fn, ms) => { const id = setTimeout(fn, ms); timers.push(id); return id; };
const clearTimers = () => { for (const id of timers) clearTimeout(id); timers = []; };

const REEL_CELL_PX = 92;   // relics.js:134 —— 演示「现状」模式里写死的格高
const REEL_CELLS = 26;     // relics.js:135
const STRIP_CELLS = REEL_CELLS + 1;

/* ------------------------------------------------------------------ ① 抽卡 */
const slotEl = $('[data-slot]');
const reelsEl = $('[data-reels]');
const startBtn = $('[data-start]');
const skipBtn = $('[data-skip]');
const statusEl = $('[data-status]');
const cardsEl = $('[data-cards]');
const leverEl = $('[data-lever]');
const reelMod = $('[data-module="reel"]');

const RELICS = [
  { name: '红·枯竭', set: 'No.12 · 负藏', tier: '负面', desc: '每次决策后，我方全体攻击力 -4%（逐次叠加）。' },
  { name: '红·崩蚀', set: 'No.31 · 负藏', tier: '负面', desc: '开册时立即扣除 3 点目标生命值。' },
  { name: '蓝·余烬', set: 'No.58 · 青蓝', tier: '青蓝', desc: '每通过一次首领轮，资金 +6。' },
];

let reelMode = 'before';
let reels = [];
let reelPhase = 'idle';
let reelStartAt = 0;

function iconClass(i) {
  const k = i % 7;
  return k === 0 ? 'is-gold' : k === 3 ? 'is-blue' : '';
}

function buildReels() {
  reelsEl.textContent = '';
  reels = [];
  for (let r = 0; r < 3; r++) {
    const reel = document.createElement('div');
    reel.className = 'slot__reel';
    const strip = document.createElement('div');
    strip.className = 'slot__strip';
    // 27 格：目标在最上，其余按生产同款算式铺（(i * 7 + r * 5) % n）
    for (let i = 0; i < STRIP_CELLS; i++) {
      const cell = document.createElement('span');
      cell.className = `slot__cell ${iconClass(i + r * 2)}`;
      cell.appendChild(document.createElement('i'));
      strip.appendChild(cell);
    }
    const payline = document.createElement('span');
    payline.className = 'slot__payline';
    reel.append(strip, payline);
    reelsEl.appendChild(reel);
    reels.push({ reel, strip, offset: -REEL_CELLS, spinning: false, stopped: false });
  }
  paintReels();
}

/** 现状：translateY(offset * 92px)（写死）；优化：按条自身高度的百分比（永远 −26/27 格） */
function paintReels() {
  for (const r of reels) {
    r.strip.style.transform = reelMode === 'before'
      ? `translateY(${r.offset * REEL_CELL_PX}px)`
      : `translateY(${(r.offset / STRIP_CELLS) * 100}%)`;
    r.reel.classList.toggle('is-spinning', r.spinning);
  }
}

function setReelPhase(phase, label) {
  reelPhase = phase;
  statusEl.textContent = label;
  slotEl.classList.toggle('is-done', phase === 'done');
  slotEl.classList.toggle('is-ready', phase === 'idle');
  skipBtn.hidden = phase !== 'spinning';
  startBtn.disabled = phase === 'spinning';
}

function buildCards() {
  cardsEl.textContent = '';
  for (const [i, relic] of RELICS.entries()) {
    const card = document.createElement('button');
    card.type = 'button';
    card.className = `rlc${relic.tier === '青蓝' ? ' rlc--blue' : ''}`;
    card.style.setProperty('--i', String(i));
    card.innerHTML = `
      <span class="rlc__tier">${relic.tier}</span>
      <span class="rlc__head">
        <span class="rlc__icon"><i></i></span>
        <span class="rlc__titles">
          <b class="rlc__name">${relic.name}</b>
          <span class="rlc__set">${relic.set}</span>
        </span>
      </span>
      <span class="rlc__desc">${relic.desc}</span>`;
    cardsEl.appendChild(card);
  }
}

function startReels() {
  if (reelPhase === 'spinning') return;
  clearTimers();
  cardsEl.hidden = true;
  slotEl.classList.remove('is-done');
  const before = reelMode === 'before';
  const pad = before ? 120 : 40;
  setReelPhase('spinning', before ? '抽取中 · 现状' : '抽取中 · 优化');
  reelStartAt = performance.now();
  for (const [i, r] of reels.entries()) {
    r.offset = 0;
    r.spinning = true;
    r.stopped = false;
    r.strip.style.transitionDuration = `${(before ? 1500 + i * 380 : 900 + i * 220)}ms`;
    r.strip.style.transitionTimingFunction = before ? 'cubic-bezier(.08,.72,.12,1)' : 'cubic-bezier(.2,.8,.2,1)';
  }
  paintReels();
  // 每只轮自己的停点：之前是 duration + 120ms 的猜；优化里是 duration + 40ms 的兜底（真实现配 transitionend）
  for (const [i, r] of reels.entries()) {
    const duration = before ? 1500 + i * 380 : 900 + i * 220;
    later(() => {
      r.spinning = false;
      r.stopped = true;
      paintReels();
      if (!before) {
        slotEl.classList.add('is-hit');
        later(() => slotEl.classList.remove('is-hit'), 260);
      }
      const allStopped = reels.every((x) => x.stopped);
      if (allStopped) later(revealCards, before ? 620 : 360);
    }, duration + pad);
  }
}

function revealCards() {
  const ms = Math.round(performance.now() - reelStartAt);
  setReelPhase('done', `${ms}ms 后出卡`);
  cardsEl.hidden = false;
  say(`抽卡完成，用时 ${ms} 毫秒`);
  renderReelReadout(ms);
}

function skipReels() {
  clearTimers();
  for (const r of reels) {
    r.offset = 0;
    r.spinning = false;
    r.stopped = true;
    r.strip.style.transitionDuration = '0ms';
  }
  paintReels();
  revealCards();
}

function renderReelReadout(ms) {
  const cellPx = Math.round(reels[0].reel.getBoundingClientRect().height) || REEL_CELL_PX;
  const stripPx = Math.round(reels[0].strip.getBoundingClientRect().height) || cellPx * STRIP_CELLS;
  const travel = REEL_CELL_PX * REEL_CELLS;
  const short = travel - stripPx;
  const before = reelMode === 'before';
  const geometry = cellPx === REEL_CELL_PX
    ? `行程 ${REEL_CELLS} × ${REEL_CELL_PX}px = ${travel}px，与格高一致 → <b class="good">停点对齐</b>`
    : short > 0
      ? `行程 ${travel}px ＞ 条自身高 ${stripPx}px，<b class="bad">超出 ${short}px（约 ${Math.round((short / stripPx) * 100)}%）</b> → 起步一小段空白、转速随视口漂（停点仍准）`
      : `行程 ${travel}px ＜ 条自身高 ${stripPx}px → 停点仍准，窗底多留 ${-short}px`;
  const numbers = before
    ? `位移按写死的 92px：${geometry}`
    : `位移改成 <b class="good">${REEL_CELLS}/${STRIP_CELLS} ≈ ${((REEL_CELLS / STRIP_CELLS) * 100).toFixed(2)}% 的条高</b>　（当前格高 ${cellPx}px：${geometry}）`;
  const timing = before
    ? '时长 1500 / 1880 / 2260ms + 每只轮再等 120ms；最后一只停后 <b class="bad">620ms 空拍</b>；三卡同时出现（无入场）'
    : '时长 900 / 1120 / 1340ms + 40ms 兜底；停轮 payline 240ms 冲击；<b class="good">360ms</b> 后出卡，卡 0 / 70 / 140ms stagger（backwards）';
  $('[data-readout="reel"]').innerHTML =
    `模式：<b>${before ? '现状' : '优化'}</b>　最近一次「拉把手 → 出卡」：${ms == null ? '—' : `<b>${ms}ms</b>`}\n${timing}\n${numbers}`;
}

/* ------------------------------------------------------------------ ② 三选一 */
const pickMod = $('[data-module="pick"]');
const pickCardsEl = $('[data-pick-cards]');
let pickMode = 'before';
let pickArmed = null;
let pickChosen = null;

function buildPickCards() {
  pickCardsEl.textContent = '';
  for (const relic of RELICS) {
    const card = document.createElement('button');
    card.type = 'button';
    card.className = `rlc${relic.tier === '青蓝' ? ' rlc--blue' : ''}`;
    card.innerHTML = `
      <span class="rlc__tier">${relic.tier}</span>
      <span class="rlc__head">
        <span class="rlc__icon"><i></i></span>
        <span class="rlc__titles">
          <b class="rlc__name">${relic.name}</b>
          <span class="rlc__set">${relic.set}</span>
        </span>
      </span>
      <span class="rlc__desc">${relic.desc}</span>
      <span class="rlc__confirm" hidden><b>确认选择</b><small>再次点击</small></span>`;
    card.addEventListener('click', () => tapPick(relic));
    pickCardsEl.appendChild(card);
  }
}

function tapPick(relic) {
  const idx = RELICS.indexOf(relic);
  if (pickChosen === idx) return;
  if (pickArmed !== idx) {
    pickArmed = idx;
    paintPick();
    say(`已选中 ${relic.name}，再点一次确认`);
    return;
  }
  pickChosen = idx;
  paintPick();
  say(`已选择 ${relic.name}`);
}

function paintPick() {
  const cards = $$('.rlc', pickCardsEl);
  cards.forEach((card, i) => {
    card.classList.toggle('is-armed', pickArmed === i && pickChosen == null);
    card.classList.toggle('is-chosen', pickChosen === i);
    card.disabled = pickChosen != null && pickChosen !== i;
    const confirm = $('.rlc__confirm', card);
    confirm.hidden = !(pickArmed === i && pickChosen == null);
  });
  const others = cards.length - 1;
  const before = pickMode === 'before';
  const state = pickChosen != null ? `已选：<b>${RELICS[pickChosen].name}</b>（生产上这里浮层关闭、canReady 转真）`
    : pickArmed != null ? `第 1 次点击：<b>已选中，再点一次确认</b>` : '未选择 · 点一张看看';
  $('[data-readout="pick"]').innerHTML =
    `模式：<b>${before ? '现状' : '优化'}</b>　${state}\n`
    + (before
      ? '选中信号：边框变金 + 静态确认块；其余卡不变；armed 后鼠标悬停仍会上下浮动'
      : `选中信号：220ms 单次金环（不是无限呼吸）+ 确认块 140ms 缩放入场；其余 ${others} 张让位到 66%；armed 后不再浮动`);
}

/* ------------------------------------------------------------------ ③ 层叠 */
const stackEl = $('[data-stack]');
const ovlLow = $('[data-ovl-low]');
const ovlHigh = $('[data-ovl-high]');
const miniLow = $('[data-mini-cards]');
const miniHigh = $('[data-ovl-high] .mini-cards');
let stackMode = 'before';
let stackOpen = false;
let lowArmed = 0;

function buildStack() {
  miniLow.textContent = '';
  for (const [i, relic] of RELICS.entries()) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `mini${i === lowArmed ? ' is-armed' : ''}`;
    b.textContent = relic.tier;
    b.addEventListener('click', () => { lowArmed = i; buildStack(); paintStack(); });
    miniLow.appendChild(b);
  }
  miniHigh.textContent = '';
  for (const text of ['+攻击', '+攻击', '+攻击']) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'mini';
    b.textContent = text;
    miniHigh.appendChild(b);
  }
}

function openHigh() {
  stackOpen = true;
  ovlHigh.hidden = false;
  $('[data-ovl-ok]').focus({ preventScroll: true });
  paintStack();
  say('增益浮层已打开');
}

function closeHigh(viaEsc) {
  if (!stackOpen) return;
  stackOpen = false;
  ovlHigh.hidden = true;
  // 现状的 bug：一次 Esc 会把下层一起关掉，连已被选中的卡也丢了
  if (viaEsc && stackMode === 'before') {
    lowArmed = -1;
    buildStack();
  }
  paintStack();
  say(viaEsc ? '已按 Esc' : '已收下');
}

function paintStack() {
  const after = stackMode === 'after';
  const covered = after && stackOpen;
  ovlLow.classList.toggle('is-covered', covered);
  if (covered) ovlLow.setAttribute('aria-hidden', 'true');
  else ovlLow.removeAttribute('aria-hidden');
  for (const el of $$('button', ovlLow)) {
    if (covered) el.setAttribute('tabindex', '-1');
    else el.removeAttribute('tabindex');
  }
  // 读出来的都是 DOM 真值：aria-modal 的个数、可 Tab 的按钮数、还在做全屏模糊的层数
  const modals = $$('[aria-modal="true"]', stackEl).filter((el) => !el.hidden && !el.classList.contains('is-covered')).length;
  const focusable = $$('button', stackEl).filter((el) => !el.disabled && el.getBoundingClientRect().width > 0 && el.tabIndex >= 0).length;
  const blurred = $$('.ovl__veil', stackEl).filter((el) => {
    const cs = getComputedStyle(el);
    const v = cs.backdropFilter || cs.webkitBackdropFilter || 'none';
    return v !== 'none' && el.getBoundingClientRect().width > 0;
  }).length;
  const lowVisible = getComputedStyle($('.ovl__panel', ovlLow)).visibility;
  $('[data-readout="stack"]').innerHTML =
    `模式：<b>${after ? '优化' : '现状'}</b>　增益浮层：<b>${stackOpen ? '打开' : '关闭'}</b>　下层选中：<b>${lowArmed >= 0 ? RELICS[lowArmed].name : '（丢了）'}</b>\n`
    + `aria-modal 生效个数 <b class="${modals > 1 ? 'bad' : 'good'}">${modals}</b>　`
    + `可 Tab 的按钮 <b class="${focusable > 4 ? 'bad' : 'good'}">${focusable}</b>　`
    + `全屏模糊层 <b class="${blurred > 1 ? 'bad' : 'good'}">${blurred}</b>　`
    + `下层面板 visibility：<b class="${lowVisible === 'visible' && stackOpen ? 'bad' : 'good'}">${lowVisible}</b>\n`
    + (after
      ? '被盖住的那层：visibility:hidden + pointer-events:none（同时移出 Tab 序列），它的全屏模糊也一起卸掉；Esc 只作用于最上层'
      : '两层同时 aria-modal、两层全屏模糊、下层仍可 Tab、下层标题从黑幕里透出来；Esc 会把两层一起关掉');
}

/* ------------------------------------------------------------------ ④ 蚀流 */
const erosionMod = $('[data-module="erosion"]');
const tiersEl = $('[data-tiers]');
const roomChipsEl = $('[data-room-chips]');
const badgeEl = $('[data-badge]');
let erosionMode = 'before';
let erosionTier = 4;

function tierLabel(n) {
  if (erosionMode === 'after') return n === 6 ? '6∞' : String(n);
  return String(n);
}
function roomLabel(n) {
  return erosionMode === 'after' ? (n === 6 ? '6∞' : String(n)) : (n === 6 ? '∞' : String(n));
}

function buildErosion() {
  tiersEl.textContent = '';
  roomChipsEl.textContent = '';
  for (let n = 1; n <= 6; n++) {
    const hall = document.createElement('button');
    hall.type = 'button';
    hall.className = `ext-tier${n === erosionTier ? ' is-on' : ''}`;
    hall.dataset.tier = String(n);
    hall.textContent = tierLabel(n);
    hall.setAttribute('aria-pressed', String(n === erosionTier));
    hall.addEventListener('click', () => { erosionTier = n; buildErosion(); paintErosion(); });
    tiersEl.appendChild(hall);

    const room = document.createElement('button');
    room.type = 'button';
    room.className = `rs-erosion__chip${n === erosionTier ? ' is-on' : ''}`;
    room.dataset.tier = String(n);
    room.textContent = roomLabel(n);
    room.setAttribute('aria-pressed', String(n === erosionTier));
    room.addEventListener('click', () => { erosionTier = n; buildErosion(); paintErosion(); });
    roomChipsEl.appendChild(room);
  }
  const endless = erosionTier === 6;
  badgeEl.classList.toggle('is-endless', endless);
  badgeEl.innerHTML = endless ? '<span>无尽湮灭</span><b>∞</b>' : `<span>蚀流</span><b>${erosionTier}</b>`;
}

function paintErosion() {
  const after = erosionMode === 'after';
  const px = (el) => {
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    return { font: parseFloat(cs.fontSize), h: Math.round(r.height), w: Math.round(r.width) };
  };
  const hall = px($('.ext-tier.is-on', tiersEl));
  const party = px($('.ext-party__chip.is-on', erosionMod));
  const room = px($('.rs-erosion__chip.is-on', roomChipsEl));
  const badge = px(badgeEl);
  const badgeB = px($('b', badgeEl));
  const t = getComputedStyle($('#stage')).getPropertyValue('--t').trim();
  const fmt = (v) => `${v.toFixed(2).replace(/\.00$/, '')}px`;
  $('[data-readout="erosion"]').innerHTML =
    `模式：<b>${after ? '优化' : '现状'}</b>　蚀流 <b>${erosionTier}</b>${erosionTier === 6 ? '（无尽）' : ''}　--t = ${t}\n`
    + `大厅 chip 字 ${fmt(hall.font)}（${hall.w}×${hall.h}）　单人/同盟 ${fmt(party.font)}　房内胶囊 ${fmt(room.font)}（${room.w}×${room.h}）　`
    + `角标标签 ${fmt(badge.font)} / 数字 ${fmt(badgeB.font)}（${badge.w}×${badge.h}）\n`
    + (after
      ? '<b class="good">像素地板生效</b>：标签 ≥11px、数字 ≥14px（无尽 ≥16px）；三处第 6 档都写「6∞」，读屏仍是「蚀流 6」'
      : '<b class="bad">纯比例缩放</b>：--t 在矮屏只有 40px，chip 与角标字号落到 4–7px（切「800×360」看）');
}

/* ------------------------------------------------------------------ ⑤ 列表 stagger */
const listMod = $('[data-module="list"]');
const listEl = $('[data-list]');
let listMode = 'before';
const ROWS = [
  ['湮灭模拟', 'AC-5', '可开局'],
  ['无尽火力', 'AC-6', '筹备中'],
  ['深潜协议', 'AC-7', '筹备中'],
  ['（演示）第 4 条', 'AC-8', '筹备中'],
  ['（演示）第 5 条', 'AC-9', '筹备中'],
];

function buildList() {
  listEl.textContent = '';
  for (const [i, [name, code, chip]] of ROWS.entries()) {
    const li = document.createElement('li');
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'ext-row';
    // 优化：行号写在自己身上（1 → N 不漂）；现状：CSS 只写了前三条
    if (listMode === 'after') btn.style.setProperty('--n', String(i));
    btn.innerHTML = `
      <span class="ext-row__idx">${String(i + 1).padStart(2, '0')}</span>
      <span><b class="ext-row__name">${name}</b> <span class="ext-row__desc">${code}</span></span>
      <span class="ext-row__tail"><span class="chip${chip === '可开局' ? ' chip--ready' : ''}">${chip}</span></span>`;
    li.appendChild(btn);
    listEl.appendChild(li);
  }
  paintList();
}

function paintList() {
  const delays = $$('.ext-row', listEl).map((el) => getComputedStyle(el).animationDelay.replace(/,.*$/, ''));
  const before = listMode === 'before';
  $('[data-readout="list"]').innerHTML =
    `模式：<b>${before ? '现状' : '优化'}</b>　各行实际 animation-delay：<b class="${before ? 'bad' : 'good'}">${delays.join(' / ')}</b>\n`
    + (before
      ? '前三条 240 / 300 / 360ms（backwards 期间是透明的），第 4 条起 0ms —— 于是<b class="bad">后面的先出现</b>'
      : '240 + n×60ms：240 / 300 / 360 / 420 / 480ms，行数变多也不会反转');
}

/* ------------------------------------------------------------------ 壳 */
const stage = $('#stage');
const stageTag = $('#stage-tag');
const VP_LABEL = { wide: '1280×720', short: '800×360', phone: '667×375', portrait: '390×844（竖屏）', auto: '跟随窗口' };

function paintShell() {
  const vp = stage.dataset.vp;
  const t = getComputedStyle(stage).getPropertyValue('--t').trim();
  stageTag.textContent = `视口 ${VP_LABEL[vp]} · --t = ${t}（生产：1rem，根字号随视口 66.67px / 40px）`;
  paintReels();
  paintPick();
  paintStack();
  paintErosion();
  paintList();
  renderReelReadout(null);
}

function setVp(vp) {
  clearTimers();
  stage.dataset.vp = vp;
  for (const b of $$('[data-seg="vp"] > button')) b.classList.toggle('is-on', b.dataset.vp === vp);
  paintShell();
  say(`视口切换为 ${VP_LABEL[vp]}`);
}

function setMode(seg, mode) {
  if (seg === 'reel') {
    reelMode = mode;
    reelMod.classList.toggle('reel--after', mode === 'after');
    reelMod.classList.toggle('reel--before', mode === 'before');
    clearTimers();
    cardsEl.hidden = true;
    slotEl.classList.remove('is-done', 'is-hit');
    for (const r of reels) {
      r.offset = -REEL_CELLS;
      r.spinning = false;
      r.stopped = false;
      r.strip.style.transitionDuration = '0ms';
    }
    setReelPhase('idle', '待抽取');
    paintReels();
    renderReelReadout(null);
  } else if (seg === 'pick') {
    pickMode = mode;
    pickMod.classList.toggle('pick--after', mode === 'after');
    pickArmed = null;
    pickChosen = null;
    paintPick();
  } else if (seg === 'stack') {
    stackMode = mode;
    stackEl.classList.toggle('stack--after', mode === 'after');
    stackEl.classList.toggle('stack--before', mode === 'before');
    // 每种模式都从「下层已选中一张」开始，才能看出 Esc 到底有没有把它弄丢
    lowArmed = 0;
    buildStack();
    paintStack();
  } else if (seg === 'erosion') {
    erosionMode = mode;
    erosionMod.classList.toggle('erosion--after', mode === 'after');
    erosionMod.classList.toggle('erosion--before', mode === 'before');
    buildErosion();
    paintErosion();
  } else if (seg === 'list') {
    listMode = mode;
    listMod.classList.toggle('list--after', mode === 'after');
    listMod.classList.toggle('list--before', mode === 'before');
    buildList();
  }
}

function replayAll() {
  clearTimers();
  // ① 回到待抽取
  setMode('reel', reelMode);
  // ② 清选中
  pickArmed = null;
  pickChosen = null;
  paintPick();
  // ③ 关上层
  stackOpen = false;
  ovlHigh.hidden = true;
  ovlHigh.setAttribute('hidden', '');
  lowArmed = 0;
  buildStack();
  paintStack();
  // ④ 重置档位
  erosionTier = 4;
  buildErosion();
  paintErosion();
  // ⑤ 重播列表：先清空、下一帧重建，动画才会重跑
  listEl.textContent = '';
  later(() => buildList(), 30);
  say('已重播');
}

function wire() {
  for (const b of $$('[data-seg="vp"] > button')) b.addEventListener('click', () => setVp(b.dataset.vp));
  for (const seg of ['reel', 'pick', 'stack', 'erosion', 'list']) {
    for (const b of $$(`[data-seg="${seg}"] > button`)) {
      b.addEventListener('click', () => {
        for (const x of $$(`[data-seg="${seg}"] > button`)) x.classList.toggle('is-on', x === b);
        setMode(seg, b.dataset.mode);
      });
    }
  }
  startBtn.addEventListener('click', startReels);
  leverEl.addEventListener('click', startReels);
  skipBtn.addEventListener('click', skipReels);
  $('[data-stack-open]').addEventListener('click', openHigh);
  $('[data-ovl-ok]').addEventListener('click', () => closeHigh(false));
  $('[data-stack-esc]').addEventListener('click', () => closeHigh(true));
  $('[data-stack-close]').addEventListener('click', () => closeHigh(false));
  $('[data-list-replay]').addEventListener('click', () => {
    listEl.textContent = '';
    later(() => buildList(), 30);
  });
  $('#replay').addEventListener('click', replayAll);
  $('#rm').addEventListener('change', (e) => {
    document.documentElement.classList.toggle('rm', e.target.checked);
    say(e.target.checked ? '已开启减少动效' : '已关闭减少动效');
    paintShell();
  });
  // Esc 只在增益浮层打开时接管（演示 ③ 的 bug）
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeHigh(true);
  });
}

buildReels();
buildCards();
buildPickCards();
buildStack();
buildErosion();
buildList();
setReelPhase('idle', '待抽取');
wire();
paintShell();
renderReelReadout(null);
paintPick();
paintStack();
paintErosion();
paintList();
say('演示页就绪');

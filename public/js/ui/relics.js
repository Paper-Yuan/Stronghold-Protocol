// public/js/ui/relics.js — 湮灭模拟 · 藏品 UI: the 1-of-3 negative draft overlay, the owned-relic strip and the
// "获得藏品" reveal banner. The server sends the cards in m.private.relics (server/match/relics.js relicPrivateView):
// { owned: [{id,name,desc,tier,kind,set,no,icon}], draft: { id, round, cards } | null, reveal: { seq, ...card } | null }.
//
// The overlay follows the 机变 draft's two-tap grammar (ui/choiceOverlay.js): the first tap selects a card, a second tap
// on the same card (or 确认选择) sends g.relic { idx }. The prep deadline picks one at random, so the overlay is never a
// dead end; Ready is refused server-side while it is open.

import { useCallback, useEffect, useMemo, useRef, useState } from '../../vendor/hooks.module.js';
import { html, Icon } from './components.js';
import { audio } from '../audio.js';

const cx = (...p) => p.flat().filter(Boolean).join(' ');

/* ---- slot-machine SFX: synthesized through the game's own Web Audio SFX bus (respects 音量/静音, no new assets) ---- */
function sfxBus() {
  try {
    const ctx = audio && audio.ctx;
    if (!ctx || ctx.state === 'closed') return null;
    if (ctx.state === 'suspended') { try { ctx.resume(); } catch { /* ignore */ } }
    return { ctx, bus: audio.sfxGain || ctx.destination };
  } catch { return null; }
}

function tone(b, freq, dur, gain, type = 'square', when = 0, to = null) {
  try {
    const { ctx, bus } = b;
    const t0 = ctx.currentTime + when;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(Math.max(20, freq), t0);
    if (to) osc.frequency.exponentialRampToValueAtTime(Math.max(20, to), t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), t0 + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g);
    g.connect(bus);
    osc.start(t0);
    osc.stop(t0 + dur + 0.03);
  } catch { /* audio must never break the UI */ }
}

/** The lever: a low mechanical pull. */
function sndLever() {
  const b = sfxBus(); if (!b) return;
  tone(b, 170, 0.22, 0.075, 'sawtooth', 0, 55);
  tone(b, 90, 0.06, 0.05, 'square');
}
/** One reel tick while spinning (soft, short). */
function sndTick() {
  const b = sfxBus(); if (!b) return;
  tone(b, 950 + Math.random() * 520, 0.028, 0.016, 'square');
}
/** A reel locking into place; n = 0-based reel index (the pitch falls on the later reels). */
function sndStop(n) {
  const b = sfxBus(); if (!b) return;
  const base = 320 - n * 55;
  tone(b, base, 0.18, 0.06, 'triangle', 0, base * 0.45);
  tone(b, base * 2.1, 0.04, 0.02, 'square');
}
/** All three reels stopped: a short rising payout jingle. */
function sndWin() {
  const b = sfxBus(); if (!b) return;
  [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => tone(b, f, 0.14, 0.05, 'triangle', i * 0.09));
  tone(b, 1567.98, 0.35, 0.028, 'sine', 0.36);
}
/** Skipping the animation. */
function sndCancel() {
  const b = sfxBus(); if (!b) return;
  tone(b, 300, 0.08, 0.028, 'square', 0, 180);
}


let cssLoaded = false;
function ensureCss() {
  if (cssLoaded || typeof document === 'undefined') return;
  cssLoaded = true;
  if (document.querySelector('link[data-relics]')) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = '/css/screens/relics.css';
  link.dataset.relics = '1';
  document.head.appendChild(link);
}

/** The draft the overlay shows, or null (shape-checked; the server is authoritative). */
export function normalizeRelicDraft(priv) {
  const r = priv && priv.relics;
  const d = r && r.draft;
  if (!d || !Array.isArray(d.cards) || !d.cards.length) return null;
  // 同盟湮灭的投票信息要原样带到界面（team/votes/myVote/…），不能在这里被裁掉
  return {
    id: String(d.id || d.round),
    round: d.round,
    cards: d.cards.filter(Boolean),
    spinner: Array.isArray(d.spinner) ? d.spinner : undefined,
    team: d.team === true,
    kind: d.kind === 'positive' ? 'positive' : 'negative',
    spinning: d.spinning === true,
    tie: Array.isArray(d.tie) && d.tie.length ? d.tie : null,
    hostId: d.hostId || null,
    myVote: Number.isInteger(d.myVote) ? d.myVote : null,
    votes: Array.isArray(d.votes) ? d.votes : null,
    votedCount: Number.isInteger(d.votedCount) ? d.votedCount : null,
    voterCount: Number.isInteger(d.voterCount) ? d.voterCount : null,
  };
}

const tierName = (tier) => (tier === 'blue' ? '青蓝' : '红色');

/** A card of the draft. */
function RelicCard({ card, armed, disabled, onTap, votes = null, isVote = false, dimmed = false }) {
  const tone = card.tier === 'blue' ? 'blue' : 'red';
  return html`<button type="button" class=${cx('rlc', 'rlc--' + tone, armed && 'is-armed', dimmed && 'is-dimmed')}
      disabled=${disabled} aria-pressed=${armed ? 'true' : undefined}
      aria-label=${card.name + '（' + tierName(card.tier) + '）' + card.desc}
      title=${card.name + '：' + card.desc} onClick=${() => onTap()}>
    <span class="rlc__tier">${tierName(card.tier)}</span>
    ${isVote && votes != null ? html`<span class="rlc__votes" title="当前票数">${votes} 票</span>` : null}
    <span class="rlc__head">
      <span class="rlc__icon"><img src=${card.icon} alt="" loading="lazy" /></span>
      <span class="rlc__titles">
        <b class="rlc__name">${card.name}</b>
        <span class="rlc__set">${card.no ? 'No.' + card.no + ' · ' : ''}${card.set}</span>
      </span>
    </span>
    <span class="rlc__desc">${card.desc}</span>
    ${armed ? html`<span class="rlc__confirm"><b>确认选择</b><small>再次点击</small></span>` : null}
  </button>`;
}

/** 老虎机转轮：图标带向下滚动并缓停到目标图标（中奖线居中）。位移按「条自身高度的百分比」算 —— 格子尺寸由 CSS 决定
 *  （宽屏 92px、≤560px 宽 72px、增益浮层 78px），写死像素会让行程和条高对不上：窄屏时 26 × 92 = 2392px 比
 *  27 × 72 = 1944px 多走 448px，起步那一小段转轮是空的。 */
const REEL_CELLS = 26;

function SlotReel({ items, target, index, spinning, onStop, reduced, stopped = false }) {
  const strip = useMemo(() => {
    // 目标放在最上面，其余随机图案排在下方；滚动时从下往上经过窗口，最终目标落到窗口
    const out = [target];
    for (let i = 0; i < REEL_CELLS; i++) out.push(items.length ? items[(i * 7 + index * 5) % items.length] : target);
    return out;
  }, [items, target, index]);
  const [offset, setOffset] = useState(-REEL_CELLS);
  const duration = 900 + index * 220;   // 1500 + 380i 的三只轮要 2.26s，再加停后 620ms 空拍太贵；这一档合计约 1.74s
  const stopRef = useRef(onStop);
  stopRef.current = onStop;
  // once a reel has spun, a later `spinning: false` (the result phase) must NOT snap it back to the top — the final
  // symbol has to stay in the window; only the blur class drops with `spinning`
  const animatedRef = useRef(false);
  // A NEW target (the next draw) starts from the top of the strip again. Without this the strip stayed on offset 0
  // from the previous draw, so the second positive relic showed its result before the lever was pulled ("提前定格").
  // Compared by ID: every m.private flush rebuilds the card object, and an object comparison would reset the strip
  // mid-spin.
  const targetIdRef = useRef(target && target.id);
  useEffect(() => {
    const id = target && target.id;
    if (targetIdRef.current === id) return;
    targetIdRef.current = id;
    animatedRef.current = false;
    setOffset(-REEL_CELLS);
  }, [target && target.id]);
  useEffect(() => {
    if (!spinning) { if (!animatedRef.current) setOffset(-REEL_CELLS); return undefined; }
    animatedRef.current = true;
    if (reduced) { setOffset(0); stopRef.current(); return undefined; }
    setOffset(0);
    const timer = setTimeout(() => stopRef.current(), duration + 40);
    return () => { clearTimeout(timer); };
  }, [spinning, reduced, duration]);
  return html`<div class=${cx('slot__reel', spinning && 'is-spinning')} data-stopped=${stopped ? '' : null}>
    <div class="slot__strip" style=${{ transform: `translateY(${(offset / strip.length) * 100}%)`, transitionDuration: (spinning ? duration : 0) + 'ms' }}>
      ${strip.map((it, i) => html`<span class="slot__cell" key=${i}><img src=${it && it.icon} alt="" loading="lazy" /></span>`)}
    </div>
    <span class="slot__payline" aria-hidden="true"></span>
  </div>`;
}

/** prefers-reduced-motion: skip the reels and show the cards. */
function useReducedMotion() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return undefined;
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const sync = () => setReduced(!!mq.matches);
    sync();
    if (mq.addEventListener) mq.addEventListener('change', sync);
    return () => { if (mq.removeEventListener) mq.removeEventListener('change', sync); };
  }, []);
  return reduced;
}

/**
 * The draft overlay: a slot-machine draw (three reels stop on the three negative relics), then the two-tap 1-of-3 pick.
 * @param {{ draft: {id:string, round:number, cards:any[], spinner?:any[]}, busyIdx?: number|null, onPick:(idx:number)=>void }} props
 */
export function RelicOverlay({ draft, busyIdx = null, onPick, onStart = null, myId = null, covered = false }) {
  ensureCss();
  const [sel, setSel] = useState(null);
  const [phase, setPhase] = useState('ready');
  const [stopped, setStopped] = useState(0);
  const reduced = useReducedMotion();
  const cards = (draft && draft.cards) || [];
  // 同盟湮灭: one draw for the whole team, decided by a vote (a tie goes to the creator)
  const team = !!(draft && draft.team === true);
  const positive = !!(draft && draft.kind === 'positive');
  // 平票：只有创建者能点一件定案，其他人只看着
  const tie = team && Array.isArray(draft.tie) && draft.tie.length ? draft.tie : null;
  const isCreator = !!(draft && draft.hostId && myId && draft.hostId === myId);
  const myVote = team && Number.isInteger(draft.myVote) ? draft.myVote : null;
  const voteCounts = team && Array.isArray(draft.votes) ? draft.votes : null;
  const items = useMemo(() => {
    const base = (draft && (draft.spinner && draft.spinner.length ? draft.spinner : draft.cards)) || [];
    const out = base.slice();
    // 每次打开都重新洗牌：待机时转轮里是随机图标，不会提前露出本次三张卡
    for (let i = out.length - 1; i > 0; i--) { const k = Math.floor(Math.random() * (i + 1)); [out[i], out[k]] = [out[k], out[i]]; }
    return out;
  }, [draft && draft.id]);
  const tickRef = useRef(0);
  const stoppedRef = useRef(0);
  const wonRef = useRef(false);
  const startRef = useRef(null);
  const phaseRef = useRef(phase);
  phaseRef.current = phase;
  const stopTicks = useCallback(() => { if (tickRef.current) { clearInterval(tickRef.current); tickRef.current = 0; } }, []);
  useEffect(() => {
    setSel(null); setPhase('ready'); setStopped(0);
    stopTicks(); stoppedRef.current = 0; wonRef.current = false;
  }, [draft && draft.id, stopTicks]);
  useEffect(() => () => stopTicks(), [stopTicks]);
  // 同盟房：创建者点了「开始抽取」（server 广播 draft.spinning）才转，其他人在待机画面等
  const spinningOnServer = !!(draft && draft.spinning);
  useEffect(() => {
    if (!team) return undefined;
    if (!spinningOnServer) return undefined;
    const t = setTimeout(() => startRef.current && startRef.current(), 220);
    return () => clearTimeout(t);
  }, [team, spinningOnServer, draft && draft.id]);
  useEffect(() => {
    if (phase === 'spinning' && stopped >= cards.length) {
      // 最后一只轮停下后的「揭晓空拍」：620ms 的静止是每回合的固定税，这里压到 360ms（sndWin 约 0.71s，别再压更短）
      const t = setTimeout(() => setPhase('done'), 360);
      return () => clearTimeout(t);
    }
    return undefined;
  }, [phase, stopped, cards.length]);
  useEffect(() => {
    // 被增益浮层盖住时这一层是 visibility:hidden：Esc 该只作用于最上层，不能顺手把下层的选中也清掉
    if (sel == null || covered) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') setSel(null); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [sel, covered]);
  const start = () => {
    if (phaseRef.current !== 'ready') return;
    if (reduced) { phaseRef.current = 'done'; setPhase('done'); return; }
    stoppedRef.current = 0;
    wonRef.current = false;
    setStopped(0);
    phaseRef.current = 'spinning';
    setPhase('spinning');
    sndLever();
    stopTicks();
    tickRef.current = setInterval(sndTick, 72);
  };
  startRef.current = start;
  const stopAll = () => { stopTicks(); sndCancel(); phaseRef.current = 'done'; setStopped(cards.length); setPhase('done'); };
  const onReelStop = useCallback(() => {
    if (phaseRef.current !== 'spinning') return;
    const n = stoppedRef.current;
    stoppedRef.current = n + 1;
    sndStop(n);
    if (stoppedRef.current >= cards.length && !wonRef.current) {
      wonRef.current = true;
      stopTicks();
      sndWin();
    }
    setStopped(stoppedRef.current);
  }, [cards.length, stopTicks]);
  if (!draft) return null;
  const armed = team ? myVote : (Number.isInteger(sel) && sel >= 0 && sel < cards.length && busyIdx == null ? sel : null);
  const tap = (idx) => {
    if (busyIdx != null) return;
    if (team && !done) return;   // 创建者还没抽，先不能投票
    if (tie) { if (!isCreator || !tie.includes(idx)) return; onPick(idx); return; } // 平票：创建者点了就定案
    if (team) { onPick(idx); return; }   // 一票，可以改投，等所有人投完再结算
    if (armed === idx) { setSel(null); onPick(idx); return; }
    setSel(idx);
  };
  const allBlue = cards.length > 0 && cards.every((c) => c && c.tier === 'blue');
  const done = phase === 'done';
  return html`<div class=${cx('rlov', covered && 'is-covered')} role="dialog" aria-modal="true" aria-hidden=${covered || undefined}
      aria-label="湮灭藏品抽取">
    <div class="rlov__veil" aria-hidden="true"></div>
    <div class="rlov__inner">
      <header class="rlov__head">
        <div>
          <span class="rlov__micro">ANNIHILATION // 湮灭藏品 · ${allBlue ? '青蓝' : '红色'}</span>
          <h2 class="rlov__title">${team ? (tie ? (isCreator ? '平票 · 请创建者选择' : '平票 · 等待创建者') : (positive ? '增益藏品 · 同盟投票' : '负面藏品 · 同盟投票')) : done ? '负面藏品 · 三选一' : '负面藏品 · 转动抽取'}</h2>
          <p class="rlov__sub">${team
            ? '第 ' + draft.round + ' 回合 · 创建者抽取，全队投票（已投 ' + (draft.votedCount ?? 0) + '/' + (draft.voterCount ?? 0) + '）'
              + (tie ? (isCreator ? ' · 平票，请点一件定案' : ' · 平票，等创建者决定…') : ' · 平票由创建者决定')
              + (myVote != null && !tie ? ' · 你已投第 ' + (myVote + 1) + ' 件' : '')
            : done
              ? '第 ' + draft.round + ' 回合 · 点击卡牌选中，再次点击确认' + (armed != null ? ' · 已选中' : '')
              : '第 ' + draft.round + ' 回合 · 转动把手，从藏品池抽出三件'}</p>
        </div>
        <span class="rlov__count">${done ? cards.length + ' 选 1' : phase === 'spinning' ? '抽取中' : '待抽取'}</span>
      </header>

      ${team && !spinningOnServer ? html`<div class="rlov__wait">
        ${isCreator
          ? html`<button type="button" class="rlov__start" disabled=${busyIdx != null}
              onClick=${() => { onStart && onStart(); start(); }}>
              <span class="rlov__start-lever" aria-hidden="true"></span>开始抽取
            </button>
            <small>只有同盟创建者能抽 · 抽完全队投票</small>`
          : html`<span class="rlov__wait-text">等待同盟创建者抽取…</span>`}
      </div>` : null}
      <div class=${cx('slot', done && 'is-done', phase === 'ready' && 'is-ready')}>
        <div class="slot__frame">
          <div class="slot__reels">
            ${cards.map((card, i) => html`<${SlotReel} key=${card.id || i} items=${items} target=${card} index=${i}
              spinning=${phase === 'spinning'} reduced=${reduced} stopped=${stopped > i} onStop=${onReelStop} />`)}
          </div>
          <button type="button" class=${cx('slot__lever', phase !== 'ready' && 'is-pulled')} onClick=${start}
            disabled=${phase !== 'ready' || team} aria-label="转动老虎机把手">
            <span class="slot__lever-arm"><span class="slot__lever-knob"></span></span>
          </button>
          <span class="slot__payline-label" aria-hidden="true">PAYLINE</span>
        </div>
        <div class="slot__actions">
          ${phase === 'ready' && !team ? html`<button type="button" class="slot__start" onClick=${start}>启动藏品抽取</button>` : null}
          ${phase === 'spinning' ? html`<span class="slot__spinning">抽取中…</span><button type="button" class="slot__skip" onClick=${stopAll}>跳过动画</button>` : null}
          ${done ? html`<span class="slot__done-tip">从下方的三件藏品中选择一件</span>` : null}
        </div>
      </div>

      ${done ? html`<div class=${cx('rlov__grid', cards.length <= 3 && 'rlov__grid--3')}>
        ${cards.map((card, i) => html`<${RelicCard} key=${card.id || i} card=${card} armed=${armed === i}
          votes=${voteCounts ? voteCounts[i] : null} isVote=${team}
          dimmed=${!!(tie && !tie.includes(i))}
          disabled=${busyIdx != null || (!!tie && (!isCreator || !tie.includes(i)))} onTap=${() => tap(i)} />`)}
      </div>` : null}
    </div>
  </div>`;
}

function RevealBanner({ reveal }) {
  const [show, setShow] = useState(true);
  useEffect(() => {
    setShow(true);
    const timer = setTimeout(() => setShow(false), 9000);
    return () => clearTimeout(timer);
  }, [reveal && reveal.seq]);
  if (!reveal || !show) return null;
  return html`<span key=${'reveal' + reveal.seq} class=${cx('rlreveal', 'is-' + (reveal.kind === 'negative' ? 'red' : 'blue'))}>
      <img src=${reveal.icon} alt="" />
      <span class="rlreveal__txt"><small>${reveal.kind === 'negative' ? '负面藏品' : '增益藏品'}</small><b>${reveal.name}</b></span>
    </span>`;
}
/** The owned-relic strip (a compact column of medallions; the tooltip carries name + text). */
export function RelicStrip({ relics, reveal }) {
  ensureCss();
  const list = Array.isArray(relics) ? relics : [];
  if (!list.length && !reveal) return null;
  const shown = list.slice(-8);
  const extra = list.length - shown.length;
  return html`<div class="rlstrip" aria-label="已获得的藏品">
    ${shown.map((r) => html`<span key=${r.id} class=${cx('rlstrip__item', 'is-' + (r.tier === 'blue' ? 'blue' : 'red'))}
      title=${r.name + '：' + r.desc} tabindex="0"><img src=${r.icon} alt=${r.name} loading="lazy" /></span>`)}
    ${extra > 0 ? html`<span class="rlstrip__more" title=${'其余 ' + extra + ' 件藏品'}>+${extra}</span>` : null}
    <${RevealBanner} reveal=${reveal} />

  </div>`;
}

/* ---- 藏品图鉴 (all 79 relics, owned marked) ---- */

let catalogPromise = null;
function loadCatalog() {
  if (!catalogPromise) {
    catalogPromise = fetch('/assets/relics/catalog.json', { cache: 'no-cache' })
      .then((r) => (r && r.ok ? r.json() : null))
      .then((j) => (j && Array.isArray(j.relics) ? j.relics : []))
      .catch(() => []);
  }
  return catalogPromise;
}

/** The small top-right entry (below 准备就绪): 藏品 + owned count; flashes for a moment when a new relic arrives. */
export function RelicCodexButton({ count = 0, revealSeq = 0, escalation = 0, onClick }) {
  ensureCss();
  const [flash, setFlash] = useState(false);
  useEffect(() => {
    if (!revealSeq) return undefined;
    setFlash(true);
    const timer = setTimeout(() => setFlash(false), 2600);
    return () => clearTimeout(timer);
  }, [revealSeq]);
  return html`<button type="button" class=${cx('rlcodex-btn', flash && 'is-flash')} onClick=${onClick} title="查看全部藏品（图鉴）" aria-label="打开藏品图鉴">
    <span class="rlcodex-btn__mark">藏</span>
    <span class="rlcodex-btn__label">藏品</span>
    <b class="rlcodex-btn__n num">${count}</b>
    ${escalation > 0 ? html`<span class="rlcodex-btn__esc num" title="藏品已尽：此后每次决策，我方攻击/生命与敌方生命/攻击/防御各 ×1.2">×${Math.pow(1.2, escalation).toFixed(2)}</span>` : null}
  </button>`;
}

const TIER_LABEL = { blue: '青蓝', red: '红色' };

/**
 * The codex overlay: 全部 / 负面 / 增益, a grid on the left and the selected relic's full card on the right.
 * @param {{ open: boolean, owned: any[], onClose: () => void }} props
 */
export function RelicCodex({ open, owned, onClose }) {
  ensureCss();
  const [catalog, setCatalog] = useState([]);
  const [tab, setTab] = useState('all');
  const [sel, setSel] = useState(null);
  const ownedIds = useMemo(() => new Set((Array.isArray(owned) ? owned : []).map((r) => r && r.id).filter(Boolean)), [owned]);
  const ownedById = useMemo(() => new Map((Array.isArray(owned) ? owned : []).filter((r) => r && r.id).map((r) => [r.id, r])), [owned]);
  useEffect(() => {
    if (!open) return undefined;
    loadCatalog().then(setCatalog);
    return undefined;
  }, [open]);
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  useEffect(() => {
    if (!open || !catalog.length) return;
    if (sel && catalog.some((r) => r.id === sel)) return;
    const first = catalog.find((r) => ownedIds.has(r.id)) || catalog[0];
    setSel(first.id);
  }, [open, catalog, ownedIds, sel]);
  if (!open) return null;
  const list = catalog.filter((r) => tab === 'all' || r.kind === tab);
  const card = catalog.find((r) => r.id === sel) || list[0] || null;
  return html`<div class="rlcodex" role="dialog" aria-modal="true" aria-label="藏品图鉴">
    <div class="rlcodex__veil" onClick=${onClose} aria-hidden="true"></div>
    <div class="rlcodex__panel">
      <header class="rlcodex__head">
        <div>
          <span class="rlcodex__micro">ANNIHILATION // RELIC CODEX</span>
          <h2 class="rlcodex__title">藏品图鉴 <span class="num">${ownedIds.size} / ${catalog.length || 79}</span></h2>
        </div>
        <div class="rlcodex__tabs" role="tablist">
          ${[['all', '全部'], ['negative', '负面'], ['positive', '增益']].map(([id, label]) => html`
            <button key=${id} type="button" role="tab" aria-selected=${tab === id ? 'true' : 'false'}
              class=${cx('rlcodex__tab', tab === id && 'is-on')} onClick=${() => setTab(id)}>${label}</button>`)}
        </div>
        <button type="button" class="rlcodex__close" onClick=${onClose} aria-label="关闭">×</button>
      </header>
      <div class="rlcodex__body">
        <div class="rlcodex__scroll">
          ${catalog.length === 0 ? html`<div class="rlcodex__empty">正在读取藏品目录…</div>` : html`
            <div class="rlcodex__grid">
              ${list.map((r) => {
                const own = ownedById.get(r.id);
                return html`
                <button key=${r.id} type="button" class=${cx('rlcdx-card', 'is-' + (r.tier === 'blue' ? 'blue' : 'red'), ownedIds.has(r.id) && 'is-owned', r.id === (card && card.id) && 'is-sel')}
                  onClick=${() => setSel(r.id)} title=${r.name + '：' + r.desc}>
                  <span class="rlcdx-card__icon"><img src=${r.icon} alt="" loading="lazy" /></span>
                  <span class="rlcdx-card__name">${r.name}</span>
                  <span class="rlcdx-card__meta">${TIER_LABEL[r.tier] || ''}${r.no ? ' · No.' + r.no : ''}</span>
                  ${own && own.stacks != null && own.stacks > 0 ? html`<span class="rlcdx-card__count num" title=${'效果计数：' + own.stacks + ' 层' + (own.stackHint ? '（' + own.stackHint + '）' : '')}>×${own.stacks}</span>` : null}
                  ${ownedIds.has(r.id) ? html`<span class="rlcdx-card__own">已获得</span>` : null}
                </button>`;
              })}
            </div>`}
        </div>
        ${card ? html`
          <aside class="rlcodex__detail">
            <div class=${cx('rlcdx-detail__icon', 'is-' + (card.tier === 'blue' ? 'blue' : 'red'))}><img src=${card.icon} alt="" /></div>
            <div class="rlcdx-detail__head">
              <b>${card.name}</b>
              <span class=${cx('rlcdx-detail__tier', card.tier === 'blue' ? 'is-blue' : 'is-red')}>${TIER_LABEL[card.tier] || '藏品'}</span>
              ${ownedIds.has(card.id) ? html`<span class="rlcdx-detail__own">已获得</span>` : html`<span class="rlcdx-detail__miss">未获得</span>`}
            </div>
            <p class="rlcdx-detail__set">${card.kind === 'negative' ? '负面藏品' : '增益藏品'}${card.no ? ' · No.' + card.no : ''} · ${card.set}</p>
            <p class="rlcdx-detail__desc">${card.desc}</p>
        ${(() => {
          const own = ownedById.get(card.id);
          return own && own.stacks != null
            ? html`<p class="rlcdx-detail__stack">效果计数：<b class="num">${own.stacks}</b> 层${own.stackHint ? html`<span class="rlcdx-detail__stack-hint">（${own.stackHint}）</span>` : null}</p>`
            : null;
        })()}
          </aside>` : null}
      </div>
    </div>
  </div>`;
}

/* ---- 增益藏品抽取：三只转轮都停在同一种增益藏品上 ---- */
/**
 * @param {{ card: any|null, onClose: () => void }} props card = the m.private.relics.reveal record (positive)
 */
export function PositiveSlotOverlay({ card, onClose, myId = null }) {
  const canDraw = !card || card.byOwner !== false;
  ensureCss();
  const reduced = useReducedMotion();
  const [items, setItems] = useState([]);
  const [spinning, setSpinning] = useState(false);
  const [stopped, setStopped] = useState(0);
  const [done, setDone] = useState(false);
  const tickRef = useRef(0);
  const stoppedRef = useRef(0);
  const wonRef = useRef(false);
  const stopTicks = useCallback(() => { if (tickRef.current) { clearInterval(tickRef.current); tickRef.current = 0; } }, []);
  useEffect(() => () => stopTicks(), [stopTicks]);
  useEffect(() => {
    loadCatalog().then((list) => {
      const pool = (list || []).filter((r) => r && r.kind === 'positive');
      // 每次增益抽取都重新洗牌，三只转轮仍全部停在同一张
      for (let i = pool.length - 1; i > 0; i--) { const k = Math.floor(Math.random() * (i + 1)); [pool[i], pool[k]] = [pool[k], pool[i]]; }
      setItems(pool);
    });
  }, []);
  useEffect(() => {
    if (!card) return undefined;
    stoppedRef.current = 0;
    wonRef.current = false;
    setStopped(0);
    setSpinning(false);
    setDone(false);
    stopTicks();
    return () => stopTicks();
  }, [card && card.id, stopTicks]);
  const begin = () => {
    if (spinning || done) return;
    if (reduced) { setDone(true); return; }
    setSpinning(true);
    sndLever();
    stopTicks();
    tickRef.current = setInterval(sndTick, 72);
  };
  const skip = () => { stopTicks(); sndCancel(); stoppedRef.current = 3; setStopped(3); setDone(true); setSpinning(false); };
  useEffect(() => {
    if (!card) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [card, onClose]);
  const onReelStop = useCallback(() => {
    if (!spinning || done) return;
    const n = stoppedRef.current;
    stoppedRef.current = n + 1;
    sndStop(n);
    if (stoppedRef.current >= 3 && !wonRef.current) {
      wonRef.current = true;
      stopTicks();
      sndWin();
      setDone(true);
    }
    setStopped(stoppedRef.current);
  }, [spinning, done, stopTicks]);
  if (!card) return null;
  const pool = items.length ? items : [card];
  const tone = card.tier === 'blue' ? 'is-blue' : 'is-red';
  return html`<div class="rlpos" role="dialog" aria-modal="true" aria-label="增益藏品抽取">
    <div class="rlpos__veil" onClick=${onClose} aria-hidden="true"></div>
    <div class="rlpos__inner">
      <header class="rlpos__head">
        <div>
          <span class="rlpos__micro">ANNIHILATION // 增益藏品</span>
          <h2 class="rlpos__title">${done ? '三连 · 增益藏品' : '增益藏品 · 抽取'}</h2>
          <p class="rlpos__sub">${done ? '三个转轮都停在同一种藏品上' : '三个转轮会一起停在同一种增益藏品上'}</p>
        </div>
        <button type="button" class="rlpos__close" onClick=${onClose} aria-label="关闭">×</button>
      </header>
      <div class="rlpos__frame">
        <div class="slot__reels">
          ${[0, 1, 2].map((i) => html`<${SlotReel} key=${(card.id || 'x') + ':' + i} items=${pool} target=${card} index=${i}
            spinning=${spinning} reduced=${reduced} stopped=${stopped > i} onStop=${onReelStop} />`)}
        </div>
        <span class="rlpos__line" aria-hidden="true">TRIPLE</span>
      </div>
      ${!done ? html`<div class="rlpos__actions">
        ${!canDraw ? html`<span class="slot__spinning">由创建者抽取…</span><button type="button" class="slot__skip" onClick=${onClose}>收下</button>` : null}
        ${canDraw && !spinning ? html`<button type="button" class="slot__start" onClick=${begin}>启动抽取</button>` : null}
        ${spinning ? html`<span class="slot__spinning">抽取中…</span><button type="button" class="slot__skip" onClick=${skip}>跳过动画</button>` : null}
      </div>` : null}
      ${done ? html`<div class=${cx('rlpos__result', tone)}>
        <span class="rlpos__icon"><img src=${card.icon} alt="" /></span>
        <div class="rlpos__txt">
          <b>${card.name}</b>
          <small>${card.no ? 'No.' + card.no + ' · ' : ''}${card.set}</small>
          <p>${card.desc}</p>
        </div>
        <button type="button" class="rlpos__ok" onClick=${onClose}>收下</button>
      </div>` : null}
    </div>
  </div>`;
}

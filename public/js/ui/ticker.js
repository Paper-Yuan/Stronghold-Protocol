// Broadcast ticker (m.ticker): a strip under the top bar; each line slides in from the right, stays
// TICKER_MS and leaves; queued lines play by their broadcast priority, first in first out among equals (QUEUE_MAX kept;
// enqueueTickerLines).
// A leader-damage line (BOSS_HIT "{0}博士对敌方领袖造成的伤害超过X%!") is news about the leader in play: it is dropped,
// queued or on screen, once the round it came in is over — the queue can lag a line by up to QUEUE_MAX × TICKER_MS, and
// a Final Assault line must never play over the Hidden Core's fresh leader (player report after 0.1.0: "隐藏boss还没打
// 就出了造成50%伤害播报"). A player's newer BOSS_HIT line of the same round supersedes their older one, queued or on
// screen (it names a higher threshold: the server announces each player's thresholds once each, rising), so a burst
// finish shows its highest milestone before the round ends. Lines carry `type`, `playerId` and `round` from main.js
// (the m.ticker handler). The queue rules are the pure helpers below (test/ui/bosshit-ticker.test.js).

import { useEffect, useRef, useState } from '../../vendor/hooks.module.js';
import { html } from './components.js';
import { GIcon, RichText } from './gameComponents.js';
import { useStore } from '../store.js';
import { audio } from '../audio.js';

const TICKER_MS = 5200;
const QUEUE_MAX = 4;

/**
 * @typedef {{ id: number, text: string, at?: number, type?: string|null, playerId?: string|null, round?: number|null, priority?: number }} TickerLine
 */

/**
 * Whether a ticker line may still play in `round` (m.public.round): every line except a BOSS_HIT line from another
 * round (the Final Assault's lines once the Hidden Core's round started). Lines without a round always play.
 * @param {TickerLine|null} line
 * @param {number|null} round
 */
export function tickerLineLive(line, round) {
  if (!line || line.type !== 'BOSS_HIT') return true;
  return line.round == null || round == null || line.round === round;
}

/**
 * Whether `line` makes `old` redundant: both BOSS_HIT lines of the same (known) player from the same round. The newer one
 * names the higher threshold.
 * @param {TickerLine|null} line
 * @param {TickerLine|null} old
 */
export function tickerSupersedes(line, old) {
  return !!line && !!old && line.type === 'BOSS_HIT' && old.type === 'BOSS_HIT'
    && line.playerId != null && line.playerId === old.playerId && line.round === old.round;
}

/** A line's broadcast priority (activity_table autoChessData.broadcastList `priority`, sent with m.ticker; none = 0). */
const prio = (t) => (t && typeof t.priority === 'number' && Number.isFinite(t.priority) ? t.priority : 0);

/**
 * Takes `fresh` lines in: a line that supersedes the one on screen replaces it there, one that supersedes a queued line
 * replaces that line; every other line queues by priority — research 06 §9.2 "The highest priority wins": BOSS_HIT 30 >
 * CHAR_DAMAGE 20 > SHOP_LEVEL 11 > GOLDEN_CHAR 2 > CHAR_GIFT 1, the remake's own notices between (server Match
 * FLOW_TICKER_PRIORITY) or 0 — behind the queued lines of its priority or higher (first in, first out among equals). The
 * line on screen is never cut short. Past `max` queued lines the lowest priority's oldest goes. Until 0.1.1 the queue
 * was first in, first out, so shop-level and promotion lines held a leader-damage line until its round was over.
 * @param {TickerLine[]} queue
 * @param {TickerLine|null} cur the line on screen
 * @param {TickerLine[]} fresh
 * @returns {{ queue: TickerLine[], cur: TickerLine|null }} `cur` is a fresh line when it replaced the one on screen
 */
export function enqueueTickerLines(queue, cur, fresh, max = QUEUE_MAX) {
  let q = [...queue];
  let c = cur;
  for (const t of fresh) {
    if (!t) continue;
    if (c && tickerSupersedes(t, c)) { c = t; continue; }
    q = q.filter((o) => !tickerSupersedes(t, o));
    let at = q.length;
    while (at > 0 && prio(q[at - 1]) < prio(t)) at--;
    q.splice(at, 0, t);
  }
  while (q.length > max) {
    let low = 0;
    for (let i = 1; i < q.length; i++) if (prio(q[i]) < prio(q[low])) low = i;
    q.splice(low, 1);
  }
  return { queue: q, cur: c };
}

/**
 * A round change: BOSS_HIT lines from another round leave the queue, and the line on screen goes if it is one.
 * @param {TickerLine[]} queue
 * @param {TickerLine|null} cur
 * @param {number|null} round
 */
export function pruneTickerLines(queue, cur, round) {
  return { queue: queue.filter((t) => tickerLineLive(t, round)), dropCur: !!cur && !tickerLineLive(cur, round) };
}

/**
 * The next line to show in `round` and the queue after it (stale BOSS_HIT lines are skipped).
 * @param {TickerLine[]} queue
 * @param {number|null} round
 * @returns {{ line: TickerLine|null, queue: TickerLine[] }}
 */
export function nextTickerLine(queue, round) {
  const q = [...queue];
  let line = q.shift() || null;
  while (line && !tickerLineLive(line, round)) line = q.shift() || null;
  return { line, queue: q };
}

/** Ticker strip bound to store.ticker. */
export function Ticker() {
  const items = useStore((s) => s.ticker);
  const round = useStore((s) => s.match?.public?.round ?? null);
  const seen = useRef(null);
  const queue = useRef([]);
  const roundRef = useRef(round);
  const [cur, setCur] = useState(null);
  const timer = useRef(null);
  roundRef.current = round;

  useEffect(() => {
    const list = Array.isArray(items) ? items : [];
    if (seen.current == null) {
      // lines received before this screen mounted are history, not news
      seen.current = list.length ? list[list.length - 1].id : 0;
      return;
    }
    const fresh = list.filter((t) => t && t.id > seen.current && Date.now() - t.at < 30000);
    if (!fresh.length) return;
    seen.current = fresh[fresh.length - 1].id;
    const r = enqueueTickerLines(queue.current, cur, fresh);
    queue.current = r.queue;
    if (r.cur !== cur) show(r.cur); // a player's newer leader-damage line replaces their older one on screen
    else if (!cur) next();
  }, [items]);

  // a new round: the last round's leader-damage lines leave the queue and the strip
  useEffect(() => {
    const r = pruneTickerLines(queue.current, cur, round);
    queue.current = r.queue;
    if (r.dropCur) next();
  }, [round]);

  useEffect(() => () => clearTimeout(timer.current), []);

  function show(it) {
    setCur(it);
    clearTimeout(timer.current);
    if (it) {
      audio.sfx('broadcast', { volume: 0.5 });
      timer.current = setTimeout(next, TICKER_MS);
    }
  }

  function next() {
    const r = nextTickerLine(queue.current, roundRef.current);
    queue.current = r.queue;
    show(r.line);
  }

  if (!cur) return null;
  return html`<div class="ticker" role="status" aria-live="polite">
    <div key=${cur.id} class="ticker__line"><${GIcon} name="flag" class="ticker__icon" /><${RichText} text=${cur.text} /></div>
  </div>`;
}

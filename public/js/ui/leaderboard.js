// 无尽模式排行榜（玩家可见 · 只读）。
//
// 无尽模式没有胜负：成绩就是「坚持过的回合数」。服务端按昵称累积历史最高回合
// （server/records.js，落盘 data/endless-records.json）。本模块消费公开接口
//   GET /api/endless/leaderboard?limit=30[&name=<昵称>]
// 它只暴露展示字段（name / rounds / runs / solo / at），不含 playerId 等内部标识；
// 传 name 时后端会附带该昵称的排名，用于显示「我的排名」（排名取自完整榜单，
// 不受 limit 影响 —— 即使只列前 30 名，自己排第 87 名也会如实显示）。
// 入榜难度：只有「无尽 · 终极」（ENDLESS_ABYSS）的成绩进榜 —— 四档底难度敌方强度不同，成绩不可比。
// 管理后台另有一份带内部字段的 /api/admin/endless，与本模块无关。
//
// 入口：<LeaderboardButton/>（自管开关状态，可直接放进任意屏幕）。

import { useEffect, useState } from '../../vendor/hooks.module.js';
import { html, Modal, Button, Icon, MicroLabel, Spinner } from './components.js';
import { createStore, useStore } from '../store.js';

const ENDPOINT = '/api/endless/leaderboard';
const DEFAULT_LIMIT = 30;
const CACHE_MS = 10000;

/** @type {{ key: string, at: number, data: any } | null} */
let cache = null;

/**
 * 拉取无尽排行榜（带 10 秒内存缓存，避免反复开关弹窗时打服务端）。
 * @param {{ limit?: number, name?: string, force?: boolean }} [opts]
 */
export async function fetchEndlessLeaderboard({ limit = DEFAULT_LIMIT, name = '', force = false } = {}) {
  const key = `${limit}|${name}`;
  if (!force && cache && cache.key === key && Date.now() - cache.at < CACHE_MS) return cache.data;
  const qs = new URLSearchParams({ limit: String(limit) });
  if (name) qs.set('name', name);
  const res = await fetch(`${ENDPOINT}?${qs.toString()}`, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  if (!data || data.ok !== true) throw new Error('接口返回异常');
  cache = { key, at: Date.now(), data };
  return data;
}

const pad2 = (n) => String(n).padStart(2, '0');
/** @param {any} at 时间戳 */
function fmtDate(at) {
  if (!Number.isFinite(at) || at <= 0) return '—';
  const d = new Date(at);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

const RANK_TONE = { 1: 'gold', 2: 'silver', 3: 'bronze' };

/**
 * 榜单一行。
 * @param {{ row: any, rank: number, self: boolean }} props
 */
function Row({ row, rank, self }) {
  const tone = RANK_TONE[rank] || '';
  return html`<div class=${`lb-row${tone ? ` lb-row--${tone}` : ''}${self ? ' is-self' : ''}`}>
    <span class="lb-row__rank num">${tone ? html`<${Icon} name="crown" class="lb-row__crown" />` : null}${rank}</span>
    <span class="lb-row__name" title=${row.name}>${row.name || '匿名博士'}${self ? html`<span class="lb-row__you">你</span>` : null}</span>
    <span class="lb-row__rounds num">${row.rounds}<i>回合</i></span>
    <span class="lb-row__runs num">${row.runs || 1}<i>局</i></span>
    <span class="lb-row__flags">${row.solo ? html`<span class="lb-tag" title="单人出击">单人</span>` : null}</span>
    <span class="lb-row__date num">${fmtDate(row.at)}</span>
  </div>`;
}

/**
 * 无尽模式排行榜弹窗。
 * @param {{ open: boolean, onClose: Function }} props
 */
export function LeaderboardModal({ open, onClose }) {
  const meName = useStore((s) => s.me.name);
  const [status, setStatus] = useState('idle'); // idle | loading | ready | error
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [reloadAt, setReloadAt] = useState(0);

  useEffect(() => {
    if (!open) return undefined;
    let alive = true;
    setStatus('loading');
    setError('');
    fetchEndlessLeaderboard({ limit: DEFAULT_LIMIT, name: meName || '', force: reloadAt > 0 })
      .then((d) => { if (alive) { setData(d); setStatus('ready'); } })
      .catch((e) => { if (alive) { setError(String(e?.message || e)); setStatus('error'); } });
    return () => { alive = false; };
  }, [open, meName, reloadAt]);

  const rows = Array.isArray(data?.leaderboard) ? data.leaderboard : [];
  const me = data?.me || null;
  const isEmpty = status === 'ready' && rows.length === 0;

  return html`<${Modal} open=${open} onClose=${onClose} tone="mint" class="lb-modal"
      title="无尽 · 终极 排行榜" micro="ENDLESS ABYSS LEADERBOARD" width="min(92vw, 7.2rem)"
      actions=${html`<${Button} variant="ghost" size="md" icon="close" onClick=${onClose}>关闭<//>`}>
    <div class="lb">
      <p class="lb__intro">
        无尽模式没有胜负 —— 坚持得越久，回合数越高。榜单按历史最高回合降序排列，
        <b>只统计「无尽 · 终极」</b>难度的成绩（四档底难度的敌方强度不同，成绩不可比）。
      </p>

      <div class="lb__bar">
        <span class="lb__total">
          ${status === 'ready' ? html`共 <b class="num">${data.total || rows.length}</b> 位博士上榜${
            (data.total || rows.length) > rows.length ? html`<i class="lb__only">仅显示前 ${rows.length} 名</i>` : null}` : html`<${MicroLabel}>LOADING<//>`}
        </span>
        <${Button} variant="secondary" size="sm" icon="refresh" loading=${status === 'loading'}
          disabled=${status === 'loading'} onClick=${() => setReloadAt((n) => n + 1)}>刷新<//>
      </div>

      ${me ? html`<div class="lb-me brackets">
        <span class="lb-me__rank"><${MicroLabel} tone="gold">MY RANK</${MicroLabel}><b class="num">#${me.rank}</b></span>
        <span class="lb-me__name">${me.name || meName}</span>
        <span class="lb-me__rounds num">${me.rounds}<i>回合</i></span>
      </div>` : null}

      ${status === 'loading' && !rows.length ? html`<div class="lb__state"><${Spinner} size="md" label="LOADING" /></div>` : null}

      ${status === 'error' ? html`<div class="lb__state lb__state--err">
        <${Icon} name="warn" />
        <p>排行榜加载失败：${error}</p>
        <${Button} variant="secondary" size="sm" icon="refresh" onClick=${() => setReloadAt((n) => n + 1)}>重试<//>
      </div>` : null}

      ${isEmpty ? html`<div class="lb__state">
        <${Icon} name="hourglass" />
        <p>还没有任何记录 —— 去开一局「无尽 · 终极」，把你的回合数写上榜单吧。</p>
      </div>` : null}

      ${rows.length ? html`<div class="lb__table">
        <div class="lb-row lb-row--head">
          <span class="lb-row__rank">#</span>
          <span class="lb-row__name">博士</span>
          <span class="lb-row__rounds">最高回合</span>
          <span class="lb-row__runs">对局</span>
          <span class="lb-row__flags"></span>
          <span class="lb-row__date">最近</span>
        </div>
        <div class="lb__list">
          ${rows.map((r, i) => html`<${Row} key=${`${i}-${r.name}`} row=${r} rank=${i + 1} self=${!!meName && r.name === meName} />`)}
        </div>
      </div>` : null}
    </div>
  <//>`;
}

/**
 * 排行榜弹窗的开关状态。
 *
 * 必须是「全局 + 命令式」：弹窗若直接渲染在按钮内部，就会落在某些屏幕的
 * transform 祖先里，`position: fixed` 的遮罩会被那个祖先困住（尺寸塌成容器大小、
 * 位置错乱）。所以照 GuideHost / LoadoutHost 的做法，把弹窗挂到 <LeaderboardHost/>
 * （由 main.js 在 .app-root 下挂一次），按钮只负责发命令。
 */
export const leaderboardStore = createStore({ open: false });
export const openLeaderboard = () => leaderboardStore.set({ open: true });
export const closeLeaderboard = () => leaderboardStore.set({ open: false });

/**
 * 「排行榜」按钮：只发打开命令，不自己渲染弹窗（见 leaderboardStore 注释）。
 * @param {{ class?: string, variant?: string, size?: string, label?: string, icon?: string, block?: boolean, title?: string }} props
 */
export function LeaderboardButton({ class: cls, variant = 'secondary', size = 'sm', label = '排行榜', icon = 'crown', block = false, title = '无尽 · 终极 排行榜' }) {
  return html`<${Button} variant=${variant} size=${size} icon=${icon} class=${cls} block=${block} title=${title}
    aria-label=${title} onClick=${openLeaderboard}>${label}<//>`;
}

/** 全局宿主：由 main.js 挂一次（与 <GuideHost/> 同级）。 */
export function LeaderboardHost() {
  const open = useStore((s) => s.open, Object.is, leaderboardStore);
  return html`<${LeaderboardModal} open=${open} onClose=${closeLeaderboard} />`;
}

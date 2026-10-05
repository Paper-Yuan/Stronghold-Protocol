// lobbyBoard.js — ES2020-compliant public room board client & Preact UI component.
// Fetches active rooms from Cloudflare Worker room board & community sources.
// Compatible with the sp-lobby-board contract (Rainya-compatible additive fields).

import { useEffect, useRef, useState } from '../../vendor/hooks.module.js';
import { html, Button, Icon, MicroLabel, Panel, Spinner, DifficultyTag, DifficultyIcon } from './components.js';
import { toast, toastError } from './toasts.js';
import { DIFFICULTY_NAMES, DIFFICULTY_COLORS } from '../../../shared/constants.js';

export const BOARD_API = 'https://sp-lobby.jiangjiangze.icu/api/rooms';
export const RELAY_API = 'https://sp-lobby.jiangjiangze.icu/api/community?src=rainya';

const TOKENS_KEY = 'sp.lobby.tokens';
const FETCH_TIMEOUT_MS = 6000;
const CODE_RE = /^[A-HJ-NP-Z0-9]{4}$/;

function readTokens() {
  try {
    const o = JSON.parse(localStorage.getItem(TOKENS_KEY) || '{}');
    return (o && typeof o === 'object' && !Array.isArray(o)) ? o : {};
  } catch {
    return {};
  }
}

function writeTokens(o) {
  try {
    localStorage.setItem(TOKENS_KEY, JSON.stringify(o || {}));
  } catch {
    /* private browsing */
  }
}

export function isRoomPublic(code) {
  if (!code) return false;
  const c = String(code).trim().toUpperCase();
  const tokens = readTokens();
  return Boolean(tokens[c]);
}

export function saveRoomToken(code, token) {
  if (!code || !token) return;
  const c = String(code).trim().toUpperCase();
  const tokens = readTokens();
  tokens[c] = String(token);
  writeTokens(tokens);
}

export function removeRoomToken(code) {
  if (!code) return;
  const c = String(code).trim().toUpperCase();
  const tokens = readTokens();
  if (tokens[c]) {
    delete tokens[c];
    writeTokens(tokens);
  }
}

/** Check if host is loopback or local private address. */
export function isPrivateHost(host) {
  const h = String(host || '').toLowerCase().replace(/^\[/, '').replace(/\]$/, '');
  if (!h || h === 'localhost' || h === '::1' || h === '0.0.0.0' || h === 'local') return true;
  if (/\.local$/.test(h)) return true;
  if (/^127\./.test(h) || /^10\./.test(h) || /^192\.168\./.test(h) || /^169\.254\./.test(h)) return true;
  const m = /^172\.(\d{1,3})\./.exec(h);
  return Boolean(m && Number(m[1]) >= 16 && Number(m[1]) <= 31);
}

/** Format remaining time into mm:ss */
export function formatLeftTime(sec) {
  const s = Math.max(0, Math.floor(sec || 0));
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return `${m}:${rem < 10 ? '0' : ''}${rem}`;
}

/** Publish a room to the public board. */
export async function toggleRoomPublic(code, meta = {}) {
  const c = String(code || '').trim().toUpperCase();
  if (!CODE_RE.test(c)) return { ok: false, error: '同盟密钥无效' };

  const currentToken = readTokens()[c];
  if (currentToken) {
    // Withdraw room
    try {
      const url = `${BOARD_API}?code=${encodeURIComponent(c)}&serverId=${encodeURIComponent(meta.serverId || location.host)}`;
      const res = await fetch(url, {
        method: 'DELETE',
        headers: { 'X-Token': currentToken },
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.ok) {
        removeRoomToken(c);
        return { ok: true, isPublic: false, text: '已从公共大厅下架' };
      }
      return { ok: false, error: data.error || '下架失败' };
    } catch (err) {
      return { ok: false, error: '网络异常，请重试' };
    }
  }

  // Publish room
  const hostname = location.hostname;
  if (isPrivateHost(hostname)) {
    return {
      ok: false,
      error: '本机为私有或单机网络（127.0.0.1 / 内网），外部玩家无法直接通过公网连接。请在公网服开房后再公开。',
    };
  }

  const payload = {
    code: c,
    serverId: meta.serverId || location.host,
    serverName: meta.serverName || (location.host.includes('rainya') ? 'Rainya 源' : '当前服务器'),
    note: meta.note || '',
    difficulty: meta.difficulty || 'NORMAL',
    mode: meta.mode || 'coop',
    url: location.origin + location.pathname + `?room=${c}`,
  };

  try {
    const res = await fetch(BOARD_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok && data.ok && data.token) {
      saveRoomToken(c, data.token);
      return { ok: true, isPublic: true, text: '已成功公开到公共大厅（10分钟有效）' };
    }
    return { ok: false, error: data.error || '公开到大厅失败' };
  } catch (err) {
    return { ok: false, error: '网络异常，无法连接房间大厅服务器' };
  }
}

/** Fetch public rooms from the Cloudflare Worker board. */
export async function fetchPublicRooms() {
  const fetchWithTimeout = async (url) => {
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS) : null;
    try {
      const res = await fetch(url, {
        cache: 'no-store',
        signal: controller ? controller.signal : undefined,
      });
      if (timer) clearTimeout(timer);
      if (!res.ok) return null;
      return await res.json();
    } catch {
      if (timer) clearTimeout(timer);
      return null;
    }
  };

  const [boardData, relayData] = await Promise.all([
    fetchWithTimeout(BOARD_API),
    fetchWithTimeout(RELAY_API),
  ]);

  const roomsMap = new Map();
  let visitors = 0;

  if (boardData && Array.isArray(boardData.rooms)) {
    visitors = boardData.visitors || 0;
    for (const r of boardData.rooms) {
      if (r && r.code && CODE_RE.test(r.code)) {
        roomsMap.set(r.code, { ...r, source: 'sp-board' });
      }
    }
  }

  if (relayData && Array.isArray(relayData.rooms)) {
    for (const r of relayData.rooms) {
      if (r && r.code && CODE_RE.test(r.code) && !roomsMap.has(r.code)) {
        roomsMap.set(r.code, { ...r, source: 'community' });
      }
    }
  }

  const list = Array.from(roomsMap.values()).map((r) => ({
    code: r.code,
    server: r.serverName || r.server || '公共对局',
    url: r.url || '',
    note: r.note || '',
    difficulty: r.difficulty || 'NORMAL',
    mode: r.mode || 'coop',
    status: r.status || (r.occupied >= (r.capacity || 4) ? 'full' : 'waiting'),
    occupied: r.occupied ?? r.humans ?? 1,
    capacity: r.capacity || 4,
    leftSec: Number.isFinite(r.leftSec) ? r.leftSec : 600,
  }));

  // Sort: waiting rooms first, then by leftSec descending
  list.sort((a, b) => {
    if (a.status === 'waiting' && b.status !== 'waiting') return -1;
    if (b.status === 'waiting' && a.status !== 'waiting') return 1;
    return b.leftSec - a.leftSec;
  });

  return { ok: true, visitors, rooms: list };
}

/**
 * LobbyBoard component.
 * Displays live public rooms with difficulty, status, countdown, and 1-click join.
 */
export function LobbyBoard({ onSelectCode, onDirectJoin }) {
  const [rooms, setRooms] = useState([]);
  const [visitors, setVisitors] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [collapsed, setCollapsed] = useState(false);
  const mountedRef = useRef(true);

  const loadRooms = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetchPublicRooms();
      if (!mountedRef.current) return;
      if (res.ok) {
        setRooms(res.rooms);
        setVisitors(res.visitors);
      } else {
        setError('暂未获取到房间数据');
      }
    } catch {
      if (mountedRef.current) setError('获取大厅房间失败');
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  };

  useEffect(() => {
    mountedRef.current = true;
    loadRooms();
    const interval = setInterval(loadRooms, 30000); // 30s auto-refresh
    return () => {
      mountedRef.current = false;
      clearInterval(interval);
    };
  }, []);

  // 1-second countdown ticker for leftSec
  useEffect(() => {
    const timer = setInterval(() => {
      setRooms((prev) =>
        prev
          .map((r) => ({ ...r, leftSec: Math.max(0, r.leftSec - 1) }))
          .filter((r) => r.leftSec > 0)
      );
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  const handleRoomClick = (room) => {
    if (onDirectJoin) {
      onDirectJoin(room);
    } else if (onSelectCode) {
      onSelectCode(room.code);
    }
  };

  return html`<${Panel} class="lobby-board-panel" tone="teal">
    <div class="lobby-board-header">
      <div class="lobby-board-title">
        <${Icon} name="signal" />
        <span class="title-text">公共联机大厅</span>
        <${MicroLabel} tone="mint">ONLINE LOBBY<//>
        ${visitors > 0 ? html`<span class="visitors-pill num">${visitors} 人在线</span>` : null}
      </div>
      <div class="lobby-board-actions">
        <button
          type="button"
          class="btn-board-toggle"
          onClick=${() => setCollapsed(!collapsed)}
          title=${collapsed ? '展开大厅' : '折叠大厅'}
        >
          <${Icon} name=${collapsed ? 'chevronRight' : 'chevronLeft'} />
          <span>${collapsed ? '展开' : '收起'}</span>
        </button>
        <button
          type="button"
          class=${`btn-board-refresh ${loading ? 'is-loading' : ''}`}
          onClick=${loadRooms}
          disabled=${loading}
          title="刷新大厅房间"
        >
          <${Icon} name="refresh" />
          <span>${loading ? '刷新中…' : '刷新'}</span>
        </button>
      </div>
    </div>

    ${collapsed
      ? null
      : html`
          <div class="lobby-board-content">
            ${loading && !rooms.length
              ? html`<div class="board-loading"><${Spinner} size="sm" /><span>正在同步全服同盟房间…</span></div>`
              : error && !rooms.length
              ? html`<div class="board-error"><span>${error}</span><button type="button" onClick=${loadRooms} class="retry-link">重试</button></div>`
              : rooms.length === 0
              ? html`<div class="board-empty">
                  <span>当前暂无活跃的公共房间。创建同盟后可在等待室点击「公开到大厅」让其他博士加入。</span>
                </div>`
              : html`<div class="room-grid">
                  ${rooms.map((r) => {
                    const diffColor = DIFFICULTY_COLORS[r.difficulty] || 'var(--mint-500)';
                    const diffName = DIFFICULTY_NAMES[r.difficulty]?.replace('模拟', '') || r.difficulty;
                    const isFull = r.status === 'full' || r.occupied >= r.capacity;
                    return html`<div
                      key=${r.code}
                      class=${`room-card ${isFull ? 'is-full' : ''}`}
                      style=${`--card-diff-color: ${diffColor}`}
                      onClick=${() => handleRoomClick(r)}
                    >
                      <div class="room-card__header">
                        <span class="room-card__code num">${r.code}</span>
                        <span class="room-card__diff" style=${`color: ${diffColor}`}>
                          <${DifficultyIcon} difficulty=${r.difficulty} />
                          <span>${diffName}</span>
                        </span>
                        <span class="room-card__left num">${formatLeftTime(r.leftSec)}</span>
                      </div>
                      <div class="room-card__body">
                        <span class="room-card__server">${r.server}</span>
                        ${r.note ? html`<span class="room-card__note" title=${r.note}>${r.note}</span>` : null}
                      </div>
                      <div class="room-card__footer">
                        <span class="room-card__seats">
                          <${Icon} name="users" />
                          <span class="num">${r.occupied}/${r.capacity}</span>
                        </span>
                        <button
                          type="button"
                          class="room-card__btn"
                          disabled=${isFull}
                        >
                          ${isFull ? '满员' : '加入'}
                        </button>
                      </div>
                    </div>`;
                  })}
                </div>`}
          </div>
        `}
  <//>`;
}

// public/js/ui/chatBox.js — 房间与局内文字聊天 (room.chat, shared/protocol.js · server/lobby.js `chat`): the log, the
// input and the trigger button of the room's text channel.
//
// The server broadcasts every line to the whole room (its lobby and its running match alike, players and spectators
// both) and stores nothing, so this component keeps the tail of what it has seen (store.js `pushChatMessage`, a ring
// buffer of CHAT_KEEP) — a client that joins later sees only the lines after it joined. Every string here goes through
// t() (public/i18n/en.json carries the translations; test/i18n.test.js fails on an unwrapped Han literal).
//
// Two ways in, matching the two screens it mounts on (screens/room.js, screens/game.js):
//   controlled  (`active` given) — the parent owns the open state; the caller draws its own trigger (the game HUD's
//               chat gear), so no trigger button is rendered here;
//   uncontrolled (`active` undefined) — the panel carries its own trigger and its own state (the room screen).
// Enter opens the input (when closed), Escape closes it. A line that cannot reach the server (offline / a single-player
// dev page) is echoed locally instead of vanishing, so the log still works without a room.

import { html } from './components.js';
import { useState, useEffect, useRef } from '../../vendor/hooks.module.js';
import { net } from '../net.js';
import { store, useStore, pushChatMessage } from '../store.js';
import { getRoomDanmaku } from './roomDanmaku.js';
import { toast } from './toasts.js';
import { t } from '../../../shared/i18n.js';

/** Seat colours, one per player seat (the spectator gets its own class). */
const SEAT_CLASS = Object.freeze(['seat-0', 'seat-1', 'seat-2', 'seat-3']);

/**
 * @param {{ active?: boolean, onToggle?: (v: boolean) => void, showTrigger?: boolean }} props
 */
export function ChatBox({ active: controlledActive, onToggle, showTrigger = controlledActive === undefined }) {
  const messages = useStore((s) => s.chatMessages) || [];
  const [internalActive, setInternalActive] = useState(false);
  const active = controlledActive !== undefined ? controlledActive : internalActive;
  const setActive = onToggle || setInternalActive;
  const [draft, setDraft] = useState('');
  const [danmakuOn, setDanmakuOn] = useState(() => getRoomDanmaku().enabled);
  const inputRef = useRef(null);
  const logRef = useRef(null);

  // Keep the newest line in view.
  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [messages.length]);

  useEffect(() => {
    if (active) setTimeout(() => inputRef.current?.focus(), 40);
  }, [active]);

  // Desktop: Enter opens the input, Escape closes it (局内生效；局外不截获按键).
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Enter') {
        const inMatch = Boolean(store.get().room?.inMatch);
        if (!inMatch) return;
        if (!active) { e.preventDefault(); e.stopPropagation(); setActive(true); }
      } else if (e.key === 'Escape') {
        if (active) { setActive(false); inputRef.current?.blur(); }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active, setActive]);

  const toggleDanmaku = (e) => {
    e?.preventDefault?.();
    e?.stopPropagation?.();
    const next = getRoomDanmaku().toggle();
    setDanmakuOn(next);
  };

  const send = async (e) => {
    e?.preventDefault?.();
    const text = draft.trim();
    setDraft('');
    setActive(false);
    if (!text) return;
    const room = store.get().room;
    const pub = store.get().match?.public;
    const rawCode = room?.code || '';
    const code = typeof rawCode === 'string' && rawCode.length === 4 ? rawCode : undefined;
    const me = store.get().me;
    let seat = 0;
    if (pub?.players) {
      const idx = pub.players.findIndex((p) => p.playerId === me?.playerId);
      if (idx >= 0) seat = pub.players[idx].seat ?? idx;
    } else if (room?.players) {
      const idx = room.players.findIndex((p) => p.playerId === me?.playerId);
      if (idx >= 0) seat = idx;
    }
    const localMsg = {
      playerId: me?.playerId || 'me',
      name: me?.name || t('博士'),
      seat,
      isSpectator: false,
      text,
      at: Date.now(),
    };

    // 乐观立即弹出自己发送的弹幕（确保单人/多人/离线立即呈现）
    try {
      getRoomDanmaku().show(localMsg, true);
    } catch (err) {
      console.warn('[chat] local danmaku render error', err);
    }

    try {
      if (net.status !== 'online' || !room) {
        // offline / single-player dev page: echo locally into log
        pushChatMessage(localMsg);
        return;
      }
      const chatPayload = code ? { text, code } : { text };
      await net.request('room.chat', chatPayload);
    } catch (err) {
      console.warn('[chat] send failed', err);
      if (err?.code === 'RATE') { toast(t('发言过于频繁，请稍候'), 'warn'); return; }
      if (net.status !== 'online' || !store.get().room) {
        pushChatMessage(localMsg);
        return;
      }
      toast(err?.message ? t(err.message) : t('发送失败，请重试'), 'warn');
    }
  };

  return html`
    <div class=${`chat-panel ${active ? 'is-active' : ''}`}>
      <div class="chat-log" ref=${logRef}>
        ${messages.map((m, i) => {
          const seatLabel = m.isSpectator ? t('观战') : `P${(m.seat ?? 0) + 1}`;
          const colorCls = m.isSpectator ? 'seat-spec' : (SEAT_CLASS[m.seat] || '');
          return html`
            <div key=${i} class="chat-item">
              <span class=${`chat-seat ${colorCls}`}>[${seatLabel}] ${m.name || t('博士')}:</span>
              <span class="chat-text">${m.text}</span>
            </div>
          `;
        })}
      </div>

      ${active ? html`
        <form class="chat-form" onSubmit=${send}>
          <input
            ref=${inputRef}
            type="text"
            class="chat-input"
            maxlength="80"
            placeholder=${t('输入对话 (Enter发送, Esc取消)...')}
            value=${draft}
            onInput=${(e) => setDraft(e.target.value)}
            onKeyDown=${(e) => e.stopPropagation()}
            onBlur=${() => { setTimeout(() => { if (!draft) setActive(false); }, 180); }}
          />
          <button
            type="button"
            class=${`chat-danmaku-btn ${danmakuOn ? 'is-on' : ''}`}
            onMouseDown=${(e) => e.preventDefault()}
            onTouchStart=${(e) => e.preventDefault()}
            onClick=${toggleDanmaku}
            title=${danmakuOn ? t('弹幕已开启 (点击关闭)') : t('弹幕已关闭 (点击开启)')}
          >
            ${danmakuOn ? t('弹幕开') : t('弹幕关')}
          </button>
          <button type="submit" class="chat-send-btn">${t('发送')}</button>
        </form>
      ` : (showTrigger ? html`
        <button type="button" class="chat-trigger-btn" title=${t('打开对话')} aria-label=${t('打开对话')}
          onClick=${() => { setActive(true); setTimeout(() => inputRef.current?.focus(), 30); }}>
          <span aria-hidden="true">💬</span>
        </button>
      ` : null)}
    </div>
  `;
}

// Room screen (同盟等待室), laid out like the event's room: 4 tall seat cards (the 名片干员 portrait or the avatar frame,
// 创建者, the ready state at the bottom, the name plate under the card; an empty seat offers 邀请 — copies the key — and,
// to the host, 添加 AI 队友; the host's 移出 / 移除 AI 队友 at a card's top right), the top bar (leave, mode and ping, 统计 /
// 设置 / 玩法说明, 干员调配 and the 同盟密钥 with 复制 / the link), the bottom: the ready count and status line, the
// difficulty pill and ⚙ 同盟设置 (co-op; a timed solo's ⚙ is 模拟设置 and holds 「不限时」, DESIGN §35.23.10; the ⚙ sits where the event's pill has 快速搜寻 — matchmaking is dropped by the
// maintainer's PR #643 keep / drop list of 2026-10-15), and the big 开始模拟 / 准备就绪 button (its disabled reason in
// the project's Tooltip: hover, or a long press on touch; the status line says it too).
// Room settings: a co-op room is created at once from the lobby's 创建同盟 (the event's 联合模拟, research 06 §3.2; the
// maintainer's decision of 2026-10-21), so the difficulty is chosen here — the host's pill (or ⚙'s 模拟难度 row) opens
// 选择模拟协议 (screens/lobby.js ProtocolSelect) whose 确认 sends room.setDifficulty; the dialog closes only once the
// server took it (a refusal keeps it open with the error toast), and its hint states the server's rules: the other
// doctors have to ready again, a plugin mode the host chose is left. ⚙ 同盟设置 lists the 模拟难度 and the
// 「AI 队友最后选择」 switch. The other doctors (and spectators) open the same screens read-only — the cards shown,
// not chosen, 由创建者选择 / 由创建者设置 — and a toast tells them when the host changed the difficulty [ASSUMED: a
// remake aid, since the change reset their ready state; how the event tells the others is not recorded].
//
// Start rule (server/lobby.js): room.start needs every *other* human connected and ready; the
// host's start counts as the host's ready. So 开始模拟 is enabled exactly then and sends room.start
// alone (no separate room.ready round trip that could leave the host "ready" after a failed start).
// 房间人数 (room.setSeats, the owner's decision 2026-10-31): the room layer seats 4 / 8 / 12 and the match layer now
// plays all three (docs/TWELVE_PLAYER_MODE.md: one team per 4 seats), so 开始模拟 has no capacity gate any more — the
// temporary first-layer gate and its hint/status line were removed with the second layer.
// Solo rooms show a single seat.
// Spectator seats (community report #26, a remake feature): a co-op room with spectators shows the 观战席 strip under
// the seats — names, offline marks, the host's ✕ (room.removeSpectator) — and a spectator's own view swaps the ready
// button for 观战中 and offers 入座 (room.join of the room) while a player seat is free.
// Plugins (DESIGN §32 P1a): the tag under the title — 「原版」 or 「插件 ×N」 — opens the 插件 panel (ui/pluginPanel.js:
// the host switches the room's plugins, everybody else reads them). With gameplay plugins (§32.6: a content set of its
// own — the tag reads 「非官方」 too) every seat shows whether its page has loaded and checked the room's content
// (seats[].content: 载入中 / 就绪 / 校验失败), 准备就绪 and 开始模拟 wait for it (the server refuses them before:
// CONTENT_NOT_READY), and a plugin mode the host chose shows beside the mode name in the top bar (the orange chip).
// 名片干员 (PR #643 split 6): a doctor's seat card shows an operator's portrait — the one the player picked (更换立绘 on
// one's own seat opens the picker: search, rarity, 默认; kept as a pref — ui/seatArt.js cardStore — and sent as
// room.card by ui/loadoutSync.js installCardSync, so the room sees it as seats[].card), else one of the 5★/6★ operators
// chosen by the player id (ui/seatArt.js), the same on every client. [ASSUMED] The pick made here and kept in this
// browser stands in for the event's account assistant (名片形象); [ASSUMED] the default by player id is a remake rule.
// Outfits (docs/SKINS.md; the maintainer's decision 4 of 2026-10-21): the portrait wears the player's outfit — one's own
// card this browser's choice at once, another doctor's the map that seat published (room.state seats[].skins) unless
// 「显示其他玩家的皮肤」 is off; an outfit this page's appearance plugins do not have draws the default art (ui/seatArt.js
// seatCardSkin). The picker is one's own picker, so its tiles wear one's own outfits too (like 干员调配's).
// Without the art pack the card keeps its avatar frame; a bot keeps its robot frame.
// Official versions (DESIGN §35.23, M1; versions.js): a room plays one version (room.state.version; absent = 第二期下半).
// Another version's name shows beside the mode in the top bar (ui/pluginTag.js VersionTag) and every page loads and checks
// its data like a gameplay plugin's content set (content.js) — the seat tags read 版本数据载入中 / 就绪 / 校验失败 and
// 准备就绪 / 开始模拟 wait for it (needsContent: gameplay plugins or another version; 非官方 stays the plugins' alone).
// The version pill beside the difficulty (and ⚙'s 版本 row in co-op) opens the version picker (ui/versionPicker.js): the
// host's pick proposes the switch (room.proposeVersion: a lone human's room switches at once; otherwise the seated humans
// vote — ui/versionVote.js, the strip between the 观战席 and the footer); everybody else reads it (由创建者发起). It is off
// during a vote, with gameplay plugins on (they play 第二期下半 only) and offline. A switch is told to everybody (a toast,
// never on entering a room), and a room whose version is not this browser's lobby choice says that leaving restores it.
// Texts go through t() (docs/I18N.md).

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from '../../vendor/hooks.module.js';
import { DIFFICULTY_NAMES, DIFFICULTY_COLORS, MAX_SEATS, MAX_SEATS_CAP, ROOM_SEAT_CAPS, MAX_SPECTATORS } from '../../../shared/constants.js';
// 单人系房间（solo 与 solo_infinite）只显示 1 个座位、没有邀请 / 加 AI；之前用 mode === 'solo' 判断，
// 超限单人被当成同盟房渲染成 4 座（业主 2026-10-26）。
import { isSoloRoomMode, isInfiniteMode } from '../../../shared/infiniteMode.js';
// 湮灭模拟（拓展模式的首个玩法包）的蚀流档位：难度不新增枚举，靠 ANNIHILATION + erosion 1..6 区分（docs/EXTENSION_MODE.md §3.1）
import { ANNIHILATION_DIFFICULTY, EROSION_MAX } from '../../../shared/annihilation-constants.js';
import {
  html, Button, Icon, MicroLabel, PingPill, AvatarFrame, DifficultyIcon, Tooltip, Spinner, confirmDialog, doctorNo, Modal,
  TextField,
} from '../ui/components.js';
import { toast, toastError } from '../ui/toasts.js';
import { TestMark } from '../ui/testConsole.js';
import { copyText } from '../ui/clipboard.js';
import { mountRoomChat } from '../ui/roomChat.js';
import { GuideButton } from '../ui/guide.js';
import { openStats } from './stats.js';
import { SettingsButton } from '../ui/settings.js';
import { LoadoutButton } from './loadout.js';
import { PluginTag, VersionTag, isModdedRoom } from '../ui/pluginTag.js';
import { VersionVote, versionVoteOf } from '../ui/versionVote.js';
import { VersionPicker } from '../ui/versionPicker.js';
import { DEFAULT_VERSION, lobbyVersion, needsContent, offeredDifficulties, roomVersion, serverDefaultVersion, soloTimedOf, soloTimeMsgid, versionLabel } from '../versions.js';
// 玩法包房间的判据（官方 / 炸惊 / 湮灭）：版本、难度、插件由玩法包锁死；房里不跑版本检测链（业主 2026-10-28 P0-4/P0-5）
import { extensionRoomOf } from '../ui/zjView.js';
import { hasScriptConsent, rememberScriptConsent, pageVersion } from '../content.js';
import { net } from '../net.js';
import { store, useStore, shallowEqual, emptyMatch, isSpectating, savePref } from '../store.js';
import { data, useData, getConfig } from '../data.js';
import { chessAvatarUrl, chessPortraitUrl } from '../ui/assetUrls.js';
// 名片立绘微调（业主 2026-10-28 A 项）：座位卡上显示的精一/精二、缩放与框内平移（ui/cardArt.js 存本机 pref）。
import { CardArt, CardArtImage } from '../ui/cardArt.js';
// 名片（B 项）：自己的座位牌上回显本机选的名片底图（与大厅个人条同一份 pref，ui/accounts.js）
import { useCurrentAccount } from '../ui/accounts.js';
import { NameCardLayer } from '../ui/namecards.js';
import { CARD_KEY, cardStore, setCard, cardOperators, cardContext, seatOperator, seatCardSkin, seatArtSrc } from '../ui/seatArt.js';
import { skinsStore, SKINS_KEY, ownerSkin } from '../ui/skins.js';
import { settingsStore } from '../ui/settingsStore.js';
import { difficultyInfo, ProtocolSelect, INFINITE_OPTION } from './lobby.js';
// 炸惊模拟（拓展模式的第二个玩法包）：房内顶栏的「规则」按钮翻开它自己的规则速览（ui/zhajingRules.js）。
// 难度的名字与颜色在 shared/constants.js 的 DIFFICULTY_NAMES / DIFFICULTY_COLORS 里（照 ANNIHILATION 的写法各加一项）。
import { ZHAJING_DIFFICULTY } from './extensionModes.js';
import { ZhajingRulesButton, ZhajingRulesDialog } from '../ui/zhajingRules.js';
// 炸惊模拟的卡池预选（C 项）：房内改自己的 ban 名单，走已就绪的 `room.bans`（配额取自 config.bans.ZHAJING）
import { ZhajingBansButton, ZhajingBanPicker } from '../ui/banPicker.js';
import { useRise } from '../ui/transitions.js';
import { t, tc } from '../../../shared/i18n.js';

/**
 * Seats padded to the room's capacity (co-op 4, solo 1), each null or a seat record.
 * @param {any} room room.state payload
 * @returns {(null | {seat:number, playerId:any, name:string, isBot:boolean, ready:boolean, connected:boolean})[]}
 */
export function normalizeSeats(room) {
  const cap = isSoloRoomMode(room?.mode) ? 1 : seatCapacity(room);
  const src = Array.isArray(room?.seats) ? room.seats : [];
  const out = [];
  for (let i = 0; i < cap; i++) {
    const s = src[i];
    out.push(s && typeof s === 'object' ? { ...s, seat: Number.isInteger(s.seat) ? s.seat : i } : null);
  }
  return out;
}

/**
 * 房间人数 (room.state.maxSeats, room.setSeats; the owner's decision 2026-10-31): the room's seat capacity.
 * `4` unless the server says 8 or 12 — an absent key, a stale value or anything outside `ROOM_SEAT_CAPS` reads as
 * `MAX_SEATS`, so every room that never raised its capacity renders exactly the four-seat screen it always had.
 * @param {any} room room.state payload
 * @returns {4|8|12}
 */
export function seatCapacity(room) {
  const n = room?.maxSeats;
  return Number.isInteger(n) && n > MAX_SEATS && n <= MAX_SEATS_CAP && ROOM_SEAT_CAPS.includes(n)
    ? /** @type {4|8|12} */ (n) : /** @type {4} */ (MAX_SEATS);
}

/** How many 4-doctor teams the room holds (1, 2 or 3) — the wide room draws one column/chip per team. */
export function teamCountOf(room) {
  const cap = seatCapacity(room);
  return cap === 12 ? 3 : cap === 8 ? 2 : 1;
}

/**
 * Every team's four seat slots, in seat order: `[[null|seat] × 4, …]`, team 0 = 我方 (seats 0–3), team 1 = the
 * second alliance (4–7), team 2 = the third (8–11).
 * @param {any} room room.state payload
 * @returns {(null | any)[][]}
 */
export function seatTeams(room) {
  const seats = normalizeSeats(room);
  return Array.from({ length: teamCountOf(room) }, (_, t) => seats.slice(t * 4, t * 4 + 4));
}

/** The 12-seat chip order: 我方 is the left column, the other two alliances are the chips. */
export const SEAT12_TEAM_TONES = Object.freeze(['mine', 'blue', 'red']);

/**
 * A wide room's team heading: 我方同盟 / 对方同盟 (8 seats) or 我方同盟 / 蓝方同盟 / 红方同盟 (12 seats).
 * Inline Chinese on purpose (the owner's 2026-10-31 wording; no i18n msgid is added for the wide room).
 * @param {number} team 0-based team index
 * @param {4|8|12} capacity `seatCapacity(room)`
 * @returns {string}
 */
export function teamNameOf(team, capacity = MAX_SEATS) {
  if (team === 0) return '我方同盟'; // i18n-ignore
  if (capacity === 8) return '对方同盟'; // i18n-ignore
  return team === 1 ? '蓝方同盟' : '红方同盟'; // i18n-ignore
}

/** 房间人数's own label (the owner's 2026-10-31 wording; inline, not an i18n msgid). */
export const SEATS_LABEL = '房间人数'; // i18n-ignore
/** What each raised capacity will look like (3 teams / 2 teams of four); inline, not an i18n msgid. */
const SEAT_TEAM_NOTES = Object.freeze({ 8: '将变成 2 队 × 4 人', 12: '将变成 3 队 × 4 人' }); // i18n-ignore

/**
 * The hint under 房间人数's segmented control. Three states (the owner's 2026-10-31 wording):
 * - a started room: 模拟已开始 · 不可更改 (two existing msgids joined);
 * - a host before the match, 8 / 12 seats: what the room will look like (将变成 2/3 队 × 4 人);
 * - a host before the match, 4 seats (and the read-only view of the others): the rule (可随时提高人数；降低人数需先让
 *   其他博士离开) / 由创建者设置.
 * @param {any} room room.state payload
 * @param {boolean} editable the host's live view (false for everybody else)
 * @returns {string}
 */
export function seatsNote(room, editable) {
  if (room?.inMatch) return `${t('模拟已开始')} · ${t('不可更改')}`;
  if (!editable) return t('由创建者设置');
  const cap = seatCapacity(room);
  return SEAT_TEAM_NOTES[cap] || '可随时提高人数；降低人数需先让其他博士离开'; // i18n-ignore
}

/**
 * 房间人数 as a ⚙ 同盟设置 row: the current capacity and whether this player may change it (the host, before the match,
 * in a co-op room). `null` in a solo room (its single seat is not a capacity) and while a match runs.
 * @param {any} room room.state payload
 * @param {any} myId
 * @returns {{ value: 4|8|12, editable: boolean } | null}
 */
export function seatsOption(room, myId) {
  if (!room || isSoloRoomMode(room.mode)) return null;
  return {
    value: seatCapacity(room),
    editable: room.hostId != null && room.hostId === myId && !room.inMatch,
  };
}

/**
 * 这个房间是不是玩法包房（炸惊 / 湮灭），是哪一档。版本、难度、插件都由玩法包锁死（服务端
 * `room.proposeVersion` → VERSION_UNSUPPORTED、`room.setDifficulty` / `room.setPlugins` → BAD_TARGET），
 * 于是房里既不该有版本切换 UI，也不该跑版本检测链（业主 2026-10-28 P0-4 / P0-5）。
 * @param {any} room `room.state`
 * @returns {'zhajing'|'annihilation'|null}
 */
export function playSetOf(room) {
  if (!room) return null;
  const byDifficulty = extensionRoomOf(room.difficulty);
  if (byDifficulty !== 'official') return byDifficulty;
  const byMode = extensionRoomOf(room.modeId);
  return byMode === 'official' ? null : byMode;
}

/**
 * Derived room facts for the local player.
 * @param {any} room
 * @param {any} myId
 */
export function roomFacts(room, myId) {
  const seats = normalizeSeats(room);
  const occupied = seats.filter(Boolean);
  const humans = occupied.filter((s) => !s.isBot);
  const mine = occupied.find((s) => s.playerId === myId) || null;
  const isHost = room?.hostId != null && room.hostId === myId;
  const others = humans.filter((s) => s.playerId !== myId);
  // The host never readies: starting the match is the host's ready (server rule), so the count
  // treats the host as ready — "已就绪 0/1" next to "准许进入模拟" would contradict itself.
  const isReady = (s) => !!s.ready || s.playerId === room?.hostId;
  const readyHumans = humans.filter(isReady).length;
  const othersReady = others.every((s) => s.ready && s.connected !== false);
  // a room with gameplay plugins (DESIGN §32.6) or another official version (§35.23): every player's page has loaded and
  // checked its content (the host's too); `modded` (非官方) is the plugins' alone
  const modded = isModdedRoom(room);
  // 玩法包房间（炸惊 / 湮灭）不跑版本检测：版本被玩法包锁死，服务端 proposeVersion 回 VERSION_UNSUPPORTED（P0-5）
  const loadsContent = !playSetOf(room) && needsContent(room);
  const contentReady = !loadsContent || humans.every((s) => s.content === 'ready');
  return {
    seats, occupied, humans, mine, isHost, readyHumans, isReady,
    emptySeats: seats.filter((s) => !s).length,
    // 开始模拟 (room.start): a room of any capacity starts — the match layer fields one team per 4 seats, so the
    // first-layer gate is gone and this is exactly the condition the 4-seat screen always used
    canStart: isHost && othersReady && !!mine && contentReady && (!room?.content?.trusted || humans.every(s => room.content.trusted.consent[s.seat])),
    othersReady,
    modded,
    needsContent: loadsContent,
    // another official version (its seat tags and texts; a gameplay plugin room keeps the plugins' words)
    versionRoom: loadsContent && !modded,
    contentReady,
    myContent: loadsContent ? (mine?.content || 'loading') : 'ready',
    // spectator seats (never players: not in `humans`, never counted for ready / start)
    spectators: Array.isArray(room?.spectators) ? room.spectators.filter((s) => s && typeof s === 'object') : [],
    spectating: isSpectating(room, myId),
  };
}

/**
 * The co-op room option 「AI 队友最后选择」 (GitHub #338; room.setAiPicksLast, room.state.aiPicksLast): in the strategy and
 * 机变 drafts every human picks before the AI teammates. null in a solo room (no AI teammates); otherwise its state (off
 * when the server sends none) and whether this player may switch it — the host only, the others see it read-only.
 * @param {any} room room.state payload
 * @param {any} myId
 * @returns {{ on: boolean, editable: boolean } | null}
 */
export function aiLastOption(room, myId) {
  if (!room || room.mode === 'solo') return null;
  return { on: room.aiPicksLast === true, editable: room.hostId != null && room.hostId === myId };
}

/** Spectator handover is available only in original default-version co-op rooms, with a host opt-in. */
export function aiTakeoverOption(room, myId) {
  if (!room || room.mode === 'solo' || roomVersion(room) !== DEFAULT_VERSION || room.content?.vanilla === false) return null;
  return { on: room.aiTakeoverEnabled === true, editable: room.hostId != null && room.hostId === myId && !room.inMatch };
}

/**
 * The solo room option 「不限时」 (DESIGN §35.23.10; room.setSoloUnlimited). null unless the room is solo AND `timed`
 * is exactly true (a version whose solo is timed, and whose data is on screen). Off when room.state omits the key.
 * The host switches it; everybody else sees it read-only.
 * @param {any} room room.state payload
 * @param {any} myId
 * @param {boolean | null} timed soloTimedOf(config, room version)
 * @returns {{ on: boolean, editable: boolean } | null}
 */
export function soloUnlimitedOption(room, myId, timed) {
  if (!room || room.mode !== 'solo' || timed !== true) return null;
  return { on: room.soloUnlimited === true, editable: room.hostId != null && room.hostId === myId };
}

/**
 * An AI teammate's name split into its 「AI·」 prefix and the rest, for the plate (room.css hides the prefix on a phone:
 * the avatar's badge and the card's AI 队友 tag say it, and at 特大 the prefix left one character of the name,
 * 「AI·华…」). Null for a human seat and for a name that is only a number after the prefix (`AI·2`).
 * @param {{ isBot?: boolean, name?: string } | null | undefined} seat
 * @returns {[string, string] | null}
 */
export function botNameParts(seat) {
  const m = seat?.isBot ? /^(AI\s*·\s*)(\D.*)$/su.exec(seat.name || '') : null;
  return m ? [m[1], m[2]] : null;
}

/** Invite link for a room code (current page URL with ?room=CODE). */
export function inviteLink(code) {
  const loc = globalThis.location;
  const base = loc ? `${loc.origin}${loc.pathname}` : '';
  return `${base}?room=${encodeURIComponent(code)}`;
}

/**
 * The text the room's 复制 / 复制链接 buttons put on the clipboard (the owner's wording, 2026-10-31). Two lines:
 *
 *   {host} 邀请你参加 {room}【{n}/{total}】
 *   <inviteLink(code)>
 *
 * `room` is one label, composed by the caller: an official co-op room passes 「同盟模拟」 plus the difficulty
 * (「同盟模拟 · 终极模拟」), while a room that carries its own mode (炸惊模拟 / 湮灭模拟 / 超限模拟) passes
 * `isPlaySet` and its mode alone, never a difficulty. A difficulty this build cannot name (`''`) leaves the mode
 * alone. A solo room has no invitation at all (its link button is not rendered): null.
 * @param {{ host: string, modeLabel: string, difficultyLabel?: string, isPlaySet?: boolean, solo?: boolean, n: number, total: number, code: string }} p
 * @returns {string | null}
 */
export function inviteText({ host, modeLabel, difficultyLabel, isPlaySet, solo, n, total, code }) {
  if (solo) return null;
  const room = isPlaySet || !difficultyLabel ? modeLabel : `${modeLabel} · ${difficultyLabel}`;
  return `${t('{host} 邀请你参加 {room}【{n}/{total}】', { host, room, n, total })}\n${inviteLink(code)}`;
}

/**
 * Copy text to the clipboard (async API with a textarea fallback for insecure contexts). Moved to ui/clipboard.js so
 * 干员调配 can use it without importing this screen (which imports loadout.js): re-exported here for existing callers.
 * @param {string} text
 * @returns {Promise<boolean>}
 */
export { copyText };

/** A picker tile's avatar; the name's first character when the art pack has none or it fails to load. */
function CardThumb({ src, name }) {
  const [bad, setBad] = useState(false);
  return html`<span class="cardpick__img">${src && !bad
    ? html`<img src=${src} alt="" loading="lazy" draggable=${false} onError=${() => setBad(true)} />`
    : html`<span class="cardpick__glyph">${[...(name || '?')][0]}</span>`}</span>`;
}

/**
 * 名片干员 picker (更换立绘 on one's own seat card): the operators a seat card can show (ui/seatArt.js cardOperators —
 * search by name, rarity tabs) and 默认, no pick: the card shows the operator chosen by the player id. Picking closes it;
 * the current choice takes the focus (no on-screen keyboard on a phone). A local picker: each tile wears this browser's
 * outfit for that operator (`localSkins`, docs/SKINS.md), as the card will.
 */
function CardPicker({ current, list, m, localSkins = {}, onPick, onClose }) {
  const [q, setQ] = useState('');
  const [star, setStar] = useState(0);
  const stars = useMemo(() => [...new Set(list.map((c) => c.rarity).filter((r) => r > 0))].sort((a, b) => b - a), [list]);
  const known = !!current && list.some((c) => c.charId === current);
  const needle = q.trim().toLowerCase();
  const shown = list.filter((c) => (!star || c.rarity === star)
    && (!needle || [c.name, c.appellation].some((v) => String(v || '').toLowerCase().includes(needle))));
  return html`<${Modal} open=${true} class="cardpick" micro="SEAT CARD OPERATOR" title=${t('名片干员')} width="min(10.4rem, 96vw)"
      onClose=${onClose} actions=${html`<${Button} variant="ghost" onClick=${onClose}>${t('关闭')}<//>`}>
    <div class="cardpick__bar">
      <${TextField} class="cardpick__search" size="sm" icon="search" value=${q} onInput=${setQ} placeholder=${t('搜索干员')} />
      <div class="cardpick__stars" role="radiogroup" aria-label=${t('稀有度')}>
        ${[0, ...stars].map((v) => html`<button key=${v} type="button" role="radio" aria-checked=${star === v ? 'true' : 'false'}
          class=${star === v ? 'is-on' : ''} onClick=${() => setStar(v)}>${v ? html`<span class="num">${v}★</span>` : t('全部')}</button>`)}
      </div>
    </div>
    <div class="cardpick__grid" data-testid="card-picker">
      <button type="button" class=${`cardpick__op cardpick__op--auto${known ? '' : ' is-on'}`} aria-pressed=${known ? 'false' : 'true'}
          data-char="" data-autofocus=${known ? undefined : ''} title=${t('按博士编号自动分配')} onClick=${() => onPick('')}>
        <span class="cardpick__img"><${Icon} name="refresh" /></span><span class="cardpick__name">${t('默认')}</span>
      </button>
      ${shown.map((c) => {
        const src = chessAvatarUrl(m, c, { skin: ownerSkin(c.charId, { localSkins }) });
        const on = known && c.charId === current;
        return html`<button key=${c.charId} type="button" class=${`cardpick__op r${c.rarity}${on ? ' is-on' : ''}`} aria-pressed=${on ? 'true' : 'false'}
            data-char=${c.charId} data-autofocus=${on ? '' : undefined} title=${c.name} onClick=${() => onPick(c.charId)}>
          <${CardThumb} src=${src} name=${c.name} />
          <span class="cardpick__name">${c.name}</span>${c.rarity ? html`<span class="cardpick__star num">${c.rarity}★</span>` : null}
        </button>`;
      })}
    </div>
    ${shown.length ? null : html`<p class="cardpick__empty">${t('没有符合条件的干员')}</p>`}
    <p class="cardpick__note"><${Icon} name="info" />${t('选择后，同盟里的博士都会看到这张立绘')}</p>
  <//>`;
}

/**
 * One seat: a tall card — the top strip (P#), the 名片干员 portrait (or the avatar frame: a bot, no art pack), 创建者, the
 * state at the bottom (准备中 / 待命中 / 已就绪 with its box) — and the name plate under it. The art's text sits in two
 * groups in flow, `.rseat__top` (the badge, 更换立绘, the tags) and `.rseat__low` (the operator's name, the state), so a
 * larger 文字大小 wraps and pushes them apart rather than drawing one over another (§35.18 review). One's own card offers 更换立绘
 * (`onPickCard`); the host gets 移出 / 移除 AI 队友 at the top right. An empty seat: 邀请 (copies the key) and, for the
 * host of a co-op room, 添加 AI 队友. `portrait` is the worn appearance's picture (the outfit's, else the operator's),
 * `portraitDefault` the operator's own default one (given when an outfit is worn), `illust` its 立绘 (the outfit's own,
 * else the operator's): a picture that fails to load gives way to the next, the last to the avatar frame. `illustFirst`
 * says which one the card opens with (room.js decides): an outfit that ships only a 180×360 portrait puts that picture
 * first (docs/SKINS.md's decision 4), while no outfit at all — or one with a 立绘 of its own — opens with the 立绘.
 */
function SeatCard({ seat, index, room, facts, myId, busy, onAddBot, onRemoveBot, onKick, onInvite, portrait = null, portraitDefault = null, illust = null, illustFirst = false, charId = null, nameCard = null, operator = null, onPickCard = null, onTuneCard = null, fresh = false }) {
  const [badArt, setBadArt] = useState([]);
  const coop = !isSoloRoomMode(room.mode);
  // the 转场 flash: a seat that turns ready (or becomes the host's), and an AI teammate added while the room is open
  // (`fresh`: this card mounted after the room was already on screen)
  const flash = useRise(!!seat && (seat.ready || seat.isBot || seat.playerId === room.hostId), 700, fresh);
  if (!seat) {
    const canAdd = coop && facts.isHost;
    const invitable = coop && !facts.spectating;
    return html`<article class="seat seat--empty rseat rseat--empty" style=${`--i:${index}`}>
      <span class="rseat__clip" aria-hidden="true"></span>
      <header class="rseat__strip"><i></i><span class="num">P${index + 1}</span></header>
      <div class="rseat__art">
        ${invitable
          ? html`<button type="button" class="rseat__invite" onClick=${onInvite} title=${t('复制同盟密钥以邀请队友')}>
              <span class="rseat__plus" aria-hidden="true"></span><b>${t('邀请')}</b><small>${t('复制同盟密钥以邀请队友')}</small></button>`
          : html`<span class="rseat__wait"><small>${t('等待博士加入')}</small></span>`}
        ${canAdd ? html`<${Button} variant="secondary" size="sm" icon="robot" class="rseat__add" loading=${busy === 'add'} onClick=${onAddBot}>${t('添加 AI 队友')}<//>` : null}
        <span class="rseat__noinfo" aria-hidden="true">NOINFO</span>
      </div>
      <div class="rseat__plate rseat__plate--empty"><span class="seat__state t-dim">${t('空位')}</span></div>
    </article>`;
  }
  const consent = room.content?.trusted?.consent?.[seat.seat];
  const isMe = seat.playerId === myId;
  const isHostSeat = seat.playerId === room.hostId;
  const offline = seat.connected === false && !seat.isBot;
  // The host never needs to toggle ready: starting the match readies them (server rule).
  const state = offline ? 'offline' : seat.ready || seat.isBot ? 'ready' : isHostSeat ? 'host' : 'waiting';
  const lit = state === 'ready' || state === 'host';
  const art = seat.isBot ? null : seatArtSrc([portrait, portraitDefault], badArt);
  // (the outfit's own picture alone: the operator's default portrait behind it waits until the 立绘 has had its try)
  const outfitArt = art === portrait ? art : null;
  const canPick = isMe && !seat.isBot && !!onPickCard;
  // 立绘（精二 `char/illust/<id>.png`）优先；打不开才退回既有 portrait 链（精一 `_1` 缺失由 CardArtImage 自己退精二）
  const illustOk = !!illust && !seat.isBot && !badArt.includes(illust);
  const canTune = isMe && illustOk && !!onTuneCard;
  // The two pictures of the card, each null once it has failed: `illust` (drawn by CardArtImage, 精一/精二 by the pref)
  // opens the card unless an outfit's own 180×360 picture goes first (`illustFirst`); `art` is the portrait chain —
  // the outfit's picture, then the operator's default one — and `outfitArt` is its first link only.
  const illustNode = illustOk
    ? html`<${CardArtImage} key=${`${illust}|${charId}`} charId=${charId} illust=${illust} class="seat__portrait"
        onError=${() => setBadArt((b) => (b.includes(illust) ? b : [...b, illust]))} />`
    : null;
  const artNode = art
    ? html`<img key=${art} class="seat__portrait" src=${art} alt="" draggable=${false} onError=${() => setBadArt((b) => (b.includes(art) ? b : [...b, art]))} />`
    : null;
  const shown = !!illustNode || !!artNode; // a picture instead of the avatar frame
  // an AI teammate's name without its 「AI·」 prefix on a phone (room.css; botNameParts)
  const botPrefix = botNameParts(seat);
  return html`<article class=${`seat rseat${isMe ? ' is-me' : ''}${isHostSeat ? ' is-host' : ''}${seat.isBot ? ' is-bot' : ''}${shown ? ' has-art' : ''}${lit ? ' is-lit' : ''}${flash ? ' is-flash' : ''} is-${state}`}
      style=${`--i:${index}`}>
    <span class="rseat__clip" aria-hidden="true"></span>
    <header class="rseat__strip"><i></i><span class="num">P${index + 1}</span></header>
    <div class="seat__art rseat__art">
      ${illustFirst && illustNode
        ? illustNode
        : outfitArt && artNode
          ? artNode
          : illustNode || artNode
            || html`<${AvatarFrame} size="xl" name=${seat.name} seat=${index} bot=${seat.isBot} self=${isMe} ready=${state === 'ready'} offline=${offline} />`}
      <div class="rseat__top">
        ${isHostSeat ? html`<span class="rseat__host"><${Icon} name="crown" />${t('创建者')}</span>` : null}
        ${seat.isBot ? html`<span class="rseat__bot"><${Icon} name="robot" />${t('AI 队友')}</span>` : null}
        ${canPick ? html`<button type="button" class="rseat__pick" data-testid="seat-card-pick" onClick=${onPickCard}
          title=${t('更换名片干员')} aria-label=${t('更换名片干员')}><${Icon} name="edit" /><span>${t('更换立绘')}</span></button>` : null}
        ${canTune ? html`<button type="button" class="rseat__pick rseat__pick--art" data-testid="seat-card-art" onClick=${onTuneCard}
          title=${t('立绘调整')} aria-label=${t('立绘调整')}><${Icon} name="image" /><span>${t('立绘调整')}</span></button>` : null}
        ${consent ? html`<span class="rseat__tag" data-testid="script-consented">${t('已同意')}</span>` : null}
        ${facts.needsContent && !seat.isBot ? html`<span class=${`rseat__tag seat__content is-${seat.content || 'loading'}`} data-testid="seat-content">
          ${facts.versionRoom
            ? seat.content === 'ready' ? t('版本数据就绪') : seat.content === 'failed' ? t('版本数据校验失败') : t('版本数据载入中')
            : seat.content === 'ready' ? t('插件内容就绪') : seat.content === 'failed' ? t('插件内容校验失败') : t('插件内容载入中')}
        </span>` : null}
      </div>
      ${offline ? html`<span class="rseat__lost"><${Icon} name="wifiOff" />${t('连接中断')}</span>` : null}
      <div class="rseat__low">
        ${shown ? html`<span class="seat__op">${operator?.name || ''}</span>` : null}
        <span class=${`rseat__state seat__state--${state}`}>
          <span class="rseat__box">${lit ? html`<${Icon} name="check" />` : null}</span>
          <span class="rseat__said">${state === 'ready' ? t('已就绪') : state === 'host' ? t('待命中') : state === 'offline' ? t('连接中断') : t('准备中')}</span>
        </span>
      </div>
    </div>
    ${seat.isBot && facts.isHost ? html`<button type="button" class="rseat__kick" disabled=${busy === `rm${index}`} onClick=${() => onRemoveBot(index)}
      title=${t('移除该 AI 队友')} aria-label=${t('移除 AI 队友')}><${Icon} name="robot" /><${Icon} name="close" /></button>` : null}
    ${!seat.isBot && !isMe && facts.isHost ? html`<button type="button" class="rseat__kick" disabled=${busy === `kick${index}`}
      onClick=${() => onKick(index, seat.name, seat.playerId)} title=${t('将该博士移出同盟')} aria-label=${t('移出该博士')}><${Icon} name="user" /><${Icon} name="close" /></button>` : null}
    <div class="rseat__plate">
      ${isMe && nameCard ? html`<${NameCardLayer} card=${nameCard} />` : null}
      ${isMe ? html`<span class="rseat__me" role="img" aria-label=${t('你')} title=${t('你')}><${Icon} name="info" /></span>` : null}
      <${AvatarFrame} size="sm" name=${seat.name} seat=${index} bot=${seat.isBot} self=${isMe} />
      <span class="rseat__who"><b class="seat__name">${botPrefix ? html`<span class="seat__name-pre">${botPrefix[0]}</span>${botPrefix[1]}` : seat.name || t('博士')}</b>${isMe ? html`<span class="seat__you" aria-hidden="true">${t('你')}</span>` : null}</span>
      <small class="rseat__doc">${seat.isBot ? 'AUTONOMOUS UNIT' : `DOCTOR #${doctorNo(seat.playerId)}`}</small>
    </div>
  </article>`;
}

/** The state word of a wide room's 名片卡 row (the tall cards' words, same states). */
function wideStateText(state) {
  return state === 'ready' ? t('已就绪') : state === 'host' ? t('待命中') : state === 'offline' ? t('连接中断') : t('准备中');
}

/**
 * One 44 px 名片卡 row of a room with more than four seats (handoff/room12/mock-room.html, the 8- and 12-seat
 * layouts): the name card art (own card, else the CSS fallback), a 65%→35% dark veil, the 32 px avatar, the name and the
 * state. An empty slot is a dashed row with 邀请 (it copies the room key, like the empty tall card).
 * @param {{ info: any, index: number, canInvite: boolean, onInvite: () => void, nameCard: string | null }} props
 */
function WideSeatRow({ info, index, canInvite, onInvite, nameCard }) {
  if (!info) {
    return html`<li class="rs-namecard rs-namecard--empty" data-seat=${index}>
      ${canInvite
        ? html`<button type="button" class="rs-namecard__invite" onClick=${onInvite} title=${t('复制同盟密钥以邀请队友')}>
            <span class="rs-plus" aria-hidden="true"></span>${t('邀请')}</button>`
        : html`<span class="t-dim">${t('等待博士加入')}</span>`}
    </li>`;
  }
  const tone = info.state === 'ready' ? ' is-ready' : info.state === 'offline' ? ' is-off' : '';
  return html`<li class=${`rs-namecard${info.offline ? ' is-off' : ''}`} data-seat=${index}>
    <span class="rs-namecard__art" aria-hidden="true"></span>
    ${info.isMe && nameCard ? html`<${NameCardLayer} card=${nameCard} />` : null}
    <span class="rs-namecard__veil" aria-hidden="true"></span>
    <span class="rs-avatar" aria-hidden="true">
      ${info.avatar
        ? html`<img src=${info.avatar} alt="" draggable=${false} onError=${(e) => e.currentTarget.remove()} />`
        : info.bot
          ? html`<${Icon} name="robot" class="rs-avatar__bot" />`
          : html`<span class="rs-avatar__glyph">${[...(info.name || '?')][0]}</span>`}
    </span>
    <span class="rs-namecard__who">${info.name}</span>
    <span class=${`rs-namecard__state${tone}`}>${wideStateText(info.state)}</span>
  </li>`;
}

/** The four-slot list of one team (shared by the 8-seat columns and the 12-seat team panel). */
function WideTeamList({ rows, canInvite, onInvite, nameCard }) {
  return html`<ul class="rs-teamlist">
    ${rows.map((r) => html`<${WideSeatRow} key=${r.info ? `p${r.info.seat.playerId}` : `e${r.index}`}
      info=${r.info} index=${r.index} canInvite=${canInvite} onInvite=${onInvite} nameCard=${nameCard} />`)}
  </ul>`;
}

/** A team's heading: its name and taken seats `x/4`. */
function WideTeamHead({ name, rows, mine = false }) {
  const count = rows.filter((r) => r.info).length;
  return html`<header class=${`rs-teamhead${mine ? ' is-mine' : ''}`}>
    <span class="rs-teamhead__name">${name}</span>
    <span class="rs-teamhead__count num">${count}<i>/</i>4</span>
  </header>`;
}

/**
 * A room with more than four seats: the 8-seat two-column layout (left 54% 我方, right 46% 对方) and the 12-seat
 * collapsed layout (left 64% 我方 cards, right 36% two chips). `openTeam` is the chip a player opened (12 only), and
 * `bar` is its 40 px mine column.
 */
function WideRoom({ room, facts, cap, openTeam, cards, myCard, localSkins, otherSkins, acct, me, onInvite, onOpenTeam, onBack }) {
  const canInvite = !facts.spectating;
  const assets = data.get('assets');
  /** Resolve one seat to what a 44 px row draws (operator avatar, name, ready state). */
  const view = (s, index) => {
    if (!s) return null;
    const op = seatOperator(s, cards, { myId: me.playerId, myCard });
    const skin = op ? seatCardSkin(s, op.chess.charId, { myId: me.playerId, localSkins, players: facts.occupied, otherSkins }) : null;
    const avatar = op ? chessAvatarUrl(assets, op.chess, { skin }) : null;
    const isHostSeat = s.playerId === room.hostId;
    const offline = s.connected === false && !s.isBot;
    const state = offline ? 'offline' : s.ready || s.isBot ? 'ready' : isHostSeat ? 'host' : 'waiting';
    return { seat: s, index, avatar, name: s.name || t('博士'), state, offline, isMe: s.playerId === me.playerId, bot: !!s.isBot };
  };
  const rowsOf = (team) => facts.seats.slice(team * 4, team * 4 + 4).map((s, i) => ({ info: view(s, team * 4 + i), index: team * 4 + i }));
  const teams = teamCountOf(room);
  const nameCard = acct?.card || null;

  if (cap === 8) {
    return html`<div class="rs-seat8">
      <section class="rs-seat8__col rs-seat8__col--mine" aria-label=${teamNameOf(0, cap)}>
        <${WideTeamHead} name=${teamNameOf(0, cap)} rows=${rowsOf(0)} mine=${true} />
        <${WideTeamList} rows=${rowsOf(0)} canInvite=${canInvite} onInvite=${onInvite} nameCard=${nameCard} />
      </section>
      <section class="rs-seat8__col rs-seat8__col--foe" aria-label=${teamNameOf(1, cap)}>
        <${WideTeamHead} name=${teamNameOf(1, cap)} rows=${rowsOf(1)} />
        <${WideTeamList} rows=${rowsOf(1)} canInvite=${canInvite} onInvite=${onInvite} nameCard=${nameCard} />
      </section>
    </div>`;
  }

  const mineRows = rowsOf(0);
  if (openTeam == null) {
    return html`<div class="rs-seat12">
      <section class="rs-seat12__mine" aria-label=${teamNameOf(0, cap)}>
        <${WideTeamHead} name=${teamNameOf(0, cap)} rows=${mineRows} mine=${true} />
        <${WideTeamList} rows=${mineRows} canInvite=${canInvite} onInvite=${onInvite} nameCard=${nameCard} />
      </section>
      <aside class="rs-seat12__others">
        ${Array.from({ length: teams - 1 }, (_, k) => k + 1).map((team) => {
          const rows = rowsOf(team);
          const count = rows.filter((r) => r.info).length;
          return html`<button type="button" key=${team} class=${`rs-seat12__chip rs-seat12__chip--${SEAT12_TEAM_TONES[team]}`}
              onClick=${() => onOpenTeam(team)} aria-label=${`${teamNameOf(team, cap)} ${count}/4`}>
            <span class="rs-seat12__chip-top">
              <span class="rs-seat12__dot" aria-hidden="true"></span>
              <span class="rs-seat12__chip-name">${teamNameOf(team, cap)}</span>
              <span class="rs-seat12__chip-count num">${count}<i>/</i>4</span>
            </span>
          </button>`;
        })}
      </aside>
    </div>`;
  }

  // expanded (12): the left column becomes a 40 px strip of four 26 px avatars, the opened team takes the rest
  const rows = rowsOf(openTeam);
  return html`<div class="rs-seat12 is-expanded">
    <button type="button" class="rs-seat12__bar" onClick=${onBack} title=${t('返回')} aria-label=${`${teamNameOf(0, cap)} · ${t('返回')}`}>
      ${mineRows.map((r) => html`<span key=${r.index} class=${`rs-seat12__barav${r.info?.isMe ? ' is-self' : ''}${r.info?.offline ? ' is-off' : ''}`}>
        ${r.info?.avatar ? html`<img src=${r.info.avatar} alt="" draggable=${false} />` : null}
      </span>`)}
    </button>
    <section class=${`rs-seat12__team rs-seat12__team--${SEAT12_TEAM_TONES[openTeam]}`} aria-label=${teamNameOf(openTeam, cap)}>
      <${WideTeamHead} name=${teamNameOf(openTeam, cap)} rows=${rows} />
      <${WideTeamList} rows=${rows} canInvite=${canInvite} onInvite=${onInvite} nameCard=${nameCard} />
    </section>
  </div>`;
}

/** 观战席: the room's spectators (host: ✕ frees a seat), and 入座 for a spectator while a player seat is free. */
function SpectatorBar({ facts, myId, busy, onRemove, onSit }) {
  if (!facts.spectators.length) return null;
  return html`<section class="specbar" aria-label=${t('观战席')}>
    <span class="specbar__label"><${Icon} name="eye" />${t('观战席')}<b class="num">${facts.spectators.length}</b><span class="num t-dim">/${MAX_SPECTATORS}</span></span>
    ${facts.spectators.map((s) => html`<span key=${s.playerId} class=${`specbar__who${s.playerId === myId ? ' is-me' : ''}${s.connected === false ? ' is-offline' : ''}`}>
      ${s.connected === false ? html`<${Icon} name="wifiOff" />` : null}${s.name || t('博士')}${s.playerId === myId ? html`<span class="seat__you">${t('你')}</span>` : null}
      ${facts.isHost ? html`<${Button} variant="ghost" size="sm" square=${true} icon="close" loading=${busy === `rs${s.playerId}`}
        onClick=${() => onRemove(s.playerId)} aria-label=${t('移出观战者 {name}', { name: s.name || '' })} title=${t('移出该观战者')} />` : null}
    </span>`)}
    ${facts.spectating && facts.emptySeats > 0 ? html`<${Button} size="sm" icon="user" loading=${busy === 'sit'} onClick=${onSit}>${t('入座')}<//>` : null}
  </section>`;
}

/** The 「不限时」 switch (a timed solo): the host toggles it, everybody else sees its state. */
function SoloUnlimitedToggle({ option, busy, onToggle }) {
  if (!option) return null;
  return html`<div class="ailast">
    <${Tooltip} text=${t('关闭本局休整与机变的计时。官方为休整期每轮 300 秒、机变 150 秒。')}>
      <button type="button" role="switch" aria-checked=${option.on ? 'true' : 'false'} data-testid="room-solo-unlimited"
          class=${`dpick__opt ailast__opt${option.on ? ' is-active' : ''}`} disabled=${!option.editable || !!busy}
          onClick=${() => option.editable && onToggle(!option.on)}>
        <${Icon} name="check" class=${option.on ? 'is-on' : ''} />${t('不限时')}
      </button>
    <//>
    ${option.editable ? null : html`<span class="t-dim">${t('由创建者设置')}</span>`}
  </div>`;
}

/** The 「AI 队友最后选择」 switch (co-op): the host toggles it, everybody else sees its state. */
function AiLastToggle({ option, busy, onToggle }) {
  if (!option) return null;
  return html`<div class="ailast">
    <${Tooltip} text=${t('策略与机变轮选时，所有博士先于 AI 队友选择')}>
      <button type="button" role="switch" aria-checked=${option.on ? 'true' : 'false'}
          class=${`dpick__opt ailast__opt${option.on ? ' is-active' : ''}`} disabled=${!option.editable || !!busy}
          onClick=${() => option.editable && onToggle(!option.on)}>
        <${Icon} name="check" class=${option.on ? 'is-on' : ''} />${t('AI 队友最后选择')}
      </button>
    <//>
    ${option.editable ? null : html`<span class="t-dim">${t('由创建者设置')}</span>`}
  </div>`;
}

function AiTakeoverToggle({ option, busy, onToggle }) {
  if (!option) return null;
  return html`<div class="ailast">
    <${Tooltip} text=${t('默认关闭。开启后，观战者可在休整期经同房间真人投票接替 AI；继承记录不计个人统计或奖励。')}>
      <button type="button" role="switch" aria-checked=${option.on ? 'true' : 'false'} data-testid="room-ai-takeover"
          class=${`dpick__opt ailast__opt${option.on ? ' is-active' : ''}`} disabled=${!option.editable || !!busy}
          onClick=${() => option.editable && onToggle(!option.on)}>
        <${Icon} name="check" class=${option.on ? 'is-on' : ''} />${t('允许观战者接替 AI')}
      </button>
    <//>
    ${option.editable ? null : html`<span class="t-dim">${t('由创建者设置')}</span>`}
  </div>`;
}

/**
 * ⚙ of the bottom pill (co-op): 同盟设置 — the 模拟难度 (opens 选择模拟协议: the host's 确认, the others' read-only view)
 * and the 「AI 队友最后选择」 switch. Closes on a click outside it or Esc.
 * `locked` (炸惊房): the play set locks the difficulty — the row stays visible (it says what the room is) but is disabled.
 */
function RoomOptions({ option, takeoverOption, onAiTakeover, soloOption = null, seatsOption = null, onSeats = null, room, isHost, busy, onAiLast, onSoloUnlimited, onDifficulty, onClose, version = null, locked = null }) {
  const info = difficultyInfo(room.mode, room.difficulty);
  const title = soloOption ? t('模拟设置') : t('同盟设置');
  const panelRef = useRef(null);
  useEffect(() => {
    const away = (e) => { if (!e.target.closest?.('.rs-opts, .rs-pill__gear')) onClose(); };
    const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } };
    addEventListener('pointerdown', away);
    addEventListener('keydown', onKey);
    return () => { removeEventListener('pointerdown', away); removeEventListener('keydown', onKey); };
  }, []);
  // 面板是 `.rs-pill` 的绝对定位子元素（left:50% + translateX(-50%)，锚在底部那颗 ⚙ 上）。792×360 / 844×390 / 900×500
  // 这些窗口里 `.rs-foot` 的中间列被右侧的大按钮挤到左边（pill left 8.8/10.2），面板居中后就从左边越出视口
  // （实测 left −30.8，`版本` 整块在屏外，handoff/shots/MULTI-REAL-SHOTS.md §9.1）。这里只做水平夹取：量到视口
  // 外就把它推回「左右各留 8px」，放得下时一动不动（1920/1930 仍是原来的 772/777）；窗口改尺寸时重量一次。
  useLayoutEffect(() => {
    const el = panelRef.current;
    if (!el) return undefined;
    const clamp = () => {
      el.style.transform = '';
      const r = el.getBoundingClientRect();
      const vw = document.documentElement.clientWidth || innerWidth;
      if (!r.width) return; // 还没排版（测试环境）：下一次渲染再量
      let dx = 0;
      if (r.left < 8) dx = 8 - r.left;
      else if (r.right > vw - 8) dx = vw - 8 - r.right;
      if (dx) el.style.transform = `translateX(calc(-50% + ${dx}px))`;
    };
    clamp();
    addEventListener('resize', clamp);
    return () => removeEventListener('resize', clamp);
  }, []);
  return html`<div class="rs-opts" role="dialog" aria-label=${title} ref=${panelRef}>
    <h4>${title}</h4>
    ${soloOption ? null : html`<div class="rs-opts__row" data-testid="room-opt-difficulty">
      <span class="rs-opts__k">${t('模拟难度')}</span>
      <button type="button" class="rs-opts__diff" disabled=${locked ? true : (isHost && !!busy)} onClick=${onDifficulty}
          title=${locked || (isHost ? t('更改模拟难度') : t('由创建者选择'))}>
        <${DifficultyIcon} difficulty=${room.difficulty} />${DIFFICULTY_NAMES[room.difficulty] ? t(DIFFICULTY_NAMES[room.difficulty]) : ''}<span class="num rs-pill__code">${info.code}</span>
        ${isHost && !locked ? html`<em>${t('更改')}</em>` : null}
      </button>
      ${isHost ? null : html`<span class="t-dim">${locked || t('由创建者选择')}</span>`}
    </div>`}
    ${seatsOption ? html`<div class="rs-opts__seats" data-testid="room-opt-seats">
      <div class="rs-opts__row">
        <span class="rs-opts__k">${SEATS_LABEL}</span>
        <div class="rs-opts__seg" role="group" aria-label=${SEATS_LABEL}>
          ${ROOM_SEAT_CAPS.map((n) => html`<button type="button" key=${n}
            class=${`rs-opts__segbtn${n === seatsOption.value ? ' is-on' : ''}`}
            aria-pressed=${n === seatsOption.value ? 'true' : 'false'}
            disabled=${!seatsOption.editable || !!busy}
            onClick=${() => n !== seatsOption.value && onSeats?.(n)}>${n}</button>`)}
        </div>
      </div>
      <p class="rs-opts__note" data-testid="room-opt-seats-note">${seatsNote(room, seatsOption.editable)}</p>
    </div>` : null}
    ${!soloOption && version ? html`<div class="rs-opts__row" data-testid="room-opt-version">
      <span class="rs-opts__k">${t('版本')}</span>
      <${Tooltip} text=${version.why}>
        <button type="button" class="rs-opts__diff rs-opts__ver" disabled=${version.disabled} onClick=${version.onOpen}
            title=${version.editable ? t('发起切换版本') : t('由创建者发起')}>
          <${Icon} name="book" />${versionLabel(version.id)}${version.editable ? html`<em>${t('切换')}</em>` : null}
        </button>
      <//>
      ${version.editable ? null : html`<span class="t-dim">${t('由创建者发起')}</span>`}
    </div>` : null}
    <${AiTakeoverToggle} option=${takeoverOption} busy=${busy} onToggle=${onAiTakeover} />
    ${soloOption
      ? html`<${SoloUnlimitedToggle} option=${soloOption} busy=${busy} onToggle=${onSoloUnlimited} />`
      : html`<${AiLastToggle} option=${option} busy=${busy} onToggle=${onAiLast} />`}
  </div>`;
}

/** A gear (the pill's ⚙, in the place of the event's 快速搜寻: matchmaking is dropped — the maintainer's PR #643 keep / drop list, 2026-10-15). */
function GearGlyph() {
  return html`<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path fill-rule="evenodd" d="M10.3 2h3.4l.5 2.6 1.9.8 2.2-1.5 2.4 2.4-1.5 2.2.8 1.9 2.6.5v3.4l-2.6.5-.8 1.9 1.5 2.2-2.4 2.4-2.2-1.5-1.9.8-.5 2.6h-3.4l-.5-2.6-1.9-.8-2.2 1.5-2.4-2.4 1.5-2.2-.8-1.9L2 13.7v-3.4l2.6-.5.8-1.9-1.5-2.2 2.4-2.4 2.2 1.5 1.9-.8zM12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7z" /></svg>`;
}

/**
 * The big button of the bottom right (开始模拟 / 准备就绪 / 已就绪 / 观战中), styled like 选择模拟协议's. A disabled reason goes in
 * the project's Tooltip around it (review of PR #813: a native title never shows on touch).
 */
function GoButton({ label, onClick, disabled, loading = false, ready = null, icon = null }) {
  return html`<button type="button" class=${`proto-start rs-go${ready ? ' is-ready' : ''}`} disabled=${disabled} onClick=${onClick}
      aria-busy=${loading ? 'true' : 'false'}>
    ${ready != null
      ? html`<span class="rs-go__box" aria-hidden="true">${ready ? html`<${Icon} name="check" />` : null}</span>`
      : icon
        // (a spectator's 观战中: its eye in the mark's place, so the label keeps the width — §35.18 review)
        ? html`<span class="rs-go__icon" aria-hidden="true"><${Icon} name=${icon} /></span>`
        : html`<span class="proto-start__mark" aria-hidden="true"><span class="proto-start__rook"><i>[</i><${Icon} name="rook" /><i>]</i></span><small>STRONGHOLD<br />PROTOCOL</small></span>`}
    <span class="proto-start__label">${loading ? html`<${Spinner} size="sm" />` : null}${label}</span>
    <span class="proto-start__deco" aria-hidden="true"></span>
  </button>`;
}

/** How long a version proposal refused as too frequent (RATE) waits before it is sent once more [ASSUMED]. */
const PROPOSE_RETRY_MS = 1200;

// ---- 名片立绘：public/js/assets.js 按需加载 -------------------------------------------------------------------------
// illustUrl 只有两处用到（座位卡的立绘、立绘调整的预览），而 assets.js 是那份大 manifest 的模块（manifest / Spine 缓存）：
// 静态 import 会把它拖进 main.js 的静态图（test/ui/plugins-client.test.js 的「assets.js 只在需要时加载」），所以这里改成
// 按需 import，并把这个 Promise 缓存在模块级。拿到之前 illustUrl 返回 null —— 座位卡照旧走 portrait → 头像框，立绘调整
// 的入口也不出现；拿到之后重画一次，美术照常显示。import 失败就留着占位（刷新页面再试），不抛错。
let illustModule = null;
let illustLoading = null;

/** The one import of public/js/assets.js this page makes (a failure is kept; a reload asks again). */
function loadIllustModule() {
  if (!illustLoading) {
    illustLoading = import('../assets.js').then((m) => { illustModule = m; return m; }).catch(() => null);
  }
  return illustLoading;
}

/** What a caller gets until public/js/assets.js has loaded: no illustration, so the portrait chain stands in. */
const noIllustUrl = () => null;

/**
 * assets.js' illustUrl once it has arrived (a redraw follows), `noIllustUrl` before — the same signature either way, so
 * both call sites keep their expression.
 * @returns {(m: any, id: string, opts?: { skin?: string | null }) => string | null}
 */
function useIllustUrl() {
  const [mod, setMod] = useState(illustModule);
  useEffect(() => {
    if (mod) return undefined;
    let alive = true;
    loadIllustModule().then((m) => { if (alive && m) setMod(m); });
    return () => { alive = false; };
  }, [mod]);
  return mod ? mod.illustUrl : noIllustUrl;
}

/** Room screen component. */
export function RoomScreen() {
  const room = useStore((s) => s.room);
  const me = useStore((s) => s.me, shallowEqual);
  const conn = useStore((s) => s.connection, shallowEqual);
  const [busy, setBusy] = useState(null);
  const alive = useRef(true);
  const inFlight = useRef(false); // synchronous guard against double clicks (state updates are async)
  useEffect(() => () => { alive.current = false; }, []);
  // 房间聊天 (room.chat): the repository's own draggable panel + danmaku, mounted outside React (ui/roomChat.js owns its
  // DOM, drag position and teardown) — the test pins this exact call
  useEffect(() => mountRoomChat(), []);
  // 名片干员: the operators a seat card can show and the default pool (ui/seatArt.js), one's own pick (a pref the sync
  // engine sends: ui/loadoutSync.js installCardSync), and the outfits the cards wear — this browser's choices and the
  // 「显示其他玩家的皮肤」 switch (docs/SKINS.md)
  useData('chess', 'assets', 'config');
  const chess = data.get('chess');
  const cardList = useMemo(() => cardOperators(data.list('chess')), [chess]);
  const cards = useMemo(() => cardContext(cardList), [cardList]);
  const myCard = useStore((s) => s[CARD_KEY], Object.is, cardStore);
  const localSkins = useStore((s) => s[SKINS_KEY], Object.is, skinsStore);
  const otherSkins = useStore((s) => s.otherSkins !== false, Object.is, settingsStore);
  const [picking, setPicking] = useState(false);
  // 名片立绘微调（A 项）：座位卡上的「立绘调整」开一层只读预览 + 缩放/平移
  const [artOpen, setArtOpen] = useState(false);
  // 本机账号（名片底图）：只给自己那一张座位牌回显（名片是本地偏好，服务端没有这个字段）
  const { me: acct } = useCurrentAccount();
  // the room whose seats are on screen: a seat card that mounts after its first render is new (an AI teammate added)
  const shownRoom = useRef('');
  useEffect(() => { shownRoom.current = room?.code || ''; });
  // 选择模拟协议 over the room — open, and the host's pick before 确认 (the others read it: the room's difficulty) — and
  // the ⚙ menu
  const [protoOpen, setProtoOpen] = useState(false);
  const [protoPick, setProtoPick] = useState(null);
  // the 超限 pick of the open 选择模拟协议 dialog (null until it opens: the room's own state is the starting point)
  const [protoInf, setProtoInf] = useState(null);
  const [opts, setOpts] = useState(false);
  // 12 人房（maxSeats > 4）: which team chip is open (1 / 2), or null for the two-column view. Reset when the room or
  // its capacity changes, so a shrink to 8 never leaves a 12-seat team panel on screen.
  const [openTeam, setOpenTeam] = useState(null);
  useEffect(() => { setOpenTeam(null); }, [room?.code, room?.maxSeats]);
  // the host's change of difficulty, told to the others (see the header); never on entering a room or switching rooms
  const seenDiff = useRef(room ? `${room.code}|${room.difficulty}` : '');
  useEffect(() => {
    if (!room) return;
    const key = `${room.code}|${room.difficulty}`;
    const before = seenDiff.current;
    seenDiff.current = key;
    if (!before || before === key || !before.startsWith(`${room.code}|`) || room.hostId === me.playerId) return;
    const name = DIFFICULTY_NAMES[room.difficulty] ? t(DIFFICULTY_NAMES[room.difficulty]) : room.difficulty;
    toast(t('创建者已将模拟难度改为「{name}」', { name }), 'info');
  }, [room?.code, room?.difficulty]);
  // official versions (DESIGN §35.23): the room's switch is told to everybody (the host's own page included — a vote's
  // result arrives later than the pick); never on entering a room or switching rooms
  const versions = useStore((s) => s.versions);
  const myLobby = useStore(lobbyVersion);
  const serverDefault = useStore(serverDefaultVersion);
  const [versionOpen, setVersionOpen] = useState(false);
  // 炸惊模拟的规则速览（房内「规则」按钮 → 一张只读的表；数字由 ui/zhajingRules.js 从 config.json 现算）
  const [rulesOpen, setRulesOpen] = useState(false);
  // 炸惊模拟的卡池预选（C 项）：自己的 ban 名单，房内可改、下一局生效
  const [bansOpen, setBansOpen] = useState(false);
  const seenVersion = useRef(room ? `${room.code}|${roomVersion(room)}` : '');
  useEffect(() => {
    if (!room) return;
    // 玩法包房：版本被锁死，没有「同盟已切换」这回事，也绝不进版本检测链（P0-5）
    if (playSetOf(room)) { seenVersion.current = `${room.code}|${roomVersion(room)}`; return; }
    const key = `${room.code}|${roomVersion(room)}`;
    const before = seenVersion.current;
    seenVersion.current = key;
    if (!before || before === key || !before.startsWith(`${room.code}|`)) return;
    setVersionOpen(false);
    toast(t('同盟已切换到「{version}」', { version: versionLabel(roomVersion(room)) }), 'success');
  }, [room?.code, room?.version]);
  // the room sees one's pick once the server has it (seats[].card): ui/loadoutSync.js installCardSync sends it after
  // every pick, welcome and content change and retries a RATE / TIMEOUT / OFFLINE refusal (review of PR #813)
  const pickCard = (charId) => { setCard(charId); setPicking(false); };
  // 立绘的 URL 解析器（public/js/assets.js 按需加载：先占位，到了重画一次 — 见 useIllustUrl）
  const illustUrl = useIllustUrl();

  if (!room) return null;
  const online = conn.status === 'online';
  const coop = !isSoloRoomMode(room.mode);
  const facts = roomFacts(room, me.playerId);
  // 房间人数 (room.state.maxSeats): 4 keeps the original tall-card screen; 8 / 12 take the wide layouts below
  const cap = seatCapacity(room);
  const wide = coop && cap > MAX_SEATS;
  // a 12-seat room's opened chip; anything else (8 seats, a stale index) renders the collapsed two-column view
  const shownTeam = cap === 12 && (openTeam === 1 || openTeam === 2) ? openTeam : null;
  const seatsOpt = seatsOption(room, me.playerId);
  const myReady = !!facts.mine?.ready;
  // 蚀流档位（只有湮灭房有 room.erosion 这个键；普通房的 room.state 逐字节不变）—— 先算它，简报要用
  const erosionLv = Number.isInteger(room.erosion) ? room.erosion : 1;
  const info = difficultyInfo(room.mode, room.difficulty, erosionLv);
  // 自己座位上的名片干员 = 立绘调整的对象（与座位卡同一套解析：ui/seatArt.js，picks 优先于服务端回显）
  const mySeatRec = facts.seats.find((s) => s && s.playerId === me.playerId) || null;
  const myOp = mySeatRec ? seatOperator(mySeatRec, cards, { myId: me.playerId, myCard }) : null;
  const myIllust = myOp
    ? illustUrl(data.get('assets'), myOp.chess.charId, {
      skin: seatCardSkin(mySeatRec, myOp.chess.charId, { myId: me.playerId, localSkins, players: facts.occupied, otherSkins }),
    })
    : null;

  /** Runs one request at a time; resolves true once the server took it (false: not sent, or refused — toasted). */
  const run = async (kind, fn) => {
    if (inFlight.current) return false;
    if (!online) { toast(t('连接中断，请稍候重试'), 'warn'); return false; }
    inFlight.current = true;
    setBusy(kind);
    try { await fn(); return true; } catch (err) { toastError(err); return false; } finally {
      inFlight.current = false;
      if (alive.current) setBusy(null);
    }
  };

  const toggleReady = () => run('ready', () => net.request('room.ready', { ready: !myReady }));
  const start = () => run('start', () => net.request('room.start', {}));
  const addBot = () => run('add', () => net.request('room.addBot', {}));
  const removeBot = (seat) => run(`rm${seat}`, () => net.request('room.removeBot', { seat }));
  // the host removes a human before the match (community report #17): asked first; the player may join again. The
  // confirmed player's id goes along: if they left and someone else took the seat meanwhile, the server refuses it.
  const kick = async (seat, name, playerId) => {
    if (inFlight.current) return;
    const ok = await confirmDialog({ title: t('移出同盟'), text: t('确定将「{name}」移出同盟吗？对方可以凭同盟密钥重新加入。', { name: name || t('博士') }), okText: t('移出'), danger: true });
    if (ok) run(`kick${seat}`, () => net.request('room.kick', { seat, playerId }));
  };
  const setDifficulty = (difficulty) => run('diff', () => net.request('room.setDifficulty', { difficulty }));
  // 房间人数 (room.setSeats): host-only, before the match; the server owns the raise/lower rules
  const setSeats = (maxSeats) => run('seats', () => net.request('room.setSeats', { maxSeats }));
  // 超限模拟 as a room setting (room.setInfinite): host-only, before the match, the same gate as the difficulty above
  const setInfinite = (on) => run('infinite', () => net.request('room.setInfinite', { on }));
  // 蚀流 (erosion): host-only, before the match — this screen only exists before it starts, so no phase gate is needed;
  // the server refuses a non-host or a started room anyway (server/lobby.js setErosion → BAD_MSG).
  const setErosion = (level) => run('erosion', () => net.request('room.setErosion', { level }));
  const setAiTakeover = (on) => run('aihandover', () => net.request('room.setAiTakeover', { on }));
  const setAiLast = (on) => run('ailast', () => net.request('room.setAiPicksLast', { on }));
  // the room is the authority; the lobby card reads the same pref the next time this browser creates a solo room
  const setSoloUnlimited = async (on) => {
    const sent = await run('solofree', () => net.request('room.setSoloUnlimited', { on }));
    if (sent) savePref('lobby.soloUnlimited', on === true);
  };
  // spectator seats: the host frees one; a spectator takes a free player seat with room.join of this room
  const removeSpectator = (playerId) => run(`rs${playerId}`, () => net.request('room.removeSpectator', { playerId }));
  const sit = () => run('sit', () => net.request('room.join', { code: room.code, ...(room.test ? { testAck: true } : {}) }));
  const leave = async () => {
    if (inFlight.current) return;
    const othersHere = facts.humans.some((s) => s.playerId !== me.playerId);
    if (facts.isHost && othersHere) {
      const ok = await confirmDialog({ title: t('离开同盟'), text: t('你是同盟的创建者，离开后创建者身份将移交或同盟解散。确定离开吗？'), okText: t('离开'), danger: true });
      if (!ok) return;
    }
    inFlight.current = true;
    setBusy('leave');
    try {
      await net.request('room.leave', {});
    } catch (err) {
      if (err?.code !== 'NOT_IN_ROOM') toastError(err);
    } finally {
      // Leaving locally is always safe: the server either confirmed or no longer has us in the room.
      store.set({ room: null, match: emptyMatch() });
      inFlight.current = false;
      if (alive.current) setBusy(null);
    }
  };

  const statusLine = !online
    ? html`<span class="t-orange"><${Icon} name="wifiOff" />${t('连接中断，正在重连…')}</span>`
    : facts.spectating
      ? html`<span class="t-lo"><${Icon} name="eye" />${t('观战中 · 不占博士席位，模拟开始后可切换观看各位博士')}</span>`
    : !coop
      ? html`<span class="t-mint">${t('*模拟协议已就绪，准许进入模拟')}</span>`
    : facts.versionRoom && !facts.contentReady
      ? html`<span class="t-lo">${t('等待所有博士载入「{version}」的数据', { version: versionLabel(roomVersion(room)) })}</span>`
    : facts.needsContent && !facts.contentReady
      ? html`<span class="t-lo">${t('等待所有博士载入房间的插件内容')}</span>`
    : facts.isHost
      ? facts.canStart
        ? html`<span class="t-mint">${t('*同盟人数达标，准许进入模拟')}</span>`
        : html`<span class="t-lo">${t('等待所有博士准备就绪')}</span>`
      : myReady
        ? html`<span class="t-mint">${t('已就绪 · 等待创建者开始模拟')}</span>`
        : html`<span class="t-lo">${t('准备就绪后，创建者即可开始模拟')}</span>`;

  const copy = async (what) => {
    // 复制 / 复制链接 = the two-line invitation (the owner's wording, 2026-10-31): 「{host} 邀请你参加 {room}【{n}/{total}】」
    // then the link itself, unchanged. {room} is 「同盟模拟 · <难度>」 in an official co-op room and the mode alone in
    // a room that carries its own (炸惊模拟 / 湮灭模拟 / 超限模拟); a difficulty this build cannot name leaves the mode
    // alone. An empty seat's 邀请 still copies the bare key, and a solo room has no invitation at all.
    const playSetKind = playSetOf(room);
    const invite = what === 'link' && coop ? inviteText({
      host: facts.seats.find((s) => s && s.playerId === room.hostId)?.name || t('博士'),
      modeLabel: playSetKind === 'annihilation' ? t('湮灭模拟') : playSetKind === 'zhajing' ? t('炸惊模拟')
        : isInfiniteMode(room.mode) ? t('超限模拟') : t('同盟模拟'),
      difficultyLabel: DIFFICULTY_NAMES[room.difficulty] ? t(DIFFICULTY_NAMES[room.difficulty]) : '',
      isPlaySet: !!playSetKind || isInfiniteMode(room.mode),
      solo: !coop,
      n: facts.occupied.length,
      total: facts.seats.length,
      code: room.code,
    }) : null;
    const ok = await copyText(invite ?? room.code);
    if (ok) toast(invite ? t('已复制邀请链接') : t('已复制同盟密钥 {code}', { code: room.code }), 'success');
    else toast(t('复制失败，请手动复制'), 'warn');
  };
  // 选择模拟协议 over the room: the host picks and sends the difficulty on 确认 (nothing to send when it did not change —
  // unless a plugin mode is on, which picking a difficulty leaves: server/lobby.js setDifficulty); it closes only once the
  // server took it, and the accepted pick becomes the remembered difficulty (`lobby.difficulty`, the one 创建同盟 and
  // 独立模拟's 选择模拟协议 start from — README / PLAYING 难度沿用上次选的). Everybody else opens it read-only.
  //
  // 超限模拟 is a pick of this same dialog now (the owner's decision of 2026-10-28): the 特殊难度 card sets the room's mode
  // (room.setInfinite), and 确认 sends the difficulty and the mode together — a co-op room reaches 超限 exactly the way a
  // solo room does, instead of 选择同盟方式 carrying a second create entry for it. `protoInf` is the pick under the cursor
  // (the room's own state until the host touches the card), so the brief and the picture follow it before 确认.
  const openProto = () => { setOpts(false); setProtoPick(room.difficulty); setProtoInf(isInfiniteMode(room.mode)); setProtoOpen(true); };
  const closeProto = () => { setProtoOpen(false); setProtoPick(null); setProtoInf(null); };
  const pluginMode = room.content?.modeId ? (room.content.modes || []).find((m) => m.id === room.content.modeId)?.name || room.content.modeId : null;
  const confirmDifficulty = async () => {
    const wantInf = !!protoInf && !pluginMode;
    const wasInf = isInfiniteMode(room.mode);
    const d = protoPick || room.difficulty;
    // the mode first: turning 超限 off then picking a difficulty is two server calls, and neither may be skipped silently
    if (wantInf !== wasInf && !(await setInfinite(wantInf))) return;
    if (d !== room.difficulty || pluginMode) {
      if (!(await setDifficulty(d))) return;
      savePref('lobby.difficulty', d);
      // the plugin mode is gone: said, as a same-difficulty 确认 changes nothing else the host sees (§35.51; §35.18's nit)
      if (pluginMode) toast(t('已退出插件模式「{name}」', { name: pluginMode }), 'info');
    }
    if (alive.current) closeProto();
  };
  // the difficulties the room's version offers (its config's modes, versions.js) — the page shows that version's data
  // once it is loaded; until then (or for a gameplay plugin room's own modes) all four
  const protoDifficulties = offeredDifficulties(pageVersion() === roomVersion(room) ? getConfig() : null, room.mode);
  const protoHint = pluginMode
    ? t('确认后将退出插件模式「{name}」', { name: pluginMode })
    : facts.humans.length > 1 ? t('更改难度后，其他博士需要重新准备就绪') : '';  const aiLast = aiLastOption(room, me.playerId);
  const soloTimed = soloTimedOf(pageVersion() === roomVersion(room) ? getConfig() : null, roomVersion(room));
  const soloOpt = soloUnlimitedOption(room, me.playerId, soloTimed);
  const soloBrief = soloTimeMsgid('brief', { timed: soloTimed, unlimited: room.soloUnlimited === true });
  const modeName = isInfiniteMode(room.mode) ? t('超限模拟') : coop ? t('同盟模拟') : t('独立模拟');
  // 玩法包房锁定（业主 2026-10-28 晚 / P0-4）：「进入房间时左下的『第二期下半』改为『炸惊一期』且暂时不能调整，难度也锁定」；
  // 湮灭同样处理，版本胶囊写「湮灭一期」。玩法包自带卡池 → 版本对它没有意义（服务端 room.proposeVersion 回
  // VERSION_UNSUPPORTED），难度同理（room.setDifficulty → BAD_TARGET）。所以这一屏只**展示**，不提供入口：
  // 版本胶囊写玩法包名 + disabled，难度胶囊点击只弹一句提示。非玩法包房间逐字节不变。
  const playSet = playSetOf(room);
  const isPlaySetRoom = !!playSet;
  const playSetLock = isPlaySetRoom ? t('玩法包自带卡池，版本已锁定') : null;
  // 锁死的版本名：湮灭一期 / 炸惊一期（两条都已在四包里）
  const playSetVersionLabel = playSet === 'annihilation' ? t('湮灭一期') : t('炸惊一期');
  // the room's version (DESIGN §35.23): the pill and ⚙'s row on a server that enables versions (or in a version room)
  const vote = versionVoteOf(room);
  const curVersion = roomVersion(room);
  const showVersion = isPlaySetRoom || Array.isArray(versions) || curVersion !== DEFAULT_VERSION;
  const versionWhy = isPlaySetRoom ? playSetLock
    : !online ? t('连接中断，请稍候重试')
    : vote ? t('切换版本投票进行中，请等投票结束')
    : facts.modded ? t('请先关闭改变玩法的插件')
    : !Array.isArray(versions) || versions.length < 2 ? t('本服务器只启用了这一个版本') : null;
  const versionEditable = facts.isHost && !facts.spectating && !room.inMatch && !isPlaySetRoom;
  // the room's version is not this browser's lobby choice: the banner says leaving restores it (on a short screen, where
  // the banner gives its room to the seats, the pill's tooltip says it)
  const bannerText = curVersion !== myLobby && Array.isArray(versions) && !isPlaySetRoom ? t('本房间为「{room}」，离开后恢复你的大厅版本「{mine}」', { room: versionLabel(curVersion), mine: versionLabel(myLobby) }) : null;
  const versionCtl = showVersion ? {
    // 玩法包房：一颗只读的胶囊，文案是玩法包自己的名字（炸惊一期 / 湮灭一期），不是版本名
    id: curVersion, playSet: isPlaySetRoom, label: isPlaySetRoom ? playSetVersionLabel : null,
    editable: versionEditable, why: [versionEditable ? versionWhy : (playSetLock || t('由创建者发起')), bannerText].filter(Boolean).join(' · ') || null,
    disabled: isPlaySetRoom ? true : (versionEditable ? !!versionWhy || !!busy : !Array.isArray(versions)),
    onOpen: () => { if (isPlaySetRoom) { toast(playSetLock, 'info'); return; } setOpts(false); setVersionOpen(true); },
  } : null;
  // (a switch makes every page send its settings again, which share the server's budget of heavy messages with
  // room.proposeVersion: a RATE right after one is tried once more a moment later; the server's own 5 s pause after a
  // declined or expired vote answers RATE again and is told)
  const proposeVersion = async (version) => {
    const send = () => net.request('room.proposeVersion', { version });
    const sent = await run('version', async () => {
      try { await send(); } catch (err) {
        if (err?.code !== 'RATE') throw err;
        await new Promise((r) => setTimeout(r, PROPOSE_RETRY_MS));
        await send();
      }
    });
    if (sent && alive.current) setVersionOpen(false);
  };

  return html`<div class=${`screen room-screen rs${coop ? '' : ' rs--solo'}`} style=${`--d-color:${DIFFICULTY_COLORS[room.difficulty] || 'var(--amber)'}; --n:${facts.seats.length}`}>
    <div class="rs__bg" aria-hidden="true"></div>
    <header class="topbar rs-top">
      <div class="topbar__left rs-top__left">
        ${shownTeam != null ? html`<button type="button" class="rs-back" onClick=${() => setOpenTeam(null)}><span class="rs-back__chev" aria-hidden="true">‹</span>${t('返回')}</button>` : null}<${Tooltip} text=${t('离开同盟')} placement="bottom">
          <button type="button" class="rs-exit" disabled=${busy === 'leave'} onClick=${leave} aria-label=${t('离开同盟')}><${Icon} name="exit" /></button>
        <//>
        <div class="rs-clock">
          <b>${modeName}${room.test ? html` <${TestMark} />` : null}<${VersionTag} room=${room} class="rs-clock__ver" />${wide ? html`<span class="rs-count num" data-testid="room-count">${facts.occupied.length}<i>/</i>${cap}</span>` : null}
            ${pluginMode ? html`<span class="rs-clock__sep"></span><span class="room-mode" data-testid="room-mode">${pluginMode}</span>` : null}</b>
          <span class="rs-clock__ping">${t('当前延迟')}<${PingPill} ms=${conn.ping} online=${online} /></span>
        </div>
        <div class="rs-tools">
          ${room.difficulty === ZHAJING_DIFFICULTY ? html`<${ZhajingRulesButton} onClick=${() => setRulesOpen(true)} />
            <${ZhajingBansButton} onClick=${() => setBansOpen(true)} />` : null}
          <${Button} variant="secondary" size="sm" square=${true} icon="chart" class="stats-entry" onClick=${openStats} title=${t('统计数据')} aria-label=${t('统计数据')} />
          <${SettingsButton} class="room-settings" variant="secondary" square=${true} />
          <${GuideButton} class="room-guide" variant="secondary" square=${true} />
        </div>
        <${PluginTag} room=${room} myId=${me.playerId} />
      </div>
      <div class="rs-top__right">
        <${LoadoutButton} from="room" size="md" class="hub-plate hub-plate--loadout rs-loadout room-loadout" label=${t('干员调配')} />
        ${coop ? html`<div class="rs-key">
          <span class="rs-key__k">${t('同盟密钥')}</span>
          <b class="rs-key__code num selectable" aria-label=${t('同盟密钥 {code}', { code: room.code })}>${room.code}</b>
          <button type="button" class="rs-key__copy" onClick=${() => copy('link')} title=${t('复制链接')}>${t('复制')}</button>
          <button type="button" class="rs-key__link" onClick=${() => copy('link')} title=${t('复制链接')} aria-label=${t('复制链接')}><${Icon} name="link" /></button>
        </div>` : html`<div class="rs-key rs-key--solo"><${MicroLabel}>SINGLE OPERATOR<//><span>${t('仅限 1 名博士')}</span></div>`}
      </div>
    </header>

    <main class=${`seats rs-seats${coop ? '' : ' seats--solo'}${wide ? ` rs-seats--wide rs-seats--${cap}${shownTeam != null ? ' is-expanded' : ''}` : ''}`}>
      ${wide
        ? html`<${WideRoom} room=${room} facts=${facts} cap=${cap} openTeam=${shownTeam} cards=${cards} myCard=${myCard}
            localSkins=${localSkins} otherSkins=${otherSkins} acct=${acct} me=${me} onInvite=${() => copy('code')}
            onOpenTeam=${setOpenTeam} onBack=${() => setOpenTeam(null)} />`
        : facts.seats.map((s, i) => {
        const op = seatOperator(s, cards, { myId: me.playerId, myCard });
        // the player's outfit for that operator (header "Outfits"); null = the default art
        const skin = op ? seatCardSkin(s, op.chess.charId, { myId: me.playerId, localSkins, players: facts.occupied, otherSkins }) : null;
        const m = data.get('assets');
        // 立绘（`char/illust/<id>.png`）：名片立绘微调的画布；没有这条素材的干员照旧走 portrait → 头像框
        const illust = op ? illustUrl(m, op.chess.charId, { skin }) : null;
        // 这张卡先画哪张图（决定 4 × 2026-10-28 的 A 项）：穿外观、且本页**真有这套外观的图**时，外观自己的
        // 180×360 小图排在干员自己的立绘前面（外观自带的立绘除外，立绘本来就更全）；没穿外观、或本页没有这套外观
        // （插件外观缺失 / 没有美术包）时照旧是干员自己的立绘在前。illustUrl / chessPortraitUrl 对「本页没有的
        // skinId」都回落到干员自己的图，所以这里用「跟默认那张是否相同」来判断外观在本页有没有画得出来。
        const ownIllust = op ? illustUrl(m, op.chess.charId) : null;
        const wornIllust = op && skin ? illustUrl(m, op.chess.charId, { skin }) : null;
        const ownPortrait = op ? chessPortraitUrl(m, op.chess) : null;
        const wornPortrait = op ? chessPortraitUrl(m, op.chess, { skin }) : null;
        const outfitArt = !!skin && (wornIllust !== ownIllust || wornPortrait !== ownPortrait);
        const illustFirst = !outfitArt || wornIllust !== ownIllust;
        return html`<${SeatCard} key=${s ? `p${s.playerId}` : `e${i}`} seat=${s} index=${i} room=${room} facts=${facts}
          myId=${me.playerId} busy=${busy} onAddBot=${addBot} onRemoveBot=${removeBot} onKick=${kick} onInvite=${() => copy('code')}
          portrait=${wornPortrait}
          portraitDefault=${op && skin ? chessPortraitUrl(data.get('assets'), op.chess) : null} illust=${illust} illustFirst=${illustFirst}
          charId=${op?.chess.charId || null}
          nameCard=${acct?.card || null}
          operator=${op?.chess} onPickCard=${() => setPicking(true)} onTuneCard=${() => setArtOpen(true)}
          fresh=${shownRoom.current === room.code} />`;
      })}
      ${coop ? null : html`<aside class="solo-brief rs-brief brackets">
        <${MicroLabel} tone="mint">BRIEFING<//>
        <h2>${DIFFICULTY_NAMES[room.difficulty] ? t(DIFFICULTY_NAMES[room.difficulty]) : ''} <span class="num t-dim">${info.code}</span></h2>
        <p>${info.desc}</p>
        <ul>
          ${info.effects.map((e) => html`<li key=${e}>${e}</li>`)}
          <li>${t('共')} <b class="num">${info.rounds}</b> ${tc('rounds', '回合')}${info.hidden ? t('，满足条件时进入隐秘核心') : ''}</li>
          ${soloBrief ? html`<li>${t(soloBrief)}</li>` : null}
        </ul>
      </aside>`}
    </main>
    <${SpectatorBar} facts=${facts} myId=${me.playerId} busy=${busy} onRemove=${removeSpectator} onSit=${sit} />
    <${VersionVote} room=${room} />
    ${bannerText ? html`<p class="rs-verbanner" data-testid="version-banner"><${Icon} name="info" />${bannerText}</p>` : null}

    <footer class="room-bar rs-foot">
      <div class="rs-foot__left" aria-hidden="true"></div>
      <div class="rs-foot__center">
        <p class="rs-hint">${coop ? html`<span class="rs-ready num" title=${t('已就绪')}>${facts.humans.map((s) => html`<${Icon} key=${s.playerId} name="user" class=${facts.isReady(s) ? 'is-on' : ''} />`)}<b>${facts.readyHumans}</b>/${facts.humans.length}</span>` : null}<span class="room-bar__status">${statusLine}</span></p>
        <div class="rs-pill">
          <button type="button" class=${`rs-pill__diff${facts.isHost || isPlaySetRoom ? '' : ' is-ro'}${isInfiniteMode(room.mode) ? ' is-infinite' : ''}${isPlaySetRoom ? ' is-locked' : ''}`}
            disabled=${!isPlaySetRoom && facts.isHost && !!busy} data-locked=${isPlaySetRoom ? 'play-set' : null}
            onClick=${isPlaySetRoom ? () => toast(playSetLock, 'info') : openProto}
            title=${isPlaySetRoom ? playSetLock : (facts.isHost ? t('更改模拟难度') : t('由创建者选择'))}>${isInfiniteMode(room.mode)
            ? html`<span class="rs-pill__inf" aria-hidden="true">∞</span>`
            : html`<${DifficultyIcon} difficulty=${room.difficulty} />`}${DIFFICULTY_NAMES[room.difficulty] ? t(DIFFICULTY_NAMES[room.difficulty]) : ''}<span class="num rs-pill__code">${info.code}</span></button>
          ${room.difficulty === ANNIHILATION_DIFFICULTY ? html`<span class="rs-erosion-chips" role="group" aria-label=${t('蚀流')} data-testid="room-erosion">
            ${Array.from({ length: EROSION_MAX }, (_, i) => i + 1).map((n) => html`<button type="button" key=${n}
              class=${`rs-erosion__chip num${n === erosionLv ? ' is-on' : ''}`} data-tier=${n}
              aria-pressed=${n === erosionLv ? 'true' : 'false'} aria-label=${`${t('蚀流')} ${n}`}
              title=${n === EROSION_MAX ? t('无尽湮灭') : t('由创建者设置')}
              disabled=${!facts.isHost || !!busy} onClick=${() => setErosion(n)}>${n === EROSION_MAX ? '∞' : n}</button>`)}
          </span>` : null}
          ${versionCtl ? html`<${Tooltip} text=${versionCtl.why} class="rs-pill__version"><button type="button" class=${`rs-pill__ver${versionCtl.editable ? '' : ' is-ro'}${versionCtl.playSet ? ' is-playset' : ''}`} data-testid="room-version"
            data-locked=${versionCtl.playSet ? 'play-set' : null}
            disabled=${versionCtl.disabled} onClick=${versionCtl.onOpen}
            aria-label=${versionCtl.playSet ? versionCtl.label : t('游戏版本：{name}', { name: versionLabel(curVersion) })}><${Icon} name="book" /><span class="rs-pill__vername">${versionCtl.playSet ? versionCtl.label : versionLabel(curVersion)}</span></button><//>` : null}
          ${aiLast || soloOpt || seatsOpt ? html`<button type="button" class=${`rs-pill__gear${opts ? ' is-on' : ''}`} onClick=${() => setOpts((v) => !v)} title=${aiLast ? t('同盟设置') : t('模拟设置')} aria-label=${aiLast ? t('同盟设置') : t('模拟设置')}
            aria-expanded=${opts ? 'true' : 'false'}><${GearGlyph} /></button>` : null}
          ${opts && (aiLast || soloOpt || seatsOpt) ? html`<${RoomOptions} takeoverOption=${aiTakeoverOption(room, me.playerId)} onAiTakeover=${setAiTakeover} option=${aiLast} soloOption=${soloOpt} seatsOption=${seatsOpt} onSeats=${setSeats} room=${room} isHost=${facts.isHost} busy=${busy} onAiLast=${setAiLast}
            locked=${playSetLock} onDifficulty=${isPlaySetRoom ? () => toast(playSetLock, 'info') : openProto} onSoloUnlimited=${setSoloUnlimited} onClose=${() => setOpts(false)} version=${versionCtl} />` : null}
        </div>
      </div>
      <div class="room-bar__right rs-foot__right">
        ${facts.isHost
          ? html`<${Tooltip} text=${facts.canStart ? null : vote ? t('切换版本投票进行中，请等投票结束') : !facts.contentReady ? (facts.versionRoom ? t('仍有博士未载入「{version}」的数据', { version: versionLabel(curVersion) }) : t('仍有博士未载入房间的插件内容')) : t('仍有博士未准备就绪')}>
              <${GoButton} label=${t('开始模拟')} loading=${busy === 'start'} disabled=${!facts.canStart || !online || busy === 'start' || !!vote} onClick=${start} />
            <//>`
          : facts.spectating
            ? html`<${GoButton} label=${t('观战中')} icon="eye" disabled=${true} />`
          : html`<${Tooltip} text=${!myReady && facts.myContent !== 'ready' ? (facts.versionRoom ? t('「{version}」的数据载入并通过校验后才能准备', { version: versionLabel(curVersion) }) : t('房间的插件内容载入并通过校验后才能准备')) : null}>
              <${GoButton} label=${myReady ? t('已就绪') : t('准备就绪')} ready=${myReady} loading=${busy === 'ready'}
                disabled=${!online || !facts.mine || busy === 'ready' || (!myReady && facts.myContent !== 'ready')} onClick=${toggleReady} />
            <//>`}
      </div>
    </footer>
    ${picking ? html`<${CardPicker} current=${myCard} list=${cardList} m=${data.get('assets')} localSkins=${localSkins} onPick=${pickCard} onClose=${() => setPicking(false)} />` : null}
    ${artOpen && myOp && myIllust ? html`<${Modal} open=${true} title=${t('立绘调整')} micro="CARD ART" width="min(9.6rem, 96vw)"
      onClose=${() => setArtOpen(false)} actions=${html`<${Button} variant="ghost" onClick=${() => setArtOpen(false)}>${t('关闭')}<//>`}>
      <${CardArt} charId=${myOp.chess.charId} illust=${myIllust} />
    <//>` : null}
    ${protoOpen ? facts.isHost
      ? html`<${ProtocolSelect} roomMode=${room.mode} difficulty=${protoInf ? INFINITE_OPTION : protoPick || room.difficulty} onDifficulty=${(d) => { if (d === INFINITE_OPTION) setProtoInf(true); else { setProtoInf(false); setProtoPick(d); } }} onClose=${closeProto}
          allowInfinite=${!pluginMode} onCreate=${confirmDifficulty} busy=${busy === 'diff' || busy === 'infinite' ? 'create' : null} online=${online} action=${t('确认')} hint=${protoHint} difficulties=${protoDifficulties} />`
      : html`<${ProtocolSelect} roomMode=${room.mode} difficulty=${isInfiniteMode(room.mode) ? INFINITE_OPTION : room.difficulty} onDifficulty=${() => {}} onClose=${closeProto}
          online=${online} readOnly=${true} difficulties=${protoDifficulties} />` : null}
    ${versionOpen && versionCtl ? html`<${VersionPicker} mode="room" versions=${versions || [{ id: curVersion, roomModes: [room.mode] }]} current=${curVersion}
      serverDefault=${isPlaySetRoom ? null : serverDefault} roomMode=${room.mode} editable=${versionEditable && !versionWhy} busy=${busy === 'version'}
      note=${versionEditable ? versionWhy || (facts.humans.length > 1 ? t('其他博士同意后才会切换；切换后需要重新准备。') : null) : t('由创建者发起')}
      onPick=${proposeVersion} onClose=${() => setVersionOpen(false)} />` : null}
    ${rulesOpen ? html`<${ZhajingRulesDialog} onClose=${() => setRulesOpen(false)} />` : null}
    ${bansOpen ? html`<${ZhajingBanPicker} room=${room} myId=${me.playerId} busy=${busy === 'bans'}
      onSet=${(next) => run('bans', () => net.request('room.bans', { mode: 'zhajing', core: next.core, addon: next.addon }))}
      onClose=${() => setBansOpen(false)} />` : null}
  </div>`;
}

/** Persistent across room/game routes, including spectators who never consent. */
export function TrustedNotice() {
  const state = useStore(s => s);
  const room = state.room, cs = room?.content?.cs, trusted = room?.content?.trusted;
  const seat = room?.seats?.find(s => s && s.playerId === state.me?.playerId);
  const [dismissed,setDismissed] = useState(null);
  const [busy,setBusy] = useState(false);
  const [review,setReview] = useState(false);
  const choose = async accept => {
    setBusy(true);
    try {
      if (seat) await net.request('room.consent',{cs,accept});
      rememberScriptConsent(cs,accept);
      setDismissed(cs); setReview(false);
      if (accept && trusted.plugins.some(p => p.permissions.includes('trusted.page'))) {
        const url = new URL(location.href); url.searchParams.set('cs',cs); url.searchParams.set('room',room.code);
        location.assign(url.href); return;
      }
      store.set({room:{...store.get().room}}); // wake the content loader after local persistence
    } catch (e) { toastError(e); }
    finally { setBusy(false); }
  };
  useEffect(() => {
    if (trusted && seat && hasScriptConsent(cs) && !trusted.consent?.[seat.seat] && !room.inMatch) {
      net.request('room.consent',{cs,accept:true}).catch(toastError);
    }
  },[cs,seat?.seat,!!trusted?.consent?.[seat?.seat]]);
  if (!trusted) return null;
  return html`<aside class="trusted-banner" data-testid="trusted-banner">
    <strong>${t('受信任插件')}</strong>
    <button onClick=${() => setReview(true)}>${t('查看风险与同意状态')}</button>
    <${Modal} open=${review || (dismissed !== cs && !hasScriptConsent(cs))} title=${t('受信任插件')} tone="red" closeOnBackdrop=${false}
      onClose=${() => room.inMatch ? setReview(false) : choose(false)} actions=${html`<${Button} disabled=${busy} onClick=${() => choose(false)} data-testid="script-decline">${t('拒绝')}<//>
        <${Button} disabled=${busy} onClick=${() => choose(true)} data-testid="script-accept">${t('同意运行')}<//>`}>
      <p>${t('它可以完全控制你的游戏页面')}</p>
      <p>${t('仅在你信任所有作者及以下代码时同意。换了内容组合需要重新同意。')}</p>
      <ul>${trusted.plugins.map(p => html`<li key=${p.id}><strong>${p.id} ${p.version}</strong>
        <p>${t('作者：{authors}',{authors:(p.authors || []).join(', ') || '—'})}</p>
        <p class="trusted-hash">SHA-256: ${p.hash}</p><p>${t('权限：{permissions}',{permissions:p.permissions.join(', ')})}</p></li>`)}</ul>
    <//>
  </aside>`;
}

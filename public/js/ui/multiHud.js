// 多人房局内 HUD（8 / 12 人，docs/TWELVE_PLAYER_MODE.md §1/§3/§5 + handoff/room12/MOCK-ROOM12.md「多人房局内 HUD」）：
//
//   队伍框 .gm-teams    左栏竖排、左缘贴边 .2rem（8），从盟约栏下沿（2.36rem）往下排、框间距 .15rem（6）：
//                       一框 = 一支队伍（12 人房 3 框 = 12 人、8 人房 2 框 = 8 人）。收起态 2.2rem × .8rem（88×32）：
//                       队色条 + 队名 + `n/4`；队级状态画在边框上（实线 = 满员在线 / 淡 = 有空位 / 红 = 有掉线或倒下）。
//                       点开某一框：该框**原地向下展开**为 88 ×（32 + 4 行 × 34），行 = 大名单的一行（头像 + AI 角标 +
//                       名字 + 状态图标 + 我方那一队的血量数字（lpDisplay：max(1, floor(hp))、归零才是 0 —— 与顶栏
//                       LpTower 同一条口径，也就是 server/match/teams.js hpDisplay 的客户端孪生）：
//                       行的美工原样复用 `.team__row` / `.team__ai` / `.team__info` / `.team__name` / `.team__line` /
//                       `.team__status`（game.css），本组件只给容器与队列布局；空位仍是「空位 + 邀请」。同时另外两框暂时
//                       隐藏；再点该框（或 Esc）三框回到收起态。第三个框展开时行高会按视口收紧（见 multi-hud.css）。
//                       「收起 / 展开」就是框头那颗按钮本身（88×32，Enter / Space / 点击都能切）。
//   联防条   .gm-unite    只在联防阶段出现，屏幕底部正中的一小条（宽按内容自适应、下限 4rem 上限 9rem，高 .8rem：业主
//                       2026-11-01「太遮视野」→ 收窄，同日「移到下侧居中、高一点」= 24 → 32）：阶段 / **我方那一队**的出手
//                       干员头像（1–2 位）/ 阶段名 / 剩余敌人 / 状态；left 50% + translateX(-50%) 居中、bottom .2rem（792 下 8）。
//                       team 段各队同时各打各的场（三队各 1–2 位、合计最多 6），业主口径是条上**只显示我方那一队**、不合并、
//                       不补齐：本队只有 1 位就只画 1 个；本队全漏（没有场）一个头像都不画，读作观看（观战中 / 观看其他队的
//                       联防）；cross 段画跨队出手的那两位（语义由「跨队联防」区分）。
//                        「真的在联防」= `m.public.phase === 'UNITE'` **且** `m.public.unite.stage` 是 team / cross 之
//                        一（唯一的门 uniteLive）；其余任何一帧都不挂载这个节点（不是 display:none）。
//                       观看态不是第四段：服务端的 `watch` 阶段长度是 0（unitePhase.js 把 uniteStage 置 'watch' 的同一个
//                       tick 就进 cross，markPublic 只置脏位），所以 m.public **永远收不到** `stage === 'watch'`；
//                       「观战中」由 **team 段 + 本队没有场**（unite.teams[mine] 不存在或其 helpers 为空）读出来。
//
// 左栏：多人房（.gm.has-multi，game.js 按 maxSeats > 4 挂的类）里左侧大名单 .team 整个不挂载 —— 这一列队伍框是局内
// 唯一显示玩家的地方（业主 2026-10-31「不要那份大名单」）。因此 4 人房与既有模式的渲染逐字节不变：那一层由
// game.js 的 `isMultiRoom(pub) ? null : <TeamPanel>` 决定，本组件在 4 人房也返回 null。
// 玩法零改动：不切观战、不换棋盘、不加队长制。类名一律 `gm-` 前缀，且只有 m.public 带 maxSeats（房间人数 > 4）时才
// 渲染 —— 4 人房的局内渲染逐字节不变（本组件返回 null，TeamPanel 照旧挂载）。
// 文案：不新增 msgid。队名沿用第一层房间界面的内联口径（我方 / 对方 / 蓝方 / 红方同盟，i18n-ignore）；展开行的状态图标
// 用 STATUS_META 的既有条目（行动中 / 已就绪 / 决策中 / 作战中 / 作战结束 / 已淘汰，掉线是官方 icon_lost_connect），
// 空位用既有的「空位」「邀请」，联防用既有的「联防阶段」「联防中」「观战中」「剩余敌人 {v}」。

import { useState, useEffect } from '../../vendor/hooks.module.js';
import { PHASE } from '../../../shared/constants.js';
import { html, Icon } from './components.js';
import { PlayerAvatar, GIcon, LocalSprite } from './gameComponents.js';
import { STATUS_META, lpDisplay } from './gameLogic.js';
import { STATUS_SPRITE } from './teamPanel.js';
import { localAsset } from '../data.js';
import { t } from '../../../shared/i18n.js';

const cx = (...p) => p.flat().filter(Boolean).join(' ');

/**
 * The one gate of the multi-team HUD: an 8 / 12-seat room (`m.public.maxSeats > 4`). game.js reads it for the `.gm`
 * root's `has-multi` class AND for mounting `.team` (the left roster panel): false ⇒ that panel mounts as always.
 * @param {any} pub m.public (4 人房不带宽容量键：false)
 * @returns {boolean}
 */
export function isMultiRoom(pub) {
  return (Number(pub?.maxSeats) || 0) > 4;
}

/** 联防两段的读法 —— 内联中文，不新增 msgid。 */
const STAGE_TEXT = { team: '队内联防', cross: '跨队联防' }; // i18n-ignore

/** team 段本队没有场时的阶段字（既有内联中文，不新增 msgid）。 */
const WATCHING_TEXT = '观看其他队的联防'; // i18n-ignore

/**
 * 联防在场的两段（服务端 server/match/match/unitePhase.js：team → cross）。服务端另有一个 `watch` 状态，但它的长度是
 * 0 —— 置 'watch' 与进 'cross' 在同一个 tick，`markPublic()` 只置脏位、不会在两者之间广播 —— 所以 `m.public.unite.stage`
 * 只会是 team / cross（或三段走完后的 null）。「观看」因此不是一个阶段，而是 team 段的一种读法（见 uniteWatching）。
 */
export const UNITE_STAGES = Object.freeze(['team', 'cross']);

/**
 * 联防条唯一的门（业主 2026-10-31「只在真的处于联防阶段时出现」）：UNITE 阶段 + `m.public.unite.stage` 是
 * team / cross 之一（UNITE_STAGES；服务端的 `watch` 是零长度状态，不会出现在 m.public 里）。**不能**只看 `pub.unite`
 * 是否存在 —— 两种 `unite` 都不该画出这条横条：
 *   1. 4 人房的 `{ helpers, leakers }`（views.js，没有 stage）；
 *   2. 多人房两段走完、`_finishMultiUnite` 把 `uniteStage` 置 null 之后的那几帧（此前 views.js 回落到
 *      `'team'`，横条会一直挂到 SETTLE，读作「队内联防 / 剩余敌人 N」而场上什么都没跑）。
 * 返回 false 的每一帧（PREP / COMBAT / SETTLE / 选卡浮层 / 联防已结束）调用处都**不挂载**这个节点。
 * @param {any} pub m.public
 * @returns {boolean}
 */
export function uniteLive(pub) {
  const u = pub && pub.unite;
  return !!(pub && pub.phase === PHASE.UNITE && u && typeof u.stage === 'string' && UNITE_STAGES.includes(u.stage));
}

/** The four seats of a team, padded with nulls: `[player|null × 4]`. */
export function teamSeats(players, index) {
  const list = (Array.isArray(players) ? players : [])
    .filter((p) => (Number.isInteger(p?.team) ? p.team : Math.floor((Number(p?.seat) || 0) / 4)) === index)
    .sort((a, b) => (a.seat ?? 0) - (b.seat ?? 0));
  const out = list.slice(0, 4);
  while (out.length < 4) out.push(null);
  return out;
}

/** 我方同盟 / 对方同盟 (2 teams) or 我方同盟 / 蓝方同盟 / 红方同盟 (3 teams) — inline, no msgid (layer 1's wording). */
export function teamLabelOf(index, teams = 3) {
  if (index === 0) return '我方同盟'; // i18n-ignore
  if (teams <= 2) return '对方同盟'; // i18n-ignore
  return index === 1 ? '蓝方同盟' : '红方同盟'; // i18n-ignore
}

/** The 4-seat state of a seat: 'on' (in the match), 'off' (down / disconnected), 'gap' (empty seat). */
export function seatStateOf(p) {
  if (!p) return 'gap';
  if (p.alive === false) return 'off';
  if (p.connected === false && p.isBot !== true) return 'off';
  return 'on';
}

/** Why a seat reads 'off': 'down' (eliminated) or 'conn' (disconnected). Only meaningful for an 'off' seat. */
export function offReasonOf(p) {
  return p && p.alive === false ? 'down' : 'conn';
}

/** The big number of a 联防 bar: how many leaked enemies are still standing, over every leaker of the running stage. */
export function uniteLeftTotal(unite) {
  const map = unite && unite.left;
  if (!map || typeof map !== 'object') return null;
  let n = 0;
  for (const v of Object.values(map)) if (Number.isFinite(v)) n += Math.max(0, Math.trunc(v));
  return n;
}

/**
 * The helpers the 联防 bar draws — **my own team's only** (业主 2026-11-01：team 段各队同时各打各的场，条上只显示我方那一队
 * 的 1–2 位 helpers，不合并三队、不补齐). `unite.teams[mine].helpers` is already capped at two by planTeamUnite
 * (server/match/teams.js), and the slice keeps a malformed frame from ever drawing more. One helper = one avatar: no padding.
 * The cross stage is the exception — its one field belongs to the other team's pair (跨队联防), so the bar shows
 * `unite.cross.helpers` (≤2) there. A team that fields nobody gets `[]`: the bar shows the viewing semantics instead
 * (see uniteWatching), never another team's helpers.
 * @param {any} unite m.public.unite
 * @param {number} mine my team index (m.public.players[me].team)
 * @returns {string[]} 0–2 player ids
 */
export function uniteWho(unite, mine) {
  if (!unite) return [];
  if (unite.stage === 'cross') {
    return unite.cross && Array.isArray(unite.cross.helpers) ? unite.cross.helpers.slice(0, 2) : [];
  }
  const teams = Array.isArray(unite.teams) ? unite.teams : [];
  const own = teams.find((x) => x && x.index === mine);
  return own && Array.isArray(own.helpers) ? own.helpers.slice(0, 2) : [];
}

/**
 * Whether the bar reads 「观看」 for me: **in the team stage, my own team has no field** — `unite.teams[mine]` is missing, or
 * its `helpers` is empty (its four players all leaked, or it leaked nothing at all) — so there is no teammate avatar to
 * draw and the bar shows the viewing semantics instead: the existing strings `观战中` (msgid) and `观看其他队的联防`
 * (WATCHING_TEXT, inline). The `watch` stage this used to key on is zero-length server-side (unitePhase.js leaves it on the
 * same tick it enters it), so m.public never carries it; the reading hangs off the team frame instead. The cross stage is
 * never 「观看」: its field is the cross-team pair's and the bar names it 跨队联防.
 * @param {any} unite m.public.unite
 * @param {number} mine my team index
 * @returns {boolean}
 */
export function uniteWatching(unite, mine) {
  if (!unite) return false;
  if (unite.stage !== 'team') return false; // cross 段画跨队那两位；其余阶段不存在或不是观看
  return uniteWho(unite, mine).length === 0;
}

/**
 * A seat's status glyph — **the roster row's own** (TeamPanel): the same `.team__status` span, tone and official
 * sprites (STATUS_META + STATUS_SPRITE, shared from teamPanel.js), 就绪 / 决策中 / 行动中 / 作战中 / 已淘汰 or the
 * lost-connect icon for a disconnected seat. The text stays as the accessible name (aria-label) — existing msgids.
 * @param {{ p: any }} props
 */
function SeatStatus({ p }) {
  const status = p.alive === false ? 'dead' : p.status;
  const meta = STATUS_META[status] || STATUS_META.acting;
  const offline = p.connected === false && !p.isBot;
  const sprite = offline ? 'icon_lost_connect' : STATUS_SPRITE[status];
  return html`<span class=${cx('team__status', `is-${meta.tone}`, offline && 'is-offline', sprite && localAsset('ui/battle', sprite) && 'has-sprite')}
      aria-label=${t(meta.text)}>
    ${offline ? html`<${LocalSprite} name="icon_lost_connect" fallback=${html`<${Icon} name="wifiOff" />`} />`
      : sprite ? html`<${LocalSprite} name=${sprite} fallback=${html`<${GIcon} name=${meta.glyph} />`} />`
      : html`<${GIcon} name=${meta.glyph} />`}
  </span>`;
}

/**
 * @param {{ pub: any, myId: string|null }} props
 */
export function MultiHud({ pub, myId }) {
  const [openTeam, setOpenTeam] = useState(-1);
  // Esc 收起（业主定稿：再点该框或 Esc 都回到三框收起的原状）
  useEffect(() => {
    if (openTeam < 0) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') setOpenTeam(-1); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [openTeam]);
  return multiHudView({ pub, myId, openTeam, onPick: (i) => setOpenTeam((cur) => (cur === i ? -1 : i)) });
}

/**
 * The markup of the multi-team HUD — pure (no hooks), so a test can walk the vnode tree. `openTeam` is the team whose
 * box is expanded (-1: all three collapsed) and `onPick(i)` toggles it. Returns null for a 4-seat room (no `maxSeats`).
 * @param {{ pub: any, myId: string|null, openTeam?: number, onPick?: (i: number) => void }} o
 */
export function multiHudView({ pub, myId, openTeam = -1, onPick = () => {} }) {
  if (!pub || !isMultiRoom(pub)) return null; // 4 人房：这一层整个不存在（渲染输出与从前逐字节相同）
  const capacity = Number(pub?.maxSeats) || 0;
  const teams = Math.max(1, Math.round(capacity / 4));
  const players = Array.isArray(pub.players) ? pub.players : [];
  const findMe = players.find((p) => p.playerId === myId);
  const mine = Number.isInteger(findMe?.team) ? findMe.team : 0;
  const unite = uniteLive(pub) ? pub.unite : null; // 联防条的唯一门：UNITE 阶段 + 已知 stage（见 uniteLive）
  const left = uniteLeftTotal(unite);
  const who = uniteWho(unite, mine); // 只我方那一队的 1–2 位（cross 段是跨队那两位）
  const watching = uniteWatching(unite, mine); // team 段本队没有场 ⇒ 不画队友头像，读作观看
  const stageTxt = unite ? (watching ? WATCHING_TEXT : STAGE_TEXT[unite.stage]) : '';
  const done = watching; // 观看态 = 阶段字「观看其他队的联防」+ 状态字「观战中」（不是第四段，见 uniteWatching）
  const byId = (id) => players.find((p) => p.playerId === id) || null;
  /** 队色：我方薄荷 / 三队房的蓝方、红方 / 两队房的对方灰（沿用游戏里既有的队色）。 */
  const toneOf = (i) => (i === mine ? 'is-mine' : teams > 2 ? (i === 1 ? 'is-blue' : 'is-red') : null);
  return html`<div class=${cx('gm-teams', openTeam === teams - 1 && 'is-tail')} role="group" aria-label="ALLIANCE">
    ${Array.from({ length: teams }, (_, i) => {
      const seats = teamSeats(players, i);
      const states = seats.map(seatStateOf);
      const n = seats.filter(Boolean).length;
      const off = states.includes('off');
      const open = openTeam === i;
      const hidden = openTeam >= 0 && !open;
      return html`<div key=${i} class=${cx('gm-team', toneOf(i), n >= 4 && !off && 'is-full', n < 4 && 'is-gap',
          off && 'is-off', open && 'is-open')} style=${`--slot:${i}`} hidden=${hidden || undefined}>
        <button type="button" class="gm-team__head" aria-expanded=${open ? 'true' : 'false'}
          aria-label=${`${teamLabelOf(i, teams)} ${n}/4`} aria-controls=${open ? `gm-team-${i}` : undefined}
          onClick=${() => onPick(i)}>
          <span class="gm-team__title">${teamLabelOf(i, teams)}</span>
          <span class="gm-team__num num">${n}/4</span>
        </button>
        ${open ? html`<div class="gm-team__list" id=${`gm-team-${i}`} role="group" aria-label=${teamLabelOf(i, teams)}>
          ${seats.map((p, k) => (p ? html`<div key=${p.playerId} class=${cx('gm-team__row', 'team__row',
              p.playerId === myId && 'is-self', p.alive === false && 'is-dead', seatStateOf(p) === 'off' && 'is-off')}
              role="group" aria-label=${`${teamLabelOf(i, teams)} ${p.name || t('博士')}`}>
            <span class="gm-team__ava">
              <${PlayerAvatar} player=${p} self=${p.playerId === myId} />
              ${p.isBot ? html`<span class="team__ai">AI</span>` : null}
            </span>
            <div class="team__info">
              <span class="team__name">${p.name || t('博士')}</span>
              <div class="team__line">
                ${i === mine && p.alive !== false && Number.isFinite(p.hp)
                  ? html`<span class="gm-team__hp num">${lpDisplay(p.hp)}</span>` : null}
                <${SeatStatus} p=${p} />
              </div>
            </div>
          </div>` : html`<div key=${`e${k}`} class="gm-team__row is-empty">
            <span class="gm-team__who">${t('空位')}</span>
            <span class="gm-team__invite">${t('邀请')}</span>
          </div>`))}
        </div>` : null}
      </div>`;
    })}
  </div>

  ${unite ? html`<div class="gm-unite" role="status" aria-label=${t('联防阶段')}>
    <span class="gm-unite__phase">${t('联防阶段')}</span>
    ${who.length ? html`<span class="gm-unite__who">${who.map((id) => (byId(id) ? html`<${PlayerAvatar} key=${id} player=${byId(id)} self=${id === myId} />` : null))}</span>` : null}
    <span class="gm-unite__txt">${stageTxt}</span>
    ${left != null ? html`<span class="gm-unite__count">${t('剩余敌人 {v}', { v: left })}</span>` : null}
    <span class=${cx('gm-unite__state', done && 'is-done')}>${done ? t('观战中') : t('联防中')}</span>
  </div>` : null}`;
}

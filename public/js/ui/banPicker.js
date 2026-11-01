// public/js/ui/banPicker.js — 炸惊模拟 · 卡池预选（房内面板；业主 2026-10-28 C 项）。
//
// 口径（服务端 5/5 已就绪，见 server/lobby.js 的 `setBans` 与 test/match/zhajing-bans.test.js）：
//   * 协议 `room.bans { mode:'zhajing', core:[bondId], addon:[bondId] }` —— **每个在座真人只改自己的**（非房主特权），
//     只在炸惊房有效（其余 BAD_TARGET）、已开局 ROOM_STARTED、超配额 / 错列 / 未知 id ⇒ BAD_MSG（toast 由调用方给）。
//   * 配额从 `data/config.json` 的 `bans.ZHAJING` 现算（core 3 / addon 4），不写死；读回在 `room.state.seats[].bans`
//     （形状 `{ zhajing: { core, addon } }`，服务端已去重并按数据序归一化）。
//   * 列只有两类：`isCore === true` 的进「核心盟约」，其余进「附加盟约」——与服务端 `pick(list, wantCore, …)` 同一判据，
//     所以客户端**画不出**服务端会拒掉的组合（超配额的那一下直接不生效，不发请求）。
//
// 这一页刻意不做「特别关心 ❤」：那是参考包 100 座变体的概念（每人一副独立牌池），本仓的 room.bans 没有这个字段。
import { useEffect, useState } from '../../vendor/hooks.module.js';
import { html, Button, Icon, Modal } from './components.js';
import { data, useData } from '../data.js';
import { t } from '../../../shared/i18n.js';

let cssLoaded = false;
/** 本面板的样式（与 ui/forge.js / ui/cardArt.js 同一个懒加载写法；不进 index.html）。 */
export function ensureBanPickerCss() {
  if (cssLoaded || typeof document === 'undefined') return;
  cssLoaded = true;
  if (document.querySelector('link[data-banpicker]')) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = '/css/screens/ban-picker.css';
  link.dataset.banpicker = '1';
  document.head.appendChild(link);
}

/** The play set's ban mode key (the server accepts exactly this one). */
export const BAN_MODE = 'zhajing';

/**
 * 炸惊档的 ban 配额：`config.bans.ZHAJING { core, addon }`，缺项退回 3 / 4（与服务端同一个缺省）。
 * @param {any} [cfg]
 * @returns {{ core: number, addon: number }}
 */
export function banQuota(cfg = data.get('config')) {
  const q = cfg && typeof cfg === 'object' && cfg.bans && typeof cfg.bans === 'object' ? cfg.bans.ZHAJING : null;
  const pick = (v, def) => (Number.isInteger(v) && v >= 0 ? v : def);
  return { core: pick(q && q.core, 3), addon: pick(q && q.addon, 4) };
}

/** 数据序（identifier 降序、再按 bondId）——与服务端 `pick()` 归一化的顺序一致，避免每次回显都跳位。 */
const byData = (a, b) => ((Number(b.identifier) || 99) - (Number(a.identifier) || 99)) || String(a.bondId).localeCompare(String(b.bondId));

/**
 * 两列可 ban 的盟约（炸惊档：`zjOnly` 也算，官方档不会调用这里）。
 * @param {any[]|Record<string, any>} [bonds]
 * @returns {{ core: any[], addon: any[] }}
 */
export function banLists(bonds = data.list('bonds')) {
  const list = (Array.isArray(bonds) ? bonds : Object.values(bonds && typeof bonds === 'object' ? bonds : {}))
    .filter((b) => b && typeof b.bondId === 'string');
  return {
    core: list.filter((b) => b.isCore === true).sort(byData),
    addon: list.filter((b) => b.isCore !== true).sort(byData),
  };
}

/**
 * 自己的两份名单（服务端回显；没有就是空的）。
 * @param {any} room room.state @param {any} myId
 * @returns {{ core: string[], addon: string[] }}
 */
export function seatBans(room, myId) {
  const seat = Array.isArray(room?.seats) ? room.seats.find((s) => s && s.playerId === myId) : null;
  const b = seat?.bans?.zhajing;
  const list = (v) => (Array.isArray(v) ? v.filter((x) => typeof x === 'string') : []);
  return { core: list(b?.core), addon: list(b?.addon) };
}

/**
 * 点一下某条盟约：已选就取消；没选且该列还没满就加入；**满了就原样返回**（不发请求，服务端也会 BAD_MSG）。
 * @param {{ core: string[], addon: string[] }} sel
 * @param {string} bondId @param {'core'|'addon'} kind @param {{ core: number, addon: number }} quota
 */
export function toggleBan(sel, bondId, kind, quota) {
  const mine = kind === 'core' ? sel.core : sel.addon;
  const key = kind === 'core' ? 'core' : 'addon';
  if (mine.includes(bondId)) return { ...sel, [key]: mine.filter((id) => id !== bondId) };
  if (mine.length >= quota[key]) return sel;
  return { ...sel, [key]: [...mine, bondId] };
}

/** 两列是否一致（用来判断「有未保存的改动」，只影响 重置 键的可用性）。 */
export const sameBans = (a, b) => JSON.stringify(a) === JSON.stringify(b);

function Chip({ bond, on, disabled, onClick }) {
  return html`<button type="button" class=${`zjban__chip${on ? ' is-on' : ''}`} data-bond=${bond.bondId}
      aria-pressed=${on ? 'true' : 'false'} disabled=${disabled}
      title=${bond.desc ? String(bond.desc).slice(0, 300) : bond.name} onClick=${onClick}>
    <span class="zjban__name">${bond.name}</span>
    ${on ? html`<span class="zjban__mark" aria-hidden="true"><${Icon} name="check" /></span>` : null}
  </button>`;
}

/**
 * 卡池预选面板（房内；自己的名单）。
 * @param {{ room: any, myId: any, busy?: boolean, onSet: (next: {core: string[], addon: string[]}) => void,
 *   onClose: () => void }} props
 */
export function ZhajingBanPicker({ room, myId, busy = false, onSet = () => {}, onClose = () => {} }) {
  ensureBanPickerCss();
  // 盟约数据可能在进房时还没载入（大厅 → 拓展 → 炸惊 → 开始）：订阅它，载入完成就重画，
  // 否则面板会画成两列空的（巡检实测过这个状态）。
  useData('bonds');
  const quota = banQuota();
  const { core, addon } = banLists();
  const [sel, setSel] = useState(() => seatBans(room, myId));
  // 服务端回显（广播 room.state）是权威：回显一到就把本地选择对齐
  useEffect(() => { setSel(seatBans(room, myId)); }, [room, myId]);
  const locked = busy || room?.inMatch === true;
  const send = (next) => { setSel(next); onSet(next); };

  const section = (kind, list, title, micro) => html`<section class="zjban__sec">
    <header class="zjban__head">
      <h3 class="zjban__title">${title}<span class="zjban__micro">${micro}</span></h3>
      <span class="zjban__count num" data-testid=${`zj-ban-count-${kind}`}>${sel[kind].length}/${quota[kind]}</span>
    </header>
    <div class="zjban__chips" role="group" aria-label=${title}>
      ${list.map((b) => html`<${Chip} key=${b.bondId} bond=${b} on=${sel[kind].includes(b.bondId)} disabled=${locked}
        onClick=${() => { const next = toggleBan(sel, b.bondId, kind, quota); if (!sameBans(next, sel)) send(next); }} />`)}
    </div>
  </section>`;

  return html`<${Modal} open=${true} onClose=${onClose} title=${t('卡池预选')} micro="POOL BAN PICKS" class="zjban"
      width="min(11rem, 96vw)"
      actions=${html`<${Button} variant="ghost" disabled=${locked || (!sel.core.length && !sel.addon.length)}
          onClick=${() => send({ core: [], addon: [] })}>${t('重置')}<//>
        <${Button} variant="primary" onClick=${onClose}>${t('关闭')}<//>`}>
    <div class="zjban__body" data-testid="zj-ban-picker" data-mode=${BAN_MODE}>
      <p class="zjban__lead">${t('禁选的盟约只影响你自己的干员池：队友的池子不受影响，没填满的槽位由系统随机补。')}</p>
      ${section('core', core, t('核心盟约'), 'CORE')}
      ${section('addon', addon, t('附加盟约'), 'ADD-ON')}
    </div>
  <//>`;
}

/** 房内入口键（只在炸惊房挂；与「规则」并排）。 */
export function ZhajingBansButton({ onClick, class: cls }) {
  return html`<${Button} variant="secondary" size="sm" icon="crown" class=${cls} data-testid="zj-bans-open"
      title=${t('卡池预选')} onClick=${onClick}>${t('卡池预选')}<//>`;
}

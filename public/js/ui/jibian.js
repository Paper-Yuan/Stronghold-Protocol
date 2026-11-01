// public/js/ui/jibian.js — 炸惊模拟 (ZHAJING) 惊变界面：三选一浮层 + 已选惊变面板（我方 / 敌方 / 羁绊三页）。
//
// 数据面（与 engine-core 对齐，2026-10-28）：
//   * 抽卡 = 普通 SP_DRAFT：`m.public.sp = { family:'jibian', name, desc, cards:[{idx,kind,id,name,desc,rarity,flavor?,bond?,iconBond?,bonds?}],
//     order, turn, picks, taken, untimed }` —— 卡片字段来自 `match/choices.js cardView`，选卡走既有 `g.choice { idx }`
//     （`ui/gameActions.js choice`）。**本轮没有专用的 `g.jibian*` 消息**，也没有重抽协议（服务端 `refreshSpCard` 已就绪但
//     `shared/protocol.js` 缺 message），所以这里不画重抽按钮。
//   * 已选惊变 = `m.private.jibian = { cards:[{key,id,name,desc,rarity,flavor?,bond?,iconBond?}], owned:[id], rerollsLeft }`
//     （`match/player/basics.js jibianView`；只在 `gd.zhajing` 下出现）。
//   * 敌方惊变 = `m.public.enemyJibian = { round, rarity, card, cards:[{round,id,name,desc,rarity,flavor?}], pool, flickerMs, resultMs }`
//     —— `cards` 是本局**已经抽到的全部**敌方惊变（R1 / R6 两张同时生效），所以敌方页读它，而不是只看最新一张。
//   * 惊变羁绊 = `/data/jibianBonds.json`（人类可读镜像；判定在 `server/sim/content/jibianBonds.js`）。经 data.js 载入
//     （`useData('jibianBonds')`），失败就当空 —— 卡面与羁绊页都只认这一张表，绝不编造文案。
//
// 版式：浮层与「机变」的 `.spov`（game-panels.css）同一层，落在局内屏内而不是全屏固定层 —— 它与机变占同一个位置
// （SP_DRAFT），玩家看到的是同一件事的另一种卡面。三张**竖卡**始终并排（契约是 `modes[*].jibian.cards` = 3，但这里
// 不写死：`sp.cards` 有几张画几张）；每张竖卡从上到下是 图 / 名称+稀有度 / 卡面描述 / **所属惊变羁绊**（名 + effect
// 全文，见 jibianCardBonds），手机 792×360 也并排看得见，真放不下时浮层内部竖向滚动（业主 2026-10-29 的竖版卡片式
// 改版）。所有尺寸走 rem + var(--t)，跟 文字大小 一起缩放。
// **已选惊变面板**（我方 / 敌方两页）走的是另一套版式：**横行**，一行一张惊变（业主 2026-10-29 晚「已选惊变的显示
// 逻辑是横行而不是选择时的竖排卡片」）—— 左图，右侧名称 / 稀有度 / 已选或敌方标记一行，描述与羁绊名 + tiers 横铺
// 其后，effect 全文与整段文案挂在整行的 title 上；面板正文竖向滚，行高不随文案长。
//
// 三选一是**两步**（Lead 裁决 2026-10-28）：第一次点选只把卡置为「已选」（高亮 + 确认键亮起），再点同一张卡或点
// 「确认选择」才发 `g.choice { idx }`；点别处 / Esc 取消选中。理由与机变、藏品一致（防误触），而惊变是整局不可逆的选择
// （进池后影响羁绊进度），代价比藏品更高。状态机直接复用 ui/choiceOverlay.js 的 `spTap` / `armedCard` / `cardPickable`，
// 不另写一套。
import { useEffect, useRef, useState } from '../../vendor/hooks.module.js';
import { html, Icon, Button, Spinner } from './components.js';
import { Img, RichText, GIcon } from './gameComponents.js';
import { bondIconUrl, uiUrl } from './assetUrls.js';
import { cardPickable, pickBusy, spTap, armedCard } from './choiceOverlay.js';
import { reducedMotion } from './device.js';
import { data, useData } from '../data.js';
import { t, tName } from '../../../shared/i18n.js';

const cx = (...p) => p.flat().filter(Boolean).join(' ');

let cssLoaded = false;
/** The panel's stylesheet, loaded on first draw (the same way ui/relics.js brings in relics.css). */
function ensureCss() {
  if (cssLoaded || typeof document === 'undefined') return;
  cssLoaded = true;
  if (document.querySelector('link[data-jibian]')) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = '/css/screens/jibian.css';
  link.dataset.jibian = '1';
  document.head.appendChild(link);
}
/** The 惊变 stylesheet is brought in HERE too when another module draws a `.zjpanel` (the HUD's 模式工具 panel:
 *  ui/hud.js ModeToolsPanelView — its forge page may be the first thing opened in a room). */
export { ensureCss as ensureJibianCss };

/** 惊变 rarities (the mode's `jibian.rarityWeights` keys, in order: 普通 / 稀有 / 史诗 / 传说 / 隐秘). */
export const JIBIAN_RARITIES = ['normal', 'rare', 'epic', 'legend', 'hidden'];
/** Their names — the five words the card face prints. */
export const RARITY_NAMES = { normal: '普通', rare: '稀有', epic: '史诗', legend: '传说', hidden: '隐秘' };

/** The card's data id (an effectId, a `jibian:`-prefixed key, or a bare id). */
export function jibianArtId(card) {
  const id = card?.effectId || card?.jibianId || card?.data?.effectId || card?.id || card?.key;
  return typeof id === 'string' ? id.replace(/^jibian:/, '').split('#')[0] : null;
}

/**
 * Is this effects-column entry a picked 惊变? Its ref is `<cardId>#<uid>` and every 惊变 card id starts with `jibian_`
 * (choices.js addRef keys `jibian:<cardId>`). screens/game.js uses it to keep 惊变 out of the right-hand effects column
 * (业主 2026-10-29「已选惊变不要显示在右侧」); jibianFromEffects below reads the same shape for the watched seat.
 * @param {any} effect
 */
export function isJibianRef(effect) {
  return typeof effect?.id === 'string' && effect.id.split('#')[0].startsWith('jibian_');
}

/**
 * The card's icon: 盟约惊变 draws that bond's portrait (the reference build's `iconBond`), everything else its own
 * `assets.items` key (data/assets.json registers one key per card that has art), else the shared 惊变 glyph.
 * @param {any} manifest data.get('assets') @param {any} card
 * @returns {{ id: string|null, whiteGlyph: boolean, icon: string|null }}
 */
export function resolveJibianArt(manifest, card) {
  const id = jibianArtId(card);
  const bondId = card?.iconBond || card?.bond || null;
  const own = id && manifest && manifest.items ? manifest.items[id] : null;
  return {
    id,
    whiteGlyph: !!card?.iconBond,
    icon: (bondId && bondIconUrl(manifest, bondId)) || own || uiUrl(manifest, 'buffIcon/icon_player_buff'),
  };
}

/** The rarity of a card, guaranteed to be one of the five (an unknown roll reads as 普通). */
export function jibianRarity(card) {
  return JIBIAN_RARITIES.includes(card?.rarity) ? card.rarity : 'normal';
}

/** 惊变羁绊表 (`/data/jibianBonds.json`, `{ bonds: [...] }`)；文件还没拿到时是空表。 */
function jibianBondTable() {
  const table = data.get('jibianBonds');
  return table && Array.isArray(table.bonds) ? table.bonds : [];
}

/**
 * 这张惊变卡属于哪些**惊变羁绊**（0…n 条）。反查的键就是卡片自己的 id（`jibianArtId`：`effectId || jibianId ||
 * data.effectId || id || key`），去 `data/jibianBonds.json` 每条的 `members` 里找。
 *
 * 卡片自带的 `bond` / `iconBond` 是**盟约** id（`yanShip` / `mujicaShip` …），它们不参与这句补充 —— 盟约的自有文案在
 * 盟约条上，业主 2026-10-29：「我方惊变的补充是这个惊变属于什么惊变羁绊，没让你补充说明对应盟约，这个文案不是有吗」。
 * 数据只有 `data/jibianBonds.json` 这一处（人类可读镜像；判定在 `server/sim/content/jibianBonds.js`）。
 * 一条都查不到 = 这张卡不参与任何羁绊（99 张里 36 张如此）→ 调用方不画羁绊块，**绝不编造文案**。
 * 注：`jibian_jibangzhili`（羁绊之力）在服务器 `bondsOfCard` 里属于全部 18 条；它的卡面描述已经写明「它属于所有羁绊」，
 * 卡面若列出 18 段效果没法读，所以这里也只认 `members`（它没有条目 → 不画块）。
 * @param {any} card
 * @returns {{ id: string, name: string, effect: string, tiers: number[], members: string[] }[]}
 */
export function jibianCardBonds(card) {
  const id = jibianArtId(card);
  if (!id) return [];
  const out = [];
  for (const b of jibianBondTable()) {
    if (!b || !Array.isArray(b.members) || !b.members.includes(id)) continue;
    out.push({
      id: b.id,
      name: b.name || b.id,
      effect: typeof b.effect === 'string' ? b.effect : '',
      tiers: Array.isArray(b.tiers) ? b.tiers : [],
      members: b.members,
    });
  }
  return out;
}

/**
 * 卡面上的「惊变羁绊」块：羁绊名 + 该羁绊 effect **全文**（不截断；太长由浮层自己竖向滚动），命中的每条画一块。
 * `idx` 给三选一的卡（`data-testid="jibian-bond-<idx>"`）；面板里的卡不传 idx。
 * @param {{ card: any, idx?: number|null }} props
 */
function JibianBondBlocks({ card, idx = null }) {
  const bonds = jibianCardBonds(card);
  if (!bonds.length) return null;
  return html`<span class="zjcard__bondblocks" data-testid=${idx == null ? undefined : `jibian-bond-${idx}`}
      data-bonds=${bonds.map((b) => b.id).join(' ')}>
    ${bonds.map((b) => html`<span class="zjcard__bondbox" key=${b.id} data-bond=${b.id}>
      <span class="zjcard__bondhead">
        <span class="zjcard__bondtag">${t('惊变羁绊')}</span>
        <b class="zjcard__bondname">${tName(b.name)}</b>
        ${b.tiers.length ? html`<span class="zjcard__bondtiers num">${b.tiers.join(' / ')}</span>` : null}
      </span>
      ${b.effect ? html`<${RichText} text=${b.effect} class="zjcard__bondeffect" />` : null}
    </span>`)}
  </span>`;
}

/** The card's bond hints (the draft's 「羁绊名 已有/阈值」 lines); accepts the server's objects or plain strings. */
function bondHints(card) {
  const list = Array.isArray(card?.bonds) ? card.bonds : [];
  return list.map((b) => (typeof b === 'string' ? { text: b } : { text: `${b.name || ''} ${b.have ?? 0}/${(b.tiers && b.tiers[0]) ?? b.need ?? 2}`, on: (b.have || 0) > 0 }));
}

/** One card of the draft. `armed` = the two-tap selection's current card (it lifts and shows 确认选择 · 再次点击). */
function JibianCard({ card, can, busy, armed = false, onTap, rerollLeft = null, rerollBusy = null, onReroll = null }) {
  const rarity = jibianRarity(card);
  const name = tName(card.name) || t('惊变');
  const art = resolveJibianArt(data.get('assets'), card);
  const hints = bondHints(card);
  // 所属**惊变羁绊**（竖卡的第二块信息，业主 2026-10-29）：按卡片 id 反查 jibianBonds.members，名 + effect 全文；
  // 不属于任何羁绊的卡不画块（不编）。卡上的 bond / iconBond 是盟约，不参与这块。
  const bonds = jibianCardBonds(card);
  // 重抽 (`g.cardRefresh { idx }`)：**每张卡各能刷一次**（服务端 `spDraft.refreshSpCard` 按卡片 id 记账，同一张刷第二次是
  // ALREADY，toast 由 ui/gameActions.js act() 负责）。所以按钮的单卡可用性看 `card.rerolled`，而 `rerollsLeft` 只是
  // 「这一手还能刷几张」的显示预算（服务端 `jibianRerollsLeft()`）。旧注释里「第 5 次会被 SOLD_OUT / RATE」已过期。
  const canRerollThis = card.rerolled !== true;
  const reroll = onReroll ? html`<button type="button" class="zjcard__reroll" data-testid=${`jibian-reroll-${card.idx}`}
      disabled=${!canRerollThis || !(rerollLeft > 0) || rerollBusy != null}
      title=${`${t('重抽')} ${rerollLeft > 0 ? rerollLeft : 0}`} aria-label=${`${t('重抽')} ${rerollLeft > 0 ? rerollLeft : 0}`}
      onClick=${(e) => { e.stopPropagation(); if (canRerollThis && rerollLeft > 0 && rerollBusy == null) onReroll(card.idx); }}>
    <${Icon} name="refresh" /><span class="zjcard__rerolltext">${t('重抽')}</span><b class="num">${rerollLeft > 0 ? rerollLeft : 0}</b>
  </button>` : null;
  return html`<div class="zjcardwrap">
    <button type="button" class=${cx('zjcard', can && 'is-pickable', armed && 'is-armed', busy && 'is-busy')} data-rarity=${rarity}
        disabled=${!can} aria-busy=${busy ? 'true' : undefined} aria-pressed=${can ? String(armed) : undefined}
        data-testid=${`jibian-card-${card.idx}`}
        aria-label=${armed ? t('{name}，已选中，再次点击确认', { name }) : `${name}（${t(RARITY_NAMES[rarity])}）`}
        title=${[name, card.desc || '', ...bonds.map((b) => tName(b.name))].filter(Boolean).join('\n')}
        onClick=${() => { if (can) onTap(card.idx); }}>
      <span class="zjcard__top">
        <span class=${cx('zjcard__icon', art.whiteGlyph && 'is-white-glyph')}>
          <${Img} src=${art.icon} fallback=${html`<${GIcon} name="bolt" />`} />
        </span>
        <span class="zjcard__titles">
          <b class="zjcard__name">${name}</b>
          <span class="zjcard__rarity">${t(RARITY_NAMES[rarity])}</span>
        </span>
      </span>
      <${RichText} text=${card.desc || ''} class="zjcard__desc" />
      <${JibianBondBlocks} card=${card} idx=${card.idx} />
      ${hints.length ? html`<span class="zjcard__bonds">${hints.map((h) => html`<span key=${h.text} class=${cx('zjcard__bond', h.on && 'is-on')}>${h.text}</span>`)}</span>` : null}
      ${card.flavor ? html`<span class="zjcard__flavor">${card.flavor}</span>` : null}
      ${armed ? html`<span class="zjcard__confirm" role="status"><b>${t('确认选择')}</b><small>${t('再次点击')}</small></span>` : null}
      ${busy ? html`<span class="zjcard__busy" role="status">${t('选择中')}</span>` : null}
    </button>
    ${reroll}
  </div>`;
}

/**
 * 惊变三选一：the 惊变 draft of an SP_DRAFT round, two taps like 机变 and 藏品 — the first tap selects the card (it lifts, the
 * head's 确认选择 lights up), the second tap on the same card or the 确认选择 button sends `onPick(idx)` → `g.choice`. A tap
 * elsewhere, another card, or Esc drops the selection. `sp` is `normalizeSp(m.public.sp)`; the overlay draws whatever the
 * server offers and never invents a pick.
 * @param {{ sp: any, myId: string, solo?: boolean, busyIdx?: number|null, onPick?: (idx: number) => void,
 *   rerollsLeft?: number, rerollBusy?: number|null, onReroll?: ((idx: number) => void)|null }} props
 */
export function JibianOverlay({ sp, myId, solo = false, busyIdx = null, onPick = () => {},
  rerollsLeft = 0, rerollBusy = null, onReroll = null }) {
  // 羁绊效果（modern_strongest / layers_fan 只在 jibianBonds.json 里）：等它到货再重画一次竖卡
  useData('jibianBonds');
  const [sel, setSel] = useState(null);
  const armed = armedCard(sel, sp, { myId, solo, busyIdx });
  // a selection whose card can no longer be picked (taken, the turn moved on, a pick in flight) is dropped
  useEffect(() => { if (sel != null && armed == null) setSel(null); }, [sel, armed]);
  useEffect(() => {
    if (armed == null) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') setSel(null); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [armed]);
  if (!sp || sp.family !== 'jibian' || !sp.cards.length) return null;
  const tap = (idx) => {
    const card = sp.cards.find((c) => c && c.idx === idx);
    const r = spTap(armed, idx, cardPickable(sp, card, { myId, solo, busyIdx }));
    setSel(r.armed);
    if (r.pick != null) onPick(r.pick);
  };
  return html`<${JibianDraftView} sp=${sp} myId=${myId} solo=${solo} busyIdx=${busyIdx} armed=${armed}
    rerollsLeft=${rerollsLeft} rerollBusy=${rerollBusy} onReroll=${onReroll}
    onTap=${tap} onConfirm=${() => { if (armed != null) tap(armed); }} onDisarm=${() => setSel(null)} />`;
}

/**
 * The draft's view (pure: no hooks — test/ui draws it as a function, the same split as ChoiceOverlay / ChoiceView).
 * `rerollsLeft` / `onReroll`: the 惊变 重抽 budget (`m.private.jibian.rerollsLeft`) — `onReroll` null hides the button
 * (no 重抽 protocol, see the header note), 0 disables it.
 * @param {{ sp: any, myId: string, solo?: boolean, busyIdx?: number|null, armed?: number|null,
 *   rerollsLeft?: number, rerollBusy?: number|null, onReroll?: ((idx: number) => void)|null,
 *   onTap?: (idx: number) => void, onConfirm?: () => void, onDisarm?: () => void }} props
 */
export function JibianDraftView({ sp, myId, solo = false, busyIdx = null, armed = null,
  rerollsLeft = 0, rerollBusy = null, onReroll = null,
  onTap = () => {}, onConfirm = () => {}, onDisarm = () => {} }) {
  ensureCss();
  if (!sp || sp.family !== 'jibian' || !sp.cards.length) return null;
  const myTurn = solo || sp.turnPid === myId;
  const mine = sp.pickOf.get(myId);
  const timed = !solo && !sp.untimed;
  const armedCardRec = armed != null ? sp.cards.find((c) => c && c.idx === armed) : null;
  const armedName = armedCardRec ? (tName(armedCardRec.name) || t('惊变')) : null;
  // a press anywhere but a card or the confirm button drops the selection
  const onDown = (e) => {
    if (armed == null) return;
    const node = e.target;
    if (node && typeof node.closest === 'function' && node.closest('.zjcard, .zjov__confirm')) return;
    onDisarm();
  };
  return html`<div class=${cx('zjov', armed != null && 'has-armed')} role="dialog" aria-modal="true" aria-label=${t('惊变阶段')}
      data-testid="jibian-overlay" onPointerDown=${onDown}>
    <div class="zjov__veil" aria-hidden="true"></div>
    <div class="zjov__inner">
      <header class="zjov__head">
        <span class="zjov__micro">BLAST // MUTATION</span>
        <h2 class="zjov__title">${t('惊变阶段')}</h2>
        <p class="zjov__sub">${timed ? t('倒计时结束后仍未选定将自动分配') : t('选择一项（无时间限制）')}${mine == null && myTurn ? t(' · 点击卡牌选中，再次点击确认') : ''}</p>
        <div class="zjov__turn">
          ${armed != null ? html`<${Button} variant="primary" size="lg" icon="check" class="zjov__confirm" data-testid="jibian-confirm"
              title=${armedName ? t('确认选择「{armedName}」（再次点击卡牌亦可）', { armedName }) : t('确认选择')} onClick=${onConfirm}>${t('确认选择')}<//>`
          : html`<span class=${cx('zjov__state', myTurn && mine == null && 'is-mine')}>
              ${mine != null ? html`<${Icon} name="check" />${t('已完成选择')}`
                : myTurn ? html`<${Icon} name="hourglass" />${t('当前轮到你决策')}`
                : html`<${Icon} name="dots" />${t('正在决策…')}`}
            </span>`}
        </div>
      </header>
      <div class=${cx('zjov__grid', sp.cards.length <= 3 && 'zjov__grid--3')}>
        ${sp.cards.map((card) => {
          const can = cardPickable(sp, card, { myId, solo, busyIdx });
          // 重抽 only where it can do something: my turn, nothing picked yet, this card still on the table. An exhausted
          // budget (0 left) keeps the button and disables it — the count is information the player is owed.
          const mayReroll = !!onReroll && myTurn && mine == null && !card.takenBy;
          return html`<${JibianCard} key=${card.idx} card=${card} can=${can} armed=${can && armed === card.idx}
            busy=${pickBusy(busyIdx, card, mine)} onTap=${onTap}
            rerollLeft=${mayReroll ? rerollsLeft : 0} rerollBusy=${rerollBusy}
            onReroll=${mayReroll ? onReroll : null} />`;
        })}
      </div>
    </div>
  </div>`;
}

/**
 * A watched teammate's 惊变, derived from **the effects column we already receive** (`field.effects` when watching someone:
 * game.js passes the same source the effects column uses, exactly as the reference build does — no second data channel).
 * A picked 惊变 is an effect ref whose id is `<cardId>#<uid>` (choices.js addRef: key `jibian:<cardId>`), so the card id is
 * the part before `#`, and every 惊变 card id starts with `jibian_`. Rarity / flavour / bond come from the mode's own pool
 * (config), which the watcher can read without the other seat's private state.
 * The 羁绊 page's progress still needs a seat's `owned` set, which no watch channel carries — that page shows the viewer's
 * own progress ([ASSUMED], engine-core 2026-10-28: 观战别人的羁绊进度没有通道，本轮不做).
 * @param {any[]} effects m.field.effects (the watched seat's effects column)
 * @param {string|null} modeId the room's mode (for the pool lookup)
 * @returns {{ cards: any[], owned: string[], rerollsLeft: number, watched: true }}
 */
export function jibianFromEffects(effects, modeId = null) {
  const pool = new Map();
  for (const rec of jibianPoolOf(modeId)) {
    const id = rec.effectId || rec.id || rec.key;
    if (typeof id === 'string') pool.set(id, rec);
  }
  const cards = [];
  for (const e of Array.isArray(effects) ? effects : []) {
    if (!isJibianRef(e)) continue;                     // not a 惊变 ref (a strategy / bounty / item effect)
    const cardId = e.id.split('#')[0];
    if (cards.some((c) => c.id === cardId)) continue;  // a re-picked card stacks server-side; the panel lists it once
    const rec = pool.get(cardId) || null;
    cards.push({
      id: cardId, key: `jibian:${cardId}`,
      name: e.name || (rec && rec.name) || cardId,
      desc: e.desc || (rec && rec.desc) || '',
      rarity: (rec && rec.rarity) || null,
      flavor: (rec && rec.flavor) || null,
      ...(rec && rec.bond ? { bond: rec.bond } : null),
      ...(rec && rec.iconBond ? { iconBond: rec.iconBond } : null),
    });
  }
  return { cards, owned: cards.map((c) => c.id), rerollsLeft: 0, watched: true };
}

// (业主 2026-10-29: 「已选惊变」/「惊变一览」不再是右上角的两枚 .zjbtn 角标 —— 它们与锻造器合并成顶栏左上那一颗
//  「模式工具」按钮（ui/hud.js ModeToolsButton）。局内这一层只有「已选惊变 / 敌方惊变 / 惊变羁绊」单行三页签
//  （JibianPanelView / JibianTabs）；「惊变一览」已经搬去局外，JibianCodex / JibianCodexView 的导出保留给局外页面用。)

/** id → name for every 惊变 card of the mode's pools (the 羁绊 page lists its members by name, not by id). */
function jibianNameMap() {
  const out = new Map();
  const modes = data.get('config')?.modes || {};
  for (const m of Object.values(modes)) {
    const pool = Array.isArray(m?.jibian?.pool) ? m.jibian.pool : [];
    for (const card of pool) {
      const id = card && (card.effectId || card.id || card.key);
      if (typeof id === 'string' && card.name && !out.has(id)) out.set(id, card.name);
    }
  }
  return out;
}

/**
 * One 惊变 of the two selected lists (我方 / 敌方) — **a horizontal row**, not the draft's vertical card
 * (业主 2026-10-29：「已选惊变的显示逻辑是横行而不是选择时的竖排卡片」)。
 *
 * One row = 左图 | 名字 + 稀有度 + 已选/敌方标记 ‖ 描述 · 所属惊变羁绊（名 + tiers 同行）。
 * 描述与羁绊**就地截断**（单行/两行省略号），整段文案（名称 / 稀有度 / 描述 / flavor / 每条羁绊的名 + tiers +
 * effect 全文）都挂在整行的 `title` 上 —— 行高不随文案长，面板正文自己竖向滚。敌方的 id 不在羁绊表里，自然没有
 * 羁绊块（同三选一卡，绝不编）。
 * @param {{ card: any, enemy?: boolean }} props
 */
function SelectedCard({ card, enemy = false }) {
  const rarity = jibianRarity(card);
  const art = resolveJibianArt(data.get('assets'), card);
  const name = tName(card.name) || t('惊变');
  const desc = typeof card.desc === 'string' ? card.desc : '';
  const bonds = jibianCardBonds(card);
  // 横行里被省略号截掉的全文：整行 title，逐字来自卡片与 data/jibianBonds.json
  const full = [
    `${name}（${t(RARITY_NAMES[rarity])}）${enemy ? ` · ${t('敌方惊变')}` : ''}`,
    desc,
    card.flavor ? `「${card.flavor}」` : '',
    ...bonds.map((b) => `${t('惊变羁绊')} · ${tName(b.name)}${b.tiers.length ? `（${b.tiers.join(' / ')}）` : ''}${b.effect ? `\n${b.effect}` : ''}`),
  ].filter(Boolean).join('\n');
  return html`<div class=${cx('zjsel', enemy && 'zjsel--enemy')} data-rarity=${rarity} title=${full}
      data-testid=${enemy ? 'jibian-row-enemy' : 'jibian-row-mine'}>
    <span class=${cx('zjsel__icon', card.iconBond && 'is-white-glyph')}><${Img} src=${art.icon} fallback=${html`<${GIcon} name="bolt" />`} /></span>
    <div class="zjsel__main">
      <span class="zjsel__head">
        <b class="zjsel__name" title=${name}>${name}</b>
        <span class="zjsel__rarity">${t(RARITY_NAMES[rarity])}</span>
        ${enemy
          ? html`<span class="zjsel__mark zjsel__mark--enemy"><${Icon} name="eye" />${t('敌方惊变')}</span>`
          : html`<span class="zjsel__mark"><${Icon} name="check" />${t('已选')}</span>`}
      </span>
      ${desc || bonds.length ? html`<span class=${cx('zjsel__meta', bonds.length && 'zjsel__meta--bonds')}>
        ${desc ? html`<span class="zjsel__desc" title=${desc}>${desc}</span>` : null}
        ${bonds.length ? html`<span class="zjsel__bonds" data-bonds=${bonds.map((b) => b.id).join(' ')}>
          ${bonds.map((b) => html`<span class="zjsel__bond" key=${b.id} data-bond=${b.id} title=${b.effect || tName(b.name)}>
            <b class="zjsel__bondname">${tName(b.name)}</b>
            ${b.tiers.length ? html`<span class="zjsel__bondtiers num">${b.tiers.join(' / ')}</span>` : null}
          </span>`)}
        </span>` : null}
      </span>` : null}
    </div>
  </div>`;
}

/** 羁绊 page: every 惊变羁绊 with the viewer's own progress (owned / 阈值), from /data/jibianBonds.json (data store). */
function BondTab({ owned }) {
  useData('jibianBonds');
  const bonds = jibianBondTable();
  if (!bonds.length) return html`<p class="zjpanel__none">${t('没有羁绊数据')}</p>`;
  const names = jibianNameMap();
  const rows = bonds.map((b) => {
    const members = Array.isArray(b.members) ? b.members : [];
    const tiers = Array.isArray(b.tiers) && b.tiers.length ? b.tiers : [2];
    const have = members.filter((id) => owned.has(id)).length;
    return { b, members, tiers, have, active: have >= tiers[0], full: tiers.length > 1 && have >= tiers[1] };
  }).sort((x, y) => (Number(y.active) - Number(x.active)) || (y.have - x.have));
  return html`<div class="zjpanel__bonds">
    ${rows.map(({ b, members, tiers, have, active, full }) => html`<div key=${b.id} class=${cx('zjbon', active && 'is-on', full && 'is-full')}>
      <div class="zjbon__top">
        <b class="zjbon__name">${b.name}</b>
        <span class=${cx('zjbon__num', have > 0 && 'is-on', full && 'is-full')}>${have}/${tiers[0]}</span>
        ${tiers.length > 1 ? html`<span class=${cx('zjbon__num zjbon__num--t2', full && 'is-full')}>${tiers[1]}</span>` : null}
      </div>
      <i class="zjbon__bar" style=${`width:${Math.min(100, Math.round((have / Math.max(1, tiers[0])) * 100))}%`}></i>
      ${b.effect ? html`<span class="zjbon__effect">${b.effect}</span>` : null}
      <span class="zjbon__members">${members.map((id) => html`<span key=${id} class=${cx('zjbon__mem', owned.has(id) && 'is-on')}>${names.get(id) || id}</span>`)}</span>
    </div>`)}
  </div>`;
}

/**
 * 已选惊变：**单层三页签** —— 已选惊变（我方卡）/ 敌方惊变 / 惊变羁绊（业主 2026-10-29：局内不再有「惊变一览」页，
 * 一览搬去局外；这里只有这一行页签，不再套第二层）。观战队友时「我方」那一页换成「TA 的惊变」。
 * The panel is the hook-free view + a thin state holder (`tab`), the same split as ChoiceOverlay / ChoiceView: a test can
 * draw any page without a renderer.
 * @param {{ jibian: any, enemy?: any, onClose?: () => void, watchingName?: string|null }} props
 *   jibian: m.private.jibian (or the watched seat's) ; enemy: m.public.enemyJibian
 */
export function JibianPanel({ jibian, enemy = null, onClose = () => {}, watchingName = null }) {
  // 卡面的「惊变羁绊」补充要在表到货后重画一次
  useData('jibianBonds');
  const [tab, setTab] = useState('mine');
  return html`<${JibianPanelView} tab=${tab} onTab=${setTab} jibian=${jibian} enemy=${enemy} onClose=${onClose}
    watchingName=${watchingName} />`;
}

/**
 * The panel's view (pure: BondTab is the only hook-using child, and only the 羁绊 page draws it).
 * @param {{ tab?: 'mine'|'enemy'|'bond', onTab?: (id: string) => void, jibian: any, enemy?: any,
 *   onClose?: () => void, watchingName?: string|null, bare?: boolean }} props
 */
export function JibianPanelView({ tab = 'mine', onTab = () => {}, jibian, enemy = null, onClose = () => {}, watchingName = null, bare = false }) {
  ensureCss();
  const mine = Array.isArray(jibian?.cards) ? jibian.cards.filter(Boolean) : [];
  const enemyCards = Array.isArray(enemy?.cards) ? enemy.cards.filter(Boolean) : [];
  const owned = new Set(Array.isArray(jibian?.owned) ? jibian.owned : []);
  const tabs = [
    // 观战队友时「我方」那一页换成「TA 的惊变」（面板里显示的是被观战者的惊变，自己的 private 不动）；首标签复用既有键
    // t('已选惊变')（业主 2026-10-29：不要新增 i18n 里没有的「我方已选」之类）
    { id: 'mine', text: watchingName ? t('TA 的惊变') : t('已选惊变'), n: mine.length },
    { id: 'enemy', text: t('敌方惊变'), n: enemyCards.length },
    { id: 'bond', text: t('惊变羁绊'), n: null },
  ];
  const tablist = html`<div class="zjpanel__tabs" role="tablist">
        ${tabs.map((x) => html`<button type="button" key=${x.id} role="tab" aria-selected=${tab === x.id ? 'true' : 'false'}
            class=${cx('zjpanel__tab', tab === x.id && 'is-on')} data-testid=${`jibian-tab-${x.id}`}
            onClick=${() => onTab(x.id)}>${x.text}${x.n == null ? null : html`<b class="num">${x.n}</b>`}</button>`)}
      </div>`;
  // 两页列表都是**横行**（业主 2026-10-29）：一行一张惊变，.zjpanel__grid 是竖排容器（一行一张、面板正文自己竖滚），
  // 敌方的一行前面多一列「R1 / R6」轮次徽标。三选一浮层（.zjov / JibianCard）仍是竖版卡，两套版式不共用。
  const body = html`<div class="zjpanel__body">
        ${tab === 'mine' ? (mine.length
          ? html`<div class="zjpanel__grid" data-testid="jibian-mine">${mine.map((c, i) => html`<${SelectedCard} key=${c.key || c.id || i} card=${c} />`)}</div>`
          : html`<p class="zjpanel__none" data-testid="jibian-mine-empty">${t('还没有选过惊变')}</p>`)
        : tab === 'enemy' ? (enemyCards.length
          ? html`<div class="zjpanel__grid" data-testid="jibian-enemy">
              ${enemyCards.map((c, i) => html`<div key=${c.id || i} class="zjpanel__cell">
                <span class="zjpanel__round num">R${c.round}</span>
                <${SelectedCard} card=${c} enemy=${true} />
              </div>`)}
            </div>`
          : html`<p class="zjpanel__none" data-testid="jibian-enemy-empty">${t('本局没有敌方惊变')}</p>`)
        : html`<${BondTab} owned=${owned} />`}
      </div>`;
  // bare: the tabs + the page only — the HUD's 模式工具 panel (ui/hud.js ModeToolsPanelView) draws the .zjpanel shell
  if (bare) return html`<div class="zjtools__sub" data-testid="jibian-panel">${tablist}${body}</div>`;
  // 标题与首标签原来同一句话（t('已选惊变')），抬头重复一遍页签的字；业主 2026-10-29 只指定了标签，抬头改用它已经
  // 覆盖三页的 t('惊变')（既有键，不新增 msgid）。aria-label 跟着抬头走。
  return html`<div class="zjpanel" role="dialog" aria-modal="false" aria-label=${t('惊变')} data-testid="jibian-panel">
    <div class="zjpanel__scrim" onClick=${onClose}></div>
    <div class="zjpanel__box">
      <header class="zjpanel__head">
        <span class="zjpanel__micro">BLAST // MUTATIONS</span>
        <b class="zjpanel__title">${t('惊变')}</b>
        ${watchingName ? html`<span class="zjpanel__who"><${GIcon} name="eye" />${watchingName}</span>` : null}
        <button type="button" class="zjpanel__x" aria-label=${t('关闭')} title=${t('关闭')} onClick=${onClose}><${Icon} name="close" /></button>
      </header>
      ${tablist}${body}
    </div>
  </div>`;
}

/**
 * 已选惊变的**单层三页签**（状态在组件里），给局内 HUD 当一页内容用（`bare`：页签 + 页面，壳由调用方画）。
 * 「惊变一览」不在这一层（业主 2026-10-29：一览搬去局外）；JibianCodex / JibianCodexView 仍然导出，但局内不再挂。
 * @param {{ jibian: any, enemy?: any, watchingName?: string|null }} props
 */
export function JibianTabs({ jibian, enemy = null, watchingName = null }) {
  useData('jibianBonds');
  const [tab, setTab] = useState('mine');
  return html`<${JibianPanelView} bare=${true} tab=${tab} onTab=${setTab} jibian=${jibian} enemy=${enemy}
    watchingName=${watchingName} />`;
}

// ---- 敌方惊变揭晓（规则14：R1 / R6 各抽一张，全场共享） ------------------------------------------------
//
// 数据：`m.public.enemyJibian { round, rarity, card, cards, pool, flickerMs, resultMs }`（engine-core，2026-10-28）。
// `card` 是**刚抽到的那张**（`cards` 是整局累计，已选惊变面板的敌方页读它）。时序照服务端给的毫秒数：先 `flickerMs`
// 翻牌（轮播 pool 里的卡面，**不含刚抽到的这张** —— 不提前泄露），再 `resultMs` 定格；点一下 / 空格 / Esc 跳下一步。
// 减动效（prefers-reduced-motion）**没有翻牌**：直接出结果并停 `resultMs`（信息照给，只是不动），`data-reduced` 可断言。

/** The flicker's rotation: the mode's own pool, minus the card that was just drawn (no early leak). */
export function flickerPool(enemy) {
  const drawn = enemy && enemy.card ? enemy.card.id : null;
  return (Array.isArray(enemy && enemy.pool) ? enemy.pool : []).filter((c) => c && c.id && c.name && c.id !== drawn);
}

/**
 * The reveal's view (pure: `stage` is the state machine's, so a test can draw any frame).
 * @param {{ enemy: any, stage?: 'flicker'|'result', slot?: number, reduced?: boolean, onSkip?: () => void }} props
 */
export function EnemyJibianRevealView({ enemy, stage = 'result', slot = 0, reduced = false, onSkip = () => {} }) {
  ensureCss();
  if (!enemy) return null;
  const card = enemy.card || null;
  const pool = flickerPool(enemy);
  const spinning = !!card && stage === 'flicker' && !reduced && pool.length > 0;
  const at = spinning ? pool[((slot % pool.length) + pool.length) % pool.length] : null;
  const name = spinning ? at.name : (card ? (tName(card.name) || t('惊变')) : null);
  const rarity = spinning ? jibianRarity(at) : jibianRarity(card);
  const art = spinning ? resolveJibianArt(data.get('assets'), at) : (card ? resolveJibianArt(data.get('assets'), card) : null);
  const round = enemy.round;
  const onKey = (e) => { if (e.key === ' ' || e.key === 'Escape' || e.key === 'Enter') { e.preventDefault(); onSkip(); } };
  return html`<div class=${cx('zjrev', spinning && 'is-spinning')} role="dialog" aria-modal="true" aria-label=${t('敌方惊变')}
      data-testid="jibian-reveal" data-stage=${card ? (spinning ? 'flicker' : 'result') : 'drawing'} data-reduced=${reduced ? 'true' : 'false'}
      data-round=${Number.isInteger(round) ? round : null} tabindex="0" onKeyDown=${onKey} onClick=${onSkip}>
    <div class="zjrev__veil" aria-hidden="true"></div>
    <div class="zjrev__box">
      <span class="zjrev__micro">BLAST // HOSTILE MUTATION</span>
      <b class="zjrev__round num">${Number.isInteger(round) ? `R${round}` : ''}</b>
      <span class="zjrev__title">${t('敌方惊变')}</span>
      ${card ? html`<div class=${cx('zjrev__card', spinning && 'is-spinning')} data-rarity=${rarity}>
        <span class="zjrev__icon"><${Img} src=${art ? art.icon : null} fallback=${html`<${GIcon} name="bolt" />`} /></span>
        <b class="zjrev__name">${name}</b>
        ${spinning ? null : html`<span class="zjrev__rarity">${t(RARITY_NAMES[rarity])}</span>`}
        ${spinning ? null : html`<${RichText} text=${card.desc || ''} class="zjrev__desc" />`}
        ${spinning || !card.flavor ? null : html`<span class="zjrev__flavor">${card.flavor}</span>`}
      </div>` : html`<div class="zjrev__wait" data-testid="jibian-reveal-wait"><${Spinner} label="DRAWING" /></div>`}
      ${card ? html`<button type="button" class="zjrev__skip" data-testid="jibian-skip"
        onClick=${(e) => { e.stopPropagation(); onSkip(); }}>${t('跳过')}</button>` : null}
    </div>
  </div>`;
}

/**
 * The reveal: flicker for `flickerMs`, then hold the card for `resultMs`, then close. A click / Space / Esc skips a step.
 * With prefers-reduced-motion there is no flicker at all — the result shows at once and holds for `resultMs`
 * (`reduced` is a prop so a test can force either branch).
 * @param {{ enemy: any, reduced?: boolean|null, onClose?: () => void }} props
 */
export function EnemyJibianReveal({ enemy, reduced = null, onClose = () => {} }) {
  const isReduced = reduced == null ? (typeof window !== 'undefined' && reducedMotion()) : reduced === true;
  const [stage, setStage] = useState(isReduced ? 'result' : 'flicker');
  const [slot, setSlot] = useState(0);
  const closedRef = useRef(false);
  const close = () => { if (closedRef.current) return; closedRef.current = true; onClose(); };
  const flickerMs = Math.max(0, Number(enemy && enemy.flickerMs) || 0);
  const resultMs = Math.max(0, Number(enemy && enemy.resultMs) || 0);
  // the roulette: a new face every 90 ms while the flicker lasts (CSS does the blur; this only advances the name)
  useEffect(() => {
    if (stage !== 'flicker' || isReduced) return undefined;
    const id = setInterval(() => setSlot((n) => n + 1), 90);
    return () => clearInterval(id);
  }, [stage, isReduced]);
  useEffect(() => {
    if (stage !== 'flicker') return undefined;
    if (isReduced) { setStage('result'); return undefined; }
    const t = setTimeout(() => setStage('result'), flickerMs);
    return () => clearTimeout(t);
  }, [stage, isReduced, flickerMs]);
  useEffect(() => {
    if (stage !== 'result') return undefined;
    const t = setTimeout(close, resultMs);
    return () => clearTimeout(t);
  }, [stage, resultMs]);
  const skip = () => { if (stage === 'flicker') setStage('result'); else close(); };
  // Space / Esc / Enter skip without needing focus (a modal that only answers when tabbed into would read as frozen);
  // the view keeps its own onKeyDown for the focused case.
  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const onKey = (e) => {
      if (e.key !== ' ' && e.key !== 'Escape' && e.key !== 'Enter') return;
      e.preventDefault();
      skip();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [stage]);
  return html`<${EnemyJibianRevealView} enemy=${enemy} stage=${stage} slot=${slot} reduced=${isReduced} onSkip=${skip} />`;
}

// ---- 惊变一览（本模式全部 99 张，按稀有度分组，已拥有打勾） --------------------------------------------
//
// 数据只从本仓地读取：`config.modes[modeId].jibian.pool`（我方牌库）+ `m.private.jibian.owned`（自己已有的 id）。
// 不去 fetch 玩法包自己的任何数据；面板是纯只读视图，开关它不碰对局状态（不改 ready、不发任何 g.*）。

/** The mode's own 惊变 pool (config), [] when the config has no such mode. */
export function jibianPoolOf(modeId, cfg = data.get('config')) {
  const mode = cfg && cfg.modes ? cfg.modes[modeId] : null;
  const pool = mode && mode.jibian && Array.isArray(mode.jibian.pool) ? mode.jibian.pool : [];
  return pool.filter((c) => c && (c.effectId || c.id || c.key));
}

/** The pool grouped by rarity, in the five-tier order; each group keeps the pool's own order. */
export function jibianPoolGroups(pool) {
  const groups = JIBIAN_RARITIES.map((r) => ({ rarity: r, name: RARITY_NAMES[r], cards: [] }));
  const byRarity = new Map(groups.map((g) => [g.rarity, g]));
  for (const card of Array.isArray(pool) ? pool : []) {
    if (!card) continue;
    const g = byRarity.get(jibianRarity(card)) || byRarity.get('normal');
    g.cards.push(card);
  }
  return groups.filter((g) => g.cards.length > 0);
}

/**
 * 惊变一览: every 惊变 card of this mode, grouped by rarity, the ones the viewer owns ticked.
 * 局内不再挂这一页（业主 2026-10-29：一览搬去局外，局内只有单层三页签）；导出保留给局外页面用。
 * `bare`: only the groups — the caller draws the .zjpanel shell.
 * @param {{ pool?: any[], owned?: string[]|Set<string>, onClose?: () => void, bare?: boolean }} props
 */
export function JibianCodexView({ pool = [], owned = [], onClose = () => {}, bare = false }) {
  ensureCss();
  const own = owned instanceof Set ? owned : new Set(Array.isArray(owned) ? owned : []);
  const groups = jibianPoolGroups(pool);
  const idOf = (c) => c.effectId || c.id || c.key;
  const list = html`<div class="zjpanel__body">
        ${groups.length ? groups.map((g) => html`<section class="zjcodex__group" key=${g.rarity} data-rarity=${g.rarity}
            data-testid=${`jibian-codex-${g.rarity}`}>
          <div class="zjcodex__ghead">
            <span class="zjcodex__gname">${t(g.name)}</span>
            <b class="zjcodex__gnum num" data-testid=${`jibian-codex-count-${g.rarity}`}>${g.cards.length}</b>
          </div>
          <ul class="zjcodex__list">
            ${g.cards.map((c) => html`<li key=${idOf(c)} class=${cx('zjcodex__row', own.has(idOf(c)) && 'is-owned')}
                data-testid=${`jibian-codex-card-${idOf(c)}`} title=${c.desc || c.name || ''}>
              <span class="zjcodex__box" aria-hidden="true">${own.has(idOf(c)) ? html`<${Icon} name="check" />` : null}</span>
              <span class="zjcodex__name">${tName(c.name) || t('惊变')}</span>
              ${own.has(idOf(c)) ? html`<span class="sr-only">${t('已选')}</span>` : null}
            </li>`)}
          </ul>
        </section>`)
        : html`<p class="zjpanel__none">${t('加载中')}</p>`}
      </div>`;
  if (bare) return html`<div class="zjcodex zjtools__sub" data-testid="jibian-codex">${list}</div>`;
  return html`<div class="zjpanel zjcodex" role="dialog" aria-modal="false" aria-label=${t('惊变一览')} data-testid="jibian-codex">
    <div class="zjpanel__scrim" onClick=${onClose}></div>
    <div class="zjpanel__box">
      <header class="zjpanel__head">
        <span class="zjpanel__micro">BLAST // ALL MUTATIONS</span>
        <b class="zjpanel__title">${t('惊变一览')}</b>
        <span class="zjcodex__total num">${own.size}</span>
        <button type="button" class="zjpanel__x" aria-label=${t('关闭')} title=${t('关闭')} onClick=${onClose}><${Icon} name="close" /></button>
      </header>
      ${list}
    </div>
  </div>`;
}

/** 惊变一览's wrapper: resolves the pool from the room's mode id and draws the view. */
export function JibianCodex({ modeId = null, owned = [], onClose = () => {} }) {
  return html`<${JibianCodexView} pool=${jibianPoolOf(modeId)} owned=${owned} onClose=${onClose} />`;
}

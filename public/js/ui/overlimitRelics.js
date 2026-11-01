// public/js/ui/overlimitRelics.js — 超限模拟「词条」（饰品）的三选一浮层（业主 2026-10-31）。
//
// 它**复用炸惊惊变那一套版式**：`.zjov` / `.zjov__*` / `.zjcard` / `.zjcard__*` 全部来自 css/screens/jibian.css，
// 尺寸单位仍是那一族的 `--zj-u`（= min(1rem, 100svh/10.8)），所以局内 / 局外、手机与桌面的观感与惊变三选一逐像素同级。
// 本文件只补三件小事（样式在 css/screens/overlimitRelics.css）：
//   · 抬头 .zjov__micro 换成 OVERLIMIT // RELIC（文案是技术眉题，不是 i18n 词条）；
//   · 每张卡的左上小字是**词条编号**（LC-001 / FGO-Ⅹ…，数据，不翻译）；
//   · 效果还没实装的卡（`impl: 'pending'`：第一批 36 条全部如此；第二批实装 A 类 29 条后只剩 B 类 7 条）右上角一枚极小的角标。
//
// 数据：`m.public.sp = { family: 'overlimit', relicKind, round, cards: [{ idx, kind: 'overlimit', id, name, desc,
// flavor, group, impl, effectColor, icon }], order, turn, picks, taken, untimed }`（server/match/match/relicDraft.js）。
// 选卡走既有 `g.choice { idx }`（ui/gameActions.js choice），两段式点击与机变 / 惊变 / 藏品一致：
// 第一次点只把卡置为「已选」（高亮 + 确认键亮起），再点同一张卡或点「确认选择」才发 g.choice；点别处 / Esc 取消。
// 没有重抽（业主定稿：选到的结果不重掷、不提供 reroll），所以这里也不画重抽按钮。
//
// **已选饰品面板**（业主 2026-10-31 追加，同日改名）：局内左下角一颗「已选饰品」独立键（ui/hud.js RelicHudButton）+ 点开的面板
// （本文件 OverlimitRelicPanel）—— 做法照抄炸惊的「已选惊变」：按钮与设置 / 对话 / 惊变同一行、同一尺寸（.gm__gear），
// 面板直接套 jibian.css 的 .zjpanel 壳与 .zjsel 横行。**只在超限局出现**：认 `m.private.relicsOverlimit`（服务端只对
// `Match.isInfinite` 下发，见下）。
import { useEffect, useRef, useState } from '../../vendor/hooks.module.js';
import { html, Button, Icon } from './components.js';
import { Img, GIcon, RichText } from './gameComponents.js';
import { cardPickable, pickBusy, spTap, armedCard } from './choiceOverlay.js';
import { ensureJibianCss } from './jibian.js';
import { data, useData } from '../data.js';
import { t } from '../../../shared/i18n.js';

const cx = (...p) => p.flat().filter(Boolean).join(' ');

let cssLoaded = false;
/**
 * The relic overlay's stylesheetS, loaded on first draw — **two of them, in this order**:
 *   1. `css/screens/jibian.css` — every `.zjov` / `.zjcard` rule and the `--zj-u` scale live there. 复用 ui/jibian.js
 *      的 `ensureCss()`（导出名 `ensureJibianCss`），不复制第二份 loader。
 *   2. `css/screens/overlimitRelics.css` — this file's few overrides on top of it.
 * 冷启动路径（超限局里第一次遇到词条三选一、此前从没开过炸惊）正是漏了第 1 步：jibian.css 是按需加载的，
 * 只有 JibianDraftView / JibianPanel / EnemyJibianRevealView 画过才会进 DOM，于是浮层裸奔（220px 高、
 * 三张 33px 横条）。开过一次炸惊再回大厅就「自己好了」——所以这是加载顺序问题，不是版式问题。
 */
export function ensureRelicCss() {
  if (cssLoaded || typeof document === 'undefined') return;
  cssLoaded = true;
  ensureJibianCss();
  if (document.querySelector('link[data-overlimit-relics]')) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = '/css/screens/overlimitRelics.css';
  link.dataset.overlimitRelics = '1';
  document.head.appendChild(link);
}

/**
 * 「未实装」角标用哪句文案：**必须是既有 msgid**（业主纪律：新增 i18n 字面量要先报）。
 * 现在借用 `t('暂不可用')`（既有键，四语都有）；等业主批下「未实装」这个字面量后，改这一处 + 补 public/i18n/*.json 即可。
 */
const pendingLabel = () => t('暂不可用');

/**
 * 一张词条卡。`armed` = 两段式选择的当前卡（抬起 + 显示「确认选择 · 再次点击」）。
 * @param {{ card: any, can: boolean, busy?: boolean, armed?: boolean, onTap?: (idx: number) => void }} props
 */
function RelicCard({ card, can, busy = false, armed = false, onTap = () => {} }) {
  const name = card.name || card.id || t('词条');
  const pending = card.impl === 'pending';
  // 图标是数据字段 `card.icon`（`/assets/relics/overlimit/<词条编号>.png`，业主表里 DISPIMG 嵌入图解出来的那 36 张）。
  // 没有路径、或 <img> 加载失败，都落回原来的占位符（Img 自带 onError → fallback），不新增任何文案 / DOM。
  // 负面词条（业主 2026-10-31 第二批）：`card.negative` 让这张卡带 `is-neg`（警示描边 / 编号色），档位（Ⅰ/Ⅱ/Ⅲ）是
  // 数据字段 `card.tierLabel`，画在编号旁边那枚小字上 —— 一个字节的新文案都没有。
  return html`<button type="button" class=${cx('zjcard', can && 'is-pickable', armed && 'is-armed', busy && 'is-busy', card.negative && 'is-neg')}
      data-group=${card.group || null} data-impl=${card.impl || null} data-negative=${card.negative ? 'true' : null} disabled=${!can}
      aria-busy=${busy ? 'true' : undefined} aria-pressed=${can ? String(armed) : undefined}
      data-testid=${`relic-card-${card.idx}`}
      aria-label=${armed ? t('{name}，已选中，再次点击确认', { name }) : name}
      title=${[name, card.desc || '', card.flavor ? `「${card.flavor}」` : ''].filter(Boolean).join('\n')}
      onClick=${() => { if (can) onTap(card.idx); }}>
    <span class="zjcard__top">
      <span class="zjcard__icon">
        <${Img} src=${card.icon || null} fallback=${html`<${GIcon} name="bolt" />`} />
      </span>
      <span class="zjcard__titles">
        <b class="zjcard__name">${name}</b>
        <span class="zjcard__rarity">${card.id || ''}</span>
        ${card.tierLabel ? html`<span class="zjcard__tier" data-testid=${`relic-tier-${card.idx}`}>${card.tierLabel}</span>` : null}
      </span>
      ${pending ? html`<span class="zjcard__pending" role="note" data-testid=${`relic-pending-${card.idx}`}>${pendingLabel()}</span>` : null}
    </span>
    <${RichText} text=${card.desc || ''} class="zjcard__desc" />
    ${card.flavor ? html`<span class="zjcard__flavor">${card.flavor}</span>` : null}
    ${armed ? html`<span class="zjcard__confirm" role="status"><b>${t('确认选择')}</b><small>${t('再次点击')}</small></span>` : null}
    ${busy ? html`<span class="zjcard__busy" role="status">${t('选择中')}</span>` : null}
  </button>`;
}

/**
 * 词条三选一：状态机（hooks）。`sp` 是 `normalizeSp(m.public.sp)`（family 'overlimit'）。
 * 除 family 之外与惊变浮层完全同一套交互：`spTap` / `armedCard` / `cardPickable` / `pickBusy` 全部复用
 * ui/choiceOverlay.js（不另写一套两段式点击）。
 * @param {{ sp: any, myId: string, solo?: boolean, busyIdx?: number|null, onPick?: (idx: number) => void }} props
 */
export function OverlimitRelicOverlay({ sp, myId, solo = false, busyIdx = null, onPick = () => {} }) {
  const [sel, setSel] = useState(null);
  const armed = armedCard(sel, sp, { myId, solo, busyIdx });
  useEffect(() => { if (sel != null && armed == null) setSel(null); }, [sel, armed]);
  useEffect(() => {
    if (armed == null) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') setSel(null); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [armed]);
  if (!sp || sp.family !== 'overlimit' || !sp.cards.length) return null;
  const tap = (idx) => {
    const card = sp.cards.find((c) => c && c.idx === idx);
    const r = spTap(armed, idx, cardPickable(sp, card, { myId, solo, busyIdx }));
    setSel(r.armed);
    if (r.pick != null) onPick(r.pick);
  };
  return html`<${OverlimitRelicDraftView} sp=${sp} myId=${myId} solo=${solo} busyIdx=${busyIdx} armed=${armed}
    onTap=${tap} onConfirm=${() => { if (armed != null) tap(armed); }} onDisarm=${() => setSel(null)} />`;
}

/**
 * 纯视图（无 hooks —— test/ui 直接把当函数画，与 JibianDraftView / ChoiceView 同一个拆分）。
 * 抬头标题用既有 msgid `t('词条抉择')`（超限 TRAIT_DRAFT 浮层也在用），副标题沿用 `t('选择一项（无时间限制）')`
 * 与 `t(' · 点击卡牌选中，再次点击确认')`，一个字节的新文案都没有。
 * @param {{ sp: any, myId: string, solo?: boolean, busyIdx?: number|null, armed?: number|null,
 *   onTap?: (idx: number) => void, onConfirm?: () => void, onDisarm?: () => void }} props
 */
export function OverlimitRelicDraftView({ sp, myId, solo = false, busyIdx = null, armed = null,
  onTap = () => {}, onConfirm = () => {}, onDisarm = () => {} }) {
  ensureRelicCss();
  if (!sp || sp.family !== 'overlimit' || !sp.cards.length) return null;
  const myTurn = solo || sp.turnPid === myId;
  const mine = sp.pickOf.get(myId);
  const timed = !solo && !sp.untimed;
  // 负面池的判据：`normalizeSp` 只保留 family / 名字 / 卡与轮次，所以 sp 级的 `negative` 可能被它摘掉 ——
  // 卡面自己带的 `card.negative`（服务端 negativeCardView）是第二道判据，两边任一成立就按负面浮层画。
  const negative = sp.negative === true || sp.cards.some((c) => c && c.negative === true);
  const armedCardRec = armed != null ? sp.cards.find((c) => c && c.idx === armed) : null;
  const armedName = armedCardRec ? (armedCardRec.name || armedCardRec.id || t('词条')) : null;
  // 点任意非卡片 / 非确认键的地方取消选中
  const onDown = (e) => {
    if (armed == null) return;
    const node = e.target;
    if (node && typeof node.closest === 'function' && node.closest('.zjcard, .zjov__confirm')) return;
    onDisarm();
  };
  return html`<div class=${cx('zjov', 'zjov--relic', negative && 'zjov--neg', armed != null && 'has-armed')} role="dialog" aria-modal="true"
      aria-label=${t('词条抉择')} data-testid="overlimit-relic-overlay" data-negative=${negative ? 'true' : null} onPointerDown=${onDown}>
    <div class="zjov__veil" aria-hidden="true"></div>
    <div class="zjov__inner">
      <header class="zjov__head">
        <span class="zjov__micro">${negative ? 'OVERLIMIT // NEGATIVE' : 'OVERLIMIT // RELIC'}</span>
        <h2 class="zjov__title">${t('词条抉择')}</h2>
        <p class="zjov__sub">${timed ? t('倒计时结束后仍未选定将自动分配') : t('选择一项（无时间限制）')}${mine == null && myTurn ? t(' · 点击卡牌选中，再次点击确认') : ''}</p>
        <div class="zjov__turn">
          ${armed != null ? html`<${Button} variant="primary" size="lg" icon="check" class="zjov__confirm" data-testid="overlimit-relic-confirm"
              title=${armedName ? t('确认选择「{armedName}」（再次点击卡牌亦可）', { armedName }) : t('确认选择')} onClick=${onConfirm}>${t('确认选择')}<//>`
          : html`<span class=${cx('zjov__state', myTurn && mine == null && 'is-mine')}>
              ${mine != null ? html`<${Icon} name="check" />${t('已完成选择')}`
                : myTurn ? html`<${Icon} name="hourglass" />${t('当前轮到你决策')}`
                : html`<${Icon} name="dots" />${t('正在决策…')}`}
            </span>`}
        </div>
      </header>
      <div class=${cx('zjov__grid', sp.cards.length <= 3 && 'zjov__grid--3')}>
        ${sp.cards.map((card) => html`<${RelicCard} key=${card.idx} card=${card}
          can=${cardPickable(sp, card, { myId, solo, busyIdx })} armed=${armed === card.idx}
          busy=${pickBusy(busyIdx, card, mine)} onTap=${onTap} />`)}
      </div>
    </div>
  </div>`;
}

/**
 * 词条表（data/relicsOverlimit.json，`{ entries: [...] }`）—— 表还没到货时是空数组。
 * 同一份表在局外 S.W.E.E.P. 的词条页（screens/sweep.js relicEntriesOf）也读；那边是整页图鉴，这里是局内面板，
 * 两边各自三行取值，不共用页面骨架（业主口径）。
 * @returns {any[]}
 */
function relicEntries() {
  const table = data.get('relicsOverlimit');
  return table && Array.isArray(table.entries) ? table.entries.filter((e) => e && typeof e.id === 'string') : [];
}

/**
 * 负面词条表（data/relicsOverlimitNegative.json，`{ entries: [...] }`，业主 2026-10-31 第二批）。
 * 面板把负面词条**列在同一块列表里**、用分组色（`neg`，警示红）区分 —— 业主未定，先按这个做。
 * @returns {any[]}
 */
function negativeEntries() {
  const table = data.get('relicsOverlimitNegative');
  return table && Array.isArray(table.entries) ? table.entries.filter((e) => e && typeof e.id === 'string') : [];
}

/**
 * HUD 用：本局已选词条的 id 列表 → 一整行要画的东西（`m.private.relicsOverlimit.picked` 只有 id；
 * 名字 / 分组 / 图标 / 效果全文在 data/relicsOverlimit.json）。
 * 顺序 = picked 的顺序（服务端按选取顺序记，见 server/match/match/relicDraft.js relicState），查不到的 id 原样回显，
 * 不编名字、不编分组（图标回落占位符，色条用 .zjsel 的默认色）。
 * @param {any[]} entries data/relicsOverlimit.json 的 entries
 * @param {string[]} picked id 列表
 * @returns {{ id: string, name: string, group: string, icon: string|null, desc: string }[]}
 */
export function pickedRelicRows(entries, picked) {
  const byId = new Map((Array.isArray(entries) ? entries : []).filter((e) => e && typeof e.id === 'string').map((e) => [e.id, e]));
  return (Array.isArray(picked) ? picked : []).map((id) => {
    const rec = byId.get(id);
    return {
      id,
      name: rec ? rec.name : id,
      group: rec ? rec.group : '',
      icon: (rec && typeof rec.icon === 'string' ? rec.icon : null),
      desc: (rec && typeof rec.desc === 'string' ? rec.desc : ''),
      tier: null,
    };
  });
}

/**
 * 本局已选的**负面**词条 → 面板要画的行（与 `pickedRelicRows` 同一形状，多一个档位标记）。
 * `negPicked` 是 `m.private.relicsOverlimit.negPicked`（`{ id, tier }[]`；服务端也可能给纯 id），
 * 分组永远是数据里的 `neg`（警示红）—— 查不到的 id 原样回显、分组留空，不编名字。
 * @param {any[]} entries data/relicsOverlimitNegative.json 的 entries
 * @param {({ id: string, tier?: number|null }|string)[]} negPicked
 * @returns {{ id: string, name: string, group: string, icon: string|null, desc: string, tier: string|null }[]}
 */
export function pickedNegativeRows(entries, negPicked) {
  const byId = new Map((Array.isArray(entries) ? entries : []).filter((e) => e && typeof e.id === 'string').map((e) => [e.id, e]));
  const list = Array.isArray(negPicked) ? negPicked : [];
  return list.map((it) => {
    const id = typeof it === 'string' ? it : (it && it.id);
    const tierIdx = typeof it === 'object' && it && Number.isInteger(it.tier) ? it.tier : null;
    const rec = byId.get(id);
    const tier = rec && Array.isArray(rec.tiers) && tierIdx != null && rec.tiers[tierIdx] ? rec.tiers[tierIdx].label : null;
    return {
      id,
      name: rec ? rec.name : id,
      group: rec ? rec.group : '',
      icon: (rec && typeof rec.icon === 'string' ? rec.icon : null),
      desc: (rec && typeof rec.desc === 'string' ? rec.desc : ''),
      tier,
    };
  }).filter((r) => typeof r.id === 'string' && r.id);
}

/**
 * 本局已选词条（`m.private.relicsOverlimit`，形状 `{ picked, negPicked, pool, negPool, nextAt, nextNegAt }`，
 * server/match/match/relicDraft.js）。
 * **只有超限局有这个键**：服务端在 server/match/player/views.js 用 `Match.isInfinite`
 * （= shared/infiniteMode.js 的 `isInfiniteMode(room.mode)`，即 `solo_infinite` / `coop_infinite`）门控它，
 * 普通 / 湮灭 / 炸惊的私有视图里没有 ⇒ screens/game.js 的「词条」键与面板只认这个键，其它模式一帧不变。
 * `negPicked`（负面词条，业主 2026-10-31 第二批）缺省 / 形状不对时按空数组走。
 * @param {any} priv m.private
 * @returns {{ picked: string[], negPicked: { id: string, tier: number|null }[] }|null} null = 这一局没有词条（按钮与面板都不画）
 */
export function overlimitRelicsOf(priv) {
  const st = priv && typeof priv === 'object' ? priv.relicsOverlimit : null;
  if (!st || typeof st !== 'object') return null;
  const neg = Array.isArray(st.negPicked) ? st.negPicked : [];
  return {
    ...st,
    picked: Array.isArray(st.picked) ? st.picked.filter((id) => typeof id === 'string' && id) : [],
    negPicked: neg
      .map((x) => (typeof x === 'string' ? { id: x, tier: null } : (x && typeof x.id === 'string' ? { id: x.id, tier: Number.isInteger(x.tier) ? x.tier : null } : null)))
      .filter((x) => x && x.id),
  };
}

/**
 * 已选词条面板的纯视图 —— **照抄炸惊「已选惊变」面板的壳与行**：外壳 .zjpanel / .zjpanel__head / .zjpanel__body、
 * 列表 .zjpanel__grid、行 .zjsel 全部来自 css/screens/jibian.css，尺寸与 --zj-u 的缩放一起继承；
 * 只多一条「分组色条」：.zjsel::before 那根 3px 竖条的颜色由 `--zj-r` 决定，这里按 `data-group` 覆写
 * （颜色与词条三选一的卡面同一套，见 css/screens/overlimitRelics.css）。
 * 一行 = 图标（`icon`，缺失 / 加载失败都落回 GIcon 占位）+ 词条名 + 编号 + 分组色条；整行 title 是全文。
 * **负面词条列在同一块列表里**（业主 2026-10-31 第二批；「另加一段」业主未定，先按同一面板 + 分组色区分做）：
 * 顺序 = 饰品（picked 顺序）在前、负面（negPicked 顺序）在后；负面行的色条是 `neg`（警示红），档位（Ⅰ/Ⅱ/Ⅲ）画在
 * 编号后面那枚小字上。合计数字 = 两段之和。
 * 空态用 msgid `t('还没有选过词条')`（业主 2026-10-31 定稿；之前借用的是 `t('无')`）。
 * @param {{ picked?: string[], negPicked?: ({ id: string, tier?: number|null }|string)[], onClose?: () => void }} props
 */
export function OverlimitRelicPanelView({ picked = [], negPicked = [], onClose = () => {} }) {
  ensureRelicCss();
  const rows = [...pickedRelicRows(relicEntries(), picked), ...pickedNegativeRows(negativeEntries(), negPicked)];
  return html`<div class="zjpanel zjpanel--relics" role="dialog" aria-modal="false" aria-label=${t('词条')}
      data-testid="overlimit-relic-panel">
    <div class="zjpanel__scrim" onClick=${onClose}></div>
    <div class="zjpanel__box">
      <header class="zjpanel__head">
        <span class="zjpanel__micro">OVERLIMIT // RELICS</span>
        <b class="zjpanel__title">${t('词条')}</b>
        <span class="zjcodex__total num" data-testid="overlimit-relic-total">${rows.length}</span>
        <button type="button" class="zjpanel__x" aria-label=${t('关闭')} title=${t('关闭')}
          data-testid="overlimit-relic-close" onClick=${onClose}><${Icon} name="close" /></button>
      </header>
      <div class="zjpanel__body">
        ${rows.length
          ? html`<div class="zjpanel__grid" data-testid="overlimit-relic-list">${rows.map((r) => html`<div key=${r.id}
              class=${cx('zjsel', r.group === 'neg' && 'zjsel--neg')} data-group=${r.group || null} data-testid="overlimit-relic-row"
              title=${[r.name, r.id, r.desc].filter(Boolean).join('\n')}>
              <span class="zjsel__icon"><${Img} src=${r.icon} fallback=${html`<${GIcon} name="bolt" />`} /></span>
              <div class="zjsel__main">
                <span class="zjsel__head">
                  <b class="zjsel__name">${r.name}</b>
                  <span class="zjsel__rarity num">${r.id}</span>
                  ${r.tier ? html`<span class="zjsel__tier num">${r.tier}</span>` : null}
                </span>
              </div>
            </div>`)}</div>`
          : html`<p class="zjpanel__none" data-testid="overlimit-relic-empty">${t('还没有选过词条')}</p>`}
      </div>
    </div>
  </div>`;
}

/**
 * 已选词条面板（带 hooks）：等词条表到货后重画一次 + Esc 关闭；遮罩与右上角 ✕ 走 onClose。
 * 开关状态归 screens/game.js（与炸惊的 JibianHudButton / JibianPanel 同一个分法：按钮只发开合，面板只报关闭）。
 * @param {{ picked?: string[], negPicked?: ({ id: string, tier?: number|null }|string)[], onClose?: () => void }} props
 */
export function OverlimitRelicPanel({ picked = [], negPicked = [], onClose = () => {} }) {
  useData('relicsOverlimit');
  useData('relicsOverlimitNegative');
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') closeRef.current(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  return html`<${OverlimitRelicPanelView} picked=${picked} negPicked=${negPicked} onClose=${() => closeRef.current()} />`;
}

// public/js/screens/extensionThemeHall.js — 主题大厅：选中一个玩法包之后的下一级（业主 2026-10-28）
//
// 流程：大厅 → 拓展模式（选择拓展玩法）→ 选中「湮灭模拟」进入 → **本屏** → 单人 / 同盟 + 蚀流 → 开始 → 房。
//
// 美术取自原玩法包（E:\Workbox\.session-dump\ext\annihilation\湮灭模拟-独立mod-v3.2.0）：
//   * 主视觉 assets/annihilation-intro/art/crimson-knight.webp（不息恶火）做全屏底图，压暗后只留右侧的赤色轮廓；
//   * 封面 slide-01 的排版语汇：左上小标（ANNIHILATION // FIELD MANUAL）、左侧赤红竖线、大标题、右侧光环、底部一排选择；
//   * 配色沿用玩法包自己的 --x-color（#5b0a14）与封面里的余烬橙（#e85c3a）。
// 图不在（未装资源）时只留底色与排版，不报错：<img> 的 onError 自己隐藏，底下的渐变仍然成立。
//
// 无状态视图：蚀流与单人/同盟都是大厅（lobby.js）的状态，这里只收 props 并回传 —— 与 ExtensionHall 同一套约定，
// 测试才能不跑 hooks 地渲染它（test/ui/extension-modes.test.js）。两处例外都是叶子组件：
//   * 左下角的两枚入口（ExtThemeDock）：自己只留「S.W.E.E.P.报告开着没有」这一个开关；
//   * 惊变一览（ExtThemeCodex，task-16）：只在玩法包声明了 `codex` 时出现，自己只留「一览开着没有」这一个开关。
// 本页其余一切仍由 props 决定。
import { html, Icon } from '../ui/components.js';
import { openGuide } from '../ui/guide.js';
import { useEffect, useState } from '../../vendor/hooks.module.js';
// S.W.E.E.P.报告：与大厅**同一份**组件（screens/sweep.js），这里只多一个入口，不另建一套报告。
import { SweepReport } from './sweep.js';
// 惊变一览：局内那颗（ui/jibian.js 的 JibianCodex）原样复用 —— 99 张按稀有度分组、已拥有打勾、纯只读。
// 这里不复制也不改它的内部（另一任务在动），只调用它的导出。
import { JibianCodex } from '../ui/jibian.js';
import { t } from '../../../shared/i18n.js';

/** The two lobby forms of a play set: 单人 (a `solo` room) and 同盟 (a `coop` room). */
const PARTY_KINDS = [
  { id: 'solo', text: '单人' },
  { id: 'coop', text: '同盟' },
];

/**
 * 左下角的两枚入口（业主 2026-10-29）：S.W.E.E.P. 清单 在 干员调配 **之上**，两枚都落在页脚那条横线之上、**同宽**。
 *  - 干员调配：与大厅首页那颗 hub-plate--loadout 同一套薄板语汇，只是更窄；点开的是**既有的**干员调配整屏 ——
 *    `onPoolEdit` 交回大厅，由它 `openLoadout('ext', null, 'loadout', id)`（不复制那一屏）。
 *    **2026-10-29 修订**：原先旁边还有一颗「卡池调整」，它与这颗打开的是同一屏（业主：「干员调配和卡池调整重复」），
 *    已删掉；二级页不再出现「卡池调整」，入口统一叫「干员调配」（`data-testid="ext-loadout"`）。
 *  - S.W.E.E.P.报告：与大厅**同一份** `SweepReport`（screens/sweep.js），像大厅那样挂一层；特殊模式只有这一个入口。
 * 开关只留在本组件里（主题大厅对上仍是 props 的函数），所以它是叶子组件、不是新的 props 通道。
 * @param {{ mode: any, onPoolEdit: (id: string) => void }} props
 */
function ExtThemeDock({ mode, onPoolEdit }) {
  const [sweepOpen, setSweepOpen] = useState(false);
  return html`<div class="ext-theme__dock">
    <button type="button" class="ext-theme__slot" data-testid="ext-sweep"
        title=${t('S.W.E.E.P.报告')} aria-label=${t('S.W.E.E.P.报告')} onClick=${() => setSweepOpen(true)}>
      <${Icon} name="search" /><span>${t('S.W.E.E.P.报告')}</span>
    </button>
    <button type="button" class="ext-theme__loadout" data-testid="ext-loadout"
        title=${t('干员调配')} aria-label=${t('干员调配')} onClick=${() => onPoolEdit(mode.id)}>
      <span class="ext-theme__loadout-glyph" aria-hidden="true"><${Icon} name="user" /></span>
      <span class="ext-theme__loadout-label">${t('干员调配')}</span>
    </button>
    ${sweepOpen ? html`<${SweepReport} extension=${mode.id} onClose=${() => setSweepOpen(false)} />` : null}
  </div>`;
}

/**
 * 惊变一览的入口 + 面板（纯视图，业主 task-16）：一颗与「规则 / 攻略说明」同形状的按钮，点开就是局内那份
 * `JibianCodex`（99 张按稀有度分组）。局外没有 `m.private.jibian.owned`，`owned` 传空数组：面板是只读的，
 * 不抽卡、不建房、不动任何对局状态；`onOpen` / `onClose` 由外面给，这里不持有开关。
 * @param {{ modeId?: string|null, open?: boolean, onOpen?: () => void, onClose?: () => void }} props
 *   modeId: 这份惊变牌库的模式 id（`config.modes[modeId].jibian.pool`，炸惊是 `mode_single_zhajing`）
 */
export function ExtThemeCodexView({ modeId = null, open = false, onOpen = () => {}, onClose = () => {} }) {
  if (!modeId) return null;
  return [
    html`<button type="button" class="ext-theme__guide ext-theme__codex" data-testid="extension-codex"
        title=${t('惊变一览')} aria-label=${t('惊变一览')} onClick=${onOpen}>
      <${Icon} name="eye" /><span>${t('惊变一览')}</span>
    </button>`,
    // 点遮罩 / 关闭键 / Esc 都走 `onClose`（前两者是 jibian.js 自己的，Esc 由下面对叶子组件拦）。
    open ? html`<${JibianCodex} modeId=${modeId} owned=${[]} onClose=${onClose} />` : null,
  ];
}

/**
 * 惊变一览的叶子组件：只留「一览开着没有」这一个开关，外加 Esc 的归属。
 * 主题大厅在项目 Modal 里（components.js），它的 window keydown 会把 Esc 当成「返回列表」——
 * 所以在**捕获阶段**截下这一次 Escape 并 `stopPropagation`，Modal 就看不到它：关的是一览，二级页原地不动。
 * jibian.js 与局内 HUD 共用、另一个任务在改它的内部，这里只调用它的导出，不给它加键盘处理。
 * @param {{ modeId: string }} props
 */
function ExtThemeCodex({ modeId }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open || typeof window === 'undefined') return undefined;
    const onKey = (e) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      setOpen(false);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open]);
  return html`<${ExtThemeCodexView} modeId=${modeId} open=${open} onOpen=${() => setOpen(true)}
      onClose=${() => setOpen(false)} />`;
}

/**
 * 主题大厅：一个玩法包自己的入口页。
 * @param {{ mode: any, erosion?: number, onErosion?: (n: number) => void,
 *   party?: 'solo'|'coop', onParty?: (p: 'solo'|'coop') => void,
 *   onPick?: (id: string, erosion: number, party: 'solo'|'coop') => void,
 *   onBack?: () => void, busy?: string|null, online?: boolean }} props
 *   mode: an EXTENSION_MODES entry (needs `theme.art`, `theme.kicker`, `erosionTiers`, `code`, `name`, `en`, `desc`;
 *   `codex` — a mode id — adds the read-only 惊变一览 entry, task-16)
 */
export function ExtensionThemeHall({ mode, erosion = 1, onErosion = () => {}, party = 'solo', onParty = () => {},
  onPick = () => {}, onBack = () => {}, onRules = () => {}, onPoolEdit = () => {}, onFeatureSettings = () => {},
  busy = null, online = true }) {
  const playable = mode.status === 'ready';
  const tiers = Number.isInteger(mode.erosionTiers) && mode.erosionTiers > 1 ? mode.erosionTiers : 0;
  // 单人 / 同盟 is declared by `forms` (two lobby forms, no ladder — 炸惊模拟) or implied by `erosionTiers` (湮灭模拟);
  // 蚀流 chips need `erosionTiers`. Same rule as the list (screens/extensionModes.js, docs/EXTENSION_MODE.md §2.3).
  const forms = Array.isArray(mode.forms) ? mode.forms.filter((f) => f === 'solo' || f === 'coop') : [];
  const partyIds = forms.length ? forms : (tiers ? PARTY_KINDS.map((k) => k.id) : []);
  const partyKind = party === 'coop' ? 'coop' : 'solo';
  const startText = t('开始 {name}', { name: t(mode.name) });
  const art = mode.theme && mode.theme.art ? mode.theme.art : null;
  const kicker = mode.theme && mode.theme.kicker ? mode.theme.kicker : `${mode.code} // ${mode.en}`;
  // 惊变一览（task-16）：条目声明 `codex` = 局外那份惊变牌库的模式 id，二级页才多这一颗入口。
  // 与 `rules` / `poolEdit` / `featureSettings` 同一个套路：大厅只画表里声明了的东西。
  const codexMode = typeof mode.codex === 'string' && mode.codex ? mode.codex : null;

  return html`<div class="ext-theme" data-theme=${mode.id} style=${`--x-color:${mode.color}`} data-testid="extension-theme">
    <div class="ext-theme__art" aria-hidden="true">
      ${art ? html`<img class="ext-theme__art-img" src=${art} alt="" decoding="async"
          onError=${(e) => { e.currentTarget.style.display = 'none'; }} />` : null}
      <span class="ext-theme__veil"></span>
      <span class="ext-theme__ring"></span>
    </div>

    <header class="ext-theme__top">
      <button type="button" class="proto-back ext-theme__back" onClick=${onBack}
          title=${t('返回')} aria-label=${t('返回')} data-testid="extension-theme-back">
        <${Icon} name="chevronLeft" /><span class="proto-back__home"><${Icon} name="rook" /></span>
      </button>
      <div class="ext-theme__title">
        <span class="ext-theme__kicker">${kicker}</span>
        <h2 class="ext-theme__name">${t(mode.name)}</h2>
        <span class="ext-theme__meta"><b class="num">${mode.code}</b><i>${mode.en}</i></span>
      </div>
    </header>

    <div class="ext-theme__body">
      <p class="ext-theme__desc">${t(mode.desc)}</p>
      <ul class="ext-theme__feats">${(mode.features || []).map((f) => html`<li key=${f}>${t(f)}</li>`)}</ul>
      ${Array.isArray(mode.guide) && mode.guide.length ? html`<button type="button" class="ext-theme__guide" data-testid="extension-guide"
          onClick=${() => openGuide(0, mode.guide)}>
        <${Icon} name="book" /><span>${t('攻略说明')}</span><i class="num">${mode.guide.length}</i>
      </button>` : null}
      ${mode.rules === true ? html`<button type="button" class="ext-theme__guide ext-theme__rules" data-testid="extension-rules"
          onClick=${onRules}>
        <${Icon} name="info" /><span>${t('规则')}</span>
      </button>` : null}
      ${codexMode ? html`<${ExtThemeCodex} modeId=${codexMode} />` : null}
      ${mode.featureSettings === true ? html`<button type="button" class="ext-theme__guide ext-theme__feat" data-testid="extension-feature-settings"
          title=${t('功能设置')} onClick=${() => onFeatureSettings(mode.id)}>
        <${Icon} name="dots" /><span>${t('功能设置')}</span>
      </button>` : null}
    </div>

    <footer class="ext-theme__foot">
      ${mode.poolEdit === true ? html`<div class="ext-theme__corner">
        <${ExtThemeDock} mode=${mode} onPoolEdit=${onPoolEdit} />
      </div>` : null}
      <span class="ext-theme__pack num">${t(mode.pack)}</span>
      ${partyIds.length ? html`<div class="ext-party" role="group" aria-label=${`${t('单人')} / ${t('同盟')}`} data-testid="extension-party">
        ${PARTY_KINDS.filter((k) => partyIds.includes(k.id)).map((k) => html`<button type="button" key=${k.id}
            class=${`ext-party__chip${partyKind === k.id ? ' is-on' : ''}`} data-party=${k.id}
            aria-pressed=${partyKind === k.id ? 'true' : 'false'}
            onClick=${() => onParty(k.id)}>${t(k.text)}</button>`)}
      </div>` : null}
      ${tiers ? html`<div class="ext-tiers" role="group" aria-label=${t('蚀流')} data-testid="extension-tiers">
        <span class="ext-tiers__label">${t('蚀流')}</span>
        ${Array.from({ length: tiers }, (_, i) => i + 1).map((n) => html`<button type="button" key=${n}
            class=${`ext-tier num${n === erosion ? ' is-on' : ''}`} data-tier=${n} aria-pressed=${n === erosion ? 'true' : 'false'}
            aria-label=${`${t('蚀流')} ${n}`} title=${n === tiers ? t('无尽湮灭') : null}
            onClick=${() => onErosion(n)}>${n}</button>`)}
      </div>` : null}
      <button type="button" class="ext-theme__start is-cta" data-testid="extension-start" disabled=${!playable || busy === 'create' || !online}
          title=${playable ? startText : t(mode.reason || '玩法包尚未接入本机')}
          onClick=${() => { if (playable) onPick(mode.id, erosion, partyKind); }}>
        <${Icon} name="play" class="ext-theme__starticon" /><span class="ext-theme__starttext">${startText}</span>
      </button>
    </footer>
  </div>`;
}

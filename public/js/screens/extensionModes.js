// 拓展模式 (the maintainer's decision of 2026-10-26): the hub's third entry and its 拓展玩法 hall. A mode here is neither an
// official difficulty nor a room mode — the hall is a catalogue of play sets (玩法包) that a server may carry beside the
// official four difficulties. Every entry states its own `status`, and 开始 is enabled only for a `ready` one. The first
// entry, 湮灭模拟 (AC-5), is `ready` (2026-10-27: the whole path — 房内蚀流胶囊 → 开始模拟 → 简报 → 策略草稿 → R1 的藏品
// 三选一 → 选完能准备就绪 → 局内角标 — was walked on a real machine, devtools/render-check-annihilation-room.mjs): its
// code, colour, features and numbers come from the play set itself (mode_single_annihilation / mode_multi_annihilation in
// the Annihilation mod v3.1.0 — code AC-5, colour #5b0a14, 蚀流 1–6, 87 relics, 首领血点 bloodPointAbyss). 开始 opens a
// room whose difficulty is ANNIHILATION and whose 蚀流 tier and 单人/同盟 kind are the hall's own state
// (the lobby's createExtension).
//
// 2026-10-28: the second play set, 炸惊模拟 (ZHAJING, mode_single_zhajing / mode_multi_zhajing, code AC-8, colour #17d9a0,
// handoff/ZHAJING-SPLIT-PLAN-2026-10-28.md) — its numbers, its 惊变 card pools and its 惊变 界面 are its own, and it is in
// the same table as an entry and nothing else. It declares `forms: ['solo','coop']` instead of `erosionTiers`: it has the
// two lobby forms but no 蚀流 ladder, so those two chips (and only those) show for it.
//
// The layout is the reference page's second pass (public/dev/extension-hall-preview.html, 2026-10-26): a play set's dossier
// at the left, an evenly spaced option list at the right. Its two fixes are the rules below — a row is a fixed height with a
// one-line description (a longer text never pushes the next row down), and the dossier, not the row, holds the features.
// Sizes follow 文字大小 (--t) like the other dialogs; the rows keep 88 / 64 / 56 px so the list stays an even ladder at any
// text size (the 88 is [ASSUMED]: the reference page measured it against this page's own scale).
//
// Adding a play set is one entry in EXTENSION_MODES and nothing else — the hall draws whatever the table holds (1 → N), and
// an entry whose pack is absent stays listed with its reason rather than disappearing.
//
// The selection lives in the lobby (`extPick`), like 选择模拟协议's difficulty: the hall is a function of its props, so a
// test can call it and read the vnode tree (test/ui/extension-modes.test.js).

import { html, Icon, Modal } from '../ui/components.js';
import { t, N_ } from '../../../shared/i18n.js';
import { ExtensionThemeHall } from './extensionThemeHall.js';
import { ANNIHILATION_DIFFICULTY } from '../../../shared/annihilation-constants.js';

/**
 * 炸惊模拟's difficulty value — the play set's own wire value, mirrored from the server's
 * `shared/zhajing-constants.js` (ZHAJING_DIFFICULTY, the data worker's file). The client keeps its own copy so the entry
 * table does not depend on a server module landing first; the VALUE is the contract (`modeIdFor('solo', 'ZHAJING')` →
 * `mode_single_zhajing`), so the two must never drift.
 */
export const ZHAJING_DIFFICULTY = 'ZHAJING';

/**
 * The play sets the hall lists. `status`:
 *   'ready'   — the play set is in this build: 开始 opens it (docs/EXTENSION_MODE.md §2);
 *   'pending' — its entry and data are here, its engine is not: the row is listed, its 开始 stays disabled and the dossier
 *               says why (`reason`);
 *   'missing' — not shipped at all (a 筹备中 placeholder): the row is dashed and not selectable.
 * `code` / `color` / `en` / `features` are the play set's own (the Annihilation mod's mode table), never the official four
 * difficulties' — the hall borrows no difficulty's code, colour or effects.
 * `difficulty` is what the play set's room is created with (`room.create.difficulty`); it is the play set's own value and
 * deliberately not a `DIFFICULTIES` member.
 * `erosionTiers` and `forms` are the two *selector* declarations: a play set that declares `erosionTiers` gets the 1–N 蚀流
 * chips (and the 单人 / 同盟 ones), a play set that declares `forms` gets the 单人 / 同盟 chips **without** a ladder (炸惊模拟:
 * it has two lobby forms but no 蚀流 tiers). Both are the hall's/defaults' business, not the row's.
 * @type {ReadonlyArray<{ id: string, name: string, en: string, code: string, color: string, icon: string, desc: string,
 *   features: string[], stats: { value: string, label: string }[], pack: string, status: string, reason?: string,
 *   difficulty?: string, erosionTiers?: number, forms?: string[], theme?: { art: string, kicker: string },
 *   codex?: string }>}
 */
export const EXTENSION_MODES = Object.freeze([
  {
    id: 'annihilation', name: N_('湮灭模拟'), en: 'ANNIHILATION', code: 'AC-5', color: '#5b0a14', icon: 'annihilation',
    desc: N_('敌方攻击强度突破设定上限的无限推演：可选 1~6 级蚀流，逐级加码。'),
    features: [
      N_('作战环境完全崩坏，所有地图机制升级为致命级'),
      N_('究极危险敌人，攻击模式完全无规律'),
      N_('蚀流 2 起加入藏品抽取；蚀流 6「无尽湮灭」回合无限'),
    ],
    stats: [
      { value: '1–6', label: N_('蚀流') },
      { value: '87', label: N_('藏品') },
      { value: '×5.7', label: N_('首领血点') },
    ],
    pack: N_('湮灭模拟 v3.1.0'),
    // 蚀流 1..6 (shared/annihilation-constants.js EROSION_MAX): 6 = 无尽湮灭. Only a play set that has tiers declares this.
    erosionTiers: 6,
    // 功能设置（业主 2026-10-28 晚）：湮灭的主题大厅里多一颗「功能设置」——房间级 annMods 的八个开关
    // （ui/annihilationSettings.js）。与 poolEdit / rules 同一个套路：条目声明，二级页画。
    featureSettings: true,
    // 卡池调整（业主 2026-10-28 P1-1）：湮灭也有自己的卡池档（room.loadout { mode:'annihilation' }，
    // 名册 = 房间自己的官方名册），入口与炸惊同款左下窄条、同一句文案
    poolEdit: true,
    // what the room is created with (lobby.js createExtension): the play set's own difficulty, never a DIFFICULTIES member
    difficulty: ANNIHILATION_DIFFICULTY,
    // 主题大厅（业主 2026-10-28）：选中本玩法后先进入它自己的大厅，再选单人/同盟与蚀流。主视觉与封面小标都取自原包
    // （assets/annihilation-intro/art/crimson-knight.webp 是「不息恶火」，slide-01 的眉题是 ANNIHILATION // FIELD MANUAL）。
    theme: { art: '/assets/annihilation-intro/art/crimson-knight.webp', kicker: 'ANNIHILATION // FIELD MANUAL' },
    // 攻略说明（业主 2026-10-28）：主题大厅里「攻略说明」按钮翻开的 8 页战场手册，逐字取自原包（slide-01…08，
    // 16:9 / 1600×900）。page 是**玩法包自己的**，与官方 19 页玩法说明无关：它由 GuideHost 的原样列表分支渲染，
    // 不查 data/assets.json（这些图只在磁盘上，不进清单）。
    // [ASSUMED] 图上的数值是原包 v3.1.0 的：毒雾 30 秒、禁选 5/7 等与本仓（60 秒、{5,5}/{4,7}）不同，见
    // docs/EXTENSION_MODE.md §2 与交接 §6 的决策记录 —— 玩家看到的是玩法包的原始手册，不是本仓的最终数值。
    guide: [
      { key: 'slide-01', title: N_('封面'), url: '/assets/annihilation-intro/slide-01.webp' },
      { key: 'slide-02', title: N_('模式总览'), url: '/assets/annihilation-intro/slide-02.webp' },
      { key: 'slide-03', title: N_('四条核心规则'), url: '/assets/annihilation-intro/slide-03.webp' },
      { key: 'slide-04', title: N_('蚀流 1–6'), url: '/assets/annihilation-intro/slide-04.webp' },
      { key: 'slide-05', title: N_('禁选盟约'), url: '/assets/annihilation-intro/slide-05.webp' },
      { key: 'slide-06', title: N_('藏品决策'), url: '/assets/annihilation-intro/slide-06.webp' },
      { key: 'slide-07', title: N_('战场记录'), url: '/assets/annihilation-intro/slide-07.webp' },
      { key: 'slide-08', title: N_('终局与结算'), url: '/assets/annihilation-intro/slide-08.webp' },
    ],
    status: 'ready',
  },
  // 炸惊模拟（拓展模式的第二个玩法包，业主 2026-10-28）：`difficulty: 'ZHAJING'`、mode_single_zhajing / mode_multi_zhajing、
  // code AC-8（包内与湮灭撞 AC-5，本仓给它自己的编号）、colour #17d9a0（包内 mode 的 color）。数字取自**本仓数据**：
  // 炸惊棋库是 **99 个干员位**（`data/chess.json` 里 99 条 `zhajing: true` 的非精锐记录 = 99 个不同 charId，
  // 其中重岳 / 白铁两位是 `grantOnly`、只由「祀」策略发放，不进卡池 → 可抽取 97）；包内清单说 104 位，那算的是
  // 包内 205 条记录的全部 base（含 6 条 `zhajing:false` 的副本），本仓不把它们放进名册。惊变 99 张 + 敌方 21 张；
  // allyScale atk ×2.5 / def ×3 / hp ×3。
  // **声明 theme**（2026-10-28 晚起，见本条目下面的 `theme` 字段）：本机现在有这个玩法包的主视觉
  // （`/assets/zhajing-intro/art/zhajing-key.webp`），所以它有和湮灭同一层的二级界面；列表页只画「进入」，
  // 「单人 / 同盟」两枚 chip 由 `forms` 带出来（有形态、没有蚀流档位，docs/EXTENSION_MODE.md §8.1）。
  {
    id: 'zhajing', name: N_('炸惊模拟'), en: 'BLAST SIMULATION', code: 'AC-8', color: '#17d9a0', icon: 'blast',
    desc: N_('惊变随机的推演：我方每轮 3 选 1，敌方抽一张全场共享。'),
    features: [
      N_('炸惊专属棋库：99 个干员位，只在本模式出现'),
      N_('我方惊变 99 张、敌方惊变 21 张，凑齐还有惊变羁绊'),
      N_('干员白值膨胀：生命 ×3、防御 ×3、攻击 ×2.5'),
    ],
    stats: [
      { value: '99', label: N_('干员位') },
      { value: '99+21', label: N_('惊变') },
      { value: '×2.5', label: N_('攻') },
    ],
    pack: N_('炸惊模拟 v2.1'),
    // the room's difficulty (lobby.js createExtension); the mode ids are mode_single_zhajing / mode_multi_zhajing
    difficulty: ZHAJING_DIFFICULTY,
    // 形态（单人 / 同盟）而**不是**档位：没有 erosionTiers，也照旧画这两枚 chip，蚀流缺省 1
    forms: ['solo', 'coop'],
    // 卡池调整（业主 2026-10-28 晚）：「玩法包自带卡池」，它的调整入口在二级页（打开既有的干员调配整屏、炸惊档），
    // 不进主内容的干员调配 / sweep。与 forms / erosionTiers 同一个套路：大厅只画表里声明了的东西。
    poolEdit: true,
    // 规则速览（同一屏）：条目声明 `rules` 时，二级页多一颗「规则」（ui/zhajingRules.js，数字从 config 现算）。
    rules: true,
    // 惊变一览（业主 task-16，2026-10-29）：「惊变一览写局外二级界面去」——二级页多一颗只读入口，点开复用局内
    // ui/jibian.js 的 `JibianCodex`。值 = 局外打开的那份惊变牌库的模式 id（`config.modes[modeId].jibian.pool`，
    // 99 张；单人/同盟两个模式 id 共用同一份牌库）。它只读 config 与 assets，不建房、不改任何房间状态。
    codex: 'mode_single_zhajing',
    // 二级界面（业主 2026-10-28 晚，口径与湮灭一致）：炸惊自己的主题大厅。
    // art = 业主给的背景原图（816×564 的 webp，137 KB —— 原图就这么大，不放大；CSS 用 cover + 渐变遮罩 + 轻模糊，
    // 既盖住放大噪点又保文字对比度 ≥ AA）。
    theme: { art: '/assets/zhajing-intro/art/zhajing-key.webp', kicker: 'BLAST SIMULATION // FIELD MANUAL' },
    status: 'ready',
  },
]);

/**
 * The play set of an id, or null.
 * @param {string} id
 */
export function extensionModeById(id) {
  return EXTENSION_MODES.find((m) => m.id === id) || null;
}

/**
 * Whether the hall may start this play set (its 开始 enabled).
 * @param {string} id
 */
export function extensionModePlayable(id) {
  return extensionModeById(id)?.status === 'ready';
}

/**
 * How many play sets the hall lists — the hub card's line says it. It counts the listed ones (a `missing` placeholder is
 * not a play set yet), not the `ready` ones: the hub is a catalogue sign, and 「0 个玩法」 beside a card that opens a hall
 * with an entry in it would be a lie. Whether a listed play set can start is the hall's business (its chip and its reason).
 */
export function extensionModeCount() {
  return EXTENSION_MODES.filter((m) => m.status !== 'missing').length;
}

/**
 * The first play set the hall can show a dossier of: the first with a pack, else the first entry.
 * @param {ReadonlyArray<{ id: string, status: string }>} [modes] the table to pick from (a server's own catalogue)
 */
export function defaultExtensionPick(modes = EXTENSION_MODES) {
  return (modes.find((m) => m.status !== 'missing') || modes[0]).id;
}

/** The two lobby forms of a play set: 单人 (a `solo` room) and 同盟 (a `coop` room), the same difficulty either way. */
const PARTY_KINDS = [
  { id: 'solo', text: N_('单人') },
  { id: 'coop', text: N_('同盟') },
];

/** The status chip of a row: its word and the class that colours it. */
const STATUS = {
  ready: { text: N_('可开局'), cls: 'chip--ready' },
  pending: { text: N_('待接入'), cls: 'chip--pending' },
  missing: { text: N_('筹备中'), cls: 'chip--missing' },
};

/** The ‹ + dotted rook plate at the top left (lobby.js's BackPlate, which is module-private there). */
function ExtBack({ onClick }) {
  return html`<button type="button" class="proto-back ext__back" onClick=${onClick} title=${t('返回')} aria-label=${t('返回')}>
    <${Icon} name="chevronLeft" /><span class="proto-back__home"><${Icon} name="rook" /></span>
  </button>`;
}

/**
 * 选择拓展玩法: the extension hall. Full screen — the selected play set's dossier at the left (its code, name, the numbers
 * of its own rules, its description, its feature list and the note that says whether it can start), the play sets down the
 * right as an evenly spaced list of fixed-height rows, and the foot with the pack and 开始. The project's Modal (focus trap,
 * Esc, focus restored) styled to fill the screen, like 选择模拟协议 and 选择同盟方式.
 *
 * `onPick` is called with the id of a `ready` play set, its 蚀流 tier and its 单人/同盟 kind; the lobby routes it to that
 * play set's own create path (docs/EXTENSION_MODE.md §3). A play set that is not ready stays listed with its `reason` and
 * its 开始 disabled — a catalogue entry is never hidden because its pack is absent.
 * `modes` is the catalogue drawn — EXTENSION_MODES in the game. It is a prop so the states the table cannot reach today are
 * still testable: a `pending` play set (开始 dark, the reason in the dossier), an all-`missing` catalogue (the empty
 * state), and a catalogue of a different length (1 → N). The hall never filters it: what the table holds is what the list
 * shows.
 *
 * `erosion` is the 蚀流 tier the player picked for the play set under the cursor (1..EROSION_MAX), shown as chips in the
 * foot only for an entry that declares `erosionTiers`. It is the lobby's state, like the protocol's difficulty, and it is
 * handed to `onPick` — the play set's own create path turns it into `room.create.erosion` (docs/EXTENSION_MODE.md §3). An
 * entry without tiers keeps the neutral default 1 and its create path sends no `erosion` at all.
 * `party` is the play set's form: 'solo' (独立模拟) or 'coop' (同盟模拟), shown as the two chips beside the 蚀流 ones —
 * for an entry that declares `forms` (炸惊模拟: two forms, no ladder) as well as for one that declares `erosionTiers`
 * (湮灭模拟) — and handed to `onPick` as its third argument, which turns it into `room.create.mode`. The difficulty does
 * not change between the two: `solo` + the entry's own `difficulty` is its mode_single_* record and `coop` its
 * mode_multi_* one (server/lobby.js modeIdFor). It is the lobby's state too, so it survives a switch of entry.
 * `entered` / `onEnter` / `onBack` are the 主题大厅 step (业主 2026-10-28): a play set that declares `theme` is entered
 * first (the hall's 进入), and its own hall (extensionThemeHall.js) holds 单人/同盟, 蚀流 and 开始 — so the hall itself
 * only lists and presents. Esc / 返回 inside the theme hall comes back here, it does not close the whole screen. A play
 * set without `theme` keeps the old one-step 开始 → onPick path.
 * @param {{ selected?: string|null, onSelect?: (id: string) => void, onClose: () => void,
 *   onPick?: (id: string, erosion: number, party: 'solo'|'coop') => void, erosion?: number, onErosion?: (level: number) => void,
 *   party?: 'solo'|'coop', onParty?: (party: 'solo'|'coop') => void, onPoolEdit?: (id: string) => void,
 *   busy?: string|null, online?: boolean, entered?: boolean, onEnter?: () => void, onBack?: () => void,
 *   modes?: ReadonlyArray<{ id: string, name: string, en: string, code: string, color: string, icon: string, desc: string,
 *     features: string[], stats: { value: string, label: string }[], pack: string, status: string, reason?: string,
 *     difficulty?: string, erosionTiers?: number, forms?: string[], poolEdit?: boolean, rules?: boolean,
 *     theme?: { art?: string, kicker: string } }> }} props
 * `onPoolEdit` (业主 2026-10-28 晚，口径 = 「维持原版的界面逻辑」): the play set's 卡池调整 — it opens the project's own
 * 干员调配 screen in that play set's tier (loadout.js + ui/loadoutSync.js), NOT a second editor written here. A play set
 * that declares `theme` shows the button in its 主题大厅 beside 规则 / 单人·同盟 / 开始; a themeless one keeps it in the
 * list's foot.
 * `onRules` is the same screen's 规则 entry (the play set's own rules table, ui/zhajingRules.js).
 */
export function ExtensionHall({ selected = null, onSelect = () => {}, onClose, onPick = () => {}, erosion = 1, onErosion = () => {},
  party = 'solo', onParty = () => {}, onPoolEdit = () => {}, onRules = () => {}, onFeatureSettings = () => {},
  busy = null, online = true, modes = EXTENSION_MODES,
  entered = false, enterKey = 0, onEnter = () => {}, onBack = () => {} }) {
  const byId = (id) => modes.find((m) => m.id === id) || null;
  const mode = byId(selected) || byId(defaultExtensionPick(modes));
  const status = STATUS[mode.status] || STATUS.missing;
  const playable = mode.status === 'ready';
  // a hall with no pack at all: every entry missing, so the list gives way to the empty state (the reference page's
  // 切换空状态 case, here reached by data rather than a demo switch)
  const empty = modes.every((m) => m.status === 'missing');
  const startText = playable ? t('开始 {name}', { name: t(mode.name) }) : t(status.text);
  // 主题大厅（业主 2026-10-28）：声明了 theme 的玩法包，选中后先进入它自己的大厅，再选单人/同盟与蚀流；
  // 没有 theme 的条目保持原样（开始直接建房）。Esc / 返回在主题大厅里回到本列表，而不是关掉整个大厅。
  const themed = !!mode.theme;
  // 能进主题大厅的才写「进入」；还不能开局的玩法包仍旧把状态词写在按钮上（待接入 / 筹备中）
  const enterText = themed && playable ? t('进入') : startText;
  // 蚀流 chips: only a play set that declares tiers gets them, and the tier survives a switch to another entry (it is the
  // hall's state, not the entry's) — a play set without tiers simply ignores it
  const tiers = Number.isInteger(mode.erosionTiers) && mode.erosionTiers > 1 ? mode.erosionTiers : 0;
  // 单人 / 同盟: same rule and same kind of state as the tiers, but NOT the same declaration (docs/EXTENSION_MODE.md §2.3) —
  // a play set that has both lobby forms declares `forms` and gets the two chips even without a 蚀流 ladder (炸惊模拟: 形态有、
  // 档位没有), while a play set that has a ladder implies them as before (湮灭模拟). An unknown value falls back to 单人, the
  // form a play set has always opened in.
  const forms = Array.isArray(mode.forms) ? mode.forms.filter((f) => f === 'solo' || f === 'coop') : [];
  const partyIds = forms.length ? forms : (tiers ? PARTY_KINDS.map((k) => k.id) : []);
  const partyKind = party === 'coop' ? 'coop' : 'solo';
  const showParty = partyIds.length > 0 && !themed;
  // 卡池调整（业主 2026-10-28 晚）：条目声明 `poolEdit` 才有这颗键；有 theme 的玩法包把它放在二级页（与单人/同盟、
  // 开始同一排），没有 theme 的条目才留在列表页脚。
  const poolEdit = mode.poolEdit === true && playable && !themed;

  const row = (m, i) => {
    const st = STATUS[m.status] || STATUS.missing;
    const placeholder = m.status === 'missing';
    const on = m.id === mode.id;
    return html`<li key=${m.id}>
      <button type="button" class=${`ext-row${on ? ' is-selected' : ''}${placeholder ? ' is-placeholder' : ''}`}
          style=${`--n:${i}`}
          data-ext=${m.id} data-testid=${`extension-row-${m.id}`} data-status=${m.status}
          aria-pressed=${on ? 'true' : 'false'} disabled=${placeholder}
          onClick=${() => { if (!placeholder) onSelect(m.id); }}>
        <span class="ext-row__idx num" aria-hidden="true">${String(i + 1).padStart(2, '0')}</span>
        <span class="ext-row__main">
          <span class="ext-row__head">
            <span class="ext-row__name">${t(m.name)}</span>
            <span class="ext-row__code num">${m.code}</span>
          </span>
          <span class="ext-row__desc">${t(m.desc)}</span>
        </span>
        <span class="ext-row__tail"><span class=${`chip ${st.cls}`}>${t(st.text)}</span></span>
      </button>
    </li>`;
  };

  return html`<${Modal} open=${true} onClose=${entered ? onBack : onClose} class="ext" veilClass="proto-veil">
    ${entered && themed ? html`<${ExtensionThemeHall} key=${`${mode.id}:${enterKey}`} mode=${mode} erosion=${erosion} onErosion=${onErosion}
        party=${partyKind} onParty=${onParty} onPick=${onPick} onPoolEdit=${onPoolEdit} onRules=${onRules}
        onFeatureSettings=${onFeatureSettings}
        onBack=${onBack} busy=${busy} online=${online} />` : html`
    <div class="ext__body" data-extension=${mode.id} data-status=${mode.status}>
      <div class="proto__bg ext__bg" aria-hidden="true"></div>
      <header class="proto-top">
        <${ExtBack} onClick=${onClose} />
        <div class="proto-title">
          <h2 class="modal__title">${t('选择拓展玩法')}</h2>
          <span class="proto-title__mode ext__mode"><${Icon} name="expand" />${t('拓展模式')}<i>EXTENSION MODES</i></span>
        </div>
      </header>
      <div class="proto-body ext-body">
        <section class="ext-stage" data-testid="extension-stage" style=${`--x-color:${mode.color}`} aria-label=${t('玩法档案')}>
          <span class="ext-stage__frame" aria-hidden="true"></span>
          ${mode.theme?.art ? html`<span class="ext-stage__art" aria-hidden="true">
            <img src=${mode.theme.art} alt="" decoding="async" onError=${(e) => { e.currentTarget.style.display = 'none'; }} />
          </span>` : null}
          <div class="ext-hero">
            <span class="ext-hero__art" aria-hidden="true"><${Icon} name=${mode.icon} /></span>
            <div class="ext-hero__meta">
              <span class="ext-hero__code num">${mode.code}</span>
              <h3 class="ext-hero__name">${t(mode.name)}</h3>
              <span class="ext-hero__en">${mode.en}</span>
            </div>
          </div>
          ${mode.stats.length ? html`<div class="ext-stats">
            ${mode.stats.map((s) => html`<div key=${s.label} class="ext-stat"><b class="num">${s.value}</b><span>${t(s.label)}</span></div>`)}
          </div>` : null}
          <p class="ext-desc">${t(mode.desc)}</p>
          <ul class="ext-feats">${mode.features.map((f) => html`<li key=${f}>${t(f)}</li>`)}</ul>
          <p class=${`ext-note${playable ? ' is-ready' : ''}`} data-testid="extension-note">
            <${Icon} name=${playable ? 'check' : 'info'} /><span>${playable ? t('玩法包已就位，可以直接开局。') : t(mode.reason || '玩法包尚未接入本机')}</span>
          </p>
        </section>

        <section class="ext-pane" aria-label=${t('拓展玩法')}>
          <p class="ext-pane__lead">${t('选择一个拓展玩法；它们不改动官方四档难度，玩法、难度与内容各自独立。')}</p>
          ${empty ? html`<div class="ext-empty" role="status" data-testid="extension-empty">
              <${Icon} name="expand" />
              <p>${t('还没有可玩的拓展玩法')}</p>
              <span>${t('安装一个玩法包后，它会出现在这里。')}</span>
            </div>` : html`<ul class="ext-list" role="list">${modes.map(row)}</ul>`}
          ${empty ? null : html`<div class="ext-facts" data-testid="extension-facts">
            ${[
              { k: t('玩法包'), v: t('{n} 个', { n: modes.filter((m) => m.status !== 'missing').length }) },
              { k: t('可开局'), v: t('{n} 个', { n: modes.filter((m) => m.status === 'ready').length }) },
              { k: t('难度'), v: t('各自独立') },
            ].map((f) => html`<span key=${f.k} class="ext-fact"><b>${f.v}</b><small>${f.k}</small></span>`)}
          </div>`}
          <div class="ext-foot">
            <span class="ext-foot__pack num">${t(mode.pack)}</span>
            ${showParty ? html`<div class="ext-party" role="group" aria-label=${`${t('单人')} / ${t('同盟')}`} data-testid="extension-party">
              ${PARTY_KINDS.filter((k) => partyIds.includes(k.id)).map((k) => html`<button type="button" key=${k.id}
                  class=${`ext-party__chip${partyKind === k.id ? ' is-on' : ''}`} data-party=${k.id}
                  aria-pressed=${partyKind === k.id ? 'true' : 'false'}
                  onClick=${() => onParty(k.id)}>${t(k.text)}</button>`)}
            </div>` : null}
            ${tiers && !themed ? html`<div class="ext-tiers" role="group" aria-label=${t('蚀流')} data-testid="extension-tiers">
              <span class="ext-tiers__label">${t('蚀流')}</span>
              ${Array.from({ length: tiers }, (_, i) => i + 1).map((n) => html`<button type="button" key=${n}
                  class=${`ext-tier num${n === erosion ? ' is-on' : ''}`} data-tier=${n} aria-pressed=${n === erosion ? 'true' : 'false'}
                  aria-label=${`${t('蚀流')} ${n}`} title=${n === tiers ? t('无尽湮灭') : null}
                  onClick=${() => onErosion(n)}>${n}</button>`)}
            </div>` : null}
            ${poolEdit ? html`<button type="button" class="ext-foot__pool" data-testid="extension-pool-edit"
                title=${t('卡池调整')} onClick=${() => onPoolEdit(mode.id)}>${t('卡池调整')}</button>` : null}
            <button type="button" class="ext-foot__start" data-testid=${themed ? 'extension-enter' : 'extension-start'}
                disabled=${!playable || busy === 'create' || !online}
                title=${playable ? (themed ? t('进入') : startText) : t(mode.reason || status.text)}
                onClick=${() => { if (!playable) return; if (themed) onEnter(); else onPick(mode.id, erosion, partyKind); }}>
              ${enterText}
            </button>
          </div>
        </section>

        <p class="ext-note-line">
          <${Icon} name="info" />${t('拓展玩法由玩法包自己决定规则与数值，独立于官方四档难度。')}
        </p>
      </div>
    </div>`}
  <//>`;
}

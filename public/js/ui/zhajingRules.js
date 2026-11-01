// public/js/ui/zhajingRules.js — 炸惊模拟 · 规则速览（房内「规则」按钮翻开的一张表）。
//
// **数字不是抄包内那份速览的**：参考包里 `ui/zhajingRules.js` 的 10 条写的是它自己的 v2.1 口径（毒雾 30 秒、禁选 5/7、
// 惊变在第 1/2/4/7 回合…），与本仓不一定一致。这里每条都**从本仓的 `data/config.json` 现算**（`mode_single_zhajing` /
// `mode_multi_zhajing` 的 benchSize / spPhaseKinds / jibian / enemyJibian / bans / lastRound / allyScale），
// 所以 `docs/research/17-*.json` 改一次、`tools/build-data.mjs` 重生成一次，这一页就自己跟着变 —— 不可能与引擎漂移。
// 唯一写死的是「10 格」这个普通难度的对照值（`server/match/gamedata.js` 的 DEFAULTS.benchSize）与两条文案语汇。
//
// 数据缺一项就整条不画：没有这个玩法包的服务器不会长出一页假数字（一页空表比一页假表诚实）。
import { html, Modal, Button } from './components.js';
import { data } from '../data.js';
import { t } from '../../../shared/i18n.js';

/** The play set's mode record (single first: both carry the same rules in this build). */
export function zhajingMode(cfg = data.get('config')) {
  const modes = cfg && typeof cfg === 'object' ? cfg.modes : null;
  return (modes && (modes.mode_single_zhajing || modes.mode_multi_zhajing)) || null;
}

/** 惊变 or 快递 or 悬赏 rounds of the mode's `spPhaseKinds` table (a list of round numbers). */
function roundsOfKind(mode, kind) {
  const table = mode && mode.spPhaseKinds;
  if (!table || typeof table !== 'object') return [];
  return Object.entries(table)
    .filter(([, v]) => v === kind)
    .map(([k]) => Number(k))
    .filter((n) => Number.isInteger(n))
    .sort((a, b) => a - b);
}

/** `[1,3,6]` → `1 / 3 / 6` (a round list as the card prints it; not a translatable string, only digits and slashes). */
const roundList = (list) => (list.length ? list.join(' / ') : null);

/**
 * The rule rows of 炸惊模拟, every number taken from this build's config (never from the reference pack's own sheet).
 * @param {{ cfg?: any, bonds?: any[] }} [deps]
 * @returns {{ key: string, text: string }[]}
 */
export function zhajingRules({ cfg = data.get('config'), bonds = data.get('bonds') } = {}) {
  const mode = zhajingMode(cfg);
  if (!mode) return [];
  const rows = [];
  const j = mode.jibian && typeof mode.jibian === 'object' ? mode.jibian : null;
  const ej = mode.enemyJibian && typeof mode.enemyJibian === 'object' ? mode.enemyJibian : null;
  const scale = mode.allyScale && typeof mode.allyScale === 'object' ? mode.allyScale : null;
  const bans = cfg && cfg.bans && cfg.bans.ZHAJING ? cfg.bans.ZHAJING : null;
  // benchSize / chessPrice / income 挂在 mode.economy 里（0.3.3 的经济块），不是 mode 的顶层键
  const econ = mode.economy && typeof mode.economy === 'object' ? mode.economy : {};

  const bench = Number.isInteger(econ.benchSize) ? econ.benchSize : (Number.isInteger(mode.benchSize) ? mode.benchSize : null);
  if (bench && bench !== 10) {
    rows.push({ key: 'bench', text: t('待部署区 {n} 格（普通难度是 10 格）。', { n: bench }) });
  }
  // equipPerChess 也在 economy 块里（0.3.3 的经济设置），顶层没有就退回顶层键
  const equip = Number.isInteger(econ.equipPerChess) ? econ.equipPerChess : (Number.isInteger(mode.equipPerChess) ? mode.equipPerChess : null);
  if (equip && equip !== 1) {
    rows.push({ key: 'equip', text: t('装备：每名干员可装备 {n} 件（普通难度是 1 件）。', { n: equip }) });
  }
  const jibianRounds = roundList(roundsOfKind(mode, 'jibian'));
  if (jibianRounds && j && Number.isInteger(j.cards) && j.cards > 0) {
    rows.push({ key: 'mine', text: t('我方惊变：第 {rounds} 回合各抽一次，每次 {cards} 张任选其一（每人 {rerolls} 次重抽）。',
      { rounds: jibianRounds, cards: j.cards, rerolls: Number.isInteger(j.rerolls) ? j.rerolls : 0 }) });
  }
  const enemyRounds = roundList(Array.isArray(ej?.rounds) ? ej.rounds.map(Number).filter(Number.isInteger).sort((a, b) => a - b) : []);
  if (enemyRounds && Array.isArray(ej?.pool) && ej.pool.length) {
    rows.push({ key: 'enemy', text: t('敌方惊变：第 {rounds} 回合各抽一张，全场共享、抽到就不再变化（共 {n} 张）。',
      { rounds: enemyRounds, n: ej.pool.length }) });
  }
  if (j && Array.isArray(j.pool) && j.pool.length) {
    rows.push({ key: 'pool', text: t('我方惊变共 {n} 张；已经拿到的不会再出现，凑齐同一组还能点亮惊变羁绊。', { n: j.pool.length }) });
  }
  if (scale) {
    rows.push({ key: 'scale', text: t('干员白值膨胀：生命 ×{hp}、防御 ×{def}、攻击 ×{atk}（折进白值，不是战场乘区）。',
      { hp: scale.hp, def: scale.def, atk: scale.atk }) });
  }
  if (bans && Number.isInteger(bans.core) && bans.core + bans.addon > 0) {
    // data/bonds.json is keyed by bondId (an object, not a list): accept either shape
    const list = Array.isArray(bonds) ? bonds : (bonds && typeof bonds === 'object' ? Object.values(bonds) : []);
    const off = Array.isArray(mode.inactiveBondIds)
      ? mode.inactiveBondIds.map((id) => (list.find((b) => b && b.bondId === id) || {}).name).filter(Boolean).join('、')
      : '';
    rows.push({ key: 'bans', text: off
      ? t('禁用盟约：{core} 条核心、{addon} 条附加；{bonds}不会出现在本模式。', { core: bans.core, addon: bans.addon, bonds: off })
      : t('禁用盟约：{core} 条核心、{addon} 条附加（随机禁选）。', { core: bans.core, addon: bans.addon }) });
  }
  if (Number.isInteger(mode.lastRound) && Number.isInteger(mode.bossRound)) {
    rows.push({ key: 'rounds', text: t('本局共 {rounds} 回合，第 {boss} 回合是首领；击败首领后进入隐秘核心。',
      { rounds: mode.lastRound, boss: mode.bossRound }) });
  }
  const kinds = new Set(Object.values(mode.spPhaseKinds || {}));
  if (kinds.size) {
    rows.push({ key: 'phases', text: t('特殊阶段按回合表逐个开启；惊变阶段当场揭晓卡面，不提前公开。') });
  }
  return rows;
}

/**
 * The rules dialog (the project Modal: Esc, focus trap, focus restored).
 * @param {{ onClose: () => void, open?: boolean }} props
 */
export function ZhajingRulesDialog({ onClose, open = true }) {
  const rows = zhajingRules();
  return html`<${Modal} open=${open} onClose=${onClose} title=${t('炸惊模拟 · 规则速览')} micro="BLAST // FIELD MANUAL" class="zjrules">
    <ul class="zjrules__list">
      ${rows.map((r) => html`<li key=${r.key} class="zjrules__row">${r.text}</li>`)}
    </ul>
  <//>`;
}

/**
 * 规则 entry button (room page; the same button the reference build put on the difficulty card and the room bar).
 * @param {{ onClick: () => void, class?: string }} props
 */
export function ZhajingRulesButton({ onClick, class: cls }) {
  return html`<${Button} variant="secondary" size="sm" icon="info" class=${cls} data-testid="zj-rules"
      title=${t('炸惊模拟 · 规则速览')} onClick=${onClick}>${t('规则')}<//>`;
}

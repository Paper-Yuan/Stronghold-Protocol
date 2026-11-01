// server/match/match/relicDraft.js — 超限模拟「词条」（饰品）的三选一阶段（业主 2026-10-31）。
//
// **不发明新协议**：整个阶段复用既有的 机变/惊变 三选一通道 ——
//   · 阶段 = PHASE.SP_DRAFT（客户端本来就有这个阶段的全屏浮层与倒计时语义）；
//   · 数据 = m.public.sp { family: 'overlimit', cards: [...], order, turn, picks, taken, untimed }
//     （形状与 generateDraft 的输出一致，客户端的 normalizeSp 直接吃得下）；
//   · 选卡 = 既有 `g.choice { idx }` → MatchSpDraft.pickCard → _applyCard（这里加了一条分支，见 spDraft.js）；
//   · 收尾 = MatchSpDraft.finishSpDraft → finishRelicDraft（把同一回合的机变 / 无限段的词条抉择串起来）。
//
// 触发（业主定稿）：
//   · 正常段：R3 与 R8 各一次，池 = **还没选过的 LC**（7 → 6 → 5）；R5 / R11 抽负面池（见下）；
//   · 无限段：每个 Boss 轮（R20/25/30…）打完后的下一回合一次，池 = SP + EX + FGO-SP + FGO-Ⅹ + 普通 FGO +
//     未被选走的 LC（去掉所有已选过的）。抽饰品还是负面由 `relicDraftKind` 按 Boss 轮交替决定
//     （R21/R31/R41 负面、R26/R36/R46 饰品）。
//
// 效果分两半（业主 2026-10-31 第二批起）：
//   · **整备期**的那一半在 match 侧：选中的瞬间到账（LC-SP1 的 10 资金）、每回合收入（FGO-09 / FGO-14）、
//     每回合免费刷新（FGO-17）、价格（LC-EX3）、跨回合经费（LC-EX1）—— 见 relicsOverlimit.js 与
//     content/overlimitRelics.js 的 registerMeta；
//   · **战斗**的那一半由 sim 的 content/overlimitRelics.js 读 `battleInput.relicsOverlimit`（`[{ id, at }]`）实现。
// 未实装的条目仍然是 `impl: 'pending'`：选中只记进 `this.relicState.picked` + `relicPickedLog`，不改任何数值。
// 全部 gate 在 `this.isInfinite`，普通 / 湮灭 / 炸惊一帧不变。

import { PHASE, ERR } from '../../../shared/constants.js';
import {
  RELIC_CARD_COUNT, RELIC_CARD_FAMILY, RELIC_INFINITE_FROM, RELIC_NEGATIVE_KIND,
  drawNegativeCards, drawRelicCards, negativeCardView, negativePool, negativeRng, negativeTable, negativeTierOf,
  nextNegativeRounds, nextRelicRounds, relicCardView, relicDraftKind, relicPool, relicRng, relicTable,
} from '../relicsOverlimit.js';
import { OK, fail } from './common.js';

/** 无限段的 Boss 轮口径（与 server/match/infiniteWaves.js isInfiniteBossRound 一致：R20/25/30…）。 */
const isInfiniteBossRound = (r) => Number.isInteger(r) && r >= 20 && r % 5 === 0;

/**
 * 这一回合要不要开词条三选一（**任何一个池子**：饰品或负面，见 relicsOverlimit.js relicDraftKind）。
 *
 * 正常段：R3 / R8（饰品 LC）、R5 / R11（负面）—— 还没开过就开。
 * 无限段：上一回合是 Boss 轮，**并且那只领袖真的被消灭了** —— 与 wantsTraitDraft 同一口径
 * （`_infBossClearedRound` 由 settle 在推进回合前写入；漏了 Boss 就不给词条）。
 * 抽哪个池由 `relicDraftKind` 决定（无限段按 Boss 轮交替：R21/R31/R41 负面、R26/R36/R46 饰品），这里只管「要不要开」。
 * @param {any} m Match
 * @param {number} round
 * @returns {boolean}
 */
export function wantsRelicDraft(m, round) {
  if (!m || m.isInfinite !== true) return false;
  const r = Number(round);
  if (!Number.isInteger(r) || r < 1) return false;
  const done = m.relicsOverlimit && m.relicsOverlimit.roundsDone instanceof Set ? m.relicsOverlimit.roundsDone : null;
  if (done && done.has(r)) return false;
  if (relicDraftKind(m, r) == null) return false;
  if (r < RELIC_INFINITE_FROM) return true;              // 正常段：R3 / R5 / R8 / R11
  if (!isInfiniteBossRound(r - 1)) return false;
  if (m._infBossClearedRound != null) return m._infBossClearedRound === r - 1;
  return true;
}

export class MatchRelicDraft {
  /**
   * 本局的词条状态（懒建）。两个池子各有自己的「已选走」：
   *   · `picked`     饰品的 id（无放回的唯一真源；形状沿用第一批的字符串数组，`activeRelicIds` / ids.size 都读它）；
   *   · `negPicked`  负面词条的 `{ id, tier }`（tier = 抽到的档位序号，没档位是 null）；
   *   · `roundsDone` 已开过词条三选一的回合（两个池子共用：一回合只开一次）。
   * 两个池子**互不混**：负面 id 不进 `picked`，所以「每拥有一件饰品」这类条文不会把负面词条也算成饰品。
   * @returns {{ picked: string[], negPicked: { id: string, tier: number|null }[], roundsDone: Set<number> }}
   */
  relicState() {
    if (!this.relicsOverlimit || typeof this.relicsOverlimit !== 'object') {
      this.relicsOverlimit = { picked: [], negPicked: [], roundsDone: new Set() };
    }
    if (!Array.isArray(this.relicsOverlimit.picked)) this.relicsOverlimit.picked = [];
    if (!Array.isArray(this.relicsOverlimit.negPicked)) this.relicsOverlimit.negPicked = [];
    if (!(this.relicsOverlimit.roundsDone instanceof Set)) this.relicsOverlimit.roundsDone = new Set();
    return this.relicsOverlimit;
  }

  /**
   * 开一次词条三选一。池子按 `relicDraftKind` 决定（正常段 R3/R8 = LC、R5/R11 = 负面、无限段按 Boss 轮交替 =
   * 负面 / 饰品），抽 RELIC_CARD_COUNT 张不同的卡。
   *
   * 负面池的两条额外规则（业主 2026-10-31 第三单，实现都在 relicsOverlimit.js）：
   *   · **档位按回合过滤**：R5/R11 只出 Ⅰ 档条目；无限段 R50 前 = Ⅱ 档 + 无挡位、R50 起 = Ⅲ 档 + 无挡位。
   *     所以每张卡的 `tierIndex` 由**这一回合**推导（`negativeTierOf(e, r)`），不随机取档；
   *   · **权重 1.0 / 0.5**：有挡位的留在池里（可反复抽），无挡位的抽中即移出（`negativePool` 按 `negPicked` 剔）。
   * 单人超限局：order 就是自己，没有时限（untimed）—— 与既有三选一的单人语义一致。
   * @param {number} round
   * @returns {boolean} 是否真的开起来了
   */
  enterRelicDraft(round = this.round) {
    if (this.isInfinite !== true) return false;
    const r = Number(round);
    const kind = relicDraftKind(this, r);
    if (kind == null) return false;
    const negative = kind === RELIC_NEGATIVE_KIND;
    const table = negative ? negativeTable(this.gd) : relicTable(this.gd);
    if (!table) return false;
    const alive = this.alivePlayers();
    if (!alive.length) return false;
    const st = this.relicState();
    const picked = negative ? st.negPicked.map((x) => (typeof x === 'string' ? x : x && x.id)).filter(Boolean) : st.picked;
    // 负面池按「这一回合的档位阶段」过滤（A 表）；同档已拥有的剔除（B′）要看 `negPicked` 里的 `tier`，所以整条数组传进去
    const pool = negative ? negativePool(table, st.negPicked, r) : relicPool(table, kind, new Set(picked));
    const rng = negative ? negativeRng(this, `${kind}:${r}:${picked.length}`) : relicRng(this, `${kind}:${r}:${picked.length}`);
    const cards = negative
      ? drawNegativeCards(rng, pool, RELIC_CARD_COUNT).map((e, i) => negativeCardView(e, i, negativeTierOf(e, r)))
      : drawRelicCards(rng, pool, RELIC_CARD_COUNT).map((c, i) => relicCardView(c, i));
    if (!cards.length) return false;
    const order = this.humansFirst(alive.map((p) => p.playerId));
    this.phase = PHASE.SP_DRAFT;
    this.sp = {
      family: RELIC_CARD_FAMILY,
      relicKind: kind,
      negative,
      round: r,
      // 卡面抬头由客户端出（t('词条抉择') / 眉题 OVERLIMIT // NEGATIVE）；服务端不发 UI 文案，name/desc 保持 null
      name: null,
      desc: null,
      cards,
      order, idx: 0, picks: {}, taken: {}, untimed: true, turnDeadline: 0,
    };
    st.roundsDone.add(r);
    this.setDeadline(0);
    this.markPublic();
    this.startSpTurn();
    // m.private.relicsOverlimit（已选 / 池子 / 下次回合）要立刻到端上，所以进阶段的这一帧补一次私有视图
    for (const ps of alive) this.markPrivate(ps);
    return true;
  }

  /**
   * 记下选走的词条，并立刻结算「获得该饰品后」的整备期那一半（业主 2026-10-31 第二批）。
   *
   * 战斗侧的那一半由 content/overlimitRelics.js 读 `battleInput.relicsOverlimit` 实现；这里只做**选中的瞬间**
   * 就该到账的东西：LC-SP1「WOC，是⚪神」的「并获得 10 资金」。词条是一局全队共享的，所以每名存活玩家都拿到。
   * 无放回：同一条不会出现第二次，重复记同一 id 直接拒绝（`picked` 里已经有它）。
   * @param {any} ps
   * @param {any} card sp.cards 的一项
   * @returns {boolean}
   */
  takeOverlimitRelic(ps, card) {
    if (!card || typeof card.id !== 'string' || !card.id) return false;
    if (card.negative === true) return this.takeNegativeRelic(ps, card);
    const st = this.relicState();
    if (st.picked.includes(card.id)) return false;
    st.picked.push(card.id);
    // 「只记录 / 已实装」的证据：这一局拿了什么、哪一回合、实装状态
    if (!Array.isArray(this.relicPickedLog)) this.relicPickedLog = [];
    this.relicPickedLog.push({
      id: card.id, group: card.group || null, round: this.round,
      impl: typeof card.impl === 'string' ? card.impl : 'pending',
    });
    // 选取即到账（业主表「获得该饰品后…并获得 N 资金」）：LC-SP1 +10（这条没有失效条款）。
    if (card.id === 'LC-SP1') {
      for (const p of this.alivePlayers()) p.addFunds(10, { reason: 'relic' });
    }
    if (ps && typeof ps.dirty === 'function') ps.dirty();
    return true;
  }

  /**
   * 记下选走的**负面**词条（id + 档位），与饰品分开一条记录：`m.relicsOverlimit.negPicked` /
   * `m.relicPickedLog`（带 `neg: true`）/ `battleInput.relicsOverlimitNegative`。
   * 负面词条不给任何「获得瞬间」的整备收益 —— 它的效果全是惩罚，由 sim 的 content/overlimitNegative.js 在战斗侧兑现。
   *
   * 放回规则（业主 2026-10-31 第三单）：**有挡位**的负面词条抽中后留在池里，所以同一条会被再次抽到 ——
   * 这时不叠加两份，而是把档位**升到更高的那一档**（`[ASSUMED]`：Ⅱ 期抽过 D01 = −4，Ⅲ 期又抽到 = −6 覆盖前值；
   * 记录仍只有一条，战斗侧按一条结算）。档位相同 / 更低 / 任一侧没有档位 ⇒ 按「已拥有」处理，返回 false、不动数值。
   * **无挡位**的负面词条抽中即出池（`negativePool` 按 `negPicked` 剔），正常路径不会重复到达这里。
   * @param {any} ps
   * @param {any} card sp.cards 的一项（`negative: true`）
   * @returns {boolean} 这次选取有没有改变本局的状态
   */
  takeNegativeRelic(ps, card) {
    if (!card || typeof card.id !== 'string' || !card.id) return false;
    const st = this.relicState();
    const tier = Number.isInteger(card.tierIndex) ? card.tierIndex : null;
    const at = st.negPicked.findIndex((x) => (typeof x === 'string' ? x : x && x.id) === card.id);
    if (at >= 0) {
      const cur = st.negPicked[at];
      const before = typeof cur === 'object' && cur ? cur.tier : null;
      if (!(Number.isInteger(tier) && Number.isInteger(before) && tier > before)) return false;
      cur.tier = tier;   // 同一回合的阶段更高 ⇒ 取更强的那一档（不叠加两份）
    } else {
      st.negPicked.push({ id: card.id, tier });
    }
    if (!Array.isArray(this.relicPickedLog)) this.relicPickedLog = [];
    this.relicPickedLog.push({
      id: card.id, group: card.group || 'neg', round: this.round,
      impl: typeof card.impl === 'string' ? card.impl : 'pending', neg: true, tier,
    });
    if (ps && typeof ps.dirty === 'function') ps.dirty();
    return true;
  }

  /**
   * 三选一结束：清 sp，然后接下一个阶段。
   *
   *  - 无限段（`_relicPendingRound` = 下一回合号）：先把既有的词条抉择（TRAIT_DRAFT）走完（它自己会 startRound），
   *    没有再 startRound；
   *  - 正常段（R3 / R8）：同一回合的机变先走完，然后进整备。
   * @returns {void}
   */
  finishRelicDraft() {
    const pending = this._relicPendingRound;
    this._relicPendingRound = null;
    this.sp = null;
    if (Number.isInteger(pending) && pending > 0) {
      // 与 bossRounds.js 的时点一致：这时 this.round 还是刚打完的 Boss 轮
      this._traitDoneRound = this.round;
      this._traitPendingRound = pending;
      if (this.enterTraitDraft(pending)) return;
      this._traitPendingRound = null;
      this.startRound(pending);
      return;
    }
    if (this.gd.spRounds().includes(this.round)) {
      this.enterSpDraft();
      return;
    }
    this.beforePrepOffers();
  }

  /**
   * m.private.relicsOverlimit —— 玩家侧看得到的词条状态（业主指定形状 + 第二批加的负面那一段）：
   *   `picked`     本局已选走的**饰品** id（按选取顺序）
   *   `negPicked`  本局已选走的**负面**词条 `{ id, tier }`（tier = 档位序号，没档位是 null）
   *   `pool`       无限段饰品池里还剩什么（id 列表；正常段 R8 之前也算出来，便于预览）
   *   `negPool`    负面池里还剩什么（id 列表；有挡位恒留池里、无挡位按已选剔除，与抽取口径一致）
   *   `nextAt`     还没开过的**饰品**词条回合 / `nextNegAt` 负面词条回合（正常段剩下的 + 无限段接下来的几个）
   * 非超限局不会走到这里（privateView 的 gate 在 player/views.js）。
   * @returns {{ picked: string[], negPicked: { id: string, tier: number|null }[], pool: string[], negPool: string[],
   *   nextAt: number[], nextNegAt: number[] }}
   */
  relicsOverlimitView() {
    const st = this.relicState();
    const table = relicTable(this.gd);
    const negTable = negativeTable(this.gd);
    const picked = st.picked.slice();
    const negPicked = st.negPicked.map((x) => (typeof x === 'string' ? { id: x, tier: null } : { id: x.id, tier: Number.isInteger(x.tier) ? x.tier : null }));
    const pool = table ? relicPool(table, 'infinite', new Set(picked)).map((e) => e.id) : [];
    const negPool = negTable ? negativePool(negTable, negPicked).map((e) => e.id) : [];
    return {
      picked, negPicked, pool, negPool,
      nextAt: nextRelicRounds(this.round, st.roundsDone, 3),
      nextNegAt: nextNegativeRounds(this.round, st.roundsDone, 3),
    };
  }

  /**
   * 调试 / 测试用：直接选一张（跳过 g.choice 的入参校验），语义与 pickCard 完全一致。
   * 正式路径永远是 `g.choice { idx }`（pickCard）。
   * @param {any} ps @param {number} idx
   */
  pickRelicAt(ps, idx) {
    if (this.phase !== PHASE.SP_DRAFT || !this.sp || this.sp.family !== RELIC_CARD_FAMILY) return fail(ERR.WRONG_PHASE);
    if (!ps || !ps.alive) return fail(ERR.ELIMINATED);
    if (!Number.isInteger(idx) || idx < 0 || idx >= this.sp.cards.length) return fail(ERR.BAD_TARGET);
    this._applyCard(ps, idx);
    return OK;
  }
}

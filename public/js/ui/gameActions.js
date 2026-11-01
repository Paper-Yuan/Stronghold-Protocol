// In-match intents (`g.*`, DESIGN §8.2) with uniform error handling: every request goes through
// `act()`, which plays a UI sound on success, shows the ERR_TEXT toast on failure and never throws.
// The UI never mutates state optimistically — it waits for the next m.private / m.public push.
// `net.request` is looked up at call time so the dev mock harness can stub it.

import { net } from '../net.js';
import { toastError } from './toasts.js';
import { audio } from '../audio.js';

const SUCCESS_SFX = {
  'g.buy': 'buy', 'g.sell': 'sell', 'g.refresh': 'refresh', 'g.freeze': 'freeze', 'g.levelUp': 'levelup',
  'g.move': 'drop', 'g.equip': 'equip', 'g.art': 'artPlace', 'g.reward': 'pick', 'g.choice': 'pick',
  'g.band': 'confirm', 'g.bandSkip': 'back', 'g.infoReady': 'ready', 'g.emote': 'emote', 'g.destroy': 'back', 'g.unequip': 'back',
};

let inflight = 0;
const busyListeners = new Set();
const emitBusy = () => { for (const fn of [...busyListeners]) { try { fn(inflight); } catch { /* ignore */ } } };

/** Subscribe to the number of in-flight intents (for subtle busy indicators). */
export function onBusy(fn) { busyListeners.add(fn); return () => busyListeners.delete(fn); }

// Single-flight shop refresh (GitHub #501, single-ptilopsis): under a high RTT the shop has not answered yet while the
// player taps 刷新 again — every extra g.refresh the client sends is a paid refresh (server/match intents.js → ps.refresh).
// A tap while the previous request is still on the wire is dropped; the button dims and the R hotkey stays inert (both
// call actions.refresh) until the request settles (success or failure). This is not server-side cancellation or
// idempotency: a timed-out request may already have executed. The shop bar receives onRefreshBusy via the game screen.
let refreshPending = false;
const refreshBusyListeners = new Set();
const emitRefreshBusy = () => { for (const fn of [...refreshBusyListeners]) { try { fn(refreshPending); } catch { /* ignore */ } } };

/**
 * Subscribe to the shop refresh's in-flight state — fires once with the current state.
 * @param {(busy: boolean) => void} fn
 * @returns {() => void} unsubscribe
 */
export function onRefreshBusy(fn) { refreshBusyListeners.add(fn); try { fn(refreshPending); } catch { /* ignore */ } return () => refreshBusyListeners.delete(fn); }

/**
 * Send an intent. Resolves true on `ok`, false on error (already toasted).
 * @param {string} t
 * @param {object} [fields]
 * @param {{ sfx?: string|false, quiet?: boolean }} [opts]
 * @returns {Promise<boolean>}
 */
export async function act(t, fields = {}, opts = {}) {
  inflight += 1;
  emitBusy();
  try {
    await net.request(t, fields);
    const s = opts.sfx === undefined ? SUCCESS_SFX[t] : opts.sfx;
    if (s) audio.sfx(s);
    return true;
  } catch (err) {
    if (!opts.quiet) {
      toastError(err);
      audio.sfx('error', { volume: 0.6 });
    }
    return false;
  } finally {
    inflight = Math.max(0, inflight - 1);
    emitBusy();
  }
}

export const actions = {
  infoReady: (setupRevision = 0) => act('g.infoReady', { setupRevision }),
  rerollSetup: (setupRevision) => act('room.rerollSetup', { setupRevision }, { sfx: 'confirm' }),
  rerollVote: (voteId, agree) => act('g.rerollVote', { voteId, agree }, { sfx: agree ? 'confirm' : 'back' }),
  cancelReroll: (voteId) => act('room.cancelReroll', { voteId }, { sfx: 'back' }),
  band: (bandId) => act('g.band', { bandId }),
  bandSkip: () => act('g.bandSkip'),
  buy: (slot) => act('g.buy', { slot }),
  // a tap while the previous g.refresh is still on the wire is dropped (GitHub #501) — see onRefreshBusy above
  refresh: () => {
    if (refreshPending) return Promise.resolve(false);
    refreshPending = true;
    emitRefreshBusy();
    return act('g.refresh').finally(() => { refreshPending = false; emitRefreshBusy(); });
  },
  freeze: () => act('g.freeze'),
  levelUp: () => act('g.levelUp'),
  sell: (uid) => act('g.sell', { uid }),
  // `dir` (UP|RIGHT|DOWN|LEFT): the direction chosen with the deploy wheel (research 09 §6.1 — g.move / g.art carry it;
  // the server defaults to RIGHT when absent)
  move: (uid, to, dir) => act('g.move', dir ? { uid, to, dir } : { uid, to }),
  // `replaceUid`: the equipped item the replace dialog picked (ui/equipReplace.js) — it is destroyed; absent ⇒ none needed
  equip: (itemUid, targetUid, replaceUid) => act('g.equip', Number.isInteger(replaceUid) ? { itemUid, targetUid, replaceUid } : { itemUid, targetUid }),
  art: (itemUid, row, col, dir) => act('g.art', dir ? { itemUid, row, col, dir } : { itemUid, row, col }),
  destroy: (uid) => act('g.destroy', { uid }),
  unequip: (itemUid) => act('g.unequip', { itemUid }),
  reward: (idx) => act('g.reward', { idx }),
  offer: (offer, idx, refresh = false, cardId) => act(refresh ? 'g.offerRefresh' : 'g.offer', { offerId: offer.id, pluginId: offer.pluginId, seq: offer.seq, idx, cardId }),
  choice: (idx, choiceId) => act('g.choice', choiceId === undefined ? { idx } : { idx, choiceId }),
  // 炸惊模拟 · 锻造器 (业主 2026-10-14；engine-core T11 2026-10-28 落地)：点一张卡即选。`optId` 与这一组的 `rarity`
  // **两个都必须带**（协议层只收 normal|epic|legend；服务端还会核对它与 `rolled.rarity` 一致，不一致 → BAD_TARGET）。
  // 成功回一帧完整的新 `m.private.forge`（扣数 / 累计 / 抽好下一组），所以 UI 不需要任何乐观更新。
  forgeTake: (optId, rarity) => act('g.forgeTake', { optId, rarity }, { sfx: 'pick' }),
  // 湮灭模拟 · 藏品 draft (the 1-of-3 negative pick: server/match/relics.js pickRelic)
  relic: (idx) => act('g.relic', { idx }),
  // 炸惊模拟 · 惊变 重抽 (one offered 惊变 card, its own slot; the server's MatchSpDraft.refreshSpCard: once per card,
  // `modes[*].jibian.rerolls` per player). **The protocol entry is engine-core's task (T5) — the key name and `{ idx }`
  // shape are what shared/protocol.js will carry; if that lands under another name, this one line changes.**
  // Refusals (BAD_TARGET / RATE / SOLD_OUT) come back as codes and are toasted by act() from ERR_TEXT — no new string here.
  cardRefresh: (idx) => act('g.cardRefresh', { idx }, { sfx: 'refresh' }),
  // 超限模拟 (solo_infinite): 词条抉择 / 战术撤退 / 战斗倍速（服务端只在超限局接受）
  traitChoice: (idx) => act('g.traitChoice', { idx }),
  traitReroll: () => act('g.traitReroll', {}, { quiet: true }),
  traitSkip: () => act('g.traitSkip', {}, { quiet: true }),
  traitLock: (idx) => act('g.traitLock', { idx }, { quiet: true }),
  contract: (id) => act('g.contract', { id }, { sfx: 'tab' }),
  retreat: () => act('g.retreat', {}, { sfx: 'back' }),
  combatSpeed: (speed) => act('g.combatSpeed', { speed: speed === 2 ? 2 : 1 }, { quiet: true }),
  ready: (ready) => act('g.ready', { ready }, { sfx: ready ? 'ready' : 'back' }),
  emote: (id) => act('g.emote', { id }, { quiet: true }),
  // `playerId`: the player tapped in the team panel (a shared field shows two) — what an eliminated viewer follows
  watch: (fieldId, playerId = null) => act('g.watch', typeof playerId === 'string' && playerId ? { fieldId, playerId } : { fieldId }, { sfx: 'tab' }),
  autoplay: (on) => act('g.autoplay', { on }),
  // solo battles only (ui/matchStatus.js pauseAvailable): m.public.paused follows
  pause: (on) => act('g.pause', { on: !!on }, { sfx: on ? 'click' : 'confirm' }),
  // room-level intent (NOT g.*): the host frees a spectator seat while the match runs — the server takes room.removeSpectator at
  // any time (server/lobby.js removeSpectator), the game screen had no entry for it (ui/hud.js SpectatorPill; GitHub #120)
  removeSpectator: (playerId) => act('room.removeSpectator', { playerId }, { sfx: 'back' }),
};

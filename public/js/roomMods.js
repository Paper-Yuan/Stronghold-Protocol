// public/js/roomMods.js — what mod content this client is talking to, and what a room may declare (W-A, DESIGN §28.9).
//
// Two questions live here, and they are NOT the same one:
//
//   1. WHICH SET AM I CONNECTED TO? `welcome.mods` says what the server runs (DESIGN §28.2). The client must echo that
//      digest in `room.create` / `room.join`, or the server's gate refuses the room with BAD_MSG — a browser client
//      that never read `welcome.mods` could not enter a room on a modded server at all. `welcomeModSet` holds it, and
//      `buildCreatePayload` / `buildJoinPayload` are the ONLY place the digest is put on the wire.
//   2. WHICH SUBSET MAY THIS ROOM DECLARE? The host picks from the catalogue the server declared (`welcome.mods.packs`)
//      and the pick travels as `room.create.modIds`. The room's own set is a subset of what the server loaded, so a
//      client can never name content the server does not have; `ERR.MOD_UNKNOWN` is the server's answer if it ever did.
//
// The state is module-level and framework-agnostic on purpose: the UI renders it from the store (main.js writes
// `store.roomMods`), and a Node test can drive it without a DOM. `reset()` is what a test — or a fresh connection —
// uses to get back to "no mods".
//
// ▸ Absent means absent. On a plain install `welcome` has NO `mods` key, `welcomeModSet` stays null, and every payload
// builder here returns the fields it was given, byte-identical: no `mods`, no `modIds`, no empty object.

import { mergeBehaviourDecls, behaviourValue } from '../../shared/behaviour.js';
import { setMorphPairing, setMorphSlotPolicy } from './ui/gameLogic/bonds.js';
import { setUnequipAllowed } from './ui/gameActions.js';
import { setPrepLoadout } from './ui/loadoutSync.js';

/** @typedef {{ id: string, hash: string, layer: string, combat: boolean, api?: string }} ModEntry */

/** The set the server declared in `welcome`, or null on a plain install. @type {{ digest: string, packs: ModEntry[] } | null} */
let welcomeModSet = null;
/** Pack ids the host has ticked for the room it is about to create. @type {string[]} */
let selectedModIds = [];

/** Back to "this client has been told about no mods" (a fresh connection, or a test). */
export function reset() {
  welcomeModSet = null;
  selectedModIds = [];
}

/**
 * Record what `welcome` said (main.js, on every welcome — including a reconnect). A payload without `mods` — or a
 * malformed one — clears the state: the client only ever echoes a digest it was actually handed, never one it
 * remembered from an earlier session.
 *
 * Returns whether the set is the SAME one the client already knew. When it is not (a first welcome, a server that
 * restarted with another pack root, a reconnect to a different process), the host's picks are dropped: they name packs
 * of a catalogue that is gone, and `setSelectedModIds` would drop them one by one anyway.
 * @param {any} msg the `welcome` frame
 * @returns {boolean} true when the set did not change (the caller may keep the current selection)
 */
export function setWelcomeMods(msg) {
  const mods = msg && typeof msg === 'object' ? msg.mods : null;
  const digest = mods && typeof mods.digest === 'string' ? mods.digest : null;
  const packs = mods && Array.isArray(mods.packs) ? mods.packs : [];
  const next = digest ? { digest, packs } : null;
  const same = sameSet(welcomeModSet, next);
  welcomeModSet = next;
  if (!same) {
    try {
      const raw = localStorage.getItem('sp.pref.enabledMods');
      if (raw) {
        const saved = JSON.parse(raw);
        if (Array.isArray(saved)) {
          setSelectedModIds(saved);
        } else {
          setSelectedModIds(packs.map((p) => p.id));
        }
      } else {
        setSelectedModIds(packs.map((p) => p.id));
      }
    } catch {
      setSelectedModIds(packs.map((p) => p.id));
    }
  }
  for (const p of packs) {
    if (p && p.id && Array.isArray(p.operators)) {
      registerPackOperators(p.id, p.operators);
    }
  }
  const decl = mergeBehaviourDecls(packs).decl;
  setMorphPairing(behaviourValue(decl, 'morphPairing'));
  setMorphSlotPolicy(behaviourValue(decl, 'morphPairing'));
  setUnequipAllowed(behaviourValue(decl, 'unequip') === 'allow');
  setPrepLoadout(behaviourValue(decl, 'prepLoadout'));
  return same;
}

/**
 * Whether two mod sets are the same one: same digest, same pack ids in the same order (the server sorts by id, so a
 * reordered list would be a different server). Compares digests first, which is what the gate checks.
 * @param {{ digest: string, packs: ModEntry[] } | null} a @param {{ digest: string, packs: ModEntry[] } | null} b
 */
function sameSet(a, b) {
  if (!a || !b) return a === b;
  if (a.digest !== b.digest) return false;
  if (a.packs.length !== b.packs.length) return false;
  return a.packs.every((p, i) => p && b.packs[i] && p.id === b.packs[i].id);
}

/** The set this connection was told about, or null. @returns {{ digest: string, packs: ModEntry[] } | null} */
export function currentModSet() { return welcomeModSet; }

/** The catalogue a room may declare (empty on a plain install). @returns {ModEntry[]} */
export function availableMods() { return welcomeModSet ? welcomeModSet.packs : []; }

/** Whether this server runs any workshop pack at all (the lobby only shows the picker when it does). */
export function hasMods() { return welcomeModSet !== null; }

/** The host's current picks (a copy — the caller cannot reach the module state). @returns {string[]} */
export function getSelectedModIds() { return selectedModIds.slice(); }

/**
 * Set the host's picks, keeping only ids the server actually declared and dropping duplicates. An unknown id is dropped
 * rather than sent: the server would refuse the whole `room.create` with MOD_UNKNOWN, and a stale pick (the server
 * restarted with fewer packs) must not be able to break the create button.
 * @param {string[]} ids
 * @returns {string[]} what was kept, sorted (the order the server would store)
 */
export function setSelectedModIds(ids) {
  const known = new Set(availableMods().map((p) => p.id));
  const kept = [];
  for (const id of Array.isArray(ids) ? ids : []) {
    if (typeof id === 'string' && known.has(id) && !kept.includes(id)) kept.push(id);
  }
  selectedModIds = kept.sort();
  try {
    localStorage.setItem('sp.pref.enabledMods', JSON.stringify(selectedModIds));
  } catch {}
  return selectedModIds.slice();
}

/** Whether `id` is a pack this server declared (the picker's checkbox state comes from here). @param {string} id */
export function isAvailable(id) { return availableMods().some((p) => p.id === id); }

/** Forget the host's picks (the room they were made for now exists — the next create starts from none). */
export function clearSelection() { selectedModIds = []; }

/**
 * The `room.create` fields (DESIGN §28.9, W-A).
 *
 * `mods` is the digest of the set this server runs — REQUIRED to get a seat on a modded server — and is added only when
 * the server declared one. `modIds` is the host's picks and is added only when there is at least one: an empty pick
 * means "declare nothing", which is the same message as omitting the field (and the default behaviour must not change).
 * @param {string} mode @param {string} difficulty
 * @returns {{ mode: string, difficulty: string, mods?: string, modIds?: string[] }}
 */
const chessToPackMap = new Map();

export function registerPackOperators(packId, chessIds) {
  if (!packId || !Array.isArray(chessIds)) return;
  for (const id of chessIds) {
    if (typeof id === 'string') chessToPackMap.set(id, packId);
  }
}

export function getPackIdForChess(chessId) {
  return chessToPackMap.get(chessId) || null;
}

export function buildCreatePayload(mode, difficulty) {
  /** @type {{ mode: string, difficulty: string, mods?: string, modIds?: string[] }} */
  const fields = { mode, difficulty };
  if (welcomeModSet) {
    fields.mods = welcomeModSet.digest;
    fields.modIds = selectedModIds.slice();
  }
  return fields;
}

/**
 * The `room.join` fields: the same digest, and nothing else — a room's declared set is the room's business, not
 * something a joiner may propose. On a plain install this is exactly `{ code }`.
 * @param {string} code
 * @returns {{ code: string, mods?: string }}
 */
export function buildJoinPayload(code) {
  /** @type {{ code: string, mods?: string }} */
  const fields = { code };
  if (welcomeModSet) fields.mods = welcomeModSet.digest;
  return fields;
}

/**
 * The mod list to show for a room, or null when it declared none. A room that declared a set shows ITS set — not the
 * server's — so a joiner can see what the host picked before the match starts.
 * @param {any} room a `room.state` payload
 * @returns {{ digest: string, packs: ModEntry[] } | null}
 */
export function roomModsOf(room) {
  const mods = room && typeof room === 'object' ? room.mods : null;
  if (!mods || typeof mods.digest !== 'string' || !Array.isArray(mods.packs)) return null;
  return { digest: mods.digest, packs: mods.packs };
}

/**
 * Short form of a digest for a label: the first 12 hex characters (the same prefix `server/lobby.js checkModSet`
 * quotes in its refusal, so a player reading both sees the same string).
 * @param {string} digest
 * @returns {string}
 */
export function shortDigest(digest) {
  return typeof digest === 'string' ? digest.slice(0, 12) : '';
}

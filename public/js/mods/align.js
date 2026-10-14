// public/js/mods/align.js — 对齐到房间自己那套 (W-D, DESIGN §28.16).
//
// W-B makes a room's declared set decide what that room runs, and puts the room's own data face on the wire
// (`/room-data/<摘要>/<文件>.json`). What is left for the CLIENT is the honest half of "may I play in this room":
//
//   1. **Do I really hold this room's packs?** Not "did I see them in `welcome`" — do the bytes on THIS client rebuild
//      the pack hashes the room declared. `localPackHash` (public/js/mods/sync.js) answers that with the server's own
//      algorithm, and it answers `null` when anything is missing.
//   2. **If not, can I get them?** `alignRoom` downloads exactly the room's packs (never the other ones the server
//      carries), reporting progress step by step, and then re-asks question 1.
//   3. **Which data face do I simulate on?** `roomDataBase` — `/data/` for a room that runs the process set (the common
//      case: no declaration at all), `/room-data/<digest>/` for a room that declared its own.
//
// ▸ Nothing here decides anything on the server. The room simply cannot start while a member is not ready, and this
// module is what the room screen asks before it offers that Ready button (and what refuses, by name, when it cannot).
import { CATALOG_URL, localPackHash, missing, sync } from './sync.js';
import { openStore } from './store.js';
import { modDigest } from '../../../shared/modIdentity.js';

/** The room-data face prefix the server serves (`server/http/static.js ROOM_DATA_PREFIX` — the same string). */
export const ROOM_DATA_PREFIX = '/room-data/';
/** The process data face every install has. */
export const DATA_PREFIX = '/data/';
/** A mod digest as `shared/modIdentity.js` builds it: sha256, lowercase hex. */
const DIGEST_RE = /^[0-9a-f]{64}$/;

/** The browser store, opened once per page (OPFS → IndexedDB → memory; never throws). */
let store = null;
/** @returns {ReturnType<typeof openStore>} */
export function storeFor() {
  if (!store) store = openStore();
  return store;
}

/** Tests / a caller that wants its own backend. */
export function setStore(next) { store = next || null; }

/**
 * Which data face a battle of this room must be simulated on (W-B): the room's own when it declared a set, the process
 * one otherwise. `welcome` carries the process set (`public/js/roomMods.js currentModSet`), and a room that declared
 * nothing has no `mods` at all — both are the process face, which is the point: on a plain install (or a room that
 * ticked nothing) this returns `/data/` and the loader is byte-for-byte the one that always ran.
 * @param {{ digest?: string }|null|undefined} mods a BattleSpec's / room's mod set
 * @param {{ digest?: string }|null|undefined} welcomeMods the process set from `welcome`
 * @returns {string}
 */
export function roomDataBase(mods, welcomeMods) {
  const digest = mods && typeof mods.digest === 'string' ? mods.digest : '';
  const process = welcomeMods && typeof welcomeMods.digest === 'string' ? welcomeMods.digest : '';
  if (!DIGEST_RE.test(digest) || digest === process) return DATA_PREFIX;
  return `${ROOM_DATA_PREFIX}${digest}/`;
}

/**
 * The catalogue (`GET /mods/catalog.json`) — what this server carries and what each file's hash is. Cached per page:
 * the catalogue only changes when the server restarts, and a failed load is not cached (the next call retries).
 * @param {{ fetch?: typeof fetch, url?: string }} [opts]
 * @returns {Promise<{ packs: Array<any> }|null>}
 */
let catalogPromise = null;
export function loadCatalog({ fetch: doFetch = (...a) => globalThis.fetch(...a), url = CATALOG_URL } = {}) {
  if (!catalogPromise) {
    catalogPromise = (async () => {
      try {
        const res = await doFetch(url, { cache: 'no-cache' });
        if (!res || !res.ok) return null;
        const body = await res.json();
        return body && Array.isArray(body.packs) ? body : null;
      } catch { return null; }
    })().then((cat) => {
      if (!cat) catalogPromise = null; // a failed load must not be remembered as "this server has no mods"
      return cat;
    });
  }
  return catalogPromise;
}

/** Forget the cached catalogue (a fresh connection, or a test). */
export function resetCatalog() { catalogPromise = null; }

/**
 * What it takes to line up with a room's set, WITHOUT downloading anything.
 *
 * `ok` is the whole answer to "may this client say it is ready": every pack the room declared is complete **locally**
 * (its files present, AND their bytes hashing to the catalogue's `sha256` so the pack hash can be rebuilt at all — a
 * corrupted cache entry is not "I have this pack"). `packs` carries the per-pack verdict so a UI can show which one is
 * short; `unknown` names packs the ROOM declared that this server's catalogue does not carry (a server-side
 * inconsistency — nothing here can be downloaded); `missingFiles` counts the files that are not in the store yet
 * (existence only: cheap, so a button can say how much work it is).
 * @param {{ catalog: { packs: Array<any> }|null, mods: { digest?: string, packs: Array<any> }|null, store: any }} opts
 * @returns {Promise<{ needed: boolean, ok: boolean, digest: string|null, held: string|null,
 *   packs: Array<{ id: string, ok: boolean, known: boolean }>, unknown: string[], missingFiles: number }>}
 */
export async function planAlignment({ catalog, mods, store: st }) {
  const roomPacks = mods && Array.isArray(mods.packs) ? mods.packs.filter((p) => p && typeof p.id === 'string') : [];
  if (!roomPacks.length) return { needed: false, ok: true, digest: null, held: null, packs: [], unknown: [], missingFiles: 0 };
  const known = new Set((Array.isArray(catalog?.packs) ? catalog.packs : []).map((p) => p && p.id));
  const unknown = roomPacks.filter((p) => !known.has(p.id)).map((p) => p.id);
  const packs = [];
  /** @type {Array<{ id: string, hash: string }>} */
  const verified = [];
  for (const p of roomPacks) {
    if (!known.has(p.id)) { packs.push({ id: p.id, ok: false, known: false }); continue; }
    const local = await localPackHash(p.id, st, catalog, { verifyBytes: true });
    const ok = local !== null && local === p.hash;
    packs.push({ id: p.id, ok, known: true });
    if (ok) verified.push({ id: p.id, hash: p.hash });
  }
  const held = verified.length === roomPacks.length ? modDigest(verified) : null;
  const files = await missing(catalog, roomPacks.filter((p) => known.has(p.id)).map((p) => p.id), st);
  // The digest the room declared is the judge, not "I have every pack I could find": a server whose set moved under us
  // must show up here rather than be papered over.
  const ok = unknown.length === 0 && held !== null && held === mods.digest;
  return { needed: true, ok, digest: mods.digest ?? null, held, packs, unknown, missingFiles: files.length };
}

/**
 * Line up with a room's set: download exactly its packs (and nothing else the server carries), then answer again whether
 * the client really holds them.
 *
 * `onProgress` is `sync`'s event stream, untouched (see public/js/mods/sync.js for the shapes) — a UI draws its bar from
 * it. The return value is `planAlignment`'s, so a caller never has to interpret the download's own summary: what matters
 * is whether the BYTES now rebuild what the room declared.
 * @param {{ catalog: any, mods: any, store: any, onProgress?: ((e: any) => void)|null, fetch?: typeof fetch,
 *   concurrency?: number, retries?: number, fileTimeoutMs?: number, urlPrefix?: string, signal?: AbortSignal|null }} opts
 * @returns {Promise<Awaited<ReturnType<typeof planAlignment>>>}
 */
export async function alignRoom({ catalog, mods, store: st, onProgress = null, fetch: doFetch, ...rest }) {
  const roomPacks = mods && Array.isArray(mods.packs) ? mods.packs.filter((p) => p && typeof p.id === 'string') : [];
  const known = new Set((Array.isArray(catalog?.packs) ? catalog.packs : []).map((p) => p && p.id));
  const ids = roomPacks.filter((p) => known.has(p.id)).map((p) => p.id);
  if (ids.length) {
    await sync({
      catalog, packIds: ids, store: st, onProgress,
      ...(doFetch ? { fetch: doFetch } : {}),
      ...rest,
    });
  }
  return planAlignment({ catalog, mods, store: st });
}

/**
 * The human-readable half of 「为什么进不去」: the pack ids this client is missing (unknown to the catalogue included,
 * because "the server does not have it" and "I do not have it" both mean "this room cannot run here").
 * @param {{ packs?: Array<{ id: string, ok: boolean }> }|null} plan
 * @returns {string[]}
 */
export function missingPackIds(plan) {
  return (plan && Array.isArray(plan.packs) ? plan.packs : []).filter((p) => p && p.ok === false).map((p) => p.id);
}
